// Stage 40: business accounts and money-safe business operations.
//
// Part 1 tests the service directly, on the in-memory fixture. Part 2 runs through the socket, on each configured backend
// (the file backend always, and PostgreSQL when a disposable database is configured). The rules are in
// docs/STAGE_40_BUSINESS_ACCOUNTS.md.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { addPlayer, makeWorld } from "./support/business-world.mjs";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";
import { loadBusinessCatalog } from "../dist/businesses/catalog.js";
import {
  addBusinessProduct,
  businessAccountKey,
  closeBusiness,
  createBusiness,
  hireEmployee,
  migrateLegacyBusinessAccounts,
  paySalary,
  purchaseProduct,
  purchaseService,
  recordBusinessExpense,
  restockInventory,
  runProduction,
  seedNpcBusinesses,
  transferBetweenBusinesses,
  withdrawFromBusiness,
  businessAccountMismatches,
} from "../dist/businesses/service.js";

before(connectBackends);
after(disconnectBackends);

/** The money the economy holds for players and businesses: cash accounts plus business accounts. */
function totalMoney(state) {
  return Object.values(state.economyAccounts)
    .filter((a) => a.kind === "cash" || a.kind === "current")
    .reduce((sum, a) => sum + a.balance_ngn, 0);
}

const accountOf = (state, businessId) => state.economyAccounts[businessAccountKey(businessId)].balance_ngn;
const cashOf = (state, characterId) => Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;
const ledgerKinds = (state, businessId) => Object.values(state.economyTransactions)
  .filter((r) => r.account_id === businessAccountKey(businessId)).map((r) => r.kind);

