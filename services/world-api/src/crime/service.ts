/**
 * Stage 15 — Crime and Consequences System
 *
 * Server-authoritative service for crime incidents, resolution, evidence,
 * criminal records, notoriety, consequences, and rehabilitation.
 *
 * Integrates with:
 * - Police (Stage 13): incident reports, investigations, wanted status
 * - Justice (Stage 12): law references, court cases, judgments
 * - Economy (Stage 7): financial consequences, restitution
 * - Careers (Stage 6): employment consequences
 * - Government (Stage 10): political consequences
 * - Life (Stage 5): character attributes, age, relationships
 *
 * Crime incidents ≠ convictions. Allegations ≠ established facts.
 */

import type { CalendarDate } from "../life/types.js";
import type {
  PersistentCrimeMaps,
  CrimeIncidentRecord,
  CrimeParticipationRecord,
  CrimeEvidenceRecord,
  CrimeReportRecord,
  CriminalRecord,
  CrimeNotorietyRecord,
  CrimeRestitutionRecord,
  CrimeRehabilitationRecord,
  CrimeAuditRecord,
  CrimeCategoryId,
  CrimeSeverityId,
  CrimeIncidentStatusId,
  ParticipantRoleId,
  CrimeOutcomeId,
  CrimeIncidentSnapshot,
  CriminalProfileSnapshot,
} from "./types.js";
import { CrimeCatalogService } from "./catalog.js";

export function emptyCrimeMaps(): PersistentCrimeMaps {
  return {
    crimeIncidents: {},
    crimeParticipations: {},
    crimeEvidence: {},
    crimeReports: {},
    criminalRecords: {},
    crimeNotoriety: {},
    crimeRestitution: {},
    crimeRehabilitation: {},
    crimeAudits: {},
  };
}

