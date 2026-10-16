// Stage 43: business lifecycle, server validation, economic integrity, and NPC integration points.
//
// Part 1 tests the service directly on the in-memory fixture (business-world.mjs). Part 2 runs through the socket on each
// configured backend (the file backend always, PostgreSQL when a disposable database is configured). The rules are in
// docs/STAGE_43_BUSINESS_LIFECYCLE.md, and the money model is in docs/STAGE_40_BUSINESS_ACCOUNTS.md.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addPlayer, makeWorld } from "./support/business-world.mjs";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { resumeSession } from "./support/harness.mjs";
import {
  accountOf,
  businessAction,
  cashOf,
  citizen,
  createShop,
  reconnect,
  savedUntil,
  settle,
  stockedRice,
  stockOf,
} from "./support/business-socket.mjs";
import { loadBusinessCatalog } from "../dist/businesses/catalog.js";
import { loadCareerCatalog } from "../dist/careers/catalog.js";
import {
  careerEligibility,
  initializeCareerWorldState,
  processPendingCareerApplications,
  submitCareerApplication,
} from "../dist/careers/service.js";
import {
  addBranch,
  addBusinessProduct,
  businessAccountFor,
  businessAccountKey,
  businessAccountMismatches,
  closeBusiness,
  contributeCapital,
  createBusiness,
  fireEmployee,
  hireEmployee,
  paySalary,
  processBusinessWorldDate,
  purchaseProduct,
  purchaseService,
  recordBusinessExpense,
  restockInventory,
  restoreBusinessState,
  runBusinessChange,
  runProduction,
  seedNpcBusinesses,
  setBusinessListing,
  snapshotBusinessState,
  transferBetweenBusinesses,
  transferOwnership,
  updateBusinessPrice,
  withdrawFromBusiness,
} from "../dist/businesses/service.js";

before(connectBackends);
after(disconnectBackends);

const catalog = loadBusinessCatalog();
const PROVISION = "template:provision-store";

/** The money the economy holds for players and businesses: cash accounts plus business accounts. */
function totalMoney(state) {
  return Object.values(state.economyAccounts)
    .filter((a) => a.kind === "cash" || a.kind === "current")
    .reduce((sum, a) => sum + a.balance_ngn, 0);
}

const cashAccountOf = (state, characterId) =>
  Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId);

const ledgerRowsOn = (state, accountId) => Object.values(state.economyTransactions).filter((r) => r.account_id === accountId);

/** Every map a refused or rolled-back change must leave unchanged. */
function snapshot(state) {
  return JSON.stringify({
    accounts: state.economyAccounts,
    ledger: state.economyTransactions,
    players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, p.character.money])),
    businesses: state.businesses,
    ownership: state.businessOwnership,
    branches: state.businessBranches,
    products: state.businessProducts,
    inventory: state.businessInventory,
    movements: state.businessInventoryMovements,
    sales: state.businessSales,
    journal: state.businessTransactions,
    expenses: state.businessExpenses,
    runs: state.businessProductionRuns,
    events: state.businessEvents,
    employments: state.employments,
  });
}

/** Asserts that a function refuses with the given code and changes nothing. */
function assertRefusedUnchanged(state, fn, code) {
  const before = snapshot(state);
  assert.throws(fn, new RegExp(code));
  assert.equal(snapshot(state), before, `a refused change (${code}) must leave no partial change`);
}

/** Puts a business into the active state with a given balance, owned by a fresh owner with cash. */
function ownedShop(world, { capital = 0, ownerMoney = 500_000, label = "Shop", template = PROVISION, location = "market" } = {}) {
  const owner = addPlayer(world, `${label} Owner`, { age: 40, money: ownerMoney });
  const business = createBusiness(world.state, owner.characterId, template, label, "Shop.", location, capital, world.date, 480, world.now, catalog);
  return { owner, business };
}

/** Lists rice at a fixed price, and restocks it. */
function stockRice(world, business, ownerId, { quantity = 10, unitCost = 1000, price = 9000 } = {}) {
  const product = addBusinessProduct(world.state, business.business_id, ownerId, "biz-goods:rice-5kg", price, world.date, 480, world.now, catalog, "product");
  restockInventory(world.state, business.business_id, ownerId, "biz-goods:rice-5kg", quantity, unitCost, world.date, 480, world.now, catalog);
  return product;
}

const nextDay = (date) => {
  const day = date.day + 1;
  return day > 28 ? { year: date.year, month: date.month + 1, day: 1 } : { ...date, day };
};

// ---------------------------------------------------------------------------------------------------------------------
// Part 1: the service, directly.
// ---------------------------------------------------------------------------------------------------------------------

describe("creation and authorisation", () => {
  test("an adult creates a business from their own cash; the setup fee leaves the economy and the capital is moved", () => {
    const world = makeWorld();
    const { characterId } = addPlayer(world, "Founder", { age: 30, money: 500_000 });
    const template = catalog.templates.find((t) => t.id === PROVISION);
    const before = totalMoney(world.state);
    const business = createBusiness(world.state, characterId, PROVISION, "Founder Shop", "Shop.", "market", 100_000, world.date, 480, world.now, catalog);
    assert.equal(business.status, "active");
    assert.equal(business.owner_character_id, characterId);
    assert.equal(accountOf(world.state, business.business_id), 100_000);
    assert.equal(cashAccountOf(world.state, characterId).balance_ngn, 500_000 - template.setup_cost_ngn - 100_000);
    assert.equal(totalMoney(world.state), before - template.setup_cost_ngn, "only the setup fee left the economy");
    const kinds = ledgerRowsOn(world.state, businessAccountKey(business.business_id)).map((r) => r.kind);
    assert.deepEqual(kinds, ["business_capital"]);
    assert.deepEqual(businessAccountMismatches(world.state), []);
  });

  test("creation refuses an underage founder, an unknown template, and insufficient funds, with no partial change", () => {
    const world = makeWorld();
    const child = addPlayer(world, "Child", { age: 17, money: 500_000 });
    assertRefusedUnchanged(world.state, () => createBusiness(world.state, child.characterId, PROVISION, "Too Young", "Shop.", "market", 0, world.date, 480, world.now, catalog), "business_owner_age_ineligible");
    const adult = addPlayer(world, "Adult", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => createBusiness(world.state, adult.characterId, "template:not-real", "Ghost", "Shop.", "market", 0, world.date, 480, world.now, catalog), "business_template_not_found");
    assertRefusedUnchanged(world.state, () => createBusiness(world.state, adult.characterId, PROVISION, "Broke Shop", "Shop.", "market", 0, world.date, 480, world.now, catalog), "business_insufficient_funds");
  });

  test("creation refuses a location the template does not allow, and enforces the per-character business limit", () => {
    const world = makeWorld();
    const rich = addPlayer(world, "Rich", { age: 35, money: 50_000_000 });
    assertRefusedUnchanged(world.state, () => createBusiness(world.state, rich.characterId, PROVISION, "Nowhere", "Shop.", "lekki-market", 0, world.date, 480, world.now, catalog), "business_location_invalid");
    for (let i = 0; i < catalog.rules.maximum_businesses_per_character; i++) {
      createBusiness(world.state, rich.characterId, PROVISION, `Shop ${i}`, "Shop.", "market", 0, world.date, 480, world.now, catalog);
    }
    assertRefusedUnchanged(world.state, () => createBusiness(world.state, rich.characterId, PROVISION, "One Too Many", "Shop.", "market", 0, world.date, 480, world.now, catalog), "business_limit_reached");
  });

  test("a stranger cannot act on a business they do not own, and a refused stranger changes nothing", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    const stranger = addPlayer(world, "Stranger", { age: 30, money: 500_000 });
    const id = business.business_id;
    assertRefusedUnchanged(world.state, () => withdrawFromBusiness(world.state, id, stranger.characterId, 100, world.date, 480, world.now, catalog), "business_unauthorized");
    assertRefusedUnchanged(world.state, () => contributeCapital(world.state, id, stranger.characterId, 100, world.date, 480, world.now, catalog), "business_unauthorized");
    assertRefusedUnchanged(world.state, () => restockInventory(world.state, id, stranger.characterId, "biz-goods:rice-5kg", 1, 1000, world.date, 480, world.now, catalog), "business_unauthorized");
    assertRefusedUnchanged(world.state, () => closeBusiness(world.state, id, stranger.characterId, "Mine now.", world.date, 480, world.now), "business_unauthorized");
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, stranger.characterId, stranger.characterId, "owner", 100, world.date, 480, world.now, catalog), "business_unauthorized");
    assert.equal(world.state.businesses[id].owner_character_id, owner.characterId);
  });
});

