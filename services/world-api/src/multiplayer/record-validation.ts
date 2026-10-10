/**
 * Record-level validation for the JSON world-state loader.
 *
 * Validates the persisted records of the property, government, election, and justice maps against
 * the TypeScript record types in their domain modules. Rules are:
 *
 * - Invalid records are rejected. They are never deleted, regenerated, or rewritten.
 * - A nullable field that is absent (undefined) is normalized to null. That is the only rewrite, it is
 *   deterministic, and it is counted in `normalizedFields`. Absent required fields are rejected.
 * - Diagnostics name the category, map, record identifier, field, and failed invariant. They never
 *   include field values, so descriptions, names, and other free text do not reach logs.
 * - References are checked only against maps held in the same world state. Owner and character
 *   identifiers that point to people or organisations outside these four domains are checked for
 *   identifier syntax only.
 */

import { isValidDate } from "../life/calendar.js";
import { loadJusticeCatalog } from "../justice/catalog.js";
import type { PersistentPropertyMaps } from "../properties/types.js";
import type { PersistentGovernmentMaps } from "../government/types.js";
import type { PersistentElectionMaps } from "../elections/types.js";
import type { PersistentJusticeMaps } from "../justice/types.js";
import { isFiniteNumber, isRecord } from "./types.js";

export interface RecordIssue {
  readonly category: string;
  readonly map: string;
  readonly recordId: string;
  readonly field: string;
  readonly invariant: string;
}

export interface RecordValidationResult {
  readonly issues: readonly RecordIssue[];
  readonly normalizedFields: number;
}

type Rec = Record<string, unknown>;
type RecordMap = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const MAX_TEXT_LENGTH = 20000;

// ─── Enumerations (from the domain type unions) ───────────────────────────────

const PROPERTY_CATEGORIES = new Set(["cat:residential", "cat:commercial", "cat:land", "cat:public"]);
const PROPERTY_CONDITIONS = new Set(["excellent", "good", "fair", "poor", "requires_repair"]);
const PROPERTY_DEVELOPMENT_STATUSES = new Set(["undeveloped", "reserved", "under_construction", "developed"]);
const PROPERTY_OWNER_KINDS = new Set(["player", "npc", "business", "government", "community", "joint"]);
const PROPERTY_LISTING_TYPES = new Set(["sale", "rent", "none"]);
const PROPERTY_RENT_PERIODS = new Set(["monthly", "quarterly", "half_yearly", "yearly", "none"]);
const RENTAL_AGREEMENT_STATUSES = new Set(["pending", "active", "expired", "terminated", "cancelled"]);
const MAINTENANCE_STATUSES = new Set(["pending", "completed", "cancelled"]);

const GOVERNMENT_LEVELS = new Set(["federal", "state", "local"]);
const GOVERNMENT_ORGANISATION_STATUSES = new Set(["active", "inactive", "dissolved"]);
const APPOINTMENT_STATUSES = new Set(["active", "ended", "removed"]);
const BUDGET_STATUSES = new Set(["draft", "approved", "active", "closed"]);
const PROJECT_STATUSES = new Set([
  "proposed", "under_review", "approved", "funded", "in_progress", "completed", "suspended", "cancelled",
]);
const ANNOUNCEMENT_STATUSES = new Set(["draft", "published", "archived"]);

const ELECTION_TYPES = new Set([
  "presidential", "governorship", "senatorial", "house_of_representatives", "state_assembly", "local_chairman",
]);
const ELECTION_PHASES = new Set([
  "scheduling", "candidate_registration", "screening", "campaign", "voting", "counting",
  "certification", "completed", "disputed", "cancelled",
]);
const WINNING_RULES = new Set([
  "plurality_national", "plurality_state", "plurality_district", "plurality_constituency", "plurality_lga",
]);
const PARTY_STATUSES = new Set(["proposed", "pending_registration", "active", "suspended", "dissolved"]);
const MEMBERSHIP_STATUSES = new Set(["active", "resigned", "suspended", "expelled"]);
const CANDIDATE_STATUSES = new Set(["pending", "approved", "rejected", "withdrawn"]);
const CAMPAIGN_STATUSES = new Set(["preparing", "active", "concluded", "cancelled"]);
const CAMPAIGN_EVENT_STATUSES = new Set(["scheduled", "completed", "cancelled"]);
const CAMPAIGN_FINANCE_TYPES = new Set([
  "donation", "party_allocation", "expense", "event_expense", "advertising_expense",
]);
const DEBATE_STATUSES = new Set(["scheduled", "in_progress", "completed", "cancelled"]);
const DISPUTE_STATUSES = new Set(["submitted", "under_review", "accepted", "rejected", "resolved", "escalated"]);
const RESULT_STATUSES = new Set(["counting", "preliminary", "certified", "published", "disputed", "annulled"]);

const LAW_CATEGORIES = new Set([
  "constitutional", "criminal", "civil", "commercial", "property", "employment", "traffic", "environmental",
  "administration", "election", "financial", "education", "safety", "other",
]);
const COURT_LEVELS = new Set([
  "customary", "magistrate", "state_high", "federal_high", "national_industrial", "court_of_appeal", "supreme", "tribunal",
]);
const CASE_CATEGORIES = new Set([
  "civil_general", "contract_dispute", "debt_recovery", "property_dispute", "tenancy_dispute", "employment_claim",
  "compensation_claim", "criminal_misdemeanor", "criminal_felony", "regulatory_penalty", "commercial_dispute",
]);
const CASE_TYPES = new Set(["civil", "criminal"]);
const LAW_STATUSES = new Set([
  "draft", "proposed", "under_review", "approved", "enacted", "in_force", "suspended", "amended", "repealed", "rejected", "archived",
]);
const PROVISION_STATUSES = new Set(["active", "suspended", "repealed"]);
const PROPOSAL_STATUSES = new Set(["draft", "submitted", "under_review", "approved", "enacted", "rejected", "withdrawn"]);
const COURT_STATUSES = new Set(["active", "inactive", "suspended"]);
const PROFESSIONAL_ROLES = new Set([
  "lawyer", "prosecutor", "defense_counsel", "judge", "magistrate", "legal_clerk", "court_registrar",
]);
const PROFESSIONAL_STATUSES = new Set(["active", "suspended", "inactive"]);
const REPRESENTATION_ROLES = new Set(["claimant_counsel", "defendant_counsel", "prosecutor", "defense_counsel"]);
const CASE_STATUSES = new Set([
  "draft", "submitted", "accepted", "rejected", "awaiting_response", "pretrial", "awaiting_hearing", "in_hearing",
  "awaiting_judgment", "judgment_issued", "eligible_for_appeal", "appeal_pending", "settled", "withdrawn", "dismissed", "closed",
]);
const CASE_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const PARTICIPANT_ROLES = new Set(["claimant", "defendant", "respondent", "third_party", "witness"]);
const PARTICIPANT_STATUSES = new Set(["active", "removed", "withdrawn"]);
const EVIDENCE_VERIFICATION = new Set(["unverified", "verified", "challenged", "rejected", "accepted"]);
const EVIDENCE_ADMISSIBILITY = new Set(["pending", "admitted", "excluded"]);
const WITNESS_CREDIBILITY = new Set(["pending", "credible", "challenged", "discredited"]);
const HEARING_TYPES = new Set(["pretrial", "trial", "sentencing", "interlocutory", "appeal_hearing"]);
const HEARING_STATUSES = new Set(["scheduled", "in_progress", "adjourned", "completed", "cancelled"]);
const JUDGMENT_OUTCOMES = new Set([
  "acquittal", "conviction", "dismissal", "civil_remedy", "fine_only", "settlement_approved", "case_transferred", "consent_order",
]);
const JUDGMENT_STATUSES = new Set(["issued", "under_appeal", "reversed", "modified", "affirmed", "final"]);
const SENTENCE_TYPES = new Set(["warning", "fine", "compensation", "community_service", "activity_restriction", "imprisonment"]);
const SENTENCE_STATUSES = new Set(["active", "served", "suspended", "overturned", "waived"]);
const FINE_STATUSES = new Set(["outstanding", "partially_paid", "paid", "disputed", "waived", "cancelled"]);
const SETTLEMENT_STATUSES = new Set(["proposed", "accepted", "approved", "completed", "breached", "rejected"]);
const APPEAL_STATUSES = new Set(["filed", "accepted", "rejected", "in_hearing", "decided"]);
const APPEAL_OUTCOMES = new Set(["affirmed", "reversed", "modified", "remanded", "dismissed"]);

