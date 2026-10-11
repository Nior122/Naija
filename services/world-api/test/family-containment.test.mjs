/**
 * Military, police, and crime-link containment (Stage 28 Foundation Hardening, D-04).
 *
 * Through the real WebSocket request path:
 *   - each suspended consequential action is refused with its stable code, and no military, police, or crime state
 *     changes (the refusal happens before any state access);
 *   - read-only actions remain available;
 *   - a client-supplied education value does not satisfy the military or police recruitment check (the server's
 *     character record is the only input).
 */
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import { seedPoliceWorld } from "../dist/police/index.js";

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
  const started = await startOver(backend, { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } });
  const entry = { backend, started, peers: [] };
  opened.push(entry);
  return { backend, started, entry };
}

/** A real identity over the socket. Age is set through date_of_birth, the field the engine recomputes age from. */
async function citizen(entry, backend, name, age, educationLevel) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = backend.store.state.players[identity.playerId].character;
  const worldDate = backend.store.state.worldClock.world_date;
  character.date_of_birth = { year: worldDate.year - age, month: 1, day: 1 };
  character.age = age;
  if (educationLevel) character.education_level = educationLevel;
  return { peer, playerId: identity.playerId, characterId: character.character_id };
}

/** Sends one request and waits for the reply that carries the same requestId. */
function ask(peer, message) {
  peer.send(message);
  return peer.waitFor((reply) => reply.requestId === message.requestId && /\.(result|error)$/.test(reply.type), 5000);
}

/** Deterministic copy of every military, police, crime, and criminal-record map on the test state. */
function familyState(state) {
  const pick = {};
  for (const key of Object.keys(state)) {
    if (/military|police|crime|criminal|service|training|appoint|assign|arrest|incident|recruit/i.test(key)) {
      pick[key] = JSON.parse(JSON.stringify(state[key] ?? null));
    }
  }
  return pick;
}

const SUSPENDED = [
  { family: "military", type: "military.action", error: "military.error", action: "enlist", code: "military_enlistment_suspended", extra: { application_id: "app-made-up" } },
  { family: "military", type: "military.action", error: "military.error", action: "enroll_training", code: "military_training_suspended", extra: { service_id: "svc-made-up", course_id: "course-made-up" } },
  { family: "military", type: "military.action", error: "military.error", action: "complete_training", code: "military_training_suspended", extra: { training_record_id: "trn-made-up", result: "pass" } },
  { family: "military", type: "military.action", error: "military.error", action: "promote", code: "military_promotion_suspended", extra: { service_id: "svc-made-up", rank: "Captain" } },
  { family: "military", type: "military.action", error: "military.error", action: "create_appointment", code: "military_appointment_suspended", extra: { service_id: "svc-made-up", org_id: "org-made-up", role: "commander" } },
  { family: "military", type: "military.action", error: "military.error", action: "assign", code: "military_assignment_suspended", extra: { service_id: "svc-made-up", assignment_type: "garrison" } },
  { family: "police", type: "police.action", error: "police.error", action: "execute_arrest", code: "police_arrest_suspended", extra: { character_id: "char-made-up", reason: "Test", legal_basis: "Test" } },
  { family: "crime", type: "crime.action", error: "crime.error", action: "link_to_justice", code: "crime_link_suspended", extra: { incident_id: "inc-made-up", case_id: "case-made-up" } },
  { family: "crime", type: "crime.action", error: "crime.error", action: "link_to_police", code: "crime_link_suspended", extra: { incident_id: "inc-made-up", police_incident_id: "pol-made-up" } },
];

for (const backendName of backendNames) {
  test(`[${backendName}] suspended military, police, and crime-link actions are refused with stable codes and change no state`, async () => {
    const { backend, entry } = await session(backendName);
    const actor = await citizen(entry, backend, "Actor", 30, "secondary");
    const before = familyState(backend.store.state);

    for (const row of SUSPENDED) {
      const reply = await ask(actor.peer, { type: row.type, action: row.action, requestId: `${row.action}-refused`, ...row.extra });
      assert.equal(reply.type, row.error, `${row.action}: error envelope`);
      assert.equal(reply.code, row.code, `${row.action}: stable refusal code`);
      assert.ok(reply.message, `${row.action}: a message is given`);
    }
    assert.deepEqual(familyState(backend.store.state), before, "no military, police, or crime state changed");
  });

  test(`[${backendName}] read-only military, police, and crime actions remain available`, async () => {
    const { backend, entry } = await session(backendName);
    const actor = await citizen(entry, backend, "Reader", 30, "secondary");
    const reads = [
      { type: "military.action", action: "list_branches" },
      { type: "military.action", action: "military_profile" },
      { type: "military.action", action: "list_training" },
      { type: "police.action", action: "police_profile" },
      { type: "crime.action", action: "criminal_profile" },
    ];
    for (const read of reads) {
      const reply = await ask(actor.peer, { ...read, requestId: `read-${read.action}` });
      assert.match(reply.type, /\.result$/, `${read.action} still answers`);
    }
  });

  test(`[${backendName}] a client-supplied education value does not satisfy military or police recruitment`, async () => {
    const { backend, entry } = await session(backendName);
    // Authoritative record: primary education, below the secondary minimum for military recruitment.
    const actor = await citizen(entry, backend, "Forger", 25, "primary");

    const militaryBefore = familyState(backend.store.state);
    const military = await ask(actor.peer, {
      type: "military.action", action: "apply_for_service", requestId: "forge-military",
      branch: "army", education: "tertiary",
    });
    assert.equal(military.type, "military.error");
    assert.equal(military.code, "military_education_ineligible", "the forged education field is ignored");
    assert.deepEqual(familyState(backend.store.state), militaryBefore, "the refused military application changes no state");

    // Police needs a real, active station to reach the education check. Seed the trusted police world on the test state.
    seedPoliceWorld(backend.store.state, backend.store.state.worldClock.world_date);
    const stationId = Object.values(backend.store.state.policeUnits).find((unit) => unit.status === "active")?.unit_id;
    assert.ok(stationId, "premise: an active police station exists in the seeded world");
    const policeBefore = familyState(backend.store.state);
    const police = await ask(actor.peer, {
      type: "police.action", action: "apply_recruitment", requestId: "forge-police",
      station_id: stationId, education: "tertiary",
    });
    assert.equal(police.type, "police.error");
    assert.equal(police.code, "police_education_ineligible", "the forged education field is ignored");
    assert.deepEqual(familyState(backend.store.state), policeBefore, "the refused police application changes no state");

    // Control: the same request from a character whose authoritative education meets the requirement succeeds.
    const qualified = await citizen(entry, backend, "Qualified", 25, "tertiary");
    const ok = await ask(qualified.peer, {
      type: "police.action", action: "apply_recruitment", requestId: "qualified-police",
      station_id: stationId,
    });
    assert.equal(ok.type, "police.result", "a character with authoritative tertiary education can apply");
  });
}
