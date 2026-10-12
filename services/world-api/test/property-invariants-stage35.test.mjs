// Property service invariants (Stage 35), in memory: each money or ownership path validates before it changes anything.
// A refused operation must leave every property, ownership, listing, rental, and cash record exactly as it was. A success
// must move the money and the ownership together (no debit without the ownership change, no contradictory owners).
// Socket and persistence behaviour is tested in property-mutation-stage35.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPropertyCatalog } from "../dist/properties/catalog.js";
import {
  createRentalAgreement,
  listPropertyForRent,
  listPropertyForSale,
  purchaseProperty,
  recordMaintenance,
  seedProperties,
  transferProperty,
} from "../dist/properties/service.js";
import { activeOwnersOf, addPlayer, balanceOf, cashAccountOf, makeWorld, propertyContent } from "./support/property-world.mjs";

const catalog = loadPropertyCatalog();

function seededWorld(overrides = {}) {
  const world = makeWorld();
  seedProperties(world.state, world.date, world.now, catalog);
  return { ...world, catalog: overrides.catalog ?? catalog };
}

const minute = (world) => world.state.worldClock.minute_of_day;
const later = (world, ms = 60_000) => world.now + ms;

function saleListings(state) {
  return Object.values(state.propertyListings).filter((l) => l.listing_type === "sale" && l.available);
}

function rentListings(state) {
  return Object.values(state.propertyListings).filter((l) => l.listing_type === "rent" && l.available);
}

/** Buys a seeded NPC-owned listing for `buyer` (a player), so that the buyer owns a non-land property. */
function buyNonLand(world, buyer, price) {
  const listing = saleListings(world.state).find((l) => !world.state.properties[l.property_id].is_land && (price === undefined || l.asking_price_ngn <= price));
  assert.ok(listing, "premise: a seeded non-land sale listing exists");
  purchaseProperty(world.state, buyer.characterId, listing.listing_id, world.date, minute(world), later(world), world.catalog);
  return listing.property_id;
}

test("purchase: the buyer's debit and the seller's credit are the sale price, and the buyer becomes the only active owner", () => {
  const world = seededWorld();
  const buyer = addPlayer(world, "Buyer", { money: 50_000_000 });
  const listing = saleListings(world.state).find((l) => !world.state.properties[l.property_id].is_land);
  const sellerOwner = Object.values(world.state.propertyOwnership).find((o) => o.property_id === listing.property_id && o.active);
  const before = balanceOf(world.state, buyer.characterId);

  const result = purchaseProperty(world.state, buyer.characterId, listing.listing_id, world.date, minute(world), later(world), world.catalog);

  assert.equal(before - balanceOf(world.state, buyer.characterId), listing.asking_price_ngn, "the buyer is debited the price");
  assert.deepEqual(activeOwnersOf(world.state, listing.property_id), [buyer.characterId], "exactly one active owner: the buyer");
  assert.equal(result.sale.amount_ngn, listing.asking_price_ngn);
  assert.equal(world.state.propertyOwnership[sellerOwner.ownership_id].active, false, "the seller's ownership ends");
  assert.equal(world.state.propertyOwnership[sellerOwner.ownership_id].end_reason, "sold");
  assert.equal(listing.available, false, "the listing is single-use");
});

