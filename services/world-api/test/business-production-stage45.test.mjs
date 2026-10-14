// Stage 45: business production through the socket, on each configured backend.
//
// `produce` turns stock inputs and an operating cost into output stock. These tests check the whole chain the Godot panel
// offers: a run changes stock, the business account, and the history together; produced stock can be listed and sold from
// that stock; and every refusal leaves the world as it was.
//
// Routing: a sale route is chosen by the catalogue category, not by the ID prefix. Two products carry a `biz-service:` ID
// but are category "food", so they are stock products (jollof rice and grilled fish). The tests use that route for them.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";
import { businessAccountKey } from "../dist/businesses/service.js";

before(connectBackends);
after(disconnectBackends);

const cashOf = (state, characterId) => Object.values(state.economyAccounts)
  .find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;
const accountOf = (state, businessId) => state.economyAccounts[businessAccountKey(businessId)].balance_ngn;
const stockOf = (state, businessId, definitionId) => Object.values(state.businessInventory)
  .filter((item) => item.business_id === businessId && item.product_definition_id === definitionId)
  .reduce((sum, item) => sum + item.quantity, 0);
const countOf = (rows, businessId) => Object.values(rows).filter((row) => row.business_id === businessId).length;

/** Everything a production run or a refused run could change, read from the live world. */
function snapshot(state, businessId, actorId, definitions) {
  return {
    account: accountOf(state, businessId),
    actorCash: cashOf(state, actorId),
    stock: Object.fromEntries(definitions.map((id) => [id, stockOf(state, businessId, id)])),
    runs: countOf(state.businessProductionRuns, businessId),
    movements: countOf(state.businessInventoryMovements, businessId),
    transactions: countOf(state.businessTransactions, businessId),
    sales: countOf(state.businessSales, businessId),
    events: countOf(state.businessEvents, businessId),
  };
}

/** A citizen with money in hand, created as the other business socket tests create them. */
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
  return { peer, characterId: player.character.character_id };
}

/** The first reply for this request ID, including a generic error that carries the ID. */
const settle = (peer, requestId) => peer.waitFor(
  (message) => message.requestId === requestId
    && ["business.result", "business.error", "command.duplicate", "error"].includes(message.type),
  20000,
);

async function businessAction(peer, action, payload, requestId = `${action}-${randomUUID()}`) {
  peer.send({ type: "business.action", action, requestId, payload });
  return settle(peer, requestId);
}

