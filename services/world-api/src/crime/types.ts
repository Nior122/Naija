/**
 * Stage 15 — Crime and Consequences System
 *
 * Types for crime definitions, incidents, participation, criminal records,
 * notoriety, consequences, and audit records.
 *
 * This system integrates with police (Stage 13) and justice (Stage 12).
 * Crime incidents are NOT convictions. Allegations are NOT established facts.
 * All actions are server-authoritative.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type CrimeCategoryId = "theft" | "fraud" | "robbery" | "property_damage" | "extortion" | "smuggling" | "organized_crime" | "corruption" | "kidnapping" | "assault" | "cybercrime" | "financial_crime" | "public_misconduct" | "vandalism";
export type CrimeSeverityId = "minor" | "moderate" | "serious" | "severe";
export type CrimeIncidentStatusId = "created" | "reported" | "under_review" | "investigation_open" | "referred_to_court" | "resolved" | "closed";
export type ParticipantRoleId = "suspect" | "accused" | "victim" | "witness" | "reporter" | "investigator";
export type CrimeOutcomeId = "successful_completion" | "failed_attempt" | "partial_success" | "detected" | "witness_aware" | "referred_to_police" | "referred_to_court" | "dismissed" | "acquitted" | "convicted" | "settled" | "appealed" | "overturned";

export interface CrimeCategoryDefinition { readonly id: CrimeCategoryId; readonly label: string; readonly severity: CrimeSeverityId; readonly description: string; }
export interface CrimeSeverityDefinition { readonly id: CrimeSeverityId; readonly label: string; readonly base_detection_chance: number; readonly base_fine_min: number; readonly base_fine_max: number; }
export interface CrimeDefinition {
  readonly id: string;
  readonly category: CrimeCategoryId;
  readonly label: string;
  readonly min_value: number;
  readonly max_value: number;
  readonly severity: CrimeSeverityId;
  readonly police_category: string;
  readonly justice_case_category: string;
  readonly requires_target_character?: boolean;
  readonly requires_target_property?: boolean;
  readonly requires_target_business?: boolean;
  readonly cooldown_hours: number;
}
export interface CrimeIncidentStatusDefinition { readonly id: CrimeIncidentStatusId; readonly label: string; }

export interface CrimeRules {
  readonly minimum_age_for_crime_action: number;
  readonly victim_targeting_cooldown_hours: number;
  readonly max_reports_per_hour: number;
  readonly max_crime_actions_per_day: number;
  readonly new_player_protection_days: number;
  readonly new_player_protection_min_age: number;
  readonly offline_protection_loss_limit_percent: number;
  readonly description_max_length: number;
  readonly summary_max_length: number;
  readonly reason_max_length: number;
  readonly max_participants_per_incident: number;
  readonly max_victims_per_incident: number;
  readonly max_evidence_per_incident: number;
  readonly max_incidents_per_day_per_character: number;
  readonly notoriety_decay_rate_per_day: number;
  readonly notoriety_threshold_for_attention: number;
  readonly reputation_impact_minor: number;
  readonly reputation_impact_moderate: number;
  readonly reputation_impact_serious: number;
  readonly reputation_impact_severe: number;
  readonly rehabilitation_min_days: number;
  readonly rehabilitation_max_days: number;
}

export interface ConsequenceRules {
  readonly criminal_record_retention_years: number;
  readonly employment_background_check_categories: readonly CrimeCategoryId[];
  readonly political_disqualification_categories: readonly CrimeCategoryId[];
  readonly business_license_impact_categories: readonly CrimeCategoryId[];
  readonly restitution_percentage: number;
  readonly rehabilitation_reputation_recovery_per_day: number;
}

export interface CrimeCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly crime_categories: readonly CrimeCategoryDefinition[];
  readonly crime_severities: readonly CrimeSeverityDefinition[];
  readonly crime_definitions: readonly CrimeDefinition[];
  readonly incident_statuses: readonly CrimeIncidentStatusDefinition[];
  readonly valid_transitions: Record<CrimeIncidentStatusId, readonly CrimeIncidentStatusId[]>;
  readonly rules: CrimeRules;
  readonly consequence_rules: ConsequenceRules;
}

// ─── Persistent record types ──────────────────────────────────────

export interface CrimeIncidentRecord {
  readonly incident_id: string;
  crime_definition_id: string;
  category: CrimeCategoryId;
  severity: CrimeSeverityId;
  status: CrimeIncidentStatusId;
  description: string;
  summary: string;
  location_id: string | null;
  state_id: string | null;
  value_involved: number;
  perpetrator_character_id: string | null;
  victim_character_id: string | null;
  victim_property_id: string | null;
  victim_business_id: string | null;
  police_incident_id: string | null;
  police_investigation_id: string | null;
  justice_case_id: string | null;
  evidence_ids: string[];
  witness_character_ids: string[];
  participant_character_ids: string[];
  detection_roll: number | null;
  detected: boolean;
  outcome: CrimeOutcomeId | null;
  outcome_reason: string | null;
  financial_loss: number;
  financial_recovery: number;
  created_at: string;
  created_world_date: CalendarDate;
  reported_at: string | null;
  resolved_at: string | null;
  resolved_world_date: CalendarDate | null;
  closed_at: string | null;
  closed_world_date: CalendarDate | null;
  updated_at: string;
}

export interface CrimeParticipationRecord {
  readonly participation_id: string;
  readonly incident_id: string;
  readonly character_id: string;
  role: ParticipantRoleId;
  is_npc: boolean;
  npc_id: string | null;
  description: string;
  added_at: string;
  added_world_date: CalendarDate;
  updated_at: string;
}

export interface CrimeEvidenceRecord {
  readonly evidence_id: string;
  readonly incident_id: string;
  readonly police_evidence_id: string | null;
  evidence_type: string;
  source_description: string;
  source_reference: string | null;
  collected_by: string | null;
  collected_at: string;
  collected_world_date: CalendarDate;
  integrity_status: "unverified" | "verified" | "challenged" | "rejected";
  chain_of_custody: Array<{ actor: string; event: string; date: string }>;
  created_at: string;
  updated_at: string;
}

export interface CrimeReportRecord {
  readonly report_id: string;
  readonly incident_id: string;
  reporter_character_id: string | null;
  reporter_is_npc: boolean;
  description: string;
  submitted_at: string;
  submitted_world_date: CalendarDate;
  status: "submitted" | "reviewed" | "actioned" | "dismissed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  updated_at: string;
}

export interface CriminalRecord {
  readonly record_id: string;
  readonly character_id: string;
  readonly incident_id: string;
  readonly justice_case_id: string | null;
  category: CrimeCategoryId;
  severity: CrimeSeverityId;
  conviction: boolean;
  outcome: CrimeOutcomeId | null;
  conviction_date: string | null;
  conviction_world_date: CalendarDate | null;
  penalty_description: string | null;
  fine_amount: number;
  fine_paid: boolean;
  restitution_amount: number;
  restitution_paid: boolean;
  record_expiry_date: string | null;
  record_expiry_world_date: CalendarDate | null;
  sealed: boolean;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface CrimeNotorietyRecord {
  readonly character_id: string;
  notoriety_score: number;
  last_updated: string;
  last_updated_world_date: CalendarDate;
  incidents_involved: number;
  convictions: number;
  active_wanted_status: boolean;
  updated_at: string;
}

export interface CrimeRestitutionRecord {
  readonly restitution_id: string;
  readonly incident_id: string;
  readonly creditor_character_id: string;
  readonly debtor_character_id: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
  paid_world_date: CalendarDate | null;
  transaction_id: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface CrimeRehabilitationRecord {
  readonly rehabilitation_id: string;
  readonly character_id: string;
  readonly criminal_record_id: string | null;
  activity_type: string;
  start_date: string;
  start_world_date: CalendarDate;
  target_completion_date: string;
  target_completion_world_date: CalendarDate;
  actual_completion_date: string | null;
  actual_completion_world_date: CalendarDate | null;
  status: "in_progress" | "completed" | "abandoned";
  reputation_recovery: number;
  created_at: string;
  updated_at: string;
}

export interface CrimeAuditRecord {
  readonly audit_id: string;
  category: string;
  incident_id: string | null;
  character_id: string | null;
  actor_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentCrimeMaps {
  crimeIncidents: Record<string, CrimeIncidentRecord>;
  crimeParticipations: Record<string, CrimeParticipationRecord>;
  crimeEvidence: Record<string, CrimeEvidenceRecord>;
  crimeReports: Record<string, CrimeReportRecord>;
  criminalRecords: Record<string, CriminalRecord>;
  crimeNotoriety: Record<string, CrimeNotorietyRecord>;
  crimeRestitution: Record<string, CrimeRestitutionRecord>;
  crimeRehabilitation: Record<string, CrimeRehabilitationRecord>;
  crimeAudits: Record<string, CrimeAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface CrimeIncidentSnapshot {
  readonly incident_id: string;
  readonly category: CrimeCategoryId;
  readonly severity: CrimeSeverityId;
  readonly status: CrimeIncidentStatusId;
  readonly summary: string;
  readonly perpetrator_character_id: string | null;
  readonly victim_character_id: string | null;
  readonly detected: boolean;
  readonly outcome: CrimeOutcomeId | null;
  readonly financial_loss: number;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

export interface CriminalProfileSnapshot {
  readonly character_id: string;
  readonly has_criminal_record: boolean;
  readonly notoriety_score: number;
  readonly criminal_records_count: number;
  readonly convictions_count: number;
  readonly active_incidents_count: number;
  readonly outstanding_fines: number;
  readonly outstanding_restitution: number;
  readonly active_rehabilitation: boolean;
  readonly recent_incidents: readonly CrimeIncidentSnapshot[];
  readonly criminal_records: readonly { record_id: string; category: CrimeCategoryId; severity: CrimeSeverityId; conviction: boolean; created_at: string }[];
}
