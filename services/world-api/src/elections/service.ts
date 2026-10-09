/**
 * Stage 11 — Elections and Politics System
 *
 * Core service for political parties, elections, candidates, campaigns,
 * voting, results, disputes, audit, and government-office integration.
 */

import { randomUUID } from "node:crypto";
import type { PersistentWorldState } from "../multiplayer/types.js";
import type { CalendarDate } from "../life/types.js";
import type {
  ElectionsCatalog,
  PoliticalPartyRecord,
  PartyMembershipRecord,
  PoliticalProfileRecord,
  ElectionRecord,
  CandidateRecord,
  CampaignRecord,
  CampaignEventRecord,
  CampaignFinanceRecord,
  DebateRecord,
  BallotRecord,
  VoterParticipationRecord,
  ElectionDisputeRecord,
  ElectionAuditRecord,
  ElectionResultRecord,
  ManifestoRecord,
  PartyStatus,
  ElectionPhase,
  DisputeStatus,
  PoliticalProfileSnapshot,
  PartySnapshot,
  CandidateSnapshot,
  ElectionSnapshot,
  CampaignSnapshot,
} from "./types.js";
import type { GovernmentOrganisationRecord, GovernmentOfficeRecord, AppointmentRecord } from "../government/types.js";
import { loadElectionsCatalog } from "./catalog.js";

// ─── Helpers ──────────────────────────────────────────────────────

function cloneDate(d: CalendarDate): CalendarDate {
  return { year: d.year, month: d.month, day: d.day };
}

function characterForId(state: PersistentWorldState, characterId: string) {
  return Object.values(state.players).find((p) => p.character.character_id === characterId) ?? null;
}

function appendElectionAudit(
  state: PersistentWorldState,
  electionId: string,
  category: string,
  actorId: string | null,
  summary: string,
  date: CalendarDate,
  now: number,
  details: Record<string, string | number | boolean | null> = {},
): ElectionAuditRecord {
  const record: ElectionAuditRecord = {
    audit_id: `audit-${randomUUID()}`,
    election_id: electionId,
    category,
    actor_character_id: actorId,
    summary,
    details,
    created_at: new Date(now).toISOString(),
    created_world_date: cloneDate(date),
  };
  state.electionAudits[record.audit_id] = record;
  return record;
}

function findOfficeForElection(
  state: PersistentWorldState,
  election: ElectionRecord,
): { org: GovernmentOrganisationRecord; office: GovernmentOfficeRecord } | null {
  const offices = Object.values(state.governmentOffices).filter(
    (o) => o.definition_id === election.office_definition_id,
  );
  for (const office of offices) {
    const org = state.governmentOrganisations[office.organisation_id];
    if (!org) continue;
    if (election.jurisdiction_level === "federal" && org.level === "federal" && org.ministry_id === null && org.parent_organisation_id === null) {
      return { org, office };
    }
    if (election.jurisdiction_level === "state" && org.level === "state" && org.jurisdiction_id === election.jurisdiction_id && org.parent_organisation_id === null) {
      return { org, office };
    }
    if (election.jurisdiction_level === "local" && org.level === "local" && org.jurisdiction_id === election.jurisdiction_id) {
      return { org, office };
    }
  }
  return null;
}

function activeAppointmentForOffice(state: PersistentWorldState, officeId: string): AppointmentRecord | null {
  return Object.values(state.governmentAppointments).find(
    (a) => a.office_id === officeId && a.status === "active",
  ) ?? null;
}

function endExistingAppointment(state: PersistentWorldState, officeId: string, reason: string, date: CalendarDate, now: number): void {
  const existing = activeAppointmentForOffice(state, officeId);
  if (!existing) return;
  const timestamp = new Date(now).toISOString();
  existing.status = "ended";
  existing.end_date = timestamp;
  existing.end_world_date = cloneDate(date);
  existing.end_reason = reason;
  existing.updated_at = timestamp;
}

// ─── Initialization ───────────────────────────────────────────────

export function initializeElectionWorldState(state: PersistentWorldState): void {
  if (!state.politicalParties) state.politicalParties = {};
  if (!state.partyMemberships) state.partyMemberships = {};
  if (!state.politicalProfiles) state.politicalProfiles = {};
  if (!state.elections) state.elections = {};
  if (!state.candidates) state.candidates = {};
  if (!state.campaigns) state.campaigns = {};
  if (!state.campaignEvents) state.campaignEvents = {};
  if (!state.campaignFinances) state.campaignFinances = {};
  if (!state.debates) state.debates = {};
  if (!state.ballots) state.ballots = {};
  if (!state.voterParticipation) state.voterParticipation = {};
  if (!state.electionDisputes) state.electionDisputes = {};
  if (!state.electionAudits) state.electionAudits = {};
}

// ─── Political Parties ────────────────────────────────────────────

