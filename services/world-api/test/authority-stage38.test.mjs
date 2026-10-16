// Authority and consequential socket paths (Stage 38). Runs on every configured backend: file always, PostgreSQL when the
// live database is configured (the same tests run on both). Each test drives a real server over the socket and checks
// what the server reports AND what is stored (the saved world, read back with durableState()).
//
// What these tests prove:
//   - police dispatch_unit and open_investigation act only for the officer's own station, only for an incident that
//     triage assigned to that station, and only from an officer on duty. A refused request changes no record.
//   - The client cannot name another officer as the requesting or lead officer: the session's officer is used.
//   - commit_crime checks each named target against the saved world: a victim must be a different, existing character;
//     a property or business must exist and not be the perpetrator's; a target the crime does not take is refused. The
//     stored victim is the checked identifier. A refused crime records nothing.
//   - military apply_for_service and police apply_recruitment take the applicant from the session, ignore a client-named
//     applicant, and refuse a character with no date of birth (no silent age of 20).
//   - create_proposal and submit_proposal: only the sponsor can submit; a submitted proposal cannot be submitted again;
//     no socket route enacts a law.
//   - family.childbirth after a marriage formed over the socket: a refused birth records nothing; a saved birth is told
//     to the spouse only after the save; a retry with the same request ID records one child.
//   - Save failures for these paths are reported as *_not_saved and are not confirmed; a retry applies the change once.
//
// What they do NOT prove:
//   - Officers and triaged incidents have no socket route. These tests create them in memory (the saved world is then
//     flushed). The creation path is therefore not tested here; see docs/STAGE_38_AUTHORITY_ENFORCEMENT_AND_MULTIPLAYER_RELIABILITY.md.
//   - Education eligibility for military and police recruitment reads the display label stored on the character, and no
//     label maps to a level (Stage 38 finding). The success path below therefore sets the character's education to the
//     key the rule reads, and says so. The refusal path with the real label is also tested.
//   - Cross-process behaviour: see cross-process-requests-stage36.test.mjs (PostgreSQL only).
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

/**
 * The reply to one request ID: a result, an error, a duplicate, or a family's own event, for that request ID. A
 * character.snapshot is not a reply: a duplicate sends command.duplicate first, and a snapshot left in the buffer would
 * otherwise answer a later request that reuses the ID.
 */
function replyTo(requestId) {
  return (message) => message.requestId === requestId && (
    message.type.endsWith(".result") || message.type.endsWith(".error") || message.type.endsWith("childborn")
    || message.type === "error" || message.type === "command.duplicate" || message.type === "relationship.progress"
  );
}

async function send(peer, message, timeoutMs = 20000) {
  peer.send(message);
  return peer.waitFor(replyTo(message.requestId), timeoutMs);
}

/** Records that a test seeds in memory: an officer on a station, and an incident triaged to a station. */
async function seedOfficer(entry, actor, stationId, status = "on_duty") {
  const state = entry.backend.store.state;
  const officerId = `officer-s38-${actor.characterId}`;
  const now = new Date().toISOString();
  state.policeOfficers[officerId] = {
    officer_id: officerId, character_id: actor.characterId, station_id: stationId, rank: "sergeant", status,
    badge_number: "PF-38", training_completed: [], joined_at: now, joined_world_date: { ...state.worldClock.world_date },
    appointed_by: null, updated_at: now,
  };
  await entry.backend.store.flush();
  return officerId;
}

async function reportIncident(actor, description, requestId) {
  return send(actor.peer, {
    type: "police.action", action: "submit_incident", requestId, category: "theft", description, summary: description,
  });
}

/** Triage is not routed on the socket, so the test assigns the incident to a station, as triage would. */
async function triage(entry, incidentId, stationId, status = "accepted") {
  const incident = entry.backend.store.state.policeIncidents[incidentId];
  incident.status = status;
  incident.assigned_station_id = stationId;
  await entry.backend.store.flush();
}

function policeIncidentIds(state) {
  return Object.keys(state.policeIncidents).sort();
}