let _uidCounter = 0;
function uid(prefix: string): string {
  _uidCounter++;
  return `${prefix}-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
}

function yearsSince(worldDate: CalendarDate, pastDate: CalendarDate): number {
  let years = worldDate.year - pastDate.year;
  if (worldDate.month < pastDate.month || (worldDate.month === pastDate.month && worldDate.day < pastDate.day)) years--;
  return years;
}

function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return Math.floor((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** Simple seeded pseudo-random for reproducible server-side resolution */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function initializeCrimeWorldState(state: PersistentCrimeMaps): void {
  if (!state.crimeIncidents) state.crimeIncidents = {};
  if (!state.crimeParticipations) state.crimeParticipations = {};
  if (!state.crimeEvidence) state.crimeEvidence = {};
  if (!state.crimeReports) state.crimeReports = {};
  if (!state.criminalRecords) state.criminalRecords = {};
  if (!state.crimeNotoriety) state.crimeNotoriety = {};
  if (!state.crimeRestitution) state.crimeRestitution = {};
  if (!state.crimeRehabilitation) state.crimeRehabilitation = {};
  if (!state.crimeAudits) state.crimeAudits = {};
}

export function seedCrimeWorld(): { seeded: boolean } {
  // Crime catalogue is configuration-only; no runtime seeding required.
  return { seeded: true };
}

export class CrimeService {
  private maps: PersistentCrimeMaps;
  private catalog: CrimeCatalogService;

  constructor(maps: PersistentCrimeMaps | null, catalog: CrimeCatalogService) {
    this.maps = maps ?? emptyCrimeMaps();
    this.catalog = catalog;
  }

  getMaps(): PersistentCrimeMaps { return this.maps; }

  private audit(category: string, data: { incident_id?: string; character_id?: string; actor_character_id?: string; summary: string; details?: Record<string, string | number | boolean | null> }, worldDate: CalendarDate) {
    const id = `caudit-${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
    _uidCounter++;
    const record: CrimeAuditRecord = {
      audit_id: id, category,
      incident_id: data.incident_id ?? null,
      character_id: data.character_id ?? null,
      actor_character_id: data.actor_character_id ?? null,
      summary: data.summary, details: data.details ?? {},
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
    };
    this.maps.crimeAudits[id] = record;
  }

  // ─── Crime action resolution ──────────────────────────────────

  resolveCrimeAction(params: {
    crime_definition_id: string;
    perpetrator_character_id: string;
    victim_character_id?: string | null;
    victim_property_id?: string | null;
    victim_business_id?: string | null;
    location_id?: string | null;
    state_id?: string | null;
    value_involved?: number;
    description?: string;
    perpetrator_age: number;
    seed?: number;
  }, worldDate: CalendarDate): { incident: CrimeIncidentRecord; detected: boolean; value_gained: number; outcome: CrimeOutcomeId } {
    const def = this.catalog.getCrimeDefinition(params.crime_definition_id);
    if (!def) throw new Error("crime_definition_not_found");
    const rules = this.catalog.getRules();

    // Age check
    if (params.perpetrator_age < rules.minimum_age_for_crime_action) throw new Error("crime_age_ineligible");

    // Victim targeting cooldown
    if (params.victim_character_id) {
      const recentTargeting = Object.values(this.maps.crimeIncidents).filter(
        (i) => i.perpetrator_character_id === params.perpetrator_character_id &&
          i.victim_character_id === params.victim_character_id &&
          (Date.now() - new Date(i.created_at).getTime()) < rules.victim_targeting_cooldown_hours * 3600_000
      );
      if (recentTargeting.length > 0) throw new Error("crime_victim_cooldown");
    }

    // Max incidents per day
    const todayIncidents = Object.values(this.maps.crimeIncidents).filter(
      (i) => i.perpetrator_character_id === params.perpetrator_character_id &&
        (Date.now() - new Date(i.created_at).getTime()) < 86400_000
    );
    if (todayIncidents.length >= rules.max_incidents_per_day_per_character) throw new Error("crime_daily_limit_reached");

    // Value determination
    const rng = seededRandom(params.seed ?? Date.now());
    const value = params.value_involved ?? Math.floor(def.min_value + rng() * (def.max_value - def.min_value));
    const severityDef = this.catalog.getSeverity(def.severity);
    if (!severityDef) throw new Error("crime_severity_not_found");

    // Detection roll
    const detectionRoll = rng();
    const detected = detectionRoll < severityDef.base_detection_chance;

    // Determine outcome
    let outcome: CrimeOutcomeId;
    if (detected) {
      outcome = "detected";
    } else {
      outcome = "successful_completion";
    }

    const id = uid("crime");
    const summary = def.label;
    const record: CrimeIncidentRecord = {
      incident_id: id,
      crime_definition_id: def.id,
      category: def.category,
      severity: def.severity,
      status: "created",
      description: params.description ?? `${def.label} incident.`,
      summary,
      location_id: params.location_id ?? null,
      state_id: params.state_id ?? null,
      value_involved: value,
      perpetrator_character_id: params.perpetrator_character_id,
      victim_character_id: params.victim_character_id ?? null,
      victim_property_id: params.victim_property_id ?? null,
      victim_business_id: params.victim_business_id ?? null,
      police_incident_id: null,
      police_investigation_id: null,
      justice_case_id: null,
      evidence_ids: [],
      witness_character_ids: [],
      participant_character_ids: [],
      detection_roll: detectionRoll,
      detected,
      outcome,
      outcome_reason: detected ? "Detected during the act." : null,
      financial_loss: detected ? value : 0,
      financial_recovery: 0,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      reported_at: null,
      resolved_at: null,
      resolved_world_date: null,
      closed_at: null,
      closed_world_date: null,
      updated_at: new Date().toISOString(),
    };
    this.maps.crimeIncidents[id] = record;

    // Add perpetrator as participant
    const partId = uid("crimpart");
    this.maps.crimeParticipations[partId] = {
      participation_id: partId, incident_id: id,
      character_id: params.perpetrator_character_id,
      role: "suspect", is_npc: false, npc_id: null,
      description: "Perpetrator", added_at: new Date().toISOString(),
      added_world_date: { ...worldDate }, updated_at: new Date().toISOString(),
    };

    // If detected, auto-generate evidence and add victim as witness
    if (detected) {
      const evId = uid("crimeev");
      this.maps.crimeEvidence[evId] = {
        evidence_id: evId, incident_id: id, police_evidence_id: null,
        evidence_type: "incident_observations",
        source_description: `Observations at location during ${def.label}.`,
        source_reference: null, collected_by: null,
        collected_at: new Date().toISOString(), collected_world_date: { ...worldDate },
        integrity_status: "unverified",
        chain_of_custody: [{ actor: "system", event: "auto-generated", date: new Date().toISOString() }],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      record.evidence_ids = [evId];
    }

    // Update notoriety
    this.updateNotoriety(params.perpetrator_character_id, detected, def.severity, worldDate);

    // Update reputation
    // Note: reputation is managed through the life system; we record the impact
    this.audit("crime_action", {
      incident_id: id, character_id: params.perpetrator_character_id,
      actor_character_id: params.perpetrator_character_id,
      summary: `Crime action resolved: ${def.id} — ${detected ? "detected" : "undetected"}`,
      details: { value, outcome, detection_roll: detectionRoll, category: def.category },
    }, worldDate);

    return { incident: record, detected, value_gained: detected ? 0 : value, outcome };
  }

  // ─── Incident lifecycle ───────────────────────────────────────

  reportCrime(incidentId: string, reporterCharacterId: string | null, description: string, worldDate: CalendarDate): CrimeReportRecord {
    const inc = this.maps.crimeIncidents[incidentId];
    if (!inc) throw new Error("crime_incident_not_found");
    if (inc.status !== "created") throw new Error("crime_incident_not_reportable");

    // Create report
    const id = uid("crimerep");
    const report: CrimeReportRecord = {
      report_id: id, incident_id: incidentId,
      reporter_character_id: reporterCharacterId, reporter_is_npc: false,
      description, submitted_at: new Date().toISOString(),
      submitted_world_date: { ...worldDate },
      status: "submitted", reviewed_by: null, reviewed_at: null, review_notes: null,
      updated_at: new Date().toISOString(),
    };
    this.maps.crimeReports[id] = report;

    // Transition incident
    inc.status = "reported";
    inc.reported_at = new Date().toISOString();
    inc.updated_at = new Date().toISOString();
    this.audit("report", { incident_id: incidentId, ...(reporterCharacterId ? { actor_character_id: reporterCharacterId } : {}), summary: `Crime reported` }, worldDate);
    return report;
  }

  transitionIncident(incidentId: string, newStatus: CrimeIncidentStatusId, reason: string | null, worldDate: CalendarDate): CrimeIncidentRecord {
    const inc = this.maps.crimeIncidents[incidentId];
    if (!inc) throw new Error("crime_incident_not_found");
    if (!this.catalog.isValidTransition(inc.status, newStatus)) {
      throw new Error("crime_invalid_transition");
    }

    const oldStatus = inc.status;
    inc.status = newStatus;
    inc.updated_at = new Date().toISOString();

    if (newStatus === "resolved") {
      inc.resolved_at = new Date().toISOString();
      inc.resolved_world_date = { ...worldDate };
    }
    if (newStatus === "closed") {
      inc.closed_at = new Date().toISOString();
      inc.closed_world_date = { ...worldDate };
    }

    this.audit("transition", { incident_id: incidentId, summary: `Status: ${oldStatus} → ${newStatus}`, details: { reason } }, worldDate);
    return inc;
  }

  // ─── Participation ────────────────────────────────────────────

  addParticipant(incidentId: string, characterId: string, role: ParticipantRoleId, description: string, worldDate: CalendarDate): CrimeParticipationRecord {
    const inc = this.maps.crimeIncidents[incidentId];
    if (!inc) throw new Error("crime_incident_not_found");

    const id = uid("crimpart");
    const record: CrimeParticipationRecord = {
      participation_id: id, incident_id: incidentId,
      character_id: characterId, role, is_npc: false, npc_id: null,
      description, added_at: new Date().toISOString(),
      added_world_date: { ...worldDate }, updated_at: new Date().toISOString(),
    };
    this.maps.crimeParticipations[id] = record;
    return record;
  }

  // ─── Evidence ─────────────────────────────────────────────────

  addEvidence(incidentId: string, evidenceType: string, sourceDescription: string, sourceReference: string | null, collectedBy: string | null, worldDate: CalendarDate): CrimeEvidenceRecord {
    const inc = this.maps.crimeIncidents[incidentId];
    if (!inc) throw new Error("crime_incident_not_found");
    if (inc.evidence_ids.length >= this.catalog.getRules().max_evidence_per_incident) throw new Error("crime_max_evidence");

    const id = uid("crimeev");
    const record: CrimeEvidenceRecord = {
      evidence_id: id, incident_id: incidentId, police_evidence_id: null,
      evidence_type: evidenceType, source_description: sourceDescription,
      source_reference: sourceReference, collected_by: collectedBy,
      collected_at: new Date().toISOString(), collected_world_date: { ...worldDate },
      integrity_status: "unverified",
      chain_of_custody: [{ actor: collectedBy ?? "system", event: "collected", date: new Date().toISOString() }],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    this.maps.crimeEvidence[id] = record;
    inc.evidence_ids = [...inc.evidence_ids, id];
    inc.updated_at = new Date().toISOString();
    return record;
  }

  // ─── Police & Justice integration ─────────────────────────────

  linkToPoliceIncident(crimeIncidentId: string, policeIncidentId: string): void {
    const inc = this.maps.crimeIncidents[crimeIncidentId];
    if (!inc) throw new Error("crime_incident_not_found");
    inc.police_incident_id = policeIncidentId;
    inc.updated_at = new Date().toISOString();
  }

  linkToPoliceInvestigation(crimeIncidentId: string, investigationId: string): void {
    const inc = this.maps.crimeIncidents[crimeIncidentId];
    if (!inc) throw new Error("crime_incident_not_found");
    inc.police_investigation_id = investigationId;
    if (inc.status === "reported" || inc.status === "under_review") {
      inc.status = "investigation_open";
    }
    inc.updated_at = new Date().toISOString();
  }

  linkToJusticeCase(crimeIncidentId: string, caseId: string): void {
    const inc = this.maps.crimeIncidents[crimeIncidentId];
    if (!inc) throw new Error("crime_incident_not_found");
    inc.justice_case_id = caseId;
    if (inc.status === "investigation_open" || inc.status === "under_review") {
      inc.status = "referred_to_court";
    }
    inc.updated_at = new Date().toISOString();
  }

  // ─── Criminal records ─────────────────────────────────────────

  createCriminalRecord(params: {
    character_id: string;
    incident_id: string;
    justice_case_id?: string | null;
    category: CrimeCategoryId;
    severity: CrimeSeverityId;
    conviction: boolean;
    outcome: CrimeOutcomeId | null;
    penalty_description?: string | null;
    fine_amount?: number;
    restitution_amount?: number;
  }, worldDate: CalendarDate): CriminalRecord {
    const id = uid("criminal");
    const consequenceRules = this.catalog.getConsequenceRules();
    const expiryDate = { year: worldDate.year + consequenceRules.criminal_record_retention_years, month: worldDate.month, day: worldDate.day };

    const record: CriminalRecord = {
      record_id: id,
      character_id: params.character_id,
      incident_id: params.incident_id,
      justice_case_id: params.justice_case_id ?? null,
      category: params.category,
      severity: params.severity,
      conviction: params.conviction,
      outcome: params.outcome,
      conviction_date: params.conviction ? new Date().toISOString() : null,
      conviction_world_date: params.conviction ? { ...worldDate } : null,
      penalty_description: params.penalty_description ?? null,
      fine_amount: params.fine_amount ?? 0,
      fine_paid: false,
      restitution_amount: params.restitution_amount ?? 0,
      restitution_paid: false,
      record_expiry_date: new Date(expiryDate.year, expiryDate.month - 1, expiryDate.day).toISOString(),
      record_expiry_world_date: expiryDate,
      sealed: false,
      created_at: new Date().toISOString(),
      created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.criminalRecords[id] = record;
    this.audit("criminal_record", { character_id: params.character_id, incident_id: params.incident_id, summary: `Criminal record ${params.conviction ? "conviction" : "created"}: ${params.category}` }, worldDate);
    return record;
  }

  // ─── Restitution ──────────────────────────────────────────────

  createRestitution(incidentId: string, creditorCharacterId: string, debtorCharacterId: string, amount: number, worldDate: CalendarDate): CrimeRestitutionRecord {
    const id = uid("restit");
    const record: CrimeRestitutionRecord = {
      restitution_id: id, incident_id: incidentId,
      creditor_character_id: creditorCharacterId, debtor_character_id: debtorCharacterId,
      amount, paid: false, paid_at: null, paid_world_date: null, transaction_id: null,
      created_at: new Date().toISOString(), created_world_date: { ...worldDate },
      updated_at: new Date().toISOString(),
    };
    this.maps.crimeRestitution[id] = record;
    return record;
  }

  markRestitutionPaid(restitutionId: string, transactionId: string, worldDate: CalendarDate): CrimeRestitutionRecord {
    const r = this.maps.crimeRestitution[restitutionId];
    if (!r) throw new Error("crime_restitution_not_found");
    if (r.paid) throw new Error("crime_restitution_already_paid");
    r.paid = true;
    r.paid_at = new Date().toISOString();
    r.paid_world_date = { ...worldDate };
    r.transaction_id = transactionId;
    r.updated_at = new Date().toISOString();
    return r;
  }

  // ─── Rehabilitation ──────────────────────────────────────────

  startRehabilitation(params: { character_id: string; criminal_record_id?: string | null; activity_type: string; duration_days: number }, worldDate: CalendarDate): CrimeRehabilitationRecord {
    const rules = this.catalog.getRules();
    if (params.duration_days < rules.rehabilitation_min_days || params.duration_days > rules.rehabilitation_max_days) throw new Error("crime_rehabilitation_duration_invalid");

    const id = uid("rehab");
    const targetDate = { year: worldDate.year, month: worldDate.month, day: worldDate.day + params.duration_days };
    // Normalize date
    const target = new Date(Date.UTC(worldDate.year, worldDate.month - 1, worldDate.day + params.duration_days));
    const targetWorldDate: CalendarDate = { year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() };

    const record: CrimeRehabilitationRecord = {
      rehabilitation_id: id,
      character_id: params.character_id,
      criminal_record_id: params.criminal_record_id ?? null,
      activity_type: params.activity_type,
      start_date: new Date().toISOString(),
      start_world_date: { ...worldDate },
      target_completion_date: new Date(targetWorldDate.year, targetWorldDate.month - 1, targetWorldDate.day).toISOString(),
      target_completion_world_date: targetWorldDate,
      actual_completion_date: null,
      actual_completion_world_date: null,
      status: "in_progress",
      reputation_recovery: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.maps.crimeRehabilitation[id] = record;
    return record;
  }

  completeRehabilitation(rehabId: string, worldDate: CalendarDate): CrimeRehabilitationRecord {
    const r = this.maps.crimeRehabilitation[rehabId];
    if (!r) throw new Error("crime_rehabilitation_not_found");
    if (r.status !== "in_progress") throw new Error("crime_rehabilitation_not_active");
    r.status = "completed";
    r.actual_completion_date = new Date().toISOString();
    r.actual_completion_world_date = { ...worldDate };
    const days = daysBetween(r.start_world_date, worldDate);
    r.reputation_recovery = days * this.catalog.getConsequenceRules().rehabilitation_reputation_recovery_per_day;
    r.updated_at = new Date().toISOString();
    return r;
  }

  // ─── Notoriety ────────────────────────────────────────────────

  getNotoriety(characterId: string): CrimeNotorietyRecord | null {
    return this.maps.crimeNotoriety[characterId] ?? null;
  }

  private updateNotoriety(characterId: string, detected: boolean, severity: CrimeSeverityId, worldDate: CalendarDate): void {
    if (!detected) return;
    const existing = this.maps.crimeNotoriety[characterId] ?? {
      character_id: characterId, notoriety_score: 0, last_updated: new Date().toISOString(),
      last_updated_world_date: { ...worldDate }, incidents_involved: 0, convictions: 0,
      active_wanted_status: false, updated_at: new Date().toISOString(),
    };
    const severityMultiplier: Record<CrimeSeverityId, number> = { minor: 0.05, moderate: 0.1, serious: 0.2, severe: 0.35 };
    existing.notoriety_score = Math.min(1, existing.notoriety_score + (severityMultiplier[severity] ?? 0.05));
    existing.incidents_involved++;
    existing.last_updated = new Date().toISOString();
    existing.last_updated_world_date = { ...worldDate };
    existing.updated_at = new Date().toISOString();
    this.maps.crimeNotoriety[characterId] = existing;
  }

  decayNotoriety(characterId: string, worldDate: CalendarDate): CrimeNotorietyRecord | null {
    const record = this.maps.crimeNotoriety[characterId];
    if (!record) return null;
    const days = daysBetween(record.last_updated_world_date, worldDate);
    if (days <= 0) return record;
    const decayRate = this.catalog.getRules().notoriety_decay_rate_per_day;
    record.notoriety_score = Math.max(0, record.notoriety_score - (days * decayRate));
    record.last_updated = new Date().toISOString();
    record.last_updated_world_date = { ...worldDate };
    record.updated_at = new Date().toISOString();
    return record;
  }

  // ─── Queries ──────────────────────────────────────────────────

  getIncident(incidentId: string): CrimeIncidentRecord | undefined {
    return this.maps.crimeIncidents[incidentId];
  }

  listIncidents(perpetratorId?: string, victimId?: string, status?: CrimeIncidentStatusId): readonly CrimeIncidentRecord[] {
    let results = Object.values(this.maps.crimeIncidents);
    if (perpetratorId) results = results.filter((i) => i.perpetrator_character_id === perpetratorId);
    if (victimId) results = results.filter((i) => i.victim_character_id === victimId);
    if (status) results = results.filter((i) => i.status === status);
    return results;
  }

  getCriminalRecords(characterId: string): readonly CriminalRecord[] {
    return Object.values(this.maps.criminalRecords).filter((r) => r.character_id === characterId);
  }

  getRestitutions(characterId: string): readonly CrimeRestitutionRecord[] {
    return Object.values(this.maps.crimeRestitution).filter((r) => r.debtor_character_id === characterId);
  }

  getActiveRehabilitation(characterId: string): CrimeRehabilitationRecord | null {
    return Object.values(this.maps.crimeRehabilitation).find(
      (r) => r.character_id === characterId && r.status === "in_progress"
    ) ?? null;
  }

  listAudits(incidentId?: string, characterId?: string): readonly CrimeAuditRecord[] {
    let results = Object.values(this.maps.crimeAudits);
    if (incidentId) results = results.filter((a) => a.incident_id === incidentId);
    if (characterId) results = results.filter((a) => a.character_id === characterId);
    return results;
  }

  // ─── Profile ──────────────────────────────────────────────────

  getCriminalProfile(characterId: string): CriminalProfileSnapshot {
    const records = this.getCriminalRecords(characterId);
    const incidents = this.listIncidents(characterId);
    const activeIncidents = incidents.filter((i) => i.status !== "closed" && i.status !== "resolved");
    const convictions = records.filter((r) => r.conviction);
    const notoriety = this.maps.crimeNotoriety[characterId];
    const outstandingFines = records.filter((r) => r.fine_amount > 0 && !r.fine_paid).reduce((sum, r) => sum + r.fine_amount, 0);
    const outstandingRestitution = this.getRestitutions(characterId).filter((r) => !r.paid).reduce((sum, r) => sum + r.amount, 0);
    const activeRehab = this.getActiveRehabilitation(characterId);

    return {
      character_id: characterId,
      has_criminal_record: records.length > 0,
      notoriety_score: notoriety?.notoriety_score ?? 0,
      criminal_records_count: records.length,
      convictions_count: convictions.length,
      active_incidents_count: activeIncidents.length,
      outstanding_fines: outstandingFines,
      outstanding_restitution: outstandingRestitution,
      active_rehabilitation: activeRehab !== null,
      recent_incidents: incidents.slice(-5).map((i) => this.toIncidentSnapshot(i)),
      criminal_records: records.slice(-10).map((r) => ({
        record_id: r.record_id, category: r.category, severity: r.severity, conviction: r.conviction, created_at: r.created_at,
      })),
    };
  }

  private toIncidentSnapshot(i: CrimeIncidentRecord): CrimeIncidentSnapshot {
    return {
      incident_id: i.incident_id, category: i.category, severity: i.severity,
      status: i.status, summary: i.summary, perpetrator_character_id: i.perpetrator_character_id,
      victim_character_id: i.victim_character_id, detected: i.detected, outcome: i.outcome,
      financial_loss: i.financial_loss, created_at: i.created_at, resolved_at: i.resolved_at,
    };
  }
}

export function crimeErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    crime_definition_not_found: "Crime type not found.",
    crime_age_ineligible: "Character does not meet minimum age requirement.",
    crime_victim_cooldown: "Cannot target this victim again so soon.",
    crime_daily_limit_reached: "Daily crime action limit reached.",
    crime_severity_not_found: "Crime severity configuration error.",
    crime_incident_not_found: "Crime incident not found.",
    crime_incident_not_reportable: "Incident is not in a reportable state.",
    crime_invalid_transition: "Invalid incident status transition.",
    crime_max_evidence: "Maximum evidence per incident reached.",
    crime_restitution_not_found: "Restitution record not found.",
    crime_restitution_already_paid: "Restitution has already been paid.",
    crime_rehabilitation_not_found: "Rehabilitation record not found.",
    crime_rehabilitation_not_active: "Rehabilitation is not active.",
    crime_rehabilitation_duration_invalid: "Rehabilitation duration is outside allowed range.",
  };
  return messages[code] ?? "An unexpected crime system error occurred.";
}
