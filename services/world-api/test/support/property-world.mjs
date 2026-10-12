// In-memory world fixtures for the property service tests (Stage 35). The shape matches test/properties.test.mjs, which
// keeps its own copy. Nothing here touches storage.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadLifeCatalog, normalizeWorldClock } from "../../dist/life/calendar.js";
import { initializeEconomyWorldState } from "../../dist/economy/service.js";
import { initializePropertyWorldState } from "../../dist/properties/service.js";

export function makeWorld() {
  const catalog = loadLifeCatalog();
  const now = Date.UTC(2025, 0, 1);
  const state = {
    schemaVersion: 14,
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

/** Adds a player with a cash account holding `money` (default ₦500,000). `cashAccount: false` adds none. */
export function addPlayer(world, name, overrides = {}) {
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
      life_status: overrides.life_status ?? "alive",
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
  if (overrides.cashAccount !== false) {
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
  }
  return { playerId, characterId, token, creationKey };
}

export function cashAccountOf(state, characterId) {
  return Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId);
}

export function balanceOf(state, characterId) {
  return cashAccountOf(state, characterId)?.balance_ngn ?? 0;
}

/** JSON with object keys sorted at every level. PostgreSQL JSONB does not keep key order, so comparisons use this. */
function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The property maps as canonical JSON. Two states are equal here when no property, money, or ownership record changed. */
export function propertyContent(state) {
  return sortedJson({
    properties: state.properties,
    propertyOwnership: state.propertyOwnership,
    propertyListings: state.propertyListings,
    rentalAgreements: state.rentalAgreements,
    rentalPayments: state.rentalPayments,
    propertySales: state.propertySales,
    propertyMaintenance: state.propertyMaintenance,
    propertyFurnishings: state.propertyFurnishings,
    propertyEvents: state.propertyEvents,
    economyAccounts: state.economyAccounts,
    economyTransactions: state.economyTransactions,
  });
}

export function activeOwnersOf(state, propertyId) {
  return Object.values(state.propertyOwnership)
    .filter((o) => o.property_id === propertyId && o.active)
    .map((o) => o.owner_id);
}