/** Every map a refused action must leave unchanged. */
function snapshot(state) {
  return JSON.stringify({
    accounts: state.economyAccounts,
    ledger: state.economyTransactions,
    businesses: state.businesses,
    ownership: state.businessOwnership,
    inventory: state.businessInventory,
    movements: state.businessInventoryMovements,
    sales: state.businessSales,
    journal: state.businessTransactions,
    events: state.businessEvents,
    runs: state.businessProductionRuns,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 1: the service, directly.
// ---------------------------------------------------------------------------------------------------------------------

test("creation moves the setup fee and the capital through the ledger, and the only money that leaves is the setup fee", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId } = addPlayer(world, "Owner", { age: 30, money: 500000 });
  const template = catalog.templates.find((t) => t.id === "template:provision-store");
  const before = totalMoney(world.state);

  const business = createBusiness(world.state, characterId, template.id, "Ledger Shop", "Shop.", "market", 100000, world.date, 480, world.now, catalog);

  assert.equal(accountOf(world.state, business.business_id), 100000);
  assert.equal(business.balance_ngn, 100000, "the business record shows its account balance");
  assert.equal(totalMoney(world.state), before - template.setup_cost_ngn, "capital moved; only the setup fee left the economy");
  assert.deepEqual(ledgerKinds(world.state, business.business_id), ["business_capital"]);
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("a buyer pays from their own cash; the business is credited in the same movement, and money is conserved", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Owner", { age: 30, money: 500000 });
  const { characterId: buyerId } = addPlayer(world, "Buyer", { age: 30, money: 50000 });
  const business = createBusiness(world.state, ownerId, "template:provision-store", "Pay Shop", "Shop.", "market", 0, world.date, 480, world.now, catalog);
  const product = addBusinessProduct(world.state, business.business_id, ownerId, "biz-goods:bread", null, world.date, 481, world.now, catalog);
  restockInventory(world.state, business.business_id, ownerId, "biz-goods:bread", 4, 0, world.date, 482, world.now, catalog);
  const before = totalMoney(world.state);
  const buyerBefore = cashOf(world.state, buyerId);

  const { sale, revenue_transaction } = purchaseProduct(world.state, business.business_id, product.product_record_id, buyerId, 2, world.date, 483, world.now, catalog);

  assert.equal(cashOf(world.state, buyerId), buyerBefore - sale.total_ngn);
  assert.equal(accountOf(world.state, business.business_id), sale.total_ngn);
  assert.equal(business.balance_ngn, sale.total_ngn);
  assert.equal(totalMoney(world.state), before, "a purchase moves money, and creates none");
  assert.equal(revenue_transaction.kind, "sale_product");
  assert.equal(sale.buyer_character_id, buyerId, "the sale names the buyer who paid");
  assert.deepEqual(ledgerKinds(world.state, business.business_id).slice(-1), ["business_sale"]);
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("a seller cannot record a sale: an owner cannot buy from their own business, and a poor buyer is refused with nothing changed", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Owner", { age: 30, money: 500000 });
  const { characterId: poorId } = addPlayer(world, "Poor", { age: 30, money: 100 });
  const business = createBusiness(world.state, ownerId, "template:provision-store", "Guarded Shop", "Shop.", "market", 0, world.date, 480, world.now, catalog);
  const product = addBusinessProduct(world.state, business.business_id, ownerId, "biz-goods:bread", null, world.date, 481, world.now, catalog);
  restockInventory(world.state, business.business_id, ownerId, "biz-goods:bread", 4, 0, world.date, 482, world.now, catalog);

  const before = snapshot(world.state);
  assert.throws(() => purchaseProduct(world.state, business.business_id, product.product_record_id, ownerId, 1, world.date, 483, world.now, catalog),
    /business_self_purchase/);
  assert.equal(snapshot(world.state), before, "the refused self-purchase changed nothing");

  assert.throws(() => purchaseProduct(world.state, business.business_id, product.product_record_id, poorId, 1, world.date, 484, world.now, catalog),
    /business_insufficient_funds/);
  assert.equal(snapshot(world.state), before, "the refused purchase changed nothing");
});

test("a service is paid for by the buyer, and needs no stock", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Consultant", { age: 30, money: 500000 });
  const { characterId: clientId } = addPlayer(world, "Client", { age: 30, money: 500000 });
  const business = createBusiness(world.state, ownerId, "template:consulting-firm", "Advisory Co", "Consulting.", "town", 0, world.date, 480, world.now, catalog);
  const product = addBusinessProduct(world.state, business.business_id, ownerId, "biz-service:consulting-hour", null, world.date, 481, world.now, catalog);
  const clientBefore = cashOf(world.state, clientId);
  const { sale } = purchaseService(world.state, business.business_id, product.product_record_id, clientId, world.date, 482, world.now, catalog);
  assert.equal(sale.is_service, true);
  assert.equal(cashOf(world.state, clientId), clientBefore - 15000);
  assert.equal(accountOf(world.state, business.business_id), 15000);
});

test("refused operations change nothing: restock and production refuse before stock moves", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId } = addPlayer(world, "Cook", { age: 30, money: 500000 });
  const business = createBusiness(world.state, characterId, "template:restaurant", "Refused Kitchen", "Food.", "town", 0, world.date, 480, world.now, catalog);

  const before = snapshot(world.state);
  assert.throws(() => restockInventory(world.state, business.business_id, characterId, "biz-goods:rice-5kg", 5, 7000, world.date, 481, world.now, catalog),
    /business_insufficient_funds/);
  assert.equal(snapshot(world.state), before, "a restock the business cannot pay for leaves inventory as it was");

  assert.throws(() => runProduction(world.state, business.business_id, characterId, "recipe:jollof-rice", world.date, 482, world.now, catalog));
  assert.equal(snapshot(world.state), before, "a refused production run changes nothing");
});

