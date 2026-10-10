import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { loadPropertyCatalog, validatePropertyCatalogForTest } from "../dist/properties/catalog.js";
import {
  initializePropertyWorldState,
  seedProperties,
  searchPropertyMarket,
  purchaseProperty,
  listPropertyForSale,
  listPropertyForRent,
  createRentalAgreement,
  payRent,
  terminateRentalAgreement,
  recordMaintenance,
  purchaseFurniture,
  removeFurnishing,
  transferProperty,
  buildPropertyProfile,
  getCharacterProperties,
  getCharacterRentals,
  propertyErrorMessage,
} from "../dist/properties/service.js";
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

function validateWorldStateForTest(value) {
  if (typeof value !== "object" || value === null || typeof value.schemaVersion !== "number") {
    throw new Error("Invalid world state");
  }
  return value;
}

function makeWorld() {
  const catalog = loadLifeCatalog();
  const now = Date.UTC(2025, 0, 1);
  const state = {
    schemaVersion: 13,
    worldId: "nigeria-main",
    worldClock: normalizeWorldClock({ day: catalog.calendar.starting_world_day, minute_of_day: catalog.calendar.starting_minute_of_day, millisecond_of_minute: 0, updated_at: new Date(now).toISOString() }, now, catalog),
    players: {},
    people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
    careerEmployers: {}, careerVacancies: {}, careerApplications: {}, employments: {}, workSessions: {}, careerSkills: {}, careerLicenses: {}, careerReviews: {}, careerLeaveRequests: {}, careerEvents: {}, salaryPayments: {}, npcCareers: {},
    economyAccounts: {}, economyTransactions: {}, economyLoans: {}, economyCreditScores: {}, economyEvents: {},
    businesses: {}, businessOwnership: {}, businessBranches: {}, businessProducts: {}, businessInventory: {}, businessInventoryMovements: {}, businessTransactions: {}, businessExpenses: {}, businessSales: {}, businessProductionRuns: {}, businessEvents: {},
    properties: {}, propertyOwnership: {}, propertyListings: {}, rentalAgreements: {}, rentalPayments: {}, propertySales: {}, propertyMaintenance: {}, propertyFurnishings: {}, propertyEvents: {},
  };
  initializeEconomyWorldState(state, now);
  initializePropertyWorldState(state);
  return { state, date: state.worldClock.world_date, now };
}

function addPlayer(world, name, overrides = {}) {
  const playerId = `player-${randomUUID()}`;
  const characterId = `char-${randomUUID()}`;
  const age = overrides.age ?? 20;
  const money = overrides.money ?? 500000;
  const creationKey = randomBytes(32).toString("hex");
  const token = randomBytes(32).toString("hex");
  const now = new Date(world.now).toISOString();
  world.state.players[playerId] = {
    playerId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    creationKeyHash: createHash("sha256").update(creationKey).digest("hex"),
    recentRequestIds: [],
    createdAt: now,
    lastSeen: now,
    character: {
      player_id: playerId,
      character_id: characterId,
      name,
      age,
      character_type: "androgynous",
      appearance: {},
      money,
      health: 100,
      energy: 100,
      hunger: 50,
      education_level: "secondary",
      school_id: "",
      home_id: "",
      current_location: "market",
      position: { x: 0, y: 0 },
      direction: { x: 0, y: 0 },
      inventory: [],
      academic_scores: {},
      attendance: [],
      education_record: { schema_version: 1, student_id: characterId, enrollments: [], attempts: [], qualifications: [], tertiary_enrollment: null, skills: {}, history: [] },
      reputation: 50,
      household: {},
      geographic_location: null,
      created_at: now,
      updated_at: now,
      date_of_birth: { year: 2025 - age, month: 6, day: 15 },
      life_status: "alive",
      life_stage: age < 13 ? "child" : age < 18 ? "adolescent" : "adult",
      processed_through_date: { year: 2025, month: 1, day: 1 },
      family_id: null,
      household_id: null,
      partner_character_ids: [],
      child_character_ids: [],
      parent_character_ids: [],
      guardian_character_ids: [],
      sibling_character_ids: [],
    },
  };
  // Give the character a cash account with funds
  const cashAccounts = Object.values(world.state.economyAccounts).filter((a) => a.kind === "cash" && a.character_id === characterId);
  if (cashAccounts.length === 0) {
    const accountId = `econ-acc-${randomUUID()}`;
    world.state.economyAccounts[accountId] = {
      account_id: accountId,
      character_id: characterId,
      kind: "cash",
      bank_product_id: null,
      status: "active",
      balance_ngn: money,
      total_deposited_ngn: money,
      total_withdrawn_ngn: 0,
      opened_at: now,
      updated_at: now,
    };
  } else {
    cashAccounts[0].balance_ngn = money;
  }
  return { playerId, characterId, token, creationKey };
}

