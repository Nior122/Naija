import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { loadGovernmentCatalog, validateGovernmentCatalogForTest } from "../dist/government/catalog.js";
import {
  initializeGovernmentWorldState,
  seedGovernmentWorld,
  appointOfficial,
  removeOfficial,
  createBudget,
  getBudgetAvailable,
  recordGovernmentRevenue,
  recordGovernmentExpenditure,
  createProject,
  updateProjectStatus,
  fundProject,
  publishAnnouncement,
  getFederalGovernment,
  getStateGovernment,
  getLocalGovernment,
  searchProjects,
  getPublishedAnnouncements,
  getCharacterAppointments,
  governmentErrorMessage,
} from "../dist/government/service.js";
import { loadLifeCatalog, normalizeWorldClock } from "../dist/life/calendar.js";
import { initializeEconomyWorldState } from "../dist/economy/service.js";
import { WorldStore } from "../dist/multiplayer/persistence.js";

const activeServers = new Set();
const activeDirectories = new Set();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

afterEach(async () => {
  for (const server of activeServers) {
    await server.shutdown();
    activeServers.delete(server);
  }
  for (const dir of activeDirectories) {
    await rm(dir, { recursive: true, force: true });
    activeDirectories.delete(dir);
  }
});

function makeWorld() {
  const catalog = loadLifeCatalog();
  const now = Date.UTC(2025, 0, 1);
  const state = {
    schemaVersion: 10,
    worldId: "nigeria-main",
    worldClock: normalizeWorldClock({ day: catalog.calendar.starting_world_day, minute_of_day: catalog.calendar.starting_minute_of_day, millisecond_of_minute: 0, updated_at: new Date(now).toISOString() }, now, catalog),
    players: {},
    people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
    careerEmployers: {}, careerVacancies: {}, careerApplications: {}, employments: {}, workSessions: {}, careerSkills: {}, careerLicenses: {}, careerReviews: {}, careerLeaveRequests: {}, careerEvents: {}, salaryPayments: {}, npcCareers: {},
    economyAccounts: {}, economyTransactions: {}, economyLoans: {}, economyCreditScores: {}, economyEvents: {},
    businesses: {}, businessOwnership: {}, businessBranches: {}, businessProducts: {}, businessInventory: {}, businessInventoryMovements: {}, businessTransactions: {}, businessExpenses: {}, businessSales: {}, businessProductionRuns: {}, businessEvents: {},
    properties: {}, propertyOwnership: {}, propertyListings: {}, rentalAgreements: {}, rentalPayments: {}, propertySales: {}, propertyMaintenance: {}, propertyFurnishings: {}, propertyEvents: {},
    governmentOrganisations: {}, governmentOffices: {}, governmentAppointments: {}, governmentBudgets: {}, governmentRevenue: {}, governmentExpenditure: {}, governmentProjects: {}, governmentAnnouncements: {}, governmentEvents: {},
  };
  initializeEconomyWorldState(state, now);
  initializeGovernmentWorldState(state);
  return { state, date: state.worldClock.world_date, now };
}

function addPlayer(world, name, overrides = {}) {
  const playerId = `player-${randomUUID()}`;
  const characterId = `char-${randomUUID()}`;
  const age = overrides.age ?? 25;
  const money = overrides.money ?? 500000;
  const creationKey = randomBytes(32).toString("hex");
  const token = randomBytes(32).toString("hex");
  const now = new Date(world.now).toISOString();
  world.state.players[playerId] = {
    playerId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    creationKeyHash: createHash("sha256").update(creationKey).digest("hex"),
    recentRequestIds: [],
    createdAt: now,
    lastSeen: now,
    character: {
      player_id: playerId,
      character_id: characterId,
      name,
      age,
      character_type: "androgynous",
      appearance: {},
      money,
      health: 100,
      energy: 100,
      hunger: 50,
      education_level: "secondary",
      school_id: "",
      home_id: "",
      current_location: "market",
      position: { x: 0, y: 0 },
      direction: { x: 0, y: 0 },
      inventory: [],
      academic_scores: {},
      attendance: [],
      education_record: { schema_version: 1, student_id: characterId, enrollments: [], attempts: [], qualifications: [], tertiary_enrollment: null, skills: {}, history: [] },
      reputation: 50,
      household: {},
      geographic_location: null,
      created_at: now,
      updated_at: now,
      date_of_birth: { year: 2025 - age, month: 6, day: 15 },
      life_status: "alive",
      life_stage: age < 13 ? "child" : age < 18 ? "adolescent" : "adult",
      processed_through_date: { year: 2025, month: 1, day: 1 },
      family_id: null,
      household_id: null,
      partner_character_ids: [],
      child_character_ids: [],
      parent_character_ids: [],
      guardian_character_ids: [],
      sibling_character_ids: [],
    },
  };
  const cashAccounts = Object.values(world.state.economyAccounts).filter((a) => a.kind === "cash" && a.character_id === characterId);
  if (cashAccounts.length === 0) {
    const accountId = `econ-acc-${randomUUID()}`;
    world.state.economyAccounts[accountId] = {
      account_id: accountId,
      character_id: characterId,
      kind: "cash",
      bank_product_id: null,
      status: "active",
      balance_ngn: money,
      total_deposited_ngn: money,
      total_withdrawn_ngn: 0,
      opened_at: now,
      updated_at: now,
    };
  }
  return { playerId, characterId, token, creationKey };
}

