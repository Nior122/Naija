import { createHash, randomUUID } from "node:crypto";
import { loadPropertyCatalog } from "./catalog.js";
import type {
  PropertyCatalog,
  PropertyCondition,
  PropertyEventRecord,
  PropertyFurnishingRecord,
  PropertyListingRecord,
  PropertyListingSnapshot,
  PropertyListingType,
  PropertyMaintenanceRecord,
  PropertyMarketSnapshot,
  PropertyOwnershipRecord,
  PropertyOwnershipKind,
  PropertyProfileSnapshot,
  PropertyRecord,
  PropertyRentPeriod,
  PropertySaleRecord,
  RentalAgreementRecord,
  RentalAgreementSnapshot,
  RentalPaymentRecord,
} from "./types.js";
import type { PersistentWorldState, PersistentPlayer } from "../multiplayer/types.js";
import type { CalendarDate } from "../life/types.js";

function cloneDate(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: date.day };
}

function characterForId(state: PersistentWorldState, characterId: string): PersistentPlayer | undefined {
  return Object.values(state.players).find((player) => player.character.character_id === characterId);
}

function appendPropertyEvent(
  state: PersistentWorldState,
  propertyId: string,
  type: string,
  summary: string,
  date: CalendarDate,
  now: number,
  details: Record<string, string | number | boolean | null>,
): PropertyEventRecord {
  const event: PropertyEventRecord = {
    event_id: `prop-event-${randomUUID()}`,
    property_id: propertyId,
    type,
    world_date: cloneDate(date),
    summary,
    details,
    created_at: new Date(now).toISOString(),
  };
  state.propertyEvents[event.event_id] = event;
  return event;
}

function ownerForProperty(state: PersistentWorldState, propertyId: string): PropertyOwnershipRecord | undefined {
  return Object.values(state.propertyOwnership).find(
    (o) => o.property_id === propertyId && o.active,
  );
}

function ownershipForCharacterAndProperty(state: PersistentWorldState, propertyId: string, characterId: string): PropertyOwnershipRecord | undefined {
  return Object.values(state.propertyOwnership).find(
    (o) => o.property_id === propertyId && o.owner_id === characterId && o.active,
  );
}

function authorizePropertyAction(
  state: PersistentWorldState,
  propertyId: string,
  characterId: string,
  allowedKinds: PropertyOwnershipKind[],
): PropertyOwnershipRecord {
  const ownership = ownershipForCharacterAndProperty(state, propertyId, characterId);
  if (!ownership) throw new Error("property_not_owner");
  if (!allowedKinds.includes(ownership.owner_kind)) throw new Error("property_unauthorized");
  return ownership;
}

function propertiesForCharacter(state: PersistentWorldState, characterId: string): PropertyRecord[] {
  const propertyIds = new Set(
    Object.values(state.propertyOwnership)
      .filter((o) => o.owner_id === characterId && o.active)
      .map((o) => o.property_id),
  );
  return Object.values(state.properties).filter((p) => propertyIds.has(p.property_id));
}

function activeRentalForProperty(state: PersistentWorldState, propertyId: string): RentalAgreementRecord | undefined {
  return Object.values(state.rentalAgreements).find(
    (a) => a.property_id === propertyId && a.status === "active",
  );
}

function activeListingForProperty(state: PersistentWorldState, propertyId: string): PropertyListingRecord | undefined {
  return Object.values(state.propertyListings).find(
    (l) => l.property_id === propertyId && l.available,
  );
}

function cashBalanceForCharacter(state: PersistentWorldState, characterId: string): number {
  const cashAccounts = Object.values(state.economyAccounts).filter((a) => a.kind === "cash" && a.character_id === characterId);
  if (cashAccounts.length === 0) return 0;
  const account = cashAccounts[0];
  return account ? account.balance_ngn : 0;
}

function deductFromCashAccount(state: PersistentWorldState, characterId: string, amountNgn: number, timestamp: string): void {
  const cashAccounts = Object.values(state.economyAccounts).filter((a) => a.kind === "cash" && a.character_id === characterId);
  const account = cashAccounts[0];
  if (!account) throw new Error("property_no_cash_account");
  if (account.balance_ngn < amountNgn) throw new Error("property_insufficient_funds");
  account.balance_ngn -= amountNgn;
  account.total_withdrawn_ngn += amountNgn;
  account.updated_at = timestamp;
}

function creditToCashAccount(state: PersistentWorldState, characterId: string, amountNgn: number, timestamp: string): void {
  const cashAccounts = Object.values(state.economyAccounts).filter((a) => a.kind === "cash" && a.character_id === characterId);
  const account = cashAccounts[0];
  if (!account) throw new Error("property_no_cash_account");
  account.balance_ngn += amountNgn;
  account.total_deposited_ngn += amountNgn;
  account.updated_at = timestamp;
}

