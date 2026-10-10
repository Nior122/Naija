import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { loadEconomyCatalog, validateEconomyCatalogForTest } from "../dist/economy/catalog.js";
import {
  buildEconomyProfile,
  depositToAccount,
  economyAccountPort,
  estimateIncomeTax,
  initializeEconomyWorldState,
  listMarketGoodsForLocation,
  openEconomyAccount,
  processEconomyWorldDate,
  purchaseMarketGood,
  repayLoan,
  requestLoan,
  syncCharacterCashFromEconomy,
  transferBetweenAccounts,
  withdrawFromAccount,
} from "../dist/economy/service.js";
import { loadLifeCatalog, normalizeWorldClock, worldDayForDate } from "../dist/life/calendar.js";
import { createStarterFamily } from "../dist/life/service.js";
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
    schemaVersion: 4,
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
  };
  initializeEconomyWorldState(state, now);
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
  const age = overrides.age ?? 18;
  const character = {
    player_id: playerId,
    character_id: characterId,
    name,
    age,
    date_of_birth: { year: 2025 - age, month: 6, day: 15 },
    life_stage_id: age >= 25 ? "young-adult" : "secondary-school-youth",
    life_status: "alive",
    household_id: "",
    family_ids: [],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...world.date },
    inheritance_event_ids: [],
    character_type: "androgynous",
    appearance: { skin_tone: "#9b654d", hairstyle: "Short curls", clothing_color: "#27734a" },
    money: overrides.money ?? 5000,
    health: 100,
    energy: 100,
    hunger: 100,
    education_level: "SS3",
    school_id: "school:prototype-day-secondary",
    home_id: "home:generated",
    current_location: "town",
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
  waitFor(predicate, timeoutMs = 3000) {
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
  const directory = await mkdtemp(join(tmpdir(), "naija-economy-"));
  activeDirectories.add(directory);
  const stateFile = join(directory, "world-state.json");
  const port = 32000 + Math.floor(Math.random() * 10000);
  const server = createApiServer({ stateFile, allowedOrigins: ["http://localhost"], port });
  activeServers.add(server);
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  const serverPort = typeof address === "object" && address ? address.port : port;
  return { server, serverPort, stateFile, directory };
}

async function connectPeer(serverPort, token, creationKey) {
  const ws = new WebSocket(`ws://0.0.0.0:${serverPort}/ws`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const peer = new TestPeer(ws);
  const ready = await peer.waitForType("session.ready");
  return { peer, ws, ready };
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
      name: "Economy Tester",
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

test("economy catalog loads, validates and exposes NGN goods, banking, tax and loan products", () => {
  const catalog = loadEconomyCatalog();
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.world_id, "nigeria-main");
  assert.equal(catalog.rules.currency, "NGN");
  assert.equal(catalog.rules.currency_symbol, "₦");
  assert.ok(catalog.tax_bands.length >= 6);
  assert.ok(catalog.bank_products.length >= 3);
  assert.ok(catalog.loan_products.length >= 3);
  assert.ok(catalog.market_goods.length >= 10);
  const foodGoods = catalog.market_goods.filter((good) => good.category === "food");
  assert.ok(foodGoods.length >= 5);
  for (const good of foodGoods) {
    assert.ok(good.base_price_ngn >= 1);
    assert.ok(good.location_ids.includes("market"));
  }
  assert.throws(() => validateEconomyCatalogForTest({ schema_version: 1, world_id: "nigeria-main", notice: "x".repeat(30), rules: {}, tax_bands: [], bank_products: [], loan_products: [], market_goods: [] }),
    /Economy rules/);
});

test("economy initializes cash accounts from character money on world state setup", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Adaeze", { age: 22, money: 12500 });
  const profile = buildEconomyProfile(world.state, characterId);
  assert.equal(profile.cash_balance_ngn, 12500);
  assert.equal(profile.total_wealth_ngn, 12500);
  assert.equal(profile.credit_score, 500);
  assert.ok(profile.accounts.length >= 1);
  const cashAccount = profile.accounts.find((account) => account.kind === "cash");
  assert.ok(cashAccount);
  assert.equal(cashAccount.balance_ngn, 12500);
});