test("withdrawals are for owners and co-owners only, and the money goes to the caller's own cash", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Owner", { age: 30, money: 500000 });
  const { characterId: manager } = addPlayer(world, "Manager", { age: 30, money: 1000 });
  const { characterId: stranger } = addPlayer(world, "Stranger", { age: 30, money: 1000 });
  const business = createBusiness(world.state, ownerId, "template:provision-store", "Owned Shop", "Shop.", "market", 200000, world.date, 480, world.now, catalog);
  world.state.businessOwnership["biz-own-manager-stage40"] = {
    ownership_id: "biz-own-manager-stage40", business_id: business.business_id, character_id: manager, role: "manager", share_percent: 0,
    created_at: business.created_at, created_world_date: business.created_world_date, updated_at: business.created_at, is_founder: false, active: true,
  };

  const before = snapshot(world.state);
  assert.throws(() => withdrawFromBusiness(world.state, business.business_id, stranger, 1000, world.date, 481, world.now, catalog), /business_unauthorized/);
  assert.throws(() => withdrawFromBusiness(world.state, business.business_id, manager, 1000, world.date, 481, world.now, catalog), /business_unauthorized/);
  assert.equal(snapshot(world.state), before, "refused withdrawals changed nothing");

  const ownerBefore = cashOf(world.state, ownerId);
  const strangerBefore = cashOf(world.state, stranger);
  withdrawFromBusiness(world.state, business.business_id, ownerId, 30000, world.date, 482, world.now, catalog);
  assert.equal(cashOf(world.state, ownerId), ownerBefore + 30000, "the owner receives the money");
  assert.equal(cashOf(world.state, stranger), strangerBefore, "nobody else is credited");
  assert.equal(accountOf(world.state, business.business_id), 170000);
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("payroll pays only an active employee, and a salary cannot be recorded as an ordinary expense", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Owner", { age: 30, money: 500000 });
  const { characterId: workerId } = addPlayer(world, "Worker", { age: 25, money: 0 });
  const { characterId: outsiderId } = addPlayer(world, "Outsider", { age: 25, money: 0 });
  const business = createBusiness(world.state, ownerId, "template:provision-store", "Payroll Shop", "Shop.", "market", 100000, world.date, 480, world.now, catalog);

  assert.throws(() => recordBusinessExpense(world.state, business.business_id, ownerId, "salary", 5000, "Wages.", world.date, 481, world.now),
    /business_salary_use_payroll/);
  assert.throws(() => paySalary(world.state, business.business_id, ownerId, outsiderId, 5000, world.date, 481, world.now, catalog),
    /business_salary_employee_invalid/);

  hireEmployee(world.state, business.business_id, ownerId, workerId, world.date, 482, world.now, catalog);
  const workerBefore = cashOf(world.state, workerId);
  paySalary(world.state, business.business_id, ownerId, workerId, 5000, world.date, 483, world.now, catalog);
  assert.equal(cashOf(world.state, workerId), workerBefore + 5000, "the employee is paid into their own cash");
  assert.equal(accountOf(world.state, business.business_id), 95000);
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("money moves between two businesses only when the caller owns both; the total is unchanged", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Owner", { age: 30, money: 500000 });
  const { characterId: otherId } = addPlayer(world, "Other", { age: 30, money: 500000 });
  const source = createBusiness(world.state, ownerId, "template:provision-store", "Source Shop", "Shop.", "market", 80000, world.date, 480, world.now, catalog);
  const foreign = createBusiness(world.state, otherId, "template:provision-store", "Foreign Shop", "Shop.", "market", 0, world.date, 481, world.now, catalog);

  assert.throws(() => transferBetweenBusinesses(world.state, source.business_id, ownerId, foreign.business_id, 1000, world.date, 482, world.now, catalog),
    /business_transfer_not_permitted/);
  assert.throws(() => transferBetweenBusinesses(world.state, source.business_id, ownerId, source.business_id, 1000, world.date, 482, world.now, catalog),
    /business_transfer_invalid/);
  assert.equal(accountOf(world.state, source.business_id), 80000, "refused transfers changed nothing");

  const second = createBusiness(world.state, ownerId, "template:provision-store", "Second Shop", "Shop.", "market", 0, world.date, 483, world.now, catalog);
  const before = totalMoney(world.state);
  transferBetweenBusinesses(world.state, source.business_id, ownerId, second.business_id, 25000, world.date, 484, world.now, catalog);
  assert.equal(accountOf(world.state, source.business_id), 55000);
  assert.equal(accountOf(world.state, second.business_id), 25000);
  assert.equal(totalMoney(world.state), before, "a transfer moves money and creates none");
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("NPC seed capital is an explicit issuance row, not an unexplained balance", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const before = totalMoney(world.state);
  const seeded = seedNpcBusinesses(world.state, ["npc-alpha-001", "npc-beta-002"], world.date, world.now, catalog);
  assert.equal(seeded.length, 2);
  const issued = seeded.reduce((sum, b) => sum + accountOf(world.state, b.business_id), 0);
  assert.equal(totalMoney(world.state) - before, issued, "the only change is the issuance, and it is recorded per business");
  for (const business of seeded) {
    assert.deepEqual(ledgerKinds(world.state, business.business_id), ["business_seed_capital"]);
  }
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("a legacy business balance is carried into an account once, as an explicit import, and the import changes no other money", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId } = addPlayer(world, "Legacy Owner", { age: 30, money: 500000 });
  const business = createBusiness(world.state, characterId, "template:provision-store", "Legacy Shop", "Shop.", "market", 0, world.date, 480, world.now, catalog);
  // Simulate a Stage 39 save: the balance is on the record, there is no account, and no ledger rows exist for it.
  delete world.state.economyAccounts[businessAccountKey(business.business_id)];
  business.balance_ngn = 7000;
  business.total_revenue_ngn = 9000;
  const before = totalMoney(world.state);

  assert.deepEqual(businessAccountMismatches(world.state), [], "a business with no account is not yet a mismatch");
  assert.equal(migrateLegacyBusinessAccounts(world.state, world.date, world.now), 1);
  assert.equal(accountOf(world.state, business.business_id), 7000);
  assert.equal(business.balance_ngn, 7000);
  assert.deepEqual(ledgerKinds(world.state, business.business_id), ["business_legacy_import"]);
  assert.equal(totalMoney(world.state) - before, 7000, "the import is the recorded amount, and is shown as an import");
  const event = Object.values(world.state.businessEvents).find((e) => e.business_id === business.business_id && e.type === "legacy_balance_imported");
  assert.equal(event.details.imported_ngn, 7000);
  assert.equal(event.details.legacy_recorded_revenue_ngn, 9000, "the old revenue figure is kept for reconciliation, not treated as verified");

  assert.equal(migrateLegacyBusinessAccounts(world.state, world.date, world.now), 0, "a second run does nothing");
  assert.equal(accountOf(world.state, business.business_id), 7000);
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("a legacy balance above the account limit is refused and nothing is created for it", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId } = addPlayer(world, "Rich Legacy", { age: 30, money: 500000 });
  const business = createBusiness(world.state, characterId, "template:provision-store", "Big Legacy", "Shop.", "market", 0, world.date, 480, world.now, catalog);
  delete world.state.economyAccounts[businessAccountKey(business.business_id)];
  business.balance_ngn = Number.MAX_SAFE_INTEGER;
  const before = snapshot(world.state);
  assert.throws(() => migrateLegacyBusinessAccounts(world.state, world.date, world.now), /business_legacy_balance_over_limit/);
  assert.equal(snapshot(world.state), before, "the failed migration changed nothing");
});

test("the reconciliation finds a business whose record or ledger disagrees with its account", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId } = addPlayer(world, "Auditee", { age: 30, money: 500000 });
  const business = createBusiness(world.state, characterId, "template:provision-store", "Audited Shop", "Shop.", "market", 50000, world.date, 480, world.now, catalog);
  assert.deepEqual(businessAccountMismatches(world.state), []);

  business.balance_ngn += 1;
  assert.equal(businessAccountMismatches(world.state).length, 1);
  business.balance_ngn -= 1;

  const account = world.state.economyAccounts[businessAccountKey(business.business_id)];
  account.balance_ngn += 1;
  business.balance_ngn += 1;
  assert.match(businessAccountMismatches(world.state)[0], /ledger rows/);
  account.balance_ngn -= 1;
  business.balance_ngn -= 1;
  assert.deepEqual(businessAccountMismatches(world.state), []);
});