// ─── Validation context ───────────────────────────────────────────────────────

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function hasKey(target: RecordMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** Map keys are shown only when they are identifiers, so arbitrary file content never reaches a message. */
function displayId(key: string): string {
  return isIdentifier(key) ? key : "(non-identifier key)";
}

class RecordValidator {
  readonly issues: RecordIssue[] = [];
  normalizedFields = 0;
  private map = "";
  private recordId = "";

  constructor(private readonly category: string) {}

  /** Validates each record of one map. The map key must equal the record's identifier field. */
  records(mapName: string, records: RecordMap | undefined, idField: string, check: (rec: Rec) => void): void {
    for (const [key, value] of Object.entries(records ?? {})) {
      this.map = mapName;
      this.recordId = displayId(key);
      if (!isRecord(value)) {
        this.fail("(record)", "must be an object");
        continue;
      }
      if (value[idField] !== key) {
        this.fail(idField, "must equal the record's map key");
      } else if (!isIdentifier(value[idField])) {
        this.fail(idField, "must be an identifier");
      }
      check(value);
    }
  }

  /** Adds a diagnostic for a record found outside the per-record checks (for example, a cross-record sum). */
  issueAt(mapName: string, recordId: string, field: string, invariant: string): void {
    this.issues.push({ category: this.category, map: mapName, recordId: displayId(recordId), field, invariant });
  }

  private fail(field: string, invariant: string): void {
    this.issues.push({ category: this.category, map: this.map, recordId: this.recordId, field, invariant });
  }

  /**
   * Core check. An absent nullable field is set to null (counted). An absent required field fails.
   * A null value fails unless the field is nullable.
   */
  private expect(rec: Rec, field: string, nullable: boolean, test: (value: unknown) => boolean, invariant: string): void {
    const value = rec[field];
    if (value === undefined) {
      if (nullable) {
        rec[field] = null;
        this.normalizedFields += 1;
      } else {
        this.fail(field, "is required");
      }
      return;
    }
    if (value === null) {
      if (!nullable) this.fail(field, "must not be null");
      return;
    }
    if (!test(value)) this.fail(field, invariant);
  }

  id(rec: Rec, field: string, nullable = false): void {
    this.expect(rec, field, nullable, isIdentifier, "must be an identifier");
  }

  text(rec: Rec, field: string, nullable = false): void {
    this.expect(rec, field, nullable, (v) => typeof v === "string" && v.length <= MAX_TEXT_LENGTH, "must be text");
  }

  nonEmptyText(rec: Rec, field: string, nullable = false): void {
    this.expect(rec, field, nullable, (v) => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT_LENGTH,
      "must be non-empty text");
  }

  num(rec: Rec, field: string, options: { min?: number; max?: number; integer?: boolean; nullable?: boolean } = {}): void {
    const { min = -Infinity, max = Infinity, integer = false, nullable = false } = options;
    const expected = `must be a ${integer ? "whole number" : "number"}${min > -Infinity ? ` of at least ${min}` : ""}${max < Infinity ? ` and at most ${max}` : ""}`;
    this.expect(rec, field, nullable, (v) => isFiniteNumber(v) && v >= min && v <= max && (!integer || Number.isInteger(v)),
      expected);
  }

  bool(rec: Rec, field: string, nullable = false): void {
    this.expect(rec, field, nullable, (v) => typeof v === "boolean", "must be true or false");
  }

  oneOf(rec: Rec, field: string, allowed: ReadonlySet<string>, nullable = false): void {
    this.expect(rec, field, nullable, (v) => typeof v === "string" && allowed.has(v), "must be one of the documented values");
  }

  /** ISO timestamp (or any date string Date can parse). */
  timestamp(rec: Rec, field: string, nullable = false): void {
    this.expect(rec, field, nullable, (v) => typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v)),
      "must be a valid date string");
  }

  worldDate(rec: Rec, field: string, nullable = false): void {
    this.expect(rec, field, nullable, (v) => isValidDate(v), "must be a valid world calendar date");
  }

  stringArray(rec: Rec, field: string): void {
    this.expect(rec, field, false, (v) => Array.isArray(v) && v.every((item) => typeof item === "string"),
      "must be an array of text");
  }

  idArray(rec: Rec, field: string): void {
    this.expect(rec, field, false, (v) => Array.isArray(v) && v.every(isIdentifier), "must be an array of identifiers");
  }

  /** Reference to a record in another map. Nullable references may be null. */
  ref(rec: Rec, field: string, targetName: string, target: RecordMap | undefined, nullable = false): void {
    this.expect(rec, field, nullable,
      (v) => isIdentifier(v) && (target === undefined || hasKey(target, v)),
      `must reference an existing ${targetName} record`);
  }

  refArray(rec: Rec, field: string, targetName: string, target: RecordMap | undefined): void {
    this.expect(rec, field, false,
      (v) => Array.isArray(v) && v.every((item) => isIdentifier(item) && (target === undefined || hasKey(target, item))),
      `must contain only identifiers of existing ${targetName} records`);
  }

  /** Details objects hold only primitive values. */
  details(rec: Rec, field: string): void {
    this.expect(rec, field, false,
      (v) => isRecord(v) && Object.values(v).every((item) => item === null || typeof item === "string" ||
        typeof item === "number" || typeof item === "boolean"),
      "must be an object of primitive values");
  }

  /** Optional nested object: absent becomes null, present must satisfy `check`. */
  nested(rec: Rec, field: string, check: (value: Rec) => void): void {
    const value = rec[field];
    if (value === undefined) {
      rec[field] = null;
      this.normalizedFields += 1;
      return;
    }
    if (value === null) return;
    if (!isRecord(value)) {
      this.fail(field, "must be an object or null");
      return;
    }
    check(value);
  }

  /** Array of nested objects. Each item is checked by `check`. */
  nestedArray(rec: Rec, field: string, check: (item: Rec) => void): void {
    const value = rec[field];
    if (!Array.isArray(value)) {
      this.fail(field, "must be an array");
      return;
    }
    for (const item of value) {
      if (!isRecord(item)) {
        this.fail(field, "must contain only objects");
        return;
      }
      check(item);
    }
  }

  /** Custom invariant. */
  invariant(field: string, ok: boolean, message: string): void {
    if (!ok) this.fail(field, message);
  }

  /** Walks a parent chain and fails if it loops back on itself. */
  noParentCycle(records: RecordMap, rec: Rec, field: string, id: string): void {
    const seen = new Set<string>([id]);
    let current = rec[field];
    while (typeof current === "string") {
      if (seen.has(current)) {
        this.fail(field, "must not form a parent cycle");
        return;
      }
      seen.add(current);
      const next = records[current];
      if (!isRecord(next)) return;
      current = next[field];
    }
  }

  result(): RecordValidationResult {
    return { issues: this.issues, normalizedFields: this.normalizedFields };
  }
}

