/**
 * Stage 12 — Laws, Courts and Justice System tests
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
import { loadJusticeCatalog } from "../dist/justice/catalog.js";
import {
  initializeJusticeWorldState,
  seedJusticeWorld,
  createLaw,
  updateLawStatus,
  amendLaw,
  addLawProvision,
  getActiveLaws,
  searchLaws,
  createLegislativeProposal,
  submitProposal,
  approveProposal,
  rejectProposal,
  getCourt,
  listCourts,
  appointLegalProfessional,
  fileCase,
  advanceCaseStatus,
  getCase,
  getCharacterCases,
  submitEvidence,
  issueJudgment,
  createFine,
  payFine,
  getCharacterFines,
  fileAppeal,
  decideAppeal,
  getLegalProfile,
  justiceErrorMessage,
} from "../dist/justice/service.js";

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
      players: {}, people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
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
      laws: {}, lawProvisions: {}, legislativeProposals: {}, courts: {},
      legalProfessionals: {}, legalRepresentations: {}, cases: {},
      caseParticipants: {}, evidence: {}, witnesses: {}, hearings: {},
      judgments: {}, sentences: {}, fines: {}, settlements: {}, appeals: {},
      legalAudits: {},
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

class TestPeer {
  constructor(socket) {
    this.socket = socket; this.messages = []; this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const index = this.waiters.findIndex((w) => w.predicate(message));
      if (index >= 0) { const [w] = this.waiters.splice(index, 1); clearTimeout(w.timer); w.resolve(message); }
      else this.messages.push(message);
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
  async close() { return new Promise((resolve) => { this.socket.once("close", () => resolve()); if (this.socket.readyState === WebSocket.OPEN) this.socket.close(); else this.socket.terminate(); }); }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-justice-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const server = createApiServer({ stateFile, allowedOrigins: ["http://localhost"] });
  activeServers.add(server);
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  const serverPort = typeof address === "object" && address ? address.port : 3000;
  return { server, serverPort, stateFile, directory };
}

async function createOnlinePeer(serverPort) {
  const ws = new WebSocket(`ws://0.0.0.0:${serverPort}/ws`);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const peer = new TestPeer(ws);
  const creationKey = randomBytes(32).toString("hex");
  peer.send({ type: "identity.create", creationKey, profile: { name: "Justice Tester", age: 16, character_type: "androgynous", appearance: { skin_tone: "#9b654d", hairstyle: "Short", clothing_color: "#27734a" } } });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, created, ready };
}

// ─── Catalogue tests ──────────────────────────────────────────────

test("justice catalogue loads with all required sections", () => {
  const catalog = loadJusticeCatalog();
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.world_id, "nigeria-main");
  assert.ok(catalog.law_categories.length >= 10);
  assert.ok(catalog.court_levels.length >= 6);
  assert.ok(catalog.case_categories.length >= 8);
  assert.ok(catalog.seed_laws.length >= 3);
  assert.ok(catalog.seed_courts.length >= 3);
});

test("seed_laws include constitution and criminal code", () => {
  const catalog = loadJusticeCatalog();
  const constitution = catalog.seed_laws.find((l) => l.id === "law:constitution-1999");
  assert.ok(constitution);
  assert.equal(constitution.category, "constitutional");
  assert.equal(constitution.status, "in_force");
  assert.ok(constitution.provisions.length > 5);
});

// ─── Seed tests ───────────────────────────────────────────────────

test("seedJusticeWorld creates laws, provisions, and courts", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  const result = seedJusticeWorld(world.state, world.date, world.now, catalog);
  assert.ok(result.laws >= 3);
  assert.ok(result.courts >= 3);
  assert.ok(Object.keys(world.state.laws).length >= 3);
  assert.ok(Object.keys(world.state.courts).length >= 3);
  assert.ok(Object.keys(world.state.lawProvisions).length > 10);
});

// ─── Law tests ────────────────────────────────────────────────────

test("createLaw creates a law in draft status", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const charId = addPlayer(world, "Creator", 40);
  const catalog = loadJusticeCatalog();
  const law = createLaw(world.state, "Test Law", "TL", "A test law.", "civil", "federal", null, "Test explanation.", "2025-01-01", "2025-01-01", charId, world.date, world.now, catalog);
  assert.ok(law.law_id.startsWith("law-"));
  assert.equal(law.status, "draft");
  assert.equal(law.title, "Test Law");
});

test("updateLawStatus follows valid transitions", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const charId = addPlayer(world, "Creator", 40);
  const catalog = loadJusticeCatalog();
  const law = createLaw(world.state, "Test Law", "TL", "A test law.", "civil", "federal", null, "Test explanation.", "2025-01-01", "2025-01-01", charId, world.date, world.now, catalog);
  updateLawStatus(world.state, law.law_id, "proposed", charId, world.date, world.now);
  assert.equal(world.state.laws[law.law_id].status, "proposed");
  // Invalid transition
  assert.throws(() => updateLawStatus(world.state, law.law_id, "in_force", charId, world.date, world.now), /justice_law_status_transition_invalid/);
});

test("amendLaw creates new version and marks old as amended", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const charId = addPlayer(world, "Creator", 40);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const constitution = world.state.laws["law:constitution-1999"];
  assert.ok(constitution);
  const amended = amendLaw(world.state, constitution.law_id, "Constitution (Amended)", null, null, charId, world.date, world.now);
  assert.equal(amended.version, 2);
  assert.equal(amended.parent_law_id, constitution.law_id);
  assert.equal(constitution.status, "amended");
});

test("searchLaws filters by query and category", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const results = searchLaws(world.state, "constitution");
  assert.ok(results.length >= 1);
  const civilResults = searchLaws(world.state, undefined, "civil");
  assert.ok(civilResults.every((l) => l.category === "civil"));
});

// ─── Legislative proposal tests ───────────────────────────────────

test("createLegislativeProposal and approveProposal creates a law", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const charId = addPlayer(world, "Sponsor", 30);
  const catalog = loadJusticeCatalog();
  const proposal = createLegislativeProposal(world.state, "Test Bill", "A test bill.", "Testing.", charId, "federal", null, [{ section: "1", title: "Purpose", description: "Testing." }], "Supporting.", world.date, world.now, catalog);
  assert.equal(proposal.status, "draft");
  submitProposal(world.state, proposal.proposal_id, charId, world.date, world.now);
  assert.equal(world.state.legislativeProposals[proposal.proposal_id].status, "submitted");
  const adminId = addPlayer(world, "Admin", 40);
  const { law } = approveProposal(world.state, proposal.proposal_id, adminId, "Approved.", world.date, world.now);
  assert.ok(law.law_id.startsWith("law-"));
  assert.equal(law.status, "enacted");
});

test("rejectProposal rejects a pending proposal", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const charId = addPlayer(world, "Sponsor", 30);
  const catalog = loadJusticeCatalog();
  const proposal = createLegislativeProposal(world.state, "Bill", "Desc.", "Purpose.", charId, "federal", null, [], "Supporting.", world.date, world.now, catalog);
  submitProposal(world.state, proposal.proposal_id, charId, world.date, world.now);
  const adminId = addPlayer(world, "Admin", 40);
  rejectProposal(world.state, proposal.proposal_id, adminId, "Not suitable.", world.date, world.now);
  assert.equal(world.state.legislativeProposals[proposal.proposal_id].status, "rejected");
});

// ─── Court tests ──────────────────────────────────────────────────

test("listCourts returns seeded courts", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const courts = listCourts(world.state);
  assert.ok(courts.length >= 3);
  assert.ok(courts.every((c) => c.status === "active"));
});

test("getCourt returns court details", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const supreme = getCourt(world.state, "court:supreme");
  assert.ok(supreme);
  assert.equal(supreme.level, "supreme");
});

// ─── Case tests ───────────────────────────────────────────────────

test("fileCase creates a case with proper status", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const claimantId = addPlayer(world, "Claimant", 30);
  const respondentId = addPlayer(world, "Respondent", 28);
  const caseRec = fileCase(world.state, "contract_dispute", "court:state-high-fct", claimantId, respondentId, "Breach of contract.", "Full description.", [], null, world.date, world.now, catalog);
  assert.ok(caseRec.case_id.startsWith("case-"));
  assert.equal(caseRec.status, "submitted");
  assert.equal(caseRec.case_type, "civil");
});

test("fileCase rejects filing by underage character", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const youngId = addPlayer(world, "Young", 15);
  assert.throws(() => fileCase(world.state, "contract_dispute", "court:state-high-fct", youngId, null, "Summary.", "Desc.", [], null, world.date, world.now, catalog), /justice_age_ineligible/);
});

test("advanceCaseStatus follows valid transitions", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const claimantId = addPlayer(world, "Claimant", 30);
  const caseRec = fileCase(world.state, "civil_general", "court:state-high-fct", claimantId, null, "Summary.", "Desc.", [], null, world.date, world.now, catalog);
  advanceCaseStatus(world.state, caseRec.case_id, "accepted", claimantId, world.date, world.now);
  assert.equal(world.state.cases[caseRec.case_id].status, "accepted");
  // Invalid transition
  assert.throws(() => advanceCaseStatus(world.state, caseRec.case_id, "judgment_issued", claimantId, world.date, world.now), /justice_case_status_transition_invalid/);
});

test("getCharacterCases returns cases for a character", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const claimantId = addPlayer(world, "Claimant", 30);
  fileCase(world.state, "civil_general", "court:state-high-fct", claimantId, null, "Summary.", "Desc.", [], null, world.date, world.now, catalog);
  const cases = getCharacterCases(world.state, claimantId);
  assert.ok(cases.length >= 1);
});

// ─── Evidence tests ───────────────────────────────────────────────

test("submitEvidence creates an evidence record", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const claimantId = addPlayer(world, "Claimant", 30);
  const caseRec = fileCase(world.state, "civil_general", "court:state-high-fct", claimantId, null, "Summary.", "Desc.", [], null, world.date, world.now, catalog);
  const evidence = submitEvidence(world.state, caseRec.case_id, "document", "Contract agreement.", claimantId, null, world.date, world.now, catalog);
  assert.ok(evidence.evidence_id.startsWith("ev-"));
  assert.equal(evidence.verification_status, "unverified");
});

// ─── Judgment tests ───────────────────────────────────────────────

test("issueJudgment issues a judgment for a case awaiting judgment", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const claimantId = addPlayer(world, "Claimant", 30);
  const judgeId = addPlayer(world, "Judge", 45);
  const caseRec = fileCase(world.state, "civil_general", "court:state-high-fct", claimantId, null, "Summary.", "Desc.", [], null, world.date, world.now, catalog);
  // Assign judge to court
  world.state.courts["court:state-high-fct"].assigned_judge_ids = [judgeId];
  // Advance case to awaiting_judgment
  advanceCaseStatus(world.state, caseRec.case_id, "accepted", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "pretrial", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "awaiting_hearing", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "in_hearing", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "awaiting_judgment", claimantId, world.date, world.now);
  const judgment = issueJudgment(world.state, caseRec.case_id, judgeId, "civil_remedy", "Found in favor of claimant.", "Reasoning text.", [{ type: "compensation", description: "Pay claimant.", amount_ngn: 100000 }], true, world.date, world.now, catalog);
  assert.ok(judgment.judgment_id.startsWith("jdg-"));
  assert.equal(judgment.outcome, "civil_remedy");
  assert.equal(world.state.cases[caseRec.case_id].status, "judgment_issued");
});

// ─── Fine tests ───────────────────────────────────────────────────

test("createFine and payFine work correctly", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const charId = addPlayer(world, "Offender", 30);
  const fine = createFine(world.state, "case-1", "jdg-1", "sent-1", charId, 500000, "2025-06-01", world.date, world.now);
  assert.ok(fine.fine_id.startsWith("fine-"));
  assert.equal(fine.amount_outstanding_ngn, 500000);
  payFine(world.state, fine.fine_id, 300000, "tx-1", world.date, world.now);
  assert.equal(world.state.fines[fine.fine_id].amount_paid_ngn, 300000);
  assert.equal(world.state.fines[fine.fine_id].status, "partially_paid");
  payFine(world.state, fine.fine_id, 200000, "tx-2", world.date, world.now);
  assert.equal(world.state.fines[fine.fine_id].status, "paid");
  // Already paid — further payments throw
  assert.throws(() => payFine(world.state, fine.fine_id, 200000, "tx-3", world.date, world.now), /justice_fine_already_paid/);
});

// ─── Appeal tests ─────────────────────────────────────────────────

test("fileAppeal and decideAppeal work correctly", () => {
  const world = makeWorld();
  initializeJusticeWorldState(world.state);
  const catalog = loadJusticeCatalog();
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  const claimantId = addPlayer(world, "Claimant", 30);
  const judgeId = addPlayer(world, "Judge", 45);
  const caseRec = fileCase(world.state, "civil_general", "court:state-high-fct", claimantId, null, "Summary.", "Desc.", [], null, world.date, world.now, catalog);
  world.state.courts["court:state-high-fct"].assigned_judge_ids = [judgeId];
  advanceCaseStatus(world.state, caseRec.case_id, "accepted", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "pretrial", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "awaiting_hearing", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "in_hearing", claimantId, world.date, world.now);
  advanceCaseStatus(world.state, caseRec.case_id, "awaiting_judgment", claimantId, world.date, world.now);
  const judgment = issueJudgment(world.state, caseRec.case_id, judgeId, "dismissal", "Case dismissed.", "Reasoning.", [], true, world.date, world.now, catalog);
  const appeal = fileAppeal(world.state, caseRec.case_id, judgment.judgment_id, claimantId, "Wrongful dismissal.", "court:appeal-federal", world.date, world.now, catalog);
  assert.ok(appeal.appeal_id.startsWith("app-"));
  assert.equal(appeal.status, "filed");
  const decided = decideAppeal(world.state, appeal.appeal_id, "affirmed", "Judgment affirmed on review.", judgeId, world.date, world.now);
  assert.equal(decided.outcome, "affirmed");
  assert.equal(world.state.judgments[judgment.judgment_id].status, "affirmed");
});

// ─── WebSocket tests ──────────────────────────────────────────────

test("justice search_laws and list_courts work through WebSocket", async () => {
  const { serverPort, server } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    await delay(500);
    peer.messages.length = 0;
    peer.send({ type: "justice.action", action: "search_laws", requestId: "j-1" });
    const result = await peer.waitFor((m) => m.type === "justice.result" && m.action === "search_laws");
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.data.laws));
    peer.send({ type: "justice.action", action: "list_courts", requestId: "j-2" });
    const courtsResult = await peer.waitFor((m) => m.type === "justice.result" && m.action === "list_courts");
    assert.ok(courtsResult.ok);
    assert.ok(Array.isArray(courtsResult.data.courts));
    await peer.close();
  } finally { server.close(); }
});

test("justice legal_profile and my_cases work through WebSocket", async () => {
  const { serverPort, server } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    await delay(500);
    peer.messages.length = 0;
    peer.send({ type: "justice.action", action: "legal_profile", requestId: "j-lp" });
    const profileResult = await peer.waitFor((m) => m.type === "justice.result" && m.action === "legal_profile");
    assert.ok(profileResult.ok);
    peer.send({ type: "justice.action", action: "my_cases", requestId: "j-mc" });
    const casesResult = await peer.waitFor((m) => m.type === "justice.result" && m.action === "my_cases");
    assert.ok(casesResult.ok);
    assert.ok(Array.isArray(casesResult.data.cases));
    await peer.close();
  } finally { server.close(); }
});

// ─── Schema migration test ────────────────────────────────────────

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

test("justiceErrorMessage returns readable messages", () => {
  assert.equal(justiceErrorMessage("justice_law_not_found"), "Law not found.");
  assert.equal(justiceErrorMessage("justice_case_not_found"), "Case not found.");
  assert.equal(justiceErrorMessage("justice_age_ineligible"), "Character does not meet minimum age requirement.");
});
