// Consequential families (Stage 37): authority, save-before-success, and retry safety on the socket path.
//
// Runs on every configured backend: file always, PostgreSQL when the live database is configured (the same tests run
// on both). Each test drives a real server over the socket and checks what the server reports AND what is stored.
//
// What these tests prove (and what they do not):
//   - A suspended authority-less write (military create_asset / create_security_event / file_disciplinary_case, crime
//     transition_incident / add_evidence / create_restitution, police request_wanted) is refused with its stable code and
//     changes none of the records it would have touched.
//   - military request_leave on a service record that belongs to another character is refused as not found, and creates
//     no leave record.
//   - A justice filing, a rest, and a relationship proposal reply, and any notice to another player, only after the
//     save succeeds. A failed save is reported as *_not_saved; a retry with the same request ID applies the change once.
//   - While saving is failing, a new change in these families is refused before it changes anything
//     (*_persistence_unavailable).
//   - A changing request in these families needs a request ID; a read-only request does not.
// What they do NOT prove: the cross-process race (two processes, one database) is tested in
// cross-process-requests-stage36.test.mjs (PostgreSQL only). The family-level save paths for family.childbirth (needs a
// seeded marriage) are not exercised here; see docs/STAGE_37_CONSEQUENTIAL_MUTATION_SAFETY.md.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";

const opened = [];

before(connectBackends);
after(disconnectBackends);

const SERVER_OPTIONS = { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } };

async function session(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, SERVER_OPTIONS);
  const entry = { backend, started, peers: [] };
  opened.push(entry);
  return entry;
}

/** A real adult over the socket, with a session resumed. Test-side setup fixes its age and date of birth in memory. */
async function citizen(entry, name, age = 30) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = entry.backend.store.state.players[identity.playerId].character;
  character.age = age;
  character.date_of_birth = { year: entry.backend.store.state.worldClock.world_date.year - age, month: 1, day: 1 };
  return { peer, playerId: identity.playerId, characterId: character.character_id, character };
}

/** The reply to one request: a result, an error, or a duplicate, for the same request ID (or an uncorrelated error code). */
function replyTo(requestId) {
  return (message) => message.requestId === requestId && (
    message.type.endsWith(".result") || message.type.endsWith(".error") || message.type === "error"
    || message.type === "command.duplicate" || message.type === "character.snapshot" || message.type === "relationship.progress"
  );
}

async function send(peer, message, timeoutMs = 20000) {
  peer.send(message);
  return peer.waitFor(replyTo(message.requestId), timeoutMs);
}

/** The maps that a suspended write would have changed. A refused write must leave every one of them exactly as it was. */
function consequentialMaps(state) {
  return JSON.stringify({
    militaryAssets: state.militaryAssets,
    militaryDisciplinaryRecords: state.militaryDisciplinaryRecords,
    militaryLeaveRecords: state.militaryLeaveRecords,
    crimeIncidents: state.crimeIncidents,
    crimeEvidence: state.crimeEvidence,
    crimeRestitution: state.crimeRestitution,
    wantedRecords: state.wantedRecords,
    cases: state.cases,
    evidence: state.evidence,
  });
}

afterEach(async () => {
  while (opened.length > 0) {
    const entry = opened.pop();
    for (const peer of entry.peers) peer.close();
    await entry.started.stop();
    await entry.backend.cleanup();
  }
});

