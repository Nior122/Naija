import { createHash, randomUUID } from "node:crypto";
import { loadGovernmentCatalog } from "./catalog.js";
import type {

  AppointmentRecord,
  AppointmentSnapshot,
  BudgetRecord,

  FederalGovernmentSnapshot,
  GovernmentAnnouncementRecord,
  GovernmentAnnouncementSnapshot,
  GovernmentCatalog,
  GovernmentEventRecord,
  GovernmentExpenditureRecord,
  GovernmentLevel,
  GovernmentOfficeRecord,
  GovernmentOrganisationRecord,
  GovernmentOrganisationSnapshot,
  GovernmentProjectRecord,
  GovernmentProjectSnapshot,
  GovernmentRevenueRecord,
  LocalGovernmentSnapshot,
  ProjectStatus,
  StateGovernmentSnapshot,
} from "./types.js";
import type { PersistentPlayer, PersistentWorldState } from "../multiplayer/types.js";
import type { CalendarDate } from "../life/types.js";
import { compareDates } from "../life/calendar.js";
import { authorizeOfficePermission, isOfficeSuspended } from "./authority.js";
import { loadEconomyCatalog } from "../economy/catalog.js";
import { hasActiveFamilyTie, planGovernmentPaymentCredit } from "../economy/service.js";
import { officePlacement } from "./hierarchy.js";
import type { OfficeStatus } from "./types.js";

function cloneDate(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: date.day };
}

function characterForId(state: PersistentWorldState, characterId: string): PersistentPlayer | undefined {
  return Object.values(state.players).find((p) => p.character.character_id === characterId);
}

function appendGovernmentEvent(
  state: PersistentWorldState,
  organisationId: string,
  type: string,
  summary: string,
  date: CalendarDate,
  now: number,
  details: Record<string, string | number | boolean | null>,
): GovernmentEventRecord {
  const event: GovernmentEventRecord = {
    event_id: `gov-event-${randomUUID()}`,
    organisation_id: organisationId,
    type,
    world_date: cloneDate(date),
    summary,
    details,
    created_at: new Date(now).toISOString(),
  };
  state.governmentEvents[event.event_id] = event;
  return event;
}

function activeAppointmentForOffice(state: PersistentWorldState, officeId: string): AppointmentRecord | undefined {
  return Object.values(state.governmentAppointments).find(
    (a) => a.office_id === officeId && a.status === "active",
  );
}

function activeAppointmentsForCharacter(state: PersistentWorldState, characterId: string): AppointmentRecord[] {
  return Object.values(state.governmentAppointments).filter(
    (a) => a.character_id === characterId && a.status === "active",
  );
}

function organisationForJurisdiction(state: PersistentWorldState, level: GovernmentLevel, jurisdictionId: string | null): GovernmentOrganisationRecord | undefined {
  return Object.values(state.governmentOrganisations).find(
    (o) => o.level === level && o.jurisdiction_id === jurisdictionId && o.status === "active",
  );
}


function budgetSpent(state: PersistentWorldState, budgetId: string): number {
  return Object.values(state.governmentExpenditure)
    .filter((e) => e.budget_id === budgetId)
    .reduce((sum, e) => sum + e.amount_ngn, 0);
}

export function initializeGovernmentWorldState(state: PersistentWorldState): void {
  if (!state.governmentOrganisations) state.governmentOrganisations = {};
  if (!state.governmentOffices) state.governmentOffices = {};
  if (!state.governmentAppointments) state.governmentAppointments = {};
  if (!state.governmentBudgets) state.governmentBudgets = {};
  if (!state.governmentRevenue) state.governmentRevenue = {};
  if (!state.governmentExpenditure) state.governmentExpenditure = {};
  if (!state.governmentProjects) state.governmentProjects = {};
  if (!state.governmentAnnouncements) state.governmentAnnouncements = {};
  if (!state.governmentEvents) state.governmentEvents = {};
}

export function seedGovernmentWorld(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): void {
  if (Object.keys(state.governmentOrganisations).length > 0) return;
  const timestamp = new Date(now).toISOString();

  // Create federal government
  const federalId = "gov:federal";
  state.governmentOrganisations[federalId] = {
    organisation_id: federalId,
    level: "federal",
    institution: "executive",
    name: "Federal Government of Nigeria",
    description: "The national government of the Federal Republic of Nigeria.",
    jurisdiction_id: null,
    parent_organisation_id: null,
    ministry_id: null,
    status: "active",
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };

  // Create federal ministries
  for (const ministry of catalog.federal_ministries) {
    const ministryId = `gov:${ministry.id}`;
    state.governmentOrganisations[ministryId] = {
      organisation_id: ministryId,
      level: "federal",
      institution: "executive",
      name: ministry.label,
      description: ministry.description,
      jurisdiction_id: null,
      parent_organisation_id: federalId,
      ministry_id: ministry.id,
      status: "active",
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
    };
  }

  // Independent institutions (the electoral commission). They sit under no ministry and no executive office.
  for (const institution of catalog.independent_institutions) {
    createIndependentInstitution(state, institution, date, now);
  }

  // Office seats are created only where the catalogue names a reliable organisation (seed_organisation). Other
  // definitions have no organisation to sit in yet, so no record is created for them (see docs/STAGE_31_TREASURY_AUTHORITY.md).
  for (const officeDef of catalog.seed_offices) {
    if (officeDef.seed_organisation === null) continue;
    if (officeDef.seed_organisation === "per_ministry") {
      for (const ministry of catalog.federal_ministries) {
        createOfficeSeat(state, officeDef, `gov:${ministry.id}`, `:${ministry.id}`, date, now);
      }
    } else {
      createOfficeSeat(state, officeDef, officeDef.seed_organisation, "", date, now);
    }
  }

  // Create federal budget
  const budgetId = `bud:federal:${date.year}`;
  state.governmentBudgets[budgetId] = {
    budget_id: budgetId,
    organisation_id: federalId,
    fiscal_year: date.year,
    fiscal_period_label: `${date.year}`,
    category_id: "bud:administration",
    approved_amount_ngn: catalog.rules.federal_default_annual_budget_ngn,
    allocated_amount_ngn: catalog.rules.federal_default_annual_budget_ngn,
    spent_amount_ngn: 0,
    status: "active",
    approved_at: timestamp,
    approved_world_date: cloneDate(date),
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };

  appendGovernmentEvent(state, federalId, "government_created",
    "Federal Government of Nigeria established.", date, now,
    { ministry_count: catalog.federal_ministries.length });

  reconcileGovernmentStructure(state, date, now, catalog);
}

