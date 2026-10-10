/**
 * Stage 13 — Police and Security System
 *
 * Types for police organizations, stations, officers, recruitment,
 * incidents, dispatch, investigations, wanted records, arrests,
 * misconduct, and audit records.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type PoliceLevelId = "national" | "state" | "division" | "station";
export type RankId = "constable" | "corporal" | "sergeant" | "inspector" | "chief_inspector" | "superintendent" | "chief_superintendent" | "assistant_commissioner" | "deputy_commissioner" | "commissioner";
export type IncidentCategoryId = "theft" | "assault" | "property_damage" | "fraud" | "disturbance" | "missing_person" | "traffic_incident" | "public_safety" | "business_complaint" | "suspicious_activity" | "domestic_dispute" | "vandalism" | "noise_complaint" | "other";
export type DispatchPriorityId = "low" | "normal" | "high" | "emergency";
export type MisconductCategoryId = "unauthorized_arrest" | "improper_access" | "evidence_tampering" | "abuse_of_authority" | "unauthorized_disclosure" | "corruption_allegation" | "procedural_failure" | "neglect_of_duty" | "other";
export type ComplaintOutcomeId = "no_finding" | "advisory" | "training_required" | "formal_warning" | "restricted_permissions" | "suspension" | "demotion" | "dismissal" | "legal_referral";

export type IncidentStatusId = "draft" | "submitted" | "awaiting_triage" | "accepted" | "rejected" | "assigned" | "under_review" | "under_investigation" | "referred" | "resolved" | "closed";
export type DispatchStatusId = "awaiting_dispatch" | "awaiting_unit" | "assigned" | "acknowledged" | "en_route" | "at_location" | "handling" | "resolved" | "cancelled";
export type InvestigationStatusId = "pending_assignment" | "assigned" | "active" | "awaiting_info" | "awaiting_evidence" | "suspended" | "referred" | "closed" | "reopened";
export type WantedStatusId = "requested" | "under_review" | "authorized" | "active" | "suspended" | "cancelled" | "expired" | "resolved";
export type ArrestStatusId = "requested" | "awaiting_auth" | "authorized" | "executed" | "awaiting_processing" | "referred" | "released" | "cancelled" | "invalidated";
export type ComplaintStatusId = "submitted" | "under_review" | "assigned" | "investigating" | "findings" | "resolved" | "closed" | "escalated";
export type OfficerStatusId = "active" | "on_duty" | "off_duty" | "suspended" | "dismissed" | "resigned" | "retired";

export interface RankDefinition { readonly id: RankId; readonly label: string; readonly level: number; readonly description: string; }
export interface PoliceLevelDefinition { readonly id: PoliceLevelId; readonly label: string; readonly description: string; }
export interface IncidentCategoryDefinition { readonly id: IncidentCategoryId; readonly label: string; }
export interface DispatchPriorityDefinition { readonly id: DispatchPriorityId; readonly label: string; }
export interface MisconductCategoryDefinition { readonly id: MisconductCategoryId; readonly label: string; }
export interface TrainingModuleDefinition { readonly id: string; readonly label: string; }
export interface ComplaintOutcomeDefinition { readonly id: ComplaintOutcomeId; readonly label: string; }

export interface PoliceRules {
  readonly minimum_recruitment_age: number;
  readonly minimum_rank_age: Record<RankId, number>;
  readonly minimum_education_for_recruitment: string;
  readonly training_duration_days: number;
  readonly incident_description_max_length: number;
  readonly incident_summary_max_length: number;
  readonly investigation_summary_max_length: number;
  readonly complaint_description_max_length: number;
  readonly dispatch_notes_max_length: number;
  readonly wanted_reason_max_length: number;
  readonly arrest_reason_max_length: number;
  readonly evidence_description_max_length: number;
  readonly max_incidents_per_station: number;
  readonly max_investigations_per_officer: number;
  readonly max_dispatch_per_station: number;
  readonly max_wanted_records: number;
  readonly max_evidence_per_incident: number;
  readonly report_duplicate_window_hours: number;
  readonly supported_government_levels: readonly string[];
}

export interface SeedStation {
  readonly id: string;
  readonly name: string;
  readonly level: PoliceLevelId;
  readonly jurisdiction: string | null;
  readonly parent_unit_id: string | null;
  readonly status: string;
}

export interface PoliceCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly police_levels: readonly PoliceLevelDefinition[];
  readonly ranks: readonly RankDefinition[];
  readonly incident_categories: readonly IncidentCategoryDefinition[];
  readonly dispatch_priorities: readonly DispatchPriorityDefinition[];
  readonly misconduct_categories: readonly MisconductCategoryDefinition[];
  readonly training_modules: readonly TrainingModuleDefinition[];
  readonly complaint_outcomes: readonly ComplaintOutcomeDefinition[];
  readonly rules: PoliceRules;
  readonly seed_stations: readonly SeedStation[];
}

// ─── Persistent record types ──────────────────────────────────────

export interface PoliceUnitRecord {
  readonly unit_id: string;
  name: string;
  level: PoliceLevelId;
  jurisdiction: string | null;
  parent_unit_id: string | null;
  status: "active" | "inactive" | "suspended";
  commanding_officer_id: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface PoliceOfficerRecord {
  readonly officer_id: string;
  readonly character_id: string;
  readonly station_id: string;
  rank: RankId;
  status: OfficerStatusId;
  badge_number: string;
  training_completed: string[];
  joined_at: string;
  joined_world_date: CalendarDate;
  appointed_by: string | null;
  updated_at: string;
}

export interface RecruitmentRecord {
  readonly application_id: string;
  readonly character_id: string;
  readonly station_id: string;
  status: "submitted" | "under_review" | "accepted" | "rejected" | "training" | "completed";
  education_verified: boolean;
  training_completed: string[];
  applied_at: string;
  applied_world_date: CalendarDate;
  decided_at: string | null;
  decided_world_date: CalendarDate | null;
  decided_by: string | null;
  decision_reason: string | null;
  updated_at: string;
}

export interface IncidentRecord {
  readonly incident_id: string;
  reference_number: string;
  category: IncidentCategoryId;
  description: string;
  summary: string;
  reporter_character_id: string | null;
  reported_character_id: string | null;
  location_id: string | null;
  jurisdiction: string | null;
  incident_date: string;
  reported_at: string;
  reported_world_date: CalendarDate;
  assigned_station_id: string | null;
  assigned_officer_id: string | null;
  priority: DispatchPriorityId;
  status: IncidentStatusId;
  related_case_id: string | null;
  related_property_id: string | null;
  related_business_id: string | null;
  confidentiality: "public" | "confidential" | "anonymous";
  outcome: string | null;
  closed_at: string | null;
  closed_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface DispatchRecord {
  readonly dispatch_id: string;
  readonly incident_id: string;
  readonly station_id: string;
  readonly requesting_officer_id: string | null;
  priority: DispatchPriorityId;
  location_id: string | null;
  assigned_unit_id: string | null;
  assigned_officer_id: string | null;
  status: DispatchStatusId;
  notes: string;
  dispatched_at: string;
  dispatched_world_date: CalendarDate;
  arrived_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvestigationRecord {
  readonly investigation_id: string;
  readonly incident_id: string;
  readonly case_id: string | null;
  readonly station_id: string;
  readonly lead_officer_id: string;
  participant_officer_ids: string[];
  category: IncidentCategoryId;
  summary: string;
  status: InvestigationStatusId;
  relevant_law_ids: string[];
  evidence_ids: string[];
  witness_character_ids: string[];
  timeline: Array<{ date: string; officer_id: string; action: string; summary: string }>;
  suspension_reason: string | null;
  referral_target: string | null;
  closure_outcome: string | null;
  opened_at: string;
  opened_world_date: CalendarDate;
  closed_at: string | null;
  closed_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface PoliceEvidenceRecord {
  readonly evidence_id: string;
  readonly incident_id: string;
  readonly investigation_id: string | null;
  readonly case_id: string | null;
  readonly justice_evidence_id: string | null;
  category: string;
  description: string;
  source_reference: string | null;
  collected_by_officer_id: string;
  collected_at: string;
  collected_world_date: CalendarDate;
  custody_chain: Array<{ officer_id: string; event: string; date: string }>;
  current_custodian_officer_id: string;
  integrity_status: "unverified" | "verified" | "challenged" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface WantedRecord {
  readonly wanted_id: string;
  readonly character_id: string;
  readonly incident_id: string | null;
  readonly investigation_id: string | null;
  readonly case_id: string | null;
  reason: string;
  legal_basis: string;
  issuing_officer_id: string;
  jurisdiction: string | null;
  status: WantedStatusId;
  priority: DispatchPriorityId;
  issued_at: string;
  issued_world_date: CalendarDate;
  authorized_at: string | null;
  authorized_by: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  resolved_at: string | null;
  resolved_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArrestRecord {
  readonly arrest_id: string;
  readonly character_id: string;
  readonly arresting_officer_id: string;
  readonly incident_id: string | null;
  readonly investigation_id: string | null;
  readonly case_id: string | null;
  readonly wanted_id: string | null;
  reason: string;
  legal_basis: string;
  location_id: string | null;
  status: ArrestStatusId;
  arrested_at: string;
  arrested_world_date: CalendarDate;
  processed_at: string | null;
  processed_world_date: CalendarDate | null;
  released_at: string | null;
  released_world_date: CalendarDate | null;
  release_reason: string | null;
  referred_case_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MisconductComplaintRecord {
  readonly complaint_id: string;
  readonly complainant_character_id: string | null;
  readonly accused_officer_id: string;
  readonly incident_id: string | null;
  readonly arrest_id: string | null;
  category: MisconductCategoryId;
  description: string;
  evidence_references: string[];
  status: ComplaintStatusId;
  assigned_reviewer_id: string | null;
  findings: string | null;
  outcome: ComplaintOutcomeId | null;
  submitted_at: string;
  submitted_world_date: CalendarDate;
  resolved_at: string | null;
  resolved_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface PoliceAuditRecord {
  readonly audit_id: string;
  category: string;
  station_id: string | null;
  officer_id: string | null;
  incident_id: string | null;
  investigation_id: string | null;
  arrest_id: string | null;
  wanted_id: string | null;
  complaint_id: string | null;
  actor_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentPoliceMaps {
  policeUnits: Record<string, PoliceUnitRecord>;
  policeOfficers: Record<string, PoliceOfficerRecord>;
  recruitmentApplications: Record<string, RecruitmentRecord>;
  policeIncidents: Record<string, IncidentRecord>;
  dispatches: Record<string, DispatchRecord>;
  investigations: Record<string, InvestigationRecord>;
  policeEvidence: Record<string, PoliceEvidenceRecord>;
  wantedRecords: Record<string, WantedRecord>;
  arrestRecords: Record<string, ArrestRecord>;
  misconductComplaints: Record<string, MisconductComplaintRecord>;
  policeAudits: Record<string, PoliceAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface PoliceStationSnapshot {
  readonly unit_id: string;
  readonly name: string;
  readonly level: PoliceLevelId;
  readonly jurisdiction: string | null;
  readonly status: string;
  readonly officer_count: number;
  readonly active_incident_count: number;
  readonly active_investigation_count: number;
  readonly active_dispatch_count: number;
}

export interface OfficerSnapshot {
  readonly officer_id: string;
  readonly character_id: string;
  readonly station_id: string;
  readonly station_name: string;
  readonly rank: RankId;
  readonly rank_label: string;
  readonly status: OfficerStatusId;
  readonly badge_number: string;
  readonly training_completed: readonly string[];
  readonly active_investigation_count: number;
}

export interface IncidentSnapshot {
  readonly incident_id: string;
  readonly reference_number: string;
  readonly category: IncidentCategoryId;
  readonly summary: string;
  readonly reporter_character_id: string | null;
  readonly reported_character_id: string | null;
  readonly location_id: string | null;
  readonly assigned_station_id: string | null;
  readonly assigned_officer_id: string | null;
  readonly priority: DispatchPriorityId;
  readonly status: IncidentStatusId;
  readonly reported_at: string;
  readonly related_case_id: string | null;
}

export interface InvestigationSnapshot {
  readonly investigation_id: string;
  readonly incident_id: string;
  readonly case_id: string | null;
  readonly station_id: string;
  readonly lead_officer_id: string;
  readonly category: IncidentCategoryId;
  readonly summary: string;
  readonly status: InvestigationStatusId;
  readonly evidence_count: number;
  readonly witness_count: number;
  readonly opened_at: string;
  readonly closed_at: string | null;
}

export interface PoliceProfileSnapshot {
  readonly character_id: string;
  readonly is_officer: boolean;
  readonly officer_id: string | null;
  readonly station_id: string | null;
  readonly rank: RankId | null;
  readonly rank_label: string | null;
  readonly status: OfficerStatusId | null;
  readonly badge_number: string | null;
  readonly assigned_incidents: readonly IncidentSnapshot[];
  readonly active_investigations: readonly InvestigationSnapshot[];
  readonly misconduct_complaints_count: number;
}
