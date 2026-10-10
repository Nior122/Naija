/**
 * Justice filing rules: court category vocabulary, jurisdiction, and catalog consistency.
 *
 * Decision (Stage 28): a court's permitted_categories lists LAW categories (the legal subject matter,
 * e.g. "employment", "commercial"), which is the vocabulary of the seeded courts and of the stored
 * worlds. A case is accepted when its law category is listed, or when its case type (civil/criminal)
 * is listed. Each case category declares its law_category in game/data/justice/catalog.json.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadJusticeCatalog } from "../dist/justice/catalog.js";
import {
  courtHandlesCaseCategory,
  fileCase,
  initializeJusticeWorldState,
  seedJusticeWorld,
} from "../dist/justice/service.js";
import { validateJusticeRecords } from "../dist/multiplayer/record-validation.js";

const LAW_MAPS = [
  "laws", "lawProvisions", "legislativeProposals", "courts", "legalProfessionals", "legalRepresentations",
  "cases", "caseParticipants", "evidence", "witnesses", "hearings", "judgments", "sentences", "fines",
  "settlements", "appeals", "legalAudits",
];

// Only the maps the justice service and validators touch. Test data never reaches a live world file.
function makeWorld() {
  const state = {
    schemaVersion: 14,
    worldId: "nigeria-main",
    worldClock: { day: 1, minute_of_day: 0, millisecond_of_minute: 0, updated_at: new Date(0).toISOString(), world_date: { year: 2025, month: 1, day: 1 } },
    players: {}, people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
    careerEmployers: {}, careerVacancies: {}, careerApplications: {}, employments: {}, workSessions: {},
    careerSkills: {}, careerLicenses: {}, careerReviews: {}, careerLeaveRequests: {}, careerEvents: {},
    salaryPayments: {}, npcCareers: {},
    accounts: {}, transactions: {}, loans: {}, loanPayments: {}, marketGoods: {}, creditScores: {}, economyEvents: {},
    businesses: {}, businessProducts: {}, businessInventory: {}, businessTransactions: {}, businessSales: {},
    businessProductionRuns: {}, businessEvents: {}, businessSnapshots: {},
    properties: {}, propertyOwnership: {}, propertyListings: {}, rentalAgreements: {}, rentalPayments: {},
    propertySales: {}, propertyMaintenance: {}, propertyFurnishings: {}, propertyEvents: {},
    governmentOrganisations: {}, governmentOffices: {}, governmentAppointments: {}, governmentBudgets: {},
    governmentRevenue: {}, governmentExpenditure: {}, governmentProjects: {}, governmentAnnouncements: {}, governmentEvents: {},
    politicalParties: {}, partyMemberships: {}, politicalProfiles: {}, elections: {}, candidates: {},
    campaigns: {}, campaignEvents: {}, campaignFinances: {}, debates: {}, ballots: {}, voterParticipation: {},
    electionDisputes: {}, electionAudits: {},
  };
  for (const name of LAW_MAPS) state[name] = {};
  return { state, date: { year: 2025, month: 1, day: 1 }, now: Date.UTC(2025, 0, 1) };
}

/** A character with a recorded geographic location (stateId) or none (stateId null). */
function addPlayer(world, name, age, stateId) {
  const characterId = `char-${name.toLowerCase().replace(/\s/g, "-")}`;
  const playerId = `player-${characterId}`;
  world.state.players[playerId] = {
    playerId, tokenHash: "hash", creationKeyHash: "ckey", recentRequestIds: [],
    createdAt: new Date(world.now).toISOString(), lastSeen: new Date(world.now).toISOString(),
    character: {
      player_id: playerId, character_id: characterId, name, age, character_type: "androgynous",
      life_status: "alive",
      geographic_location: stateId
        ? { world_id: "nigeria-main", region_id: "ng", country_id: "NG", state_id: stateId, lga_id: null, settlement_id: null, ward_id: null, latitude: 9.05, longitude: 7.49, local_position_m: { x: 0, y: 0 }, chunk_id: "c" }
        : null,
    },
  };
  return characterId;
}

function seededWorld() {
  const world = makeWorld();
  const catalog = loadJusticeCatalog();
  initializeJusticeWorldState(world.state);
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  return { world, catalog };
}

function file(world, catalog, category, courtId, filerId) {
  return fileCase(world.state, category, courtId, filerId, null, "Summary.", "Description.", [], null, world.date, world.now, catalog);
}

// ─── Catalog and vocabulary ───────────────────────────────────────

