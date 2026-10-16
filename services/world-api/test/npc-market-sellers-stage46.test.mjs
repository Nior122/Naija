// Stage 46: NPC economic participation through the existing market ledger.
//
// Market goods bought by players are now paid to a non-player stall holder (a registered market seller in the economy
// catalogue). The holder is not a character and no NPC decides anything: it is a cash account in the same ledger that
// receives the price. The money moves from the buyer to the holder; none is created. Goods that have no seller keep the
// existing behaviour (the money leaves the economy), and the tests say so.
//
// The tests cover: the catalogue link; the ledger credit and its counterparties; the balance-limit refusal before any
// debit; the holder account being out of reach of player routes; monthly processing; the socket path on each backend;
// and the shop purchase route, which is checked against the same ledger.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";
import { addPlayer, makeWorld } from "./support/economy-world.mjs";
import { loadEconomyCatalog, validateEconomyCatalogForTest } from "../dist/economy/catalog.js";
import {
  accountKey,
  openNonPlayerCashAccount,
  processEconomyWorldDate,
  purchaseMarketGood,
  transferBetweenAccounts,
  withdrawFromAccount,
} from "../dist/economy/service.js";

const SELLER_ID = "market-seller:idera-market";

const cashAccountOf = (state, characterId) => Object.values(state.economyAccounts)
  .find((account) => account.kind === "cash" && account.character_id === characterId);
const sellerAccountOf = (state) => state.economyAccounts[accountKey(SELLER_ID, "cash", "default")];
const totalMoney = (state) => Object.values(state.economyAccounts).reduce((sum, account) => sum + account.balance_ngn, 0);
const marketSales = (state) => Object.values(state.economyTransactions).filter((tx) => tx.kind === "market_sale");

describe("market seller catalogue", () => {
  test("stall goods point at the registered market seller, and goods without one are listed as the documented gap", () => {
    const catalog = loadEconomyCatalog();
    assert.equal(catalog.market_sellers.length, 1);
    const seller = catalog.market_sellers[0];
    assert.equal(seller.id, SELLER_ID);
    assert.deepEqual(seller.location_ids, ["market"]);
    const stallGoods = catalog.market_goods.filter((good) => good.seller_id !== undefined);
    assert.ok(stallGoods.length >= 8, `at least eight stall goods (got ${stallGoods.length})`);
    for (const good of stallGoods) {
      assert.equal(good.seller_id, SELLER_ID, good.id);
      assert.ok(good.location_ids.every((locationId) => seller.location_ids.includes(locationId)), good.id);
    }
    // Paracetamol is also sold at the clinic, which has no seller, so it stays without one (documented gap).
    assert.equal(catalog.market_goods.find((good) => good.id === "goods:paracetamol").seller_id, undefined);
    assert.equal(catalog.market_goods.find((good) => good.id === "goods:bus-fare-town").seller_id, undefined);
  });

  test("the catalogue refuses a stall good that names an unknown seller, or a seller that does not cover its location", () => {
    const catalog = loadEconomyCatalog();
    const unknown = structuredClone(catalog);
    unknown.market_goods.find((good) => good.id === "goods:bread").seller_id = "market-seller:missing";
    assert.throws(() => validateEconomyCatalogForTest(unknown), /market seller|seller/i);

    const uncovered = structuredClone(catalog);
    uncovered.market_goods.find((good) => good.id === "goods:bread").location_ids = ["market", "town"];
    assert.throws(() => validateEconomyCatalogForTest(uncovered), /seller/i);
  });
});