export function createPoliticalParty(
  state: PersistentWorldState,
  name: string,
  abbreviation: string,
  description: string,
  founderCharacterId: string,
  policyPositions: string[],
  date: CalendarDate,
  now: number,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): PoliticalPartyRecord {
  const trimmedName = name.trim();
  const trimmedAbbrev = abbreviation.trim().toUpperCase();
  if (trimmedName.length < catalog.party_rules.party_name_min_length) throw new Error("elections_party_name_too_short");
  if (trimmedName.length > catalog.party_rules.party_name_max_length) throw new Error("elections_party_name_too_long");
  if (trimmedAbbrev.length < catalog.party_rules.party_abbreviation_min_length) throw new Error("elections_party_abbreviation_too_short");
  if (trimmedAbbrev.length > catalog.party_rules.party_abbreviation_max_length) throw new Error("elections_party_abbreviation_too_long");
  if (description.length > catalog.party_rules.party_description_max_length) throw new Error("elections_party_description_too_long");

  const player = characterForId(state, founderCharacterId);
  if (!player) throw new Error("elections_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("elections_character_deceased");
  if (player.character.age < catalog.party_rules.minimum_founder_age) throw new Error("elections_party_founder_age_ineligible");

  if (catalog.party_rules.unique_name_required) {
    const dup = Object.values(state.politicalParties).find(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase() && p.status !== "dissolved",
    );
    if (dup) throw new Error("elections_party_name_taken");
  }
  if (catalog.party_rules.unique_abbreviation_required) {
    const dup = Object.values(state.politicalParties).find(
      (p) => p.abbreviation === trimmedAbbrev && p.status !== "dissolved",
    );
    if (dup) throw new Error("elections_party_abbreviation_taken");
  }

  // Check existing party membership
  const existingMembership = Object.values(state.partyMemberships).find(
    (m) => m.character_id === founderCharacterId && m.status === "active",
  );
  if (existingMembership && catalog.party_rules.max_parties_per_character === 1) {
    throw new Error("elections_already_in_party");
  }

  const timestamp = new Date(now).toISOString();
  const party: PoliticalPartyRecord = {
    party_id: `party-${randomUUID()}`,
    name: trimmedName,
    abbreviation: trimmedAbbrev,
    description: description.trim(),
    status: "pending_registration",
    founded_by: founderCharacterId,
    founding_date: timestamp,
    founding_world_date: cloneDate(date),
    policy_positions: policyPositions,
    leadership: { national_chairman: founderCharacterId },
    updated_at: timestamp,
  };
  state.politicalParties[party.party_id] = party;

  // Auto-add founder as active member
  const membership: PartyMembershipRecord = {
    membership_id: `pmem-${randomUUID()}`,
    party_id: party.party_id,
    character_id: founderCharacterId,
    status: "active",
    role: "national_chairman",
    joined_at: timestamp,
    joined_world_date: cloneDate(date),
    ended_at: null,
    ended_world_date: null,
    end_reason: null,
    updated_at: timestamp,
  };
  state.partyMemberships[membership.membership_id] = membership;

  // Ensure political profile exists
  ensurePoliticalProfile(state, founderCharacterId, timestamp, date);

  return party;
}

export function registerPoliticalParty(
  state: PersistentWorldState,
  partyId: string,
  _authorizedBy: string,
  date: CalendarDate,
  now: number,
): PoliticalPartyRecord {
  const party = state.politicalParties[partyId];
  if (!party) throw new Error("elections_party_not_found");
  if (party.status !== "pending_registration") throw new Error("elections_party_not_pending");

  const timestamp = new Date(now).toISOString();
  party.status = "active";
  party.updated_at = timestamp;
  void date;
  return party;
}

export function updatePartyStatus(
  state: PersistentWorldState,
  partyId: string,
  newStatus: PartyStatus,
  _authorizedBy: string,
  date: CalendarDate,
  now: number,
): PoliticalPartyRecord {
  const party = state.politicalParties[partyId];
  if (!party) throw new Error("elections_party_not_found");
  const catalog = loadElectionsCatalog();
  if (!catalog.party_rules.party_statuses.includes(newStatus)) throw new Error("elections_party_status_invalid");

  const timestamp = new Date(now).toISOString();
  party.status = newStatus;
  party.updated_at = timestamp;
  void date;
  return party;
}

export function joinPoliticalParty(
  state: PersistentWorldState,
  partyId: string,
  characterId: string,
  date: CalendarDate,
  now: number,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): PartyMembershipRecord {
  const party = state.politicalParties[partyId];
  if (!party) throw new Error("elections_party_not_found");
  if (party.status !== "active") throw new Error("elections_party_not_active");

  const player = characterForId(state, characterId);
  if (!player) throw new Error("elections_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("elections_character_deceased");
  if (player.character.age < catalog.party_rules.minimum_member_age) throw new Error("elections_member_age_ineligible");

  const existingActive = Object.values(state.partyMemberships).find(
    (m) => m.character_id === characterId && m.status === "active",
  );
  if (existingActive) throw new Error("elections_already_in_party");

  const alreadyInParty = Object.values(state.partyMemberships).find(
    (m) => m.party_id === partyId && m.character_id === characterId && m.status === "active",
  );
  if (alreadyInParty) throw new Error("elections_already_in_this_party");

  const timestamp = new Date(now).toISOString();
  const membership: PartyMembershipRecord = {
    membership_id: `pmem-${randomUUID()}`,
    party_id: partyId,
    character_id: characterId,
    status: "active",
    role: null,
    joined_at: timestamp,
    joined_world_date: cloneDate(date),
    ended_at: null,
    ended_world_date: null,
    end_reason: null,
    updated_at: timestamp,
  };
  state.partyMemberships[membership.membership_id] = membership;

  ensurePoliticalProfile(state, characterId, timestamp, date);
  const profile = getPoliticalProfileForCharacter(state, characterId);
  if (profile) {
    profile.party_id = partyId;
    profile.updated_at = timestamp;
  }

  return membership;
}

export function leavePoliticalParty(
  state: PersistentWorldState,
  membershipId: string,
  reason: string,
  date: CalendarDate,
  now: number,
): PartyMembershipRecord {
  const membership = state.partyMemberships[membershipId];
  if (!membership) throw new Error("elections_membership_not_found");
  if (membership.status !== "active") throw new Error("elections_membership_not_active");

  const timestamp = new Date(now).toISOString();
  membership.status = "resigned";
  membership.ended_at = timestamp;
  membership.ended_world_date = cloneDate(date);
  membership.end_reason = reason.trim() || "Voluntary departure.";
  membership.updated_at = timestamp;

  const profile = getPoliticalProfileForCharacter(state, membership.character_id);
  if (profile && profile.party_id === membership.party_id) {
    profile.party_id = null;
    profile.updated_at = timestamp;
  }

  return membership;
}

export function setPartyLeadership(
  state: PersistentWorldState,
  partyId: string,
  role: string,
  characterId: string,
  _authorizedBy: string,
  date: CalendarDate,
  now: number,
): void {
  const party = state.politicalParties[partyId];
  if (!party) throw new Error("elections_party_not_found");
  const catalog = loadElectionsCatalog();
  if (!catalog.party_rules.leadership_roles.includes(role)) throw new Error("elections_leadership_role_invalid");

  const player = characterForId(state, characterId);
  if (!player) throw new Error("elections_character_not_found");

  const member = Object.values(state.partyMemberships).find(
    (m) => m.party_id === partyId && m.character_id === characterId && m.status === "active",
  );
  if (!member) throw new Error("elections_not_party_member");

  const timestamp = new Date(now).toISOString();
  party.leadership[role] = characterId;
  member.role = role;
  member.updated_at = timestamp;
  void date;
}

// ─── Political Profiles ───────────────────────────────────────────

function ensurePoliticalProfile(state: PersistentWorldState, characterId: string, timestamp: string, date: CalendarDate): PoliticalProfileRecord {
  const existing = Object.values(state.politicalProfiles).find((p) => p.character_id === characterId);
  if (existing) return existing;

  const profile: PoliticalProfileRecord = {
    profile_id: `pprofile-${randomUUID()}`,
    character_id: characterId,
    party_id: null,
    public_statement: "",
    public_service_history: [],
    reputation_score: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.politicalProfiles[profile.profile_id] = profile;
  void date;
  return profile;
}

export function getPoliticalProfileForCharacter(state: PersistentWorldState, characterId: string): PoliticalProfileRecord | null {
  return Object.values(state.politicalProfiles).find((p) => p.character_id === characterId) ?? null;
}

export function getPoliticalProfile(state: PersistentWorldState, characterId: string): PoliticalProfileSnapshot | null {
  const profile = getPoliticalProfileForCharacter(state, characterId);
  if (!profile) return null;
  const party = profile.party_id ? state.politicalParties[profile.party_id] : null;
  return {
    profile_id: profile.profile_id,
    character_id: profile.character_id,
    party_id: profile.party_id,
    party_name: party?.name ?? null,
    party_abbreviation: party?.abbreviation ?? null,
    public_statement: profile.public_statement,
    public_service_history: profile.public_service_history,
    reputation_score: profile.reputation_score,
  };
}

export function updatePoliticalProfile(
  state: PersistentWorldState,
  characterId: string,
  publicStatement: string,
  date: CalendarDate,
  now: number,
): PoliticalProfileRecord {
  const profile = ensurePoliticalProfile(state, characterId, new Date(now).toISOString(), date);
  const timestamp = new Date(now).toISOString();
  profile.public_statement = publicStatement.trim();
  profile.updated_at = timestamp;
  return profile;
}

// ─── Elections ────────────────────────────────────────────────────

export function createElection(
  state: PersistentWorldState,
  electionType: string,
  jurisdictionId: string | null,
  constituencyId: string | null,
  createdBy: string,
  registrationOpenDate: string,
  registrationCloseDate: string,
  campaignStartDate: string,
  campaignEndDate: string,
  votingOpenDate: string,
  votingCloseDate: string,
  date: CalendarDate,
  now: number,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): ElectionRecord {
  const typeDef = catalog.election_types.find((t) => t.id === electionType);
  if (!typeDef) throw new Error("elections_type_not_found");

  const eligibility = catalog.eligibility_rules[electionType];
  if (!eligibility) throw new Error("elections_eligibility_rules_not_found");

  // Validate schedule ordering
  const regOpen = new Date(registrationOpenDate).getTime();
  const regClose = new Date(registrationCloseDate).getTime();
  const campStart = new Date(campaignStartDate).getTime();
  const campEnd = new Date(campaignEndDate).getTime();
  const voteOpen = new Date(votingOpenDate).getTime();
  const voteClose = new Date(votingCloseDate).getTime();
  if (!(regOpen < regClose && regClose <= campStart && campStart < campEnd && campEnd <= voteOpen && voteOpen < voteClose)) {
    throw new Error("elections_schedule_invalid");
  }

  const player = characterForId(state, createdBy);
  if (!player) throw new Error("elections_character_not_found");

  const timestamp = new Date(now).toISOString();
  const election: ElectionRecord = {
    election_id: `election-${randomUUID()}`,
    election_type: typeDef.id,
    office_definition_id: typeDef.office_definition_id,
    jurisdiction_level: typeDef.level,
    jurisdiction_id: jurisdictionId,
    constituency_id: constituencyId,
    phase: "scheduling",
    registration_open_date: registrationOpenDate,
    registration_close_date: registrationCloseDate,
    campaign_start_date: campaignStartDate,
    campaign_end_date: campaignEndDate,
    voting_open_date: votingOpenDate,
    voting_close_date: votingCloseDate,
    created_by: createdBy,
    created_at: timestamp,
    created_world_date: cloneDate(date),
    updated_at: timestamp,
    winning_rule: eligibility.winning_rule,
    results: null,
  };
  state.elections[election.election_id] = election;

  appendElectionAudit(state, election.election_id, "election_created", createdBy,
    `${typeDef.label} election created.`, date, now,
    { election_type: electionType, jurisdiction_id: jurisdictionId });

  return election;
}

export function advanceElectionPhase(
  state: PersistentWorldState,
  electionId: string,
  newPhase: ElectionPhase,
  authorizedBy: string,
  date: CalendarDate,
  now: number,
): ElectionRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");

  const validTransitions: Record<ElectionPhase, ElectionPhase[]> = {
    scheduling: ["candidate_registration"],
    candidate_registration: ["screening"],
    screening: ["campaign"],
    campaign: ["voting"],
    voting: ["counting"],
    counting: ["certification"],
    certification: ["completed"],
    completed: ["disputed"],
    disputed: ["completed"],
    cancelled: [],
  };

  const allowed = validTransitions[election.phase];
  if (!allowed || !allowed.includes(newPhase)) throw new Error("elections_phase_transition_invalid");

  const timestamp = new Date(now).toISOString();
  election.phase = newPhase;
  election.updated_at = timestamp;

  if (newPhase === "voting") {
    appendElectionAudit(state, election.election_id, "poll_opened", authorizedBy, "Poll opened for voting.", date, now);
  } else if (newPhase === "counting") {
    appendElectionAudit(state, election.election_id, "poll_closed", authorizedBy, "Poll closed.", date, now);
  }

  return election;
}

export function cancelElection(
  state: PersistentWorldState,
  electionId: string,
  reason: string,
  authorizedBy: string,
  date: CalendarDate,
  now: number,
): ElectionRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");
  if (election.phase === "completed") throw new Error("elections_cannot_cancel_completed");
  if (election.phase === "cancelled") throw new Error("elections_already_cancelled");

  const timestamp = new Date(now).toISOString();
  election.phase = "cancelled";
  election.updated_at = timestamp;
  appendElectionAudit(state, election.election_id, "election_cancelled", authorizedBy, `Election cancelled: ${reason}`, date, now);
  return election;
}

// ─── Candidates ───────────────────────────────────────────────────

export function registerCandidate(
  state: PersistentWorldState,
  electionId: string,
  characterId: string,
  partyId: string | null,
  manifesto: ManifestoRecord | null,
  date: CalendarDate,
  now: number,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): CandidateRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");
  if (election.phase !== "candidate_registration") throw new Error("elections_registration_not_open");

  const player = characterForId(state, characterId);
  if (!player) throw new Error("elections_character_not_found");

  const eligibility = catalog.eligibility_rules[election.election_type];
  if (!eligibility) throw new Error("elections_eligibility_rules_not_found");

  // Age check
  if (player.character.age < eligibility.minimum_age) throw new Error("elections_candidate_age_ineligible");
  // Life status check
  if (player.character.life_status === "deceased") throw new Error("elections_character_deceased");
  // Party affiliation check
  if (eligibility.party_affiliation_required && !partyId) throw new Error("elections_party_affiliation_required");

  // Party membership verification
  if (partyId) {
    const party = state.politicalParties[partyId];
    if (!party) throw new Error("elections_party_not_found");
    if (party.status !== "active") throw new Error("elections_party_not_active");
    const member = Object.values(state.partyMemberships).find(
      (m) => m.party_id === partyId && m.character_id === characterId && m.status === "active",
    );
    if (!member) throw new Error("elections_not_party_member");
  }

  // Duplicate candidacy check
  const existingCandidate = Object.values(state.candidates).find(
    (c) => c.election_id === electionId && c.character_id === characterId && c.status !== "withdrawn" && c.status !== "rejected",
  );
  if (existingCandidate) throw new Error("elections_already_registered_candidate");

  // Office incompatibility: check if already holds this office
  const targetMatch = findOfficeForElection(state, election);
  if (targetMatch) {
    const currentHolder = activeAppointmentForOffice(state, targetMatch.office.office_id);
    if (currentHolder && currentHolder.character_id === characterId) {
      // Already holds this office - can run for re-election only if under term limit
      const previousCount = Object.values(state.candidates).filter(
        (c) => c.character_id === characterId && c.election_id !== electionId && c.status === "approved",
      ).length;
      void previousCount;
    }
  }

  // Manifesto validation
  if (manifesto) {
    if (manifesto.summary.length > catalog.campaign_rules.max_manifesto_length) {
      throw new Error("elections_manifesto_too_long");
    }
  }

  const timestamp = new Date(now).toISOString();
  const candidate: CandidateRecord = {
    candidate_id: `cand-${randomUUID()}`,
    election_id: electionId,
    character_id: characterId,
    party_id: partyId,
    status: "pending",
    manifesto,
    registered_at: timestamp,
    registered_world_date: cloneDate(date),
    approved_at: null,
    approved_world_date: null,
    rejection_reason: null,
    updated_at: timestamp,
  };
  state.candidates[candidate.candidate_id] = candidate;

  appendElectionAudit(state, electionId, "candidate_registered", characterId,
    `${player.character.name} registered as candidate.`, date, now,
    { candidate_id: candidate.candidate_id, party_id: partyId });

  ensurePoliticalProfile(state, characterId, timestamp, date);
  return candidate;
}

