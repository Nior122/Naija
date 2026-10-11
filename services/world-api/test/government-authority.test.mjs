// Office authority resolution (Stage 30, Stage 28 rules G-2, G-3 and principles 1 to 3).
//
// These tests call the trusted government functions and the pure resolver on an in-memory state. No government route
// is opened: government writes stay suspended at the engine (see government-authorization.test.mjs), because the
// permission rules that would say which office may act are still owner decisions (R-a, R-b).
//
// What is proved here: an office confers authority only while it is effective on the date (active, started, not
// term-ended, not suspended, not contested, organisation active, holder alive and present, level matching), and only
// over its own organisation (exact scope; no hierarchy is assumed). Expired, ended, removed, suspended, contested, and
// deceased holders get nothing, and the term-expiry processor ends elapsed terms once, with an audit event.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import {
  appointmentAuthorityState,
  authorizeGovernmentActor,
  effectiveOfficeGrants,
  officeOccupancy,
} from "../dist/government/authority.js";
import {
  appointOfficial,
  expireElapsedTerms,
  initializeGovernmentWorldState,
  processGovernmentWorldDate,
  removeOfficial,
  seedGovernmentWorld,
  setGovernmentOfficeStatus,
} from "../dist/government/service.js";
import { validateGovernmentRecords } from "../dist/multiplayer/record-validation.js";

before(connectBackends);
after(disconnectBackends);

const DATE = { year: 2026, month: 10, day: 11 };
const NOW = Date.UTC(2026, 9, 11);
const FEDERAL = "gov:federal";
const FINANCE = "gov:min:finance";

/** A world with the seeded federal government, plus one citizen per call of addCitizen. Nothing else is needed. */
function makeState() {
  const state = {
    worldClock: { world_date: { ...DATE } },
    players: {},
    people: {},
  };
  initializeGovernmentWorldState(state);
  seedGovernmentWorld(state, DATE, NOW);
  return state;
}

function addCitizen(state, name, { age = 40, status = "alive" } = {}) {
  const characterId = `char-${name.toLowerCase()}`;
  state.players[`player-${characterId}`] = {
    playerId: `player-${characterId}`,
    character: { character_id: characterId, name, age, life_status: status },
  };
  return characterId;
}

/** The seeded office for a catalogue definition. Seeded office IDs are "office:" plus the definition ID. */
function seededOffice(state, definitionId) {
  const office = Object.values(state.governmentOffices).find((o) => o.definition_id === definitionId);
  assert.ok(office, `premise: the seeded world has ${definitionId}`);
  return office;
}

/** A state government with a governor's office, placed correctly (state level, its own jurisdiction). */
function addStateGovernment(state, stateId = "ng:state:fc") {
  const orgId = `gov:state:${stateId.split(":").pop()}`;
  state.governmentOrganisations[orgId] = {
    organisation_id: orgId, level: "state", name: "Test State Government", description: "Test.",
    jurisdiction_id: stateId, parent_organisation_id: null, ministry_id: null, status: "active",
    created_at: new Date(NOW).toISOString(), created_world_date: { ...DATE }, updated_at: new Date(NOW).toISOString(),
  };
  const officeId = `office:state-governor:${stateId.split(":").pop()}`;
  state.governmentOffices[officeId] = {
    office_id: officeId, definition_id: "office:governor", organisation_id: orgId, label: "State Governor",
    unique: true, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(),
  };
  return { orgId, officeId };
}

/** A federal office holder: the President. Appointed through the trusted path. */
function appointPresident(state, characterId, date = DATE) {
  const office = seededOffice(state, "office:president");
  return appointOfficial(state, office.office_id, characterId, "operator-seed", date, NOW);
}

test("an active, started, unexpired federal office authorises its own organisation only", () => {
  const state = makeState();
  const president = addCitizen(state, "President");
  appointPresident(state, president);

  const own = authorizeGovernmentActor(state, president, FEDERAL, DATE);
  assert.equal(own.ok, true, "the President is effective over the federal government");
  assert.equal(own.grant.character_id, president);

  // Exact scope (rule R-c, conservative default): a federal office does not act for a ministry.
  const ministry = authorizeGovernmentActor(state, president, FINANCE, DATE);
  assert.equal(ministry.ok, false);
  assert.equal(ministry.code, "government_authority_scope", "a federal officer does not automatically control a ministry");
});