function createIndependentInstitution(
  state: PersistentWorldState,
  institution: GovernmentCatalog["independent_institutions"][number],
  date: CalendarDate,
  now: number,
): void {
  if (state.governmentOrganisations[institution.organisation_id]) return;
  const timestamp = new Date(now).toISOString();
  state.governmentOrganisations[institution.organisation_id] = {
    organisation_id: institution.organisation_id,
    level: institution.level,
    institution: institution.institution,
    name: institution.label,
    description: institution.description,
    jurisdiction_id: null,
    parent_organisation_id: null,
    ministry_id: null,
    status: "active",
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
}

/** Creates one vacant office seat, unless the seat already exists. Returns true when a record was created. */
function createOfficeSeat(
  state: PersistentWorldState,
  definition: GovernmentCatalog["seed_offices"][number],
  organisationId: string,
  idSuffix: string,
  _date: CalendarDate,
  now: number,
): boolean {
  const officeId = `office:${definition.id.slice("office:".length)}${idSuffix}`;
  if (state.governmentOffices[officeId]) return false;
  const timestamp = new Date(now).toISOString();
  state.governmentOffices[officeId] = {
    office_id: officeId,
    definition_id: definition.id,
    organisation_id: organisationId,
    label: definition.label,
    unique: definition.unique,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return true;
}

/**
 * Brings a world up to the current structure without changing any existing record (Stage 31). Idempotent. It adds
 * only what is missing: a seat for each reliably placed office definition whose organisation exists, an independent
 * institution's organisation, a treasury account for each organisation, and a draft budget for each federal ministry
 * for the current fiscal year. Existing records, including legacy placements, are never moved or rewritten.
 * Returns the number of records created.
 */
export function reconcileGovernmentStructure(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): number {
  initializeGovernmentWorldState(state);
  if (Object.keys(state.governmentOrganisations).length === 0) {
    seedGovernmentWorld(state, date, now, catalog);
    return 0;
  }
  let created = 0;
  for (const institution of catalog.independent_institutions) {
    if (!state.governmentOrganisations[institution.organisation_id]) {
      createIndependentInstitution(state, institution, date, now);
      created += 1;
    }
  }
  for (const officeDef of catalog.seed_offices) {
    if (officeDef.seed_organisation === null) continue;
    if (officeDef.seed_organisation === "per_ministry") {
      for (const ministry of catalog.federal_ministries) {
        if (state.governmentOrganisations[`gov:${ministry.id}`] &&
          createOfficeSeat(state, officeDef, `gov:${ministry.id}`, `:${ministry.id}`, date, now)) created += 1;
      }
    } else if (state.governmentOrganisations[officeDef.seed_organisation] &&
      createOfficeSeat(state, officeDef, officeDef.seed_organisation, "", date, now)) {
      created += 1;
    }
  }
  for (const organisation of Object.values(state.governmentOrganisations)) {
    if (!organisation.treasury_account) {
      ensureTreasuryAccount(organisation, date, now);
      created += 1;
    }
  }
  for (const ministry of catalog.federal_ministries) {
    const organisationId = `gov:${ministry.id}`;
    const budgetId = `bud:${ministry.id}:${date.year}`;
    if (!state.governmentOrganisations[organisationId] || state.governmentBudgets[budgetId]) continue;
    const timestamp = new Date(now).toISOString();
    state.governmentBudgets[budgetId] = {
      budget_id: budgetId,
      organisation_id: organisationId,
      fiscal_year: date.year,
      fiscal_period_label: `${date.year}`,
      category_id: catalog.rules.ministry_budget_category_id,
      approved_amount_ngn: 0,
      allocated_amount_ngn: 0,
      spent_amount_ngn: 0,
      status: "draft",
      approved_at: null,
      approved_world_date: null,
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
    };
    created += 1;
  }
  created += applyInitialTreasuryFunding(state, date, now, catalog);
  if (created > 0) {
    appendGovernmentEvent(state, "gov:federal", "structure_reconciled",
      `Government structure reconciled: ${created} record(s) added.`, date, now, { records_added: created });
  }
  return created;
}

/** The treasury account of an organisation, created empty if it does not exist yet. Balance changes go through the ledger. */
function ensureTreasuryAccount(organisation: GovernmentOrganisationRecord, date: CalendarDate, now: number) {
  if (organisation.treasury_account) return organisation.treasury_account;
  const timestamp = new Date(now).toISOString();
  organisation.treasury_account = {
    account_id: `treasury:${organisation.organisation_id}`,
    organisation_id: organisation.organisation_id,
    level: organisation.level,
    jurisdiction_id: organisation.jurisdiction_id,
    balance_ngn: 0,
    total_credited_ngn: 0,
    total_debited_ngn: 0,
    status: "active",
    opened_world_date: cloneDate(date),
    created_at: timestamp,
    updated_at: timestamp,
  };
  return organisation.treasury_account;
}

// ─── Appointment management ───────────────────────────────────────

export function appointOfficial(
  state: PersistentWorldState,
  officeId: string,
  characterId: string,
  appointedBy: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): AppointmentRecord {
  const office = state.governmentOffices[officeId];
  if (!office) throw new Error("government_office_not_found");
  // A suspended office cannot be filled (Stage 30). Suspension is an administrative state with no player route.
  if (isOfficeSuspended(office)) throw new Error("government_office_suspended");
  // An office that does not fit its organisation cannot be filled (Stage 31). Legacy placements are left as they are.
  if (!officePlacement(state, office, catalog).ok) throw new Error("government_office_placement_invalid");

  const player = characterForId(state, characterId);
  if (!player) throw new Error("government_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("government_character_deceased");
  if (player.character.age < catalog.rules.minimum_office_holder_age) throw new Error("government_age_ineligible");

  // Check if office already has an active occupant (for unique offices)
  if (office.unique) {
    const existing = activeAppointmentForOffice(state, officeId);
    if (existing) throw new Error("government_office_already_occupied");
  }

  // Check character's appointment limit
  const currentAppointments = activeAppointmentsForCharacter(state, characterId);
  if (currentAppointments.length >= catalog.rules.maximum_active_appointments_per_character) {
    throw new Error("government_appointment_limit_reached");
  }

  const timestamp = new Date(now).toISOString();
  const appointment: AppointmentRecord = {
    appointment_id: `appt-${randomUUID()}`,
    office_id: officeId,
    character_id: characterId,
    status: "active",
    start_date: timestamp,
    start_world_date: cloneDate(date),
    end_date: null,
    end_world_date: null,
    end_reason: null,
    appointed_by: appointedBy,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.governmentAppointments[appointment.appointment_id] = appointment;

  const org = state.governmentOrganisations[office.organisation_id];
  if (org) {
    org.updated_at = timestamp;
    appendGovernmentEvent(state, org.organisation_id, "appointment_made",
      `${player.character.name} appointed to ${office.label}.`, date, now,
      { office_id: officeId, character_id: characterId, appointment_id: appointment.appointment_id });
  }

  return appointment;
}

export function removeOfficial(
  state: PersistentWorldState,
  appointmentId: string,
  reason: string,
  date: CalendarDate,
  now: number,
): AppointmentRecord {
  const appointment = state.governmentAppointments[appointmentId];
  if (!appointment) throw new Error("government_appointment_not_found");
  if (appointment.status !== "active") throw new Error("government_appointment_not_active");

  const timestamp = new Date(now).toISOString();
  appointment.status = "ended";
  appointment.end_date = timestamp;
  appointment.end_world_date = cloneDate(date);
  appointment.end_reason = reason.trim() || "Removed from office.";
  appointment.updated_at = timestamp;

  const office = state.governmentOffices[appointment.office_id];
  if (office) {
    const org = state.governmentOrganisations[office.organisation_id];
    if (org) {
      org.updated_at = timestamp;
      appendGovernmentEvent(state, org.organisation_id, "appointment_ended",
        `Appointment ended. ${appointment.end_reason}`, date, now,
        { office_id: office.office_id, character_id: appointment.character_id, appointment_id: appointmentId });
    }
  }

  return appointment;
}

// ─── Budget management ────────────────────────────────────────────

export function createBudget(
  state: PersistentWorldState,
  organisationId: string,
  fiscalYear: number,
  categoryId: string,
  amountNgn: number,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): BudgetRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");

  if (amountNgn < catalog.rules.minimum_budget_amount_ngn || amountNgn > catalog.rules.maximum_budget_amount_ngn) {
    throw new Error("government_budget_amount_invalid");
  }

  const budgetCat = catalog.budget_categories.find((c) => c.id === categoryId);
  if (!budgetCat) throw new Error("government_budget_category_invalid");

  const timestamp = new Date(now).toISOString();
  const budgetId = `bud-${randomUUID()}`;
  const budget: BudgetRecord = {
    budget_id: budgetId,
    organisation_id: organisationId,
    fiscal_year: fiscalYear,
    fiscal_period_label: `${fiscalYear}`,
    category_id: categoryId,
    approved_amount_ngn: amountNgn,
    allocated_amount_ngn: amountNgn,
    spent_amount_ngn: 0,
    status: "approved",
    approved_at: timestamp,
    approved_world_date: cloneDate(date),
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.governmentBudgets[budgetId] = budget;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "budget_created",
    `Budget of ₦${amountNgn.toLocaleString("en-NG")} approved for ${budgetCat.label} (${fiscalYear}).`, date, now,
    { budget_id: budgetId, amount_ngn: amountNgn, category_id: categoryId, fiscal_year: fiscalYear });

  return budget;
}

export function getBudgetAvailable(state: PersistentWorldState, budgetId: string): number {
  const budget = state.governmentBudgets[budgetId];
  if (!budget) return 0;
  const spent = budgetSpent(state, budgetId);
  return budget.allocated_amount_ngn - spent;
}

// ─── Revenue and Expenditure ──────────────────────────────────────

// ─── Revenue, expenditure, and treasury ledger (Stage 31) ─────────
//
// Every change to a treasury balance is a ledger row in the existing revenue (credit) or expenditure (debit) records,
// written in the same synchronous step as the balance. Every function here validates the whole request before its
// first write, so a rejected request changes nothing (no balance, no ledger row, no budget, no event).
//
// Authority is decided by authorizeOfficePermission (authority.ts), never by a field in the request. The
// request-supplied fields are the target (budget, destination, amount, reason) and an idempotency key.

const TREASURY_DESTINATION_KINDS = ["character", "business", "organisation"] as const;
const MAX_REQUEST_ID_LENGTH = 80;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(value);
}

function fingerprintOf(parts: readonly (string | number | null)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Trusted intake: money received into an organisation's treasury account. It has no player route. When a source
 * reference is given, a repeated intake with the same source is recorded once.
 */
export function recordGovernmentRevenue(
  state: PersistentWorldState,
  organisationId: string,
  categoryId: string,
  amountNgn: number,
  description: string,
  sourceReference: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentRevenueRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");
  if (org.status !== "active") throw new Error("government_organisation_inactive");
  if (!Number.isSafeInteger(amountNgn) || amountNgn < catalog.rules.minimum_revenue_amount_ngn || amountNgn > catalog.rules.maximum_revenue_amount_ngn) {
    throw new Error("government_revenue_amount_invalid");
  }
  const revCat = catalog.revenue_categories.find((c) => c.id === categoryId);
  if (!revCat) throw new Error("government_revenue_category_invalid");

  const reference = sourceReference === null || sourceReference.trim() === "" ? null : sourceReference.trim();
  const idemKey = reference === null
    ? createHash("sha256").update(`gov-rev:${randomUUID()}`).digest("hex")
    : createHash("sha256").update(`gov-rev:${organisationId}:${categoryId}:${amountNgn}:${reference}`).digest("hex");
  if (reference !== null) {
    const existing = Object.values(state.governmentRevenue).find((r) => r.idempotency_key === idemKey);
    if (existing) return existing;
  }

  const account = ensureTreasuryAccount(org, date, now);
  const timestamp = new Date(now).toISOString();
  account.balance_ngn += amountNgn;
  account.total_credited_ngn += amountNgn;
  account.updated_at = timestamp;
  const revenue: GovernmentRevenueRecord = {
    revenue_id: `gov-rev-${randomUUID()}`,
    organisation_id: organisationId,
    category_id: categoryId,
    amount_ngn: amountNgn,
    description: description.trim() || revCat.label,
    source_reference: reference,
    received_at: timestamp,
    received_world_date: cloneDate(date),
    idempotency_key: idemKey,
    account_id: account.account_id,
    actor_character_id: null,
    balance_after_ngn: account.balance_ngn,
  };
  state.governmentRevenue[revenue.revenue_id] = revenue;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "revenue_recorded",
    `Revenue of ₦${amountNgn.toLocaleString("en-NG")} recorded (${revCat.label}).`, date, now,
    { revenue_id: revenue.revenue_id, amount_ngn: amountNgn, category_id: categoryId, account_id: account.account_id,
      balance_after_ngn: account.balance_ngn });

  return revenue;
}

/**
 * Writes one expenditure and its debit. Callers must have validated the request (amount, budget, funds, authority).
 * It is the only place a treasury balance is reduced by spending.
 */
function postExpenditure(
  state: PersistentWorldState,
  org: GovernmentOrganisationRecord,
  input: {
    budgetId: string | null;
    categoryId: string;
    amountNgn: number;
    description: string;
    projectId: string | null;
    recipientReference: string | null;
    actorCharacterId: string | null;
    destinationKind: "character" | "business" | "organisation" | null;
    destinationId: string | null;
    idempotencyKey: string;
    requestFingerprint: string | null;
    categoryLabel: string;
  },
  date: CalendarDate,
  now: number,
): GovernmentExpenditureRecord {
  const account = ensureTreasuryAccount(org, date, now);
  const timestamp = new Date(now).toISOString();
  account.balance_ngn -= input.amountNgn;
  account.total_debited_ngn += input.amountNgn;
  account.updated_at = timestamp;

  const expenditure: GovernmentExpenditureRecord = {
    expenditure_id: `gov-exp-${randomUUID()}`,
    organisation_id: org.organisation_id,
    budget_id: input.budgetId,
    project_id: input.projectId,
    category_id: input.categoryId,
    amount_ngn: input.amountNgn,
    description: input.description,
    recipient_reference: input.recipientReference,
    spent_at: timestamp,
    spent_world_date: cloneDate(date),
    idempotency_key: input.idempotencyKey,
    account_id: account.account_id,
    actor_character_id: input.actorCharacterId,
    destination_kind: input.destinationKind,
    destination_id: input.destinationId,
    request_fingerprint: input.requestFingerprint,
    balance_after_ngn: account.balance_ngn,
  };
  state.governmentExpenditure[expenditure.expenditure_id] = expenditure;

  if (input.budgetId) {
    const budget = state.governmentBudgets[input.budgetId];
    if (budget) {
      budget.spent_amount_ngn = budgetSpent(state, input.budgetId);
      budget.updated_at = timestamp;
      if (budget.status === "approved") budget.status = "active";
    }
  }
  org.updated_at = timestamp;

  appendGovernmentEvent(state, org.organisation_id, "expenditure_recorded",
    `Expenditure of ₦${input.amountNgn.toLocaleString("en-NG")} recorded (${input.categoryLabel}).`, date, now,
    { expenditure_id: expenditure.expenditure_id, amount_ngn: input.amountNgn, category_id: input.categoryId,
      budget_id: input.budgetId, account_id: account.account_id, actor_character_id: input.actorCharacterId,
      destination_kind: input.destinationKind, destination_id: input.destinationId,
      balance_after_ngn: account.balance_ngn });
  return expenditure;
}

/**
 * Trusted expenditure path, with no actor and no route. It applies the same budget, funds, and organisation-scope
 * checks as spendBudget, but it does not check office authority, because it has no actor. It is for system work only.
 */
export function recordGovernmentExpenditure(
  state: PersistentWorldState,
  organisationId: string,
  budgetId: string | null,
  categoryId: string,
  amountNgn: number,
  description: string,
  projectId: string | null,
  recipientReference: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentExpenditureRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");
  if (org.status !== "active") throw new Error("government_organisation_inactive");
  if (!Number.isSafeInteger(amountNgn) || amountNgn < catalog.rules.minimum_expenditure_amount_ngn || amountNgn > catalog.rules.maximum_expenditure_amount_ngn) {
    throw new Error("government_expenditure_amount_invalid");
  }
  const expCat = catalog.expenditure_categories.find((c) => c.id === categoryId);
  if (!expCat) throw new Error("government_expenditure_category_invalid");

  if (budgetId) {
    const budget = state.governmentBudgets[budgetId];
    if (!budget) throw new Error("government_budget_not_found");
    // Exact organisation only. A ministry may not spend from its parent's budget, and a parent may not spend from a
    // ministry's budget, because neither implies authority over the other (Stage 31, jurisdiction rule).
    if (budget.organisation_id !== organisationId) throw new Error("government_budget_wrong_organisation");
    if (budget.status === "draft") throw new Error("government_budget_not_approved");
    if (budget.status === "closed") throw new Error("government_budget_closed");
    if (getBudgetAvailable(state, budgetId) < amountNgn) throw new Error("government_insufficient_budget");
  }
  const funds = org.treasury_account?.balance_ngn ?? 0;
  if (funds < amountNgn) throw new Error("treasury_insufficient_funds");

  return postExpenditure(state, org, {
    budgetId, categoryId, amountNgn, description: description.trim() || expCat.label, projectId, recipientReference,
    actorCharacterId: null, destinationKind: null, destinationId: null,
    idempotencyKey: createHash("sha256").update(`gov-exp:${randomUUID()}`).digest("hex"),
    requestFingerprint: null, categoryLabel: expCat.label,
  }, date, now);
}

/**
 * Approves a budget ceiling (budget_approve). The amount is absolute, so a retried request yields the same state.
 * Approval needs the server-verified minimum age (authorizeOfficePermission). It is not allocation or spending.
 */
export function approveBudget(
  state: PersistentWorldState,
  actorCharacterId: string,
  budgetId: string,
  approvedAmountNgn: number,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): BudgetRecord {
  const budget = state.governmentBudgets[budgetId];
  if (!budget) throw new Error("government_budget_not_found");
  const org = state.governmentOrganisations[budget.organisation_id];
  if (!org) throw new Error("government_organisation_not_found");
  // Authority is decided first, so a refused caller learns nothing about the budget's amounts.
  const permission = authorizeOfficePermission(state, actorCharacterId, org.organisation_id, "budget_approve", date, catalog);
  if (!permission.ok) throw new Error(permission.code);
  if (org.status !== "active") throw new Error("government_organisation_inactive");
  if (budget.status === "closed") throw new Error("government_budget_closed");
  if (!Number.isSafeInteger(approvedAmountNgn) || approvedAmountNgn < 1 ||
    approvedAmountNgn > catalog.rules.maximum_budget_amount_ngn) {
    throw new Error("government_budget_amount_invalid");
  }
  if (approvedAmountNgn < budget.allocated_amount_ngn) throw new Error("treasury_approval_below_allocation");

  const timestamp = new Date(now).toISOString();
  const previous = budget.approved_amount_ngn;
  budget.approved_amount_ngn = approvedAmountNgn;
  if (budget.status === "draft") budget.status = "approved";
  budget.approved_at = timestamp;
  budget.approved_world_date = cloneDate(date);
  budget.approved_by_character_id = actorCharacterId;
  budget.updated_at = timestamp;
  org.updated_at = timestamp;
  appendGovernmentEvent(state, org.organisation_id, "budget_approved",
    `Budget ceiling set to ₦${approvedAmountNgn.toLocaleString("en-NG")}.`, date, now,
    { budget_id: budgetId, previous_amount_ngn: previous, approved_amount_ngn: approvedAmountNgn,
      actor_character_id: actorCharacterId });
  return budget;
}

/**
 * Allocates part of an approved budget to its purposes (budget_allocate). Allocation commits money within the
 * ceiling but moves no cash. Retries with the same request ID and the same amount change nothing.
 */
export function allocateBudget(
  state: PersistentWorldState,
  actorCharacterId: string,
  budgetId: string,
  amountNgn: number,
  requestId: string | undefined,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): { budget: BudgetRecord; replayed: boolean } {
  if (!isRequestId(requestId)) throw new Error("treasury_request_id_required");
  const budget = state.governmentBudgets[budgetId];
  if (!budget) throw new Error("government_budget_not_found");
  const org = state.governmentOrganisations[budget.organisation_id];
  if (!org) throw new Error("government_organisation_not_found");
  const permission = authorizeOfficePermission(state, actorCharacterId, org.organisation_id, "budget_allocate", date, catalog);
  if (!permission.ok) throw new Error(permission.code);

  const idemKey = createHash("sha256").update(`gov-alloc:${actorCharacterId}:${requestId}`).digest("hex");
  const fingerprint = fingerprintOf([budgetId, amountNgn]);
  const earlier = Object.values(state.governmentEvents).find(
    (e) => e.type === "budget_allocated" && e.details.idempotency_key === idemKey,
  );
  if (earlier) {
    if (earlier.details.request_fingerprint === fingerprint) return { budget, replayed: true };
    throw new Error("treasury_idempotency_conflict");
  }

  if (!Number.isSafeInteger(amountNgn) || amountNgn < 1 || amountNgn > catalog.rules.maximum_budget_amount_ngn) {
    throw new Error("government_budget_amount_invalid");
  }
  if (org.status !== "active") throw new Error("government_organisation_inactive");
  if (budget.status === "draft") throw new Error("government_budget_not_approved");
  if (budget.status === "closed") throw new Error("government_budget_closed");
  if (budget.allocated_amount_ngn + amountNgn > budget.approved_amount_ngn) throw new Error("government_budget_over_approval");

  const timestamp = new Date(now).toISOString();
  budget.allocated_amount_ngn += amountNgn;
  budget.updated_at = timestamp;
  org.updated_at = timestamp;
  appendGovernmentEvent(state, org.organisation_id, "budget_allocated",
    `₦${amountNgn.toLocaleString("en-NG")} allocated within the approved budget.`, date, now,
    { budget_id: budgetId, amount_ngn: amountNgn, allocated_total_ngn: budget.allocated_amount_ngn,
      actor_character_id: actorCharacterId, idempotency_key: idemKey, request_fingerprint: fingerprint });
  return { budget, replayed: false };
}

/**
 * Spends from an allocated budget to a destination, debiting the organisation's treasury account (budget_spend).
 *
 * Checks, in order, all before the first write:
 *   1. a request ID (the idempotency key, scoped to the actor);
 *   2. the actor's office authority over the budget's own organisation, with the budget_spend permission;
 *   3. a retry of the same request returns the original expenditure (replayed), and a different payload with the
 *      same request ID is refused;
 *   4. amount, reason, organisation status, and budget status;
 *   5. the destination is a character with a cash account (Stage 32: business and organisation payments are refused as
 *      unsupported), and the actor has no direct interest in it (not the actor, and no active family or marriage tie);
 *   6. enough allocated budget left, enough money in the treasury account, and the payee can take the credit (active
 *      cash account, per-payment limit, balance limit), checked by planGovernmentPaymentCredit.
 * Only then are the debit, the budget update, and the payee's credit written, in one synchronous step.
 * The actor, the destination owner, and the organisation all come from server records. No request field grants authority.
 */
export function spendBudget(
  state: PersistentWorldState,
  actorCharacterId: string,
  budgetId: string,
  amountNgn: number,
  destination: { readonly kind: string; readonly id: string },
  reason: string,
  requestId: string | undefined,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): { expenditure: GovernmentExpenditureRecord; replayed: boolean } {
  if (!isRequestId(requestId)) throw new Error("treasury_request_id_required");
  const budget = state.governmentBudgets[budgetId];
  if (!budget) throw new Error("government_budget_not_found");
  const org = state.governmentOrganisations[budget.organisation_id];
  if (!org) throw new Error("government_organisation_not_found");

  const permission = authorizeOfficePermission(state, actorCharacterId, org.organisation_id, "budget_spend", date, catalog);
  if (!permission.ok) throw new Error(permission.code);

  const destinationKind = destination.kind as "character" | "business" | "organisation";
  const destinationId = typeof destination.id === "string" ? destination.id : "";
  const reasonText = typeof reason === "string" ? reason.trim() : "";
  const fingerprint = fingerprintOf([budgetId, amountNgn, destinationKind, destinationId, reasonText]);
  const idemKey = createHash("sha256").update(`gov-spend:${actorCharacterId}:${requestId}`).digest("hex");
  const earlier = Object.values(state.governmentExpenditure).find((e) => e.idempotency_key === idemKey);
  if (earlier) {
    if (earlier.request_fingerprint === fingerprint) return { expenditure: earlier, replayed: true };
    throw new Error("treasury_idempotency_conflict");
  }

  if (!Number.isSafeInteger(amountNgn) || amountNgn < catalog.rules.minimum_expenditure_amount_ngn ||
    amountNgn > catalog.rules.maximum_expenditure_amount_ngn) {
    throw new Error("government_expenditure_amount_invalid");
  }
  if (reasonText.length === 0 || reasonText.length > 200) throw new Error("treasury_reason_invalid");
  if (org.status !== "active") throw new Error("government_organisation_inactive");
  if (budget.status === "draft") throw new Error("government_budget_not_approved");
  if (budget.status === "closed") throw new Error("government_budget_closed");

  if (!(TREASURY_DESTINATION_KINDS as readonly string[]).includes(destinationKind) || destinationId.length === 0 ||
    destinationId.length > 120) {
    throw new Error("treasury_destination_invalid");
  }
  // Only a character can receive a payment in Stage 32: the money is credited to that character's existing cash
  // account. A business or an organisation has no receiving rule yet, so it is refused, never debited with no credit.
  if (destinationKind !== "character") throw new Error("treasury_destination_unsupported");
  const payee = Object.values(state.players).find((p) => p.character.character_id === destinationId);
  if (!payee) throw new Error("treasury_destination_not_found");
  // Self-payment and payment to a family member or spouse of the actor are refused: each would benefit the actor.
  if (destinationId === actorCharacterId || hasActiveFamilyTie(state, actorCharacterId, destinationId)) {
    throw new Error("treasury_conflict_of_interest");
  }
  const destinationLabel = payee.character.name;

  if (getBudgetAvailable(state, budgetId) < amountNgn) throw new Error("government_insufficient_budget");
  const funds = org.treasury_account?.balance_ngn ?? 0;
  if (funds < amountNgn) throw new Error("treasury_insufficient_funds");
  // Every check on the recipient runs here, before the first write (see planGovernmentPaymentCredit).
  const credit = planGovernmentPaymentCredit(state, destinationId, amountNgn, loadEconomyCatalog());

  // The debit and the credit are written in this one synchronous step. The save that follows writes both together.
  const expenditure = postExpenditure(state, org, {
    budgetId, categoryId: budget.category_id, amountNgn, description: reasonText, projectId: null,
    recipientReference: destinationLabel, actorCharacterId, destinationKind, destinationId,
    idempotencyKey: idemKey, requestFingerprint: fingerprint,
    categoryLabel: catalog.budget_categories.find((c) => c.id === budget.category_id)?.label ?? budget.category_id,
  }, date, now);
  const transactionId = credit.apply({
    expenditureId: expenditure.expenditure_id, treasuryAccountId: expenditure.account_id ?? "", sourceLabel: org.name,
    amountNgn, date, now,
  });
  expenditure.recipient_account_id = credit.accountId;
  expenditure.recipient_transaction_id = transactionId;
  return { expenditure, replayed: false };
}

/**
 * Read-only ledger check (Stage 31). For each treasury account: balance = credits - debits, the totals match the
 * ledger rows, and no balance is negative. For each budget: 0 <= spent <= allocated <= approved. Returns the list of
 * problems; an empty list means the ledger agrees with the balances.
 */
export function auditTreasuryLedger(state: PersistentWorldState): string[] {
  const problems: string[] = [];
  for (const organisation of Object.values(state.governmentOrganisations)) {
    const account = organisation.treasury_account;
    if (!account) continue;
    const credits = Object.values(state.governmentRevenue)
      .filter((r) => r.account_id === account.account_id).reduce((sum, r) => sum + r.amount_ngn, 0);
    const debits = Object.values(state.governmentExpenditure)
      .filter((e) => e.account_id === account.account_id).reduce((sum, e) => sum + e.amount_ngn, 0);
    if (account.total_credited_ngn !== credits) problems.push(`${account.account_id}: credits do not match the ledger`);
    if (account.total_debited_ngn !== debits) problems.push(`${account.account_id}: debits do not match the ledger`);
    if (account.balance_ngn !== credits - debits) problems.push(`${account.account_id}: balance does not match the ledger`);
    if (account.balance_ngn < 0) problems.push(`${account.account_id}: negative balance`);
  }
  for (const budget of Object.values(state.governmentBudgets)) {
    const spent = budgetSpent(state, budget.budget_id);
    if (budget.spent_amount_ngn !== spent) problems.push(`${budget.budget_id}: spent does not match the ledger`);
    if (budget.spent_amount_ngn < 0 || budget.spent_amount_ngn > budget.allocated_amount_ngn) {
      problems.push(`${budget.budget_id}: spent is outside the allocated amount`);
    }
    if (budget.allocated_amount_ngn > budget.approved_amount_ngn) problems.push(`${budget.budget_id}: allocated exceeds approved`);
  }
  // Stage 32: a payment to a character is credited to that character's cash account, one for one.
  const transactions = state.economyTransactions ?? {};
  const creditedByPayments = new Set<string>();
  for (const expenditure of Object.values(state.governmentExpenditure)) {
    if (expenditure.destination_kind !== "character") continue;
    if (!expenditure.recipient_transaction_id) {
      problems.push(`${expenditure.expenditure_id}: payment to a character was recorded before its recipient was credited`);
      continue;
    }
    const transaction = transactions[expenditure.recipient_transaction_id];
    if (!transaction || transaction.kind !== "government_payment" || transaction.amount_ngn !== expenditure.amount_ngn ||
      transaction.account_id !== expenditure.recipient_account_id || transaction.reference_id !== expenditure.expenditure_id) {
      problems.push(`${expenditure.expenditure_id}: recipient credit does not match the payment`);
    } else {
      creditedByPayments.add(transaction.transaction_id);
    }
  }
  for (const transaction of Object.values(transactions)) {
    if (transaction.kind === "government_payment" && !creditedByPayments.has(transaction.transaction_id)) {
      problems.push(`${transaction.transaction_id}: government payment credit has no matching payment`);
    }
  }
  return problems;
}

/**
 * One-time initial treasury funding (Stage 32). For each catalogue rule whose organisation exists, one revenue row is
 * written to that treasury, with the rule's source reference and funding_rule_id. The check reads the ledger that is
 * saved with the world, so it holds across restarts: a rule that has already been applied changes nothing. The amount
 * comes from the catalogue only. No request can name one, and there is no route that applies a rule.
 */
export function applyInitialTreasuryFunding(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): number {
  let funded = 0;
  for (const rule of catalog.treasury_funding) {
    const org = state.governmentOrganisations[rule.organisation_id];
    if (!org || org.status !== "active") continue;
    const marker = `treasury-funding:${rule.rule_id}`;
    const alreadyFunded = Object.values(state.governmentRevenue).some((row) =>
      row.funding_rule_id === rule.rule_id || (row.organisation_id === org.organisation_id && row.source_reference === marker));
    if (alreadyFunded) continue;
    const revenue = recordGovernmentRevenue(state, org.organisation_id, rule.category_id, rule.amount_ngn, rule.reason,
      marker, date, now, catalog);
    revenue.funding_rule_id = rule.rule_id;
    funded += 1;
  }
  return funded;
}

// ─── Projects ─────────────────────────────────────────────────────

export function createProject(
  state: PersistentWorldState,
  organisationId: string,
  budgetId: string | null,
  categoryId: string,
  name: string,
  description: string,
  locationId: string,
  estimatedCostNgn: number,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentProjectRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");

  const projCat = catalog.project_categories.find((c) => c.id === categoryId);
  if (!projCat) throw new Error("government_project_category_invalid");

  const projName = name.normalize("NFC").trim();
  if (projName.length < 1 || projName.length > catalog.rules.project_max_name_length) throw new Error("government_project_name_invalid");
  const projDesc = description.normalize("NFC").trim();
  if (projDesc.length > catalog.rules.project_max_description_length) throw new Error("government_project_description_invalid");

  if (estimatedCostNgn < catalog.rules.minimum_project_cost_ngn || estimatedCostNgn > catalog.rules.maximum_project_cost_ngn) {
    throw new Error("government_project_cost_invalid");
  }

  const timestamp = new Date(now).toISOString();
  const project: GovernmentProjectRecord = {
    project_id: `gov-proj-${randomUUID()}`,
    organisation_id: organisationId,
    budget_id: budgetId,
    category_id: categoryId,
    name: projName,
    description: projDesc,
    location_id: locationId,
    estimated_cost_ngn: estimatedCostNgn,
    approved_funding_ngn: 0,
    actual_spent_ngn: 0,
    status: "proposed",
    progress_percent: 0,
    start_date: null,
    start_world_date: null,
    planned_completion: null,
    actual_completion: null,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.governmentProjects[project.project_id] = project;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "project_created",
    `Project '${projName}' proposed.`, date, now,
    { project_id: project.project_id, category_id: categoryId, estimated_cost_ngn: estimatedCostNgn });

  return project;
}

export function updateProjectStatus(
  state: PersistentWorldState,
  projectId: string,
  newStatus: ProjectStatus,
  progressPercent: number | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentProjectRecord {
  const project = state.governmentProjects[projectId];
  if (!project) throw new Error("government_project_not_found");
  if (!catalog.rules.project_statuses.includes(newStatus)) throw new Error("government_project_status_invalid");

  const validTransitions: Record<string, ProjectStatus[]> = {
    proposed: ["under_review", "cancelled"],
    under_review: ["approved", "cancelled"],
    approved: ["funded", "cancelled"],
    funded: ["in_progress", "cancelled"],
    in_progress: ["completed", "suspended", "cancelled"],
    suspended: ["in_progress", "cancelled"],
    completed: [],
    cancelled: [],
  };
  if (!validTransitions[project.status]?.includes(newStatus)) {
    throw new Error("government_project_status_transition_invalid");
  }

  const timestamp = new Date(now).toISOString();
  project.status = newStatus;
  if (progressPercent !== null) {
    project.progress_percent = Math.max(0, Math.min(100, progressPercent));
  }
  if (newStatus === "in_progress" && !project.start_date) {
    project.start_date = timestamp;
    project.start_world_date = cloneDate(date);
  }
  if (newStatus === "completed") {
    project.actual_completion = timestamp;
    project.progress_percent = 100;
  }
  project.updated_at = timestamp;

  const org = state.governmentOrganisations[project.organisation_id];
  if (org) org.updated_at = timestamp;

  appendGovernmentEvent(state, project.organisation_id, "project_status_changed",
    `Project '${project.name}' status changed to ${newStatus}.`, date, now,
    { project_id: projectId, previous_status: project.status, new_status: newStatus });

  return project;
}

export function fundProject(
  state: PersistentWorldState,
  projectId: string,
  fundingAmountNgn: number,
  date: CalendarDate,
  now: number,
): GovernmentProjectRecord {
  const project = state.governmentProjects[projectId];
  if (!project) throw new Error("government_project_not_found");
  if (project.status !== "approved" && project.status !== "funded" && project.status !== "in_progress") {
    throw new Error("government_project_not_fundable");
  }
  if (fundingAmountNgn < 1) throw new Error("government_funding_amount_invalid");

  const timestamp = new Date(now).toISOString();
  project.approved_funding_ngn += fundingAmountNgn;
  if (project.status === "approved") project.status = "funded";
  project.updated_at = timestamp;

  appendGovernmentEvent(state, project.organisation_id, "project_funded",
    `Project '${project.name}' received ₦${fundingAmountNgn.toLocaleString("en-NG")} in funding.`, date, now,
    { project_id: projectId, funding_amount_ngn: fundingAmountNgn, total_funding_ngn: project.approved_funding_ngn });

  return project;
}

// ─── Announcements ────────────────────────────────────────────────

export function publishAnnouncement(
  state: PersistentWorldState,
  organisationId: string,
  title: string,
  body: string,
  scopeLevel: GovernmentLevel,
  scopeJurisdictionId: string | null,
  projectId: string | null,
  date: CalendarDate,
  now: number,
  catalog: GovernmentCatalog = loadGovernmentCatalog(),
): GovernmentAnnouncementRecord {
  const org = state.governmentOrganisations[organisationId];
  if (!org) throw new Error("government_organisation_not_found");

  const annTitle = title.normalize("NFC").trim();
  if (annTitle.length < 1 || annTitle.length > catalog.rules.announcement_max_title_length) {
    throw new Error("government_announcement_title_invalid");
  }
  const annBody = body.normalize("NFC").trim();
  if (annBody.length < 1 || annBody.length > catalog.rules.announcement_max_body_length) {
    throw new Error("government_announcement_body_invalid");
  }

  const timestamp = new Date(now).toISOString();
  const announcement: GovernmentAnnouncementRecord = {
    announcement_id: `gov-ann-${randomUUID()}`,
    organisation_id: organisationId,
    project_id: projectId,
    title: annTitle,
    body: annBody,
    scope_level: scopeLevel,
    scope_jurisdiction_id: scopeJurisdictionId,
    status: "published",
    published_at: timestamp,
    published_world_date: cloneDate(date),
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.governmentAnnouncements[announcement.announcement_id] = announcement;
  org.updated_at = timestamp;

  appendGovernmentEvent(state, organisationId, "announcement_published",
    `Announcement: '${annTitle}'.`, date, now,
    { announcement_id: announcement.announcement_id, scope_level: scopeLevel });

  return announcement;
}

// ─── Query functions ──────────────────────────────────────────────

function buildOrganisationSnapshot(state: PersistentWorldState, orgId: string): GovernmentOrganisationSnapshot | null {
  const org = state.governmentOrganisations[orgId];
  if (!org) return null;
  const offices = Object.values(state.governmentOffices).filter((o) => o.organisation_id === orgId);
  const appointments: AppointmentSnapshot[] = Object.values(state.governmentAppointments)
    .filter((a) => offices.some((o) => o.office_id === a.office_id) && a.status === "active")
    .map((a) => {
      const office = state.governmentOffices[a.office_id];
      return {
        appointment_id: a.appointment_id,
        office_id: a.office_id,
        office_label: office?.label ?? a.office_id,
        character_id: a.character_id,
        status: a.status,
        start_date: a.start_date,
        end_date: a.end_date,
      };
    });
  const budgets = Object.values(state.governmentBudgets).filter((b) => b.organisation_id === orgId);
  const latestBudget = budgets.sort((a, b) => b.fiscal_year - a.fiscal_year)[0] ?? null;
  const projectCount = Object.values(state.governmentProjects).filter((p) => p.organisation_id === orgId).length;
  const announcementCount = Object.values(state.governmentAnnouncements).filter((a) => a.organisation_id === orgId).length;

  return {
    organisation_id: org.organisation_id,
    level: org.level,
    name: org.name,
    description: org.description,
    jurisdiction_id: org.jurisdiction_id,
    parent_organisation_id: org.parent_organisation_id,
    ministry_id: org.ministry_id,
    status: org.status,
    active_offices: offices,
    active_appointments: appointments,
    latest_budget: latestBudget,
    project_count: projectCount,
    announcement_count: announcementCount,
  };
}

export function getFederalGovernment(state: PersistentWorldState): FederalGovernmentSnapshot | null {
  const federal = Object.values(state.governmentOrganisations).find(
    (o) => o.level === "federal" && o.parent_organisation_id === null && o.status === "active",
  );
  if (!federal) return null;

  const federalSnapshot = buildOrganisationSnapshot(state, federal.organisation_id);
  if (!federalSnapshot) return null;

  const ministries = Object.values(state.governmentOrganisations)
    .filter((o) => o.parent_organisation_id === federal.organisation_id && o.ministry_id !== null)
    .map((m) => buildOrganisationSnapshot(state, m.organisation_id))
    .filter((s): s is GovernmentOrganisationSnapshot => s !== null);

  const presidentOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:president",
  );
  const vpOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:vice-president",
  );

  const presidentAppt = presidentOffice ? activeAppointmentForOffice(state, presidentOffice.office_id) : undefined;
  const vpAppt = vpOffice ? activeAppointmentForOffice(state, vpOffice.office_id) : undefined;

  const toApptSnapshot = (a: AppointmentRecord | undefined): AppointmentSnapshot | null => {
    if (!a) return null;
    const office = state.governmentOffices[a.office_id];
    return {
      appointment_id: a.appointment_id,
      office_id: a.office_id,
      office_label: office?.label ?? a.office_id,
      character_id: a.character_id,
      status: a.status,
      start_date: a.start_date,
      end_date: a.end_date,
    };
  };

  const announcements: GovernmentAnnouncementSnapshot[] = Object.values(state.governmentAnnouncements)
    .filter((a) => a.organisation_id === federal.organisation_id && a.status === "published")
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 10)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));

  const projects: GovernmentProjectSnapshot[] = Object.values(state.governmentProjects)
    .filter((p) => p.organisation_id === federal.organisation_id && p.status !== "cancelled" && p.status !== "completed")
    .slice(0, 10)
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));

  return {
    federal_organisation: federalSnapshot,
    ministries,
    president: toApptSnapshot(presidentAppt),
    vice_president: toApptSnapshot(vpAppt),
    recent_announcements: announcements,
    active_projects: projects,
  };
}