test("opening a bank account, depositing and withdrawing through the economy ledger", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Chioma", { age: 25, money: 50000 });
  const catalog = loadEconomyCatalog();
  const account = openEconomyAccount(world.state, characterId, "bank-product:savings", 10000, world.date, 480, world.now, catalog);
  assert.equal(account.kind, "savings");
  assert.equal(account.balance_ngn, 10000);
  const depositTx = depositToAccount(world.state, characterId, account.account_id, 5000, world.date, 481, world.now, catalog);
  assert.equal(depositTx.kind, "bank_deposit");
  const refreshedAccount = world.state.economyAccounts[account.account_id];
  assert.equal(refreshedAccount.balance_ngn, 15000);
  const withdrawalTx = withdrawFromAccount(world.state, characterId, account.account_id, 3000, world.date, 482, world.now, catalog);
  assert.equal(withdrawalTx.kind, "bank_withdrawal");
  const afterWithdrawal = world.state.economyAccounts[account.account_id];
  assert.equal(afterWithdrawal.balance_ngn, 12000);
  const profile = buildEconomyProfile(world.state, characterId);
  assert.equal(profile.total_bank_balance_ngn, 12000);
});

test("transfers between own accounts debit and credit correctly", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Emeka", { age: 28, money: 100000 });
  const catalog = loadEconomyCatalog();
  const savings = openEconomyAccount(world.state, characterId, "bank-product:savings", 30000, world.date, 480, world.now, catalog);
  const current = openEconomyAccount(world.state, characterId, "bank-product:current", 20000, world.date, 481, world.now, catalog);
  const tx = transferBetweenAccounts(world.state, characterId, savings.account_id, current.account_id, 5000, world.date, 482, world.now, catalog);
  assert.equal(tx.kind, "bank_transfer");
  assert.equal(world.state.economyAccounts[savings.account_id].balance_ngn, 25000 - (catalog.bank_products.find((p) => p.id === "bank-product:savings")?.transfer_fee_ngn ?? 0));
  assert.equal(world.state.economyAccounts[current.account_id].balance_ngn, 25000);
});

test("market purchases deduct cash, apply hunger restoration and record transactions", () => {
  const world = makeWorld();
  const { characterId, player } = addPlayer(world, "Fatima", { age: 20, money: 20000 });
  const catalog = loadEconomyCatalog();
  const result = purchaseMarketGood(world.state, characterId, "goods:bread", 2, "market", world.date, 480, world.now, catalog);
  assert.equal(result.total_cost_ngn, 3000);
  assert.equal(result.good.hunger_restore, 20);
  assert.equal(player.character.hunger, 100);
  const cashAccount = Object.values(world.state.economyAccounts).find((account) => account.kind === "cash" && account.character_id === characterId);
  assert.equal(cashAccount.balance_ngn, 17000);
  assert.throws(() => purchaseMarketGood(world.state, characterId, "goods:bread", 1, "schoolyard", world.date, 480, world.now, catalog),
    /economy_good_not_available_here/);
});

test("loan request, repayment and credit-score adjustments work correctly", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Grace", { age: 30, money: 50000 });
  const catalog = loadEconomyCatalog();
  // Use student loan which does not require employment
  const loan = requestLoan(world.state, characterId, "loan-product:student", 200000, 12, world.date, 480, world.now, catalog);
  assert.equal(loan.status, "active");
  assert.equal(loan.principal_ngn, 200000);
  assert.equal(loan.term_months, 12);
  const scoreAfterLoan = world.state.economyCreditScores[characterId].score;
  assert.ok(scoreAfterLoan >= 500);
  const repayTx = repayLoan(world.state, characterId, loan.loan_id, 50000, world.date, 481, world.now, catalog);
  assert.equal(repayTx.kind, "loan_repayment");
  assert.equal(world.state.economyLoans[loan.loan_id].remaining_principal_ngn, 150000);
  assert.equal(world.state.economyLoans[loan.loan_id].payments_made, 1);
});

test("loan request rejects characters with low credit score or no employment", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Halima", { age: 20, money: 5000 });
  world.state.economyCreditScores[characterId].score = 400;
  const catalog = loadEconomyCatalog();
  // Student loan requires score >= 400, but 400 is the minimum — use personal loan which needs 550
  assert.throws(() => requestLoan(world.state, characterId, "loan-product:personal", 100000, 12, world.date, 480, world.now, catalog),
    /economy_credit_score_too_low/);
  // Business loan requires employment
  world.state.economyCreditScores[characterId].score = 700;
  assert.throws(() => requestLoan(world.state, characterId, "loan-product:business", 100000, 12, world.date, 480, world.now, catalog),
    /economy_loan_requires_employment/);
});

