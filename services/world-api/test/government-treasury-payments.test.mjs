// Treasury funding and payments into economy accounts (Stage 32).
//
// Part A calls the trusted functions on an in-memory state: one-time funding, the payment write, every refusal, the
// ledger audit, and the record validator. Every refusal is checked against a full snapshot of the world. A refused
// request must leave no trace: no balance change, no ledger row, no economy account, no event.
//
// Part B drives the real socket path on every configured backend (file always; PostgreSQL when the live database is
// configured). It injects persistence failures through FaultyStore: a failed write, a lost response, a crash and a
// restart, and (PostgreSQL only) a writer that has been fenced by another instance. The rule under test: a treasury
// reply says "government.result" only after the change is saved.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import { loadGovernmentCatalog, validateGovernmentCatalogForTest } from "../dist/government/catalog.js";
import {
  allocateBudget,
  applyInitialTreasuryFunding,
  appointOfficial,
  approveBudget,
  auditTreasuryLedger,
  initializeGovernmentWorldState,
  recordGovernmentExpenditure,
  recordGovernmentRevenue,
  reconcileGovernmentStructure,
  seedGovernmentWorld,
  spendBudget,
} from "../dist/government/service.js";
import { initializeEconomyWorldState } from "../dist/economy/service.js";
import { validateGovernmentRecords } from "../dist/multiplayer/record-validation.js";
import { database } from "../dist/database/connection.js";
import { PostgresWorldStore, WorldStateConflictError } from "../dist/database/world-store.js";
import { classifySaveFailure, saveOutcomeOf } from "../dist/persistence-status.js";

const CATALOG = loadGovernmentCatalog();
const DATE = { year: 2026, month: 10, day: 11 };
const NOW = Date.UTC(2026, 9, 11);
const FEDERAL = "gov:federal";
const FINANCE = "gov:min:finance";
const HEALTH = "gov:min:health";
const FUNDING = CATALOG.treasury_funding[0];
const PAYMENT_LIMIT = 50_000_000; // economy maximum_transaction_amount_ngn
const BALANCE_LIMIT = 500_000_000; // economy maximum_account_balance_ngn

// ─── Part A: service level ────────────────────────────────────────────────────

/** A world with the seeded government and the economy maps. The seed has no funding unless `withFunding` is set. */
function makeState({ withFunding = false } = {}) {
  const state = {
    worldClock: { world_date: { ...DATE }, minute_of_day: 600 }, players: {}, people: {}, businesses: {},
    relationships: {}, marriages: {},
  };
  initializeGovernmentWorldState(state);
  initializeEconomyWorldState(state, NOW);
  seedGovernmentWorld(state, DATE, NOW, withFunding ? CATALOG : { ...CATALOG, treasury_funding: [] });
  return state;
}

/** A living citizen with a cash account (created by the economy, as in a real world). */
function addCitizen(state, name, { age = 40, status = "alive" } = {}) {
  const characterId = `char-${name.toLowerCase()}`;
  const character = { character_id: characterId, name, life_status: status, age, money: 0 };
  character.date_of_birth = { year: DATE.year - age, month: 1, day: 1 };
  state.players[`player-${characterId}`] = { playerId: `player-${characterId}`, character };
  initializeEconomyWorldState(state, NOW);
  return characterId;
}

const cashAccountOf = (state, characterId) =>
  Object.values(state.economyAccounts).find((a) => a.character_id === characterId && a.kind === "cash");
const financeTreasury = (state) => state.governmentOrganisations[FINANCE].treasury_account;
const budgetFor = (state, organisationId) => Object.values(state.governmentBudgets)
  .find((b) => b.organisation_id === organisationId);

function appointTo(state, definitionId, organisationId, characterId) {
  const office = Object.values(state.governmentOffices)
    .find((o) => o.definition_id === definitionId && o.organisation_id === organisationId);
  assert.ok(office, `premise: ${definitionId} exists in ${organisationId}`);
  return appointOfficial(state, office.office_id, characterId, "operator-seed", DATE, NOW, CATALOG);
}

const snapshot = (state) => JSON.stringify(state);
function assertRefusedWithoutChange(state, action, pattern) {
  const before = snapshot(state);
  assert.throws(action, pattern);
  assert.equal(snapshot(state), before, "a refused request changes nothing");
}

/** A minister with an approved, allocated budget and a finance treasury holding `funds` (trusted intake, test setup). */
function readyMinister(state, { funds = 200_000_000 } = {}) {
  const minister = addCitizen(state, "Minister", { age: 40 });
  appointTo(state, "office:minister", FINANCE, minister);
  const budget = budgetFor(state, FINANCE);
  approveBudget(state, minister, budget.budget_id, 500_000_000, DATE, NOW, CATALOG);
  allocateBudget(state, minister, budget.budget_id, 400_000_000, "alloc-1", DATE, NOW, CATALOG);
  recordGovernmentRevenue(state, FINANCE, "rev:transfer_in", funds, "Test funds", `test-funds-${randomUUID()}`, DATE, NOW, CATALOG);
  return { minister, budget };
}

let attempt = 0;
const nextRequest = () => {
  attempt += 1;
  return `pay-${attempt}`;
};