// ─── Catalog Tests ────────────────────────────────────────────────

test("property catalog loads, validates and exposes categories, types, locations and seed properties", () => {
  const catalog = loadPropertyCatalog();
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.world_id, "nigeria-main");
  assert.ok(catalog.property_categories.length >= 4);
  assert.ok(catalog.property_types.length >= 15);
  assert.ok(catalog.property_locations.length >= 8);
  assert.ok(catalog.seed_properties.length >= 8);
  assert.ok(catalog.furniture_catalog.length >= 8);
  assert.equal(catalog.rules.currency, "NGN");
  assert.ok(catalog.rules.minimum_purchase_age_years >= 18);
  assert.ok(catalog.rules.maximum_properties_per_character >= 1);

  const cat = validatePropertyCatalogForTest(catalog);
  assert.equal(cat.world_id, "nigeria-main");
});

test("property seed data creates properties with ownership and listings", () => {
  const world = makeWorld();
  const catalog = loadPropertyCatalog();
  const seeded = seedProperties(world.state, world.date, world.now, catalog);
  assert.ok(seeded.length >= 8);
  for (const prop of seeded) {
    assert.ok(world.state.properties[prop.property_id]);
    const ownership = Object.values(world.state.propertyOwnership).find((o) => o.property_id === prop.property_id && o.active);
    assert.ok(ownership, `Property ${prop.property_id} should have an owner`);
  }
  // Seed again should not create duplicates
  const seeded2 = seedProperties(world.state, world.date, world.now, catalog);
  assert.equal(seeded2.length, 0);
});

test("searchPropertyMarket filters by location, type, listing type, and price", () => {
  const world = makeWorld();
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const all = searchPropertyMarket(world.state, {}, catalog);
  assert.ok(all.listings.length >= 5);

  const forSale = searchPropertyMarket(world.state, { listing_type: "sale" }, catalog);
  assert.ok(forSale.total_for_sale > 0);
  assert.ok(forSale.listings.every((l) => l.listing_type === "sale"));

  const forRent = searchPropertyMarket(world.state, { listing_type: "rent" }, catalog);
  assert.ok(forRent.total_for_rent > 0);
  assert.ok(forRent.listings.every((l) => l.listing_type === "rent"));

  const akure = searchPropertyMarket(world.state, { location_id: "loc:akure-odo" }, catalog);
  assert.ok(akure.listings.every((l) => l.location_id === "loc:akure-odo"));

  const expensive = searchPropertyMarket(world.state, { listing_type: "sale", min_price_ngn: 20000000 }, catalog);
  assert.ok(expensive.listings.every((l) => l.asking_price_ngn >= 20000000));

  const bedroomFilter = searchPropertyMarket(world.state, { listing_type: "sale", min_bedrooms: 2 }, catalog);
  assert.ok(bedroomFilter.listings.every((l) => l.bedrooms >= 2));
});

test("purchaseProperty deducts funds, transfers ownership, and records the sale", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Buyer", { age: 25, money: 50000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const saleListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available);
  assert.ok(saleListing);

  const price = saleListing.asking_price_ngn;
  const result = purchaseProperty(world.state, characterId, saleListing.listing_id, world.date, 480, world.now, catalog);
  assert.equal(result.property.property_id, saleListing.property_id);
  assert.equal(result.sale.amount_ngn, price);
  assert.equal(result.ownership.owner_id, characterId);
  assert.equal(result.ownership.active, true);

  // Cash deducted
  const cashAccounts = Object.values(world.state.economyAccounts).filter((a) => a.kind === "cash" && a.character_id === characterId);
  assert.ok(cashAccounts[0].balance_ngn < 50000000);

  // Listing no longer available
  assert.equal(saleListing.available, false);
});

