// NPC activity and social-bond rules (Stage 42): pure server rules, no sockets. These run on every backend
// configuration because they do not touch storage; the socket behaviour is in npc-social-stage42.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEducationCatalog } from "../dist/education/catalog.js";
import {
  applyNPCSocialAction,
  derivedActivity,
  loadNPCSocialCatalog,
  npcBondView,
  seedNeighbourResidents,
  syncNPCActivities,
  validateNPCSocialRecords,
  visibleNPCProfiles,
} from "../dist/npc/index.js";
import { initialState, validateState } from "../dist/multiplayer/persistence.js";
import { dateForWorldDay } from "../dist/life/calendar.js";

const NOW = Date.parse("2026-10-13T00:00:00Z");
const catalog = loadNPCSocialCatalog();
const schoolDays = loadEducationCatalog().calendar.school_days_of_week;
const FOLAKE = "npc-nb-folake-bello";
const YUSUF = "npc-nb-yusuf-danjuma";
const CHIOMA = "npc-nb-chioma-eze";
const MONDAY = 1;
const SUNDAY = 7;
const SATURDAY = 6;

function world() {
  const state = initialState(NOW);
  const character = {
    character_id: "char-rules-ada",
    name: "Ada Rules",
    household_id: "",
    current_location: "community_hall",
  };
  state.players["player-rules-ada"] = { playerId: "player-rules-ada", character };
  return { state, character };
}

function setClock(state, day, minuteOfDay) {
  state.worldClock.day = day;
  state.worldClock.minute_of_day = minuteOfDay;
  state.worldClock.world_date = dateForWorldDay(day);
}

function act(state, character, npcId, action, now = NOW) {
  return applyNPCSocialAction(state, { character, npcId, action, now }, catalog, schoolDays);
}

test("activity boundaries follow the catalog hours on a school day", () => {
  const child = { age: 10 };
  const adult = { age: 30 };
  const at = (person, day, minute) => derivedActivity(person, { day, minute_of_day: minute }, schoolDays, catalog).activity;
  // Sleep: 22:00 to 06:00.
  assert.equal(at(child, MONDAY, 21 * 60 + 59), "relaxing");
  assert.equal(at(child, MONDAY, 22 * 60), "sleeping");
  assert.equal(at(child, MONDAY, 5 * 60 + 59), "sleeping");
  assert.equal(at(child, MONDAY, 6 * 60), "relaxing");
  // School: 08:00 to 14:00, on a school day only.
  assert.equal(at(child, MONDAY, 7 * 60 + 59), "relaxing");
  assert.equal(at(child, MONDAY, 8 * 60), "studying");
  assert.equal(at(child, MONDAY, 13 * 60 + 59), "studying");
  assert.equal(at(child, MONDAY, 14 * 60), "relaxing");
  assert.equal(at(child, SATURDAY, 9 * 60), "relaxing", "no school on a Saturday");
  assert.equal(at(child, SUNDAY, 9 * 60), "relaxing", "no school on a Sunday");
  // School ages: 6 to 17 inclusive.
  assert.equal(at({ age: 5 }, MONDAY, 9 * 60), "relaxing");
  assert.equal(at({ age: 6 }, MONDAY, 9 * 60), "studying");
  assert.equal(at({ age: 17 }, MONDAY, 9 * 60), "studying");
  assert.equal(at({ age: 18 }, MONDAY, 9 * 60), "relaxing", "adults are not at school");
  // Socialising: 18:00 to 21:00, adults only.
  assert.equal(at(adult, MONDAY, 17 * 60 + 59), "relaxing");
  assert.equal(at(adult, MONDAY, 18 * 60), "socializing");
  assert.equal(at(adult, MONDAY, 20 * 60 + 59), "socializing");
  assert.equal(at(adult, MONDAY, 21 * 60), "relaxing");
  assert.equal(at(child, MONDAY, 18 * 60), "relaxing", "a child does not socialise at the hall");
});

test("activity locations match the catalog states", () => {
  const where = (person, day, minute) => derivedActivity(person, { day, minute_of_day: minute }, schoolDays, catalog).location_id;
  assert.equal(where({ age: 10 }, MONDAY, 9 * 60), "schoolyard");
  assert.equal(where({ age: 30 }, MONDAY, 19 * 60), "community_hall");
  assert.equal(where({ age: 30 }, MONDAY, 23 * 60), "home");
});

test("residents are seeded once with fixed IDs, and seeding again creates nothing", () => {
  const { state } = world();
  const ids = Object.keys(state.people).sort();
  assert.deepEqual(ids, catalog.residents.map((r) => r.person_id).sort());
  assert.equal(seedNeighbourResidents(state, catalog, NOW), 0, "a second seed finds every resident");
  assert.deepEqual(Object.keys(state.people).sort(), ids);
  for (const resident of catalog.residents) {
    const person = state.people[resident.person_id];
    assert.equal(person.family_role, "neighbour");
    assert.equal(person.name, resident.name);
    assert.equal(state.households[person.household_id].member_ids.includes(resident.person_id), true);
  }
});