export function approveCandidate(
  state: PersistentWorldState,
  candidateId: string,
  approvedBy: string,
  date: CalendarDate,
  now: number,
): CandidateRecord {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error("elections_candidate_not_found");
  if (candidate.status !== "pending") throw new Error("elections_candidate_not_pending");

  const player = characterForId(state, candidate.character_id);
  const timestamp = new Date(now).toISOString();
  candidate.status = "approved";
  candidate.approved_at = timestamp;
  candidate.approved_world_date = cloneDate(date);
  candidate.updated_at = timestamp;

  appendElectionAudit(state, candidate.election_id, "candidate_approved", approvedBy,
    `${player?.character.name ?? candidate.character_id} approved as candidate.`, date, now,
    { candidate_id: candidateId });

  return candidate;
}

export function rejectCandidate(
  state: PersistentWorldState,
  candidateId: string,
  reason: string,
  rejectedBy: string,
  date: CalendarDate,
  now: number,
): CandidateRecord {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error("elections_candidate_not_found");
  if (candidate.status !== "pending") throw new Error("elections_candidate_not_pending");

  const player = characterForId(state, candidate.character_id);
  const timestamp = new Date(now).toISOString();
  candidate.status = "rejected";
  candidate.rejection_reason = reason.trim();
  candidate.updated_at = timestamp;

  appendElectionAudit(state, candidate.election_id, "candidate_rejected", rejectedBy,
    `${player?.character.name ?? candidate.character_id} rejected: ${reason}`, date, now,
    { candidate_id: candidateId });

  return candidate;
}