for (const backendName of backendNames) {
  const label = (text) => `${backendName}: ${text}`;

  test(label("suspended authority-less writes are refused with their codes and change nothing"), async () => {
    const entry = await session(backendName);
    const actor = await citizen(entry, "Suspended");
    const before = consequentialMaps(entry.backend.store.state);
    const cases = [
      { type: "military.action", action: "create_asset", code: "military_asset_creation_suspended" },
      { type: "military.action", action: "create_security_event", code: "military_security_event_suspended" },
      { type: "military.action", action: "file_disciplinary_case", code: "military_disciplinary_suspended" },
      { type: "crime.action", action: "transition_incident", code: "crime_incident_transition_suspended" },
      { type: "crime.action", action: "add_evidence", code: "crime_evidence_suspended" },
      { type: "crime.action", action: "create_restitution", code: "crime_restitution_suspended" },
      { type: "police.action", action: "request_wanted", code: "police_wanted_request_suspended" },
    ];
    for (const { type, action, code } of cases) {
      // The suspension check runs before any parsing, so a body that would otherwise be valid is still refused.
      actor.peer.send({ type, action, incident_id: "crime-x", debtor_character_id: actor.characterId, amount: 1000, service_id: "svc-x", character_id: actor.characterId });
      const reply = await actor.peer.waitFor((message) => message.code === code, 20000);
      // The family's own error type (military.error, crime.error, police.error) carries the stable code.
      assert.match(reply.type, /\.error$/, `${action}: ${JSON.stringify(reply)}`);
      assert.equal(reply.code, code);
    }
    assert.equal(consequentialMaps(entry.backend.store.state), before, "no suspended write changed any record");
  });

  test(label("military request_leave on another character's service record is refused as not found and creates no leave"), async () => {
    const entry = await session(backendName);
    const actor = await citizen(entry, "Trooper");
    // A service record that belongs to someone else. The check compares the record's owner with the caller before any change.
    const foreign = { service_id: "svc-foreign-37", character_id: "char-someone-else", status: "active", branch: "army", rank: "private" };
    entry.backend.store.state.militaryServiceRecords[foreign.service_id] = foreign;
    const leavesBefore = Object.keys(entry.backend.store.state.militaryLeaveRecords ?? {}).length;
    const reply = await send(actor.peer, {
      type: "military.action", action: "request_leave", requestId: "leave-foreign-1",
      service_id: foreign.service_id, leave_type: "annual", start_date: "2026-11-01", end_date: "2026-11-05", reason: "test",
    });
    assert.equal(reply.type, "military.error", JSON.stringify(reply));
    assert.equal(reply.code, "military_service_not_found");
    assert.equal(Object.keys(entry.backend.store.state.militaryLeaveRecords ?? {}).length, leavesBefore, "no leave record was created");
  });

  test(label("a justice filing whose save fails is not confirmed; the retry with the same request ID files one case"), async () => {
    const entry = await session(backendName);
    const filer = await citizen(entry, "Filer");
    const courts = await send(filer.peer, { type: "justice.action", action: "list_courts", requestId: "s37-courts" });
    assert.equal(courts.type, "justice.result", JSON.stringify(courts));
    const court = (courts.data?.courts ?? []).find((c) => c.court_id === "court:federal-high" && c.status === "active");
    assert.ok(court, "the seeded world has an active Federal High Court");
    const filing = {
      type: "justice.action", action: "file_case", requestId: "s37-file-1", category: "civil_general",
      court_id: court.court_id, summary: "Stage 37 filing", description: "Save failure",
    };
    const casesWith = (state) => Object.values(state.cases).filter((c) => c.summary === "Stage 37 filing").length;

    entry.backend.store.failNextWrite("disk full");
    const first = await send(filer.peer, filing);
    assert.equal(first.type, "justice.error", JSON.stringify(first));
    assert.equal(first.code, "justice_not_saved", "a save known to have failed is reported as not saved");

    const retry = await send(filer.peer, filing);
    assert.equal(retry.type, "justice.result", JSON.stringify(retry));
    assert.equal(retry.data?.replayed, true, "the recorded filing is replayed, not filed again");
    assert.equal(casesWith(entry.backend.store.state), 1, "one case in memory");
    const durable = await entry.backend.durableState();
    assert.equal(Object.values(durable.cases).filter((c) => c.summary === "Stage 37 filing").length, 1, "one case in the saved world");
  });

  test(label("while saving fails, a new justice filing is refused before it changes anything"), async () => {
    const entry = await session(backendName);
    const filer = await citizen(entry, "Blocked");
    const courts = await send(filer.peer, { type: "justice.action", action: "list_courts", requestId: "s37-courts-2" });
    const court = (courts.data?.courts ?? []).find((c) => c.court_id === "court:federal-high" && c.status === "active");
    assert.ok(court);
    const filing = (requestId, summary) => ({
      type: "justice.action", action: "file_case", requestId, category: "civil_general", court_id: court.court_id, summary, description: "Gate",
    });
    for (let i = 0; i < 1000; i += 1) entry.backend.store.failNextWrite("disk unavailable");
    const failed = await send(filer.peer, filing("s37-gate-a", "Gate A"));
    assert.equal(failed.code, "justice_not_saved");
    const memory = JSON.stringify(entry.backend.store.state.cases);

    const refused = await send(filer.peer, filing("s37-gate-b", "Gate B"));
    // The gate uses the shared error reply (type "error") with the stable code.
    assert.equal(refused.type, "error", JSON.stringify(refused));
    assert.equal(refused.code, "justice_persistence_unavailable", JSON.stringify(refused));
    assert.equal(JSON.stringify(entry.backend.store.state.cases), memory, "a refused filing changes nothing");

    entry.backend.store.clearFailures();
    const retry = await send(filer.peer, filing("s37-gate-a", "Gate A"));
    assert.equal(retry.type, "justice.result", JSON.stringify(retry));
    assert.equal(retry.data?.replayed, true);
    const durable = await entry.backend.durableState();
    assert.equal(Object.values(durable.cases).filter((c) => c.summary === "Gate A").length, 1, "filed once");
    assert.equal(Object.values(durable.cases).filter((c) => c.summary === "Gate B").length, 0, "the refused filing was never filed");
  });

  test(label("character.rest is confirmed only once saved, and a failed save is not applied twice"), async () => {
    const entry = await session(backendName);
    const sleeper = await citizen(entry, "Sleeper");
    sleeper.character.current_location = "home";
    sleeper.character.position = { x: 440, y: 350 };
    sleeper.character.hunger = 80;
    await entry.backend.store.flush();

    entry.backend.store.failNextWrite("disk full");
    const failed = await send(sleeper.peer, { type: "character.rest", requestId: "s37-rest-1" });
    assert.equal(failed.type, "error", JSON.stringify(failed));
    assert.equal(failed.code, "rest_not_saved", "a rest whose save failed is not confirmed");
    assert.equal((await entry.backend.durableState()).players[sleeper.playerId].character.hunger, 80, "nothing was saved");

    const retry = await send(sleeper.peer, { type: "character.rest", requestId: "s37-rest-1" });
    assert.equal(retry.type, "character.snapshot", JSON.stringify(retry));
    // Rest lowers hunger by 18 once. A second application would give 44.
    assert.equal(sleeper.character.hunger, 62, "the rest was applied once");
    assert.equal((await entry.backend.durableState()).players[sleeper.playerId].character.hunger, 62, "the saved world holds the rest");
  });

  test(label("a relationship proposal: the partner is told only after the proposal is saved"), async () => {
    const entry = await session(backendName);
    const a = await citizen(entry, "Ayo");
    const b = await citizen(entry, "Bisi");
    for (const who of [a, b]) {
      who.character.current_location = "home";
      who.character.position = { x: 440, y: 350 };
    }
    await entry.backend.store.flush();

    const proposal = { type: "relationship.progress", requestId: "s37-rel-1", targetCharacterId: b.characterId, stage: "friendship" };
    entry.backend.store.failNextWrite("disk full");
    const failed = await send(a.peer, proposal);
    assert.equal(failed.type, "relationship.error", JSON.stringify(failed));
    assert.equal(failed.code, "relationship_not_saved");
    // The partner has heard nothing: the notice waits for the save.
    assert.equal(b.peer.messages.filter((m) => m.type === "relationship.progress").length, 0);
    await assert.rejects(b.peer.waitFor((m) => m.type === "relationship.progress", 800), /Timed out/);

    const retry = await send(a.peer, proposal);
    assert.equal(retry.type, "relationship.progress", JSON.stringify(retry));
    assert.equal(retry.status, "pending");
    const notice = await b.peer.waitFor((m) => m.type === "relationship.progress" && m.requestId === "s37-rel-1", 5000);
    assert.equal(notice.actorCharacterId, a.characterId);
    assert.equal(notice.status, "pending", "the partner is told once, after the save");
  });

  test(label("a changing request in these families needs a request ID; a read-only request does not"), async () => {
    const entry = await session(backendName);
    const user = await citizen(entry, "Requester");
    user.peer.send({ type: "justice.action", action: "file_case", category: "civil_general", court_id: "court:federal-high", summary: "No id", description: "x" });
    const noId = await user.peer.waitFor((m) => m.type === "error" && m.code === "request_id_required", 20000);
    assert.equal(noId.code, "request_id_required");
    user.peer.send({ type: "justice.action", action: "list_courts" });
    const read = await user.peer.waitFor((m) => m.type === "justice.result" && m.action === "list_courts", 20000);
    assert.equal(read.ok, true);
    assert.equal(Object.values(entry.backend.store.state.cases).filter((c) => c.summary === "No id").length, 0, "no case without a request ID");
  });
}
