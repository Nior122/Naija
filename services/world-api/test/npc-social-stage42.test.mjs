// NPC activity and player-to-NPC social bonds (Stage 42): server behaviour over the socket.
//
// Runs on every configured backend: file always, PostgreSQL when the live database is configured (the same tests run
// on both; see support/creation-backends.mjs). Each test drives a real server and checks what the server reports AND
// what is stored. Time is set by the test: the world clock does not tick in these tests.
//
// What these tests prove:
//   - The neighbourhood residents keep their fixed IDs, names, and birth dates across a restart (never regenerated).
//   - NPC activity follows the in-game clock (school hours on school days, the evening hall, sleep), and an NPC is
//     actionable only when the character can see them and they are here and awake.
//   - greet, talk, acquaint, argue, and apologise are validated by the server. Each is idempotent for a request ID;
//     a repeat is a duplicate; a reused ID for another request is refused. Refusals change nothing.
//   - Cooldowns hold for their full length in game minutes, and a boundary minute is allowed.
//   - Affinity, counts, and history are server-owned: a client-supplied value is ignored.
//   - A bond survives a restart, and a returning player is recognised in the dialogue.
//   - A failed save is not confirmed, and a retry with the same request ID applies the change once.
//   - A character sees only its own bonds, and only NPCs it can see.
// What they do NOT prove: Godot UI behaviour (see the client contract tests), or behaviour at other times of day
// beyond those listed here. The unit rules are in npc-social-rules-stage42.test.mjs.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { dateForWorldDay } from "../dist/life/calendar.js";
import { loadNPCSocialCatalog } from "../dist/npc/index.js";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";

const SERVER_OPTIONS = { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } };
const catalog = loadNPCSocialCatalog();
const RESIDENT_IDS = catalog.residents.map((resident) => resident.person_id);
const FOLAKE = "npc-nb-folake-bello";
const YUSUF = "npc-nb-yusuf-danjuma";
const CHIOMA = "npc-nb-chioma-eze";
const HALL = "community_hall";
const SCHOOL = "schoolyard";
const MONDAY = 1; // (day - 1) % 7 === 0, a school day
const SATURDAY = 6; // (day - 1) % 7 === 5, not a school day
const EVENING = 19 * 60;

const opened = [];

before(connectBackends);
after(disconnectBackends);

afterEach(async () => {
  while (opened.length > 0) {
    const entry = opened.pop();
    for (const peer of entry.peers) peer.close();
    await entry.started.stop();
    await entry.backend.cleanup();
  }
});

async function session(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, SERVER_OPTIONS);
  const entry = { backend, started, peers: [] };
  opened.push(entry);
  return entry;
}

/**
 * A real character over the socket, placed at `location`. The snapshot is read on a fresh connection after placement,
 * so it reflects the location and the clock the test set.
 */
async function citizen(entry, name, location = "home") {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = entry.backend.store.state.players[identity.playerId].character;
  character.current_location = location;
  await entry.backend.store.flush();
  const who = {
    peer,
    playerId: identity.playerId,
    sessionToken: identity.sessionToken,
    characterId: character.character_id,
    name,
    character,
    snapshot: null,
  };
  await reconnect(entry, who);
  return who;
}

/** Closes the character's socket and opens a fresh one. The session resumes, as after a reconnect. */
async function reconnect(entry, who) {
  await who.peer.close();
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const resumed = await resumeSession(peer, who.sessionToken);
  who.peer = peer;
  who.snapshot = resumed.character;
  return resumed.character;
}

/** Sets the in-game clock (day and minute), keeping world_date consistent with the day. */
async function setClock(entry, day, minuteOfDay) {
  const clock = entry.backend.store.state.worldClock;
  clock.day = day;
  clock.minute_of_day = minuteOfDay;
  clock.world_date = dateForWorldDay(day);
  await entry.backend.store.flush();
}

async function setLocation(entry, who, location) {
  who.character.current_location = location;
  await entry.backend.store.flush();
}