for (const backendName of backendNames) {
  describe(`business production over the socket (${backendName} backend)`, () => {
    test("a poultry farm produces eggs, and the stock, business account, and history change together", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const farmer = await citizen(backend, started, "Farmer", 1_000_000);
        const created = await businessAction(farmer.peer, "create", {
          template_id: "template:poultry-farm", name: "Egg Farm", description: "Eggs.", location_id: "town", initial_capital_ngn: 100_000,
        });
        assert.equal(created.type, "business.result", JSON.stringify(created));
        const businessId = created.data.business.business_id;
        const accountBefore = accountOf(backend.store.state, businessId);
        const txBefore = countOf(backend.store.state.businessTransactions, businessId);

        const run = await businessAction(farmer.peer, "produce", { business_id: businessId, recipe_id: "recipe:eggs-tray" });
        assert.equal(run.type, "business.result", JSON.stringify(run));
        assert.equal(run.data.production_run.output_quantity, 2);
        assert.equal(run.data.production_run.operating_cost_ngn, 300);
        assert.equal(stockOf(backend.store.state, businessId, "biz-goods:eggs-tray"), 2);
        assert.equal(accountOf(backend.store.state, businessId), accountBefore - 300, "the operating cost is paid from the business account");
        assert.equal(countOf(backend.store.state.businessTransactions, businessId), txBefore + 1, "one production cost is recorded");
        assert.ok(Object.values(backend.store.state.businessTransactions).some((tx) => tx.business_id === businessId && tx.kind === "production_cost" && tx.amount_ngn === 300));
        assert.ok(Object.values(backend.store.state.businessInventoryMovements).some((m) => m.business_id === businessId && m.kind === "production_output" && m.quantity === 2));
        assert.ok(Object.values(backend.store.state.businessEvents).some((e) => e.business_id === businessId && e.type === "production_completed"));
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("produced goods are listed and sold from stock: the buyer pays, stock falls, and the business keeps the sale", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const farmer = await citizen(backend, started, "Seller", 1_000_000);
        const buyer = await citizen(backend, started, "Buyer", 10_000);
        const created = await businessAction(farmer.peer, "create", {
          template_id: "template:poultry-farm", name: "Egg Stall", description: "Eggs.", location_id: "town", initial_capital_ngn: 100_000,
        });
        const businessId = created.data.business.business_id;
        const produced = await businessAction(farmer.peer, "produce", { business_id: businessId, recipe_id: "recipe:eggs-tray" });
        assert.equal(produced.type, "business.result", JSON.stringify(produced));
        const listed = await businessAction(farmer.peer, "add_product", { business_id: businessId, product_definition_id: "biz-goods:eggs-tray" });
        assert.equal(listed.type, "business.result", JSON.stringify(listed));
        const recordId = listed.data.product.product_record_id;
        const price = listed.data.product.price_ngn;

        const buyerCashBefore = cashOf(backend.store.state, buyer.characterId);
        const accountBefore = accountOf(backend.store.state, businessId);
        const sold = await businessAction(buyer.peer, "buy_product", { business_id: businessId, product_record_id: recordId, quantity: 1 });
        assert.equal(sold.type, "business.result", JSON.stringify(sold));
        assert.equal(cashOf(backend.store.state, buyer.characterId), buyerCashBefore - price, "the buyer pays from their own cash");
        assert.equal(accountOf(backend.store.state, businessId), accountBefore + price, "the business is credited the price");
        assert.equal(stockOf(backend.store.state, businessId, "biz-goods:eggs-tray"), 1, "one crate leaves stock");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a refused production changes nothing: funds, stock limit, business type, recipe, inputs, closure, and a stranger", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        // A character may own at most three businesses, so the cases use two owners.
        const ownerA = await citizen(backend, started, "Owner A", 3_000_000);
        const ownerB = await citizen(backend, started, "Owner B", 3_000_000);
        const stranger = await citizen(backend, started, "Stranger", 10_000);
        const state = () => backend.store.state;
        const tracked = ["biz-goods:eggs-tray", "biz-goods:rice-5kg", "biz-goods:palm-oil-1l"];

        const make = async (owner, templateId, name, location, capital) => {
          const created = await businessAction(owner.peer, "create", {
            template_id: templateId, name, description: "Test.", location_id: location, initial_capital_ngn: capital,
          });
          assert.equal(created.type, "business.result", JSON.stringify(created));
          return created.data.business.business_id;
        };
        const refuse = async (label, actor, businessId, action, payload, code) => {
          const before = snapshot(state(), businessId, actor.characterId, tracked);
          const reply = await businessAction(actor.peer, action, payload);
          assert.equal(reply.type, "business.error", `${label}: ${JSON.stringify(reply)}`);
          assert.equal(reply.code, code, label);
          assert.deepEqual(snapshot(state(), businessId, actor.characterId, tracked), before, `${label}: nothing changed`);
        };

        const broke = await make(ownerA, "template:poultry-farm", "No Funds", "town", 0);
        await refuse("no funds for the operating cost", ownerA, broke, "produce", { business_id: broke, recipe_id: "recipe:eggs-tray" }, "business_insufficient_funds");

        const full = await make(ownerA, "template:poultry-farm", "Full Store", "town", 100_000);
        const stocked = await businessAction(ownerA.peer, "restock", {
          business_id: full, product_definition_id: "biz-goods:eggs-tray", quantity: 9_999, unit_cost_ngn: 0,
        });
        assert.equal(stocked.type, "business.result", JSON.stringify(stocked));
        await refuse("output above the stock limit", ownerA, full, "produce", { business_id: full, recipe_id: "recipe:eggs-tray" }, "business_stock_limit_exceeded");

        const shop = await make(ownerA, "template:provision-store", "Shop", "market", 50_000);
        await refuse("a business type without production", ownerA, shop, "produce", { business_id: shop, recipe_id: "recipe:eggs-tray" }, "business_production_not_supported");

        const farm = await make(ownerB, "template:poultry-farm", "Farm", "town", 100_000);
        await refuse("a recipe that is not for this business", ownerB, farm, "produce", { business_id: farm, recipe_id: "recipe:jollof-rice" }, "business_recipe_not_available");
        await refuse("a stranger is not authorised", stranger, farm, "produce", { business_id: farm, recipe_id: "recipe:eggs-tray" }, "business_unauthorized");

        const kitchen = await make(ownerB, "template:restaurant", "Kitchen", "town", 100_000);
        const rice = await businessAction(ownerB.peer, "restock", {
          business_id: kitchen, product_definition_id: "biz-goods:rice-5kg", quantity: 1, unit_cost_ngn: 1000,
        });
        assert.equal(rice.type, "business.result", JSON.stringify(rice));
        await refuse("an input is missing", ownerB, kitchen, "produce", { business_id: kitchen, recipe_id: "recipe:jollof-rice" }, "business_insufficient_input_stock");

        const closed = await make(ownerB, "template:poultry-farm", "Closed", "town", 0);
        const closure = await businessAction(ownerB.peer, "close", { business_id: closed, reason: "Retiring." });
        assert.equal(closure.type, "business.result", JSON.stringify(closure));
        await refuse("a closed business", ownerB, closed, "produce", { business_id: closed, recipe_id: "recipe:eggs-tray" }, "business_not_active");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a repeated request ID runs production once", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const farmer = await citizen(backend, started, "Repeat", 1_000_000);
        const created = await businessAction(farmer.peer, "create", {
          template_id: "template:poultry-farm", name: "Repeat Farm", description: "Eggs.", location_id: "town", initial_capital_ngn: 100_000,
        });
        const businessId = created.data.business.business_id;
        const requestId = `produce-${randomUUID()}`;
        const payload = { business_id: businessId, recipe_id: "recipe:eggs-tray" };
        const first = await businessAction(farmer.peer, "produce", payload, requestId);
        assert.equal(first.type, "business.result", JSON.stringify(first));
        const second = await businessAction(farmer.peer, "produce", payload, requestId);
        assert.equal(second.type, "command.duplicate", JSON.stringify(second));
        assert.equal(stockOf(backend.store.state, businessId, "biz-goods:eggs-tray"), 2, "the second copy did not produce again");
        assert.equal(countOf(backend.store.state.businessProductionRuns, businessId), 1);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a restaurant run uses its inputs and makes stock that a sale then draws down", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Chef", 2_000_000);
        const diner = await citizen(backend, started, "Diner", 10_000);
        const created = await businessAction(owner.peer, "create", {
          template_id: "template:restaurant", name: "Test Kitchen", description: "Food.", location_id: "town", initial_capital_ngn: 100_000,
        });
        const businessId = created.data.business.business_id;
        for (const definition of ["biz-goods:rice-5kg", "biz-goods:palm-oil-1l"]) {
          const stocked = await businessAction(owner.peer, "restock", { business_id: businessId, product_definition_id: definition, quantity: 1, unit_cost_ngn: 1000 });
          assert.equal(stocked.type, "business.result", JSON.stringify(stocked));
        }
        const run = await businessAction(owner.peer, "produce", { business_id: businessId, recipe_id: "recipe:jollof-rice" });
        assert.equal(run.type, "business.result", JSON.stringify(run));
        assert.equal(stockOf(backend.store.state, businessId, "biz-goods:rice-5kg"), 0, "the rice is used up");
        assert.equal(stockOf(backend.store.state, businessId, "biz-goods:palm-oil-1l"), 0, "the oil is used up");
        assert.equal(stockOf(backend.store.state, businessId, "biz-service:jollof-rice"), 5, "five plates are made");

        // The jollof product is category "food", so it is listed and sold as stock.
        const listed = await businessAction(owner.peer, "add_product", { business_id: businessId, product_definition_id: "biz-service:jollof-rice" });
        assert.equal(listed.type, "business.result", JSON.stringify(listed));
        const sold = await businessAction(diner.peer, "buy_product", {
          business_id: businessId, product_record_id: listed.data.product.product_record_id, quantity: 1,
        });
        assert.equal(sold.type, "business.result", JSON.stringify(sold));
        assert.equal(stockOf(backend.store.state, businessId, "biz-service:jollof-rice"), 4, "one plate leaves stock");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