test("an ordinary citizen, or an unknown character, holds no office authority", () => {
  const state = makeState();
  const citizen = addCitizen(state, "Citizen");
  assert.deepEqual(effectiveOfficeGrants(state, citizen, DATE), []);
  for (const characterId of [citizen, "char-does-not-exist"]) {
    const decision = authorizeGovernmentActor(state, characterId, FEDERAL, DATE);
    assert.equal(decision.ok, false);
    assert.equal(decision.code, "government_authority_none");
  }
});

test("a term that has ended on the date confers nothing, even before the processor runs", () => {
  const state = makeState();
  const official = addCitizen(state, "Expiring");
  const appointment = appointPresident(state, official);
  appointment.end_world_date = { ...DATE };
  assert.equal(appointmentAuthorityState(state, appointment, DATE), "term_ended");
  assert.equal(authorizeGovernmentActor(state, official, FEDERAL, DATE).code, "government_authority_none");

  // A term that ends after the date is still in force on the date.
  appointment.end_world_date = { year: 2027, month: 1, day: 1 };
  assert.equal(appointmentAuthorityState(state, appointment, DATE), "effective");
});

test("an appointment that has not yet started confers nothing", () => {
  const state = makeState();
  const future = addCitizen(state, "Future");
  const appointment = appointPresident(state, future, { year: 2027, month: 1, day: 1 });
  assert.equal(appointmentAuthorityState(state, appointment, DATE), "not_yet_started");
  assert.equal(authorizeGovernmentActor(state, future, FEDERAL, DATE).code, "government_authority_none");
  assert.equal(authorizeGovernmentActor(state, future, FEDERAL, { year: 2027, month: 1, day: 1 }).ok, true, "in force from its start date");
});

test("a removed or ended appointment confers nothing; removal leaves an audit event", () => {
  const state = makeState();
  const official = addCitizen(state, "Removed");
  const appointment = appointPresident(state, official);
  removeOfficial(state, appointment.appointment_id, "Removed for the test.", DATE, NOW);
  assert.equal(appointment.status, "ended");
  assert.equal(appointmentAuthorityState(state, appointment, DATE), "appointment_not_active");
  assert.equal(authorizeGovernmentActor(state, official, FEDERAL, DATE).code, "government_authority_none");
  assert.ok(Object.values(state.governmentEvents).some((e) => e.type === "appointment_ended"), "the removal is recorded");
});

test("the term-expiry processor ends elapsed terms once, records each, and leaves other appointments alone", () => {
  const state = makeState();
  const elapsed = addCitizen(state, "Elapsed");
  const current = addCitizen(state, "Current");
  const elapsedAppointment = appointPresident(state, elapsed);
  elapsedAppointment.end_world_date = { year: 2026, month: 9, day: 30 };
  // A second federal office holder with a term still running, to show the processor is selective.
  const minister = seededOffice(state, "office:minister");
  const ministerAppointment = appointOfficial(state, minister.office_id, current, "operator-seed", DATE, NOW);
  ministerAppointment.end_world_date = { year: 2027, month: 6, day: 1 };

  const eventsBefore = Object.keys(state.governmentEvents).length;
  assert.equal(expireElapsedTerms(state, DATE, NOW), 1, "one elapsed term is ended");
  assert.equal(elapsedAppointment.status, "ended");
  assert.equal(elapsedAppointment.end_reason, "Term ended.");
  assert.equal(ministerAppointment.status, "active", "a running term is untouched");
  assert.equal(Object.keys(state.governmentEvents).length, eventsBefore + 1, "one audit event for the one ended term");
  const event = Object.values(state.governmentEvents).find((e) => e.type === "appointment_ended" && e.details.reason === "term_ended");
  assert.ok(event, "the event records the term_ended reason");
  assert.equal(event.details.appointment_id, elapsedAppointment.appointment_id);

  assert.equal(expireElapsedTerms(state, DATE, NOW), 0, "a second run on the same date changes nothing");
  assert.equal(processGovernmentWorldDate(state, DATE, NOW), 0, "the daily processor is idempotent too");
  assert.equal(authorizeGovernmentActor(state, elapsed, FEDERAL, DATE).code, "government_authority_none");
});

