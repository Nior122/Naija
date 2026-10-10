/**
 * Stage 13 — Police and Security System tests
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
import { PoliceCatalogService } from "../dist/police/catalog.js";
import { PoliceService, emptyPoliceMaps, policeErrorMessage, initializePoliceWorldState, seedPoliceWorld } from "../dist/police/index.js";

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
      schemaVersion: 10,
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
      ...emptyPoliceMaps(),
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
      // Check existing messages
      for (const msg of this.messages) { if (check(msg)) { clearTimeout(timer); resolve(msg); return; } }
    });
  }
  waitForType(type, timeout = 5000) { return this.waitFor((m) => m.type === type, timeout); }
  async close() { this.ws.close(); await new Promise((r) => this.ws.once("close", r)); }
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-police-"));
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
  peer.send({ type: "identity.create", creationKey, profile: { name: "Police Tester", age: 16, character_type: "androgynous", appearance: { skin_tone: "#9b654d", hairstyle: "Short", clothing_color: "#27734a" } } });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, created, ready };
}

// ─── Catalog ──────────────────────────────────────────────────────

test("police catalog loads and has expected structure", () => {
  const catalog = new PoliceCatalogService();
  const data = catalog.get();
  assert.equal(data.schema_version, 1);
  assert.equal(data.world_id, "nigeria-main");
  assert.ok(data.ranks.length >= 10);
  assert.ok(data.incident_categories.length >= 14);
  assert.ok(data.dispatch_priorities.length === 4);
  assert.ok(data.misconduct_categories.length >= 9);
  assert.ok(data.training_modules.length >= 8);
  assert.ok(data.complaint_outcomes.length >= 9);
  assert.ok(data.seed_stations.length >= 4);
  assert.equal(data.rules.minimum_recruitment_age, 18);
});

test("police catalog rank lookups work", () => {
  const catalog = new PoliceCatalogService();
  const constable = catalog.getRank("constable");
  assert.ok(constable);
  assert.equal(constable.label, "Police Constable");
  assert.ok(catalog.hasRank("commissioner"));
  assert.ok(!catalog.hasRank("general"));
});

// ─── emptyPoliceMaps ─────────────────────────────────────────────

test("emptyPoliceMaps returns all expected map keys", () => {
  const maps = emptyPoliceMaps();
  assert.ok(typeof maps.policeUnits === "object");
  assert.ok(typeof maps.policeOfficers === "object");
  assert.ok(typeof maps.recruitmentApplications === "object");
  assert.ok(typeof maps.policeIncidents === "object");
  assert.ok(typeof maps.dispatches === "object");
  assert.ok(typeof maps.investigations === "object");
  assert.ok(typeof maps.policeEvidence === "object");
  assert.ok(typeof maps.wantedRecords === "object");
  assert.ok(typeof maps.arrestRecords === "object");
  assert.ok(typeof maps.misconductComplaints === "object");
  assert.ok(typeof maps.policeAudits === "object");
});

// ─── initializePoliceWorldState ───────────────────────────────────

test("initializePoliceWorldState sets all maps", () => {
  const state = {};
  initializePoliceWorldState(state);
  assert.ok(typeof state.policeUnits === "object");
  assert.ok(typeof state.policeOfficers === "object");
  assert.ok(typeof state.policeIncidents === "object");
});

// ─── seedPoliceWorld ──────────────────────────────────────────────

test("seedPoliceWorld creates seed stations", () => {
  const state = emptyPoliceMaps();
  const result = seedPoliceWorld(state, { year: 2025, month: 1, day: 1 });
  assert.ok(result.stations >= 4);
  assert.ok(state.policeUnits["national-hq"]);
  assert.ok(state.policeUnits["fct-hq"]);
  assert.ok(state.policeUnits["abuja-central"]);
  assert.ok(state.policeUnits["abuja-south"]);
});

test("seedPoliceWorld is idempotent", () => {
  const state = emptyPoliceMaps();
  seedPoliceWorld(state, { year: 2025, month: 1, day: 1 });
  const count1 = Object.keys(state.policeUnits).length;
  seedPoliceWorld(state, { year: 2025, month: 1, day: 2 });
  assert.equal(count1, Object.keys(state.policeUnits).length);
});

// ─── Station management ───────────────────────────────────────────

test("createStation and getStation work", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  const station = service.createStation({ name: "Test Station", level: "station", jurisdiction: "test-area" }, world.date);
  assert.ok(station.unit_id.startsWith("station-"));
  const fetched = service.getStation(station.unit_id);
  assert.ok(fetched);
  assert.equal(fetched.name, "Test Station");
});

// ─── Recruitment ──────────────────────────────────────────────────

test("applyForRecruitment enforces age requirement", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  assert.throws(() => {
    service.applyForRecruitment({
      character_id: "char-young",
      station_id: "abuja-central",
      education: "tertiary",
      birth_date: { year: 2015, month: 1, day: 1 },
    }, world.date);
  }, /at least 18/);
});

test("applyForRecruitment enforces education requirement", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  assert.throws(() => {
    service.applyForRecruitment({
      character_id: "char-uneducated",
      station_id: "abuja-central",
      education: "primary",
      birth_date: { year: 2000, month: 1, day: 1 },
    }, world.date);
  }, /education/i);
});

test("applyForRecruitment succeeds for eligible character", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({
    character_id: "char-eligible",
    station_id: "abuja-central",
    education: "secondary",
    birth_date: { year: 2000, month: 1, day: 1 },
  }, world.date);
  assert.equal(app.status, "submitted");
  assert.equal(app.character_id, "char-eligible");
});

test("enrollOfficer creates officer record with badge number", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({
    character_id: "char-recruit",
    station_id: "abuja-central",
    education: "tertiary",
    birth_date: { year: 2000, month: 1, day: 1 },
  }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "constable", world.date);
  assert.ok(officer.officer_id.startsWith("officer-"));
  assert.ok(officer.badge_number.startsWith("PF"));
  assert.equal(officer.rank, "constable");
});

test("promoteOfficer requires higher rank", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({
    character_id: "char-promote",
    station_id: "abuja-central",
    education: "tertiary",
    birth_date: { year: 2000, month: 1, day: 1 },
  }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "constable", world.date);
  assert.throws(() => service.promoteOfficer(officer.officer_id, "constable"), /higher/);
  service.promoteOfficer(officer.officer_id, "corporal");
  assert.equal(service.getOfficer(officer.officer_id).rank, "corporal");
});

// ─── Incident reporting ───────────────────────────────────────────

test("submitIncident creates incident with reference number", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const inc = service.submitIncident({
    category: "theft",
    description: "A bag was stolen from the market stall.",
    summary: "Bag stolen at market",
    reporter_character_id: "char-reporter",
    location_id: "loc-market-1",
  }, world.date);
  assert.ok(inc.incident_id.startsWith("incident-"));
  assert.ok(inc.reference_number.startsWith("NPF-THE-"));
  assert.equal(inc.status, "submitted");
});

test("submitIncident rejects invalid category", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  assert.throws(() => {
    service.submitIncident({
      category: "alien_invasion",
      description: "Something happened.",
      summary: "test",
    }, world.date);
  });
});

test("triageIncident accepts and assigns station", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const inc = service.submitIncident({
    category: "assault",
    description: "A fight broke out near the bus stop.",
    summary: "Assault at bus stop",
  }, world.date);
  const triaged = service.triageIncident(inc.incident_id, { accepted: true, assigned_station_id: "abuja-central" }, world.date);
  assert.equal(triaged.status, "accepted");
  assert.equal(triaged.assigned_station_id, "abuja-central");
});

test("triageIncident can reject", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  const inc = service.submitIncident({
    category: "theft",
    description: "Report with insufficient detail.",
    summary: "Dup",
  }, world.date);
  const triaged = service.triageIncident(inc.incident_id, { accepted: false, reason: "Insufficient detail" }, world.date);
  assert.equal(triaged.status, "rejected");
});

// ─── Investigations ───────────────────────────────────────────────

test("openInvestigation requires active officer", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const inc = service.submitIncident({
    category: "fraud",
    description: "Business fraud reported.",
    summary: "Fraud report",
  }, world.date);
  assert.throws(() => {
    service.openInvestigation({
      incident_id: inc.incident_id,
      station_id: "abuja-central",
      lead_officer_id: "officer-nonexistent",
      category: "fraud",
      summary: "Investigation into fraud",
    }, world.date);
  }, /Officer not found/);
});

test("openInvestigation and close flow", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({
    character_id: "char-investigator",
    station_id: "abuja-central",
    education: "tertiary",
    birth_date: { year: 2000, month: 1, day: 1 },
  }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "sergeant", world.date);
  const inc = service.submitIncident({
    category: "fraud",
    description: "Business fraud at shop.",
    summary: "Fraud at shop",
  }, world.date);
  service.triageIncident(inc.incident_id, { accepted: true, assigned_station_id: "abuja-central" }, world.date);
  const inv = service.openInvestigation({
    incident_id: inc.incident_id,
    station_id: "abuja-central",
    lead_officer_id: officer.officer_id,
    category: "fraud",
    summary: "Investigating business fraud",
  }, world.date);
  assert.equal(inv.status, "assigned");
  const closed = service.closeInvestigation(inv.investigation_id, "Insufficient evidence", world.date);
  assert.equal(closed.status, "closed");
});

// ─── Evidence ─────────────────────────────────────────────────────

test("submitEvidence and custody transfer", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app1 = service.applyForRecruitment({ character_id: "char-ev1", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  service.decideApplication(app1.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer1 = service.enrollOfficer(app1.application_id, "constable", world.date);
  const app2 = service.applyForRecruitment({ character_id: "char-ev2", station_id: "abuja-central", education: "secondary", birth_date: { year: 1999, month: 6, day: 15 } }, world.date);
  service.decideApplication(app2.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer2 = service.enrollOfficer(app2.application_id, "constable", world.date);
  const inc = service.submitIncident({ category: "theft", description: "Phone stolen.", summary: "Phone theft" }, world.date);
  const ev = service.submitEvidence({
    incident_id: inc.incident_id,
    category: "cctv_footage",
    description: "CCTV footage from market entrance",
    collected_by_officer_id: officer1.officer_id,
  }, world.date);
  assert.equal(ev.current_custodian_officer_id, officer1.officer_id);
  assert.equal(ev.custody_chain.length, 1);
  const transferred = service.transferCustody(ev.evidence_id, officer2.officer_id, "transferred_for_analysis");
  assert.equal(transferred.current_custodian_officer_id, officer2.officer_id);
  assert.equal(transferred.custody_chain.length, 2);
});

// ─── Wanted records ───────────────────────────────────────────────

test("requestWantedRecord requires legal basis", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({ character_id: "char-wanted-officer", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "sergeant", world.date);
  assert.throws(() => {
    service.requestWantedRecord({
      character_id: "char-suspect",
      reason: "Theft",
      legal_basis: "",
      issuing_officer_id: officer.officer_id,
    }, world.date);
  }, /Legal basis/);
});

test("wanted record lifecycle: request → authorize → activate → cancel", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app1 = service.applyForRecruitment({ character_id: "char-sgt", station_id: "abuja-central", education: "tertiary", birth_date: { year: 1990, month: 1, day: 1 } }, world.date);
  service.decideApplication(app1.application_id, { approved: true, decided_by: "admin" }, world.date);
  const sergeant = service.enrollOfficer(app1.application_id, "sergeant", world.date);
  const app2 = service.applyForRecruitment({ character_id: "char-insp", station_id: "abuja-central", education: "tertiary", birth_date: { year: 1985, month: 1, day: 1 } }, world.date);
  service.decideApplication(app2.application_id, { approved: true, decided_by: "admin" }, world.date);
  const inspector = service.enrollOfficer(app2.application_id, "inspector", world.date);
  const wanted = service.requestWantedRecord({
    character_id: "char-fugitive",
    reason: "Armed robbery suspect",
    legal_basis: "Criminal Code Act, Section 402",
    issuing_officer_id: sergeant.officer_id,
  }, world.date);
  assert.equal(wanted.status, "requested");
  const authorized = service.authorizeWantedRecord(wanted.wanted_id, inspector.officer_id);
  assert.equal(authorized.status, "authorized");
  const active = service.activateWantedRecord(wanted.wanted_id);
  assert.equal(active.status, "active");
  const cancelled = service.cancelWantedRecord(wanted.wanted_id, inspector.officer_id, "Suspect apprehended");
  assert.equal(cancelled.status, "cancelled");
});

// ─── Arrests ──────────────────────────────────────────────────────

test("executeArrest with inactive wanted record fails", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({ character_id: "char-arp", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "constable", world.date);
  const wanted = service.requestWantedRecord({
    character_id: "char-target",
    reason: "Outstanding warrant",
    legal_basis: "Criminal Code Act",
    issuing_officer_id: officer.officer_id,
  }, world.date);
  assert.throws(() => {
    service.executeArrest({
      character_id: "char-target",
      arresting_officer_id: officer.officer_id,
      wanted_id: wanted.wanted_id,
      reason: "Executing warrant",
      legal_basis: "Police Act",
    }, world.date);
  }, /not active/);
});

test("executeArrest without wanted record works", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({ character_id: "char-ar", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "constable", world.date);
  const arrest = service.executeArrest({
    character_id: "char-perp",
    arresting_officer_id: officer.officer_id,
    reason: "Caught in the act",
    legal_basis: "Police Act, Section 18",
  }, world.date);
  assert.equal(arrest.status, "requested");
  assert.equal(arrest.character_id, "char-perp");
});

// ─── Misconduct ───────────────────────────────────────────────────

test("submitMisconductComplaint and resolve", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({ character_id: "char-badcop", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "constable", world.date);
  const complaint = service.submitMisconductComplaint({
    complainant_character_id: "char-citizen",
    accused_officer_id: officer.officer_id,
    category: "unauthorized_arrest",
    description: "Officer arrested me without cause.",
  }, world.date);
  assert.equal(complaint.status, "submitted");
  const resolved = service.resolveComplaint(complaint.complaint_id, "Arrest was unlawful.", "formal_warning", world.date);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.outcome, "formal_warning");
});

test("resolveComplaint with dismissal changes officer status", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({ character_id: "char-worstcop", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  const officer = service.enrollOfficer(app.application_id, "constable", world.date);
  const complaint = service.submitMisconductComplaint({
    complainant_character_id: "char-victim",
    accused_officer_id: officer.officer_id,
    category: "corruption_allegation",
    description: "Officer accepted bribes.",
  }, world.date);
  service.resolveComplaint(complaint.complaint_id, "Evidence confirmed corruption.", "dismissal", world.date);
  assert.equal(service.getOfficer(officer.officer_id).status, "dismissed");
});

// ─── Snapshots ────────────────────────────────────────────────────

test("getPoliceProfile for non-officer returns is_officer false", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  const profile = service.getPoliceProfile("char-nobody");
  assert.equal(profile.is_officer, false);
  assert.equal(profile.officer_id, null);
});

test("getPoliceProfile for officer returns full profile", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  const app = service.applyForRecruitment({ character_id: "char-profiled", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  service.decideApplication(app.application_id, { approved: true, decided_by: "admin" }, world.date);
  service.enrollOfficer(app.application_id, "sergeant", world.date);
  const profile = service.getPoliceProfile("char-profiled");
  assert.equal(profile.is_officer, true);
  assert.equal(profile.rank, "sergeant");
  assert.ok(profile.badge_number);
});

// ─── Audit ────────────────────────────────────────────────────────

test("audit records are created for key actions", () => {
  const world = makeWorld();
  const service = new PoliceService(world.state, new PoliceCatalogService());
  seedPoliceWorld(world.state, world.date);
  service.applyForRecruitment({ character_id: "char-audited", station_id: "abuja-central", education: "secondary", birth_date: { year: 2000, month: 1, day: 1 } }, world.date);
  const audits = service.listAudits();
  assert.ok(audits.length >= 1);
  assert.ok(audits.some((a) => a.category === "recruitment"));
});

// ─── Error messages ───────────────────────────────────────────────

test("policeErrorMessage returns readable messages", () => {
  assert.equal(policeErrorMessage("police_not_an_officer"), "You must be a registered police officer to perform this action.");
  assert.equal(policeErrorMessage("police_station_not_found"), "Police station not found.");
  assert.equal(policeErrorMessage("police_age_ineligible"), "You do not meet the minimum age requirement for recruitment.");
  assert.equal(policeErrorMessage("unknown_code"), "An unexpected police system error occurred.");
});

// ─── Persistence migration ────────────────────────────────────────

test("schema version 9 state migrates to version 11 with empty police and military maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-police-migration-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const original = new WorldStore(stateFile, Date.UTC(2025, 0, 1));
  await original.flush();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 14);
  saved.schemaVersion = 9;
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
  await writeFile(stateFile, JSON.stringify(saved), "utf8");
  const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
  assert.equal(migrated.state.schemaVersion, 14);
  assert.ok(typeof migrated.state.policeUnits === "object");
  assert.ok(typeof migrated.state.policeOfficers === "object");
  assert.ok(typeof migrated.state.policeIncidents === "object");
  assert.ok(typeof migrated.state.wantedRecords === "object");
  assert.ok(typeof migrated.state.arrestRecords === "object");
});

// ─── WebSocket integration ────────────────────────────────────────

test("police.action list_stations works over WebSocket", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "police.action", action: "list_stations", requestId: "req-stations-1" });
    const result = await peer.waitFor((msg) => msg.type === "police.result" && msg.requestId === "req-stations-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.action, "list_stations");
    assert.ok(Array.isArray(result.data.stations));
    await peer.close();
  } finally {
    server.close();
  }
});

test("police.action submit_incident and list_incidents work over WebSocket", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({
      type: "police.action", action: "submit_incident", requestId: "req-inc-1",
      category: "theft", description: "My phone was stolen at the bus stop.", summary: "Phone stolen",
    });
    const incResult = await peer.waitFor((msg) => msg.type === "police.result" && msg.requestId === "req-inc-1", 5000);
    assert.ok(incResult);
    assert.equal(incResult.ok, true);
    assert.ok(incResult.data.incident);
    assert.ok(incResult.data.incident.reference_number.startsWith("NPF-THE-"));
    peer.send({ type: "police.action", action: "list_incidents", requestId: "req-inc-list" });
    const listResult = await peer.waitFor((msg) => msg.type === "police.result" && msg.requestId === "req-inc-list", 5000);
    assert.ok(listResult);
    assert.equal(listResult.ok, true);
    assert.ok(Array.isArray(listResult.data.incidents));
    assert.ok(listResult.data.incidents.length >= 1);
    await peer.close();
  } finally {
    server.close();
  }
});

test("police.action police_profile returns non-officer for regular character", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "police.action", action: "police_profile", requestId: "req-profile-1" });
    const result = await peer.waitFor((msg) => msg.type === "police.result" && msg.requestId === "req-profile-1", 5000);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.is_officer, false);
    await peer.close();
  } finally {
    server.close();
  }
});

test("police.action error returned for invalid action", async () => {
  const { server, serverPort } = await startServer();
  try {
    const { peer } = await createOnlinePeer(serverPort);
    peer.send({ type: "police.action", action: "invalid_action", requestId: "req-invalid" });
    const result = await peer.waitFor((msg) => msg.type === "police.error" && msg.requestId === "req-invalid", 5000);
    assert.ok(result);
    assert.equal(result.action, "invalid_action");
    await peer.close();
  } finally {
    server.close();
  }
});