test("the initial funding lands once on the finance treasury, with its rule and reason in the ledger", () => {
  const state = makeState({ withFunding: true });
  const treasury = financeTreasury(state);
  assert.equal(treasury.balance_ngn, FUNDING.amount_ngn, "funded from the catalogue at seed");
  assert.equal(treasury.total_credited_ngn, FUNDING.amount_ngn);
  const rows = Object.values(state.governmentRevenue).filter((row) => row.funding_rule_id === FUNDING.rule_id);
  assert.equal(rows.length, 1, "exactly one funding row");
  const [row] = rows;
  assert.equal(row.organisation_id, FINANCE);
  assert.equal(row.category_id, FUNDING.category_id);
  assert.equal(row.amount_ngn, FUNDING.amount_ngn);
  assert.equal(row.description, FUNDING.reason, "the reason is recorded");
  assert.equal(row.source_reference, `treasury-funding:${FUNDING.rule_id}`);
  assert.equal(row.actor_character_id, null, "funding has no actor");
  assert.equal(row.account_id, `treasury:${FINANCE}`);
  assert.deepEqual(auditTreasuryLedger(state), []);
  assert.deepEqual(validateGovernmentRecords(state).issues, []);
});

test("the initial funding is applied once: a second application, or a reload from saved data, funds nothing", () => {
  const state = makeState({ withFunding: true });
  const before = snapshot(state);
  assert.equal(applyInitialTreasuryFunding(state, DATE, NOW, CATALOG), 0, "already funded");
  assert.equal(reconcileGovernmentStructure(state, DATE, NOW, CATALOG), 0);
  assert.equal(snapshot(state), before, "a repeated application changes nothing");

  // The marker lives in the saved ledger, so a process that reloads the saved world sees it too.
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(applyInitialTreasuryFunding(reloaded, DATE, NOW, CATALOG), 0, "a reloaded world is not funded again");
  assert.equal(financeTreasury(reloaded).balance_ngn, FUNDING.amount_ngn);
});

test("a legacy ledger is preserved when the funding is applied, and the funding row is the only addition", () => {
  const state = makeState();
  const legacyRevenue = {
    revenue_id: "gov-rev-legacy", organisation_id: FINANCE, category_id: "rev:tax", amount_ngn: 700, description: "Old levy",
    source_reference: "old-levy", received_at: new Date(NOW).toISOString(), received_world_date: { ...DATE },
    idempotency_key: "legacy-key", account_id: `treasury:${FINANCE}`, actor_character_id: null, balance_after_ngn: 700,
  };
  state.governmentRevenue["gov-rev-legacy"] = legacyRevenue;
  financeTreasury(state).balance_ngn = 700;
  financeTreasury(state).total_credited_ngn = 700;
  const legacyBefore = JSON.stringify(legacyRevenue);

  assert.equal(applyInitialTreasuryFunding(state, DATE, NOW, CATALOG), 1);
  assert.equal(JSON.stringify(state.governmentRevenue["gov-rev-legacy"]), legacyBefore, "the legacy row is untouched");
  assert.equal(financeTreasury(state).balance_ngn, 700 + FUNDING.amount_ngn);
  assert.deepEqual(auditTreasuryLedger(state), []);
});

test("funding rules are checked when the catalogue loads: a bad rule is refused, not written", () => {
  const good = JSON.parse(JSON.stringify(CATALOG));
  assert.equal(validateGovernmentCatalogForTest(good).treasury_funding.length, 1);
  const withRule = (rule) => ({ ...JSON.parse(JSON.stringify(CATALOG)), treasury_funding: [rule] });
  const base = { ...FUNDING };
  for (const [label, rule] of [
    ["an amount of zero", { ...base, amount_ngn: 0 }],
    ["an amount above the revenue bound", { ...base, amount_ngn: 2_000_000_000_000 }],
    ["a fractional amount", { ...base, amount_ngn: 1.5 }],
    ["an unknown revenue category", { ...base, category_id: "rev:tax-free-gift" }],
    ["an organisation that is not a government body", { ...base, organisation_id: "biz:bank" }],
    ["an empty reason", { ...base, reason: "   " }],
  ]) {
    assert.throws(() => validateGovernmentCatalogForTest(withRule(rule)), undefined, label);
  }
  const duplicated = { ...JSON.parse(JSON.stringify(CATALOG)), treasury_funding: [base, { ...base }] };
  assert.throws(() => validateGovernmentCatalogForTest(duplicated), /duplicate/, "a rule ID can be used once");
  const missing = JSON.parse(JSON.stringify(CATALOG));
  delete missing.treasury_funding;
  assert.throws(() => validateGovernmentCatalogForTest(missing), /incomplete/);
});

test("a payment debits the treasury and credits the payee's existing cash account in one write, with matching ledger rows", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state);
  const payee = addCitizen(state, "Payee", { age: 30 });
  const accountCount = Object.keys(state.economyAccounts).length;
  const startTreasury = financeTreasury(state).balance_ngn;
  const startPayee = cashAccountOf(state, payee).balance_ngn;

  const { expenditure, replayed } = spendBudget(state, minister, budget.budget_id, 30_000_000,
    { kind: "character", id: payee }, "Clinic supplies", "pay-a", DATE, NOW, CATALOG);
  assert.equal(replayed, false);
  assert.equal(financeTreasury(state).balance_ngn, startTreasury - 30_000_000, "the treasury is debited");
  assert.equal(cashAccountOf(state, payee).balance_ngn, startPayee + 30_000_000, "the payee is credited");
  assert.equal(Object.keys(state.economyAccounts).length, accountCount, "no account was created for the payee");

  const cash = cashAccountOf(state, payee);
  assert.equal(expenditure.recipient_account_id, cash.account_id);
  const transaction = state.economyTransactions[expenditure.recipient_transaction_id];
  assert.equal(transaction.kind, "government_payment");
  assert.equal(transaction.amount_ngn, 30_000_000);
  assert.equal(transaction.reference_id, expenditure.expenditure_id, "the credit names its payment");
  assert.equal(transaction.counterparty_account_id, `treasury:${FINANCE}`);
  assert.equal(transaction.balance_after_ngn, startPayee + 30_000_000);
  assert.ok(Object.values(state.economyEvents).some((e) => e.type === "government_payment_received" &&
    e.account_id === cash.account_id), "the payee sees the receipt in the economy events");
  assert.deepEqual(auditTreasuryLedger(state), [], "balances agree with the ledgers");
  assert.deepEqual(validateGovernmentRecords(state).issues, []);
});