export function getStateGovernment(state: PersistentWorldState, stateId: string): StateGovernmentSnapshot | null {
  const stateOrg = organisationForJurisdiction(state, "state", stateId);
  if (!stateOrg) return null;

  const stateSnapshot = buildOrganisationSnapshot(state, stateOrg.organisation_id);
  if (!stateSnapshot) return null;

  const departments = Object.values(state.governmentOrganisations)
    .filter((o) => o.parent_organisation_id === stateOrg.organisation_id)
    .map((d) => buildOrganisationSnapshot(state, d.organisation_id))
    .filter((s): s is GovernmentOrganisationSnapshot => s !== null);

  const governorOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:governor" && o.organisation_id === stateOrg.organisation_id,
  );
  const deputyOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:deputy-governor" && o.organisation_id === stateOrg.organisation_id,
  );

  const governorAppt = governorOffice ? activeAppointmentForOffice(state, governorOffice.office_id) : undefined;
  const deputyAppt = deputyOffice ? activeAppointmentForOffice(state, deputyOffice.office_id) : undefined;

  const toApptSnapshot = (a: AppointmentRecord | undefined): AppointmentSnapshot | null => {
    if (!a) return null;
    const office = state.governmentOffices[a.office_id];
    return {
      appointment_id: a.appointment_id,
      office_id: a.office_id,
      office_label: office?.label ?? a.office_id,
      character_id: a.character_id,
      status: a.status,
      start_date: a.start_date,
      end_date: a.end_date,
    };
  };

  const announcements: GovernmentAnnouncementSnapshot[] = Object.values(state.governmentAnnouncements)
    .filter((a) => a.organisation_id === stateOrg.organisation_id && a.status === "published")
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 10)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));

  const projects: GovernmentProjectSnapshot[] = Object.values(state.governmentProjects)
    .filter((p) => p.organisation_id === stateOrg.organisation_id && p.status !== "cancelled" && p.status !== "completed")
    .slice(0, 10)
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));

  return {
    state_organisation: stateSnapshot,
    governor: toApptSnapshot(governorAppt),
    deputy_governor: toApptSnapshot(deputyAppt),
    departments,
    recent_announcements: announcements,
    active_projects: projects,
  };
}

