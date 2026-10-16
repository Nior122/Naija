// Stage 41: server changes made for the business client interface.
//
//   1. A sale's kind must match its product: a stock product cannot be bought as a service (which skipped the stock check),
//      and a service cannot be bought as a stock product.
//   2. The character snapshot lists businesses by active owner or co-owner records. The founder field is not updated by a
//      transfer, so the old check showed a transferred business to its former founder and hid it from the new owner.
//
// Part 1 tests the service directly on the in-memory fixture. Part 2 runs through the socket on each configured backend.
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
  createBusiness,
  purchaseProduct,
  purchaseService,
  restockInventory,
} from "../dist/businesses/service.js";

before(connectBackends);
after(disconnectBackends);

const cashOf = (state, characterId) => Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;
const accountOf = (state, businessId) => state.economyAccounts[businessAccountKey(businessId)].balance_ngn;
const stockOf = (state, businessId, definitionId) => Object.values(state.businessInventory)
  .find((inv) => inv.business_id === businessId && inv.product_definition_id === definitionId)?.quantity ?? null;

// ---------------------------------------------------------------------------------------------------------------------
// Part 1: the service.
// ---------------------------------------------------------------------------------------------------------------------

test("a stock product cannot be bought as a service: no stock moves and no money moves", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Grocer", { age: 30, money: 500000 });
  const { characterId: buyerId } = addPlayer(world, "Shopper", { age: 30, money: 500000 });
  const shop = createBusiness(world.state, ownerId, "template:provision-store", "Stock Shop", "Shop.", "market", 3000, world.date, 480, world.now, catalog);
  const bread = addBusinessProduct(world.state, shop.business_id, ownerId, "biz-goods:bread", null, world.date, 481, world.now, catalog);
  restockInventory(world.state, shop.business_id, ownerId, "biz-goods:bread", 5, 100, world.date, 482, world.now, catalog);

  const stockBefore = stockOf(world.state, shop.business_id, "biz-goods:bread");
  const buyerBefore = cashOf(world.state, buyerId);
  const accountBefore = accountOf(world.state, shop.business_id);
  const transactionsBefore = Object.keys(world.state.businessTransactions).length;

  assert.throws(
    () => purchaseService(world.state, shop.business_id, bread.product_record_id, buyerId, world.date, 483, world.now, catalog),
    /business_sale_not_service/,
  );
  assert.equal(stockOf(world.state, shop.business_id, "biz-goods:bread"), stockBefore);
  assert.equal(cashOf(world.state, buyerId), buyerBefore);
  assert.equal(accountOf(world.state, shop.business_id), accountBefore);
  assert.equal(Object.keys(world.state.businessTransactions).length, transactionsBefore);

  // The stock route still works for the same product.
  purchaseProduct(world.state, shop.business_id, bread.product_record_id, buyerId, 1, world.date, 484, world.now, catalog);
  assert.equal(stockOf(world.state, shop.business_id, "biz-goods:bread"), stockBefore - 1);
});

test("a service cannot be bought as a stock product, because it has no stock to take", () => {
  const world = makeWorld();
  const catalog = loadBusinessCatalog();
  const { characterId: ownerId } = addPlayer(world, "Consultant", { age: 30, money: 500000 });
  const { characterId: clientId } = addPlayer(world, "Client", { age: 30, money: 500000 });
  const firm = createBusiness(world.state, ownerId, "template:consulting-firm", "Advisory Co", "Consulting.", "town", 0, world.date, 480, world.now, catalog);
  const hour = addBusinessProduct(world.state, firm.business_id, ownerId, "biz-service:consulting-hour", null, world.date, 481, world.now, catalog);
  const clientBefore = cashOf(world.state, clientId);

  assert.throws(
    () => purchaseProduct(world.state, firm.business_id, hour.product_record_id, clientId, 1, world.date, 483, world.now, catalog),
    /business_sale_is_service/,
  );
  assert.equal(cashOf(world.state, clientId), clientBefore);

  // The service route is unchanged.
  purchaseService(world.state, firm.business_id, hour.product_record_id, clientId, world.date, 484, world.now, catalog);
  assert.ok(cashOf(world.state, clientId) < clientBefore);
});