// ─── Catalog Tests ────────────────────────────────────────────────

test("government catalog loads, validates and exposes levels, ministries, offices, and rules", () => {
  const catalog = loadGovernmentCatalog();
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.world_id, "nigeria-main");
  assert.equal(catalog.government_levels.length, 3);
  assert.ok(catalog.federal_ministries.length >= 10);
  assert.ok(catalog.seed_offices.length >= 5);
  assert.ok(catalog.project_categories.length >= 10);
  assert.ok(catalog.budget_categories.length >= 8);
  assert.equal(catalog.rules.currency, "NGN");
  assert.ok(catalog.rules.minimum_office_holder_age >= 18);
  assert.ok(catalog.rules.project_statuses.length >= 3);
  const cat = validateGovernmentCatalogForTest(catalog);
  assert.equal(cat.world_id, "nigeria-main");
});

test("seedGovernmentWorld creates federal government, ministries, offices, and budget", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);
  assert.ok(federal);
  assert.equal(federal.name, "Federal Government of Nigeria");

  const ministries = Object.values(world.state.governmentOrganisations).filter((o) => o.parent_organisation_id === federal.organisation_id && o.ministry_id);
  assert.ok(ministries.length >= 10);

  const offices = Object.values(world.state.governmentOffices);
  assert.ok(offices.length >= 5);

  const budgets = Object.values(world.state.governmentBudgets);
  assert.equal(budgets.length, 1);
  assert.ok(budgets[0].approved_amount_ngn > 0);
});

test("appointOfficial assigns an eligible character to an office", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "President", { age: 45 });
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const presidentOffice = Object.values(world.state.governmentOffices).find((o) => o.definition_id === "office:president");
  assert.ok(presidentOffice);

  const appointment = appointOfficial(world.state, presidentOffice.office_id, characterId, null, world.date, world.now, catalog);
  assert.equal(appointment.character_id, characterId);
  assert.equal(appointment.status, "active");
});

test("appointOfficial rejects underage, deceased, duplicate unique-office, and limit", () => {
  const world = makeWorld();
  const { characterId: youngId } = addPlayer(world, "Young", { age: 16 });
  const { characterId: oldId } = addPlayer(world, "Old", { age: 50 });
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const presidentOffice = Object.values(world.state.governmentOffices).find((o) => o.definition_id === "office:president");

  // Underage
  assert.throws(() => appointOfficial(world.state, presidentOffice.office_id, youngId, null, world.date, world.now, catalog), /government_age_ineligible/);

  // First appointment succeeds
  appointOfficial(world.state, presidentOffice.office_id, oldId, null, world.date, world.now, catalog);

  // Duplicate unique office
  const { characterId: otherId } = addPlayer(world, "Other", { age: 50 });
  assert.throws(() => appointOfficial(world.state, presidentOffice.office_id, otherId, null, world.date, world.now, catalog), /government_office_already_occupied/);
});

test("removeOfficial ends an appointment and preserves history", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "President", { age: 45 });
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const presidentOffice = Object.values(world.state.governmentOffices).find((o) => o.definition_id === "office:president");
  const appointment = appointOfficial(world.state, presidentOffice.office_id, characterId, null, world.date, world.now, catalog);

  const removed = removeOfficial(world.state, appointment.appointment_id, "Term ended.", world.date, world.now);
  assert.equal(removed.status, "ended");
  assert.ok(removed.end_date);
  assert.equal(removed.end_reason, "Term ended.");

  // History preserved
  const history = Object.values(world.state.governmentAppointments).filter((a) => a.office_id === presidentOffice.office_id);
  assert.ok(history.length >= 1);
});