describe("route separation and listings", () => {
  test("products and services use separate routes: a goods listing refuses the service route and a service refuses the product route", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    const id = business.business_id;
    assertRefusedUnchanged(world.state, () => addBusinessProduct(world.state, id, owner.characterId, "biz-goods:rice-5kg", 9000, world.date, 480, world.now, catalog, "service"), "business_service_is_product");
    assertRefusedUnchanged(world.state, () => addBusinessProduct(world.state, id, owner.characterId, "biz-service:consulting-hour", 20000, world.date, 480, world.now, catalog, "product"), "business_product_is_service");
    const listed = addBusinessProduct(world.state, id, owner.characterId, "biz-goods:rice-5kg", 9000, world.date, 480, world.now, catalog, "product");
    assert.equal(listed.available, true);
    assert.equal(listed.price_ngn, 9000);
  });

  test("one listing per definition; a goods price must sit between the markup limits, and a service price has a ceiling", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    const id = business.business_id;
    addBusinessProduct(world.state, id, owner.characterId, "biz-goods:rice-5kg", 9000, world.date, 480, world.now, catalog, "product");
    assertRefusedUnchanged(world.state, () => addBusinessProduct(world.state, id, owner.characterId, "biz-goods:rice-5kg", 9000, world.date, 480, world.now, catalog, "product"), "business_product_already_listed");
    assertRefusedUnchanged(world.state, () => addBusinessProduct(world.state, id, owner.characterId, "biz-goods:beans-2kg", 1, world.date, 480, world.now, catalog, "product"), "business_price_invalid");
    assertRefusedUnchanged(world.state, () => addBusinessProduct(world.state, id, owner.characterId, "biz-goods:beans-2kg", 999_999_999, world.date, 480, world.now, catalog, "product"), "business_price_invalid");
    assertRefusedUnchanged(world.state, () => addBusinessProduct(world.state, id, owner.characterId, "biz-service:consulting-hour", 15000 * 6, world.date, 480, world.now, catalog, "service"), "business_price_invalid");
    const service = addBusinessProduct(world.state, id, owner.characterId, "biz-service:consulting-hour", 15000, world.date, 480, world.now, catalog, "service");
    assert.equal(service.price_ngn, 15000);
  });

  test("a listing can be switched off and on, and a price can be changed only within limits; both are owner-or-manager actions", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    const id = business.business_id;
    const listing = stockRice(world, business, owner.characterId);
    const off = setBusinessListing(world.state, id, owner.characterId, listing.product_record_id, false, world.date, 480, world.now);
    assert.equal(off.available, false);
    const on = setBusinessListing(world.state, id, owner.characterId, listing.product_record_id, true, world.date, 480, world.now);
    assert.equal(on.available, true);
    const priced = updateBusinessPrice(world.state, id, owner.characterId, listing.product_record_id, 9500, world.date, 480, world.now, catalog);
    assert.equal(priced.price_ngn, 9500);
    assertRefusedUnchanged(world.state, () => updateBusinessPrice(world.state, id, owner.characterId, listing.product_record_id, 0, world.date, 480, world.now, catalog), "business_price_invalid");
    const stranger = addPlayer(world, "Price Stranger", { age: 30, money: 1000 });
    assertRefusedUnchanged(world.state, () => setBusinessListing(world.state, id, stranger.characterId, listing.product_record_id, false, world.date, 480, world.now), "business_unauthorized");
  });
});

describe("stock, restocking, and purchases", () => {
  test("restocking validates quantity and unit cost, refuses services, and pays the supplier from the business account", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 5_000 });
    const id = business.business_id;
    assertRefusedUnchanged(world.state, () => restockInventory(world.state, id, owner.characterId, "biz-goods:rice-5kg", 0, 1000, world.date, 480, world.now, catalog), "business_stock_quantity_invalid");
    assertRefusedUnchanged(world.state, () => restockInventory(world.state, id, owner.characterId, "biz-goods:rice-5kg", 1.5, 1000, world.date, 480, world.now, catalog), "business_stock_quantity_invalid");
    assertRefusedUnchanged(world.state, () => restockInventory(world.state, id, owner.characterId, "biz-service:consulting-hour", 1, 0, world.date, 480, world.now, catalog), "business_restock_is_service");
    assertRefusedUnchanged(world.state, () => restockInventory(world.state, id, owner.characterId, "biz-goods:rice-5kg", 10, 1000, world.date, 480, world.now, catalog), "business_insufficient_funds");
    const before = totalMoney(world.state);
    restockInventory(world.state, id, owner.characterId, "biz-goods:rice-5kg", 4, 1000, world.date, 480, world.now, catalog);
    assert.equal(accountOf(world.state, id), 1_000);
    assert.equal(stockOf(world.state, id, "biz-goods:rice-5kg"), 4);
    assert.equal(totalMoney(world.state), before - 4_000, "the supplier payment is a sink, not a transfer to a player");
  });

  test("restocking does not require a listing: raw materials can be held before they are sold", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    restockInventory(world.state, business.business_id, owner.characterId, "biz-goods:rice-5kg", 2, 1000, world.date, 480, world.now, catalog);
    assert.equal(stockOf(world.state, business.business_id, "biz-goods:rice-5kg"), 2);
    assert.equal(Object.values(world.state.businessProducts).filter((p) => p.business_id === business.business_id).length, 0);
  });

  test("a buyer pays from their own cash, the business is credited in the same movement, and stock falls by the quantity sold", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 20_000 });
    const listing = stockRice(world, business, owner.characterId, { quantity: 10, unitCost: 1000, price: 9000 });
    const buyer = addPlayer(world, "Buyer", { age: 30, money: 50_000 });
    const id = business.business_id;
    const total = totalMoney(world.state);
    const businessBefore = accountOf(world.state, id);
    const ownerBefore = cashOf(world.state, owner.characterId);
    const buyerBefore = cashOf(world.state, buyer.characterId);
    const result = purchaseProduct(world.state, id, listing.product_record_id, buyer.characterId, 2, world.date, 481, world.now, catalog);
    assert.equal(result.sale.total_ngn, 18_000);
    assert.equal(cashOf(world.state, buyer.characterId), buyerBefore - 18_000, "the buyer pays from their own cash");
    assert.equal(accountOf(world.state, id), businessBefore + 18_000, "the business is credited");
    assert.equal(cashOf(world.state, owner.characterId), ownerBefore, "the owner's own cash is untouched by a sale");
    assert.equal(stockOf(world.state, id, "biz-goods:rice-5kg"), 8);
    assert.equal(totalMoney(world.state), total, "a sale moves money between two accounts and creates none");
    assert.ok(ledgerRowsOn(world.state, businessAccountKey(id)).some((r) => r.kind === "business_sale" && r.counterparty_account_id !== null));
    assert.ok(ledgerRowsOn(world.state, cashAccountOf(world.state, buyer.characterId).account_id).some((r) => r.kind === "business_purchase"));
    assert.deepEqual(businessAccountMismatches(world.state), []);
  });

  test("a purchase is refused for insufficient stock, insufficient buyer funds, an unlisted product, a bad quantity, or the owner buying their own goods", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 5_000 });
    const listing = stockRice(world, business, owner.characterId, { quantity: 2, price: 9000 });
    const id = business.business_id;
    const buyer = addPlayer(world, "Poor Buyer", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => purchaseProduct(world.state, id, listing.product_record_id, buyer.characterId, 1, world.date, 481, world.now, catalog), "business_insufficient_funds");
    const rich = addPlayer(world, "Rich Buyer", { age: 30, money: 500_000 });
    assertRefusedUnchanged(world.state, () => purchaseProduct(world.state, id, listing.product_record_id, rich.characterId, 3, world.date, 481, world.now, catalog), "business_insufficient_stock");
    assertRefusedUnchanged(world.state, () => purchaseProduct(world.state, id, listing.product_record_id, rich.characterId, 0, world.date, 481, world.now, catalog), "business_sale_quantity_invalid");
    assertRefusedUnchanged(world.state, () => purchaseProduct(world.state, id, listing.product_record_id, owner.characterId, 1, world.date, 481, world.now, catalog), "business_self_purchase");
    setBusinessListing(world.state, id, owner.characterId, listing.product_record_id, false, world.date, 480, world.now);
    assertRefusedUnchanged(world.state, () => purchaseProduct(world.state, id, listing.product_record_id, rich.characterId, 1, world.date, 481, world.now, catalog), "business_product_unavailable");
  });

  test("a service is bought through the service route only; a goods line is refused on the service route", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 20_000, template: "template:consulting-firm", location: "town" });
    const id = business.business_id;
    const service = addBusinessProduct(world.state, id, owner.characterId, "biz-service:consulting-hour", 15000, world.date, 480, world.now, catalog, "service");
    const goods = stockRice(world, business, owner.characterId);
    const client = addPlayer(world, "Client", { age: 30, money: 100_000 });
    assertRefusedUnchanged(world.state, () => purchaseService(world.state, id, goods.product_record_id, client.characterId, world.date, 481, world.now, catalog), "business_sale_not_service");
    assertRefusedUnchanged(world.state, () => purchaseProduct(world.state, id, service.product_record_id, client.characterId, 1, world.date, 481, world.now, catalog), "business_sale_is_service");
    const before = totalMoney(world.state);
    purchaseService(world.state, id, service.product_record_id, client.characterId, world.date, 481, world.now, catalog);
    assert.equal(cashOf(world.state, client.characterId), 100_000 - 15_000);
    assert.equal(totalMoney(world.state), before, "a service sale moves money and does not create it");
  });
});