// ---------------------------------------------------------------------------------------------------------------------
// Part 2: through the socket, on each backend.
// ---------------------------------------------------------------------------------------------------------------------

/** A citizen with money in hand, as business-accounts-stage40.test.mjs creates them. */
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

/** Request IDs use only [A-Za-z0-9._:-]; the server drops any other ID. */
async function businessAction(peer, action, payload) {
  const requestId = `${action}-${randomUUID()}`;
  peer.send({ type: "business.action", action, requestId, payload });
  return settle(peer, requestId);
}

/**
 * Closes this citizen's connection and resumes on a new one, and returns the session.ready snapshot. The server refuses a
 * second connection for an identity that is still connected, so the old connection is closed first.
 */
async function reconnect(started, record) {
  await record.peer.close();
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const ready = await resumeSession(peer, record.sessionToken);
  assert.equal(ready.type, "session.ready", JSON.stringify(ready));
  record.peer = peer;
  return ready;
}

const businessIdsIn = (ready) => (ready.character.business_profiles ?? []).map((profile) => profile.business_id);

for (const backendName of backendNames) {
  describe(`business client contract over the socket (${backendName} backend)`, () => {
    test("a stock product bought as a service is refused over the socket, and nothing moves", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Grocer", 500_000);
        const created = await businessAction(owner.peer, "create", {
          template_id: "template:provision-store", name: "Socket Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 50_000,
        });
        assert.equal(created.type, "business.result", JSON.stringify(created));
        const businessId = created.data.business.business_id;
        const added = await businessAction(owner.peer, "add_product", { business_id: businessId, product_definition_id: "biz-goods:rice-5kg" });
        assert.equal(added.type, "business.result", JSON.stringify(added));
        const restocked = await businessAction(owner.peer, "restock", { business_id: businessId, product_definition_id: "biz-goods:rice-5kg", quantity: 10, unit_cost_ngn: 1000 });
        assert.equal(restocked.type, "business.result", JSON.stringify(restocked));

        const buyer = await citizen(backend, started, "Shopper", 100_000);
        const buyerBefore = cashOf(backend.store.state, buyer.characterId);
        const accountBefore = accountOf(backend.store.state, businessId);
        const stockBefore = stockOf(backend.store.state, businessId, "biz-goods:rice-5kg");

        const refused = await businessAction(buyer.peer, "buy_service", {
          business_id: businessId, product_record_id: added.data.product.product_record_id,
        });
        assert.equal(refused.type, "business.error", JSON.stringify(refused));
        assert.equal(refused.code, "business_sale_not_service");
        assert.equal(cashOf(backend.store.state, buyer.characterId), buyerBefore);
        assert.equal(accountOf(backend.store.state, businessId), accountBefore);
        assert.equal(stockOf(backend.store.state, businessId, "biz-goods:rice-5kg"), stockBefore);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a transferred business is listed for its new owner and not for its former founder", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const founder = await citizen(backend, started, "Founder", 500_000);
        const successor = await citizen(backend, started, "Successor", 0);
        const created = await businessAction(founder.peer, "create", {
          template_id: "template:provision-store", name: "Handover Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 0,
        });
        assert.equal(created.type, "business.result", JSON.stringify(created));
        const businessId = created.data.business.business_id;

        assert.ok(businessIdsIn(await reconnect(started, founder)).includes(businessId), "the founder sees the business before the transfer");

        const transferred = await businessAction(founder.peer, "transfer_ownership", {
          business_id: businessId, to_character_id: successor.characterId, new_role: "co_owner", share_percent: 60,
        });
        assert.equal(transferred.type, "business.result", JSON.stringify(transferred));

        assert.ok(businessIdsIn(await reconnect(started, successor)).includes(businessId), "the co-owner sees the business");
        assert.ok(!businessIdsIn(await reconnect(started, founder)).includes(businessId), "the former founder does not");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