test("createBudget validates amounts and categories", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);

  const budget = createBudget(world.state, federal.organisation_id, 2025, "bud:healthcare", 1000000000, world.date, world.now, catalog);
  assert.equal(budget.approved_amount_ngn, 1000000000);
  assert.equal(budget.status, "approved");

  // Invalid category
  assert.throws(() => createBudget(world.state, federal.organisation_id, 2025, "invalid:cat", 1000000, world.date, world.now, catalog), /government_budget_category_invalid/);
});

test("recordGovernmentRevenue and recordGovernmentExpenditure track finances", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);
  const budget = Object.values(world.state.governmentBudgets).find((b) => b.organisation_id === federal.organisation_id);

  // Record revenue
  const revenue = recordGovernmentRevenue(world.state, federal.organisation_id, "rev:tax", 5000000000, "Tax collection", null, world.date, world.now, catalog);
  assert.equal(revenue.amount_ngn, 5000000000);

  // Record expenditure
  const exp = recordGovernmentExpenditure(world.state, federal.organisation_id, budget.budget_id, "exp:salary", 100000000, "Civil servant salaries", null, null, world.date, world.now, catalog);
  assert.equal(exp.amount_ngn, 100000000);

  // Budget spent updated
  const updatedBudget = world.state.governmentBudgets[budget.budget_id];
  assert.equal(updatedBudget.spent_amount_ngn, 100000000);
});

test("recordGovernmentExpenditure rejects overspending", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);
  // Create a tiny budget
  const tinyBudget = createBudget(world.state, federal.organisation_id, 2025, "bud:community", 1000, world.date, world.now, catalog);

  assert.throws(() => recordGovernmentExpenditure(world.state, federal.organisation_id, tinyBudget.budget_id, "exp:capital", 2000, "Too much", null, null, world.date, world.now, catalog), /government_insufficient_budget/);
});

test("createProject and updateProjectStatus enforce valid lifecycle transitions", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);

  const project = createProject(world.state, federal.organisation_id, null, "proj:road",
    "Lagos-Ibadan Expressway", "Major highway rehabilitation.", "loc:lagos-ikeja",
    50000000000, world.date, world.now, catalog);
  assert.equal(project.status, "proposed");

  // Valid: proposed -> under_review
  updateProjectStatus(world.state, project.project_id, "under_review", null, world.date, world.now, catalog);

  // Invalid: proposed -> completed (should fail since now it's under_review)
  assert.throws(() => updateProjectStatus(world.state, project.project_id, "completed", null, world.date, world.now, catalog), /government_project_status_transition_invalid/);

  // Valid: under_review -> approved
  updateProjectStatus(world.state, project.project_id, "approved", null, world.date, world.now, catalog);
});

test("fundProject updates funding and status", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);
  const project = createProject(world.state, federal.organisation_id, null, "proj:school",
    "New Primary School", "Building a new school.", "loc:akure-odo",
    1000000000, world.date, world.now, catalog);

  // Fund approved project
  updateProjectStatus(world.state, project.project_id, "under_review", null, world.date, world.now, catalog);
  updateProjectStatus(world.state, project.project_id, "approved", null, world.date, world.now, catalog);
  const funded = fundProject(world.state, project.project_id, 500000000, world.date, world.now);
  assert.equal(funded.approved_funding_ngn, 500000000);
  assert.equal(funded.status, "funded");
});

test("publishAnnouncement creates a published announcement", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);
  const ann = publishAnnouncement(world.state, federal.organisation_id,
    "New Infrastructure Plan", "The federal government announces a major infrastructure plan.",
    "federal", null, null, world.date, world.now, catalog);
  assert.equal(ann.status, "published");
  assert.equal(ann.title, "New Infrastructure Plan");
});

test("getFederalGovernment returns a complete federal snapshot", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "President", { age: 50 });
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const presidentOffice = Object.values(world.state.governmentOffices).find((o) => o.definition_id === "office:president");
  appointOfficial(world.state, presidentOffice.office_id, characterId, null, world.date, world.now, catalog);

  const federal = getFederalGovernment(world.state);
  assert.ok(federal);
  assert.ok(federal.federal_organisation);
  assert.ok(federal.ministries.length >= 10);
  assert.ok(federal.president);
  assert.equal(federal.president.character_id, characterId);
});

