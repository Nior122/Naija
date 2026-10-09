/**
 * Stage 12 — Laws, Courts and Justice System
 *
 * Core service for laws, courts, cases, evidence, hearings, judgments,
 * appeals, fines, legal professionals, legislative proposals, and audit.
 */

import { randomUUID } from "node:crypto";
import type { PersistentWorldState } from "../multiplayer/types.js";
import type { CalendarDate } from "../life/types.js";
import type {
  JusticeCatalog,
  LawRecord,
  LawProvisionRecord,
  LegislativeProposalRecord,
  CourtRecord,
  LegalProfessionalRecord,
  CaseRecord,
  CaseParticipantRecord,
  EvidenceRecord,
  HearingRecord,
  JudgmentRecord,
  FineRecord,
  AppealRecord,
  LegalAuditRecord,
  LawCategoryId,
  LawStatusId,
  CaseCategoryId,
  CaseStatusId,
  JudgmentOutcomeId,
  AppealOutcomeId,
  LegalProfessionalRoleId,
  LawSnapshot,
  CourtSnapshot,
  CaseSnapshot,
  LegalProfileSnapshot,
} from "./types.js";
import { loadJusticeCatalog } from "./catalog.js";

// ─── Helpers ──────────────────────────────────────────────────────

function cloneDate(d: CalendarDate): CalendarDate {
  return { year: d.year, month: d.month, day: d.day };
}

function characterForId(state: PersistentWorldState, characterId: string) {
  return Object.values(state.players).find((p) => p.character.character_id === characterId) ?? null;
}

function appendJusticeAudit(
  state: PersistentWorldState,
  category: string,
  lawId: string | null,
  proposalId: string | null,
  caseId: string | null,
  judgmentId: string | null,
  appealId: string | null,
  actorId: string | null,
  summary: string,
  date: CalendarDate,
  now: number,
  details: Record<string, string | number | boolean | null> = {},
): LegalAuditRecord {
  const record: LegalAuditRecord = {
    audit_id: `lga-${randomUUID()}`,
    category,
    law_id: lawId,
    proposal_id: proposalId,
    case_id: caseId,
    judgment_id: judgmentId,
    appeal_id: appealId,
    actor_character_id: actorId,
    summary,
    details,
    created_at: new Date(now).toISOString(),
    created_world_date: cloneDate(date),
  };
  state.legalAudits[record.audit_id] = record;
  return record;
}

function generateCaseNumber(state: PersistentWorldState, courtId: string, date: CalendarDate): string {
  const year = date.year;
  const existingCount = Object.values(state.cases).filter((c) => c.court_id === courtId && c.filing_date.startsWith(String(year))).length;
  return `${year}/${courtId.slice(-4).toUpperCase()}/${String(existingCount + 1).padStart(4, "0")}`;
}

// ─── Initialization & Seeding ─────────────────────────────────────

export function initializeJusticeWorldState(state: PersistentWorldState): void {
  if (!state.laws) state.laws = {};
  if (!state.lawProvisions) state.lawProvisions = {};
  if (!state.legislativeProposals) state.legislativeProposals = {};
  if (!state.courts) state.courts = {};
  if (!state.legalProfessionals) state.legalProfessionals = {};
  if (!state.legalRepresentations) state.legalRepresentations = {};
  if (!state.cases) state.cases = {};
  if (!state.caseParticipants) state.caseParticipants = {};
  if (!state.evidence) state.evidence = {};
  if (!state.witnesses) state.witnesses = {};
  if (!state.hearings) state.hearings = {};
  if (!state.judgments) state.judgments = {};
  if (!state.sentences) state.sentences = {};
  if (!state.fines) state.fines = {};
  if (!state.settlements) state.settlements = {};
  if (!state.appeals) state.appeals = {};
  if (!state.legalAudits) state.legalAudits = {};
}

export function seedJusticeWorld(
  state: PersistentWorldState,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): { laws: number; courts: number } {
  const timestamp = new Date(now).toISOString();
  let lawsSeeded = 0;
  let courtsSeeded = 0;

  for (const seed of catalog.seed_laws) {
    if (state.laws[seed.id]) continue;
    const law: LawRecord = {
      law_id: seed.id,
      title: seed.title,
      short_reference: seed.short_reference,
      description: seed.description,
      category: seed.category,
      jurisdiction: seed.jurisdiction,
      applicable_state_id: seed.applicable_state_id ?? null,
      enacted_by: null,
      status: seed.status,
      version: seed.version,
      enactment_date: seed.enactment_date,
      effective_date: seed.effective_date,
      expiration_date: null,
      parent_law_id: null,
      related_law_ids: [],
      public_explanation: seed.public_explanation,
      source_reference: null,
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
    };
    state.laws[law.law_id] = law;
    for (const prov of seed.provisions) {
      const provId = `${seed.id}:s${prov.section}`;
      if (state.lawProvisions[provId]) continue;
      const provision: LawProvisionRecord = {
        provision_id: provId,
        law_id: seed.id,
        section: prov.section,
        title: prov.title,
        description: prov.description,
        effective_from: seed.effective_date,
        effective_until: null,
        penalty_type: null,
        penalty_min_amount_ngn: null,
        penalty_max_amount_ngn: null,
        status: "active",
        created_at: timestamp,
        updated_at: timestamp,
      };
      state.lawProvisions[provId] = provision;
    }
    lawsSeeded++;
  }

  for (const seed of catalog.seed_courts) {
    if (state.courts[seed.id]) continue;
    const court: CourtRecord = {
      court_id: seed.id,
      name: seed.name,
      level: seed.level as CourtRecord["level"],
      jurisdiction: seed.jurisdiction,
      applicable_jurisdiction_id: seed.applicable_jurisdiction_id ?? null,
      superior_court_id: determineSuperiorCourt(seed.level),
      permitted_categories: [...seed.permitted_categories],
      status: seed.status as CourtRecord["status"],
      assigned_judge_ids: [],
      created_at: timestamp,
      created_world_date: cloneDate(date),
      updated_at: timestamp,
    };
    state.courts[court.court_id] = court;
    courtsSeeded++;
  }

  return { laws: lawsSeeded, courts: courtsSeeded };
}