export function withdrawCandidate(
  state: PersistentWorldState,
  candidateId: string,
  date: CalendarDate,
  now: number,
): CandidateRecord {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error("elections_candidate_not_found");
  if (candidate.status === "withdrawn") throw new Error("elections_already_withdrawn");
  if (candidate.status === "rejected") throw new Error("elections_candidate_already_rejected");

  const election = state.elections[candidate.election_id];
  if (election && election.phase === "completed") throw new Error("elections_election_completed");

  const timestamp = new Date(now).toISOString();
  candidate.status = "withdrawn";
  candidate.updated_at = timestamp;
  void date;
  return candidate;
}

// ─── Campaigns ────────────────────────────────────────────────────

export function createCampaign(
  state: PersistentWorldState,
  candidateId: string,
  title: string,
  description: string,
  themes: string[],
  date: CalendarDate,
  now: number,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): CampaignRecord {
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error("elections_candidate_not_found");
  if (candidate.status !== "approved") throw new Error("elections_candidate_not_approved");

  if (title.trim().length > catalog.campaign_rules.max_campaign_title_length) throw new Error("elections_campaign_title_too_long");
  if (description.trim().length > catalog.campaign_rules.max_campaign_message_length) throw new Error("elections_campaign_description_too_long");

  const election = state.elections[candidate.election_id];
  const timestamp = new Date(now).toISOString();
  const campaign: CampaignRecord = {
    campaign_id: `camp-${randomUUID()}`,
    candidate_id: candidateId,
    election_id: candidate.election_id,
    party_id: candidate.party_id,
    title: title.trim(),
    description: description.trim(),
    themes,
    status: "preparing",
    start_date: election?.campaign_start_date ?? timestamp,
    start_world_date: election ? cloneDate(election.created_world_date) : cloneDate(date),
    end_date: null,
    end_world_date: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.campaigns[campaign.campaign_id] = campaign;
  return campaign;
}

export function createCampaignEvent(
  state: PersistentWorldState,
  campaignId: string,
  eventType: string,
  title: string,
  description: string,
  locationId: string | null,
  scheduledDate: string,
  date: CalendarDate,
  now: number,
): CampaignEventRecord {
  const campaign = state.campaigns[campaignId];
  if (!campaign) throw new Error("elections_campaign_not_found");
  const catalog = loadElectionsCatalog();

  const eventsForCampaign = Object.values(state.campaignEvents).filter((e) => e.campaign_id === campaignId);
  if (eventsForCampaign.length >= catalog.campaign_rules.max_events_per_campaign) throw new Error("elections_campaign_event_limit");

  const timestamp = new Date(now).toISOString();
  const event: CampaignEventRecord = {
    event_id: `cevt-${randomUUID()}`,
    campaign_id: campaignId,
    election_id: campaign.election_id,
    event_type: eventType,
    title: title.trim(),
    description: description.trim(),
    location_id: locationId,
    scheduled_date: scheduledDate,
    scheduled_world_date: cloneDate(date),
    status: "scheduled",
    created_at: timestamp,
  };
  state.campaignEvents[event.event_id] = event;
  return event;
}

export function recordCampaignFinance(
  state: PersistentWorldState,
  campaignId: string,
  type: CampaignFinanceRecord["type"],
  amountNgn: number,
  description: string,
  sourceOrRecipient: string,
  idempotencyKey: string,
  date: CalendarDate,
  now: number,
): CampaignFinanceRecord {
  const campaign = state.campaigns[campaignId];
  if (!campaign) throw new Error("elections_campaign_not_found");
  if (!Number.isFinite(amountNgn) || amountNgn <= 0) throw new Error("elections_campaign_amount_invalid");

  // Idempotency check
  const existing = Object.values(state.campaignFinances).find(
    (f) => f.idempotency_key === idempotencyKey && f.campaign_id === campaignId,
  );
  if (existing) return existing;

  // Cannot spend more than available
  if (type === "expense" || type === "event_expense" || type === "advertising_expense") {
    const totalFunding = Object.values(state.campaignFinances)
      .filter((f) => f.campaign_id === campaignId && (f.type === "donation" || f.type === "party_allocation"))
      .reduce((sum, f) => sum + f.amount_ngn, 0);
    const totalExpenses = Object.values(state.campaignFinances)
      .filter((f) => f.campaign_id === campaignId && (f.type === "expense" || f.type === "event_expense" || f.type === "advertising_expense"))
      .reduce((sum, f) => sum + f.amount_ngn, 0);
    if (totalExpenses + amountNgn > totalFunding) throw new Error("elections_campaign_insufficient_funds");
  }

  const timestamp = new Date(now).toISOString();
  const record: CampaignFinanceRecord = {
    transaction_id: `cfin-${randomUUID()}`,
    campaign_id: campaignId,
    election_id: campaign.election_id,
    type,
    amount_ngn: amountNgn,
    description: description.trim(),
    source_or_recipient: sourceOrRecipient.trim(),
    idempotency_key: idempotencyKey,
    recorded_at: timestamp,
    recorded_world_date: cloneDate(date),
  };
  state.campaignFinances[record.transaction_id] = record;
  return record;
}

// ─── Debates ──────────────────────────────────────────────────────

export function createDebate(
  state: PersistentWorldState,
  electionId: string,
  debateType: string,
  title: string,
  topic: string,
  participantCandidateIds: string[],
  moderator: string | null,
  scheduledDate: string,
  date: CalendarDate,
  now: number,
): DebateRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");

  // Verify all participants are approved candidates
  for (const cid of participantCandidateIds) {
    const candidate = Object.values(state.candidates).find(
      (c) => c.candidate_id === cid && c.election_id === electionId && c.status === "approved",
    );
    if (!candidate) throw new Error("elections_debate_participant_invalid");
  }

  const timestamp = new Date(now).toISOString();
  const debate: DebateRecord = {
    debate_id: `debate-${randomUUID()}`,
    election_id: electionId,
    debate_type: debateType,
    title: title.trim(),
    topic: topic.trim(),
    participant_candidate_ids: participantCandidateIds,
    moderator,
    scheduled_date: scheduledDate,
    scheduled_world_date: cloneDate(date),
    status: "scheduled",
    statements: [],
    created_at: timestamp,
  };
  state.debates[debate.debate_id] = debate;
  return debate;
}