test("the payee's character money is kept equal to the cash account", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state);
  const payee = addCitizen(state, "Payee", { age: 30 });
  spendBudget(state, minister, budget.budget_id, 1_000_000, { kind: "character", id: payee }, "Fuel", "pay-m", DATE, NOW, CATALOG);
  assert.equal(state.players[`player-${payee}`].character.money, cashAccountOf(state, payee).balance_ngn);
});

test("a payee with no cash account, a frozen account, or who is deceased is refused, and nothing is written", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state);
  // Create every citizen first: the economy's seeding path gives a cash account to any living character without one,
  // so an account can only be removed after the last character has been added.
  const noAccount = addCitizen(state, "NoAccount", { age: 30 });
  const frozen = addCitizen(state, "Frozen", { age: 30 });
  const deceased = addCitizen(state, "Deceased", { age: 30, status: "deceased" });
  delete state.economyAccounts[cashAccountOf(state, noAccount).account_id];
  cashAccountOf(state, frozen).status = "frozen";

  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000,
    { kind: "character", id: noAccount }, "x", nextRequest(), DATE, NOW, CATALOG), /economy_payee_account_missing/,
  "no account is created for a payee who has none");
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000,
    { kind: "character", id: frozen }, "x", nextRequest(), DATE, NOW, CATALOG), /economy_payee_account_inactive/);
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000,
    { kind: "character", id: deceased }, "x", nextRequest(), DATE, NOW, CATALOG), /economy_payee_deceased/);
  assert.equal(Object.values(state.economyAccounts).filter((a) => a.character_id === noAccount).length, 0);
});

test("a single payment is limited to the economy transaction limit, and a payee cannot be pushed over the balance limit", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state, { funds: 300_000_000 });
  const payee = addCitizen(state, "Payee", { age: 30 });

  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, PAYMENT_LIMIT + 1,
    { kind: "character", id: payee }, "Over", nextRequest(), DATE, NOW, CATALOG), /economy_payment_over_transaction_limit/);
  const exact = spendBudget(state, minister, budget.budget_id, PAYMENT_LIMIT, { kind: "character", id: payee }, "At the limit",
    "pay-limit", DATE, NOW, CATALOG);
  assert.equal(exact.replayed, false, "exactly the limit is allowed");

  cashAccountOf(state, payee).balance_ngn = BALANCE_LIMIT - 10_000_000;
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 20_000_000,
    { kind: "character", id: payee }, "Too much", nextRequest(), DATE, NOW, CATALOG), /economy_payee_balance_limit/);
  const fits = spendBudget(state, minister, budget.budget_id, 10_000_000, { kind: "character", id: payee }, "Fits",
    "pay-fits", DATE, NOW, CATALOG);
  assert.equal(cashAccountOf(state, payee).balance_ngn, BALANCE_LIMIT, "the balance can reach the limit and no further");
  assert.equal(fits.replayed, false);
});

test("a payment to a family member or a spouse is a conflict of interest, and an ended tie is not", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state);
  const sibling = addCitizen(state, "Sibling", { age: 30 });
  const spouse = addCitizen(state, "Spouse", { age: 30 });
  const parent = addCitizen(state, "Parent", { age: 60 });
  const former = addCitizen(state, "Former", { age: 30 });
  state.relationships["rel-sibling"] = { relationship_id: "rel-sibling", type: "sibling_of", participants: [minister, sibling], status: "active" };
  state.relationships["rel-parent"] = { relationship_id: "rel-parent", type: "parent_of", participants: [parent, minister], status: "active" };
  state.relationships["rel-former"] = { relationship_id: "rel-former", type: "sibling_of", participants: [minister, former], status: "ended" };
  state.marriages["marriage-1"] = { marriage_id: "marriage-1", spouse_ids: [minister, spouse], status: "active" };

  for (const relative of [sibling, spouse, parent]) {
    assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000,
      { kind: "character", id: relative }, "x", nextRequest(), DATE, NOW, CATALOG), /treasury_conflict_of_interest/);
  }
  const ok = spendBudget(state, minister, budget.budget_id, 1000, { kind: "character", id: former }, "Ended tie", "pay-ended", DATE, NOW, CATALOG);
  assert.equal(ok.replayed, false, "a tie that has ended is not a conflict");
});

test("a business or an organisation is refused as unsupported, and an unknown kind is invalid, with no writes", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state);
  state.businesses["biz-other"] = { business_id: "biz-other", name: "Other", owner_character_id: "char-x", status: "active" };
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000,
    { kind: "business", id: "biz-other" }, "x", nextRequest(), DATE, NOW, CATALOG), /treasury_destination_unsupported/);
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000,
    { kind: "organisation", id: HEALTH }, "x", nextRequest(), DATE, NOW, CATALOG), /treasury_destination_unsupported/);
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000,
    { kind: "government_office", id: "office:president" }, "x", nextRequest(), DATE, NOW, CATALOG), /treasury_destination_invalid/);
});

