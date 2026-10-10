/**
 * Stage 13 — Police and Security System
 *
 * Main service managing police organizations, recruitment, incidents,
 * dispatch, investigations, evidence, wanted records, arrests, misconduct,
 * and audit records.
 *
 * This service is server-authoritative. It enforces eligibility for
 * recruitment, promotion, incident triage, investigation access,
 * wanted status, arrest authorization, and complaint handling.
 *
 * Police reports and arrest records are NOT convictions. They are
 * evidence and reports that may be referenced by the justice system.
 * Allegations in complaints or wanted requests are NOT convictions.
 */

import type { CalendarDate } from "../life/types.js";
import type {
  PersistentPoliceMaps,
  PoliceUnitRecord,
  PoliceOfficerRecord,
  RecruitmentRecord,
  IncidentRecord,
  DispatchRecord,
  InvestigationRecord,
  PoliceEvidenceRecord,
  WantedRecord,
  ArrestRecord,
  MisconductComplaintRecord,
  PoliceAuditRecord,
  RankId,
  IncidentCategoryId,
  DispatchPriorityId,
  MisconductCategoryId,
  ComplaintOutcomeId,
  IncidentStatusId,
  DispatchStatusId,
  InvestigationStatusId,
  PoliceStationSnapshot,
  OfficerSnapshot,
  IncidentSnapshot,
  InvestigationSnapshot,
  PoliceProfileSnapshot,
  PoliceLevelId,
} from "./types.js";
import { PoliceCatalogService } from "./catalog.js";

export function emptyPoliceMaps(): PersistentPoliceMaps {
  return {
    policeUnits: {},
    policeOfficers: {},
    recruitmentApplications: {},
    policeIncidents: {},
    dispatches: {},
    investigations: {},
    policeEvidence: {},
    wantedRecords: {},
    arrestRecords: {},
    misconductComplaints: {},
    policeAudits: {},
  };
}

let _uidCounter = 0;
function uid(prefix: string): string {
  _uidCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
}

function refNumber(category: IncidentCategoryId, counter: number, year: number): string {
  const prefix = category.substring(0, 3).toUpperCase();
  return `NPF-${prefix}-${year}-${String(counter).padStart(6, "0")}`;
}

function badgeNumber(station: string, counter: number): string {
  const suffix = station.substring(0, 3).toUpperCase();
  return `PF${suffix}${String(counter).padStart(4, "0")}`;
}

const EDUCATION_HIERARCHY: Record<string, number> = {
  none: 0,
  primary: 1,
  secondary: 2,
  tertiary: 3,
  postgraduate: 4,
};

function meetsEducation(have: string, need: string): boolean {
  return (EDUCATION_HIERARCHY[have] ?? 0) >= (EDUCATION_HIERARCHY[need] ?? 0);
}

function yearsSince(worldDate: CalendarDate, pastDate: CalendarDate): number {
  const yearDiff = worldDate.year - pastDate.year;
  const monthDiff = worldDate.month - pastDate.month;
  const dayDiff = worldDate.day - pastDate.day;
  let years = yearDiff;
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years--;
  return years;
}

export function initializePoliceWorldState(state: PersistentPoliceMaps): void {
  if (!state.policeUnits) state.policeUnits = {};
  if (!state.policeOfficers) state.policeOfficers = {};
  if (!state.recruitmentApplications) state.recruitmentApplications = {};
  if (!state.policeIncidents) state.policeIncidents = {};
  if (!state.dispatches) state.dispatches = {};
  if (!state.investigations) state.investigations = {};
  if (!state.policeEvidence) state.policeEvidence = {};
  if (!state.wantedRecords) state.wantedRecords = {};
  if (!state.arrestRecords) state.arrestRecords = {};
  if (!state.misconductComplaints) state.misconductComplaints = {};
  if (!state.policeAudits) state.policeAudits = {};
}

export function seedPoliceWorld(
  state: PersistentPoliceMaps,
  date: CalendarDate,
): { stations: number } {
  let stationsSeeded = 0;
  for (const seed of POLICE_SEED_STATIONS) {
    if (state.policeUnits[seed.id]) continue;
    state.policeUnits[seed.id] = {
      unit_id: seed.id,
      name: seed.name,
      level: seed.level,
      jurisdiction: seed.jurisdiction,
      parent_unit_id: seed.parent_unit_id,
      status: seed.status as "active" | "inactive" | "suspended",
      commanding_officer_id: null,
      created_at: new Date().toISOString(),
      created_world_date: { ...date },
      updated_at: new Date().toISOString(),
    };
    stationsSeeded++;
  }
  return { stations: stationsSeeded };
}

const POLICE_SEED_STATIONS = [
  { id: "national-hq", name: "National Police Headquarters", level: "national" as const, jurisdiction: null, parent_unit_id: null, status: "active" },
  { id: "fct-hq", name: "FCT Police Headquarters", level: "state" as const, jurisdiction: "fct", parent_unit_id: "national-hq", status: "active" },
  { id: "abuja-central", name: "Abuja Central Police Station", level: "station" as const, jurisdiction: "abuja-central", parent_unit_id: "fct-hq", status: "active" },
  { id: "abuja-south", name: "Abuja South Police Station", level: "station" as const, jurisdiction: "abuja-south", parent_unit_id: "fct-hq", status: "active" },
];

export class PoliceService {
  private maps: PersistentPoliceMaps;
  private catalog: PoliceCatalogService;
  private refCounter = 1;
  private badgeCounter = 1;
  private auditCounter = 1;

  constructor(maps: PersistentPoliceMaps | null, catalog: PoliceCatalogService) {
    this.maps = maps ?? emptyPoliceMaps();
    this.catalog = catalog;
  }

  getMaps(): PersistentPoliceMaps {
    return this.maps;
  }

