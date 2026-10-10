/**
 * Stage 16 — Religion, Culture and Community System
 *
 * Server-authoritative service for communities, institutions, memberships,
 * cultural profiles, festivals, projects, disputes, and reputation.
 *
 * Integrates with geography (locations), life (relationships), government,
 * careers, economy, and justice systems.
 *
 * All participation is voluntary. No automatic religious/cultural assignment.
 * Privacy is respected — sensitive info is not exposed without authorization.
 */

import type { CalendarDate } from "../life/types.js";
import type {
  PersistentCultureMaps,
  CommunityRecord,
  CommunityMembershipRecord,
  InstitutionRecord,
  InstitutionMembershipRecord,
  CulturalProfileRecord,
  CommunityEventRecord,
  CommunityProjectRecord,
  CommunityAnnouncementRecord,
  CommunityReputationRecord,
  CommunityDisputeRecord,
  CommunityContributionRecord,
  CommunityAuditRecord,
  CommunityTypeId,
  InstitutionCategoryId,
  InstitutionGeneralCategory,
  ReligiousCategoryId,
  ProjectCategoryId,
  ProjectStatusId,
  MembershipStatusId,
  EventStatusId,
  DisputeStatusId,
  CulturalProfileSnapshot,
  CommunitySnapshot,
} from "./types.js";
import { CultureCatalogService } from "./catalog.js";

export function emptyCultureMaps(): PersistentCultureMaps {
  return {
    communities: {},
    communityMemberships: {},
    institutions: {},
    institutionMemberships: {},
    culturalProfiles: {},
    communityEvents: {},
    communityProjects: {},
    communityAnnouncements: {},
    communityReputation: {},
    communityDisputes: {},
    communityContributions: {},
    communityAudits: {},
  };
}

let _uidCounter = 0;
function uid(prefix: string): string {
  _uidCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
}