test("a payment that fails at any check leaves the treasury, the budget, the economy, and the events exactly as they were", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state, { funds: 1_000_000 });
  const payee = addCitizen(state, "Payee", { age: 30 });
  // Funds short by one naira: the economy checks pass, but the treasury check refuses before any write.
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1_000_001,
    { kind: "character", id: payee }, "Short", nextRequest(), DATE, NOW, CATALOG), /treasury_insufficient_funds/);
  // A refused request that is also a replay of nothing: no idempotency record is written either.
  assert.equal(Object.values(state.governmentExpenditure).length, 0);
  assert.equal(Object.values(state.economyTransactions).filter((t) => t.kind === "government_payment").length, 0);
});

test("a retry with the same request ID returns the first payment; a changed payload with that ID is refused", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state);
  const payee = addCitizen(state, "Payee", { age: 30 });
  const first = spendBudget(state, minister, budget.budget_id, 5_000_000, { kind: "character", id: payee }, "Once", "retry-1",
    DATE, NOW, CATALOG);
  const credited = cashAccountOf(state, payee).balance_ngn;
  const replay = spendBudget(state, minister, budget.budget_id, 5_000_000, { kind: "character", id: payee }, "Once", "retry-1",
    DATE, NOW, CATALOG);
  assert.equal(replay.replayed, true);
  assert.equal(replay.expenditure.recipient_transaction_id, first.expenditure.recipient_transaction_id);
  assert.equal(cashAccountOf(state, payee).balance_ngn, credited, "credited once");
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 6_000_000,
    { kind: "character", id: payee }, "Once", "retry-1", DATE, NOW, CATALOG), /treasury_idempotency_conflict/);
});

test("the audit reports a payment whose credit does not match, an orphan credit, and an old payment with no credit", () => {
  const state = makeState();
  const { minister, budget } = readyMinister(state);
  const payee = addCitizen(state, "Payee", { age: 30 });
  const { expenditure } = spendBudget(state, minister, budget.budget_id, 2_000_000, { kind: "character", id: payee }, "Audit",
    "audit-1", DATE, NOW, CATALOG);
  assert.deepEqual(auditTreasuryLedger(state), []);

  const transaction = state.economyTransactions[expenditure.recipient_transaction_id];
  transaction.amount_ngn += 1;
  assert.ok(auditTreasuryLedger(state).some((p) => p.includes("recipient credit does not match")));
  transaction.amount_ngn -= 1;

  const orphan = { ...transaction, transaction_id: "economy-tx-orphan", reference_id: "gov-exp-none" };
  state.economyTransactions[orphan.transaction_id] = orphan;
  assert.ok(auditTreasuryLedger(state).some((p) => p.includes("has no matching payment")));
  delete state.economyTransactions[orphan.transaction_id];

  // A payment written before Stage 32: debited, with no credit. The audit reports it; nothing is credited automatically.
  const legacy = recordGovernmentExpenditure(state, FINANCE, null, "exp:other", 500, "Legacy", null, null, DATE, NOW, CATALOG);
  state.governmentExpenditure[legacy.expenditure_id].destination_kind = "character";
  state.governmentExpenditure[legacy.expenditure_id].destination_id = payee;
  assert.ok(auditTreasuryLedger(state).some((p) => p.includes("recorded before its recipient was credited")));
});

test("the record validator refuses a forged funding marker or payment link", () => {
  const state = makeState({ withFunding: true });
  const row = Object.values(state.governmentRevenue).find((r) => r.funding_rule_id);
  row.funding_rule_id = { not: "an id" };
  assert.ok(validateGovernmentRecords(state).issues.some((i) => i.field === "funding_rule_id"));
  row.funding_rule_id = FUNDING.rule_id;

  const { minister, budget } = readyMinister(state);
  const payee = addCitizen(state, "Payee", { age: 30 });
  const { expenditure } = spendBudget(state, minister, budget.budget_id, 1000, { kind: "character", id: payee }, "V", "v-1",
    DATE, NOW, CATALOG);
  expenditure.recipient_transaction_id = { forged: true };
  assert.ok(validateGovernmentRecords(state).issues.some((i) => i.field === "recipient_transaction_id"));
});

// ─── Part B: socket path, every backend ───────────────────────────────────────

const opened = [];
before(connectBackends);
after(disconnectBackends);
afterEach(async () => {
  while (opened.length > 0) {
    const entry = opened.pop();
    for (const peer of entry.peers) peer.close();
    await entry.started.stop();
    await entry.backend.cleanup();
  }
});

const SERVER_OPTIONS = { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } };

async function session(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, SERVER_OPTIONS);
  const entry = { backend, started, peers: [] };
  opened.push(entry);
  return entry;
}

/** A real identity over the socket. Its birth date is set so that the age on the world date is `age`. */
async function citizen(entry, name, age) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = entry.backend.store.state.players[identity.playerId].character;
  character.age = age;
  character.date_of_birth = { year: entry.backend.store.state.worldClock.world_date.year - age, month: 1, day: 1 };
  return { peer, playerId: identity.playerId, sessionToken: identity.sessionToken, characterId: character.character_id };
}

function appointReal(backend, characterId, definitionId, organisationId) {
  const state = backend.store.state;
  const office = Object.values(state.governmentOffices)
    .find((o) => o.definition_id === definitionId && o.organisation_id === organisationId);
  assert.ok(office, `premise: ${definitionId} in ${organisationId}`);
  appointOfficial(state, office.office_id, characterId, "operator-seed", state.worldClock.world_date, Date.now(), CATALOG);
}

const financeBalance = (backend) => backend.store.state.governmentOrganisations[FINANCE].treasury_account.balance_ngn;
const TREASURY_REPLY = (reply) => reply.type === "government.result" || reply.type === "government.error";
const waitForGovernment = (peer) => peer.waitFor(TREASURY_REPLY, 20000);
const treasuryRequest = (action, requestId, payload = {}) => ({ type: "government.action", action, requestId, payload });
async function sendTreasury(peer, message) {
  peer.send(message);
  return waitForGovernment(peer);
}