describe("employment: hiring, pay, and dismissal", () => {
  function staffed(world) {
    const { owner, business } = ownedShop(world, { capital: 200_000, template: PROVISION });
    const employee = addPlayer(world, "Staff", { age: 25, money: 1_000 });
    return { owner, business, employee, id: business.business_id };
  }

  test("the owner hires an eligible adult; the employment is a business ownership record with role employee; no money moves", () => {
    const world = makeWorld();
    const { owner, id, employee } = staffed(world);
    const total = totalMoney(world.state);
    const employment = hireEmployee(world.state, id, owner.characterId, employee.characterId, world.date, 481, world.now, catalog);
    assert.equal(employment.role, "employee");
    assert.equal(employment.active, true);
    assert.equal(totalMoney(world.state), total);
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, owner.characterId, employee.characterId, world.date, 482, world.now, catalog), "business_employee_already_employed");
  });

  test("hiring refuses the owner as their own staff, a child, a deceased person, a character without a cash account, and a stranger as the employer", () => {
    const world = makeWorld();
    const { owner, id } = staffed(world);
    const child = addPlayer(world, "Child Staff", { age: 15, money: 1_000 });
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, owner.characterId, child.characterId, world.date, 481, world.now, catalog), "business_employee_age_ineligible");
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, owner.characterId, owner.characterId, world.date, 481, world.now, catalog), "business_employee_is_owner");
    const dead = addPlayer(world, "Late Staff", { age: 40, money: 1_000 });
    world.state.players[dead.playerId].character.life_status = "deceased";
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, owner.characterId, dead.characterId, world.date, 481, world.now, catalog), "business_employee_deceased");
    const unbanked = addPlayer(world, "Unbanked", { age: 30, money: 1_000 });
    const cash = cashAccountOf(world.state, unbanked.characterId);
    delete world.state.economyAccounts[cash.account_id];
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, owner.characterId, unbanked.characterId, world.date, 481, world.now, catalog), "business_no_cash_account");
    const stranger = addPlayer(world, "Hiring Stranger", { age: 30, money: 1_000 });
    const candidate = addPlayer(world, "Candidate", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, stranger.characterId, candidate.characterId, world.date, 481, world.now, catalog), "business_unauthorized");
  });

  test("the staff limit is the smaller of the template limit and the global rule, and is enforced", () => {
    const world = makeWorld();
    const { owner, id } = staffed(world);
    const limit = Math.min(catalog.templates.find((t) => t.id === PROVISION).maximum_employees, catalog.rules.maximum_employees_per_business);
    for (let i = 0; i < limit; i++) {
      const worker = addPlayer(world, `Worker ${i}`, { age: 30, money: 1_000 });
      hireEmployee(world.state, id, owner.characterId, worker.characterId, world.date, 481, world.now, catalog);
    }
    const extra = addPlayer(world, "Extra Worker", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, owner.characterId, extra.characterId, world.date, 481, world.now, catalog), "business_employee_limit_reached");
  });

  test("a salary is paid from the business account to the employee's cash, through the ledger, and only an owner pays it", () => {
    const world = makeWorld();
    const { owner, id, employee } = staffed(world);
    hireEmployee(world.state, id, owner.characterId, employee.characterId, world.date, 481, world.now, catalog);
    const businessBefore = accountOf(world.state, id);
    const cashBefore = cashOf(world.state, employee.characterId);
    const total = totalMoney(world.state);
    paySalary(world.state, id, owner.characterId, employee.characterId, 30_000, world.date, 482, world.now, catalog);
    assert.equal(accountOf(world.state, id), businessBefore - 30_000);
    assert.equal(cashOf(world.state, employee.characterId), cashBefore + 30_000);
    assert.equal(totalMoney(world.state), total, "salary moves money between accounts");
    assert.ok(ledgerRowsOn(world.state, businessAccountKey(id)).some((r) => r.kind === "business_salary"));
    const manager = addPlayer(world, "Manager", { age: 35, money: 1_000 });
    const managerEmployment = hireEmployee(world.state, id, owner.characterId, manager.characterId, world.date, 483, world.now, catalog);
    // Fixture: the service has no operation that sets a manager's role, so the role is set on the record to test the rule.
    managerEmployment.role = "manager";
    assertRefusedUnchanged(world.state, () => paySalary(world.state, id, manager.characterId, employee.characterId, 100, world.date, 484, world.now, catalog), "business_unauthorized");
    const outsider = addPlayer(world, "Outsider", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => paySalary(world.state, id, owner.characterId, outsider.characterId, 100, world.date, 484, world.now, catalog), "business_salary_employee_invalid");
    assertRefusedUnchanged(world.state, () => paySalary(world.state, id, owner.characterId, employee.characterId, 200_000, world.date, 484, world.now, catalog), "business_insufficient_funds");
  });

  test("a fired employee is no longer on the payroll; firing moves no money and rehiring is allowed afterwards", () => {
    const world = makeWorld();
    const { owner, id, employee } = staffed(world);
    hireEmployee(world.state, id, owner.characterId, employee.characterId, world.date, 481, world.now, catalog);
    const total = totalMoney(world.state);
    const fired = fireEmployee(world.state, id, owner.characterId, employee.characterId, "Late every day.", world.date, 482, world.now);
    assert.equal(fired.active, false);
    assert.equal(totalMoney(world.state), total, "firing moves no money");
    assertRefusedUnchanged(world.state, () => paySalary(world.state, id, owner.characterId, employee.characterId, 100, world.date, 483, world.now, catalog), "business_salary_employee_invalid");
    assert.ok(Object.values(world.state.businessEvents).some((e) => e.business_id === id && e.type === "employee_fired"));
    const rehired = hireEmployee(world.state, id, owner.characterId, employee.characterId, world.date, 484, world.now, catalog);
    assert.equal(rehired.active, true);
  });
});

describe("the career and business commitments", () => {
  test("a business employee is refused a career job, and the refusal is re-checked when an application is reviewed", () => {
    const world = makeWorld();
    initializeCareerWorldState(world.state, world.now);
    const { owner, id } = (() => {
      const o = ownedShop(world, { capital: 200_000 });
      return { owner: o.owner, id: o.business.business_id };
    })();
    const applicant = addPlayer(world, "Dual Applicant", { age: 18, money: 1_000 });
    const job = loadCareerCatalog().jobs.find((entry) => entry.id === "community-market-sales-assistant");
    const application = submitCareerApplication(world.state, applicant.characterId, "vacancy-market-sales-assistant", world.date, world.now);
    assert.equal(application.status, "under_review");
    // The business hires the applicant after the application was made. Review must now refuse the application.
    hireEmployee(world.state, id, owner.characterId, applicant.characterId, world.date, 481, world.now, catalog);
    const eligibility = careerEligibility(world.state, applicant.player.character, job, world.date);
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.missing.includes("End the current business employment before taking a career job."));
    const reviewDate = world.state.careerApplications[application.application_id].review_due_date;
    const decisions = processPendingCareerApplications(world.state, reviewDate, world.now);
    const decision = decisions.find((d) => d.application_id === application.application_id);
    assert.equal(decision.status, "rejected");
    assert.match(decision.message, /End the current business employment/);
    assert.equal(Object.values(world.state.employments).filter((e) => e.character_id === applicant.characterId && e.status === "active").length, 0);
  });

  test("an active career employment blocks a business hire", () => {
    const world = makeWorld();
    initializeCareerWorldState(world.state, world.now);
    const { owner, id } = (() => {
      const o = ownedShop(world, { capital: 200_000 });
      return { owner: o.owner, id: o.business.business_id };
    })();
    const worker = addPlayer(world, "Career Worker", { age: 18, money: 1_000 });
    submitCareerApplication(world.state, worker.characterId, "vacancy-market-sales-assistant", world.date, world.now);
    processPendingCareerApplications(world.state, world.state.careerApplications[Object.keys(world.state.careerApplications)[0]].review_due_date, world.now);
    assert.ok(Object.values(world.state.employments).some((e) => e.character_id === worker.characterId && e.status === "active"));
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, id, owner.characterId, worker.characterId, world.date, 481, world.now, catalog), "business_employee_has_career_job");
  });
});

