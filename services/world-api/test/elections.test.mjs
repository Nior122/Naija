/**
 * Stage 11 — Elections and Politics System tests
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { loadElectionsCatalog } from "../dist/elections/catalog.js";
import {
  initializeElectionWorldState,
  createPoliticalParty,
  registerPoliticalParty,
  joinPoliticalParty,
  leavePoliticalParty,
  createElection,
  advanceElectionPhase,
  registerCandidate,
  approveCandidate,
  rejectCandidate,
  withdrawCandidate,
  castBallot,
  countVotes,
  certifyElectionResult,
  publishElectionResult,
  transferElectedOffice,
  submitDispute,
  checkVoterEligibility,
  getPoliticalProfile,
  getCharacterPartyMembership,
  electionsErrorMessage,
} from "../dist/elections/service.js";
import { loadGovernmentCatalog } from "../dist/government/catalog.js";
import { seedGovernmentWorld, initializeGovernmentWorldState } from "../dist/government/service.js";

const activeServers = new Set();
const activeDirectories = new Set();

afterEach(async () => {
  for (const server of activeServers) { try { server.close(); } catch { /* ignore */ } }
  activeServers.clear();
  for (const directory of activeDirectories) { try { await rm(directory, { recursive: true, force: true }); } catch { /* ignore */ } }
  activeDirectories.clear();
});

function makeWorld() {
  return {
    state: {
      schemaVersion: 14,
      worldId: "nigeria-main",
      worldClock: { day: 1, minute_of_day: 0, millisecond_of_minute: 0, updated_at: new Date(0).toISOString(), world_date: { year: 2025, month: 1, day: 1 } },
      players: {},
      people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
      careerEmployers: {}, careerVacancies: {}, careerApplications: {}, employments: {}, workSessions: {},
      careerSkills: {}, careerLicenses: {}, careerReviews: {}, careerLeaveRequests: {}, careerEvents: {},
      salaryPayments: {}, npcCareers: {},
      accounts: {}, transactions: {}, loans: {}, loanPayments: {}, marketGoods: {}, creditScores: {}, economyEvents: {},
      businesses: {}, businessProducts: {}, businessInventory: {}, businessTransactions: {}, businessSales: {},
      businessProductionRuns: {}, businessEvents: {}, businessSnapshots: {},
      properties: {}, propertyOwnership: {}, propertyListings: {}, rentalAgreements: {}, rentalPayments: {},
      propertySales: {}, propertyMaintenance: {}, propertyFurnishings: {}, propertyEvents: {},
      governmentOrganisations: {}, governmentOffices: {}, governmentAppointments: {}, governmentBudgets: {},
      governmentRevenue: {}, governmentExpenditure: {}, governmentProjects: {}, governmentAnnouncements: {}, governmentEvents: {},
      politicalParties: {}, partyMemberships: {}, politicalProfiles: {}, elections: {}, candidates: {},
      campaigns: {}, campaignEvents: {}, campaignFinances: {}, debates: {}, ballots: {}, voterParticipation: {},
      electionDisputes: {}, electionAudits: {},
    },
    date: { year: 2025, month: 1, day: 1 },
    now: Date.UTC(2025, 0, 1),
  };
}

function addPlayer(world, name, age, stateId = "ng:state:fc") {
  const characterId = `char-${name.toLowerCase().replace(/\s/g, "-")}`;
  const playerId = `player-${characterId}`;
  world.state.players[playerId] = {
    playerId, tokenHash: "hash", creationKeyHash: "ckey", recentRequestIds: [],
    createdAt: new Date(world.now).toISOString(), lastSeen: new Date(world.now).toISOString(),
    character: {
      player_id: playerId, character_id: characterId, name, age, character_type: "androgynous",
      appearance: {}, money: 500000000, health: 100, energy: 100, hunger: 50,
      education_level: "secondary", school_id: "", home_id: "", current_location: "home",
      position: { x: 720, y: 540 }, direction: { x: 0, y: 1 }, inventory: [],
      academic_scores: {}, attendance: [],
      education_record: { enrollment_status: "graduated", school_id: null, class_id: null, year_id: null, term_id: null, subjects: [], assessments: [], results: [], exam_registrations: [], qualifications: [], applications: [], tertiary_enrollments: [], vocational_training: [], skills: [], scholarships: [], history: [], graduation_date: "2020-01-01", graduation_details: { program_id: null, qualification_id: null } },
      reputation: 50, household: {},
      geographic_location: stateId ? { world_id: "nigeria-main", region_id: "ng", country_id: "ng", state_id: stateId, lga_id: null, settlement_id: null, ward_id: null, latitude: 9.05, longitude: 7.49, local_position: { x: 0, y: 0 }, chunk_id: "chunk-0-0" } : null,
      date_of_birth: `UTC${2025 - age}-01-01T00:00:00.000Z`, age_days: age * 365, age_snapshot: age,
      life_stage: age >= 18 ? "adult" : "minor", life_status: "alive",
      household_id: null, family_id: null, processed_through_date: { year: 2025, month: 1, day: 1 },
      life_events: [], relationships: [], retirement_date: null, retirement_world_date: null,
      death_date: null, death_world_date: null,
      created_at: new Date(world.now).toISOString(), updated_at: new Date(world.now).toISOString(),
    },
  };
  return characterId;
}

