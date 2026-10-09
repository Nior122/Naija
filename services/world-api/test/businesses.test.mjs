import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { loadBusinessCatalog, validateBusinessCatalogForTest } from "../dist/businesses/catalog.js";
import {
  addBranch,
  addBusinessProduct,
  buildBusinessProfile,
  closeBusiness,
  contributeCapital,
  createBusiness,
  discoverBusinesses,
  fireEmployee,
  hireEmployee,
  initializeBusinessWorldState,
  processBusinessWorldDate,
  recordBusinessExpense,
  restockInventory,
  runProduction,
  seedNpcBusinesses,
  sellProduct,
  sellService,
  transferOwnership,
  withdrawFromBusiness,
} from "../dist/businesses/service.js";
import { loadLifeCatalog, normalizeWorldClock, worldDayForDate } from "../dist/life/calendar.js";
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

function makeWorld(date = { year: 2025, month: 1, day: 4 }) {
  const now = Date.UTC(2025, 0, 4, 10, 0, 0);
  const lifeCatalog = loadLifeCatalog();
  const day = worldDayForDate(date, lifeCatalog);
  const state = {
    schemaVersion: 5,
    worldId: "nigeria-main",
    worldClock: normalizeWorldClock({
      day,
      minute_of_day: 480,
      millisecond_of_minute: 0,
      updated_at: new Date(now).toISOString(),
    }, now, lifeCatalog),
    players: {},
    people: {},
    households: {},
    families: {},
    relationships: {},
    lifeEvents: {},
    marriages: {},
    inheritanceEvents: {},
    careerEmployers: {},
    careerVacancies: {},
    careerApplications: {},
    employments: {},
    workSessions: {},
    careerSkills: {},
    careerLicenses: {},
    careerReviews: {},
    careerLeaveRequests: {},
    careerEvents: {},
    salaryPayments: {},
    npcCareers: {},
    economyAccounts: {},
    economyTransactions: {},
    economyLoans: {},
    economyCreditScores: {},
    economyEvents: {},
    businesses: {},
    businessOwnership: {},
    businessBranches: {},
    businessProducts: {},
    businessInventory: {},
    businessInventoryMovements: {},
    businessTransactions: {},
    businessExpenses: {},
    businessSales: {},
    businessProductionRuns: {},
    businessEvents: {},
  };
  initializeEconomyWorldState(state, now);
  initializeBusinessWorldState(state);
  return { state, now, date };
}