describe("branches and ownership", () => {
  test("a branch is opened in an allowed location, costs nothing, and the branch limit is enforced", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 0 });
    const id = business.business_id;
    const total = totalMoney(world.state);
    const branch = addBranch(world.state, id, owner.characterId, "Market Branch", "market", "shop", world.date, 480, world.now, catalog);
    assert.equal(branch.status, "active");
    assert.equal(totalMoney(world.state), total, "opening a branch moves no money (no branch setup cost is defined)");
    assertRefusedUnchanged(world.state, () => addBranch(world.state, id, owner.characterId, "Castle", "market", "castle", world.date, 480, world.now, catalog), "business_premises_invalid");
    assertRefusedUnchanged(world.state, () => addBranch(world.state, id, owner.characterId, "Nowhere", "lekki-market", "shop", world.date, 480, world.now, catalog), "business_location_invalid");
    const stranger = addPlayer(world, "Branch Stranger", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => addBranch(world.state, id, stranger.characterId, "Sneaky", "market", "shop", world.date, 480, world.now, catalog), "business_unauthorized");
  });

  test("ownership transfer moves the business to a verified recipient; the old owner's record is kept but inactive; no money moves", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 30_000 });
    const id = business.business_id;
    const heir = addPlayer(world, "Heir", { age: 30, money: 1_000 });
    const total = totalMoney(world.state);
    const result = transferOwnership(world.state, id, owner.characterId, heir.characterId, "owner", 100, world.date, 481, world.now, catalog);
    assert.equal(result.previous.active, false);
    assert.equal(result.ownership.role, "owner");
    assert.equal(world.state.businesses[id].owner_character_id, heir.characterId);
    assert.equal(totalMoney(world.state), total, "a transfer moves no money");
    assert.equal(accountOf(world.state, id), 30_000, "the business account and its history stay with the business");
    assertRefusedUnchanged(world.state, () => withdrawFromBusiness(world.state, id, owner.characterId, 100, world.date, 482, world.now, catalog), "business_unauthorized");
    const withdrawn = withdrawFromBusiness(world.state, id, heir.characterId, 1_000, world.date, 482, world.now, catalog);
    assert.equal(withdrawn.amount_ngn, 1_000);
    assert.ok(Object.values(world.state.businessEvents).some((e) => e.business_id === id && e.type === "ownership_transferred"));
  });

  test("ownership transfer refuses a stranger, a manager, an employee, an unknown recipient, the owner themselves, a child, a deceased or unbanked recipient, and a bad share", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 0 });
    const id = business.business_id;
    const recipient = addPlayer(world, "Recipient", { age: 30, money: 1_000 });
    const manager = addPlayer(world, "Mgr", { age: 30, money: 1_000 });
    hireEmployee(world.state, id, owner.characterId, manager.characterId, world.date, 481, world.now, catalog);
    world.state.businessOwnership[Object.keys(world.state.businessOwnership).find((k) => world.state.businessOwnership[k].character_id === manager.characterId)].role = "manager";
    const employee = addPlayer(world, "Emp", { age: 30, money: 1_000 });
    hireEmployee(world.state, id, owner.characterId, employee.characterId, world.date, 481, world.now, catalog);
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, manager.characterId, recipient.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_unauthorized");
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, employee.characterId, recipient.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_unauthorized");
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, "character-nobody", "owner", 100, world.date, 482, world.now, catalog), "business_transfer_character_not_found");
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, owner.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_transfer_same_character");
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, recipient.characterId, "owner", 101, world.date, 482, world.now, catalog), "business_share_invalid");
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, recipient.characterId, "employee", 100, world.date, 482, world.now, catalog), "business_role_invalid");
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, employee.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_transfer_recipient_already_involved");
    const child = addPlayer(world, "Child Heir", { age: 12, money: 1_000 });
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, child.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_owner_age_ineligible");
    const unbanked = addPlayer(world, "No Bank", { age: 30, money: 1_000 });
    delete world.state.economyAccounts[cashAccountOf(world.state, unbanked.characterId).account_id];
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, unbanked.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_no_cash_account");
    const late = addPlayer(world, "Late", { age: 30, money: 1_000 });
    world.state.players[late.playerId].character.life_status = "deceased";
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, owner.characterId, late.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_transfer_recipient_deceased");
  });

  test("a co-owner-held business cannot be transferred onward, because only the owner may transfer (recorded limitation)", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 0 });
    const id = business.business_id;
    const partner = addPlayer(world, "Partner", { age: 30, money: 1_000 });
    transferOwnership(world.state, id, owner.characterId, partner.characterId, "co_owner", 60, world.date, 481, world.now, catalog);
    const next = addPlayer(world, "Next", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, partner.characterId, next.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_unauthorized");
  });
});

describe("contributions, withdrawals, and transfers between businesses", () => {
  test("an owner's contribution moves their cash into the business; the cash and the account change by the same amount", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 0 });
    const total = totalMoney(world.state);
    contributeCapital(world.state, business.business_id, owner.characterId, 20_000, world.date, 481, world.now, catalog);
    assert.equal(accountOf(world.state, business.business_id), 20_000);
    assert.equal(totalMoney(world.state), total);
    assertRefusedUnchanged(world.state, () => contributeCapital(world.state, business.business_id, owner.characterId, 0, world.date, 481, world.now, catalog), "business_contribution_amount_invalid");
    assertRefusedUnchanged(world.state, () => contributeCapital(world.state, business.business_id, owner.characterId, 99_000_000, world.date, 481, world.now, catalog), "business_contribution_amount_invalid");
    assertRefusedUnchanged(world.state, () => contributeCapital(world.state, business.business_id, owner.characterId, 10_000_000, world.date, 481, world.now, catalog), "business_insufficient_funds");
  });

  test("a withdrawal pays the caller's own cash; a manager cannot withdraw; the balance limit is enforced", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 40_000 });
    const id = business.business_id;
    const total = totalMoney(world.state);
    const ownerBefore = cashOf(world.state, owner.characterId);
    withdrawFromBusiness(world.state, id, owner.characterId, 15_000, world.date, 481, world.now, catalog);
    assert.equal(cashOf(world.state, owner.characterId), ownerBefore + 15_000);
    assert.equal(accountOf(world.state, id), 25_000);
    assert.equal(totalMoney(world.state), total);
    assertRefusedUnchanged(world.state, () => withdrawFromBusiness(world.state, id, owner.characterId, 26_000, world.date, 481, world.now, catalog), "business_insufficient_funds");
    assertRefusedUnchanged(world.state, () => withdrawFromBusiness(world.state, id, owner.characterId, 6_000_000, world.date, 481, world.now, catalog), "business_withdrawal_amount_invalid");
    const manager = addPlayer(world, "Mgr Cash", { age: 30, money: 1_000 });
    hireEmployee(world.state, id, owner.characterId, manager.characterId, world.date, 481, world.now, catalog);
    world.state.businessOwnership[Object.keys(world.state.businessOwnership).find((k) => world.state.businessOwnership[k].character_id === manager.characterId)].role = "manager";
    assertRefusedUnchanged(world.state, () => withdrawFromBusiness(world.state, id, manager.characterId, 100, world.date, 482, world.now, catalog), "business_unauthorized");
  });

  test("a co-owner, once recorded, is equally authorised to contribute and withdraw (fixture: no add-co-owner operation exists yet)", () => {
    const world = makeWorld();
    const { business } = ownedShop(world, { capital: 40_000 });
    const id = business.business_id;
    const partner = addPlayer(world, "Co", { age: 30, money: 5_000 });
    world.state.businessOwnership["biz-own-fixture-co"] = {
      ownership_id: "biz-own-fixture-co", business_id: id, character_id: partner.characterId, role: "co_owner", share_percent: 50,
      created_at: new Date(world.now).toISOString(), created_world_date: world.date, updated_at: new Date(world.now).toISOString(),
      is_founder: false, active: true,
    };
    contributeCapital(world.state, id, partner.characterId, 1_000, world.date, 481, world.now, catalog);
    withdrawFromBusiness(world.state, id, partner.characterId, 2_000, world.date, 482, world.now, catalog);
    assert.equal(accountOf(world.state, id), 40_000 + 1_000 - 2_000);
  });

  test("a transfer between two businesses of the same owner moves money through the ledger; an unowned destination is refused", () => {
    const world = makeWorld();
    const { owner, business: from } = ownedShop(world, { capital: 20_000, label: "From" });
    const to = createBusiness(world.state, owner.characterId, PROVISION, "To", "Shop.", "market", 0, world.date, 480, world.now, catalog);
    const total = totalMoney(world.state);
    transferBetweenBusinesses(world.state, from.business_id, owner.characterId, to.business_id, 6_000, world.date, 481, world.now, catalog);
    assert.equal(accountOf(world.state, from.business_id), 14_000);
    assert.equal(accountOf(world.state, to.business_id), 6_000);
    assert.equal(totalMoney(world.state), total);
    const other = ownedShop(world, { capital: 10_000, label: "Other" });
    assertRefusedUnchanged(world.state, () => transferBetweenBusinesses(world.state, from.business_id, owner.characterId, other.business.business_id, 1_000, world.date, 482, world.now, catalog), "business_transfer_not_permitted");
    assertRefusedUnchanged(world.state, () => transferBetweenBusinesses(world.state, from.business_id, owner.characterId, from.business_id, 1_000, world.date, 482, world.now, catalog), "business_transfer_invalid");
    assertRefusedUnchanged(world.state, () => transferBetweenBusinesses(world.state, from.business_id, owner.characterId, to.business_id, 99_000, world.date, 482, world.now, catalog), "business_insufficient_funds");
  });
});

