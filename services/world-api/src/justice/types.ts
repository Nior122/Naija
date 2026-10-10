/**
 * Stage 12 — Laws, Courts and Justice System
 *
 * Types for laws, courts, cases, evidence, hearings, judgments,
 * appeals, legal professionals, fines, and audit records.
 */

import type { CalendarDate } from "../life/types.js";
import type { GovernmentLevel } from "../government/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type LawCategoryId = "constitutional" | "criminal" | "civil" | "commercial" | "property" | "employment" | "traffic" | "environmental" | "administration" | "election" | "financial" | "education" | "safety" | "other";

export type CourtLevelId = "customary" | "magistrate" | "state_high" | "federal_high" | "national_industrial" | "court_of_appeal" | "supreme" | "tribunal";

export type CaseCategoryId = "civil_general" | "contract_dispute" | "debt_recovery" | "property_dispute" | "tenancy_dispute" | "employment_claim" | "compensation_claim" | "criminal_misdemeanor" | "criminal_felony" | "regulatory_penalty" | "commercial_dispute";

export type CaseType = "civil" | "criminal";

export type LawStatusId = "draft" | "proposed" | "under_review" | "approved" | "enacted" | "in_force" | "suspended" | "amended" | "repealed" | "rejected" | "archived";

export type CaseStatusId = "draft" | "submitted" | "accepted" | "rejected" | "awaiting_response" | "pretrial" | "awaiting_hearing" | "in_hearing" | "awaiting_judgment" | "judgment_issued" | "eligible_for_appeal" | "appeal_pending" | "settled" | "withdrawn" | "dismissed" | "closed";

export type JudgmentOutcomeId = "acquittal" | "conviction" | "dismissal" | "civil_remedy" | "fine_only" | "settlement_approved" | "case_transferred" | "consent_order";

export type SentenceTypeId = "warning" | "fine" | "compensation" | "community_service" | "activity_restriction" | "imprisonment";

export type AppealOutcomeId = "affirmed" | "reversed" | "modified" | "remanded" | "dismissed";

export type LegalProfessionalRoleId = "lawyer" | "prosecutor" | "defense_counsel" | "judge" | "magistrate" | "legal_clerk" | "court_registrar";

export interface LawCategoryDefinition { readonly id: LawCategoryId; readonly label: string; }
export interface CourtLevelDefinition { readonly id: CourtLevelId; readonly label: string; readonly level: number; readonly description: string; }
/**
 * A case category. `law_category` is the legal subject matter (a LawCategoryId). A court handles a
 * case when its permitted_categories lists that law category or the case `type` (civil/criminal).
 */
export interface CaseCategoryDefinition { readonly id: CaseCategoryId; readonly label: string; readonly type: CaseType; readonly law_category: LawCategoryId; }
export interface LegalProfessionalRoleDefinition { readonly id: LegalProfessionalRoleId; readonly label: string; }
export interface LawStatusDefinition { readonly id: LawStatusId; readonly label: string; }
export interface CaseStatusDefinition { readonly id: CaseStatusId; readonly label: string; }
export interface JudgmentOutcomeDefinition { readonly id: JudgmentOutcomeId; readonly label: string; }
export interface SentenceTypeDefinition { readonly id: SentenceTypeId; readonly label: string; }
export interface AppealOutcomeDefinition { readonly id: AppealOutcomeId; readonly label: string; }

export interface JusticeRules {
  readonly minimum_filing_age: number;
  readonly minimum_lawyer_age: number;
  readonly minimum_judge_age: number;
  readonly law_title_max_length: number;
  readonly law_description_max_length: number;
  readonly law_public_explanation_max_length: number;
  readonly provision_title_max_length: number;
  readonly provision_description_max_length: number;
  readonly case_summary_max_length: number;
  readonly case_description_max_length: number;
  readonly evidence_description_max_length: number;
  readonly judgment_reasoning_max_length: number;
  readonly appeal_grounds_max_length: number;
  readonly hearing_notes_max_length: number;
  readonly fine_minimum_ngn: number;
  readonly fine_maximum_ngn: number;
  readonly compensation_minimum_ngn: number;
  readonly compensation_maximum_ngn: number;
  readonly filing_fee_ngn: number;
  readonly appeal_filing_fee_ngn: number;
  readonly appeal_window_days: number;
  readonly max_evidence_per_case: number;
  readonly max_parties_per_case: number;
  readonly max_witnesses_per_case: number;
  readonly max_hearings_per_case: number;
  readonly max_provisions_per_law: number;
  readonly max_cases_per_court_queue: number;
  readonly law_enactment_authority_levels: readonly GovernmentLevel[];
  readonly default_jurisdiction: string;
  readonly supported_government_levels: readonly string[];
}

