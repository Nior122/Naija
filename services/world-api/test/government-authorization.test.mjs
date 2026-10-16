// Government and election authorization: TEMPORARY CONTAINMENT (Stage 28).
//
// Player-initiated government and election writes are suspended on the server until permanent authorization rules
// are defined. Every test here drives the real socket request path (government.action / election.action) and then
// inspects the actual world state. A refused request must leave the state unchanged, except for the engine's
// pre-dispatch `lastSeen` timestamp, which is excluded from every comparison below (it is set for every command
// before dispatch, not by the government or election code). These tests do not assert that any write is authorised:
// no office, role, or appointment rule exists yet, so every ordinary player write is refused.
//
// Read-only government and election actions must stay available. Internal seeding (world init and identity creation)
// does not go through the socket gate and is tested separately.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";

const GOVERNMENT_SUSPENDED = "government_writes_suspended";
const ELECTION_SUSPENDED = "election_writes_suspended";

// Every government action the engine dispatches as a write that is still SUSPENDED (see governmentAction in
// world-engine.ts). The Stage 31 treasury routes (approve_budget, allocate_budget, spend_budget) are open and are tested
// in government-treasury.test.mjs, so they are deliberately not listed here.
const GOVERNMENT_WRITE_ACTIONS = [
  "appoint", "remove_official", "create_budget", "record_revenue", "record_expenditure",
  "create_project", "update_project", "fund_project", "publish_announcement",
];
const GOVERNMENT_READ_ACTIONS = ["view_federal", "view_state", "view_local", "search_projects", "announcements", "my_appointments"];

// Every election action the engine dispatches as a write (see electionAction in world-engine.ts).
const ELECTION_WRITE_ACTIONS = [
  "create_party", "register_party", "join_party", "leave_party", "update_profile", "create_election", "advance_phase",
  "register_candidate", "approve_candidate", "reject_candidate", "withdraw_candidate", "create_campaign", "cast_ballot",
  "count_votes", "certify_result", "publish_result", "transfer_office", "submit_dispute",
];
const ELECTION_READ_ACTIONS = [
  "list_parties", "political_profile", "list_elections", "view_election", "list_candidates", "view_campaign",
  "check_eligibility", "audit_log", "my_history",
];
// Mutators that exist in src/elections/service.ts but have no player action. They must be refused as well.
const ELECTION_UNLISTED_NAMES = [
  "cancel_election", "set_party_leadership", "update_party_status", "create_campaign_event",
  "record_campaign_finance", "create_debate", "add_debate_statement", "resolve_dispute",
];

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

async function citizen(entry, backend, name, age) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = backend.store.state.players[identity.playerId].character;
  character.age = age;
  return { peer, playerId: identity.playerId, characterId: character.character_id };
}

/** Test-side setup on disposable in-memory state: an active appointment, as if the office had been filled. */
function appoint(backend, characterId, definitionId, organisationId) {
  const state = backend.store.state;
  const office = Object.values(state.governmentOffices)
    .find((entry) => entry.definition_id === definitionId && entry.organisation_id === organisationId);
  assert.ok(office, `seeded office ${definitionId} in ${organisationId}`);
  const id = `appt-${randomUUID()}`;
  const now = new Date().toISOString();
  state.governmentAppointments[id] = {
    appointment_id: id, office_id: office.office_id, character_id: characterId, status: "active",
    start_date: now, start_world_date: { ...state.worldClock.world_date }, end_date: null, end_world_date: null,
    end_reason: null, appointed_by: "test-setup", created_at: now, updated_at: now,
  };
  return { appointmentId: id, officeId: office.office_id };
}

const activeAppointments = (backend, characterId) => Object.values(backend.store.state.governmentAppointments)
  .filter((entry) => entry.character_id === characterId && entry.status === "active").length;

/** Every field the world state holds, minus the engine's pre-dispatch lastSeen timestamp. */
function fingerprint(state) {
  // lastSeen and session.lastActivityAt are transient activity markers (in memory, not a world-state change).
  // Everything else, including session.revokedAt and session.issuedAt, is compared.
  return JSON.stringify(state, (key, value) => (key === "lastSeen" || key === "lastActivityAt" ? undefined : value));
}