test("a reload keeps the same residents with the same birth dates, and gives them no career", () => {
  const { state } = world();
  // The fixture character is not a complete character record, so it is removed before the reload.
  delete state.players["player-rules-ada"];
  const json = JSON.parse(JSON.stringify(state));
  const reloaded = validateState(json, NOW);
  assert.deepEqual(Object.keys(reloaded.people).sort(), Object.keys(state.people).sort());
  for (const id of Object.keys(state.people)) {
    assert.deepEqual(reloaded.people[id].date_of_birth, state.people[id].date_of_birth, `${id} birth date is kept`);
  }
  for (const id of Object.keys(state.people)) {
    assert.equal(reloaded.npcCareers[id], undefined, `${id} has no career record: a neighbour takes no vacancy`);
  }
});

test("sync writes a record only when the activity changes, and returns the number changed", () => {
  const { state } = world();
  setClock(state, MONDAY, 9 * 60);
  const first = syncNPCActivities(state, catalog, schoolDays);
  assert.equal(first, catalog.residents.length, "every resident gets an activity record");
  assert.equal(syncNPCActivities(state, catalog, schoolDays), 0, "nothing changed, nothing written");
  setClock(state, MONDAY, 22 * 60);
  assert.equal(syncNPCActivities(state, catalog, schoolDays), catalog.residents.length, "all sleep at 22:00");
  assert.equal(state.people[CHIOMA].npc_activity.activity, "sleeping");
  assert.equal(state.people[CHIOMA].npc_activity.since_minute_of_day, 22 * 60);
});

test("a deceased NPC has no activity and is not visible", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 19 * 60);
  syncNPCActivities(state, catalog, schoolDays);
  state.people[FOLAKE].life_status = "deceased";
  syncNPCActivities(state, catalog, schoolDays);
  assert.equal(state.people[FOLAKE].npc_activity, undefined);
  assert.ok(!visibleNPCProfiles(state, character, catalog, schoolDays).some((p) => p.npc_id === FOLAKE));
});

test("a cooldown holds for its full length; the minute it ends is allowed", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 19 * 60);
  assert.equal(act(state, character, FOLAKE, "greet").affinity_change, 2);
  setClock(state, MONDAY, 19 * 60 + 29);
  assert.throws(() => act(state, character, FOLAKE, "greet"), (error) => {
    assert.equal(error.code, "npc_cooldown_active");
    assert.match(error.message, /Try again in 1 game minute\./);
    return true;
  });
  setClock(state, MONDAY, 19 * 60 + 30);
  act(state, character, FOLAKE, "greet");
  assert.equal(state.people[FOLAKE].npc_social.bonds[character.character_id].greeting_count, 2);
});

test("affinity is clamped to the catalog bounds", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 19 * 60);
  act(state, character, FOLAKE, "greet");
  state.people[FOLAKE].npc_social.bonds[character.character_id].affinity = 99;
  setClock(state, 2, 19 * 60);
  assert.equal(act(state, character, FOLAKE, "talk").profile.bond.affinity, catalog.bonds.affinity_max);
  setClock(state, 3, 19 * 60);
  assert.equal(act(state, character, FOLAKE, "talk").profile.bond.affinity, catalog.bonds.affinity_max, "it stops at the top");
});

test("history is bounded to the limit, keeps the newest events, and numbers them in order", () => {
  const { state, character } = world();
  for (let day = 1; day <= 40; day += 1) {
    setClock(state, day, 19 * 60);
    const bond = state.people[YUSUF].npc_social?.bonds[character.character_id];
    const hostile = bond !== undefined && bond.affinity <= catalog.bonds.hostile_at_or_below;
    act(state, character, YUSUF, hostile ? "apologise" : "argue");
  }
  const bond = state.people[YUSUF].npc_social.bonds[character.character_id];
  assert.equal(bond.history.length, catalog.bonds.history_limit, "bounded");
  const seqs = bond.history.map((event) => event.seq);
  for (let index = 1; index < seqs.length; index += 1) assert.equal(seqs[index], seqs[index - 1] + 1, "consecutive and in order");
  assert.equal(seqs.at(-1), bond.next_event_seq - 1, "the newest event is kept");
  const view = npcBondView(state, character, YUSUF, catalog, schoolDays);
  assert.equal(view.history[0].seq, seqs.at(-1), "the view lists the newest first");
});