test("a suspended office confers no authority and cannot be filled; reinstatement restores the holder's authority", () => {
  const state = makeState();
  const president = addCitizen(state, "Suspended");
  appointPresident(state, president);
  const office = seededOffice(state, "office:president");

  setGovernmentOfficeStatus(state, office.office_id, "suspended", "Administrative hold for the test.", DATE, NOW);
  assert.equal(officeOccupancy(state, office.office_id, DATE), "suspended");
  assert.equal(authorizeGovernmentActor(state, president, FEDERAL, DATE).code, "government_authority_none");

  const other = addCitizen(state, "Other");
  assert.throws(() => appointOfficial(state, office.office_id, other, "operator-seed", DATE, NOW), /government_office_suspended/,
    "a suspended office cannot be filled");

  setGovernmentOfficeStatus(state, office.office_id, "active", "Hold lifted.", DATE, NOW);
  assert.equal(authorizeGovernmentActor(state, president, FEDERAL, DATE).ok, true, "the existing appointment is restored, not replaced");
  const types = Object.values(state.governmentEvents).map((e) => e.type);
  assert.ok(types.includes("office_suspended") && types.includes("office_reinstated"), "suspension and reinstatement are recorded");
});

test("a contested unique office gives authority to neither claimant", () => {
  const state = makeState();
  const first = addCitizen(state, "FirstClaimant");
  const second = addCitizen(state, "SecondClaimant");
  appointPresident(state, first);
  // A second live appointment to the same unique office can only come from a bad write. Test setup forces it, to show
  // that the resolver fails closed on it.
  const office = seededOffice(state, "office:president");
  state.governmentAppointments["appt-forced-contest"] = {
    appointment_id: "appt-forced-contest", office_id: office.office_id, character_id: second, status: "active",
    start_date: new Date(NOW).toISOString(), start_world_date: { ...DATE }, end_date: null, end_world_date: null,
    end_reason: null, appointed_by: "test", created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(),
  };
  assert.equal(officeOccupancy(state, office.office_id, DATE), "contested");
  for (const characterId of [first, second]) {
    assert.equal(authorizeGovernmentActor(state, characterId, FEDERAL, DATE).code, "government_authority_none");
  }
});

test("a deceased holder, or an appointment whose holder record is missing, confers nothing", () => {
  const state = makeState();
  const dead = addCitizen(state, "Deceased", { status: "deceased" });
  const deadAppointment = appointPresident(state, addCitizen(state, "Living"));
  deadAppointment.character_id = dead;
  assert.equal(appointmentAuthorityState(state, deadAppointment, DATE), "holder_deceased");
  assert.equal(authorizeGovernmentActor(state, dead, FEDERAL, DATE).code, "government_authority_none");

  const phantom = "char-phantom";
  const phantomAppointment = appointOfficial(state, seededOffice(state, "office:minister").office_id, addCitizen(state, "Real"), "operator-seed", DATE, NOW);
  phantomAppointment.character_id = phantom;
  assert.equal(appointmentAuthorityState(state, phantomAppointment, DATE), "holder_missing");
});

test("an appointment in an inactive organisation confers nothing", () => {
  const state = makeState();
  const president = addCitizen(state, "Dissolved");
  appointPresident(state, president);
  state.governmentOrganisations[FEDERAL].status = "dissolved";
  assert.equal(authorizeGovernmentActor(state, president, FEDERAL, DATE).code, "government_authority_none");
});

test("a state office placed in the federal organisation confers nothing (level mismatch, fail closed)", () => {
  const state = makeState();
  // The seeded world places the state governor in the federal organisation. Authority follows the organisation, so
  // without this check the governor would hold federal scope. It must not.
  const governor = addCitizen(state, "Governor");
  const office = seededOffice(state, "office:governor");
  assert.equal(office.organisation_id, FEDERAL, "premise: the seeded state office sits in the federal organisation");
  appointOfficial(state, office.office_id, governor, "operator-seed", DATE, NOW);
  const appointment = Object.values(state.governmentAppointments).find((a) => a.character_id === governor);
  assert.equal(appointmentAuthorityState(state, appointment, DATE), "office_level_mismatch");
  assert.equal(authorizeGovernmentActor(state, governor, FEDERAL, DATE).code, "government_authority_none");
});