function addPlayer(world, name, overrides = {}) {
  const playerId = `player-${randomBytes(8).toString("hex")}`;
  const characterId = `character-${randomBytes(8).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const creationKey = randomBytes(32).toString("hex");
  const creationKeyHash = createHash("sha256").update(creationKey).digest("hex");
  const timestamp = new Date(world.now).toISOString();
  const age = overrides.age ?? 20;
  const character = {
    player_id: playerId,
    character_id: characterId,
    name,
    age,
    date_of_birth: { year: 2025 - age, month: 6, day: 15 },
    life_stage_id: "young-adult",
    life_status: "alive",
    household_id: "",
    family_ids: [],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...world.date },
    inheritance_event_ids: [],
    character_type: "androgynous",
    appearance: { skin_tone: "#9b654d", hairstyle: "Short curls", clothing_color: "#27734a" },
    money: overrides.money ?? 500000,
    health: 100,
    energy: 100,
    hunger: 100,
    education_level: "SS3",
    school_id: "school:prototype-day-secondary",
    home_id: "home:generated",
    current_location: overrides.location ?? "town",
    position: { x: 720, y: 540 },
    direction: { x: 0, y: 1 },
    inventory: [],
    academic_scores: {},
    attendance: [],
    education_record: {
      schema_version: 1,
      student_id: characterId,
      current_school_id: "school:prototype-day-secondary",
      current_class_id: "class:jss1",
      enrollment_date: { year: 2024, month: 9, day: 1 },
      status: "active",
      attendance: { total_school_days: 0, days_present: 0, days_absent: 0, days_late: 0, marked_sessions: 0, present_sessions: 0, late_sessions: 0 },
      results: [],
      assessments: [],
      skills: [],
      qualifications: [],
      school_history: [],
      final_exam_record: null,
      tertiary_enrollment: null,
      admission_applications: [],
      scholarship_awards: [],
      generated_exam_content: [],
      final_exam_content_nonce: "",
    },
    reputation: 0,
    household: {},
    geographic_location: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const player = {
    playerId,
    tokenHash,
    creationKeyHash,
    recentRequestIds: [],
    createdAt: timestamp,
    lastSeen: timestamp,
    character,
  };
  world.state.players[playerId] = player;
  initializeEconomyWorldState(world.state, world.now);
  initializeBusinessWorldState(world.state);
  return { playerId, characterId, token, creationKey, player };
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
  waitForType(type, timeoutMs) { return this.waitFor((message) => message.type === type, timeoutMs); }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { this.socket.terminate(); resolve(); }, 1000);
      this.socket.once("close", () => { clearTimeout(timer); resolve(); });
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      else this.socket.terminate();
    });
  }
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-business-"));
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
      name: "Business Tester",
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

test("business catalog loads, validates and exposes categories, templates, products and recipes", () => {
  const catalog = loadBusinessCatalog();
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.world_id, "nigeria-main");
  assert.ok(catalog.categories.length >= 10);
  assert.ok(catalog.templates.length >= 10);
  assert.ok(catalog.business_products.length >= 15);
  assert.ok(catalog.production_recipes.length >= 3);
  const activeTemplates = catalog.templates.filter((t) => t.active);
  assert.ok(activeTemplates.length >= 10);
  for (const template of activeTemplates) {
    assert.ok(catalog.categories.some((c) => c.id === template.category_id));
    assert.ok(template.setup_cost_ngn >= 0);
    assert.ok(template.maximum_employees >= 0);
  }
  assert.throws(() => validateBusinessCatalogForTest({ schema_version: 1, world_id: "nigeria-main", notice: "x".repeat(30), rules: {}, categories: [], premises_types: [], templates: [], business_products: [], production_recipes: [] }),
    /Business rules/);
});

test("business creation validates eligibility, charges setup cost, and records ownership", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Adaeze", { age: 22, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Adaeze Provisions", "Daily household goods.", "market", 100000, world.date, 480, world.now, catalog);
  assert.equal(business.status, "active");
  assert.equal(business.name, "Adaeze Provisions");
  assert.equal(business.template_id, "template:provision-store");
  assert.equal(business.primary_location_id, "market");
  assert.equal(business.balance_ngn, 100000);
  assert.equal(business.total_capital_ngn, 100000);
  const ownership = Object.values(world.state.businessOwnership).find((o) => o.business_id === business.business_id);
  assert.ok(ownership);
  assert.equal(ownership.character_id, characterId);
  assert.equal(ownership.role, "owner");
  assert.equal(ownership.share_percent, 100);
});

test("business creation rejects underage characters, invalid templates, and insufficient funds", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: minor } = addPlayer(world, "Young Person", { age: 16, money: 500000 });
  assert.throws(() => createBusiness(world.state, minor, "template:provision-store", "Minor Shop", "A shop.", "market", 0, world.date, 480, world.now, catalog),
    /business_owner_age_ineligible/);
  const { characterId: broke } = addPlayer(world, "Broke", { age: 25, money: 1000 });
  assert.throws(() => createBusiness(world.state, broke, "template:restaurant", "Expensive Place", "High cost.", "town", 0, world.date, 480, world.now, catalog),
    /business_insufficient_funds/);
  const { characterId: invalid } = addPlayer(world, "Invalid", { age: 25, money: 500000 });
  assert.throws(() => createBusiness(world.state, invalid, "template:nonexistent", "Bad Business", "No template.", "town", 0, world.date, 480, world.now, catalog),
    /business_template_not_found/);
});

test("business creation rejects invalid location for template", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Location Test", { age: 25, money: 500000 });
  const catalog = loadBusinessCatalog();
  assert.throws(() => createBusiness(world.state, characterId, "template:provision-store", "Bad Location", "Wrong place.", "clinic", 0, world.date, 480, world.now, catalog),
    /business_location_invalid/);
});

test("adding products, restocking, and selling products through the business ledger", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Shopkeeper", { age: 25, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Test Shop", "Products.", "market", 200000, world.date, 480, world.now, catalog);
  const product = addBusinessProduct(world.state, business.business_id, characterId, "biz-goods:rice-5kg", null, world.date, 481, world.now, catalog);
  assert.equal(product.price_ngn, 8500);
  const { inventory } = restockInventory(world.state, business.business_id, characterId, "biz-goods:rice-5kg", 20, 7000, world.date, 482, world.now, catalog);
  assert.equal(inventory.quantity, 20);
  const { sale } = sellProduct(world.state, business.business_id, product.product_record_id, null, 5, world.date, 483, world.now, catalog);
  assert.equal(sale.quantity, 5);
  assert.equal(sale.total_ngn, 42500);
  const updatedInventory = world.state.businessInventory[inventory.inventory_id];
  assert.equal(updatedInventory.quantity, 15);
  assert.equal(business.total_revenue_ngn, 42500);
});

test("selling insufficient stock is rejected", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Stock Test", { age: 25, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Low Stock", "Limited.", "market", 200000, world.date, 480, world.now, catalog);
  const product = addBusinessProduct(world.state, business.business_id, characterId, "biz-goods:bread", null, world.date, 481, world.now, catalog);
  restockInventory(world.state, business.business_id, characterId, "biz-goods:bread", 2, 1200, world.date, 482, world.now, catalog);
  assert.throws(() => sellProduct(world.state, business.business_id, product.product_record_id, null, 5, world.date, 483, world.now, catalog),
    /business_insufficient_stock/);
});

test("service-based businesses can sell services without inventory", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Consultant", { age: 28, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:consulting-firm", "Advisory Co", "Consulting.", "town", 100000, world.date, 480, world.now, catalog);
  const product = addBusinessProduct(world.state, business.business_id, characterId, "biz-service:consulting-hour", null, world.date, 481, world.now, catalog);
  const { sale } = sellService(world.state, business.business_id, product.product_record_id, null, world.date, 482, world.now, catalog);
  assert.equal(sale.is_service, true);
  assert.equal(sale.total_ngn, 15000);
  assert.equal(business.total_revenue_ngn, 15000);
});

test("capital contributions and owner withdrawals use the shared economy ledger", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Investor", { age: 30, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Capital Test", "Funds.", "market", 50000, world.date, 480, world.now, catalog);
  const contribTx = contributeCapital(world.state, business.business_id, characterId, 100000, world.date, 481, world.now, catalog);
  assert.equal(contribTx.amount_ngn, 100000);
  assert.equal(contribTx.kind, "capital_contribution");
  assert.equal(business.balance_ngn, 150000);
  const withdrawTx = withdrawFromBusiness(world.state, business.business_id, characterId, 30000, world.date, 482, world.now, catalog);
  assert.equal(withdrawTx.amount_ngn, 30000);
  assert.equal(withdrawTx.kind, "owner_withdrawal");
  assert.equal(business.balance_ngn, 120000);
});

test("business expenses are deducted from business balance", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Manager", { age: 30, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Expense Test", "Expenses.", "market", 200000, world.date, 480, world.now, catalog);
  const tx = recordBusinessExpense(world.state, business.business_id, characterId, "rent", 25000, "Monthly rent.", world.date, 481, world.now);
  assert.equal(tx.amount_ngn, 25000);
  assert.equal(tx.kind, "expense_rent");
  assert.equal(business.total_expenses_ngn, 25000);
});

test("production consumes inputs and creates output in the inventory ledger", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Baker", { age: 30, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:restaurant", "Test Kitchen", "Food.", "town", 300000, world.date, 480, world.now, catalog);
  restockInventory(world.state, business.business_id, characterId, "biz-goods:rice-5kg", 5, 7000, world.date, 481, world.now, catalog);
  restockInventory(world.state, business.business_id, characterId, "biz-goods:palm-oil-1l", 5, 2000, world.date, 482, world.now, catalog);
  const run = runProduction(world.state, business.business_id, characterId, "recipe:jollof-rice", world.date, 483, world.now, catalog);
  assert.equal(run.output_quantity, 5);
  assert.equal(run.completed, true);
  const outputInventory = Object.values(world.state.businessInventory).find((inv) => inv.business_id === business.business_id && inv.product_definition_id === "biz-service:jollof-rice");
  assert.ok(outputInventory);
  assert.equal(outputInventory.quantity, 5);
});

test("business closure preserves history and prevents further sales", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Closer", { age: 30, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Closing Shop", "Closing.", "market", 200000, world.date, 480, world.now, catalog);
  const product = addBusinessProduct(world.state, business.business_id, characterId, "biz-goods:bread", null, world.date, 481, world.now, catalog);
  restockInventory(world.state, business.business_id, characterId, "biz-goods:bread", 10, 1200, world.date, 482, world.now, catalog);
  closeBusiness(world.state, business.business_id, characterId, "Test closure.", world.date, 483, world.now);
  assert.equal(business.status, "closed");
  assert.ok(business.closed_at);
  assert.throws(() => sellProduct(world.state, business.business_id, product.product_record_id, null, 1, world.date, 484, world.now, catalog),
    /business_not_active/);
});

test("unauthorized characters cannot manage another character's business", () => {
  const world = makeWorld();
  const { characterId: owner } = addPlayer(world, "Owner", { age: 30, money: 500000 });
  const { characterId: stranger } = addPlayer(world, "Stranger", { age: 25, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, owner, "template:provision-store", "Owner Shop", "Private.", "market", 200000, world.date, 480, world.now, catalog);
  assert.throws(() => addBusinessProduct(world.state, business.business_id, stranger, "biz-goods:bread", null, world.date, 481, world.now, catalog),
    /business_unauthorized/);
  assert.throws(() => contributeCapital(world.state, business.business_id, stranger, 50000, world.date, 482, world.now, catalog),
    /business_unauthorized/);
});

test("business discovery lists active businesses by location", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Discoverer", { age: 30, money: 500000 });
  const catalog = loadBusinessCatalog();
  createBusiness(world.state, characterId, "template:provision-store", "Market Shop", "In market.", "market", 100000, world.date, 480, world.now, catalog);
  createBusiness(world.state, characterId, "template:cybercafe", "Town Cafe", "In town.", "town", 100000, world.date, 481, world.now, catalog);
  const marketResults = discoverBusinesses(world.state, "market", catalog);
  assert.equal(marketResults.length, 1);
  assert.equal(marketResults[0].name, "Market Shop");
  const townResults = discoverBusinesses(world.state, "town", catalog);
  assert.equal(townResults.length, 1);
  const allResults = discoverBusinesses(world.state, null, catalog);
  assert.ok(allResults.length >= 2);
});

test("processBusinessWorldDate charges daily operating costs and detects insolvency", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Failing", { age: 30, money: 500000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Failing Shop", "Low funds.", "market", 100, world.date, 480, world.now, catalog);
  assert.equal(business.balance_ngn, 100);
  const nextDay = { year: world.date.year, month: world.date.month, day: world.date.day + 1 };
  processBusinessWorldDate(world.state, nextDay, world.now, catalog);
  assert.equal(business.status, "insolvent");
});

test("addBranch opens a new branch and respects branch limits", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Branch Owner", { age: 30, money: 2000000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, characterId, "template:provision-store", "Branch Test Shop", "Testing branches.", "market", 500000, world.date, 480, world.now, catalog);
  const branch = addBranch(world.state, business.business_id, characterId, "Lekki Branch", "lekki-market", "shop", world.date, 480, world.now, catalog);
  assert.equal(branch.business_id, business.business_id);
  assert.equal(branch.name, "Lekki Branch");
  assert.equal(branch.status, "active");
  assert.equal(branch.location_id, "lekki-market");
  assert.equal(branch.premises_type, "shop");

  // Verify event was recorded
  const events = Object.values(world.state.businessEvents).filter((e) => e.business_id === business.business_id && e.type === "branch_opened");
  assert.equal(events.length, 1);

  // Branch limit check (max 5)
  for (let i = 0; i < 4; i++) {
    addBranch(world.state, business.business_id, characterId, `Branch ${i}`, "market", "shop", world.date, 480, world.now, catalog);
  }
  const branchCount = Object.values(world.state.businessBranches).filter((b) => b.business_id === business.business_id && b.status === "active").length;
  assert.equal(branchCount, 5);
  assert.throws(() => addBranch(world.state, business.business_id, characterId, "Over Limit", "market", "shop", world.date, 480, world.now, catalog), /business_branch_limit_reached/);
});

test("transferOwnership moves ownership to another character", () => {
  const world = makeWorld();
  const { characterId: owner1Id } = addPlayer(world, "Owner One", { age: 30, money: 500000 });
  const { characterId: owner2Id } = addPlayer(world, "Owner Two", { age: 28, money: 100000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, owner1Id, "template:provision-store", "Transfer Shop", "Testing transfer.", "market", 100000, world.date, 480, world.now, catalog);

  const result = transferOwnership(world.state, business.business_id, owner1Id, owner2Id, "owner", 100, world.date, 480, world.now);
  assert.equal(result.ownership.character_id, owner2Id);
  assert.equal(result.ownership.role, "owner");
  assert.equal(result.ownership.share_percent, 100);
  assert.equal(result.previous.active, false);

  // Old owner should no longer have active ownership
  const oldOwnerActive = Object.values(world.state.businessOwnership).filter(
    (o) => o.business_id === business.business_id && o.character_id === owner1Id && o.active,
  );
  assert.equal(oldOwnerActive.length, 0);

  // Non-owner cannot transfer
  const { characterId: otherId } = addPlayer(world, "Other", { age: 25, money: 50000 });
  assert.throws(() => transferOwnership(world.state, business.business_id, otherId, owner1Id, "co_owner", 50, world.date, 480, world.now), /business_unauthorized|business_not_owner|business_not_found/);
});

test("hireEmployee and fireEmployee manage business staff", () => {
  const world = makeWorld();
  const { characterId: managerId } = addPlayer(world, "Manager", { age: 30, money: 500000 });
  const { characterId: employeeId } = addPlayer(world, "Worker", { age: 22, money: 10000 });
  const catalog = loadBusinessCatalog();
  const business = createBusiness(world.state, managerId, "template:provision-store", "Staff Shop", "Testing staff.", "market", 100000, world.date, 480, world.now, catalog);

  const employment = hireEmployee(world.state, business.business_id, managerId, employeeId, world.date, 480, world.now, catalog);
  assert.equal(employment.character_id, employeeId);
  assert.equal(employment.role, "employee");
  assert.equal(employment.active, true);
  assert.equal(employment.share_percent, 0);

  // Cannot hire same person twice
  assert.throws(() => hireEmployee(world.state, business.business_id, managerId, employeeId, world.date, 480, world.now, catalog), /business_employee_already_employed/);

  // Cannot hire yourself
  assert.throws(() => hireEmployee(world.state, business.business_id, managerId, managerId, world.date, 480, world.now, catalog), /business_employee_is_owner/);

  // Fire the employee
  const fired = fireEmployee(world.state, business.business_id, managerId, employeeId, "Contract ended.", world.date, 480, world.now);
  assert.equal(fired.active, false);

  // Event was recorded
  const hireEvents = Object.values(world.state.businessEvents).filter((e) => e.type === "employee_hired");
  const fireEvents = Object.values(world.state.businessEvents).filter((e) => e.type === "employee_fired");
  assert.equal(hireEvents.length, 1);
  assert.equal(fireEvents.length, 1);
});

test("seedNpcBusinesses creates NPC-owned businesses with initial products", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const npcIds = ["npc-alpha-001", "npc-beta-002", "npc-gamma-003"];
  const seeded = seedNpcBusinesses(world.state, npcIds, world.date, world.now, catalog);
  assert.equal(seeded.length, 3);

  for (const biz of seeded) {
    assert.equal(biz.status, "active");
    assert.ok(biz.balance_ngn > 0);
    const owner = Object.values(world.state.businessOwnership).find(
      (o) => o.business_id === biz.business_id && o.role === "owner" && o.active,
    );
    assert.ok(owner);
    assert.ok(npcIds.includes(owner.character_id));

    // Should have some products seeded
    const products = Object.values(world.state.businessProducts).filter((p) => p.business_id === biz.business_id);
    assert.ok(products.length > 0);
  }

  // Seeding again should not create duplicates
  const seeded2 = seedNpcBusinesses(world.state, npcIds, world.date, world.now, catalog);
  assert.equal(seeded2.length, 0);
});

test("online business actions create, stock, and sell through WebSocket", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await delay(500);
  peer.messages.length = 0;

  peer.send({ type: "business.action", action: "discover", requestId: "biz-discover-1" });
  const discoverResult = await peer.waitFor(
    (msg) => msg.type === "business.result" && msg.requestId === "biz-discover-1", 5000,
  );
  assert.equal(discoverResult.ok, true);
  assert.ok(Array.isArray(discoverResult.data.businesses));

  await peer.close();
});

test("online business creation rejects underage characters through WebSocket", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await delay(500);
  peer.messages.length = 0;

  // Character is 16 years old - cannot create a business (minimum age is 18)
  peer.send({
    type: "business.action", action: "create", requestId: "biz-create-1",
    payload: { template_id: "template:provision-store", name: "Underage Shop", description: "Should fail.", location_id: "market", initial_capital_ngn: 50000 },
  });
  const errorResult = await peer.waitFor(
    (msg) => msg.type === "business.error" && msg.requestId === "biz-create-1", 5000,
  );
  assert.equal(errorResult.code, "business_owner_age_ineligible");

  await peer.close();
});

test("business profiles are included in character snapshots", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  assert.ok(Array.isArray(ready.character.business_profiles));
  assert.equal(ready.character.business_profiles.length, 0);
  await peer.close();
});

test("schema version 4 state migrates to version 5 with empty business maps", async () => {
  const { serverPort, stateFile } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await peer.close();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 5);
  saved.schemaVersion = 4;
  delete saved.businesses;
  delete saved.businessOwnership;
  delete saved.businessBranches;
  delete saved.businessProducts;
  delete saved.businessInventory;
  delete saved.businessInventoryMovements;
  delete saved.businessTransactions;
  delete saved.businessExpenses;
  delete saved.businessSales;
  delete saved.businessProductionRuns;
  delete saved.businessEvents;
  await writeFile(stateFile, JSON.stringify(saved), "utf8");
  const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
  assert.equal(migrated.state.schemaVersion, 5);
  assert.ok(typeof migrated.state.businesses === "object");
  assert.ok(typeof migrated.state.businessOwnership === "object");
  assert.ok(typeof migrated.state.businessTransactions === "object");
});