function setupElectionWithCandidate(world, adminId, electionType = "presidential", jurisdictionId = null) {
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Test Party", "TP", "Desc", adminId, [], world.date, world.now, catalog);
  registerPoliticalParty(world.state, party.party_id, adminId, world.date, world.now);
  const election = createElection(world.state, electionType, jurisdictionId, null, adminId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z",
    "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z",
    world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "candidate_registration", adminId, world.date, world.now);
  const candidate = registerCandidate(world.state, election.election_id, adminId, party.party_id, null, world.date, world.now, catalog);
  approveCandidate(world.state, candidate.candidate_id, adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "screening", adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "campaign", adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "voting", adminId, world.date, world.now);
  return { election, candidate, party, catalog };
}

class TestPeer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else this.messages.push(message);
    });
  }
  send(message) { this.socket.send(JSON.stringify(message)); }
  waitFor(predicate, timeoutMs = 5000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => { this.waiters = this.waiters.filter((e) => e !== waiter); reject(new Error("Timed out waiting for a WebSocket result.")); }, timeoutMs) };
      this.waiters.push(waiter);
    });
  }
  waitForType(type, timeoutMs = 5000) { return this.waitFor((msg) => msg.type === type, timeoutMs); }
  waitForMessage(predicate, timeoutMs = 5000) { return this.waitFor(predicate, timeoutMs); }
  async close() {
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      else this.socket.terminate();
    });
  }
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-elections-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const server = createApiServer({ stateFile, allowedOrigins: ["http://localhost"] });
  activeServers.add(server);
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  const serverPort = typeof address === "object" && address ? address.port : 3000;
  return { server, serverPort, stateFile, directory };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function createOnlinePeer(serverPort) {
  const ws = new WebSocket(`ws://0.0.0.0:${serverPort}/ws`);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const peer = new TestPeer(ws);
  const creationKey = randomBytes(32).toString("hex");
  peer.send({ type: "identity.create", creationKey, profile: { name: "Elections Tester", age: 16, character_type: "androgynous", appearance: { skin_tone: "#9b654d", hairstyle: "Short", clothing_color: "#27734a" } } });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, created, ready };
}

// ─── Catalogue tests ──────────────────────────────────────────────

test("elections catalogue loads with all required sections", () => {
  const catalog = loadElectionsCatalog();
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.world_id, "nigeria-main");
  assert.ok(catalog.election_types.length >= 6);
  assert.ok(catalog.election_phases.length >= 10);
  assert.ok(typeof catalog.eligibility_rules === "object");
  assert.ok(typeof catalog.voter_eligibility === "object");
  assert.ok(typeof catalog.party_rules === "object");
  assert.ok(typeof catalog.campaign_rules === "object");
});

test("election types map to correct office definitions", () => {
  const catalog = loadElectionsCatalog();
  const presidential = catalog.election_types.find((t) => t.id === "presidential");
  assert.ok(presidential);
  assert.equal(presidential.level, "federal");
  assert.equal(presidential.office_definition_id, "office:president");
});

test("eligibility rules enforce correct minimum ages", () => {
  const catalog = loadElectionsCatalog();
  assert.equal(catalog.eligibility_rules.presidential.minimum_age, 40);
  assert.equal(catalog.eligibility_rules.governorship.minimum_age, 35);
  assert.equal(catalog.eligibility_rules.local_chairman.minimum_age, 30);
});