export interface SeedLawProvision {
  readonly section: string;
  readonly title: string;
  readonly description: string;
}

export interface SeedLaw {
  readonly id: string;
  readonly title: string;
  readonly short_reference: string;
  readonly description: string;
  readonly category: LawCategoryId;
  readonly jurisdiction: string;
  readonly applicable_state_id?: string;
  readonly status: LawStatusId;
  readonly version: number;
  readonly enactment_date: string;
  readonly effective_date: string;
  readonly public_explanation: string;
  readonly provisions: readonly SeedLawProvision[];
}

export interface SeedCourt {
  readonly id: string;
  readonly name: string;
  readonly level: CourtLevelId;
  readonly jurisdiction: string;
  readonly applicable_jurisdiction_id?: string;
  readonly status: string;
  readonly permitted_categories: readonly string[];
}

export interface JusticeCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly law_categories: readonly LawCategoryDefinition[];
  readonly court_levels: readonly CourtLevelDefinition[];
  readonly case_categories: readonly CaseCategoryDefinition[];
  readonly legal_professional_roles: readonly LegalProfessionalRoleDefinition[];
  readonly law_statuses: readonly LawStatusDefinition[];
  readonly case_statuses: readonly CaseStatusDefinition[];
  readonly judgment_outcomes: readonly JudgmentOutcomeDefinition[];
  readonly sentence_types: readonly SentenceTypeDefinition[];
  readonly appeal_outcomes: readonly AppealOutcomeDefinition[];
  readonly rules: JusticeRules;
  readonly seed_laws: readonly SeedLaw[];
  readonly seed_courts: readonly SeedCourt[];
}

// ─── Persistent record types ──────────────────────────────────────