export function initializePropertyWorldState(state: PersistentWorldState): void {
  if (!state.properties) state.properties = {};
  if (!state.propertyOwnership) state.propertyOwnership = {};
  if (!state.propertyListings) state.propertyListings = {};
  if (!state.rentalAgreements) state.rentalAgreements = {};
  if (!state.rentalPayments) state.rentalPayments = {};
  if (!state.propertySales) state.propertySales = {};
  if (!state.propertyMaintenance) state.propertyMaintenance = {};
  if (!state.propertyFurnishings) state.propertyFurnishings = {};
  if (!state.propertyEvents) state.propertyEvents = {};
}

export function seedProperties(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: PropertyCatalog = loadPropertyCatalog(),
): PropertyRecord[] {
  const seeded: PropertyRecord[] = [];
  if (Object.keys(state.properties).length > 0) return seeded;
  const timestamp = new Date(now).toISOString();
  for (const seed of catalog.seed_properties) {
    const typeDef = catalog.property_types.find((t) => t.id === seed.type_id);
    if (!typeDef) continue;
    const locDef = catalog.property_locations.find((l) => l.id === seed.location_id);
    if (!locDef) continue;
    const property: PropertyRecord = {
      property_id: seed.id,
      type_id: seed.type_id,
      category_id: typeDef.category_id,
      location_id: seed.location_id,
      name: seed.name,
      description: typeDef.description,
      bedrooms: seed.bedrooms,
      bathrooms: seed.bathrooms,
      condition: seed.condition,
      size_sqm: seed.size_sqm,
      amenities: [...seed.amenities],
      development_status: "developed",
      is_land: typeDef.category_id === "cat:land",
      is_commercial: typeDef.is_commercial,
      max_occupants: typeDef.max_occupants,
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
    };
    state.properties[property.property_id] = property;
    const ownership: PropertyOwnershipRecord = {
      ownership_id: `prop-own-${randomUUID()}`,
      property_id: property.property_id,
      owner_kind: seed.owner_kind,
      owner_id: seed.owner_id,
      share_percent: 100,
      acquisition_date: timestamp,
      acquisition_world_date: cloneDate(date),
      acquisition_price_ngn: 0,
      active: true,
      end_date: null,
      end_world_date: null,
      end_reason: null,
      updated_at: timestamp,
    };
    state.propertyOwnership[ownership.ownership_id] = ownership;
    if (seed.listed_for_sale && seed.sale_price_ngn > 0) {
      const saleListing: PropertyListingRecord = {
        listing_id: `prop-list-sale-${randomUUID()}`,
        property_id: property.property_id,
        owner_id: seed.owner_id,
        listing_type: "sale",
        asking_price_ngn: seed.sale_price_ngn,
        rent_price_ngn: 0,
        rent_period: "none",
        deposit_ngn: 0,
        available: true,
        created_at: timestamp,
        created_world_date: cloneDate(date),
        updated_at: timestamp,
        idempotency_key: createHash("sha256").update(`prop-seed-sale:${seed.id}`).digest("hex"),
      };
      state.propertyListings[saleListing.listing_id] = saleListing;
    }
    if (seed.listed_for_rent && seed.rent_price_ngn > 0) {
      const rentListing: PropertyListingRecord = {
        listing_id: `prop-list-rent-${randomUUID()}`,
        property_id: property.property_id,
        owner_id: seed.owner_id,
        listing_type: "rent",
        asking_price_ngn: 0,
        rent_price_ngn: seed.rent_price_ngn,
        rent_period: seed.rent_period,
        deposit_ngn: seed.deposit_ngn,
        available: true,
        created_at: timestamp,
        created_world_date: cloneDate(date),
        updated_at: timestamp,
        idempotency_key: createHash("sha256").update(`prop-seed-rent:${seed.id}`).digest("hex"),
      };
      state.propertyListings[rentListing.listing_id] = rentListing;
    }
    appendPropertyEvent(state, property.property_id, "property_created",
      `Property '${property.name}' was added to the world.`, date, now,
      { type_id: typeDef.id, location_id: seed.location_id, owner_id: seed.owner_id, owner_kind: seed.owner_kind });
    seeded.push(property);
  }
  return seeded;
}

