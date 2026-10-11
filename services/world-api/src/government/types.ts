/**
 * Stage 10 — Government System
 *
 * Types for government organisations, offices, appointments,
 * budgets, revenue, expenditure, projects, and announcements.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type GovernmentLevel = "federal" | "state" | "local";

export type ProjectStatus = "proposed" | "under_review" | "approved" | "funded" | "in_progress" | "completed" | "suspended" | "cancelled";

export type AnnouncementStatus = "draft" | "published" | "archived";

export type AppointmentStatus = "active" | "ended" | "removed";

export type BudgetStatus = "draft" | "approved" | "active" | "closed";

/** An office is active unless suspended. Suspension removes all office authority over it (see authority.ts). */
export type OfficeStatus = "active" | "suspended";

/**
 * The kind of organisation an office may sit in (Stage 31, hierarchy). An office definition names exactly one scope,
 * and it confers authority only over an organisation of that kind. Scopes with no organisation in the model
 * (federal_agency, state_ministry, state_department) match nothing, so offices of those scopes fail closed.
 */
export type OfficeScope =
  | "federal_government"
  | "federal_ministry"
  | "federal_agency"
  | "electoral_commission"
  | "state_government"
  | "state_ministry"
  | "state_department"
  | "local_government";

/** The branch of government an organisation or office belongs to. Legislative and judicial bodies are not modelled here. */
export type Institution = "executive" | "electoral";

/**
 * Where an office definition is placed when the world is seeded. `per_ministry` creates one seat per federal ministry.
 * `null` means no reliable organisation exists, so the office is not seeded (it cannot be placed).
 */
export type SeedOrganisation = "gov:federal" | "gov:electoral" | "per_ministry" | null;

/** Money permissions. Approval, allocation, and spending are separate permissions. */
export type TreasuryPermission = "budget_approve" | "budget_allocate" | "budget_spend";

export interface GovernmentLevelDefinition {
  readonly id: GovernmentLevel;
  readonly label: string;
  readonly description: string;
}

export interface MinistryDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly default_budget_ngn: number;
}

export interface ProjectCategoryDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface BudgetCategoryDefinition {
  readonly id: string;
  readonly label: string;
}

export interface RevenueCategoryDefinition {
  readonly id: string;
  readonly label: string;
}

export interface ExpenditureCategoryDefinition {
  readonly id: string;
  readonly label: string;
}

export interface OfficeDefinition {
  readonly id: string;
  readonly level: GovernmentLevel;
  readonly scope: OfficeScope;
  readonly institution: Institution;
  readonly seed_organisation: SeedOrganisation;
  readonly label: string;
  readonly unique: boolean;
  readonly description: string;
}

export interface GovernmentRules {
  readonly currency: string;
  readonly currency_label: string;
  readonly currency_symbol: string;
  readonly fiscal_year_start_month: number;
  readonly fiscal_year_start_day: number;
  readonly minimum_office_holder_age: number;
  readonly maximum_active_appointments_per_character: number;
  readonly maximum_unique_office_holders: number;
  readonly maximum_ministers_per_federal_government: number;
  readonly maximum_commissioners_per_state: number;
  readonly minimum_budget_amount_ngn: number;
  readonly maximum_budget_amount_ngn: number;
  readonly minimum_project_cost_ngn: number;
  readonly maximum_project_cost_ngn: number;
  readonly minimum_revenue_amount_ngn: number;
  readonly maximum_revenue_amount_ngn: number;
  readonly minimum_expenditure_amount_ngn: number;
  readonly maximum_expenditure_amount_ngn: number;
  readonly maximum_announcements_per_government: number;
  readonly maximum_projects_per_government: number;
  readonly maximum_budgets_per_government: number;
  readonly maximum_budget_history_per_government: number;
  readonly maximum_appointment_history_per_office: number;
  readonly transaction_idempotency_window_seconds: number;
  readonly announcement_max_title_length: number;
  readonly announcement_max_body_length: number;
  readonly project_max_name_length: number;
  readonly project_max_description_length: number;
  readonly project_statuses: readonly ProjectStatus[];
  readonly announcement_statuses: readonly AnnouncementStatus[];
  readonly appointment_statuses: readonly AppointmentStatus[];
  readonly budget_statuses: readonly BudgetStatus[];
  readonly federal_default_annual_budget_ngn: number;
  /** Minimum age (years, on the world date) for directly holding budget-approval authority. Enforced server-side. */
  readonly budget_approval_minimum_age_years: number;
  readonly ministry_budget_category_id: string;
}

export interface IndependentInstitutionDefinition {
  readonly id: string;
  readonly organisation_id: string;
  readonly institution: Institution;
  readonly scope: OfficeScope;
  readonly level: GovernmentLevel;
  readonly label: string;
  readonly description: string;
}