test("purchaseProperty rejects insufficient funds, underage, and unavailable listings", () => {
  const world = makeWorld();
  const { characterId: poorId } = addPlayer(world, "Poor Buyer", { age: 25, money: 1000 });
  const { characterId: youngId } = addPlayer(world, "Young Buyer", { age: 16, money: 50000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const saleListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available);
  assert.ok(saleListing);

  // Insufficient funds
  assert.throws(() => purchaseProperty(world.state, poorId, saleListing.listing_id, world.date, 480, world.now, catalog), /property_insufficient_funds/);

  // Underage
  assert.throws(() => purchaseProperty(world.state, youngId, saleListing.listing_id, world.date, 480, world.now, catalog), /property_age_ineligible/);

  // Already sold listing
  const { characterId: richId } = addPlayer(world, "Rich Buyer", { age: 25, money: 500000000 });
  purchaseProperty(world.state, richId, saleListing.listing_id, world.date, 480, world.now, catalog);
  assert.throws(() => purchaseProperty(world.state, richId, saleListing.listing_id, world.date, 480, world.now, catalog), /property_listing_unavailable|property_already_owner/);
});

test("listPropertyForSale and listPropertyForRent create listings for owned properties", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Owner", { age: 25, money: 500000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  // First purchase a property
  const saleListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available);
  const result = purchaseProperty(world.state, characterId, saleListing.listing_id, world.date, 480, world.now, catalog);
  const propertyId = result.property.property_id;

  // List for sale
  const saleList = listPropertyForSale(world.state, propertyId, characterId, 20000000, world.date, 480, world.now, catalog);
  assert.equal(saleList.listing_type, "sale");
  assert.equal(saleList.asking_price_ngn, 20000000);
  assert.equal(saleList.available, true);

  // List for rent on a different owned property (buy another one first)
  const rentSourceListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available);
  assert.ok(rentSourceListing);
  const result2 = purchaseProperty(world.state, characterId, rentSourceListing.listing_id, world.date, 480, world.now, catalog);

  const rentList = listPropertyForRent(world.state, result2.property.property_id, characterId, 300000, "yearly", 100000, world.date, 480, world.now, catalog);
  assert.equal(rentList.listing_type, "rent");
  assert.equal(rentList.rent_price_ngn, 300000);
  assert.equal(rentList.rent_period, "yearly");
  assert.equal(rentList.deposit_ngn, 100000);
});