export function searchPropertyMarket(
  state: PersistentWorldState,
  filters: {
    location_id?: string | null;
    category_id?: string | null;
    listing_type?: PropertyListingType | null;
    min_price_ngn?: number | null;
    max_price_ngn?: number | null;
    min_bedrooms?: number | null;
    condition?: PropertyCondition | null;
  },
  catalog: PropertyCatalog = loadPropertyCatalog(),
): PropertyMarketSnapshot {
  const listings: PropertyListingSnapshot[] = [];
  for (const listing of Object.values(state.propertyListings)) {
    if (!listing.available) continue;
    const property = state.properties[listing.property_id];
    if (!property) continue;
    const location = catalog.property_locations.find((l) => l.id === property.location_id);
    if (filters.location_id && property.location_id !== filters.location_id) continue;
    if (filters.category_id && property.category_id !== filters.category_id) continue;
    if (filters.listing_type && listing.listing_type !== filters.listing_type) continue;
    const effectivePrice = listing.listing_type === "sale" ? listing.asking_price_ngn : listing.rent_price_ngn;
    if (filters.min_price_ngn !== null && filters.min_price_ngn !== undefined && effectivePrice < filters.min_price_ngn) continue;
    if (filters.max_price_ngn !== null && filters.max_price_ngn !== undefined && effectivePrice > filters.max_price_ngn) continue;
    if (filters.min_bedrooms !== null && filters.min_bedrooms !== undefined && property.bedrooms < filters.min_bedrooms) continue;
    if (filters.condition && property.condition !== filters.condition) continue;
    listings.push({
      listing_id: listing.listing_id,
      property_id: listing.property_id,
      type_id: property.type_id,
      category_id: property.category_id,
      location_id: property.location_id,
      location_label: location?.label ?? property.location_id,
      name: property.name,
      description: property.description,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      condition: property.condition,
      size_sqm: property.size_sqm,
      amenities: property.amenities,
      listing_type: listing.listing_type,
      asking_price_ngn: listing.asking_price_ngn,
      rent_price_ngn: listing.rent_price_ngn,
      rent_period: listing.rent_period,
      deposit_ngn: listing.deposit_ngn,
      available: listing.available,
      owner_id: listing.owner_id,
      owner_kind: "npc" as PropertyOwnershipKind,
    });
  }
  return {
    listings,
    total_for_sale: listings.filter((l) => l.listing_type === "sale").length,
    total_for_rent: listings.filter((l) => l.listing_type === "rent").length,
    catalog_locations: catalog.property_locations,
    catalog_types: catalog.property_types.filter((t) => t.id !== "type:govt-building"),
  };
}