test("a business with money cannot be closed; once its balance is withdrawn it can", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId } = addPlayer(world, "Closer", { age: 30, money: 500000 });
  const business = createBusiness(world.state, characterId, "template:provision-store", "Closing Ledger", "Shop.", "market", 3000, world.date, 480, world.now, catalog);
  assert.throws(() => closeBusiness(world.state, business.business_id, characterId, "Done.", world.date, 481, world.now), /business_balance_not_empty/);
  withdrawFromBusiness(world.state, business.business_id, characterId, 3000, world.date, 482, world.now, catalog);
  closeBusiness(world.state, business.business_id, characterId, "Done.", world.date, 483, world.now);
  assert.equal(accountOf(world.state, business.business_id), 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// Part 2: through the socket, on each backend.
// ---------------------------------------------------------------------------------------------------------------------

/** A citizen with money in hand, as business-money-stage34.test.mjs creates them. */
async function citizen(backend, started, name, money) {
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const identity = await createIdentity(peer, name);
  assert.equal((await resumeSession(peer, identity.sessionToken)).type, "session.ready");
  const player = backend.store.state.players[identity.playerId];
  const worldDate = backend.store.state.worldClock.world_date;
  player.character.date_of_birth = { year: worldDate.year - 30, month: 1, day: 1 };
  player.character.age = 30;
  player.character.money = money;
  for (const account of Object.values(backend.store.state.economyAccounts)) {
    if (account.character_id === player.character.character_id && account.kind === "cash") account.balance_ngn = money;
  }
  await backend.store.flush();
  return { peer, playerId: identity.playerId, characterId: player.character.character_id, sessionToken: identity.sessionToken };
}

/** The first reply for this request ID: a result, a duplicate notice, or an error. */
function settle(peer, requestId, types = ["business.result", "business.error", "command.duplicate"]) {
  return peer.waitFor((message) => message.requestId === requestId && types.includes(message.type), 20000);
}

/** Waits until the saved world holds the expected value, after a confirmed reply. */
async function savedUntil(backend, predicate) {
  const started = Date.now();
  for (;;) {
    const state = await backend.durableState();
    if (predicate(state)) return state;
    if (Date.now() - started > 2000) throw new Error("The saved world did not reach the expected value.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Request IDs use only [A-Za-z0-9._:-] (the server drops any other ID), so each helper request gets a generated one. */
async function ownedBusiness(started, owner, label = "Owner Shop") {
  const requestId = `create-${randomUUID()}`;
  owner.peer.send({
    type: "business.action", action: "create", requestId,
    payload: { template_id: "template:provision-store", name: label, description: "A shop.", location_id: "market", initial_capital_ngn: 50_000 },
  });
  const reply = await settle(owner.peer, requestId);
  assert.equal(reply.type, "business.result", `owner creates a business: ${reply.code ?? ""}`);
  return reply.data.business.business_id;
}

async function stocked(owner, businessId) {
  const addId = `add-${randomUUID()}`;
  owner.peer.send({ type: "business.action", action: "add_product", requestId: addId, payload: { business_id: businessId, product_definition_id: "biz-goods:rice-5kg" } });
  const added = await settle(owner.peer, addId);
  assert.equal(added.type, "business.result", JSON.stringify(added));
  const restockId = `restock-${randomUUID()}`;
  owner.peer.send({ type: "business.action", action: "restock", requestId: restockId, payload: { business_id: businessId, product_definition_id: "biz-goods:rice-5kg", quantity: 10, unit_cost_ngn: 1000 } });
  const restocked = await settle(owner.peer, restockId);
  assert.equal(restocked.type, "business.result", JSON.stringify(restocked));
  return added.data.product.product_record_id;
}

for (const backendName of backendNames) {
  describe(`business accounts over the socket (${backendName} backend)`, () => {
    test("a purchase debits the buyer and credits the business account, and the saved world agrees", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(started, owner, "Buy Shop");
        const productRecordId = await stocked(owner, businessId);
        const buyer = await citizen(backend, started, "Buyer", 100_000);
        const buyerBefore = cashOf(backend.store.state, buyer.characterId);
        const accountBefore = accountOf(backend.store.state, businessId);

        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "buy-1", payload: { business_id: businessId, product_record_id: productRecordId, quantity: 2 } });
        const reply = await settle(buyer.peer, "buy-1");
        assert.equal(reply.type, "business.result", JSON.stringify(reply));
        assert.equal(cashOf(backend.store.state, buyer.characterId), buyerBefore - 17_000);
        assert.equal(accountOf(backend.store.state, businessId), accountBefore + 17_000);

        const saved = await savedUntil(backend, (state) => cashOf(state, buyer.characterId) === buyerBefore - 17_000);
        assert.equal(accountOf(saved, businessId), accountBefore + 17_000);
        assert.deepEqual(businessAccountMismatches(saved), []);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a seller cannot record a sale: sell_product is refused, and no money moves", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(started, owner, "No Sale Shop");
        const productRecordId = await stocked(owner, businessId);
        const outsider = await citizen(backend, started, "Outsider", 0);
        const before = snapshotMoney(backend.store.state, businessId, [owner.characterId, outsider.characterId]);

        owner.peer.send({ type: "business.action", action: "sell_product", requestId: "sell-1", payload: { business_id: businessId, product_record_id: productRecordId, quantity: 3, buyer_character_id: outsider.characterId } });
        const reply = await settle(owner.peer, "sell-1");
        assert.equal(reply.type, "business.error", JSON.stringify(reply));
        assert.equal(reply.code, "business_sale_must_be_purchase");
        assert.deepEqual(snapshotMoney(backend.store.state, businessId, [owner.characterId, outsider.characterId]), before);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("the payer is the session character: a buyer_character_id in the payload is ignored", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(started, owner, "Payer Shop");
        const productRecordId = await stocked(owner, businessId);
        const buyer = await citizen(backend, started, "Honest Buyer", 100_000);
        const victim = await citizen(backend, started, "Named Payer", 100_000);
        const victimBefore = cashOf(backend.store.state, victim.characterId);
        const buyerBefore = cashOf(backend.store.state, buyer.characterId);

        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "payer-1", payload: { business_id: businessId, product_record_id: productRecordId, quantity: 1, buyer_character_id: victim.characterId } });
        const reply = await settle(buyer.peer, "payer-1");
        assert.equal(reply.type, "business.result", JSON.stringify(reply));
        assert.equal(cashOf(backend.store.state, victim.characterId), victimBefore, "the named character is not charged");
        assert.equal(cashOf(backend.store.state, buyer.characterId), buyerBefore - 8_500, "the session character pays");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a repeated request ID is applied once; a reused ID with a different payload is refused", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(started, owner, "Repeat Shop");
        const productRecordId = await stocked(owner, businessId);
        const buyer = await citizen(backend, started, "Repeat Buyer", 100_000);
        const buyerBefore = cashOf(backend.store.state, buyer.characterId);
        const payload = { business_id: businessId, product_record_id: productRecordId, quantity: 1 };

        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "rep-1", payload });
        assert.equal((await settle(buyer.peer, "rep-1")).type, "business.result");
        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "rep-1", payload });
        const duplicate = await settle(buyer.peer, "rep-1", ["command.duplicate", "business.result", "business.error"]);
        assert.equal(duplicate.type, "command.duplicate", JSON.stringify(duplicate));
        assert.equal(cashOf(backend.store.state, buyer.characterId), buyerBefore - 8_500, "charged once");

        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "rep-1", payload: { ...payload, quantity: 4 } });
        const conflicting = await settle(buyer.peer, "rep-1", ["error", "command.duplicate", "business.result", "business.error"]);
        assert.equal(conflicting.code, "request_id_reused", JSON.stringify(conflicting));
        assert.equal(cashOf(backend.store.state, buyer.characterId), buyerBefore - 8_500, "still charged once");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a failed save of a purchase is business_not_saved; the retry is applied once", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(started, owner, "Failing Buy Shop");
        const productRecordId = await stocked(owner, businessId);
        const buyer = await citizen(backend, started, "Retry Buyer", 100_000);
        const buyerBefore = cashOf(backend.store.state, buyer.characterId);
        const payload = { business_id: businessId, product_record_id: productRecordId, quantity: 1 };

        backend.store.failNextWrite("disk full");
        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "fb-1", payload });
        const first = await settle(buyer.peer, "fb-1");
        assert.equal(first.code, "business_not_saved", JSON.stringify(first));

        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "fb-1", payload });
        const retry = await settle(buyer.peer, "fb-1");
        assert.equal(retry.type, "business.result", JSON.stringify(retry));
        assert.equal(cashOf(backend.store.state, buyer.characterId), buyerBefore - 8_500, "the purchase happened once");
        await savedUntil(backend, (state) => cashOf(state, buyer.characterId) === buyerBefore - 8_500);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("payroll and inter-business transfer work over the socket and reconcile in the saved world", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(started, owner, "Payroll Socket Shop");
        const second = await ownedBusiness(started, owner, "Second Socket Shop");
        const worker = await citizen(backend, started, "Worker", 0);

        owner.peer.send({ type: "business.action", action: "hire_employee", requestId: "hire-1", payload: { business_id: businessId, employee_character_id: worker.characterId } });
        assert.equal((await settle(owner.peer, "hire-1")).type, "business.result");

        const workerBefore = cashOf(backend.store.state, worker.characterId);
        owner.peer.send({ type: "business.action", action: "pay_salary", requestId: "pay-1", payload: { business_id: businessId, employee_character_id: worker.characterId, amount_ngn: 4_000 } });
        const paid = await settle(owner.peer, "pay-1");
        assert.equal(paid.type, "business.result", JSON.stringify(paid));
        assert.equal(cashOf(backend.store.state, worker.characterId), workerBefore + 4_000);

        const totalBefore = totalMoney(backend.store.state);
        const secondBefore = accountOf(backend.store.state, second);
        owner.peer.send({ type: "business.action", action: "transfer_funds", requestId: "tr-1", payload: { business_id: businessId, to_business_id: second, amount_ngn: 5_000 } });
        const moved = await settle(owner.peer, "tr-1");
        assert.equal(moved.type, "business.result", JSON.stringify(moved));
        assert.equal(totalMoney(backend.store.state), totalBefore, "a transfer moves money and creates none");

        const saved = await savedUntil(backend, (state) => accountOf(state, second) === secondBefore + 5_000);
        assert.deepEqual(businessAccountMismatches(saved), []);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a saved world whose business balance does not match its account is refused at load", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(started, owner, "Tampered Shop");
        // A change made outside the business code: the record says more than the account holds.
        backend.store.state.businesses[businessId].balance_ngn += 1;
        await backend.store.flush();
        await started.stop();
        await assert.rejects(() => backend.reopen(), /do not reconcile/);
      } finally {
        await backend.cleanup();
      }
    });

    test("a confirmed purchase survives a restart, and the saved accounts still reconcile", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      let businessId;
      let buyerId;
      let expectedBuyerCash;
      let expectedAccount;
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        businessId = await ownedBusiness(started, owner, "Restart Shop");
        const productRecordId = await stocked(owner, businessId);
        const buyer = await citizen(backend, started, "Restart Buyer", 100_000);
        buyerId = buyer.characterId;
        buyer.peer.send({ type: "business.action", action: "buy_product", requestId: "rs-1", payload: { business_id: businessId, product_record_id: productRecordId, quantity: 1 } });
        assert.equal((await settle(buyer.peer, "rs-1")).type, "business.result");
        expectedBuyerCash = cashOf(backend.store.state, buyerId);
        expectedAccount = accountOf(backend.store.state, businessId);
        await savedUntil(backend, (state) => cashOf(state, buyerId) === expectedBuyerCash);
        await buyer.peer.close();
      } finally {
        await started.stop();
      }
      await backend.reopen();
      try {
        const saved = await backend.durableState();
        assert.equal(cashOf(saved, buyerId), expectedBuyerCash);
        assert.equal(accountOf(saved, businessId), expectedAccount, "the saved account holds the confirmed balance");
        assert.deepEqual(businessAccountMismatches(saved), []);
      } finally {
        await backend.cleanup();
      }
    });
  });
}

/** The money a socket test checks: the business account and the named cash accounts. */
function snapshotMoney(state, businessId, characterIds) {
  return {
    account: accountOf(state, businessId),
    cash: characterIds.map((id) => cashOf(state, id)),
    inventory: JSON.stringify(Object.values(state.businessInventory).filter((i) => i.business_id === businessId)),
    sales: Object.values(state.businessSales).filter((s) => s.business_id === businessId).length,
  };
}