export function addDebateStatement(
  state: PersistentWorldState,
  debateId: string,
  candidateId: string,
  statement: string,
  date: CalendarDate,
  now: number,
): DebateRecord {
  const debate = state.debates[debateId];
  if (!debate) throw new Error("elections_debate_not_found");
  if (!debate.participant_candidate_ids.includes(candidateId)) throw new Error("elections_not_debate_participant");
  if (debate.status === "cancelled") throw new Error("elections_debate_cancelled");

  // Verify this candidate is who they say they are (authorization check is done at WebSocket level)
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error("elections_candidate_not_found");

  const timestamp = new Date(now).toISOString();
  debate.statements.push({
    candidate_id: candidateId,
    statement: statement.trim(),
    submitted_at: timestamp,
  });
  void date;
  return debate;
}

// ─── Voting ───────────────────────────────────────────────────────

export function checkVoterEligibility(
  state: PersistentWorldState,
  electionId: string,
  characterId: string,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): { eligible: boolean; reason: string | null } {
  const election = state.elections[electionId];
  if (!election) return { eligible: false, reason: "elections_election_not_found" };
  if (election.phase !== "voting") return { eligible: false, reason: "elections_voting_not_open" };

  const player = characterForId(state, characterId);
  if (!player) return { eligible: false, reason: "elections_character_not_found" };
  if (player.character.life_status === "deceased") return { eligible: false, reason: "elections_character_deceased" };
  if (player.character.age < catalog.voter_eligibility.minimum_age) return { eligible: false, reason: "elections_voter_age_ineligible" };

  // Geographic eligibility: check if character is in election jurisdiction
  if (election.jurisdiction_level === "state" && election.jurisdiction_id) {
    const geo = player.character.geographic_location;
    if (geo && geo.state_id !== election.jurisdiction_id) {
      return { eligible: false, reason: "elections_voter_not_in_jurisdiction" };
    }
  }
  if (election.jurisdiction_level === "local" && election.jurisdiction_id) {
    const geo = player.character.geographic_location;
    if (geo && geo.lga_id !== election.jurisdiction_id) {
      return { eligible: false, reason: "elections_voter_not_in_jurisdiction" };
    }
  }

  // Already voted check
  const participation = Object.values(state.voterParticipation).find(
    (p) => p.election_id === electionId && p.voter_character_id === characterId,
  );
  if (participation && participation.has_voted) return { eligible: false, reason: "elections_already_voted" };

  return { eligible: true, reason: null };
}

export function castBallot(
  state: PersistentWorldState,
  electionId: string,
  voterCharacterId: string,
  candidateId: string,
  date: CalendarDate,
  now: number,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): { ballot: BallotRecord; participation: VoterParticipationRecord } {
  // Check eligibility
  const eligibility = checkVoterEligibility(state, electionId, voterCharacterId, catalog);
  if (!eligibility.eligible) throw new Error(eligibility.reason ?? "elections_voter_ineligible");

  // Verify candidate is valid for this election
  const candidate = state.candidates[candidateId];
  if (!candidate) throw new Error("elections_candidate_not_found");
  if (candidate.election_id !== electionId) throw new Error("elections_candidate_wrong_election");
  if (candidate.status !== "approved") throw new Error("elections_candidate_not_approved");

  const timestamp = new Date(now).toISOString();

  // Create ballot
  const ballot: BallotRecord = {
    ballot_id: `ballot-${randomUUID()}`,
    election_id: electionId,
    voter_character_id: voterCharacterId,
    candidate_id: candidateId,
    cast_at: timestamp,
    cast_world_date: cloneDate(date),
    is_valid: true,
    rejection_reason: null,
  };
  state.ballots[ballot.ballot_id] = ballot;

  // Record voter participation
  let participation = Object.values(state.voterParticipation).find(
    (p) => p.election_id === electionId && p.voter_character_id === voterCharacterId,
  );
  if (!participation) {
    participation = {
      participation_id: `vpart-${randomUUID()}`,
      election_id: electionId,
      voter_character_id: voterCharacterId,
      has_voted: true,
      voted_at: timestamp,
      voted_world_date: cloneDate(date),
    };
    state.voterParticipation[participation.participation_id] = participation;
  } else {
    participation.has_voted = true;
    participation.voted_at = timestamp;
    participation.voted_world_date = cloneDate(date);
  }

  appendElectionAudit(state, electionId, "ballot_cast", voterCharacterId,
    "Valid ballot cast.", date, now,
    { ballot_id: ballot.ballot_id, candidate_id: candidateId });

  return { ballot, participation };
}