  private audit(category: string, data: { station_id?: string; officer_id?: string; incident_id?: string; investigation_id?: string; arrest_id?: string; wanted_id?: string; complaint_id?: string; actor_character_id?: string; summary: string; details?: Record<string, string | number | boolean | null> }, worldDate: CalendarDate) {
    const id = `audit-${Date.now().toString(36)}-${(this.auditCounter++).toString(36)}`;
    const record: PoliceAuditRecord = {
      audit_id: id,
      category,
      station_id: data.station_id ?? null,
      officer_id: data.officer_id ?? null,
      incident_id: data.incident_id ?? null,
      investigation_id: data.investigation_id ?? null,
      arrest_id: data.arrest_id ?? null,
      wanted_id: data.wanted_id ?? null,
      complaint_id: data.complaint_id ?? null,
      actor_character_id: data.actor_character_id ?? null,
      summary: data.summary,
      details: data.details ?? {},
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };
    this.maps.policeAudits[id] = record;
    return record;
  }

  // ─── Police organization ──────────────────────────────────────

  createStation(params: { name: string; level: PoliceLevelId; jurisdiction: string | null; parent_unit_id?: string | null; status?: "active" | "inactive" | "suspended" }, worldDate: CalendarDate): PoliceUnitRecord {
    const id = uid("station");
    const record: PoliceUnitRecord = {
      unit_id: id,
      name: params.name,
      level: params.level,
      jurisdiction: params.jurisdiction ?? null,
      parent_unit_id: params.parent_unit_id ?? null,
      status: params.status ?? "active",
      commanding_officer_id: null,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.policeUnits[id] = record;
    return record;
  }

  getStation(unitId: string): PoliceUnitRecord | undefined {
    return this.maps.policeUnits[unitId];
  }

  getStationByName(name: string): PoliceUnitRecord | undefined {
    return Object.values(this.maps.policeUnits).find((u) => u.name === name);
  }

  listStations(): readonly PoliceUnitRecord[] {
    return Object.values(this.maps.policeUnits);
  }

  setStationCommander(unitId: string, officerId: string): void {
    const station = this.maps.policeUnits[unitId];
    if (!station) throw new Error("Station not found");
    const officer = this.maps.policeOfficers[officerId];
    if (!officer) throw new Error("Officer not found");
    if (officer.station_id !== unitId) throw new Error("Officer not assigned to this station");
    station.commanding_officer_id = officerId;
    station.updated_at = new Date().toISOString();
  }

  // ─── Seeding ──────────────────────────────────────────────────

  seedStations(worldDate: CalendarDate): void {
    const catalog = this.catalog.get();
    for (const seed of catalog.seed_stations) {
      if (this.maps.policeUnits[seed.id]) continue;
      this.maps.policeUnits[seed.id] = {
        unit_id: seed.id,
        name: seed.name,
        level: seed.level,
        jurisdiction: seed.jurisdiction,
        parent_unit_id: seed.parent_unit_id,
        status: seed.status as "active" | "inactive" | "suspended",
        commanding_officer_id: null,
        created_at: new Date().toISOString(),
        created_world_date: { ...worldDate },
        updated_at: new Date().toISOString(),
      };
    }
  }

  // ─── Recruitment & promotion ──────────────────────────────────

  applyForRecruitment(params: { character_id: string; station_id: string; education: string; birth_date: CalendarDate }, worldDate: CalendarDate): RecruitmentRecord {
    const station = this.getStation(params.station_id);
    if (!station) throw new Error("Station not found");
    if (station.status !== "active") throw new Error("Station is not active");

    const age = yearsSince(worldDate, params.birth_date);
    const minAge = this.catalog.getMinimumRecruitmentAge();
    if (age < minAge) throw new Error(`Must be at least ${minAge} years old`);

    const minEducation = this.catalog.getMinimumEducation();
    if (!meetsEducation(params.education, minEducation)) throw new Error(`Minimum education requirement: ${minEducation}`);

    // Check for existing active application
    const existing = Object.values(this.maps.recruitmentApplications).find(
      (a) => a.character_id === params.character_id &&
        (a.status === "submitted" || a.status === "under_review" || a.status === "training")
    );
    if (existing) throw new Error("Active application already exists");

    const id = uid("recruit");
    const record: RecruitmentRecord = {
      application_id: id,
      character_id: params.character_id,
      station_id: params.station_id,
      status: "submitted",
      education_verified: false,
      training_completed: [],
      applied_at: new Date().toISOString(),
      applied_world_date: { ...worldDate },
      decided_at: null,
      decided_world_date: null,
      decided_by: null,
      decision_reason: null,
      updated_at: new Date().toISOString(),
    };
    this.maps.recruitmentApplications[id] = record;
    this.audit("recruitment", { actor_character_id: params.character_id, station_id: params.station_id, summary: `Application submitted for police recruitment` }, worldDate);
    return record;
  }

  decideApplication(applicationId: string, params: { approved: boolean; decided_by: string; reason?: string | null }, worldDate: CalendarDate): RecruitmentRecord {
    const app = this.maps.recruitmentApplications[applicationId];
    if (!app) throw new Error("Application not found");
    if (app.status !== "submitted" && app.status !== "under_review") throw new Error("Application not in decisionable state");

    app.status = params.approved ? "accepted" : "rejected";
    app.decided_at = new Date().toISOString();
    app.decided_world_date = { ...worldDate };
    app.decided_by = params.decided_by;
    app.decision_reason = params.reason ?? null;
    app.updated_at = new Date().toISOString();
    return app;
  }

  completeTraining(applicationId: string, moduleId: string): RecruitmentRecord {
    const app = this.maps.recruitmentApplications[applicationId];
    if (!app) throw new Error("Application not found");
    if (app.status !== "accepted" && app.status !== "training") throw new Error("Must be accepted or in training");
    if (!this.catalog.getTrainingModule(moduleId)) throw new Error("Unknown training module");
    if (app.training_completed.includes(moduleId)) return app;
    app.training_completed = [...app.training_completed, moduleId];
    app.status = "training";
    app.updated_at = new Date().toISOString();
    return app;
  }

  enrollOfficer(applicationId: string, rank: RankId, worldDate: CalendarDate): PoliceOfficerRecord {
    const app = this.maps.recruitmentApplications[applicationId];
    if (!app) throw new Error("Application not found");
    if (app.status !== "accepted" && app.status !== "training" && app.status !== "completed") throw new Error("Application must be accepted");
    if (!this.catalog.hasRank(rank)) throw new Error("Invalid rank");

    // Check existing officer record
    const existing = Object.values(this.maps.policeOfficers).find((o) => o.character_id === app.character_id && o.status !== "dismissed");
    if (existing) throw new Error("Character is already an officer");

    const station = this.getStation(app.station_id);
    if (!station) throw new Error("Station not found");

    const id = uid("officer");
    const badge = badgeNumber(station.unit_id, this.badgeCounter++);
    const record: PoliceOfficerRecord = {
      officer_id: id,
      character_id: app.character_id,
      station_id: app.station_id,
      rank,
      status: "active",
      badge_number: badge,
      training_completed: [...app.training_completed],
      joined_at: new Date().toISOString(),
      joined_world_date: { ...worldDate },
      appointed_by: app.decided_by,
      updated_at: new Date().toISOString(),
    };
    this.maps.policeOfficers[id] = record;
    app.status = "completed";
    app.updated_at = new Date().toISOString();
    this.audit("recruitment", { officer_id: id, station_id: app.station_id, actor_character_id: app.character_id, summary: `Officer enrolled at rank ${rank}` }, worldDate);
    return record;
  }

  getOfficer(officerId: string): PoliceOfficerRecord | undefined {
    return this.maps.policeOfficers[officerId];
  }

  getOfficerByCharacter(characterId: string): PoliceOfficerRecord | undefined {
    return Object.values(this.maps.policeOfficers).find((o) => o.character_id === characterId && o.status !== "dismissed");
  }

  listOfficers(stationId?: string): readonly PoliceOfficerRecord[] {
    const all = Object.values(this.maps.policeOfficers);
    if (stationId) return all.filter((o) => o.station_id === stationId);
    return all;
  }

  promoteOfficer(officerId: string, newRank: RankId): PoliceOfficerRecord {
    const officer = this.maps.policeOfficers[officerId];
    if (!officer) throw new Error("Officer not found");
    if (!this.catalog.hasRank(newRank)) throw new Error("Invalid rank");
    const currentRank = this.catalog.getRank(officer.rank);
    const targetRank = this.catalog.getRank(newRank);
    if (!currentRank || !targetRank) throw new Error("Rank definition error");
    if (targetRank.level <= currentRank.level) throw new Error("New rank must be higher");
    officer.rank = newRank;
    officer.updated_at = new Date().toISOString();
    return officer;
  }

  // ─── Incident reporting ───────────────────────────────────────

  submitIncident(params: {
    category: IncidentCategoryId;
    description: string;
    summary: string;
    reporter_character_id?: string | null;
    reported_character_id?: string | null;
    location_id?: string | null;
    jurisdiction?: string | null;
    incident_date?: string;
    priority?: DispatchPriorityId;
    related_case_id?: string | null;
    related_property_id?: string | null;
    related_business_id?: string | null;
    confidentiality?: "public" | "confidential" | "anonymous";
  }, worldDate: CalendarDate): IncidentRecord {
    if (!this.catalog.hasIncidentCategory(params.category)) throw new Error("Invalid incident category");
    const rules = this.catalog.getRules();
    if (params.description.length > rules.incident_description_max_length) throw new Error(`Description exceeds max length of ${rules.incident_description_max_length}`);
    if (params.summary.length > rules.incident_summary_max_length) throw new Error(`Summary exceeds max length of ${rules.incident_summary_max_length}`);

    // Duplicate check
    const window = rules.report_duplicate_window_hours * 3600_000;
    const dup = Object.values(this.maps.policeIncidents).find(
      (i) => i.category === params.category &&
        i.reporter_character_id === (params.reporter_character_id ?? null) &&
        i.description === params.description &&
        (Date.now() - new Date(i.created_at).getTime()) < window
    );
    if (dup) throw new Error("Duplicate incident report detected within window");

    const id = uid("incident");
    const year = worldDate.year;
    const ref = refNumber(params.category, this.refCounter++, year);

    const record: IncidentRecord = {
      incident_id: id,
      reference_number: ref,
      category: params.category,
      description: params.description,
      summary: params.summary,
      reporter_character_id: params.reporter_character_id ?? null,
      reported_character_id: params.reported_character_id ?? null,
      location_id: params.location_id ?? null,
      jurisdiction: params.jurisdiction ?? null,
      incident_date: params.incident_date ?? new Date().toISOString(),
      reported_at: new Date().toISOString(),
      reported_world_date: { ...worldDate },
      assigned_station_id: null,
      assigned_officer_id: null,
      priority: params.priority ?? "normal",
      status: "submitted",
      related_case_id: params.related_case_id ?? null,
      related_property_id: params.related_property_id ?? null,
      related_business_id: params.related_business_id ?? null,
      confidentiality: params.confidentiality ?? "public",
      outcome: null,
      closed_at: null,
      closed_world_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.policeIncidents[id] = record;
    this.audit("incident", { incident_id: id, ...(params.reporter_character_id ? { actor_character_id: params.reporter_character_id } : {}), summary: `Incident reported: ${params.category}` }, worldDate);
    return record;
  }

  triageIncident(incidentId: string, params: { accepted: boolean; assigned_station_id?: string; priority?: DispatchPriorityId; reason?: string }, worldDate: CalendarDate): IncidentRecord {
    const inc = this.maps.policeIncidents[incidentId];
    if (!inc) throw new Error("Incident not found");
    if (inc.status !== "submitted" && inc.status !== "awaiting_triage") throw new Error("Incident not awaiting triage");

    if (!params.accepted) {
      inc.status = "rejected";
      inc.outcome = params.reason ?? null;
      inc.closed_at = new Date().toISOString();
      inc.closed_world_date = { ...worldDate };
    } else {
      inc.status = "accepted";
      inc.assigned_station_id = params.assigned_station_id ?? null;
      if (params.priority) inc.priority = params.priority;
    }
    inc.updated_at = new Date().toISOString();
    return inc;
  }

  assignIncident(incidentId: string, officerId: string): IncidentRecord {
    const inc = this.maps.policeIncidents[incidentId];
    if (!inc) throw new Error("Incident not found");
    const officer = this.maps.policeOfficers[officerId];
    if (!officer) throw new Error("Officer not found");
    if (officer.status === "suspended" || officer.status === "dismissed") throw new Error("Officer not on active duty");
    inc.assigned_officer_id = officerId;
    inc.status = "assigned";
    inc.updated_at = new Date().toISOString();
    return inc;
  }

  getIncident(incidentId: string): IncidentRecord | undefined {
    return this.maps.policeIncidents[incidentId];
  }

  listIncidents(stationId?: string, status?: IncidentStatusId): readonly IncidentRecord[] {
    let results = Object.values(this.maps.policeIncidents);
    if (stationId) results = results.filter((i) => i.assigned_station_id === stationId);
    if (status) results = results.filter((i) => i.status === status);
    return results;
  }

  // ─── Dispatch ─────────────────────────────────────────────────

  dispatchUnit(params: { incident_id: string; station_id: string; priority?: DispatchPriorityId; location_id?: string; notes: string; requesting_officer_id?: string | null }, worldDate: CalendarDate): DispatchRecord {
    const inc = this.maps.policeIncidents[params.incident_id];
    if (!inc) throw new Error("Incident not found");
    if (!this.catalog.hasDispatchPriority(params.priority ?? "normal")) throw new Error("Invalid priority");
    const rules = this.catalog.getRules();
    if (params.notes.length > rules.dispatch_notes_max_length) throw new Error(`Notes exceed max length of ${rules.dispatch_notes_max_length}`);

    const id = uid("dispatch");
    const record: DispatchRecord = {
      dispatch_id: id,
      incident_id: params.incident_id,
      station_id: params.station_id,
      requesting_officer_id: params.requesting_officer_id ?? null,
      priority: params.priority ?? inc.priority,
      location_id: params.location_id ?? inc.location_id,
      assigned_unit_id: null,
      assigned_officer_id: null,
      status: "awaiting_dispatch",
      notes: params.notes,
      dispatched_at: new Date().toISOString(),
      dispatched_world_date: { ...worldDate },
      arrived_at: null,
      resolved_at: null,
      resolution: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.dispatches[id] = record;
    inc.status = "assigned";
    inc.updated_at = new Date().toISOString();
    return record;
  }

  acknowledgeDispatch(dispatchId: string, officerId: string): DispatchRecord {
    const d = this.maps.dispatches[dispatchId];
    if (!d) throw new Error("Dispatch not found");
    const officer = this.maps.policeOfficers[officerId];
    if (!officer) throw new Error("Officer not found");
    d.assigned_officer_id = officerId;
    d.status = "acknowledged";
    d.updated_at = new Date().toISOString();
    return d;
  }

  updateDispatchStatus(dispatchId: string, status: DispatchStatusId, resolution?: string): DispatchRecord {
    const d = this.maps.dispatches[dispatchId];
    if (!d) throw new Error("Dispatch not found");
    d.status = status;
    if (status === "at_location") d.arrived_at = new Date().toISOString();
    if (status === "resolved") {
      d.resolved_at = new Date().toISOString();
      if (resolution) d.resolution = resolution;
    }
    d.updated_at = new Date().toISOString();
    return d;
  }

  // ─── Investigations ───────────────────────────────────────────

  openInvestigation(params: { incident_id: string; case_id?: string | null; station_id: string; lead_officer_id: string; category: IncidentCategoryId; summary: string; relevant_law_ids?: string[] }, worldDate: CalendarDate): InvestigationRecord {
    const inc = this.maps.policeIncidents[params.incident_id];
    if (!inc) throw new Error("Incident not found");
    const officer = this.maps.policeOfficers[params.lead_officer_id];
    if (!officer) throw new Error("Officer not found");
    if (officer.status === "suspended" || officer.status === "dismissed") throw new Error("Officer not on active duty");

    // Check active investigation limit
    const rules = this.catalog.getRules();
    const activeCount = Object.values(this.maps.investigations).filter(
      (i) => i.lead_officer_id === params.lead_officer_id && (i.status === "assigned" || i.status === "active" || i.status === "awaiting_info" || i.status === "awaiting_evidence")
    ).length;
    if (activeCount >= rules.max_investigations_per_officer) throw new Error(`Officer has reached max active investigations (${rules.max_investigations_per_officer})`);

    const rules2 = this.catalog.getRules();
    if (params.summary.length > rules2.investigation_summary_max_length) throw new Error(`Summary exceeds max length of ${rules2.investigation_summary_max_length}`);

    const id = uid("invest");
    const record: InvestigationRecord = {
      investigation_id: id,
      incident_id: params.incident_id,
      case_id: params.case_id ?? null,
      station_id: params.station_id,
      lead_officer_id: params.lead_officer_id,
      participant_officer_ids: [params.lead_officer_id],
      category: params.category,
      summary: params.summary,
      status: "assigned",
      relevant_law_ids: params.relevant_law_ids ?? [],
      evidence_ids: [],
      witness_character_ids: [],
      timeline: [{ date: new Date().toISOString(), officer_id: params.lead_officer_id, action: "opened", summary: params.summary }],
      suspension_reason: null,
      referral_target: null,
      closure_outcome: null,
      opened_at: new Date().toISOString(),
      opened_world_date: { ...worldDate },
      closed_at: null,
      closed_world_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.investigations[id] = record;
    inc.status = "under_investigation";
    inc.updated_at = new Date().toISOString();
    return record;
  }

  addEvidenceToInvestigation(investigationId: string, evidenceId: string): void {
    const inv = this.maps.investigations[investigationId];
    if (!inv) throw new Error("Investigation not found");
    if (!inv.evidence_ids.includes(evidenceId)) {
      inv.evidence_ids = [...inv.evidence_ids, evidenceId];
    }
    inv.updated_at = new Date().toISOString();
  }

  addTimelineEntry(investigationId: string, officerId: string, action: string, summary: string): void {
    const inv = this.maps.investigations[investigationId];
    if (!inv) throw new Error("Investigation not found");
    inv.timeline = [...inv.timeline, { date: new Date().toISOString(), officer_id: officerId, action, summary }];
    inv.updated_at = new Date().toISOString();
  }

  closeInvestigation(investigationId: string, outcome: string, worldDate: CalendarDate): InvestigationRecord {
    const inv = this.maps.investigations[investigationId];
    if (!inv) throw new Error("Investigation not found");
    inv.status = "closed";
    inv.closure_outcome = outcome;
    inv.closed_at = new Date().toISOString();
    inv.closed_world_date = { ...worldDate };
    inv.updated_at = new Date().toISOString();
    return inv;
  }

  getInvestigation(investigationId: string): InvestigationRecord | undefined {
    return this.maps.investigations[investigationId];
  }

  listInvestigations(officerId?: string, status?: InvestigationStatusId): readonly InvestigationRecord[] {
    let results = Object.values(this.maps.investigations);
    if (officerId) results = results.filter((i) => i.lead_officer_id === officerId || i.participant_officer_ids.includes(officerId));
    if (status) results = results.filter((i) => i.status === status);
    return results;
  }

  // ─── Evidence ─────────────────────────────────────────────────

  submitEvidence(params: { incident_id: string; investigation_id?: string | null; case_id?: string | null; category: string; description: string; source_reference?: string | null; collected_by_officer_id: string }, worldDate: CalendarDate): PoliceEvidenceRecord {
    const inc = this.maps.policeIncidents[params.incident_id];
    if (!inc) throw new Error("Incident not found");
    const officer = this.maps.policeOfficers[params.collected_by_officer_id];
    if (!officer) throw new Error("Officer not found");

    const rules = this.catalog.getRules();
    if (params.description.length > rules.evidence_description_max_length) throw new Error(`Description exceeds max length of ${rules.evidence_description_max_length}`);

    // Check max evidence per incident
    const existingCount = Object.values(this.maps.policeEvidence).filter((e) => e.incident_id === params.incident_id).length;
    if (existingCount >= rules.max_evidence_per_incident) throw new Error(`Max evidence per incident (${rules.max_evidence_per_incident}) reached`);

    const id = uid("evidence");
    const record: PoliceEvidenceRecord = {
      evidence_id: id,
      incident_id: params.incident_id,
      investigation_id: params.investigation_id ?? null,
      case_id: params.case_id ?? null,
      justice_evidence_id: null,
      category: params.category,
      description: params.description,
      source_reference: params.source_reference ?? null,
      collected_by_officer_id: params.collected_by_officer_id,
      collected_at: new Date().toISOString(),
      collected_world_date: { ...worldDate },
      custody_chain: [{ officer_id: params.collected_by_officer_id, event: "collected", date: new Date().toISOString() }],
      current_custodian_officer_id: params.collected_by_officer_id,
      integrity_status: "unverified",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.policeEvidence[id] = record;
    if (params.investigation_id) this.addEvidenceToInvestigation(params.investigation_id, id);
    return record;
  }

  transferCustody(evidenceId: string, toOfficerId: string, event: string): PoliceEvidenceRecord {
    const ev = this.maps.policeEvidence[evidenceId];
    if (!ev) throw new Error("Evidence not found");
    const officer = this.maps.policeOfficers[toOfficerId];
    if (!officer) throw new Error("Officer not found");
    ev.custody_chain = [...ev.custody_chain, { officer_id: toOfficerId, event, date: new Date().toISOString() }];
    ev.current_custodian_officer_id = toOfficerId;
    ev.updated_at = new Date().toISOString();
    return ev;
  }

  // ─── Wanted records ───────────────────────────────────────────

  requestWantedRecord(params: { character_id: string; incident_id?: string | null; investigation_id?: string | null; case_id?: string | null; reason: string; legal_basis: string; issuing_officer_id: string; jurisdiction?: string | null; priority?: DispatchPriorityId }, worldDate: CalendarDate): WantedRecord {
    const officer = this.maps.policeOfficers[params.issuing_officer_id];
    if (!officer) throw new Error("Officer not found");
    if (officer.status === "suspended" || officer.status === "dismissed") throw new Error("Officer not on active duty");
    if (!params.reason || params.reason.length === 0) throw new Error("Reason is required for wanted request");
    if (!params.legal_basis || params.legal_basis.length === 0) throw new Error("Legal basis is required");

    const rules = this.catalog.getRules();
    if (params.reason.length > rules.wanted_reason_max_length) throw new Error(`Reason exceeds max length of ${rules.wanted_reason_max_length}`);

    // Check if character already has an active wanted record
    const existing = Object.values(this.maps.wantedRecords).find(
      (w) => w.character_id === params.character_id && w.status === "active"
    );
    if (existing) throw new Error("Character already has an active wanted record");

    const id = uid("wanted");
    const record: WantedRecord = {
      wanted_id: id,
      character_id: params.character_id,
      incident_id: params.incident_id ?? null,
      investigation_id: params.investigation_id ?? null,
      case_id: params.case_id ?? null,
      reason: params.reason,
      legal_basis: params.legal_basis,
      issuing_officer_id: params.issuing_officer_id,
      jurisdiction: params.jurisdiction ?? null,
      status: "requested",
      priority: params.priority ?? "normal",
      issued_at: new Date().toISOString(),
      issued_world_date: { ...worldDate },
      authorized_at: null,
      authorized_by: null,
      expires_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
      resolved_at: null,
      resolved_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.wantedRecords[id] = record;
    this.audit("wanted", { wanted_id: id, officer_id: params.issuing_officer_id, summary: `Wanted record requested for character` }, worldDate);
    return record;
  }

  authorizeWantedRecord(wantedId: string, authorizedBy: string): WantedRecord {
    const w = this.maps.wantedRecords[wantedId];
    if (!w) throw new Error("Wanted record not found");
    if (w.status !== "requested" && w.status !== "under_review") throw new Error("Wanted record not pending authorization");
    const authorizer = this.maps.policeOfficers[authorizedBy];
    if (!authorizer) throw new Error("Authorizer must be a registered officer");
    const authorizerRank = this.catalog.getRank(authorizer.rank);
    const issuer = this.maps.policeOfficers[w.issuing_officer_id];
    if (issuer && authorizerRank && this.catalog.getRank(issuer.rank)) {
      if (authorizerRank.level <= this.catalog.getRank(issuer.rank)!.level) throw new Error("Authorizer must be higher rank than issuer");
    }
    w.status = "authorized";
    w.authorized_at = new Date().toISOString();
    w.authorized_by = authorizedBy;
    w.updated_at = new Date().toISOString();
    return w;
  }

  activateWantedRecord(wantedId: string): WantedRecord {
    const w = this.maps.wantedRecords[wantedId];
    if (!w) throw new Error("Wanted record not found");
    if (w.status !== "authorized") throw new Error("Wanted record must be authorized before activation");
    w.status = "active";
    w.updated_at = new Date().toISOString();
    return w;
  }

  cancelWantedRecord(wantedId: string, cancelledBy: string, reason: string): WantedRecord {
    const w = this.maps.wantedRecords[wantedId];
    if (!w) throw new Error("Wanted record not found");
    if (w.status !== "requested" && w.status !== "authorized" && w.status !== "active") throw new Error("Cannot cancel record in this state");
    w.status = "cancelled";
    w.cancelled_at = new Date().toISOString();
    w.cancelled_by = cancelledBy;
    w.cancellation_reason = reason;
    w.updated_at = new Date().toISOString();
    return w;
  }

  getWantedRecord(wantedId: string): WantedRecord | undefined {
    return this.maps.wantedRecords[wantedId];
  }

  getActiveWantedRecord(characterId: string): WantedRecord | undefined {
    return Object.values(this.maps.wantedRecords).find((w) => w.character_id === characterId && w.status === "active");
  }

  listWantedRecords(): readonly WantedRecord[] {
    return Object.values(this.maps.wantedRecords);
  }

  // ─── Arrests ──────────────────────────────────────────────────

  executeArrest(params: { character_id: string; arresting_officer_id: string; incident_id?: string | null; investigation_id?: string | null; case_id?: string | null; wanted_id?: string | null; reason: string; legal_basis: string; location_id?: string | null }, worldDate: CalendarDate): ArrestRecord {
    const officer = this.maps.policeOfficers[params.arresting_officer_id];
    if (!officer) throw new Error("Officer not found");
    if (officer.status === "suspended" || officer.status === "dismissed") throw new Error("Officer not on active duty");
    if (!params.reason || params.reason.length === 0) throw new Error("Reason is required");
    if (!params.legal_basis || params.legal_basis.length === 0) throw new Error("Legal basis is required");

    const rules = this.catalog.getRules();
    if (params.reason.length > rules.arrest_reason_max_length) throw new Error(`Reason exceeds max length of ${rules.arrest_reason_max_length}`);

    // If linked to wanted record, verify it is active
    if (params.wanted_id) {
      const wanted = this.maps.wantedRecords[params.wanted_id];
      if (!wanted) throw new Error("Wanted record not found");
      if (wanted.character_id !== params.character_id) throw new Error("Wanted record does not match target character");
      if (wanted.status !== "active") throw new Error("Wanted record is not active");
    }

    const id = uid("arrest");
    const record: ArrestRecord = {
      arrest_id: id,
      character_id: params.character_id,
      arresting_officer_id: params.arresting_officer_id,
      incident_id: params.incident_id ?? null,
      investigation_id: params.investigation_id ?? null,
      case_id: params.case_id ?? null,
      wanted_id: params.wanted_id ?? null,
      reason: params.reason,
      legal_basis: params.legal_basis,
      location_id: params.location_id ?? null,
      status: "requested",
      arrested_at: new Date().toISOString(),
      arrested_world_date: { ...worldDate },
      processed_at: null,
      processed_world_date: null,
      released_at: null,
      released_world_date: null,
      release_reason: null,
      referred_case_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.arrestRecords[id] = record;
    this.audit("arrest", { arrest_id: id, officer_id: params.arresting_officer_id, summary: `Arrest executed` }, worldDate);
    return record;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  authorizeArrest(arrestId: string, _authorizedBy: string): ArrestRecord {
    const a = this.maps.arrestRecords[arrestId];
    if (!a) throw new Error("Arrest record not found");
    if (a.status !== "requested") throw new Error("Arrest not pending authorization");
    a.status = "authorized";
    a.updated_at = new Date().toISOString();
    return a;
  }

  processArrestedCharacter(arrestId: string): ArrestRecord {
    const a = this.maps.arrestRecords[arrestId];
    if (!a) throw new Error("Arrest record not found");
    if (a.status !== "authorized" && a.status !== "executed") throw new Error("Arrest not in processable state");
    a.status = "awaiting_processing";
    a.processed_at = new Date().toISOString();
    a.processed_world_date = a.arrested_world_date;
    a.updated_at = new Date().toISOString();
    return a;
  }

  releaseCharacter(arrestId: string, reason: string): ArrestRecord {
    const a = this.maps.arrestRecords[arrestId];
    if (!a) throw new Error("Arrest record not found");
    a.status = "released";
    a.released_at = new Date().toISOString();
    a.released_world_date = a.arrested_world_date;
    a.release_reason = reason;
    a.updated_at = new Date().toISOString();
    return a;
  }

  referToJustice(arrestId: string, caseId: string): ArrestRecord {
    const a = this.maps.arrestRecords[arrestId];
    if (!a) throw new Error("Arrest record not found");
    a.status = "referred";
    a.referred_case_id = caseId;
    a.updated_at = new Date().toISOString();
    return a;
  }

  getArrestRecord(arrestId: string): ArrestRecord | undefined {
    return this.maps.arrestRecords[arrestId];
  }

  listArrests(characterId?: string, officerId?: string): readonly ArrestRecord[] {
    let results = Object.values(this.maps.arrestRecords);
    if (characterId) results = results.filter((a) => a.character_id === characterId);
    if (officerId) results = results.filter((a) => a.arresting_officer_id === officerId);
    return results;
  }

  // ─── Misconduct / complaints ──────────────────────────────────

  submitMisconductComplaint(params: { complainant_character_id?: string | null; accused_officer_id: string; incident_id?: string | null; arrest_id?: string | null; category: MisconductCategoryId; description: string; evidence_references?: string[] }, worldDate: CalendarDate): MisconductComplaintRecord {
    const officer = this.maps.policeOfficers[params.accused_officer_id];
    if (!officer) throw new Error("Officer not found");
    if (!this.catalog.hasMisconductCategory(params.category)) throw new Error("Invalid misconduct category");
    const rules = this.catalog.getRules();
    if (params.description.length > rules.complaint_description_max_length) throw new Error(`Description exceeds max length of ${rules.complaint_description_max_length}`);

    const id = uid("complaint");
    const record: MisconductComplaintRecord = {
      complaint_id: id,
      complainant_character_id: params.complainant_character_id ?? null,
      accused_officer_id: params.accused_officer_id,
      incident_id: params.incident_id ?? null,
      arrest_id: params.arrest_id ?? null,
      category: params.category,
      description: params.description,
      evidence_references: params.evidence_references ?? [],
      status: "submitted",
      assigned_reviewer_id: null,
      findings: null,
      outcome: null,
      submitted_at: new Date().toISOString(),
      submitted_world_date: { ...worldDate },
      resolved_at: null,
      resolved_world_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.misconductComplaints[id] = record;
    this.audit("complaint", { complaint_id: id, officer_id: params.accused_officer_id, ...(params.complainant_character_id ? { actor_character_id: params.complainant_character_id } : {}), summary: `Misconduct complaint filed: ${params.category}` }, worldDate);
    return record;
  }

  resolveComplaint(complaintId: string, findings: string, outcome: ComplaintOutcomeId, worldDate: CalendarDate): MisconductComplaintRecord {
    const c = this.maps.misconductComplaints[complaintId];
    if (!c) throw new Error("Complaint not found");
    if (!this.catalog.hasComplaintOutcome(outcome)) throw new Error("Invalid outcome");
    c.status = "resolved";
    c.findings = findings;
    c.outcome = outcome;
    c.resolved_at = new Date().toISOString();
    c.resolved_world_date = { ...worldDate };
    c.updated_at = new Date().toISOString();

    // Apply outcome to officer
    const officer = this.maps.policeOfficers[c.accused_officer_id];
    if (officer) {
      if (outcome === "suspension") officer.status = "suspended";
      if (outcome === "dismissal" || outcome === "legal_referral") officer.status = "dismissed";
      officer.updated_at = new Date().toISOString();
    }

    return c;
  }

  getComplaint(complaintId: string): MisconductComplaintRecord | undefined {
    return this.maps.misconductComplaints[complaintId];
  }

  listComplaints(officerId?: string): readonly MisconductComplaintRecord[] {
    let results = Object.values(this.maps.misconductComplaints);
    if (officerId) results = results.filter((c) => c.accused_officer_id === officerId);
    return results;
  }

  // ─── Audit logs ───────────────────────────────────────────────

  listAudits(stationId?: string, officerId?: string): readonly PoliceAuditRecord[] {
    let results = Object.values(this.maps.policeAudits);
    if (stationId) results = results.filter((a) => a.station_id === stationId);
    if (officerId) results = results.filter((a) => a.officer_id === officerId);
    return results;
  }

  // ─── Snapshots ────────────────────────────────────────────────

  getStationSnapshot(unitId: string): PoliceStationSnapshot | null {
    const u = this.maps.policeUnits[unitId];
    if (!u) return null;
    const officers = Object.values(this.maps.policeOfficers).filter((o) => o.station_id === unitId);
    const incidents = Object.values(this.maps.policeIncidents).filter((i) => i.assigned_station_id === unitId && i.status !== "closed" && i.status !== "resolved" && i.status !== "rejected");
    const investigations = Object.values(this.maps.investigations).filter((i) => i.station_id === unitId && i.status !== "closed");
    const dispatches = Object.values(this.maps.dispatches).filter((d) => d.station_id === unitId && d.status !== "resolved" && d.status !== "cancelled");
    return {
      unit_id: u.unit_id,
      name: u.name,
      level: u.level,
      jurisdiction: u.jurisdiction,
      status: u.status,
      officer_count: officers.length,
      active_incident_count: incidents.length,
      active_investigation_count: investigations.length,
      active_dispatch_count: dispatches.length,
    };
  }

  getOfficerSnapshot(officerId: string): OfficerSnapshot | null {
    const o = this.maps.policeOfficers[officerId];
    if (!o) return null;
    const station = this.maps.policeUnits[o.station_id];
    const rank = this.catalog.getRank(o.rank);
    const activeInvestigations = Object.values(this.maps.investigations).filter(
      (i) => (i.lead_officer_id === officerId || i.participant_officer_ids.includes(officerId)) &&
        (i.status === "assigned" || i.status === "active" || i.status === "awaiting_info" || i.status === "awaiting_evidence")
    );
    return {
      officer_id: o.officer_id,
      character_id: o.character_id,
      station_id: o.station_id,
      station_name: station?.name ?? "Unknown",
      rank: o.rank,
      rank_label: rank?.label ?? o.rank,
      status: o.status,
      badge_number: o.badge_number,
      training_completed: o.training_completed,
      active_investigation_count: activeInvestigations.length,
    };
  }

  getPoliceProfile(characterId: string): PoliceProfileSnapshot {
    const officer = this.getOfficerByCharacter(characterId);
    if (!officer) {
      return {
        character_id: characterId,
        is_officer: false,
        officer_id: null,
        station_id: null,
        rank: null,
        rank_label: null,
        status: null,
        badge_number: null,
        assigned_incidents: [],
        active_investigations: [],
        misconduct_complaints_count: 0,
      };
    }
    const rank = this.catalog.getRank(officer.rank);
    const assignedIncidents = Object.values(this.maps.policeIncidents)
      .filter((i) => i.assigned_officer_id === officer.officer_id && i.status !== "closed" && i.status !== "resolved")
      .map((i) => this.toIncidentSnapshot(i));
    const activeInvestigations = Object.values(this.maps.investigations)
      .filter((i) => (i.lead_officer_id === officer.officer_id || i.participant_officer_ids.includes(officer.officer_id)) && i.status !== "closed")
      .map((i) => this.toInvestigationSnapshot(i));
    const complaints = Object.values(this.maps.misconductComplaints).filter((c) => c.accused_officer_id === officer.officer_id);

    return {
      character_id: characterId,
      is_officer: true,
      officer_id: officer.officer_id,
      station_id: officer.station_id,
      rank: officer.rank,
      rank_label: rank?.label ?? officer.rank,
      status: officer.status,
      badge_number: officer.badge_number,
      assigned_incidents: assignedIncidents,
      active_investigations: activeInvestigations,
      misconduct_complaints_count: complaints.length,
    };
  }

  private toIncidentSnapshot(i: IncidentRecord): IncidentSnapshot {
    return {
      incident_id: i.incident_id,
      reference_number: i.reference_number,
      category: i.category,
      summary: i.summary,
      reporter_character_id: i.reporter_character_id,
      reported_character_id: i.reported_character_id,
      location_id: i.location_id,
      assigned_station_id: i.assigned_station_id,
      assigned_officer_id: i.assigned_officer_id,
      priority: i.priority,
      status: i.status,
      reported_at: i.reported_at,
      related_case_id: i.related_case_id,
    };
  }

  private toInvestigationSnapshot(i: InvestigationRecord): InvestigationSnapshot {
    return {
      investigation_id: i.investigation_id,
      incident_id: i.incident_id,
      case_id: i.case_id,
      station_id: i.station_id,
      lead_officer_id: i.lead_officer_id,
      category: i.category,
      summary: i.summary,
      status: i.status,
      evidence_count: i.evidence_ids.length,
      witness_count: i.witness_character_ids.length,
      opened_at: i.opened_at,
      closed_at: i.closed_at,
    };
  }
}

export function policeErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    police_action_invalid: "Choose a supported police action.",
    police_action_unknown: "That police action is not supported.",
    police_station_required: "Station ID is required.",
    police_station_not_found: "Police station not found.",
    police_incident_fields_required: "Incident category, description, and summary are required.",
    police_incident_required: "Incident ID is required.",
    police_incident_not_found: "Incident not found.",
    police_dispatch_fields_required: "Incident ID, station ID, and notes are required.",
    police_investigation_fields_required: "Incident ID, station ID, category, and summary are required.",
    police_evidence_fields_required: "Incident ID, category, and description are required.",
    police_wanted_fields_required: "Character ID, reason, and legal basis are required.",
    police_arrest_fields_required: "Character ID, reason, and legal basis are required.",
    police_complaint_fields_required: "Accused officer ID, category, and description are required.",
    police_not_an_officer: "You must be a registered police officer to perform this action.",
    police_age_ineligible: "You do not meet the minimum age requirement for recruitment.",
    police_education_ineligible: "You do not meet the minimum education requirement for recruitment.",
    police_officer_not_found: "Officer not found.",
    police_officer_suspended: "Officer is suspended or dismissed.",
    police_rank_invalid: "Invalid rank.",
    police_rank_must_be_higher: "New rank must be higher than current rank.",
    police_max_investigations: "Maximum active investigations reached for this officer.",
    police_max_evidence: "Maximum evidence per incident reached.",
    police_duplicate_application: "An active recruitment application already exists.",
    police_duplicate_report: "Duplicate incident report detected.",
    police_wanted_active: "Character already has an active wanted record.",
    police_wanted_rank_ineligible: "Authorizer must be higher rank than the issuer.",
    police_wanted_not_active: "Wanted record is not active.",
    police_wanted_mismatch: "Wanted record does not match target character.",
    police_description_too_long: "Description exceeds maximum length.",
    police_summary_too_long: "Summary exceeds maximum length.",
    police_notes_too_long: "Notes exceed maximum length.",
    police_reason_too_long: "Reason exceeds maximum length.",
    police_category_invalid: "Invalid category.",
    police_priority_invalid: "Invalid priority.",
    police_outcome_invalid: "Invalid outcome.",
  };
  return messages[code] ?? "An unexpected police system error occurred.";
}