test("Justice catalog: every case category declares a known law category and a civil or criminal type", () => {
  const catalog = loadJusticeCatalog();
  const lawIds = new Set(catalog.law_categories.map((c) => c.id));
  for (const category of catalog.case_categories) {
    assert.ok(lawIds.has(category.law_category), `${category.id} has unknown law category ${category.law_category}`);
    assert.ok(["civil", "criminal"].includes(category.type), `${category.id} has type ${category.type}`);
  }
});

test("Justice catalog: every seeded court lists only law categories", () => {
  const catalog = loadJusticeCatalog();
  const lawIds = new Set(catalog.law_categories.map((c) => c.id));
  for (const court of catalog.seed_courts) {
    for (const permitted of court.permitted_categories) {
      assert.ok(lawIds.has(permitted), `${court.id} lists ${permitted}, which is not a law category`);
    }
  }
});

test("Court rule: only the case's law category or case type counts, never its case-category ID", () => {
  const category = { law_category: "employment", type: "civil" };
  assert.equal(courtHandlesCaseCategory({ permitted_categories: ["employment"] }, category), true);
  assert.equal(courtHandlesCaseCategory({ permitted_categories: ["civil"] }, category), true, "the case type still counts");
  assert.equal(courtHandlesCaseCategory({ permitted_categories: ["employment_claim"] }, category), false, "a case-category ID is not a permitted category");
  assert.equal(courtHandlesCaseCategory({ permitted_categories: ["commercial"] }, category), false);
});

// ─── Accepted filings ─────────────────────────────────────────────

test("Filing: an employment claim is accepted at the National Industrial Court (previously rejected)", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Worker", 30, "ng:state:fc");
  const caseRec = file(world, catalog, "employment_claim", "court:nic", claimant);
  assert.equal(caseRec.court_id, "court:nic");
  assert.equal(caseRec.case_type, "civil");
  assert.equal(caseRec.status, "submitted");
});

test("Filing: a commercial dispute is accepted at the FCT High Court (commercial is listed)", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Trader", 40, "ng:state:fc");
  assert.equal(file(world, catalog, "commercial_dispute", "court:state-high-fct", claimant).category, "commercial_dispute");
  assert.equal(file(world, catalog, "contract_dispute", "court:state-high-fct", claimant).category, "contract_dispute");
});

test("Filing: a commercial dispute is accepted at the Federal High Court (commercial is listed)", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Trader", 40, "ng:state:fc");
  assert.equal(file(world, catalog, "commercial_dispute", "court:federal-high", claimant).court_id, "court:federal-high");
});

test("Filing: a tenancy dispute is accepted at the customary court through its property listing", () => {
  const { world, catalog } = seededWorld();
  const tenant = addPlayer(world, "Tenant", 26, "ng:state:fc");
  assert.equal(file(world, catalog, "tenancy_dispute", "court:customary-fct", tenant).court_id, "court:customary-fct");
});

test("Filing: a federal court accepts a filer from any state", () => {
  const { world, catalog } = seededWorld();
  const lagosFiler = addPlayer(world, "Lagos Worker", 30, "ng:state:la");
  assert.equal(file(world, catalog, "employment_claim", "court:nic", lagosFiler).court_id, "court:nic");
  assert.equal(file(world, catalog, "civil_general", "court:supreme", lagosFiler).court_id, "court:supreme");
});

test("Filing: a filer in the court's state is accepted", () => {
  const { world, catalog } = seededWorld();
  const fcFiler = addPlayer(world, "FCT Resident", 30, "ng:state:fc");
  assert.equal(file(world, catalog, "civil_general", "court:state-high-fct", fcFiler).court_id, "court:state-high-fct");
  assert.equal(file(world, catalog, "civil_general", "court:magistrate-fct", fcFiler).court_id, "court:magistrate-fct");
});

// ─── Rejected filings ─────────────────────────────────────────────

test("Filing rejected: a general civil claim at the National Industrial Court (not listed, not employment)", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Claimant", 30, "ng:state:fc");
  assert.throws(() => file(world, catalog, "civil_general", "court:nic", claimant), /justice_court_category_not_permitted/);
});

test("Filing rejected: a criminal felony at the National Industrial Court", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Claimant", 30, "ng:state:fc");
  assert.throws(() => file(world, catalog, "criminal_felony", "court:nic", claimant), /justice_court_category_not_permitted/);
});

test("Filing rejected: a criminal misdemeanor at the customary court (civil and property only)", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Claimant", 30, "ng:state:fc");
  assert.throws(() => file(world, catalog, "criminal_misdemeanor", "court:customary-fct", claimant), /justice_court_category_not_permitted/);
});

