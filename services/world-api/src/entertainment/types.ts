/**
 * Stage 17 — Entertainment and Media System
 *
 * Types for entertainment professions, creator profiles, music, film,
 * content, events, fame, contracts, journalism, controversies, and moderation.
 *
 * Integrates with careers (Stage 6), economy (Stage 7), businesses (Stage 8),
 * culture (Stage 16), and geography (Stage 3) systems.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type ProfessionCategoryId = "music" | "film" | "comedy" | "digital_content" | "broadcasting" | "journalism";
export type ProductionStatusId = "idea" | "development" | "pre_production" | "production" | "post_production" | "ready_for_release" | "released" | "cancelled";
export type ContentStatusId = "draft" | "processing" | "published" | "unlisted" | "removed" | "archived";
export type ContractStatusId = "proposed" | "accepted" | "active" | "completed" | "cancelled" | "disputed";
export type ControversyStatusId = "allegation" | "dispute" | "investigation" | "confirmed" | "corrected" | "resolved" | "dismissed";
export type EventTypeId = "concert" | "comedy_show" | "theatre" | "festival_performance" | "album_launch" | "film_premiere" | "fan_meetup" | "livestream_event" | "press_conference" | "award_ceremony";
export type EventTypeStatusId = "scheduled" | "in_progress" | "completed" | "cancelled";

export interface ProfessionCategoryDefinition { readonly id: ProfessionCategoryId; readonly label: string; readonly description: string; }
export interface ProfessionDefinition { readonly id: string; readonly category: ProfessionCategoryId; readonly label: string; readonly description: string; }
export interface SkillDefinition { readonly id: string; readonly label: string; readonly category: string; }
export interface ContentTypeDefinition { readonly id: string; readonly label: string; readonly category: string; }
export interface GenreDefinition { readonly id: string; readonly label: string; }
export interface ReleaseTypeDefinition { readonly id: string; readonly label: string; readonly track_count: number; }
export interface ProductionStatusDefinition { readonly id: ProductionStatusId; readonly label: string; }
export interface ContentStatusDefinition { readonly id: ContentStatusId; readonly label: string; }
export interface EntertainmentEventTypeDefinition { readonly id: EventTypeId; readonly label: string; }
export interface ContractTypeDefinition { readonly id: string; readonly label: string; }
export interface CareerStageDefinition { readonly id: string; readonly label: string; readonly min_fame: number; }
export interface NewsTopicDefinition { readonly id: string; readonly label: string; }

export interface EntertainmentRules {
  readonly minimum_age_for_entertainment_profile: number;
  readonly minimum_age_for_contract: number;
  readonly max_professions_per_character: number;
  readonly max_collaborators_per_project: number;
  readonly max_projects_per_character: number;
  readonly max_content_per_day: number;
  readonly max_events_per_day: number;
  readonly max_contracts_per_character: number;
  readonly max_news_reports_per_day: number;
  readonly max_followers_display: number;
  readonly fame_gain_per_release: number;
  readonly fame_gain_per_event: number;
  readonly fame_gain_per_collaboration: number;
  readonly fame_decay_per_day_inactive: number;
  readonly fame_max: number;
  readonly content_title_max_length: number;
  readonly content_description_max_length: number;
  readonly stage_name_max_length: number;
  readonly biography_max_length: number;
  readonly contract_title_max_length: number;
  readonly event_ticket_price_max: number;
  readonly event_capacity_max: number;
  readonly project_budget_max: number;
  readonly ad_revenue_per_view: number;
  readonly platform_revenue_share_percent: number;
  readonly controversy_decay_per_day: number;
  readonly max_controversies_per_month: number;
}

export interface EntertainmentCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly profession_categories: readonly ProfessionCategoryDefinition[];
  readonly professions: readonly ProfessionDefinition[];
  readonly skills: readonly SkillDefinition[];
  readonly content_types: readonly ContentTypeDefinition[];
  readonly genres: readonly GenreDefinition[];
  readonly release_types: readonly ReleaseTypeDefinition[];
  readonly production_statuses: readonly ProductionStatusDefinition[];
  readonly content_statuses: readonly ContentStatusDefinition[];
  readonly event_types: readonly EntertainmentEventTypeDefinition[];
  readonly contract_types: readonly ContractTypeDefinition[];
  readonly career_stages: readonly CareerStageDefinition[];
  readonly news_topics: readonly NewsTopicDefinition[];
  readonly project_status_transitions: Record<ProductionStatusId, readonly ProductionStatusId[]>;
  readonly content_status_transitions: Record<ContentStatusId, readonly ContentStatusId[]>;
  readonly rules: EntertainmentRules;
}

// ─── Persistent record types ──────────────────────────────────────

export interface EntertainmentProfileRecord {
  readonly profile_id: string;
  readonly character_id: string;
  stage_name: string;
  biography: string;
  professions: string[];
  career_stage: string;
  fame_score: number;
  followers_count: number;
  total_views: number;
  total_listens: number;
  total_revenue: number;
  last_active: string;
  last_active_world_date: CalendarDate;
  status: "active" | "inactive" | "suspended";
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface MusicProjectRecord {
  readonly project_id: string;
  readonly artist_profile_id: string;
  readonly artist_character_id: string;
  title: string;
  description: string;
  genre: string;
  release_type: string;
  status: ProductionStatusId;
  collaborator_character_ids: string[];
  budget: number;
  expenses: number;
  release_date: string | null;
  release_world_date: CalendarDate | null;
  views: number;
  listens: number;
  revenue: number;
  quality_score: number;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface FilmProjectRecord {
  readonly project_id: string;
  readonly producer_character_id: string;
  title: string;
  description: string;
  genre: string;
  content_type: string;
  status: ProductionStatusId;
  director_character_id: string | null;
  cast_character_ids: string[];
  crew_character_ids: string[];
  budget: number;
  expenses: number;
  release_date: string | null;
  release_world_date: CalendarDate | null;
  views: number;
  revenue: number;
  quality_score: number;
  business_id: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface ContentRecord {
  readonly content_id: string;
  readonly creator_profile_id: string;
  readonly creator_character_id: string;
  title: string;
  description: string;
  content_type: string;
  genre: string | null;
  status: ContentStatusId;
  visibility: "public" | "unlisted" | "private";
  published_at: string | null;
  published_world_date: CalendarDate | null;
  views: number;
  likes: number;
  comments_count: number;
  revenue: number;
  moderation_status: "clean" | "flagged" | "reviewed" | "removed";
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface EntertainmentEventRecord {
  readonly event_id: string;
  readonly organizer_character_id: string;
  readonly organizer_profile_id: string | null;
  name: string;
  description: string;
  event_type: EventTypeId;
  venue_name: string | null;
  state_id: string | null;
  lga_id: string | null;
  settlement_id: string | null;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  status: EventTypeStatusId;
  capacity: number;
  ticket_price: number;
  performer_character_ids: string[];
  attendee_character_ids: string[];
  tickets_sold: number;
  revenue: number;
  expenses: number;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface EntertainmentContractRecord {
  readonly contract_id: string;
  readonly title: string;
  contract_type: string;
  status: ContractStatusId;
  initiating_character_id: string;
  accepting_character_id: string | null;
  project_id: string | null;
  terms: string;
  compensation: number;
  compensation_paid: boolean;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string | null;
  end_world_date: CalendarDate | null;
  deliverables: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface NewsReportRecord {
  readonly report_id: string;
  readonly author_character_id: string;
  readonly organization_id: string | null;
  headline: string;
  summary: string;
  topic: string;
  related_event_id: string | null;
  status: "draft" | "under_review" | "published" | "corrected" | "retracted";
  editorial_review: string | null;
  source_references: string[];
  published_at: string | null;
  published_world_date: CalendarDate | null;
  corrected_at: string | null;
  correction_notes: string | null;
  views: number;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface ControversyRecord {
  readonly controversy_id: string;
  readonly character_id: string;
  readonly profile_id: string | null;
  title: string;
  description: string;
  category: string;
  status: ControversyStatusId;
  filed_by_character_id: string | null;
  resolution: string | null;
  reputation_impact: number;
  filed_at: string;
  filed_world_date: CalendarDate;
  resolved_at: string | null;
  resolved_world_date: CalendarDate | null;
  created_at: string;
  updated_at: string;
}

export interface ContentModerationRecord {
  readonly moderation_id: string;
  readonly content_id: string | null;
  readonly profile_id: string | null;
  report_reason: string;
  reported_by_character_id: string;
  reviewer_character_id: string | null;
  status: "pending" | "reviewed" | "actioned" | "dismissed";
  action_taken: string | null;
  notes: string | null;
  filed_at: string;
  filed_world_date: CalendarDate;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntertainmentCollaborationRecord {
  readonly collaboration_id: string;
  readonly project_id: string | null;
  readonly initiator_character_id: string;
  readonly collaborator_character_id: string;
  role: string;
  status: "proposed" | "accepted" | "active" | "completed" | "cancelled";
  terms: string;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface EntertainmentAuditRecord {
  readonly audit_id: string;
  category: string;
  character_id: string | null;
  profile_id: string | null;
  actor_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentEntertainmentMaps {
  entertainmentProfiles: Record<string, EntertainmentProfileRecord>;
  musicProjects: Record<string, MusicProjectRecord>;
  filmProjects: Record<string, FilmProjectRecord>;
  contentRecords: Record<string, ContentRecord>;
  entertainmentEvents: Record<string, EntertainmentEventRecord>;
  entertainmentContracts: Record<string, EntertainmentContractRecord>;
  newsReports: Record<string, NewsReportRecord>;
  controversies: Record<string, ControversyRecord>;
  contentModeration: Record<string, ContentModerationRecord>;
  entertainmentCollaborations: Record<string, EntertainmentCollaborationRecord>;
  entertainmentAudits: Record<string, EntertainmentAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface EntertainmentProfileSnapshot {
  readonly character_id: string;
  readonly stage_name: string;
  readonly professions: readonly string[];
  readonly career_stage: string;
  readonly fame_score: number;
  readonly followers_count: number;
  readonly total_views: number;
  readonly total_revenue: number;
  readonly project_count: number;
  readonly content_count: number;
  readonly event_count: number;
  readonly active_contracts: number;
}