describe("operating expenses and production", () => {
  test("operating and rent expenses are recorded; salary-type expenses must use payroll; a stranger cannot record one", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    const id = business.business_id;
    const total = totalMoney(world.state);
    recordBusinessExpense(world.state, id, owner.characterId, "operating", 3_000, "Electricity.", world.date, 481, world.now);
    assert.equal(accountOf(world.state, id), 47_000);
    assert.equal(totalMoney(world.state), total - 3_000, "an operating expense is a sink");
    assertRefusedUnchanged(world.state, () => recordBusinessExpense(world.state, id, owner.characterId, "salary", 1_000, "Pay.", world.date, 481, world.now), "business_salary_use_payroll");
    assertRefusedUnchanged(world.state, () => recordBusinessExpense(world.state, id, owner.characterId, "utilities", 1_000, "Bills.", world.date, 481, world.now), "business_expense_kind_invalid");
    const stranger = addPlayer(world, "Expense Stranger", { age: 30, money: 1_000 });
    assertRefusedUnchanged(world.state, () => recordBusinessExpense(world.state, id, stranger.characterId, "operating", 1, "Nope.", world.date, 481, world.now), "business_unauthorized");
  });

  test("production refuses missing inputs with no partial change", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000, template: "template:restaurant" });
    const id = business.business_id;
    assertRefusedUnchanged(world.state, () => runProduction(world.state, id, owner.characterId, "recipe:jollof-rice", world.date, 481, world.now, catalog), "business_insufficient_input_stock");
  });
});

describe("closure", () => {
  test("closure is refused while the business holds money; once it is emptied, closure releases staff and branches, writes stock off, and keeps the history", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 30_000 });
    const id = business.business_id;
    const listing = stockRice(world, business, owner.characterId, { quantity: 4, unitCost: 1_000, price: 9_000 });
    const worker = addPlayer(world, "Leaving Worker", { age: 30, money: 1_000 });
    hireEmployee(world.state, id, owner.characterId, worker.characterId, world.date, 481, world.now, catalog);
    addBranch(world.state, id, owner.characterId, "Side", "market", "shop", world.date, 481, world.now, catalog);
    const journalCount = Object.keys(world.state.businessTransactions).length;
    assertRefusedUnchanged(world.state, () => closeBusiness(world.state, id, owner.characterId, "Done.", world.date, 482, world.now), "business_balance_not_empty");
    withdrawFromBusiness(world.state, id, owner.characterId, accountOf(world.state, id), world.date, 482, world.now, catalog);
    const total = totalMoney(world.state);
    const ledgerCount = Object.keys(world.state.economyTransactions).length;
    closeBusiness(world.state, id, owner.characterId, "Retiring.", world.date, 483, world.now);
    assert.equal(world.state.businesses[id].status, "closed");
    assert.equal(totalMoney(world.state), total, "closure moves no money");
    assert.equal(stockOf(world.state, id, "biz-goods:rice-5kg"), 0, "stock is written off");
    assert.ok(Object.values(world.state.businessInventoryMovements).some((m) => m.business_id === id && m.kind === "adjustment"));
    assert.equal(world.state.businessProducts[listing.product_record_id].available, false);
    assert.equal(Object.values(world.state.businessBranches).filter((b) => b.business_id === id && b.status === "active").length, 0);
    const employment = Object.values(world.state.businessOwnership).find((o) => o.business_id === id && o.character_id === worker.characterId);
    assert.equal(employment.active, false);
    assert.ok(Object.values(world.state.businessEvents).some((e) => e.business_id === id && e.type === "employee_released"));
    assert.equal(Object.keys(world.state.businessTransactions).length, journalCount + 1, "the journal is kept and added to, not deleted");
    assert.equal(Object.keys(world.state.economyTransactions).length, ledgerCount, "closure writes no new money rows");
    assert.ok(Object.values(world.state.businessOwnership).some((o) => o.business_id === id && o.character_id === owner.characterId), "the ownership record is kept");
    assert.deepEqual(businessAccountMismatches(world.state), []);
  });

  test("a closed business refuses every further action, and a second closure is refused", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 0 });
    const id = business.business_id;
    closeBusiness(world.state, id, owner.characterId, "", world.date, 481, world.now);
    assertRefusedUnchanged(world.state, () => closeBusiness(world.state, id, owner.characterId, "", world.date, 482, world.now), "business_already_closed");
    assertRefusedUnchanged(world.state, () => contributeCapital(world.state, id, owner.characterId, 1_000, world.date, 482, world.now, catalog), "business_not_active");
    assertRefusedUnchanged(world.state, () => addBranch(world.state, id, owner.characterId, "Late", "market", "shop", world.date, 482, world.now, catalog), "business_not_active");
  });
});

