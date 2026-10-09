/**
 * Stage 11 — Elections and Politics System
 *
 * Types for political parties, elections, candidates, campaigns,
 * voting, results, disputes, and audit records.
 */

import type { CalendarDate } from "../life/types.js";
import type { GovernmentLevel } from "../government/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type ElectionTypeId = "presidential" | "governorship" | "senatorial" | "house_of_representatives" | "state_assembly" | "local_chairman";

export type ElectionPhase = "scheduling" | "candidate_registration" | "screening" | "campaign" | "voting" | "counting" | "certification" | "completed" | "disputed" | "cancelled";

export type PartyStatus = "proposed" | "pending_registration" | "active" | "suspended" | "dissolved";

export type MembershipStatus = "active" | "resigned" | "suspended" | "expelled";

export type CandidateStatus = "pending" | "approved" | "rejected" | "withdrawn";

export type CampaignStatus = "preparing" | "active" | "concluded" | "cancelled";

export type DisputeStatus = "submitted" | "under_review" | "accepted" | "rejected" | "resolved" | "escalated";

export type ResultStatus = "counting" | "preliminary" | "certified" | "published" | "disputed" | "annulled";

export type WinningRule = "plurality_national" | "plurality_state" | "plurality_district" | "plurality_constituency" | "plurality_lga";

export interface ElectionTypeDefinition {
  readonly id: ElectionTypeId;
  readonly label: string;
  readonly level: GovernmentLevel;
  readonly description: string;
  readonly office_definition_id: string;
}

export interface ElectionPhaseDefinition {
  readonly id: ElectionPhase;
  readonly label: string;
}

export interface EligibilityRules {
  readonly minimum_age: number;
  readonly must_be_alive: boolean;
  readonly must_be_citizen: boolean;
  readonly party_affiliation_required: boolean;
  readonly residency_state_required?: boolean;
  readonly residency_lga_required?: boolean;
  readonly residency_requirement?: string | null;
  readonly term_length_days: number;
  readonly max_terms: number;
  readonly winning_rule: WinningRule;
  readonly description: string;
}

export interface VoterEligibilityRules {
  readonly minimum_age: number;
  readonly must_be_alive: boolean;
  readonly must_be_citizen: boolean;
  readonly geographic_requirement: string;
}

export interface CampaignTheme {
  readonly id: string;
  readonly label: string;
}

export interface DebateType {
  readonly id: string;
  readonly label: string;
}

export interface PartyRules {
  readonly minimum_founder_age: number;
  readonly minimum_member_age: number;
  readonly unique_name_required: boolean;
  readonly unique_abbreviation_required: boolean;
  readonly max_parties_per_character: number;
  readonly party_name_min_length: number;
  readonly party_name_max_length: number;
  readonly party_abbreviation_min_length: number;
  readonly party_abbreviation_max_length: number;
  readonly party_description_max_length: number;
  readonly party_statuses: readonly PartyStatus[];
  readonly membership_statuses: readonly MembershipStatus[];
  readonly leadership_roles: readonly string[];
}

export interface CampaignRules {
  readonly max_manifesto_length: number;
  readonly max_campaign_message_length: number;
  readonly max_campaign_title_length: number;
  readonly max_events_per_campaign: number;
  readonly campaign_themes: readonly CampaignTheme[];
  readonly debate_types: readonly DebateType[];
}

export interface DisputeRules {
  readonly max_description_length: number;
  readonly max_evidence_items: number;
  readonly dispute_statuses: readonly DisputeStatus[];
}

export interface ElectionsCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly election_types: readonly ElectionTypeDefinition[];
  readonly election_phases: readonly ElectionPhaseDefinition[];
  readonly eligibility_rules: Record<string, EligibilityRules>;
  readonly voter_eligibility: VoterEligibilityRules;
  readonly party_rules: PartyRules;
  readonly campaign_rules: CampaignRules;
  readonly dispute_rules: DisputeRules;
  readonly audit_categories: readonly string[];
}

// ─── Persistent record types ──────────────────────────────────────

