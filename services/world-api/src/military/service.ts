/**
 * Stage 14 — Military System
 *
 * Main service managing military organizations, bases, units, recruitment,
 * training, ranks, promotions, command appointments, assignments, leave,
 * assets, national-security events, disciplinary cases, and audit records.
 *
 * Server-authoritative. Military service is a career path, not a dominant system.
 * Military records are NOT criminal records. Disciplinary findings are NOT convictions.
 */

import type { CalendarDate } from "../life/types.js";
import type {
  PersistentMilitaryMaps,
  MilitaryOrganizationRecord,
  MilitaryBaseRecord,
  MilitaryUnitRecord,
  MilitaryRecruitmentRecord,
  MilitaryServiceRecord,
  MilitaryTrainingRecord,
  MilitaryRankHistoryRecord,
  MilitaryCommandAppointmentRecord,
  MilitaryAssignmentRecord,
  MilitaryLeaveRecord,
  MilitaryAssetRecord,
  NationalSecurityEventRecord,
  MilitaryDisciplinaryRecord,
  MilitaryAuditRecord,
  ServiceBranchId,
  BaseCategoryId,
  UnitCategoryId,
  AssignmentTypeId,
  EquipmentCategoryId,
  NationalSecurityEventCategoryId,
  DisciplinaryOutcomeId,
  AssetStatusId,
  NationalSecurityEventStatusId,
  MilitaryBaseSnapshot,
  MilitaryUnitSnapshot,
  MilitaryServiceSnapshot,
  MilitaryProfileSnapshot,
} from "./types.js";
import { MilitaryCatalogService } from "./catalog.js";

export function emptyMilitaryMaps(): PersistentMilitaryMaps {
  return {
    militaryOrganizations: {},
    militaryBases: {},
    militaryUnits: {},
    militaryRecruitments: {},
    militaryServiceRecords: {},
    militaryTrainingRecords: {},
    militaryRankHistory: {},
    militaryCommandAppointments: {},
    militaryAssignments: {},
    militaryLeaveRecords: {},
    militaryAssets: {},
    nationalSecurityEvents: {},
    militaryDisciplinaryRecords: {},
    militaryAudits: {},
  };
}

let _uidCounter = 0;
function uid(prefix: string): string {
  _uidCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
}

function serviceNumber(branch: ServiceBranchId, counter: number): string {
  const branchCode: Record<ServiceBranchId, string> = { army: "NA", navy: "NN", air_force: "NAF" };
  return `${branchCode[branch]}${String(counter).padStart(6, "0")}`;
}

const EDUCATION_HIERARCHY: Record<string, number> = { none: 0, primary: 1, secondary: 2, tertiary: 3, postgraduate: 4 };
function meetsEducation(have: string, need: string): boolean {
  return (EDUCATION_HIERARCHY[have] ?? 0) >= (EDUCATION_HIERARCHY[need] ?? 0);
}

function yearsSince(worldDate: CalendarDate, pastDate: CalendarDate): number {
  let years = worldDate.year - pastDate.year;
  if (worldDate.month < pastDate.month || (worldDate.month === pastDate.month && worldDate.day < pastDate.day)) years--;
  return years;
}

function daysBetween(a: CalendarDate, b: CalendarDate): number {
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  return Math.floor((db - da) / 86_400_000);
}

export function initializeMilitaryWorldState(state: PersistentMilitaryMaps): void {
  if (!state.militaryOrganizations) state.militaryOrganizations = {};
  if (!state.militaryBases) state.militaryBases = {};
  if (!state.militaryUnits) state.militaryUnits = {};
  if (!state.militaryRecruitments) state.militaryRecruitments = {};
  if (!state.militaryServiceRecords) state.militaryServiceRecords = {};
  if (!state.militaryTrainingRecords) state.militaryTrainingRecords = {};
  if (!state.militaryRankHistory) state.militaryRankHistory = {};
  if (!state.militaryCommandAppointments) state.militaryCommandAppointments = {};
  if (!state.militaryAssignments) state.militaryAssignments = {};
  if (!state.militaryLeaveRecords) state.militaryLeaveRecords = {};
  if (!state.militaryAssets) state.militaryAssets = {};
  if (!state.nationalSecurityEvents) state.nationalSecurityEvents = {};
  if (!state.militaryDisciplinaryRecords) state.militaryDisciplinaryRecords = {};
  if (!state.militaryAudits) state.militaryAudits = {};
}

export function seedMilitaryWorld(
  state: PersistentMilitaryMaps,
  date: CalendarDate,
): { organizations: number; bases: number } {
  let orgsSeeded = 0;
  let basesSeeded = 0;
  const catalog = new MilitaryCatalogService();
  for (const seed of catalog.get().seed_organizations) {
    if (state.militaryOrganizations[seed.id]) continue;
    state.militaryOrganizations[seed.id] = {
      org_id: seed.id,
      name: seed.name,
      branch: seed.branch,
      org_type: seed.org_type,
      parent_org_id: seed.parent_id,
      base_id: null,
      commanding_officer_id: null,
      status: "active",
      description: seed.description,
      created_at: new Date().toISOString(),
      created_world_date: { ...date },
      updated_at: new Date().toISOString(),
    };
    orgsSeeded++;
  }
  for (const seed of catalog.get().seed_bases) {
    if (state.militaryBases[seed.id]) continue;
    state.militaryBases[seed.id] = {
      base_id: seed.id,
      name: seed.name,
      category: seed.category,
      branch: seed.branch,
      state_id: seed.state_id,
      location_id: seed.location_id,
      parent_org_id: seed.parent_org_id,
      status: "active",
      description: seed.description,
      created_at: new Date().toISOString(),
      created_world_date: { ...date },
      updated_at: new Date().toISOString(),
    };
    basesSeeded++;
  }
  return { organizations: orgsSeeded, bases: basesSeeded };
}