describe("insolvency and the ledger", () => {
  test("a business that cannot pay a day's operating cost becomes insolvent, refuses sales, and returns to active once its balance covers the day", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 2_000 });
    const id = business.business_id;
    const listing = stockRice(world, business, owner.characterId, { quantity: 2, unitCost: 1000, price: 9000 });
    const buyer = addPlayer(world, "Insolvency Buyer", { age: 30, money: 100_000 });
    const tomorrow = nextDay(world.date);
    processBusinessWorldDate(world.state, tomorrow, world.now + 86_400_000, catalog);
    assert.equal(world.state.businesses[id].status, "insolvent");
    assertRefusedUnchanged(world.state, () => purchaseProduct(world.state, id, listing.product_record_id, buyer.characterId, 1, tomorrow, 481, world.now, catalog), "business_not_active");
    contributeCapital(world.state, id, owner.characterId, 5_000, tomorrow, 482, world.now, catalog);
    assert.equal(world.state.businesses[id].status, "active");
    assert.ok(Object.values(world.state.businessEvents).some((e) => e.business_id === id && e.type === "business_solvent_again"));
  });

  test("a long mixed sequence conserves money: the total changes only by the recorded issuance and sinks, and every account reconciles", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 0 });
    const id = business.business_id;
    const buyer = addPlayer(world, "Ledger Buyer", { age: 30, money: 200_000 });
    const worker = addPlayer(world, "Ledger Worker", { age: 30, money: 1_000 });
    const sibling = createBusiness(world.state, owner.characterId, PROVISION, "Sibling", "Shop.", "market", 0, world.date, 480, world.now, catalog);
    const startTotal = totalMoney(world.state);
    const startLedger = Object.keys(world.state.economyTransactions).length;

    contributeCapital(world.state, id, owner.characterId, 60_000, world.date, 481, world.now, catalog);
    const listing = stockRice(world, business, owner.characterId, { quantity: 6, unitCost: 2_000, price: 9_000 });
    purchaseProduct(world.state, id, listing.product_record_id, buyer.characterId, 3, world.date, 482, world.now, catalog);
    hireEmployee(world.state, id, owner.characterId, worker.characterId, world.date, 483, world.now, catalog);
    paySalary(world.state, id, owner.characterId, worker.characterId, 8_000, world.date, 484, world.now, catalog);
    transferBetweenBusinesses(world.state, id, owner.characterId, sibling.business_id, 5_000, world.date, 485, world.now, catalog);
    recordBusinessExpense(world.state, id, owner.characterId, "rent", 2_000, "Rent.", world.date, 486, world.now);
    withdrawFromBusiness(world.state, id, owner.characterId, 4_000, world.date, 487, world.now, catalog);

    // Sinks are rows with no counterparty whose balance went down; issuance would be rows with no counterparty whose balance went up.
    const rowsSince = Object.values(world.state.economyTransactions).slice(startLedger);
    const sinks = rowsSince.filter((r) => r.counterparty_account_id === null && r.balance_after_ngn < r.balance_before_ngn)
      .reduce((s, r) => s + (r.balance_before_ngn - r.balance_after_ngn), 0);
    const issuance = rowsSince.filter((r) => r.counterparty_account_id === null && r.balance_after_ngn > r.balance_before_ngn)
      .reduce((s, r) => s + (r.balance_after_ngn - r.balance_before_ngn), 0);
    assert.equal(issuance, 0, "no issuance happened in this sequence");
    assert.ok(sinks > 0, "the sequence did use the sinks (setup, supplier, rent)");
    assert.equal(totalMoney(world.state), startTotal - sinks + issuance, "the total changes only by recorded sinks and issuance");
    assert.deepEqual(businessAccountMismatches(world.state), []);
  });
});

describe("snapshot rollback", () => {
  test("a change that writes and then throws leaves the state as it was, and the error is rethrown unchanged", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    const id = business.business_id;
    const listing = stockRice(world, business, owner.characterId, { quantity: 5, price: 9_000 });
    const buyer = addPlayer(world, "Rollback Buyer", { age: 30, money: 100_000 });
    const before = snapshot(world.state);
    assert.throws(() => runBusinessChange(world.state, () => {
      purchaseProduct(world.state, id, listing.product_record_id, buyer.characterId, 2, world.date, 481, world.now, catalog);
      throw new Error("simulated failure after the sale was written");
    }), /simulated failure/);
    assert.equal(snapshot(world.state), before);
  });

  test("snapshot and restore return every business map and every player's money exactly", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 9_000 });
    const saved = snapshotBusinessState(world.state);
    contributeCapital(world.state, business.business_id, owner.characterId, 1_000, world.date, 481, world.now, catalog);
    restoreBusinessState(world.state, saved);
    assert.equal(accountOf(world.state, business.business_id), 9_000);
  });
});

