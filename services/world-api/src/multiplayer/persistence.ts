import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { geographicLocationIsValid } from "../geography/catalog.js";
import { loadEducationCatalog } from "../education/catalog.js";
import { isEducationStudentRecord, normalizeEducationRecord, syncLegacyEducation } from "../education/service.js";
import { loadLifeCatalog, normalizeWorldClock, isValidDate } from "../life/calendar.js";
import { normalizeLifeWorldState } from "../life/service.js";
import { initializeCareerWorldState } from "../careers/service.js";
import { initializeEconomyWorldState } from "../economy/service.js";
import { initializeBusinessWorldState } from "../businesses/service.js";
import { initializePropertyWorldState } from "../properties/service.js";
import { initializeGovernmentWorldState } from "../government/service.js";
import { initializeElectionWorldState } from "../elections/service.js";
import { initializeJusticeWorldState } from "../justice/service.js";
import { emptyPoliceMaps, initializePoliceWorldState } from "../police/service.js";
import { emptyMilitaryMaps, initializeMilitaryWorldState } from "../military/service.js";
import type { PersistentElectionMaps } from "../elections/types.js";
import type { PersistentJusticeMaps } from "../justice/types.js";
import type { PersistentPoliceMaps } from "../police/types.js";
import type { PersistentMilitaryMaps } from "../military/types.js";
import type { LifeCatalog } from "../life/types.js";
import type { PersistentCareerMaps } from "../careers/types.js";
import type { PersistentEconomyMaps } from "../economy/types.js";
import type { PersistentBusinessMaps } from "../businesses/types.js";
import type { PersistentPropertyMaps } from "../properties/types.js";
import type { PersistentGovernmentMaps } from "../government/types.js";
import {
  WORLD_ID,
  isFiniteNumber,
  isRecord,
  type PersistentPlayer,
  type PersistentWorldState,
  type Point2D,
} from "./types.js";

const MAX_STATE_FILE_BYTES = 16 * 1024 * 1024;
const CHARACTER_TYPES = new Set(["girl", "boy", "androgynous"]);
const LIFE_STATUSES = new Set(["alive", "retired", "deceased"]);
const RELATIONSHIP_TYPES = new Set([
  "parent_of", "guardian_of", "sibling_of", "friendship", "romantic", "spouse",
]);
const RELATIONSHIP_STATUSES = new Set(["pending", "active", "ended", "bereaved"]);
const LIFE_EVENT_TYPES = new Set([
  "character_created", "family_created", "birthday", "life_stage_changed", "friendship_started",
  "relationship_stage_changed", "marriage", "childbirth", "retirement", "death", "inheritance_hook_created",
]);
const DEATH_CAUSES = new Set([
  "old_age", "illness", "accident", "violence", "poisoning_or_exposure", "other",
]);