test("unauthorized characters cannot list or sell another player's property", () => {
  const world = makeWorld();
  const { characterId: ownerId } = addPlayer(world, "Owner", { age: 25, money: 500000000 });
  const { characterId: otherId } = addPlayer(world, "Other", { age: 25, money: 500000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const result = purchaseProperty(world.state, ownerId, Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available).listing_id, world.date, 480, world.now, catalog);
  assert.throws(() => listPropertyForSale(world.state, result.property.property_id, otherId, 10000000, world.date, 480, world.now, catalog), /property_not_owner/);
});

test("createRentalAgreement creates agreement, deducts rent and deposit", () => {
  const world = makeWorld();
  const { characterId: tenantId } = addPlayer(world, "Tenant", { age: 22, money: 5000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const rentListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "rent" && l.available);
  assert.ok(rentListing);

  const balanceBefore = Object.values(world.state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === tenantId).balance_ngn;
  const result = createRentalAgreement(world.state, tenantId, rentListing.listing_id, world.date, 480, world.now, catalog);

  assert.equal(result.agreement.status, "active");
  assert.equal(result.agreement.tenant_id, tenantId);
  assert.ok(result.payment);

  // Balance decreased by rent + deposit
  const balanceAfter = Object.values(world.state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === tenantId).balance_ngn;
  assert.equal(balanceBefore - balanceAfter, rentListing.rent_price_ngn + rentListing.deposit_ngn);

  // Listing no longer available
  assert.equal(rentListing.available, false);
});

test("rental agreement rejects unavailable property, insufficient funds, and rental limit", () => {
  const world = makeWorld();
  const { characterId: tenantId } = addPlayer(world, "Tenant", { age: 22, money: 5000000 });
  const { characterId: poorTenant } = addPlayer(world, "Poor Tenant", { age: 22, money: 100 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const rentListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "rent" && l.available);
  assert.ok(rentListing);

  // Insufficient funds
  assert.throws(() => createRentalAgreement(world.state, poorTenant, rentListing.listing_id, world.date, 480, world.now, catalog), /property_insufficient_funds/);

  // After successful rental, listing unavailable
  createRentalAgreement(world.state, tenantId, rentListing.listing_id, world.date, 480, world.now, catalog);
  assert.throws(() => createRentalAgreement(world.state, tenantId, rentListing.listing_id, world.date, 480, world.now, catalog), /property_listing_unavailable|property_already_rented/);
});

test("terminateRentalAgreement updates status and re-lists property", () => {
  const world = makeWorld();
  const { characterId: tenantId } = addPlayer(world, "Tenant", { age: 22, money: 5000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const rentListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "rent" && l.available);
  const result = createRentalAgreement(world.state, tenantId, rentListing.listing_id, world.date, 480, world.now, catalog);

  const terminated = terminateRentalAgreement(world.state, tenantId, result.agreement.agreement_id, "Moving out.", world.date, 480, world.now);
  assert.equal(terminated.status, "terminated");
  assert.ok(terminated.end_date);

  // Property re-listed
  const reListed = Object.values(world.state.propertyListings).find((l) => l.property_id === result.agreement.property_id && l.listing_type === "rent" && l.available);
  assert.ok(reListed);
});

test("recordMaintenance updates property condition and charges owner", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Owner", { age: 25, money: 500000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const result = purchaseProperty(world.state, characterId, Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available).listing_id, world.date, 480, world.now, catalog);
  const propertyId = result.property.property_id;
  const balanceBefore = Object.values(world.state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;

  const maintenance = recordMaintenance(world.state, propertyId, characterId, "Fixed leaking roof.", 50000, "excellent", world.date, 480, world.now, catalog);
  assert.equal(maintenance.condition_before, "good");
  assert.equal(maintenance.condition_after, "excellent");
  assert.equal(maintenance.cost_ngn, 50000);

  // Condition updated
  assert.equal(world.state.properties[propertyId].condition, "excellent");

  // Cost deducted
  const balanceAfter = Object.values(world.state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;
  assert.equal(balanceBefore - balanceAfter, 50000);
});

test("purchaseFurniture places items and charges the owner", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Owner", { age: 25, money: 500000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const result = purchaseProperty(world.state, characterId, Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available && !world.state.properties[l.property_id].is_land).listing_id, world.date, 480, world.now, catalog);
  const propertyId = result.property.property_id;
  const furnitureDef = catalog.furniture_catalog[0];

  const balanceBefore = Object.values(world.state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;
  const furnishing = purchaseFurniture(world.state, propertyId, characterId, furnitureDef.id, 2, world.date, 480, world.now, catalog);
  assert.equal(furnishing.quantity, 2);
  assert.equal(furnishing.furniture_definition_id, furnitureDef.id);

  const balanceAfter = Object.values(world.state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;
  assert.equal(balanceBefore - balanceAfter, furnitureDef.price_ngn * 2);

  // Purchase more of the same item
  const furnishing2 = purchaseFurniture(world.state, propertyId, characterId, furnitureDef.id, 1, world.date, 480, world.now, catalog);
  assert.equal(furnishing2.quantity, 3);
});

test("transferProperty moves ownership to another character", () => {
  const world = makeWorld();
  const { characterId: owner1Id } = addPlayer(world, "Owner One", { age: 30, money: 500000000 });
  const { characterId: owner2Id } = addPlayer(world, "Owner Two", { age: 28, money: 100000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const result = purchaseProperty(world.state, owner1Id, Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available).listing_id, world.date, 480, world.now, catalog);

  const transfer = transferProperty(world.state, result.property.property_id, owner1Id, owner2Id, world.date, 480, world.now);
  assert.equal(transfer.ownership.owner_id, owner2Id);
  assert.equal(transfer.previous.active, false);
});

test("buildPropertyProfile returns full property details", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Owner", { age: 25, money: 500000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  const result = purchaseProperty(world.state, characterId, Object.values(world.state.propertyListings).find((l) => l.listing_type === "sale" && l.available).listing_id, world.date, 480, world.now, catalog);
  const profile = buildPropertyProfile(world.state, result.property.property_id);
  assert.equal(profile.property_id, result.property.property_id);
  assert.ok(profile.ownership);
  assert.equal(profile.ownership.owner_id, characterId);
  assert.ok(Array.isArray(profile.amenities));
  assert.ok(Array.isArray(profile.recent_events));
});

test("getCharacterProperties and getCharacterRentals return player data", () => {
  const world = makeWorld();
  const { characterId } = addPlayer(world, "Multi", { age: 25, money: 5000000000 });
  const catalog = loadPropertyCatalog();
  seedProperties(world.state, world.date, world.now, catalog);

  // Buy two properties
  const listings = Object.values(world.state.propertyListings).filter((l) => l.listing_type === "sale" && l.available);
  purchaseProperty(world.state, characterId, listings[0].listing_id, world.date, 480, world.now, catalog);
  purchaseProperty(world.state, characterId, listings[1].listing_id, world.date, 480, world.now, catalog);

  const properties = getCharacterProperties(world.state, characterId);
  assert.equal(properties.length, 2);

  // Rent a property
  const rentListing = Object.values(world.state.propertyListings).find((l) => l.listing_type === "rent" && l.available);
  createRentalAgreement(world.state, characterId, rentListing.listing_id, world.date, 480, world.now, catalog);

  const rentals = getCharacterRentals(world.state, characterId);
  assert.equal(rentals.length, 1);
  assert.equal(rentals[0].status, "active");
});

test("propertyErrorMessage returns known messages for standard codes", () => {
  assert.equal(propertyErrorMessage("property_not_found"), "Property not found.");
  assert.equal(propertyErrorMessage("property_insufficient_funds"), "Insufficient funds for this transaction.");
  assert.equal(propertyErrorMessage("property_age_ineligible"), "You must be at least 18 to own or rent property.");
  assert.ok(propertyErrorMessage("unknown_code").length > 0);
});

// ─── WebSocket Tests ──────────────────────────────────────────────

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
  waitForType(type, timeoutMs = 5000) {
    return this.waitFor((msg) => msg.type === type, timeoutMs);
  }
  async close() {
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      else this.socket.terminate();
    });
  }
}

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), "naija-property-"));
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
      name: "Property Tester",
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