test("a refused action changes no record and names the reason", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 7 * 60 + 30);
  // Activity is derived state: the server brings it up to date with the clock before any check, so it is current first.
  syncNPCActivities(state, catalog, schoolDays);
  const before = JSON.stringify(state.people);
  assert.throws(() => act(state, character, FOLAKE, "talk"), (error) => error.code === "npc_not_found");
  assert.equal(JSON.stringify(state.people), before, "nothing was written");
  assert.throws(() => act(state, character, "npc-nb-nobody", "greet"), (error) => error.code === "npc_not_found");
  assert.throws(() => act(state, character, FOLAKE, "rob"), (error) => error.code === "npc_action_unknown");
  assert.throws(() => act(state, { ...character, character_id: "nobody" }, FOLAKE, "greet"), (error) => error.code === "npc_not_found");
  assert.equal(JSON.stringify(state.people), before);
});

test("the view is refused for an NPC the character cannot see", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 9 * 60);
  syncNPCActivities(state, catalog, schoolDays);
  assert.throws(() => npcBondView(state, character, CHIOMA, catalog, schoolDays), (error) => error.code === "npc_not_found");
});

test("visible profiles carry only this character's bond", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 19 * 60);
  act(state, character, FOLAKE, "greet");
  const other = { character_id: "char-rules-bola", name: "Bola", household_id: "", current_location: "community_hall" };
  state.players["player-rules-bola"] = { playerId: "player-rules-bola", character: other };
  const seen = visibleNPCProfiles(state, other, catalog, schoolDays).find((p) => p.npc_id === FOLAKE);
  assert.equal(seen.bond.greeting_count, 0);
  assert.equal(seen.bond.affinity, 0);
  assert.equal(seen.bond.recognised, false);
  assert.ok(!JSON.stringify(seen).includes(character.character_id));
});

test("each action row says whether it is available, why not, and how long a cooldown has left", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 19 * 60);
  act(state, character, FOLAKE, "greet");
  setClock(state, MONDAY, 19 * 60 + 10);
  const profile = visibleNPCProfiles(state, character, catalog, schoolDays).find((p) => p.npc_id === FOLAKE);
  const greet = profile.actions.find((row) => row.action === "greet");
  assert.equal(greet.available, false);
  assert.equal(greet.reason_code, "npc_cooldown_active");
  assert.equal(greet.cooldown_minutes_left, 20);
  assert.equal(greet.reason_message, "You spoke with them too recently. Try again in 20 game minutes.");
  const talk = profile.actions.find((row) => row.action === "talk");
  assert.equal(talk.available, true);
  assert.equal(talk.reason_message, null);
  assert.equal(talk.cooldown_minutes_left, 0);
});

test("validation reports each kind of corrupted record", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 19 * 60);
  act(state, character, FOLAKE, "greet");
  assert.deepEqual(validateNPCSocialRecords(state, catalog), []);
  const bond = state.people[FOLAKE].npc_social.bonds[character.character_id];

  bond.affinity = 500;
  assert.ok(validateNPCSocialRecords(state, catalog).some((p) => p.includes("is invalid")));
  bond.affinity = 2;

  bond.cooldowns.steal = 1;
  assert.ok(validateNPCSocialRecords(state, catalog).some((p) => p.includes("is invalid")));
  delete bond.cooldowns.steal;

  bond.history = Array.from({ length: catalog.bonds.history_limit + 1 }, (_, index) => ({
    event_id: `e${index}`, seq: index + 1, kind: "first_met", summary: "x", affinity_after: 0, world_day: 1, minute_of_day: 0,
  }));
  assert.ok(validateNPCSocialRecords(state, catalog).some((p) => p.includes("is invalid")));
  bond.history = [];

  state.people[FOLAKE].npc_social.bonds["char-missing"] = { ...bond, character_id: "char-missing" };
  assert.ok(validateNPCSocialRecords(state, catalog).some((p) => p.includes("unknown character")));
  delete state.people[FOLAKE].npc_social.bonds["char-missing"];

  state.people[FOLAKE].npc_social.bonds["char-other-key"] = bond;
  assert.ok(validateNPCSocialRecords(state, catalog).some((p) => p.includes("is invalid")), "a key that differs from character_id is refused");
  delete state.people[FOLAKE].npc_social.bonds["char-other-key"];

  state.people[YUSUF].npc_activity = { activity: "flying", location_id: "home", since_day: 1, since_minute_of_day: 0 };
  assert.ok(validateNPCSocialRecords(state, catalog).some((p) => p.includes("npc_activity is invalid")));
});

test("every dialogue line fills its placeholders completely", () => {
  const { state, character } = world();
  setClock(state, MONDAY, 19 * 60);
  const outcome = act(state, character, FOLAKE, "greet");
  assert.ok(!outcome.dialogue.includes("{"), outcome.dialogue);
  for (const action of ["greet", "talk"]) {
    for (const lines of Object.values(catalog.dialogue[action])) {
      for (const line of lines) {
        assert.ok(!line.replace(/\{player\}|\{name\}/g, "").includes("{"), `unknown placeholder in: ${line}`);
      }
    }
  }
});