function isPoint(value: unknown): value is Point2D {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCharacterBase(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return typeof value.player_id === "string" &&
    typeof value.character_id === "string" &&
    typeof value.name === "string" &&
    isFiniteNumber(value.age) && Number.isSafeInteger(value.age) && value.age >= 0 && value.age <= 9998 &&
    CHARACTER_TYPES.has(String(value.character_type)) &&
    isStringRecord(value.appearance) &&
    isFiniteNumber(value.money) && value.money >= 0 &&
    isFiniteNumber(value.health) && value.health >= 0 && value.health <= 100 &&
    isFiniteNumber(value.energy) && value.energy >= 0 && value.energy <= 100 &&
    isFiniteNumber(value.hunger) && value.hunger >= 0 && value.hunger <= 100 &&
    typeof value.education_level === "string" &&
    typeof value.school_id === "string" &&
    typeof value.home_id === "string" &&
    typeof value.current_location === "string" &&
    isPoint(value.position) && isPoint(value.direction) &&
    Array.isArray(value.inventory) && value.inventory.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.name === "string" &&
      isFiniteNumber(item.quantity) && item.quantity >= 0 && typeof item.category === "string" &&
      (item.hunger_restore === undefined || isFiniteNumber(item.hunger_restore))) &&
    isRecord(value.academic_scores) && Object.values(value.academic_scores).every((score) =>
      isFiniteNumber(score) && score >= 0 && score <= 100) &&
    Array.isArray(value.attendance) && value.attendance.every(isRecord) &&
    isFiniteNumber(value.reputation) &&
    (value.education_record === undefined || isEducationStudentRecord(value.education_record)) &&
    isRecord(value.household) &&
    (value.geographic_location === undefined || value.geographic_location === null ||
      geographicLocationIsValid(value.geographic_location)) &&
    typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function hasLifeFields(value: Record<string, unknown>): boolean {
  return isValidDate(value.date_of_birth) &&
    typeof value.life_stage_id === "string" && value.life_stage_id.length > 0 &&
    typeof value.life_status === "string" && LIFE_STATUSES.has(value.life_status) &&
    typeof value.household_id === "string" &&
    isStringArray(value.family_ids) && isStringArray(value.life_event_ids) &&
    isStringArray(value.relationship_ids) && isValidDate(value.last_life_processed_date) &&
    isStringArray(value.inheritance_event_ids) &&
    (value.death_cause === undefined || (typeof value.death_cause === "string" && DEATH_CAUSES.has(value.death_cause))) &&
    (value.death_date === undefined || isValidDate(value.death_date)) &&
    (value.age_at_death === undefined || (Number.isSafeInteger(value.age_at_death) &&
      isFiniteNumber(value.age_at_death) && value.age_at_death >= 0 && value.age_at_death <= 9998)) &&
    (value.retirement_date === undefined || isValidDate(value.retirement_date));
}

function isPersistentPlayerBase(value: unknown, playerId: string): value is Record<string, unknown> {
  return isRecord(value) && value.playerId === playerId &&
    typeof value.tokenHash === "string" && /^[a-f0-9]{64}$/.test(value.tokenHash) &&
    typeof value.creationKeyHash === "string" && /^[a-f0-9]{64}$/.test(value.creationKeyHash) &&
    Array.isArray(value.recentRequestIds) && value.recentRequestIds.length <= 256 &&
    value.recentRequestIds.every((requestId) => typeof requestId === "string" && requestId.length <= 80) &&
    typeof value.createdAt === "string" && typeof value.lastSeen === "string" &&
    isCharacterBase(value.character) && value.character.player_id === playerId;
}

function isFamilyPerson(value: unknown, key: string): boolean {
  return isRecord(value) && value.person_id === key && typeof value.name === "string" &&
    isFiniteNumber(value.age) && Number.isSafeInteger(value.age) && value.age >= 0 && value.age <= 9998 &&
    hasLifeFields(value) && ["parent", "guardian", "sibling", "child", "relative"].includes(String(value.family_role)) &&
    typeof value.home_id === "string" && typeof value.current_location === "string" &&
    typeof value.education_level === "string" && typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isHousehold(value: unknown, key: string): boolean {
  return isRecord(value) && value.household_id === key && typeof value.home_id === "string" &&
    typeof value.home_type === "string" && typeof value.neighborhood_id === "string" &&
    isStringArray(value.family_ids) && isStringArray(value.member_ids) &&
    typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isFamily(value: unknown, key: string): boolean {
  return isRecord(value) && value.family_id === key && typeof value.family_name === "string" &&
    isStringArray(value.member_ids) && isStringArray(value.household_ids) &&
    isStringArray(value.parent_family_ids) && isStringArray(value.life_event_ids) &&
    typeof value.created_at === "string";
}

function isRelationship(value: unknown, key: string): boolean {
  if (!isRecord(value)) return false;
  const stages = ["meet", "get_to_know", "dating", "commitment", "marriage", "friendship"];
  return value.relationship_id === key && typeof value.type === "string" && RELATIONSHIP_TYPES.has(value.type) &&
    Array.isArray(value.participants) && value.participants.length === 2 && value.participants.every((id) => typeof id === "string") &&
    typeof value.status === "string" && RELATIONSHIP_STATUSES.has(value.status) &&
    isValidDate(value.created_world_date) && isValidDate(value.updated_world_date) && isStringArray(value.event_ids) &&
    (value.stage === undefined || (typeof value.stage === "string" && stages.includes(value.stage))) &&
    (value.pending_stage === undefined || (typeof value.pending_stage === "string" && stages.includes(value.pending_stage))) &&
    (value.pending_by === undefined || typeof value.pending_by === "string") &&
    (value.marriage_id === undefined || typeof value.marriage_id === "string");
}

function isLifeEvent(value: unknown, key: string): boolean {
  return isRecord(value) && value.event_id === key && typeof value.event_type === "string" &&
    LIFE_EVENT_TYPES.has(value.event_type) && isValidDate(value.world_date) &&
    Number.isSafeInteger(value.world_day) && isFiniteNumber(value.minute_of_day) &&
    value.minute_of_day >= 0 && value.minute_of_day < 1440 && isStringArray(value.participant_ids) &&
    typeof value.summary === "string" && isRecord(value.data) &&
    (value.family_id === undefined || typeof value.family_id === "string") &&
    (value.household_id === undefined || typeof value.household_id === "string");
}

function isMarriage(value: unknown, key: string): boolean {
  return isRecord(value) && value.marriage_id === key && Array.isArray(value.spouse_ids) &&
    value.spouse_ids.length === 2 && value.spouse_ids.every((id) => typeof id === "string") &&
    isValidDate(value.world_date) && typeof value.household_id === "string" &&
    typeof value.family_id === "string" && typeof value.life_event_id === "string" &&
    ["active", "ended_by_death"].includes(String(value.status));
}

function isInheritanceEvent(value: unknown, key: string): boolean {
  return isRecord(value) && value.inheritance_event_id === key && typeof value.deceased_person_id === "string" &&
    isValidDate(value.world_date) && isStringArray(value.heir_person_ids) &&
    isStringArray(value.asset_reference_ids) && value.status === "pending_review" &&
    typeof value.life_event_id === "string";
}

const CAREER_EMPLOYMENT_STATUSES = new Set([
  "active", "on_leave", "suspended", "resigned", "terminated", "contract_completed", "retired", "deceased",
]);
const CAREER_APPLICATION_STATUSES = new Set([
  "draft", "submitted", "under_review", "interview_requested", "accepted", "rejected", "withdrawn", "expired",
]);
const CAREER_SESSION_STATUSES = new Set(["in_progress", "completed", "invalidated", "cancelled"]);
const CAREER_PAY_FREQUENCIES = new Set(["weekly", "biweekly", "monthly"]);
const CAREER_EMPLOYMENT_TYPES = new Set([
  "full_time", "part_time", "shift", "contract", "temporary", "seasonal", "casual", "apprenticeship", "freelance", "self_employed",
]);

function isCareerEmployer(value: unknown, key: string): boolean {
  return isRecord(value) && value.employer_id === key && typeof value.name === "string" &&
    typeof value.industry_id === "string" && typeof value.kind === "string" && typeof value.location_id === "string" &&
    (value.linked_institution_id === null || typeof value.linked_institution_id === "string") &&
    typeof value.description === "string" && value.prototype_fixture === true &&
    Number.isSafeInteger(value.capacity) && isFiniteNumber(value.capacity) && value.capacity >= 0 &&
    typeof value.active === "boolean" && isStringArray(value.employee_character_ids) &&
    value.employee_character_ids.length <= 50_000 && typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isCareerVacancy(value: unknown, key: string): boolean {
  return isRecord(value) && value.vacancy_id === key &&
    (value.employer_id === null || typeof value.employer_id === "string") && typeof value.job_id === "string" &&
    isFiniteNumber(value.monthly_salary_ngn) && Number.isSafeInteger(value.monthly_salary_ngn) && value.monthly_salary_ngn >= 0 &&
    typeof value.employment_type === "string" && CAREER_EMPLOYMENT_TYPES.has(value.employment_type) &&
    typeof value.pay_frequency === "string" && CAREER_PAY_FREQUENCIES.has(value.pay_frequency) &&
    Number.isSafeInteger(value.openings_total) && isFiniteNumber(value.openings_total) && value.openings_total > 0 &&
    Number.isSafeInteger(value.openings_remaining) && isFiniteNumber(value.openings_remaining) &&
    value.openings_remaining >= 0 && value.openings_remaining <= value.openings_total &&
    ["open", "filled", "closed"].includes(String(value.status)) && value.prototype_fixture === true &&
    typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isCareerApplication(value: unknown, key: string): boolean {
  return isRecord(value) && value.application_id === key && typeof value.character_id === "string" &&
    typeof value.vacancy_id === "string" && typeof value.job_id === "string" &&
    (value.employer_id === null || typeof value.employer_id === "string") &&
    typeof value.status === "string" && CAREER_APPLICATION_STATUSES.has(value.status) &&
    typeof value.created_at === "string" && isValidDate(value.submitted_world_date) && isValidDate(value.review_due_date) &&
    Number.isSafeInteger(value.eligibility_score) && isFiniteNumber(value.eligibility_score) &&
    value.eligibility_score >= 0 && value.eligibility_score <= 100 && typeof value.updated_at === "string" &&
    typeof value.decision_reason === "string" && value.decision_reason.length <= 500 &&
    (value.employment_id === undefined || typeof value.employment_id === "string");
}

function isCareerEmployment(value: unknown, key: string): boolean {
  return isRecord(value) && value.employment_id === key && typeof value.character_id === "string" &&
    typeof value.application_id === "string" && typeof value.vacancy_id === "string" &&
    (value.employer_id === null || typeof value.employer_id === "string") &&
    typeof value.employer_name_at_start === "string" && typeof value.job_id === "string" &&
    typeof value.employment_type === "string" && CAREER_EMPLOYMENT_TYPES.has(value.employment_type) &&
    typeof value.status === "string" && CAREER_EMPLOYMENT_STATUSES.has(value.status) &&
    Number.isSafeInteger(value.salary_ngn_monthly) && isFiniteNumber(value.salary_ngn_monthly) &&
    value.salary_ngn_monthly >= 0 && value.salary_ngn_monthly <= 5_000_000 &&
    typeof value.pay_frequency === "string" && CAREER_PAY_FREQUENCIES.has(value.pay_frequency) &&
    typeof value.work_schedule_id === "string" && isValidDate(value.start_date) && isValidDate(value.pay_period_start_date) &&
    isValidDate(value.next_payment_date) && Number.isSafeInteger(value.completed_sessions) &&
    isFiniteNumber(value.completed_sessions) && value.completed_sessions >= 0 &&
    Number.isSafeInteger(value.performance_score) && isFiniteNumber(value.performance_score) &&
    value.performance_score >= 0 && value.performance_score <= 100 &&
    (value.current_work_session_id === undefined || typeof value.current_work_session_id === "string") &&
    (value.end_date === undefined || isValidDate(value.end_date)) &&
    (value.end_reason === undefined || (typeof value.end_reason === "string" && value.end_reason.length <= 200)) &&
    typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isCareerWorkSession(value: unknown, key: string): boolean {
  return isRecord(value) && value.session_id === key && typeof value.employment_id === "string" &&
    typeof value.character_id === "string" && typeof value.job_id === "string" && isValidDate(value.world_date) &&
    typeof value.schedule_id === "string" && typeof value.workplace_location_id === "string" &&
    Number.isSafeInteger(value.scheduled_start_minute) && isFiniteNumber(value.scheduled_start_minute) &&
    value.scheduled_start_minute >= 0 && value.scheduled_start_minute < 1440 &&
    Number.isSafeInteger(value.scheduled_end_minute) && isFiniteNumber(value.scheduled_end_minute) &&
    value.scheduled_end_minute > value.scheduled_start_minute && value.scheduled_end_minute <= 1440 &&
    Number.isSafeInteger(value.started_at_minute) && isFiniteNumber(value.started_at_minute) &&
    value.started_at_minute >= value.scheduled_start_minute && value.started_at_minute < 1440 &&
    typeof value.status === "string" && CAREER_SESSION_STATUSES.has(value.status) &&
    Number.isSafeInteger(value.worked_minutes) && isFiniteNumber(value.worked_minutes) && value.worked_minutes >= 0 && value.worked_minutes <= 1440 &&
    Number.isSafeInteger(value.gross_earned_ngn) && isFiniteNumber(value.gross_earned_ngn) && value.gross_earned_ngn >= 0 &&
    Number.isSafeInteger(value.performance_score) && isFiniteNumber(value.performance_score) && value.performance_score >= 0 && value.performance_score <= 100 &&
    typeof value.skill_id === "string" && Number.isSafeInteger(value.skill_experience_awarded) &&
    isFiniteNumber(value.skill_experience_awarded) && value.skill_experience_awarded >= 0 &&
    typeof value.started_at === "string" && typeof value.updated_at === "string" &&
    (value.completed_at_minute === undefined || (Number.isSafeInteger(value.completed_at_minute) &&
      isFiniteNumber(value.completed_at_minute) && value.completed_at_minute >= 0 && value.completed_at_minute < 1440)) &&
    (value.payroll_payment_id === undefined || typeof value.payroll_payment_id === "string") &&
    (value.invalidation_reason === undefined || typeof value.invalidation_reason === "string");
}

function isCareerSkill(value: unknown, key: string): boolean {
  return isRecord(value) && typeof key === "string" && typeof value.skill_record_id === "string" &&
    typeof value.character_id === "string" && typeof value.skill_id === "string" &&
    Number.isSafeInteger(value.level) && isFiniteNumber(value.level) && value.level >= 0 && value.level <= 100 &&
    Number.isSafeInteger(value.experience) && isFiniteNumber(value.experience) && value.experience >= 0 &&
    isStringArray(value.sources) && isValidDate(value.last_updated_world_date) && typeof value.last_updated_at === "string";
}

function isCareerLicense(value: unknown, key: string): boolean {
  return isRecord(value) && typeof key === "string" && typeof value.license_record_id === "string" &&
    typeof value.character_id === "string" && typeof value.license_id === "string" && typeof value.issuer === "string" &&
    typeof value.issued_at === "string" && isValidDate(value.world_date) &&
    ["active", "suspended", "revoked"].includes(String(value.status));
}

function isCareerReview(value: unknown, key: string): boolean {
  return isRecord(value) && typeof key === "string" && typeof value.review_id === "string" &&
    typeof value.employment_id === "string" && typeof value.character_id === "string" && isValidDate(value.world_date) &&
    Number.isSafeInteger(value.completed_sessions) && isFiniteNumber(value.completed_sessions) && value.completed_sessions >= 1 &&
    Number.isSafeInteger(value.performance_score) && isFiniteNumber(value.performance_score) && value.performance_score >= 0 &&
    value.performance_score <= 100 && typeof value.summary === "string" && typeof value.created_at === "string";
}

function isCareerLeaveRequest(value: unknown, key: string): boolean {
  return isRecord(value) && typeof key === "string" && typeof value.leave_request_id === "string" &&
    typeof value.employment_id === "string" && typeof value.character_id === "string" &&
    ["personal", "vacation"].includes(String(value.leave_type)) && isValidDate(value.start_date) && isValidDate(value.end_date) &&
    ["pending", "approved", "rejected", "cancelled", "completed"].includes(String(value.status)) &&
    typeof value.reason === "string" && value.reason.length <= 120 && typeof value.decision_reason === "string" &&
    value.decision_reason.length <= 300 && typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isCareerEvent(value: unknown, key: string): boolean {
  return isRecord(value) && typeof key === "string" && typeof value.event_id === "string" &&
    typeof value.character_id === "string" && typeof value.type === "string" && isValidDate(value.world_date) &&
    Number.isSafeInteger(value.minute_of_day) && isFiniteNumber(value.minute_of_day) &&
    value.minute_of_day >= 0 && value.minute_of_day < 1440 && typeof value.summary === "string" &&
    isRecord(value.details) && Object.values(value.details).every((entry) => entry === null ||
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") &&
    typeof value.created_at === "string" &&
    (value.employment_id === undefined || typeof value.employment_id === "string") &&
    (value.application_id === undefined || typeof value.application_id === "string");
}

function isSalaryPayment(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value.payment_id === "string" && value.payment_id === key &&
    typeof value.employment_id === "string" && typeof value.character_id === "string" &&
    (value.employer_id === null || typeof value.employer_id === "string") &&
    Number.isSafeInteger(value.amount_ngn) && isFiniteNumber(value.amount_ngn) && value.amount_ngn > 0 &&
    typeof value.pay_frequency === "string" && CAREER_PAY_FREQUENCIES.has(value.pay_frequency) &&
    isValidDate(value.pay_period_start_date) && isValidDate(value.pay_period_end_date) &&
    isValidDate(value.paid_at_world_date) && typeof value.final_payment === "boolean" &&
    isStringArray(value.work_session_ids) && value.work_session_ids.length > 0 && typeof value.posted_at === "string";
}

function isNpcCareer(value: unknown, key: string): boolean {
  return isRecord(value) && value.person_id === key &&
    (value.job_id === null || typeof value.job_id === "string") &&
    (value.employer_id === null || typeof value.employer_id === "string") &&
    (value.schedule_id === null || typeof value.schedule_id === "string") &&
    ["student", "employed", "unemployed", "retired", "deceased"].includes(String(value.status)) &&
    value.prototype_fixture === true && value.profile_source === "deterministic_household_fixture" &&
    (value.start_date === undefined || isValidDate(value.start_date)) &&
    isValidDate(value.last_processed_date) && typeof value.updated_at === "string";
}

function emptyCareerMaps(): PersistentCareerMaps {
  return {
    careerEmployers: {}, careerVacancies: {}, careerApplications: {}, employments: {}, workSessions: {},
    careerSkills: {}, careerLicenses: {}, careerReviews: {}, careerLeaveRequests: {}, careerEvents: {},
    salaryPayments: {}, npcCareers: {},
  };
}

function emptyEconomyMaps(): PersistentEconomyMaps {
  return {
    economyAccounts: {}, economyTransactions: {}, economyLoans: {}, economyCreditScores: {}, economyEvents: {},
  };
}

function emptyBusinessMaps(): PersistentBusinessMaps {
  return {
    businesses: {}, businessOwnership: {}, businessBranches: {}, businessProducts: {},
    businessInventory: {}, businessInventoryMovements: {}, businessTransactions: {},
    businessExpenses: {}, businessSales: {}, businessProductionRuns: {}, businessEvents: {},
  };
}

function emptyPropertyMaps(): PersistentPropertyMaps {
  return {
    properties: {}, propertyOwnership: {}, propertyListings: {},
    rentalAgreements: {}, rentalPayments: {}, propertySales: {},
    propertyMaintenance: {}, propertyFurnishings: {}, propertyEvents: {},
  };
}

function emptyGovernmentMaps(): PersistentGovernmentMaps {
  return {
    governmentOrganisations: {}, governmentOffices: {}, governmentAppointments: {},
    governmentBudgets: {}, governmentRevenue: {}, governmentExpenditure: {},
    governmentProjects: {}, governmentAnnouncements: {}, governmentEvents: {},
  };
}

function emptyElectionMaps(): PersistentElectionMaps {
  return {
    politicalParties: {}, partyMemberships: {}, politicalProfiles: {},
    elections: {}, candidates: {}, campaigns: {}, campaignEvents: {},
    campaignFinances: {}, debates: {}, ballots: {}, voterParticipation: {},
    electionDisputes: {}, electionAudits: {},
  };
}

function emptyJusticeMaps(): PersistentJusticeMaps {
  return {
    laws: {}, lawProvisions: {}, legislativeProposals: {}, courts: {},
    legalProfessionals: {}, legalRepresentations: {}, cases: {},
    caseParticipants: {}, evidence: {}, witnesses: {}, hearings: {},
    judgments: {}, sentences: {}, fines: {}, settlements: {}, appeals: {},
    legalAudits: {},
  };
}

function emptyLifeMaps(): Pick<
  PersistentWorldState,
  "people" | "households" | "families" | "relationships" | "lifeEvents" | "marriages" | "inheritanceEvents"
> {
  return {
    people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
  };
}

const ECONOMY_ACCOUNT_KINDS = new Set(["cash", "savings", "current", "fixed_deposit"]);
const ECONOMY_ACCOUNT_STATUSES = new Set(["active", "frozen", "closed"]);
const ECONOMY_LOAN_STATUSES = new Set(["active", "paid_off", "defaulted", "cancelled"]);
const ECONOMY_TRANSACTION_KINDS = new Set([
  "salary_credit", "market_purchase", "bank_deposit", "bank_withdrawal", "bank_transfer", "bank_fee",
  "bank_interest", "tax_payment", "loan_disbursement", "loan_repayment", "loan_origination_fee",
  "loan_late_fee", "initial_credit", "clinic_payment", "bus_fare",
]);

function isEconomyAccount(value: unknown, key: string): boolean {
  return isRecord(value) && value.account_id === key && typeof value.character_id === "string" &&
    typeof value.kind === "string" && ECONOMY_ACCOUNT_KINDS.has(value.kind) &&
    (value.bank_product_id === null || typeof value.bank_product_id === "string") &&
    isFiniteNumber(value.balance_ngn) && value.balance_ngn >= 0 &&
    typeof value.status === "string" && ECONOMY_ACCOUNT_STATUSES.has(value.status) &&
    isValidDate(value.created_world_date) && typeof value.created_at === "string" && typeof value.updated_at === "string" &&
    isValidDate(value.opened_world_date) &&
    (value.last_interest_date === null || isValidDate(value.last_interest_date)) &&
    isFiniteNumber(value.total_deposited_ngn) && isFiniteNumber(value.total_withdrawn_ngn) &&
    isFiniteNumber(value.total_fees_paid_ngn) && isFiniteNumber(value.total_interest_earned_ngn) &&
    isFiniteNumber(value.daily_withdrawal_total_ngn) &&
    (value.daily_withdrawal_date === null || isValidDate(value.daily_withdrawal_date));
}

function isEconomyTransaction(value: unknown, key: string): boolean {
  return isRecord(value) && value.transaction_id === key && typeof value.account_id === "string" &&
    typeof value.character_id === "string" && typeof value.kind === "string" &&
    ECONOMY_TRANSACTION_KINDS.has(value.kind) &&
    isFiniteNumber(value.amount_ngn) && value.amount_ngn >= 0 &&
    isFiniteNumber(value.balance_before_ngn) && isFiniteNumber(value.balance_after_ngn) &&
    isFiniteNumber(value.fee_ngn) && typeof value.description === "string" &&
    isValidDate(value.world_date) && isFiniteNumber(value.minute_of_day) &&
    value.minute_of_day >= 0 && value.minute_of_day < 1440 &&
    typeof value.posted_at === "string" &&
    (value.reference_id === null || typeof value.reference_id === "string") &&
    (value.counterparty_account_id === null || typeof value.counterparty_account_id === "string") &&
    typeof value.idempotency_key === "string";
}

function isEconomyLoan(value: unknown, key: string): boolean {
  return isRecord(value) && value.loan_id === key && typeof value.character_id === "string" &&
    typeof value.loan_product_id === "string" &&
    isFiniteNumber(value.principal_ngn) && value.principal_ngn >= 0 &&
    isFiniteNumber(value.remaining_principal_ngn) && value.remaining_principal_ngn >= 0 &&
    typeof value.interest_rate_monthly_percent === "number" &&
    isFiniteNumber(value.term_months) && Number.isSafeInteger(value.term_months) &&
    isFiniteNumber(value.monthly_payment_ngn) && isFiniteNumber(value.origination_fee_ngn) &&
    typeof value.status === "string" && ECONOMY_LOAN_STATUSES.has(value.status) &&
    isValidDate(value.start_date) && isValidDate(value.end_date) && isValidDate(value.next_payment_date) &&
    isFiniteNumber(value.payments_made) && isFiniteNumber(value.payments_missed) &&
    isFiniteNumber(value.total_paid_ngn) && typeof value.created_at === "string" &&
    typeof value.updated_at === "string" && typeof value.disbursement_account_id === "string";
}

function isEconomyCreditScore(value: unknown, key: string): boolean {
  return isRecord(value) && value.character_id === key &&
    isFiniteNumber(value.score) && Number.isSafeInteger(value.score) &&
    Array.isArray(value.history) && typeof value.updated_at === "string" &&
    isValidDate(value.updated_world_date);
}

function isEconomyEvent(value: unknown, key: string): boolean {
  return isRecord(value) && value.event_id === key && typeof value.character_id === "string" &&
    typeof value.type === "string" && isValidDate(value.world_date) &&
    isFiniteNumber(value.minute_of_day) && value.minute_of_day >= 0 && value.minute_of_day < 1440 &&
    typeof value.summary === "string" && isRecord(value.details) &&
    typeof value.created_at === "string" &&
    (value.account_id === undefined || typeof value.account_id === "string") &&
    (value.loan_id === undefined || typeof value.loan_id === "string") &&
    (value.transaction_id === undefined || typeof value.transaction_id === "string");
}

const BUSINESS_STATUSES = new Set(["draft", "active", "suspended", "closed", "insolvent"]);
const BUSINESS_MODELS = new Set(["retail", "food_service", "service", "production"]);
const BUSINESS_OWNERSHIP_ROLES = new Set(["owner", "co_owner", "manager", "accountant", "inventory_manager", "employee"]);
const BUSINESS_TX_KINDS = new Set([
  "sale_product", "sale_service", "expense_operating", "expense_rent", "expense_salary",
  "capital_contribution", "owner_withdrawal", "production_cost", "setup_cost", "refund", "purchase_stock",
]);
const BUSINESS_PREMISES_TYPES = new Set([
  "home_based", "market_stall", "shop", "office", "workshop", "restaurant", "farm", "warehouse", "factory", "service_area", "studio",
]);

function isBusiness(value: unknown, key: string): boolean {
  return isRecord(value) && value.business_id === key && typeof value.name === "string" && typeof value.description === "string" &&
    typeof value.template_id === "string" && typeof value.category_id === "string" &&
    typeof value.model === "string" && BUSINESS_MODELS.has(value.model) &&
    typeof value.status === "string" && BUSINESS_STATUSES.has(value.status) &&
    typeof value.primary_location_id === "string" &&
    typeof value.premises_type === "string" && BUSINESS_PREMISES_TYPES.has(value.premises_type) &&
    isFiniteNumber(value.reputation_score) && isFiniteNumber(value.balance_ngn) &&
    isFiniteNumber(value.total_revenue_ngn) && isFiniteNumber(value.total_expenses_ngn) &&
    isFiniteNumber(value.total_capital_ngn) && isFiniteNumber(value.total_withdrawals_ngn) &&
    typeof value.created_at === "string" && typeof value.updated_at === "string" &&
    isValidDate(value.created_world_date) && typeof value.owner_character_id === "string" &&
    (value.closed_at === null || typeof value.closed_at === "string") &&
    (value.closed_world_date === null || isValidDate(value.closed_world_date)) &&
    (value.closure_reason === null || typeof value.closure_reason === "string") &&
    (value.last_operating_date === null || isValidDate(value.last_operating_date));
}

function isBusinessOwnership(value: unknown, key: string): boolean {
  return isRecord(value) && value.ownership_id === key && typeof value.business_id === "string" &&
    typeof value.character_id === "string" &&
    typeof value.role === "string" && BUSINESS_OWNERSHIP_ROLES.has(value.role) &&
    isFiniteNumber(value.share_percent) && value.share_percent >= 0 && value.share_percent <= 100 &&
    typeof value.created_at === "string" && typeof value.updated_at === "string" &&
    isValidDate(value.created_world_date) && typeof value.is_founder === "boolean" &&
    typeof value.active === "boolean";
}

function isBusinessTransaction(value: unknown, key: string): boolean {
  return isRecord(value) && value.transaction_id === key && typeof value.business_id === "string" &&
    typeof value.kind === "string" && BUSINESS_TX_KINDS.has(value.kind) &&
    isFiniteNumber(value.amount_ngn) && isFiniteNumber(value.balance_before_ngn) && isFiniteNumber(value.balance_after_ngn) &&
    typeof value.description === "string" && isValidDate(value.world_date) &&
    isFiniteNumber(value.minute_of_day) && value.minute_of_day >= 0 && value.minute_of_day < 1440 &&
    typeof value.posted_at === "string" &&
    (value.reference_id === null || typeof value.reference_id === "string") &&
    (value.counterparty_character_id === null || typeof value.counterparty_character_id === "string") &&
    typeof value.idempotency_key === "string";
}

function isBusinessSale(value: unknown, key: string): boolean {
  return isRecord(value) && value.sale_id === key && typeof value.business_id === "string" &&
    (value.product_record_id === null || typeof value.product_record_id === "string") &&
    typeof value.product_definition_id === "string" &&
    (value.buyer_character_id === null || typeof value.buyer_character_id === "string") &&
    isFiniteNumber(value.quantity) && isFiniteNumber(value.unit_price_ngn) && isFiniteNumber(value.total_ngn) &&
    isValidDate(value.world_date) && isFiniteNumber(value.minute_of_day) &&
    typeof value.posted_at === "string" && typeof value.is_service === "boolean";
}

function isBusinessEvent(value: unknown, key: string): boolean {
  return isRecord(value) && value.event_id === key && typeof value.business_id === "string" &&
    typeof value.type === "string" && isValidDate(value.world_date) &&
    isFiniteNumber(value.minute_of_day) && value.minute_of_day >= 0 && value.minute_of_day < 1440 &&
    typeof value.summary === "string" && isRecord(value.details) &&
    typeof value.created_at === "string";
}

function validateState(value: unknown, now: number): PersistentWorldState {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6 && value.schemaVersion !== 7 && value.schemaVersion !== 8 && value.schemaVersion !== 9 && value.schemaVersion !== 10 && value.schemaVersion !== 11) ||
    value.worldId !== WORLD_ID || !isRecord(value.worldClock) || !isRecord(value.players)) {
    throw new Error("World data has an invalid schema; refusing to start with reset state.");
  }
  const schemaVersion = value.schemaVersion as number;
  const clock = value.worldClock;
  if (!isFiniteNumber(clock.day) || !Number.isSafeInteger(clock.day) || clock.day < 1 ||
    !isFiniteNumber(clock.minute_of_day) || !Number.isSafeInteger(clock.minute_of_day) ||
    clock.minute_of_day < 0 || clock.minute_of_day >= 1440 || typeof clock.updated_at !== "string") {
    throw new Error("World data has an invalid clock; refusing to start with reset state.");
  }
  if (schemaVersion >= 2) {
    const mapNames = ["people", "households", "families", "relationships", "lifeEvents", "marriages", "inheritanceEvents"] as const;
    if (mapNames.some((name) => !isRecord(value[name]))) {
      throw new Error("World data is missing Stage 5 lifecycle records; refusing to start with reset state.");
    }
    const map = (name: typeof mapNames[number]): Record<string, unknown> => value[name] as Record<string, unknown>;
    if (Object.entries(map("people")).some(([id, person]) => !isFamilyPerson(person, id)) ||
      Object.entries(map("households")).some(([id, item]) => !isHousehold(item, id)) ||
      Object.entries(map("families")).some(([id, item]) => !isFamily(item, id)) ||
      Object.entries(map("relationships")).some(([id, item]) => !isRelationship(item, id)) ||
      Object.entries(map("lifeEvents")).some(([id, item]) => !isLifeEvent(item, id)) ||
      Object.entries(map("marriages")).some(([id, item]) => !isMarriage(item, id)) ||
      Object.entries(map("inheritanceEvents")).some(([id, item]) => !isInheritanceEvent(item, id))) {
      throw new Error("World data contains an invalid Stage 5 lifecycle record.");
    }
  }
  if (schemaVersion === 3 || schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) {
    const careerMapNames = [
      "careerEmployers", "careerVacancies", "careerApplications", "employments", "workSessions", "careerSkills",
      "careerLicenses", "careerReviews", "careerLeaveRequests", "careerEvents", "salaryPayments", "npcCareers",
    ] as const;
    if (careerMapNames.some((name) => !isRecord(value[name]))) {
      throw new Error("World data is missing Stage 6 career records; refusing to start with reset state.");
    }
    const careerMap = (name: typeof careerMapNames[number]): Record<string, unknown> => value[name] as Record<string, unknown>;
    if (Object.entries(careerMap("careerEmployers")).some(([id, entry]) => !isCareerEmployer(entry, id)) ||
      Object.entries(careerMap("careerVacancies")).some(([id, entry]) => !isCareerVacancy(entry, id)) ||
      Object.entries(careerMap("careerApplications")).some(([id, entry]) => !isCareerApplication(entry, id)) ||
      Object.entries(careerMap("employments")).some(([id, entry]) => !isCareerEmployment(entry, id)) ||
      Object.entries(careerMap("workSessions")).some(([id, entry]) => !isCareerWorkSession(entry, id)) ||
      Object.entries(careerMap("careerSkills")).some(([id, entry]) => !isCareerSkill(entry, id)) ||
      Object.entries(careerMap("careerLicenses")).some(([id, entry]) => !isCareerLicense(entry, id)) ||
      Object.entries(careerMap("careerReviews")).some(([id, entry]) => !isCareerReview(entry, id)) ||
      Object.entries(careerMap("careerLeaveRequests")).some(([id, entry]) => !isCareerLeaveRequest(entry, id)) ||
      Object.entries(careerMap("careerEvents")).some(([id, entry]) => !isCareerEvent(entry, id)) ||
      Object.entries(careerMap("salaryPayments")).some(([id, entry]) => !isSalaryPayment(entry, id)) ||
      Object.entries(careerMap("npcCareers")).some(([id, entry]) => !isNpcCareer(entry, id))) {
      throw new Error("World data contains an invalid Stage 6 career record.");
    }
  }
  if (schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) {
    const economyMapNames = [
      "economyAccounts", "economyTransactions", "economyLoans", "economyCreditScores", "economyEvents",
    ] as const;
    if (economyMapNames.some((name) => !isRecord(value[name]))) {
      throw new Error("World data is missing Stage 7 economy records; refusing to start with reset state.");
    }
    const economyMap = (name: typeof economyMapNames[number]): Record<string, unknown> => value[name] as Record<string, unknown>;
    if (Object.entries(economyMap("economyAccounts")).some(([id, entry]) => !isEconomyAccount(entry, id)) ||
      Object.entries(economyMap("economyTransactions")).some(([id, entry]) => !isEconomyTransaction(entry, id)) ||
      Object.entries(economyMap("economyLoans")).some(([id, entry]) => !isEconomyLoan(entry, id)) ||
      Object.entries(economyMap("economyCreditScores")).some(([id, entry]) => !isEconomyCreditScore(entry, id)) ||
      Object.entries(economyMap("economyEvents")).some(([id, entry]) => !isEconomyEvent(entry, id))) {
      throw new Error("World data contains an invalid Stage 7 economy record.");
    }
  }
  if (schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) {
    const businessMapNames = [
      "businesses", "businessOwnership", "businessBranches", "businessProducts", "businessInventory",
      "businessInventoryMovements", "businessTransactions", "businessExpenses", "businessSales",
      "businessProductionRuns", "businessEvents",
    ] as const;
    if (businessMapNames.some((name) => !isRecord(value[name]))) {
      throw new Error("World data is missing Stage 8 business records; refusing to start with reset state.");
    }
    const businessMap = (name: typeof businessMapNames[number]): Record<string, unknown> => value[name] as Record<string, unknown>;
    if (Object.entries(businessMap("businesses")).some(([id, entry]) => !isBusiness(entry, id)) ||
      Object.entries(businessMap("businessOwnership")).some(([id, entry]) => !isBusinessOwnership(entry, id)) ||
      Object.entries(businessMap("businessTransactions")).some(([id, entry]) => !isBusinessTransaction(entry, id)) ||
      Object.entries(businessMap("businessSales")).some(([id, entry]) => !isBusinessSale(entry, id)) ||
      Object.entries(businessMap("businessEvents")).some(([id, entry]) => !isBusinessEvent(entry, id))) {
      throw new Error("World data contains an invalid Stage 8 business record.");
    }
  }

  const catalog: LifeCatalog = loadLifeCatalog();
  const careerMaps: PersistentCareerMaps = (schemaVersion === 3 || schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) ? {
    careerEmployers: value.careerEmployers as PersistentCareerMaps["careerEmployers"],
    careerVacancies: value.careerVacancies as PersistentCareerMaps["careerVacancies"],
    careerApplications: value.careerApplications as PersistentCareerMaps["careerApplications"],
    employments: value.employments as PersistentCareerMaps["employments"],
    workSessions: value.workSessions as PersistentCareerMaps["workSessions"],
    careerSkills: value.careerSkills as PersistentCareerMaps["careerSkills"],
    careerLicenses: value.careerLicenses as PersistentCareerMaps["careerLicenses"],
    careerReviews: value.careerReviews as PersistentCareerMaps["careerReviews"],
    careerLeaveRequests: value.careerLeaveRequests as PersistentCareerMaps["careerLeaveRequests"],
    careerEvents: value.careerEvents as PersistentCareerMaps["careerEvents"],
    salaryPayments: value.salaryPayments as PersistentCareerMaps["salaryPayments"],
    npcCareers: value.npcCareers as PersistentCareerMaps["npcCareers"],
  } : emptyCareerMaps();
  const economyMaps: PersistentEconomyMaps = (schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) ? {
    economyAccounts: value.economyAccounts as PersistentEconomyMaps["economyAccounts"],
    economyTransactions: value.economyTransactions as PersistentEconomyMaps["economyTransactions"],
    economyLoans: value.economyLoans as PersistentEconomyMaps["economyLoans"],
    economyCreditScores: value.economyCreditScores as PersistentEconomyMaps["economyCreditScores"],
    economyEvents: value.economyEvents as PersistentEconomyMaps["economyEvents"],
  } : emptyEconomyMaps();
  const businessMaps: PersistentBusinessMaps = (schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) ? {
    businesses: value.businesses as PersistentBusinessMaps["businesses"],
    businessOwnership: value.businessOwnership as PersistentBusinessMaps["businessOwnership"],
    businessBranches: value.businessBranches as PersistentBusinessMaps["businessBranches"],
    businessProducts: value.businessProducts as PersistentBusinessMaps["businessProducts"],
    businessInventory: value.businessInventory as PersistentBusinessMaps["businessInventory"],
    businessInventoryMovements: value.businessInventoryMovements as PersistentBusinessMaps["businessInventoryMovements"],
    businessTransactions: value.businessTransactions as PersistentBusinessMaps["businessTransactions"],
    businessExpenses: value.businessExpenses as PersistentBusinessMaps["businessExpenses"],
    businessSales: value.businessSales as PersistentBusinessMaps["businessSales"],
    businessProductionRuns: value.businessProductionRuns as PersistentBusinessMaps["businessProductionRuns"],
    businessEvents: value.businessEvents as PersistentBusinessMaps["businessEvents"],
  } : emptyBusinessMaps();
  const propertyMaps: PersistentPropertyMaps = (schemaVersion === 6 || schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) ? {
    properties: value.properties as PersistentPropertyMaps["properties"],
    propertyOwnership: value.propertyOwnership as PersistentPropertyMaps["propertyOwnership"],
    propertyListings: value.propertyListings as PersistentPropertyMaps["propertyListings"],
    rentalAgreements: value.rentalAgreements as PersistentPropertyMaps["rentalAgreements"],
    rentalPayments: value.rentalPayments as PersistentPropertyMaps["rentalPayments"],
    propertySales: value.propertySales as PersistentPropertyMaps["propertySales"],
    propertyMaintenance: value.propertyMaintenance as PersistentPropertyMaps["propertyMaintenance"],
    propertyFurnishings: value.propertyFurnishings as PersistentPropertyMaps["propertyFurnishings"],
    propertyEvents: value.propertyEvents as PersistentPropertyMaps["propertyEvents"],
  } : emptyPropertyMaps();
  const governmentMaps: PersistentGovernmentMaps = (schemaVersion === 7 || schemaVersion === 8 || schemaVersion === 9) ? {
    governmentOrganisations: value.governmentOrganisations as PersistentGovernmentMaps["governmentOrganisations"],
    governmentOffices: value.governmentOffices as PersistentGovernmentMaps["governmentOffices"],
    governmentAppointments: value.governmentAppointments as PersistentGovernmentMaps["governmentAppointments"],
    governmentBudgets: value.governmentBudgets as PersistentGovernmentMaps["governmentBudgets"],
    governmentRevenue: value.governmentRevenue as PersistentGovernmentMaps["governmentRevenue"],
    governmentExpenditure: value.governmentExpenditure as PersistentGovernmentMaps["governmentExpenditure"],
    governmentProjects: value.governmentProjects as PersistentGovernmentMaps["governmentProjects"],
    governmentAnnouncements: value.governmentAnnouncements as PersistentGovernmentMaps["governmentAnnouncements"],
    governmentEvents: value.governmentEvents as PersistentGovernmentMaps["governmentEvents"],
  } : emptyGovernmentMaps();
  const electionMaps: PersistentElectionMaps = (schemaVersion === 8 || schemaVersion === 9) ? {
    politicalParties: value.politicalParties as PersistentElectionMaps["politicalParties"],
    partyMemberships: value.partyMemberships as PersistentElectionMaps["partyMemberships"],
    politicalProfiles: value.politicalProfiles as PersistentElectionMaps["politicalProfiles"],
    elections: value.elections as PersistentElectionMaps["elections"],
    candidates: value.candidates as PersistentElectionMaps["candidates"],
    campaigns: value.campaigns as PersistentElectionMaps["campaigns"],
    campaignEvents: value.campaignEvents as PersistentElectionMaps["campaignEvents"],
    campaignFinances: value.campaignFinances as PersistentElectionMaps["campaignFinances"],
    debates: value.debates as PersistentElectionMaps["debates"],
    ballots: value.ballots as PersistentElectionMaps["ballots"],
    voterParticipation: value.voterParticipation as PersistentElectionMaps["voterParticipation"],
    electionDisputes: value.electionDisputes as PersistentElectionMaps["electionDisputes"],
    electionAudits: value.electionAudits as PersistentElectionMaps["electionAudits"],
  } : emptyElectionMaps();
  const justiceMaps: PersistentJusticeMaps = schemaVersion === 9 ? {
    laws: value.laws as PersistentJusticeMaps["laws"],
    lawProvisions: value.lawProvisions as PersistentJusticeMaps["lawProvisions"],
    legislativeProposals: value.legislativeProposals as PersistentJusticeMaps["legislativeProposals"],
    courts: value.courts as PersistentJusticeMaps["courts"],
    legalProfessionals: value.legalProfessionals as PersistentJusticeMaps["legalProfessionals"],
    legalRepresentations: value.legalRepresentations as PersistentJusticeMaps["legalRepresentations"],
    cases: value.cases as PersistentJusticeMaps["cases"],
    caseParticipants: value.caseParticipants as PersistentJusticeMaps["caseParticipants"],
    evidence: value.evidence as PersistentJusticeMaps["evidence"],
    witnesses: value.witnesses as PersistentJusticeMaps["witnesses"],
    hearings: value.hearings as PersistentJusticeMaps["hearings"],
    judgments: value.judgments as PersistentJusticeMaps["judgments"],
    sentences: value.sentences as PersistentJusticeMaps["sentences"],
    fines: value.fines as PersistentJusticeMaps["fines"],
    settlements: value.settlements as PersistentJusticeMaps["settlements"],
    appeals: value.appeals as PersistentJusticeMaps["appeals"],
    legalAudits: value.legalAudits as PersistentJusticeMaps["legalAudits"],
  } : emptyJusticeMaps();
  const policeMaps: PersistentPoliceMaps = schemaVersion >= 10 ? {
    policeUnits: value.policeUnits as PersistentPoliceMaps["policeUnits"],
    policeOfficers: value.policeOfficers as PersistentPoliceMaps["policeOfficers"],
    recruitmentApplications: value.recruitmentApplications as PersistentPoliceMaps["recruitmentApplications"],
    policeIncidents: value.policeIncidents as PersistentPoliceMaps["policeIncidents"],
    dispatches: value.dispatches as PersistentPoliceMaps["dispatches"],
    investigations: value.investigations as PersistentPoliceMaps["investigations"],
    policeEvidence: value.policeEvidence as PersistentPoliceMaps["policeEvidence"],
    wantedRecords: value.wantedRecords as PersistentPoliceMaps["wantedRecords"],
    arrestRecords: value.arrestRecords as PersistentPoliceMaps["arrestRecords"],
    misconductComplaints: value.misconductComplaints as PersistentPoliceMaps["misconductComplaints"],
    policeAudits: value.policeAudits as PersistentPoliceMaps["policeAudits"],
  } : emptyPoliceMaps();
  const militaryMaps: PersistentMilitaryMaps = schemaVersion >= 11 ? {
    militaryOrganizations: value.militaryOrganizations as PersistentMilitaryMaps["militaryOrganizations"],
    militaryBases: value.militaryBases as PersistentMilitaryMaps["militaryBases"],
    militaryUnits: value.militaryUnits as PersistentMilitaryMaps["militaryUnits"],
    militaryRecruitments: value.militaryRecruitments as PersistentMilitaryMaps["militaryRecruitments"],
    militaryServiceRecords: value.militaryServiceRecords as PersistentMilitaryMaps["militaryServiceRecords"],
    militaryTrainingRecords: value.militaryTrainingRecords as PersistentMilitaryMaps["militaryTrainingRecords"],
    militaryRankHistory: value.militaryRankHistory as PersistentMilitaryMaps["militaryRankHistory"],
    militaryCommandAppointments: value.militaryCommandAppointments as PersistentMilitaryMaps["militaryCommandAppointments"],
    militaryAssignments: value.militaryAssignments as PersistentMilitaryMaps["militaryAssignments"],
    militaryLeaveRecords: value.militaryLeaveRecords as PersistentMilitaryMaps["militaryLeaveRecords"],
    militaryAssets: value.militaryAssets as PersistentMilitaryMaps["militaryAssets"],
    nationalSecurityEvents: value.nationalSecurityEvents as PersistentMilitaryMaps["nationalSecurityEvents"],
    militaryDisciplinaryRecords: value.militaryDisciplinaryRecords as PersistentMilitaryMaps["militaryDisciplinaryRecords"],
    militaryAudits: value.militaryAudits as PersistentMilitaryMaps["militaryAudits"],
  } : emptyMilitaryMaps();
  const state = {
    schemaVersion: 11 as const,
    worldId: WORLD_ID,
    worldClock: normalizeWorldClock(clock, now, catalog),
    players: {} as Record<string, PersistentPlayer>,
    ...(schemaVersion >= 2 ? {
      people: value.people as PersistentWorldState["people"],
      households: value.households as PersistentWorldState["households"],
      families: value.families as PersistentWorldState["families"],
      relationships: value.relationships as PersistentWorldState["relationships"],
      lifeEvents: value.lifeEvents as PersistentWorldState["lifeEvents"],
      marriages: value.marriages as PersistentWorldState["marriages"],
      inheritanceEvents: value.inheritanceEvents as PersistentWorldState["inheritanceEvents"],
    } : emptyLifeMaps()),
    ...careerMaps,
    ...economyMaps,
    ...businessMaps,
    ...propertyMaps,
    ...governmentMaps,
    ...electionMaps,
    ...justiceMaps,
    ...policeMaps,
    ...militaryMaps,
  } satisfies PersistentWorldState;

  for (const [playerId, rawPlayer] of Object.entries(value.players)) {
    if (!isPersistentPlayerBase(rawPlayer, playerId)) {
      throw new Error(`World data contains an invalid player record (${playerId}).`);
    }
    if (schemaVersion === 1 && (!isRecord(rawPlayer.character) ||
      (rawPlayer.character.age !== 15 && rawPlayer.character.age !== 16))) {
      throw new Error(`World data contains an invalid legacy player age (${playerId}).`);
    }
    const character = rawPlayer.character as unknown as PersistentPlayer["character"];
    if (schemaVersion >= 2 && (!isRecord(rawPlayer.character) || !hasLifeFields(rawPlayer.character))) {
      throw new Error(`World data contains an invalid life record (${playerId}).`);
    }
    if (character.geographic_location === undefined) character.geographic_location = null;
    character.education_record = normalizeEducationRecord(
      character.education_record,
      character.character_id,
      character.age,
      character.school_id,
      character.academic_scores,
      character.attendance,
      Math.max(1, Math.floor(state.worldClock.day)),
      loadEducationCatalog(),
    );
    syncLegacyEducation(character, loadEducationCatalog());
    state.players[playerId] = rawPlayer as unknown as PersistentPlayer;
  }
  normalizeLifeWorldState(state, now);
  initializeCareerWorldState(state, now);
  initializeEconomyWorldState(state, now);
  initializeBusinessWorldState(state);
  return state;
}

function initialState(now: number): PersistentWorldState {
  const catalog = loadLifeCatalog();
  const state: PersistentWorldState = {
    schemaVersion: 11,
    worldId: WORLD_ID,
    worldClock: normalizeWorldClock({
      day: catalog.calendar.starting_world_day,
      minute_of_day: catalog.calendar.starting_minute_of_day,
      millisecond_of_minute: 0,
      updated_at: new Date(now).toISOString(),
    }, now, catalog),
    players: {},
    ...emptyLifeMaps(),
    ...emptyCareerMaps(),
    ...emptyEconomyMaps(),
    ...emptyBusinessMaps(),
    ...emptyPropertyMaps(),
    ...emptyGovernmentMaps(),
    ...emptyElectionMaps(),
    ...emptyJusticeMaps(),
    ...emptyPoliceMaps(),
    ...emptyMilitaryMaps(),
  };
  initializeCareerWorldState(state, now);
  initializeEconomyWorldState(state, now);
  initializeBusinessWorldState(state);
  initializePropertyWorldState(state);
  initializeGovernmentWorldState(state);
  initializeElectionWorldState(state);
  initializeJusticeWorldState(state);
  initializePoliceWorldState(state);
  initializeMilitaryWorldState(state);
  return state;
}

export class WorldStore {
  readonly filePath: string;
  readonly state: PersistentWorldState;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, now: number = Date.now()) {
    this.filePath = resolve(filePath);
    try {
      const size = statSync(this.filePath).size;
      if (size > MAX_STATE_FILE_BYTES) throw new Error("World data file exceeds the 16 MiB prototype limit.");
      this.state = validateState(JSON.parse(readFileSync(this.filePath, "utf8")) as unknown, now);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") this.state = initialState(now);
      else throw new Error(`Could not load multiplayer world data: ${String(error)}`, { cause: error });
    }
  }

  async flush(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    if (Buffer.byteLength(snapshot, "utf8") > MAX_STATE_FILE_BYTES) {
      throw new Error("World data file exceeds the 16 MiB prototype limit.");
    }
    const write = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, this.filePath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    };
    const nextWrite = this.writeQueue.then(write, write);
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }
}