export function getLocalGovernment(state: PersistentWorldState, lgaId: string): LocalGovernmentSnapshot | null {
  const localOrg = organisationForJurisdiction(state, "local", lgaId);
  if (!localOrg) return null;

  const localSnapshot = buildOrganisationSnapshot(state, localOrg.organisation_id);
  if (!localSnapshot) return null;

  const chairmanOffice = Object.values(state.governmentOffices).find(
    (o) => o.definition_id === "office:lg-chairman" && o.organisation_id === localOrg.organisation_id,
  );
  const chairmanAppt = chairmanOffice ? activeAppointmentForOffice(state, chairmanOffice.office_id) : undefined;

  const toApptSnapshot = (a: AppointmentRecord | undefined): AppointmentSnapshot | null => {
    if (!a) return null;
    const office = state.governmentOffices[a.office_id];
    return {
      appointment_id: a.appointment_id,
      office_id: a.office_id,
      office_label: office?.label ?? a.office_id,
      character_id: a.character_id,
      status: a.status,
      start_date: a.start_date,
      end_date: a.end_date,
    };
  };

  const announcements: GovernmentAnnouncementSnapshot[] = Object.values(state.governmentAnnouncements)
    .filter((a) => a.organisation_id === localOrg.organisation_id && a.status === "published")
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 5)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));

  const projects: GovernmentProjectSnapshot[] = Object.values(state.governmentProjects)
    .filter((p) => p.organisation_id === localOrg.organisation_id && p.status !== "cancelled" && p.status !== "completed")
    .slice(0, 5)
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));

  return {
    local_organisation: localSnapshot,
    chairman: toApptSnapshot(chairmanAppt),
    recent_announcements: announcements,
    active_projects: projects,
  };
}