export function purchaseProperty(
  state: PersistentWorldState,
  characterId: string,
  listingId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: PropertyCatalog = loadPropertyCatalog(),
): { property: PropertyRecord; sale: PropertySaleRecord; ownership: PropertyOwnershipRecord } {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("property_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("property_character_deceased");
  if (player.character.age < catalog.rules.minimum_purchase_age_years) throw new Error("property_age_ineligible");

  const listing = state.propertyListings[listingId];
  if (!listing) throw new Error("property_listing_not_found");
  if (listing.listing_type !== "sale") throw new Error("property_not_for_sale");
  if (!listing.available) throw new Error("property_listing_unavailable");

  const property = state.properties[listing.property_id];
  if (!property) throw new Error("property_not_found");

  // Check for public/government properties
  const typeDef = catalog.property_types.find((t) => t.id === property.type_id);
  if (typeDef && !typeDef.allowed_uses.includes("residential") && !typeDef.allowed_uses.includes("commercial") && !typeDef.allowed_uses.some((u) => u.startsWith("land"))) {
    throw new Error("property_not_purchasable");
  }

  // Idempotency check
  const idemKey = createHash("sha256").update(`prop-purchase:${listingId}:${characterId}`).digest("hex");
  const existingSale = Object.values(state.propertySales).find((s) => s.idempotency_key === idemKey);
  if (existingSale) {
    return { property, sale: existingSale, ownership: ownershipForCharacterAndProperty(state, property.property_id, characterId)! };
  }

  // Check existing ownership limit
  const ownedCount = propertiesForCharacter(state, characterId).length;
  if (ownedCount >= catalog.rules.maximum_properties_per_character) throw new Error("property_limit_reached");
  if (property.is_land) {
    const landCount = propertiesForCharacter(state, characterId).filter((p) => p.is_land).length;
    if (landCount >= catalog.rules.maximum_land_per_character) throw new Error("property_land_limit_reached");
  }

  // Check affordability
  const price = listing.asking_price_ngn;
  if (price < catalog.rules.minimum_property_price_ngn || price > catalog.rules.maximum_property_price_ngn) {
    throw new Error("property_price_invalid");
  }
  const balance = cashBalanceForCharacter(state, characterId);
  if (balance < price) throw new Error("property_insufficient_funds");

  // Check seller ownership
  const currentOwner = ownerForProperty(state, property.property_id);
  if (!currentOwner) throw new Error("property_no_owner");
  if (currentOwner.owner_id === characterId) throw new Error("property_already_owner");

  const timestamp = new Date(now).toISOString();

  // Deduct from buyer
  deductFromCashAccount(state, characterId, price, timestamp);

  // Credit seller if they are a player
  const sellerPlayer = characterForId(state, currentOwner.owner_id);
  if (sellerPlayer) {
    creditToCashAccount(state, currentOwner.owner_id, price, timestamp);
  }

  // Deactivate current ownership
  currentOwner.active = false;
  currentOwner.end_date = timestamp;
  currentOwner.end_world_date = cloneDate(date);
  currentOwner.end_reason = "sold";
  currentOwner.updated_at = timestamp;

  // Create new ownership
  const ownership: PropertyOwnershipRecord = {
    ownership_id: `prop-own-${randomUUID()}`,
    property_id: property.property_id,
    owner_kind: "player",
    owner_id: characterId,
    share_percent: 100,
    acquisition_date: timestamp,
    acquisition_world_date: cloneDate(date),
    acquisition_price_ngn: price,
    active: true,
    end_date: null,
    end_world_date: null,
    end_reason: null,
    updated_at: timestamp,
  };
  state.propertyOwnership[ownership.ownership_id] = ownership;

  // Create sale record
  const sale: PropertySaleRecord = {
    sale_id: `prop-sale-${randomUUID()}`,
    property_id: property.property_id,
    listing_id: listingId,
    seller_id: currentOwner.owner_id,
    seller_kind: currentOwner.owner_kind,
    buyer_id: characterId,
    amount_ngn: price,
    sale_date: timestamp,
    sale_world_date: cloneDate(date),
    idempotency_key: idemKey,
  };
  state.propertySales[sale.sale_id] = sale;

  // Mark listing as unavailable
  listing.available = false;
  listing.updated_at = timestamp;

  // Terminate any active rental
  const activeRental = activeRentalForProperty(state, property.property_id);
  if (activeRental) {
    activeRental.status = "terminated";
    activeRental.end_date = timestamp;
    activeRental.end_world_date = cloneDate(date);
    activeRental.updated_at = timestamp;
  }

  property.updated_at = timestamp;

  appendPropertyEvent(state, property.property_id, "property_sold",
    `Property '${property.name}' was sold for ₦${price.toLocaleString("en-NG")}.`, date, now,
    { seller_id: currentOwner.owner_id, buyer_id: characterId, amount_ngn: price, sale_id: sale.sale_id });

  return { property, sale, ownership };
}

export function listPropertyForSale(
  state: PersistentWorldState,
  propertyId: string,
  characterId: string,
  askingPriceNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: PropertyCatalog = loadPropertyCatalog(),
): PropertyListingRecord {
  const property = state.properties[propertyId];
  if (!property) throw new Error("property_not_found");
  authorizePropertyAction(state, propertyId, characterId, ["player"]);

  if (askingPriceNgn < catalog.rules.minimum_property_price_ngn || askingPriceNgn > catalog.rules.maximum_property_price_ngn) {
    throw new Error("property_price_invalid");
  }

  // Remove any existing sale listing
  const existingSaleListing = Object.values(state.propertyListings).find(
    (l) => l.property_id === propertyId && l.listing_type === "sale" && l.available,
  );
  if (existingSaleListing) {
    existingSaleListing.available = false;
    existingSaleListing.updated_at = new Date(now).toISOString();
  }

  const timestamp = new Date(now).toISOString();
  const idemKey = createHash("sha256").update(`prop-list-sale:${propertyId}:${now}`).digest("hex");
  const listing: PropertyListingRecord = {
    listing_id: `prop-list-${randomUUID()}`,
    property_id: propertyId,
    owner_id: characterId,
    listing_type: "sale",
    asking_price_ngn: askingPriceNgn,
    rent_price_ngn: 0,
    rent_period: "none",
    deposit_ngn: 0,
    available: true,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    idempotency_key: idemKey,
  };
  state.propertyListings[listing.listing_id] = listing;
  property.updated_at = timestamp;

  appendPropertyEvent(state, propertyId, "listing_created",
    `Property listed for sale at ₦${askingPriceNgn.toLocaleString("en-NG")}.`, date, now,
    { listing_type: "sale", asking_price_ngn: askingPriceNgn });

  return listing;
}

export function listPropertyForRent(
  state: PersistentWorldState,
  propertyId: string,
  characterId: string,
  rentPriceNgn: number,
  rentPeriod: PropertyRentPeriod,
  depositNgn: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: PropertyCatalog = loadPropertyCatalog(),
): PropertyListingRecord {
  const property = state.properties[propertyId];
  if (!property) throw new Error("property_not_found");
  authorizePropertyAction(state, propertyId, characterId, ["player"]);

  if (property.is_land) throw new Error("property_land_not_rentable");
  if (rentPriceNgn < catalog.rules.minimum_rent_price_ngn || rentPriceNgn > catalog.rules.maximum_rent_price_ngn) {
    throw new Error("property_rent_price_invalid");
  }
  if (rentPeriod === "none") throw new Error("property_rent_period_invalid");
  if (depositNgn < 0) throw new Error("property_deposit_invalid");

  // Remove any existing rent listing
  const existingRentListing = Object.values(state.propertyListings).find(
    (l) => l.property_id === propertyId && l.listing_type === "rent" && l.available,
  );
  if (existingRentListing) {
    existingRentListing.available = false;
    existingRentListing.updated_at = new Date(now).toISOString();
  }

  const timestamp = new Date(now).toISOString();
  const idemKey = createHash("sha256").update(`prop-list-rent:${propertyId}:${now}`).digest("hex");
  const listing: PropertyListingRecord = {
    listing_id: `prop-list-${randomUUID()}`,
    property_id: propertyId,
    owner_id: characterId,
    listing_type: "rent",
    asking_price_ngn: 0,
    rent_price_ngn: rentPriceNgn,
    rent_period: rentPeriod,
    deposit_ngn: depositNgn,
    available: true,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    idempotency_key: idemKey,
  };
  state.propertyListings[listing.listing_id] = listing;
  property.updated_at = timestamp;

  appendPropertyEvent(state, propertyId, "listing_created",
    `Property listed for rent at ₦${rentPriceNgn.toLocaleString("en-NG")}/${rentPeriod}.`, date, now,
    { listing_type: "rent", rent_price_ngn: rentPriceNgn, rent_period: rentPeriod, deposit_ngn: depositNgn });

  return listing;
}

export function createRentalAgreement(
  state: PersistentWorldState,
  characterId: string,
  listingId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: PropertyCatalog = loadPropertyCatalog(),
): { agreement: RentalAgreementRecord; payment: RentalPaymentRecord | null } {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("property_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("property_character_deceased");
  if (player.character.age < catalog.rules.minimum_purchase_age_years) throw new Error("property_age_ineligible");

  const listing = state.propertyListings[listingId];
  if (!listing) throw new Error("property_listing_not_found");
  if (listing.listing_type !== "rent") throw new Error("property_not_for_rent");
  if (!listing.available) throw new Error("property_listing_unavailable");

  const property = state.properties[listing.property_id];
  if (!property) throw new Error("property_not_found");

  // Check if there's already an active rental for this property
  const existingRental = activeRentalForProperty(state, property.property_id);
  if (existingRental) throw new Error("property_already_rented");

  // Check tenant rental limit
  const tenantRentals = Object.values(state.rentalAgreements).filter(
    (a) => a.tenant_id === characterId && a.status === "active",
  );
  if (tenantRentals.length >= catalog.rules.maximum_active_rental_agreements_per_tenant) {
    throw new Error("property_rental_limit_reached");
  }

  // Cannot rent own property
  const currentOwner = ownerForProperty(state, property.property_id);
  if (currentOwner && currentOwner.owner_id === characterId) throw new Error("property_cannot_rent_own");

  const timestamp = new Date(now).toISOString();
  const rent = listing.rent_price_ngn;
  const deposit = listing.deposit_ngn;
  const totalDue = rent + deposit;

  // Check affordability
  const balance = cashBalanceForCharacter(state, characterId);
  if (balance < totalDue) throw new Error("property_insufficient_funds");

  // Deduct from tenant
  deductFromCashAccount(state, characterId, totalDue, timestamp);

  // Credit landlord if they are a player
  const landlordPlayer = characterForId(state, listing.owner_id);
  if (landlordPlayer) {
    creditToCashAccount(state, listing.owner_id, totalDue, timestamp);
  }

  const agreement: RentalAgreementRecord = {
    agreement_id: `prop-rent-${randomUUID()}`,
    property_id: property.property_id,
    listing_id: listingId,
    landlord_id: listing.owner_id,
    landlord_kind: currentOwner?.owner_kind ?? "npc",
    tenant_id: characterId,
    rent_ngn: rent,
    rent_period: listing.rent_period,
    deposit_ngn: deposit,
    start_date: timestamp,
    start_world_date: cloneDate(date),
    end_date: null,
    end_world_date: null,
    status: "active",
    total_paid_ngn: totalDue,
    last_payment_date: timestamp,
    last_payment_world_date: cloneDate(date),
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.rentalAgreements[agreement.agreement_id] = agreement;

  // Create initial rent payment record
  const payment: RentalPaymentRecord = {
    payment_id: `prop-pay-${randomUUID()}`,
    agreement_id: agreement.agreement_id,
    property_id: property.property_id,
    tenant_id: characterId,
    landlord_id: listing.owner_id,
    amount_ngn: totalDue,
    period_start: timestamp,
    period_end: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(),
    payment_date: timestamp,
    payment_world_date: cloneDate(date),
    idempotency_key: createHash("sha256").update(`prop-rent-initial:${listingId}:${characterId}`).digest("hex"),
  };
  state.rentalPayments[payment.payment_id] = payment;

  // Mark listing as unavailable
  listing.available = false;
  listing.updated_at = timestamp;

  property.updated_at = timestamp;

  appendPropertyEvent(state, property.property_id, "rental_started",
    `Rental agreement started. Rent: ₦${rent.toLocaleString("en-NG")}/${listing.rent_period}.`, date, now,
    { tenant_id: characterId, landlord_id: listing.owner_id, rent_ngn: rent, deposit_ngn: deposit });

  return { agreement, payment };
}

export function payRent(
  state: PersistentWorldState,
  characterId: string,
  agreementId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
): RentalPaymentRecord {
  const agreement = state.rentalAgreements[agreementId];
  if (!agreement) throw new Error("property_agreement_not_found");
  if (agreement.tenant_id !== characterId) throw new Error("property_unauthorized");
  if (agreement.status !== "active") throw new Error("property_agreement_not_active");

  const rent = agreement.rent_ngn;
  const balance = cashBalanceForCharacter(state, characterId);
  if (balance < rent) throw new Error("property_insufficient_funds");

  const timestamp = new Date(now).toISOString();

  // Idempotency
  const idemKey = createHash("sha256").update(`prop-rent-pay:${agreementId}:${timestamp}`).digest("hex");
  const existing = Object.values(state.rentalPayments).find((p) => p.idempotency_key === idemKey);
  if (existing) return existing;

  // Deduct from tenant
  deductFromCashAccount(state, characterId, rent, timestamp);

  // Credit landlord if they are a player
  const landlordPlayer = characterForId(state, agreement.landlord_id);
  if (landlordPlayer) {
    creditToCashAccount(state, agreement.landlord_id, rent, timestamp);
  }

  const payment: RentalPaymentRecord = {
    payment_id: `prop-pay-${randomUUID()}`,
    agreement_id: agreementId,
    property_id: agreement.property_id,
    tenant_id: characterId,
    landlord_id: agreement.landlord_id,
    amount_ngn: rent,
    period_start: agreement.last_payment_date ?? agreement.start_date,
    period_end: timestamp,
    payment_date: timestamp,
    payment_world_date: cloneDate(date),
    idempotency_key: idemKey,
  };
  state.rentalPayments[payment.payment_id] = payment;

  agreement.total_paid_ngn += rent;
  agreement.last_payment_date = timestamp;
  agreement.last_payment_world_date = cloneDate(date);
  agreement.updated_at = timestamp;

  appendPropertyEvent(state, agreement.property_id, "rent_paid",
    `Rent payment of ₦${rent.toLocaleString("en-NG")} received.`, date, now,
    { tenant_id: characterId, amount_ngn: rent, payment_id: payment.payment_id });

  return payment;
}

export function terminateRentalAgreement(
  state: PersistentWorldState,
  characterId: string,
  agreementId: string,
  reason: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
): RentalAgreementRecord {
  const agreement = state.rentalAgreements[agreementId];
  if (!agreement) throw new Error("property_agreement_not_found");
  // Only tenant or landlord can terminate
  if (agreement.tenant_id !== characterId && agreement.landlord_id !== characterId) {
    throw new Error("property_unauthorized");
  }
  if (agreement.status !== "active") throw new Error("property_agreement_not_active");

  const timestamp = new Date(now).toISOString();
  agreement.status = "terminated";
  agreement.end_date = timestamp;
  agreement.end_world_date = cloneDate(date);
  agreement.updated_at = timestamp;

  // Re-list the property for rent
  const property = state.properties[agreement.property_id];
  if (property) {
    const listing = Object.values(state.propertyListings).find(
      (l) => l.property_id === property.property_id && l.listing_type === "rent" && l.owner_id === agreement.landlord_id,
    );
    if (listing) {
      listing.available = true;
      listing.updated_at = timestamp;
    }
    property.updated_at = timestamp;
  }

  appendPropertyEvent(state, agreement.property_id, "rental_terminated",
    `Rental agreement terminated. ${reason.trim()}`.trim(), date, now,
    { tenant_id: agreement.tenant_id, landlord_id: agreement.landlord_id, reason: reason.trim() });

  return agreement;
}

export function recordMaintenance(
  state: PersistentWorldState,
  propertyId: string,
  characterId: string,
  description: string,
  costNgn: number,
  newCondition: PropertyCondition,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: PropertyCatalog = loadPropertyCatalog(),
): PropertyMaintenanceRecord {
  const property = state.properties[propertyId];
  if (!property) throw new Error("property_not_found");
  authorizePropertyAction(state, propertyId, characterId, ["player"]);

  const conditionLevels = catalog.rules.property_condition_levels;
  if (!conditionLevels.includes(newCondition)) throw new Error("property_condition_invalid");
  if (costNgn < 0) throw new Error("property_maintenance_cost_invalid");

  const desc = description.normalize("NFC").trim();
  if (desc.length < 1 || desc.length > 500) throw new Error("property_maintenance_description_invalid");

  const conditionBefore = property.condition;
  const timestamp = new Date(now).toISOString();

  const maintenance: PropertyMaintenanceRecord = {
    maintenance_id: `prop-maint-${randomUUID()}`,
    property_id: propertyId,
    requested_by: characterId,
    description: desc,
    cost_ngn: costNgn,
    condition_before: conditionBefore,
    condition_after: newCondition,
    status: "completed",
    created_at: timestamp,
    created_world_date: cloneDate(date),
    completed_at: timestamp,
  };
  state.propertyMaintenance[maintenance.maintenance_id] = maintenance;

  // Update property condition
  property.condition = newCondition;
  property.updated_at = timestamp;

  // Deduct maintenance cost from owner
  if (costNgn > 0) {
    deductFromCashAccount(state, characterId, costNgn, timestamp);
  }

  appendPropertyEvent(state, propertyId, "maintenance_completed",
    `Maintenance: ${desc}. Condition: ${conditionBefore} → ${newCondition}. Cost: ₦${costNgn.toLocaleString("en-NG")}.`, date, now,
    { cost_ngn: costNgn, condition_before: conditionBefore, condition_after: newCondition });

  return maintenance;
}

export function purchaseFurniture(
  state: PersistentWorldState,
  propertyId: string,
  characterId: string,
  furnitureDefinitionId: string,
  quantity: number,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
  catalog: PropertyCatalog = loadPropertyCatalog(),
): PropertyFurnishingRecord {
  const property = state.properties[propertyId];
  if (!property) throw new Error("property_not_found");
  if (property.is_land) throw new Error("property_land_no_furniture");
  authorizePropertyAction(state, propertyId, characterId, ["player"]);

  const furnitureDef = catalog.furniture_catalog.find((f) => f.id === furnitureDefinitionId);
  if (!furnitureDef) throw new Error("property_furniture_not_found");
  if (quantity < 1 || quantity > 10) throw new Error("property_furniture_quantity_invalid");

  // Check furniture limit
  const existingFurnishing = Object.values(state.propertyFurnishings).find(
    (f) => f.property_id === propertyId && f.furniture_definition_id === furnitureDefinitionId,
  );
  const totalFurnitureCount = Object.values(state.propertyFurnishings)
    .filter((f) => f.property_id === propertyId)
    .reduce((sum, f) => sum + f.quantity, 0);
  if (totalFurnitureCount + quantity > catalog.rules.maximum_furniture_per_property) {
    throw new Error("property_furniture_limit_reached");
  }

  const totalCost = furnitureDef.price_ngn * quantity;
  const balance = cashBalanceForCharacter(state, characterId);
  if (balance < totalCost) throw new Error("property_insufficient_funds");

  const timestamp = new Date(now).toISOString();
  deductFromCashAccount(state, characterId, totalCost, timestamp);

  if (existingFurnishing) {
    existingFurnishing.quantity += quantity;
    existingFurnishing.updated_at = timestamp;
  } else {
    const furnishing: PropertyFurnishingRecord = {
      furnishing_id: `prop-furn-${randomUUID()}`,
      property_id: propertyId,
      furniture_definition_id: furnitureDefinitionId,
      quantity,
      placed_at: timestamp,
      updated_at: timestamp,
    };
    state.propertyFurnishings[furnishing.furnishing_id] = furnishing;
  }

  property.updated_at = timestamp;

  appendPropertyEvent(state, propertyId, "furniture_purchased",
    `Purchased ${quantity}× ${furnitureDef.label} for ₦${totalCost.toLocaleString("en-NG")}.`, date, now,
    { furniture_id: furnitureDefinitionId, quantity, cost_ngn: totalCost });

  return existingFurnishing ?? Object.values(state.propertyFurnishings).find(
    (f) => f.property_id === propertyId && f.furniture_definition_id === furnitureDefinitionId,
  )!;
}

export function removeFurnishing(
  state: PersistentWorldState,
  propertyId: string,
  characterId: string,
  furnishingId: string,
  date: CalendarDate,
  now: number,
): void {
  const property = state.properties[propertyId];
  if (!property) throw new Error("property_not_found");
  authorizePropertyAction(state, propertyId, characterId, ["player"]);

  const furnishing = state.propertyFurnishings[furnishingId];
  if (!furnishing || furnishing.property_id !== propertyId) throw new Error("property_furnishing_not_found");

  delete state.propertyFurnishings[furnishingId];
  property.updated_at = new Date(now).toISOString();

  appendPropertyEvent(state, propertyId, "furniture_removed",
    `Furnishing removed.`, date, now,
    { furnishing_id: furnishingId, furniture_definition_id: furnishing.furniture_definition_id });
}

export function transferProperty(
  state: PersistentWorldState,
  propertyId: string,
  fromCharacterId: string,
  toCharacterId: string,
  date: CalendarDate,
  minuteOfDay: number,
  now: number,
): { ownership: PropertyOwnershipRecord; previous: PropertyOwnershipRecord } {
  const property = state.properties[propertyId];
  if (!property) throw new Error("property_not_found");
  const fromOwnership = authorizePropertyAction(state, propertyId, fromCharacterId, ["player"]);

  if (fromCharacterId === toCharacterId) throw new Error("property_transfer_same_character");
  const toPlayer = characterForId(state, toCharacterId);
  if (!toPlayer) throw new Error("property_character_not_found");
  if (toPlayer.character.life_status === "deceased") throw new Error("property_character_deceased");

  const timestamp = new Date(now).toISOString();

  fromOwnership.active = false;
  fromOwnership.end_date = timestamp;
  fromOwnership.end_world_date = cloneDate(date);
  fromOwnership.end_reason = "transferred";
  fromOwnership.updated_at = timestamp;

  const newOwnership: PropertyOwnershipRecord = {
    ownership_id: `prop-own-${randomUUID()}`,
    property_id: propertyId,
    owner_kind: "player",
    owner_id: toCharacterId,
    share_percent: 100,
    acquisition_date: timestamp,
    acquisition_world_date: cloneDate(date),
    acquisition_price_ngn: 0,
    active: true,
    end_date: null,
    end_world_date: null,
    end_reason: null,
    updated_at: timestamp,
  };
  state.propertyOwnership[newOwnership.ownership_id] = newOwnership;
  property.updated_at = timestamp;

  // Cancel any active rental
  const activeRental = activeRentalForProperty(state, propertyId);
  if (activeRental) {
    activeRental.status = "terminated";
    activeRental.end_date = timestamp;
    activeRental.end_world_date = cloneDate(date);
    activeRental.updated_at = timestamp;
  }

  // Cancel any active listing
  const activeListing = activeListingForProperty(state, propertyId);
  if (activeListing) {
    activeListing.available = false;
    activeListing.updated_at = timestamp;
  }

  appendPropertyEvent(state, propertyId, "ownership_transferred",
    `Ownership transferred from ${fromCharacterId} to ${toCharacterId}.`, date, now,
    { from_character_id: fromCharacterId, to_character_id: toCharacterId });

  return { ownership: newOwnership, previous: fromOwnership };
}

export function buildPropertyProfile(
  state: PersistentWorldState,
  propertyId: string,
): PropertyProfileSnapshot {
  const property = state.properties[propertyId];
  if (!property) throw new Error("property_not_found");
  const ownership = ownerForProperty(state, propertyId);
  if (!ownership) throw new Error("property_no_owner");
  const listing = activeListingForProperty(state, propertyId) ?? null;
  const rental = activeRentalForProperty(state, propertyId) ?? null;
  const furnishing = Object.values(state.propertyFurnishings).filter((f) => f.property_id === propertyId);
  const events = Object.values(state.propertyEvents)
    .filter((e) => e.property_id === propertyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
  return {
    property_id: property.property_id,
    type_id: property.type_id,
    category_id: property.category_id,
    location_id: property.location_id,
    name: property.name,
    description: property.description,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    condition: property.condition,
    size_sqm: property.size_sqm,
    amenities: property.amenities,
    development_status: property.development_status,
    is_land: property.is_land,
    is_commercial: property.is_commercial,
    max_occupants: property.max_occupants,
    ownership,
    active_listing: listing,
    active_rental: rental,
    furnishing,
    recent_events: events,
  };
}

export function getCharacterProperties(
  state: PersistentWorldState,
  characterId: string,
): PropertyProfileSnapshot[] {
  return propertiesForCharacter(state, characterId).map((p) => buildPropertyProfile(state, p.property_id));
}

export function getCharacterRentals(
  state: PersistentWorldState,
  characterId: string,
): RentalAgreementSnapshot[] {
  return Object.values(state.rentalAgreements)
    .filter((a) => a.tenant_id === characterId)
    .map((a) => {
      const property = state.properties[a.property_id];
      return {
        agreement_id: a.agreement_id,
        property_id: a.property_id,
        property_name: property?.name ?? "Unknown",
        location_id: property?.location_id ?? "",
        landlord_id: a.landlord_id,
        tenant_id: a.tenant_id,
        rent_ngn: a.rent_ngn,
        rent_period: a.rent_period,
        deposit_ngn: a.deposit_ngn,
        start_date: a.start_date,
        end_date: a.end_date,
        status: a.status,
        total_paid_ngn: a.total_paid_ngn,
      };
    });
}

export function processPropertyWorldDate(
  state: PersistentWorldState,
): number {
  // Future: auto-expire rental agreements, charge recurring property taxes, etc.
  let processed = 0;
  for (const agreement of Object.values(state.rentalAgreements)) {
    if (agreement.status !== "active") continue;
    processed += 1;
  }
  return processed;
}

export function propertyErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    property_not_found: "Property not found.",
    property_character_not_found: "Character not found.",
    property_character_deceased: "Deceased characters cannot manage property.",
    property_age_ineligible: "You must be at least 18 to own or rent property.",
    property_no_cash_account: "No cash account found. Open one in the economy first.",
    property_insufficient_funds: "Insufficient funds for this transaction.",
    property_limit_reached: "You have reached the maximum number of properties.",
    property_land_limit_reached: "You have reached the maximum number of land parcels.",
    property_rental_limit_reached: "You have reached the maximum number of active rental agreements.",
    property_not_for_sale: "This property is not listed for sale.",
    property_not_for_rent: "This property is not listed for rent.",
    property_listing_not_found: "Listing not found.",
    property_listing_unavailable: "This listing is no longer available.",
    property_not_owner: "You do not own this property.",
    property_unauthorized: "You are not authorized to perform this action.",
    property_price_invalid: "The price is outside the allowed range.",
    property_rent_price_invalid: "The rent price is outside the allowed range.",
    property_rent_period_invalid: "Invalid rent period.",
    property_deposit_invalid: "Invalid deposit amount.",
    property_already_owner: "You already own this property.",
    property_already_rented: "This property already has an active rental agreement.",
    property_cannot_rent_own: "You cannot rent a property you own.",
    property_not_purchasable: "This property type cannot be purchased by players.",
    property_land_not_rentable: "Land cannot be rented.",
    property_transfer_same_character: "Cannot transfer property to yourself.",
    property_agreement_not_found: "Rental agreement not found.",
    property_agreement_not_active: "Rental agreement is not active.",
    property_condition_invalid: "Invalid property condition.",
    property_maintenance_cost_invalid: "Invalid maintenance cost.",
    property_maintenance_description_invalid: "Description must be 1–500 characters.",
    property_furniture_not_found: "Furniture item not found in catalogue.",
    property_furniture_quantity_invalid: "Quantity must be between 1 and 10.",
    property_furniture_limit_reached: "Maximum furniture items reached for this property.",
    property_furnishing_not_found: "Furnishing record not found.",
    property_land_no_furniture: "Land parcels cannot be furnished.",
  };
  return messages[code] ?? "An unknown property error occurred.";
}