describe("market purchases pay the stall holder through the ledger", () => {
  test("a purchase moves the price from the buyer to the holder, and no money is created or destroyed", () => {
    const world = makeWorld();
    const { characterId } = addPlayer(world, "Buyer", { age: 20, money: 20000 });
    const catalog = loadEconomyCatalog();
    const buyerAccount = cashAccountOf(world.state, characterId);
    const moneyBefore = totalMoney(world.state);

    const result = purchaseMarketGood(world.state, characterId, "goods:bread", 2, "market", world.date, 480, world.now, catalog);

    const sellerAccount = sellerAccountOf(world.state);
    assert.ok(sellerAccount, "the holder's cash account was opened by the sale");
    assert.equal(sellerAccount.character_id, SELLER_ID);
    assert.equal(result.total_cost_ngn, 3000);
    assert.equal(buyerAccount.balance_ngn, 17000);
    assert.equal(sellerAccount.balance_ngn, 3000);
    assert.equal(sellerAccount.total_deposited_ngn, 3000);
    assert.equal(totalMoney(world.state), moneyBefore, "the buyer's debit equals the holder's credit");

    const buyerTx = world.state.economyTransactions[result.transaction.transaction_id];
    assert.equal(buyerTx.kind, "market_purchase");
    assert.equal(buyerTx.counterparty_account_id, sellerAccount.account_id);
    const [sale] = marketSales(world.state);
    assert.ok(sale, "the holder has a market_sale ledger row");
    assert.equal(sale.account_id, sellerAccount.account_id);
    assert.equal(sale.counterparty_account_id, buyerAccount.account_id);
    assert.equal(sale.amount_ngn, 3000);
    assert.equal(sale.balance_before_ngn, 0);
    assert.equal(sale.balance_after_ngn, 3000);
    assert.equal(result.seller.id, SELLER_ID);
    assert.equal(result.seller.label, loadEconomyCatalog().market_sellers[0].label);
  });

  test("repeated sales accumulate on the holder, with one ledger row per sale", () => {
    const world = makeWorld();
    const { characterId } = addPlayer(world, "Regular", { age: 22, money: 20000 });
    const catalog = loadEconomyCatalog();
    purchaseMarketGood(world.state, characterId, "goods:bread", 1, "market", world.date, 480, world.now, catalog);
    purchaseMarketGood(world.state, characterId, "goods:water-50cl", 2, "market", world.date, 481, world.now, catalog);
    assert.equal(sellerAccountOf(world.state).balance_ngn, 1500 + 400);
    assert.equal(marketSales(world.state).length, 2);
  });

  test("a refusal because the holder would exceed the balance limit changes nothing, before any debit", () => {
    const world = makeWorld();
    const { characterId } = addPlayer(world, "Buyer", { age: 20, money: 20000 });
    const catalog = loadEconomyCatalog();
    const buyerAccount = cashAccountOf(world.state, characterId);
    const holder = openNonPlayerCashAccount(world.state, SELLER_ID, world.date, world.now);
    holder.balance_ngn = catalog.rules.maximum_account_balance_ngn - 1000;
    const transactionsBefore = Object.keys(world.state.economyTransactions).length;
    const buyerBefore = buyerAccount.balance_ngn;

    assert.throws(() => purchaseMarketGood(world.state, characterId, "goods:bread", 1, "market", world.date, 480, world.now, catalog),
      /economy_seller_balance_limit/);
    assert.equal(buyerAccount.balance_ngn, buyerBefore, "the buyer was not debited");
    assert.equal(holder.balance_ngn, catalog.rules.maximum_account_balance_ngn - 1000, "the holder was not credited");
    assert.equal(Object.keys(world.state.economyTransactions).length, transactionsBefore, "no ledger row was written");
  });

  test("a player cannot withdraw from the holder's account, and monthly processing does not charge or pay it", () => {
    const world = makeWorld();
    const { characterId } = addPlayer(world, "Buyer", { age: 20, money: 20000 });
    const catalog = loadEconomyCatalog();
    purchaseMarketGood(world.state, characterId, "goods:bread", 2, "market", world.date, 480, world.now, catalog);
    const holder = sellerAccountOf(world.state);

    assert.throws(() => withdrawFromAccount(world.state, characterId, holder.account_id, 100, world.date, 480, world.now, catalog),
      /economy_account_not_found/);
    assert.throws(() => transferBetweenAccounts(world.state, characterId, cashAccountOf(world.state, characterId).account_id,
      holder.account_id, 100, world.date, 480, world.now, catalog), /economy_account_not_found/);
    assert.equal(holder.balance_ngn, 3000);

    const nextMonth = { year: world.date.year, month: world.date.month + 1 > 12 ? 1 : world.date.month + 1,
      day: 1 };
    processEconomyWorldDate(world.state, nextMonth, world.now + 31 * 24 * 60 * 60 * 1000, catalog);
    assert.equal(holder.balance_ngn, 3000, "no interest or fee changed the holder's balance");
    assert.equal(holder.total_fees_paid_ngn, 0);
    assert.equal(holder.total_interest_earned_ngn, 0);
  });

  test("goods without a seller still leave the economy, as before (a documented gap, not a new rule)", () => {
    const world = makeWorld();
    const { characterId } = addPlayer(world, "Buyer", { age: 20, money: 20000 });
    const catalog = loadEconomyCatalog();
    const buyerAccount = cashAccountOf(world.state, characterId);
    const moneyBefore = totalMoney(world.state);

    const result = purchaseMarketGood(world.state, characterId, "goods:paracetamol", 1, "market", world.date, 480, world.now, catalog);

    assert.equal(result.seller, null);
    assert.equal(buyerAccount.balance_ngn, 20000 - 350);
    assert.equal(sellerAccountOf(world.state), undefined, "no holder account was opened");
    assert.equal(totalMoney(world.state), moneyBefore - 350);
    assert.equal(world.state.economyTransactions[result.transaction.transaction_id].counterparty_account_id, null);
  });
});

