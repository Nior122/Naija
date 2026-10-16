/**
 * Stage 14 — Military System
 *
 * Types for military organizations, service branches, ranks,
 * recruitment, training, qualifications, assignments, equipment,
 * national-security events, discipline, and audit records.
 *
 * Military reports ≠ convictions. Allegations are not findings.
 * All actions are server-authoritative.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type ServiceBranchId = "army" | "navy" | "air_force";
export type RankCategoryId = "enlisted" | "warrant" | "officer" | "general" | "flag" | "air_officer";
export type BaseCategoryId = "administrative" | "training" | "naval_installation" | "air_facility" | "logistics" | "medical" | "support" | "operational";
export type UnitCategoryId = "infantry" | "armoured" | "artillery" | "engineers" | "signals" | "logistics_unit" | "medical_unit" | "naval_vessel" | "naval_squadron" | "air_squadron" | "air_wing" | "special_forces" | "headquarters" | "training_unit";
export type AssignmentTypeId = "administrative_duty" | "training_duty" | "logistics_duty" | "base_support" | "medical_support" | "engineering_support" | "operations_duty" | "community_assistance" | "emergency_response_duty" | "headquarters_duty";
export type EquipmentCategoryId = "uniforms" | "communications_equipment" | "administrative_equipment" | "medical_supplies" | "engineering_equipment" | "logistics_assets" | "service_vehicles" | "training_equipment" | "naval_equipment" | "aviation_equipment";
export type NationalSecurityEventCategoryId = "emergency_preparedness" | "natural_disaster_assistance" | "infrastructure_protection" | "humanitarian_support" | "border_security" | "national_emergency" | "public_safety_support" | "civilian_assistance";
export type DisciplinaryOutcomeId = "no_finding" | "warning" | "retraining_required" | "restricted_assignment" | "forfeiture_of_privileges" | "suspension" | "demotion" | "discharge" | "legal_referral";

export type ServiceMemberStatusId = "active" | "on_duty" | "on_leave" | "suspended" | "discharged" | "retired" | "resigned" | "deceased";
export type ApplicationStatusId = "draft" | "submitted" | "under_review" | "awaiting_requirements" | "approved" | "rejected" | "withdrawn" | "closed";
export type TrainingStatusId = "enrolled" | "in_progress" | "completed" | "failed" | "withdrawn";
export type AssignmentStatusId = "active" | "completed" | "transferred" | "suspended" | "cancelled";
export type AssetStatusId = "serviceable" | "assigned" | "in_maintenance" | "unserviceable" | "retired" | "missing";
export type DisciplinaryCaseStatusId = "submitted" | "under_review" | "investigation_pending" | "awaiting_response" | "awaiting_decision" | "decision_issued" | "appealed" | "closed";
export type NationalSecurityEventStatusId = "proposed" | "approved" | "active" | "standby" | "resolved" | "cancelled";
export type LeaveStatusId = "requested" | "approved" | "rejected" | "cancelled" | "completed";

export interface ServiceBranchDefinition { readonly id: ServiceBranchId; readonly label: string; readonly description: string; }
export interface RankDefinition { readonly id: string; readonly label: string; readonly level: number; readonly category: RankCategoryId; }
export interface BaseCategoryDefinition { readonly id: BaseCategoryId; readonly label: string; }
export interface UnitCategoryDefinition { readonly id: UnitCategoryId; readonly label: string; }
export interface TrainingCourseDefinition { readonly id: string; readonly label: string; readonly duration_days: number; readonly branch: ServiceBranchId | "all"; readonly prerequisite_rank: string | null; readonly prerequisite_rank_level?: number | null; readonly prerequisite_education?: string | null; readonly description: string; }
export interface AssignmentTypeDefinition { readonly id: AssignmentTypeId; readonly label: string; }
export interface EquipmentCategoryDefinition { readonly id: EquipmentCategoryId; readonly label: string; }
export interface NationalSecurityEventCategoryDefinition { readonly id: NationalSecurityEventCategoryId; readonly label: string; }
export interface DisciplinaryOutcomeDefinition { readonly id: DisciplinaryOutcomeId; readonly label: string; }

export interface MilitaryRules {
  readonly minimum_recruitment_age: number;
  readonly minimum_education_for_recruitment: string;
  readonly basic_training_duration_days: number;
  readonly minimum_time_in_rank_days: Record<string, number>;
  readonly maximum_active_assignments_per_person: number;
  readonly maximum_leave_days_per_year: number;
  readonly leave_approval_authority_min_rank_level: number;
  readonly description_max_length: number;
  readonly summary_max_length: number;
  readonly reason_max_length: number;
  readonly maximum_personnel_per_unit: number;
  readonly maximum_equipment_per_unit: number;
  readonly maximum_disciplinary_cases_per_person: number;
}

export interface SeedOrganization {
  readonly id: string;
  readonly name: string;
  readonly branch: ServiceBranchId | null;
  readonly org_type: string;
  readonly parent_id: string | null;
  readonly description: string;
}

export interface SeedBase {
  readonly id: string;
  readonly name: string;
  readonly category: BaseCategoryId;
  readonly branch: ServiceBranchId | null;
  readonly state_id: string;
  readonly location_id: string;
  readonly parent_org_id: string;
  readonly description: string;
}

export interface MilitaryCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly service_branches: readonly ServiceBranchDefinition[];
  readonly rank_categories: Record<ServiceBranchId, readonly RankDefinition[]>;
  readonly base_categories: readonly BaseCategoryDefinition[];
  readonly unit_categories: readonly UnitCategoryDefinition[];
  readonly training_courses: readonly TrainingCourseDefinition[];
  readonly assignment_types: readonly AssignmentTypeDefinition[];
  readonly equipment_categories: readonly EquipmentCategoryDefinition[];
  readonly national_security_event_categories: readonly NationalSecurityEventCategoryDefinition[];
  readonly disciplinary_outcomes: readonly DisciplinaryOutcomeDefinition[];
  readonly rules: MilitaryRules;
  readonly seed_organizations: readonly SeedOrganization[];
  readonly seed_bases: readonly SeedBase[];
}

// ─── Persistent record types ──────────────────────────────────────

export interface MilitaryOrganizationRecord {
  readonly org_id: string;
  name: string;
  branch: ServiceBranchId | null;
  org_type: string;
  parent_org_id: string | null;
  base_id: string | null;
  commanding_officer_id: string | null;
  status: "active" | "inactive" | "suspended";
  description: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface MilitaryBaseRecord {
  readonly base_id: string;
  name: string;
  category: BaseCategoryId;
  branch: ServiceBranchId | null;
  state_id: string;
  location_id: string;
  parent_org_id: string | null;
  status: "active" | "inactive" | "suspended";
  description: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface MilitaryUnitRecord {
  readonly unit_id: string;
  name: string;
  branch: ServiceBranchId;
  unit_category: UnitCategoryId;
  parent_org_id: string | null;
  base_id: string | null;
  commanding_officer_id: string | null;
  personnel_count: number;
  status: "active" | "inactive" | "deployed" | "standby";
  description: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface MilitaryRecruitmentRecord {
  readonly application_id: string;
  readonly character_id: string;
  branch: ServiceBranchId;
  status: ApplicationStatusId;
  education_verified: boolean;
  age_verified: boolean;
  required_training: string[];
  completed_training: string[];
  reviewing_authority: string | null;
  applied_at: string;
  applied_world_date: CalendarDate;
  decided_at: string | null;
  decided_world_date: CalendarDate | null;
  decision_reason: string | null;
  service_record_id: string | null;
  updated_at: string;
}

export interface MilitaryServiceRecord {
  readonly service_id: string;
  readonly character_id: string;
  branch: ServiceBranchId;
  rank: string;
  status: ServiceMemberStatusId;
  service_number: string;
  org_id: string | null;
  unit_id: string | null;
  base_id: string | null;
  current_assignment_id: string | null;
  training_completed: string[];
  qualifications: string[];
  joined_at: string;
  joined_world_date: CalendarDate;
  rank_since: string;
  rank_since_world_date: CalendarDate;
  updated_at: string;
}

export interface MilitaryTrainingRecord {
  readonly training_record_id: string;
  readonly character_id: string;
  readonly service_id: string | null;
  course_id: string;
  branch: ServiceBranchId;
  status: TrainingStatusId;
  enrolled_at: string;
  enrolled_world_date: CalendarDate;
  completed_at: string | null;
  completed_world_date: CalendarDate | null;
  assessment_result: "pass" | "fail" | null;
  instructor_id: string | null;
  institution_id: string | null;
  updated_at: string;
}

export interface MilitaryRankHistoryRecord {
  readonly record_id: string;
  readonly service_id: string;
  from_rank: string | null;
  to_rank: string;
  branch: ServiceBranchId;
  effective_date: string;
  effective_world_date: CalendarDate;
  authority: string | null;
  reason: string;
  record_type: "promotion" | "demotion" | "initial";
  created_at: string;
}

export interface MilitaryCommandAppointmentRecord {
  readonly appointment_id: string;
  readonly character_id: string;
  readonly service_id: string;
  org_id: string;
  role: string;
  appointing_authority: string | null;
  effective_date: string;
  effective_world_date: CalendarDate;
  expiration_date: string | null;
  status: "active" | "expired" | "revoked";
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface MilitaryAssignmentRecord {
  readonly assignment_id: string;
  readonly character_id: string;
  readonly service_id: string;
  unit_id: string | null;
  base_id: string | null;
  assignment_type: AssignmentTypeId;
  status: AssignmentStatusId;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  assigned_by: string | null;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface MilitaryLeaveRecord {
  readonly leave_id: string;
  readonly character_id: string;
  readonly service_id: string;
  leave_type: string;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string;
  end_world_date: CalendarDate;
  status: LeaveStatusId;
  approved_by: string | null;
  reason: string;
  created_at: string;
  updated_at: string;
}

export interface MilitaryAssetRecord {
  readonly asset_id: string;
  name: string;
  category: EquipmentCategoryId;
  org_id: string | null;
  unit_id: string | null;
  base_id: string | null;
  status: AssetStatusId;
  custodian_service_id: string | null;
  assigned_to_service_id: string | null;
  assignment_history: Array<{ event: string; service_id: string | null; date: string }>;
  maintenance_status: "current" | "overdue" | "in_progress";
  description: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface NationalSecurityEventRecord {
  readonly event_id: string;
  category: NationalSecurityEventCategoryId;
  title: string;
  description: string;
  jurisdiction: string | null;
  state_id: string | null;
  status: NationalSecurityEventStatusId;
  authorizing_authority: string | null;
  participating_org_ids: string[];
  assigned_asset_ids: string[];
  public_info: string | null;
  started_at: string | null;
  started_world_date: CalendarDate | null;
  resolved_at: string | null;
  resolved_world_date: CalendarDate | null;
  resolution: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface MilitaryDisciplinaryRecord {
  readonly case_id: string;
  readonly accused_service_id: string;
  readonly accused_character_id: string;
  related_incident_id: string | null;
  alleged_conduct: string;
  evidence_references: string[];
  reviewing_authority: string | null;
  status: DisciplinaryCaseStatusId;
  findings: string | null;
  outcome: DisciplinaryOutcomeId | null;
  consequences: string | null;
  submitted_at: string;
  submitted_world_date: CalendarDate;
  decided_at: string | null;
  decided_world_date: CalendarDate | null;
  appealed_at: string | null;
  closed_at: string | null;
  closed_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface MilitaryAuditRecord {
  readonly audit_id: string;
  category: string;
  org_id: string | null;
  base_id: string | null;
  unit_id: string | null;
  service_id: string | null;
  character_id: string | null;
  asset_id: string | null;
  event_id: string | null;
  case_id: string | null;
  actor_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentMilitaryMaps {
  militaryOrganizations: Record<string, MilitaryOrganizationRecord>;
  militaryBases: Record<string, MilitaryBaseRecord>;
  militaryUnits: Record<string, MilitaryUnitRecord>;
  militaryRecruitments: Record<string, MilitaryRecruitmentRecord>;
  militaryServiceRecords: Record<string, MilitaryServiceRecord>;
  militaryTrainingRecords: Record<string, MilitaryTrainingRecord>;
  militaryRankHistory: Record<string, MilitaryRankHistoryRecord>;
  militaryCommandAppointments: Record<string, MilitaryCommandAppointmentRecord>;
  militaryAssignments: Record<string, MilitaryAssignmentRecord>;
  militaryLeaveRecords: Record<string, MilitaryLeaveRecord>;
  militaryAssets: Record<string, MilitaryAssetRecord>;
  nationalSecurityEvents: Record<string, NationalSecurityEventRecord>;
  militaryDisciplinaryRecords: Record<string, MilitaryDisciplinaryRecord>;
  militaryAudits: Record<string, MilitaryAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface MilitaryBaseSnapshot {
  readonly base_id: string;
  readonly name: string;
  readonly category: BaseCategoryId;
  readonly branch: ServiceBranchId | null;
  readonly state_id: string;
  readonly status: string;
  readonly parent_org_id: string | null;
  readonly personnel_count: number;
  readonly asset_count: number;
}

export interface MilitaryUnitSnapshot {
  readonly unit_id: string;
  readonly name: string;
  readonly branch: ServiceBranchId;
  readonly unit_category: UnitCategoryId;
  readonly base_id: string | null;
  readonly status: string;
  readonly personnel_count: number;
  readonly commanding_officer_id: string | null;
}

export interface MilitaryServiceSnapshot {
  readonly service_id: string;
  readonly character_id: string;
  readonly branch: ServiceBranchId;
  readonly rank: string;
  readonly rank_label: string;
  readonly status: ServiceMemberStatusId;
  readonly service_number: string;
  readonly org_id: string | null;
  readonly unit_id: string | null;
  readonly base_id: string | null;
  readonly base_name: string | null;
  readonly training_completed: readonly string[];
  readonly qualifications: readonly string[];
  readonly joined_at: string;
}

export interface MilitaryProfileSnapshot {
  readonly character_id: string;
  readonly is_service_member: boolean;
  readonly service_id: string | null;
  readonly branch: ServiceBranchId | null;
  readonly rank: string | null;
  readonly rank_label: string | null;
  readonly status: ServiceMemberStatusId | null;
  readonly service_number: string | null;
  readonly org_id: string | null;
  readonly unit_id: string | null;
  readonly base_id: string | null;
  readonly base_name: string | null;
  readonly current_assignment_type: AssignmentTypeId | null;
  readonly training_completed: readonly string[];
  readonly qualifications: readonly string[];
  readonly active_assignments: readonly MilitaryAssignmentRecord[];
  readonly disciplinary_cases_count: number;
  readonly pending_leave_count: number;
}