export interface PoliticalPartyRecord {
  readonly party_id: string;
  name: string;
  abbreviation: string;
  description: string;
  status: PartyStatus;
  founded_by: string;
  founding_date: string;
  founding_world_date: CalendarDate;
  policy_positions: string[];
  leadership: Record<string, string>;
  updated_at: string;
}

export interface PartyMembershipRecord {
  readonly membership_id: string;
  readonly party_id: string;
  readonly character_id: string;
  status: MembershipStatus;
  role: string | null;
  joined_at: string;
  joined_world_date: CalendarDate;
  ended_at: string | null;
  ended_world_date: CalendarDate | null;
  end_reason: string | null;
  updated_at: string;
}

export interface PoliticalProfileRecord {
  readonly profile_id: string;
  readonly character_id: string;
  party_id: string | null;
  public_statement: string;
  public_service_history: Array<{
    office_label: string;
    organisation_name: string;
    start_date: string;
    end_date: string | null;
  }>;
  reputation_score: number;
  created_at: string;
  updated_at: string;
}

export interface ElectionRecord {
  readonly election_id: string;
  readonly election_type: ElectionTypeId;
  readonly office_definition_id: string;
  jurisdiction_level: GovernmentLevel;
  jurisdiction_id: string | null;
  constituency_id: string | null;
  phase: ElectionPhase;
  registration_open_date: string;
  registration_close_date: string;
  campaign_start_date: string;
  campaign_end_date: string;
  voting_open_date: string;
  voting_close_date: string;
  created_by: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
  winning_rule: WinningRule;
  results: ElectionResultRecord | null;
}

export interface CandidateRecord {
  readonly candidate_id: string;
  readonly election_id: string;
  readonly character_id: string;
  readonly party_id: string | null;
  status: CandidateStatus;
  manifesto: ManifestoRecord | null;
  registered_at: string;
  registered_world_date: CalendarDate;
  approved_at: string | null;
  approved_world_date: CalendarDate | null;
  rejection_reason: string | null;
  updated_at: string;
}

export interface ManifestoRecord {
  title: string;
  summary: string;
  policies: Array<{
    category: string;
    statement: string;
  }>;
  published_at: string;
  published_world_date: CalendarDate;
}