function recordOf(value: unknown): Rec {
  return isRecord(value) ? value : {};
}

// ─── Property ─────────────────────────────────────────────────────────────────

export function validatePropertyRecords(maps: PersistentPropertyMaps): RecordValidationResult {
  const v = new RecordValidator("property");
  const properties = maps.properties as unknown as RecordMap;
  const listings = maps.propertyListings as unknown as RecordMap;
  const agreements = maps.rentalAgreements as unknown as RecordMap;
  const payments = maps.rentalPayments as unknown as RecordMap;

  v.records("properties", properties, "property_id", (r) => {
    v.id(r, "type_id");
    v.oneOf(r, "category_id", PROPERTY_CATEGORIES);
    v.id(r, "location_id");
    v.nonEmptyText(r, "name");
    v.text(r, "description");
    v.num(r, "bedrooms", { min: 0, integer: true });
    v.num(r, "bathrooms", { min: 0, integer: true });
    v.oneOf(r, "condition", PROPERTY_CONDITIONS);
    v.num(r, "size_sqm", { min: 0 });
    v.stringArray(r, "amenities");
    v.oneOf(r, "development_status", PROPERTY_DEVELOPMENT_STATUSES);
    v.bool(r, "is_land");
    v.bool(r, "is_commercial");
    v.num(r, "max_occupants", { min: 0, integer: true });
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
  });

  v.records("propertyOwnership", maps.propertyOwnership as unknown as RecordMap, "ownership_id", (r) => {
    v.ref(r, "property_id", "properties", properties);
    v.oneOf(r, "owner_kind", PROPERTY_OWNER_KINDS);
    v.id(r, "owner_id");
    v.num(r, "share_percent", { min: 0, max: 100 });
    v.timestamp(r, "acquisition_date");
    v.worldDate(r, "acquisition_world_date");
    v.num(r, "acquisition_price_ngn", { min: 0 });
    v.bool(r, "active");
    v.timestamp(r, "end_date", true);
    v.worldDate(r, "end_world_date", true);
    v.text(r, "end_reason", true);
    v.timestamp(r, "updated_at");
  });
  // Active ownership of one property cannot exceed 100 percent in total.
  const activeShares = new Map<string, number>();
  for (const value of Object.values(maps.propertyOwnership as unknown as RecordMap)) {
    const r = recordOf(value);
    if (r.active === true && isIdentifier(r.property_id) && isFiniteNumber(r.share_percent)) {
      activeShares.set(r.property_id, (activeShares.get(r.property_id) ?? 0) + r.share_percent);
    }
  }
  for (const [propertyId, total] of activeShares) {
    if (total > 100 + 1e-9) {
      v.issueAt("propertyOwnership", propertyId, "share_percent", "active ownership shares exceed 100 percent of the property");
    }
  }

  v.records("propertyListings", listings, "listing_id", (r) => {
    v.ref(r, "property_id", "properties", properties);
    v.id(r, "owner_id");
    v.oneOf(r, "listing_type", PROPERTY_LISTING_TYPES);
    v.num(r, "asking_price_ngn", { min: 0 });
    v.num(r, "rent_price_ngn", { min: 0 });
    v.oneOf(r, "rent_period", PROPERTY_RENT_PERIODS);
    v.num(r, "deposit_ngn", { min: 0 });
    v.bool(r, "available");
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
    v.nonEmptyText(r, "idempotency_key");
  });

  v.records("rentalAgreements", agreements, "agreement_id", (r) => {
    v.ref(r, "property_id", "properties", properties);
    v.ref(r, "listing_id", "propertyListings", listings);
    v.id(r, "landlord_id");
    v.oneOf(r, "landlord_kind", PROPERTY_OWNER_KINDS);
    v.id(r, "tenant_id");
    v.num(r, "rent_ngn", { min: 0 });
    v.oneOf(r, "rent_period", PROPERTY_RENT_PERIODS);
    v.num(r, "deposit_ngn", { min: 0 });
    v.timestamp(r, "start_date");
    v.worldDate(r, "start_world_date");
    v.timestamp(r, "end_date", true);
    v.worldDate(r, "end_world_date", true);
    v.oneOf(r, "status", RENTAL_AGREEMENT_STATUSES);
    v.num(r, "total_paid_ngn", { min: 0 });
    v.timestamp(r, "last_payment_date", true);
    v.worldDate(r, "last_payment_world_date", true);
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
    const listing = recordOf(listings?.[String(r.listing_id)]);
    v.invariant("listing_id", !isIdentifier(r.listing_id) || listing.property_id === undefined ||
      listing.property_id === r.property_id, "must refer to a listing of the same property");
  });

  v.records("rentalPayments", payments, "payment_id", (r) => {
    v.ref(r, "agreement_id", "rentalAgreements", agreements);
    v.ref(r, "property_id", "properties", properties);
    v.id(r, "tenant_id");
    v.id(r, "landlord_id");
    v.num(r, "amount_ngn", { min: 0 });
    v.timestamp(r, "period_start");
    v.timestamp(r, "period_end");
    v.timestamp(r, "payment_date");
    v.worldDate(r, "payment_world_date");
    v.nonEmptyText(r, "idempotency_key");
    const agreement = recordOf(agreements?.[String(r.agreement_id)]);
    v.invariant("property_id", !isIdentifier(r.agreement_id) || agreement.property_id === undefined ||
      agreement.property_id === r.property_id, "must match the property of its rental agreement");
    const start = typeof r.period_start === "string" ? Date.parse(r.period_start) : NaN;
    const end = typeof r.period_end === "string" ? Date.parse(r.period_end) : NaN;
    v.invariant("period_end", !(Number.isFinite(start) && Number.isFinite(end)) || end >= start,
      "must not be earlier than period_start");
  });

  v.records("propertySales", maps.propertySales as unknown as RecordMap, "sale_id", (r) => {
    v.ref(r, "property_id", "properties", properties);
    v.ref(r, "listing_id", "propertyListings", listings);
    v.id(r, "seller_id");
    v.oneOf(r, "seller_kind", PROPERTY_OWNER_KINDS);
    v.id(r, "buyer_id");
    v.num(r, "amount_ngn", { min: 0 });
    v.timestamp(r, "sale_date");
    v.worldDate(r, "sale_world_date");
    v.nonEmptyText(r, "idempotency_key");
    const listing = recordOf(listings?.[String(r.listing_id)]);
    v.invariant("listing_id", !isIdentifier(r.listing_id) || listing.property_id === undefined ||
      listing.property_id === r.property_id, "must refer to a listing of the same property");
  });

  v.records("propertyMaintenance", maps.propertyMaintenance as unknown as RecordMap, "maintenance_id", (r) => {
    v.ref(r, "property_id", "properties", properties);
    v.id(r, "requested_by");
    v.text(r, "description");
    v.num(r, "cost_ngn", { min: 0 });
    v.oneOf(r, "condition_before", PROPERTY_CONDITIONS);
    v.oneOf(r, "condition_after", PROPERTY_CONDITIONS);
    v.oneOf(r, "status", MAINTENANCE_STATUSES);
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "completed_at", true);
  });

  v.records("propertyFurnishings", maps.propertyFurnishings as unknown as RecordMap, "furnishing_id", (r) => {
    v.ref(r, "property_id", "properties", properties);
    v.id(r, "furniture_definition_id");
    v.num(r, "quantity", { min: 0, integer: true });
    v.timestamp(r, "placed_at");
    v.timestamp(r, "updated_at");
  });

  v.records("propertyEvents", maps.propertyEvents as unknown as RecordMap, "event_id", (r) => {
    v.ref(r, "property_id", "properties", properties);
    v.nonEmptyText(r, "type");
    v.worldDate(r, "world_date");
    v.text(r, "summary");
    v.details(r, "details");
    v.timestamp(r, "created_at");
  });

  return v.result();
}