/** Minister, payee, and an approved, allocated budget with funds. Saved, so the setup survives a restart. */
async function socketSetup(entry, { funds = 200_000_000 } = {}) {
  const backend = entry.backend;
  const minister = await citizen(entry, "Minister", 40);
  const payee = await citizen(entry, "Payee", 30);
  appointReal(backend, minister.characterId, "office:minister", FINANCE);
  const budget = budgetFor(backend.store.state, FINANCE);
  recordGovernmentRevenue(backend.store.state, FINANCE, "rev:transfer_in", funds, "Setup funds", `setup-${randomUUID()}`,
    backend.store.state.worldClock.world_date, Date.now(), CATALOG);
  const approved = await sendTreasury(minister.peer, treasuryRequest("approve_budget", "s-approve", {
    budget_id: budget.budget_id, approved_amount_ngn: 500_000_000,
  }));
  assert.equal(approved.type, "government.result", JSON.stringify(approved));
  const allocated = await sendTreasury(minister.peer, treasuryRequest("allocate_budget", "s-allocate", {
    budget_id: budget.budget_id, amount_ngn: 400_000_000,
  }));
  assert.equal(allocated.type, "government.result", JSON.stringify(allocated));
  await backend.store.flush();
  return { minister, payee, budget };
}

const payeeCash = (backend, characterId) => cashAccountOf(backend.store.state, characterId).balance_ngn;
const expenditureCount = (backend) => Object.keys(backend.store.state.governmentExpenditure).length;
const creditCount = (backend) => Object.values(backend.store.state.economyTransactions)
  .filter((t) => t.kind === "government_payment").length;

/**
 * Simulates a crash. The store is killed first, so no write reaches storage from here on: a closing socket runs its
 * disconnect save, and that save must not happen in a process that has died. The server is closed without its shutdown.
 */