test("purchase: an invalid asking price is refused before any change", () => {
  const world = seededWorld();
  const buyer = addPlayer(world, "Buyer", { money: 50_000_000 });
  const listing = saleListings(world.state)[0];
  listing.asking_price_ngn = 1;
  const before = propertyContent(world.state);
  assert.throws(
    () => purchaseProperty(world.state, buyer.characterId, listing.listing_id, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_price_invalid",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
});

test("purchase: an unavailable listing is refused; the second buyer is not charged and the first buyer keeps the property", () => {
  const world = seededWorld();
  const first = addPlayer(world, "First", { money: 50_000_000 });
  const second = addPlayer(world, "Second", { money: 50_000_000 });
  const listing = saleListings(world.state).find((l) => !world.state.properties[l.property_id].is_land);
  purchaseProperty(world.state, first.characterId, listing.listing_id, world.date, minute(world), later(world), world.catalog);
  const secondBefore = balanceOf(world.state, second.characterId);
  const before = propertyContent(world.state);

  assert.throws(
    () => purchaseProperty(world.state, second.characterId, listing.listing_id, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_listing_unavailable",
  );
  assert.equal(balanceOf(world.state, second.characterId), secondBefore, "the second buyer is not charged");
  assert.equal(propertyContent(world.state), before, "nothing changed");
  assert.deepEqual(activeOwnersOf(world.state, listing.property_id), [first.characterId]);
});

test("purchase: insufficient funds are refused before any change", () => {
  const world = seededWorld();
  const buyer = addPlayer(world, "Poor", { money: 10 });
  const listing = saleListings(world.state).find((l) => !world.state.properties[l.property_id].is_land);
  const before = propertyContent(world.state);
  assert.throws(
    () => purchaseProperty(world.state, buyer.characterId, listing.listing_id, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_insufficient_funds",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
});

test("purchase: the current owner cannot buy their own listing (self-dealing rule kept)", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  buyNonLand(world, owner);
  const propertyId = Object.values(world.state.propertyOwnership).find((o) => o.owner_id === owner.characterId && o.active).property_id;
  const listed = listPropertyForSale(world.state, propertyId, owner.characterId, catalog.rules.minimum_property_price_ngn, world.date, minute(world), later(world), world.catalog);
  const before = propertyContent(world.state);
  assert.throws(
    () => purchaseProperty(world.state, owner.characterId, listed.listing_id, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_already_owner",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
});

test("purchase from a player seller with no cash account is refused before the buyer is debited or the ownership moves", () => {
  const world = seededWorld();
  const seller = addPlayer(world, "Seller", { money: 50_000_000 });
  const propertyId = buyNonLand(world, seller);
  const listed = listPropertyForSale(world.state, propertyId, seller.characterId, catalog.rules.minimum_property_price_ngn, world.date, minute(world), later(world), world.catalog);
  const buyer = addPlayer(world, "Buyer", { money: 50_000_000 });
  // Setup: the seller loses the account that would be credited.
  delete world.state.economyAccounts[cashAccountOf(world.state, seller.characterId).account_id];
  const before = propertyContent(world.state);
  const buyerBefore = balanceOf(world.state, buyer.characterId);

  assert.throws(
    () => purchaseProperty(world.state, buyer.characterId, listed.listing_id, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_no_cash_account",
  );
  assert.equal(balanceOf(world.state, buyer.characterId), buyerBefore, "the buyer is not debited");
  assert.equal(propertyContent(world.state), before, "no ownership, listing, or money record changed");
  assert.deepEqual(activeOwnersOf(world.state, propertyId), [seller.characterId]);
});

test("rent: a player landlord with no cash account is refused before the tenant is debited", () => {
  const world = seededWorld();
  const landlord = addPlayer(world, "Landlord", { money: 50_000_000 });
  const propertyId = buyNonLand(world, landlord);
  const rentListing = listPropertyForRent(world.state, propertyId, landlord.characterId, catalog.rules.minimum_rent_price_ngn, "yearly", 0, world.date, minute(world), later(world), world.catalog);
  const tenant = addPlayer(world, "Tenant", { money: 50_000_000 });
  delete world.state.economyAccounts[cashAccountOf(world.state, landlord.characterId).account_id];
  const before = propertyContent(world.state);
  const tenantBefore = balanceOf(world.state, tenant.characterId);

  assert.throws(
    () => createRentalAgreement(world.state, tenant.characterId, rentListing.listing_id, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_no_cash_account",
  );
  assert.equal(balanceOf(world.state, tenant.characterId), tenantBefore, "the tenant is not debited");
  assert.equal(propertyContent(world.state), before, "no rental, payment, or listing record changed");
  assert.equal(rentListing.available, true, "the listing is still available");
});

test("rent: a successful rental debits the tenant once and credits a player landlord the same amount", () => {
  const world = seededWorld();
  const landlord = addPlayer(world, "Landlord", { money: 50_000_000 });
  const propertyId = buyNonLand(world, landlord);
  const rentListing = listPropertyForRent(world.state, propertyId, landlord.characterId, catalog.rules.minimum_rent_price_ngn, "yearly", 0, world.date, minute(world), later(world), world.catalog);
  const tenant = addPlayer(world, "Tenant", { money: 50_000_000 });
  const landlordBefore = balanceOf(world.state, landlord.characterId);
  const tenantBefore = balanceOf(world.state, tenant.characterId);

  createRentalAgreement(world.state, tenant.characterId, rentListing.listing_id, world.date, minute(world), later(world), world.catalog);

  const due = rentListing.rent_price_ngn;
  assert.equal(tenantBefore - balanceOf(world.state, tenant.characterId), due);
  assert.equal(balanceOf(world.state, landlord.characterId) - landlordBefore, due);
  assert.equal(rentListing.available, false);
});

test("maintenance: insufficient funds are refused before the condition or the record changes", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const propertyId = buyNonLand(world, owner);
  const property = world.state.properties[propertyId];
  cashAccountOf(world.state, owner.characterId).balance_ngn = 10;
  const newCondition = catalog.rules.property_condition_levels.find((c) => c !== property.condition);
  const before = propertyContent(world.state);

  assert.throws(
    () => recordMaintenance(world.state, propertyId, owner.characterId, "Roof repair", 5000, newCondition, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_insufficient_funds",
  );
  assert.equal(propertyContent(world.state), before, "no condition, maintenance, or money record changed");
});

test("maintenance: a player without a cash account is refused before the condition changes", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const propertyId = buyNonLand(world, owner);
  const property = world.state.properties[propertyId];
  delete world.state.economyAccounts[cashAccountOf(world.state, owner.characterId).account_id];
  const newCondition = catalog.rules.property_condition_levels.find((c) => c !== property.condition);
  const before = propertyContent(world.state);

  assert.throws(
    () => recordMaintenance(world.state, propertyId, owner.characterId, "Roof repair", 5000, newCondition, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_no_cash_account",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
});

test("maintenance: a paid repair debits the owner once and records the condition change", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const propertyId = buyNonLand(world, owner);
  const property = world.state.properties[propertyId];
  const newCondition = catalog.rules.property_condition_levels.find((c) => c !== property.condition);
  const before = balanceOf(world.state, owner.characterId);

  recordMaintenance(world.state, propertyId, owner.characterId, "Roof repair", 5000, newCondition, world.date, minute(world), later(world), world.catalog);

  assert.equal(before - balanceOf(world.state, owner.characterId), 5000);
  assert.equal(world.state.properties[propertyId].condition, newCondition);
  assert.equal(Object.values(world.state.propertyMaintenance).filter((m) => m.property_id === propertyId).length, 1);
});

test("list for sale by someone who does not own the property is refused before any change", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const stranger = addPlayer(world, "Stranger", { money: 50_000_000 });
  const propertyId = buyNonLand(world, owner);
  const before = propertyContent(world.state);
  assert.throws(
    () => listPropertyForSale(world.state, propertyId, stranger.characterId, catalog.rules.minimum_property_price_ngn, world.date, minute(world), later(world), world.catalog),
    (error) => error.message === "property_not_owner",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
});

test("transfer: a recipient already at the ownership limit is refused, and the property keeps its owner", () => {
  const world = seededWorld();
  const tight = structuredClone(catalog);
  tight.rules.maximum_properties_per_character = 1;
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const recipient = addPlayer(world, "Recipient", { money: 50_000_000 });
  const propertyId = buyNonLand(world, owner);
  buyNonLand(world, recipient);
  const before = propertyContent(world.state);

  assert.throws(
    () => transferProperty(world.state, propertyId, owner.characterId, recipient.characterId, world.date, minute(world), later(world), tight),
    (error) => error.message === "property_limit_reached",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
  assert.deepEqual(activeOwnersOf(world.state, propertyId), [owner.characterId]);
});

test("transfer: a recipient below the minimum purchase age is refused", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const child = addPlayer(world, "Child", { age: 10 });
  const propertyId = buyNonLand(world, owner);
  const before = propertyContent(world.state);
  assert.throws(
    () => transferProperty(world.state, propertyId, owner.characterId, child.characterId, world.date, minute(world), later(world), catalog),
    (error) => error.message === "property_age_ineligible",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
});

test("transfer: a deceased recipient is refused, and a transfer to oneself is refused", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const dead = addPlayer(world, "Late", { life_status: "deceased" });
  const propertyId = buyNonLand(world, owner);
  const before = propertyContent(world.state);
  assert.throws(
    () => transferProperty(world.state, propertyId, owner.characterId, dead.characterId, world.date, minute(world), later(world), catalog),
    (error) => error.message === "property_character_deceased",
  );
  assert.throws(
    () => transferProperty(world.state, propertyId, owner.characterId, owner.characterId, world.date, minute(world), later(world), catalog),
    (error) => error.message === "property_transfer_same_character",
  );
  assert.equal(propertyContent(world.state), before, "nothing changed");
});

test("transfer: a valid transfer makes the recipient the only active owner, and moves no money", () => {
  const world = seededWorld();
  const owner = addPlayer(world, "Owner", { money: 50_000_000 });
  const recipient = addPlayer(world, "Recipient", { money: 50_000_000 });
  const propertyId = buyNonLand(world, owner);
  const balances = [balanceOf(world.state, owner.characterId), balanceOf(world.state, recipient.characterId)];

  transferProperty(world.state, propertyId, owner.characterId, recipient.characterId, world.date, minute(world), later(world), catalog);

  assert.deepEqual(activeOwnersOf(world.state, propertyId), [recipient.characterId]);
  assert.deepEqual(
    [balanceOf(world.state, owner.characterId), balanceOf(world.state, recipient.characterId)],
    balances,
    "a transfer is not a sale: no money moves",
  );
});