export interface TreasuryFundingRule {
  readonly rule_id: string;
  readonly organisation_id: string;
  readonly category_id: string;
  readonly amount_ngn: number;
  readonly reason: string;
}

export interface GovernmentCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly government_levels: readonly GovernmentLevelDefinition[];
  readonly federal_ministries: readonly MinistryDefinition[];
  readonly project_categories: readonly ProjectCategoryDefinition[];
  readonly budget_categories: readonly BudgetCategoryDefinition[];
  readonly revenue_categories: readonly RevenueCategoryDefinition[];
  readonly expenditure_categories: readonly ExpenditureCategoryDefinition[];
  readonly seed_offices: readonly OfficeDefinition[];
  readonly independent_institutions: readonly IndependentInstitutionDefinition[];
  /**
   * One-time treasury funding (Stage 32). Each rule is applied at most once per world, recorded as a revenue row in the
   * treasury ledger with its rule_id. Amounts come from this catalogue only; no player request can name one.
   */
  readonly treasury_funding: readonly TreasuryFundingRule[];
  /** Permissions held by an office definition. An office confers a permission only within its own organisation. */
  readonly office_permissions: Readonly<Record<string, readonly TreasuryPermission[]>>;
  readonly rules: GovernmentRules;
}

// ─── Persistent record types ──────────────────────────────────────

/**
 * The treasury account of one organisation. Its balance is changed only by the ledger functions in service.ts, and
 * balance = total_credited_ngn - total_debited_ngn always (checked by tests and by the ledger consistency check).
 */
export interface TreasuryAccountRecord {
  readonly account_id: string;
  readonly organisation_id: string;
  readonly level: GovernmentLevel;
  /** The jurisdiction of the owning organisation (state ID, LGA ID, or null for federal). */
  readonly jurisdiction_id: string | null;
  balance_ngn: number;
  total_credited_ngn: number;
  total_debited_ngn: number;
  status: "active";
  readonly opened_world_date: CalendarDate;
  readonly created_at: string;
  updated_at: string;
}