test("voter eligibility requires age 18+", () => {
  const catalog = loadElectionsCatalog();
  assert.equal(catalog.voter_eligibility.minimum_age, 18);
});

// ─── Party tests ──────────────────────────────────────────────────

test("createPoliticalParty creates a pending party with founder membership", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const charId = addPlayer(world, "Adebayo", 25);
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Unity Party", "UP", "A party for unity.", charId, ["education"], world.date, world.now, catalog);
  assert.ok(party.party_id.startsWith("party-"));
  assert.equal(party.name, "Unity Party");
  assert.equal(party.abbreviation, "UP");
  assert.equal(party.status, "pending_registration");
  const membership = getCharacterPartyMembership(world.state, charId);
  assert.ok(membership);
  assert.equal(membership.party_id, party.party_id);
  assert.equal(membership.role, "national_chairman");
});

test("party creation rejects underage founders", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const charId = addPlayer(world, "Young", 18);
  assert.throws(() => createPoliticalParty(world.state, "A Party For Unity", "APV", "Description here.", charId, [], world.date, world.now), /elections_party_founder_age_ineligible/);
});

test("registerPoliticalParty transitions status to active", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const charId = addPlayer(world, "Founder", 25);
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Test Party", "TP", "Desc", charId, [], world.date, world.now, catalog);
  const registered = registerPoliticalParty(world.state, party.party_id, charId, world.date, world.now);
  assert.equal(registered.status, "active");
});

test("joinPoliticalParty adds a member and rejects duplicates", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const founderId = addPlayer(world, "Founder", 25);
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Party", "PP", "Desc", founderId, [], world.date, world.now, catalog);
  registerPoliticalParty(world.state, party.party_id, founderId, world.date, world.now);
  const memberId = addPlayer(world, "Member", 22);
  const membership = joinPoliticalParty(world.state, party.party_id, memberId, world.date, world.now, catalog);
  assert.equal(membership.status, "active");
  assert.throws(() => joinPoliticalParty(world.state, party.party_id, memberId, world.date, world.now, catalog), /elections_already_in_party/);
});

test("leavePoliticalParty ends membership", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const founderId = addPlayer(world, "Founder", 25);
  const catalog = loadElectionsCatalog();
  createPoliticalParty(world.state, "Party", "PP", "Desc", founderId, [], world.date, world.now, catalog);
  const membership = getCharacterPartyMembership(world.state, founderId);
  assert.ok(membership);
  leavePoliticalParty(world.state, membership.membership_id, "Moving on.", world.date, world.now);
  const after = getCharacterPartyMembership(world.state, founderId);
  assert.equal(after, null);
});

// ─── Election tests ───────────────────────────────────────────────

test("createElection creates election with correct schedule", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const charId = addPlayer(world, "Creator", 40);
  const election = createElection(world.state, "governorship", "ng:state:la", null, charId,
    "2025-06-01T00:00:00Z", "2025-07-01T00:00:00Z", "2025-07-02T00:00:00Z", "2025-09-01T00:00:00Z",
    "2025-09-02T00:00:00Z", "2025-09-15T00:00:00Z", world.date, world.now);
  assert.ok(election.election_id.startsWith("election-"));
  assert.equal(election.election_type, "governorship");
  assert.equal(election.phase, "scheduling");
});

test("createElection rejects invalid schedule order", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const charId = addPlayer(world, "Creator", 40);
  assert.throws(() => createElection(world.state, "presidential", null, null, charId,
    "2025-07-01T00:00:00Z", "2025-06-01T00:00:00Z", "2025-08-01T00:00:00Z", "2025-09-01T00:00:00Z",
    "2025-09-02T00:00:00Z", "2025-09-15T00:00:00Z", world.date, world.now), /elections_schedule_invalid/);
});

test("advanceElectionPhase follows valid transitions and rejects invalid", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const charId = addPlayer(world, "Admin", 40);
  const election = createElection(world.state, "presidential", null, null, charId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", world.date, world.now);
  const updated = advanceElectionPhase(world.state, election.election_id, "candidate_registration", charId, world.date, world.now);
  assert.equal(updated.phase, "candidate_registration");
  assert.throws(() => advanceElectionPhase(world.state, election.election_id, "voting", charId, world.date, world.now), /elections_phase_transition_invalid/);
});

// ─── Candidate tests ──────────────────────────────────────────────

