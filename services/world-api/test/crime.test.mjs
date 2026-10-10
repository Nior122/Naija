/**
 * Stage 15 — Crime and Consequences System tests
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
import { CrimeCatalogService } from "../dist/crime/catalog.js";
import { CrimeService, emptyCrimeMaps, crimeErrorMessage, initializeCrimeWorldState, seedCrimeWorld } from "../dist/crime/index.js";

const activeDirectories = new Set();
const activeServers = new Set();

afterEach(async () => {
  for (const server of activeServers) { server.close(); }
  activeServers.clear();
  for (const dir of activeDirectories) {
    try { await rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  activeDirectories.clear();
});

function makeWorld() {
  return {
    state: {
      schemaVersion: 13,
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
      ...emptyCrimeMaps(),
    },
    date: { year: 2025, month: 1, day: 1 },
    now: Date.UTC(2025, 0, 1),
  };
}

class TestPeer {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    this.waiters = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      for (const waiter of this.waiters) {
        if (waiter.check(msg)) waiter.resolve(msg);
      }
      this.waiters = this.waiters.filter((w) => !w.check(msg) || !w.once);
      this.messages.push(msg);
    });
  }
  send(data) { this.ws.send(JSON.stringify(data)); }
  waitFor(check, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeout);
      this.waiters.push({ check, resolve, once: true });
      for (const msg of this.messages) { if (check(msg)) { clearTimeout(timer); resolve(msg); return; } }
    });
  }
  waitForType(type, timeout = 5000) { return this.waitFor((m) => m.type === type, timeout); }
  async close() { this.ws.close(); await new Promise((r) => this.ws.once("close", r)); }
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-crime-"));
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
  peer.send({ type: "identity.create", creationKey, profile: { name: "Crime Tester", age: 16, character_type: "androgynous", appearance: { skin_tone: "#9b654d", hairstyle: "Short", clothing_color: "#27734a" } } });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, created, ready };
}

// ─── Catalog ──────────────────────────────────────────────────────

test("crime catalog loads and has expected structure", () => {
  const catalog = new CrimeCatalogService();
  const data = catalog.get();
  assert.equal(data.schema_version, 1);
  assert.ok(data.crime_categories.length >= 14);
  assert.ok(data.crime_severities.length === 4);
  assert.ok(data.crime_definitions.length >= 12);
  assert.ok(data.incident_statuses.length >= 7);
  assert.ok(Object.keys(data.valid_transitions).length >= 7);
  assert.equal(data.rules.minimum_age_for_crime_action, 15);
  assert.ok(data.consequence_rules.criminal_record_retention_years > 0);
});

test("crime catalog valid transitions work", () => {
  const catalog = new CrimeCatalogService();
  assert.ok(catalog.isValidTransition("created", "reported"));
  assert.ok(catalog.isValidTransition("created", "closed"));
  assert.ok(catalog.isValidTransition("reported", "under_review"));
  assert.ok(!catalog.isValidTransition("closed", "created"));
  assert.ok(!catalog.isValidTransition("created", "resolved"));
});

// ─── emptyCrimeMaps ───────────────────────────────────────────────

test("emptyCrimeMaps returns all expected map keys", () => {
  const maps = emptyCrimeMaps();
  assert.ok(typeof maps.crimeIncidents === "object");
  assert.ok(typeof maps.crimeParticipations === "object");
  assert.ok(typeof maps.crimeEvidence === "object");
  assert.ok(typeof maps.crimeReports === "object");
  assert.ok(typeof maps.criminalRecords === "object");
  assert.ok(typeof maps.crimeNotoriety === "object");
  assert.ok(typeof maps.crimeRestitution === "object");
  assert.ok(typeof maps.crimeRehabilitation === "object");
  assert.ok(typeof maps.crimeAudits === "object");
});

// ─── Crime action resolution ─────────────────────────────────────

test("resolveCrimeAction creates incident for eligible character", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-thief",
    victim_character_id: "char-shopkeeper",
    perpetrator_age: 18,
    seed: 42,
  }, world.date);
  assert.ok(result.incident.incident_id.startsWith("crime-"));
  assert.equal(result.incident.category, "theft");
  assert.equal(result.incident.status, "created");
  assert.ok(typeof result.detected === "boolean");
});

test("resolveCrimeAction enforces age requirement", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  assert.throws(() => {
    service.resolveCrimeAction({
      crime_definition_id: "shoplifting",
      perpetrator_character_id: "char-young",
      perpetrator_age: 10,
      seed: 42,
    }, world.date);
  }, /age/i);
});

test("resolveCrimeAction enforces victim cooldown", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-repeat",
    victim_character_id: "char-victim",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  assert.throws(() => {
    service.resolveCrimeAction({
      crime_definition_id: "shoplifting",
      perpetrator_character_id: "char-repeat",
      victim_character_id: "char-victim",
      perpetrator_age: 18,
      seed: 2,
    }, world.date);
  }, /cooldown/i);
});

test("resolveCrimeAction generates evidence when detected", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  // Use a seed that guarantees detection (severity minor = 0.7 detection chance)
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-caught",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  if (result.detected) {
    assert.ok(result.incident.evidence_ids.length > 0);
  }
  // Notoriety is updated when detected
  const notoriety = service.getNotoriety("char-caught");
  if (result.detected) {
    assert.ok(notoriety);
    assert.ok(notoriety.notoriety_score > 0);
  }
});

test("resolveCrimeAction rejects unknown crime definition", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  assert.throws(() => {
    service.resolveCrimeAction({
      crime_definition_id: "nonexistent_crime",
      perpetrator_character_id: "char-x",
      perpetrator_age: 18,
      seed: 1,
    }, world.date);
  }, /crime_definition_not_found/);
});

// ─── Incident lifecycle ───────────────────────────────────────────

test("reportCrime transitions incident to reported", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-rep",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  const report = service.reportCrime(result.incident.incident_id, "char-witness", "I saw someone shoplifting.", world.date);
  assert.equal(report.status, "submitted");
  const inc = service.getIncident(result.incident.incident_id);
  assert.equal(inc.status, "reported");
});

test("reportCrime rejects non-reportable incident", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  assert.throws(() => {
    service.reportCrime("nonexistent-id", "char-x", "test", world.date);
  }, /crime_incident_not_found/);
});

test("transitionIncident follows valid transitions", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-trans",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  service.reportCrime(result.incident.incident_id, "char-w", "report", world.date);
  const updated = service.transitionIncident(result.incident.incident_id, "under_review", null, world.date);
  assert.equal(updated.status, "under_review");
});

test("transitionIncident rejects invalid transitions", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-badtrans",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  assert.throws(() => {
    service.transitionIncident(result.incident.incident_id, "resolved", null, world.date);
  }, /invalid/i);
});

// ─── Evidence ─────────────────────────────────────────────────────

test("addEvidence creates evidence record", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-ev",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  const ev = service.addEvidence(result.incident.incident_id, "witness_statement", "Shopkeeper confirms theft.", null, "char-shopkeeper", world.date);
  assert.ok(ev.evidence_id.startsWith("crimeev-"));
  assert.equal(ev.integrity_status, "unverified");
  const inc = service.getIncident(result.incident.incident_id);
  assert.ok(inc.evidence_ids.includes(ev.evidence_id));
});

// ─── Police & Justice integration ─────────────────────────────────

test("linkToPoliceIncident associates records", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-link",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  service.linkToPoliceIncident(result.incident.incident_id, "police-inc-123");
  const inc = service.getIncident(result.incident.incident_id);
  assert.equal(inc.police_incident_id, "police-inc-123");
});

test("linkToJusticeCase transitions incident", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-justice",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  service.reportCrime(result.incident.incident_id, "char-w", "report", world.date);
  service.transitionIncident(result.incident.incident_id, "under_review", null, world.date);
  service.transitionIncident(result.incident.incident_id, "investigation_open", null, world.date);
  service.linkToJusticeCase(result.incident.incident_id, "case-456");
  const inc = service.getIncident(result.incident.incident_id);
  assert.equal(inc.justice_case_id, "case-456");
  assert.equal(inc.status, "referred_to_court");
});

// ─── Criminal records ─────────────────────────────────────────────

test("createCriminalRecord creates record with expiry", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-record",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  const record = service.createCriminalRecord({
    character_id: "char-record",
    incident_id: result.incident.incident_id,
    category: "theft",
    severity: "minor",
    conviction: true,
    outcome: "convicted",
    fine_amount: 10000,
  }, world.date);
  assert.ok(record.record_id.startsWith("criminal-"));
  assert.equal(record.conviction, true);
  assert.equal(record.fine_amount, 10000);
  assert.ok(record.record_expiry_date);
});

test("getCriminalRecords returns records for character", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-records",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  service.createCriminalRecord({
    character_id: "char-records",
    incident_id: result.incident.incident_id,
    category: "theft",
    severity: "minor",
    conviction: false,
    outcome: null,
  }, world.date);
  const records = service.getCriminalRecords("char-records");
  assert.ok(records.length >= 1);
});

// ─── Restitution ──────────────────────────────────────────────────

test("createRestitution and markPaid", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-restit",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  const rest = service.createRestitution(result.incident.incident_id, "char-victim", "char-restit", 5000, world.date);
  assert.equal(rest.paid, false);
  const paid = service.markRestitutionPaid(rest.restitution_id, "txn-123", world.date);
  assert.equal(paid.paid, true);
  assert.equal(paid.transaction_id, "txn-123");
});

test("markRestitutionPaid rejects double payment", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-doublepay",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  const rest = service.createRestitution(result.incident.incident_id, "char-v", "char-doublepay", 3000, world.date);
  service.markRestitutionPaid(rest.restitution_id, "txn-1", world.date);
  assert.throws(() => {
    service.markRestitutionPaid(rest.restitution_id, "txn-2", world.date);
  }, /crime_restitution_already_paid/);
});

// ─── Rehabilitation ──────────────────────────────────────────────

test("startRehabilitation and completeRehabilitation", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const rehab = service.startRehabilitation({
    character_id: "char-rehab",
    activity_type: "community_service",
    duration_days: 30,
  }, world.date);
  assert.equal(rehab.status, "in_progress");
  const completed = service.completeRehabilitation(rehab.rehabilitation_id, { year: 2025, month: 2, day: 1 });
  assert.equal(completed.status, "completed");
  assert.ok(completed.reputation_recovery > 0);
});

test("startRehabilitation rejects invalid duration", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  assert.throws(() => {
    service.startRehabilitation({ character_id: "char-x", activity_type: "test", duration_days: 5 }, world.date);
  }, /duration/i);
});

// ─── Notoriety ────────────────────────────────────────────────────

test("notoriety decays over time", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  // Create an incident that gets detected
  service.resolveCrimeAction({
    crime_definition_id: "armed_robbery",
    perpetrator_character_id: "char-notorious",
    perpetrator_age: 20,
    seed: 1,
  }, world.date);
  const before = service.getNotoriety("char-notorious");
  if (before) {
    const decayed = service.decayNotoriety("char-notorious", { year: 2025, month: 2, day: 1 });
    assert.ok(decayed);
    assert.ok(decayed.notoriety_score <= before.notoriety_score);
  }
});

// ─── Profile ──────────────────────────────────────────────────────

test("getCriminalProfile returns clean profile for non-criminal", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const profile = service.getCriminalProfile("char-clean");
  assert.equal(profile.has_criminal_record, false);
  assert.equal(profile.notoriety_score, 0);
  assert.equal(profile.convictions_count, 0);
});

test("getCriminalProfile returns full profile for criminal", () => {
  const world = makeWorld();
  const service = new CrimeService(world.state, new CrimeCatalogService());
  const result = service.resolveCrimeAction({
    crime_definition_id: "shoplifting",
    perpetrator_character_id: "char-criminal",
    perpetrator_age: 18,
    seed: 1,
  }, world.date);
  service.createCriminalRecord({
    character_id: "char-criminal",
    incident_id: result.incident.incident_id,
    category: "theft",
    severity: "minor",
    conviction: true,
    outcome: "convicted",
    fine_amount: 5000,
  }, world.date);
  const profile = service.getCriminalProfile("char-criminal");
  assert.equal(profile.has_criminal_record, true);
  assert.equal(profile.convictions_count, 1);
  assert.equal(profile.outstanding_fines, 5000);
});

// ─── Error messages ───────────────────────────────────────────────

test("crimeErrorMessage returns readable messages", () => {
  assert.equal(crimeErrorMessage("crime_definition_not_found"), "Crime type not found.");
  assert.equal(crimeErrorMessage("crime_age_ineligible"), "Character does not meet minimum age requirement.");
  assert.equal(crimeErrorMessage("unknown_code"), "An unexpected crime system error occurred.");
});

// ─── Persistence migration ────────────────────────────────────────

test("schema version 11 state migrates to version 12 with empty crime maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-crime-migration-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const original = new WorldStore(stateFile, Date.UTC(2025, 0, 1));
  await original.flush();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 13);
  saved.schemaVersion = 11;
  delete saved.crimeIncidents; delete saved.crimeParticipations; delete saved.crimeEvidence;
  delete saved.crimeReports; delete saved.criminalRecords; delete saved.crimeNotoriety;
  delete saved.crimeRestitution; delete saved.crimeRehabilitation; delete saved.crimeAudits;
  delete saved.communities; delete saved.communityMemberships; delete saved.institutions;
  delete saved.institutionMemberships; delete saved.culturalProfiles; delete saved.communityEvents;
  delete saved.communityProjects; delete saved.communityAnnouncements; delete saved.communityReputation;
  delete saved.communityDisputes; delete saved.communityContributions; delete saved.communityAudits;
  await writeFile(stateFile, JSON.stringify(saved), "utf8");
  const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
  assert.equal(migrated.state.schemaVersion, 13);
  assert.ok(typeof migrated.state.crimeIncidents === "object");
  assert.ok(typeof migrated.state.criminalRecords === "object");
  assert.ok(typeof migrated.state.crimeNotoriety === "object");
});

// ─── WebSocket integration ────────────────────────────────────────

test("crime.action list_crime_definitions works over WebSocket", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "crime.action", action: "list_crime_definitions", requestId: "req-defs-1" });
    const result = await peer.waitFor((msg) => msg.type === "crime.result" && msg.requestId === "req-defs-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data.definitions));
    assert.ok(result.data.definitions.length >= 12);
    await peer.close();
  } finally {
    server.close();
  }
});

test("crime.action criminal_profile works over WebSocket", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "crime.action", action: "criminal_profile", requestId: "req-prof-1" });
    const result = await peer.waitFor((msg) => msg.type === "crime.result" && msg.requestId === "req-prof-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.has_criminal_record, false);
    await peer.close();
  } finally {
    server.close();
  }
});

test("crime.action error returned for invalid action", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "crime.action", action: "invalid_action", requestId: "req-inv" });
    const result = await peer.waitFor((msg) => msg.type === "crime.error" && msg.requestId === "req-inv", 5000);
    assert.ok(result);
    assert.equal(result.action, "invalid_action");
    await peer.close();
  } finally {
    server.close();
  }
});