// ─── Government ───────────────────────────────────────────────────────────────

export function validateGovernmentRecords(maps: PersistentGovernmentMaps): RecordValidationResult {
  const v = new RecordValidator("government");
  const orgs = maps.governmentOrganisations as unknown as RecordMap;
  const offices = maps.governmentOffices as unknown as RecordMap;
  const budgets = maps.governmentBudgets as unknown as RecordMap;
  const projects = maps.governmentProjects as unknown as RecordMap;

  v.records("governmentOrganisations", orgs, "organisation_id", (r) => {
    v.oneOf(r, "level", GOVERNMENT_LEVELS);
    v.nonEmptyText(r, "name");
    v.text(r, "description");
    v.id(r, "jurisdiction_id", true);
    v.ref(r, "parent_organisation_id", "governmentOrganisations", orgs, true);
    v.id(r, "ministry_id", true);
    v.oneOf(r, "status", GOVERNMENT_ORGANISATION_STATUSES);
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
    v.noParentCycle(orgs ?? {}, r, "parent_organisation_id", String(r.organisation_id));
  });

  v.records("governmentOffices", offices, "office_id", (r) => {
    v.id(r, "definition_id");
    v.ref(r, "organisation_id", "governmentOrganisations", orgs);
    v.nonEmptyText(r, "label");
    v.bool(r, "unique");
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
  });

  v.records("governmentAppointments", maps.governmentAppointments as unknown as RecordMap, "appointment_id", (r) => {
    v.ref(r, "office_id", "governmentOffices", offices);
    v.id(r, "character_id");
    v.oneOf(r, "status", APPOINTMENT_STATUSES);
    v.timestamp(r, "start_date");
    v.worldDate(r, "start_world_date");
    v.timestamp(r, "end_date", true);
    v.worldDate(r, "end_world_date", true);
    v.text(r, "end_reason", true);
    v.id(r, "appointed_by", true);
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
  });

  v.records("governmentBudgets", budgets, "budget_id", (r) => {
    v.ref(r, "organisation_id", "governmentOrganisations", orgs);
    v.num(r, "fiscal_year", { min: 0, max: 9999, integer: true });
    v.text(r, "fiscal_period_label");
    v.id(r, "category_id");
    v.num(r, "approved_amount_ngn", { min: 0 });
    v.num(r, "allocated_amount_ngn", { min: 0 });
    v.num(r, "spent_amount_ngn", { min: 0 });
    v.oneOf(r, "status", BUDGET_STATUSES);
    v.timestamp(r, "approved_at", true);
    v.worldDate(r, "approved_world_date", true);
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
  });

  v.records("governmentRevenue", maps.governmentRevenue as unknown as RecordMap, "revenue_id", (r) => {
    v.ref(r, "organisation_id", "governmentOrganisations", orgs);
    v.id(r, "category_id");
    v.num(r, "amount_ngn", { min: 0 });
    v.text(r, "description");
    v.text(r, "source_reference", true);
    v.timestamp(r, "received_at");
    v.worldDate(r, "received_world_date");
    v.nonEmptyText(r, "idempotency_key");
  });

  v.records("governmentExpenditure", maps.governmentExpenditure as unknown as RecordMap, "expenditure_id", (r) => {
    v.ref(r, "organisation_id", "governmentOrganisations", orgs);
    v.ref(r, "budget_id", "governmentBudgets", budgets, true);
    v.ref(r, "project_id", "governmentProjects", projects, true);
    v.id(r, "category_id");
    v.num(r, "amount_ngn", { min: 0 });
    v.text(r, "description");
    v.text(r, "recipient_reference", true);
    v.timestamp(r, "spent_at");
    v.worldDate(r, "spent_world_date");
    v.nonEmptyText(r, "idempotency_key");
  });

  v.records("governmentProjects", projects, "project_id", (r) => {
    v.ref(r, "organisation_id", "governmentOrganisations", orgs);
    v.ref(r, "budget_id", "governmentBudgets", budgets, true);
    v.id(r, "category_id");
    v.nonEmptyText(r, "name");
    v.text(r, "description");
    v.id(r, "location_id");
    v.num(r, "estimated_cost_ngn", { min: 0 });
    v.num(r, "approved_funding_ngn", { min: 0 });
    v.num(r, "actual_spent_ngn", { min: 0 });
    v.oneOf(r, "status", PROJECT_STATUSES);
    v.num(r, "progress_percent", { min: 0, max: 100 });
    v.timestamp(r, "start_date", true);
    v.worldDate(r, "start_world_date", true);
    v.timestamp(r, "planned_completion", true);
    v.timestamp(r, "actual_completion", true);
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
  });

  v.records("governmentAnnouncements", maps.governmentAnnouncements as unknown as RecordMap, "announcement_id", (r) => {
    v.ref(r, "organisation_id", "governmentOrganisations", orgs);
    v.ref(r, "project_id", "governmentProjects", projects, true);
    v.nonEmptyText(r, "title");
    v.text(r, "body");
    v.oneOf(r, "scope_level", GOVERNMENT_LEVELS);
    v.id(r, "scope_jurisdiction_id", true);
    v.oneOf(r, "status", ANNOUNCEMENT_STATUSES);
    v.timestamp(r, "published_at", true);
    v.worldDate(r, "published_world_date", true);
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
  });

  v.records("governmentEvents", maps.governmentEvents as unknown as RecordMap, "event_id", (r) => {
    v.ref(r, "organisation_id", "governmentOrganisations", orgs);
    v.nonEmptyText(r, "type");
    v.worldDate(r, "world_date");
    v.text(r, "summary");
    v.details(r, "details");
    v.timestamp(r, "created_at");
  });

  return v.result();
}

