/**
 * Record-level validation for the property, government, election, and justice maps.
 *
 * Each domain has a valid fixture in which every record type is present and every reference resolves.
 * Mutation tables then apply one defect at a time (missing field, wrong type, invalid identifier,
 * broken reference, violated invariant, key mismatch) and require the validator to report it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJusticeCatalog } from "../dist/justice/catalog.js";
import {
  assertRecordsValid,
  validateElectionRecords,
  validateGovernmentRecords,
  validateJusticeRecords,
  validatePropertyRecords,
} from "../dist/multiplayer/record-validation.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateState, WorldStore } from "../dist/multiplayer/persistence.js";
import { createIdentity, openPeer, startApi, stopApi } from "./support/harness.mjs";

/** A world saved by the real server (with its seeded catalog records), read back from disk. */
async function savedWorld() {
  const dir = mkdtempSync(join(tmpdir(), "naija-rv-"));
  try {
    const jsonPath = join(dir, "world-state.json");
    const instance = await startApi({ worldStore: new WorldStore(jsonPath), allowedOrigins: [] });
    try {
      const peer = await openPeer(instance.websocketUrl);
      await createIdentity(peer, "Validation Test");
      await peer.close();
    } finally {
      await stopApi(instance.server);
    }
    return JSON.parse(readFileSync(jsonPath, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TS = "2026-10-10T12:00:00.000Z";
const CAL = { year: 2025, month: 1, day: 1 };
const clone = (value) => structuredClone(value);

function withMaps(names, overrides) {
  const maps = Object.fromEntries(names.map((name) => [name, {}]));
  return Object.assign(maps, overrides);
}

// ─── Property ────────────────────────────────────────────────────────────────

const PROPERTY_MAP_NAMES = [
  "properties", "propertyOwnership", "propertyListings", "rentalAgreements", "rentalPayments",
  "propertySales", "propertyMaintenance", "propertyFurnishings", "propertyEvents",
];

function propertyRecord(id, overrides = {}) {
  return {
    property_id: id, type_id: "type:single-room", category_id: "cat:residential", location_id: "loc:akure-odo",
    name: "Test Room", description: "A test room.", bedrooms: 0, bathrooms: 0, condition: "fair", size_sqm: 12,
    amenities: ["shared_kitchen"], development_status: "developed", is_land: false, is_commercial: false,
    max_occupants: 2, created_at: TS, created_world_date: CAL, updated_at: TS, ...overrides,
  };
}

function propertyFixture() {
  return withMaps(PROPERTY_MAP_NAMES, {
    properties: { "prop:test-1": propertyRecord("prop:test-1"), "prop:test-2": propertyRecord("prop:test-2") },
    propertyOwnership: {
      "prop-own-1": {
        ownership_id: "prop-own-1", property_id: "prop:test-1", owner_kind: "npc", owner_id: "npc-landlord-test-1",
        share_percent: 100, acquisition_date: TS, acquisition_world_date: CAL, acquisition_price_ngn: 0, active: true,
        end_date: null, end_world_date: null, end_reason: null, updated_at: TS,
      },
    },
    propertyListings: {
      "prop-list-1": {
        listing_id: "prop-list-1", property_id: "prop:test-1", owner_id: "npc-landlord-test-1", listing_type: "rent",
        asking_price_ngn: 0, rent_price_ngn: 60000, rent_period: "yearly", deposit_ngn: 60000, available: false,
        created_at: TS, created_world_date: CAL, updated_at: TS, idempotency_key: "key-list-1",
      },
    },
    rentalAgreements: {
      "agr-1": {
        agreement_id: "agr-1", property_id: "prop:test-1", listing_id: "prop-list-1", landlord_id: "npc-landlord-test-1",
        landlord_kind: "npc", tenant_id: "character-tenant-1", rent_ngn: 60000, rent_period: "yearly", deposit_ngn: 60000,
        start_date: TS, start_world_date: CAL, end_date: null, end_world_date: null, status: "active", total_paid_ngn: 60000,
        last_payment_date: TS, last_payment_world_date: CAL, created_at: TS, updated_at: TS,
      },
    },
    rentalPayments: {
      "pay-1": {
        payment_id: "pay-1", agreement_id: "agr-1", property_id: "prop:test-1", tenant_id: "character-tenant-1",
        landlord_id: "npc-landlord-test-1", amount_ngn: 60000, period_start: "2025-01-01T00:00:00.000Z",
        period_end: "2026-01-01T00:00:00.000Z", payment_date: TS, payment_world_date: CAL, idempotency_key: "key-pay-1",
      },
    },
    propertySales: {
      "sale-1": {
        sale_id: "sale-1", property_id: "prop:test-1", listing_id: "prop-list-1", seller_id: "npc-landlord-test-1",
        seller_kind: "npc", buyer_id: "character-buyer-1", amount_ngn: 1000000, sale_date: TS, sale_world_date: CAL,
        idempotency_key: "key-sale-1",
      },
    },
    propertyMaintenance: {
      "maint-1": {
        maintenance_id: "maint-1", property_id: "prop:test-1", requested_by: "character-tenant-1", description: "Fix tap.",
        cost_ngn: 5000, condition_before: "fair", condition_after: "good", status: "completed", created_at: TS,
        created_world_date: CAL, completed_at: TS,
      },
    },
    propertyFurnishings: {
      "furn-1": { furnishing_id: "furn-1", property_id: "prop:test-1", furniture_definition_id: "furn:bed", quantity: 1, placed_at: TS, updated_at: TS },
    },
    propertyEvents: {
      "pevt-1": {
        event_id: "pevt-1", property_id: "prop:test-1", type: "property_created", world_date: CAL, summary: "Created.",
        details: { type_id: "type:single-room", count: 1, flag: true, none: null }, created_at: TS,
      },
    },
  });
}

const PROPERTY_MUTATIONS = [
  ["missing required field", (m) => { delete m.properties["prop:test-1"].bedrooms; }, "properties", "prop:test-1", "bedrooms"],
  ["wrong type", (m) => { m.properties["prop:test-1"].bedrooms = "2"; }, "properties", "prop:test-1", "bedrooms"],
  ["negative count", (m) => { m.properties["prop:test-1"].max_occupants = -1; }, "properties", "prop:test-1", "max_occupants"],
  ["unknown enum value", (m) => { m.properties["prop:test-1"].condition = "pristine"; }, "properties", "prop:test-1", "condition"],
  ["invalid identifier", (m) => {
    const r = m.properties["prop:test-1"]; delete m.properties["prop:test-1"]; r.property_id = "bad id!"; m.properties["bad id!"] = r;
  }, "properties", "(non-identifier key)", "property_id"],
  ["key does not match identifier", (m) => { m.properties["prop:other"] = m.properties["prop:test-1"]; delete m.properties["prop:test-1"]; },
    "properties", "prop:other", "property_id"],
  ["ownership references missing property", (m) => { m.propertyOwnership["prop-own-1"].property_id = "prop:missing"; },
    "propertyOwnership", "prop-own-1", "property_id"],
  ["ownership share above 100 percent", (m) => {
    m.propertyOwnership["prop-own-2"] = { ...m.propertyOwnership["prop-own-1"], ownership_id: "prop-own-2", share_percent: 50 };
  }, "propertyOwnership", "prop:test-1", "share_percent"],
  ["listing references missing property", (m) => { m.propertyListings["prop-list-1"].property_id = "prop:missing"; },
    "propertyListings", "prop-list-1", "property_id"],
  ["agreement listing belongs to another property", (m) => { m.rentalAgreements["agr-1"].property_id = "prop:test-2"; },
    "rentalAgreements", "agr-1", "listing_id"],
  ["payment property does not match agreement", (m) => { m.rentalPayments["pay-1"].property_id = "prop:test-2"; },
    "rentalPayments", "pay-1", "property_id"],
  ["payment period reversed", (m) => { m.rentalPayments["pay-1"].period_end = "2024-01-01T00:00:00.000Z"; },
    "rentalPayments", "pay-1", "period_end"],
  ["sale references missing listing", (m) => { m.propertySales["sale-1"].listing_id = "prop-list-missing"; },
    "propertySales", "sale-1", "listing_id"],
  ["maintenance cost negative", (m) => { m.propertyMaintenance["maint-1"].cost_ngn = -5; }, "propertyMaintenance", "maint-1", "cost_ngn"],
  ["furnishing quantity fractional", (m) => { m.propertyFurnishings["furn-1"].quantity = 1.5; }, "propertyFurnishings", "furn-1", "quantity"],
  ["event details contain an object", (m) => { m.propertyEvents["pevt-1"].details = { nested: { a: 1 } }; }, "propertyEvents", "pevt-1", "details"],
];

// ─── Government ──────────────────────────────────────────────────────────────

const GOVERNMENT_MAP_NAMES = [
  "governmentOrganisations", "governmentOffices", "governmentAppointments", "governmentBudgets", "governmentRevenue",
  "governmentExpenditure", "governmentProjects", "governmentAnnouncements", "governmentEvents",
];

function governmentFixture() {
  return withMaps(GOVERNMENT_MAP_NAMES, {
    governmentOrganisations: {
      "gov:federal": {
        organisation_id: "gov:federal", level: "federal", name: "Federal Government", description: "Federal.",
        jurisdiction_id: null, parent_organisation_id: null, ministry_id: null, status: "active",
        created_at: TS, created_world_date: CAL, updated_at: TS,
      },
      "gov:state:test": {
        organisation_id: "gov:state:test", level: "state", name: "State Government", description: "State.",
        jurisdiction_id: "ng:state:la", parent_organisation_id: "gov:federal", ministry_id: "ministry:health",
        status: "active", created_at: TS, created_world_date: CAL, updated_at: TS,
      },
    },
    governmentOffices: {
      "office:test-1": {
        office_id: "office:test-1", definition_id: "office:president", organisation_id: "gov:federal",
        label: "President", unique: true, created_at: TS, updated_at: TS,
      },
    },
    governmentAppointments: {
      "appt-1": {
        appointment_id: "appt-1", office_id: "office:test-1", character_id: "character-president-1", status: "active",
        start_date: TS, start_world_date: CAL, end_date: null, end_world_date: null, end_reason: null, appointed_by: null,
        created_at: TS, updated_at: TS,
      },
    },
    governmentBudgets: {
      "bud:federal:2025": {
        budget_id: "bud:federal:2025", organisation_id: "gov:federal", fiscal_year: 2025, fiscal_period_label: "2025",
        category_id: "bud:administration", approved_amount_ngn: 100, allocated_amount_ngn: 100, spent_amount_ngn: 0,
        status: "active", approved_at: TS, approved_world_date: CAL, created_at: TS, created_world_date: CAL, updated_at: TS,
      },
    },
    governmentRevenue: {
      "rev-1": {
        revenue_id: "rev-1", organisation_id: "gov:federal", category_id: "rev:tax", amount_ngn: 50, description: "Tax.",
        source_reference: null, received_at: TS, received_world_date: CAL, idempotency_key: "key-rev-1",
      },
    },
    governmentExpenditure: {
      "exp-1": {
        expenditure_id: "exp-1", organisation_id: "gov:federal", budget_id: "bud:federal:2025", project_id: "proj-1",
        category_id: "bud:administration", amount_ngn: 10, description: "Spend.", recipient_reference: null, spent_at: TS,
        spent_world_date: CAL, idempotency_key: "key-exp-1",
      },
    },
    governmentProjects: {
      "proj-1": {
        project_id: "proj-1", organisation_id: "gov:federal", budget_id: "bud:federal:2025", category_id: "proj:roads",
        name: "Road", description: "Road works.", location_id: "loc:akure-odo", estimated_cost_ngn: 100,
        approved_funding_ngn: 100, actual_spent_ngn: 0, status: "approved", progress_percent: 10, start_date: null,
        start_world_date: null, planned_completion: null, actual_completion: null, created_at: TS, created_world_date: CAL,
        updated_at: TS,
      },
    },
    governmentAnnouncements: {
      "ann-1": {
        announcement_id: "ann-1", organisation_id: "gov:federal", project_id: "proj-1", title: "Notice", body: "Body.",
        scope_level: "federal", scope_jurisdiction_id: null, status: "published", published_at: TS, published_world_date: CAL,
        created_at: TS, created_world_date: CAL, updated_at: TS,
      },
    },
    governmentEvents: {
      "gevt-1": {
        event_id: "gevt-1", organisation_id: "gov:federal", type: "government_created", world_date: CAL, summary: "Created.",
        details: { ministry_count: 15 }, created_at: TS,
      },
    },
  });
}

const GOVERNMENT_MUTATIONS = [
  ["missing required field", (m) => { delete m.governmentOrganisations["gov:federal"].name; }, "governmentOrganisations", "gov:federal", "name"],
  ["unknown level", (m) => { m.governmentOrganisations["gov:federal"].level = "galactic"; }, "governmentOrganisations", "gov:federal", "level"],
  ["wrong type for status", (m) => { m.governmentOrganisations["gov:federal"].status = 1; }, "governmentOrganisations", "gov:federal", "status"],
  ["parent organisation missing", (m) => { m.governmentOrganisations["gov:state:test"].parent_organisation_id = "gov:missing"; },
    "governmentOrganisations", "gov:state:test", "parent_organisation_id"],
  ["parent cycle", (m) => { m.governmentOrganisations["gov:federal"].parent_organisation_id = "gov:state:test"; },
    "governmentOrganisations", "gov:federal", "parent_organisation_id"],
  ["office identifier invalid", (m) => {
    const r = m.governmentOffices["office:test-1"]; delete m.governmentOffices["office:test-1"]; r.office_id = "bad office"; m.governmentOffices["bad office"] = r;
  }, "governmentOffices", "(non-identifier key)", "office_id"],
  ["office organisation missing", (m) => { m.governmentOffices["office:test-1"].organisation_id = "gov:missing"; },
    "governmentOffices", "office:test-1", "organisation_id"],
  ["appointment office missing", (m) => { m.governmentAppointments["appt-1"].office_id = "office:missing"; },
    "governmentAppointments", "appt-1", "office_id"],
  ["budget amount negative", (m) => { m.governmentBudgets["bud:federal:2025"].approved_amount_ngn = -1; },
    "governmentBudgets", "bud:federal:2025", "approved_amount_ngn"],
  ["revenue amount wrong type", (m) => { m.governmentRevenue["rev-1"].amount_ngn = "50"; }, "governmentRevenue", "rev-1", "amount_ngn"],
  ["expenditure project missing", (m) => { m.governmentExpenditure["exp-1"].project_id = "proj-missing"; },
    "governmentExpenditure", "exp-1", "project_id"],
  ["project progress above 100", (m) => { m.governmentProjects["proj-1"].progress_percent = 150; },
    "governmentProjects", "proj-1", "progress_percent"],
  ["project status unknown", (m) => { m.governmentProjects["proj-1"].status = "maybe"; }, "governmentProjects", "proj-1", "status"],
  ["announcement scope unknown", (m) => { m.governmentAnnouncements["ann-1"].scope_level = "continental"; },
    "governmentAnnouncements", "ann-1", "scope_level"],
  ["event details contain nested object", (m) => { m.governmentEvents["gevt-1"].details = { a: { b: 1 } }; },
    "governmentEvents", "gevt-1", "details"],
];

// ─── Elections ───────────────────────────────────────────────────────────────

const ELECTION_MAP_NAMES = [
  "politicalParties", "partyMemberships", "politicalProfiles", "elections", "candidates", "campaigns", "campaignEvents",
  "campaignFinances", "debates", "ballots", "voterParticipation", "electionDisputes", "electionAudits",
];

function electionFixture() {
  const election = (id) => ({
    election_id: id, election_type: "presidential", office_definition_id: "office:president", jurisdiction_level: "federal",
    jurisdiction_id: null, constituency_id: null, phase: "candidate_registration",
    registration_open_date: "2025-01-01T00:00:00Z", registration_close_date: "2025-02-01T00:00:00Z",
    campaign_start_date: "2025-02-02T00:00:00Z", campaign_end_date: "2025-04-01T00:00:00Z",
    voting_open_date: "2025-04-02T00:00:00Z", voting_close_date: "2025-04-15T00:00:00Z",
    created_by: "character-founder-1", created_at: TS, created_world_date: CAL, updated_at: TS,
    winning_rule: "plurality_national", results: null,
  });
  return withMaps(ELECTION_MAP_NAMES, {
    politicalParties: {
      "party-1": {
        party_id: "party-1", name: "Test Party", abbreviation: "TP", description: "A party.", status: "active",
        founded_by: "character-founder-1", founding_date: TS, founding_world_date: CAL, policy_positions: ["education"],
        leadership: { chair: "character-founder-1" }, updated_at: TS,
      },
    },
    partyMemberships: {
      "mem-1": {
        membership_id: "mem-1", party_id: "party-1", character_id: "character-member-1", status: "active", role: null,
        joined_at: TS, joined_world_date: CAL, ended_at: null, ended_world_date: null, end_reason: null, updated_at: TS,
      },
    },
    politicalProfiles: {
      "prof-1": {
        profile_id: "prof-1", character_id: "character-member-1", party_id: "party-1", public_statement: "Statement.",
        public_service_history: [{ office_label: "Councillor", organisation_name: "Local council", start_date: "2020-01-01", end_date: null }],
        reputation_score: 50, created_at: TS, updated_at: TS,
      },
    },
    elections: { "election-1": election("election-1"), "election-2": election("election-2") },
    candidates: {
      "cand-1": {
        candidate_id: "cand-1", election_id: "election-1", character_id: "character-member-1", party_id: "party-1",
        status: "approved",
        manifesto: { title: "Manifesto", summary: "Summary.", policies: [{ category: "education", statement: "Schools." }], published_at: TS, published_world_date: CAL },
        registered_at: TS, registered_world_date: CAL, approved_at: TS, approved_world_date: CAL, rejection_reason: null, updated_at: TS,
      },
      "cand-2": {
        candidate_id: "cand-2", election_id: "election-2", character_id: "character-other-1", party_id: null, status: "pending",
        manifesto: null, registered_at: TS, registered_world_date: CAL, approved_at: null, approved_world_date: null,
        rejection_reason: null, updated_at: TS,
      },
    },
    campaigns: {
      "camp-1": {
        campaign_id: "camp-1", candidate_id: "cand-1", election_id: "election-1", party_id: "party-1", title: "Campaign",
        description: "Campaign.", themes: ["education"], status: "active", start_date: TS, start_world_date: CAL,
        end_date: null, end_world_date: null, created_at: TS, updated_at: TS,
      },
    },
    campaignEvents: {
      "cevt-1": {
        event_id: "cevt-1", campaign_id: "camp-1", election_id: "election-1", event_type: "rally", title: "Rally",
        description: "Rally.", location_id: null, scheduled_date: TS, scheduled_world_date: CAL, status: "scheduled", created_at: TS,
      },
    },
    campaignFinances: {
      "cfin-1": {
        transaction_id: "cfin-1", campaign_id: "camp-1", election_id: "election-1", type: "donation", amount_ngn: 1000,
        description: "Donation.", source_or_recipient: "donor", idempotency_key: "key-cfin-1", recorded_at: TS, recorded_world_date: CAL,
      },
    },
    debates: {
      "debate-1": {
        debate_id: "debate-1", election_id: "election-1", debate_type: "televised", title: "Debate", topic: "Economy",
        participant_candidate_ids: ["cand-1"], moderator: null, scheduled_date: TS, scheduled_world_date: CAL,
        status: "scheduled", statements: [{ candidate_id: "cand-1", statement: "Statement.", submitted_at: TS }], created_at: TS,
      },
    },
    ballots: {
      "ballot-1": {
        ballot_id: "ballot-1", election_id: "election-1", voter_character_id: "character-voter-1", candidate_id: "cand-1",
        cast_at: TS, cast_world_date: CAL, is_valid: true, rejection_reason: null,
      },
    },
    voterParticipation: {
      "part-1": {
        participation_id: "part-1", election_id: "election-1", voter_character_id: "character-voter-1", has_voted: true,
        voted_at: TS, voted_world_date: CAL,
      },
    },
    electionDisputes: {
      "disp-1": {
        dispute_id: "disp-1", election_id: "election-1", complainant_character_id: "character-voter-1", category: "irregularity",
        description: "Dispute.", evidence_references: [], status: "submitted", submitted_at: TS, submitted_world_date: CAL,
        reviewed_by: null, reviewed_at: null, resolution: null, resolved_at: null, resolved_world_date: null, updated_at: TS,
      },
    },
    electionAudits: {
      "audit-1": {
        audit_id: "audit-1", election_id: "election-1", category: "created", actor_character_id: "character-founder-1",
        summary: "Created.", details: { ok: true }, created_at: TS, created_world_date: CAL,
      },
    },
  });
}

const ELECTION_MUTATIONS = [
  ["missing required field", (m) => { delete m.politicalParties["party-1"].name; }, "politicalParties", "party-1", "name"],
  ["wrong type for founding date", (m) => { m.politicalParties["party-1"].founding_date = 2025; }, "politicalParties", "party-1", "founding_date"],
  ["policy positions not text", (m) => { m.politicalParties["party-1"].policy_positions = [1]; }, "politicalParties", "party-1", "policy_positions"],
  ["membership party missing", (m) => { m.partyMemberships["mem-1"].party_id = "party-missing"; }, "partyMemberships", "mem-1", "party_id"],
  ["membership character identifier invalid", (m) => { m.partyMemberships["mem-1"].character_id = "bad id"; }, "partyMemberships", "mem-1", "character_id"],
  ["profile service history malformed", (m) => { m.politicalProfiles["prof-1"].public_service_history = [{ office_label: 1 }]; },
    "politicalProfiles", "prof-1", "public_service_history"],
  ["election schedule out of order", (m) => { m.elections["election-1"].voting_close_date = "2025-04-01T00:00:00Z"; },
    "elections", "election-1", "registration_open_date"],
  ["election phase unknown", (m) => { m.elections["election-1"].phase = "limbo"; }, "elections", "election-1", "phase"],
  ["election results for another election", (m) => { m.elections["election-1"].results = {
    election_id: "election-2", election_type: "presidential", total_valid_votes: 0, total_invalid_votes: 0,
    total_registered_voters: 0, candidate_results: [], winner_candidate_id: null, winner_character_id: null, is_tie: false,
    status: "counting", certified_at: null, certified_world_date: null, published_at: null, published_world_date: null,
    counting_started_at: null, counting_completed_at: null }; }, "elections", "election-1", "results"],
  ["candidate election missing", (m) => { m.candidates["cand-1"].election_id = "election-missing"; }, "candidates", "cand-1", "election_id"],
  ["candidate registered_at wrong type", (m) => { m.candidates["cand-1"].registered_at = 12345; }, "candidates", "cand-1", "registered_at"],
  ["campaign candidate from another election", (m) => { m.campaigns["camp-1"].election_id = "election-2"; }, "campaigns", "camp-1", "election_id"],
  ["campaign event status unknown", (m) => { m.campaignEvents["cevt-1"].status = "postponed"; }, "campaignEvents", "cevt-1", "status"],
  ["campaign finance amount negative", (m) => { m.campaignFinances["cfin-1"].amount_ngn = -1; }, "campaignFinances", "cfin-1", "amount_ngn"],
  ["debate participant from another election", (m) => { m.debates["debate-1"].participant_candidate_ids = ["cand-2"]; },
    "debates", "debate-1", "participant_candidate_ids"],
  ["debate statement from missing candidate", (m) => { m.debates["debate-1"].statements[0].candidate_id = "cand-missing"; },
    "debates", "debate-1", "statements"],
  ["ballot candidate from another election", (m) => { m.ballots["ballot-1"].candidate_id = "cand-2"; }, "ballots", "ballot-1", "candidate_id"],
  ["ballot is_valid not boolean", (m) => { m.ballots["ballot-1"].is_valid = "yes"; }, "ballots", "ballot-1", "is_valid"],
  ["participation says voted without a time", (m) => { m.voterParticipation["part-1"].voted_at = null; }, "voterParticipation", "part-1", "voted_at"],
  ["dispute status unknown", (m) => { m.electionDisputes["disp-1"].status = "ignored"; }, "electionDisputes", "disp-1", "status"],
  ["audit election missing", (m) => { m.electionAudits["audit-1"].election_id = "election-missing"; }, "electionAudits", "audit-1", "election_id"],
];

// ─── Justice ─────────────────────────────────────────────────────────────────

const JUSTICE_MAP_NAMES = [
  "laws", "lawProvisions", "legislativeProposals", "courts", "legalProfessionals", "legalRepresentations", "cases",
  "caseParticipants", "evidence", "witnesses", "hearings", "judgments", "sentences", "fines", "settlements", "appeals",
  "legalAudits",
];

const CASE_TYPE_FOR = (() => {
  const catalog = loadJusticeCatalog();
  return new Map(catalog.case_categories.map((c) => [c.id, c.type]));
})();

function justiceFixture() {
  return withMaps(JUSTICE_MAP_NAMES, {
    laws: {
      "law:test-1": {
        law_id: "law:test-1", title: "Test Law", short_reference: "TL 1", description: "Test.", category: "criminal",
        jurisdiction: "federal", applicable_state_id: null, enacted_by: null, status: "in_force", version: 1,
        enactment_date: "2000-01-01", effective_date: "2000-01-01", expiration_date: null, parent_law_id: null,
        related_law_ids: [], public_explanation: "Explained.", source_reference: null, created_at: TS,
        created_world_date: CAL, updated_at: TS,
      },
    },
    lawProvisions: {
      "law:test-1:s1": {
        provision_id: "law:test-1:s1", law_id: "law:test-1", section: "1", title: "Section", description: "Text.",
        effective_from: "2000-01-01", effective_until: null, penalty_type: "fine", penalty_min_amount_ngn: 1000,
        penalty_max_amount_ngn: 5000, status: "active", created_at: TS, updated_at: TS,
      },
    },
    legislativeProposals: {
      "legpro-1": {
        proposal_id: "legpro-1", title: "Bill", description: "Bill.", purpose: "Purpose.", proposed_law_id: null,
        sponsor_character_id: "character-member-1", sponsor_office_id: null, jurisdiction: "federal", applicable_state_id: null,
        status: "draft", provisions: [{ section: "1", title: "Section", description: "Text." }], supporting_explanation: "Why.",
        submission_date: null, submission_world_date: null, decision_date: null, decision_world_date: null, decision_reason: null,
        revision_history: [{ date: TS, summary: "Created.", by_character_id: "character-member-1" }], created_at: TS,
        created_world_date: CAL, updated_at: TS,
      },
    },
    courts: {
      "court:supreme": {
        court_id: "court:supreme", name: "Supreme Court", level: "supreme", jurisdiction: "federal", applicable_jurisdiction_id: null,
        superior_court_id: null, permitted_categories: ["criminal", "civil"], status: "active", assigned_judge_ids: [],
        created_at: TS, created_world_date: CAL, updated_at: TS,
      },
      "court:magistrate-1": {
        court_id: "court:magistrate-1", name: "Magistrate Court", level: "magistrate", jurisdiction: "federal",
        applicable_jurisdiction_id: null, superior_court_id: "court:supreme", permitted_categories: ["criminal", "civil"],
        status: "active", assigned_judge_ids: ["character-judge-1"], created_at: TS, created_world_date: CAL, updated_at: TS,
      },
    },
    legalProfessionals: {
      "prof-judge-1": {
        professional_id: "prof-judge-1", character_id: "character-judge-1", role: "judge", court_id: "court:magistrate-1",
        status: "active", qualifications: ["LLB"], appointed_at: TS, appointed_world_date: CAL, appointed_by: null, updated_at: TS,
      },
      "prof-lawyer-1": {
        professional_id: "prof-lawyer-1", character_id: "character-lawyer-1", role: "lawyer", court_id: null, status: "active",
        qualifications: ["BL"], appointed_at: TS, appointed_world_date: CAL, appointed_by: null, updated_at: TS,
      },
    },
    cases: {
      "case-1": {
        case_id: "case-1", case_number: "CASE/1", category: "civil_general", case_type: CASE_TYPE_FOR.get("civil_general"),
        court_id: "court:magistrate-1", jurisdiction: "federal", applicable_state_id: null,
        filing_party_character_id: "character-member-1", respondent_character_id: "character-other-1",
        additional_party_character_ids: [], assigned_judge_character_id: "character-judge-1", summary: "Summary.",
        description: "Description.", relevant_event_date: null, relevant_law_ids: ["law:test-1"],
        relevant_provision_ids: ["law:test-1:s1"], filing_date: TS, filing_world_date: CAL, status: "awaiting_judgment",
        priority: "normal", judgment_id: "judg-1", appeal_id: "appeal-1", closure_date: null, closure_world_date: null,
        created_at: TS, updated_at: TS,
      },
    },
    caseParticipants: {
      "cp-1": {
        participant_id: "cp-1", case_id: "case-1", character_id: "character-member-1", role: "claimant", joined_at: TS,
        joined_world_date: CAL, status: "active", updated_at: TS,
      },
    },
    legalRepresentations: {
      "rep-1": {
        representation_id: "rep-1", case_id: "case-1", lawyer_character_id: "character-lawyer-1", professional_id: "prof-lawyer-1",
        represented_party_character_id: "character-member-1", role: "claimant_counsel", started_at: TS, started_world_date: CAL,
        ended_at: null, ended_world_date: null, end_reason: null, updated_at: TS,
      },
    },
    evidence: {
      "ev-1": {
        evidence_id: "ev-1", case_id: "case-1", category: "document", submitted_by_character_id: "character-member-1",
        description: "Receipt.", source_reference: null, transaction_reference: null, submitted_at: TS, submitted_world_date: CAL,
        verification_status: "unverified", admissibility_status: "pending", reviewed_by_character_id: null, reviewed_at: null,
        review_reason: null, version: 1, supersedes_evidence_id: null, updated_at: TS,
      },
    },
    witnesses: {
      "wit-1": {
        witness_id: "wit-1", case_id: "case-1", character_id: "character-witness-1", testimony: "Testimony.",
        submitted_by_character_id: "character-member-1", submitted_at: TS, submitted_world_date: CAL,
        credibility_status: "pending", updated_at: TS,
      },
    },
    hearings: {
      "hear-1": {
        hearing_id: "hear-1", case_id: "case-1", court_id: "court:magistrate-1", judge_character_id: "character-judge-1",
        hearing_type: "pretrial", scheduled_date: TS, scheduled_world_date: CAL, actual_start_date: null, actual_end_date: null,
        status: "scheduled", notes: "Notes.", evidence_references: [], attendance_character_ids: ["character-member-1"],
        procedural_decisions: [], created_at: TS, updated_at: TS,
      },
    },
    judgments: {
      "judg-1": {
        judgment_id: "judg-1", case_id: "case-1", court_id: "court:magistrate-1", judge_character_id: "character-judge-1",
        outcome: "fine_only", findings: "Found.", reasoning: "Because.", relevant_law_ids: ["law:test-1"],
        relevant_provision_ids: ["law:test-1:s1"], evidence_considered_ids: ["ev-1"],
        remedies: [{ type: "fine", description: "Fine.", amount_ngn: 1000 }], sentence_ids: ["sent-1"], appeal_eligible: true,
        appeal_deadline: TS, issued_at: TS, issued_world_date: CAL, superseded_by_judgment_id: null, status: "issued", updated_at: TS,
      },
    },
    sentences: {
      "sent-1": {
        sentence_id: "sent-1", case_id: "case-1", judgment_id: "judg-1", convicted_character_id: "character-other-1",
        type: "fine", description: "Fine.", amount_ngn: 1000, duration_days: null, start_date: TS, start_world_date: CAL,
        end_date: null, end_world_date: null, status: "active", issued_at: TS, issued_world_date: CAL, updated_at: TS,
      },
    },
    fines: {
      "fine-1": {
        fine_id: "fine-1", case_id: "case-1", judgment_id: "judg-1", sentence_id: "sent-1",
        responsible_character_id: "character-other-1", amount_ngn: 1000, amount_paid_ngn: 400, amount_outstanding_ngn: 600,
        due_date: TS, due_world_date: CAL, status: "partially_paid", payment_transaction_ids: ["tx-1"],
        idempotency_key: "key-fine-1", created_at: TS, created_world_date: CAL, updated_at: TS,
      },
    },
    settlements: {
      "set-1": {
        settlement_id: "set-1", case_id: "case-1", parties_character_ids: ["character-member-1", "character-other-1"],
        terms: "Terms.", effective_date: TS, effective_world_date: CAL, payment_obligation_ngn: null,
        payment_recipient_character_id: null, status: "proposed", approved_by_character_id: null, approved_at: null,
        completed_at: null, created_at: TS, updated_at: TS,
      },
    },
    appeals: {
      "appeal-1": {
        appeal_id: "appeal-1", original_case_id: "case-1", original_judgment_id: "judg-1",
        appellant_character_id: "character-other-1", grounds: "Grounds.", supporting_references: [], filing_date: TS,
        filing_world_date: CAL, appellate_court_id: "court:supreme", assigned_judge_character_id: null, status: "filed",
        outcome: null, outcome_judgment_id: null, outcome_reasoning: null, decided_at: null, decided_world_date: null, updated_at: TS,
      },
    },
    legalAudits: {
      "la-1": {
        audit_id: "la-1", category: "law_created", law_id: "law:test-1", proposal_id: null, case_id: null, judgment_id: null,
        appeal_id: null, actor_character_id: null, summary: "Created.", details: { ok: true }, created_at: TS, created_world_date: CAL,
      },
    },
  });
}

const JUSTICE_MUTATIONS = [
  ["missing required field", (m) => { delete m.cases["case-1"].summary; }, "cases", "case-1", "summary"],
  ["wrong type for amount", (m) => { m.sentences["sent-1"].amount_ngn = "1000"; }, "sentences", "sent-1", "amount_ngn"],
  ["invalid identifier on legal audit actor", (m) => { m.legalAudits["la-1"].actor_character_id = "bad actor"; }, "legalAudits", "la-1", "actor_character_id"],
  ["judgment court missing", (m) => { m.judgments["judg-1"].court_id = "court:missing"; }, "judgments", "judg-1", "court_id"],
  ["case type does not match category", (m) => { m.cases["case-1"].case_type = "criminal"; }, "cases", "case-1", "case_type"],
  ["case references missing provision", (m) => { m.cases["case-1"].relevant_provision_ids = ["law:missing:s9"]; },
    "cases", "case-1", "relevant_provision_ids"],
  ["fine outstanding does not match", (m) => { m.fines["fine-1"].amount_outstanding_ngn = 500; }, "fines", "fine-1", "amount_outstanding_ngn"],
  ["penalty minimum above maximum", (m) => { m.lawProvisions["law:test-1:s1"].penalty_min_amount_ngn = 9000; },
    "lawProvisions", "law:test-1:s1", "penalty_min_amount_ngn"],
  ["court superior cycle", (m) => { m.courts["court:supreme"].superior_court_id = "court:magistrate-1"; },
    "courts", "court:supreme", "superior_court_id"],
  ["judgment status unknown", (m) => { m.judgments["judg-1"].status = "pending"; }, "judgments", "judg-1", "status"],
  ["remedy amount negative", (m) => { m.judgments["judg-1"].remedies = [{ type: "fine", description: "Fine.", amount_ngn: -5 }]; },
    "judgments", "judg-1", "remedies"],
  ["appeal court missing", (m) => { m.appeals["appeal-1"].appellate_court_id = "court:missing"; }, "appeals", "appeal-1", "appellate_court_id"],
  ["evidence version zero", (m) => { m.evidence["ev-1"].version = 0; }, "evidence", "ev-1", "version"],
  ["representation professional missing", (m) => { m.legalRepresentations["rep-1"].professional_id = "prof-missing"; },
    "legalRepresentations", "rep-1", "professional_id"],
  ["settlement status unknown", (m) => { m.settlements["set-1"].status = "agreed"; }, "settlements", "set-1", "status"],
];

const DOMAINS = [
  { name: "property", fixture: propertyFixture, validate: validatePropertyRecords, mutations: PROPERTY_MUTATIONS },
  { name: "government", fixture: governmentFixture, validate: validateGovernmentRecords, mutations: GOVERNMENT_MUTATIONS },
  { name: "election", fixture: electionFixture, validate: validateElectionRecords, mutations: ELECTION_MUTATIONS },
  { name: "justice", fixture: justiceFixture, validate: validateJusticeRecords, mutations: JUSTICE_MUTATIONS },
];

for (const domain of DOMAINS) {
  test(`Record validation (${domain.name}): valid records pass without changes`, () => {
    const maps = domain.fixture();
    const before = JSON.stringify(maps);
    const result = domain.validate(maps);
    assert.deepEqual(result.issues, [], JSON.stringify(result.issues));
    assert.equal(result.normalizedFields, 0);
    assert.equal(JSON.stringify(maps), before, "valid records must not be rewritten");
  });

  for (const [label, mutate, map, recordId, field] of domain.mutations) {
    test(`Record validation (${domain.name}): rejects ${label}`, () => {
      const maps = domain.fixture();
      mutate(maps);
      const result = domain.validate(maps);
      const hit = result.issues.find((issue) => issue.map === map && issue.recordId === recordId && issue.field === field);
      assert.ok(hit, `expected an issue at ${map}[${recordId}].${field}; got ${JSON.stringify(result.issues.slice(0, 5))}`);
      assert.equal(hit.category, domain.name);
    });
  }

  test(`Record validation (${domain.name}): absent nullable fields are normalized to null and counted`, () => {
    const maps = domain.fixture();
    const normalizedFieldsByDomain = {
      property: () => { delete maps.propertyOwnership["prop-own-1"].end_date; return ["propertyOwnership", "prop-own-1", "end_date"]; },
      government: () => { delete maps.governmentAppointments["appt-1"].end_date; return ["governmentAppointments", "appt-1", "end_date"]; },
      election: () => { delete maps.partyMemberships["mem-1"].role; return ["partyMemberships", "mem-1", "role"]; },
      justice: () => { delete maps.judgments["judg-1"].appeal_deadline; return ["judgments", "judg-1", "appeal_deadline"]; },
    };
    const [map, id, field] = normalizedFieldsByDomain[domain.name]();
    const result = domain.validate(maps);
    assert.deepEqual(result.issues, []);
    assert.equal(result.normalizedFields, 1);
    assert.equal(maps[map][id][field], null);
  });

  test(`Record validation (${domain.name}): a key that is not an identifier is not echoed`, () => {
    const maps = domain.fixture();
    const first = Object.keys(maps).find((name) => Object.keys(maps[name]).length > 0);
    const [key] = Object.keys(maps[first]);
    const record = maps[first][key];
    const secretKey = "SECRET-KEY\n with spaces";
    maps[first][secretKey] = { ...record };
    const result = domain.validate(maps);
    const message = (() => { try { assertRecordsValid(result); return ""; } catch (error) { return error.message; } })();
    assert.ok(message.includes("invalid"), "expected diagnostic");
    assert.ok(!message.includes("SECRET-KEY"), "the raw key must not appear in the diagnostic");
  });
}

test("Record validation: diagnostics name the category, record, field, and invariant without field values", () => {
  const maps = propertyFixture();
  maps.properties["prop:test-1"].description = "PRIVATE-DESCRIPTION-TEXT";
  maps.properties["prop:test-1"].bedrooms = "TWO";
  const result = validatePropertyRecords(maps);
  assert.throws(() => assertRecordsValid(result), (error) => {
    assert.match(error.message, /invalid property record: properties\[prop:test-1\] field "bedrooms" must be a whole number/);
    assert.ok(!error.message.includes("PRIVATE-DESCRIPTION-TEXT"));
    assert.ok(!error.message.includes("TWO"));
    return true;
  });
});

test("Record validation: a rejected record is left in place, not deleted or regenerated", () => {
  const maps = governmentFixture();
  maps.governmentOffices["office:test-1"].organisation_id = "gov:missing";
  const before = JSON.stringify(maps);
  const result = validateGovernmentRecords(maps);
  assert.ok(result.issues.length > 0);
  assert.equal(JSON.stringify(maps), before, "validation must not change a record that fails");
});

test("Record validation: a valid engine-produced world with seeded records loads, round-trips, and keeps IDs", async () => {
  const now = Date.now();
  const saved = await savedWorld();
  const first = validateState(JSON.parse(JSON.stringify(saved)), now);
  const second = validateState(JSON.parse(JSON.stringify(first)), now);
  for (const name of [...PROPERTY_MAP_NAMES, ...GOVERNMENT_MAP_NAMES, ...ELECTION_MAP_NAMES, ...JUSTICE_MAP_NAMES]) {
    assert.deepEqual(Object.keys(second[name]).sort(), Object.keys(first[name]).sort(), `IDs changed for ${name}`);
  }
  assert.ok(Object.keys(first.properties).length > 0, "seeded properties expected in a saved world");
  assert.ok(Object.keys(first.governmentOrganisations).length > 0, "seeded government organisations expected");
  assert.ok(Object.keys(first.laws).length > 0, "seeded laws expected");
  assert.equal(JSON.stringify(first.properties), JSON.stringify(second.properties));
  assert.equal(JSON.stringify(first.governmentOrganisations), JSON.stringify(second.governmentOrganisations));
  assert.equal(JSON.stringify(first.laws), JSON.stringify(second.laws));
});

test("Record validation: validateState rejects an invalid property record in a saved world", async () => {
  const now = Date.now();
  const saved = await savedWorld();
  const [seedId] = Object.keys(saved.properties);
  assert.ok(seedId, "a saved world must contain seeded properties");
  saved.properties[seedId].bedrooms = -3;
  assert.throws(() => validateState(saved, now), /invalid property record: properties\[.*\] field "bedrooms" must be a whole number of at least 0/);
});