test("Filing rejected: an unknown case category is reported as invalid, not as a court restriction", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Claimant", 30, "ng:state:fc");
  assert.throws(() => file(world, catalog, "made_up_category", "court:state-high-fct", claimant), /justice_case_category_invalid/);
});

test("Filing rejected: a filer located in another state cannot file at a state court", () => {
  const { world, catalog } = seededWorld();
  const lagosFiler = addPlayer(world, "Lagos Worker", 30, "ng:state:la");
  assert.throws(() => file(world, catalog, "civil_general", "court:state-high-fct", lagosFiler), /justice_court_jurisdiction_mismatch/);
});

test("Filing rejected: a filer located in another state cannot file at a local court", () => {
  const { world, catalog } = seededWorld();
  const lagosFiler = addPlayer(world, "Lagos Tenant", 26, "ng:state:la");
  assert.throws(() => file(world, catalog, "tenancy_dispute", "court:customary-fct", lagosFiler), /justice_court_jurisdiction_mismatch/);
});

test("Filing rejected: a rejected filing changes neither the cases nor the courts", () => {
  const { world, catalog } = seededWorld();
  const claimant = addPlayer(world, "Claimant", 30, "ng:state:fc");
  const lagosFiler = addPlayer(world, "Lagos Worker", 30, "ng:state:la");
  file(world, catalog, "civil_general", "court:state-high-fct", claimant);
  const before = JSON.stringify({ cases: world.state.cases, courts: world.state.courts, audit: world.state.legalAudits });
  assert.throws(() => file(world, catalog, "civil_general", "court:nic", claimant), /justice_court_category_not_permitted/);
  assert.throws(() => file(world, catalog, "civil_general", "court:state-high-fct", lagosFiler), /justice_court_jurisdiction_mismatch/);
  assert.throws(() => file(world, catalog, "made_up_category", "court:state-high-fct", claimant), /justice_case_category_invalid/);
  assert.equal(JSON.stringify({ cases: world.state.cases, courts: world.state.courts, audit: world.state.legalAudits }), before);
});

// ─── Jurisdiction status: missing, valid, and invalid location data ────────

function jurisdictionCheckFor(world, caseRec) {
  const audit = Object.values(world.state.legalAudits).find((a) => a.category === "case_filed" && a.case_id === caseRec.case_id);
  assert.ok(audit, "the case_filed audit entry exists");
  return audit.details.jurisdiction_check;
}

test("Location, missing: a state court accepts the filing, and the audit records it as unverified (not eligible)", () => {
  const { world, catalog } = seededWorld();
  const unplaced = addPlayer(world, "Unplaced", 30, null);
  const caseRec = file(world, catalog, "civil_general", "court:state-high-fct", unplaced);
  assert.equal(caseRec.court_id, "court:state-high-fct");
  // The filing is accepted for compatibility with characters that have no location. It is not proof that
  // the filer is within the court's state, so the audit entry must not say "verified".
  assert.equal(jurisdictionCheckFor(world, caseRec), "unverified_no_location");
});

test("Location, missing: a local court is also recorded as unverified", () => {
  const { world, catalog } = seededWorld();
  const unplaced = addPlayer(world, "Unplaced Tenant", 26, null);
  const caseRec = file(world, catalog, "tenancy_dispute", "court:customary-fct", unplaced);
  assert.equal(jurisdictionCheckFor(world, caseRec), "unverified_no_location");
});

test("Location, missing: a federal court does not need a location, and the audit says so", () => {
  const { world, catalog } = seededWorld();
  const unplaced = addPlayer(world, "Unplaced Worker", 30, null);
  const caseRec = file(world, catalog, "employment_claim", "court:nic", unplaced);
  assert.equal(jurisdictionCheckFor(world, caseRec), "not_required");
});

test("Location, valid: a filer in the court's state is recorded as verified", () => {
  const { world, catalog } = seededWorld();
  const fcFiler = addPlayer(world, "FCT Resident", 30, "ng:state:fc");
  const caseRec = file(world, catalog, "civil_general", "court:state-high-fct", fcFiler);
  assert.equal(jurisdictionCheckFor(world, caseRec), "verified");
});

test("Location, valid: a filer in another state is rejected at a state court", () => {
  const { world, catalog } = seededWorld();
  const laFiler = addPlayer(world, "Lagos Resident", 30, "ng:state:la");
  assert.throws(() => file(world, catalog, "civil_general", "court:state-high-fct", laFiler), /justice_court_jurisdiction_mismatch/);
});