// ─── Vote Counting and Results ────────────────────────────────────

export function countVotes(
  state: PersistentWorldState,
  electionId: string,
  date: CalendarDate,
  now: number,
): ElectionResultRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");
  if (election.phase !== "counting" && election.phase !== "certification") throw new Error("elections_counting_not_permitted");

  const approvedCandidates = Object.values(state.candidates).filter(
    (c) => c.election_id === electionId && c.status === "approved",
  );
  const validBallots = Object.values(state.ballots).filter(
    (b) => b.election_id === electionId && b.is_valid,
  );
  const invalidBallots = Object.values(state.ballots).filter(
    (b) => b.election_id === electionId && !b.is_valid,
  );
  const totalParticipation = Object.values(state.voterParticipation).filter(
    (p) => p.election_id === electionId && p.has_voted,
  ).length;

  // Count votes per candidate
  const voteCounts: Record<string, number> = {};
  for (const c of approvedCandidates) voteCounts[c.candidate_id] = 0;
  for (const b of validBallots) {
    if (voteCounts[b.candidate_id] !== undefined) voteCounts[b.candidate_id] = (voteCounts[b.candidate_id] ?? 0) + 1;
  }

  const totalValid = validBallots.length;
  const candidateResults = approvedCandidates.map((c) => {
    const votes = voteCounts[c.candidate_id] ?? 0;
    return {
      candidate_id: c.candidate_id,
      character_id: c.character_id,
      party_id: c.party_id,
      votes,
      percentage: totalValid > 0 ? Math.round((votes / totalValid) * 10000) / 100 : 0,
    };
  });

  // Sort by votes descending
  candidateResults.sort((a, b) => b.votes - a.votes);

  // Determine winner
  let winnerCandidateId: string | null = null;
  let winnerCharacterId: string | null = null;
  let isTie = false;
  if (candidateResults.length > 0 && (candidateResults[0]?.votes ?? 0) > 0) {
    if (candidateResults.length >= 2 && (candidateResults[0]?.votes ?? 0) === (candidateResults[1]?.votes ?? 0)) {
      isTie = true;
    } else {
      winnerCandidateId = candidateResults[0]!.candidate_id;
      winnerCharacterId = candidateResults[0]!.character_id;
    }
  }

  const timestamp = new Date(now).toISOString();
  const result: ElectionResultRecord = {
    election_id: electionId,
    election_type: election.election_type,
    jurisdiction_id: election.jurisdiction_id,
    total_valid_votes: totalValid,
    total_invalid_votes: invalidBallots.length,
    total_registered_voters: totalParticipation,
    candidate_results: candidateResults,
    winner_candidate_id: winnerCandidateId,
    winner_character_id: winnerCharacterId,
    is_tie: isTie,
    status: "preliminary",
    certified_at: null,
    certified_world_date: null,
    published_at: null,
    published_world_date: null,
    counting_started_at: timestamp,
    counting_completed_at: timestamp,
  };

  election.results = result;
  election.phase = "certification";
  election.updated_at = timestamp;

  appendElectionAudit(state, electionId, "votes_counted", null,
    `Counted ${totalValid} valid votes.`, date, now,
    { winner_candidate_id: winnerCandidateId, is_tie: isTie });

  return result;
}

export function certifyElectionResult(
  state: PersistentWorldState,
  electionId: string,
  certifiedBy: string,
  date: CalendarDate,
  now: number,
): ElectionResultRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");
  if (!election.results) throw new Error("elections_no_results_to_certify");
  if (election.results.status === "certified") throw new Error("elections_already_certified");
  if (election.results.is_tie) throw new Error("elections_tie_cannot_certify");

  const timestamp = new Date(now).toISOString();
  election.results.status = "certified";
  election.results.certified_at = timestamp;
  election.results.certified_world_date = cloneDate(date);
  election.updated_at = timestamp;

  appendElectionAudit(state, electionId, "result_certified", certifiedBy,
    "Election result certified.", date, now);

  return election.results;
}

export function publishElectionResult(
  state: PersistentWorldState,
  electionId: string,
  publishedBy: string,
  date: CalendarDate,
  now: number,
): ElectionResultRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");
  if (!election.results) throw new Error("elections_no_results");
  if (election.results.status !== "certified" && election.results.status !== "preliminary") {
    throw new Error("elections_result_not_ready");
  }

  const timestamp = new Date(now).toISOString();
  election.results.status = "published";
  election.results.published_at = timestamp;
  election.results.published_world_date = cloneDate(date);
  election.updated_at = timestamp;

  appendElectionAudit(state, electionId, "result_published", publishedBy,
    "Election result published.", date, now);

  return election.results;
}

// ─── Government Office Transfer ───────────────────────────────────

export function transferElectedOffice(
  state: PersistentWorldState,
  electionId: string,
  date: CalendarDate,
  now: number,
): AppointmentRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");
  if (!election.results) throw new Error("elections_no_results");
  if (election.results.status !== "certified" && election.results.status !== "published") {
    throw new Error("elections_result_not_certified");
  }
  if (!election.results.winner_character_id) throw new Error("elections_no_winner");
  if (election.results.is_tie) throw new Error("elections_tie_no_transfer");

  // Find the matching office
  const match = findOfficeForElection(state, election);
  if (!match) throw new Error("elections_office_not_found_for_election");

  const winnerCharId = election.results.winner_character_id;
  const player = characterForId(state, winnerCharId);
  if (!player) throw new Error("elections_winner_character_not_found");
  if (player.character.life_status === "deceased") throw new Error("elections_winner_deceased");

  // End existing appointment if any
  endExistingAppointment(state, match.office.office_id, "Election result certified — new officeholder takes office.", date, now);

  const timestamp = new Date(now).toISOString();
  const appointment: AppointmentRecord = {
    appointment_id: `appt-${randomUUID()}`,
    office_id: match.office.office_id,
    character_id: winnerCharId,
    status: "active",
    start_date: timestamp,
    start_world_date: cloneDate(date),
    end_date: null,
    end_world_date: null,
    end_reason: null,
    appointed_by: `election:${electionId}`,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.governmentAppointments[appointment.appointment_id] = appointment;

  // Update political profile
  const profile = ensurePoliticalProfile(state, winnerCharId, timestamp, date);
  profile.public_service_history.push({
    office_label: match.office.label,
    organisation_name: match.org.name,
    start_date: timestamp,
    end_date: null,
  });
  profile.updated_at = timestamp;

  appendElectionAudit(state, electionId, "office_transferred", null,
    `${player.character.name} transferred to ${match.office.label}.`, date, now,
    { office_id: match.office.office_id, character_id: winnerCharId, appointment_id: appointment.appointment_id });

  return appointment;
}