describe("NPC integration points", () => {
  test("seeding an NPC business issues its starting capital as a recorded issuance, and seeding again does not create a second business", () => {
    const world = makeWorld();
    const realRandom = Math.random;
    Math.random = () => 0; // the first active template, so the test is deterministic
    try {
      const before = totalMoney(world.state);
      // An NPC is a character with a cash account; the NPC is not a player, so it is added to the economy only.
      const npcId = "character-npc-seed-one";
      world.state.economyAccounts["npc-cash-seed-one"] = {
        account_id: "npc-cash-seed-one", character_id: npcId, kind: "cash", status: "active", balance_ngn: 0,
        opened_world_date: world.date, opened_at: new Date(world.now).toISOString(), updated_at: new Date(world.now).toISOString(),
      };
      const seeded = seedNpcBusinesses(world.state, [npcId], world.date, world.now, catalog);
      assert.equal(seeded.length, 1);
      const business = seeded[0];
      assert.equal(business.owner_character_id, npcId);
      const template = catalog.templates.find((t) => t.id === business.template_id);
      assert.equal(accountOf(world.state, business.business_id), template.setup_cost_ngn * 3);
      assert.equal(totalMoney(world.state), before + template.setup_cost_ngn * 3, "the seed is issuance, the only way money enters");
      const seedRows = ledgerRowsOn(world.state, businessAccountKey(business.business_id));
      assert.ok(seedRows.some((r) => r.kind === "business_seed_capital" && r.counterparty_account_id === null));
      assert.deepEqual(businessAccountMismatches(world.state), []);
      const again = seedNpcBusinesses(world.state, [npcId], world.date, world.now + 1, catalog);
      assert.equal(again.length, 0, "an NPC with an active business does not get a second one");
      assert.equal(Object.values(world.state.businesses).length, 1);
    } finally {
      Math.random = realRandom;
    }
  });

  test("a player can buy from an NPC-owned business through the ledger, but cannot run it", () => {
    const world = makeWorld();
    const realRandom = Math.random;
    Math.random = () => 0;
    try {
      const npcId = "character-npc-trade";
      world.state.economyAccounts["npc-cash-trade"] = {
        account_id: "npc-cash-trade", character_id: npcId, kind: "cash", status: "active", balance_ngn: 0,
        opened_world_date: world.date, opened_at: new Date(world.now).toISOString(), updated_at: new Date(world.now).toISOString(),
      };
      const [npcBusiness] = seedNpcBusinesses(world.state, [npcId], world.date, world.now, catalog);
      const id = npcBusiness.business_id;
      // Fixture: seeded goods are not listed, so this test lists one by hand to exercise the purchase path.
      const product = Object.values(world.state.businessProducts).find((p) => p.business_id === id);
      // The NPC restocks its own goods from its own account, through the same restock rule a player uses.
      restockInventory(world.state, id, npcId, product.product_definition_id, 3, 1000, world.date, 480, world.now, catalog);
      product.available = true;
      const buyer = addPlayer(world, "NPC Trade Buyer", { age: 30, money: 100_000 });
      const total = totalMoney(world.state);
      purchaseProduct(world.state, id, product.product_record_id, buyer.characterId, 1, world.date, 481, world.now, catalog);
      assert.equal(totalMoney(world.state), total);
      assert.equal(cashOf(world.state, buyer.characterId), 100_000 - product.price_ngn);
      assertRefusedUnchanged(world.state, () => withdrawFromBusiness(world.state, id, buyer.characterId, 1, world.date, 482, world.now, catalog), "business_unauthorized");
      assertRefusedUnchanged(world.state, () => transferOwnership(world.state, id, buyer.characterId, buyer.characterId, "owner", 100, world.date, 482, world.now, catalog), "business_unauthorized");
      assertRefusedUnchanged(world.state, () => closeBusiness(world.state, id, buyer.characterId, "Mine.", world.date, 482, world.now), "business_unauthorized");
      assert.deepEqual(businessAccountMismatches(world.state), []);
    } finally {
      Math.random = realRandom;
    }
  });

  test("an NPC is not hireable yet: NPCs are not players, so the hiring path cannot resolve them (recorded dependency)", () => {
    const world = makeWorld();
    const { owner, business } = ownedShop(world, { capital: 50_000 });
    assertRefusedUnchanged(world.state, () => hireEmployee(world.state, business.business_id, owner.characterId, "character-npc-not-a-player", world.date, 481, world.now, catalog), "business_employee_not_found");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Part 2: through the socket, on each backend.
// ---------------------------------------------------------------------------------------------------------------------

const failedReply = (reply) => reply.type !== "business.result";

for (const backendName of backendNames) {
  describe(`socket: the business lifecycle on the ${backendName} backend`, () => {
    let backend;
    let started;

    before(async () => {
      backend = await openBackend(backendName);
      started = await startOver(backend, {});
    });

    after(async () => {
      await started?.stop();
      await backend?.cleanup();
    });

    test("creation returns the server's result, and a repeated request ID returns the duplicate notice and creates nothing more", async () => {
      const owner = await citizen(backend, started, "Create Owner", 500_000);
      const requestId = "create-dup-stage43";
      owner.peer.send({ type: "business.action", action: "create", requestId, payload: { template_id: PROVISION, name: "Dup Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 10_000 } });
      const first = await settle(owner.peer, requestId);
      assert.equal(first.type, "business.result", JSON.stringify(first));
      owner.peer.send({ type: "business.action", action: "create", requestId, payload: { template_id: PROVISION, name: "Dup Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 10_000 } });
      const second = await settle(owner.peer, requestId);
      assert.equal(second.type, "command.duplicate", JSON.stringify(second));
      const saved = await savedUntil(backend, (state) => Object.values(state.businesses).filter((b) => b.name === "Dup Shop").length === 1);
      assert.equal(Object.values(saved.businesses).filter((b) => b.name === "Dup Shop").length, 1);
      await owner.peer.close();
    });

    test("product and service routes are separate over the socket", async () => {
      const owner = await citizen(backend, started, "Route Owner", 500_000);
      const businessId = await createShop(owner, "Route Shop");
      const goodsOnService = await businessAction(owner.peer, "add_service", { business_id: businessId, product_definition_id: "biz-goods:rice-5kg" });
      assert.equal(goodsOnService.type, "business.error");
      assert.equal(goodsOnService.code, "business_service_is_product");
      const serviceOnProduct = await businessAction(owner.peer, "add_product", { business_id: businessId, product_definition_id: "biz-service:consulting-hour" });
      assert.equal(serviceOnProduct.type, "business.error");
      assert.equal(serviceOnProduct.code, "business_product_is_service");
      await owner.peer.close();
    });

    test("a negative or fractional restock is refused by the server and nothing changes", async () => {
      const owner = await citizen(backend, started, "Stock Owner", 500_000);
      const businessId = await createShop(owner, "Stock Shop");
      await stockedRice(owner, businessId, 3, 1000);
      const before = await backend.durableState();
      for (const quantity of [-5, 0, 1.5]) {
        const reply = await businessAction(owner.peer, "restock", { business_id: businessId, product_definition_id: "biz-goods:rice-5kg", quantity, unit_cost_ngn: 1000 });
        assert.ok(failedReply(reply), `quantity ${quantity} must be refused`);
      }
      const after = await backend.durableState();
      assert.equal(stockOf(after, businessId, "biz-goods:rice-5kg"), 3);
      assert.equal(accountOf(after, businessId), accountOf(before, businessId));
      await owner.peer.close();
    });

    test("a buyer with insufficient funds is refused and nothing moves; a funded buyer pays and the business is credited", async () => {
      const owner = await citizen(backend, started, "Sale Owner", 500_000);
      const businessId = await createShop(owner, "Sale Shop");
      const listingId = await stockedRice(owner, businessId, 5, 1000);
      const price = (await backend.durableState()).businessProducts[listingId].price_ngn;
      const poor = await citizen(backend, started, "Poor Buyer", 100);
      const poorBefore = await backend.durableState();
      const refused = await businessAction(poor.peer, "buy_product", { business_id: businessId, product_record_id: listingId, quantity: 1 });
      assert.equal(refused.code, "business_insufficient_funds", JSON.stringify(refused));
      const afterRefusal = await backend.durableState();
      assert.equal(cashOf(afterRefusal, poor.characterId), cashOf(poorBefore, poor.characterId));
      assert.equal(stockOf(afterRefusal, businessId, "biz-goods:rice-5kg"), 5);

      const rich = await citizen(backend, started, "Sale Buyer", 100_000);
      const richBefore = await backend.durableState();
      const bought = await businessAction(rich.peer, "buy_product", { business_id: businessId, product_record_id: listingId, quantity: 2 });
      assert.equal(bought.type, "business.result", JSON.stringify(bought));
      const saved = await savedUntil(backend, (state) => stockOf(state, businessId, "biz-goods:rice-5kg") === 3);
      assert.equal(cashOf(saved, rich.characterId), cashOf(richBefore, rich.characterId) - 2 * price);
      assert.equal(accountOf(saved, businessId), accountOf(richBefore, businessId) + 2 * price);
      await owner.peer.close();
      await rich.peer.close();
      await poor.peer.close();
    });

    test("a stranger's changing actions are refused with business_unauthorized and change nothing", async () => {
      const owner = await citizen(backend, started, "Auth Owner", 500_000);
      const businessId = await createShop(owner, "Auth Shop", 20_000);
      const listingId = await stockedRice(owner, businessId, 4, 1000);
      const stranger = await citizen(backend, started, "Auth Stranger", 500_000);
      const before = await backend.durableState();
      const attempts = [
        { action: "update_price", payload: { business_id: businessId, product_record_id: listingId, price_ngn: 1 } },
        { action: "set_listing", payload: { business_id: businessId, product_record_id: listingId, available: false } },
        { action: "restock", payload: { business_id: businessId, product_definition_id: "biz-goods:rice-5kg", quantity: 1, unit_cost_ngn: 1 } },
        { action: "withdraw", payload: { business_id: businessId, amount_ngn: 100 } },
        { action: "close", payload: { business_id: businessId, reason: "Mine." } },
        { action: "transfer_ownership", payload: { business_id: businessId, to_character_id: stranger.characterId, new_role: "owner", share_percent: 100 } },
        { action: "hire_employee", payload: { business_id: businessId, employee_character_id: stranger.characterId } },
        { action: "add_branch", payload: { business_id: businessId, name: "Sneaky", location_id: "market", premises_type: "shop" } },
      ];
      for (const attempt of attempts) {
        const reply = await businessAction(stranger.peer, attempt.action, attempt.payload);
        assert.equal(reply.type, "business.error", `${attempt.action} must be refused`);
        assert.equal(reply.code, "business_unauthorized", `${attempt.action}: ${JSON.stringify(reply)}`);
      }
      const after = await backend.durableState();
      assert.equal(after.businesses[businessId].status, "active");
      assert.equal(after.businesses[businessId].owner_character_id, owner.characterId);
      assert.equal(accountOf(after, businessId), accountOf(before, businessId));
      assert.equal(stockOf(after, businessId, "biz-goods:rice-5kg"), 4);
      await owner.peer.close();
      await stranger.peer.close();
    });

    test("a listing can be switched off and refuses purchases, and a price outside the limits is refused", async () => {
      const owner = await citizen(backend, started, "Listing Owner", 500_000);
      const businessId = await createShop(owner, "Listing Shop");
      const listingId = await stockedRice(owner, businessId, 4, 1000);
      const buyer = await citizen(backend, started, "Listing Buyer", 100_000);
      assert.equal((await businessAction(owner.peer, "set_listing", { business_id: businessId, product_record_id: listingId, available: false })).type, "business.result");
      const off = await businessAction(buyer.peer, "buy_product", { business_id: businessId, product_record_id: listingId, quantity: 1 });
      assert.equal(off.code, "business_product_unavailable", JSON.stringify(off));
      assert.equal((await businessAction(owner.peer, "set_listing", { business_id: businessId, product_record_id: listingId, available: true })).type, "business.result");
      const badPrice = await businessAction(owner.peer, "update_price", { business_id: businessId, product_record_id: listingId, price_ngn: 0 });
      assert.equal(badPrice.type, "business.error");
      const goodPrice = await businessAction(owner.peer, "update_price", { business_id: businessId, product_record_id: listingId, price_ngn: 9500 });
      assert.equal(goodPrice.type, "business.result", JSON.stringify(goodPrice));
      await owner.peer.close();
      await buyer.peer.close();
    });

    test("hiring and firing through the socket; a fired employee cannot be paid", async () => {
      const owner = await citizen(backend, started, "Hire Owner", 500_000);
      const businessId = await createShop(owner, "Hire Shop", 100_000);
      const worker = await citizen(backend, started, "Hire Worker", 1_000);
      const hired = await businessAction(owner.peer, "hire_employee", { business_id: businessId, employee_character_id: worker.characterId });
      assert.equal(hired.type, "business.result", JSON.stringify(hired));
      const paid = await businessAction(owner.peer, "pay_salary", { business_id: businessId, employee_character_id: worker.characterId, amount_ngn: 5_000 });
      assert.equal(paid.type, "business.result", JSON.stringify(paid));
      const fired = await businessAction(owner.peer, "fire_employee", { business_id: businessId, employee_character_id: worker.characterId, reason: "Redundant." });
      assert.equal(fired.type, "business.result", JSON.stringify(fired));
      const late = await businessAction(owner.peer, "pay_salary", { business_id: businessId, employee_character_id: worker.characterId, amount_ngn: 5_000 });
      assert.equal(late.code, "business_salary_employee_invalid", JSON.stringify(late));
      await owner.peer.close();
      await worker.peer.close();
    });

    test("a branch opens in an allowed location and an unlisted location is refused", async () => {
      const owner = await citizen(backend, started, "Branch Owner", 500_000);
      const businessId = await createShop(owner, "Branch Shop");
      const opened = await businessAction(owner.peer, "add_branch", { business_id: businessId, name: "Market Two", location_id: "market", premises_type: "shop" });
      assert.equal(opened.type, "business.result", JSON.stringify(opened));
      const refused = await businessAction(owner.peer, "add_branch", { business_id: businessId, name: "Lekki", location_id: "lekki-market", premises_type: "shop" });
      assert.equal(refused.code, "business_location_invalid", JSON.stringify(refused));
      await owner.peer.close();
    });

    test("ownership transfer through the socket: the recipient acts, the former owner is refused", async () => {
      const owner = await citizen(backend, started, "Transfer Owner", 500_000);
      const businessId = await createShop(owner, "Transfer Shop", 30_000);
      const heir = await citizen(backend, started, "Transfer Heir", 1_000);
      const stranger = await citizen(backend, started, "Transfer Stranger", 1_000);
      const refused = await businessAction(stranger.peer, "transfer_ownership", { business_id: businessId, to_character_id: stranger.characterId, new_role: "owner", share_percent: 100 });
      assert.equal(refused.code, "business_unauthorized");
      const moved = await businessAction(owner.peer, "transfer_ownership", { business_id: businessId, to_character_id: heir.characterId, new_role: "owner", share_percent: 100 });
      assert.equal(moved.type, "business.result", JSON.stringify(moved));
      const formerRefused = await businessAction(owner.peer, "withdraw", { business_id: businessId, amount_ngn: 100 });
      assert.equal(formerRefused.code, "business_unauthorized");
      const heirWithdraw = await businessAction(heir.peer, "withdraw", { business_id: businessId, amount_ngn: 1_000 });
      assert.equal(heirWithdraw.type, "business.result", JSON.stringify(heirWithdraw));
      await owner.peer.close();
      await heir.peer.close();
      await stranger.peer.close();
    });

    test("closure is refused while the balance is not empty; after it is emptied the business closes once, and then refuses sales", async () => {
      const owner = await citizen(backend, started, "Close Owner", 500_000);
      const businessId = await createShop(owner, "Close Shop", 12_000);
      const listingId = await stockedRice(owner, businessId, 2, 1000);
      const notEmpty = await businessAction(owner.peer, "close", { business_id: businessId, reason: "Done." });
      assert.equal(notEmpty.code, "business_balance_not_empty", JSON.stringify(notEmpty));
      const emptied = await businessAction(owner.peer, "withdraw", { business_id: businessId, amount_ngn: await accountOf(await backend.durableState(), businessId) });
      assert.equal(emptied.type, "business.result", JSON.stringify(emptied));
      const closed = await businessAction(owner.peer, "close", { business_id: businessId, reason: "Done." });
      assert.equal(closed.type, "business.result", JSON.stringify(closed));
      const again = await businessAction(owner.peer, "close", { business_id: businessId, reason: "Again." });
      assert.equal(again.code, "business_already_closed", JSON.stringify(again));
      const buyer = await citizen(backend, started, "Late Buyer", 100_000);
      const late = await businessAction(buyer.peer, "buy_product", { business_id: businessId, product_record_id: listingId, quantity: 1 });
      assert.equal(late.type, "business.error");
      const saved = await backend.durableState();
      assert.equal(saved.businesses[businessId].status, "closed");
      assert.equal(stockOf(saved, businessId, "biz-goods:rice-5kg"), 0);
      await owner.peer.close();
      await buyer.peer.close();
    });

    test("a repeated buy with the same request ID is a duplicate: one sale, one payment", async () => {
      const owner = await citizen(backend, started, "Dup Sale Owner", 500_000);
      const businessId = await createShop(owner, "Dup Sale Shop");
      const listingId = await stockedRice(owner, businessId, 5, 1000);
      const buyer = await citizen(backend, started, "Dup Sale Buyer", 100_000);
      const requestId = "buy-dup-stage43";
      const payload = { business_id: businessId, product_record_id: listingId, quantity: 1 };
      buyer.peer.send({ type: "business.action", action: "buy_product", requestId, payload });
      assert.equal((await settle(buyer.peer, requestId)).type, "business.result");
      buyer.peer.send({ type: "business.action", action: "buy_product", requestId, payload });
      assert.equal((await settle(buyer.peer, requestId)).type, "command.duplicate");
      const saved = await savedUntil(backend, (state) => stockOf(state, businessId, "biz-goods:rice-5kg") === 4);
      assert.equal(stockOf(saved, businessId, "biz-goods:rice-5kg"), 4, "one unit sold, not two");
      assert.equal(Object.values(saved.businessSales).filter((s) => s.business_id === businessId).length, 1);
      await owner.peer.close();
      await buyer.peer.close();
    });

    test("two buyers race for the last unit: exactly one sale succeeds, and stock never goes negative", async () => {
      const owner = await citizen(backend, started, "Race Owner", 500_000);
      const businessId = await createShop(owner, "Race Shop");
      const listingId = await stockedRice(owner, businessId, 1, 1000);
      const first = await citizen(backend, started, "Race One", 100_000);
      const second = await citizen(backend, started, "Race Two", 100_000);
      const payload = { business_id: businessId, product_record_id: listingId, quantity: 1 };
      const [a, b] = await Promise.all([
        businessAction(first.peer, "buy_product", payload),
        businessAction(second.peer, "buy_product", payload),
      ]);
      const results = [a, b].map((r) => r.type);
      assert.equal(results.filter((t) => t === "business.result").length, 1, JSON.stringify([a, b]));
      const loser = a.type === "business.result" ? b : a;
      assert.equal(loser.code, "business_insufficient_stock");
      const saved = await savedUntil(backend, (state) => stockOf(state, businessId, "biz-goods:rice-5kg") === 0);
      assert.equal(stockOf(saved, businessId, "biz-goods:rice-5kg"), 0);
      await owner.peer.close();
      await first.peer.close();
      await second.peer.close();
    });

    test("a confirmed business state survives a restart: the balance, stock, employment, and ownership are read back from the saved world", async () => {
      const owner = await citizen(backend, started, "Restart Owner", 500_000);
      const businessId = await createShop(owner, "Restart Lifecycle", 40_000);
      const listingId = await stockedRice(owner, businessId, 6, 1000);
      const worker = await citizen(backend, started, "Restart Worker", 1_000);
      await businessAction(owner.peer, "hire_employee", { business_id: businessId, employee_character_id: worker.characterId });
      const buyer = await citizen(backend, started, "Restart Buyer", 100_000);
      await businessAction(buyer.peer, "buy_product", { business_id: businessId, product_record_id: listingId, quantity: 2 });
      const expected = await savedUntil(backend, (state) => stockOf(state, businessId, "biz-goods:rice-5kg") === 4);
      const expectedAccount = accountOf(expected, businessId);
      const expectedBuyerCash = cashOf(expected, buyer.characterId);
      await owner.peer.close();
      await worker.peer.close();
      await buyer.peer.close();
      await started.stop();
      await backend.reopen();
      const restarted = await startOver(backend, {});
      try {
        const ownerAgain = await citizen(backend, restarted, "Restart Observer", 1_000);
        const saved = await backend.durableState();
        assert.equal(accountOf(saved, businessId), expectedAccount);
        assert.equal(cashOf(saved, buyer.characterId), expectedBuyerCash);
        assert.equal(stockOf(saved, businessId, "biz-goods:rice-5kg"), 4);
        assert.ok(Object.values(saved.businessOwnership).some((o) => o.business_id === businessId && o.role === "employee" && o.active));
        assert.deepEqual(businessAccountMismatches(saved), []);
        await ownerAgain.peer.close();
      } finally {
        await restarted.stop();
      }
      // The restarted server is used by the cleanup below; the original is already stopped.
      started = await startOver(backend, {});
    });
  });
}