async function crash(entry) {
  entry.backend.store.kill();
  entry.started.server.closeAllConnections();
  entry.started.server.close();
  for (const peer of entry.peers) peer.close();
  entry.peers = [];
  entry.started = { stop: async () => {} };
  // Give the closed sockets a moment to run their (refused) disconnect saves before the storage is reopened.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * A new server process over the same storage, reloaded from what was saved. A graceful stop first lets the old
 * process finish the saves its closing sockets start, because in production the old process has exited before the
 * new one starts. (Without the pause, an old save can land after the new process has loaded the row, which is then
 * refused as a stale write.)
 */
async function restart(entry, { afterGracefulStop = false } = {}) {
  if (afterGracefulStop) {
    await entry.started.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await entry.backend.reopen();
  entry.started = await startOver(entry.backend, SERVER_OPTIONS);
}

async function resumeAs(entry, who) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  await resumeSession(peer, who.sessionToken);
  return peer;
}

/**
 * Makes this writer lose its storage: another writer has taken over. PostgreSQL: the saved version moves on. File: the
 * lock file is replaced by a token this writer does not hold.
 */
async function fenceWriter(entry) {
  if (entry.backend.name === "postgres") {
    await entry.backend.restoreDurable(await entry.backend.durableState());
    return;
  }
  entry.backend.store.inner.acquireWriterLock();
  writeFileSync(`${entry.backend.filePath}.lock`, `${JSON.stringify({ pid: process.pid, token: randomUUID(), acquired_at: new Date().toISOString() })}\n`);
}

for (const backendName of backendNames) {
  const label = (text) => `${backendName}: ${text}`;

  test(label("a payment over the socket credits the payee in the same save, and the reply names the credit"), async () => {
    const entry = await session(backendName);
    const { minister, payee, budget } = await socketSetup(entry);
    const payeeStart = payeeCash(entry.backend, payee.characterId);
    const start = financeBalance(entry.backend);
    const reply = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "sp-1", {
      budget_id: budget.budget_id, amount_ngn: 30_000_000, destination: { kind: "character", id: payee.characterId }, reason: "Supplies",
    }));
    assert.equal(reply.type, "government.result", JSON.stringify(reply));
    assert.equal(reply.data.replayed, false);
    assert.ok(reply.data.expenditure.recipient_transaction_id, "the reply names the credit");
    assert.equal(financeBalance(entry.backend), start - 30_000_000);
    assert.equal(payeeCash(entry.backend, payee.characterId), payeeStart + 30_000_000);
    assert.deepEqual(auditTreasuryLedger(entry.backend.store.state), []);
    // The save that the reply waited for holds both the debit and the credit.
    const durable = await entry.backend.durableState();
    assert.equal(Object.values(durable.governmentExpenditure).filter((e) => e.idempotency_key === reply.data.expenditure.idempotency_key).length, 1);
    assert.ok(durable.economyTransactions[reply.data.expenditure.recipient_transaction_id], "the credit is in the saved world");
    assert.equal(durable.governmentOrganisations[FINANCE].treasury_account.balance_ngn, start - 30_000_000);
  });

  test(label("the client cannot fund a treasury: every funding-style action is refused and nothing changes"), async () => {
    const entry = await session(backendName);
    const { minister, budget } = await socketSetup(entry);
    const before = JSON.stringify(entry.backend.store.state, (key, value) => (key === "lastSeen" || key === "lastActivityAt" ? undefined : value));
    for (const action of ["fund_treasury", "record_revenue", "fund_budget", "mint_funds"]) {
      const reply = await sendTreasury(minister.peer, treasuryRequest(action, `fund-${action}`, {
        organisation_id: FINANCE, amount_ngn: 999_000_000, budget_id: budget.budget_id, category_id: "rev:grant",
      }));
      assert.equal(reply.type, "government.error", `${action} is refused`);
      assert.equal(reply.code, "government_writes_suspended");
    }
    assert.equal(JSON.stringify(entry.backend.store.state, (key, value) => (key === "lastSeen" || key === "lastActivityAt" ? undefined : value)), before);
  });

  test(label("a save that fails is not confirmed; the same request ID after recovery credits the payee once"), async () => {
    const entry = await session(backendName);
    const { minister, payee, budget } = await socketSetup(entry);
    const payeeStart = payeeCash(entry.backend, payee.characterId);
    const payload = { budget_id: budget.budget_id, amount_ngn: 25_000_000, destination: { kind: "character", id: payee.characterId }, reason: "Repairs" };

    entry.backend.store.failNextWrite("disk full");
    const first = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "pay-fail", payload));
    assert.equal(first.type, "government.error", "the reply is not a confirmation");
    assert.equal(first.code, "treasury_not_saved");

    // The change is held in memory until a save succeeds. The retry with the same request ID confirms it.
    const retry = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "pay-fail", payload));
    assert.equal(retry.type, "government.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, true, "the first payment is replayed, not made again");
    assert.equal(payeeCash(entry.backend, payee.characterId), payeeStart + 25_000_000, "credited once");
    assert.equal(expenditureCount(entry.backend), 1);
    assert.equal(creditCount(entry.backend), 1);
    assert.deepEqual(auditTreasuryLedger(entry.backend.store.state), []);
    const durable = await entry.backend.durableState();
    assert.equal(Object.keys(durable.governmentExpenditure).length, 1, "the confirmed payment is in the saved world");
  });

  test(label("a save that commits but loses its reply is retried safely: the payment is replayed, not repeated"), async () => {
    const entry = await session(backendName);
    const { minister, payee, budget } = await socketSetup(entry);
    const payload = { budget_id: budget.budget_id, amount_ngn: 12_000_000, destination: { kind: "character", id: payee.characterId }, reason: "Lost reply" };
    entry.backend.store.failNextWriteAfterCommit("response lost");
    const first = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "pay-lost", payload));
    assert.equal(first.type, "government.error");
    // The save committed before the failure was reported, so the outcome is unknown, not "not saved" (Stage 33).
    assert.equal(first.code, "treasury_outcome_unknown", "an uncertain outcome is never reported as success or as not saved");

    const retry = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "pay-lost", payload));
    assert.equal(retry.type, "government.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, true);
    assert.equal(expenditureCount(entry.backend), 1);
    assert.equal(creditCount(entry.backend), 1);
    assert.deepEqual(auditTreasuryLedger(entry.backend.store.state), []);
  });

  test(label("a crash after a failed save: the restarted world has no payment, and the retry pays once"), async () => {
    const entry = await session(backendName);
    const { minister, payee, budget } = await socketSetup(entry);
    const payload = { budget_id: budget.budget_id, amount_ngn: 9_000_000, destination: { kind: "character", id: payee.characterId }, reason: "Crash" };
    const durableBefore = await entry.backend.durableState();
    const balanceBefore = financeBalance(entry.backend);

    entry.backend.store.failNextWrite("disk gone");
    const refused = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "pay-crash", payload));
    assert.equal(refused.code, "treasury_not_saved");
    await crash(entry);

    await restart(entry);
    assert.equal(financeBalance(entry.backend), balanceBefore, "the restarted world has the balance it saved");
    assert.equal(expenditureCount(entry.backend), Object.keys(durableBefore.governmentExpenditure).length);
    const peer = await resumeAs(entry, minister);
    const retry = await sendTreasury(peer, treasuryRequest("spend_budget", "pay-crash", payload));
    assert.equal(retry.type, "government.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, false, "nothing was saved, so this is the first payment");
    assert.equal(financeBalance(entry.backend), balanceBefore - 9_000_000);
    assert.equal(expenditureCount(entry.backend), 1);
    assert.equal(creditCount(entry.backend), 1);
    const durable = await entry.backend.durableState();
    assert.equal(Object.keys(durable.governmentExpenditure).length, 1);
    assert.deepEqual(auditTreasuryLedger(entry.backend.store.state), []);
  });

  test(label("a crash after a committed save with a lost reply: the restarted world holds the payment, and a retry replays it"), async () => {
    const entry = await session(backendName);
    const { minister, payee, budget } = await socketSetup(entry);
    const payeeStart = payeeCash(entry.backend, payee.characterId);
    const payload = { budget_id: budget.budget_id, amount_ngn: 7_000_000, destination: { kind: "character", id: payee.characterId }, reason: "Committed" };
    entry.backend.store.failNextWriteAfterCommit("reply lost");
    const refused = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "pay-committed", payload));
    // The save committed before the failure was reported, so the outcome is unknown (Stage 33).
    assert.equal(refused.code, "treasury_outcome_unknown");
    await crash(entry);

    await restart(entry);
    const peer = await resumeAs(entry, minister);
    const retry = await sendTreasury(peer, treasuryRequest("spend_budget", "pay-committed", payload));
    assert.equal(retry.type, "government.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, true, "the saved payment is replayed");
    assert.equal(expenditureCount(entry.backend), 1);
    assert.equal(creditCount(entry.backend), 1);
    assert.equal(payeeCash(entry.backend, payee.characterId), payeeStart + 7_000_000, "credited once in total");
    assert.deepEqual(auditTreasuryLedger(entry.backend.store.state), []);
  });

  test(label("the initial funding survives a restart and is not applied a second time"), async () => {
    const entry = await session(backendName);
    await citizen(entry, "First", 30);
    const funded = financeBalance(entry.backend);
    assert.equal(funded, FUNDING.amount_ngn, "the world was funded when it was created");
    await entry.backend.store.flush();
    await restart(entry, { afterGracefulStop: true });
    const peer = await openPeer(entry.started.websocketUrl);
    entry.peers.push(peer);
    const again = await createIdentity(peer, "Second");
    await resumeSession(peer, again.sessionToken);
    assert.equal(financeBalance(entry.backend), FUNDING.amount_ngn, "a restart and a new session do not fund it again");
    const rows = Object.values(entry.backend.store.state.governmentRevenue).filter((r) => r.funding_rule_id === FUNDING.rule_id);
    assert.equal(rows.length, 1, "one funding row in the world");
    assert.deepEqual(auditTreasuryLedger(entry.backend.store.state), []);
  });

  test(label("a failed save refuses the next new treasury change before it changes anything, and the recorded request is confirmed once saving works"), async () => {
    const entry = await session(backendName);
    const { minister, payee, budget } = await socketSetup(entry);
    const payload = (reason) => ({ budget_id: budget.budget_id, amount_ngn: 4_000_000, destination: { kind: "character", id: payee.characterId }, reason });
    const payeeStart = payeeCash(entry.backend, payee.characterId);
    const start = financeBalance(entry.backend);
    // Saving fails for as long as failures are queued, so no automatic retry can succeed during these checks.
    for (let i = 0; i < 1000; i += 1) entry.backend.store.failNextWrite("disk unavailable");

    const first = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "gate-a", payload("First")));
    assert.equal(first.type, "government.error");
    assert.equal(first.code, "treasury_not_saved", "a save that failed before any write is reported as not saved");
    const afterFirst = { balance: financeBalance(entry.backend), expenditures: expenditureCount(entry.backend), payee: payeeCash(entry.backend, payee.characterId) };

    const second = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "gate-b", payload("Second")));
    assert.equal(second.type, "government.error", JSON.stringify(second));
    assert.equal(second.code, "treasury_persistence_unavailable", "a new payment is refused while saving is failing");
    const approve = await sendTreasury(minister.peer, treasuryRequest("approve_budget", "gate-approve", {
      budget_id: budget.budget_id, approved_amount_ngn: 500_000_000,
    }));
    assert.equal(approve.code, "treasury_persistence_unavailable", "an approval is refused while saving is failing");
    assert.equal(financeBalance(entry.backend), afterFirst.balance, "a refused request debits nothing");
    assert.equal(expenditureCount(entry.backend), afterFirst.expenditures, "a refused request records nothing");
    assert.equal(payeeCash(entry.backend, payee.characterId), afterFirst.payee, "a refused request credits nothing");

    entry.backend.store.clearFailures();
    const retry = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "gate-a", payload("First")));
    assert.equal(retry.type, "government.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, true, "the recorded request is replayed, not applied again");
    assert.equal(expenditureCount(entry.backend), afterFirst.expenditures, "one payment in total");
    assert.equal(payeeCash(entry.backend, payee.characterId), payeeStart + 4_000_000, "credited once");
    assert.equal(financeBalance(entry.backend), start - 4_000_000, "debited once");

    const fresh = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "gate-b", payload("Second")));
    assert.equal(fresh.type, "government.result", JSON.stringify(fresh));
    assert.equal(fresh.data.replayed, false, "with saving working again, a new request is accepted");
    assert.equal(financeBalance(entry.backend), start - 8_000_000);
    const durable = await entry.backend.durableState();
    assert.equal(Object.keys(durable.governmentExpenditure).length, expenditureCount(entry.backend), "the saved world matches memory");
    assert.equal(durable.governmentOrganisations[FINANCE].treasury_account.balance_ngn, start - 8_000_000);
    assert.deepEqual(auditTreasuryLedger(entry.backend.store.state), []);
  });

  test(label("a fenced writer refuses new treasury changes after its first refused save, and never confirms one"), async () => {
    const entry = await session(backendName);
    const { minister, payee, budget } = await socketSetup(entry);
    const durableBefore = Object.keys((await entry.backend.durableState()).governmentExpenditure).length;
    await fenceWriter(entry);
    const payload = (reason) => ({ budget_id: budget.budget_id, amount_ngn: 3_000_000, destination: { kind: "character", id: payee.characterId }, reason });

    const first = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "fence-a", payload("Fenced")));
    assert.equal(first.code, "treasury_not_saved", "the fenced save is refused before any write");
    const memory = { balance: financeBalance(entry.backend), expenditures: expenditureCount(entry.backend) };

    const second = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "fence-b", payload("Refused")));
    assert.equal(second.code, "treasury_persistence_unavailable", "a fenced writer accepts no new treasury change");
    assert.equal(financeBalance(entry.backend), memory.balance);
    assert.equal(expenditureCount(entry.backend), memory.expenditures);
    const durable = await entry.backend.durableState();
    assert.equal(Object.keys(durable.governmentExpenditure).length, durableBefore, "nothing from this writer reached storage");
    // This instance is fenced for good: it is ended as a crash, because a graceful stop would try to save.
    await crash(entry);
  });

  if (backendName === "postgres") {
    test(label("a fenced writer never confirms a payment: another writer saved first, so the payment is refused as not saved"), async () => {
      const entry = await session(backendName);
      const { minister, payee, budget } = await socketSetup(entry);
      // Another instance writes the world, so this instance's version is out of date and its next save is fenced.
      await entry.backend.restoreDurable(await entry.backend.durableState());
      const reply = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "pay-fenced", {
        budget_id: budget.budget_id, amount_ngn: 3_000_000, destination: { kind: "character", id: payee.characterId }, reason: "Fenced",
      }));
      assert.equal(reply.type, "government.error", JSON.stringify(reply));
      assert.equal(reply.code, "treasury_not_saved");
      const durable = await entry.backend.durableState();
      assert.equal(Object.values(durable.governmentExpenditure).filter((e) => e.idempotency_key && e.destination_id === payee.characterId).length, 0,
        "the other writer's saved world has no fenced payment");
      // This instance is fenced for good: it is ended as a crash, because a graceful stop would try to save.
      await crash(entry);
    });
  }
}