test("property market and view actions work through WebSocket", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await delay(500);
  peer.messages.length = 0;

  // Search market
  peer.send({ type: "property.action", action: "market", requestId: "prop-market-1" });
  const marketResult = await peer.waitFor(
    (msg) => msg.type === "property.result" && msg.requestId === "prop-market-1", 5000,
  );
  assert.equal(marketResult.ok, true);
  assert.ok(Array.isArray(marketResult.data.market.listings));
  assert.ok(marketResult.data.market.listings.length > 0);

  // View a specific property
  const firstListing = marketResult.data.market.listings[0];
  peer.send({
    type: "property.action", action: "view", requestId: "prop-view-1",
    payload: { property_id: firstListing.property_id },
  });
  const viewResult = await peer.waitFor(
    (msg) => msg.type === "property.result" && msg.requestId === "prop-view-1", 5000,
  );
  assert.equal(viewResult.ok, true);
  assert.equal(viewResult.data.property_profile.property_id, firstListing.property_id);

  // My properties (empty for new character)
  peer.send({ type: "property.action", action: "my_properties", requestId: "prop-my-1" });
  const myResult = await peer.waitFor(
    (msg) => msg.type === "property.result" && msg.requestId === "prop-my-1", 5000,
  );
  assert.equal(myResult.ok, true);
  assert.equal(myResult.data.properties.length, 0);

  await peer.close();
});

test("property profiles are included in character snapshots", async () => {
  const { serverPort } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  assert.ok(Array.isArray(ready.character.property_profiles));
  assert.ok(Array.isArray(ready.character.rental_agreements));
  assert.equal(ready.character.property_profiles.length, 0);
  assert.equal(ready.character.rental_agreements.length, 0);
  await peer.close();
});

test("schema version 8 state migrates to version 10 with empty justice and police maps", async () => {
  const { serverPort, stateFile } = await startServer();
  const { peer, ready } = await createOnlinePeer(serverPort);
  await peer.close();
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.schemaVersion, 13);
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
  delete saved.militaryOrganizations; delete saved.militaryBases; delete saved.militaryUnits;
  delete saved.militaryRecruitments; delete saved.militaryServiceRecords; delete saved.militaryTrainingRecords;
  delete saved.militaryRankHistory; delete saved.militaryCommandAppointments; delete saved.militaryAssignments;
  delete saved.militaryLeaveRecords; delete saved.militaryAssets; delete saved.nationalSecurityEvents;
  delete saved.militaryDisciplinaryRecords; delete saved.militaryAudits;
  delete saved.crimeIncidents; delete saved.crimeParticipations; delete saved.crimeEvidence;
  delete saved.crimeReports; delete saved.criminalRecords; delete saved.crimeNotoriety;
  delete saved.crimeRestitution; delete saved.crimeRehabilitation; delete saved.crimeAudits;
  delete saved.communities; delete saved.communityMemberships; delete saved.institutions;
  delete saved.institutionMemberships; delete saved.culturalProfiles; delete saved.communityEvents;
  delete saved.communityProjects; delete saved.communityAnnouncements; delete saved.communityReputation;
  delete saved.communityDisputes; delete saved.communityContributions; delete saved.communityAudits;
  await writeFile(stateFile, JSON.stringify(saved), "utf8");
  const migrated = new WorldStore(stateFile, Date.UTC(2025, 0, 2));
  assert.equal(migrated.state.schemaVersion, 13);
  assert.ok(typeof migrated.state.laws === "object");
  assert.ok(typeof migrated.state.courts === "object");
  assert.ok(typeof migrated.state.governmentProjects === "object");
  assert.ok(typeof migrated.state.policeUnits === "object");
});