export interface GovernmentOrganisationRecord {
  readonly organisation_id: string;
  level: GovernmentLevel;
  /** Absent means executive (records written before Stage 31 have no field). */
  institution?: Institution | null;
  /** Absent means the organisation has no treasury account yet (created by reconciliation). */
  treasury_account?: TreasuryAccountRecord | null;
  name: string;
  description: string;
  /** For state governments, the state ID (e.g. "ng:state:la"). For FCT, "ng:state:fc". For local, the LGA ID. For federal, null. */
  jurisdiction_id: string | null;
  parent_organisation_id: string | null;
  ministry_id: string | null;
  status: "active" | "inactive" | "dissolved";
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface GovernmentOfficeRecord {
  readonly office_id: string;
  readonly definition_id: string;
  readonly organisation_id: string;
  label: string;
  unique: boolean;
  /** Absent or null means active (records seeded before Stage 30 have no field). */
  status?: OfficeStatus | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentRecord {
  readonly appointment_id: string;
  readonly office_id: string;
  readonly character_id: string;
  status: AppointmentStatus;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  end_reason: string | null;
  appointed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetRecord {
  readonly budget_id: string;
  readonly organisation_id: string;
  fiscal_year: number;
  fiscal_period_label: string;
  category_id: string;
  approved_amount_ngn: number;
  allocated_amount_ngn: number;
  spent_amount_ngn: number;
  status: BudgetStatus;
  approved_at: string | null;
  approved_world_date: CalendarDate | null;
  /** Absent on records written before Stage 31. */
  approved_by_character_id?: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface GovernmentRevenueRecord {
  readonly revenue_id: string;
  readonly organisation_id: string;
  category_id: string;
  amount_ngn: number;
  description: string;
  source_reference: string | null;
  received_at: string;
  received_world_date: CalendarDate;
  idempotency_key: string;
  /** Ledger fields (Stage 31). Absent on older records. */
  account_id?: string | null;
  actor_character_id?: string | null;
  balance_after_ngn?: number | null;
  /** Set only on one-time initial funding rows (Stage 32). Absent on every other revenue row. */
  funding_rule_id?: string | null;
}

export interface GovernmentExpenditureRecord {
  readonly expenditure_id: string;
  readonly organisation_id: string;
  readonly budget_id: string | null;
  readonly project_id: string | null;
  category_id: string;
  amount_ngn: number;
  description: string;
  recipient_reference: string | null;
  spent_at: string;
  spent_world_date: CalendarDate;
  idempotency_key: string;
  /** Ledger fields (Stage 31). Absent on older records. */
  account_id?: string | null;
  actor_character_id?: string | null;
  destination_kind?: "character" | "business" | "organisation" | null;
  destination_id?: string | null;
  request_fingerprint?: string | null;
  balance_after_ngn?: number | null;
  /**
   * Set when a payment to a character was credited to the recipient's cash account in the same write (Stage 32). Absent
   * on older records; an older payment to a character has no recipient_transaction_id and is reported by the audit.
   */
  recipient_account_id?: string | null;
  recipient_transaction_id?: string | null;
}

export interface GovernmentProjectRecord {
  readonly project_id: string;
  readonly organisation_id: string;
  readonly budget_id: string | null;
  category_id: string;
  name: string;
  description: string;
  location_id: string;
  estimated_cost_ngn: number;
  approved_funding_ngn: number;
  actual_spent_ngn: number;
  status: ProjectStatus;
  progress_percent: number;
  start_date: string | null;
  start_world_date: CalendarDate | null;
  planned_completion: string | null;
  actual_completion: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface GovernmentAnnouncementRecord {
  readonly announcement_id: string;
  readonly organisation_id: string;
  readonly project_id: string | null;
  title: string;
  body: string;
  scope_level: GovernmentLevel;
  scope_jurisdiction_id: string | null;
  status: AnnouncementStatus;
  published_at: string | null;
  published_world_date: CalendarDate | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface GovernmentEventRecord {
  readonly event_id: string;
  readonly organisation_id: string;
  readonly type: string;
  readonly world_date: CalendarDate;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentGovernmentMaps {
  governmentOrganisations: Record<string, GovernmentOrganisationRecord>;
  governmentOffices: Record<string, GovernmentOfficeRecord>;
  governmentAppointments: Record<string, AppointmentRecord>;
  governmentBudgets: Record<string, BudgetRecord>;
  governmentRevenue: Record<string, GovernmentRevenueRecord>;
  governmentExpenditure: Record<string, GovernmentExpenditureRecord>;
  governmentProjects: Record<string, GovernmentProjectRecord>;
  governmentAnnouncements: Record<string, GovernmentAnnouncementRecord>;
  governmentEvents: Record<string, GovernmentEventRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface GovernmentOrganisationSnapshot {
  readonly organisation_id: string;
  readonly level: GovernmentLevel;
  readonly name: string;
  readonly description: string;
  readonly jurisdiction_id: string | null;
  readonly parent_organisation_id: string | null;
  readonly ministry_id: string | null;
  readonly status: string;
  readonly active_offices: readonly GovernmentOfficeRecord[];
  readonly active_appointments: readonly AppointmentSnapshot[];
  readonly latest_budget: BudgetRecord | null;
  readonly project_count: number;
  readonly announcement_count: number;
}

export interface AppointmentSnapshot {
  readonly appointment_id: string;
  readonly office_id: string;
  readonly office_label: string;
  readonly character_id: string;
  readonly status: AppointmentStatus;
  readonly start_date: string;
  readonly end_date: string | null;
}

export interface GovernmentProjectSnapshot {
  readonly project_id: string;
  readonly organisation_id: string;
  readonly category_id: string;
  readonly name: string;
  readonly description: string;
  readonly location_id: string;
  readonly estimated_cost_ngn: number;
  readonly approved_funding_ngn: number;
  readonly actual_spent_ngn: number;
  readonly status: ProjectStatus;
  readonly progress_percent: number;
  readonly start_date: string | null;
  readonly planned_completion: string | null;
  readonly actual_completion: string | null;
}

export interface GovernmentAnnouncementSnapshot {
  readonly announcement_id: string;
  readonly organisation_id: string;
  readonly title: string;
  readonly body: string;
  readonly scope_level: GovernmentLevel;
  readonly scope_jurisdiction_id: string | null;
  readonly status: AnnouncementStatus;
  readonly published_at: string | null;
}

export interface FederalGovernmentSnapshot {
  readonly federal_organisation: GovernmentOrganisationSnapshot;
  readonly ministries: readonly GovernmentOrganisationSnapshot[];
  readonly president: AppointmentSnapshot | null;
  readonly vice_president: AppointmentSnapshot | null;
  readonly recent_announcements: readonly GovernmentAnnouncementSnapshot[];
  readonly active_projects: readonly GovernmentProjectSnapshot[];
}

export interface StateGovernmentSnapshot {
  readonly state_organisation: GovernmentOrganisationSnapshot;
  readonly governor: AppointmentSnapshot | null;
  readonly deputy_governor: AppointmentSnapshot | null;
  readonly departments: readonly GovernmentOrganisationSnapshot[];
  readonly recent_announcements: readonly GovernmentAnnouncementSnapshot[];
  readonly active_projects: readonly GovernmentProjectSnapshot[];
}

export interface LocalGovernmentSnapshot {
  readonly local_organisation: GovernmentOrganisationSnapshot;
  readonly chairman: AppointmentSnapshot | null;
  readonly recent_announcements: readonly GovernmentAnnouncementSnapshot[];
  readonly active_projects: readonly GovernmentProjectSnapshot[];
}