test("Location, invalid: a malformed state identifier is rejected at a state court", () => {
  const { world, catalog } = seededWorld();
  const filer = addPlayer(world, "Malformed", 30, "ng:state:fc");
  world.state.players[`player-${filer}`].character.geographic_location.state_id = "FC";
  assert.throws(() => file(world, catalog, "civil_general", "court:state-high-fct", filer), /justice_filer_location_invalid/);
});

test("Location, invalid: a malformed state identifier is rejected even at a federal court", () => {
  const { world, catalog } = seededWorld();
  const filer = addPlayer(world, "Malformed Worker", 30, "ng:state:fc");
  world.state.players[`player-${filer}`].character.geographic_location.state_id = "";
  assert.throws(() => file(world, catalog, "employment_claim", "court:nic", filer), /justice_filer_location_invalid/);
});

test("Location, invalid: a rejected filing leaves cases and audit entries unchanged", () => {
  const { world, catalog } = seededWorld();
  const filer = addPlayer(world, "Malformed", 30, "ng:state:fc");
  world.state.players[`player-${filer}`].character.geographic_location.state_id = "FC";
  const before = JSON.stringify({ cases: world.state.cases, audit: world.state.legalAudits });
  assert.throws(() => file(world, catalog, "civil_general", "court:state-high-fct", filer), /justice_filer_location_invalid/);
  assert.equal(JSON.stringify({ cases: world.state.cases, audit: world.state.legalAudits }), before);
});

test("Location: a case filed with an unverified jurisdiction check passes record validation", () => {
  const { world, catalog } = seededWorld();
  const unplaced = addPlayer(world, "Unplaced", 30, null);
  file(world, catalog, "civil_general", "court:state-high-fct", unplaced);
  const result = validateJusticeRecords(world.state);
  assert.deepEqual(result.issues, [], JSON.stringify(result.issues.slice(0, 3)));
});

// ─── Law category mapping: reviewed table ─────────────────────────

test("Law category mapping: each case category maps to the reviewed law category (changing it is a deliberate review)", () => {
  // Reviewed in docs/LAWS_COURTS_AND_JUSTICE_PLAN.md (section "Law category meanings"). Changing any entry needs review.
  const REVIEWED = {
    civil_general: "civil", contract_dispute: "commercial", debt_recovery: "civil", property_dispute: "property",
    tenancy_dispute: "property", employment_claim: "employment", compensation_claim: "civil",
    criminal_misdemeanor: "criminal", criminal_felony: "criminal", regulatory_penalty: "administration",
    commercial_dispute: "commercial",
  };
  const catalog = loadJusticeCatalog();
  const actual = Object.fromEntries(catalog.case_categories.map((c) => [c.id, c.law_category]));
  assert.deepEqual(actual, REVIEWED);
});

// ─── Compatibility with stored worlds ─────────────────────────────

test("Stored worlds: seeding does not rewrite a court that already exists in the saved world", () => {
  const world = makeWorld();
  const catalog = loadJusticeCatalog();
  initializeJusticeWorldState(world.state);
  const legacy = ["civil", "property", "tenancy_dispute"];
  world.state.courts["court:customary-fct"] = {
    court_id: "court:customary-fct", name: "FCT Customary Court", level: "customary", jurisdiction: "local",
    applicable_jurisdiction_id: "ng:state:fc", superior_court_id: null, permitted_categories: [...legacy], status: "active",
    assigned_judge_ids: [], created_at: new Date(world.now).toISOString(), created_world_date: world.date, updated_at: new Date(world.now).toISOString(),
  };
  seedJusticeWorld(world.state, world.date, world.now, catalog);
  assert.deepEqual(world.state.courts["court:customary-fct"].permitted_categories, legacy, "the saved court list must not be rewritten");
});

test("Stored worlds: a saved court with a legacy case-category entry still validates unchanged", () => {
  const { world } = seededWorld();
  world.state.courts["court:customary-fct"].permitted_categories = ["civil", "property", "tenancy_dispute"];
  const before = JSON.stringify(world.state.courts);
  const result = validateJusticeRecords(world.state);
  assert.deepEqual(result.issues, [], "a stored entry is a string and is not rejected");
  assert.equal(result.normalizedFields, 0);
  assert.equal(JSON.stringify(world.state.courts), before);
});

test("Seeded justice data passes record validation", () => {
  const { world } = seededWorld();
  const result = validateJusticeRecords(world.state);
  assert.deepEqual(result.issues, [], JSON.stringify(result.issues.slice(0, 5)));
  assert.ok(Object.keys(world.state.courts).length >= 7, "the seeded courts are present");
});