// ─── Two writers on one PostgreSQL world (Stage 33) ───────────────────────────
// Each writer is its own store instance with its own copy of the saved world, loaded at the same version, so every
// save is checked against the stored version as two server processes would be. The cross-process runs of that check
// are in multiprocess-persistence.test.mjs.
if (backendNames.includes("postgres")) {
  const twoWriters = (text, fn) => test(`postgres: ${text}`, { timeout: 120_000 }, fn);

  /** The setup (a minister, a payee, an approved and allocated budget) is saved by a server; that server is then ended. */
  async function setupForWriters() {
    const entry = await session("postgres");
    const { minister, payee, budget } = await socketSetup(entry);
    const worldKey = entry.backend.worldKey;
    await crash(entry); // the server's own store is ended; the two writers below are the only writers
    const first = await PostgresWorldStore.open({ db: database, worldKey });
    const second = await PostgresWorldStore.open({ db: database, worldKey });
    assert.equal(second.getVersion(), first.getVersion(), "premise: both writers start from the same saved version");
    return { entry, worldKey, first, second, minister, payee, budgetId: budget.budget_id };
  }
  const treasuryBalanceOf = (state) => state.governmentOrganisations[FINANCE].treasury_account.balance_ngn;
  const payeeCashOf = (state, characterId) => cashAccountOf(state, characterId).balance_ngn;
  const savedWorld = async (worldKey) => (await database.queryOne("SELECT value FROM world_state WHERE key = $1", [worldKey])).value;

  twoWriters("two writers: the stale writer's payment is refused as not saved, and the saved world holds only the first payment", async () => {
    const { entry, worldKey, first, second, minister, payee, budgetId } = await setupForWriters();
    const date = first.state.worldClock.world_date;
    const start = treasuryBalanceOf(first.state);
    const payeeStart = payeeCashOf(first.state, payee.characterId);

    spendBudget(first.state, minister.characterId, budgetId, 10_000_000, { kind: "character", id: payee.characterId }, "First", "pay-first", date, Date.now(), CATALOG);
    await first.flush();

    spendBudget(second.state, minister.characterId, budgetId, 5_000_000, { kind: "character", id: payee.characterId }, "Second", "pay-second", date, Date.now(), CATALOG);
    const refused = await second.flush().then(() => null, (error) => error);
    assert.ok(refused instanceof WorldStateConflictError, "the stale save is refused by the version check");
    assert.equal(saveOutcomeOf(refused), "not_saved", "the version check refused before any change was applied");
    assert.equal(classifySaveFailure(refused), "conflict");
    assert.equal(second.isFenced(), true, "the stale writer is fenced");
    const again = await second.flush().then(() => null, (error) => error);
    assert.ok(again instanceof WorldStateConflictError, "a fenced writer never saves again");
    assert.equal(saveOutcomeOf(again), "not_saved");

    const durable = await savedWorld(worldKey);
    assert.equal(treasuryBalanceOf(durable), start - 10_000_000, "only the first payment was debited");
    assert.equal(Object.values(durable.governmentExpenditure).length, 1, "one payment is saved");
    assert.equal(payeeCashOf(durable, payee.characterId), payeeStart + 10_000_000, "only the first payment was credited");
    assert.deepEqual(auditTreasuryLedger(durable), [], "the saved ledger is consistent");
    await crash(entry).catch(() => {});
  });

  twoWriters("two writers: a restart loads what was saved, and the refused payment can be made again under its own request", async () => {
    const { entry, worldKey, first, second, minister, payee, budgetId } = await setupForWriters();
    const date = first.state.worldClock.world_date;
    const start = treasuryBalanceOf(first.state);
    spendBudget(first.state, minister.characterId, budgetId, 10_000_000, { kind: "character", id: payee.characterId }, "First", "restart-first", date, Date.now(), CATALOG);
    await first.flush();
    spendBudget(second.state, minister.characterId, budgetId, 5_000_000, { kind: "character", id: payee.characterId }, "Second", "restart-second", date, Date.now(), CATALOG);
    await second.flush().then(() => assert.fail("the stale save must be refused"), (error) => assert.ok(error instanceof WorldStateConflictError));

    // A new process loads the saved world. It holds the first payment and not the refused one.
    const restarted = await PostgresWorldStore.open({ db: database, worldKey });
    assert.equal(treasuryBalanceOf(restarted.state), start - 10_000_000);
    assert.equal(restarted.isFenced(), false);
    assert.deepEqual(auditTreasuryLedger(restarted.state), []);

    // The refused payment is made again under the same request ID. It is applied once, and only now.
    const retry = spendBudget(restarted.state, minister.characterId, budgetId, 5_000_000, { kind: "character", id: payee.characterId }, "Second", "restart-second", date, Date.now(), CATALOG);
    assert.equal(retry.replayed, false, "nothing was saved for this request, so this is the first application");
    await restarted.flush();
    const durable = await savedWorld(worldKey);
    assert.equal(treasuryBalanceOf(durable), start - 15_000_000);
    assert.equal(Object.values(durable.governmentExpenditure).length, 2);
    assert.deepEqual(auditTreasuryLedger(durable), []);
    await crash(entry).catch(() => {});
  });
}