// ─── Elections ────────────────────────────────────────────────────────────────

export function validateElectionRecords(maps: PersistentElectionMaps): RecordValidationResult {
  const v = new RecordValidator("election");
  const parties = maps.politicalParties as unknown as RecordMap;
  const elections = maps.elections as unknown as RecordMap;
  const candidates = maps.candidates as unknown as RecordMap;
  const campaigns = maps.campaigns as unknown as RecordMap;

  v.records("politicalParties", parties, "party_id", (r) => {
    v.nonEmptyText(r, "name");
    v.nonEmptyText(r, "abbreviation");
    v.text(r, "description");
    v.oneOf(r, "status", PARTY_STATUSES);
    v.id(r, "founded_by");
    v.timestamp(r, "founding_date");
    v.worldDate(r, "founding_world_date");
    v.stringArray(r, "policy_positions");
    v.invariant("leadership", isRecord(r.leadership) && Object.values(r.leadership).every((x) => typeof x === "string"),
      "must be an object of text values");
    v.timestamp(r, "updated_at");
  });

  v.records("partyMemberships", maps.partyMemberships as unknown as RecordMap, "membership_id", (r) => {
    v.ref(r, "party_id", "politicalParties", parties);
    v.id(r, "character_id");
    v.oneOf(r, "status", MEMBERSHIP_STATUSES);
    v.text(r, "role", true);
    v.timestamp(r, "joined_at");
    v.worldDate(r, "joined_world_date");
    v.timestamp(r, "ended_at", true);
    v.worldDate(r, "ended_world_date", true);
    v.text(r, "end_reason", true);
    v.timestamp(r, "updated_at");
  });

  v.records("politicalProfiles", maps.politicalProfiles as unknown as RecordMap, "profile_id", (r) => {
    v.id(r, "character_id");
    v.ref(r, "party_id", "politicalParties", parties, true);
    v.text(r, "public_statement");
    v.nestedArray(r, "public_service_history", (item) => {
      v.invariant("public_service_history", typeof item.office_label === "string" && typeof item.organisation_name === "string" &&
        Number.isFinite(Date.parse(String(item.start_date))) &&
        (item.end_date === null || item.end_date === undefined || Number.isFinite(Date.parse(String(item.end_date)))),
      "entries must have office, organisation, and valid start and end dates");
    });
    v.num(r, "reputation_score");
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
  });

  v.records("elections", elections, "election_id", (r) => {
    v.oneOf(r, "election_type", ELECTION_TYPES);
    v.id(r, "office_definition_id");
    v.oneOf(r, "jurisdiction_level", GOVERNMENT_LEVELS);
    v.id(r, "jurisdiction_id", true);
    v.id(r, "constituency_id", true);
    v.oneOf(r, "phase", ELECTION_PHASES);
    for (const field of ["registration_open_date", "registration_close_date", "campaign_start_date", "campaign_end_date",
      "voting_open_date", "voting_close_date"]) {
      v.timestamp(r, field);
    }
    v.id(r, "created_by");
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
    v.oneOf(r, "winning_rule", WINNING_RULES);
    v.nested(r, "results", (res) => {
      v.invariant("results", res.election_id === r.election_id, "must belong to this election");
      v.oneOf(res, "election_type", ELECTION_TYPES);
      v.num(res, "total_valid_votes", { min: 0, integer: true });
      v.num(res, "total_invalid_votes", { min: 0, integer: true });
      v.num(res, "total_registered_voters", { min: 0, integer: true });
      v.oneOf(res, "status", RESULT_STATUSES);
      v.nestedArray(res, "candidate_results", (item) => {
        v.invariant("candidate_results", isIdentifier(item.candidate_id) && isIdentifier(item.character_id) &&
          isFiniteNumber(item.votes) && item.votes >= 0, "entries need candidate, character, and a non-negative vote count");
      });
    });
    // Schedule order, as enforced by createElection: open < close <= campaign start < campaign end <= voting open < voting close.
    const times = ["registration_open_date", "registration_close_date", "campaign_start_date", "campaign_end_date",
      "voting_open_date", "voting_close_date"].map((f) => (typeof r[f] === "string" ? Date.parse(r[f] as string) : NaN));
    if (times.every(Number.isFinite)) {
      const [regOpen, regClose, campStart, campEnd, voteOpen, voteClose] = times as [number, number, number, number, number, number];
      v.invariant("registration_open_date", regOpen < regClose && regClose <= campStart && campStart < campEnd &&
        campEnd <= voteOpen && voteOpen < voteClose, "election schedule dates are not in the required order");
    }
  });

  v.records("candidates", candidates, "candidate_id", (r) => {
    v.ref(r, "election_id", "elections", elections);
    v.id(r, "character_id");
    v.ref(r, "party_id", "politicalParties", parties, true);
    v.oneOf(r, "status", CANDIDATE_STATUSES);
    v.nested(r, "manifesto", (m) => {
      v.invariant("manifesto", typeof m.title === "string" && typeof m.summary === "string", "must have a title and summary");
      v.nestedArray(m, "policies", (item) => {
        v.invariant("policies", typeof item.category === "string" && typeof item.statement === "string",
          "entries must have a category and statement");
      });
    });
    v.timestamp(r, "registered_at");
    v.worldDate(r, "registered_world_date");
    v.timestamp(r, "approved_at", true);
    v.worldDate(r, "approved_world_date", true);
    v.text(r, "rejection_reason", true);
    v.timestamp(r, "updated_at");
  });

  v.records("campaigns", campaigns, "campaign_id", (r) => {
    v.ref(r, "candidate_id", "candidates", candidates);
    v.ref(r, "election_id", "elections", elections);
    v.ref(r, "party_id", "politicalParties", parties, true);
    v.text(r, "title");
    v.text(r, "description");
    v.stringArray(r, "themes");
    v.oneOf(r, "status", CAMPAIGN_STATUSES);
    v.timestamp(r, "start_date");
    v.worldDate(r, "start_world_date");
    v.timestamp(r, "end_date", true);
    v.worldDate(r, "end_world_date", true);
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
    const candidate = recordOf(candidates?.[String(r.candidate_id)]);
    v.invariant("election_id", !isIdentifier(r.candidate_id) || candidate.election_id === undefined ||
      candidate.election_id === r.election_id, "must match the election of its candidate");
  });

  v.records("campaignEvents", maps.campaignEvents as unknown as RecordMap, "event_id", (r) => {
    v.ref(r, "campaign_id", "campaigns", campaigns);
    v.ref(r, "election_id", "elections", elections);
    v.nonEmptyText(r, "event_type");
    v.text(r, "title");
    v.text(r, "description");
    v.id(r, "location_id", true);
    v.timestamp(r, "scheduled_date");
    v.worldDate(r, "scheduled_world_date");
    v.oneOf(r, "status", CAMPAIGN_EVENT_STATUSES);
    v.timestamp(r, "created_at");
    const campaign = recordOf(campaigns?.[String(r.campaign_id)]);
    v.invariant("election_id", !isIdentifier(r.campaign_id) || campaign.election_id === undefined ||
      campaign.election_id === r.election_id, "must match the election of its campaign");
  });

  v.records("campaignFinances", maps.campaignFinances as unknown as RecordMap, "transaction_id", (r) => {
    v.ref(r, "campaign_id", "campaigns", campaigns);
    v.ref(r, "election_id", "elections", elections);
    v.oneOf(r, "type", CAMPAIGN_FINANCE_TYPES);
    v.num(r, "amount_ngn", { min: 0 });
    v.text(r, "description");
    v.text(r, "source_or_recipient");
    v.nonEmptyText(r, "idempotency_key");
    v.timestamp(r, "recorded_at");
    v.worldDate(r, "recorded_world_date");
    const campaign = recordOf(campaigns?.[String(r.campaign_id)]);
    v.invariant("election_id", !isIdentifier(r.campaign_id) || campaign.election_id === undefined ||
      campaign.election_id === r.election_id, "must match the election of its campaign");
  });

  v.records("debates", maps.debates as unknown as RecordMap, "debate_id", (r) => {
    v.ref(r, "election_id", "elections", elections);
    v.nonEmptyText(r, "debate_type");
    v.text(r, "title");
    v.text(r, "topic");
    v.refArray(r, "participant_candidate_ids", "candidates", candidates);
    v.text(r, "moderator", true);
    v.timestamp(r, "scheduled_date");
    v.worldDate(r, "scheduled_world_date");
    v.oneOf(r, "status", DEBATE_STATUSES);
    v.nestedArray(r, "statements", (item) => {
      v.invariant("statements", isIdentifier(item.candidate_id) && hasKey(candidates ?? {}, String(item.candidate_id)) &&
        typeof item.statement === "string" && Number.isFinite(Date.parse(String(item.submitted_at))),
      "entries must reference an existing candidate and have text and a valid time");
    });
    v.timestamp(r, "created_at");
    if (Array.isArray(r.participant_candidate_ids)) {
      for (const candidateId of r.participant_candidate_ids) {
        const candidate = recordOf(candidates?.[String(candidateId)]);
        if (candidate.election_id !== undefined && candidate.election_id !== r.election_id) {
          v.invariant("participant_candidate_ids", false, "must contain only candidates of this election");
          break;
        }
      }
    }
  });

  v.records("ballots", maps.ballots as unknown as RecordMap, "ballot_id", (r) => {
    v.ref(r, "election_id", "elections", elections);
    v.id(r, "voter_character_id");
    v.ref(r, "candidate_id", "candidates", candidates);
    v.timestamp(r, "cast_at");
    v.worldDate(r, "cast_world_date");
    v.bool(r, "is_valid");
    v.text(r, "rejection_reason", true);
    const candidate = recordOf(candidates?.[String(r.candidate_id)]);
    v.invariant("candidate_id", !isIdentifier(r.candidate_id) || candidate.election_id === undefined ||
      candidate.election_id === r.election_id, "must be a candidate of the same election");
  });

  v.records("voterParticipation", maps.voterParticipation as unknown as RecordMap, "participation_id", (r) => {
    v.ref(r, "election_id", "elections", elections);
    v.id(r, "voter_character_id");
    v.bool(r, "has_voted");
    v.timestamp(r, "voted_at", true);
    v.worldDate(r, "voted_world_date", true);
    v.invariant("voted_at", r.has_voted !== true || typeof r.voted_at === "string",
      "must be set when has_voted is true");
  });

  v.records("electionDisputes", maps.electionDisputes as unknown as RecordMap, "dispute_id", (r) => {
    v.ref(r, "election_id", "elections", elections);
    v.id(r, "complainant_character_id");
    v.nonEmptyText(r, "category");
    v.text(r, "description");
    v.stringArray(r, "evidence_references");
    v.oneOf(r, "status", DISPUTE_STATUSES);
    v.timestamp(r, "submitted_at");
    v.worldDate(r, "submitted_world_date");
    v.id(r, "reviewed_by", true);
    v.timestamp(r, "reviewed_at", true);
    v.text(r, "resolution", true);
    v.timestamp(r, "resolved_at", true);
    v.worldDate(r, "resolved_world_date", true);
    v.timestamp(r, "updated_at");
  });

  v.records("electionAudits", maps.electionAudits as unknown as RecordMap, "audit_id", (r) => {
    v.ref(r, "election_id", "elections", elections);
    v.nonEmptyText(r, "category");
    v.id(r, "actor_character_id", true);
    v.text(r, "summary");
    v.details(r, "details");
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
  });

  return v.result();
}