test("a state official's authority covers their own state and no other: jurisdiction is checked, not assumed", () => {
  const state = makeState();
  const { orgId, officeId } = addStateGovernment(state, "ng:state:fc");
  addStateGovernment(state, "ng:state:la");
  const governor = addCitizen(state, "FctGovernor");
  appointOfficial(state, officeId, governor, "operator-seed", DATE, NOW);

  assert.equal(authorizeGovernmentActor(state, governor, orgId, DATE).ok, true, "the governor is effective over their own state");
  assert.equal(authorizeGovernmentActor(state, governor, "gov:state:la", DATE).code, "government_authority_scope",
    "a governor of one state has no authority over another state");
  assert.equal(authorizeGovernmentActor(state, governor, FEDERAL, DATE).code, "government_authority_scope",
    "a state official does not control federal resources");
});

test("a duplicate state office cannot be filled while the first holder is effective (existing rule, re-checked)", () => {
  const state = makeState();
  const first = addCitizen(state, "Holder");
  const second = addCitizen(state, "Challenger");
  appointPresident(state, first);
  assert.throws(() => appointPresident(state, second), /government_office_already_occupied/);
  assert.equal(Object.values(state.governmentAppointments).filter((a) => a.status === "active").length, 1);
});

test("government record validation accepts a suspended office and rejects an unknown office status", () => {
  const state = makeState();
  const office = seededOffice(state, "office:president");
  const maps = state;
  office.status = "suspended";
  assert.equal(validateGovernmentRecords(maps).issues.length, 0, "a suspended office is a valid record");
  office.status = "frozen";
  const issues = validateGovernmentRecords(maps).issues;
  assert.ok(issues.some((issue) => issue.field === "status"), "an unknown office status is refused on load");
});

for (const backendName of backendNames) {
  test(`[${backendName}] a suspended office and the holder's appointment survive a save and reload; authority stays refused`, async () => {
    // A real identity is created over the socket, so the holder is a valid persisted player (the loader validates players).
    const backend = await openBackend(backendName);
    const started = await startOver(backend, { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } });
    const peer = await openPeer(started.websocketUrl);
    try {
      const identity = await createIdentity(peer, "Persisted");
      await resumeSession(peer, identity.sessionToken);
      const state = backend.store.state;
      const date = state.worldClock.world_date;
      const character = state.players[identity.playerId].character;
      const characterId = character.character_id;
      // Age is derived from date_of_birth on the world date, so the birth date is what is set (an adult, 40).
      character.date_of_birth = { year: date.year - 40, month: 1, day: 1 };
      character.age = 40;
      if (Object.keys(state.governmentOrganisations ?? {}).length === 0) {
        initializeGovernmentWorldState(state);
        seedGovernmentWorld(state, date, NOW);
      }
      appointPresident(state, characterId, date);
      const office = seededOffice(state, "office:president");
      setGovernmentOfficeStatus(state, office.office_id, "suspended", "Persistence check.", date, NOW);
      await backend.store.saveState(state);
    } finally {
      peer.close();
      await started.stop();
    }

    await backend.reopen();
    try {
      const reloaded = backend.store.state;
      const date = reloaded.worldClock.world_date;
      const office = seededOffice(reloaded, "office:president");
      assert.equal(office.status, "suspended", "the suspension is durable");
      const holder = Object.values(reloaded.governmentAppointments).find((a) => a.office_id === office.office_id);
      assert.ok(holder, "the appointment record is kept, not deleted");
      assert.equal(holder.status, "active");
      assert.equal(authorizeGovernmentActor(reloaded, holder.character_id, FEDERAL, date).code, "government_authority_none",
        "the suspended office still confers no authority after reload");
    } finally {
      await backend.cleanup();
    }
  });
}