async function durable(entry) {
  return entry.backend.durableState();
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

  // ─── Police: dispatch_unit ─────────────────────────────────────────

  test(label("dispatch_unit acts only for the officer's own station and an incident assigned to it; refusals change nothing"), async () => {
    const entry = await session(backendName);
    const officer = await citizen(entry, "Sergeant");
    await seedOfficer(entry, officer, "abuja-central");
    const forCentral = await reportIncident(officer, "Phone snatched at Wuse market", "s38-d1-inc1");
    const forSouth = await reportIncident(officer, "Shop break-in at Garki", "s38-d1-inc2");
    assert.equal(forCentral.type, "police.result", JSON.stringify(forCentral));
    assert.equal(forSouth.type, "police.result", JSON.stringify(forSouth));
    const centralId = forCentral.data.incident.incident_id;
    const southId = forSouth.data.incident.incident_id;
    await triage(entry, centralId, "abuja-central");
    await triage(entry, southId, "abuja-south");
    const dispatchesBefore = JSON.stringify(entry.backend.store.state.dispatches);

    // A station the officer does not serve, for an incident of that station: refused by the officer's station.
    const otherStation = await send(officer.peer, {
      type: "police.action", action: "dispatch_unit", requestId: "s38-d1-a", incident_id: centralId, station_id: "abuja-south", notes: "Respond",
    });
    assert.equal(otherStation.type, "police.error", JSON.stringify(otherStation));
    assert.equal(otherStation.code, "police_station_not_authorized");

    // The officer's own station, but an incident triage assigned to another station: refused by the assignment.
    const notAssigned = await send(officer.peer, {
      type: "police.action", action: "dispatch_unit", requestId: "s38-d1-b", incident_id: southId, station_id: "abuja-central", notes: "Respond",
    });
    assert.equal(notAssigned.code, "police_incident_not_assigned", JSON.stringify(notAssigned));

    assert.equal(JSON.stringify(entry.backend.store.state.dispatches), dispatchesBefore, "no dispatch was created by a refused request");
    assert.equal(entry.backend.store.state.policeIncidents[centralId].status, "accepted", "the incident status did not change");

    // The authorised request. The client also names another officer as the requester; the session's officer is used.
    const ok = await send(officer.peer, {
      type: "police.action", action: "dispatch_unit", requestId: "s38-d1-c", incident_id: centralId, station_id: "abuja-central",
      notes: "Respond to the market", requesting_officer_id: "officer-someone-else",
    });
    assert.equal(ok.type, "police.result", JSON.stringify(ok));
    const dispatch = ok.data.dispatch;
    assert.equal(dispatch.requesting_officer_id, `officer-s38-${officer.characterId}`, "the session's officer is the requester");
    assert.equal(entry.backend.store.state.policeIncidents[centralId].status, "assigned");
    const saved = await durable(entry);
    assert.ok(saved.dispatches[dispatch.dispatch_id], "the dispatch is saved");
    assert.equal(saved.policeIncidents[centralId].status, "assigned", "the incident status is saved");
  });

  test(label("dispatch_unit refuses a non-officer, a suspended officer, a missing station, and an unknown station, with no change"), async () => {
    const entry = await session(backendName);
    const civilian = await citizen(entry, "Civilian");
    const suspended = await citizen(entry, "Suspended");
    await seedOfficer(entry, suspended, "abuja-central", "suspended");
    const inc = await reportIncident(civilian, "Stolen bicycle at Maitama", "s38-d2-inc");
    const incidentId = inc.data.incident.incident_id;
    await triage(entry, incidentId, "abuja-central");
    const before = JSON.stringify(entry.backend.store.state.dispatches);

    const notOfficer = await send(civilian.peer, {
      type: "police.action", action: "dispatch_unit", requestId: "s38-d2-a", incident_id: incidentId, station_id: "abuja-central", notes: "Respond",
    });
    assert.equal(notOfficer.code, "police_not_an_officer", JSON.stringify(notOfficer));

    const suspendedReply = await send(suspended.peer, {
      type: "police.action", action: "dispatch_unit", requestId: "s38-d2-b", incident_id: incidentId, station_id: "abuja-central", notes: "Respond",
    });
    assert.equal(suspendedReply.code, "police_officer_suspended", JSON.stringify(suspendedReply));

    const missingStation = await send(civilian.peer, {
      type: "police.action", action: "dispatch_unit", requestId: "s38-d2-c", incident_id: incidentId, notes: "Respond",
    });
    assert.equal(missingStation.code, "police_dispatch_fields_required", JSON.stringify(missingStation));

    const suspendedElsewhere = await send(suspended.peer, {
      type: "police.action", action: "dispatch_unit", requestId: "s38-d2-d", incident_id: incidentId, station_id: "no-such-station", notes: "Respond",
    });
    assert.equal(suspendedElsewhere.code, "police_officer_suspended", "suspension is checked before the station");
    assert.equal(JSON.stringify(entry.backend.store.state.dispatches), before, "no dispatch was created");
    assert.equal(Object.keys((await durable(entry)).dispatches).length, Object.keys(JSON.parse(before)).length, "none was saved");
  });

  test(label("dispatch_unit: a duplicate replays once, a reused request ID is refused, and a save failure is not confirmed until a retry applies it once"), async () => {
    const entry = await session(backendName);
    const officer = await citizen(entry, "Dispatcher");
    await seedOfficer(entry, officer, "abuja-central");
    const inc = await reportIncident(officer, "Armed robbery report at Gwarinpa", "s38-d3-inc");
    const incidentId = inc.data.incident.incident_id;
    await triage(entry, incidentId, "abuja-central");
    const dispatch = { type: "police.action", action: "dispatch_unit", incident_id: incidentId, station_id: "abuja-central", notes: "Respond" };
    const countFor = (state) => Object.values(state.dispatches).filter((d) => d.incident_id === incidentId).length;

    const first = await send(officer.peer, { ...dispatch, requestId: "s38-d3-1" });
    assert.equal(first.type, "police.result", JSON.stringify(first));
    const again = await send(officer.peer, { ...dispatch, requestId: "s38-d3-1" });
    assert.equal(again.type, "command.duplicate", JSON.stringify(again));
    assert.equal(countFor(entry.backend.store.state), 1, "a duplicate created no second dispatch");

    const reused = await send(officer.peer, { ...dispatch, requestId: "s38-d3-1", notes: "A different request" });
    assert.equal(reused.code, "request_id_reused", JSON.stringify(reused));
    assert.equal(countFor(entry.backend.store.state), 1);

    // A second dispatch for the same incident, whose save fails: not confirmed, then the retry applies it once.
    entry.backend.store.failNextWrite("disk full");
    const failed = await send(officer.peer, { ...dispatch, requestId: "s38-d3-2", notes: "Second unit" });
    assert.equal(failed.type, "police.error", JSON.stringify(failed));
    assert.equal(failed.code, "police_not_saved", "a dispatch whose save failed is not confirmed");
    const retry = await send(officer.peer, { ...dispatch, requestId: "s38-d3-2", notes: "Second unit" });
    assert.equal(retry.type, "police.result", JSON.stringify(retry));
    assert.equal(countFor(entry.backend.store.state), 2, "the second dispatch is recorded once");
    const saved = await durable(entry);
    assert.equal(Object.values(saved.dispatches).filter((d) => d.incident_id === incidentId).length, 2, "both dispatches are saved, once each");
  });

  // ─── Police: open_investigation ────────────────────────────────────

  test(label("open_investigation uses the session's officer as lead, and acts only for the officer's station and an assigned incident"), async () => {
    const entry = await session(backendName);
    const officer = await citizen(entry, "Investigator");
    await seedOfficer(entry, officer, "abuja-central");
    const inc = await reportIncident(officer, "Fraud at Jabi bureau", "s38-o1-inc");
    const incidentId = inc.data.incident.incident_id;
    const investigationsBefore = JSON.stringify(entry.backend.store.state.investigations);

    // Not yet triaged: refused, and nothing opened.
    const unassigned = await send(officer.peer, {
      type: "police.action", action: "open_investigation", requestId: "s38-o1-a", incident_id: incidentId,
      station_id: "abuja-central", category: "fraud", summary: "Investigate fraud",
    });
    assert.equal(unassigned.code, "police_incident_not_assigned", JSON.stringify(unassigned));
    assert.equal(JSON.stringify(entry.backend.store.state.investigations), investigationsBefore);

    await triage(entry, incidentId, "abuja-central");
    const otherStation = await send(officer.peer, {
      type: "police.action", action: "open_investigation", requestId: "s38-o1-b", incident_id: incidentId,
      station_id: "abuja-south", category: "fraud", summary: "Investigate fraud",
    });
    assert.equal(otherStation.code, "police_station_not_authorized", JSON.stringify(otherStation));
    assert.equal(JSON.stringify(entry.backend.store.state.investigations), investigationsBefore, "a refused investigation opens nothing");

    const ok = await send(officer.peer, {
      type: "police.action", action: "open_investigation", requestId: "s38-o1-c", incident_id: incidentId,
      station_id: "abuja-central", category: "fraud", summary: "Investigate fraud", lead_officer_id: "officer-someone-else",
    });
    assert.equal(ok.type, "police.result", JSON.stringify(ok));
    assert.equal(ok.data.investigation.lead_officer_id, `officer-s38-${officer.characterId}`, "the session's officer leads");
    assert.equal(entry.backend.store.state.policeIncidents[incidentId].status, "under_investigation");
    const saved = await durable(entry);
    assert.equal(Object.values(saved.investigations).filter((i) => i.incident_id === incidentId).length, 1);

    // The incident is now under investigation: a second investigation is refused by its state.
    const second = await send(officer.peer, {
      type: "police.action", action: "open_investigation", requestId: "s38-o1-d", incident_id: incidentId,
      station_id: "abuja-central", category: "fraud", summary: "Second investigation",
    });
    assert.equal(second.code, "police_incident_status_invalid", JSON.stringify(second));
    assert.equal(Object.values(entry.backend.store.state.investigations).filter((i) => i.incident_id === incidentId).length, 1);
  });

  // ─── Police: apply_recruitment (the applicant is the session character) ───

  test(label("apply_recruitment takes the applicant from the session, requires a known station, and refuses a missing date of birth"), async () => {
    const entry = await session(backendName);
    const applicant = await citizen(entry, "Recruit");
    const other = await citizen(entry, "Bystander");
    const state = entry.backend.store.state;
    const body = { type: "police.action", action: "apply_recruitment", station_id: "abuja-central" };

    // The education is the display label on the record, which no rule level matches (see the header): refused, nothing recorded.
    const labelled = await send(applicant.peer, { ...body, requestId: "s38-r1-a", character_id: other.characterId });
    assert.equal(labelled.code, "police_education_ineligible", JSON.stringify(labelled));
    assert.equal(Object.values(state.recruitmentApplications).length, 0);

    // The eligible path: the education rule reads a level key. The test sets that key on the character (see header).
    applicant.character.education_level = "tertiary";
    other.character.education_level = "tertiary";
    await entry.backend.store.flush();
    const ok = await send(applicant.peer, { ...body, requestId: "s38-r1-b", character_id: other.characterId });
    assert.equal(ok.type, "police.result", JSON.stringify(ok));
    assert.equal(ok.data.application.character_id, applicant.characterId, "the applicant is the session character, not the named one");
    assert.equal(Object.values((await durable(entry)).recruitmentApplications).filter((a) => a.character_id === other.characterId).length, 0, "the named character applied for nothing");

    // A station that does not exist: a plain code, not an internal error, and nothing recorded for this applicant.
    const unknownStation = await send(other.peer, { ...body, requestId: "s38-r1-c", station_id: "no-such-station" });
    assert.equal(unknownStation.type, "police.error", JSON.stringify(unknownStation));
    assert.equal(unknownStation.code, "police_station_not_found", JSON.stringify(unknownStation));
    assert.equal(Object.values(state.recruitmentApplications).filter((a) => a.character_id === other.characterId).length, 0);

    // A second active application by the same applicant is refused as a duplicate.
    const duplicate = await send(applicant.peer, { ...body, requestId: "s38-r1-d" });
    assert.equal(duplicate.code, "police_duplicate_application", JSON.stringify(duplicate));
    assert.equal(Object.values((await durable(entry)).recruitmentApplications).filter((a) => a.character_id === applicant.characterId).length, 1, "one application is saved");

    // No date of birth: refused, not assumed to be an adult of 20.
    other.character.date_of_birth = undefined;
    await entry.backend.store.flush();
    const noBirth = await send(other.peer, { ...body, requestId: "s38-r1-e" });
    assert.equal(noBirth.code, "police_age_ineligible", JSON.stringify(noBirth));
    assert.equal(Object.values(state.recruitmentApplications).filter((a) => a.character_id === other.characterId).length, 0);
  });

  // ─── Crime: commit_crime targets ───────────────────────────────────

  test(label("commit_crime checks a character victim against the saved world: a real, different character only"), async () => {
    const entry = await session(backendName);
    const perpetrator = await citizen(entry, "Thief");
    const victim = await citizen(entry, "Shopper");
    const incidentsBefore = JSON.stringify(entry.backend.store.state.crimeIncidents);
    const base = { type: "crime.action", action: "commit_crime", crime_definition_id: "shoplifting" };

    const none = await send(perpetrator.peer, { ...base, requestId: "s38-c1-a" });
    assert.equal(none.code, "crime_victim_required", JSON.stringify(none));
    const self = await send(perpetrator.peer, { ...base, requestId: "s38-c1-b", victim_character_id: perpetrator.characterId });
    assert.equal(self.code, "crime_victim_is_perpetrator", JSON.stringify(self));
    const missing = await send(perpetrator.peer, { ...base, requestId: "s38-c1-c", victim_character_id: "character-nobody" });
    assert.equal(missing.code, "crime_victim_not_found", JSON.stringify(missing));
    const malformed = await send(perpetrator.peer, { ...base, requestId: "s38-c1-d", victim_character_id: 42 });
    assert.equal(malformed.code, "crime_target_invalid", JSON.stringify(malformed));
    const wrongKind = await send(perpetrator.peer, { ...base, requestId: "s38-c1-e", victim_character_id: victim.characterId, victim_property_id: "property-nope" });
    assert.equal(wrongKind.code, "crime_target_not_applicable", "shoplifting takes no property, so a property id is refused");
    assert.equal(JSON.stringify(entry.backend.store.state.crimeIncidents), incidentsBefore, "no refused crime recorded an incident");

    const ok = await send(perpetrator.peer, { ...base, requestId: "s38-c1-f", victim_character_id: victim.characterId });
    assert.equal(ok.type, "crime.result", JSON.stringify(ok));
    assert.equal(ok.data.incident.victim_character_id, victim.characterId, "the stored victim is the checked character");
    const saved = await durable(entry);
    assert.equal(Object.values(saved.crimeIncidents).filter((i) => i.victim_character_id === victim.characterId).length, 1);
  });

  test(label("commit_crime refuses a target type the crime does not take, and checks property and business owners"), async () => {
    const entry = await session(backendName);
    const perpetrator = await citizen(entry, "Burglar");
    const neighbour = await citizen(entry, "Neighbour");
    const state = entry.backend.store.state;
    const activeOwnership = Object.values(state.propertyOwnership).filter((o) => o.active);
    assert.ok(activeOwnership.length >= 2, "the seeded world has at least two owned properties");
    const ownOwnership = activeOwnership[0];
    const otherOwnership = activeOwnership[1];
    ownOwnership.owner_kind = "player";
    ownOwnership.owner_id = perpetrator.characterId;
    otherOwnership.owner_kind = "player";
    otherOwnership.owner_id = neighbour.characterId;
    await entry.backend.store.flush();
    const incidentsBefore = JSON.stringify(state.crimeIncidents);
    const burglary = { type: "crime.action", action: "commit_crime", crime_definition_id: "burglary" };

    const characterOnProperty = await send(perpetrator.peer, { ...burglary, requestId: "s38-c2-a", victim_character_id: neighbour.characterId });
    assert.equal(characterOnProperty.code, "crime_target_not_applicable", "a burglary takes no character victim");
    const notApplicable = await send(perpetrator.peer, {
      ...burglary, requestId: "s38-c2-b", victim_property_id: otherOwnership.property_id, victim_character_id: neighbour.characterId,
    });
    assert.equal(notApplicable.code, "crime_target_not_applicable", JSON.stringify(notApplicable));
    const own = await send(perpetrator.peer, { ...burglary, requestId: "s38-c2-c", victim_property_id: ownOwnership.property_id });
    assert.equal(own.code, "crime_victim_is_perpetrator", JSON.stringify(own));
    const shoplift = await send(perpetrator.peer, { type: "crime.action", action: "commit_crime", crime_definition_id: "shoplifting", requestId: "s38-c2-d", victim_business_id: "business-nope", victim_character_id: neighbour.characterId });
    assert.equal(shoplift.code, "crime_target_not_applicable", JSON.stringify(shoplift));
    assert.equal(JSON.stringify(state.crimeIncidents), incidentsBefore, "no refused crime was recorded");

    const ok = await send(perpetrator.peer, { ...burglary, requestId: "s38-c2-e", victim_property_id: otherOwnership.property_id });
    assert.equal(ok.type, "crime.result", JSON.stringify(ok));
    assert.equal(ok.data.incident.victim_property_id, otherOwnership.property_id, "the stored property is the checked one");
    assert.equal(ok.data.incident.victim_character_id, null, "no character victim was attached to a property crime");

    // A business fraud against a business the perpetrator owns is refused; against an unknown business too.
    // The seeded world has no business, and business creation spends the player's cash, so the test seeds one record in
    // memory. Only refusals are tested against it: the owner check and the not-found check. A business victim that
    // succeeds is not tested here.
    const businessId = "business-s38-fixture";
    const now = new Date().toISOString();
    state.businesses[businessId] = {
      business_id: businessId, name: "Fixture Stores", description: "Test fixture", template_id: "fixture", category_id: "retail",
      model: "retail", status: "active", primary_location_id: "idera-quarter", premises_type: "shop", reputation_score: 50,
      total_revenue_ngn: 0, total_expenses_ngn: 0, total_capital_ngn: 0, total_withdrawals_ngn: 0, balance_ngn: 0,
      created_at: now, created_world_date: { ...state.worldClock.world_date }, updated_at: now, last_operating_date: null,
      owner_character_id: neighbour.characterId, closed_at: null, closed_world_date: null, closure_reason: null,
    };
    await entry.backend.store.flush();
    const businesses = [state.businesses[businessId]];
    const fraud = { type: "crime.action", action: "commit_crime", crime_definition_id: "business_fraud" };
    const noBusiness = await send(perpetrator.peer, { ...fraud, requestId: "s38-c2-f" });
    assert.equal(noBusiness.code, "crime_business_required", JSON.stringify(noBusiness));
    const unknownBusiness = await send(perpetrator.peer, { ...fraud, requestId: "s38-c2-g", victim_business_id: "business-nope" });
    assert.equal(unknownBusiness.code, "crime_business_not_found", JSON.stringify(unknownBusiness));
    businesses[0].owner_character_id = perpetrator.characterId;
    await entry.backend.store.flush();
    const ownBusiness = await send(perpetrator.peer, { ...fraud, requestId: "s38-c2-h", victim_business_id: businesses[0].business_id });
    assert.equal(ownBusiness.code, "crime_victim_is_perpetrator", JSON.stringify(ownBusiness));
  });

  test(label("commit_crime: a save failure is not confirmed, and the retry records the crime once"), async () => {
    const entry = await session(backendName);
    const perpetrator = await citizen(entry, "Pickpocket");
    const victim = await citizen(entry, "Commuter");
    const request = { type: "crime.action", action: "commit_crime", crime_definition_id: "pickpocketing", victim_character_id: victim.characterId };
    const recorded = () => Object.values(entry.backend.store.state.crimeIncidents).filter((i) => i.victim_character_id === victim.characterId).length;

    entry.backend.store.failNextWrite("disk full");
    const failed = await send(perpetrator.peer, { ...request, requestId: "s38-c3-a" });
    assert.equal(failed.type, "crime.error", JSON.stringify(failed));
    assert.equal(failed.code, "crime_not_saved", "a crime whose save failed is not confirmed");
    const retry = await send(perpetrator.peer, { ...request, requestId: "s38-c3-a" });
    assert.equal(retry.type, "crime.result", JSON.stringify(retry));
    assert.equal(recorded(), 1, "the crime is recorded once in memory");
    const saved = await durable(entry);
    assert.equal(Object.values(saved.crimeIncidents).filter((i) => i.victim_character_id === victim.characterId).length, 1, "and once in the saved world");
  });

  // ─── Military: apply_for_service ───────────────────────────────────

  test(label("apply_for_service takes the applicant from the session, ignores a client-named applicant, and refuses a missing date of birth"), async () => {
    const entry = await session(backendName);
    const recruit = await citizen(entry, "Enlistee");
    const other = await citizen(entry, "Someone");
    const state = entry.backend.store.state;

    // Unmapped label on the record: refused as education-ineligible (see the header), and nothing recorded.
    const labelled = await send(recruit.peer, { type: "military.action", action: "apply_for_service", requestId: "s38-m1-a", branch: "army", character_id: other.characterId });
    assert.equal(labelled.code, "military_education_ineligible", JSON.stringify(labelled));
    assert.equal(Object.values(state.militaryRecruitments).length, 0);

    recruit.character.education_level = "tertiary";
    await entry.backend.store.flush();
    const missingBranch = await send(recruit.peer, { type: "military.action", action: "apply_for_service", requestId: "s38-m1-b" });
    assert.equal(missingBranch.code, "military_branch_invalid", JSON.stringify(missingBranch));
    const badBranch = await send(recruit.peer, { type: "military.action", action: "apply_for_service", requestId: "s38-m1-c", branch: "marines" });
    assert.equal(badBranch.code, "military_branch_invalid", JSON.stringify(badBranch));
    assert.equal(Object.values(state.militaryRecruitments).length, 0, "refused applications recorded nothing");

    const applyBody = { type: "military.action", action: "apply_for_service", branch: "army", character_id: other.characterId };
    const ok = await send(recruit.peer, { ...applyBody, requestId: "s38-m1-d" });
    assert.equal(ok.type, "military.result", JSON.stringify(ok));
    assert.equal(ok.data.application.character_id, recruit.characterId, "the applicant is the session character");
    const duplicate = await send(recruit.peer, { type: "military.action", action: "apply_for_service", requestId: "s38-m1-e", branch: "navy" });
    assert.equal(duplicate.code, "military_duplicate_application", JSON.stringify(duplicate));
    const same = await send(recruit.peer, { ...applyBody, requestId: "s38-m1-d" });
    assert.equal(same.type, "command.duplicate", JSON.stringify(same));
    assert.equal(Object.values((await durable(entry)).militaryRecruitments).length, 1, "one application is saved");

    const another = await citizen(entry, "Nobody");
    another.character.education_level = "tertiary";
    another.character.date_of_birth = undefined;
    await entry.backend.store.flush();
    const noBirth = await send(another.peer, { type: "military.action", action: "apply_for_service", requestId: "s38-m1-f", branch: "air_force" });
    assert.equal(noBirth.code, "military_age_ineligible", "no date of birth is refused, not assumed to be 20");
  });

  test(label("apply_for_service: a save failure is not confirmed; the retry records the application once"), async () => {
    const entry = await session(backendName);
    const recruit = await citizen(entry, "Retry");
    recruit.character.education_level = "tertiary";
    await entry.backend.store.flush();
    const request = { type: "military.action", action: "apply_for_service", branch: "army" };
    entry.backend.store.failNextWrite("disk full");
    const failed = await send(recruit.peer, { ...request, requestId: "s38-m2-a" });
    assert.equal(failed.type, "military.error", JSON.stringify(failed));
    assert.equal(failed.code, "military_not_saved");
    const retry = await send(recruit.peer, { ...request, requestId: "s38-m2-a" });
    assert.equal(retry.type, "military.result", JSON.stringify(retry));
    assert.equal(Object.values((await durable(entry)).militaryRecruitments).filter((a) => a.character_id === recruit.characterId).length, 1);
  });

  // ─── Justice: proposals ────────────────────────────────────────────

  test(label("create_proposal and submit_proposal: only the sponsor submits a draft, once; no route enacts a law"), async () => {
    const entry = await session(backendName);
    const sponsor = await citizen(entry, "Sponsor");
    const other = await citizen(entry, "Outsider");
    const state = entry.backend.store.state;
    const lawsBefore = Object.keys(state.laws).length;
    const create = {
      type: "justice.action", action: "create_proposal", title: "Water access act", description: "Public water points", purpose: "Health",
      jurisdiction: "federal", provisions: [{ section: "1", title: "Scope", description: "All wards" }],
    };

    const missingTitle = await send(sponsor.peer, { ...create, title: undefined, requestId: "s38-p1-a" });
    assert.equal(missingTitle.code, "justice_action_invalid", JSON.stringify(missingTitle));
    assert.equal(Object.keys(state.legislativeProposals).length, 0);

    const made = await send(sponsor.peer, { ...create, requestId: "s38-p1-b" });
    assert.equal(made.type, "justice.result", JSON.stringify(made));
    const proposalId = made.data.proposal.proposal_id;
    assert.equal(made.data.proposal.status, "draft");
    assert.equal(made.data.proposal.sponsor_character_id, sponsor.characterId, "the sponsor is the session character");
    assert.equal((await durable(entry)).legislativeProposals[proposalId].status, "draft");

    const notSponsor = await send(other.peer, { type: "justice.action", action: "submit_proposal", proposal_id: proposalId, requestId: "s38-p1-c" });
    assert.equal(notSponsor.code, "justice_not_proposal_sponsor", JSON.stringify(notSponsor));
    assert.equal((await durable(entry)).legislativeProposals[proposalId].status, "draft", "a refused submission changed nothing");

    const submitted = await send(sponsor.peer, { type: "justice.action", action: "submit_proposal", proposal_id: proposalId, requestId: "s38-p1-d" });
    assert.equal(submitted.type, "justice.result", JSON.stringify(submitted));
    assert.equal(submitted.data.proposal.status, "submitted");
    assert.equal((await durable(entry)).legislativeProposals[proposalId].status, "submitted");

    const again = await send(sponsor.peer, { type: "justice.action", action: "submit_proposal", proposal_id: proposalId, requestId: "s38-p1-e" });
    assert.equal(again.code, "justice_proposal_not_draft", JSON.stringify(again));
    const unknown = await send(sponsor.peer, { type: "justice.action", action: "submit_proposal", proposal_id: "prop-nope", requestId: "s38-p1-f" });
    assert.equal(unknown.code, "justice_proposal_not_found", JSON.stringify(unknown));

    // No socket route enacts or rejects a proposal: the action is unknown, so nothing is enacted.
    const enact = await send(sponsor.peer, { type: "justice.action", action: "approve_proposal", proposal_id: proposalId, requestId: "s38-p1-g" });
    assert.equal(enact.type, "justice.error", JSON.stringify(enact));
    assert.equal(Object.keys(state.laws).length, lawsBefore, "no law was enacted");
    assert.equal(state.legislativeProposals[proposalId].status, "submitted");
  });

  test(label("create_proposal: a minor is refused, a request with no ID is refused, and a save failure is retried once"), async () => {
    const entry = await session(backendName);
    const minor = await citizen(entry, "Minor", 10);
    const adult = await citizen(entry, "Adult");
    const create = { type: "justice.action", action: "create_proposal", title: "Bus lanes", description: "Lanes", purpose: "Transit", jurisdiction: "state" };
    const minorReply = await send(minor.peer, { ...create, requestId: "s38-p2-a" });
    assert.equal(minorReply.code, "justice_age_ineligible", JSON.stringify(minorReply));
    adult.peer.send({ ...create });
    const noId = await adult.peer.waitFor((m) => m.type === "error" && m.code === "request_id_required", 20000);
    assert.equal(noId.code, "request_id_required");

    entry.backend.store.failNextWrite("disk full");
    const failed = await send(adult.peer, { ...create, requestId: "s38-p2-b" });
    assert.equal(failed.type, "justice.error", JSON.stringify(failed));
    assert.equal(failed.code, "justice_not_saved");
    const retry = await send(adult.peer, { ...create, requestId: "s38-p2-b" });
    assert.equal(retry.type, "justice.result", JSON.stringify(retry));
    const saved = await durable(entry);
    assert.equal(Object.values(saved.legislativeProposals).filter((p) => p.sponsor_character_id === adult.characterId).length, 1, "one proposal is saved");
  });

  // ─── Family: childbirth after a marriage formed over the socket ────

  async function formMarriage(a, b) {
    for (const stage of ["meet", "get_to_know", "dating", "commitment", "marriage"]) {
      const first = await send(a.peer, { type: "relationship.progress", requestId: `s38-m-${stage}-a`, targetCharacterId: b.characterId, stage });
      assert.equal(first.status, "pending", `${stage} is proposed: ${JSON.stringify(first)}`);
      const second = await send(b.peer, { type: "relationship.progress", requestId: `s38-m-${stage}-b`, targetCharacterId: a.characterId, stage });
      assert.equal(second.status, "confirmed", `${stage} is confirmed: ${JSON.stringify(second)}`);
    }
  }

  async function nearby(...people) {
    for (const who of people) {
      who.character.current_location = "home";
      who.character.position = { x: 440, y: 350 };
    }
  }

  const childReply = (requestId) => (message) => message.requestId === requestId && (message.type === "family.childborn" || message.type === "family.error" || message.type === "error" || message.type === "command.duplicate");

  test(label("family.childbirth needs an active marriage; a parent without one is refused and no child is recorded"), async () => {
    const entry = await session(backendName);
    const single = await citizen(entry, "Single");
    const childrenBefore = JSON.stringify(Object.values(entry.backend.store.state.people).filter((p) => p.family_role === "child").length);
    single.peer.send({ type: "family.childbirth", requestId: "s38-f1-a", name: "Tunde" });
    const reply = await single.peer.waitFor(childReply("s38-f1-a"), 20000);
    assert.equal(reply.code, "marriage_not_active", JSON.stringify(reply));
    assert.equal(JSON.stringify(Object.values(entry.backend.store.state.people).filter((p) => p.family_role === "child").length), childrenBefore, "no child was recorded");
  });

  test(label("family.childbirth after a marriage: a refused birth records nothing; a saved birth is told to the spouse once, after the save; a retry records one child"), async () => {
    const entry = await session(backendName);
    const a = await citizen(entry, "Ada");
    const b = await citizen(entry, "Bola");
    await nearby(a, b);
    await entry.backend.store.flush();
    await formMarriage(a, b);
    const state = entry.backend.store.state;
    assert.equal(Object.values(state.marriages).filter((m) => m.status === "active").length, 1, "the marriage is recorded");
    const childCount = () => Object.values(state.people).filter((p) => p.family_role === "child").length;
    const before = childCount();

    const invalidName = { type: "family.childbirth", requestId: "s38-f2-a", name: "" };
    a.peer.send(invalidName);
    const badName = await a.peer.waitFor(childReply("s38-f2-a"), 20000);
    assert.equal(badName.code, "invalid_name", JSON.stringify(badName));
    assert.equal(childCount(), before, "a refused birth recorded no child");

    const birth = { type: "family.childbirth", requestId: "s38-f2-b", name: "Kemi" };
    entry.backend.store.failNextWrite("disk full");
    a.peer.send(birth);
    const failed = await a.peer.waitFor(childReply("s38-f2-b"), 20000);
    assert.equal(failed.type, "family.error", JSON.stringify(failed));
    assert.equal(failed.code, "family_not_saved", "a birth whose save failed is not confirmed");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(b.peer.messages.filter((m) => m.type === "family.childborn").length, 0, "the spouse heard nothing before or despite the failed save");

    a.peer.send(birth);
    const saved = await a.peer.waitFor(childReply("s38-f2-b"), 20000);
    assert.equal(saved.type, "family.childborn", JSON.stringify(saved));
    const notice = await b.peer.waitFor((m) => m.type === "family.childborn" && m.requestId === "s38-f2-b", 5000);
    assert.equal(notice.child.name, "Kemi");
    assert.equal(childCount(), before + 1, "one child is recorded");
    const stored = await durable(entry);
    assert.equal(Object.values(stored.people).filter((p) => p.family_role === "child" && p.name === "Kemi").length, 1, "one child is saved");

    a.peer.send(birth);
    const again = await a.peer.waitFor(childReply("s38-f2-b"), 20000);
    assert.equal(again.type, "command.duplicate", JSON.stringify(again));
    assert.equal(childCount(), before + 1, "a duplicate records no second child");
  });
}