function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return Math.floor((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export function initializeCultureWorldState(state: PersistentCultureMaps): void {
  if (!state.communities) state.communities = {};
  if (!state.communityMemberships) state.communityMemberships = {};
  if (!state.institutions) state.institutions = {};
  if (!state.institutionMemberships) state.institutionMemberships = {};
  if (!state.culturalProfiles) state.culturalProfiles = {};
  if (!state.communityEvents) state.communityEvents = {};
  if (!state.communityProjects) state.communityProjects = {};
  if (!state.communityAnnouncements) state.communityAnnouncements = {};
  if (!state.communityReputation) state.communityReputation = {};
  if (!state.communityDisputes) state.communityDisputes = {};
  if (!state.communityContributions) state.communityContributions = {};
  if (!state.communityAudits) state.communityAudits = {};
}

export function seedCultureWorld(): { seeded: boolean } {
  // Culture catalogue is configuration-only; no runtime seeding required.
  return { seeded: true };
}

export class CultureService {
  private maps: PersistentCultureMaps;
  private catalog: CultureCatalogService;

  constructor(maps: PersistentCultureMaps | null, catalog: CultureCatalogService) {
    this.maps = maps ?? emptyCultureMaps();
    this.catalog = catalog;
  }

  getMaps(): PersistentCultureMaps { return this.maps; }

  private audit(category: string, data: { community_id?: string; institution_id?: string; character_id?: string; actor_character_id?: string; summary: string; details?: Record<string, string | number | boolean | null> }, worldDate: CalendarDate) {
    const id = `caudit-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
    _uidCounter++;
    const record: CommunityAuditRecord = {
      audit_id: id, category,
      community_id: data.community_id ?? null,
      institution_id: data.institution_id ?? null,
      character_id: data.character_id ?? null,
      actor_character_id: data.actor_character_id ?? null,
      summary: data.summary, details: data.details ?? {},
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };
    this.maps.communityAudits[id] = record;
  }

  // ─── Communities ──────────────────────────────────────────────

  createCommunity(params: {
    name: string;
    description: string;
    community_type: CommunityTypeId;
    state_id?: string | null;
    lga_id?: string | null;
    ward_id?: string | null;
    settlement_id?: string | null;
    cultural_associations?: string[];
    languages?: string[];
    creator_character_id: string;
    creator_age: number;
  }, worldDate: CalendarDate): CommunityRecord {
    const rules = this.catalog.getRules();
    if (params.creator_age < rules.minimum_age_for_leadership) throw new Error("culture_age_ineligible");
    if (!this.catalog.hasCommunityType(params.community_type)) throw new Error("culture_community_type_invalid");
    if (!params.name || params.name.length > 100) throw new Error("culture_name_invalid");
    if (params.description.length > rules.description_max_length) throw new Error("culture_description_too_long");

    const id = uid("community");
    const record: CommunityRecord = {
      community_id: id,
      name: params.name,
      description: params.description,
      community_type: params.community_type,
      state_id: params.state_id ?? null,
      lga_id: params.lga_id ?? null,
      ward_id: params.ward_id ?? null,
      settlement_id: params.settlement_id ?? null,
      cultural_associations: params.cultural_associations ?? [],
      languages: params.languages ?? [],
      population_estimate: 0,
      status: "active",
      parent_community_id: null,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.communities[id] = record;

    // Creator automatically becomes a member with leader role
    const memId = uid("commmem");
    this.maps.communityMemberships[memId] = {
      membership_id: memId, community_id: id,
      character_id: params.creator_character_id,
      membership_type: "voluntary", status: "active",
      roles: ["community_organizer"],
      joined_at: new Date().toISOString(),
      joined_world_date: { ...worldDate },
      left_at: null, left_world_date: null,
      participation_score: 0.1,
      updated_at: new Date().toISOString(),
    };

    // Initialize reputation
    const repKey = `${params.creator_character_id}:${id}`;
    this.maps.communityReputation[repKey] = {
      character_id: params.creator_character_id,
      community_id: id,
      community_trust: 0.1,
      participation_score: 0.1,
      leadership_reputation: 0.1,
      last_active: new Date().toISOString(),
      last_active_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };

    this.audit("community_created", { community_id: id, actor_character_id: params.creator_character_id, summary: `Community created: ${params.name}`, details: { type: params.community_type } }, worldDate);
    return record;
  }

  getCommunity(communityId: string): CommunityRecord | undefined {
    return this.maps.communities[communityId];
  }

  listCommunities(stateId?: string, lgaId?: string, type?: CommunityTypeId): readonly CommunityRecord[] {
    let results = Object.values(this.maps.communities).filter((c) => c.status === "active");
    if (stateId) results = results.filter((c) => c.state_id === stateId);
    if (lgaId) results = results.filter((c) => c.lga_id === lgaId);
    if (type) results = results.filter((c) => c.community_type === type);
    return results;
  }

  // ─── Community Membership ─────────────────────────────────────

  joinCommunity(communityId: string, characterId: string, characterAge: number, worldDate: CalendarDate): CommunityMembershipRecord {
    const community = this.maps.communities[communityId];
    if (!community) throw new Error("culture_community_not_found");
    if (community.status !== "active") throw new Error("culture_community_inactive");

    const rules = this.catalog.getRules();
    if (characterAge < rules.minimum_age_for_membership) throw new Error("culture_age_ineligible");

    // Check max communities
    const existingMemberships = Object.values(this.maps.communityMemberships).filter(
      (m) => m.character_id === characterId && m.status === "active"
    );
    if (existingMemberships.length >= rules.max_communities_per_character) throw new Error("culture_max_communities");

    // Check not already a member
    const existing = Object.values(this.maps.communityMemberships).find(
      (m) => m.community_id === communityId && m.character_id === characterId && m.status === "active"
    );
    if (existing) throw new Error("culture_already_member");

    // Check member limit
    const currentMembers = Object.values(this.maps.communityMemberships).filter(
      (m) => m.community_id === communityId && m.status === "active"
    );
    if (currentMembers.length >= rules.max_members_per_community) throw new Error("culture_community_full");

    const id = uid("commmem");
    const record: CommunityMembershipRecord = {
      membership_id: id, community_id: communityId,
      character_id: characterId, membership_type: "voluntary",
      status: "active", roles: [],
      joined_at: new Date().toISOString(),
      joined_world_date: { ...worldDate },
      left_at: null, left_world_date: null,
      participation_score: 0,
      updated_at: new Date().toISOString(),
    };
    this.maps.communityMemberships[id] = record;

    // Update reputation
    const repKey = `${characterId}:${communityId}`;
    if (!this.maps.communityReputation[repKey]) {
      this.maps.communityReputation[repKey] = {
        character_id: characterId, community_id: communityId,
        community_trust: 0, participation_score: 0, leadership_reputation: 0,
        last_active: new Date().toISOString(),
        last_active_world_date: { ...worldDate },
        updated_at: new Date().toISOString(),
      };
    }

    this.audit("membership_joined", { community_id: communityId, character_id: characterId, summary: `Character joined community` }, worldDate);
    return record;
  }

  leaveCommunity(communityId: string, characterId: string, worldDate: CalendarDate): void {
    const membership = Object.values(this.maps.communityMemberships).find(
      (m) => m.community_id === communityId && m.character_id === characterId && m.status === "active"
    );
    if (!membership) throw new Error("culture_membership_not_found");
    if (membership.roles.includes("community_organizer")) {
      // Check if they're the only organizer
      const otherOrganizers = Object.values(this.maps.communityMemberships).filter(
        (m) => m.community_id === communityId && m.status === "active" && m.roles.includes("community_organizer") && m.character_id !== characterId
      );
      if (otherOrganizers.length === 0) throw new Error("culture_last_organizer_cannot_leave");
    }
    membership.status = "left";
    membership.left_at = new Date().toISOString();
    membership.left_world_date = { ...worldDate };
    membership.updated_at = new Date().toISOString();
    this.audit("membership_left", { community_id: communityId, character_id: characterId, summary: `Character left community` }, worldDate);
  }

  getCommunityMembers(communityId: string): readonly CommunityMembershipRecord[] {
    return Object.values(this.maps.communityMemberships).filter(
      (m) => m.community_id === communityId && m.status === "active"
    );
  }

  getCharacterMemberships(characterId: string): readonly CommunityMembershipRecord[] {
    return Object.values(this.maps.communityMemberships).filter(
      (m) => m.character_id === characterId && m.status === "active"
    );
  }

  // ─── Institutions ─────────────────────────────────────────────

  createInstitution(params: {
    name: string;
    category: InstitutionCategoryId;
    general_category: InstitutionGeneralCategory;
    religious_category?: ReligiousCategoryId | null;
    description: string;
    community_id?: string | null;
    state_id?: string | null;
    lga_id?: string | null;
    settlement_id?: string | null;
    creator_character_id: string;
    creator_age: number;
    gathering_schedule?: Array<{ day_of_week: number; time_of_day: number; label: string }>;
  }, worldDate: CalendarDate): InstitutionRecord {
    const rules = this.catalog.getRules();
    if (params.creator_age < rules.minimum_age_for_leadership) throw new Error("culture_age_ineligible");
    if (!this.catalog.hasInstitutionCategory(params.category)) throw new Error("culture_institution_category_invalid");
    if (!params.name || params.name.length > 100) throw new Error("culture_name_invalid");
    if (params.description.length > rules.description_max_length) throw new Error("culture_description_too_long");

    const id = uid("institution");
    const record: InstitutionRecord = {
      institution_id: id,
      name: params.name,
      category: params.category,
      general_category: params.general_category,
      religious_category: params.religious_category ?? null,
      description: params.description,
      community_id: params.community_id ?? null,
      state_id: params.state_id ?? null,
      lga_id: params.lga_id ?? null,
      settlement_id: params.settlement_id ?? null,
      leader_character_id: params.creator_character_id,
      leader_role_id: params.general_category === "religious" ? "pastor" : (params.general_category === "traditional" ? "elder" : "community_organizer"),
      leadership_history: [{ character_id: params.creator_character_id, role_id: "founder", from_date: new Date().toISOString(), to_date: null }],
      gathering_schedule: params.gathering_schedule ?? [],
      member_count: 1,
      reputation_score: 0.1,
      status: "active",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.institutions[id] = record;

    // Creator becomes a member
    const memId = uid("instmem");
    this.maps.institutionMemberships[memId] = {
      membership_id: memId, institution_id: id,
      character_id: params.creator_character_id,
      role_id: record.leader_role_id ?? "founder",
      role_level: 5,
      status: "active",
      joined_at: new Date().toISOString(),
      joined_world_date: { ...worldDate },
      left_at: null,
      updated_at: new Date().toISOString(),
    };

    this.audit("institution_created", { institution_id: id, actor_character_id: params.creator_character_id, summary: `Institution created: ${params.name}`, details: { category: params.category } }, worldDate);
    return record;
  }

  getInstitution(institutionId: string): InstitutionRecord | undefined {
    return this.maps.institutions[institutionId];
  }

  listInstitutions(communityId?: string, stateId?: string, generalCategory?: InstitutionGeneralCategory): readonly InstitutionRecord[] {
    let results = Object.values(this.maps.institutions).filter((i) => i.status === "active");
    if (communityId) results = results.filter((i) => i.community_id === communityId);
    if (stateId) results = results.filter((i) => i.state_id === stateId);
    if (generalCategory) results = results.filter((i) => i.general_category === generalCategory);
    return results;
  }

  // ─── Institution Membership ───────────────────────────────────

  joinInstitution(institutionId: string, characterId: string, characterAge: number, worldDate: CalendarDate): InstitutionMembershipRecord {
    const institution = this.maps.institutions[institutionId];
    if (!institution) throw new Error("culture_institution_not_found");
    if (institution.status !== "active") throw new Error("culture_institution_inactive");

    const rules = this.catalog.getRules();
    if (characterAge < rules.minimum_age_for_membership) throw new Error("culture_age_ineligible");

    // Check not already a member
    const existing = Object.values(this.maps.institutionMemberships).find(
      (m) => m.institution_id === institutionId && m.character_id === characterId && m.status === "active"
    );
    if (existing) throw new Error("culture_already_member");

    const id = uid("instmem");
    const record: InstitutionMembershipRecord = {
      membership_id: id, institution_id: institutionId,
      character_id: characterId,
      role_id: "congregation_member",
      role_level: 1,
      status: "active",
      joined_at: new Date().toISOString(),
      joined_world_date: { ...worldDate },
      left_at: null,
      updated_at: new Date().toISOString(),
    };
    this.maps.institutionMemberships[id] = record;
    institution.member_count++;
    institution.updated_at = new Date().toISOString();

    this.audit("institution_joined", { institution_id: institutionId, character_id: characterId, summary: `Character joined institution` }, worldDate);
    return record;
  }

  leaveInstitution(institutionId: string, characterId: string, worldDate: CalendarDate): void {
    const membership = Object.values(this.maps.institutionMemberships).find(
      (m) => m.institution_id === institutionId && m.character_id === characterId && m.status === "active"
    );
    if (!membership) throw new Error("culture_membership_not_found");
    membership.status = "left";
    membership.left_at = new Date().toISOString();
    membership.updated_at = new Date().toISOString();

    const institution = this.maps.institutions[institutionId];
    if (institution) {
      institution.member_count = Math.max(0, institution.member_count - 1);
      if (institution.leader_character_id === characterId) {
        institution.leader_character_id = null;
        institution.leader_role_id = null;
      }
      institution.updated_at = new Date().toISOString();
    }

    this.audit("institution_left", { institution_id: institutionId, character_id: characterId, summary: `Character left institution` }, worldDate);
  }

  // ─── Cultural Profile ─────────────────────────────────────────

  getCulturalProfile(characterId: string): CulturalProfileRecord | null {
    return this.maps.culturalProfiles[characterId] ?? null;
  }

  updateCulturalProfile(params: {
    character_id: string;
    languages_spoken?: string[];
    preferred_language?: string | null;
    religious_affiliation?: ReligiousCategoryId | null;
    cultural_interests?: string[];
    heritage_associations?: string[];
  }, worldDate: CalendarDate): CulturalProfileRecord {
    const existing = this.maps.culturalProfiles[params.character_id] ?? {
      character_id: params.character_id,
      languages_spoken: [],
      preferred_language: null,
      religious_affiliation: null,
      cultural_interests: [],
      heritage_associations: [],
      voluntary_disclosure: true,
      updated_at: new Date().toISOString(),
      updated_world_date: { ...worldDate },
    };

    if (params.languages_spoken !== undefined) {
      for (const lang of params.languages_spoken) {
        if (!this.catalog.hasLanguage(lang)) throw new Error("culture_language_invalid");
      }
      existing.languages_spoken = [...params.languages_spoken];
    }
    if (params.preferred_language !== undefined) {
      if (params.preferred_language !== null && !this.catalog.hasLanguage(params.preferred_language)) throw new Error("culture_language_invalid");
      existing.preferred_language = params.preferred_language;
    }
    if (params.religious_affiliation !== undefined) {
      if (params.religious_affiliation !== null && !this.catalog.hasReligiousCategory(params.religious_affiliation)) throw new Error("culture_religious_category_invalid");
      existing.religious_affiliation = params.religious_affiliation;
    }
    if (params.cultural_interests !== undefined) {
      existing.cultural_interests = [...params.cultural_interests];
    }
    if (params.heritage_associations !== undefined) {
      existing.heritage_associations = [...params.heritage_associations];
    }

    existing.updated_at = new Date().toISOString();
    existing.updated_world_date = { ...worldDate };
    this.maps.culturalProfiles[params.character_id] = existing;
    return existing;
  }

  // ─── Events ───────────────────────────────────────────────────

  createEvent(params: {
    community_id?: string | null;
    institution_id?: string | null;
    festival_definition_id?: string | null;
    name: string;
    description: string;
    category: string;
    organizer_character_id: string;
    state_id?: string | null;
    lga_id?: string | null;
    settlement_id?: string | null;
    start_world_date: CalendarDate;
    end_world_date?: CalendarDate | null;
    capacity?: number | null;
  }, worldDate: CalendarDate): CommunityEventRecord {
    const rules = this.catalog.getRules();
    if (!params.name || params.name.length > 100) throw new Error("culture_name_invalid");
    if (params.description.length > rules.description_max_length) throw new Error("culture_description_too_long");

    const id = uid("commevent");
    const record: CommunityEventRecord = {
      event_id: id,
      community_id: params.community_id ?? null,
      institution_id: params.institution_id ?? null,
      festival_definition_id: params.festival_definition_id ?? null,
      name: params.name,
      description: params.description,
      category: params.category,
      organizer_character_id: params.organizer_character_id,
      state_id: params.state_id ?? null,
      lga_id: params.lga_id ?? null,
      settlement_id: params.settlement_id ?? null,
      start_date: new Date().toISOString(),
      start_world_date: { ...params.start_world_date },
      end_date: params.end_world_date ? new Date().toISOString() : null,
      end_world_date: params.end_world_date ? { ...params.end_world_date } : null,
      status: "scheduled",
      attendee_character_ids: [],
      capacity: params.capacity ?? null,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.communityEvents[id] = record;
    this.audit("event_created", { ...(params.community_id ? { community_id: params.community_id } : {}), character_id: params.organizer_character_id, summary: `Event created: ${params.name}` }, worldDate);
    return record;
  }

  attendEvent(eventId: string, characterId: string, worldDate: CalendarDate): void {
    const event = this.maps.communityEvents[eventId];
    if (!event) throw new Error("culture_event_not_found");
    if (event.status !== "scheduled") throw new Error("culture_event_not_attendable");
    if (event.attendee_character_ids.includes(characterId)) throw new Error("culture_already_attending");
    if (event.capacity !== null && event.attendee_character_ids.length >= event.capacity) throw new Error("culture_event_full");
    event.attendee_character_ids = [...event.attendee_character_ids, characterId];
    event.updated_at = new Date().toISOString();

    // Boost reputation
    if (event.community_id) {
      const repKey = `${characterId}:${event.community_id}`;
      const rep = this.maps.communityReputation[repKey];
      if (rep) {
        rep.participation_score += this.catalog.getRules().reputation_gain_per_participation;
        rep.last_active = new Date().toISOString();
        rep.last_active_world_date = { ...worldDate };
        rep.updated_at = new Date().toISOString();
      }
    }
  }

  cancelEvent(eventId: string, worldDate: CalendarDate): void {
    const event = this.maps.communityEvents[eventId];
    if (!event) throw new Error("culture_event_not_found");
    if (event.status === "completed" || event.status === "cancelled") throw new Error("culture_event_already_final");
    event.status = "cancelled";
    event.updated_at = new Date().toISOString();
    this.audit("event_cancelled", { ...(event.community_id ? { community_id: event.community_id } : {}), summary: `Event cancelled: ${event.name}` }, worldDate);
  }

  listEvents(communityId?: string, institutionId?: string, status?: EventStatusId): readonly CommunityEventRecord[] {
    let results = Object.values(this.maps.communityEvents);
    if (communityId) results = results.filter((e) => e.community_id === communityId);
    if (institutionId) results = results.filter((e) => e.institution_id === institutionId);
    if (status) results = results.filter((e) => e.status === status);
    return results;
  }

  // ─── Projects ─────────────────────────────────────────────────

  createProject(params: {
    community_id: string;
    name: string;
    description: string;
    category: ProjectCategoryId;
    organizing_institution_id?: string | null;
    leader_character_id: string;
    budget: number;
    target_completion_world_date?: CalendarDate | null;
  }, worldDate: CalendarDate): CommunityProjectRecord {
    const rules = this.catalog.getRules();
    if (!params.name || params.name.length > 100) throw new Error("culture_name_invalid");
    if (params.description.length > rules.description_max_length) throw new Error("culture_description_too_long");
    if (params.budget < 0 || params.budget > rules.project_budget_max) throw new Error("culture_budget_invalid");
    if (!this.catalog.hasProjectCategory(params.category)) throw new Error("culture_project_category_invalid");

    const community = this.maps.communities[params.community_id];
    if (!community) throw new Error("culture_community_not_found");

    // Check max projects
    const existingProjects = Object.values(this.maps.communityProjects).filter(
      (p) => p.community_id === params.community_id
    );
    if (existingProjects.length >= rules.max_projects_per_community) throw new Error("culture_max_projects");

    const id = uid("commproj");
    const record: CommunityProjectRecord = {
      project_id: id,
      community_id: params.community_id,
      name: params.name,
      description: params.description,
      category: params.category,
      organizing_institution_id: params.organizing_institution_id ?? null,
      leader_character_id: params.leader_character_id,
      status: "proposed",
      budget: params.budget,
      funds_raised: 0,
      start_date: new Date().toISOString(),
      start_world_date: { ...worldDate },
      target_completion_date: params.target_completion_world_date ? new Date().toISOString() : null,
      target_completion_world_date: params.target_completion_world_date ? { ...params.target_completion_world_date } : null,
      actual_completion_date: null,
      actual_completion_world_date: null,
      volunteer_character_ids: [],
      contributions: [],
      milestones: [],
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.communityProjects[id] = record;
    this.audit("project_created", { community_id: params.community_id, character_id: params.leader_character_id, summary: `Project proposed: ${params.name}`, details: { category: params.category, budget: params.budget } }, worldDate);
    return record;
  }

  transitionProject(projectId: string, newStatus: ProjectStatusId, worldDate: CalendarDate): CommunityProjectRecord {
    const project = this.maps.communityProjects[projectId];
    if (!project) throw new Error("culture_project_not_found");
    if (!this.catalog.isValidProjectTransition(project.status, newStatus)) throw new Error("culture_invalid_project_transition");

    const oldStatus = project.status;
    project.status = newStatus;
    project.updated_at = new Date().toISOString();

    if (newStatus === "completed") {
      project.actual_completion_date = new Date().toISOString();
      project.actual_completion_world_date = { ...worldDate };
    }

    this.audit("project_transition", { community_id: project.community_id, summary: `Project status: ${oldStatus} → ${newStatus}` }, worldDate);
    return project;
  }

  contributeToProject(projectId: string, characterId: string, contributionType: "financial" | "labor" | "materials" | "expertise", amount: number, description: string, worldDate: CalendarDate): CommunityContributionRecord {
    const project = this.maps.communityProjects[projectId];
    if (!project) throw new Error("culture_project_not_found");
    if (project.status !== "active" && project.status !== "funding_in_progress") throw new Error("culture_project_not_accepting_contributions");

    const rules = this.catalog.getRules();
    if (project.volunteer_character_ids.length >= rules.max_volunteers_per_project && !project.volunteer_character_ids.includes(characterId)) throw new Error("culture_project_full");

    const id = uid("commcont");
    const record: CommunityContributionRecord = {
      contribution_id: id, project_id: projectId,
      character_id: characterId, contribution_type: contributionType,
      amount, description,
      contributed_at: new Date().toISOString(),
      contributed_world_date: { ...worldDate },
      created_at: new Date().toISOString(),
    };
    this.maps.communityContributions[id] = record;
    project.contributions = [...project.contributions, { character_id: characterId, amount, date: new Date().toISOString(), description }];
    if (contributionType === "financial") {
      project.funds_raised += amount;
    }
    if (!project.volunteer_character_ids.includes(characterId)) {
      project.volunteer_character_ids = [...project.volunteer_character_ids, characterId];
    }
    project.updated_at = new Date().toISOString();

    // Boost reputation
    if (project.community_id) {
      const repKey = `${characterId}:${project.community_id}`;
      const rep = this.maps.communityReputation[repKey];
      if (rep) {
        rep.participation_score += this.catalog.getRules().reputation_gain_per_participation;
        rep.last_active = new Date().toISOString();
        rep.last_active_world_date = { ...worldDate };
        rep.updated_at = new Date().toISOString();
      }
    }

    return record;
  }

  getProject(projectId: string): CommunityProjectRecord | undefined {
    return this.maps.communityProjects[projectId];
  }

  listProjects(communityId?: string, status?: ProjectStatusId): readonly CommunityProjectRecord[] {
    let results = Object.values(this.maps.communityProjects);
    if (communityId) results = results.filter((p) => p.community_id === communityId);
    if (status) results = results.filter((p) => p.status === status);
    return results;
  }

  // ─── Announcements ────────────────────────────────────────────

  publishAnnouncement(params: {
    community_id?: string | null;
    institution_id?: string | null;
    author_character_id: string;
    title: string;
    body: string;
    scope: "community" | "institution" | "regional";
  }, worldDate: CalendarDate): CommunityAnnouncementRecord {
    const rules = this.catalog.getRules();
    if (!params.title || params.title.length > 100) throw new Error("culture_name_invalid");
    if (params.body.length > rules.announcement_max_length) throw new Error("culture_announcement_too_long");

    // Check daily limit
    const today = Object.values(this.maps.communityAnnouncements).filter(
      (a) => a.author_character_id === params.author_character_id &&
        (Date.now() - new Date(a.published_at).getTime()) < 86400_000
    );
    if (today.length >= rules.max_announcements_per_day) throw new Error("culture_announcement_limit");

    const id = uid("commann");
    const record: CommunityAnnouncementRecord = {
      announcement_id: id,
      community_id: params.community_id ?? null,
      institution_id: params.institution_id ?? null,
      author_character_id: params.author_character_id,
      title: params.title,
      body: params.body,
      scope: params.scope,
      published_at: new Date().toISOString(),
      published_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.communityAnnouncements[id] = record;
    this.audit("announcement_published", { ...(params.community_id ? { community_id: params.community_id } : {}), character_id: params.author_character_id, summary: `Announcement: ${params.title}` }, worldDate);
    return record;
  }

  listAnnouncements(communityId?: string, institutionId?: string): readonly CommunityAnnouncementRecord[] {
    let results = Object.values(this.maps.communityAnnouncements);
    if (communityId) results = results.filter((a) => a.community_id === communityId);
    if (institutionId) results = results.filter((a) => a.institution_id === institutionId);
    return results.sort((a, b) => b.published_at.localeCompare(a.published_at));
  }

  // ─── Disputes ─────────────────────────────────────────────────

  fileDispute(params: {
    community_id: string;
    title: string;
    description: string;
    filed_by_character_id: string;
    against_character_id?: string | null;
    against_institution_id?: string | null;
  }, worldDate: CalendarDate): CommunityDisputeRecord {
    const community = this.maps.communities[params.community_id];
    if (!community) throw new Error("culture_community_not_found");
    if (!params.title || params.title.length > 100) throw new Error("culture_name_invalid");

    // Check monthly limit
    const rules = this.catalog.getRules();
    const monthDisputes = Object.values(this.maps.communityDisputes).filter(
      (d) => d.community_id === params.community_id &&
        (Date.now() - new Date(d.filed_at).getTime()) < 30 * 86400_000
    );
    if (monthDisputes.length >= rules.max_community_disputes_per_month) throw new Error("culture_dispute_limit");

    const id = uid("commdisp");
    const record: CommunityDisputeRecord = {
      dispute_id: id,
      community_id: params.community_id,
      title: params.title,
      description: params.description,
      filed_by_character_id: params.filed_by_character_id,
      against_character_id: params.against_character_id ?? null,
      against_institution_id: params.against_institution_id ?? null,
      mediator_character_id: null,
      status: "filed",
      resolution: null,
      referred_to_justice_case_id: null,
      filed_at: new Date().toISOString(),
      filed_world_date: { ...worldDate },
      resolved_at: null,
      resolved_world_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.communityDisputes[id] = record;
    this.audit("dispute_filed", { community_id: params.community_id, character_id: params.filed_by_character_id, summary: `Dispute filed: ${params.title}` }, worldDate);
    return record;
  }

  resolveDispute(disputeId: string, resolution: string, mediatorCharacterId: string, worldDate: CalendarDate): CommunityDisputeRecord {
    const dispute = this.maps.communityDisputes[disputeId];
    if (!dispute) throw new Error("culture_dispute_not_found");
    if (dispute.status === "resolved" || dispute.status === "dismissed") throw new Error("culture_dispute_already_final");
    dispute.status = "resolved";
    dispute.resolution = resolution;
    dispute.mediator_character_id = mediatorCharacterId;
    dispute.resolved_at = new Date().toISOString();
    dispute.resolved_world_date = { ...worldDate };
    dispute.updated_at = new Date().toISOString();
    return dispute;
  }

  referDisputeToJustice(disputeId: string, justiceCaseId: string, worldDate: CalendarDate): CommunityDisputeRecord {
    const dispute = this.maps.communityDisputes[disputeId];
    if (!dispute) throw new Error("culture_dispute_not_found");
    if (dispute.status === "resolved" || dispute.status === "dismissed" || dispute.status === "referred_to_justice") throw new Error("culture_dispute_already_final");
    dispute.status = "referred_to_justice";
    dispute.referred_to_justice_case_id = justiceCaseId;
    dispute.updated_at = new Date().toISOString();
    this.audit("dispute_referred", { community_id: dispute.community_id, summary: `Dispute referred to justice: ${justiceCaseId}` }, worldDate);
    return dispute;
  }

  listDisputes(communityId?: string, status?: DisputeStatusId): readonly CommunityDisputeRecord[] {
    let results = Object.values(this.maps.communityDisputes);
    if (communityId) results = results.filter((d) => d.community_id === communityId);
    if (status) results = results.filter((d) => d.status === status);
    return results;
  }

  // ─── Reputation ───────────────────────────────────────────────

  getCommunityReputation(characterId: string, communityId: string): CommunityReputationRecord | null {
    return this.maps.communityReputation[`${characterId}:${communityId}`] ?? null;
  }

  decayReputation(characterId: string, communityId: string, worldDate: CalendarDate): CommunityReputationRecord | null {
    const rep = this.maps.communityReputation[`${characterId}:${communityId}`];
    if (!rep) return null;
    const days = daysBetween(rep.last_active_world_date, worldDate);
    if (days <= 0) return rep;
    const decayRate = this.catalog.getRules().reputation_decay_per_day_inactive;
    rep.community_trust = Math.max(0, rep.community_trust - (days * decayRate));
    rep.participation_score = Math.max(0, rep.participation_score - (days * decayRate * 0.5));
    rep.updated_at = new Date().toISOString();
    return rep;
  }

  // ─── Profile ──────────────────────────────────────────────────

  getCulturalProfileSnapshot(characterId: string): CulturalProfileSnapshot {
    const profile = this.maps.culturalProfiles[characterId];
    const memberships = this.getCharacterMemberships(characterId);
    const institutionMemberships = Object.values(this.maps.institutionMemberships).filter(
      (m) => m.character_id === characterId && m.status === "active"
    );
    const activeProjects = Object.values(this.maps.communityProjects).filter(
      (p) => p.volunteer_character_ids.includes(characterId) && (p.status === "active" || p.status === "funding_in_progress")
    );

    // Calculate aggregate reputation
    let totalTrust = 0;
    let totalParticipation = 0;
    const leadershipRoles: string[] = [];
    for (const mem of memberships) {
      const rep = this.maps.communityReputation[`${characterId}:${mem.community_id}`];
      if (rep) {
        totalTrust += rep.community_trust;
        totalParticipation += rep.participation_score;
        if (rep.leadership_reputation > 0) leadershipRoles.push(mem.community_id);
      }
      if (mem.roles.length > 0) leadershipRoles.push(...mem.roles);
    }

    return {
      character_id: characterId,
      languages_spoken: profile?.languages_spoken ?? [],
      preferred_language: profile?.preferred_language ?? null,
      religious_affiliation: profile?.religious_affiliation ?? null,
      cultural_interests: profile?.cultural_interests ?? [],
      community_memberships_count: memberships.length,
      institution_memberships_count: institutionMemberships.length,
      community_trust: totalTrust,
      participation_score: totalParticipation,
      active_projects_count: activeProjects.length,
      leadership_roles: leadershipRoles,
    };
  }

  getCommunitySnapshot(communityId: string): CommunitySnapshot | null {
    const community = this.maps.communities[communityId];
    if (!community) return null;
    const members = this.getCommunityMembers(communityId);
    return {
      community_id: community.community_id,
      name: community.name,
      community_type: community.community_type,
      state_id: community.state_id,
      lga_id: community.lga_id,
      member_count: members.length,
      status: community.status,
    };
  }
}

export function cultureErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    culture_age_ineligible: "Character does not meet the age requirement.",
    culture_community_type_invalid: "Invalid community type.",
    culture_name_invalid: "Name is required and must be under 100 characters.",
    culture_description_too_long: "Description exceeds the maximum length.",
    culture_community_not_found: "Community not found.",
    culture_community_inactive: "Community is not active.",
    culture_max_communities: "Maximum community memberships reached.",
    culture_already_member: "Already a member of this community or institution.",
    culture_community_full: "Community has reached its member limit.",
    culture_membership_not_found: "Membership not found.",
    culture_last_organizer_cannot_leave: "Last organizer cannot leave without transferring leadership.",
    culture_institution_category_invalid: "Invalid institution category.",
    culture_institution_not_found: "Institution not found.",
    culture_institution_inactive: "Institution is not active.",
    culture_language_invalid: "Invalid language.",
    culture_religious_category_invalid: "Invalid religious category.",
    culture_event_not_found: "Event not found.",
    culture_event_not_attendable: "Event is not currently accepting attendees.",
    culture_already_attending: "Already registered for this event.",
    culture_event_full: "Event has reached capacity.",
    culture_event_already_final: "Event is already in a final state.",
    culture_project_category_invalid: "Invalid project category.",
    culture_budget_invalid: "Budget is outside the allowed range.",
    culture_max_projects: "Maximum projects per community reached.",
    culture_project_not_found: "Project not found.",
    culture_invalid_project_transition: "Invalid project status transition.",
    culture_project_not_accepting_contributions: "Project is not currently accepting contributions.",
    culture_project_full: "Project has reached its volunteer limit.",
    culture_announcement_too_long: "Announcement body exceeds the maximum length.",
    culture_announcement_limit: "Daily announcement limit reached.",
    culture_dispute_limit: "Monthly dispute filing limit reached for this community.",
    culture_dispute_not_found: "Dispute not found.",
    culture_dispute_already_final: "Dispute is already in a final state.",
  };
  return messages[code] ?? "An unexpected culture system error occurred.";
}