// ---- Over the socket, on each backend ----

before(connectBackends);
after(disconnectBackends);

async function citizen(backend, started, name, money) {
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const identity = await createIdentity(peer, name);
  assert.equal((await resumeSession(peer, identity.sessionToken)).type, "session.ready");
  const player = backend.store.state.players[identity.playerId];
  const worldDate = backend.store.state.worldClock.world_date;
  player.character.date_of_birth = { year: worldDate.year - 30, month: 1, day: 1 };
  player.character.age = 30;
  player.character.money = money;
  // Stage 47: a market purchase is made by a buyer standing at that market.
  player.character.current_location = "market";
  for (const account of Object.values(backend.store.state.economyAccounts)) {
    if (account.character_id === player.character.character_id && account.kind === "cash") account.balance_ngn = money;
  }
  await backend.store.flush();
  return { peer, characterId: player.character.character_id, playerId: identity.playerId };
}

async function economy(peer, action, payload, requestId = `${action}-${randomUUID()}`) {
  peer.send({ type: "economy.action", action, requestId, payload });
  const reply = await peer.waitFor((message) => message.requestId === requestId
    && ["economy.result", "economy.error", "command.duplicate", "error"].includes(message.type), 20000);
  return reply;
}

for (const backendName of backendNames) {
  describe(`market seller over the socket (${backendName} backend)`, () => {
    test("a purchase is paid to the holder, and the saved world holds the holder's balance and sale", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const buyer = await citizen(backend, started, "Buyer", 20_000);
        const reply = await economy(buyer.peer, "purchase", { good_id: "goods:bread", quantity: 2, location_id: "market" });
        assert.equal(reply.type, "economy.result", JSON.stringify(reply));
        assert.equal(reply.ok, true);
        assert.equal(reply.data.total_cost_ngn, 3000);

        const state = backend.store.state;
        assert.equal(cashAccountOf(state, buyer.characterId).balance_ngn, 17_000);
        assert.equal(sellerAccountOf(state).balance_ngn, 3000);
        const durable = await backend.durableState();
        const durableHolder = durable.economyAccounts[accountKey(SELLER_ID, "cash", "default")];
        assert.ok(durableHolder, "the holder's account is in the saved world");
        assert.equal(durableHolder.balance_ngn, 3000);
        assert.ok(Object.values(durable.economyTransactions).some((tx) => tx.kind === "market_sale" && tx.amount_ngn === 3000),
          "the sale is in the saved ledger");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a refused purchase over the socket changes no money", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const buyer = await citizen(backend, started, "Poor", 100);
        const reply = await economy(buyer.peer, "purchase", { good_id: "goods:bread", quantity: 1, location_id: "market" });
        assert.equal(reply.type, "economy.error", JSON.stringify(reply));
        assert.equal(reply.code, "economy_insufficient_funds");
        assert.equal(cashAccountOf(backend.store.state, buyer.characterId).balance_ngn, 100);
        assert.equal(sellerAccountOf(backend.store.state), undefined);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a player's withdrawal from the holder's account is refused over the socket", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const buyer = await citizen(backend, started, "Buyer", 20_000);
        await economy(buyer.peer, "purchase", { good_id: "goods:bread", quantity: 1, location_id: "market" });
        const holder = sellerAccountOf(backend.store.state);
        const reply = await economy(buyer.peer, "withdraw", { account_id: holder.account_id, amount_ngn: 100 });
        assert.equal(reply.type, "economy.error", JSON.stringify(reply));
        assert.equal(reply.code, "economy_account_not_found");
        assert.equal(sellerAccountOf(backend.store.state).balance_ngn, 1500);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a shop purchase at the market shelf is settled in the cash account, not only on the character record", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const buyer = await citizen(backend, started, "Shopper", 1_000);
        const character = backend.store.state.players[buyer.playerId].character;
        character.current_location = "market";
        character.position = { x: 1190, y: 440 };
        await backend.store.flush();
        const requestId = `shop-${randomUUID()}`;
        buyer.peer.send({ type: "shop.purchase", itemId: "bottled_water", requestId });
        const reply = await buyer.peer.waitFor((message) => message.requestId === requestId
          && ["error", "character.snapshot", "command.duplicate"].includes(message.type), 20000);
        assert.equal(reply.type, "character.snapshot", JSON.stringify(reply));
        assert.equal(backend.store.state.players[buyer.playerId].character.money, 900);
        assert.equal(cashAccountOf(backend.store.state, buyer.characterId).balance_ngn, 900, "the cash account was debited");
        assert.equal(sellerAccountOf(backend.store.state).balance_ngn, 100, "the market holder was paid");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