test("registerCandidate creates pending candidacy", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const adminId = addPlayer(world, "Admin", 40);
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Party", "PP", "Desc", adminId, [], world.date, world.now, catalog);
  registerPoliticalParty(world.state, party.party_id, adminId, world.date, world.now);
  const election = createElection(world.state, "governorship", "ng:state:fc", null, adminId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "candidate_registration", adminId, world.date, world.now);
  const candidate = registerCandidate(world.state, election.election_id, adminId, party.party_id, null, world.date, world.now, catalog);
  assert.equal(candidate.status, "pending");
});

test("registerCandidate rejects underage candidates", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const adminId = addPlayer(world, "Admin", 40);
  const youngId = addPlayer(world, "Young", 30);
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Party", "PP", "Desc", adminId, [], world.date, world.now, catalog);
  registerPoliticalParty(world.state, party.party_id, adminId, world.date, world.now);
  const election = createElection(world.state, "presidential", null, null, adminId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "candidate_registration", adminId, world.date, world.now);
  assert.throws(() => registerCandidate(world.state, election.election_id, youngId, party.party_id, null, world.date, world.now, catalog), /elections_candidate_age_ineligible/);
});

test("approveCandidate and withdrawCandidate work correctly", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const adminId = addPlayer(world, "Admin", 40);
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Party", "PP", "Desc", adminId, [], world.date, world.now, catalog);
  registerPoliticalParty(world.state, party.party_id, adminId, world.date, world.now);
  const election = createElection(world.state, "governorship", "ng:state:fc", null, adminId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "candidate_registration", adminId, world.date, world.now);
  const candidate = registerCandidate(world.state, election.election_id, adminId, party.party_id, null, world.date, world.now, catalog);
  const approved = approveCandidate(world.state, candidate.candidate_id, adminId, world.date, world.now);
  assert.equal(approved.status, "approved");
  const withdrawn = withdrawCandidate(world.state, candidate.candidate_id, world.date, world.now);
  assert.equal(withdrawn.status, "withdrawn");
});

// ─── Voting tests ─────────────────────────────────────────────────

test("checkVoterEligibility validates age and election phase", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const adminId = addPlayer(world, "Admin", 40);
  const minorId = addPlayer(world, "Minor", 15);
  const election = createElection(world.state, "presidential", null, null, adminId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", world.date, world.now);
  assert.equal(checkVoterEligibility(world.state, election.election_id, adminId).eligible, false);
  // Advance to voting
  advanceElectionPhase(world.state, election.election_id, "candidate_registration", adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "screening", adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "campaign", adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "voting", adminId, world.date, world.now);
  assert.equal(checkVoterEligibility(world.state, election.election_id, minorId).eligible, false);
  assert.equal(checkVoterEligibility(world.state, election.election_id, adminId).eligible, true);
});

test("castBallot prevents duplicate voting", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const adminId = addPlayer(world, "Admin", 40);
  const { election, candidate } = setupElectionWithCandidate(world, adminId);
  const voterId = addPlayer(world, "Voter", 25);
  const result = castBallot(world.state, election.election_id, voterId, candidate.candidate_id, world.date, world.now);
  assert.ok(result.ballot.ballot_id);
  assert.throws(() => castBallot(world.state, election.election_id, voterId, candidate.candidate_id, world.date, world.now), /elections_already_voted/);
});

// ─── Vote counting and results ────────────────────────────────────

test("countVotes tallies ballots and identifies winner", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const adminId = addPlayer(world, "Admin", 40);
  const catalog = loadElectionsCatalog();
  const party = createPoliticalParty(world.state, "Party", "PP", "Desc", adminId, [], world.date, world.now, catalog);
  registerPoliticalParty(world.state, party.party_id, adminId, world.date, world.now);
  const charId2 = addPlayer(world, "Candidate2", 42);
  joinPoliticalParty(world.state, party.party_id, charId2, world.date, world.now, catalog);
  const election = createElection(world.state, "presidential", null, null, adminId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "candidate_registration", adminId, world.date, world.now);
  const c1 = registerCandidate(world.state, election.election_id, adminId, party.party_id, null, world.date, world.now, catalog);
  const c2 = registerCandidate(world.state, election.election_id, charId2, party.party_id, null, world.date, world.now, catalog);
  approveCandidate(world.state, c1.candidate_id, adminId, world.date, world.now);
  approveCandidate(world.state, c2.candidate_id, adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "screening", adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "campaign", adminId, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "voting", adminId, world.date, world.now);
  // 3 votes for c1, 1 for c2
  for (let i = 0; i < 3; i++) {
    const v = addPlayer(world, `V${i}`, 25 + i);
    castBallot(world.state, election.election_id, v, c1.candidate_id, world.date, world.now);
  }
  const v4 = addPlayer(world, "V4", 30);
  castBallot(world.state, election.election_id, v4, c2.candidate_id, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "counting", adminId, world.date, world.now);
  const result = countVotes(world.state, election.election_id, world.date, world.now);
  assert.equal(result.total_valid_votes, 4);
  assert.equal(result.winner_character_id, adminId);
  assert.equal(result.is_tie, false);
  assert.equal(result.status, "preliminary");
});

