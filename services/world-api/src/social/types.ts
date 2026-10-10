/**
 * Stage 18 — Social Network System
 *
 * Types for social profiles, follows, posts, comments, reactions,
 * hashtags, notifications, blocks, mutes, reports, and advertising.
 *
 * Integrates with entertainment (Stage 17), businesses (Stage 8),
 * economy (Stage 7), government (Stage 10), elections (Stage 11),
 * and culture (Stage 16) systems.
 */

import type { CalendarDate } from "../life/types.js";

// ─── Catalogue types ──────────────────────────────────────────────

export type SocialContentTypeId = "text" | "image" | "video" | "link" | "announcement" | "event" | "poll" | "sponsored";
export type SocialVisibilityId = "public" | "followers" | "private";
export type SocialReactionTypeId = "like" | "love" | "haha" | "wow" | "sad" | "angry";
export type SocialNotificationTypeId = "new_follower" | "follow_request" | "follow_approved" | "mention" | "reply" | "comment" | "reaction" | "repost" | "moderation_action" | "report_resolved";
export type SocialReportCategoryId = "spam" | "harassment" | "hate_speech" | "misinformation" | "impersonation" | "privacy_violation" | "inappropriate_content" | "fraudulent_advertising" | "manipulated_engagement" | "other";
export type SocialReportStatusId = "pending" | "under_review" | "resolved" | "dismissed";
export type SocialAdCampaignStatusId = "draft" | "pending_approval" | "active" | "paused" | "completed" | "rejected";
export type SocialAccountStatusId = "active" | "suspended" | "banned";

export interface SocialContentTypeDefinition { readonly id: SocialContentTypeId; readonly label: string; readonly description: string; }
export interface SocialVisibilityDefinition { readonly id: SocialVisibilityId; readonly label: string; readonly description: string; }
export interface SocialReactionTypeDefinition { readonly id: SocialReactionTypeId; readonly label: string; readonly emoji: string; }
export interface SocialNotificationTypeDefinition { readonly id: SocialNotificationTypeId; readonly label: string; readonly description: string; }
export interface SocialReportCategoryDefinition { readonly id: SocialReportCategoryId; readonly label: string; readonly description: string; }
export interface SocialReportStatusDefinition { readonly id: SocialReportStatusId; readonly label: string; readonly description: string; }
export interface SocialAdCampaignStatusDefinition { readonly id: SocialAdCampaignStatusId; readonly label: string; readonly description: string; }
export interface SocialAccountStatusDefinition { readonly id: SocialAccountStatusId; readonly label: string; readonly description: string; }

export interface SocialRules {
  readonly minimum_age_for_social_account: number;
  readonly username_min_length: number;
  readonly username_max_length: number;
  readonly username_pattern: string;
  readonly display_name_max_length: number;
  readonly bio_max_length: number;
  readonly post_content_max_length: number;
  readonly comment_content_max_length: number;
  readonly hashtag_max_length: number;
  readonly max_hashtags_per_post: number;
  readonly max_mentions_per_post: number;
  readonly max_posts_per_hour: number;
  readonly max_comments_per_hour: number;
  readonly max_reactions_per_hour: number;
  readonly max_follows_per_hour: number;
  readonly max_follow_requests_per_day: number;
  readonly max_blocks: number;
  readonly max_mutes: number;
  readonly max_reports_per_day: number;
  readonly max_notifications_per_user: number;
  readonly feed_page_size: number;
  readonly search_page_size: number;
  readonly trending_window_hours: number;
  readonly trending_min_posts: number;
  readonly trending_decay_rate_per_hour: number;
  readonly ad_campaign_min_budget: number;
  readonly ad_campaign_max_budget: number;
  readonly ad_campaign_min_duration_days: number;
  readonly ad_campaign_max_duration_days: number;
  readonly notification_batch_size: number;
  readonly max_pending_follow_requests: number;
  readonly private_account_requires_approval: boolean;
  readonly allow_private_accounts: boolean;
  readonly allow_verified_badges: boolean;
  readonly max_pinned_posts: number;
  readonly edit_window_minutes: number;
  readonly delete_grace_period_minutes: number;
}

