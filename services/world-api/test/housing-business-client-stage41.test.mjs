// Stage 41: Housing and Business client integration contract and socket flow verification.
//
// Part 1 verifies the GDScript client files (`housing_panel.gd`, `business_panel.gd`, `prototype_ui.gd`,
// `prototype_game.gd`, `ui_flow_headless.gd`) against the shared-world server contracts and catalog definitions.
// Part 2 exercises the exact `property.action` and `business.action` message sequences and payload shapes
// emitted by `HousingPanel` and `BusinessPanel` over the authenticated WebSocket connection on each backend.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  backendNames,
  connectBackends,
  disconnectBackends,
  openBackend,
  openPeerFrom,
  startOver,
} from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";

before(connectBackends);
after(disconnectBackends);

const repoRoot = resolve(import.meta.dirname, "../../..");

function readRepoFile(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function settleProperty(peer, requestId, types = ["property.result", "property.error", "command.duplicate"]) {
  return peer.waitFor((message) => message.requestId === requestId && types.includes(message.type), 20000);
}

function settleBusiness(peer, requestId, types = ["business.result", "business.error", "command.duplicate"]) {
  return peer.waitFor((message) => message.requestId === requestId && types.includes(message.type), 20000);
}

async function citizen(backend, started, name, money) {
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const identity = await createIdentity(peer, name);
  const ready = await resumeSession(peer, identity.sessionToken);
  assert.equal(ready.type, "session.ready");
  const player = backend.store.state.players[identity.playerId];
  const worldDate = backend.store.state.worldClock.world_date;
  player.character.date_of_birth = { year: worldDate.year - 30, month: 1, day: 1 };
  player.character.age = 30;
  player.character.money = money;
  for (const account of Object.values(backend.store.state.economyAccounts)) {
    if (account.character_id === player.character.character_id && account.kind === "cash") {
      account.balance_ngn = money;
    }
  }
  await backend.store.flush();
  return {
    peer,
    playerId: identity.playerId,
    characterId: player.character.character_id,
    sessionToken: identity.sessionToken,
    initialSnapshot: ready,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 1: GDScript client contract & wiring verification.
// ---------------------------------------------------------------------------------------------------------------------

describe("Stage 41 GDScript client contract verification", () => {
  test("prototype_ui.gd, prototype_game.gd, and multiplayer_client.gd wire HousingPanel and BusinessPanel into the HUD and WebSocket client", () => {
    const uiSource = readRepoFile("game/scripts/ui/prototype_ui.gd");
    const gameSource = readRepoFile("game/scripts/prototype_game.gd");
    const clientSource = readRepoFile("game/scripts/services/multiplayer_client.gd");
    const headlessTestSource = readRepoFile("game/tests/ui_flow_headless.gd");

    assert.match(uiSource, /preload\("res:\/\/scripts\/ui\/housing_panel\.gd"\)/);
    assert.match(uiSource, /preload\("res:\/\/scripts\/ui\/business_panel\.gd"\)/);
    assert.match(uiSource, /signal property_action_requested\(action: String, payload: Dictionary\)/);
    assert.match(uiSource, /signal business_action_requested\(action: String, payload: Dictionary\)/);
    assert.match(uiSource, /_add_menu_button\(menu_grid, "Housing", "housing"\)/);
    assert.match(uiSource, /_add_menu_button\(menu_grid, "Businesses", "businesses"\)/);
    assert.match(uiSource, /func show_housing\(/);
    assert.match(uiSource, /func show_businesses\(/);

    assert.match(gameSource, /multiplayer_client\.send_command\(\s*"property\.action"/);
    assert.match(gameSource, /multiplayer_client\.send_command\(\s*"business\.action"/);
    assert.match(clientSource, /func send_command\(message_type: String/);
    assert.match(gameSource, /"property\.result", "property\.error":/);
    assert.match(gameSource, /"business\.result", "business\.error":/);
    assert.match(gameSource, /character_data\.get\("property_profiles"/);
    assert.match(gameSource, /character_data\.get\("rental_agreements"/);
    assert.match(gameSource, /character_data\.get\("business_profiles"/);

    assert.match(headlessTestSource, /"Housing"/);
    assert.match(headlessTestSource, /"Businesses"/);
  });

  test("housing_panel.gd exposes all 14 server property.action operations with exact payload keys and no fake operations", () => {
    const housingSource = readRepoFile("game/scripts/ui/housing_panel.gd");
    const propertyCatalog = JSON.parse(readRepoFile("game/data/properties/catalog.json"));

    const expectedActions = [
      "market",
      "view",
      "my_properties",
      "my_rentals",
      "purchase",
      "rent",
      "pay_rent",
      "terminate_rental",
      "list_for_sale",
      "list_for_rent",
      "maintain",
      "furnish",
      "remove_furnishing",
      "transfer",
    ];
    for (const action of expectedActions) {
      assert.match(housingSource, new RegExp(`"${action}"`), `housing_panel.gd must support property.action '${action}'`);
    }

    // Exact server payload field names required by world-engine.ts:
    for (const field of [
      "listing_id",
      "property_id",
      "asking_price_ngn",
      "rent_price_ngn",
      "rent_period",
      "deposit_ngn",
      "agreement_id",
      "condition",
      "furniture_id",
      "furnishing_id",
      "to_character_id",
    ]) {
      assert.match(housingSource, new RegExp(`"${field}"`), `housing_panel.gd must use payload field '${field}'`);
    }

    // Default furniture ID in _form must exist in game/data/properties/catalog.json:
    const furnitureIds = new Set(propertyCatalog.furniture_catalog.map((item) => item.id));
    assert.ok(furnitureIds.has("furn:bed-single"));
    assert.match(housingSource, /"furn:bed-single"/);

    // Must not fake unsupported unlist/evict/arrears actions:
    assert.doesNotMatch(housingSource, /_emit_action\("unlist"/);
    assert.doesNotMatch(housingSource, /_emit_action\("cancel_listing"/);
    assert.doesNotMatch(housingSource, /_emit_action\("evict"/);
  });

  test("business_panel.gd exposes all 18 server business.action operations, preserves buyer-paid sales, and uses valid catalog IDs", () => {
    const businessSource = readRepoFile("game/scripts/ui/business_panel.gd");
    const businessCatalog = JSON.parse(readRepoFile("game/data/businesses/catalog.json"));

    const expectedActions = [
      "discover",
      "view",
      "create",
      "add_product",
      "restock",
      "buy_product",
      "buy_service",
      "pay_salary",
      "transfer_funds",
      "contribute_capital",
      "withdraw",
      "record_expense",
      "produce",
      "close",
      "add_branch",
      "transfer_ownership",
      "hire_employee",
      "fire_employee",
    ];
    for (const action of expectedActions) {
      assert.match(businessSource, new RegExp(`"${action}"`), `business_panel.gd must support business.action '${action}'`);
    }

    // Exact server payload field names required by world-engine.ts:
    for (const field of [
      "template_id",
      "initial_capital_ngn",
      "product_definition_id",
      "custom_price_ngn",
      "unit_cost_ngn",
      "product_record_id",
      "employee_character_id",
      "to_business_id",
      "amount_ngn",
      "kind",
      "recipe_id",
      "premises_type",
      "to_character_id",
      "new_role",
      "share_percent",
    ]) {
      assert.match(businessSource, new RegExp(`"${field}"`), `business_panel.gd must use payload field '${field}'`);
    }

    // Default template and premises in business_panel.gd must match game/data/businesses/catalog.json:
    const templateIds = new Set(businessCatalog.templates.map((t) => t.id));
    assert.ok(templateIds.has("template:provision-store"));
    assert.ok(businessCatalog.premises_types.includes("shop"));

    // Must never emit legacy seller-pushed actions or client-supplied buyer_character_id:
    assert.doesNotMatch(businessSource, /sell_product/);
    assert.doesNotMatch(businessSource, /sell_service/);
    assert.doesNotMatch(businessSource, /record_service_revenue/);
    assert.doesNotMatch(businessSource, /buyer_character_id/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Part 2: WebSocket client integration flows across configured backends.
// ---------------------------------------------------------------------------------------------------------------------

for (const backendName of backendNames) {
  describe(`Stage 41 housing and business client flows over WebSocket (${backendName} backend)`, () => {
    test("HousingPanel client flow: market -> my_properties -> my_rentals -> view -> purchase -> furnish -> maintain -> list_for_rent -> rent -> pay_rent -> terminate_rental", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const buyer = await citizen(backend, started, "Adaeze Buyer", 25_000_000);
        const tenant = await citizen(backend, started, "Chinedu Tenant", 5_000_000);

        // 1. HousingPanel.request_initial_data() sequence: market -> my_properties -> my_rentals
        buyer.peer.send({ type: "property.action", action: "market", requestId: "hp-market-1", payload: { filters: {} } });
        const marketReply = await settleProperty(buyer.peer, "hp-market-1");
        assert.equal(marketReply.type, "property.result");
        assert.ok(Array.isArray(marketReply.data.market.listings));
        assert.ok(marketReply.data.market.listings.length > 0, "seeded marketplace listings are returned");

        buyer.peer.send({ type: "property.action", action: "my_properties", requestId: "hp-owned-1", payload: {} });
        const ownedReply = await settleProperty(buyer.peer, "hp-owned-1");
        assert.equal(ownedReply.type, "property.result");
        assert.deepEqual(ownedReply.data.properties, []);

        buyer.peer.send({ type: "property.action", action: "my_rentals", requestId: "hp-rentals-1", payload: {} });
        const rentalsReply = await settleProperty(buyer.peer, "hp-rentals-1");
        assert.equal(rentalsReply.type, "property.result");
        assert.deepEqual(rentalsReply.data.rentals, []);

        // 2. Find an affordable residential sale listing and inspect via `view`
        const saleEntry = marketReply.data.market.listings.find(
          (entry) =>
            entry.listing_type === "sale" &&
            entry.category_id === "cat:residential" &&
            entry.asking_price_ngn <= 20_000_000,
        );
        assert.ok(saleEntry, "expected an affordable residential sale listing in seed catalog");
        const propertyId = saleEntry.property_id;
        const saleListingId = saleEntry.listing_id;

        buyer.peer.send({
          type: "property.action",
          action: "view",
          requestId: "hp-view-1",
          payload: { property_id: propertyId },
        });
        const viewReply = await settleProperty(buyer.peer, "hp-view-1");
        assert.equal(viewReply.type, "property.result");
        assert.equal(viewReply.data.property_profile.property_id, propertyId);

        // 3. Purchase the property from the marketplace
        buyer.peer.send({
          type: "property.action",
          action: "purchase",
          requestId: "hp-purchase-1",
          payload: { listing_id: saleListingId },
        });
        const purchaseReply = await settleProperty(buyer.peer, "hp-purchase-1");
        assert.equal(purchaseReply.type, "property.result", JSON.stringify(purchaseReply));
        assert.equal(purchaseReply.data.ownership.owner_id, buyer.characterId);
        assert.equal(purchaseReply.data.ownership.owner_kind, "player");

        // 4. Furnish and remove furnishing using HousingPanel payload keys (`furniture_id`, `furnishing_id`)
        buyer.peer.send({
          type: "property.action",
          action: "furnish",
          requestId: "hp-furnish-1",
          payload: {
            property_id: propertyId,
            furniture_id: "furn:bed-single",
            quantity: 1,
          },
        });
        const furnishReply = await settleProperty(buyer.peer, "hp-furnish-1");
        assert.equal(furnishReply.type, "property.result", JSON.stringify(furnishReply));
        const furnishingId = furnishReply.data.furnishing.furnishing_id;
        assert.ok(furnishingId);

        buyer.peer.send({
          type: "property.action",
          action: "remove_furnishing",
          requestId: "hp-unfurnish-1",
          payload: { property_id: propertyId, furnishing_id: furnishingId },
        });
        const unfurnishReply = await settleProperty(buyer.peer, "hp-unfurnish-1");
        assert.equal(unfurnishReply.type, "property.result", JSON.stringify(unfurnishReply));

        // 5. Record maintenance using HousingPanel payload keys (`condition`, `cost_ngn`, `description`)
        buyer.peer.send({
          type: "property.action",
          action: "maintain",
          requestId: "hp-maint-1",
          payload: {
            property_id: propertyId,
            description: "Routine structural maintenance",
            cost_ngn: 25_000,
            condition: "excellent",
          },
        });
        const maintReply = await settleProperty(buyer.peer, "hp-maint-1");
        assert.equal(maintReply.type, "property.result", JSON.stringify(maintReply));
        assert.equal(maintReply.data.maintenance.condition_after, "excellent");

        // 6. Owner lists property for rent, tenant rents it, sees property_rent_not_due before due date, then terminates rental
        buyer.peer.send({
          type: "property.action",
          action: "list_for_rent",
          requestId: "hp-list-rent-1",
          payload: {
            property_id: propertyId,
            rent_price_ngn: 150_000,
            rent_period: "monthly",
            deposit_ngn: 50_000,
          },
        });
        const listRentReply = await settleProperty(buyer.peer, "hp-list-rent-1");
        assert.equal(listRentReply.type, "property.result", JSON.stringify(listRentReply));
        const rentListingId = listRentReply.data.listing.listing_id;

        tenant.peer.send({
          type: "property.action",
          action: "rent",
          requestId: "hp-rent-1",
          payload: { listing_id: rentListingId },
        });
        const rentReply = await settleProperty(tenant.peer, "hp-rent-1");
        assert.equal(rentReply.type, "property.result", JSON.stringify(rentReply));
        const agreementId = rentReply.data.agreement.agreement_id;
        assert.ok(rentReply.data.agreement.paid_through_world_date, "initial rent covers first period");

        // Paying rent before paid_through_world_date is refused by server with property_rent_not_due:
        tenant.peer.send({
          type: "property.action",
          action: "pay_rent",
          requestId: "hp-pay-early-1",
          payload: { agreement_id: agreementId },
        });
        const earlyPayReply = await settleProperty(tenant.peer, "hp-pay-early-1");
        assert.equal(earlyPayReply.type, "property.error");
        assert.equal(earlyPayReply.code, "property_rent_not_due");

        // Terminating the rental succeeds and updates agreement status:
        tenant.peer.send({
          type: "property.action",
          action: "terminate_rental",
          requestId: "hp-term-1",
          payload: { agreement_id: agreementId, reason: "Mutual termination" },
        });
        const termReply = await settleProperty(tenant.peer, "hp-term-1");
        assert.equal(termReply.type, "property.result", JSON.stringify(termReply));
        assert.equal(termReply.data.agreement.status, "terminated");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("BusinessPanel client flow: discover -> create -> add_product -> restock -> buy_product -> buy_service -> hire_employee -> pay_salary -> transfer_funds -> close", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Bola Founder", 1_000_000);
        const customer = await citizen(backend, started, "Tunde Customer", 200_000);
        const employee = await citizen(backend, started, "Kemi Staff", 15_000);

        // 1. BusinessPanel.request_initial_data() discover call
        owner.peer.send({ type: "business.action", action: "discover", requestId: "bp-disc-1", payload: {} });
        const discReply = await settleBusiness(owner.peer, "bp-disc-1");
        assert.equal(discReply.type, "business.result");
        assert.ok(Array.isArray(discReply.data.businesses));

        // 2. Launch primary retail store and secondary cybercafe service business via BusinessPanel `create` payload
        owner.peer.send({
          type: "business.action",
          action: "create",
          requestId: "bp-create-1",
          payload: {
            template_id: "template:provision-store",
            name: "Naija Ventures",
            description: "Neighbourhood retail and service enterprise.",
            location_id: "market",
            initial_capital_ngn: 50_000,
          },
        });
        const create1 = await settleBusiness(owner.peer, "bp-create-1");
        assert.equal(create1.type, "business.result", JSON.stringify(create1));
        const biz1Id = create1.data.business.business_id;
        assert.equal(create1.data.business_profile.balance_ngn, 50_000);

        owner.peer.send({
          type: "business.action",
          action: "create",
          requestId: "bp-create-2",
          payload: {
            template_id: "template:cybercafe",
            name: "Naija Digital Hub",
            description: "Printing and digital services.",
            location_id: "town",
            initial_capital_ngn: 15_000,
          },
        });
        const create2 = await settleBusiness(owner.peer, "bp-create-2");
        assert.equal(create2.type, "business.result", JSON.stringify(create2));
        const biz2Id = create2.data.business.business_id;

        // 3. Add physical product to biz1, restock it, and add service product to biz2
        owner.peer.send({
          type: "business.action",
          action: "add_product",
          requestId: "bp-add-prod-1",
          payload: {
            business_id: biz1Id,
            product_definition_id: "biz-goods:bread",
            custom_price_ngn: 1_500,
          },
        });
        const addProd = await settleBusiness(owner.peer, "bp-add-prod-1");
        assert.equal(addProd.type, "business.result", JSON.stringify(addProd));
        const productRecordId = addProd.data.product.product_record_id;

        owner.peer.send({
          type: "business.action",
          action: "restock",
          requestId: "bp-restock-1",
          payload: {
            business_id: biz1Id,
            product_definition_id: "biz-goods:bread",
            quantity: 10,
            unit_cost_ngn: 1_200,
          },
        });
        const restocked = await settleBusiness(owner.peer, "bp-restock-1");
        assert.equal(restocked.type, "business.result", JSON.stringify(restocked));

        owner.peer.send({
          type: "business.action",
          action: "add_product",
          requestId: "bp-add-srv-1",
          payload: {
            business_id: biz2Id,
            product_definition_id: "biz-service:printing",
          },
        });
        const addSrv = await settleBusiness(owner.peer, "bp-add-srv-1");
        assert.equal(addSrv.type, "business.result", JSON.stringify(addSrv));
        const serviceRecordId = addSrv.data.product.product_record_id;

        // 4. Customer buys physical product (`buy_product`) and service (`buy_service`) from storefronts
        customer.peer.send({
          type: "business.action",
          action: "buy_product",
          requestId: "bp-buy-prod-1",
          payload: {
            business_id: biz1Id,
            product_record_id: productRecordId,
            quantity: 2,
          },
        });
        const boughtProd = await settleBusiness(customer.peer, "bp-buy-prod-1");
        assert.equal(boughtProd.type, "business.result", JSON.stringify(boughtProd));

        customer.peer.send({
          type: "business.action",
          action: "buy_service",
          requestId: "bp-buy-srv-1",
          payload: {
            business_id: biz2Id,
            product_record_id: serviceRecordId,
          },
        });
        const boughtSrv = await settleBusiness(customer.peer, "bp-buy-srv-1");
        assert.equal(boughtSrv.type, "business.result", JSON.stringify(boughtSrv));
        assert.equal(boughtSrv.data.sale.is_service, true);

        // 5. Hire employee and pay salary (`pay_salary`) from business account
        owner.peer.send({
          type: "business.action",
          action: "hire_employee",
          requestId: "bp-hire-1",
          payload: {
            business_id: biz1Id,
            employee_character_id: employee.characterId,
          },
        });
        const hired = await settleBusiness(owner.peer, "bp-hire-1");
        assert.equal(hired.type, "business.result", JSON.stringify(hired));

        owner.peer.send({
          type: "business.action",
          action: "pay_salary",
          requestId: "bp-salary-1",
          payload: {
            business_id: biz1Id,
            employee_character_id: employee.characterId,
            amount_ngn: 5_000,
          },
        });
        const paidSalary = await settleBusiness(owner.peer, "bp-salary-1");
        assert.equal(paidSalary.type, "business.result", JSON.stringify(paidSalary));

        // 6. Transfer funds (`transfer_funds`) from biz2 to biz1 so biz2 reaches ₦0, then close biz2
        owner.peer.send({
          type: "business.action",
          action: "close",
          requestId: "bp-close-nonzero",
          payload: { business_id: biz2Id, reason: "Closed by owner." },
        });
        const closeRefused = await settleBusiness(owner.peer, "bp-close-nonzero");
        assert.equal(closeRefused.type, "business.error");
        assert.equal(closeRefused.code, "business_balance_not_empty");

        // biz2 has 15,000 initial capital + 50 printing service revenue = 15,050:
        owner.peer.send({
          type: "business.action",
          action: "transfer_funds",
          requestId: "bp-xfer-1",
          payload: {
            business_id: biz2Id,
            to_business_id: biz1Id,
            amount_ngn: 15_050,
          },
        });
        const transferred = await settleBusiness(owner.peer, "bp-xfer-1");
        assert.equal(transferred.type, "business.result", JSON.stringify(transferred));
        assert.equal(transferred.data.outgoing.balance_after_ngn, 0);

        owner.peer.send({
          type: "business.action",
          action: "close",
          requestId: "bp-close-zero",
          payload: { business_id: biz2Id, reason: "Closed by owner." },
        });
        const closed = await settleBusiness(owner.peer, "bp-close-zero");
        assert.equal(closed.type, "business.result", JSON.stringify(closed));
        assert.equal(closed.data.business.status, "closed");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
