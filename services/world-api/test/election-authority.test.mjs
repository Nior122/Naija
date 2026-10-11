// Election authority (Stage 28 rules E-2 and E-4).
//
// E-2: a candidate may not approve their own candidacy, certify an election result, or publish one, and no one may
// approve their own candidacy. E-4: a certified result transfers office once, and a second transfer is refused without
// changing any appointment.
//
// Election writes are suspended at the engine (see government-authorization.test.mjs and STAGE_28_GOVERNMENT_AUTHORIZATION.md).
// These tests therefore call the trusted service functions on an in-memory state. They prove the rules hold in the
// service layer, so that a future route cannot bypass them. They do not open any election route, and they do not decide
// who the electoral authority is (rule E-1 is still an owner decision).
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadElectionsCatalog } from "../dist/elections/catalog.js";
import {
  advanceElectionPhase,
  approveCandidate,
  castBallot,
  certifyElectionResult,
  countVotes,
  createElection,
  createPoliticalParty,
  initializeElectionWorldState,
  joinPoliticalParty,
  publishElectionResult,
  registerCandidate,
  registerPoliticalParty,
  transferElectedOffice,
  withdrawCandidate,
} from "../dist/elections/service.js";
import { initializeGovernmentWorldState, seedGovernmentWorld } from "../dist/government/service.js";

const DATE = { year: 2026, month: 10, day: 11 };
const NOW = Date.UTC(2026, 9, 11);

function makeWorld() {
  const state = {
    schemaVersion: 14,
    worldClock: { day: 1, minute_of_day: 0, millisecond_of_minute: 0, updated_at: new Date(NOW).toISOString(), world_date: { ...DATE } },
    players: {},
    politicalParties: {}, partyMemberships: {}, politicalProfiles: {}, elections: {}, candidates: {},
    campaigns: {}, campaignEvents: {}, campaignFinances: {}, debates: {}, ballots: {}, voterParticipation: {},
    electionDisputes: {}, electionAudits: {},
  };
  initializeGovernmentWorldState(state);
  initializeElectionWorldState(state);
  seedGovernmentWorld(state, DATE, NOW);
  return state;
}

function addCitizen(state, name, age = 45) {
  const characterId = `char-${name.toLowerCase()}`;
  const playerId = `player-${characterId}`;
  state.players[playerId] = {
    playerId, tokenHash: "hash", creationKeyHash: "ckey", recentRequestIds: [],
    createdAt: new Date(NOW).toISOString(), lastSeen: new Date(NOW).toISOString(),
    character: {
      character_id: characterId, name, age, life_status: "alive", character_type: "androgynous",
      geographic_location: { world_id: "nigeria-main", region_id: "ng", country_id: "ng", state_id: "ng:state:fc", lga_id: null, settlement_id: null, ward_id: null, latitude: 9.05, longitude: 7.49, local_position: { x: 0, y: 0 }, chunk_id: "chunk-0-0" },
      date_of_birth: `UTC${DATE.year - age}-01-01T00:00:00.000Z`, age_days: age * 365, age_snapshot: age,
    },
  };
  return characterId;
}

/**
 * A presidential election in the voting phase with one approved nominee, a separate administrator who approved the
 * nominee, and one voter who voted for the nominee. The nominee is a citizen, never the administrator (E-2).
 */