// ─── Justice ──────────────────────────────────────────────────────────────────

export function validateJusticeRecords(maps: PersistentJusticeMaps): RecordValidationResult {
  const v = new RecordValidator("justice");
  const catalog = loadJusticeCatalog();
  const caseTypeByCategory = new Map<string, string>(catalog.case_categories.map((c) => [c.id, c.type]));
  const laws = maps.laws as unknown as RecordMap;
  const provisions = maps.lawProvisions as unknown as RecordMap;
  const proposals = maps.legislativeProposals as unknown as RecordMap;
  const courts = maps.courts as unknown as RecordMap;
  const professionals = maps.legalProfessionals as unknown as RecordMap;
  const cases = maps.cases as unknown as RecordMap;
  const evidence = maps.evidence as unknown as RecordMap;
  const judgments = maps.judgments as unknown as RecordMap;
  const sentences = maps.sentences as unknown as RecordMap;
  const appeals = maps.appeals as unknown as RecordMap;

  v.records("laws", laws, "law_id", (r) => {
    v.nonEmptyText(r, "title");
    v.nonEmptyText(r, "short_reference");
    v.text(r, "description");
    v.oneOf(r, "category", LAW_CATEGORIES);
    v.nonEmptyText(r, "jurisdiction");
    v.id(r, "applicable_state_id", true);
    v.text(r, "enacted_by", true);
    v.oneOf(r, "status", LAW_STATUSES);
    v.num(r, "version", { min: 1, integer: true });
    v.timestamp(r, "enactment_date");
    v.timestamp(r, "effective_date");
    v.timestamp(r, "expiration_date", true);
    v.ref(r, "parent_law_id", "laws", laws, true);
    v.refArray(r, "related_law_ids", "laws", laws);
    v.text(r, "public_explanation");
    v.text(r, "source_reference", true);
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
    v.noParentCycle(laws ?? {}, r, "parent_law_id", String(r.law_id));
  });

  v.records("lawProvisions", provisions, "provision_id", (r) => {
    v.ref(r, "law_id", "laws", laws);
    v.nonEmptyText(r, "section");
    v.text(r, "title");
    v.text(r, "description");
    v.timestamp(r, "effective_from");
    v.timestamp(r, "effective_until", true);
    v.oneOf(r, "penalty_type", SENTENCE_TYPES, true);
    v.num(r, "penalty_min_amount_ngn", { min: 0, nullable: true });
    v.num(r, "penalty_max_amount_ngn", { min: 0, nullable: true });
    v.oneOf(r, "status", PROVISION_STATUSES);
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
    const min = r.penalty_min_amount_ngn;
    const max = r.penalty_max_amount_ngn;
    v.invariant("penalty_min_amount_ngn", typeof min !== "number" || typeof max !== "number" || min <= max,
      "must not exceed penalty_max_amount_ngn");
  });

  v.records("legislativeProposals", proposals, "proposal_id", (r) => {
    v.nonEmptyText(r, "title");
    v.text(r, "description");
    v.text(r, "purpose");
    v.ref(r, "proposed_law_id", "laws", laws, true);
    v.id(r, "sponsor_character_id", true);
    v.id(r, "sponsor_office_id", true);
    v.nonEmptyText(r, "jurisdiction");
    v.id(r, "applicable_state_id", true);
    v.oneOf(r, "status", PROPOSAL_STATUSES);
    v.nestedArray(r, "provisions", (item) => {
      v.invariant("provisions", typeof item.section === "string" && typeof item.title === "string" &&
        typeof item.description === "string", "entries must have section, title, and description text");
    });
    v.text(r, "supporting_explanation");
    v.timestamp(r, "submission_date", true);
    v.worldDate(r, "submission_world_date", true);
    v.timestamp(r, "decision_date", true);
    v.worldDate(r, "decision_world_date", true);
    v.text(r, "decision_reason", true);
    v.nestedArray(r, "revision_history", (item) => {
      v.invariant("revision_history", Number.isFinite(Date.parse(String(item.date))) && typeof item.summary === "string" &&
        isIdentifier(item.by_character_id), "entries need a valid date, summary, and character identifier");
    });
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
  });

  v.records("courts", courts, "court_id", (r) => {
    v.nonEmptyText(r, "name");
    v.oneOf(r, "level", COURT_LEVELS);
    v.nonEmptyText(r, "jurisdiction");
    v.id(r, "applicable_jurisdiction_id", true);
    v.ref(r, "superior_court_id", "courts", courts, true);
    v.stringArray(r, "permitted_categories");
    v.oneOf(r, "status", COURT_STATUSES);
    v.idArray(r, "assigned_judge_ids");
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
    v.noParentCycle(courts ?? {}, r, "superior_court_id", String(r.court_id));
  });

  v.records("legalProfessionals", professionals, "professional_id", (r) => {
    v.id(r, "character_id");
    v.oneOf(r, "role", PROFESSIONAL_ROLES);
    v.ref(r, "court_id", "courts", courts, true);
    v.oneOf(r, "status", PROFESSIONAL_STATUSES);
    v.stringArray(r, "qualifications");
    v.timestamp(r, "appointed_at");
    v.worldDate(r, "appointed_world_date");
    v.id(r, "appointed_by", true);
    v.timestamp(r, "updated_at");
  });

  v.records("legalRepresentations", maps.legalRepresentations as unknown as RecordMap, "representation_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.id(r, "lawyer_character_id");
    v.ref(r, "professional_id", "legalProfessionals", professionals);
    v.id(r, "represented_party_character_id");
    v.oneOf(r, "role", REPRESENTATION_ROLES);
    v.timestamp(r, "started_at");
    v.worldDate(r, "started_world_date");
    v.timestamp(r, "ended_at", true);
    v.worldDate(r, "ended_world_date", true);
    v.text(r, "end_reason", true);
    v.timestamp(r, "updated_at");
  });

  v.records("cases", cases, "case_id", (r) => {
    v.nonEmptyText(r, "case_number");
    v.oneOf(r, "category", CASE_CATEGORIES);
    v.oneOf(r, "case_type", CASE_TYPES);
    v.ref(r, "court_id", "courts", courts);
    v.nonEmptyText(r, "jurisdiction");
    v.id(r, "applicable_state_id", true);
    v.id(r, "filing_party_character_id");
    v.id(r, "respondent_character_id", true);
    v.idArray(r, "additional_party_character_ids");
    v.id(r, "assigned_judge_character_id", true);
    v.text(r, "summary");
    v.text(r, "description");
    v.timestamp(r, "relevant_event_date", true);
    v.refArray(r, "relevant_law_ids", "laws", laws);
    v.refArray(r, "relevant_provision_ids", "lawProvisions", provisions);
    v.timestamp(r, "filing_date");
    v.worldDate(r, "filing_world_date");
    v.oneOf(r, "status", CASE_STATUSES);
    v.oneOf(r, "priority", CASE_PRIORITIES);
    v.ref(r, "judgment_id", "judgments", judgments, true);
    v.ref(r, "appeal_id", "appeals", appeals, true);
    v.timestamp(r, "closure_date", true);
    v.worldDate(r, "closure_world_date", true);
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
    const expectedType = typeof r.category === "string" ? caseTypeByCategory.get(r.category) : undefined;
    v.invariant("case_type", expectedType === undefined || r.case_type === expectedType,
      "must match the case type of its category in the justice catalog");
  });

  v.records("caseParticipants", maps.caseParticipants as unknown as RecordMap, "participant_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.id(r, "character_id");
    v.oneOf(r, "role", PARTICIPANT_ROLES);
    v.timestamp(r, "joined_at");
    v.worldDate(r, "joined_world_date");
    v.oneOf(r, "status", PARTICIPANT_STATUSES);
    v.timestamp(r, "updated_at");
  });

  v.records("evidence", evidence, "evidence_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.nonEmptyText(r, "category");
    v.id(r, "submitted_by_character_id");
    v.text(r, "description");
    v.text(r, "source_reference", true);
    v.text(r, "transaction_reference", true);
    v.timestamp(r, "submitted_at");
    v.worldDate(r, "submitted_world_date");
    v.oneOf(r, "verification_status", EVIDENCE_VERIFICATION);
    v.oneOf(r, "admissibility_status", EVIDENCE_ADMISSIBILITY);
    v.id(r, "reviewed_by_character_id", true);
    v.timestamp(r, "reviewed_at", true);
    v.text(r, "review_reason", true);
    v.num(r, "version", { min: 1, integer: true });
    v.ref(r, "supersedes_evidence_id", "evidence", evidence, true);
    v.timestamp(r, "updated_at");
  });

  v.records("witnesses", maps.witnesses as unknown as RecordMap, "witness_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.id(r, "character_id");
    v.text(r, "testimony");
    v.id(r, "submitted_by_character_id");
    v.timestamp(r, "submitted_at");
    v.worldDate(r, "submitted_world_date");
    v.oneOf(r, "credibility_status", WITNESS_CREDIBILITY);
    v.timestamp(r, "updated_at");
  });

  v.records("hearings", maps.hearings as unknown as RecordMap, "hearing_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.ref(r, "court_id", "courts", courts);
    v.id(r, "judge_character_id");
    v.oneOf(r, "hearing_type", HEARING_TYPES);
    v.timestamp(r, "scheduled_date");
    v.worldDate(r, "scheduled_world_date");
    v.timestamp(r, "actual_start_date", true);
    v.timestamp(r, "actual_end_date", true);
    v.oneOf(r, "status", HEARING_STATUSES);
    v.text(r, "notes");
    v.stringArray(r, "evidence_references");
    v.idArray(r, "attendance_character_ids");
    v.stringArray(r, "procedural_decisions");
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
  });

  v.records("judgments", judgments, "judgment_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.ref(r, "court_id", "courts", courts);
    v.id(r, "judge_character_id");
    v.oneOf(r, "outcome", JUDGMENT_OUTCOMES);
    v.text(r, "findings");
    v.text(r, "reasoning");
    v.refArray(r, "relevant_law_ids", "laws", laws);
    v.refArray(r, "relevant_provision_ids", "lawProvisions", provisions);
    v.refArray(r, "evidence_considered_ids", "evidence", evidence);
    v.nestedArray(r, "remedies", (item) => {
      v.invariant("remedies", typeof item.type === "string" && typeof item.description === "string" &&
        (item.amount_ngn === undefined || (isFiniteNumber(item.amount_ngn) && item.amount_ngn >= 0)) &&
        (item.duration_days === undefined || (Number.isInteger(item.duration_days) && (item.duration_days as number) >= 0)),
      "entries need type and description text, and any amount or duration must be non-negative");
    });
    v.refArray(r, "sentence_ids", "sentences", sentences);
    v.bool(r, "appeal_eligible");
    v.timestamp(r, "appeal_deadline", true);
    v.timestamp(r, "issued_at");
    v.worldDate(r, "issued_world_date");
    v.ref(r, "superseded_by_judgment_id", "judgments", judgments, true);
    v.oneOf(r, "status", JUDGMENT_STATUSES);
    v.timestamp(r, "updated_at");
  });

  v.records("sentences", sentences, "sentence_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.ref(r, "judgment_id", "judgments", judgments);
    v.id(r, "convicted_character_id");
    v.oneOf(r, "type", SENTENCE_TYPES);
    v.text(r, "description");
    v.num(r, "amount_ngn", { min: 0, nullable: true });
    v.num(r, "duration_days", { min: 0, integer: true, nullable: true });
    v.timestamp(r, "start_date");
    v.worldDate(r, "start_world_date");
    v.timestamp(r, "end_date", true);
    v.worldDate(r, "end_world_date", true);
    v.oneOf(r, "status", SENTENCE_STATUSES);
    v.timestamp(r, "issued_at");
    v.worldDate(r, "issued_world_date");
    v.timestamp(r, "updated_at");
  });

  v.records("fines", maps.fines as unknown as RecordMap, "fine_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.ref(r, "judgment_id", "judgments", judgments);
    v.ref(r, "sentence_id", "sentences", sentences);
    v.id(r, "responsible_character_id");
    v.num(r, "amount_ngn", { min: 0 });
    v.num(r, "amount_paid_ngn", { min: 0 });
    v.num(r, "amount_outstanding_ngn", { min: 0 });
    v.timestamp(r, "due_date");
    v.worldDate(r, "due_world_date");
    v.oneOf(r, "status", FINE_STATUSES);
    v.stringArray(r, "payment_transaction_ids");
    v.nonEmptyText(r, "idempotency_key");
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
    v.timestamp(r, "updated_at");
    if (isFiniteNumber(r.amount_ngn) && isFiniteNumber(r.amount_paid_ngn) && isFiniteNumber(r.amount_outstanding_ngn)) {
      v.invariant("amount_outstanding_ngn", Math.abs(r.amount_outstanding_ngn - (r.amount_ngn - r.amount_paid_ngn)) < 1e-6,
        "must equal amount_ngn minus amount_paid_ngn");
    }
  });

  v.records("settlements", maps.settlements as unknown as RecordMap, "settlement_id", (r) => {
    v.ref(r, "case_id", "cases", cases);
    v.idArray(r, "parties_character_ids");
    v.text(r, "terms");
    v.timestamp(r, "effective_date");
    v.worldDate(r, "effective_world_date");
    v.num(r, "payment_obligation_ngn", { min: 0, nullable: true });
    v.id(r, "payment_recipient_character_id", true);
    v.oneOf(r, "status", SETTLEMENT_STATUSES);
    v.id(r, "approved_by_character_id", true);
    v.timestamp(r, "approved_at", true);
    v.timestamp(r, "completed_at", true);
    v.timestamp(r, "created_at");
    v.timestamp(r, "updated_at");
  });

  v.records("appeals", appeals, "appeal_id", (r) => {
    v.ref(r, "original_case_id", "cases", cases);
    v.ref(r, "original_judgment_id", "judgments", judgments);
    v.id(r, "appellant_character_id");
    v.text(r, "grounds");
    v.stringArray(r, "supporting_references");
    v.timestamp(r, "filing_date");
    v.worldDate(r, "filing_world_date");
    v.ref(r, "appellate_court_id", "courts", courts);
    v.id(r, "assigned_judge_character_id", true);
    v.oneOf(r, "status", APPEAL_STATUSES);
    v.oneOf(r, "outcome", APPEAL_OUTCOMES, true);
    v.ref(r, "outcome_judgment_id", "judgments", judgments, true);
    v.text(r, "outcome_reasoning", true);
    v.timestamp(r, "decided_at", true);
    v.worldDate(r, "decided_world_date", true);
    v.timestamp(r, "updated_at");
  });

  v.records("legalAudits", maps.legalAudits as unknown as RecordMap, "audit_id", (r) => {
    v.nonEmptyText(r, "category");
    v.ref(r, "law_id", "laws", laws, true);
    v.ref(r, "proposal_id", "legislativeProposals", proposals, true);
    v.ref(r, "case_id", "cases", cases, true);
    v.ref(r, "judgment_id", "judgments", judgments, true);
    v.ref(r, "appeal_id", "appeals", appeals, true);
    v.id(r, "actor_character_id", true);
    v.text(r, "summary");
    v.details(r, "details");
    v.timestamp(r, "created_at");
    v.worldDate(r, "created_world_date");
  });

  return v.result();
}

// ─── Reporting ────────────────────────────────────────────────────────────────

/**
 * Throws a diagnostic error for the first invalid record. The message names the category, map,
 * record, field, and invariant. It never includes field values.
 */
export function assertRecordsValid(result: RecordValidationResult): void {
  const [first] = result.issues;
  if (!first) return;
  const more = result.issues.length > 1 ? ` (${result.issues.length} invalid fields in total)` : "";
  throw new Error(
    `World data contains an invalid ${first.category} record: ${first.map}[${first.recordId}] field "${first.field}" ${first.invariant}.${more}`,
  );
}