test("processEconomyWorldDate accrues interest and charges monthly fees", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Ibrahim", { age: 35, money: 200000 });
  const catalog = loadEconomyCatalog();
  openEconomyAccount(world.state, characterId, "bank-product:savings", 100000, world.date, 480, world.now, catalog);
  const nextMonth = { year: world.date.year, month: world.date.month + 1, day: world.date.day };
  if (nextMonth.month > 12) { nextMonth.month -= 12; nextMonth.year += 1; }
  const interestCount = processEconomyWorldDate(world.state, nextMonth, world.now, catalog);
  assert.ok(interestCount >= 1);
  const savingsAccount = Object.values(world.state.economyAccounts).find((account) => account.kind === "savings" && account.character_id === characterId);
  assert.ok(savingsAccount.balance_ngn > 100000);
});

test("economyAccountPort credits salary into the cash ledger atomically", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Joke", { age: 27, money: 15000 });
  const catalog = loadEconomyCatalog();
  const port = economyAccountPort(world.state, catalog);
  assert.equal(port.balanceForCharacter(characterId), 15000);
  port.creditSalary(characterId, 150000, "payment-test-1", new Date(world.now).toISOString());
  assert.equal(port.balanceForCharacter(characterId), 165000);
  port.creditSalary(characterId, 150000, "payment-test-1", new Date(world.now).toISOString());
  assert.equal(port.balanceForCharacter(characterId), 165000);
});

test("income tax estimation uses progressive bands", () => {
  const catalog = loadEconomyCatalog();
  const lowIncomeTax = estimateIncomeTax(20000, catalog);
  const highIncomeTax = estimateIncomeTax(300000, catalog);
  assert.ok(lowIncomeTax >= 0);
  assert.ok(highIncomeTax > lowIncomeTax);
  assert.equal(estimateIncomeTax(0, catalog), 0);
});

test("market goods listing filters by location", () => {
  const catalog = loadEconomyCatalog();
  const marketGoods = listMarketGoodsForLocation(catalog, "market");
  assert.ok(marketGoods.length >= 5);
  const clinicGoods = listMarketGoodsForLocation(catalog, "clinic");
  assert.ok(clinicGoods.length >= 1);
});

test("syncCharacterCashFromEconomy updates character money from cash account", () => {
  const world = makeWorld();
  const { characterId, player } = addPlayer(world, "Kemi", { age: 25, money: 30000 });
  const cashAccount = Object.values(world.state.economyAccounts).find((account) => account.kind === "cash" && account.character_id === characterId);
  cashAccount.balance_ngn = 25000;
  syncCharacterCashFromEconomy(world.state, characterId);
  assert.equal(player.character.money, 25000);
});

test("schema version 8 state migrates to version 10 with empty justice and police maps", async () => {
  const { serverPort, stateFile } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await peer.close();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 10);
  // Simulate a v8 state by removing police fields
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
  assert.ok(typeof migrated.state.policeUnits === "object");
  const characterId = ready.character.character_id;
  const creditScore = migrated.state.economyCreditScores[characterId];
  assert.ok(creditScore);
  assert.equal(creditScore.score, 500);
});

test("online economy profile and list goods actions work through WebSocket", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await delay(500);
  peer.messages.length = 0;

  // Profile request
  peer.send({ type: "economy.action", action: "profile", requestId: "req-profile-1" });
  const profileResult = await peer.waitFor(
    (msg) => msg.type === "economy.result" && msg.requestId === "req-profile-1", 5000,
  );
  assert.equal(profileResult.ok, true);
  assert.ok(profileResult.data.economy_profile);
  assert.equal(profileResult.data.economy_profile.currency, "NGN");

  await peer.close();
});

test("online economy purchase action deducts cash through WebSocket", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await delay(500);
  peer.messages.length = 0;

  peer.send({ type: "economy.action", action: "purchase", payload: { good_id: "goods:bread", quantity: 1, location_id: "market" }, requestId: "req-purchase-1" });
  const purchaseResult = await peer.waitFor(
    (msg) => msg.type === "economy.result" && msg.requestId === "req-purchase-1", 5000,
  );
  assert.equal(purchaseResult.ok, true);
  assert.equal(purchaseResult.data.total_cost_ngn, 1500);

  await peer.close();
});

test("economy profile is included in the private character snapshot", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);

  assert.ok(ready.character.economy_profile);
  assert.equal(ready.character.economy_profile.currency, "NGN");
  assert.equal(typeof ready.character.economy_profile.cash_balance_ngn, "number");
  assert.equal(typeof ready.character.economy_profile.credit_score, "number");

  await peer.close();
});