test("certify and publish election results", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const adminId = addPlayer(world, "Admin", 40);
  const { election, candidate } = setupElectionWithCandidate(world, adminId);
  const voterId = addPlayer(world, "Voter", 25);
  castBallot(world.state, election.election_id, voterId, candidate.candidate_id, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "counting", adminId, world.date, world.now);
  countVotes(world.state, election.election_id, world.date, world.now);
  const certified = certifyElectionResult(world.state, election.election_id, adminId, world.date, world.now);
  assert.equal(certified.status, "certified");
  const published = publishElectionResult(world.state, election.election_id, adminId, world.date, world.now);
  assert.equal(published.status, "published");
});

// ─── Government integration ───────────────────────────────────────

test("transferElectedOffice assigns winner to correct government office", () => {
  const world = makeWorld();
  initializeGovernmentWorldState(world.state);
  initializeElectionWorldState(world.state);
  const govCatalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, govCatalog);
  const winnerId = addPlayer(world, "Winner", 42);
  const { election, candidate } = setupElectionWithCandidate(world, winnerId);
  const voterId = addPlayer(world, "Voter", 25);
  castBallot(world.state, election.election_id, voterId, candidate.candidate_id, world.date, world.now);
  advanceElectionPhase(world.state, election.election_id, "counting", winnerId, world.date, world.now);
  countVotes(world.state, election.election_id, world.date, world.now);
  certifyElectionResult(world.state, election.election_id, winnerId, world.date, world.now);
  publishElectionResult(world.state, election.election_id, winnerId, world.date, world.now);
  const appointment = transferElectedOffice(world.state, election.election_id, world.date, world.now);
  assert.equal(appointment.character_id, winnerId);
  assert.equal(appointment.status, "active");
  assert.ok(appointment.appointed_by.startsWith("election:"));
});

// ─── Disputes ─────────────────────────────────────────────────────

test("submitDispute creates a dispute record", () => {
  const world = makeWorld();
  initializeElectionWorldState(world.state);
  const charId = addPlayer(world, "Complainant", 30);
  const election = createElection(world.state, "presidential", null, null, charId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z", "2025-04-01T00:00:00Z",
    "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", world.date, world.now);
  const dispute = submitDispute(world.state, election.election_id, charId, "irregularity", "Vote counting issue.", [], world.date, world.now);
  assert.ok(dispute.dispute_id.startsWith("disp-"));
  assert.equal(dispute.status, "submitted");
});

// ─── WebSocket tests ──────────────────────────────────────────────

test("election list_parties and view_election work through WebSocket", async () => {
  const { serverPort, server } = await startServer();
  try {
    const { peer, ready } = await createOnlinePeer(serverPort);
    await delay(500);
    peer.messages.length = 0;
    peer.send({ type: "election.action", action: "list_parties", requestId: "elec-1" });
    const partiesResult = await peer.waitFor((m) => m.type === "election.result" && m.action === "list_parties");
    assert.ok(partiesResult.ok);
    assert.ok(Array.isArray(partiesResult.data.parties));
    peer.send({ type: "election.action", action: "list_elections", requestId: "elec-2" });
    const electionsResult = await peer.waitFor((m) => m.type === "election.result" && m.action === "list_elections");
    assert.ok(electionsResult.ok);
    assert.ok(Array.isArray(electionsResult.data.elections));
    peer.send({ type: "election.action", action: "political_profile", requestId: "elec-3" });
    const profileResult = await peer.waitFor((m) => m.type === "election.result" && m.action === "political_profile");
    assert.ok(profileResult.ok);
    await peer.close();
  } finally { server.close(); }
});