export interface CampaignRecord {
  readonly campaign_id: string;
  readonly candidate_id: string;
  readonly election_id: string;
  readonly party_id: string | null;
  title: string;
  description: string;
  themes: string[];
  status: CampaignStatus;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignEventRecord {
  readonly event_id: string;
  readonly campaign_id: string;
  readonly election_id: string;
  event_type: string;
  title: string;
  description: string;
  location_id: string | null;
  scheduled_date: string;
  scheduled_world_date: CalendarDate;
  status: "scheduled" | "completed" | "cancelled";
  created_at: string;
}

export interface CampaignFinanceRecord {
  readonly transaction_id: string;
  readonly campaign_id: string;
  readonly election_id: string;
  type: "donation" | "party_allocation" | "expense" | "event_expense" | "advertising_expense";
  amount_ngn: number;
  description: string;
  source_or_recipient: string;
  idempotency_key: string;
  recorded_at: string;
  recorded_world_date: CalendarDate;
}

export interface DebateRecord {
  readonly debate_id: string;
  readonly election_id: string;
  readonly debate_type: string;
  title: string;
  topic: string;
  participant_candidate_ids: string[];
  moderator: string | null;
  scheduled_date: string;
  scheduled_world_date: CalendarDate;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  statements: Array<{
    candidate_id: string;
    statement: string;
    submitted_at: string;
  }>;
  created_at: string;
}

export interface BallotRecord {
  readonly ballot_id: string;
  readonly election_id: string;
  readonly voter_character_id: string;
  readonly candidate_id: string;
  cast_at: string;
  cast_world_date: CalendarDate;
  is_valid: boolean;
  rejection_reason: string | null;
}

export interface VoterParticipationRecord {
  readonly participation_id: string;
  readonly election_id: string;
  readonly voter_character_id: string;
  has_voted: boolean;
  voted_at: string | null;
  voted_world_date: CalendarDate | null;
}

export interface ElectionResultRecord {
  election_id: string;
  election_type: ElectionTypeId;
  jurisdiction_id: string | null;
  total_valid_votes: number;
  total_invalid_votes: number;
  total_registered_voters: number;
  candidate_results: Array<{
    candidate_id: string;
    character_id: string;
    party_id: string | null;
    votes: number;
    percentage: number;
  }>;
  winner_candidate_id: string | null;
  winner_character_id: string | null;
  is_tie: boolean;
  status: ResultStatus;
  certified_at: string | null;
  certified_world_date: CalendarDate | null;
  published_at: string | null;
  published_world_date: CalendarDate | null;
  counting_started_at: string | null;
  counting_completed_at: string | null;
}

export interface ElectionDisputeRecord {
  readonly dispute_id: string;
  readonly election_id: string;
  readonly complainant_character_id: string;
  category: string;
  description: string;
  evidence_references: string[];
  status: DisputeStatus;
  submitted_at: string;
  submitted_world_date: CalendarDate;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution: string | null;
  resolved_at: string | null;
  resolved_world_date: CalendarDate | null;
  updated_at: string;
}

export interface ElectionAuditRecord {
  readonly audit_id: string;
  readonly election_id: string;
  readonly category: string;
  readonly actor_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentElectionMaps {
  politicalParties: Record<string, PoliticalPartyRecord>;
  partyMemberships: Record<string, PartyMembershipRecord>;
  politicalProfiles: Record<string, PoliticalProfileRecord>;
  elections: Record<string, ElectionRecord>;
  candidates: Record<string, CandidateRecord>;
  campaigns: Record<string, CampaignRecord>;
  campaignEvents: Record<string, CampaignEventRecord>;
  campaignFinances: Record<string, CampaignFinanceRecord>;
  debates: Record<string, DebateRecord>;
  ballots: Record<string, BallotRecord>;
  voterParticipation: Record<string, VoterParticipationRecord>;
  electionDisputes: Record<string, ElectionDisputeRecord>;
  electionAudits: Record<string, ElectionAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface PoliticalProfileSnapshot {
  readonly profile_id: string;
  readonly character_id: string;
  readonly party_id: string | null;
  readonly party_name: string | null;
  readonly party_abbreviation: string | null;
  readonly public_statement: string;
  readonly public_service_history: ReadonlyArray<{
    readonly office_label: string;
    readonly organisation_name: string;
    readonly start_date: string;
    readonly end_date: string | null;
  }>;
  readonly reputation_score: number;
}

export interface PartySnapshot {
  readonly party_id: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly description: string;
  readonly status: PartyStatus;
  readonly founded_by: string;
  readonly founding_date: string;
  readonly policy_positions: readonly string[];
  readonly leadership: Record<string, string>;
  readonly member_count: number;
}

export interface CandidateSnapshot {
  readonly candidate_id: string;
  readonly election_id: string;
  readonly character_id: string;
  readonly character_name: string;
  readonly party_id: string | null;
  readonly party_name: string | null;
  readonly party_abbreviation: string | null;
  readonly status: CandidateStatus;
  readonly manifesto: ManifestoRecord | null;
  readonly registered_at: string;
  readonly approved_at: string | null;
}

export interface ElectionSnapshot {
  readonly election_id: string;
  readonly election_type: ElectionTypeId;
  readonly election_type_label: string;
  readonly jurisdiction_level: GovernmentLevel;
  readonly jurisdiction_id: string | null;
  readonly constituency_id: string | null;
  readonly phase: ElectionPhase;
  readonly registration_open_date: string;
  readonly registration_close_date: string;
  readonly campaign_start_date: string;
  readonly campaign_end_date: string;
  readonly voting_open_date: string;
  readonly voting_close_date: string;
  readonly winning_rule: WinningRule;
  readonly approved_candidates: readonly CandidateSnapshot[];
  readonly results: ElectionResultRecord | null;
}

export interface CampaignSnapshot {
  readonly campaign_id: string;
  readonly candidate_id: string;
  readonly election_id: string;
  readonly title: string;
  readonly description: string;
  readonly themes: readonly string[];
  readonly status: CampaignStatus;
  readonly event_count: number;
  readonly total_funding_ngn: number;
  readonly total_expenses_ngn: number;
}