function votingElection(state, { administrator, nominee }) {
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(state, "Test Party", "TP", "Desc", administrator, [], DATE, NOW, catalog);
  registerPoliticalParty(state, party.party_id, administrator, DATE, NOW);
  joinPoliticalParty(state, party.party_id, nominee, DATE, NOW, catalog);
  const election = createElection(state, "presidential", null, null, administrator,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", DATE, NOW);
  advanceElectionPhase(state, election.election_id, "candidate_registration", administrator, DATE, NOW);
  const candidate = registerCandidate(state, election.election_id, nominee, party.party_id, null, DATE, NOW, catalog);
  approveCandidate(state, candidate.candidate_id, administrator, DATE, NOW);
  advanceElectionPhase(state, election.election_id, "screening", administrator, DATE, NOW);
  advanceElectionPhase(state, election.election_id, "campaign", administrator, DATE, NOW);
  advanceElectionPhase(state, election.election_id, "voting", administrator, DATE, NOW);
  const voter = addCitizen(state, "Voter", 30);
  castBallot(state, election.election_id, voter, candidate.candidate_id, DATE, NOW);
  advanceElectionPhase(state, election.election_id, "counting", administrator, DATE, NOW);
  countVotes(state, election.election_id, DATE, NOW);
  return { election, candidate };
}

test("E-2: no one approves their own candidacy; the administrator's approval of the nominee is accepted", () => {
  const state = makeWorld();
  const administrator = addCitizen(state, "Administrator");
  const nominee = addCitizen(state, "Nominee");
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(state, "Test Party", "TP", "Desc", administrator, [], DATE, NOW, catalog);
  registerPoliticalParty(state, party.party_id, administrator, DATE, NOW);
  joinPoliticalParty(state, party.party_id, nominee, DATE, NOW, catalog);
  const election = createElection(state, "presidential", null, null, administrator,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", DATE, NOW);
  advanceElectionPhase(state, election.election_id, "candidate_registration", administrator, DATE, NOW);
  const candidate = registerCandidate(state, election.election_id, nominee, party.party_id, null, DATE, NOW, catalog);

  assert.throws(() => approveCandidate(state, candidate.candidate_id, nominee, DATE, NOW), /elections_self_approval_refused/,
    "the nominee cannot approve their own candidacy");
  assert.equal(state.candidates[candidate.candidate_id].status, "pending", "the candidacy is still pending");

  const approved = approveCandidate(state, candidate.candidate_id, administrator, DATE, NOW);
  assert.equal(approved.status, "approved", "the administrator, who is not the nominee, may approve");
});

test("E-2: a candidate cannot certify or publish the result of the election they stand in", () => {
  const state = makeWorld();
  const administrator = addCitizen(state, "Administrator");
  const nominee = addCitizen(state, "Nominee");
  const { election } = votingElection(state, { administrator, nominee });
  const electionId = election.election_id;

  assert.throws(() => certifyElectionResult(state, electionId, nominee, DATE, NOW), /elections_self_certification_refused/);
  assert.equal(state.elections[electionId].results.status, "preliminary", "a refused certification changes nothing");
  assert.throws(() => publishElectionResult(state, electionId, nominee, DATE, NOW), /elections_self_certification_refused/);
  assert.equal(state.elections[electionId].results.status, "preliminary", "a refused publication changes nothing");
  assert.equal(Object.values(state.governmentAppointments).length, 0, "no office is transferred by a refused certification");

  // Positive control: the non-candidate administrator certifies and publishes.
  assert.equal(certifyElectionResult(state, electionId, administrator, DATE, NOW).status, "certified");
  assert.equal(publishElectionResult(state, electionId, administrator, DATE, NOW).status, "published");
});

test("E-2: a candidate who withdrew is still excluded from administering that election", () => {
  const state = makeWorld();
  const administrator = addCitizen(state, "Administrator");
  const nominee = addCitizen(state, "Nominee");
  const { election, candidate } = votingElection(state, { administrator, nominee });
  withdrawCandidate(state, candidate.candidate_id, DATE, NOW);
  assert.throws(() => certifyElectionResult(state, election.election_id, nominee, DATE, NOW), /elections_self_certification_refused/,
    "a withdrawn candidacy still bars certification of that election");
});

test("E-4: a certified result transfers office once; a second transfer is refused and changes no appointment", () => {
  const state = makeWorld();
  const administrator = addCitizen(state, "Administrator");
  const nominee = addCitizen(state, "Nominee");
  const { election, candidate } = votingElection(state, { administrator, nominee });
  certifyElectionResult(state, election.election_id, administrator, DATE, NOW);
  publishElectionResult(state, election.election_id, administrator, DATE, NOW);

  const first = transferElectedOffice(state, election.election_id, DATE, NOW);
  assert.equal(first.character_id, candidate.character_id, "the winning candidate takes office");
  const appointmentsAfterFirst = JSON.stringify(state.governmentAppointments);

  assert.throws(() => transferElectedOffice(state, election.election_id, DATE, NOW), /elections_office_already_transferred/,
    "the same certified result cannot transfer office again");
  assert.equal(JSON.stringify(state.governmentAppointments), appointmentsAfterFirst, "the second request changes no appointment");
  const transfers = Object.values(state.governmentAppointments).filter((a) => a.appointed_by === `election:${election.election_id}`);
  assert.equal(transfers.length, 1, "exactly one appointment is linked to the election");
});
