/**
 * Stage 16 — Religion, Culture and Community System
 *
 * Types for communities, institutions, memberships, cultural profiles,
 * festivals, projects, disputes, reputation, and audit records.
 *
 * Integrates with geography (locations), life (relationships), government,
 * careers, economy, and justice systems.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type CommunityTypeId = "village" | "town" | "urban_neighborhood" | "rural_settlement" | "city_district" | "cultural_association" | "student_community" | "professional_community" | "religious_community" | "trade_association" | "age_grade" | "women_group" | "youth_group" | "development_union" | "town_union";
export type InstitutionCategoryId = "church" | "mosque" | "traditional_shrine" | "prayer_house" | "palace" | "council_hall" | "community_center" | "cultural_center" | "market_square" | "town_hall";
export type InstitutionGeneralCategory = "religious" | "traditional" | "community";
export type ReligiousCategoryId = "christianity" | "islam" | "traditional_religion" | "other_faith" | "no_affiliation";
export type FestivalCategoryId = "cultural" | "religious" | "harvest" | "historical" | "arts" | "durbar" | "carnival";
export type ProjectCategoryId = "infrastructure" | "education" | "health" | "environment" | "culture" | "youth" | "economic" | "charity" | "security";
export type ProjectStatusId = "proposed" | "under_review" | "approved" | "funding_in_progress" | "active" | "paused" | "completed" | "cancelled";
export type MembershipStatusId = "active" | "inactive" | "suspended" | "left";
export type EventStatusId = "scheduled" | "in_progress" | "completed" | "cancelled";
export type DisputeStatusId = "filed" | "under_review" | "mediation_started" | "resolved" | "referred_to_justice" | "dismissed";

export interface CommunityTypeDefinition { readonly id: CommunityTypeId; readonly label: string; readonly description: string; }
export interface InstitutionCategoryDefinition { readonly id: InstitutionCategoryId; readonly label: string; readonly general_category: InstitutionGeneralCategory; readonly description: string; }
export interface ReligiousCategoryDefinition { readonly id: ReligiousCategoryId; readonly label: string; readonly description: string; }
export interface InstitutionRoleDefinition { readonly id: string; readonly label: string; readonly general_category: InstitutionGeneralCategory; readonly level: number; }
export interface FestivalCategoryDefinition { readonly id: FestivalCategoryId; readonly label: string; readonly description: string; }
export interface ProjectCategoryDefinition { readonly id: ProjectCategoryId; readonly label: string; readonly description: string; }
export interface LanguageDefinition { readonly id: string; readonly label: string; readonly official: boolean; }
export interface FestivalDefinition { readonly id: string; readonly label: string; readonly category: FestivalCategoryId; readonly region: string; readonly description: string; readonly schedule_rule: string; }

export interface CultureRules {
  readonly minimum_age_for_membership: number;
  readonly minimum_age_for_leadership: number;
  readonly minimum_age_for_traditional_office: number;
  readonly max_communities_per_character: number;
  readonly max_projects_per_community: number;
  readonly max_events_per_community_per_month: number;
  readonly max_announcements_per_day: number;
  readonly max_volunteers_per_project: number;
  readonly max_members_per_community: number;
  readonly max_festivals_per_year: number;
  readonly description_max_length: number;
  readonly announcement_max_length: number;
  readonly project_budget_max: number;
  readonly community_creation_cooldown_hours: number;
  readonly event_creation_cooldown_hours: number;
  readonly reputation_gain_per_participation: number;
  readonly reputation_gain_per_project_completion: number;
  readonly reputation_gain_per_leadership_role: number;
  readonly reputation_decay_per_day_inactive: number;
  readonly max_community_disputes_per_month: number;
}

export interface CultureCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly community_types: readonly CommunityTypeDefinition[];
  readonly institution_categories: readonly InstitutionCategoryDefinition[];
  readonly religious_categories: readonly ReligiousCategoryDefinition[];
  readonly institution_roles: readonly InstitutionRoleDefinition[];
  readonly festival_categories: readonly FestivalCategoryDefinition[];
  readonly project_categories: readonly ProjectCategoryDefinition[];
  readonly languages: readonly LanguageDefinition[];
  readonly festival_definitions: readonly FestivalDefinition[];
  readonly project_status_transitions: Record<ProjectStatusId, readonly ProjectStatusId[]>;
  readonly rules: CultureRules;
}

// ─── Persistent record types ──────────────────────────────────────

export interface CommunityRecord {
  readonly community_id: string;
  name: string;
  description: string;
  community_type: CommunityTypeId;
  state_id: string | null;
  lga_id: string | null;
  ward_id: string | null;
  settlement_id: string | null;
  cultural_associations: string[];
  languages: string[];
  population_estimate: number;
  status: "active" | "inactive" | "dissolved";
  parent_community_id: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface CommunityMembershipRecord {
  readonly membership_id: string;
  readonly community_id: string;
  readonly character_id: string;
  membership_type: "resident" | "voluntary" | "institutional" | "honorary";
  status: MembershipStatusId;
  roles: string[];
  joined_at: string;
  joined_world_date: CalendarDate;
  left_at: string | null;
  left_world_date: CalendarDate | null;
  participation_score: number;
  updated_at: string;
}

export interface InstitutionRecord {
  readonly institution_id: string;
  name: string;
  category: InstitutionCategoryId;
  general_category: InstitutionGeneralCategory;
  religious_category: ReligiousCategoryId | null;
  description: string;
  community_id: string | null;
  state_id: string | null;
  lga_id: string | null;
  settlement_id: string | null;
  leader_character_id: string | null;
  leader_role_id: string | null;
  leadership_history: Array<{ character_id: string; role_id: string; from_date: string; to_date: string | null }>;
  gathering_schedule: Array<{ day_of_week: number; time_of_day: number; label: string }>;
  member_count: number;
  reputation_score: number;
  status: "active" | "inactive" | "dissolved";
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface InstitutionMembershipRecord {
  readonly membership_id: string;
  readonly institution_id: string;
  readonly character_id: string;
  role_id: string;
  role_level: number;
  status: MembershipStatusId;
  joined_at: string;
  joined_world_date: CalendarDate;
  left_at: string | null;
  updated_at: string;
}

export interface CulturalProfileRecord {
  readonly character_id: string;
  languages_spoken: string[];
  preferred_language: string | null;
  religious_affiliation: ReligiousCategoryId | null;
  cultural_interests: string[];
  heritage_associations: string[];
  voluntary_disclosure: boolean;
  updated_at: string;
  updated_world_date: CalendarDate;
}

export interface CommunityEventRecord {
  readonly event_id: string;
  readonly community_id: string | null;
  readonly institution_id: string | null;
  readonly festival_definition_id: string | null;
  name: string;
  description: string;
  category: string;
  organizer_character_id: string | null;
  state_id: string | null;
  lga_id: string | null;
  settlement_id: string | null;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  status: EventStatusId;
  attendee_character_ids: string[];
  capacity: number | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface CommunityProjectRecord {
  readonly project_id: string;
  readonly community_id: string;
  name: string;
  description: string;
  category: ProjectCategoryId;
  organizing_institution_id: string | null;
  leader_character_id: string | null;
  status: ProjectStatusId;
  budget: number;
  funds_raised: number;
  start_date: string;
  start_world_date: CalendarDate;
  target_completion_date: string | null;
  target_completion_world_date: CalendarDate | null;
  actual_completion_date: string | null;
  actual_completion_world_date: CalendarDate | null;
  volunteer_character_ids: string[];
  contributions: Array<{ character_id: string; amount: number; date: string; description: string }>;
  milestones: Array<{ label: string; completed: boolean; completed_date: string | null }>;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface CommunityAnnouncementRecord {
  readonly announcement_id: string;
  readonly community_id: string | null;
  readonly institution_id: string | null;
  author_character_id: string;
  title: string;
  body: string;
  scope: "community" | "institution" | "regional";
  published_at: string;
  published_world_date: CalendarDate;
  updated_at: string;
}

export interface CommunityReputationRecord {
  readonly character_id: string;
  readonly community_id: string | null;
  community_trust: number;
  participation_score: number;
  leadership_reputation: number;
  last_active: string;
  last_active_world_date: CalendarDate;
  updated_at: string;
}

export interface CommunityDisputeRecord {
  readonly dispute_id: string;
  readonly community_id: string;
  title: string;
  description: string;
  filed_by_character_id: string;
  against_character_id: string | null;
  against_institution_id: string | null;
  mediator_character_id: string | null;
  status: DisputeStatusId;
  resolution: string | null;
  referred_to_justice_case_id: string | null;
  filed_at: string;
  filed_world_date: CalendarDate;
  resolved_at: string | null;
  resolved_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface CommunityContributionRecord {
  readonly contribution_id: string;
  readonly project_id: string;
  readonly character_id: string;
  contribution_type: "financial" | "labor" | "materials" | "expertise";
  amount: number;
  description: string;
  contributed_at: string;
  contributed_world_date: CalendarDate;
  created_at: string;
}

export interface CommunityAuditRecord {
  readonly audit_id: string;
  category: string;
  community_id: string | null;
  institution_id: string | null;
  character_id: string | null;
  actor_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentCultureMaps {
  communities: Record<string, CommunityRecord>;
  communityMemberships: Record<string, CommunityMembershipRecord>;
  institutions: Record<string, InstitutionRecord>;
  institutionMemberships: Record<string, InstitutionMembershipRecord>;
  culturalProfiles: Record<string, CulturalProfileRecord>;
  communityEvents: Record<string, CommunityEventRecord>;
  communityProjects: Record<string, CommunityProjectRecord>;
  communityAnnouncements: Record<string, CommunityAnnouncementRecord>;
  communityReputation: Record<string, CommunityReputationRecord>;
  communityDisputes: Record<string, CommunityDisputeRecord>;
  communityContributions: Record<string, CommunityContributionRecord>;
  communityAudits: Record<string, CommunityAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface CulturalProfileSnapshot {
  readonly character_id: string;
  readonly languages_spoken: readonly string[];
  readonly preferred_language: string | null;
  readonly religious_affiliation: ReligiousCategoryId | null;
  readonly cultural_interests: readonly string[];
  readonly community_memberships_count: number;
  readonly institution_memberships_count: number;
  readonly community_trust: number;
  readonly participation_score: number;
  readonly active_projects_count: number;
  readonly leadership_roles: readonly string[];
}

export interface CommunitySnapshot {
  readonly community_id: string;
  readonly name: string;
  readonly community_type: CommunityTypeId;
  readonly state_id: string | null;
  readonly lga_id: string | null;
  readonly member_count: number;
  readonly status: string;
}