export function searchProjects(
  state: PersistentWorldState,
  filters: { organisation_id?: string | null; location_id?: string | null; category_id?: string | null; status?: ProjectStatus | null },
): GovernmentProjectSnapshot[] {
  return Object.values(state.governmentProjects)
    .filter((p) => {
      if (filters.organisation_id && p.organisation_id !== filters.organisation_id) return false;
      if (filters.location_id && p.location_id !== filters.location_id) return false;
      if (filters.category_id && p.category_id !== filters.category_id) return false;
      if (filters.status && p.status !== filters.status) return false;
      return true;
    })
    .map((p) => ({
      project_id: p.project_id,
      organisation_id: p.organisation_id,
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      location_id: p.location_id,
      estimated_cost_ngn: p.estimated_cost_ngn,
      approved_funding_ngn: p.approved_funding_ngn,
      actual_spent_ngn: p.actual_spent_ngn,
      status: p.status,
      progress_percent: p.progress_percent,
      start_date: p.start_date,
      planned_completion: p.planned_completion,
      actual_completion: p.actual_completion,
    }));
}

export function getPublishedAnnouncements(
  state: PersistentWorldState,
  level: GovernmentLevel | null,
  jurisdictionId: string | null,
): GovernmentAnnouncementSnapshot[] {
  return Object.values(state.governmentAnnouncements)
    .filter((a) => {
      if (a.status !== "published") return false;
      if (level && a.scope_level !== level) return false;
      if (jurisdictionId && a.scope_jurisdiction_id && a.scope_jurisdiction_id !== jurisdictionId) return false;
      return true;
    })
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 30)
    .map((a) => ({
      announcement_id: a.announcement_id,
      organisation_id: a.organisation_id,
      title: a.title,
      body: a.body,
      scope_level: a.scope_level,
      scope_jurisdiction_id: a.scope_jurisdiction_id,
      status: a.status,
      published_at: a.published_at,
    }));
}