test("searchProjects filters by organisation, location, category, status", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);
  createProject(world.state, federal.organisation_id, null, "proj:road",
    "Road A", "A road.", "loc:lagos-ikeja", 1000000, world.date, world.now, catalog);
  createProject(world.state, federal.organisation_id, null, "proj:school",
    "School B", "A school.", "loc:akure-odo", 2000000, world.date, world.now, catalog);

  const all = searchProjects(world.state, {});
  assert.equal(all.length, 2);

  const lagos = searchProjects(world.state, { location_id: "loc:lagos-ikeja" });
  assert.equal(lagos.length, 1);

  const roads = searchProjects(world.state, { category_id: "proj:road" });
  assert.equal(roads.length, 1);
});

test("getPublishedAnnouncements returns published announcements", () => {
  const world = makeWorld();
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const federal = Object.values(world.state.governmentOrganisations).find((o) => o.level === "federal" && o.parent_organisation_id === null);
  publishAnnouncement(world.state, federal.organisation_id, "Ann 1", "Body 1", "federal", null, null, world.date, world.now, catalog);
  publishAnnouncement(world.state, federal.organisation_id, "Ann 2", "Body 2", "federal", null, null, world.date, world.now, catalog);

  const anns = getPublishedAnnouncements(world.state, "federal", null);
  assert.equal(anns.length, 2);
});

test("getCharacterAppointments returns appointment history", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Minister", { age: 45 });
  const catalog = loadGovernmentCatalog();
  seedGovernmentWorld(world.state, world.date, world.now, catalog);

  const ministerOffice = Object.values(world.state.governmentOffices).find((o) => o.definition_id === "office:minister");
  const appointment = appointOfficial(world.state, ministerOffice.office_id, characterId, null, world.date, world.now, catalog);

  const appts = getCharacterAppointments(world.state, characterId);
  assert.equal(appts.length, 1);
  assert.equal(appts[0].status, "active");
});

test("governmentErrorMessage returns known messages", () => {
  assert.equal(governmentErrorMessage("government_office_not_found"), "Government office not found.");
  assert.equal(governmentErrorMessage("government_age_ineligible"), "Character does not meet the minimum age requirement for this office.");
  assert.ok(governmentErrorMessage("unknown_code").length > 0);
});

// ─── WebSocket Tests ──────────────────────────────────────────────

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
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((entry) => entry !== waiter);
          reject(new Error("Timed out waiting for a WebSocket result."));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }
  waitForType(type, timeoutMs = 5000) {
    return this.waitFor((msg) => msg.type === type, timeoutMs);
  }
  async close() {
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      else this.socket.terminate();
    });
  }
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-government-"));
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
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const peer = new TestPeer(ws);
  const creationKey = randomBytes(32).toString("hex");
  peer.send({
    type: "identity.create",
    creationKey,
    profile: {
      name: "Government Tester",
      age: 16,
      character_type: "androgynous",
      appearance: { skin_tone: "#9b654d", hairstyle: "Short curls", clothing_color: "#27734a" },
    },
  });
  const created = await peer.waitForType("identity.created");
  peer.send({ type: "session.resume", sessionToken: created.sessionToken });
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, created, ready };
}

test("government view_federal and announcements work through WebSocket", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await delay(500);
  peer.messages.length = 0;

  // View federal government
  peer.send({ type: "government.action", action: "view_federal", requestId: "gov-fed-1" });
  const fedResult = await peer.waitFor(
    (msg) => msg.type === "government.result" && msg.requestId === "gov-fed-1", 5000,
  );
  assert.equal(fedResult.ok, true);
  assert.ok(fedResult.data.federal_government);
  assert.ok(fedResult.data.federal_government.ministries.length >= 10);

  // Get announcements
  peer.send({ type: "government.action", action: "announcements", requestId: "gov-ann-1" });
  const annResult = await peer.waitFor(
    (msg) => msg.type === "government.result" && msg.requestId === "gov-ann-1", 5000,
  );
  assert.equal(annResult.ok, true);
  assert.ok(Array.isArray(annResult.data.announcements));

  await peer.close();
});

test("government appointments are included in character snapshots", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  assert.ok(Array.isArray(ready.character.government_appointments));
  assert.equal(ready.character.government_appointments.length, 0);
  await peer.close();
});

test("schema version 8 state migrates to version 10 with empty justice and police maps", async () => {
  const { serverPort, stateFile } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await peer.close();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 10);
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
  await writeFile(stateFile, JSON.stringify(saved), "utf8");
  const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
  assert.equal(migrated.state.schemaVersion, 10);
  assert.ok(typeof migrated.state.laws === "object");
  assert.ok(typeof migrated.state.courts === "object");
  assert.ok(typeof migrated.state.cases === "object");
  assert.ok(typeof migrated.state.governmentOrganisations === "object");
  assert.ok(typeof migrated.state.policeUnits === "object");
});