export interface LawRecord {
  readonly law_id: string;
  title: string;
  short_reference: string;
  description: string;
  category: LawCategoryId;
  jurisdiction: string;
  applicable_state_id: string | null;
  enacted_by: string | null;
  status: LawStatusId;
  version: number;
  enactment_date: string;
  effective_date: string;
  expiration_date: string | null;
  parent_law_id: string | null;
  related_law_ids: string[];
  public_explanation: string;
  source_reference: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface LawProvisionRecord {
  readonly provision_id: string;
  readonly law_id: string;
  section: string;
  title: string;
  description: string;
  effective_from: string;
  effective_until: string | null;
  penalty_type: SentenceTypeId | null;
  penalty_min_amount_ngn: number | null;
  penalty_max_amount_ngn: number | null;
  status: "active" | "suspended" | "repealed";
  created_at: string;
  updated_at: string;
}

export interface LegislativeProposalRecord {
  readonly proposal_id: string;
  title: string;
  description: string;
  purpose: string;
  proposed_law_id: string | null;
  sponsor_character_id: string | null;
  sponsor_office_id: string | null;
  jurisdiction: string;
  applicable_state_id: string | null;
  status: "draft" | "submitted" | "under_review" | "approved" | "enacted" | "rejected" | "withdrawn";
  provisions: Array<{ section: string; title: string; description: string }>;
  supporting_explanation: string;
  submission_date: string | null;
  submission_world_date: CalendarDate | null;
  decision_date: string | null;
  decision_world_date: CalendarDate | null;
  decision_reason: string | null;
  revision_history: Array<{ date: string; summary: string; by_character_id: string }>;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface CourtRecord {
  readonly court_id: string;
  name: string;
  level: CourtLevelId;
  jurisdiction: string;
  applicable_jurisdiction_id: string | null;
  superior_court_id: string | null;
  permitted_categories: string[];
  status: "active" | "inactive" | "suspended";
  assigned_judge_ids: string[];
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface LegalProfessionalRecord {
  readonly professional_id: string;
  readonly character_id: string;
  role: LegalProfessionalRoleId;
  court_id: string | null;
  status: "active" | "suspended" | "inactive";
  qualifications: string[];
  appointed_at: string;
  appointed_world_date: CalendarDate;
  appointed_by: string | null;
  updated_at: string;
}

export interface LegalRepresentationRecord {
  readonly representation_id: string;
  readonly case_id: string;
  readonly lawyer_character_id: string;
  readonly professional_id: string;
  represented_party_character_id: string;
  role: "claimant_counsel" | "defendant_counsel" | "prosecutor" | "defense_counsel";
  started_at: string;
  started_world_date: CalendarDate;
  ended_at: string | null;
  ended_world_date: CalendarDate | null;
  end_reason: string | null;
  updated_at: string;
}

export interface CaseRecord {
  readonly case_id: string;
  case_number: string;
  category: CaseCategoryId;
  case_type: CaseType;
  court_id: string;
  jurisdiction: string;
  applicable_state_id: string | null;
  filing_party_character_id: string;
  respondent_character_id: string | null;
  additional_party_character_ids: string[];
  assigned_judge_character_id: string | null;
  summary: string;
  description: string;
  relevant_event_date: string | null;
  relevant_law_ids: string[];
  relevant_provision_ids: string[];
  filing_date: string;
  filing_world_date: CalendarDate;
  status: CaseStatusId;
  priority: "low" | "normal" | "high" | "urgent";
  judgment_id: string | null;
  appeal_id: string | null;
  closure_date: string | null;
  closure_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface CaseParticipantRecord {
  readonly participant_id: string;
  readonly case_id: string;
  readonly character_id: string;
  role: "claimant" | "defendant" | "respondent" | "third_party" | "witness";
  joined_at: string;
  joined_world_date: CalendarDate;
  status: "active" | "removed" | "withdrawn";
  updated_at: string;
}

export interface EvidenceRecord {
  readonly evidence_id: string;
  readonly case_id: string;
  category: string;
  submitted_by_character_id: string;
  description: string;
  source_reference: string | null;
  transaction_reference: string | null;
  submitted_at: string;
  submitted_world_date: CalendarDate;
  verification_status: "unverified" | "verified" | "challenged" | "rejected" | "accepted";
  admissibility_status: "pending" | "admitted" | "excluded";
  reviewed_by_character_id: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  version: number;
  supersedes_evidence_id: string | null;
  updated_at: string;
}

export interface WitnessRecord {
  readonly witness_id: string;
  readonly case_id: string;
  character_id: string;
  testimony: string;
  submitted_by_character_id: string;
  submitted_at: string;
  submitted_world_date: CalendarDate;
  credibility_status: "pending" | "credible" | "challenged" | "discredited";
  updated_at: string;
}

export interface HearingRecord {
  readonly hearing_id: string;
  readonly case_id: string;
  readonly court_id: string;
  readonly judge_character_id: string;
  hearing_type: "pretrial" | "trial" | "sentencing" | "interlocutory" | "appeal_hearing";
  scheduled_date: string;
  scheduled_world_date: CalendarDate;
  actual_start_date: string | null;
  actual_end_date: string | null;
  status: "scheduled" | "in_progress" | "adjourned" | "completed" | "cancelled";
  notes: string;
  evidence_references: string[];
  attendance_character_ids: string[];
  procedural_decisions: string[];
  created_at: string;
  updated_at: string;
}

export interface JudgmentRecord {
  readonly judgment_id: string;
  readonly case_id: string;
  readonly court_id: string;
  readonly judge_character_id: string;
  outcome: JudgmentOutcomeId;
  findings: string;
  reasoning: string;
  relevant_law_ids: string[];
  relevant_provision_ids: string[];
  evidence_considered_ids: string[];
  remedies: Array<{
    type: string;
    description: string;
    amount_ngn?: number;
    duration_days?: number;
  }>;
  sentence_ids: string[];
  appeal_eligible: boolean;
  appeal_deadline: string | null;
  issued_at: string;
  issued_world_date: CalendarDate;
  superseded_by_judgment_id: string | null;
  status: "issued" | "under_appeal" | "reversed" | "modified" | "affirmed" | "final";
  updated_at: string;
}

export interface SentenceRecord {
  readonly sentence_id: string;
  readonly case_id: string;
  readonly judgment_id: string;
  readonly convicted_character_id: string;
  type: SentenceTypeId;
  description: string;
  amount_ngn: number | null;
  duration_days: number | null;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  status: "active" | "served" | "suspended" | "overturned" | "waived";
  issued_at: string;
  issued_world_date: CalendarDate;
  updated_at: string;
}

export interface FineRecord {
  readonly fine_id: string;
  readonly case_id: string;
  readonly judgment_id: string;
  readonly sentence_id: string;
  readonly responsible_character_id: string;
  amount_ngn: number;
  amount_paid_ngn: number;
  amount_outstanding_ngn: number;
  due_date: string;
  due_world_date: CalendarDate;
  status: "outstanding" | "partially_paid" | "paid" | "disputed" | "waived" | "cancelled";
  payment_transaction_ids: string[];
  idempotency_key: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface SettlementRecord {
  readonly settlement_id: string;
  readonly case_id: string;
  parties_character_ids: string[];
  terms: string;
  effective_date: string;
  effective_world_date: CalendarDate;
  payment_obligation_ngn: number | null;
  payment_recipient_character_id: string | null;
  status: "proposed" | "accepted" | "approved" | "completed" | "breached" | "rejected";
  approved_by_character_id: string | null;
  approved_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppealRecord {
  readonly appeal_id: string;
  readonly original_case_id: string;
  readonly original_judgment_id: string;
  readonly appellant_character_id: string;
  grounds: string;
  supporting_references: string[];
  filing_date: string;
  filing_world_date: CalendarDate;
  appellate_court_id: string;
  assigned_judge_character_id: string | null;
  status: "filed" | "accepted" | "rejected" | "in_hearing" | "decided";
  outcome: AppealOutcomeId | null;
  outcome_judgment_id: string | null;
  outcome_reasoning: string | null;
  decided_at: string | null;
  decided_world_date: CalendarDate | null;
  updated_at: string;
}

export interface LegalAuditRecord {
  readonly audit_id: string;
  category: string;
  law_id: string | null;
  proposal_id: string | null;
  case_id: string | null;
  judgment_id: string | null;
  appeal_id: string | null;
  actor_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentJusticeMaps {
  laws: Record<string, LawRecord>;
  lawProvisions: Record<string, LawProvisionRecord>;
  legislativeProposals: Record<string, LegislativeProposalRecord>;
  courts: Record<string, CourtRecord>;
  legalProfessionals: Record<string, LegalProfessionalRecord>;
  legalRepresentations: Record<string, LegalRepresentationRecord>;
  cases: Record<string, CaseRecord>;
  caseParticipants: Record<string, CaseParticipantRecord>;
  evidence: Record<string, EvidenceRecord>;
  witnesses: Record<string, WitnessRecord>;
  hearings: Record<string, HearingRecord>;
  judgments: Record<string, JudgmentRecord>;
  sentences: Record<string, SentenceRecord>;
  fines: Record<string, FineRecord>;
  settlements: Record<string, SettlementRecord>;
  appeals: Record<string, AppealRecord>;
  legalAudits: Record<string, LegalAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface LawSnapshot {
  readonly law_id: string;
  readonly title: string;
  readonly short_reference: string;
  readonly description: string;
  readonly category: LawCategoryId;
  readonly jurisdiction: string;
  readonly applicable_state_id: string | null;
  readonly status: LawStatusId;
  readonly version: number;
  readonly enactment_date: string;
  readonly effective_date: string;
  readonly public_explanation: string;
  readonly provision_count: number;
}

export interface CourtSnapshot {
  readonly court_id: string;
  readonly name: string;
  readonly level: CourtLevelId;
  readonly jurisdiction: string;
  readonly applicable_jurisdiction_id: string | null;
  readonly status: string;
  readonly permitted_categories: readonly string[];
  readonly assigned_judge_count: number;
  readonly active_case_count: number;
}

export interface CaseSnapshot {
  readonly case_id: string;
  readonly case_number: string;
  readonly category: CaseCategoryId;
  readonly case_type: CaseType;
  readonly court_id: string;
  readonly court_name: string;
  readonly filing_party_character_id: string;
  readonly respondent_character_id: string | null;
  readonly assigned_judge_character_id: string | null;
  readonly summary: string;
  readonly status: CaseStatusId;
  readonly filing_date: string;
  readonly next_hearing_date: string | null;
  readonly judgment_id: string | null;
  readonly appeal_id: string | null;
}

export interface JudgmentSnapshot {
  readonly judgment_id: string;
  readonly case_id: string;
  readonly court_id: string;
  readonly judge_character_id: string;
  readonly outcome: JudgmentOutcomeId;
  readonly findings: string;
  readonly reasoning: string;
  readonly remedies: ReadonlyArray<{ type: string; description: string; amount_ngn?: number }>;
  readonly appeal_eligible: boolean;
  readonly issued_at: string;
  readonly status: string;
}

export interface LegalProfileSnapshot {
  readonly character_id: string;
  readonly professional_id: string | null;
  readonly role: LegalProfessionalRoleId | null;
  readonly court_id: string | null;
  readonly status: string | null;
  readonly active_cases: readonly CaseSnapshot[];
  readonly fines_owed_ngn: number;
  readonly appeal_count: number;
}