export interface SocialCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly content_types: readonly SocialContentTypeDefinition[];
  readonly visibility_types: readonly SocialVisibilityDefinition[];
  readonly reaction_types: readonly SocialReactionTypeDefinition[];
  readonly notification_types: readonly SocialNotificationTypeDefinition[];
  readonly report_categories: readonly SocialReportCategoryDefinition[];
  readonly report_statuses: readonly SocialReportStatusDefinition[];
  readonly ad_campaign_statuses: readonly SocialAdCampaignStatusDefinition[];
  readonly account_statuses: readonly SocialAccountStatusDefinition[];
  readonly rules: SocialRules;
}

// ─── Persistent record types ──────────────────────────────────────

export interface SocialProfileRecord {
  readonly profile_id: string;
  readonly character_id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  cover_image_url: string | null;
  location: string | null;
  website: string | null;
  interests: string[];
  is_private: boolean;
  is_verified: boolean;
  account_status: SocialAccountStatusId;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface SocialFollowRecord {
  readonly follow_id: string;
  readonly follower_profile_id: string;
  readonly following_profile_id: string;
  readonly follower_character_id: string;
  readonly following_character_id: string;
  created_at: string;
  created_world_date: CalendarDate;
}

export interface SocialFollowRequestRecord {
  readonly request_id: string;
  readonly requester_profile_id: string;
  readonly target_profile_id: string;
  readonly requester_character_id: string;
  readonly target_character_id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  created_world_date: CalendarDate;
  resolved_at: string | null;
  updated_at: string;
}

export interface SocialPostRecord {
  readonly post_id: string;
  readonly author_profile_id: string;
  readonly author_character_id: string;
  content: string;
  content_type: SocialContentTypeId;
  visibility: SocialVisibilityId;
  parent_post_id: string | null;
  reposted_post_id: string | null;
  hashtags: string[];
  mentions: string[];
  media_refs: string[];
  like_count: number;
  comment_count: number;
  repost_count: number;
  is_deleted: boolean;
  is_pinned: boolean;
  is_sponsored: boolean;
  ad_campaign_id: string | null;
  location: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface SocialCommentRecord {
  readonly comment_id: string;
  readonly post_id: string;
  readonly author_profile_id: string;
  readonly author_character_id: string;
  content: string;
  parent_comment_id: string | null;
  like_count: number;
  is_deleted: boolean;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface SocialReactionRecord {
  readonly reaction_id: string;
  readonly post_id: string | null;
  readonly comment_id: string | null;
  readonly user_profile_id: string;
  readonly user_character_id: string;
  reaction_type: SocialReactionTypeId;
  created_at: string;
  created_world_date: CalendarDate;
}

export interface SocialHashtagRecord {
  readonly hashtag_id: string;
  readonly tag: string;
  post_count: number;
  created_at: string;
  created_world_date: CalendarDate;
  last_used_at: string;
}

export interface SocialPostHashtagRecord {
  readonly post_id: string;
  readonly hashtag_id: string;
}

export interface SocialNotificationRecord {
  readonly notification_id: string;
  readonly recipient_profile_id: string;
  readonly recipient_character_id: string;
  notification_type: SocialNotificationTypeId;
  actor_profile_id: string | null;
  actor_character_id: string | null;
  post_id: string | null;
  comment_id: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
  created_world_date: CalendarDate;
}

export interface SocialBlockRecord {
  readonly block_id: string;
  readonly blocker_profile_id: string;
  readonly blocker_character_id: string;
  readonly blocked_profile_id: string;
  readonly blocked_character_id: string;
  created_at: string;
  created_world_date: CalendarDate;
}

export interface SocialMuteRecord {
  readonly mute_id: string;
  readonly muter_profile_id: string;
  readonly muter_character_id: string;
  readonly muted_profile_id: string;
  readonly muted_character_id: string;
  created_at: string;
  created_world_date: CalendarDate;
}

export interface SocialReportRecord {
  readonly report_id: string;
  readonly reporter_profile_id: string;
  readonly reporter_character_id: string;
  target_type: "post" | "comment" | "profile";
  target_id: string;
  category: SocialReportCategoryId;
  description: string;
  status: SocialReportStatusId;
  reviewer_profile_id: string | null;
  reviewer_character_id: string | null;
  resolution_notes: string | null;
  created_at: string;
  created_world_date: CalendarDate;
  resolved_at: string | null;
  updated_at: string;
}

export interface SocialAdCampaignRecord {
  readonly campaign_id: string;
  readonly business_id: string;
  readonly owner_character_id: string;
  title: string;
  content: string;
  target_audience: string[];
  budget: number;
  spent: number;
  status: SocialAdCampaignStatusId;
  start_date: string;
  start_world_date: CalendarDate;
  end_date: string;
  end_world_date: CalendarDate;
  impressions: number;
  clicks: number;
  created_at: string;
  created_world_date: CalendarDate;
  updated_at: string;
}

export interface SocialTrendingTopicRecord {
  readonly topic_id: string;
  readonly hashtag: string;
  readonly category: string | null;
  score: number;
  post_count: number;
  participant_count: number;
  calculated_at: string;
  calculated_world_date: CalendarDate;
}

export interface SocialAuditRecord {
  readonly audit_id: string;
  category: string;
  actor_character_id: string | null;
  target_character_id: string | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  created_world_date: CalendarDate;
}

// ─── Persistence map type ─────────────────────────────────────────

export interface PersistentSocialMaps {
  socialProfiles: Record<string, SocialProfileRecord>;
  socialFollows: Record<string, SocialFollowRecord>;
  socialFollowRequests: Record<string, SocialFollowRequestRecord>;
  socialPosts: Record<string, SocialPostRecord>;
  socialComments: Record<string, SocialCommentRecord>;
  socialReactions: Record<string, SocialReactionRecord>;
  socialHashtags: Record<string, SocialHashtagRecord>;
  socialPostHashtags: Record<string, SocialPostHashtagRecord>;
  socialNotifications: Record<string, SocialNotificationRecord>;
  socialBlocks: Record<string, SocialBlockRecord>;
  socialMutes: Record<string, SocialMuteRecord>;
  socialReports: Record<string, SocialReportRecord>;
  socialAdCampaigns: Record<string, SocialAdCampaignRecord>;
  socialTrendingTopics: Record<string, SocialTrendingTopicRecord>;
  socialAudits: Record<string, SocialAuditRecord>;
}

// ─── Snapshot types ───────────────────────────────────────────────

export interface SocialProfileSnapshot {
  readonly profile_id: string;
  readonly character_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly bio: string;
  readonly avatar_url: string | null;
  readonly is_private: boolean;
  readonly is_verified: boolean;
  readonly follower_count: number;
  readonly following_count: number;
  readonly post_count: number;
  readonly is_following: boolean;
  readonly is_followed_by: boolean;
  readonly is_blocked: boolean;
  readonly is_muted: boolean;
}

export interface SocialPostSnapshot {
  readonly post_id: string;
  readonly author_profile_id: string;
  readonly author_username: string;
  readonly author_display_name: string;
  readonly author_avatar_url: string | null;
  readonly author_is_verified: boolean;
  readonly content: string;
  readonly content_type: SocialContentTypeId;
  readonly visibility: SocialVisibilityId;
  readonly parent_post_id: string | null;
  readonly reposted_post_id: string | null;
  readonly hashtags: readonly string[];
  readonly mentions: readonly string[];
  readonly like_count: number;
  readonly comment_count: number;
  readonly repost_count: number;
  readonly is_pinned: boolean;
  readonly is_sponsored: boolean;
  readonly created_at: string;
  readonly user_has_liked: boolean;
}

export interface SocialNotificationSnapshot {
  readonly notification_id: string;
  readonly notification_type: SocialNotificationTypeId;
  readonly actor_username: string | null;
  readonly actor_display_name: string | null;
  readonly actor_avatar_url: string | null;
  readonly post_id: string | null;
  readonly message: string;
  readonly is_read: boolean;
  readonly created_at: string;
}
