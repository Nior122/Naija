/**
 * Stage 18 — Social Network System tests
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { SocialService, emptySocialMaps } from "../dist/social/service.js";
import { SocialCatalogService } from "../dist/social/catalog.js";

const worldDate = { year: 2025, month: 6, day: 15 };

describe("Social Network System", () => {
  let service;
  let catalog;
  let maps;

  beforeEach(() => {
    maps = emptySocialMaps();
    catalog = new SocialCatalogService();
    service = new SocialService(maps, catalog);
  });

  describe("Profile Management", () => {
    test("creates a social profile successfully", () => {
      const profile = service.createProfile({
        character_id: "char-1",
        username: "testuser",
        display_name: "Test User",
        bio: "Hello world",
        character_age: 18,
      }, worldDate);

      assert.ok(profile);
      assert.strictEqual(profile.username, "testuser");
      assert.strictEqual(profile.display_name, "Test User");
      assert.strictEqual(profile.bio, "Hello world");
      assert.strictEqual(profile.account_status, "active");
      assert.strictEqual(profile.is_verified, false);
    });

    test("rejects profile creation for underage users", () => {
      assert.throws(() => {
        service.createProfile({
          character_id: "char-young",
          username: "younguser",
          display_name: "Young User",
          character_age: 12,
        }, worldDate);
      }, /social_age_ineligible/);
    });

    test("rejects duplicate usernames", () => {
      service.createProfile({
        character_id: "char-1",
        username: "uniqueuser",
        display_name: "User One",
        character_age: 20,
      }, worldDate);

      assert.throws(() => {
        service.createProfile({
          character_id: "char-2",
          username: "uniqueuser",
          display_name: "User Two",
          character_age: 20,
        }, worldDate);
      }, /social_username_taken/);
    });

    test("rejects invalid usernames", () => {
      assert.throws(() => {
        service.createProfile({
          character_id: "char-1",
          username: "ab", // too short
          display_name: "Test",
          character_age: 20,
        }, worldDate);
      }, /social_username_invalid/);
    });

    test("updates profile successfully", () => {
      const profile = service.createProfile({
        character_id: "char-1",
        username: "testuser",
        display_name: "Test User",
        character_age: 20,
      }, worldDate);

      const updated = service.updateProfile(profile.profile_id, {
        display_name: "Updated Name",
        bio: "New bio",
      }, worldDate);

      assert.strictEqual(updated.display_name, "Updated Name");
      assert.strictEqual(updated.bio, "New bio");
    });

    test("retrieves profile by username", () => {
      service.createProfile({
        character_id: "char-1",
        username: "findme",
        display_name: "Find Me",
        character_age: 20,
      }, worldDate);

      const found = service.getProfileByUsername("findme");
      assert.ok(found);
      assert.strictEqual(found.username, "findme");
    });

    test("searches profiles by query", () => {
      service.createProfile({
        character_id: "char-1",
        username: "alice",
        display_name: "Alice Johnson",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "bob",
        display_name: "Bob Smith",
        character_age: 20,
      }, worldDate);

      const results = service.searchProfiles("alice");
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].username, "alice");
    });
  });

  describe("Follow System", () => {
    test("follows a public account successfully", () => {
      const profile1 = service.createProfile({
        character_id: "char-1",
        username: "follower",
        display_name: "Follower",
        character_age: 20,
      }, worldDate);

      const profile2 = service.createProfile({
        character_id: "char-2",
        username: "followed",
        display_name: "Followed",
        character_age: 20,
      }, worldDate);

      const follow = service.follow("char-1", "char-2", worldDate);
      assert.ok(follow);
      assert.strictEqual(follow.follower_character_id, "char-1");
      assert.strictEqual(follow.following_character_id, "char-2");

      const updatedProfile1 = service.getProfile(profile1.profile_id);
      const updatedProfile2 = service.getProfile(profile2.profile_id);
      assert.strictEqual(updatedProfile1.following_count, 1);
      assert.strictEqual(updatedProfile2.follower_count, 1);
    });

    test("prevents following yourself", () => {
      service.createProfile({
        character_id: "char-1",
        username: "lonely",
        display_name: "Lonely",
        character_age: 20,
      }, worldDate);

      assert.throws(() => {
        service.follow("char-1", "char-1", worldDate);
      }, /social_cannot_follow_self/);
    });

    test("creates follow request for private accounts", () => {
      const profile1 = service.createProfile({
        character_id: "char-1",
        username: "requester",
        display_name: "Requester",
        character_age: 20,
      }, worldDate);

      const profile2 = service.createProfile({
        character_id: "char-2",
        username: "private",
        display_name: "Private",
        character_age: 20,
        is_private: true,
      }, worldDate);

      const request = service.follow("char-1", "char-2", worldDate);
      assert.ok(request);
      assert.strictEqual(request.status, "pending");
    });

    test("approves follow request", () => {
      service.createProfile({
        character_id: "char-1",
        username: "requester",
        display_name: "Requester",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "private",
        display_name: "Private",
        character_age: 20,
        is_private: true,
      }, worldDate);

      const request = service.follow("char-1", "char-2", worldDate);
      service.approveFollowRequest(request.request_id, worldDate);

      const isFollowing = service.isFollowing("char-1", "char-2");
      assert.strictEqual(isFollowing, true);
    });

    test("unfollows successfully", () => {
      service.createProfile({
        character_id: "char-1",
        username: "follower",
        display_name: "Follower",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "followed",
        display_name: "Followed",
        character_age: 20,
      }, worldDate);

      service.follow("char-1", "char-2", worldDate);
      service.unfollow("char-1", "char-2", worldDate);

      const isFollowing = service.isFollowing("char-1", "char-2");
      assert.strictEqual(isFollowing, false);
    });
  });

  describe("Post System", () => {
    test("creates a text post successfully", () => {
      const profile = service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "Hello world!",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      assert.ok(post);
      assert.strictEqual(post.content, "Hello world!");
      assert.strictEqual(post.content_type, "text");
      assert.strictEqual(post.visibility, "public");
    });

    test("creates a post with hashtags", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "Check this out!",
        content_type: "text",
        visibility: "public",
        hashtags: ["test", "hello"],
      }, worldDate);

      assert.strictEqual(post.hashtags.length, 2);
      assert.ok(post.hashtags.includes("test"));
      assert.ok(post.hashtags.includes("hello"));
    });

    test("rejects posts that are too long", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      const longContent = "x".repeat(501);
      assert.throws(() => {
        service.createPost({
          author_character_id: "char-1",
          content: longContent,
          content_type: "text",
          visibility: "public",
        }, worldDate);
      }, /social_post_too_long/);
    });

    test("updates a post within edit window", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "Original content",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      const updated = service.updatePost(post.post_id, "char-1", {
        content: "Updated content",
      }, worldDate);

      assert.strictEqual(updated.content, "Updated content");
    });

    test("deletes a post", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "To be deleted",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      service.deletePost(post.post_id, "char-1", worldDate);

      const deleted = service.getPost(post.post_id);
      assert.strictEqual(deleted, null);
    });

    test("creates a comment on a post", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "commenter",
        display_name: "Commenter",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "Post content",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      const comment = service.createComment({
        post_id: post.post_id,
        author_character_id: "char-2",
        content: "Great post!",
      }, worldDate);

      assert.ok(comment);
      assert.strictEqual(comment.content, "Great post!");

      const updatedPost = service.getPost(post.post_id);
      assert.strictEqual(updatedPost.comment_count, 1);
    });
  });

  describe("Reaction System", () => {
    test("adds a reaction to a post", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "reactor",
        display_name: "Reactor",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "React to this",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      const reaction = service.addReaction({
        post_id: post.post_id,
        user_character_id: "char-2",
        reaction_type: "like",
      }, worldDate);

      assert.ok(reaction);
      assert.strictEqual(reaction.reaction_type, "like");

      const updatedPost = service.getPost(post.post_id);
      assert.strictEqual(updatedPost.like_count, 1);
    });

    test("prevents duplicate reactions", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "reactor",
        display_name: "Reactor",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "React to this",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      service.addReaction({
        post_id: post.post_id,
        user_character_id: "char-2",
        reaction_type: "like",
      }, worldDate);

      // User already reacted, trying to add another reaction should throw
      assert.throws(() => {
        service.addReaction({
          post_id: post.post_id,
          user_character_id: "char-2",
          reaction_type: "like",
        }, worldDate);
      }, /social_already_reacted/);
    });

    test("removes a reaction", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "reactor",
        display_name: "Reactor",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-1",
        content: "React to this",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      const reaction = service.addReaction({
        post_id: post.post_id,
        user_character_id: "char-2",
        reaction_type: "like",
      }, worldDate);

      service.removeReaction(reaction.reaction_id, "char-2");

      const updatedPost = service.getPost(post.post_id);
      assert.strictEqual(updatedPost.like_count, 0);
    });
  });

  describe("Block and Mute System", () => {
    test("blocks a user successfully", () => {
      service.createProfile({
        character_id: "char-1",
        username: "blocker",
        display_name: "Blocker",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "blocked",
        display_name: "Blocked",
        character_age: 20,
      }, worldDate);

      const block = service.blockUser("char-1", "char-2", worldDate);
      assert.ok(block);

      const isBlocked = service.isBlocked("char-1", "char-2");
      assert.strictEqual(isBlocked, true);
    });

    test("prevents following when blocked", () => {
      service.createProfile({
        character_id: "char-1",
        username: "blocker",
        display_name: "Blocker",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "blocked",
        display_name: "Blocked",
        character_age: 20,
      }, worldDate);

      service.blockUser("char-1", "char-2", worldDate);

      assert.throws(() => {
        service.follow("char-2", "char-1", worldDate);
      }, /social_blocked_by_user/);
    });

    test("mutes a user successfully", () => {
      service.createProfile({
        character_id: "char-1",
        username: "muter",
        display_name: "Muter",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "muted",
        display_name: "Muted",
        character_age: 20,
      }, worldDate);

      const mute = service.muteUser("char-1", "char-2", worldDate);
      assert.ok(mute);

      const isMuted = service.isMuted("char-1", "char-2");
      assert.strictEqual(isMuted, true);
    });
  });

  describe("Feed System", () => {
    test("returns home feed for followed accounts", () => {
      service.createProfile({
        character_id: "char-1",
        username: "user1",
        display_name: "User One",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "user2",
        display_name: "User Two",
        character_age: 20,
      }, worldDate);

      service.follow("char-1", "char-2", worldDate);

      service.createPost({
        author_character_id: "char-2",
        content: "Post from followed user",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      const feed = service.getHomeFeed("char-1");
      assert.ok(feed.length > 0);
      assert.strictEqual(feed[0].content, "Post from followed user");
    });

    test("excludes blocked users from feed", () => {
      service.createProfile({
        character_id: "char-1",
        username: "user1",
        display_name: "User One",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "user2",
        display_name: "User Two",
        character_age: 20,
      }, worldDate);

      service.follow("char-1", "char-2", worldDate);

      service.createPost({
        author_character_id: "char-2",
        content: "Post from followed user",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      service.blockUser("char-1", "char-2", worldDate);

      const feed = service.getHomeFeed("char-1");
      const hasBlockedPost = feed.some(p => p.author_character_id === "char-2");
      assert.strictEqual(hasBlockedPost, false);
    });
  });

  describe("Notification System", () => {
    test("creates notification for new follower", () => {
      service.createProfile({
        character_id: "char-1",
        username: "follower",
        display_name: "Follower",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "followed",
        display_name: "Followed",
        character_age: 20,
      }, worldDate);

      service.follow("char-1", "char-2", worldDate);

      const notifications = service.getNotifications("char-2");
      assert.ok(notifications.length > 0);
      assert.strictEqual(notifications[0].notification_type, "new_follower");
    });

    test("marks notifications as read", () => {
      service.createProfile({
        character_id: "char-1",
        username: "follower",
        display_name: "Follower",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "followed",
        display_name: "Followed",
        character_age: 20,
      }, worldDate);

      service.follow("char-1", "char-2", worldDate);

      const notifications = service.getNotifications("char-2");
      assert.strictEqual(notifications[0].is_read, false);

      service.markNotificationRead(notifications[0].notification_id, "char-2");

      const updatedNotifications = service.getNotifications("char-2");
      assert.strictEqual(updatedNotifications[0].is_read, true);
    });
  });

  describe("Report System", () => {
    test("creates a report successfully", () => {
      service.createProfile({
        character_id: "char-1",
        username: "reporter",
        display_name: "Reporter",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "reported",
        display_name: "Reported",
        character_age: 20,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-2",
        content: "Reportable content",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      const report = service.createReport({
        reporter_character_id: "char-1",
        target_type: "post",
        target_id: post.post_id,
        category: "spam",
        description: "This is spam",
      }, worldDate);

      assert.ok(report);
      assert.strictEqual(report.status, "pending");
    });

    test("resolves a report", () => {
      service.createProfile({
        character_id: "char-1",
        username: "reporter",
        display_name: "Reporter",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-2",
        username: "reported",
        display_name: "Reported",
        character_age: 20,
      }, worldDate);

      service.createProfile({
        character_id: "char-3",
        username: "moderator",
        display_name: "Moderator",
        character_age: 25,
      }, worldDate);

      const post = service.createPost({
        author_character_id: "char-2",
        content: "Reportable content",
        content_type: "text",
        visibility: "public",
      }, worldDate);

      const report = service.createReport({
        reporter_character_id: "char-1",
        target_type: "post",
        target_id: post.post_id,
        category: "spam",
        description: "This is spam",
      }, worldDate);

      service.resolveReport(report.report_id, "char-3", "resolved", "Confirmed spam", worldDate);

      const pendingReports = service.getPendingReports();
      assert.strictEqual(pendingReports.length, 0);
    });
  });

  describe("Hashtag System", () => {
    test("creates hashtag when post is created", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      service.createPost({
        author_character_id: "char-1",
        content: "Testing hashtags",
        content_type: "text",
        visibility: "public",
        hashtags: ["test", "hello"],
      }, worldDate);

      const hashtag = service.getHashtag("test");
      assert.ok(hashtag);
      assert.strictEqual(hashtag.post_count, 1);
    });

    test("retrieves posts by hashtag", () => {
      service.createProfile({
        character_id: "char-1",
        username: "poster",
        display_name: "Poster",
        character_age: 20,
      }, worldDate);

      service.createPost({
        author_character_id: "char-1",
        content: "Post one",
        content_type: "text",
        visibility: "public",
        hashtags: ["trending"],
      }, worldDate);

      service.createPost({
        author_character_id: "char-1",
        content: "Post two",
        content_type: "text",
        visibility: "public",
        hashtags: ["trending"],
      }, worldDate);

      const posts = service.getPostsByHashtag("trending");
      assert.strictEqual(posts.length, 2);
    });
  });
});