export function getCharacterAppointments(state: PersistentWorldState, characterId: string): AppointmentSnapshot[] {
  return Object.values(state.governmentAppointments)
    .filter((a) => a.character_id === characterId)
    .map((a) => {
      const office = state.governmentOffices[a.office_id];
      return {
        appointment_id: a.appointment_id,
        office_id: a.office_id,
        office_label: office?.label ?? a.office_id,
        character_id: a.character_id,
        status: a.status,
        start_date: a.start_date,
        end_date: a.end_date,
      };
    });
}

/** Daily government processing: term expiry. Returns the number of appointments that ended. */
export function processGovernmentWorldDate(state: PersistentWorldState, date: CalendarDate, now: number): number {
  return expireElapsedTerms(state, date, now);
}

/**
 * Ends every active appointment whose term has ended on or before the date. Each ended term gets an audit event.
 * Appointments with no term end (every appointment created so far) are not affected. Running it again on the same date
 * changes nothing, because an ended appointment is no longer active.
 */
export function expireElapsedTerms(state: PersistentWorldState, date: CalendarDate, now: number): number {
  let expired = 0;
  const timestamp = new Date(now).toISOString();
  for (const appointment of Object.values(state.governmentAppointments)) {
    if (appointment.status !== "active") continue;
    if (!appointment.end_world_date || compareDates(appointment.end_world_date, date) > 0) continue;
    appointment.status = "ended";
    appointment.end_date = appointment.end_date ?? timestamp;
    appointment.end_reason = "Term ended.";
    appointment.updated_at = timestamp;
    const office = state.governmentOffices[appointment.office_id];
    const org = office ? state.governmentOrganisations[office.organisation_id] : undefined;
    if (org) {
      org.updated_at = timestamp;
      appendGovernmentEvent(state, org.organisation_id, "appointment_ended",
        `Term ended for ${office?.label ?? appointment.office_id}.`, date, now,
        { office_id: appointment.office_id, character_id: appointment.character_id, appointment_id: appointment.appointment_id, reason: "term_ended" });
    }
    expired += 1;
  }
  return expired;
}