test("election my_history works through WebSocket", async () => {
  const { serverPort, server } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    await delay(500);
    peer.messages.length = 0;
    peer.send({ type: "election.action", action: "my_history", requestId: "elec-hist-1" });
    const result = await peer.waitFor((m) => m.type === "election.result" && m.action === "my_history");
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.data.history));
    await peer.close();
  } finally { server.close(); }
});

// ─── Schema migration ─────────────────────────────────────────────

test("schema version 8 state migrates to version 10 with empty justice and police maps", async () => {
  const { serverPort, stateFile, server } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    await delay(500);
    await peer.close();
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(saved.schemaVersion, 16);
    saved.schemaVersion = 8;
  delete saved.laws; delete saved.lawProvisions; delete saved.legislativeProposals;
  delete saved.courts; delete saved.legalProfessionals; delete saved.legalRepresentations;
  delete saved.cases; delete saved.caseParticipants; delete saved.evidence;
  delete saved.witnesses; delete saved.hearings; delete saved.judgments;
  delete saved.sentences; delete saved.fines; delete saved.settlements;
  delete saved.appeals; delete saved.legalAudits;
  delete saved.policeUnits; delete saved.policeOfficers; delete saved.recruitmentApplications;
  delete saved.policeIncidents; delete saved.dispatches; delete saved.investigations;
  delete saved.policeEvidence; delete saved.wantedRecords; delete saved.arrestRecords;
  delete saved.misconductComplaints; delete saved.policeAudits;
  delete saved.militaryOrganizations; delete saved.militaryBases; delete saved.militaryUnits;
  delete saved.militaryRecruitments; delete saved.militaryServiceRecords; delete saved.militaryTrainingRecords;
  delete saved.militaryRankHistory; delete saved.militaryCommandAppointments; delete saved.militaryAssignments;
  delete saved.militaryLeaveRecords; delete saved.militaryAssets; delete saved.nationalSecurityEvents;
  delete saved.militaryDisciplinaryRecords; delete saved.militaryAudits;
  delete saved.crimeIncidents; delete saved.crimeParticipations; delete saved.crimeEvidence;
  delete saved.crimeReports; delete saved.criminalRecords; delete saved.crimeNotoriety;
  delete saved.crimeRestitution; delete saved.crimeRehabilitation; delete saved.crimeAudits;
  delete saved.communities; delete saved.communityMemberships; delete saved.institutions;
  delete saved.institutionMemberships; delete saved.culturalProfiles; delete saved.communityEvents;
  delete saved.communityProjects; delete saved.communityAnnouncements; delete saved.communityReputation;
  delete saved.communityDisputes; delete saved.communityContributions; delete saved.communityAudits;
  delete saved.entertainmentProfiles; delete saved.musicProjects; delete saved.filmProjects;
  delete saved.contentRecords; delete saved.entertainmentEvents; delete saved.entertainmentContracts;
  delete saved.newsReports; delete saved.controversies; delete saved.contentModeration;
  delete saved.entertainmentCollaborations; delete saved.entertainmentAudits;
  delete saved.socialProfiles; delete saved.socialFollows; delete saved.socialFollowRequests;
  delete saved.socialPosts; delete saved.socialComments; delete saved.socialReactions;
  delete saved.socialHashtags; delete saved.socialPostHashtags; delete saved.socialNotifications;
  delete saved.socialBlocks; delete saved.socialMutes; delete saved.socialReports;
  delete saved.socialAdCampaigns; delete saved.socialTrendingTopics; delete saved.socialAudits;
    await writeFile(stateFile, JSON.stringify(saved), "utf8");
    const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
    assert.equal(migrated.state.schemaVersion, 16);
    assert.ok(typeof migrated.state.laws === "object");
    assert.ok(typeof migrated.state.courts === "object");
    assert.ok(typeof migrated.state.cases === "object");
    assert.ok(typeof migrated.state.policeUnits === "object");
  } finally { server.close(); }
});

// ─── Error messages ───────────────────────────────────────────────

test("electionsErrorMessage returns readable messages", () => {
  assert.equal(electionsErrorMessage("elections_election_not_found"), "Election not found.");
  assert.equal(electionsErrorMessage("elections_already_voted"), "Voter has already cast a ballot in this election.");
  assert.equal(electionsErrorMessage("elections_candidate_age_ineligible"), "Character does not meet minimum age requirement.");
});
