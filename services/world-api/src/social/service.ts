/**
 * Stage 18 — Social Network System
 *
 * Service layer for social network functionality including profiles,
 * follows, posts, comments, reactions, notifications, moderation,
 * and advertising.
 */

import type { CalendarDate } from "../life/types.js";
import type {
  PersistentSocialMaps,
  SocialProfileRecord,
  SocialFollowRecord,
  SocialFollowRequestRecord,
  SocialPostRecord,
  SocialCommentRecord,
  SocialReactionRecord,
  SocialHashtagRecord,
  SocialNotificationRecord,
  SocialBlockRecord,
  SocialMuteRecord,
  SocialReportRecord,
  SocialAdCampaignRecord,
  SocialTrendingTopicRecord,
  SocialAuditRecord,
  SocialContentTypeId,
  SocialVisibilityId,
  SocialReactionTypeId,
  SocialNotificationTypeId,
  SocialReportCategoryId,
  SocialReportStatusId,
  SocialAdCampaignStatusId,
  SocialAccountStatusId,
} from "./types.js";
import { SocialCatalogService } from "./catalog.js";

let _socialUidCounter = 0;
function socialUid(prefix: string): string {
  _socialUidCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_socialUidCounter.toString(36)}`;
}

export function emptySocialMaps(): PersistentSocialMaps {
  return {
    socialProfiles: {},
    socialFollows: {},
    socialFollowRequests: {},
    socialPosts: {},
    socialComments: {},
    socialReactions: {},
    socialHashtags: {},
    socialPostHashtags: {},
    socialNotifications: {},
    socialBlocks: {},
    socialMutes: {},
    socialReports: {},
    socialAdCampaigns: {},
    socialTrendingTopics: {},
    socialAudits: {},
  };
}

export function initializeSocialWorldState(state: PersistentSocialMaps): void {
  if (!state.socialProfiles) state.socialProfiles = {};
  if (!state.socialFollows) state.socialFollows = {};
  if (!state.socialFollowRequests) state.socialFollowRequests = {};
  if (!state.socialPosts) state.socialPosts = {};
  if (!state.socialComments) state.socialComments = {};
  if (!state.socialReactions) state.socialReactions = {};
  if (!state.socialHashtags) state.socialHashtags = {};
  if (!state.socialPostHashtags) state.socialPostHashtags = {};
  if (!state.socialNotifications) state.socialNotifications = {};
  if (!state.socialBlocks) state.socialBlocks = {};
  if (!state.socialMutes) state.socialMutes = {};
  if (!state.socialReports) state.socialReports = {};
  if (!state.socialAdCampaigns) state.socialAdCampaigns = {};
  if (!state.socialTrendingTopics) state.socialTrendingTopics = {};
  if (!state.socialAudits) state.socialAudits = {};
}

export function seedSocialWorld(): { seeded: boolean } {
  return { seeded: true };
}

export class SocialService {
  private maps: PersistentSocialMaps;
  private catalog: SocialCatalogService;

  constructor(maps: PersistentSocialMaps | null, catalog: SocialCatalogService) {
    this.maps = maps ?? emptySocialMaps();
    this.catalog = catalog;
  }

  getMaps(): PersistentSocialMaps { return this.maps; }

  private audit(category: string, data: { actor_character_id?: string; target_character_id?: string; summary: string; details?: Record<string, string | number | boolean | null> }, worldDate: CalendarDate) {
    const id = socialUid("saudit");
    const record: SocialAuditRecord = {
      audit_id: id,
      category,
      actor_character_id: data.actor_character_id ?? null,
      target_character_id: data.target_character_id ?? null,
      summary: data.summary,
      details: data.details ?? {},
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };
    this.maps.socialAudits[id] = record;
  }

  private createNotification(
    recipientCharacterId: string,
    notificationType: SocialNotificationTypeId,
    actorCharacterId: string | null,
    postId: string | null,
    commentId: string | null,
    message: string,
    worldDate: CalendarDate
  ): void {
    const recipientProfile = this.getProfileByCharacterId(recipientCharacterId);
    if (!recipientProfile) return;

    const id = socialUid("snotif");
    const notification: SocialNotificationRecord = {
      notification_id: id,
      recipient_profile_id: recipientProfile.profile_id,
      recipient_character_id: recipientCharacterId,
      notification_type: notificationType,
      actor_profile_id: actorCharacterId ? this.getProfileByCharacterId(actorCharacterId)?.profile_id ?? null : null,
      actor_character_id: actorCharacterId,
      post_id: postId,
      comment_id: commentId,
      message,
      is_read: false,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };
    this.maps.socialNotifications[id] = notification;
  }

  private isBlocked(blockerCharacterId: string, blockedCharacterId: string): boolean {
    return Object.values(this.maps.socialBlocks).some(
      (b) => b.blocker_character_id === blockerCharacterId && b.blocked_character_id === blockedCharacterId
    );
  }

  private isMuted(muterCharacterId: string, mutedCharacterId: string): boolean {
    return Object.values(this.maps.socialMutes).some(
      (m) => m.muter_character_id === muterCharacterId && m.muted_character_id === mutedCharacterId
    );
  }

  private isFollowing(followerCharacterId: string, followingCharacterId: string): boolean {
    return Object.values(this.maps.socialFollows).some(
      (f) => f.follower_character_id === followerCharacterId && f.following_character_id === followingCharacterId
    );
  }

  // ─── Profile Management ───────────────────────────────────────

  createProfile(params: {
    character_id: string;
    username: string;
    display_name: string;
    bio?: string;
    avatar_url?: string | null;
    is_private?: boolean;
    character_age: number;
  }, worldDate: CalendarDate): SocialProfileRecord {
    const rules = this.catalog.getRules();
    
    if (params.character_age < rules.minimum_age_for_social_account) {
      throw new Error("social_age_ineligible");
    }

    if (!this.catalog.isValidUsername(params.username)) {
      throw new Error("social_username_invalid");
    }

    if (params.display_name.length > rules.display_name_max_length) {
      throw new Error("social_display_name_too_long");
    }

    if (params.bio && params.bio.length > rules.bio_max_length) {
      throw new Error("social_bio_too_long");
    }

    // Check username uniqueness
    const existing = Object.values(this.maps.socialProfiles).find(
      (p) => p.username.toLowerCase() === params.username.toLowerCase()
    );
    if (existing) {
      throw new Error("social_username_taken");
    }

    // Check if character already has a profile
    const existingProfile = this.getProfileByCharacterId(params.character_id);
    if (existingProfile) {
      throw new Error("social_profile_exists");
    }

    const id = socialUid("sprof");
    const profile: SocialProfileRecord = {
      profile_id: id,
      character_id: params.character_id,
      username: params.username,
      display_name: params.display_name,
      bio: params.bio ?? "",
      avatar_url: params.avatar_url ?? null,
      cover_image_url: null,
      location: null,
      website: null,
      interests: [],
      is_private: params.is_private ?? false,
      is_verified: false,
      account_status: "active",
      follower_count: 0,
      following_count: 0,
      post_count: 0,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };

    this.maps.socialProfiles[id] = profile;
    this.audit("profile_created", {
      actor_character_id: params.character_id,
      summary: `Social profile created: @${params.username}`,
      details: { username: params.username, is_private: profile.is_private },
    }, worldDate);

    return profile;
  }

  updateProfile(profileId: string, params: {
    display_name?: string;
    bio?: string;
    avatar_url?: string | null;
    cover_image_url?: string | null;
    location?: string | null;
    website?: string | null;
    interests?: string[];
    is_private?: boolean;
  }, worldDate: CalendarDate): SocialProfileRecord {
    const profile = this.maps.socialProfiles[profileId];
    if (!profile) throw new Error("social_profile_not_found");

    const rules = this.catalog.getRules();

    if (params.display_name !== undefined) {
      if (params.display_name.length > rules.display_name_max_length) {
        throw new Error("social_display_name_too_long");
      }
      profile.display_name = params.display_name;
    }

    if (params.bio !== undefined) {
      if (params.bio.length > rules.bio_max_length) {
        throw new Error("social_bio_too_long");
      }
      profile.bio = params.bio;
    }

    if (params.avatar_url !== undefined) profile.avatar_url = params.avatar_url;
    if (params.cover_image_url !== undefined) profile.cover_image_url = params.cover_image_url;
    if (params.location !== undefined) profile.location = params.location;
    if (params.website !== undefined) profile.website = params.website;
    if (params.interests !== undefined) profile.interests = [...params.interests];
    if (params.is_private !== undefined) profile.is_private = params.is_private;

    profile.updated_at = new Date().toISOString();

    this.audit("profile_updated", {
      actor_character_id: profile.character_id,
      summary: `Profile updated`,
    }, worldDate);

    return profile;
  }

  getProfile(profileId: string): SocialProfileRecord | null {
    return this.maps.socialProfiles[profileId] ?? null;
  }

  getProfileByUsername(username: string): SocialProfileRecord | null {
    return Object.values(this.maps.socialProfiles).find(
      (p) => p.username.toLowerCase() === username.toLowerCase()
    ) ?? null;
  }

  getProfileByCharacterId(characterId: string): SocialProfileRecord | null {
    return Object.values(this.maps.socialProfiles).find((p) => p.character_id === characterId) ?? null;
  }

  searchProfiles(query: string, limit: number = 20): SocialProfileRecord[] {
    const normalizedQuery = query.toLowerCase();
    return Object.values(this.maps.socialProfiles)
      .filter((p) => 
        p.account_status === "active" &&
        (p.username.toLowerCase().includes(normalizedQuery) ||
         p.display_name.toLowerCase().includes(normalizedQuery))
      )
      .slice(0, limit);
  }

  // ─── Follow System ────────────────────────────────────────────

  follow(followerCharacterId: string, targetCharacterId: string, worldDate: CalendarDate): SocialFollowRecord | SocialFollowRequestRecord {
    if (followerCharacterId === targetCharacterId) {
      throw new Error("social_cannot_follow_self");
    }

    const followerProfile = this.getProfileByCharacterId(followerCharacterId);
    const targetProfile = this.getProfileByCharacterId(targetCharacterId);

    if (!followerProfile || !targetProfile) {
      throw new Error("social_profile_not_found");
    }

    if (this.isBlocked(targetCharacterId, followerCharacterId)) {
      throw new Error("social_blocked_by_user");
    }

    if (this.isFollowing(followerCharacterId, targetCharacterId)) {
      throw new Error("social_already_following");
    }

    // Check rate limit
    const rules = this.catalog.getRules();
    const oneHourAgo = Date.now() - 3600000;
    const recentFollows = Object.values(this.maps.socialFollows).filter(
      (f) => f.follower_character_id === followerCharacterId &&
        new Date(f.created_at).getTime() > oneHourAgo
    ).length;

    if (recentFollows >= rules.max_follows_per_hour) {
      throw new Error("social_follow_rate_limit");
    }

    // If target is private, create follow request
    if (targetProfile.is_private) {
      // Check for existing pending request
      const existingRequest = Object.values(this.maps.socialFollowRequests).find(
        (r) => r.requester_character_id === followerCharacterId &&
          r.target_character_id === targetCharacterId &&
          r.status === "pending"
      );

      if (existingRequest) {
        throw new Error("social_follow_request_pending");
      }

      // Check daily limit for follow requests
      const oneDayAgo = Date.now() - 86400000;
      const recentRequests = Object.values(this.maps.socialFollowRequests).filter(
        (r) => r.requester_character_id === followerCharacterId &&
          new Date(r.created_at).getTime() > oneDayAgo
      ).length;

      if (recentRequests >= rules.max_follow_requests_per_day) {
        throw new Error("social_follow_request_limit");
      }

      const requestId = socialUid("sfreq");
      const request: SocialFollowRequestRecord = {
        request_id: requestId,
        requester_profile_id: followerProfile.profile_id,
        target_profile_id: targetProfile.profile_id,
        requester_character_id: followerCharacterId,
        target_character_id: targetCharacterId,
        status: "pending",
        created_at: new Date().toISOString(),
        created_world_date: { ...worldDate },
        resolved_at: null,
        updated_at: new Date().toISOString(),
      };

      this.maps.socialFollowRequests[requestId] = request;

      this.createNotification(
        targetCharacterId,
        "follow_request",
        followerCharacterId,
        null,
        null,
        `${followerProfile.display_name} requested to follow you`,
        worldDate
      );

      return request;
    }

    // Public account - follow immediately
    const followId = socialUid("sfollow");
    const follow: SocialFollowRecord = {
      follow_id: followId,
      follower_profile_id: followerProfile.profile_id,
      following_profile_id: targetProfile.profile_id,
      follower_character_id: followerCharacterId,
      following_character_id: targetCharacterId,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };

    this.maps.socialFollows[followId] = follow;
    followerProfile.following_count++;
    targetProfile.follower_count++;

    this.createNotification(
      targetCharacterId,
      "new_follower",
      followerCharacterId,
      null,
      null,
      `${followerProfile.display_name} followed you`,
      worldDate
    );

    return follow;
  }

  unfollow(followerCharacterId: string, targetCharacterId: string, worldDate: CalendarDate): void {
    const follow = Object.values(this.maps.socialFollows).find(
      (f) => f.follower_character_id === followerCharacterId && f.following_character_id === targetCharacterId
    );

    if (!follow) {
      throw new Error("social_not_following");
    }

    const followerProfile = this.getProfileByCharacterId(followerCharacterId);
    const targetProfile = this.getProfileByCharacterId(targetCharacterId);

    delete this.maps.socialFollows[follow.follow_id];
    if (followerProfile) followerProfile.following_count = Math.max(0, followerProfile.following_count - 1);
    if (targetProfile) targetProfile.follower_count = Math.max(0, targetProfile.follower_count - 1);
  }

  approveFollowRequest(requestId: string, worldDate: CalendarDate): void {
    const request = this.maps.socialFollowRequests[requestId];
    if (!request) throw new Error("social_follow_request_not_found");
    if (request.status !== "pending") throw new Error("social_follow_request_not_pending");

    const followerProfile = this.getProfileByCharacterId(request.requester_character_id);
    const targetProfile = this.getProfileByCharacterId(request.target_character_id);

    if (!followerProfile || !targetProfile) {
      throw new Error("social_profile_not_found");
    }

    // Create follow
    const followId = socialUid("sfollow");
    const follow: SocialFollowRecord = {
      follow_id: followId,
      follower_profile_id: request.requester_profile_id,
      following_profile_id: request.target_profile_id,
      follower_character_id: request.requester_character_id,
      following_character_id: request.target_character_id,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };

    this.maps.socialFollows[followId] = follow;
    followerProfile.following_count++;
    targetProfile.follower_count++;

    // Update request status
    request.status = "approved";
    request.resolved_at = new Date().toISOString();
    request.updated_at = new Date().toISOString();

    this.createNotification(
      request.requester_character_id,
      "follow_approved",
      request.target_character_id,
      null,
      null,
      `${targetProfile.display_name} approved your follow request`,
      worldDate
    );
  }

  rejectFollowRequest(requestId: string, worldDate: CalendarDate): void {
    const request = this.maps.socialFollowRequests[requestId];
    if (!request) throw new Error("social_follow_request_not_found");
    if (request.status !== "pending") throw new Error("social_follow_request_not_pending");

    request.status = "rejected";
    request.resolved_at = new Date().toISOString();
    request.updated_at = new Date().toISOString();
  }

  getFollowers(profileId: string): SocialProfileRecord[] {
    const profile = this.maps.socialProfiles[profileId];
    if (!profile) return [];

    const followerIds = Object.values(this.maps.socialFollows)
      .filter((f) => f.following_profile_id === profileId)
      .map((f) => f.follower_character_id);

    return followerIds
      .map((id) => this.getProfileByCharacterId(id))
      .filter((p): p is SocialProfileRecord => p !== null);
  }

  getFollowing(profileId: string): SocialProfileRecord[] {
    const profile = this.maps.socialProfiles[profileId];
    if (!profile) return [];

    const followingIds = Object.values(this.maps.socialFollows)
      .filter((f) => f.follower_profile_id === profileId)
      .map((f) => f.following_character_id);

    return followingIds
      .map((id) => this.getProfileByCharacterId(id))
      .filter((p): p is SocialProfileRecord => p !== null);
  }

  // ─── Post System ──────────────────────────────────────────────

  createPost(params: {
    author_character_id: string;
    content: string;
    content_type?: SocialContentTypeId;
    visibility?: SocialVisibilityId;
    parent_post_id?: string | null;
    reposted_post_id?: string | null;
    hashtags?: string[];
    mentions?: string[];
    media_refs?: string[];
    location?: string | null;
  }, worldDate: CalendarDate): SocialPostRecord {
    const rules = this.catalog.getRules();
    const profile = this.getProfileByCharacterId(params.author_character_id);
    if (!profile) throw new Error("social_profile_not_found");
    if (profile.account_status !== "active") throw new Error("social_account_not_active");

    if (params.content.length > rules.post_content_max_length) {
      throw new Error("social_post_too_long");
    }

    if (params.content.trim().length === 0 && !params.reposted_post_id) {
      throw new Error("social_post_empty");
    }

    const contentType = params.content_type ?? "text";
    if (!this.catalog.hasContentType(contentType)) {
      throw new Error("social_content_type_invalid");
    }

    const visibility = params.visibility ?? "public";
    if (!this.catalog.hasVisibility(visibility)) {
      throw new Error("social_visibility_invalid");
    }

    // Check rate limit
    const oneHourAgo = Date.now() - 3600000;
    const recentPosts = Object.values(this.maps.socialPosts).filter(
      (p) => p.author_character_id === params.author_character_id &&
        new Date(p.created_at).getTime() > oneHourAgo
    ).length;

    if (recentPosts >= rules.max_posts_per_hour) {
      throw new Error("social_post_rate_limit");
    }

    // Process hashtags
    const hashtags = params.hashtags ?? [];
    if (hashtags.length > rules.max_hashtags_per_post) {
      throw new Error("social_too_many_hashtags");
    }

    for (const tag of hashtags) {
      if (tag.length > rules.hashtag_max_length) {
        throw new Error("social_hashtag_too_long");
      }
      this.ensureHashtagExists(tag, worldDate);
    }

    // Process mentions
    const mentions = params.mentions ?? [];
    if (mentions.length > rules.max_mentions_per_post) {
      throw new Error("social_too_many_mentions");
    }

    const postId = socialUid("spost");
    const post: SocialPostRecord = {
      post_id: postId,
      author_profile_id: profile.profile_id,
      author_character_id: params.author_character_id,
      content: params.content,
      content_type: contentType,
      visibility,
      parent_post_id: params.parent_post_id ?? null,
      reposted_post_id: params.reposted_post_id ?? null,
      hashtags,
      mentions,
      media_refs: params.media_refs ?? [],
      like_count: 0,
      comment_count: 0,
      repost_count: 0,
      is_deleted: false,
      is_pinned: false,
      is_sponsored: false,
      ad_campaign_id: null,
      location: params.location ?? null,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };

    this.maps.socialPosts[postId] = post;
    profile.post_count++;

    // Update hashtag counts
    for (const tag of hashtags) {
      const hashtag = Object.values(this.maps.socialHashtags).find(
        (h) => h.tag.toLowerCase() === tag.toLowerCase()
      );
      if (hashtag) {
        hashtag.post_count++;
        hashtag.last_used_at = new Date().toISOString();
      }

      // Create post-hashtag link
      const hashtagId = hashtag?.hashtag_id;
      if (hashtagId) {
        const linkId = `${postId}:${hashtagId}`;
        this.maps.socialPostHashtags[linkId] = { post_id: postId, hashtag_id: hashtagId };
      }
    }

    // Notify mentioned users
    for (const mentionedUsername of mentions) {
      const mentionedProfile = this.getProfileByUsername(mentionedUsername);
      if (mentionedProfile) {
        this.createNotification(
          mentionedProfile.character_id,
          "mention",
          params.author_character_id,
          postId,
          null,
          `${profile.display_name} mentioned you in a post`,
          worldDate
        );
      }
    }

    // If this is a reply, notify parent post author and increment comment count
    if (params.parent_post_id) {
      const parentPost = this.maps.socialPosts[params.parent_post_id];
      if (parentPost && !parentPost.is_deleted) {
        parentPost.comment_count++;
        this.createNotification(
          parentPost.author_character_id,
          "reply",
          params.author_character_id,
          parentPost.post_id,
          null,
          `${profile.display_name} replied to your post`,
          worldDate
        );
      }
    }

    // If this is a repost, increment repost count
    if (params.reposted_post_id) {
      const repostedPost = this.maps.socialPosts[params.reposted_post_id];
      if (repostedPost && !repostedPost.is_deleted) {
        repostedPost.repost_count++;
        this.createNotification(
          repostedPost.author_character_id,
          "repost",
          params.author_character_id,
          repostedPost.post_id,
          null,
          `${profile.display_name} reposted your post`,
          worldDate
        );
      }
    }

    return post;
  }

  updatePost(postId: string, characterId: string, params: {
    content?: string;
    visibility?: SocialVisibilityId;
  }, worldDate: CalendarDate): SocialPostRecord {
    const post = this.maps.socialPosts[postId];
    if (!post) throw new Error("social_post_not_found");
    if (post.author_character_id !== characterId) throw new Error("social_not_post_author");
    if (post.is_deleted) throw new Error("social_post_deleted");

    const rules = this.catalog.getRules();

    // Check edit window
    const createdAt = new Date(post.created_at).getTime();
    const editWindow = rules.edit_window_minutes * 60 * 1000;
    if (Date.now() - createdAt > editWindow) {
      throw new Error("social_edit_window_expired");
    }

    if (params.content !== undefined) {
      if (params.content.length > rules.post_content_max_length) {
        throw new Error("social_post_too_long");
      }
      if (params.content.trim().length === 0) {
        throw new Error("social_post_empty");
      }
      post.content = params.content;
    }

    if (params.visibility !== undefined) {
      if (!this.catalog.hasVisibility(params.visibility)) {
        throw new Error("social_visibility_invalid");
      }
      post.visibility = params.visibility;
    }

    post.updated_at = new Date().toISOString();
    return post;
  }

  deletePost(postId: string, characterId: string, worldDate: CalendarDate): void {
    const post = this.maps.socialPosts[postId];
    if (!post) throw new Error("social_post_not_found");
    if (post.author_character_id !== characterId) throw new Error("social_not_post_author");

    post.is_deleted = true;
    post.updated_at = new Date().toISOString();

    const profile = this.getProfileByCharacterId(characterId);
    if (profile) {
      profile.post_count = Math.max(0, profile.post_count - 1);
    }

    // Decrement hashtag counts
    for (const tag of post.hashtags) {
      const hashtag = Object.values(this.maps.socialHashtags).find(
        (h) => h.tag.toLowerCase() === tag.toLowerCase()
      );
      if (hashtag) {
        hashtag.post_count = Math.max(0, hashtag.post_count - 1);
      }
    }
  }

  pinPost(postId: string, characterId: string, worldDate: CalendarDate): void {
    const post = this.maps.socialPosts[postId];
    if (!post) throw new Error("social_post_not_found");
    if (post.author_character_id !== characterId) throw new Error("social_not_post_author");

    const rules = this.catalog.getRules();
    const pinnedPosts = Object.values(this.maps.socialPosts).filter(
      (p) => p.author_character_id === characterId && p.is_pinned && !p.is_deleted
    );

    if (pinnedPosts.length >= rules.max_pinned_posts) {
      throw new Error("social_max_pinned_posts");
    }

    post.is_pinned = true;
    post.updated_at = new Date().toISOString();
  }

  unpinPost(postId: string, characterId: string): void {
    const post = this.maps.socialPosts[postId];
    if (!post) throw new Error("social_post_not_found");
    if (post.author_character_id !== characterId) throw new Error("social_not_post_author");

    post.is_pinned = false;
    post.updated_at = new Date().toISOString();
  }

  getPost(postId: string): SocialPostRecord | null {
    const post = this.maps.socialPosts[postId];
    if (!post || post.is_deleted) return null;
    return post;
  }

  getPostsByAuthor(authorCharacterId: string, limit: number = 20): SocialPostRecord[] {
    return Object.values(this.maps.socialPosts)
      .filter((p) => p.author_character_id === authorCharacterId && !p.is_deleted)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  getPostComments(postId: string, limit: number = 50): SocialCommentRecord[] {
    return Object.values(this.maps.socialComments)
      .filter((c) => c.post_id === postId && !c.is_deleted)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, limit);
  }

  // ─── Feed Generation ──────────────────────────────────────────

  getHomeFeed(characterId: string, limit: number = 20): SocialPostRecord[] {
    const profile = this.getProfileByCharacterId(characterId);
    if (!profile) return [];

    // Get list of followed accounts
    const followingIds = Object.values(this.maps.socialFollows)
      .filter((f) => f.follower_character_id === characterId)
      .map((f) => f.following_character_id);

    // Include own posts
    followingIds.push(characterId);

    // Get posts from followed accounts and self
    return Object.values(this.maps.socialPosts)
      .filter((p) => {
        if (p.is_deleted) return false;
        if (!followingIds.includes(p.author_character_id)) return false;
        
        // Check visibility
        if (p.visibility === "private" && p.author_character_id !== characterId) return false;
        if (p.visibility === "followers") {
          const authorProfile = this.getProfileByCharacterId(p.author_character_id);
          if (authorProfile?.is_private && !this.isFollowing(characterId, p.author_character_id) && p.author_character_id !== characterId) {
            return false;
          }
        }

        // Check if author is blocked or muted
        if (this.isBlocked(characterId, p.author_character_id)) return false;
        if (this.isMuted(characterId, p.author_character_id)) return false;

        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  // ─── Comment System ───────────────────────────────────────────

  createComment(params: {
    post_id: string;
    author_character_id: string;
    content: string;
    parent_comment_id?: string | null;
  }, worldDate: CalendarDate): SocialCommentRecord {
    const rules = this.catalog.getRules();
    const post = this.maps.socialPosts[params.post_id];
    if (!post || post.is_deleted) throw new Error("social_post_not_found");

    const profile = this.getProfileByCharacterId(params.author_character_id);
    if (!profile) throw new Error("social_profile_not_found");

    // Check if author can see the post
    if (post.visibility === "private" && post.author_character_id !== params.author_character_id) {
      throw new Error("social_post_not_accessible");
    }

    if (this.isBlocked(post.author_character_id, params.author_character_id)) {
      throw new Error("social_blocked_by_user");
    }

    if (params.content.length > rules.comment_content_max_length) {
      throw new Error("social_comment_too_long");
    }

    if (params.content.trim().length === 0) {
      throw new Error("social_comment_empty");
    }

    // Check rate limit
    const oneHourAgo = Date.now() - 3600000;
    const recentComments = Object.values(this.maps.socialComments).filter(
      (c) => c.author_character_id === params.author_character_id &&
        new Date(c.created_at).getTime() > oneHourAgo
    ).length;

    if (recentComments >= rules.max_comments_per_hour) {
      throw new Error("social_comment_rate_limit");
    }

    const commentId = socialUid("scomment");
    const comment: SocialCommentRecord = {
      comment_id: commentId,
      post_id: params.post_id,
      author_profile_id: profile.profile_id,
      author_character_id: params.author_character_id,
      content: params.content,
      parent_comment_id: params.parent_comment_id ?? null,
      like_count: 0,
      is_deleted: false,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };

    this.maps.socialComments[commentId] = comment;
    post.comment_count++;

    // Notify post author
    if (post.author_character_id !== params.author_character_id) {
      this.createNotification(
        post.author_character_id,
        "comment",
        params.author_character_id,
        post.post_id,
        commentId,
        `${profile.display_name} commented on your post`,
        worldDate
      );
    }

    return comment;
  }

  deleteComment(commentId: string, characterId: string): void {
    const comment = this.maps.socialComments[commentId];
    if (!comment) throw new Error("social_comment_not_found");
    if (comment.author_character_id !== characterId) throw new Error("social_not_comment_author");

    comment.is_deleted = true;
    comment.updated_at = new Date().toISOString();

    const post = this.maps.socialPosts[comment.post_id];
    if (post) {
      post.comment_count = Math.max(0, post.comment_count - 1);
    }
  }

  // ─── Reaction System ──────────────────────────────────────────

  addReaction(params: {
    post_id?: string;
    comment_id?: string;
    user_character_id: string;
    reaction_type: SocialReactionTypeId;
  }, worldDate: CalendarDate): SocialReactionRecord {
    if (!params.post_id && !params.comment_id) {
      throw new Error("social_reaction_target_required");
    }

    if (!this.catalog.hasReactionType(params.reaction_type)) {
      throw new Error("social_reaction_type_invalid");
    }

    const profile = this.getProfileByCharacterId(params.user_character_id);
    if (!profile) throw new Error("social_profile_not_found");

    // Check if already reacted
    const targetPostId = params.post_id ?? null;
    const targetCommentId = params.comment_id ?? null;
    const existingReaction = Object.values(this.maps.socialReactions).find(
      (r) => r.user_character_id === params.user_character_id &&
        r.post_id === targetPostId &&
        r.comment_id === targetCommentId
    );

    if (existingReaction) {
      throw new Error("social_already_reacted");
    }

    // Check rate limit
    const rules = this.catalog.getRules();
    const oneHourAgo = Date.now() - 3600000;
    const recentReactions = Object.values(this.maps.socialReactions).filter(
      (r) => r.user_character_id === params.user_character_id &&
        new Date(r.created_at).getTime() > oneHourAgo
    ).length;

    if (recentReactions >= rules.max_reactions_per_hour) {
      throw new Error("social_reaction_rate_limit");
    }

    const reactionId = socialUid("sreact");
    const reaction: SocialReactionRecord = {
      reaction_id: reactionId,
      post_id: params.post_id ?? null,
      comment_id: params.comment_id ?? null,
      user_profile_id: profile.profile_id,
      user_character_id: params.user_character_id,
      reaction_type: params.reaction_type,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };

    this.maps.socialReactions[reactionId] = reaction;

    // Update like count
    if (params.post_id) {
      const post = this.maps.socialPosts[params.post_id];
      if (post) {
        post.like_count++;

        // Notify post author
        if (post.author_character_id !== params.user_character_id) {
          this.createNotification(
            post.author_character_id,
            "reaction",
            params.user_character_id,
            params.post_id,
            null,
            `${profile.display_name} reacted to your post`,
            worldDate
          );
        }
      }
    } else if (params.comment_id) {
      const comment = this.maps.socialComments[params.comment_id];
      if (comment) {
        comment.like_count++;
      }
    }

    return reaction;
  }

  removeReaction(reactionId: string, characterId: string): void {
    const reaction = this.maps.socialReactions[reactionId];
    if (!reaction) throw new Error("social_reaction_not_found");
    if (reaction.user_character_id !== characterId) throw new Error("social_not_reaction_owner");

    // Update like count
    if (reaction.post_id) {
      const post = this.maps.socialPosts[reaction.post_id];
      if (post) {
        post.like_count = Math.max(0, post.like_count - 1);
      }
    } else if (reaction.comment_id) {
      const comment = this.maps.socialComments[reaction.comment_id];
      if (comment) {
        comment.like_count = Math.max(0, comment.like_count - 1);
      }
    }

    delete this.maps.socialReactions[reactionId];
  }

  hasReacted(characterId: string, postId: string | null, commentId: string | null): boolean {
    return Object.values(this.maps.socialReactions).some(
      (r) => r.user_character_id === characterId &&
        r.post_id === postId &&
        r.comment_id === commentId
    );
  }

  // ─── Hashtag System ───────────────────────────────────────────

  private ensureHashtagExists(tag: string, worldDate: CalendarDate): SocialHashtagRecord {
    const normalizedTag = tag.toLowerCase().replace(/^#/, "");
    const existing = Object.values(this.maps.socialHashtags).find(
      (h) => h.tag.toLowerCase() === normalizedTag
    );

    if (existing) return existing;

    const hashtagId = socialUid("shtag");
    const hashtag: SocialHashtagRecord = {
      hashtag_id: hashtagId,
      tag: normalizedTag,
      post_count: 0,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      last_used_at: new Date().toISOString(),
    };

    this.maps.socialHashtags[hashtagId] = hashtag;
    return hashtag;
  }

  getHashtag(tag: string): SocialHashtagRecord | null {
    const normalizedTag = tag.toLowerCase().replace(/^#/, "");
    return Object.values(this.maps.socialHashtags).find(
      (h) => h.tag.toLowerCase() === normalizedTag
    ) ?? null;
  }

  getPostsByHashtag(tag: string, limit: number = 20): SocialPostRecord[] {
    const hashtag = this.getHashtag(tag);
    if (!hashtag) return [];

    const postIds = Object.values(this.maps.socialPostHashtags)
      .filter((ph) => ph.hashtag_id === hashtag.hashtag_id)
      .map((ph) => ph.post_id);

    return postIds
      .map((id) => this.maps.socialPosts[id])
      .filter((p): p is SocialPostRecord => p !== undefined && !p.is_deleted)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  searchHashtags(query: string, limit: number = 20): SocialHashtagRecord[] {
    const normalizedQuery = query.toLowerCase().replace(/^#/, "");
    return Object.values(this.maps.socialHashtags)
      .filter((h) => h.tag.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.post_count - a.post_count)
      .slice(0, limit);
  }

  // ─── Notification System ──────────────────────────────────────

  getNotifications(characterId: string, limit: number = 50, unreadOnly: boolean = false): SocialNotificationRecord[] {
    let notifications = Object.values(this.maps.socialNotifications)
      .filter((n) => n.recipient_character_id === characterId);

    if (unreadOnly) {
      notifications = notifications.filter((n) => !n.is_read);
    }

    return notifications
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  markNotificationRead(notificationId: string, characterId: string): void {
    const notification = this.maps.socialNotifications[notificationId];
    if (!notification) throw new Error("social_notification_not_found");
    if (notification.recipient_character_id !== characterId) throw new Error("social_not_notification_owner");

    notification.is_read = true;
  }

  markAllNotificationsRead(characterId: string): void {
    Object.values(this.maps.socialNotifications)
      .filter((n) => n.recipient_character_id === characterId && !n.is_read)
      .forEach((n) => { n.is_read = true; });
  }

  getUnreadNotificationCount(characterId: string): number {
    return Object.values(this.maps.socialNotifications).filter(
      (n) => n.recipient_character_id === characterId && !n.is_read
    ).length;
  }

  // ─── Block System ─────────────────────────────────────────────

  blockUser(blockerCharacterId: string, blockedCharacterId: string, worldDate: CalendarDate): SocialBlockRecord {
    if (blockerCharacterId === blockedCharacterId) {
      throw new Error("social_cannot_block_self");
    }

    const blockerProfile = this.getProfileByCharacterId(blockerCharacterId);
    const blockedProfile = this.getProfileByCharacterId(blockedCharacterId);

    if (!blockerProfile || !blockedProfile) {
      throw new Error("social_profile_not_found");
    }

    const rules = this.catalog.getRules();
    const currentBlocks = Object.values(this.maps.socialBlocks).filter(
      (b) => b.blocker_character_id === blockerCharacterId
    ).length;

    if (currentBlocks >= rules.max_blocks) {
      throw new Error("social_max_blocks_reached");
    }

    if (this.isBlocked(blockerCharacterId, blockedCharacterId)) {
      throw new Error("social_already_blocked");
    }

    // Remove any existing follow relationships
    const followFromBlocker = Object.values(this.maps.socialFollows).find(
      (f) => f.follower_character_id === blockerCharacterId && f.following_character_id === blockedCharacterId
    );
    if (followFromBlocker) {
      this.unfollow(blockerCharacterId, blockedCharacterId, worldDate);
    }

    const followFromBlocked = Object.values(this.maps.socialFollows).find(
      (f) => f.follower_character_id === blockedCharacterId && f.following_character_id === blockerCharacterId
    );
    if (followFromBlocked) {
      this.unfollow(blockedCharacterId, blockerCharacterId, worldDate);
    }

    const blockId = socialUid("sblock");
    const block: SocialBlockRecord = {
      block_id: blockId,
      blocker_profile_id: blockerProfile.profile_id,
      blocker_character_id: blockerCharacterId,
      blocked_profile_id: blockedProfile.profile_id,
      blocked_character_id: blockedCharacterId,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };

    this.maps.socialBlocks[blockId] = block;
    return block;
  }

  unblockUser(blockerCharacterId: string, blockedCharacterId: string): void {
    const block = Object.values(this.maps.socialBlocks).find(
      (b) => b.blocker_character_id === blockerCharacterId && b.blocked_character_id === blockedCharacterId
    );

    if (!block) throw new Error("social_not_blocked");

    delete this.maps.socialBlocks[block.block_id];
  }

  getBlockedUsers(characterId: string): SocialProfileRecord[] {
    const blockedIds = Object.values(this.maps.socialBlocks)
      .filter((b) => b.blocker_character_id === characterId)
      .map((b) => b.blocked_character_id);

    return blockedIds
      .map((id) => this.getProfileByCharacterId(id))
      .filter((p): p is SocialProfileRecord => p !== null);
  }

  // ─── Mute System ──────────────────────────────────────────────

  muteUser(muterCharacterId: string, mutedCharacterId: string, worldDate: CalendarDate): SocialMuteRecord {
    if (muterCharacterId === mutedCharacterId) {
      throw new Error("social_cannot_mute_self");
    }

    const muterProfile = this.getProfileByCharacterId(muterCharacterId);
    const mutedProfile = this.getProfileByCharacterId(mutedCharacterId);

    if (!muterProfile || !mutedProfile) {
      throw new Error("social_profile_not_found");
    }

    const rules = this.catalog.getRules();
    const currentMutes = Object.values(this.maps.socialMutes).filter(
      (m) => m.muter_character_id === muterCharacterId
    ).length;

    if (currentMutes >= rules.max_mutes) {
      throw new Error("social_max_mutes_reached");
    }

    if (this.isMuted(muterCharacterId, mutedCharacterId)) {
      throw new Error("social_already_muted");
    }

    const muteId = socialUid("smute");
    const mute: SocialMuteRecord = {
      mute_id: muteId,
      muter_profile_id: muterProfile.profile_id,
      muter_character_id: muterCharacterId,
      muted_profile_id: mutedProfile.profile_id,
      muted_character_id: mutedCharacterId,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };

    this.maps.socialMutes[muteId] = mute;
    return mute;
  }

  unmuteUser(muterCharacterId: string, mutedCharacterId: string): void {
    const mute = Object.values(this.maps.socialMutes).find(
      (m) => m.muter_character_id === muterCharacterId && m.muted_character_id === mutedCharacterId
    );

    if (!mute) throw new Error("social_not_muted");

    delete this.maps.socialMutes[mute.mute_id];
  }

  getMutedUsers(characterId: string): SocialProfileRecord[] {
    const mutedIds = Object.values(this.maps.socialMutes)
      .filter((m) => m.muter_character_id === characterId)
      .map((m) => m.muted_character_id);

    return mutedIds
      .map((id) => this.getProfileByCharacterId(id))
      .filter((p): p is SocialProfileRecord => p !== null);
  }

  // ─── Report System ────────────────────────────────────────────

  createReport(params: {
    reporter_character_id: string;
    target_type: "post" | "comment" | "profile";
    target_id: string;
    category: SocialReportCategoryId;
    description: string;
  }, worldDate: CalendarDate): SocialReportRecord {
    if (!this.catalog.hasReportCategory(params.category)) {
      throw new Error("social_report_category_invalid");
    }

    const reporterProfile = this.getProfileByCharacterId(params.reporter_character_id);
    if (!reporterProfile) throw new Error("social_profile_not_found");

    // Verify target exists
    if (params.target_type === "post") {
      const post = this.maps.socialPosts[params.target_id];
      if (!post) throw new Error("social_post_not_found");
    } else if (params.target_type === "comment") {
      const comment = this.maps.socialComments[params.target_id];
      if (!comment) throw new Error("social_comment_not_found");
    } else if (params.target_type === "profile") {
      const profile = this.maps.socialProfiles[params.target_id];
      if (!profile) throw new Error("social_profile_not_found");
    }

    // Check rate limit
    const rules = this.catalog.getRules();
    const oneDayAgo = Date.now() - 86400000;
    const recentReports = Object.values(this.maps.socialReports).filter(
      (r) => r.reporter_character_id === params.reporter_character_id &&
        new Date(r.created_at).getTime() > oneDayAgo
    ).length;

    if (recentReports >= rules.max_reports_per_day) {
      throw new Error("social_report_rate_limit");
    }

    const reportId = socialUid("sreport");
    const report: SocialReportRecord = {
      report_id: reportId,
      reporter_profile_id: reporterProfile.profile_id,
      reporter_character_id: params.reporter_character_id,
      target_type: params.target_type,
      target_id: params.target_id,
      category: params.category,
      description: params.description,
      status: "pending",
      reviewer_profile_id: null,
      reviewer_character_id: null,
      resolution_notes: null,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      resolved_at: null,
      updated_at: new Date().toISOString(),
    };

    this.maps.socialReports[reportId] = report;
    return report;
  }

  resolveReport(reportId: string, reviewerCharacterId: string, status: SocialReportStatusId, resolutionNotes: string, worldDate: CalendarDate): void {
    const report = this.maps.socialReports[reportId];
    if (!report) throw new Error("social_report_not_found");
    if (report.status === "resolved" || report.status === "dismissed") {
      throw new Error("social_report_already_resolved");
    }

    const reviewerProfile = this.getProfileByCharacterId(reviewerCharacterId);
    if (!reviewerProfile) throw new Error("social_profile_not_found");

    report.status = status;
    report.reviewer_profile_id = reviewerProfile.profile_id;
    report.reviewer_character_id = reviewerCharacterId;
    report.resolution_notes = resolutionNotes;
    report.resolved_at = new Date().toISOString();
    report.updated_at = new Date().toISOString();

    // Notify reporter
    this.createNotification(
      report.reporter_character_id,
      "report_resolved",
      null,
      null,
      null,
      `Your report has been ${status}`,
      worldDate
    );
  }

  getPendingReports(): SocialReportRecord[] {
    return Object.values(this.maps.socialReports)
      .filter((r) => r.status === "pending" || r.status === "under_review")
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  // ─── Trending Topics ──────────────────────────────────────────

  calculateTrendingTopics(worldDate: CalendarDate): void {
    const rules = this.catalog.getRules();
    const windowMs = rules.trending_window_hours * 3600000;
    const cutoffTime = Date.now() - windowMs;

    // Get recent hashtags with activity
    const hashtagActivity = new Map<string, { postCount: number; participants: Set<string> }>();

    Object.values(this.maps.socialPosts)
      .filter((p) => !p.is_deleted && new Date(p.created_at).getTime() > cutoffTime)
      .forEach((post) => {
        post.hashtags.forEach((tag) => {
          const normalizedTag = tag.toLowerCase();
          if (!hashtagActivity.has(normalizedTag)) {
            hashtagActivity.set(normalizedTag, { postCount: 0, participants: new Set() });
          }
          const activity = hashtagActivity.get(normalizedTag)!;
          activity.postCount++;
          activity.participants.add(post.author_character_id);
        });
      });

    // Filter by minimum thresholds and calculate scores
    const trending: Array<{ tag: string; score: number; postCount: number; participantCount: number }> = [];

    hashtagActivity.forEach((activity, tag) => {
      if (activity.postCount >= rules.trending_min_posts && activity.participants.size >= 3) {
        const score = activity.postCount * activity.participants.size;
        trending.push({
          tag,
          score,
          postCount: activity.postCount,
          participantCount: activity.participants.size,
        });
      }
    });

    // Sort by score and take top 20
    trending.sort((a, b) => b.score - a.score);
    const top20 = trending.slice(0, 20);

    // Clear old trending topics
    this.maps.socialTrendingTopics = {};

    // Create new trending topic records
    top20.forEach(({ tag, score, postCount, participantCount }) => {
      const topicId = socialUid("strend");
      const topic: SocialTrendingTopicRecord = {
        topic_id: topicId,
        hashtag: tag,
        category: null,
        score,
        post_count: postCount,
        participant_count: participantCount,
        calculated_at: new Date().toISOString(),
        calculated_world_date: { ...worldDate },
      };
      this.maps.socialTrendingTopics[topicId] = topic;
    });
  }

  getTrendingTopics(limit: number = 10): SocialTrendingTopicRecord[] {
    return Object.values(this.maps.socialTrendingTopics)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export function socialErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    social_age_ineligible: "You must be at least 13 years old to create a social account.",
    social_username_invalid: "Username must be 3-20 characters and contain only letters, numbers, and underscores.",
    social_username_taken: "This username is already taken.",
    social_display_name_too_long: "Display name is too long.",
    social_bio_too_long: "Bio is too long.",
    social_profile_exists: "You already have a social profile.",
    social_profile_not_found: "Profile not found.",
    social_cannot_follow_self: "You cannot follow yourself.",
    social_blocked_by_user: "This user has blocked you.",
    social_already_following: "You are already following this user.",
    social_follow_request_pending: "You already have a pending follow request.",
    social_follow_request_limit: "You have reached the daily follow request limit.",
    social_follow_rate_limit: "You have reached the hourly follow limit.",
    social_not_following: "You are not following this user.",
    social_follow_request_not_found: "Follow request not found.",
    social_follow_request_not_pending: "Follow request is not pending.",
    social_cannot_block_self: "You cannot block yourself.",
    social_already_blocked: "You have already blocked this user.",
    social_not_blocked: "You have not blocked this user.",
    social_max_blocks_reached: "You have reached the maximum number of blocks.",
    social_cannot_mute_self: "You cannot mute yourself.",
    social_already_muted: "You have already muted this user.",
    social_not_muted: "You have not muted this user.",
    social_max_mutes_reached: "You have reached the maximum number of mutes.",
    social_post_too_long: "Post content is too long.",
    social_post_empty: "Post content cannot be empty.",
    social_content_type_invalid: "Invalid content type.",
    social_visibility_invalid: "Invalid visibility setting.",
    social_post_rate_limit: "You have reached the hourly post limit.",
    social_too_many_hashtags: "Too many hashtags in post.",
    social_hashtag_too_long: "Hashtag is too long.",
    social_too_many_mentions: "Too many mentions in post.",
    social_post_not_found: "Post not found.",
    social_post_deleted: "This post has been deleted.",
    social_not_post_author: "You are not the author of this post.",
    social_edit_window_expired: "The edit window has expired.",
    social_max_pinned_posts: "You have reached the maximum number of pinned posts.",
    social_post_not_accessible: "You do not have access to this post.",
    social_comment_too_long: "Comment is too long.",
    social_comment_empty: "Comment cannot be empty.",
    social_comment_rate_limit: "You have reached the hourly comment limit.",
    social_comment_not_found: "Comment not found.",
    social_not_comment_author: "You are not the author of this comment.",
    social_reaction_target_required: "Reaction must target a post or comment.",
    social_reaction_type_invalid: "Invalid reaction type.",
    social_already_reacted: "You have already reacted to this.",
    social_reaction_rate_limit: "You have reached the hourly reaction limit.",
    social_reaction_not_found: "Reaction not found.",
    social_not_reaction_owner: "You do not own this reaction.",
    social_notification_not_found: "Notification not found.",
    social_not_notification_owner: "You do not own this notification.",
    social_report_category_invalid: "Invalid report category.",
    social_report_rate_limit: "You have reached the daily report limit.",
    social_report_not_found: "Report not found.",
    social_report_already_resolved: "This report has already been resolved.",
  };
  return messages[code] ?? "An unexpected social network error occurred.";
}