export class MilitaryService {
  private maps: PersistentMilitaryMaps;
  private catalog: MilitaryCatalogService;
  private serviceNumberCounter = 1;

  constructor(maps: PersistentMilitaryMaps | null, catalog: MilitaryCatalogService) {
    this.maps = maps ?? emptyMilitaryMaps();
    this.catalog = catalog;
    // Initialize counter from existing records
    const existing = Object.keys(maps?.militaryServiceRecords ?? {}).length;
    this.serviceNumberCounter = existing + 1;
  }

  getMaps(): PersistentMilitaryMaps {
    return this.maps;
  }

  private audit(category: string, data: { org_id?: string; base_id?: string; unit_id?: string; service_id?: string; character_id?: string; asset_id?: string; event_id?: string; case_id?: string; actor_character_id?: string; summary: string; details?: Record<string, string | number | boolean | null> }, worldDate: CalendarDate) {
    const id = `maudit-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
    _uidCounter++;
    const record: MilitaryAuditRecord = {
      audit_id: id,
      category,
      org_id: data.org_id ?? null,
      base_id: data.base_id ?? null,
      unit_id: data.unit_id ?? null,
      service_id: data.service_id ?? null,
      character_id: data.character_id ?? null,
      asset_id: data.asset_id ?? null,
      event_id: data.event_id ?? null,
      case_id: data.case_id ?? null,
      actor_character_id: data.actor_character_id ?? null,
      summary: data.summary,
      details: data.details ?? {},
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };
    this.maps.militaryAudits[id] = record;
    return record;
  }

  // ─── Organizations ──────────────────────────────────────────

  createOrganization(params: { name: string; branch?: ServiceBranchId | null; org_type: string; parent_org_id?: string | null; base_id?: string | null; description?: string }, worldDate: CalendarDate): MilitaryOrganizationRecord {
    const id = uid("milorg");
    if (params.parent_org_id) {
      const parent = this.maps.militaryOrganizations[params.parent_org_id];
      if (!parent) throw new Error("military_parent_org_not_found");
      // Prevent cycles
      let check: string | null = params.parent_org_id;
      const visited = new Set<string>();
      while (check) {
        if (visited.has(check)) throw new Error("military_org_cycle_detected");
        visited.add(check);
        check = this.maps.militaryOrganizations[check]?.parent_org_id ?? null;
      }
    }
    const record: MilitaryOrganizationRecord = {
      org_id: id,
      name: params.name,
      branch: params.branch ?? null,
      org_type: params.org_type,
      parent_org_id: params.parent_org_id ?? null,
      base_id: params.base_id ?? null,
      commanding_officer_id: null,
      status: "active",
      description: params.description ?? "",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryOrganizations[id] = record;
    this.audit("organization", { org_id: id, summary: `Organization created: ${params.name}` }, worldDate);
    return record;
  }

  getOrganization(orgId: string): MilitaryOrganizationRecord | undefined {
    return this.maps.militaryOrganizations[orgId];
  }

  listOrganizations(branch?: ServiceBranchId | null): readonly MilitaryOrganizationRecord[] {
    let results = Object.values(this.maps.militaryOrganizations);
    if (branch !== undefined) results = results.filter((o) => o.branch === branch);
    return results;
  }

  setOrganizationCommander(orgId: string, serviceId: string): void {
    const org = this.maps.militaryOrganizations[orgId];
    if (!org) throw new Error("military_org_not_found");
    const svc = this.maps.militaryServiceRecords[serviceId];
    if (!svc) throw new Error("military_service_not_found");
    org.commanding_officer_id = serviceId;
    org.updated_at = new Date().toISOString();
  }

  // ─── Bases ──────────────────────────────────────────────────

  createBase(params: { name: string; category: BaseCategoryId; branch?: ServiceBranchId | null; state_id: string; location_id: string; parent_org_id?: string | null; description?: string }, worldDate: CalendarDate): MilitaryBaseRecord {
    if (!this.catalog.hasBaseCategory(params.category)) throw new Error("military_base_category_invalid");
    const id = uid("milbase");
    const record: MilitaryBaseRecord = {
      base_id: id,
      name: params.name,
      category: params.category,
      branch: params.branch ?? null,
      state_id: params.state_id,
      location_id: params.location_id,
      parent_org_id: params.parent_org_id ?? null,
      status: "active",
      description: params.description ?? "",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryBases[id] = record;
    this.audit("base", { base_id: id, summary: `Base created: ${params.name}` }, worldDate);
    return record;
  }

  getBase(baseId: string): MilitaryBaseRecord | undefined {
    return this.maps.militaryBases[baseId];
  }

  listBases(branch?: ServiceBranchId | null): readonly MilitaryBaseRecord[] {
    let results = Object.values(this.maps.militaryBases);
    if (branch !== undefined) results = results.filter((b) => b.branch === branch);
    return results;
  }

  getBaseSnapshot(baseId: string): MilitaryBaseSnapshot | null {
    const b = this.maps.militaryBases[baseId];
    if (!b) return null;
    const personnel = Object.values(this.maps.militaryServiceRecords).filter((s) => s.base_id === baseId && s.status !== "discharged" && s.status !== "retired" && s.status !== "resigned");
    const assets = Object.values(this.maps.militaryAssets).filter((a) => a.base_id === baseId);
    return {
      base_id: b.base_id,
      name: b.name,
      category: b.category,
      branch: b.branch,
      state_id: b.state_id,
      status: b.status,
      parent_org_id: b.parent_org_id,
      personnel_count: personnel.length,
      asset_count: assets.length,
    };
  }

  // ─── Units ──────────────────────────────────────────────────

  createUnit(params: { name: string; branch: ServiceBranchId; unit_category: UnitCategoryId; parent_org_id?: string | null; base_id?: string | null; description?: string }, worldDate: CalendarDate): MilitaryUnitRecord {
    if (!this.catalog.hasBranch(params.branch)) throw new Error("military_branch_invalid");
    if (!this.catalog.hasUnitCategory(params.unit_category)) throw new Error("military_unit_category_invalid");
    const id = uid("milunit");
    const record: MilitaryUnitRecord = {
      unit_id: id,
      name: params.name,
      branch: params.branch,
      unit_category: params.unit_category,
      parent_org_id: params.parent_org_id ?? null,
      base_id: params.base_id ?? null,
      commanding_officer_id: null,
      personnel_count: 0,
      status: "active",
      description: params.description ?? "",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryUnits[id] = record;
    this.audit("unit", { unit_id: id, summary: `Unit created: ${params.name}` }, worldDate);
    return record;
  }

  getUnit(unitId: string): MilitaryUnitRecord | undefined {
    return this.maps.militaryUnits[unitId];
  }

  listUnits(branch?: ServiceBranchId): readonly MilitaryUnitRecord[] {
    let results = Object.values(this.maps.militaryUnits);
    if (branch) results = results.filter((u) => u.branch === branch);
    return results;
  }

  getUnitSnapshot(unitId: string): MilitaryUnitSnapshot | null {
    const u = this.maps.militaryUnits[unitId];
    if (!u) return null;
    const personnel = Object.values(this.maps.militaryAssignments).filter((a) => a.unit_id === unitId && a.status === "active");
    return {
      unit_id: u.unit_id,
      name: u.name,
      branch: u.branch,
      unit_category: u.unit_category,
      base_id: u.base_id,
      status: u.status,
      personnel_count: personnel.length,
      commanding_officer_id: u.commanding_officer_id,
    };
  }

  // ─── Recruitment ────────────────────────────────────────────

  applyForService(params: { character_id: string; branch: ServiceBranchId; education: string; birth_date: CalendarDate }, worldDate: CalendarDate): MilitaryRecruitmentRecord {
    if (!this.catalog.hasBranch(params.branch)) throw new Error("military_branch_invalid");

    const age = yearsSince(worldDate, params.birth_date);
    const minAge = this.catalog.getMinimumRecruitmentAge();
    if (age < minAge) throw new Error("military_age_ineligible");

    const minEducation = this.catalog.getMinimumEducation();
    if (!meetsEducation(params.education, minEducation)) throw new Error("military_education_ineligible");

    // Check for existing active application
    const existing = Object.values(this.maps.militaryRecruitments).find(
      (a) => a.character_id === params.character_id &&
        ["draft", "submitted", "under_review", "awaiting_requirements", "approved"].includes(a.status)
    );
    if (existing) throw new Error("military_duplicate_application");

    const id = uid("milapp");
    const record: MilitaryRecruitmentRecord = {
      application_id: id,
      character_id: params.character_id,
      branch: params.branch,
      status: "submitted",
      education_verified: false,
      age_verified: true,
      required_training: ["basic_military_training"],
      completed_training: [],
      reviewing_authority: null,
      applied_at: new Date().toISOString(),
      applied_world_date: { ...worldDate },
      decided_at: null,
      decided_world_date: null,
      decision_reason: null,
      service_record_id: null,
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryRecruitments[id] = record;
    this.audit("recruitment", { character_id: params.character_id, summary: `Application submitted for ${params.branch}` }, worldDate);
    return record;
  }

  decideApplication(applicationId: string, params: { approved: boolean; reviewing_authority: string; reason?: string | null }, worldDate: CalendarDate): MilitaryRecruitmentRecord {
    const app = this.maps.militaryRecruitments[applicationId];
    if (!app) throw new Error("military_application_not_found");
    if (app.status !== "submitted" && app.status !== "under_review" && app.status !== "awaiting_requirements") {
      throw new Error("military_application_not_decisionable");
    }
    app.status = params.approved ? "approved" : "rejected";
    app.reviewing_authority = params.reviewing_authority;
    app.decided_at = new Date().toISOString();
    app.decided_world_date = { ...worldDate };
    app.decision_reason = params.reason ?? null;
    app.updated_at = new Date().toISOString();
    return app;
  }

  completeTrainingForApplication(applicationId: string, courseId: string): MilitaryRecruitmentRecord {
    const app = this.maps.militaryRecruitments[applicationId];
    if (!app) throw new Error("military_application_not_found");
    if (app.status !== "approved" && app.status !== "awaiting_requirements") throw new Error("military_application_not_in_training");
    const course = this.catalog.getTrainingCourse(courseId);
    if (!course) throw new Error("military_training_course_not_found");
    if (course.branch !== "all" && course.branch !== app.branch) throw new Error("military_training_branch_mismatch");
    if (app.completed_training.includes(courseId)) return app;
    app.completed_training = [...app.completed_training, courseId];
    app.status = "awaiting_requirements";
    app.updated_at = new Date().toISOString();
    return app;
  }

  enrollServiceMember(applicationId: string, worldDate: CalendarDate): MilitaryServiceRecord {
    const app = this.maps.militaryRecruitments[applicationId];
    if (!app) throw new Error("military_application_not_found");
    if (app.status !== "approved" && app.status !== "awaiting_requirements") throw new Error("military_application_not_approved");

    const existing = Object.values(this.maps.militaryServiceRecords).find(
      (s) => s.character_id === app.character_id && !["discharged", "retired", "resigned"].includes(s.status)
    );
    if (existing) throw new Error("military_already_enlisted");

    const id = uid("milservice");
    const sNum = serviceNumber(app.branch, this.serviceNumberCounter++);
    const rank = this.catalog.getRanks(app.branch)[0]?.id ?? "private";
    const record: MilitaryServiceRecord = {
      service_id: id,
      character_id: app.character_id,
      branch: app.branch,
      rank,
      status: "active",
      service_number: sNum,
      org_id: null,
      unit_id: null,
      base_id: null,
      current_assignment_id: null,
      training_completed: [...app.completed_training],
      qualifications: [],
      joined_at: new Date().toISOString(),
      joined_world_date: { ...worldDate },
      rank_since: new Date().toISOString(),
      rank_since_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryServiceRecords[id] = record;

    // Create initial rank history
    const rhId = uid("milrank");
    this.maps.militaryRankHistory[rhId] = {
      record_id: rhId,
      service_id: id,
      from_rank: null,
      to_rank: rank,
      branch: app.branch,
      effective_date: new Date().toISOString(),
      effective_world_date: { ...worldDate },
      authority: null,
      reason: "Initial enlistment",
      record_type: "initial",
      created_at: new Date().toISOString(),
    };

    app.service_record_id = id;
    app.status = "closed";
    app.updated_at = new Date().toISOString();
    this.audit("recruitment", { service_id: id, character_id: app.character_id, summary: `Enlisted in ${app.branch} as ${sNum}` }, worldDate);
    return record;
  }

  getServiceRecord(serviceId: string): MilitaryServiceRecord | undefined {
    return this.maps.militaryServiceRecords[serviceId];
  }

  getServiceByCharacter(characterId: string): MilitaryServiceRecord | undefined {
    return Object.values(this.maps.militaryServiceRecords).find(
      (s) => s.character_id === characterId && !["discharged", "retired", "resigned"].includes(s.status)
    );
  }

  // ─── Training ───────────────────────────────────────────────

  enrollInTraining(params: { service_id: string; course_id: string }, worldDate: CalendarDate): MilitaryTrainingRecord {
    const svc = this.maps.militaryServiceRecords[params.service_id];
    if (!svc) throw new Error("military_service_not_found");
    const course = this.catalog.getTrainingCourse(params.course_id);
    if (!course) throw new Error("military_training_course_not_found");
    if (course.branch !== "all" && course.branch !== svc.branch) throw new Error("military_training_branch_mismatch");

    // Check prerequisites
    if (course.prerequisite_rank_level) {
      const currentRank = this.catalog.getRank(svc.branch, svc.rank);
      if (!currentRank || currentRank.level < course.prerequisite_rank_level) throw new Error("military_training_rank_ineligible");
    }

    // Check not already enrolled
    const existing = Object.values(this.maps.militaryTrainingRecords).find(
      (t) => t.character_id === svc.character_id && t.course_id === params.course_id && (t.status === "enrolled" || t.status === "in_progress")
    );
    if (existing) throw new Error("military_training_already_enrolled");

    const id = uid("miltraining");
    const record: MilitaryTrainingRecord = {
      training_record_id: id,
      character_id: svc.character_id,
      service_id: params.service_id,
      course_id: params.course_id,
      branch: svc.branch,
      status: "enrolled",
      enrolled_at: new Date().toISOString(),
      enrolled_world_date: { ...worldDate },
      completed_at: null,
      completed_world_date: null,
      assessment_result: null,
      instructor_id: null,
      institution_id: null,
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryTrainingRecords[id] = record;
    return record;
  }

  completeTraining(trainingRecordId: string, result: "pass" | "fail", worldDate: CalendarDate): MilitaryTrainingRecord {
    const t = this.maps.militaryTrainingRecords[trainingRecordId];
    if (!t) throw new Error("military_training_not_found");
    if (t.status !== "enrolled" && t.status !== "in_progress") throw new Error("military_training_not_active");
    t.status = result === "pass" ? "completed" : "failed";
    t.assessment_result = result;
    t.completed_at = new Date().toISOString();
    t.completed_world_date = { ...worldDate };
    t.updated_at = new Date().toISOString();

    if (result === "pass" && t.service_id) {
      const svc = this.maps.militaryServiceRecords[t.service_id];
      if (svc && !svc.training_completed.includes(t.course_id)) {
        svc.training_completed = [...svc.training_completed, t.course_id];
        svc.updated_at = new Date().toISOString();
      }
    }
    return t;
  }

  // ─── Promotions ─────────────────────────────────────────────

  promoteServiceMember(serviceId: string, newRank: string, authority: string, reason: string, worldDate: CalendarDate): MilitaryServiceRecord {
    const svc = this.maps.militaryServiceRecords[serviceId];
    if (!svc) throw new Error("military_service_not_found");
    const currentRankDef = this.catalog.getRank(svc.branch, svc.rank);
    const newRankDef = this.catalog.getRank(svc.branch, newRank);
    if (!currentRankDef) throw new Error("military_rank_not_found");
    if (!newRankDef) throw new Error("military_rank_not_found");
    if (newRankDef.level <= currentRankDef.level) throw new Error("military_rank_must_be_higher");

    // Check minimum time in rank
    const minDays = this.catalog.getMinimumTimeInRankDays(currentRankDef.category);
    const daysInRank = daysBetween(svc.rank_since_world_date, worldDate);
    if (daysInRank < minDays) throw new Error("military_insufficient_time_in_rank");

    const fromRank = svc.rank;
    svc.rank = newRank;
    svc.rank_since = new Date().toISOString();
    svc.rank_since_world_date = { ...worldDate };
    svc.updated_at = new Date().toISOString();

    const rhId = uid("milrank");
    this.maps.militaryRankHistory[rhId] = {
      record_id: rhId,
      service_id: serviceId,
      from_rank: fromRank,
      to_rank: newRank,
      branch: svc.branch,
      effective_date: new Date().toISOString(),
      effective_world_date: { ...worldDate },
      authority,
      reason,
      record_type: "promotion",
      created_at: new Date().toISOString(),
    };

    this.audit("promotion", { service_id: serviceId, actor_character_id: authority, summary: `Promoted from ${fromRank} to ${newRank}` }, worldDate);
    return svc;
  }

  getRankHistory(serviceId: string): readonly MilitaryRankHistoryRecord[] {
    return Object.values(this.maps.militaryRankHistory).filter((r) => r.service_id === serviceId);
  }

  // ─── Command Appointments ───────────────────────────────────

  createCommandAppointment(params: { service_id: string; org_id: string; role: string; appointing_authority: string; expiration_date?: string | null }, worldDate: CalendarDate): MilitaryCommandAppointmentRecord {
    const svc = this.maps.militaryServiceRecords[params.service_id];
    if (!svc) throw new Error("military_service_not_found");
    const org = this.maps.militaryOrganizations[params.org_id];
    if (!org) throw new Error("military_org_not_found");

    // Check for existing active appointment in same org
    const existing = Object.values(this.maps.militaryCommandAppointments).find(
      (a) => a.service_id === params.service_id && a.org_id === params.org_id && a.status === "active"
    );
    if (existing) throw new Error("military_duplicate_appointment");

    const id = uid("milapt");
    const record: MilitaryCommandAppointmentRecord = {
      appointment_id: id,
      character_id: svc.character_id,
      service_id: params.service_id,
      org_id: params.org_id,
      role: params.role,
      appointing_authority: params.appointing_authority,
      effective_date: new Date().toISOString(),
      effective_world_date: { ...worldDate },
      expiration_date: params.expiration_date ?? null,
      status: "active",
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryCommandAppointments[id] = record;
    this.audit("appointment", { org_id: params.org_id, service_id: params.service_id, actor_character_id: params.appointing_authority, summary: `Command appointment: ${params.role}` }, worldDate);
    return record;
  }

  revokeCommandAppointment(appointmentId: string, revokedBy: string, reason: string): MilitaryCommandAppointmentRecord {
    const apt = this.maps.militaryCommandAppointments[appointmentId];
    if (!apt) throw new Error("military_appointment_not_found");
    if (apt.status !== "active") throw new Error("military_appointment_not_active");
    apt.status = "revoked";
    apt.revoked_at = new Date().toISOString();
    apt.revoked_by = revokedBy;
    apt.revoke_reason = reason;
    apt.updated_at = new Date().toISOString();
    return apt;
  }

  // ─── Assignments ────────────────────────────────────────────

  assignServiceMember(params: { service_id: string; unit_id?: string | null; base_id?: string | null; assignment_type: AssignmentTypeId; assigned_by: string; description?: string }, worldDate: CalendarDate): MilitaryAssignmentRecord {
    const svc = this.maps.militaryServiceRecords[params.service_id];
    if (!svc) throw new Error("military_service_not_found");
    if (!this.catalog.hasAssignmentType(params.assignment_type)) throw new Error("military_assignment_type_invalid");
    if (svc.status !== "active" && svc.status !== "on_duty") throw new Error("military_service_not_active");

    // Check max active assignments
    const activeCount = Object.values(this.maps.militaryAssignments).filter(
      (a) => a.service_id === params.service_id && a.status === "active"
    ).length;
    if (activeCount >= this.catalog.getRules().maximum_active_assignments_per_person) throw new Error("military_max_assignments");

    const id = uid("milassign");
    const record: MilitaryAssignmentRecord = {
      assignment_id: id,
      character_id: svc.character_id,
      service_id: params.service_id,
      unit_id: params.unit_id ?? null,
      base_id: params.base_id ?? null,
      assignment_type: params.assignment_type,
      status: "active",
      start_date: new Date().toISOString(),
      start_world_date: { ...worldDate },
      end_date: null,
      end_world_date: null,
      assigned_by: params.assigned_by,
      description: params.description ?? "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryAssignments[id] = record;
    svc.current_assignment_id = id;
    svc.base_id = params.base_id ?? svc.base_id;
    svc.unit_id = params.unit_id ?? svc.unit_id;
    svc.updated_at = new Date().toISOString();
    return record;
  }

  endAssignment(assignmentId: string, worldDate: CalendarDate): MilitaryAssignmentRecord {
    const a = this.maps.militaryAssignments[assignmentId];
    if (!a) throw new Error("military_assignment_not_found");
    if (a.status !== "active") throw new Error("military_assignment_not_active");
    a.status = "completed";
    a.end_date = new Date().toISOString();
    a.end_world_date = { ...worldDate };
    a.updated_at = new Date().toISOString();
    const svc = this.maps.militaryServiceRecords[a.service_id];
    if (svc && svc.current_assignment_id === assignmentId) {
      svc.current_assignment_id = null;
      svc.updated_at = new Date().toISOString();
    }
    return a;
  }

  // ─── Leave ──────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  requestLeave(params: { service_id: string; leave_type: string; start_date: string; end_date: string; reason: string; start_world_date: CalendarDate; end_world_date: CalendarDate }, _worldDate: CalendarDate): MilitaryLeaveRecord {
    const svc = this.maps.militaryServiceRecords[params.service_id];
    if (!svc) throw new Error("military_service_not_found");
    if (svc.status !== "active" && svc.status !== "on_duty") throw new Error("military_service_not_active");

    const id = uid("milleave");
    const record: MilitaryLeaveRecord = {
      leave_id: id,
      character_id: svc.character_id,
      service_id: params.service_id,
      leave_type: params.leave_type,
      start_date: params.start_date,
      start_world_date: params.start_world_date,
      end_date: params.end_date,
      end_world_date: params.end_world_date,
      status: "requested",
      approved_by: null,
      reason: params.reason,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryLeaveRecords[id] = record;
    return record;
  }

  approveLeave(leaveId: string, approvedBy: string): MilitaryLeaveRecord {
    const l = this.maps.militaryLeaveRecords[leaveId];
    if (!l) throw new Error("military_leave_not_found");
    if (l.status !== "requested") throw new Error("military_leave_not_pending");
    l.status = "approved";
    l.approved_by = approvedBy;
    l.updated_at = new Date().toISOString();
    const svc = this.maps.militaryServiceRecords[l.service_id];
    if (svc) {
      svc.status = "on_leave";
      svc.updated_at = new Date().toISOString();
    }
    return l;
  }

  // ─── Assets ─────────────────────────────────────────────────

  createAsset(params: { name: string; category: EquipmentCategoryId; org_id?: string | null; unit_id?: string | null; base_id?: string | null; description?: string }, worldDate: CalendarDate): MilitaryAssetRecord {
    if (!this.catalog.hasEquipmentCategory(params.category)) throw new Error("military_equipment_category_invalid");
    const id = uid("milasset");
    const record: MilitaryAssetRecord = {
      asset_id: id,
      name: params.name,
      category: params.category,
      org_id: params.org_id ?? null,
      unit_id: params.unit_id ?? null,
      base_id: params.base_id ?? null,
      status: "serviceable",
      custodian_service_id: null,
      assigned_to_service_id: null,
      assignment_history: [{ event: "created", service_id: null, date: new Date().toISOString() }],
      maintenance_status: "current",
      description: params.description ?? "",
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryAssets[id] = record;
    this.audit("asset", { asset_id: id, summary: `Asset created: ${params.name}` }, worldDate);
    return record;
  }

  assignAsset(assetId: string, toServiceId: string): MilitaryAssetRecord {
    const asset = this.maps.militaryAssets[assetId];
    if (!asset) throw new Error("military_asset_not_found");
    if (asset.status !== "serviceable") throw new Error("military_asset_not_available");
    const svc = this.maps.militaryServiceRecords[toServiceId];
    if (!svc) throw new Error("military_service_not_found");

    asset.status = "assigned";
    asset.assigned_to_service_id = toServiceId;
    asset.custodian_service_id = toServiceId;
    asset.assignment_history = [...asset.assignment_history, { event: "assigned", service_id: toServiceId, date: new Date().toISOString() }];
    asset.updated_at = new Date().toISOString();
    return asset;
  }

  returnAsset(assetId: string): MilitaryAssetRecord {
    const asset = this.maps.militaryAssets[assetId];
    if (!asset) throw new Error("military_asset_not_found");
    if (asset.status !== "assigned") throw new Error("military_asset_not_assigned");

    asset.status = "serviceable";
    asset.assigned_to_service_id = null;
    asset.assignment_history = [...asset.assignment_history, { event: "returned", service_id: null, date: new Date().toISOString() }];
    asset.updated_at = new Date().toISOString();
    return asset;
  }

  updateAssetStatus(assetId: string, status: AssetStatusId): MilitaryAssetRecord {
    const asset = this.maps.militaryAssets[assetId];
    if (!asset) throw new Error("military_asset_not_found");
    asset.status = status;
    if (status === "in_maintenance") asset.maintenance_status = "in_progress";
    asset.updated_at = new Date().toISOString();
    return asset;
  }

  listAssets(baseId?: string, orgId?: string): readonly MilitaryAssetRecord[] {
    let results = Object.values(this.maps.militaryAssets);
    if (baseId) results = results.filter((a) => a.base_id === baseId);
    if (orgId) results = results.filter((a) => a.org_id === orgId);
    return results;
  }

  // ─── National Security Events ───────────────────────────────

  createNationalSecurityEvent(params: { category: NationalSecurityEventCategoryId; title: string; description: string; jurisdiction?: string | null; state_id?: string | null; authorizing_authority: string; public_info?: string | null }, worldDate: CalendarDate): NationalSecurityEventRecord {
    if (!this.catalog.hasNationalSecurityEventCategory(params.category)) throw new Error("military_event_category_invalid");
    const id = uid("milevent");
    const record: NationalSecurityEventRecord = {
      event_id: id,
      category: params.category,
      title: params.title,
      description: params.description,
      jurisdiction: params.jurisdiction ?? null,
      state_id: params.state_id ?? null,
      status: "approved",
      authorizing_authority: params.authorizing_authority,
      participating_org_ids: [],
      assigned_asset_ids: [],
      public_info: params.public_info ?? null,
      started_at: new Date().toISOString(),
      started_world_date: { ...worldDate },
      resolved_at: null,
      resolved_world_date: null,
      resolution: null,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.nationalSecurityEvents[id] = record;
    this.audit("event", { event_id: id, actor_character_id: params.authorizing_authority, summary: `Security event: ${params.category}` }, worldDate);
    return record;
  }

  addParticipatingOrganization(eventId: string, orgId: string): NationalSecurityEventRecord {
    const ev = this.maps.nationalSecurityEvents[eventId];
    if (!ev) throw new Error("military_event_not_found");
    if (!ev.participating_org_ids.includes(orgId)) {
      ev.participating_org_ids = [...ev.participating_org_ids, orgId];
    }
    ev.updated_at = new Date().toISOString();
    return ev;
  }

  resolveNationalSecurityEvent(eventId: string, resolution: string, worldDate: CalendarDate): NationalSecurityEventRecord {
    const ev = this.maps.nationalSecurityEvents[eventId];
    if (!ev) throw new Error("military_event_not_found");
    ev.status = "resolved";
    ev.resolved_at = new Date().toISOString();
    ev.resolved_world_date = { ...worldDate };
    ev.resolution = resolution;
    ev.updated_at = new Date().toISOString();
    return ev;
  }

  listNationalSecurityEvents(status?: NationalSecurityEventStatusId): readonly NationalSecurityEventRecord[] {
    let results = Object.values(this.maps.nationalSecurityEvents);
    if (status) results = results.filter((e) => e.status === status);
    return results;
  }

  // ─── Discipline ─────────────────────────────────────────────

  submitDisciplinaryCase(params: { accused_service_id: string; alleged_conduct: string; related_incident_id?: string | null; evidence_references?: string[]; reviewing_authority?: string | null }, worldDate: CalendarDate): MilitaryDisciplinaryRecord {
    const svc = this.maps.militaryServiceRecords[params.accused_service_id];
    if (!svc) throw new Error("military_service_not_found");

    const id = uid("milcase");
    const record: MilitaryDisciplinaryRecord = {
      case_id: id,
      accused_service_id: params.accused_service_id,
      accused_character_id: svc.character_id,
      related_incident_id: params.related_incident_id ?? null,
      alleged_conduct: params.alleged_conduct,
      evidence_references: params.evidence_references ?? [],
      reviewing_authority: params.reviewing_authority ?? null,
      status: "submitted",
      findings: null,
      outcome: null,
      consequences: null,
      submitted_at: new Date().toISOString(),
      submitted_world_date: { ...worldDate },
      decided_at: null,
      decided_world_date: null,
      appealed_at: null,
      closed_at: null,
      closed_world_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.militaryDisciplinaryRecords[id] = record;
    this.audit("discipline", { case_id: id, service_id: params.accused_service_id, character_id: svc.character_id, summary: `Disciplinary case filed` }, worldDate);
    return record;
  }

  decideDisciplinaryCase(caseId: string, findings: string, outcome: DisciplinaryOutcomeId, consequences: string | null, worldDate: CalendarDate): MilitaryDisciplinaryRecord {
    const c = this.maps.militaryDisciplinaryRecords[caseId];
    if (!c) throw new Error("military_disciplinary_not_found");
    if (!this.catalog.hasDisciplinaryOutcome(outcome)) throw new Error("military_disciplinary_outcome_invalid");
    c.status = "decision_issued";
    c.findings = findings;
    c.outcome = outcome;
    c.consequences = consequences;
    c.decided_at = new Date().toISOString();
    c.decided_world_date = { ...worldDate };
    c.updated_at = new Date().toISOString();

    // Apply consequences to service member
    const svc = this.maps.militaryServiceRecords[c.accused_service_id];
    if (svc) {
      if (outcome === "suspension") svc.status = "suspended";
      if (outcome === "discharge") svc.status = "discharged";
      svc.updated_at = new Date().toISOString();
    }

    this.audit("discipline", { case_id: caseId, service_id: c.accused_service_id, summary: `Disciplinary decision: ${outcome}` }, worldDate);
    return c;
  }

  listDisciplinaryCases(serviceId?: string): readonly MilitaryDisciplinaryRecord[] {
    let results = Object.values(this.maps.militaryDisciplinaryRecords);
    if (serviceId) results = results.filter((c) => c.accused_service_id === serviceId);
    return results;
  }

  // ─── Separation ─────────────────────────────────────────────

  dischargeServiceMember(serviceId: string, reason: string, authority: string, worldDate: CalendarDate): MilitaryServiceRecord {
    const svc = this.maps.militaryServiceRecords[serviceId];
    if (!svc) throw new Error("military_service_not_found");
    svc.status = "discharged";
    svc.updated_at = new Date().toISOString();
    this.audit("separation", { service_id: serviceId, actor_character_id: authority, summary: `Discharged: ${reason}` }, worldDate);
    return svc;
  }

  retireServiceMember(serviceId: string, reason: string, authority: string, worldDate: CalendarDate): MilitaryServiceRecord {
    const svc = this.maps.militaryServiceRecords[serviceId];
    if (!svc) throw new Error("military_service_not_found");
    svc.status = "retired";
    svc.updated_at = new Date().toISOString();
    this.audit("separation", { service_id: serviceId, actor_character_id: authority, summary: `Retired: ${reason}` }, worldDate);
    return svc;
  }

  // ─── Snapshots ──────────────────────────────────────────────

  getServiceSnapshot(serviceId: string): MilitaryServiceSnapshot | null {
    const s = this.maps.militaryServiceRecords[serviceId];
    if (!s) return null;
    const rankDef = this.catalog.getRank(s.branch, s.rank);
    const base = s.base_id ? this.maps.militaryBases[s.base_id] : null;
    return {
      service_id: s.service_id,
      character_id: s.character_id,
      branch: s.branch,
      rank: s.rank,
      rank_label: rankDef?.label ?? s.rank,
      status: s.status,
      service_number: s.service_number,
      org_id: s.org_id,
      unit_id: s.unit_id,
      base_id: s.base_id,
      base_name: base?.name ?? null,
      training_completed: s.training_completed,
      qualifications: s.qualifications,
      joined_at: s.joined_at,
    };
  }

  getMilitaryProfile(characterId: string): MilitaryProfileSnapshot {
    const svc = this.getServiceByCharacter(characterId);
    if (!svc) {
      return {
        character_id: characterId,
        is_service_member: false,
        service_id: null,
        branch: null,
        rank: null,
        rank_label: null,
        status: null,
        service_number: null,
        org_id: null,
        unit_id: null,
        base_id: null,
        base_name: null,
        current_assignment_type: null,
        training_completed: [],
        qualifications: [],
        active_assignments: [],
        disciplinary_cases_count: 0,
        pending_leave_count: 0,
      };
    }
    const rankDef = this.catalog.getRank(svc.branch, svc.rank);
    const base = svc.base_id ? this.maps.militaryBases[svc.base_id] : null;
    const currentAssignment = svc.current_assignment_id ? this.maps.militaryAssignments[svc.current_assignment_id] : null;
    const activeAssignments = Object.values(this.maps.militaryAssignments).filter((a) => a.service_id === svc.service_id && a.status === "active");
    const disciplinaryCases = Object.values(this.maps.militaryDisciplinaryRecords).filter((c) => c.accused_service_id === svc.service_id);
    const pendingLeave = Object.values(this.maps.militaryLeaveRecords).filter((l) => l.service_id === svc.service_id && l.status === "requested");

    return {
      character_id: characterId,
      is_service_member: true,
      service_id: svc.service_id,
      branch: svc.branch,
      rank: svc.rank,
      rank_label: rankDef?.label ?? svc.rank,
      status: svc.status,
      service_number: svc.service_number,
      org_id: svc.org_id,
      unit_id: svc.unit_id,
      base_id: svc.base_id,
      base_name: base?.name ?? null,
      current_assignment_type: currentAssignment?.assignment_type ?? null,
      training_completed: svc.training_completed,
      qualifications: svc.qualifications,
      active_assignments: activeAssignments,
      disciplinary_cases_count: disciplinaryCases.length,
      pending_leave_count: pendingLeave.length,
    };
  }

  // ─── Audit ──────────────────────────────────────────────────

  listAudits(serviceId?: string, orgId?: string): readonly MilitaryAuditRecord[] {
    let results = Object.values(this.maps.militaryAudits);
    if (serviceId) results = results.filter((a) => a.service_id === serviceId);
    if (orgId) results = results.filter((a) => a.org_id === orgId);
    return results;
  }
}

export function militaryErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    military_branch_invalid: "Invalid service branch.",
    military_org_not_found: "Military organization not found.",
    military_org_cycle_detected: "Organizational cycle detected.",
    military_parent_org_not_found: "Parent organization not found.",
    military_base_category_invalid: "Invalid base category.",
    military_unit_category_invalid: "Invalid unit category.",
    military_equipment_category_invalid: "Invalid equipment category.",
    military_event_category_invalid: "Invalid national security event category.",
    military_disciplinary_outcome_invalid: "Invalid disciplinary outcome.",
    military_assignment_type_invalid: "Invalid assignment type.",
    military_training_course_not_found: "Training course not found.",
    military_training_branch_mismatch: "Training course is not available for this service branch.",
    military_training_rank_ineligible: "Rank requirement not met for this training.",
    military_training_already_enrolled: "Already enrolled in this training course.",
    military_training_not_found: "Training record not found.",
    military_training_not_active: "Training is not active.",
    military_age_ineligible: "You do not meet the minimum age requirement for military service.",
    military_education_ineligible: "You do not meet the minimum education requirement for military service.",
    military_duplicate_application: "An active military application already exists.",
    military_application_not_found: "Application not found.",
    military_application_not_decisionable: "Application is not in a decisionable state.",
    military_application_not_in_training: "Application is not in training.",
    military_application_not_approved: "Application has not been approved.",
    military_already_enlisted: "Character is already in military service.",
    military_service_not_found: "Military service record not found.",
    military_service_not_active: "Service record is not active.",
    military_rank_not_found: "Rank not found.",
    military_rank_must_be_higher: "New rank must be higher than current rank.",
    military_insufficient_time_in_rank: "Insufficient time in current rank for promotion.",
    military_duplicate_appointment: "An active command appointment already exists for this person and organization.",
    military_appointment_not_found: "Command appointment not found.",
    military_appointment_not_active: "Command appointment is not active.",
    military_max_assignments: "Maximum active assignments reached.",
    military_assignment_not_found: "Assignment not found.",
    military_assignment_not_active: "Assignment is not active.",
    military_leave_not_found: "Leave record not found.",
    military_leave_not_pending: "Leave request is not pending approval.",
    military_asset_not_found: "Asset not found.",
    military_asset_not_available: "Asset is not available for assignment.",
    military_asset_not_assigned: "Asset is not currently assigned.",
    military_event_not_found: "National security event not found.",
    military_disciplinary_not_found: "Disciplinary case not found.",
  };
  return messages[code] ?? "An unexpected military system error occurred.";
}