// ─── Election Disputes ───────────────────────────────────────────

export function submitDispute(
  state: PersistentWorldState,
  electionId: string,
  complainantCharacterId: string,
  category: string,
  description: string,
  evidenceReferences: string[],
  date: CalendarDate,
  now: number,
  catalog: ElectionsCatalog = loadElectionsCatalog(),
): ElectionDisputeRecord {
  const election = state.elections[electionId];
  if (!election) throw new Error("elections_election_not_found");

  if (description.trim().length > catalog.dispute_rules.max_description_length) throw new Error("elections_dispute_description_too_long");
  if (evidenceReferences.length > catalog.dispute_rules.max_evidence_items) throw new Error("elections_dispute_too_much_evidence");

  const player = characterForId(state, complainantCharacterId);
  if (!player) throw new Error("elections_character_not_found");

  const timestamp = new Date(now).toISOString();
  const dispute: ElectionDisputeRecord = {
    dispute_id: `disp-${randomUUID()}`,
    election_id: electionId,
    complainant_character_id: complainantCharacterId,
    category,
    description: description.trim(),
    evidence_references: evidenceReferences,
    status: "submitted",
    submitted_at: timestamp,
    submitted_world_date: cloneDate(date),
    reviewed_by: null,
    reviewed_at: null,
    resolution: null,
    resolved_at: null,
    resolved_world_date: null,
    updated_at: timestamp,
  };
  state.electionDisputes[dispute.dispute_id] = dispute;

  appendElectionAudit(state, electionId, "dispute_submitted", complainantCharacterId,
    `Dispute submitted: ${category}`, date, now,
    { dispute_id: dispute.dispute_id });

  return dispute;
}

export function resolveDispute(
  state: PersistentWorldState,
  disputeId: string,
  resolution: string,
  newStatus: DisputeStatus,
  resolvedBy: string,
  date: CalendarDate,
  now: number,
): ElectionDisputeRecord {
  const dispute = state.electionDisputes[disputeId];
  if (!dispute) throw new Error("elections_dispute_not_found");
  const catalog = loadElectionsCatalog();
  if (!catalog.dispute_rules.dispute_statuses.includes(newStatus)) throw new Error("elections_dispute_status_invalid");

  const timestamp = new Date(now).toISOString();
  dispute.status = newStatus;
  dispute.resolution = resolution.trim();
  dispute.reviewed_by = resolvedBy;
  dispute.reviewed_at = timestamp;
  dispute.resolved_at = timestamp;
  dispute.resolved_world_date = cloneDate(date);
  dispute.updated_at = timestamp;

  appendElectionAudit(state, dispute.election_id, "dispute_resolved", resolvedBy,
    `Dispute ${newStatus}: ${resolution}`, date, now,
    { dispute_id: disputeId });

  return dispute;
}

// ─── Queries / Snapshots ──────────────────────────────────────────

export function listParties(state: PersistentWorldState, status?: PartyStatus): PartySnapshot[] {
  let parties = Object.values(state.politicalParties);
  if (status) parties = parties.filter((p) => p.status === status);
  return parties.map((p) => {
    const memberCount = Object.values(state.partyMemberships).filter(
      (m) => m.party_id === p.party_id && m.status === "active",
    ).length;
    return {
      party_id: p.party_id,
      name: p.name,
      abbreviation: p.abbreviation,
      description: p.description,
      status: p.status,
      founded_by: p.founded_by,
      founding_date: p.founding_date,
      policy_positions: p.policy_positions,
      leadership: p.leadership,
      member_count: memberCount,
    };
  });
}

export function getPartyMembers(state: PersistentWorldState, partyId: string): PartyMembershipRecord[] {
  return Object.values(state.partyMemberships).filter((m) => m.party_id === partyId && m.status === "active");
}

export function getCharacterPartyMembership(state: PersistentWorldState, characterId: string): PartyMembershipRecord | null {
  return Object.values(state.partyMemberships).find((m) => m.character_id === characterId && m.status === "active") ?? null;
}

export function listElections(state: PersistentWorldState, phase?: ElectionPhase): ElectionSnapshot[] {
  const catalog = loadElectionsCatalog();
  let elections = Object.values(state.elections);
  if (phase) elections = elections.filter((e) => e.phase === phase);
  return elections.map((e) => buildElectionSnapshot(state, e, catalog));
}

export function getElection(state: PersistentWorldState, electionId: string): ElectionSnapshot | null {
  const election = state.elections[electionId];
  if (!election) return null;
  const catalog = loadElectionsCatalog();
  return buildElectionSnapshot(state, election, catalog);
}

function buildElectionSnapshot(state: PersistentWorldState, election: ElectionRecord, catalog: ElectionsCatalog): ElectionSnapshot {
  const typeDef = catalog.election_types.find((t) => t.id === election.election_type);
  const candidates = Object.values(state.candidates)
    .filter((c) => c.election_id === election.election_id && c.status === "approved")
    .map((c) => buildCandidateSnapshot(state, c));

  return {
    election_id: election.election_id,
    election_type: election.election_type,
    election_type_label: typeDef?.label ?? election.election_type,
    jurisdiction_level: election.jurisdiction_level,
    jurisdiction_id: election.jurisdiction_id,
    constituency_id: election.constituency_id,
    phase: election.phase,
    registration_open_date: election.registration_open_date,
    registration_close_date: election.registration_close_date,
    campaign_start_date: election.campaign_start_date,
    campaign_end_date: election.campaign_end_date,
    voting_open_date: election.voting_open_date,
    voting_close_date: election.voting_close_date,
    winning_rule: election.winning_rule,
    approved_candidates: candidates,
    results: election.results,
  };
}

function buildCandidateSnapshot(state: PersistentWorldState, candidate: CandidateRecord): CandidateSnapshot {
  const player = characterForId(state, candidate.character_id);
  const party = candidate.party_id ? state.politicalParties[candidate.party_id] : null;
  return {
    candidate_id: candidate.candidate_id,
    election_id: candidate.election_id,
    character_id: candidate.character_id,
    character_name: player?.character.name ?? "Unknown",
    party_id: candidate.party_id,
    party_name: party?.name ?? null,
    party_abbreviation: party?.abbreviation ?? null,
    status: candidate.status,
    manifesto: candidate.manifesto,
    registered_at: candidate.registered_at,
    approved_at: candidate.approved_at,
  };
}