function settle(peer, requestId, timeoutMs = 20000) {
  return peer.waitFor((message) => message.requestId === requestId && (
    message.type === "npc.result" || message.type === "npc.error" || message.type === "command.duplicate" ||
    (message.type === "error" && message.code === "request_id_reused")
  ), timeoutMs);
}

async function social(who, requestId, action, npcId, extra = {}) {
  who.peer.send({ type: "npc.action", requestId, action, npcId, ...extra });
  return settle(who.peer, requestId);
}

async function view(who, npcId) {
  who.peer.send({ type: "npc.view", npcId });
  return who.peer.waitFor((message) => (message.type === "npc.view" || message.type === "npc.error") &&
    message.npcId === npcId, 20000);
}

function bondIn(state, npcId, characterId) {
  return state.people[npcId]?.npc_social?.bonds?.[characterId];
}

function durableBond(saved, npcId, characterId) {
  return saved.people[npcId]?.npc_social?.bonds?.[characterId];
}

/** Waits until the saved world satisfies the predicate. Used before a restart, so the old process has finished writing. */
async function savedUntil(entry, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate(await entry.backend.durableState())) return;
    if (Date.now() > deadline) throw new Error("the change was not saved in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Every stored NPC social field, so a refused request can be shown to have changed nothing. */
function socialRecords(state) {
  return JSON.stringify({
    social: Object.fromEntries(Object.entries(state.people).map(([id, p]) => [id, p.npc_social ?? null])),
    activity: Object.fromEntries(Object.entries(state.people).map(([id, p]) => [id, p.npc_activity ?? null])),
  });
}

for (const backendName of backendNames) {
  const label = (text) => `${backendName}: ${text}`;

  test(label("the residents keep fixed IDs, names, and birth dates across a restart"), async () => {
    const entry = await session(backendName);
    await entry.backend.store.flush();
    const before = (await entry.backend.durableState()).people;
    for (const id of RESIDENT_IDS) assert.ok(before[id], `resident ${id} is stored`);
    const snapshotBefore = Object.fromEntries(RESIDENT_IDS.map((id) => [id, { name: before[id].name, dob: before[id].date_of_birth }]));

    await entry.started.stop();
    await entry.backend.reopen();
    entry.started = await startOver(entry.backend, SERVER_OPTIONS);
    const after = (await entry.backend.durableState()).people;
    for (const id of RESIDENT_IDS) {
      assert.equal(after[id].name, snapshotBefore[id].name);
      assert.deepEqual(after[id].date_of_birth, snapshotBefore[id].dob, "birth date is not regenerated");
    }
    assert.equal(Object.keys(after).filter((id) => id.startsWith("npc-nb-")).length, RESIDENT_IDS.length, "no duplicate residents");
  });

  test(label("a visible NPC is in the character snapshot; a neighbour is not visible from home"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const hallPlayer = await citizen(entry, "Hall Goer", HALL);
    const names = hallPlayer.snapshot.npc_profiles.map((profile) => profile.npc_id);
    assert.ok(names.includes(FOLAKE), "an adult resident at the hall is visible");
    assert.ok(!names.includes(CHIOMA), "a child at home is not visible at the hall");
    const folake = hallPlayer.snapshot.npc_profiles.find((profile) => profile.npc_id === FOLAKE);
    assert.equal(folake.here, true);
    assert.equal(folake.activity, "socializing");
    assert.equal(folake.bond.tier, "stranger");
    assert.equal(folake.bond.affinity, 0);
    assert.ok(folake.actions.some((a) => a.action === "greet" && a.available === true));

    const homePlayer = await citizen(entry, "Home Body", "home");
    const homeIds = homePlayer.snapshot.npc_profiles.map((profile) => profile.npc_id);
    assert.ok(!homeIds.some((id) => RESIDENT_IDS.includes(id)), "no neighbour is visible from home at the evening");
    for (const profile of homePlayer.snapshot.npc_profiles) {
      assert.equal(profile.household_member, true, "only household members are visible from home");
      // A member at the hall (socialising) is not here; a member at home (relaxing or asleep) is here.
      if (profile.activity === "socializing") assert.equal(profile.here, false, "a member at the hall is not here");
      if (profile.location_id === "home") assert.equal(profile.here, true, "a member at home is here");
    }
    assert.ok(homePlayer.snapshot.npc_profiles.some((p) => p.activity === "socializing"), "an adult member is out at the hall");
  });

  test(label("activity follows the in-game clock: school hours on a school day, not on a Saturday"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, 9 * 60);
    const pupil = await citizen(entry, "Schoolgoer", SCHOOL);
    const atSchool = pupil.snapshot.npc_profiles.find((profile) => profile.npc_id === CHIOMA);
    assert.ok(atSchool, "the child is at the schoolyard on a school morning");
    assert.equal(atSchool.activity, "studying");
    assert.equal(atSchool.location_id, SCHOOL);
    assert.equal(atSchool.here, true);

    await setClock(entry, SATURDAY, 9 * 60);
    await reconnect(entry, pupil);
    assert.ok(!pupil.snapshot.npc_profiles.some((profile) => profile.npc_id === CHIOMA), "the child is at home on Saturday");
    assert.equal(entry.backend.store.state.people[CHIOMA].npc_activity.activity, "relaxing");
  });

  test(label("the neighbour's recorded activity changes only at a transition, with the time it changed"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const watcher = await citizen(entry, "Watcher", HALL);
    const first = entry.backend.store.state.people[FOLAKE].npc_activity;
    assert.equal(first.activity, "socializing");
    assert.equal(first.since_minute_of_day, EVENING, "recorded at the time she started");
    await setClock(entry, MONDAY, EVENING + 30);
    await reconnect(entry, watcher);
    assert.deepEqual(entry.backend.store.state.people[FOLAKE].npc_activity, first, "no transition: the record is unchanged");
    await setClock(entry, MONDAY, 21 * 60 + 5);
    await reconnect(entry, watcher);
    const later = entry.backend.store.state.people[FOLAKE].npc_activity;
    assert.equal(later.activity, "relaxing");
    assert.equal(later.since_minute_of_day, 21 * 60 + 5);
  });

  test(label("greet is server-validated and idempotent: a repeat is a duplicate and counts once"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Greeter", HALL);
    const first = await social(who, "s42-greet-1", "greet", FOLAKE);
    assert.equal(first.type, "npc.result", JSON.stringify(first));
    assert.equal(first.ok, true);
    assert.equal(first.npc.bond.affinity, 2);
    assert.equal(first.npc.bond.greeting_count, 1);
    assert.equal(first.event.kind, "first_met");
    assert.ok(first.dialogue.length > 0 && !first.dialogue.includes("{"), "the dialogue is filled in");
    assert.equal((await entry.backend.durableState()).people[FOLAKE].npc_social.bonds[who.characterId].greeting_count, 1);

    who.peer.send({ type: "npc.action", requestId: "s42-greet-1", action: "greet", npcId: FOLAKE });
    const repeat = await who.peer.waitFor((m) => m.requestId === "s42-greet-1" && m.type === "command.duplicate", 20000);
    assert.equal(repeat.type, "command.duplicate");
    assert.equal(bondIn(entry.backend.store.state, FOLAKE, who.characterId).greeting_count, 1, "the duplicate was not applied");
    assert.equal(bondIn(entry.backend.store.state, FOLAKE, who.characterId).affinity, 2);
  });

  test(label("the cooldown holds for its full length in game minutes, and the boundary minute is allowed"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Patient", HALL);
    assert.equal((await social(who, "s42-cd-1", "greet", FOLAKE)).type, "npc.result");

    const early = await social(who, "s42-cd-2", "greet", FOLAKE);
    assert.equal(early.type, "npc.error", JSON.stringify(early));
    assert.equal(early.code, "npc_cooldown_active");
    assert.match(early.message, /Try again in 30 game minutes/);
    assert.equal(bondIn(entry.backend.store.state, FOLAKE, who.characterId).greeting_count, 1, "a refused greet changed nothing");

    await setClock(entry, MONDAY, EVENING + 29);
    const oneShort = await social(who, "s42-cd-3", "greet", FOLAKE);
    assert.equal(oneShort.code, "npc_cooldown_active", "29 minutes is not enough");

    await setClock(entry, MONDAY, EVENING + 30);
    const allowed = await social(who, "s42-cd-4", "greet", FOLAKE);
    assert.equal(allowed.type, "npc.result", JSON.stringify(allowed));
    assert.equal(bondIn(entry.backend.store.state, FOLAKE, who.characterId).greeting_count, 2);
  });

  test(label("client-supplied affinity, counts, and cooldowns are ignored"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Cheat", HALL);
    const reply = await social(who, "s42-forge-1", "talk", FOLAKE, {
      affinity: 100, affinity_change: 100, greeting_count: 99, talk_count: 99, cooldowns: {}, bond: { affinity: 100 },
    });
    assert.equal(reply.type, "npc.result", JSON.stringify(reply));
    assert.equal(reply.affinityChange, 4, "the server's change, not the client's");
    const bond = bondIn(entry.backend.store.state, FOLAKE, who.characterId);
    assert.equal(bond.affinity, 4);
    assert.equal(bond.talk_count, 1);
    assert.equal(bond.greeting_count, 0);
  });

  test(label("a reused request ID for a different action is refused and changes nothing"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Reuser", HALL);
    assert.equal((await social(who, "s42-reuse-1", "talk", FOLAKE)).type, "npc.result");
    const before = socialRecords(entry.backend.store.state);
    const reused = await social(who, "s42-reuse-1", "argue", FOLAKE);
    assert.equal(reused.type, "error", JSON.stringify(reused));
    assert.equal(reused.code, "request_id_reused");
    assert.equal(socialRecords(entry.backend.store.state), before, "nothing changed");
  });

  test(label("refusals change nothing: unknown NPC, not visible NPC, bad ID, unknown action"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Careful", HALL);
    const before = socialRecords(entry.backend.store.state);
    const unknown = await social(who, "s42-bad-1", "greet", "npc-nb-nobody");
    assert.equal(unknown.code, "npc_not_found");
    const notVisible = await social(who, "s42-bad-2", "greet", CHIOMA);
    assert.equal(notVisible.code, "npc_not_found", "a child at home is not revealed to a character at the hall");
    const badId = await social(who, "s42-bad-3", "greet", 42);
    assert.equal(badId.code, "npc_id_invalid");
    const emptyId = await social(who, "s42-bad-4", "greet", "");
    assert.equal(emptyId.code, "npc_id_invalid");
    const unknownAction = await social(who, "s42-bad-5", "steal", FOLAKE);
    assert.equal(unknownAction.code, "npc_action_unknown");
    assert.equal(socialRecords(entry.backend.store.state), before, "no refusal changed a record");
  });

  test(label("a household member who is away is not here; a sleeping one cannot be acted on"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Homebody", "home");
    const member = who.snapshot.npc_profiles.find((profile) => profile.household_member && !profile.here);
    assert.ok(member, "a household member is visible from home and is away at the hall");
    const away = await social(who, "s42-away-1", "greet", member.npc_id);
    assert.equal(away.code, "npc_not_here", "the member is at the hall, not at home");

    await setClock(entry, MONDAY, 23 * 60);
    await reconnect(entry, who);
    const asleep = who.snapshot.npc_profiles.find((profile) => profile.npc_id === member.npc_id);
    assert.equal(asleep.asleep, true);
    const refused = await social(who, "s42-away-2", "greet", member.npc_id);
    assert.equal(refused.code, "npc_asleep");
  });

  test(label("acquaint needs contact and warmth; the relationship moves through talk, argue, and apologise"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Diplomat", HALL);
    const none = await social(who, "s42-rel-1", "acquaint", YUSUF);
    assert.equal(none.code, "npc_no_contact_yet", "no acquaintance before any contact");

    assert.equal((await social(who, "s42-rel-2", "greet", YUSUF)).type, "npc.result");
    const cold = await social(who, "s42-rel-3", "acquaint", YUSUF);
    assert.equal(cold.code, "npc_not_warm_enough", "affinity 2 is below the threshold of 5");

    assert.equal((await social(who, "s42-rel-4", "talk", YUSUF)).type, "npc.result");
    const acquainted = await social(who, "s42-rel-5", "acquaint", YUSUF);
    assert.equal(acquainted.type, "npc.result", JSON.stringify(acquainted));
    assert.equal(acquainted.npc.bond.acquainted, true);
    assert.equal(acquainted.npc.bond.tier, "acquaintance");
    assert.equal(acquainted.event.kind, "acquainted");
    const again = await social(who, "s42-rel-6", "acquaint", YUSUF);
    assert.equal(again.code, "npc_already_acquainted");

    const argued = await social(who, "s42-rel-7", "argue", YUSUF);
    assert.equal(argued.type, "npc.result", JSON.stringify(argued));
    assert.equal(argued.npc.bond.affinity, 6 - 15);
    assert.equal(argued.event.kind, "argued");

    // Drive the bond to the hostile threshold by setting the stored value directly, as a server-side fixture.
    const bond = bondIn(entry.backend.store.state, YUSUF, who.characterId);
    bond.affinity = -30;
    await setClock(entry, MONDAY, 20 * 60 + 5);
    const hostileNow = await social(who, "s42-rel-8", "argue", YUSUF);
    assert.equal(hostileNow.type, "npc.result", JSON.stringify(hostileNow));
    assert.equal(hostileNow.npc.bond.tier, "hostile");
    assert.equal(hostileNow.event.kind, "became_hostile");

    const turnedAway = await social(who, "s42-rel-9", "talk", YUSUF);
    assert.equal(turnedAway.code, "npc_turned_away");
    assert.ok(turnedAway.dialogue && turnedAway.dialogue.length > 0, "a hostile NPC still answers in character");

    const apology = await social(who, "s42-rel-10", "apologise", YUSUF);
    assert.equal(apology.type, "npc.result", JSON.stringify(apology));
    assert.notEqual(apology.npc.bond.tier, "hostile", "the apology lifts hostility");
    assert.equal(apology.event.kind, "no_longer_hostile");
  });

  test(label("apologise is refused when there is no quarrel; argue is refused when already hostile"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Peacemaker", HALL);
    const nothing = await social(who, "s42-quarrel-1", "apologise", FOLAKE);
    assert.equal(nothing.code, "npc_not_hostile");
    assert.equal((await social(who, "s42-quarrel-2", "greet", FOLAKE)).type, "npc.result");
    // A server-side fixture: the stored affinity is set directly, since a client cannot set it.
    bondIn(entry.backend.store.state, FOLAKE, who.characterId).affinity = -50;
    await setClock(entry, MONDAY, EVENING + 31);
    await reconnect(entry, who);
    const argueHostile = await social(who, "s42-quarrel-3", "argue", FOLAKE);
    assert.equal(argueHostile.code, "npc_already_hostile");
  });

  test(label("view returns the summary and bounded history for a visible NPC, and is read-only"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Viewer", HALL);
    assert.equal((await social(who, "s42-view-1", "greet", FOLAKE)).type, "npc.result");
    const before = socialRecords(entry.backend.store.state);
    const reply = await view(who, FOLAKE);
    assert.equal(reply.type, "npc.view", JSON.stringify(reply));
    assert.equal(reply.npc.npc_id, FOLAKE);
    assert.equal(reply.npc.bond.greeting_count, 1);
    assert.equal(reply.history[0].kind, "first_met", "the history is returned, newest first");
    assert.equal(socialRecords(entry.backend.store.state), before, "a view changes nothing");

    const hidden = await view(who, CHIOMA);
    assert.equal(hidden.type, "npc.error");
    assert.equal(hidden.code, "npc_not_found");
    const unknown = await view(who, "npc-nb-nobody");
    assert.equal(unknown.code, "npc_not_found");
  });

  test(label("a character sees only its own bonds, never another character's"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const alpha = await citizen(entry, "Alpha", HALL);
    const beta = await citizen(entry, "Beta", HALL);
    assert.equal((await social(alpha, "s42-priv-1", "talk", FOLAKE)).type, "npc.result");
    const betaView = beta.snapshot.npc_profiles.find((profile) => profile.npc_id === FOLAKE);
    assert.equal(betaView.bond.affinity, 0, "beta does not see alpha's affinity");
    assert.equal(betaView.bond.talk_count, 0);
    assert.ok(!JSON.stringify(beta.snapshot.npc_profiles).includes(alpha.characterId), "alpha's ID is not in beta's view");
  });

  test(label("a bond survives a restart, and a returning player is recognised"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Returner", HALL);
    const first = await social(who, "s42-ret-1", "greet", FOLAKE);
    assert.equal(first.type, "npc.result");
    assert.match(first.dialogue, /Returner|Welcome|Have we met/);
    await savedUntil(entry, (saved) => durableBond(saved, FOLAKE, who.characterId)?.greeting_count === 1);
    await who.peer.close();
    await entry.started.stop();
    await entry.backend.reopen();
    entry.started = await startOver(entry.backend, SERVER_OPTIONS);
    await setClock(entry, MONDAY, EVENING + 30);
    const again = await openPeer(entry.started.websocketUrl);
    entry.peers.push(again);
    const resumed = await resumeSession(again, who.sessionToken);
    who.peer = again;
    const profile = resumed.character.npc_profiles.find((p) => p.npc_id === FOLAKE);
    assert.equal(profile.bond.affinity, 2, "the affinity survived the restart");
    assert.equal(profile.bond.recognised, true);
    const returned = await social(who, "s42-ret-2", "greet", FOLAKE);
    assert.equal(returned.type, "npc.result", JSON.stringify(returned));
    assert.ok(catalog.dialogue.greet.returning.some((line) => returned.dialogue === line.split("{player}").join("Returner")),
      `the returning line is used: ${returned.dialogue}`);
  });

  test(label("a failed save is not confirmed, and a retry with the same request ID applies the change once"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Saver", HALL);
    entry.backend.store.failNextWrite("disk full");
    const failed = await social(who, "s42-save-1", "talk", FOLAKE);
    assert.equal(failed.type, "npc.error", JSON.stringify(failed));
    assert.equal(failed.code, "npc_not_saved");
    assert.equal(durableBond(await entry.backend.durableState(), FOLAKE, who.characterId), undefined, "nothing was saved");

    const retry = await social(who, "s42-save-1", "talk", FOLAKE);
    assert.equal(retry.type, "npc.result", JSON.stringify(retry));
    const saved = durableBond(await entry.backend.durableState(), FOLAKE, who.characterId);
    assert.equal(saved.talk_count, 1, "the talk was applied once");
    assert.equal(saved.affinity, 4, "not twice (which would be 8)");
  });

  test(label("a changing social request needs a request ID; a read does not"), async () => {
    const entry = await session(backendName);
    await setClock(entry, MONDAY, EVENING);
    const who = await citizen(entry, "Noid", HALL);
    who.peer.send({ type: "npc.action", action: "greet", npcId: FOLAKE });
    const noId = await who.peer.waitFor((m) => m.type === "error" && m.code === "request_id_required", 20000);
    assert.equal(noId.code, "request_id_required");
    assert.equal(bondIn(entry.backend.store.state, FOLAKE, who.characterId), undefined, "no bond without a request ID");
  });
}
