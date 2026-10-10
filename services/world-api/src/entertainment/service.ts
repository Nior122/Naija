/**
 * Stage 17 — Entertainment and Media System
 *
 * Server-authoritative service for entertainment profiles, music, film,
 * content creation, events, fame, contracts, journalism, controversies,
 * and moderation.
 *
 * Integrates with careers (Stage 6), economy (Stage 7), businesses (Stage 8),
 * culture (Stage 16), and geography (Stage 3) systems.
 */

import type { CalendarDate } from "../life/types.js";
import type {
  PersistentEntertainmentMaps,
  EntertainmentProfileRecord,
  MusicProjectRecord,
  FilmProjectRecord,
  ContentRecord,
  EntertainmentEventRecord,
  EntertainmentContractRecord,
  NewsReportRecord,
  ControversyRecord,
  ContentModerationRecord,
  EntertainmentCollaborationRecord,
  EntertainmentAuditRecord,
  ProductionStatusId,
  ContentStatusId,
  EventTypeId,
  ControversyStatusId,
  EventTypeStatusId,
  ContractStatusId,
  EntertainmentProfileSnapshot,
} from "./types.js";
import { EntertainmentCatalogService } from "./catalog.js";

export function emptyEntertainmentMaps(): PersistentEntertainmentMaps {
  return {
    entertainmentProfiles: {},
    musicProjects: {},
    filmProjects: {},
    contentRecords: {},
    entertainmentEvents: {},
    entertainmentContracts: {},
    newsReports: {},
    controversies: {},
    contentModeration: {},
    entertainmentCollaborations: {},
    entertainmentAudits: {},
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

export function initializeEntertainmentWorldState(state: PersistentEntertainmentMaps): void {
  if (!state.entertainmentProfiles) state.entertainmentProfiles = {};
  if (!state.musicProjects) state.musicProjects = {};
  if (!state.filmProjects) state.filmProjects = {};
  if (!state.contentRecords) state.contentRecords = {};
  if (!state.entertainmentEvents) state.entertainmentEvents = {};
  if (!state.entertainmentContracts) state.entertainmentContracts = {};
  if (!state.newsReports) state.newsReports = {};
  if (!state.controversies) state.controversies = {};
  if (!state.contentModeration) state.contentModeration = {};
  if (!state.entertainmentCollaborations) state.entertainmentCollaborations = {};
  if (!state.entertainmentAudits) state.entertainmentAudits = {};
}

export function seedEntertainmentWorld(): { seeded: boolean } {
  return { seeded: true };
}

export class EntertainmentService {
  private maps: PersistentEntertainmentMaps;
  private catalog: EntertainmentCatalogService;

  constructor(maps: PersistentEntertainmentMaps | null, catalog: EntertainmentCatalogService) {
    this.maps = maps ?? emptyEntertainmentMaps();
    this.catalog = catalog;
  }

  getMaps(): PersistentEntertainmentMaps { return this.maps; }

  private audit(category: string, data: { character_id?: string; profile_id?: string; actor_character_id?: string; summary: string; details?: Record<string, string | number | boolean | null> }, worldDate: CalendarDate) {
    const id = `eaudit-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
    _uidCounter++;
    const record: EntertainmentAuditRecord = {
      audit_id: id, category,
      character_id: data.character_id ?? null,
      profile_id: data.profile_id ?? null,
      actor_character_id: data.actor_character_id ?? null,
      summary: data.summary, details: data.details ?? {},
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };
    this.maps.entertainmentAudits[id] = record;
  }

  // ─── Entertainment Profiles ───────────────────────────────────

  createProfile(params: {
    character_id: string;
    stage_name: string;
    biography?: string;
    professions?: string[];
    character_age: number;
  }, worldDate: CalendarDate): EntertainmentProfileRecord {
    const rules = this.catalog.getRules();
    if (params.character_age < rules.minimum_age_for_entertainment_profile) throw new Error("entertainment_age_ineligible");
    if (!params.stage_name || params.stage_name.length > rules.stage_name_max_length) throw new Error("entertainment_stage_name_invalid");
    if (params.biography && params.biography.length > rules.biography_max_length) throw new Error("entertainment_biography_too_long");

    // Check uniqueness of stage name
    const existing = Object.values(this.maps.entertainmentProfiles).find(
      (p) => p.stage_name.toLowerCase() === params.stage_name!.toLowerCase()
    );
    if (existing) throw new Error("entertainment_stage_name_taken");

    // Validate professions
    const professions = params.professions ?? [];
    if (professions.length > rules.max_professions_per_character) throw new Error("entertainment_max_professions");
    for (const prof of professions) {
      if (!this.catalog.hasProfession(prof)) throw new Error("entertainment_profession_invalid");
    }

    const id = uid("entprofile");
    const record: EntertainmentProfileRecord = {
      profile_id: id,
      character_id: params.character_id,
      stage_name: params.stage_name,
      biography: params.biography ?? "",
      professions,
      career_stage: "beginner",
      fame_score: 0,
      followers_count: 0,
      total_views: 0,
      total_listens: 0,
      total_revenue: 0,
      last_active: new Date().toISOString(),
      last_active_world_date: { ...worldDate },
      status: "active",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.entertainmentProfiles[id] = record;
    this.audit("profile_created", { character_id: params.character_id, profile_id: id, actor_character_id: params.character_id, summary: `Profile created: ${params.stage_name}` }, worldDate);
    return record;
  }

  updateProfile(profileId: string, params: { stage_name?: string; biography?: string; professions?: string[] }, worldDate: CalendarDate): EntertainmentProfileRecord {
    const profile = this.maps.entertainmentProfiles[profileId];
    if (!profile) throw new Error("entertainment_profile_not_found");
    const rules = this.catalog.getRules();
    if (params.stage_name !== undefined) {
      if (!params.stage_name || params.stage_name.length > rules.stage_name_max_length) throw new Error("entertainment_stage_name_invalid");
      const existing = Object.values(this.maps.entertainmentProfiles).find(
        (p) => p.profile_id !== profileId && p.stage_name.toLowerCase() === params.stage_name!.toLowerCase()
      );
      if (existing) throw new Error("entertainment_stage_name_taken");
      profile.stage_name = params.stage_name;
    }
    if (params.biography !== undefined) {
      if (params.biography.length > rules.biography_max_length) throw new Error("entertainment_biography_too_long");
      profile.biography = params.biography;
    }
    if (params.professions !== undefined) {
      if (params.professions.length > rules.max_professions_per_character) throw new Error("entertainment_max_professions");
      for (const prof of params.professions) {
        if (!this.catalog.hasProfession(prof)) throw new Error("entertainment_profession_invalid");
      }
      profile.professions = [...params.professions];
    }
    profile.updated_at = new Date().toISOString();
    return profile;
  }

  getProfile(characterId: string): EntertainmentProfileRecord | null {
    return Object.values(this.maps.entertainmentProfiles).find((p) => p.character_id === characterId) ?? null;
  }

  getProfileById(profileId: string): EntertainmentProfileRecord | undefined {
    return this.maps.entertainmentProfiles[profileId];
  }

  // ─── Music Projects ───────────────────────────────────────────

  createMusicProject(params: {
    artist_character_id: string;
    artist_profile_id: string;
    title: string;
    description?: string;
    genre: string;
    release_type: string;
    budget?: number;
  }, worldDate: CalendarDate): MusicProjectRecord {
    const rules = this.catalog.getRules();
    if (!params.title || params.title.length > rules.content_title_max_length) throw new Error("entertainment_title_invalid");
    if (!this.catalog.hasGenre(params.genre)) throw new Error("entertainment_genre_invalid");
    if (!this.catalog.hasReleaseType(params.release_type)) throw new Error("entertainment_release_type_invalid");
    if (params.budget && params.budget > rules.project_budget_max) throw new Error("entertainment_budget_exceeded");

    // Check max projects
    const existing = Object.values(this.maps.musicProjects).filter(
      (p) => p.artist_character_id === params.artist_character_id
    );
    if (existing.length >= rules.max_projects_per_character) throw new Error("entertainment_max_projects");

    const id = uid("musicproj");
    const record: MusicProjectRecord = {
      project_id: id,
      artist_profile_id: params.artist_profile_id,
      artist_character_id: params.artist_character_id,
      title: params.title,
      description: params.description ?? "",
      genre: params.genre,
      release_type: params.release_type,
      status: "idea",
      collaborator_character_ids: [],
      budget: params.budget ?? 0,
      expenses: 0,
      release_date: null,
      release_world_date: null,
      views: 0,
      listens: 0,
      revenue: 0,
      quality_score: 0,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.musicProjects[id] = record;
    this.audit("music_project_created", { character_id: params.artist_character_id, profile_id: params.artist_profile_id, summary: `Music project: ${params.title}` }, worldDate);
    return record;
  }

  transitionMusicProject(projectId: string, newStatus: ProductionStatusId, worldDate: CalendarDate): MusicProjectRecord {
    const project = this.maps.musicProjects[projectId];
    if (!project) throw new Error("entertainment_project_not_found");
    if (!this.catalog.isValidProjectTransition(project.status, newStatus)) throw new Error("entertainment_invalid_project_transition");

    project.status = newStatus;
    if (newStatus === "released") {
      project.release_date = new Date().toISOString();
      project.release_world_date = { ...worldDate };
      // Simulate quality and audience response
      project.quality_score = 50 + Math.floor(Math.random() * 50);
      project.listens = Math.floor(project.quality_score * 100 * (1 + Math.random()));
      project.revenue = Math.floor(project.listens * 0.5);
      // Update fame
      const profile = this.maps.entertainmentProfiles[project.artist_profile_id];
      if (profile) {
        profile.fame_score = Math.min(this.catalog.getRules().fame_max, profile.fame_score + this.catalog.getRules().fame_gain_per_release);
        profile.career_stage = this.catalog.getCareerStage(profile.fame_score);
        profile.total_revenue += project.revenue;
        profile.total_listens += project.listens;
        profile.last_active = new Date().toISOString();
        profile.last_active_world_date = { ...worldDate };
        profile.updated_at = new Date().toISOString();
      }
    }
    project.updated_at = new Date().toISOString();
    return project;
  }

  addCollaboratorToMusicProject(projectId: string, collaboratorCharacterId: string): void {
    const project = this.maps.musicProjects[projectId];
    if (!project) throw new Error("entertainment_project_not_found");
    if (project.status === "released" || project.status === "cancelled") throw new Error("entertainment_project_final");
    const rules = this.catalog.getRules();
    if (project.collaborator_character_ids.length >= rules.max_collaborators_per_project) throw new Error("entertainment_max_collaborators");
    if (project.collaborator_character_ids.includes(collaboratorCharacterId)) throw new Error("entertainment_already_collaborator");
    project.collaborator_character_ids = [...project.collaborator_character_ids, collaboratorCharacterId];
    project.updated_at = new Date().toISOString();
  }

  // ─── Film Projects ────────────────────────────────────────────

  createFilmProject(params: {
    producer_character_id: string;
    title: string;
    description?: string;
    genre: string;
    content_type: string;
    budget?: number;
    business_id?: string | null;
  }, worldDate: CalendarDate): FilmProjectRecord {
    const rules = this.catalog.getRules();
    if (!params.title || params.title.length > rules.content_title_max_length) throw new Error("entertainment_title_invalid");
    if (!this.catalog.hasGenre(params.genre)) throw new Error("entertainment_genre_invalid");
    if (!this.catalog.hasContentType(params.content_type)) throw new Error("entertainment_content_type_invalid");
    if (params.budget && params.budget > rules.project_budget_max) throw new Error("entertainment_budget_exceeded");

    const id = uid("filmproj");
    const record: FilmProjectRecord = {
      project_id: id,
      producer_character_id: params.producer_character_id,
      title: params.title,
      description: params.description ?? "",
      genre: params.genre,
      content_type: params.content_type,
      status: "idea",
      director_character_id: null,
      cast_character_ids: [],
      crew_character_ids: [],
      budget: params.budget ?? 0,
      expenses: 0,
      release_date: null,
      release_world_date: null,
      views: 0,
      revenue: 0,
      quality_score: 0,
      business_id: params.business_id ?? null,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.filmProjects[id] = record;
    this.audit("film_project_created", { character_id: params.producer_character_id, summary: `Film project: ${params.title}` }, worldDate);
    return record;
  }

  transitionFilmProject(projectId: string, newStatus: ProductionStatusId, worldDate: CalendarDate): FilmProjectRecord {
    const project = this.maps.filmProjects[projectId];
    if (!project) throw new Error("entertainment_project_not_found");
    if (!this.catalog.isValidProjectTransition(project.status, newStatus)) throw new Error("entertainment_invalid_project_transition");

    project.status = newStatus;
    if (newStatus === "released") {
      project.release_date = new Date().toISOString();
      project.release_world_date = { ...worldDate };
      project.quality_score = 40 + Math.floor(Math.random() * 60);
      project.views = Math.floor(project.quality_score * 200 * (1 + Math.random()));
      project.revenue = Math.floor(project.views * 1.0);
      // Update fame for producer
      const profile = this.getProfile(project.producer_character_id);
      if (profile) {
        profile.fame_score = Math.min(this.catalog.getRules().fame_max, profile.fame_score + this.catalog.getRules().fame_gain_per_release);
        profile.career_stage = this.catalog.getCareerStage(profile.fame_score);
        profile.total_revenue += project.revenue;
        profile.total_views += project.views;
        profile.last_active = new Date().toISOString();
        profile.last_active_world_date = { ...worldDate };
        profile.updated_at = new Date().toISOString();
      }
    }
    project.updated_at = new Date().toISOString();
    return project;
  }

  joinFilmCast(projectId: string, characterId: string): void {
    const project = this.maps.filmProjects[projectId];
    if (!project) throw new Error("entertainment_project_not_found");
    if (project.status === "released" || project.status === "cancelled") throw new Error("entertainment_project_final");
    if (project.cast_character_ids.includes(characterId)) throw new Error("entertainment_already_in_cast");
    project.cast_character_ids = [...project.cast_character_ids, characterId];
    project.updated_at = new Date().toISOString();
  }

  joinFilmCrew(projectId: string, characterId: string): void {
    const project = this.maps.filmProjects[projectId];
    if (!project) throw new Error("entertainment_project_not_found");
    if (project.status === "released" || project.status === "cancelled") throw new Error("entertainment_project_final");
    if (project.crew_character_ids.includes(characterId)) throw new Error("entertainment_already_in_crew");
    project.crew_character_ids = [...project.crew_character_ids, characterId];
    project.updated_at = new Date().toISOString();
  }

  // ─── Content Records ──────────────────────────────────────────

  createContent(params: {
    creator_character_id: string;
    creator_profile_id: string;
    title: string;
    description?: string;
    content_type: string;
    genre?: string | null;
  }, worldDate: CalendarDate): ContentRecord {
    const rules = this.catalog.getRules();
    if (!params.title || params.title.length > rules.content_title_max_length) throw new Error("entertainment_title_invalid");
    if (!this.catalog.hasContentType(params.content_type)) throw new Error("entertainment_content_type_invalid");

    // Daily limit
    const today = Object.values(this.maps.contentRecords).filter(
      (c) => c.creator_character_id === params.creator_character_id &&
        (Date.now() - new Date(c.created_at).getTime()) < 86400_000
    );
    if (today.length >= rules.max_content_per_day) throw new Error("entertainment_daily_content_limit");

    const id = uid("content");
    const record: ContentRecord = {
      content_id: id,
      creator_profile_id: params.creator_profile_id,
      creator_character_id: params.creator_character_id,
      title: params.title,
      description: params.description ?? "",
      content_type: params.content_type,
      genre: params.genre ?? null,
      status: "draft",
      visibility: "public",
      published_at: null,
      published_world_date: null,
      views: 0,
      likes: 0,
      comments_count: 0,
      revenue: 0,
      moderation_status: "clean",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.contentRecords[id] = record;
    return record;
  }

  publishContent(contentId: string, worldDate: CalendarDate): ContentRecord {
    const content = this.maps.contentRecords[contentId];
    if (!content) throw new Error("entertainment_content_not_found");
    if (!this.catalog.isValidContentTransition(content.status, "published") && !this.catalog.isValidContentTransition(content.status, "processing")) throw new Error("entertainment_invalid_content_transition");

    content.status = "published";
    content.published_at = new Date().toISOString();
    content.published_world_date = { ...worldDate };
    // Simulate initial views
    content.views = Math.floor(Math.random() * 100);
    content.revenue = Math.floor(content.views * this.catalog.getRules().ad_revenue_per_view * (1 - this.catalog.getRules().platform_revenue_share_percent / 100));

    // Update profile
    const profile = this.maps.entertainmentProfiles[content.creator_profile_id];
    if (profile) {
      profile.total_views += content.views;
      profile.total_revenue += content.revenue;
      profile.followers_count += Math.floor(Math.random() * 10);
      profile.last_active = new Date().toISOString();
      profile.last_active_world_date = { ...worldDate };
      profile.updated_at = new Date().toISOString();
    }
    content.updated_at = new Date().toISOString();
    return content;
  }

  transitionContent(contentId: string, newStatus: ContentStatusId): ContentRecord {
    const content = this.maps.contentRecords[contentId];
    if (!content) throw new Error("entertainment_content_not_found");
    if (!this.catalog.isValidContentTransition(content.status, newStatus)) throw new Error("entertainment_invalid_content_transition");
    content.status = newStatus;
    content.updated_at = new Date().toISOString();
    return content;
  }

  // ─── Entertainment Events ─────────────────────────────────────

  createEvent(params: {
    organizer_character_id: string;
    organizer_profile_id?: string | null;
    name: string;
    description?: string;
    event_type: EventTypeId;
    venue_name?: string | null;
    state_id?: string | null;
    lga_id?: string | null;
    settlement_id?: string | null;
    start_world_date: CalendarDate;
    capacity?: number;
    ticket_price?: number;
  }, worldDate: CalendarDate): EntertainmentEventRecord {
    const rules = this.catalog.getRules();
    if (!params.name || params.name.length > rules.content_title_max_length) throw new Error("entertainment_title_invalid");
    if (!this.catalog.hasEventType(params.event_type)) throw new Error("entertainment_event_type_invalid");
    if (params.capacity && params.capacity > rules.event_capacity_max) throw new Error("entertainment_capacity_exceeded");
    if (params.ticket_price && params.ticket_price > rules.event_ticket_price_max) throw new Error("entertainment_ticket_price_exceeded");

    const id = uid("entevent");
    const record: EntertainmentEventRecord = {
      event_id: id,
      organizer_character_id: params.organizer_character_id,
      organizer_profile_id: params.organizer_profile_id ?? null,
      name: params.name,
      description: params.description ?? "",
      event_type: params.event_type,
      venue_name: params.venue_name ?? null,
      state_id: params.state_id ?? null,
      lga_id: params.lga_id ?? null,
      settlement_id: params.settlement_id ?? null,
      start_date: new Date().toISOString(),
      start_world_date: { ...params.start_world_date },
      end_date: null,
      end_world_date: null,
      status: "scheduled",
      capacity: params.capacity ?? 100,
      ticket_price: params.ticket_price ?? 0,
      performer_character_ids: [],
      attendee_character_ids: [],
      tickets_sold: 0,
      revenue: 0,
      expenses: 0,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.entertainmentEvents[id] = record;
    this.audit("event_created", { character_id: params.organizer_character_id, summary: `Event: ${params.name}` }, worldDate);
    return record;
  }

  purchaseTicket(eventId: string, characterId: string, worldDate: CalendarDate): void {
    const event = this.maps.entertainmentEvents[eventId];
    if (!event) throw new Error("entertainment_event_not_found");
    if (event.status !== "scheduled") throw new Error("entertainment_event_not_ticketable");
    if (event.attendee_character_ids.includes(characterId)) throw new Error("entertainment_already_attending");
    if (event.tickets_sold >= event.capacity) throw new Error("entertainment_event_sold_out");

    event.attendee_character_ids = [...event.attendee_character_ids, characterId];
    event.tickets_sold++;
    event.revenue += event.ticket_price;
    event.updated_at = new Date().toISOString();
  }

  addPerformer(eventId: string, characterId: string): void {
    const event = this.maps.entertainmentEvents[eventId];
    if (!event) throw new Error("entertainment_event_not_found");
    if (event.status === "completed" || event.status === "cancelled") throw new Error("entertainment_event_final");
    if (event.performer_character_ids.includes(characterId)) throw new Error("entertainment_already_performer");
    event.performer_character_ids = [...event.performer_character_ids, characterId];
    event.updated_at = new Date().toISOString();
  }

  completeEvent(eventId: string, worldDate: CalendarDate): void {
    const event = this.maps.entertainmentEvents[eventId];
    if (!event) throw new Error("entertainment_event_not_found");
    if (event.status !== "scheduled") throw new Error("entertainment_event_not_completable");
    event.status = "completed";
    event.end_date = new Date().toISOString();
    event.end_world_date = { ...worldDate };
    event.updated_at = new Date().toISOString();

    // Update fame for performers
    const rules = this.catalog.getRules();
    for (const perfId of event.performer_character_ids) {
      const profile = this.getProfile(perfId);
      if (profile) {
        profile.fame_score = Math.min(rules.fame_max, profile.fame_score + rules.fame_gain_per_event);
        profile.career_stage = this.catalog.getCareerStage(profile.fame_score);
        profile.last_active = new Date().toISOString();
        profile.last_active_world_date = { ...worldDate };
        profile.updated_at = new Date().toISOString();
      }
    }
  }

  cancelEvent(eventId: string): void {
    const event = this.maps.entertainmentEvents[eventId];
    if (!event) throw new Error("entertainment_event_not_found");
    if (event.status === "completed" || event.status === "cancelled") throw new Error("entertainment_event_final");
    event.status = "cancelled";
    event.updated_at = new Date().toISOString();
  }

  listEvents(status?: EventTypeStatusId): readonly EntertainmentEventRecord[] {
    let results = Object.values(this.maps.entertainmentEvents);
    if (status) results = results.filter((e) => e.status === status);
    return results;
  }

  // ─── Contracts ────────────────────────────────────────────────

  createContract(params: {
    title: string;
    contract_type: string;
    initiating_character_id: string;
    accepting_character_id: string;
    project_id?: string | null;
    terms?: string;
    compensation?: number;
    end_date?: string | null;
    deliverables?: string;
  }, worldDate: CalendarDate): EntertainmentContractRecord {
    const rules = this.catalog.getRules();
    if (!params.title || params.title.length > rules.contract_title_max_length) throw new Error("entertainment_contract_title_invalid");
    if (!this.catalog.hasContractType(params.contract_type)) throw new Error("entertainment_contract_type_invalid");

    const id = uid("entcontract");
    const record: EntertainmentContractRecord = {
      contract_id: id,
      title: params.title,
      contract_type: params.contract_type,
      status: "proposed",
      initiating_character_id: params.initiating_character_id,
      accepting_character_id: params.accepting_character_id,
      project_id: params.project_id ?? null,
      terms: params.terms ?? "",
      compensation: params.compensation ?? 0,
      compensation_paid: false,
      start_date: new Date().toISOString(),
      start_world_date: { ...worldDate },
      end_date: params.end_date ?? null,
      end_world_date: null,
      deliverables: params.deliverables ?? "",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.entertainmentContracts[id] = record;
    this.audit("contract_created", { character_id: params.initiating_character_id, summary: `Contract: ${params.title}` }, worldDate);
    return record;
  }

  acceptContract(contractId: string, characterId: string, worldDate: CalendarDate): EntertainmentContractRecord {
    const contract = this.maps.entertainmentContracts[contractId];
    if (!contract) throw new Error("entertainment_contract_not_found");
    if (contract.accepting_character_id !== characterId) throw new Error("entertainment_not_contract_party");
    if (contract.status !== "proposed") throw new Error("entertainment_contract_not_proposed");
    contract.status = "accepted";
    contract.updated_at = new Date().toISOString();
    return contract;
  }

  completeContract(contractId: string, worldDate: CalendarDate): EntertainmentContractRecord {
    const contract = this.maps.entertainmentContracts[contractId];
    if (!contract) throw new Error("entertainment_contract_not_found");
    if (contract.status !== "accepted" && contract.status !== "active") throw new Error("entertainment_contract_not_active");
    contract.status = "completed";
    contract.end_date = new Date().toISOString();
    contract.end_world_date = { ...worldDate };
    contract.updated_at = new Date().toISOString();
    return contract;
  }

  cancelContract(contractId: string): void {
    const contract = this.maps.entertainmentContracts[contractId];
    if (!contract) throw new Error("entertainment_contract_not_found");
    if (contract.status === "completed") throw new Error("entertainment_contract_already_completed");
    contract.status = "cancelled";
    contract.updated_at = new Date().toISOString();
  }

  // ─── News Reports ─────────────────────────────────────────────

  createNewsReport(params: {
    author_character_id: string;
    organization_id?: string | null;
    headline: string;
    summary?: string;
    topic: string;
    related_event_id?: string | null;
    source_references?: string[];
  }, worldDate: CalendarDate): NewsReportRecord {
    const rules = this.catalog.getRules();
    if (!params.headline || params.headline.length > rules.content_title_max_length) throw new Error("entertainment_title_invalid");
    if (!this.catalog.hasNewsTopic(params.topic)) throw new Error("entertainment_news_topic_invalid");

    const id = uid("newsrep");
    const record: NewsReportRecord = {
      report_id: id,
      author_character_id: params.author_character_id,
      organization_id: params.organization_id ?? null,
      headline: params.headline,
      summary: params.summary ?? "",
      topic: params.topic,
      related_event_id: params.related_event_id ?? null,
      status: "draft",
      editorial_review: null,
      source_references: params.source_references ?? [],
      published_at: null,
      published_world_date: null,
      corrected_at: null,
      correction_notes: null,
      views: 0,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.newsReports[id] = record;
    return record;
  }

  publishNewsReport(reportId: string, editorialReview: string | null, worldDate: CalendarDate): NewsReportRecord {
    const report = this.maps.newsReports[reportId];
    if (!report) throw new Error("entertainment_report_not_found");
    if (report.status !== "draft" && report.status !== "under_review") throw new Error("entertainment_report_not_publishable");
    report.status = "published";
    report.editorial_review = editorialReview;
    report.published_at = new Date().toISOString();
    report.published_world_date = { ...worldDate };
    report.views = Math.floor(Math.random() * 200);
    report.updated_at = new Date().toISOString();
    return report;
  }

  correctNewsReport(reportId: string, correctionNotes: string): NewsReportRecord {
    const report = this.maps.newsReports[reportId];
    if (!report) throw new Error("entertainment_report_not_found");
    if (report.status !== "published") throw new Error("entertainment_report_not_published");
    report.status = "corrected";
    report.correction_notes = correctionNotes;
    report.corrected_at = new Date().toISOString();
    report.updated_at = new Date().toISOString();
    return report;
  }

  retractNewsReport(reportId: string): NewsReportRecord {
    const report = this.maps.newsReports[reportId];
    if (!report) throw new Error("entertainment_report_not_found");
    if (report.status !== "published" && report.status !== "corrected") throw new Error("entertainment_report_not_active");
    report.status = "retracted";
    report.updated_at = new Date().toISOString();
    return report;
  }

  // ─── Controversies ────────────────────────────────────────────

  fileControversy(params: {
    character_id: string;
    profile_id?: string | null;
    title: string;
    description: string;
    category: string;
    filed_by_character_id?: string | null;
  }, worldDate: CalendarDate): ControversyRecord {
    const id = uid("controv");
    const record: ControversyRecord = {
      controversy_id: id,
      character_id: params.character_id,
      profile_id: params.profile_id ?? null,
      title: params.title,
      description: params.description,
      category: params.category,
      status: "allegation",
      filed_by_character_id: params.filed_by_character_id ?? null,
      resolution: null,
      reputation_impact: -5,
      filed_at: new Date().toISOString(),
      filed_world_date: { ...worldDate },
      resolved_at: null,
      resolved_world_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.controversies[id] = record;

    // Apply reputation impact
    const profile = this.maps.entertainmentProfiles[params.profile_id ?? ""];
    if (profile) {
      profile.fame_score = Math.max(0, profile.fame_score - 5);
      profile.career_stage = this.catalog.getCareerStage(profile.fame_score);
      profile.updated_at = new Date().toISOString();
    }

    return record;
  }

  resolveControversy(controversyId: string, status: ControversyStatusId, resolution: string, worldDate: CalendarDate): ControversyRecord {
    const controversy = this.maps.controversies[controversyId];
    if (!controversy) throw new Error("entertainment_controversy_not_found");
    if (controversy.status === "resolved" || controversy.status === "dismissed") throw new Error("entertainment_controversy_final");
    controversy.status = status;
    controversy.resolution = resolution;
    controversy.resolved_at = new Date().toISOString();
    controversy.resolved_world_date = { ...worldDate };
    controversy.updated_at = new Date().toISOString();
    return controversy;
  }

  // ─── Moderation ───────────────────────────────────────────────

  reportContent(contentId: string, reportedByCharacterId: string, reason: string, worldDate: CalendarDate): ContentModerationRecord {
    const content = this.maps.contentRecords[contentId];
    if (!content) throw new Error("entertainment_content_not_found");

    const id = uid("moderate");
    const record: ContentModerationRecord = {
      moderation_id: id,
      content_id: contentId,
      profile_id: null,
      report_reason: reason,
      reported_by_character_id: reportedByCharacterId,
      reviewer_character_id: null,
      status: "pending",
      action_taken: null,
      notes: null,
      filed_at: new Date().toISOString(),
      filed_world_date: { ...worldDate },
      reviewed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.contentModeration[id] = record;
    content.moderation_status = "flagged";
    content.updated_at = new Date().toISOString();
    return record;
  }

  reviewModeration(moderationId: string, reviewerCharacterId: string, action: "actioned" | "dismissed", actionTaken: string | null, notes: string | null): ContentModerationRecord {
    const mod = this.maps.contentModeration[moderationId];
    if (!mod) throw new Error("entertainment_moderation_not_found");
    if (mod.status !== "pending") throw new Error("entertainment_moderation_not_pending");
    mod.status = action;
    mod.reviewer_character_id = reviewerCharacterId;
    mod.action_taken = actionTaken;
    mod.notes = notes;
    mod.reviewed_at = new Date().toISOString();
    mod.updated_at = new Date().toISOString();

    if (action === "actioned" && mod.content_id) {
      const content = this.maps.contentRecords[mod.content_id];
      if (content) {
        content.moderation_status = "removed";
        content.status = "removed";
        content.updated_at = new Date().toISOString();
      }
    }
    return mod;
  }

  // ─── Fame decay ───────────────────────────────────────────────

  decayFame(profileId: string, worldDate: CalendarDate): EntertainmentProfileRecord | null {
    const profile = this.maps.entertainmentProfiles[profileId];
    if (!profile) return null;
    const days = daysBetween(profile.last_active_world_date, worldDate);
    if (days <= 0) return profile;
    const decayRate = this.catalog.getRules().fame_decay_per_day_inactive;
    profile.fame_score = Math.max(0, profile.fame_score - (days * decayRate));
    profile.career_stage = this.catalog.getCareerStage(profile.fame_score);
    profile.updated_at = new Date().toISOString();
    return profile;
  }

  // ─── Profile snapshot ─────────────────────────────────────────

  getProfileSnapshot(characterId: string): EntertainmentProfileSnapshot | null {
    const profile = this.getProfile(characterId);
    if (!profile) return null;
    const musicProjects = Object.values(this.maps.musicProjects).filter((p) => p.artist_character_id === characterId);
    const filmProjects = Object.values(this.maps.filmProjects).filter((p) => p.producer_character_id === characterId || p.cast_character_ids.includes(characterId) || p.crew_character_ids.includes(characterId));
    const content = Object.values(this.maps.contentRecords).filter((c) => c.creator_character_id === characterId);
    const events = Object.values(this.maps.entertainmentEvents).filter((e) => e.organizer_character_id === characterId || e.performer_character_ids.includes(characterId));
    const contracts = Object.values(this.maps.entertainmentContracts).filter(
      (c) => (c.initiating_character_id === characterId || c.accepting_character_id === characterId) && (c.status === "accepted" || c.status === "active")
    );

    return {
      character_id: characterId,
      stage_name: profile.stage_name,
      professions: profile.professions,
      career_stage: profile.career_stage,
      fame_score: profile.fame_score,
      followers_count: profile.followers_count,
      total_views: profile.total_views,
      total_revenue: profile.total_revenue,
      project_count: musicProjects.length + filmProjects.length,
      content_count: content.length,
      event_count: events.length,
      active_contracts: contracts.length,
    };
  }
}

export function entertainmentErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    entertainment_age_ineligible: "Character does not meet the age requirement for entertainment activities.",
    entertainment_stage_name_invalid: "Stage name is required and must be within the maximum length.",
    entertainment_stage_name_taken: "This stage name is already in use.",
    entertainment_biography_too_long: "Biography exceeds the maximum length.",
    entertainment_max_professions: "Maximum number of professions reached.",
    entertainment_profession_invalid: "Invalid profession.",
    entertainment_profile_not_found: "Entertainment profile not found.",
    entertainment_title_invalid: "Title is required and must be within the maximum length.",
    entertainment_genre_invalid: "Invalid genre.",
    entertainment_release_type_invalid: "Invalid release type.",
    entertainment_content_type_invalid: "Invalid content type.",
    entertainment_budget_exceeded: "Budget exceeds the maximum allowed.",
    entertainment_max_projects: "Maximum number of projects reached.",
    entertainment_project_not_found: "Project not found.",
    entertainment_invalid_project_transition: "Invalid project status transition.",
    entertainment_project_final: "Project is in a final state.",
    entertainment_max_collaborators: "Maximum collaborators reached.",
    entertainment_already_collaborator: "Already a collaborator on this project.",
    entertainment_already_in_cast: "Already in the cast.",
    entertainment_already_in_crew: "Already in the crew.",
    entertainment_content_not_found: "Content not found.",
    entertainment_invalid_content_transition: "Invalid content status transition.",
    entertainment_daily_content_limit: "Daily content creation limit reached.",
    entertainment_event_type_invalid: "Invalid event type.",
    entertainment_capacity_exceeded: "Event capacity exceeds the maximum.",
    entertainment_ticket_price_exceeded: "Ticket price exceeds the maximum.",
    entertainment_event_not_found: "Event not found.",
    entertainment_event_not_ticketable: "Event is not currently selling tickets.",
    entertainment_already_attending: "Already attending this event.",
    entertainment_event_sold_out: "Event is sold out.",
    entertainment_event_final: "Event is in a final state.",
    entertainment_already_performer: "Already a performer at this event.",
    entertainment_event_not_completable: "Event cannot be completed in its current state.",
    entertainment_contract_title_invalid: "Contract title is required and must be within the maximum length.",
    entertainment_contract_type_invalid: "Invalid contract type.",
    entertainment_contract_not_found: "Contract not found.",
    entertainment_not_contract_party: "Not a party to this contract.",
    entertainment_contract_not_proposed: "Contract is not in proposed state.",
    entertainment_contract_not_active: "Contract is not active.",
    entertainment_contract_already_completed: "Contract is already completed.",
    entertainment_news_topic_invalid: "Invalid news topic.",
    entertainment_report_not_found: "News report not found.",
    entertainment_report_not_publishable: "Report is not in a publishable state.",
    entertainment_report_not_published: "Report is not published.",
    entertainment_report_not_active: "Report is not in an active state.",
    entertainment_controversy_not_found: "Controversy not found.",
    entertainment_controversy_final: "Controversy is in a final state.",
    entertainment_moderation_not_found: "Moderation record not found.",
    entertainment_moderation_not_pending: "Moderation record is not pending.",
  };
  return messages[code] ?? "An unexpected entertainment system error occurred.";
}