const CIVIC_KEY = /^(government|political|party|election|candidate|campaign|debate|ballot|voter)/;
/** Only the government and election maps. Used for read-only checks, where recentRequestIds may legitimately change. */
function civicFingerprint(state) {
  return JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => CIVIC_KEY.test(key))));
}

function waitForCivicReply(peer) {
  return peer.waitFor((reply) => reply.type === "government.result" || reply.type === "government.error"
    || reply.type === "election.result" || reply.type === "election.error" || reply.type === "error", 5000);
}

function governmentRequest(action, requestId, payload = {}) {
  return { type: "government.action", action, requestId, payload };
}

function electionRequest(action, requestId, fields = {}) {
  return { type: "election.action", action, requestId, ...fields };
}

const budgetRequest = (requestId, extra = {}) => governmentRequest("create_budget", requestId, {
  organisation_id: "gov:federal", fiscal_year: 2026, category_id: "bud:healthcare", amount_ngn: 1_000_000, ...extra,
});

/** Sends a government write and returns the reply, without asserting its shape. */
async function sendGovernment(peer, message) {
  peer.send(message);
  return waitForCivicReply(peer);
}

/**
 * Every government write must be refused with the stable suspension code and change nothing.
 * Collects per-action problems so one failure names every action that misbehaved.
 */
async function assertEveryGovernmentWriteRefused(peer, backend, label) {
  const problems = [];
  for (const action of GOVERNMENT_WRITE_ACTIONS) {
    const before = fingerprint(backend.store.state);
    const reply = await sendGovernment(peer, governmentRequest(action, `${label}-${action}`, {}));
    if (reply.type !== "government.error" || reply.code !== GOVERNMENT_SUSPENDED) {
      problems.push(`${action}: expected government.error ${GOVERNMENT_SUSPENDED}, got ${reply.type} ${reply.code ?? ""}`);
    } else if (reply.action !== action || !/temporarily suspended/.test(reply.message)) {
      problems.push(`${action}: reply is missing the action or the suspension message`);
    }
    if (fingerprint(backend.store.state) !== before) problems.push(`${action}: world state changed`);
  }
  assert.deepEqual(problems, [], `government write refusals (${label})`);
}

async function assertEveryElectionWriteRefused(peer, backend, label) {
  const problems = [];
  for (const action of ELECTION_WRITE_ACTIONS) {
    const before = fingerprint(backend.store.state);
    peer.send(electionRequest(action, `${label}-${action}`));
    const reply = await waitForCivicReply(peer);
    if (reply.type !== "election.error" || reply.code !== ELECTION_SUSPENDED) {
      problems.push(`${action}: expected election.error ${ELECTION_SUSPENDED}, got ${reply.type} ${reply.code ?? ""}`);
    } else if (reply.action !== action || !/temporarily suspended/.test(reply.message)) {
      problems.push(`${action}: reply is missing the action or the suspension message`);
    }
    if (fingerprint(backend.store.state) !== before) problems.push(`${action}: world state changed`);
  }
  assert.deepEqual(problems, [], `election write refusals (${label})`);
}