function determineSuperiorCourt(level: string): string | null {
  const hierarchy: Record<string, string | null> = {
    "customary": "court:state-high-fct",
    "magistrate": "court:state-high-fct",
    "state_high": "court:appeal-federal",
    "federal_high": "court:appeal-federal",
    "national_industrial": "court:appeal-federal",
    "tribunal": "court:state-high-fct",
    "court_of_appeal": "court:supreme",
    "supreme": null,
  };
  return hierarchy[level] ?? null;
}

// ─── Laws ─────────────────────────────────────────────────────────

export function createLaw(
  state: PersistentWorldState,
  title: string,
  shortReference: string,
  description: string,
  category: LawCategoryId,
  jurisdiction: string,
  applicableStateId: string | null,
  publicExplanation: string,
  enactDate: string,
  effectiveDate: string,
  enactedBy: string | null,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): LawRecord {
  if (title.trim().length > catalog.rules.law_title_max_length) throw new Error("justice_law_title_too_long");
  if (description.trim().length > catalog.rules.law_description_max_length) throw new Error("justice_law_description_too_long");

  const timestamp = new Date(now).toISOString();
  const law: LawRecord = {
    law_id: `law-${randomUUID()}`,
    title: title.trim(),
    short_reference: shortReference.trim(),
    description: description.trim(),
    category,
    jurisdiction,
    applicable_state_id: applicableStateId,
    enacted_by: enactedBy,
    status: "draft",
    version: 1,
    enactment_date: enactDate,
    effective_date: effectiveDate,
    expiration_date: null,
    parent_law_id: null,
    related_law_ids: [],
    public_explanation: publicExplanation.trim(),
    source_reference: null,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.laws[law.law_id] = law;
  appendJusticeAudit(state, "law_created", law.law_id, null, null, null, null, enactedBy, `Law created: ${law.title}`, date, now, { category, jurisdiction });
  return law;
}

export function updateLawStatus(
  state: PersistentWorldState,
  lawId: string,
  newStatus: LawStatusId,
  authorizedBy: string,
  date: CalendarDate,
  now: number,
): LawRecord {
  const law = state.laws[lawId];
  if (!law) throw new Error("justice_law_not_found");
  const validTransitions: Record<LawStatusId, LawStatusId[]> = {
    "draft": ["proposed", "rejected", "archived"],
    "proposed": ["under_review", "approved", "rejected", "withdrawn" as LawStatusId],
    "under_review": ["approved", "rejected"],
    "approved": ["enacted"],
    "enacted": ["in_force", "suspended", "amended", "repealed"],
    "in_force": ["suspended", "amended", "repealed"],
    "suspended": ["in_force", "repealed"],
    "amended": ["in_force", "repealed"],
    "repealed": ["archived"],
    "rejected": ["proposed", "archived"],
    "archived": [],
  };
  const allowed = validTransitions[law.status];
  if (!allowed.includes(newStatus)) throw new Error("justice_law_status_transition_invalid");

  const timestamp = new Date(now).toISOString();
  law.status = newStatus;
  law.updated_at = timestamp;
  appendJusticeAudit(state, "law_status_changed", law.law_id, null, null, null, null, authorizedBy, `Law status changed to ${newStatus}.`, date, now, { old_status: law.status, new_status: newStatus });
  return law;
}

export function amendLaw(
  state: PersistentWorldState,
  originalLawId: string,
  newTitle: string | null,
  newDescription: string | null,
  newPublicExplanation: string | null,
  amendingAuthority: string,
  date: CalendarDate,
  now: number,
): LawRecord {
  const original = state.laws[originalLawId];
  if (!original) throw new Error("justice_law_not_found");
  if (original.status !== "in_force" && original.status !== "enacted") throw new Error("justice_law_not_amendable");

  const timestamp = new Date(now).toISOString();
  const amended: LawRecord = {
    law_id: `law-${randomUUID()}`,
    title: (newTitle ?? original.title).trim(),
    short_reference: original.short_reference,
    description: (newDescription ?? original.description).trim(),
    category: original.category,
    jurisdiction: original.jurisdiction,
    applicable_state_id: original.applicable_state_id,
    enacted_by: amendingAuthority,
    status: original.status,
    version: original.version + 1,
    enactment_date: original.enactment_date,
    effective_date: timestamp.slice(0, 10),
    expiration_date: original.expiration_date,
    parent_law_id: originalLawId,
    related_law_ids: [...original.related_law_ids, originalLawId],
    public_explanation: (newPublicExplanation ?? original.public_explanation).trim(),
    source_reference: `amendment_of:${originalLawId}`,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.laws[amended.law_id] = amended;

  original.status = "amended";
  original.updated_at = timestamp;

  appendJusticeAudit(state, "law_amended", amended.law_id, null, null, null, null, amendingAuthority, `Law amended from ${originalLawId}.`, date, now, { original_law_id: originalLawId });
  return amended;
}

export function addLawProvision(
  state: PersistentWorldState,
  lawId: string,
  section: string,
  title: string,
  description: string,
  effectiveFrom: string,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): LawProvisionRecord {
  const law = state.laws[lawId];
  if (!law) throw new Error("justice_law_not_found");

  const existingCount = Object.values(state.lawProvisions).filter((p) => p.law_id === lawId).length;
  if (existingCount >= catalog.rules.max_provisions_per_law) throw new Error("justice_provision_limit_reached");

  const timestamp = new Date(now).toISOString();
  const provision: LawProvisionRecord = {
    provision_id: `prov-${randomUUID()}`,
    law_id: lawId,
    section: section.trim(),
    title: title.trim(),
    description: description.trim(),
    effective_from: effectiveFrom,
    effective_until: null,
    penalty_type: null,
    penalty_min_amount_ngn: null,
    penalty_max_amount_ngn: null,
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.lawProvisions[provision.provision_id] = provision;
  void date;
  return provision;
}

export function getActiveLaws(state: PersistentWorldState, jurisdiction?: string, category?: LawCategoryId, asOfDate?: string): LawSnapshot[] {
  let laws = Object.values(state.laws).filter((l) => l.status === "in_force" || l.status === "enacted");
  if (jurisdiction) laws = laws.filter((l) => l.jurisdiction === jurisdiction || l.jurisdiction === "federal");
  if (category) laws = laws.filter((l) => l.category === category);
  if (asOfDate) laws = laws.filter((l) => l.effective_date <= asOfDate && (!l.expiration_date || l.expiration_date > asOfDate));
  return laws.map((l) => {
    const provCount = Object.values(state.lawProvisions).filter((p) => p.law_id === l.law_id && p.status === "active").length;
    return {
      law_id: l.law_id,
      title: l.title,
      short_reference: l.short_reference,
      description: l.description,
      category: l.category,
      jurisdiction: l.jurisdiction,
      applicable_state_id: l.applicable_state_id,
      status: l.status,
      version: l.version,
      enactment_date: l.enactment_date,
      effective_date: l.effective_date,
      public_explanation: l.public_explanation,
      provision_count: provCount,
    };
  });
}

// ─── Legislative Proposals ────────────────────────────────────────

export function createLegislativeProposal(
  state: PersistentWorldState,
  title: string,
  description: string,
  purpose: string,
  sponsorCharacterId: string,
  jurisdiction: string,
  applicableStateId: string | null,
  provisions: Array<{ section: string; title: string; description: string }>,
  supportingExplanation: string,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): LegislativeProposalRecord {
  const player = characterForId(state, sponsorCharacterId);
  if (!player) throw new Error("justice_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("justice_character_deceased");
  if (player.character.age < catalog.rules.minimum_filing_age) throw new Error("justice_age_ineligible");

  if (title.trim().length > catalog.rules.law_title_max_length) throw new Error("justice_law_title_too_long");

  const timestamp = new Date(now).toISOString();
  const proposal: LegislativeProposalRecord = {
    proposal_id: `prop-${randomUUID()}`,
    title: title.trim(),
    description: description.trim(),
    purpose: purpose.trim(),
    proposed_law_id: null,
    sponsor_character_id: sponsorCharacterId,
    sponsor_office_id: null,
    jurisdiction,
    applicable_state_id: applicableStateId,
    status: "draft",
    provisions: provisions.map((p) => ({ section: p.section.trim(), title: p.title.trim(), description: p.description.trim() })),
    supporting_explanation: supportingExplanation.trim(),
    submission_date: null,
    submission_world_date: null,
    decision_date: null,
    decision_world_date: null,
    decision_reason: null,
    revision_history: [],
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.legislativeProposals[proposal.proposal_id] = proposal;
  appendJusticeAudit(state, "proposal_created", null, proposal.proposal_id, null, null, null, sponsorCharacterId, `Legislative proposal created: ${proposal.title}`, date, now);
  return proposal;
}

export function submitProposal(
  state: PersistentWorldState,
  proposalId: string,
  submittedBy: string,
  date: CalendarDate,
  now: number,
): LegislativeProposalRecord {
  const proposal = state.legislativeProposals[proposalId];
  if (!proposal) throw new Error("justice_proposal_not_found");
  if (proposal.status !== "draft") throw new Error("justice_proposal_not_draft");
  if (proposal.sponsor_character_id !== submittedBy) throw new Error("justice_not_proposal_sponsor");

  const timestamp = new Date(now).toISOString();
  proposal.status = "submitted";
  proposal.submission_date = timestamp;
  proposal.submission_world_date = cloneDate(date);
  proposal.updated_at = timestamp;
  appendJusticeAudit(state, "proposal_submitted", null, proposalId, null, null, null, submittedBy, `Proposal submitted: ${proposal.title}`, date, now);
  return proposal;
}

export function approveProposal(
  state: PersistentWorldState,
  proposalId: string,
  approvedBy: string,
  decisionReason: string,
  date: CalendarDate,
  now: number,
): { proposal: LegislativeProposalRecord; law: LawRecord } {
  const proposal = state.legislativeProposals[proposalId];
  if (!proposal) throw new Error("justice_proposal_not_found");
  if (proposal.status !== "submitted" && proposal.status !== "under_review") throw new Error("justice_proposal_not_pending");

  const timestamp = new Date(now).toISOString();
  proposal.status = "approved";
  proposal.decision_date = timestamp;
  proposal.decision_world_date = cloneDate(date);
  proposal.decision_reason = decisionReason.trim();
  proposal.updated_at = timestamp;

  const catalog = loadJusticeCatalog();
  const law = createLaw(
    state,
    proposal.title,
    proposal.title.slice(0, 30),
    proposal.description,
    "other" as LawCategoryId,
    proposal.jurisdiction,
    proposal.applicable_state_id,
    proposal.supporting_explanation,
    timestamp.slice(0, 10),
    timestamp.slice(0, 10),
    approvedBy,
    date,
    now,
    catalog,
  );
  law.status = "enacted";
  proposal.proposed_law_id = law.law_id;

  appendJusticeAudit(state, "proposal_approved", law.law_id, proposalId, null, null, null, approvedBy, `Proposal approved and law enacted.`, date, now);
  return { proposal, law };
}

export function rejectProposal(
  state: PersistentWorldState,
  proposalId: string,
  rejectedBy: string,
  reason: string,
  date: CalendarDate,
  now: number,
): LegislativeProposalRecord {
  const proposal = state.legislativeProposals[proposalId];
  if (!proposal) throw new Error("justice_proposal_not_found");
  if (proposal.status !== "submitted" && proposal.status !== "under_review") throw new Error("justice_proposal_not_pending");

  const timestamp = new Date(now).toISOString();
  proposal.status = "rejected";
  proposal.decision_date = timestamp;
  proposal.decision_world_date = cloneDate(date);
  proposal.decision_reason = reason.trim();
  proposal.updated_at = timestamp;
  appendJusticeAudit(state, "proposal_rejected", null, proposalId, null, null, null, rejectedBy, `Proposal rejected: ${reason}`, date, now);
  return proposal;
}

// ─── Courts ───────────────────────────────────────────────────────

export function getCourt(state: PersistentWorldState, courtId: string): CourtSnapshot | null {
  const court = state.courts[courtId];
  if (!court) return null;
  const activeCases = Object.values(state.cases).filter((c) => c.court_id === courtId && c.status !== "closed" && c.status !== "dismissed").length;
  return {
    court_id: court.court_id,
    name: court.name,
    level: court.level,
    jurisdiction: court.jurisdiction,
    applicable_jurisdiction_id: court.applicable_jurisdiction_id,
    status: court.status,
    permitted_categories: court.permitted_categories,
    assigned_judge_count: court.assigned_judge_ids.length,
    active_case_count: activeCases,
  };
}

export function listCourts(state: PersistentWorldState, jurisdiction?: string): CourtSnapshot[] {
  let courts = Object.values(state.courts).filter((c) => c.status === "active");
  if (jurisdiction) courts = courts.filter((c) => c.jurisdiction === jurisdiction || c.applicable_jurisdiction_id === jurisdiction);
  return courts.map((c) => {
    const activeCases = Object.values(state.cases).filter((cs) => cs.court_id === c.court_id && cs.status !== "closed" && cs.status !== "dismissed").length;
    return {
      court_id: c.court_id,
      name: c.name,
      level: c.level,
      jurisdiction: c.jurisdiction,
      applicable_jurisdiction_id: c.applicable_jurisdiction_id,
      status: c.status,
      permitted_categories: c.permitted_categories,
      assigned_judge_count: c.assigned_judge_ids.length,
      active_case_count: activeCases,
    };
  });
}

export function assignJudgeToCourt(
  state: PersistentWorldState,
  courtId: string,
  judgeCharacterId: string,
  professionalId: string,
  date: CalendarDate,
  now: number,
): void {
  const court = state.courts[courtId];
  if (!court) throw new Error("justice_court_not_found");
  const pro = state.legalProfessionals[professionalId];
  if (!pro) throw new Error("justice_professional_not_found");
  if (pro.character_id !== judgeCharacterId) throw new Error("justice_professional_mismatch");
  if (pro.role !== "judge" && pro.role !== "magistrate") throw new Error("justice_not_judge_role");

  if (!court.assigned_judge_ids.includes(judgeCharacterId)) {
    court.assigned_judge_ids.push(judgeCharacterId);
    pro.court_id = courtId;
    pro.updated_at = new Date(now).toISOString();
  }
  void date;
}

// ─── Legal Professionals ──────────────────────────────────────────

export function appointLegalProfessional(
  state: PersistentWorldState,
  characterId: string,
  role: LegalProfessionalRoleId,
  qualifications: string[],
  appointedBy: string,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): LegalProfessionalRecord {
  const player = characterForId(state, characterId);
  if (!player) throw new Error("justice_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("justice_character_deceased");

  const minAge = role === "judge" || role === "magistrate" ? catalog.rules.minimum_judge_age : catalog.rules.minimum_lawyer_age;
  if (player.character.age < minAge) throw new Error("justice_professional_age_ineligible");

  const existingActive = Object.values(state.legalProfessionals).find(
    (p) => p.character_id === characterId && p.status === "active" && (p.role === "judge" || p.role === role),
  );
  if (existingActive) throw new Error("justice_already_professional");

  const timestamp = new Date(now).toISOString();
  const pro: LegalProfessionalRecord = {
    professional_id: `legpro-${randomUUID()}`,
    character_id: characterId,
    role,
    court_id: null,
    status: "active",
    qualifications,
    appointed_at: timestamp,
    appointed_world_date: cloneDate(date),
    appointed_by: appointedBy,
    updated_at: timestamp,
  };
  state.legalProfessionals[pro.professional_id] = pro;
  appendJusticeAudit(state, "professional_appointed", null, null, null, null, null, appointedBy, `${role} appointed: ${characterId}`, date, now, { character_id: characterId, role });
  return pro;
}

export function getProfessionalForCharacter(state: PersistentWorldState, characterId: string): LegalProfessionalRecord | null {
  return Object.values(state.legalProfessionals).find((p) => p.character_id === characterId && p.status === "active") ?? null;
}

// ─── Cases ────────────────────────────────────────────────────────

export function fileCase(
  state: PersistentWorldState,
  category: CaseCategoryId,
  courtId: string,
  filingPartyCharacterId: string,
  respondentCharacterId: string | null,
  summary: string,
  description: string,
  relevantLawIds: string[],
  relevantEventDate: string | null,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): CaseRecord {
  const court = state.courts[courtId];
  if (!court) throw new Error("justice_court_not_found");
  if (court.status !== "active") throw new Error("justice_court_not_active");
  if (!court.permitted_categories.includes(category)) {
    // Also allow if the court permits the broad case type (civil/criminal)
    const caseCategory = catalog.case_categories.find((cc) => cc.id === category);
    if (!caseCategory || !court.permitted_categories.includes(caseCategory.type)) {
      throw new Error("justice_court_category_not_permitted");
    }
  }

  const filingPlayer = characterForId(state, filingPartyCharacterId);
  if (!filingPlayer) throw new Error("justice_character_not_found");
  if (filingPlayer.character.life_status === "deceased") throw new Error("justice_character_deceased");
  if (filingPlayer.character.age < catalog.rules.minimum_filing_age) throw new Error("justice_age_ineligible");

  if (respondentCharacterId) {
    const respPlayer = characterForId(state, respondentCharacterId);
    if (!respPlayer) throw new Error("justice_respondent_not_found");
  }

  if (summary.trim().length > catalog.rules.case_summary_max_length) throw new Error("justice_case_summary_too_long");

  const queueSize = Object.values(state.cases).filter((c) => c.court_id === courtId && c.status !== "closed" && c.status !== "dismissed").length;
  if (queueSize >= catalog.rules.max_cases_per_court_queue) throw new Error("justice_court_queue_full");

  const caseCategory = catalog.case_categories.find((cc) => cc.id === category);
  if (!caseCategory) throw new Error("justice_case_category_invalid");

  const timestamp = new Date(now).toISOString();
  const caseRec: CaseRecord = {
    case_id: `case-${randomUUID()}`,
    case_number: generateCaseNumber(state, courtId, date),
    category,
    case_type: caseCategory.type,
    court_id: courtId,
    jurisdiction: court.jurisdiction,
    applicable_state_id: court.applicable_jurisdiction_id,
    filing_party_character_id: filingPartyCharacterId,
    respondent_character_id: respondentCharacterId,
    additional_party_character_ids: [],
    assigned_judge_character_id: court.assigned_judge_ids[0] ?? null,
    summary: summary.trim(),
    description: description.trim(),
    relevant_event_date: relevantEventDate,
    relevant_law_ids: relevantLawIds,
    relevant_provision_ids: [],
    filing_date: timestamp,
    filing_world_date: cloneDate(date),
    status: "submitted",
    priority: "normal",
    judgment_id: null,
    appeal_id: null,
    closure_date: null,
    closure_world_date: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.cases[caseRec.case_id] = caseRec;

  const claimant: CaseParticipantRecord = {
    participant_id: `part-${randomUUID()}`,
    case_id: caseRec.case_id,
    character_id: filingPartyCharacterId,
    role: "claimant",
    joined_at: timestamp,
    joined_world_date: cloneDate(date),
    status: "active",
    updated_at: timestamp,
  };
  state.caseParticipants[claimant.participant_id] = claimant;

  if (respondentCharacterId) {
    const def: CaseParticipantRecord = {
      participant_id: `part-${randomUUID()}`,
      case_id: caseRec.case_id,
      character_id: respondentCharacterId,
      role: caseCategory.type === "criminal" ? "defendant" : "respondent",
      joined_at: timestamp,
      joined_world_date: cloneDate(date),
      status: "active",
      updated_at: timestamp,
    };
    state.caseParticipants[def.participant_id] = def;
  }

  appendJusticeAudit(state, "case_filed", null, null, caseRec.case_id, null, null, filingPartyCharacterId, `Case filed: ${caseRec.case_number}`, date, now, { category, court_id: courtId });
  return caseRec;
}

export function advanceCaseStatus(
  state: PersistentWorldState,
  caseId: string,
  newStatus: CaseStatusId,
  authorizedBy: string,
  date: CalendarDate,
  now: number,
): CaseRecord {
  const caseRec = state.cases[caseId];
  if (!caseRec) throw new Error("justice_case_not_found");

  const validTransitions: Record<CaseStatusId, CaseStatusId[]> = {
    "draft": ["submitted"],
    "submitted": ["accepted", "rejected"],
    "accepted": ["awaiting_response", "pretrial"],
    "rejected": ["closed"],
    "awaiting_response": ["pretrial", "dismissed"],
    "pretrial": ["awaiting_hearing", "settled"],
    "awaiting_hearing": ["in_hearing", "dismissed"],
    "in_hearing": ["awaiting_judgment", "dismissed"],
    "awaiting_judgment": ["judgment_issued", "dismissed"],
    "judgment_issued": ["eligible_for_appeal", "closed"],
    "eligible_for_appeal": ["appeal_pending", "closed"],
    "appeal_pending": ["judgment_issued", "closed"],
    "settled": ["closed"],
    "withdrawn": ["closed"],
    "dismissed": ["closed"],
    "closed": [],
  };
  const allowed = validTransitions[caseRec.status];
  if (!allowed.includes(newStatus)) throw new Error("justice_case_status_transition_invalid");

  const timestamp = new Date(now).toISOString();
  caseRec.status = newStatus;
  caseRec.updated_at = timestamp;
  if (newStatus === "closed") {
    caseRec.closure_date = timestamp;
    caseRec.closure_world_date = cloneDate(date);
  }
  appendJusticeAudit(state, "case_status_changed", null, null, caseId, null, null, authorizedBy, `Case status changed to ${newStatus}.`, date, now, { old_status: caseRec.status, new_status: newStatus });
  return caseRec;
}

export function getCase(state: PersistentWorldState, caseId: string): CaseSnapshot | null {
  const caseRec = state.cases[caseId];
  if (!caseRec) return null;
  const court = state.courts[caseRec.court_id];
  const upcomingHearing = Object.values(state.hearings)
    .filter((h) => h.case_id === caseId && h.status === "scheduled")
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))[0];
  return {
    case_id: caseRec.case_id,
    case_number: caseRec.case_number,
    category: caseRec.category,
    case_type: caseRec.case_type,
    court_id: caseRec.court_id,
    court_name: court?.name ?? "Unknown Court",
    filing_party_character_id: caseRec.filing_party_character_id,
    respondent_character_id: caseRec.respondent_character_id,
    assigned_judge_character_id: caseRec.assigned_judge_character_id,
    summary: caseRec.summary,
    status: caseRec.status,
    filing_date: caseRec.filing_date,
    next_hearing_date: upcomingHearing?.scheduled_date ?? null,
    judgment_id: caseRec.judgment_id,
    appeal_id: caseRec.appeal_id,
  };
}

export function getCharacterCases(state: PersistentWorldState, characterId: string): CaseSnapshot[] {
  const participantCaseIds = new Set(Object.values(state.caseParticipants).filter((p) => p.character_id === characterId && p.status === "active").map((p) => p.case_id));
  const directCases = Object.values(state.cases).filter((c) => c.filing_party_character_id === characterId || c.respondent_character_id === characterId);
  const allCaseIds = new Set([...participantCaseIds, ...directCases.map((c) => c.case_id)]);
  return Array.from(allCaseIds).map((id) => getCase(state, id)).filter(Boolean) as CaseSnapshot[];
}

// ─── Evidence ─────────────────────────────────────────────────────

export function submitEvidence(
  state: PersistentWorldState,
  caseId: string,
  category: string,
  description: string,
  submittedByCharacterId: string,
  sourceReference: string | null,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): EvidenceRecord {
  const caseRec = state.cases[caseId];
  if (!caseRec) throw new Error("justice_case_not_found");

  const evidenceCount = Object.values(state.evidence).filter((e) => e.case_id === caseId).length;
  if (evidenceCount >= catalog.rules.max_evidence_per_case) throw new Error("justice_evidence_limit_reached");

  const player = characterForId(state, submittedByCharacterId);
  if (!player) throw new Error("justice_character_not_found");

  const timestamp = new Date(now).toISOString();
  const ev: EvidenceRecord = {
    evidence_id: `ev-${randomUUID()}`,
    case_id: caseId,
    category,
    submitted_by_character_id: submittedByCharacterId,
    description: description.trim(),
    source_reference: sourceReference,
    transaction_reference: null,
    submitted_at: timestamp,
    submitted_world_date: cloneDate(date),
    verification_status: "unverified",
    admissibility_status: "pending",
    reviewed_by_character_id: null,
    reviewed_at: null,
    review_reason: null,
    version: 1,
    supersedes_evidence_id: null,
    updated_at: timestamp,
  };
  state.evidence[ev.evidence_id] = ev;
  appendJusticeAudit(state, "evidence_submitted", null, null, caseId, null, null, submittedByCharacterId, `Evidence submitted for case ${caseRec.case_number}.`, date, now, { evidence_id: ev.evidence_id, category });
  return ev;
}

export function admitEvidence(
  state: PersistentWorldState,
  evidenceId: string,
  reviewedByCharacterId: string,
  decision: "admitted" | "excluded",
  reason: string,
  date: CalendarDate,
  now: number,
): EvidenceRecord {
  const ev = state.evidence[evidenceId];
  if (!ev) throw new Error("justice_evidence_not_found");

  const timestamp = new Date(now).toISOString();
  ev.admissibility_status = decision;
  ev.reviewed_by_character_id = reviewedByCharacterId;
  ev.reviewed_at = timestamp;
  ev.review_reason = reason.trim();
  ev.updated_at = timestamp;
  void date;
  return ev;
}

// ─── Hearings ─────────────────────────────────────────────────────

export function scheduleHearing(
  state: PersistentWorldState,
  caseId: string,
  courtId: string,
  judgeCharacterId: string,
  hearingType: HearingRecord["hearing_type"],
  scheduledDate: string,
  notes: string,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): HearingRecord {
  const caseRec = state.cases[caseId];
  if (!caseRec) throw new Error("justice_case_not_found");
  if (caseRec.court_id !== courtId) throw new Error("justice_hearing_wrong_court");

  const court = state.courts[courtId];
  if (!court) throw new Error("justice_court_not_found");
  if (!court.assigned_judge_ids.includes(judgeCharacterId)) throw new Error("justice_judge_not_assigned");

  const hearingCount = Object.values(state.hearings).filter((h) => h.case_id === caseId).length;
  if (hearingCount >= catalog.rules.max_hearings_per_case) throw new Error("justice_hearing_limit_reached");

  if (notes.length > catalog.rules.hearing_notes_max_length) throw new Error("justice_hearing_notes_too_long");

  const timestamp = new Date(now).toISOString();
  const hearing: HearingRecord = {
    hearing_id: `hr-${randomUUID()}`,
    case_id: caseId,
    court_id: courtId,
    judge_character_id: judgeCharacterId,
    hearing_type: hearingType,
    scheduled_date: scheduledDate,
    scheduled_world_date: cloneDate(date),
    actual_start_date: null,
    actual_end_date: null,
    status: "scheduled",
    notes: notes.trim(),
    evidence_references: [],
    attendance_character_ids: [],
    procedural_decisions: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.hearings[hearing.hearing_id] = hearing;
  return hearing;
}

// ─── Judgments ────────────────────────────────────────────────────

export function issueJudgment(
  state: PersistentWorldState,
  caseId: string,
  judgeCharacterId: string,
  outcome: JudgmentOutcomeId,
  findings: string,
  reasoning: string,
  remedies: Array<{ type: string; description: string; amount_ngn?: number; duration_days?: number }>,
  appealEligible: boolean,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): JudgmentRecord {
  const caseRec = state.cases[caseId];
  if (!caseRec) throw new Error("justice_case_not_found");
  if (caseRec.status !== "awaiting_judgment") throw new Error("justice_case_not_awaiting_judgment");

  const court = state.courts[caseRec.court_id];
  if (!court) throw new Error("justice_court_not_found");
  if (!court.assigned_judge_ids.includes(judgeCharacterId)) throw new Error("justice_judge_not_assigned");

  if (reasoning.length > catalog.rules.judgment_reasoning_max_length) throw new Error("justice_judgment_reasoning_too_long");

  const timestamp = new Date(now).toISOString();
  const appealDeadline = new Date(now + catalog.rules.appeal_window_days * 24 * 60 * 60 * 1000).toISOString();

  const judgment: JudgmentRecord = {
    judgment_id: `jdg-${randomUUID()}`,
    case_id: caseId,
    court_id: caseRec.court_id,
    judge_character_id: judgeCharacterId,
    outcome,
    findings: findings.trim(),
    reasoning: reasoning.trim(),
    relevant_law_ids: caseRec.relevant_law_ids,
    relevant_provision_ids: caseRec.relevant_provision_ids,
    evidence_considered_ids: Object.values(state.evidence).filter((e) => e.case_id === caseId && e.admissibility_status === "admitted").map((e) => e.evidence_id),
    remedies,
    sentence_ids: [],
    appeal_eligible: appealEligible,
    appeal_deadline: appealEligible ? appealDeadline : null,
    issued_at: timestamp,
    issued_world_date: cloneDate(date),
    superseded_by_judgment_id: null,
    status: "issued",
    updated_at: timestamp,
  };
  state.judgments[judgment.judgment_id] = judgment;

  caseRec.judgment_id = judgment.judgment_id;
  caseRec.status = "judgment_issued";
  caseRec.updated_at = timestamp;

  appendJusticeAudit(state, "judgment_issued", null, null, caseId, judgment.judgment_id, null, judgeCharacterId, `Judgment issued for case ${caseRec.case_number}.`, date, now, { outcome });
  return judgment;
}

// ─── Fines ────────────────────────────────────────────────────────

export function createFine(
  state: PersistentWorldState,
  caseId: string,
  judgmentId: string,
  sentenceId: string,
  responsibleCharacterId: string,
  amountNgn: number,
  dueDate: string,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): FineRecord {
  if (!Number.isFinite(amountNgn) || amountNgn < catalog.rules.fine_minimum_ngn || amountNgn > catalog.rules.fine_maximum_ngn) throw new Error("justice_fine_amount_invalid");

  const player = characterForId(state, responsibleCharacterId);
  if (!player) throw new Error("justice_character_not_found");

  const idempotencyKey = `fine:${judgmentId}:${sentenceId}:${responsibleCharacterId}`;
  const existing = Object.values(state.fines).find((f) => f.idempotency_key === idempotencyKey);
  if (existing) return existing;

  const timestamp = new Date(now).toISOString();
  const fine: FineRecord = {
    fine_id: `fine-${randomUUID()}`,
    case_id: caseId,
    judgment_id: judgmentId,
    sentence_id: sentenceId,
    responsible_character_id: responsibleCharacterId,
    amount_ngn: amountNgn,
    amount_paid_ngn: 0,
    amount_outstanding_ngn: amountNgn,
    due_date: dueDate,
    due_world_date: cloneDate(date),
    status: "outstanding",
    payment_transaction_ids: [],
    idempotency_key: idempotencyKey,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
  };
  state.fines[fine.fine_id] = fine;
  appendJusticeAudit(state, "fine_created", null, null, caseId, judgmentId, null, null, `Fine of ₦${amountNgn.toLocaleString()} created.`, date, now, { amount_ngn: amountNgn, responsible_character_id: responsibleCharacterId });
  return fine;
}

export function payFine(
  state: PersistentWorldState,
  fineId: string,
  paymentAmountNgn: number,
  transactionId: string,
  date: CalendarDate,
  now: number,
): FineRecord {
  const fine = state.fines[fineId];
  if (!fine) throw new Error("justice_fine_not_found");
  if (fine.status === "paid") throw new Error("justice_fine_already_paid");
  if (!Number.isFinite(paymentAmountNgn) || paymentAmountNgn <= 0) throw new Error("justice_payment_amount_invalid");

  if (fine.payment_transaction_ids.includes(transactionId)) return fine;

  const remaining = fine.amount_outstanding_ngn;
  const actualPayment = Math.min(paymentAmountNgn, remaining);

  fine.amount_paid_ngn += actualPayment;
  fine.amount_outstanding_ngn = fine.amount_ngn - fine.amount_paid_ngn;
  fine.payment_transaction_ids.push(transactionId);
  fine.status = fine.amount_outstanding_ngn <= 0 ? "paid" : "partially_paid";
  fine.updated_at = new Date(now).toISOString();

  appendJusticeAudit(state, "fine_payment", null, null, fine.case_id, fine.judgment_id, null, fine.responsible_character_id, `Fine payment of ₦${actualPayment.toLocaleString()} received.`, date, now, { fine_id: fineId, amount: actualPayment, transaction_id: transactionId });
  return fine;
}

export function getCharacterFines(state: PersistentWorldState, characterId: string): FineRecord[] {
  return Object.values(state.fines).filter((f) => f.responsible_character_id === characterId);
}

export function getCharacterTotalFinesOwed(state: PersistentWorldState, characterId: string): number {
  return Object.values(state.fines)
    .filter((f) => f.responsible_character_id === characterId && f.status !== "paid" && f.status !== "waived" && f.status !== "cancelled")
    .reduce((sum, f) => sum + f.amount_outstanding_ngn, 0);
}

// ─── Appeals ──────────────────────────────────────────────────────

export function fileAppeal(
  state: PersistentWorldState,
  originalCaseId: string,
  originalJudgmentId: string,
  appellantCharacterId: string,
  grounds: string,
  appellateCourtId: string,
  date: CalendarDate,
  now: number,
  catalog: JusticeCatalog = loadJusticeCatalog(),
): AppealRecord {
  const judgment = state.judgments[originalJudgmentId];
  if (!judgment) throw new Error("justice_judgment_not_found");
  if (judgment.case_id !== originalCaseId) throw new Error("justice_appeal_case_mismatch");
  if (!judgment.appeal_eligible) throw new Error("justice_appeal_not_eligible");
  if (judgment.status !== "issued") throw new Error("justice_judgment_not_issuable");

  const originalCase = state.cases[originalCaseId];
  if (!originalCase) throw new Error("justice_case_not_found");

  if (appellantCharacterId !== originalCase.filing_party_character_id && appellantCharacterId !== originalCase.respondent_character_id) {
    throw new Error("justice_appeal_no_standing");
  }

  const appellateCourt = state.courts[appellateCourtId];
  if (!appellateCourt) throw new Error("justice_court_not_found");
  if (appellateCourt.level !== "court_of_appeal" && appellateCourt.level !== "supreme") throw new Error("justice_court_not_appellate");

  if (grounds.trim().length > catalog.rules.appeal_grounds_max_length) throw new Error("justice_appeal_grounds_too_long");

  const timestamp = new Date(now).toISOString();
  const appeal: AppealRecord = {
    appeal_id: `app-${randomUUID()}`,
    original_case_id: originalCaseId,
    original_judgment_id: originalJudgmentId,
    appellant_character_id: appellantCharacterId,
    grounds: grounds.trim(),
    supporting_references: [],
    filing_date: timestamp,
    filing_world_date: cloneDate(date),
    appellate_court_id: appellateCourtId,
    assigned_judge_character_id: null,
    status: "filed",
    outcome: null,
    outcome_judgment_id: null,
    outcome_reasoning: null,
    decided_at: null,
    decided_world_date: null,
    updated_at: timestamp,
  };
  state.appeals[appeal.appeal_id] = appeal;

  originalCase.appeal_id = appeal.appeal_id;
  originalCase.status = "appeal_pending";
  originalCase.updated_at = timestamp;

  judgment.status = "under_appeal";
  judgment.updated_at = timestamp;

  appendJusticeAudit(state, "appeal_filed", null, null, originalCaseId, originalJudgmentId, appeal.appeal_id, appellantCharacterId, `Appeal filed for case ${originalCase.case_number}.`, date, now);
  return appeal;
}

export function decideAppeal(
  state: PersistentWorldState,
  appealId: string,
  outcome: AppealOutcomeId,
  reasoning: string,
  decidedByCharacterId: string,
  date: CalendarDate,
  now: number,
): AppealRecord {
  const appeal = state.appeals[appealId];
  if (!appeal) throw new Error("justice_appeal_not_found");
  if (appeal.status === "decided") throw new Error("justice_appeal_already_decided");

  const timestamp = new Date(now).toISOString();
  appeal.status = "decided";
  appeal.outcome = outcome;
  appeal.outcome_reasoning = reasoning.trim();
  appeal.decided_at = timestamp;
  appeal.decided_world_date = cloneDate(date);
  appeal.assigned_judge_character_id = decidedByCharacterId;
  appeal.updated_at = timestamp;

  const judgment = state.judgments[appeal.original_judgment_id];
  if (judgment) {
    if (outcome === "affirmed" || outcome === "dismissed") judgment.status = "affirmed";
    else if (outcome === "reversed") judgment.status = "reversed";
    else if (outcome === "modified") judgment.status = "modified";
    else judgment.status = "final";
    judgment.updated_at = timestamp;
  }

  const caseRec = state.cases[appeal.original_case_id];
  if (caseRec) {
    caseRec.status = "closed";
    caseRec.closure_date = timestamp;
    caseRec.closure_world_date = cloneDate(date);
    caseRec.updated_at = timestamp;
  }

  appendJusticeAudit(state, "appeal_decided", null, null, appeal.original_case_id, appeal.original_judgment_id, appealId, decidedByCharacterId, `Appeal decided: ${outcome}.`, date, now);
  return appeal;
}

// ─── Legal Profile ────────────────────────────────────────────────

export function getLegalProfile(state: PersistentWorldState, characterId: string): LegalProfileSnapshot | null {
  const pro = getProfessionalForCharacter(state, characterId);
  const cases = getCharacterCases(state, characterId);
  const finesOwed = getCharacterTotalFinesOwed(state, characterId);
  const appealCount = Object.values(state.appeals).filter((a) => a.appellant_character_id === characterId).length;

  return {
    character_id: characterId,
    professional_id: pro?.professional_id ?? null,
    role: pro?.role ?? null,
    court_id: pro?.court_id ?? null,
    status: pro?.status ?? null,
    active_cases: cases.filter((c) => c.status !== "closed" && c.status !== "dismissed"),
    fines_owed_ngn: finesOwed,
    appeal_count: appealCount,
  };
}

// ─── Law Search ───────────────────────────────────────────────────

export function searchLaws(state: PersistentWorldState, query?: string, category?: LawCategoryId, jurisdiction?: string): LawSnapshot[] {
  let laws = Object.values(state.laws).filter((l) => l.status === "in_force" || l.status === "enacted" || l.status === "amended");
  if (query) {
    const q = query.toLowerCase();
    laws = laws.filter((l) => l.title.toLowerCase().includes(q) || l.short_reference.toLowerCase().includes(q) || l.description.toLowerCase().includes(q));
  }
  if (category) laws = laws.filter((l) => l.category === category);
  if (jurisdiction) laws = laws.filter((l) => l.jurisdiction === jurisdiction);
  return laws.map((l) => {
    const provCount = Object.values(state.lawProvisions).filter((p) => p.law_id === l.law_id && p.status === "active").length;
    return {
      law_id: l.law_id,
      title: l.title,
      short_reference: l.short_reference,
      description: l.description,
      category: l.category,
      jurisdiction: l.jurisdiction,
      applicable_state_id: l.applicable_state_id,
      status: l.status,
      version: l.version,
      enactment_date: l.enactment_date,
      effective_date: l.effective_date,
      public_explanation: l.public_explanation,
      provision_count: provCount,
    };
  });
}

// ─── Error messages ───────────────────────────────────────────────

export function justiceErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    justice_law_title_too_long: "Law title is too long.",
    justice_law_description_too_long: "Law description is too long.",
    justice_law_not_found: "Law not found.",
    justice_law_status_transition_invalid: "Invalid law status transition.",
    justice_law_not_amendable: "This law cannot be amended in its current status.",
    justice_provision_limit_reached: "Maximum provisions per law reached.",
    justice_character_not_found: "Character not found.",
    justice_character_deceased: "Character is deceased.",
    justice_age_ineligible: "Character does not meet minimum age requirement.",
    justice_court_not_found: "Court not found.",
    justice_court_not_active: "Court is not active.",
    justice_court_category_not_permitted: "This court does not handle this case category.",
    justice_court_queue_full: "Court case queue is full.",
    justice_case_category_invalid: "Invalid case category.",
    justice_case_summary_too_long: "Case summary is too long.",
    justice_respondent_not_found: "Respondent character not found.",
    justice_case_not_found: "Case not found.",
    justice_case_status_transition_invalid: "Invalid case status transition.",
    justice_case_not_awaiting_judgment: "Case is not awaiting judgment.",
    justice_professional_not_found: "Legal professional record not found.",
    justice_professional_mismatch: "Professional record does not match this character.",
    justice_not_judge_role: "Character is not appointed as a judge or magistrate.",
    justice_professional_age_ineligible: "Character does not meet minimum age for this legal role.",
    justice_already_professional: "Character already holds an active legal professional appointment.",
    justice_judge_not_assigned: "Judge is not assigned to this court.",
    justice_hearing_wrong_court: "Hearing must be in the case's assigned court.",
    justice_hearing_limit_reached: "Maximum hearings per case reached.",
    justice_hearing_notes_too_long: "Hearing notes are too long.",
    justice_judgment_reasoning_too_long: "Judgment reasoning is too long.",
    justice_fine_amount_invalid: "Fine amount is outside permitted range.",
    justice_fine_not_found: "Fine record not found.",
    justice_fine_already_paid: "Fine has already been paid.",
    justice_payment_amount_invalid: "Payment amount is invalid.",
    justice_appeal_not_found: "Appeal record not found.",
    justice_appeal_case_mismatch: "Judgment does not belong to the specified case.",
    justice_appeal_not_eligible: "This judgment is not eligible for appeal.",
    justice_judgment_not_issuable: "Judgment is not in an issuable state.",
    justice_appeal_no_standing: "Character does not have standing to appeal this case.",
    justice_court_not_appellate: "Court does not have appellate jurisdiction.",
    justice_appeal_grounds_too_long: "Appeal grounds exceed maximum length.",
    justice_appeal_already_decided: "Appeal has already been decided.",
    justice_proposal_not_found: "Legislative proposal not found.",
    justice_proposal_not_draft: "Proposal is not in draft status.",
    justice_not_proposal_sponsor: "Only the sponsor can submit this proposal.",
    justice_proposal_not_pending: "Proposal is not pending review.",
    justice_evidence_not_found: "Evidence record not found.",
    justice_evidence_limit_reached: "Maximum evidence items per case reached.",
    justice_judgment_not_found: "Judgment not found.",
  };
  return messages[code] ?? code;
}

// ─── World date processing ────────────────────────────────────────

export function processJusticeWorldDate(_state: PersistentWorldState, _date: CalendarDate, _now: number): number {
  void _state; void _date; void _now;
  return 0;
}