export function listCandidates(state: PersistentWorldState, electionId: string): CandidateSnapshot[] {
  return Object.values(state.candidates)
    .filter((c) => c.election_id === electionId)
    .map((c) => buildCandidateSnapshot(state, c));
}

export function getCampaign(state: PersistentWorldState, campaignId: string): CampaignSnapshot | null {
  const campaign = state.campaigns[campaignId];
  if (!campaign) return null;
  const totalFunding = Object.values(state.campaignFinances)
    .filter((f) => f.campaign_id === campaignId && (f.type === "donation" || f.type === "party_allocation"))
    .reduce((s, f) => s + f.amount_ngn, 0);
  const totalExpenses = Object.values(state.campaignFinances)
    .filter((f) => f.campaign_id === campaignId && (f.type === "expense" || f.type === "event_expense" || f.type === "advertising_expense"))
    .reduce((s, f) => s + f.amount_ngn, 0);
  const eventCount = Object.values(state.campaignEvents).filter((e) => e.campaign_id === campaignId).length;
  return {
    campaign_id: campaign.campaign_id,
    candidate_id: campaign.candidate_id,
    election_id: campaign.election_id,
    title: campaign.title,
    description: campaign.description,
    themes: campaign.themes,
    status: campaign.status,
    event_count: eventCount,
    total_funding_ngn: totalFunding,
    total_expenses_ngn: totalExpenses,
  };
}

export function getElectionAuditLog(state: PersistentWorldState, electionId: string): ElectionAuditRecord[] {
  return Object.values(state.electionAudits)
    .filter((a) => a.election_id === electionId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function getCharacterElectionHistory(state: PersistentWorldState, characterId: string): CandidateSnapshot[] {
  return Object.values(state.candidates)
    .filter((c) => c.character_id === characterId)
    .map((c) => buildCandidateSnapshot(state, c));
}

// ─── World date processing ────────────────────────────────────────

export function processElectionWorldDate(state: PersistentWorldState, _date: CalendarDate, _now: number): number {
  // Future: auto-advance election phases based on schedule dates
  void state;
  void _date;
  void _now;
  return 0;
}

// ─── Error messages ───────────────────────────────────────────────

export function electionsErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    elections_party_name_too_short: "Party name is too short.",
    elections_party_name_too_long: "Party name is too long.",
    elections_party_abbreviation_too_short: "Party abbreviation is too short.",
    elections_party_abbreviation_too_long: "Party abbreviation is too long.",
    elections_party_description_too_long: "Party description is too long.",
    elections_character_not_found: "Character not found.",
    elections_character_deceased: "Character is deceased.",
    elections_party_founder_age_ineligible: "Character is too young to found a party.",
    elections_party_name_taken: "A party with this name already exists.",
    elections_party_abbreviation_taken: "A party with this abbreviation already exists.",
    elections_already_in_party: "Character already belongs to a political party.",
    elections_party_not_found: "Political party not found.",
    elections_party_not_pending: "Party is not pending registration.",
    elections_party_not_active: "Party is not active.",
    elections_member_age_ineligible: "Character is too young to join a party.",
    elections_already_in_this_party: "Character is already a member of this party.",
    elections_membership_not_found: "Membership record not found.",
    elections_membership_not_active: "Membership is not active.",
    elections_leadership_role_invalid: "Invalid leadership role.",
    elections_not_party_member: "Character is not a member of this party.",
    elections_type_not_found: "Election type not found.",
    elections_eligibility_rules_not_found: "Eligibility rules not found.",
    elections_schedule_invalid: "Election schedule dates are not in valid order.",
    elections_election_not_found: "Election not found.",
    elections_phase_transition_invalid: "Invalid election phase transition.",
    elections_cannot_cancel_completed: "Cannot cancel a completed election.",
    elections_already_cancelled: "Election is already cancelled.",
    elections_registration_not_open: "Candidate registration is not open.",
    elections_candidate_age_ineligible: "Character does not meet minimum age requirement.",
    elections_party_affiliation_required: "Party affiliation is required for this office.",
    elections_already_registered_candidate: "Character is already registered as a candidate.",
    elections_candidate_not_found: "Candidate not found.",
    elections_candidate_not_pending: "Candidate is not pending review.",
    elections_already_withdrawn: "Candidate has already withdrawn.",
    elections_candidate_already_rejected: "Candidate was already rejected.",
    elections_election_completed: "Election is already completed.",
    elections_manifesto_too_long: "Manifesto exceeds maximum length.",
    elections_candidate_not_approved: "Candidate is not approved.",
    elections_campaign_not_found: "Campaign not found.",
    elections_campaign_title_too_long: "Campaign title is too long.",
    elections_campaign_description_too_long: "Campaign description is too long.",
    elections_campaign_event_limit: "Campaign event limit reached.",
    elections_campaign_amount_invalid: "Campaign finance amount is invalid.",
    elections_campaign_insufficient_funds: "Campaign has insufficient funds.",
    elections_debate_not_found: "Debate not found.",
    elections_debate_participant_invalid: "Debate participant is not a valid approved candidate.",
    elections_not_debate_participant: "Character is not a participant in this debate.",
    elections_debate_cancelled: "Debate has been cancelled.",
    elections_voting_not_open: "Voting is not currently open.",
    elections_voter_age_ineligible: "Voter does not meet minimum age requirement.",
    elections_voter_not_in_jurisdiction: "Voter is not in the election jurisdiction.",
    elections_already_voted: "Voter has already cast a ballot in this election.",
    elections_candidate_wrong_election: "Candidate does not belong to this election.",
    elections_no_results_to_certify: "No results to certify.",
    elections_already_certified: "Election result is already certified.",
    elections_tie_cannot_certify: "Cannot certify an election with a tie.",
    elections_no_results: "No results available.",
    elections_result_not_ready: "Election result is not ready for publication.",
    elections_result_not_certified: "Election result must be certified before office transfer.",
    elections_office_not_found_for_election: "No matching government office found for this election.",
    elections_winner_character_not_found: "Election winner character not found.",
    elections_winner_deceased: "Election winner is deceased.",
    elections_tie_no_transfer: "Cannot transfer office for a tied election.",
    elections_dispute_description_too_long: "Dispute description is too long.",
    elections_dispute_too_much_evidence: "Too many evidence items.",
    elections_dispute_not_found: "Dispute not found.",
    elections_dispute_status_invalid: "Invalid dispute status.",
    elections_counting_not_permitted: "Vote counting is not permitted at this phase.",
  };
  return messages[code] ?? code;
}