for (const backendName of backendNames) {
  const label = (text) => `${backendName}: ${text}`;

  test(label("every government write is refused with government_writes_suspended and changes no state (citizen, no office)"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    await assertEveryGovernmentWriteRefused(c.peer, backend, "gov-citizen");
  });

  test(label("every election write is refused with election_writes_suspended and changes no state (citizen, no office)"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    await assertEveryElectionWriteRefused(c.peer, backend, "elec-citizen");
  });

  test(label("names of unlisted election mutators are refused with election_writes_suspended and change no state"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    const problems = [];
    for (const action of ELECTION_UNLISTED_NAMES) {
      const before = fingerprint(backend.store.state);
      c.peer.send(electionRequest(action, `unlisted-${action}`));
      const reply = await waitForCivicReply(c.peer);
      if (reply.type !== "election.error" || reply.code !== ELECTION_SUSPENDED) problems.push(`${action}: ${reply.type} ${reply.code ?? ""}`);
      if (fingerprint(backend.store.state) !== before) problems.push(`${action}: world state changed`);
    }
    assert.deepEqual(problems, []);
  });

  test(label("an office holder is refused too: the suspension is not a role check that a holder can pass"), async () => {
    const { backend, entry } = await session(backendName);
    const minister = await citizen(entry, backend, "Minister", 40);
    appoint(backend, minister.characterId, "office:minister", "gov:min:finance");
    await assertEveryGovernmentWriteRefused(minister.peer, backend, "gov-holder");
  });

  test(label("a reported exploit: a 16-year-old with no office sends create_budget and no budget is created"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 16);
    assert.equal(activeAppointments(backend, c.characterId), 0);
    const before = fingerprint(backend.store.state);
    const budgetsBefore = Object.keys(backend.store.state.governmentBudgets).length;
    const reply = await sendGovernment(c.peer, budgetRequest("susp-budget-1"));
    assert.equal(reply.type, "government.error");
    assert.equal(reply.code, GOVERNMENT_SUSPENDED);
    assert.equal(Object.keys(backend.store.state.governmentBudgets).length, budgetsBefore, "no budget was created");
    assert.equal(fingerprint(backend.store.state), before, "nothing else changed either");
  });

  test(label("a repeated requestId: both sends are refused, and the requestId is not recorded as processed"), async () => {
    const { backend, entry } = await session(backendName);
    const holder = await citizen(entry, backend, "Minister", 40);
    appoint(backend, holder.characterId, "office:minister", "gov:min:finance");
    const before = fingerprint(backend.store.state);
    const budgetsBefore = Object.keys(backend.store.state.governmentBudgets).length;
    const first = await sendGovernment(holder.peer, budgetRequest("susp-repeat-1"));
    const second = await sendGovernment(holder.peer, budgetRequest("susp-repeat-1"));
    assert.equal(first.code, GOVERNMENT_SUSPENDED);
    assert.equal(second.code, GOVERNMENT_SUSPENDED);
    assert.equal(Object.keys(backend.store.state.governmentBudgets).length, budgetsBefore, "no budget was created by either send");
    assert.equal(fingerprint(backend.store.state), before, "no requestId was recorded and no state changed");
  });

  test(label("self-appointment to the presidency is refused and the office stays vacant"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    const president = Object.values(backend.store.state.governmentOffices).find((o) => o.definition_id === "office:president");
    const before = fingerprint(backend.store.state);
    const reply = await sendGovernment(c.peer, governmentRequest("appoint", "susp-self-appoint", {
      office_id: president.office_id, character_id: c.characterId,
    }));
    assert.equal(reply.code, GOVERNMENT_SUSPENDED);
    assert.equal(activeAppointments(backend, c.characterId), 0);
    assert.equal(fingerprint(backend.store.state), before);
  });

  test(label("remove_official against an active appointment is refused and the appointment stays active"), async () => {
    const { backend, entry } = await session(backendName);
    const holder = await citizen(entry, backend, "Minister", 40);
    const other = await citizen(entry, backend, "Attacker", 40);
    const { appointmentId } = appoint(backend, holder.characterId, "office:minister", "gov:min:finance");
    const before = fingerprint(backend.store.state);
    const reply = await sendGovernment(other.peer, governmentRequest("remove_official", "susp-remove", { appointment_id: appointmentId }));
    assert.equal(reply.code, GOVERNMENT_SUSPENDED);
    assert.equal(activeAppointments(backend, holder.characterId), 1, "the appointment is still active");
    assert.equal(fingerprint(backend.store.state), before);
  });

  test(label("fabricated fields (office, appointment, role, actor, organisation, character) grant nothing and change nothing"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    const official = await citizen(entry, backend, "Official", 40);
    const office = Object.values(backend.store.state.governmentOffices)[0];
    const before = fingerprint(backend.store.state);
    const fabricated = {
      office_id: office.office_id, appointment_id: "appt-fake", role: "minister", character_id: official.characterId,
      actor_character_id: c.characterId, actor_role: "minister", authority: "federal", organisation_id: "gov:federal",
    };
    const budget = await sendGovernment(c.peer, budgetRequest("susp-fabricated-1", fabricated));
    const appointment = await sendGovernment(c.peer, governmentRequest("appoint", "susp-fabricated-2", fabricated));
    assert.equal(budget.code, GOVERNMENT_SUSPENDED);
    assert.equal(appointment.code, GOVERNMENT_SUSPENDED);
    assert.equal(fingerprint(backend.store.state), before);
  });

  test(label("the election chain that gave a citizen the presidency is stopped at its first write"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Candidate", 40);
    const before = fingerprint(backend.store.state);
    const steps = [
      electionRequest("create_party", "chain-party", { name: "Own Party", abbreviation: "OP", description: "x" }),
      electionRequest("register_party", "chain-reg", { party_id: "party:none" }),
      electionRequest("create_election", "chain-create", { election_type: "presidential" }),
      electionRequest("advance_phase", "chain-phase", { election_id: "election:none", phase: "candidate_registration" }),
      electionRequest("register_candidate", "chain-cand", { election_id: "election:none" }),
      electionRequest("transfer_office", "chain-transfer", { election_id: "election:none" }),
    ];
    for (const step of steps) {
      c.peer.send(step);
      const reply = await waitForCivicReply(c.peer);
      assert.equal(reply.type, "election.error", `${step.action}: ${reply.type}`);
      assert.equal(reply.code, ELECTION_SUSPENDED, `${step.action}`);
    }
    assert.equal(activeAppointments(backend, c.characterId), 0, "no presidency was granted");
    assert.equal(Object.keys(backend.store.state.politicalParties).length, 0, "no party was created");
    assert.equal(Object.keys(backend.store.state.elections).length, 0, "no election was created");
    assert.equal(fingerprint(backend.store.state), before);
  });

  test(label("alternate message shapes are refused and change nothing"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    const before = fingerprint(backend.store.state);
    const problems = [];
    const check = async (name, message, expectedCode) => {
      c.peer.send(message);
      const reply = await waitForCivicReply(c.peer);
      if (reply.code !== expectedCode) problems.push(`${name}: expected ${expectedCode}, got ${reply.type} ${reply.code ?? ""}`);
      if (fingerprint(backend.store.state) !== before) problems.push(`${name}: world state changed`);
    };
    // Case, whitespace, and near-miss spellings of a write name.
    for (const variant of ["Create_Budget", " create_budget", "create_budget ", "CREATE_BUDGET", "create-budget"]) {
      await check(`variant ${JSON.stringify(variant)}`, governmentRequest(variant, `shape-${variant}`, { organisation_id: "gov:federal" }), GOVERNMENT_SUSPENDED);
    }
    // Write names sent through the other family's message type.
    await check("create_budget via election.action", electionRequest("create_budget", "shape-cross-1"), ELECTION_SUSPENDED);
    await check("create_party via government.action", governmentRequest("create_party", "shape-cross-2"), GOVERNMENT_SUSPENDED);
    // The action name only in the payload: no top-level action, so the request is malformed.
    await check("action only in payload", { type: "government.action", requestId: "shape-payload", payload: { action: "create_budget", organisation_id: "gov:federal" } }, "government_action_invalid");
    await check("non-string action", { type: "government.action", action: ["create_budget"], requestId: "shape-array" }, "government_action_invalid");
    await check("election action only in payload", { type: "election.action", requestId: "shape-epayload", payload: { action: "create_party" } }, ELECTION_SUSPENDED);
    // Unknown message families.
    for (const type of ["government", "politics.action", "government.write", "government.action.v2"]) {
      c.peer.send({ type, action: "create_budget", requestId: `shape-type-${type}`, payload: { organisation_id: "gov:federal" } });
      const reply = await waitForCivicReply(c.peer);
      if (reply.type === "government.result" || reply.type === "election.result") problems.push(`${type}: a result was returned`);
      if (fingerprint(backend.store.state) !== before) problems.push(`${type}: world state changed`);
    }
    assert.deepEqual(problems, []);
  });

  test(label("read-only government actions stay available and change no government state"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    const before = civicFingerprint(backend.store.state);
    const federal = await sendGovernment(c.peer, governmentRequest("view_federal", "read-federal"));
    const announcements = await sendGovernment(c.peer, governmentRequest("announcements", "read-announcements"));
    const appointments = await sendGovernment(c.peer, governmentRequest("my_appointments", "read-appointments"));
    const projects = await sendGovernment(c.peer, governmentRequest("search_projects", "read-projects"));
    const state = await sendGovernment(c.peer, governmentRequest("view_state", "read-state", { state_id: "ng:la" }));
    const local = await sendGovernment(c.peer, governmentRequest("view_local", "read-local", { lga_id: "ng:la:ikeja" }));
    assert.equal(federal.type, "government.result", federal.code);
    assert.equal(announcements.type, "government.result", announcements.code);
    assert.equal(appointments.type, "government.result", appointments.code);
    assert.equal(projects.type, "government.result", projects.code);
    for (const reply of [state, local]) {
      assert.notEqual(reply.code, GOVERNMENT_SUSPENDED, `${reply.action} is a read and must not be suspended`);
    }
    assert.equal(civicFingerprint(backend.store.state), before, "reads changed no government or election record");
  });

  test(label("read-only election actions stay available and change no election state"), async () => {
    const { backend, entry } = await session(backendName);
    const c = await citizen(entry, backend, "Citizen", 40);
    const before = civicFingerprint(backend.store.state);
    const listed = {
      list_parties: await (async () => { c.peer.send(electionRequest("list_parties", "read-parties")); return waitForCivicReply(c.peer); })(),
      list_elections: await (async () => { c.peer.send(electionRequest("list_elections", "read-elections")); return waitForCivicReply(c.peer); })(),
      political_profile: await (async () => { c.peer.send(electionRequest("political_profile", "read-profile", { character_id: c.characterId })); return waitForCivicReply(c.peer); })(),
      my_history: await (async () => { c.peer.send(electionRequest("my_history", "read-history")); return waitForCivicReply(c.peer); })(),
    };
    for (const [action, reply] of Object.entries(listed)) {
      assert.equal(reply.type, "election.result", `${action}: ${reply.code ?? reply.type}`);
    }
    // Id-based reads with no matching record: the handler must run and answer, not return the suspension code.
    for (const action of ["view_election", "list_candidates", "view_campaign", "audit_log", "check_eligibility"]) {
      c.peer.send(electionRequest(action, `read-${action}`, { election_id: "election:none", campaign_id: "campaign:none", character_id: c.characterId }));
      const reply = await waitForCivicReply(c.peer);
      assert.notEqual(reply.code, ELECTION_SUSPENDED, `${action} is a read and must not be suspended`);
    }
    assert.equal(civicFingerprint(backend.store.state), before, "reads changed no election record");
  });

  test(label("unauthenticated sockets are still refused before any government or election handler runs"), async () => {
    const { backend, started, entry } = await session(backendName);
    const peer = await openPeer(started.websocketUrl);
    entry.peers.push(peer);
    const before = fingerprint(backend.store.state);
    peer.send(budgetRequest("susp-anon-1"));
    const reply = await waitForCivicReply(peer);
    assert.equal(reply.type, "error");
    assert.equal(reply.code, "not_authenticated");
    assert.equal(fingerprint(backend.store.state), before);
  });

  test(label("internal seeding still runs on a trusted server path: identity creation seeds the government once and alters no civic record afterwards"), async () => {
    const { backend, entry } = await session(backendName);
    assert.equal(Object.keys(backend.store.state.governmentOrganisations).length, 0, "nothing is seeded before the first identity");
    await citizen(entry, backend, "First", 30);
    assert.ok(Object.keys(backend.store.state.governmentOrganisations).length > 0, "identity creation seeded the federal organisations");
    assert.ok(Object.keys(backend.store.state.governmentOffices).length > 0, "identity creation seeded the offices");
    assert.equal(Object.keys(backend.store.state.governmentAppointments).length, 0, "seeding creates no appointments");
    const before = civicFingerprint(backend.store.state);
    await citizen(entry, backend, "Second", 30);
    assert.equal(civicFingerprint(backend.store.state), before, "a second identity does not re-seed or change the government or election records");
  });
}