/**
 * Trusted, administrative change of an office's status. Suspension stops all authority over the office. It does not
 * remove the holder's appointment, so reinstating the office restores the existing holder's authority. No player route
 * calls this function.
 */
export function setGovernmentOfficeStatus(
  state: PersistentWorldState,
  officeId: string,
  status: OfficeStatus,
  reason: string,
  date: CalendarDate,
  now: number,
): GovernmentOfficeRecord {
  const office = state.governmentOffices[officeId];
  if (!office) throw new Error("government_office_not_found");
  if (status !== "active" && status !== "suspended") throw new Error("government_office_status_invalid");
  const previous = office.status ?? "active";
  if (previous === status) return office;
  const timestamp = new Date(now).toISOString();
  office.status = status;
  office.updated_at = timestamp;
  const org = state.governmentOrganisations[office.organisation_id];
  if (org) {
    org.updated_at = timestamp;
    appendGovernmentEvent(state, org.organisation_id, status === "suspended" ? "office_suspended" : "office_reinstated",
      `${office.label} ${status === "suspended" ? "suspended" : "reinstated"}. ${reason.trim()}`.trim(), date, now,
      { office_id: officeId, status, previous_status: previous });
  }
  return office;
}

export function governmentErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    government_writes_suspended: "Changes to government records are temporarily suspended while authorization rules are being implemented. Read-only government information is still available.",
    government_office_not_found: "Government office not found.",
    government_character_not_found: "Character not found.",
    government_character_deceased: "Deceased characters cannot hold government office.",
    government_age_ineligible: "Character does not meet the minimum age requirement for this office.",
    government_office_already_occupied: "This office already has an active occupant.",
    government_office_suspended: "This office is suspended and cannot be filled.",
    government_office_status_invalid: "Invalid office status.",
    government_authority_none: "You do not hold an active office with authority over this organisation.",
    government_authority_scope: "Your office does not cover this organisation.",
    government_appointment_limit_reached: "Character already holds the maximum number of government appointments.",
    government_appointment_not_found: "Appointment not found.",
    government_appointment_not_active: "This appointment is not active.",
    government_organisation_not_found: "Government organisation not found.",
    government_budget_amount_invalid: "Budget amount is outside the allowed range.",
    government_budget_category_invalid: "Invalid budget category.",
    government_budget_not_found: "Budget not found.",
    government_budget_wrong_organisation: "This budget does not belong to the specified organisation.",
    government_insufficient_budget: "Insufficient budget remaining for this expenditure.",
    government_revenue_amount_invalid: "Revenue amount is outside the allowed range.",
    government_revenue_category_invalid: "Invalid revenue category.",
    government_expenditure_amount_invalid: "Expenditure amount is outside the allowed range.",
    government_expenditure_category_invalid: "Invalid expenditure category.",
    government_project_category_invalid: "Invalid project category.",
    government_project_name_invalid: "Project name must be 1–200 characters.",
    government_project_description_invalid: "Project description is too long.",
    government_project_cost_invalid: "Project cost is outside the allowed range.",
    government_project_not_found: "Project not found.",
    government_project_status_invalid: "Invalid project status.",
    government_project_status_transition_invalid: "This status transition is not allowed.",
    government_project_not_fundable: "Project is not in a fundable status.",
    government_funding_amount_invalid: "Funding amount must be at least 1 Naira.",
    government_announcement_title_invalid: "Announcement title must be 1–200 characters.",
    government_announcement_body_invalid: "Announcement body must be 1–5000 characters.",
    government_office_placement_invalid: "This office does not fit its organisation and cannot be filled.",
    government_permission_none: "Your office does not carry this permission.",
    government_age_unknown: "Your age could not be verified for this action.",
    treasury_approval_age_ineligible: "Budget approval requires the office holder to be at least 25 years old.",
    treasury_approval_below_allocation: "The approved ceiling cannot be lower than the amount already allocated.",
    treasury_request_id_required: "A request ID is required for this treasury action.",
    treasury_idempotency_conflict: "This request ID was already used for a different treasury action.",
    treasury_reason_invalid: "A reason of 1–200 characters is required.",
    treasury_destination_invalid: "Invalid payment destination.",
    treasury_destination_not_found: "Payment destination not found.",
    treasury_conflict_of_interest: "You cannot direct public money to yourself or to a business you own.",
    treasury_insufficient_funds: "The organisation's treasury does not hold enough money for this payment.",
    government_budget_not_approved: "This budget has not been approved yet.",
    government_budget_closed: "This budget is closed.",
    government_budget_over_approval: "This allocation would exceed the approved budget.",
    government_organisation_inactive: "This organisation is not active.",
    office_level_mismatch: "This office does not match the level of its organisation.",
    office_institution_incompatible: "This office does not belong to the institution of its organisation.",
    office_scope_incompatible: "This office's scope does not cover its organisation.",
    organisation_kind_unrecognised: "This organisation is not a recognised kind.",
    organisation_missing: "The organisation for this office does not exist.",
    office_definition_missing: "The office definition for this seat no longer exists.",
    government_action_invalid: "Invalid government action.",
    government_action_unknown: "Unknown government action.",
    treasury_destination_unsupported: "Payments can only be made to a person's cash account. Business and organisation payments are not available yet.",
    treasury_not_saved: "The change is recorded on the server but is not saved yet, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
    economy_payee_not_found: "The payment recipient is not a character in this world.",
    economy_payee_deceased: "The payment recipient is deceased and cannot receive payments.",
    economy_payee_account_missing: "The payment recipient has no cash account, so the payment cannot be made.",
    economy_payee_account_inactive: "The payment recipient's cash account is not active.",
    economy_payment_over_transaction_limit: "A single payment to a person cannot exceed the economy's transaction limit.",
    economy_payee_balance_limit: "The payment would take the recipient's cash account over its balance limit.",
  };
  return messages[code] ?? "An unknown government error occurred.";
}
