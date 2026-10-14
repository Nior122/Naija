import { saveOutcomeOf, type SaveOutcome } from "../persistence-status.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describeSessionPolicy, evaluateSessionPolicy, isSessionRevoked } from "./session-policy.js";
import type { IncomingMessage } from "node:http";
import { WebSocket, type RawData } from "ws";
import { monitoring } from "../monitoring.js";
import { chunksAreWithinRadius, geographicDistanceMeters } from "../geography/coordinates.js";
import {
  geographicLocationForMapPosition,
  geographicLocationFromProfile,
  geographicLocationToMapPosition,
  loadAkureSouthRegion,
} from "../geography/catalog.js";
import type { GeographicRegion } from "../geography/types.js";
import { loadEducationCatalog } from "../education/catalog.js";
import {
  applyNPCSocialAction,
  loadNPCSocialCatalog,
  NPCSocialError,
  npcBondView,
  npcSocialMessage,
  syncNPCActivities,
  visibleNPCProfiles,
  type NPCSocialCatalog,
  type NPCSocialOutcome,
} from "../npc/index.js";
import { loadCareerCatalog } from "../careers/catalog.js";
import {
  buildCareerProfile,
  careerErrorMessage,
  completeCareerWorkSession,
  endCareerAtDeath,
  processCareerWorldDate,
  processCareerWorldMinute,
  requestCareerLeave,
  requestCareerPromotion,
  requestCareerRetirement,
  resignCareerEmployment,
  searchCareerJobsForCharacter,
  startCareerWorkSession,
  submitCareerApplication,
  withdrawCareerApplication,
} from "../careers/service.js";
import type { CareerCatalog } from "../careers/types.js";
import { loadEconomyCatalog } from "../economy/catalog.js";
import type { EconomyFixedCharge } from "../economy/types.js";
import {
  buildEconomyProfile,
  cashBalanceForCharacter,
  chargeFixedFee,
  depositToAccount,
  economyAccountPort,
  economyErrorMessage,
  initializeEconomyWorldState,
  listMarketGoodsForLocation,
  openEconomyAccount,
  processEconomyWorldDate,
  purchaseMarketGood,
  purchaseShopItem,
  repayLoan,
  requestLoan,
  syncCharacterCashFromEconomy,
  transferBetweenAccounts,
  withdrawFromAccount,
} from "../economy/service.js";
import type { EconomyCatalog } from "../economy/types.js";
import { loadBusinessCatalog } from "../businesses/catalog.js";
import {
  addBranch,
  addBusinessProduct,
  buildBusinessProfile,
  businessErrorMessage,
  closeBusiness,
  contributeCapital,
  createBusiness,
  discoverBusinesses,
  fireEmployee,
  hireEmployee,
  initializeBusinessWorldState,
  processBusinessWorldDate,
  recordBusinessExpense,
  restockInventory,
  runBusinessChange,
  runProduction,
  purchaseProduct,
  setBusinessListing,
  updateBusinessPrice,
  purchaseService,
  paySalary,
  transferBetweenBusinesses,
  transferOwnership,
  withdrawFromBusiness,
} from "../businesses/service.js";
import type { BusinessPremisesType } from "../businesses/types.js";
import type { BusinessCatalog } from "../businesses/types.js";
import { loadPropertyCatalog } from "../properties/catalog.js";
import {
  buildPropertyProfile,
  createRentalAgreement,
  getCharacterProperties,
  getCharacterRentals,
  initializePropertyWorldState,
  listPropertyForRent,
  listPropertyForSale,
  payRent,
  processPropertyWorldDate,
  propertyErrorMessage,
  purchaseFurniture,
  purchaseProperty,
  recordMaintenance,
  removeFurnishing,
  searchPropertyMarket,
  seedProperties,
  terminateRentalAgreement,
  transferProperty,
} from "../properties/service.js";
import type { PropertyCatalog, PropertyCondition, PropertyListingType, PropertyRentPeriod } from "../properties/types.js";
import { loadGovernmentCatalog } from "../government/catalog.js";
import {
  appointOfficial,
  allocateBudget,
  approveBudget,
  createBudget,
  createProject,
  fundProject,
  getCharacterAppointments,
  getFederalGovernment,
  getLocalGovernment,
  getPublishedAnnouncements,
  getStateGovernment,
  initializeGovernmentWorldState,
  processGovernmentWorldDate,
  publishAnnouncement,
  reconcileGovernmentStructure,
  recordGovernmentExpenditure,
  recordGovernmentRevenue,
  removeOfficial,
  searchProjects,
  seedGovernmentWorld,
  spendBudget,
  updateProjectStatus,
  governmentErrorMessage,
} from "../government/service.js";
import type { GovernmentCatalog, GovernmentLevel, ProjectStatus } from "../government/types.js";
import { loadElectionsCatalog } from "../elections/catalog.js";
import {
  initializeElectionWorldState,
  createPoliticalParty,
  registerPoliticalParty,
  joinPoliticalParty,
  leavePoliticalParty,
  getPoliticalProfile,
  updatePoliticalProfile,
  createElection,
  advanceElectionPhase,
  registerCandidate,
  approveCandidate,
  rejectCandidate,
  withdrawCandidate,
  createCampaign,
  checkVoterEligibility,
  castBallot,
  countVotes,
  certifyElectionResult,
  publishElectionResult,
  transferElectedOffice,
  submitDispute,
  listParties,
  listElections,
  getElection,
  listCandidates,
  getCampaign,
  getElectionAuditLog,
  getCharacterElectionHistory,
  getCharacterPartyMembership,
  processElectionWorldDate,
  electionsErrorMessage,
} from "../elections/service.js";
import type { ElectionsCatalog, ElectionPhase, PartyStatus, ManifestoRecord } from "../elections/types.js";
import { loadJusticeCatalog } from "../justice/catalog.js";
import {
  initializeJusticeWorldState,
  seedJusticeWorld,
  getActiveLaws,
  searchLaws,
  createLegislativeProposal,
  submitProposal,
  getCourt,
  listCourts,
  fileCase,
  getCase,
  getCharacterCases,
  viewCaseForCharacter,
  submitEvidence,
  issueJudgment,
  payFine,
  getCharacterFines,
  fileAppeal,
  decideAppeal,
  getLegalProfile,
  processJusticeWorldDate,
  justiceErrorMessage,
} from "../justice/service.js";
import type { JusticeCatalog, CaseCategoryId, JudgmentOutcomeId, AppealOutcomeId } from "../justice/types.js";
import { PoliceCatalogService, PoliceService, initializePoliceWorldState, seedPoliceWorld, policeErrorMessage } from "../police/index.js";
import type { IncidentCategoryId, DispatchPriorityId, MisconductCategoryId } from "../police/types.js";
import { MilitaryCatalogService, MilitaryService, initializeMilitaryWorldState, seedMilitaryWorld, militaryErrorMessage } from "../military/index.js";
import type { ServiceBranchId, AssignmentTypeId, EquipmentCategoryId, NationalSecurityEventCategoryId } from "../military/types.js";
import { CrimeCatalogService, CrimeService, initializeCrimeWorldState, seedCrimeWorld, crimeErrorMessage } from "../crime/index.js";
import type { CrimeCategoryId, CrimeIncidentStatusId } from "../crime/types.js";
import { parseTargetId, validateCrimeTargets } from "../crime/targets.js";
import { CultureCatalogService, CultureService, initializeCultureWorldState, seedCultureWorld, cultureErrorMessage } from "../culture/index.js";
import type { CommunityTypeId, InstitutionCategoryId, ProjectCategoryId, ProjectStatusId, ReligiousCategoryId } from "../culture/types.js";
import { EntertainmentCatalogService, EntertainmentService, initializeEntertainmentWorldState, seedEntertainmentWorld, entertainmentErrorMessage } from "../entertainment/index.js";
import type { ProductionStatusId, EventTypeId } from "../entertainment/types.js";
import { loadLifeCatalog, dateForWorldDay, isValidDate, worldClockSnapshot } from "../life/calendar.js";
import {
  advanceWorldLife,
  buildLifeProfile,
  canTakeActiveAction,
  createChildForMarriage,
  createStarterFamily,
  initializeCharacterLife,
  isDeathCauseCategory,
  proposeRelationship,
  recordDeath,
  recordRetirement,
} from "../life/service.js";
import type { CalendarDate, DeathCauseCategory, LifeEventRecord } from "../life/types.js";
import {
  applyEducationAction,
  beginTertiaryCoursePayload,
  createStudentEducationRecord,
  findQuestionForSubject,
  markMissedSchoolPeriods,
  nextFinalExamQuestion,
  nextSchoolLesson,
  publicSchoolQuiz,
  recordFinalExamAnswer,
  recordSchoolAttendance,
  recordSchoolQuizAnswer,
  recordTertiaryCourseAnswer,
  syncLegacyEducation,
  type EducationActionOptions,
} from "../education/service.js";
import type { EducationCatalog } from "../education/types.js";
import { WorldStateCapacityError, type WorldStoreLike } from "./persistence.js";
import { compareWithRecord, propertyRequestFingerprint, requestFingerprint, type StoredOperation } from "../persistence/request-records.js";
import { diffState, mergeStateChanges } from "./state-merge.js";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  STARTING_POSITION,
  WORLD_ID,
  clamp,
  distance,
  isFiniteNumber,
  isRecord,
  type CharacterRecord,
  type InventoryItem,
  type PersistentPlayer,
  type PersistentWorldState,
  type Point2D,
  type PublicPresence,
} from "./types.js";

const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_CHAT_LENGTH = 200;
const CHAT_RADIUS = 600;
const CHAT_MAX_MESSAGES = 5;
const CHAT_WINDOW_MS = 10_000;
const MAX_INVALID_MESSAGES = 5;
const MAX_PERSISTED_PLAYERS = 50_000;
const MAX_RECENT_REQUESTS = 256;
const MOVEMENT_MIN_INTERVAL_MS = 40;
const COMMAND_WINDOW_MS = 10_000;
const GENERAL_COMMANDS_PER_WINDOW = 20;
const INTERACTION_RADIUS = 92;
const ENTITY_INTERACTION_RADIUS = 100;
const GEOGRAPHIC_INTEREST_RADIUS_CHUNKS = 1;
const GEOGRAPHIC_INTEREST_RADIUS_METERS = 1500;
const MINUTES_PER_DAY = 1440;
/**
 * Stage 38 (R5). The per-game-minute character snapshot is held back for a socket whose unsent backlog is larger than
 * this. Normal snapshots are a few kilobytes, so normal play never reaches the limit. A slow or stalled reader is then
 * sent the latest state once its backlog drains, instead of one more copy per game minute.
 */
const SNAPSHOT_BACKLOG_LIMIT_BYTES = 1024 * 1024;
const STARTING_MONEY = 5000;
/**
 * TEMPORARY CONTAINMENT (Stage 28, government and election authorization).
 *
 * Player-initiated government and election WRITES are suspended until permanent authorization rules are defined.
 * This is a server-side, deny-by-default gate: only the read actions listed here may run for players. Every other
 * action name (known write, unlisted, unknown, or malformed) is refused with `government_writes_suspended` or
 * `election_writes_suspended` before any payload is parsed, any state is read or changed, and before
 * `markRequestProcessed` or `touchPlayer` run. Internal paths (world seeding at init and identity creation) do not
 * go through this gate. Remove or narrow these sets only together with the permanent authorization rules.
 */
const GOVERNMENT_READ_ACTIONS: ReadonlySet<string> = new Set([
  "view_federal",
  "view_state",
  "view_local",
  "search_projects",
  "announcements",
  "my_appointments",
]);
const ELECTION_READ_ACTIONS: ReadonlySet<string> = new Set([
  "list_parties",
  "political_profile",
  "list_elections",
  "view_election",
  "list_candidates",
  "view_campaign",
  "check_eligibility",
  "audit_log",
  "my_history",
]);
/**
 * Stage 31 (treasury): the only player-initiated government WRITES that are open. Each one is scoped by server-side
 * office authority (authorizeOfficePermission), requires the top-level requestId for idempotent replay where money
 * moves, and validates the whole request before writing. Every other government write stays suspended, including
 * record_revenue, record_expenditure, create_budget, appoint, remove_official, and the project and announcement writes.
 */
const GOVERNMENT_TREASURY_ACTIONS: ReadonlySet<string> = new Set([
  "approve_budget",
  "allocate_budget",
  "spend_budget",
]);
const GOVERNMENT_WRITES_SUSPENDED_CODE = "government_writes_suspended";
const ELECTION_WRITES_SUSPENDED_CODE = "election_writes_suspended";

/**
 * TEMPORARY CONTAINMENT (Stage 28 hardening, slice 1: justice and financial routes).
 *
 * Player-initiated mutations listed here are refused before payload parsing, before any state is read or changed, and
 * before `markRequestProcessed` or `touchPlayer` run. Each code is stable and documented in
 * docs/STAGE_28_FOUNDATION_HARDENING.md.
 *  - decide_appeal: appeal decisions need an authorized, independently assigned judge. No appointment or assignment
 *    route exists, so decisions stay disabled (decision D-01).
 *  - pay_fine: a payment must debit the payer and credit the treasury atomically. No economy linkage exists, so
 *    payments stay disabled (decision D-02).
 *  - create_criminal_record (crime family): a conviction must come from a final judgment. No such pathway exists, so
 *    record creation stays disabled (decision D-03).
 * Trusted service functions (judgment, appeal, fine, and record creation used by seeding and tests) are not affected.
 */
const JUSTICE_SUSPENDED_ACTIONS: ReadonlyMap<string, string> = new Map([
  ["decide_appeal", "justice_appeal_decision_suspended"],
  ["pay_fine", "justice_fine_payment_suspended"],
]);
const CRIME_SUSPENDED_ACTIONS: ReadonlyMap<string, string> = new Map([
  // Stage 37: no authority check exists for these; each would let any player change an incident, add evidence, or create a debt.
  ["transition_incident", "crime_incident_transition_suspended"],
  ["add_evidence", "crime_evidence_suspended"],
  ["create_restitution", "crime_restitution_suspended"],
  ["create_criminal_record", "crime_record_creation_suspended"],
  // Linking an incident to a case or police record is an authority act with no ownership or authority check yet.
  ["link_to_justice", "crime_link_suspended"],
  ["link_to_police", "crime_link_suspended"],
]);
/**
 * D-04 containment. Military and police mutations take IDs from the request and do not yet check the actor's
 * authority over the target (enlistment, training, promotion, command appointment, assignment, arrest). Each stays
 * unavailable until the authority model in docs/STAGE_28_AUTHORITY_MODEL.md is implemented with negative tests.
 * Reads (profiles, branch and course lists, rank history, arrest and incident lists) remain open.
 */
const MILITARY_SUSPENDED_ACTIONS: ReadonlyMap<string, string> = new Map([
  // Stage 37: no authority check exists; the caller was recorded as the authority for these.
  ["create_asset", "military_asset_creation_suspended"],
  ["create_security_event", "military_security_event_suspended"],
  ["file_disciplinary_case", "military_disciplinary_suspended"],
  ["enlist", "military_enlistment_suspended"],
  ["enroll_training", "military_training_suspended"],
  ["complete_training", "military_training_suspended"],
  ["promote", "military_promotion_suspended"],
  ["create_appointment", "military_appointment_suspended"],
  ["assign", "military_assignment_suspended"],
]);
const POLICE_SUSPENDED_ACTIONS: ReadonlyMap<string, string> = new Map([
  // Stage 37: no station or authority check exists, and repeated requests created duplicate requested records.
  ["request_wanted", "police_wanted_request_suspended"],
  ["execute_arrest", "police_arrest_suspended"],
]);

// Stage 39: pay_rent was contained in Stage 34 (no period model, time-based idempotency key). It now has a period model,
// per-period idempotency, and counterparty checks (docs/HOUSING_AND_PROPERTY_PLAN.md, "Rent periods, counterparties, and
// the ledger"). It is no longer suspended.
/**
 * Stage 35: property actions that change persistent state (money, ownership, listings, rentals, furnishing, condition).
 * Each needs a request ID. Its success reply (property.result) is sent only after a save covers the change, as for the
 * other money families. The read-only actions (market, view, my_properties, my_rentals) need no request ID.
 */
const PROPERTY_CHANGING_ACTIONS: ReadonlySet<string> = new Set([
  "list_for_sale", "list_for_rent", "purchase", "rent", "pay_rent", "terminate_rental", "maintain", "furnish",
  "remove_furnishing", "transfer",
]);

/** JSON with object keys sorted at every level, so that equal payloads have equal text. */

// Stage 39: pay_rent is no longer suspended. It now uses the period-based rule and the counterparty checks in
// properties/service.ts. The map stays as the fail-closed hook for any future property suspension.
const PROPERTY_SUSPENDED_ACTIONS: ReadonlyMap<string, string> = new Map<string, string>();

const IDEMPOTENT_COMMANDS = new Set([
  "world.travel",
  "world.bus",
  "shop.purchase",
  "inventory.consume",
  "clinic.care",
  "character.rest",
  "school.answer",
  "education.action",
  "career.action",
  "economy.action",
  "business.action",
  "relationship.progress",
  "family.childbirth",
]);

/**
 * Stage 37: the changing requests of the consequential families. Each needs a request ID, is checked against the saved
 * record, and replies only after its save succeeds (replyAfterSave). Read-only actions of these families are not listed.
 */
const CONSEQUENTIAL_TYPE_FAMILIES: ReadonlyMap<string, ConsequentialFamily> = new Map([
  ["character.rest", "rest"],
  ["relationship.progress", "relationship"],
  ["family.childbirth", "family"],
  ["npc.action", "npc"],
]);
const CONSEQUENTIAL_ACTION_FAMILIES: ReadonlyMap<string, { family: ConsequentialFamily; actions: ReadonlySet<string> }> = new Map([
  ["justice.action", { family: "justice", actions: new Set(["create_proposal", "submit_proposal", "file_case", "submit_evidence", "issue_judgment", "file_appeal"]) }],
  ["police.action", { family: "police", actions: new Set(["apply_recruitment", "submit_incident", "dispatch_unit", "open_investigation", "submit_evidence", "file_complaint"]) }],
  ["military.action", { family: "military", actions: new Set(["apply_for_service", "request_leave"]) }],
  ["crime.action", { family: "crime", actions: new Set(["commit_crime", "report_crime", "start_rehabilitation"]) }],
]);

/** Stage 37: the consequential family of a request, or undefined when the request is not a changing consequential one. */
function consequentialFamilyOf(message: Record<string, unknown>): ConsequentialFamily | undefined {
  if (typeof message.type !== "string") return undefined;
  const byType = CONSEQUENTIAL_TYPE_FAMILIES.get(message.type);
  if (byType !== undefined) return byType;
  const entry = CONSEQUENTIAL_ACTION_FAMILIES.get(message.type);
  if (entry !== undefined && typeof message.action === "string" && entry.actions.has(message.action)) return entry.family;
  return undefined;
}

/**
 * Stage 34: money-moving economy actions. Their reply says "economy.result" only after the change is saved. Until then
 * the reply is "economy.error" with economy_not_saved or economy_outcome_unknown, and the retry uses the same request ID.
 */
const ECONOMY_MONEY_ACTIONS: ReadonlySet<string> = new Set([
  "open_account",
  "deposit",
  "withdraw",
  "transfer",
  "purchase",
  "request_loan",
  "repay_loan",
]);
/** Stage 47: the fixed fees in the economy catalogue that the town bus stop and the clinic charge through the ledger. */
const BUS_FARE_CHARGE_ID = "fixed:town-bus-stop-fare";
const CLINIC_CARE_CHARGE_ID = "fixed:clinic-basic-care";
/** Replay records kept in memory (not saved) for unconfirmed or recently confirmed money requests. */
const MAX_PENDING_MONEY_REPLIES = 256;

/** Stage 37: the families whose changing actions reply only after their save. */
type ConsequentialFamily = "justice" | "police" | "military" | "crime" | "relationship" | "family" | "rest" | "npc";

/**
 * A money change whose reply waits for its save (Stage 34). `generation` is the changeGeneration that holds the change.
 * Kept only in memory: a restart keeps a change only if its save succeeded, and then the request ID is saved with it.
 * Used for every changing family (Stage 34). A change is answered only after a save covers it.
 */
type PendingMoneyReply =
  | { kind: "economy" | "business" | "education" | "career" | "property" | ConsequentialFamily; generation: number; reply: Record<string, unknown>; delivered: boolean; fingerprint?: string; afterConfirm?: () => void }
  | { kind: "snapshot"; generation: number; family: MoneyFamily; delivered: boolean };

/**
 * Business actions that only read (Stage 34). Every other business action changes persistent state (money, stock,
 * ownership, staff), so its business.result is sent only after the save covers the change. Until then the reply is
 * business.error with business_not_saved or business_outcome_unknown, and the retry uses the same request ID.
 */
const BUSINESS_READ_ONLY_ACTIONS: ReadonlySet<string> = new Set(["discover", "view"]);

/**
 * Career actions that only read (Stage 34). Every other career action changes persistent state (applications, shifts,
 * payroll, employment, life events), so its career.result is sent only after the save covers the change.
 */
const CAREER_READ_ONLY_ACTIONS: ReadonlySet<string> = new Set(["search_jobs"]);

/**
 * Wording for the save outcomes of education and career actions (Stage 34). The economy and business families use their
 * own message functions.
 */
const SAVE_OUTCOME_MESSAGES: Readonly<Record<string, string>> = {
  property_not_saved: "The property change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  property_outcome_unknown: "The property change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  property_persistence_unavailable: "Saving is failing, so property changes are paused. Nothing was changed.",
  education_persistence_unavailable: "Saving is failing, so education changes are paused. Nothing was changed.",
  education_not_saved: "The education change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  education_outcome_unknown: "The education change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  career_persistence_unavailable: "Saving is failing, so career changes are paused. Nothing was changed.",
  career_not_saved: "The career change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  career_outcome_unknown: "The career change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  justice_persistence_unavailable: "Saving is failing, so justice changes are paused. Nothing was changed.",
  justice_not_saved: "The justice change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  justice_outcome_unknown: "The justice change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  police_persistence_unavailable: "Saving is failing, so police changes are paused. Nothing was changed.",
  police_not_saved: "The police change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  police_outcome_unknown: "The police change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  military_persistence_unavailable: "Saving is failing, so military changes are paused. Nothing was changed.",
  military_not_saved: "The military change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  military_outcome_unknown: "The military change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  crime_persistence_unavailable: "Saving is failing, so crime changes are paused. Nothing was changed.",
  crime_not_saved: "The crime change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  crime_outcome_unknown: "The crime change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  relationship_persistence_unavailable: "Saving is failing, so relationship changes are paused. Nothing was changed.",
  relationship_not_saved: "The relationship change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  relationship_outcome_unknown: "The relationship change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  npc_persistence_unavailable: "Saving is failing, so social changes with people are paused. Nothing was changed.",
  npc_not_saved: "The social change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  npc_outcome_unknown: "The social change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  family_persistence_unavailable: "Saving is failing, so family changes are paused. Nothing was changed.",
  family_not_saved: "The family change could not be saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  family_outcome_unknown: "The family change may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be applied twice.",
  rest_persistence_unavailable: "Saving is failing, so resting is paused. Nothing was changed.",
};

/**
 * Player charges whose confirmation is the character snapshot carrying the request ID (Stage 34). The family names the
 * error codes (`<family>_not_saved`, `<family>_outcome_unknown`, `<family>_persistence_unavailable`) and the wording.
 */
type MoneyFamily = "shop" | "bus" | "clinic" | "rest";
const MONEY_FAMILY_TEXT: Readonly<Record<MoneyFamily, string>> = {
  shop: "The purchase",
  bus: "The bus fare",
  clinic: "The clinic charge",
  rest: "The rest",
};

/** Refuses a new money change while saving is failing, before anything changes (Stage 34). */
function moneyPausedMessage(family: MoneyFamily): string {
  return `${MONEY_FAMILY_TEXT[family]} is paused while saving is failing. Nothing was changed; try again once saving recovers.`;
}

function moneyReplyKey(player: PersistentPlayer, requestId: string): string {
  return `${player.playerId}\u0000${requestId}`;
}

/** A consequential request that is being processed (Stage 36). `released` resolves when it is no longer in flight. */
interface InFlightRequest {
  command?: string;
  fingerprint?: string;
  released: Promise<void>;
  release: () => void;
}

function newInFlightRequest(): InFlightRequest {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { released, release: () => release() };
}

/** Requests whose ID is recorded durably: the money commands, property changes (Stage 36), and the Stage 37 consequential families. */
function isTrackedRequest(message: Record<string, unknown> & { type: string }): boolean {
  return IDEMPOTENT_COMMANDS.has(message.type) || message.type === "property.action" || consequentialFamilyOf(message) !== undefined;
}

/** The request body that a fingerprint covers: the message without its type and request ID. */
function requestBodyOf(message: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...message };
  delete body.type;
  delete body.requestId;
  return body;
}

const SKIN_TONES: Record<string, string> = {
  "#9b654d": "Warm brown",
  "#70452f": "Deep brown",
  "#b77d58": "Golden brown",
  "#d0a17d": "Light brown",
};
const HAIR_STYLES = new Set(["Short curls", "Braids", "Low cut"]);
const SHIRT_STYLES: Record<string, string> = {
  "#27734a": "Green school shirt",
  "#e5e8d7": "White school shirt",
  "#3f7092": "Blue casual shirt",
};
interface TravelTarget {
  readonly destination: string;
  readonly position: Point2D;
  readonly spawn: Point2D;
}

const TRAVEL_TARGETS: Record<string, Record<string, TravelTarget>> = {
  town: {
    "home-door": { destination: "home", position: { x: 270, y: 485 }, spawn: { x: 220, y: 600 } },
    "school-gate": { destination: "schoolyard", position: { x: 920, y: 455 }, spawn: { x: 240, y: 650 } },
    "market-door": { destination: "market", position: { x: 520, y: 650 }, spawn: { x: 220, y: 600 } },
    "clinic-door": { destination: "clinic", position: { x: 1250, y: 515 }, spawn: { x: 220, y: 600 } },
    "station-door": {
      destination: "police_station", position: { x: 1330, y: 730 }, spawn: { x: 220, y: 600 },
    },
    "hall-door": {
      destination: "community_hall", position: { x: 930, y: 730 }, spawn: { x: 220, y: 600 },
    },
  },
  home: {
    "home-front-door": { destination: "town", position: { x: 220, y: 600 }, spawn: { x: 300, y: 500 } },
  },
  schoolyard: {
    "school-exit": { destination: "town", position: { x: 180, y: 650 }, spawn: { x: 900, y: 475 } },
    "classroom-door": {
      destination: "classroom", position: { x: 1120, y: 500 }, spawn: { x: 260, y: 650 },
    },
    "tertiary-campus-gate": {
      destination: "campus", position: { x: 1400, y: 550 }, spawn: { x: 260, y: 650 },
    },
    "community-skills-centre": {
      destination: "training_center", position: { x: 1400, y: 690 }, spawn: { x: 260, y: 650 },
    },
  },
  classroom: {
    "classroom-exit": {
      destination: "schoolyard", position: { x: 180, y: 650 }, spawn: { x: 1050, y: 560 },
    },
  },
  campus: {
    "campus-exit": { destination: "schoolyard", position: { x: 180, y: 650 }, spawn: { x: 1370, y: 550 } },
  },
  training_center: {
    "training-centre-exit": { destination: "schoolyard", position: { x: 180, y: 650 }, spawn: { x: 1370, y: 690 } },
  },
  market: {
    "market-exit": { destination: "town", position: { x: 180, y: 650 }, spawn: { x: 540, y: 660 } },
  },
  clinic: {
    "clinic-exit": { destination: "town", position: { x: 180, y: 650 }, spawn: { x: 1250, y: 530 } },
  },
  police_station: {
    "station-exit": { destination: "town", position: { x: 180, y: 650 }, spawn: { x: 1330, y: 740 } },
  },
  community_hall: {
    "hall-exit": { destination: "town", position: { x: 180, y: 650 }, spawn: { x: 930, y: 740 } },
  },
};
const LOCATIONS = new Set(Object.keys(TRAVEL_TARGETS));

interface ConnectionContext {
  readonly socket: WebSocket;
  readonly remoteAddress: string;
  playerId: string | null;
  identityCreationPending: boolean;
  identityCreated: boolean;
  invalidCount: number;
  lastInputAt: number;
  lastInputSequence: number;
  inputDirection: Point2D;
  running: boolean;
  chatTimes: number[];
  commandTimes: number[];
  lastWaveAt: number;
  closed: boolean;
}

interface PendingQuiz {
  readonly quizId: string;
  readonly mode: "school" | "final_exam" | "tertiary";
  readonly subjectId: string;
  readonly subject: string;
  readonly correctIndex: number;
  readonly day: number;
  readonly questionId: string;
  readonly assessmentType: string;
  readonly scheduleId?: string;
  readonly registrationId?: string;
  readonly courseId?: string;
}

interface WindowCounter {
  startedAt: number;
  count: number;
}

/**
 * R4 identity-creation budget: new identities (not recoveries) allowed in a rolling window.
 * Limits are enforced inside the persistence queue, so a check and its commit cannot interleave.
 * The global count is derived from saved identities (createdAt), so it survives a restart. The per-IP count
 * is held in memory and resets on restart. Operators set these through NAIJA_IDENTITY_* (see docs).
 */
export interface IdentityBudgetOptions {
  /** New identities allowed from one client address in the window. */
  readonly perIpLimit: number;
  /** New identities allowed from all clients together in the window. */
  readonly globalLimit: number;
  /** Length of the rolling window in milliseconds. */
  readonly windowMs: number;
  /** Most client addresses tracked at once. While full, unknown addresses are refused (fail closed) until entries expire. */
  readonly maxTrackedAddresses?: number;
}

const DEFAULT_MAX_TRACKED_ADDRESSES = 10_000;
const IDENTITY_LIMITED_CODE = "identity_creation_limited";
/** Stable code: the outcome of an earlier save with this creation key is unresolved. Documented in STAGE_28_CREATION_ATOMICITY.md. */
const IDENTITY_PENDING_CODE = "identity_creation_pending";
const IDENTITY_PENDING_MESSAGE =
  "The identity for this key is not confirmed as saved yet. Requests with this key are refused until the world saves successfully.";
/**
 * Stable code (D-05): a creation key alone never transfers or re-issues an existing identity. Key-only recovery is
 * refused before any token rotation, save, or budget use. The existing identity and any session are unchanged.
 */
const IDENTITY_RECOVERY_UNAVAILABLE_CODE = "identity_recovery_unavailable";
const IDENTITY_RECOVERY_UNAVAILABLE_MESSAGE =
  "Identity recovery is not available with a creation key alone. Your existing identity and session are unchanged.";

/**
 * Why a new identity was refused by the R4 budget. A retry time is given only for the per-IP and global windows,
 * which are computed exactly from the saved or recorded creation times. A full address table has no reliable time
 * (any slot may be taken first), so it gives none.
 */
type IdentityBudgetRefusal =
  | { readonly kind: "window"; readonly waitMs: number }
  | { readonly kind: "address-table-full" };

function validatedIdentityBudget(budget: IdentityBudgetOptions): IdentityBudgetOptions & { readonly maxTrackedAddresses: number } {
  const maxTrackedAddresses = budget.maxTrackedAddresses ?? DEFAULT_MAX_TRACKED_ADDRESSES;
  const values = [budget.perIpLimit, budget.globalLimit, budget.windowMs, maxTrackedAddresses];
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 1)) {
    throw new Error("identityBudget values must be positive integers.");
  }
  return { ...budget, maxTrackedAddresses };
}

/** Milliseconds until `limit` entries in the window can be admitted, or null when there is room now. */
function waitForIdentitySlot(times: readonly number[], limit: number, windowMs: number, now: number): number | null {
  const live = times.filter((time) => now - time < windowMs).sort((a, b) => a - b);
  if (live.length < limit) return null;
  // The entry at this index must expire before the count drops below the limit.
  const freeing = live[live.length - limit] ?? now;
  return Math.max(1, freeing + windowMs - now);
}

export interface WorldEngineOptions {
  readonly identityBudget?: IdentityBudgetOptions;
  readonly tickIntervalMs?: number;
  readonly gameMinuteMs?: number;
  readonly broadcastIntervalMs?: number;
  readonly maxConnections?: number;
  readonly connectionAttemptsPerMinute?: number;
  readonly now?: () => number;
  /**
   * Test seam only. Called at named points inside identity creation; a throw simulates a failure at that point.
   * Absent in production, so it has no effect.
   */
  readonly creationFaultHook?: (point: string) => void;
}

function safeClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 32 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null;
}

function pointFrom(value: unknown): Point2D | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

function createCharacter(
  profile: Record<string, unknown>,
  playerId: string,
  now: number,
  geographyRegion: GeographicRegion,
  educationCatalog: EducationCatalog,
  worldDate: CalendarDate,
): CharacterRecord {
  const name = validName(profile.name);
  const age = profile.age;
  const characterType = profile.character_type ?? profile.characterType;
  if (name === null) throw new Error("invalid_name");
  if (age !== 15 && age !== 16) throw new Error("invalid_age");
  if (characterType !== "girl" && characterType !== "boy" && characterType !== "androgynous") {
    throw new Error("invalid_character_type");
  }
  const rawAppearance = isRecord(profile.appearance) ? profile.appearance : {};
  const skinTone = typeof rawAppearance.skin_tone === "string" && SKIN_TONES[rawAppearance.skin_tone]
    ? rawAppearance.skin_tone : "#9b654d";
  const hairStyle = typeof rawAppearance.hairstyle === "string" && HAIR_STYLES.has(rawAppearance.hairstyle)
    ? rawAppearance.hairstyle : "Short curls";
  const shirtColor = typeof rawAppearance.clothing_color === "string" && SHIRT_STYLES[rawAppearance.clothing_color]
    ? rawAppearance.clothing_color : "#27734a";
  const timestamp = new Date(now).toISOString();
  let geographicLocation: CharacterRecord["geographic_location"] = null;
  let currentLocation = "home";
  let position: Point2D = { ...STARTING_POSITION };
  if (profile.geographic_location !== undefined && profile.geographic_location !== null) {
    geographicLocation = geographicLocationFromProfile(profile.geographic_location, geographyRegion);
    position = geographicLocationToMapPosition(geographicLocation, geographyRegion);
    currentLocation = "town";
  }
  const characterId = `character-${randomUUID()}`;
  const educationRecord = createStudentEducationRecord(characterId, age, 1, educationCatalog);
  const character: CharacterRecord = {
    player_id: playerId,
    character_id: characterId,
    name,
    age,
    date_of_birth: { ...worldDate },
    life_stage_id: "secondary-school-youth",
    life_status: "alive",
    household_id: "",
    family_ids: [],
    life_event_ids: [],
    relationship_ids: [],
    last_life_processed_date: { ...worldDate },
    inheritance_event_ids: [],
    character_type: characterType,
    appearance: {
      skin_tone: skinTone,
      skin_tone_name: SKIN_TONES[skinTone] ?? "Warm brown",
      hairstyle: hairStyle,
      hair_color: "#2c211d",
      clothing: SHIRT_STYLES[shirtColor] ?? "Green school shirt",
      clothing_color: shirtColor,
    },
    money: STARTING_MONEY,
    health: 100,
    energy: 90,
    hunger: 82,
    education_level: "Secondary school · JSS 3",
    school_id: educationRecord.school_id,
    home_id: "",
    current_location: currentLocation,
    position,
    direction: { x: 0, y: 1 },
    geographic_location: geographicLocation,
    inventory: [
      { id: "school_bag", name: "School bag", quantity: 1, category: "school" },
      { id: "notebook", name: "Exercise book", quantity: 1, category: "school" },
      { id: "phone", name: "Basic phone", quantity: 1, category: "personal" },
      { id: "meat_pie", name: "Meat pie", quantity: 1, category: "food", hunger_restore: 24 },
      { id: "uniform", name: "School uniform", quantity: 1, category: "clothing" },
    ],
    academic_scores: {},
    attendance: [],
    education_record: educationRecord,
    reputation: 0,
    household: {},
    created_at: timestamp,
    updated_at: timestamp,
  };
  initializeCharacterLife(character, worldDate, age);
  syncLegacyEducation(character, educationCatalog);
  return character;
}

function sanitizeProfile(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isTextMessage(value: unknown): value is Record<string, unknown> & { type: string } {
  return isRecord(value) && typeof value.type === "string" && value.type.length <= 48;
}

function requestIdOf(message: Record<string, unknown>): string | undefined {
  return typeof message.requestId === "string" &&
    message.requestId.length >= 1 && message.requestId.length <= 80 &&
    /^[A-Za-z0-9._:-]+$/.test(message.requestId) ? message.requestId : undefined;
}

function vectorZero(): Point2D {
  return { x: 0, y: 0 };
}

function normalizeDirection(direction: Point2D): Point2D {
  const length = Math.hypot(direction.x, direction.y);
  return length > 1 ? { x: direction.x / length, y: direction.y / length } : direction;
}

function appendOptionalRequestId<T extends Record<string, unknown>>(
  payload: T,
  requestId: string | undefined,
): T | (T & { requestId: string }) {
  return requestId === undefined ? payload : { ...payload, requestId };
}

export class MultiplayerWorld {
  private readonly contexts = new Set<ConnectionContext>();
  private readonly online = new Map<string, ConnectionContext>();
  private readonly playerByTokenHash = new Map<string, string>();
  private readonly playerByCreationKeyHash = new Map<string, string>();
  /** Creation keys with a create request in flight (R1). In-memory only; a restart clears it. */
  private readonly creationKeyReservations = new Set<string>();
  /**
   * Creation keys whose identity outcome is unresolved (Stage 28, same-key conflict). The identity may be in the saved
   * file while the live world does not hold it. Such a key is refused (identity_creation_pending) until a successful save
   * of the live world removes that identity from the file. `slot` is the per-IP budget time held while unresolved, or
   * null when no slot is held (a failed save consumes none). In memory only: a restart drops this map, and the saved
   * identity is then recovered by key like any other saved identity.
   */
  private readonly pendingCreations = new Map<string, { address: string; slot: number | null }>();
  /** Serializes world changes and saves: a save never sees a creation that has not been committed. */
  private persistenceQueue: Promise<void> = Promise.resolve();
  private readonly pendingQuizzes = new Map<string, PendingQuiz>();
  private readonly connectionWindows = new Map<string, WindowCounter>();
  private readonly now: () => number;
  private readonly gameMinuteMs: number;
  private readonly broadcastIntervalMs: number;
  private readonly maxConnections: number;
  private readonly connectionAttemptsPerMinute: number;
  private readonly identityBudget: (IdentityBudgetOptions & { readonly maxTrackedAddresses: number }) | null;
  /** Times of successful new identities, by client address. Process-local (documented). */
  private readonly identityTimesByAddress = new Map<string, number[]>();
  private readonly creationFaultHook: ((point: string) => void) | undefined;
  private readonly geographyRegion: GeographicRegion;
  private readonly educationCatalog: EducationCatalog;
  private readonly socialCatalog: NPCSocialCatalog = loadNPCSocialCatalog();
  private readonly careerCatalog: CareerCatalog = loadCareerCatalog();
  private readonly economyCatalog: EconomyCatalog = loadEconomyCatalog();
  private readonly businessCatalog: BusinessCatalog = loadBusinessCatalog();
  private readonly propertyCatalog: PropertyCatalog = loadPropertyCatalog();
  private readonly governmentCatalog: GovernmentCatalog = loadGovernmentCatalog();
  private readonly electionsCatalog: ElectionsCatalog = loadElectionsCatalog();
  private readonly justiceCatalog: JusticeCatalog = loadJusticeCatalog();
  private readonly policeCatalog = new PoliceCatalogService();
  private readonly militaryCatalog = new MilitaryCatalogService();
  private readonly crimeCatalog = new CrimeCatalogService();
  private readonly cultureCatalog = new CultureCatalogService();
  private readonly entertainmentCatalog = new EntertainmentCatalogService();
  private readonly lifeCatalog = loadLifeCatalog();
  private lastTickAt: number;
  private lastBroadcastAt = 0;
  private lastPersistAt: number;
  private gameMillisecondRemainder = 0;
  private dirty = false;
  /**
   * Stage 36: consequential requests (money and property) that are being processed, by player and request ID. The
   * command and fingerprint are set by the gate and read by markRequestProcessed. A second copy of an in-flight request
   * is refused, so two copies cannot both apply.
   */
  private readonly requestsInFlight = new Map<string, InFlightRequest>();
  private flushInFlight = false;
  /**
   * Treasury durability (Stage 32). changeGeneration counts treasury changes whose reply promises a saved world.
   * savedGeneration is the highest changeGeneration captured by a save that succeeded. A treasury reply is sent only
   * after savedGeneration has caught up with its own change (ensureDurable). Saves run through the persistence queue,
   * so a save captures every change made before it was queued.
   */
  private changeGeneration = 0;
  private savedGeneration = 0;
  /** Money requests waiting for their save, and recently confirmed ones kept for replay (Stage 34). */
  private readonly pendingMoneyReplies = new Map<string, PendingMoneyReply>();
  /** True from the first refused save (over the size limit) until the next successful save. */
  private capacityEpisodeOpen = false;
  /** Stage 38 (R5): online sockets whose per-minute character snapshot was held back for a backlog. */
  private readonly snapshotHeldBack = new WeakSet<ConnectionContext>();
  /** True from the first non-capacity save failure until the next successful save. */
  private persistenceEpisodeOpen = false;
  /** When the first failure notice of the current episode was sent. Null when no notice is open (G3). */
  private failureNoticeOpenedAt: number | null = null;
  /** Failed save attempts since the last successful save. Reported in the recovery signal (G3). */
  private failedSaveAttemptsSinceSuccess = 0;
  /** Outcome of the most recent failed save (Stage 33). Read by ensureDurable to answer a financial request. */
  private lastFailedSaveOutcome: SaveOutcome = "unknown";
  private closed = false;

  constructor(private readonly store: WorldStoreLike, options: WorldEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.gameMinuteMs = Math.max(1, options.gameMinuteMs ?? this.lifeCatalog.calendar.real_milliseconds_per_game_minute);
    this.broadcastIntervalMs = Math.max(50, options.broadcastIntervalMs ?? 100);
    this.maxConnections = Math.max(1, options.maxConnections ?? 64);
    this.connectionAttemptsPerMinute = Math.max(1, options.connectionAttemptsPerMinute ?? 30);
    this.identityBudget = options.identityBudget ? validatedIdentityBudget(options.identityBudget) : null;
    this.creationFaultHook = options.creationFaultHook;
    this.geographyRegion = loadAkureSouthRegion();
    this.educationCatalog = loadEducationCatalog();
    this.lastTickAt = this.now();
    this.lastPersistAt = this.lastTickAt;
    for (const player of Object.values(this.store.state.players)) {
      // A revoked session (logout) is not indexed, so its token is refused after a restart too.
      if (!isSessionRevoked(player.session)) this.playerByTokenHash.set(player.tokenHash, player.playerId);
      this.playerByCreationKeyHash.set(player.creationKeyHash, player.playerId);
    }
  }

  get connectedPlayerCount(): number { return this.online.size; }
  get socketCount(): number { return this.contexts.size; }

  async recordDeathEvent(
    characterId: string,
    cause: DeathCauseCategory,
  ): Promise<ReturnType<typeof recordDeath>> {
    if (!isDeathCauseCategory(cause)) throw new Error("death_cause_invalid");
    const result = recordDeath(this.store.state, characterId, cause);
    const timestamp = new Date(this.now()).toISOString();
    endCareerAtDeath(this.store.state, characterId, this.store.state.worldClock.world_date,
      this.store.state.worldClock.minute_of_day, this.now());
    this.dirty = true;
    if (!result.alreadyDeceased) {
      this.dirty = true;
      const player = Object.values(this.store.state.players).find((entry) => entry.character.character_id === characterId);
      if (player) {
        player.character.updated_at = timestamp;
        player.lastSeen = timestamp;
        const context = this.online.get(player.playerId);
        if (context) {
          context.inputDirection = vectorZero();
          context.running = false;
          this.sendCharacterSnapshot(context);
          this.send(context, { type: "presence.left", player: this.toPresence(player, "disconnected") });
        }
      } else if (this.store.state.people[characterId]) {
        this.store.state.people[characterId]!.updated_at = timestamp;
      }
    }
    await this.flushDirty();
    return result;
  }

  async recordRetirementEvent(characterId: string): Promise<LifeEventRecord> {
    const now = this.now();
    const date = { ...this.store.state.worldClock.world_date };
    const minuteOfDay = this.store.state.worldClock.minute_of_day;
    const event = recordRetirement(this.store.state, characterId);
    requestCareerRetirement(this.store.state, characterId, date, minuteOfDay, now,
      economyAccountPort(this.store.state, this.economyCatalog));
    this.dirty = true;
    const timestamp = new Date(now).toISOString();
    const player = Object.values(this.store.state.players).find((entry) => entry.character.character_id === characterId);
    if (player) {
      player.character.updated_at = timestamp;
      player.lastSeen = timestamp;
      const context = this.online.get(player.playerId);
      if (context) this.sendCharacterSnapshot(context);
    } else if (this.store.state.people[characterId]) {
      this.store.state.people[characterId]!.updated_at = timestamp;
    }
    await this.flushDirty();
    return event;
  }

  /**
   * `clientAddress` is the address the limits use (see client-address.ts). Without it the socket address is used.
   * Only app.ts supplies it, after applying the trusted-proxy policy.
   */
  attach(socket: WebSocket, request: IncomingMessage, clientAddress?: string): void {
    const now = this.now();
    const remoteAddress = clientAddress ?? request.socket.remoteAddress ?? "unknown";
    if (this.closed || this.contexts.size >= this.maxConnections) {
      socket.close(1013, "server capacity reached");
      return;
    }
    if (!this.allowConnection(remoteAddress, now)) {
      socket.close(1008, "connection rate limit");
      return;
    }
    const context: ConnectionContext = {
      socket, remoteAddress, playerId: null, identityCreationPending: false, identityCreated: false,
      invalidCount: 0, lastInputAt: 0, lastInputSequence: -1, inputDirection: vectorZero(),
      running: false, chatTimes: [], commandTimes: [], lastWaveAt: 0, closed: false,
    };
    this.contexts.add(context);
    console.info("multiplayer socket connected");
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        this.invalid(context, "binary_not_supported");
        return;
      }
      const raw = Array.isArray(data) ? Buffer.concat(data).toString("utf8")
        : Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.from(data as ArrayBuffer).toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_MESSAGE_BYTES) {
        this.invalid(context, "message_too_large");
        return;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(raw) as unknown; }
      catch { this.invalid(context, "malformed_json"); return; }
      if (!isTextMessage(parsed)) {
        this.invalid(context, "invalid_message");
        return;
      }
      void this.handleMessage(context, parsed).catch((error: unknown) => {
        console.error("multiplayer request failed", this.errorCode(error));
        this.sendError(context, "internal_error", "The request could not be completed.", requestIdOf(parsed));
      });
    });
    socket.on("close", () => { void this.disconnect(context); });
    socket.on("error", () => { console.warn("multiplayer socket error"); });
  }

  tick(now: number = this.now()): void {
    if (this.closed) return;
    const elapsed = clamp(now - this.lastTickAt, 0, 1000);
    this.lastTickAt = now;
    const scaledGameMilliseconds = elapsed * 60_000 / this.gameMinuteMs + this.gameMillisecondRemainder;
    const wholeGameMilliseconds = Math.floor(scaledGameMilliseconds);
    this.gameMillisecondRemainder = scaledGameMilliseconds - wholeGameMilliseconds;
    const deltaSeconds = elapsed / 1000;
    let changed = false;
    for (const context of this.online.values()) {
      const player = this.playerFor(context);
      if (!player || !canTakeActiveAction(player.character)) continue;
      const direction = now - context.lastInputAt <= 250 ? context.inputDirection : vectorZero();
      if (Math.hypot(direction.x, direction.y) > 0.001 && deltaSeconds > 0) {
        const speed = context.running ? 320 : 205;
        const prior = player.character.position;
        const next = {
          x: clamp(prior.x + direction.x * speed * deltaSeconds, 28, MAP_WIDTH - 28),
          y: clamp(prior.y + direction.y * speed * deltaSeconds, 28, MAP_HEIGHT - 28),
        };
        const actualDistance = distance(prior, next);
        if (actualDistance > 0.01) {
          player.character.position = next;
          player.character.direction = { ...direction };
          if (player.character.geographic_location !== null && player.character.current_location === "town") {
            player.character.geographic_location = geographicLocationForMapPosition(next, this.geographyRegion);
          }
          player.character.energy = clamp(player.character.energy - actualDistance * (context.running ? 0.003 : 0.0017), 0, 100);
          player.character.updated_at = new Date(now).toISOString();
          player.lastSeen = player.character.updated_at;
          changed = true;
        }
      }
    }
    if (wholeGameMilliseconds > 0) {
      this.advanceWorldMilliseconds(wholeGameMilliseconds, now);
      changed = true;
    }
    this.releaseHeldSnapshots();
    if (now - this.lastBroadcastAt >= this.broadcastIntervalMs) {
      this.lastBroadcastAt = now;
      this.broadcastWorldSnapshot();
    }
    if (changed) this.dirty = true;
    if (this.dirty && now - this.lastPersistAt >= 1000) void this.flushDirty();
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const context of this.contexts) {
      if (context.socket.readyState === WebSocket.OPEN) context.socket.close(1001, "server shutting down");
    }
    await this.serialize(() => this.store.flush());
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.persistenceQueue.then(operation, operation);
    this.persistenceQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** R4: null when a new identity may be created now; otherwise why not. Runs inside the persistence queue. */
  private identityBudgetRefusal(address: string, now: number): IdentityBudgetRefusal | null {
    const budget = this.identityBudget;
    if (budget === null) return null;
    // Drop expired address entries, then refuse an unknown address while the table is full (fail closed).
    for (const [key, times] of this.identityTimesByAddress) {
      const live = times.filter((time) => now - time < budget.windowMs);
      if (live.length === 0) this.identityTimesByAddress.delete(key);
      else if (live.length !== times.length) this.identityTimesByAddress.set(key, live);
    }
    if (!this.identityTimesByAddress.has(address) && this.identityTimesByAddress.size >= budget.maxTrackedAddresses) {
      return { kind: "address-table-full" };
    }
    const perIp = waitForIdentitySlot(this.identityTimesByAddress.get(address) ?? [], budget.perIpLimit, budget.windowMs, now);
    if (perIp !== null) return { kind: "window", waitMs: perIp };
    const created: number[] = [];
    for (const player of Object.values(this.store.state.players)) {
      const time = Date.parse(player.createdAt);
      if (Number.isFinite(time)) created.push(time);
    }
    const global = waitForIdentitySlot(created, budget.globalLimit, budget.windowMs, now);
    return global === null ? null : { kind: "window", waitMs: global };
  }

  private recordIdentityCreated(address: string, now: number): void {
    const budget = this.identityBudget;
    if (budget === null) return;
    const times = (this.identityTimesByAddress.get(address) ?? []).filter((time) => now - time < budget.windowMs);
    times.push(now);
    this.identityTimesByAddress.set(address, times);
  }

  /** Gives back one per-IP slot taken by recordIdentityCreated, for an identity that was removed from the saved file. */
  private releaseIdentityCreated(address: string, time: number): void {
    const times = this.identityTimesByAddress.get(address);
    if (!times) return;
    const index = times.indexOf(time);
    if (index === -1) return;
    times.splice(index, 1);
    if (times.length === 0) this.identityTimesByAddress.delete(address);
  }

  /**
   * Marks a creation key as unresolved. `holdBudget` is true when the identity save itself committed (the conflict
   * case), so the identity may be in the saved file and holds one per-IP slot until it is resolved. It is false for a
   * failed save, which consumes no budget. Either way the next save of the live world is requested.
   */
  private markCreationPending(creationKeyHash: string, address: string, now: number, holdBudget: boolean): void {
    const previous = this.pendingCreations.get(creationKeyHash);
    if (previous?.slot != null) this.releaseIdentityCreated(previous.address, previous.slot);
    const slot = holdBudget && this.identityBudget !== null ? now : null;
    if (slot !== null) this.recordIdentityCreated(address, slot);
    this.pendingCreations.set(creationKeyHash, { address, slot });
    this.dirty = true;
  }

  /**
   * Resolves every unresolved creation: a successful save writes the live world, which holds none of those identities,
   * so they are no longer in the file. Their held budget slots are given back. Called on every successful save.
   */
  private resolvePendingCreations(): void {
    for (const pending of this.pendingCreations.values()) {
      if (pending.slot !== null) this.releaseIdentityCreated(pending.address, pending.slot);
    }
    this.pendingCreations.clear();
  }

  /**
   * Saves the live world, outside the persistence queue (the caller is already inside it). Returns false if the save
   * failed; the saved file is then unchanged by this call.
   */
  private async saveLiveWorld(): Promise<boolean> {
    try {
      await this.store.flush();
    } catch {
      this.failedSaveAttemptsSinceSuccess += 1;
      return false;
    }
    this.lastPersistAt = this.now();
    this.dirty = false;
    this.noteSaveSucceeded();
    return true;
  }

  /**
   * The refusal sent to the client. It names no limit, address, player or secret. retry_after_seconds is present only
   * when the time is computed from a window (see IdentityBudgetRefusal).
   */
  private identityLimitReply(refusal: IdentityBudgetRefusal): { message: string; retryAfterSeconds?: number } {
    if (refusal.kind === "address-table-full") {
      return { message: "Too many new identities are being created right now. Try again later." };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil(refusal.waitMs / 1000));
    const minutes = Math.max(1, Math.ceil(refusal.waitMs / 60_000));
    return {
      message: `Too many new identities were created recently. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSeconds,
    };
  }

  private allowConnection(address: string, now: number): boolean {
    const key = address.slice(0, 64);
    if (this.connectionWindows.size >= 2048) {
      for (const [entryKey, entry] of this.connectionWindows) {
        if (now - entry.startedAt >= 60_000) this.connectionWindows.delete(entryKey);
      }
      if (!this.connectionWindows.has(key) && this.connectionWindows.size >= 2048) return false;
    }
    const window = this.connectionWindows.get(key);
    if (!window || now - window.startedAt >= 60_000) {
      this.connectionWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (window.count >= this.connectionAttemptsPerMinute) return false;
    window.count += 1;
    return true;
  }

  private allowCommand(context: ConnectionContext, now: number): boolean {
    context.commandTimes = context.commandTimes.filter((timestamp) => now - timestamp < COMMAND_WINDOW_MS);
    if (context.commandTimes.length >= GENERAL_COMMANDS_PER_WINDOW) return false;
    context.commandTimes.push(now);
    return true;
  }

  /**
   * Records an applied request. Its command and fingerprint come from the in-flight entry for this request (Stage 36).
   * The durable record is queued here and written by the save that commits this change.
   */
  private markRequestProcessed(player: PersistentPlayer, requestId: string | undefined): void {
    if (requestId === undefined || player.recentRequestIds.includes(requestId)) return;
    player.recentRequestIds.push(requestId);
    if (player.recentRequestIds.length > MAX_RECENT_REQUESTS) player.recentRequestIds.shift();
    const entry = this.requestsInFlight.get(moneyReplyKey(player, requestId));
    if (entry?.command !== undefined && entry.fingerprint !== undefined) {
      const records = player.recentRequestRecords ?? (player.recentRequestRecords = []);
      records.push({ request_id: requestId, command: entry.command, fingerprint: entry.fingerprint });
      while (records.length > MAX_RECENT_REQUESTS) records.shift();
      this.store.queueOperation?.({ playerId: player.playerId, requestId, command: entry.command, fingerprint: entry.fingerprint });
    }
    this.dirty = true;
  }

  /**
   * Compares a request ID with the record of an earlier request that used it (Stage 36). Memory is checked first, then
   * the durable record, so a request applied by another process is recognised. A request recorded before Stage 36 has
   * no fingerprint; it is answered as a duplicate and is not applied again. Throws when the durable lookup fails: the
   * caller must refuse the request then, because it cannot tell whether the ID is new.
   */
  private async priorRequestVerdict(
    player: PersistentPlayer,
    requestId: string,
    command: string,
    fingerprint: string,
  ): Promise<"new" | "duplicate" | "reused"> {
    const record = (player.recentRequestRecords ?? []).find((entry) => entry.request_id === requestId);
    if (record !== undefined) return compareWithRecord(record, command, fingerprint);
    if (player.recentRequestIds.includes(requestId)) return "duplicate";
    const stored = await this.durableRequest(player, requestId);
    return stored === undefined ? "new" : compareWithRecord(stored, command, fingerprint);
  }

  /** The durable record of a request ID for this player, or undefined. Stores without durable records return undefined. */
  private async durableRequest(player: PersistentPlayer, requestId: string): Promise<StoredOperation | undefined> {
    if (typeof this.store.findOperation !== "function") return undefined;
    return this.store.findOperation(player.playerId, requestId);
  }

  private async handleMessage(context: ConnectionContext, message: Record<string, unknown> & { type: string }): Promise<void> {
    const requestId = requestIdOf(message);
    const now = this.now();
    if (message.type !== "movement.input" && !this.allowCommand(context, now)) {
      this.sendError(context, "rate_limited", "Too many commands were sent in a short time.", requestId);
      return;
    }
    if (message.type === "identity.create") {
      if (context.identityCreated) {
        this.sendError(context, "already_authenticated", "This connection already created an identity.", requestId);
        return;
      }
      if (context.identityCreationPending) {
        this.sendError(context, "rate_limited", "An identity request is already being processed.", requestId);
        return;
      }
      context.identityCreationPending = true;
      try {
        await this.createIdentity(context, message, requestId);
      } finally {
        context.identityCreationPending = false;
      }
      return;
    }
    if (message.type === "session.resume") {
      await this.resumeSession(context, message, requestId);
      return;
    }
    if (message.type === "session.logout") {
      await this.logout(context, requestId);
      return;
    }
    const player = this.playerFor(context);
    if (!player) {
      if (message.type === "movement.input") {
        if (now - context.lastInputAt < MOVEMENT_MIN_INTERVAL_MS) {
          this.sendError(context, "rate_limited", "Movement input is arriving too quickly.", requestId);
          return;
        }
        context.lastInputAt = now;
      }
      this.sendError(context, "not_authenticated", "Connect with a valid identity first.", requestId);
      return;
    }
    if (!canTakeActiveAction(player.character)) {
      this.sendError(context, "character_deceased", "This character is deceased; active world actions are unavailable.", requestId);
      return;
    }
    if (requestId !== undefined && isTrackedRequest(message)) {
      const key = moneyReplyKey(player, requestId);
      // A request with a pending (unconfirmed) change is answered from that record once its save succeeds (Stage 34).
      if (this.pendingMoneyReplies.has(key)) {
        await this.routePlayerMessage(context, player, message, requestId, now);
        return;
      }
      // A second copy waits until the first has finished, so two copies never apply at once. The gate then answers the
      // second copy: a duplicate once the first is recorded (the same answer as a later retry).
      let earlier = this.requestsInFlight.get(key);
      while (earlier !== undefined) {
        await earlier.released;
        earlier = this.requestsInFlight.get(key);
      }
      const entry = newInFlightRequest();
      this.requestsInFlight.set(key, entry);
      try {
        await this.routePlayerMessage(context, player, message, requestId, now);
      } finally {
        this.releaseRequest(key, entry);
      }
      return;
    }
    await this.routePlayerMessage(context, player, message, requestId, now);
  }

  private async routePlayerMessage(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown> & { type: string },
    requestId: string | undefined,
    now: number,
  ): Promise<void> {
    if (IDEMPOTENT_COMMANDS.has(message.type) || consequentialFamilyOf(message) !== undefined) {
      if (requestId === undefined) {
        this.sendError(context, "request_id_required", "This action requires a unique request ID.");
        return;
      }
      // Stage 36: a repeat is a duplicate only when its command and fingerprint match the recorded request.
      const fingerprint = requestFingerprint(message.type, requestBodyOf(message));
      const entry = this.requestsInFlight.get(moneyReplyKey(player, requestId));
      if (entry !== undefined) {
        entry.command = message.type;
        entry.fingerprint = fingerprint;
      }
      let verdict: "new" | "duplicate" | "reused";
      try {
        verdict = await this.priorRequestVerdict(player, requestId, message.type, fingerprint);
      } catch {
        this.sendError(context, "request_check_unavailable", "The request could not be checked against saved records. Nothing was changed; retry later.", requestId);
        return;
      }
      if (verdict === "reused") {
        this.sendRequestReused(context, requestId);
        return;
      }
      if (verdict === "duplicate") {
        // Stage 34: a request whose money change is not confirmed yet is answered only after its save succeeds.
        const key = moneyReplyKey(player, requestId);
        const pending = this.pendingMoneyReplies.get(key);
        if (pending !== undefined) {
          await this.confirmMoneyReply(context, key, requestId, pending, true);
          return;
        }
        this.send(context, { type: "command.duplicate", requestId });
        this.sendCharacterSnapshot(context, requestId);
        return;
      }
      // Stage 37: a new change in a consequential family starts only while saving works (as for money, Stage 33).
      // Nothing is changed or recorded when it is refused, and a retry with the same request ID is then a new request.
      const family = consequentialFamilyOf(message);
      if (family !== undefined && !this.financialWritesOpen()) {
        const code = `${family}_persistence_unavailable`;
        this.sendError(context, code, SAVE_OUTCOME_MESSAGES[code] ?? "Saving is failing, so this change is paused. Nothing was changed.", requestId);
        return;
      }
    }
    player.lastSeen = new Date(now).toISOString();
    if (player.session !== undefined) player.session.lastActivityAt = player.lastSeen;
    switch (message.type) {
      case "movement.input": this.handleMovement(context, message, requestId); return;
      case "world.travel": await this.travel(context, player, message, requestId); return;
      case "world.bus": await this.takeBus(context, player, requestId); return;
      case "shop.purchase": await this.purchaseItem(context, player, message, requestId); return;
      case "inventory.consume": await this.consumeItem(context, player, message, requestId); return;
      case "clinic.care": await this.visitClinic(context, player, requestId); return;
      case "character.rest": await this.rest(context, player, requestId); return;
      case "geography.enter": await this.enterGeographicRegion(context, player, message, requestId); return;
      case "geography.leave": await this.leaveGeographicRegion(context, player, requestId); return;
      case "school.begin": this.beginLesson(context, player, requestId); return;
      case "school.answer": await this.answerLesson(context, player, message, requestId); return;
      case "education.action": await this.educationAction(context, player, message, requestId); return;
      case "career.action": await this.careerAction(context, player, message, requestId); return;
      case "economy.action": await this.economyAction(context, player, message, requestId); return;
      case "business.action": await this.businessAction(context, player, message, requestId); return;
      case "property.action": await this.propertyAction(context, player, message, requestId); return;
      case "government.action": await this.governmentAction(context, player, message, requestId); return;
      case "election.action": await this.electionAction(context, player, message, requestId); return;
      case "justice.action": await this.justiceAction(context, player, message, requestId); return;
      case "police.action": await this.policeAction(context, player, message, requestId); return;
      case "military.action": await this.militaryAction(context, player, message, requestId); return;
      case "crime.action": await this.crimeAction(context, player, message, requestId); return;
      case "culture.action": await this.cultureAction(context, player, message, requestId); return;
      case "entertainment.action": await this.entertainmentAction(context, player, message, requestId); return;
      case "chat.send": this.handleChat(context, player, message, requestId); return;
      case "player.interact": this.handlePlayerInteraction(context, player, message, requestId); return;
      case "relationship.progress": await this.progressRelationship(context, player, message, requestId); return;
      case "npc.action": await this.npcAction(context, player, message, requestId); return;
      case "npc.view": this.npcView(context, player, message, requestId); return;
      case "family.childbirth": await this.recordChildbirth(context, player, message, requestId); return;
      default: this.invalid(context, "unknown_message", requestId);
    }
  }

  /**
   * Identity creation (R1, R2).
   *
   * On arrival, the request is validated and its creation key is reserved synchronously, so a second
   * request with the same key is refused at once instead of racing it. The world is then changed only
   * inside the serialized persistence queue. A new identity is built on a private copy of the world and
   * saved as a candidate; only a successful save is merged into the live world, so a failed or refused
   * save leaves nothing behind. The reservation is released when the request settles, whatever the outcome.
   */
  private async createIdentity(context: ConnectionContext, message: Record<string, unknown>, requestId?: string): Promise<void> {
    if (context.playerId !== null) {
      this.sendError(context, "already_authenticated", "This connection already has an identity.", requestId);
      return;
    }
    const creationKey = message.creationKey;
    if (typeof creationKey !== "string" || !/^[a-f0-9]{64}$/i.test(creationKey)) {
      this.sendError(context, "invalid_creation_key", "A valid identity recovery key is required.", requestId);
      return;
    }
    const profile = sanitizeProfile(message.profile);
    if (!profile) {
      this.sendError(context, "invalid_profile", "A valid character profile is required.", requestId);
      return;
    }
    const creationKeyHash = createHash("sha256").update(creationKey).digest("hex");
    if (this.creationKeyReservations.has(creationKeyHash)) {
      this.sendError(context, "identity_creation_in_progress", "An identity for this key is already being processed. Try again shortly.", requestId);
      return;
    }
    this.creationKeyReservations.add(creationKeyHash);
    try {
      await this.serialize(() => this.commitIdentity(context, creationKeyHash, profile, requestId));
    } finally {
      this.creationKeyReservations.delete(creationKeyHash);
    }
  }

  /** Runs inside the persistence queue: nothing else changes or saves the world meanwhile. */
  private async commitIdentity(
    context: ConnectionContext,
    creationKeyHash: string,
    profile: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (context.socket.readyState !== WebSocket.OPEN) return;
    // An earlier save with this key is unresolved. Resolve it first, by saving the live world (which removes that
    // identity from the file). If that save fails, refuse: this is not a new identity and no record is written.
    if (this.pendingCreations.has(creationKeyHash) && !(await this.saveLiveWorld())) {
      this.sendError(context, IDENTITY_PENDING_CODE, IDENTITY_PENDING_MESSAGE, requestId);
      return;
    }
    const existingPlayerId = this.playerByCreationKeyHash.get(creationKeyHash);
    const existingPlayer = existingPlayerId ? this.store.state.players[existingPlayerId] : undefined;
    if (existingPlayerId && existingPlayer) {
      // D-05: key-only recovery is refused until the verified, cancellable recovery procedure exists. This happens
      // before any token rotation, save, or budget use, so the identity, its record, and its sessions are untouched.
      // `recoverIdentity` is kept for that future procedure and is intentionally not reached from here.
      this.sendError(context, IDENTITY_RECOVERY_UNAVAILABLE_CODE, IDENTITY_RECOVERY_UNAVAILABLE_MESSAGE, requestId);
      return;
    }
    // R4: a recovery above is not a new identity and never uses the budget. A refusal changes nothing.
    const budgetNow = this.now();
    const refusal = this.identityBudgetRefusal(context.remoteAddress, budgetNow);
    if (refusal !== null) {
      monitoring.recordIdentityCreation("limited");
      const reply = this.identityLimitReply(refusal);
      this.sendError(context, IDENTITY_LIMITED_CODE, reply.message, requestId, reply.retryAfterSeconds);
      return;
    }
    if (Object.keys(this.store.state.players).length >= MAX_PERSISTED_PLAYERS) {
      monitoring.recordIdentityCreation("capacity_refused");
      this.sendError(context, "world_capacity_reached", "The prototype player record limit has been reached.", requestId);
      return;
    }

    const playerId = `player-${randomUUID()}`;
    const sessionToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
    const timestamp = new Date(this.now()).toISOString();
    const base = this.store.state;
    const draft = structuredClone(base) as PersistentWorldState;

    let character: CharacterRecord;
    try {
      character = createCharacter(
        profile,
        playerId,
        this.now(),
        this.geographyRegion,
        this.educationCatalog,
        draft.worldClock.world_date,
      );
    } catch (error) {
      this.sendError(context, this.errorCode(error), "The character profile was not accepted.", requestId);
      return;
    }
    const player: PersistentPlayer = {
      playerId, tokenHash, creationKeyHash, recentRequestIds: [],
      createdAt: timestamp, lastSeen: timestamp, character,
      session: { issuedAt: timestamp, lastActivityAt: timestamp },
    };
    draft.players[playerId] = player;
    this.creationFaultHook?.("player-inserted");
    try {
      createStarterFamily(draft, playerId, character, this.now());
    } catch (error) {
      monitoring.recordIdentityCreation("failed");
      this.sendError(context, this.errorCode(error), "The character family could not be created.", requestId);
      return;
    }
    this.creationFaultHook?.("starter-family");
    try {
      this.seedNewIdentityWorlds(draft);
    } catch {
      console.error("multiplayer identity build failed");
      monitoring.recordIdentityCreation("failed");
      this.sendError(context, "internal_error", "The identity could not be created.", requestId);
      return;
    }

    const changes = diffState(base, draft);
    try {
      this.creationFaultHook?.("before-save");
      await this.store.saveState(draft);
    } catch (error) {
      this.failedSaveAttemptsSinceSuccess += 1;
      if (error instanceof WorldStateCapacityError) {
        monitoring.recordIdentityCreation("capacity_refused");
        this.sendError(context, "world_capacity_reached", "The world data limit has been reached; no new identities can be saved.", requestId);
        if (this.enterCapacityEpisode()) {
          this.openFailureNotice();
          console.error("multiplayer world state is over its size limit; saves are refused and the previous file is kept");
          for (const other of this.online.values()) {
            if (other !== context) this.sendError(other, "world_capacity_reached", "The world has reached its size limit. Recent changes are not saved yet.");
          }
        }
      } else {
        console.error("multiplayer identity persistence failed");
        monitoring.recordIdentityCreation("failed");
        // The outcome of a failed save is unknown: the file may hold the identity. Keep the key unresolved until a save
        // succeeds. A failed save consumes no budget.
        this.markCreationPending(creationKeyHash, context.remoteAddress, budgetNow, false);
        this.sendError(
          context,
          "persistence_failed",
          "The new identity could not be confirmed as saved. Requests with this key are refused until saving works again.",
          requestId,
        );
      }
      return;
    }

    // Committed. Merge without awaiting, and only if no live value that the creation relies on has changed.
    this.creationFaultHook?.("after-save");
    this.noteSaveSucceeded();
    const conflicts = mergeStateChanges(this.store.state, changes);
    if (conflicts.length > 0) {
      // The saved world now holds the identity, but the live world cannot take it. Save the live world
      // so the two agree again (this removes the identity from the saved world), then report the conflict.
      console.error("multiplayer identity merge conflict", conflicts.length);
      this.dirty = true;
      const removedFromSave = await this.saveLiveWorld();
      if (!removedFromSave) console.error("multiplayer identity compensating save failed");
      monitoring.recordIdentityCreation("failed");
      if (removedFromSave) {
        // The identity is gone from the file too: nothing was created, and nothing is charged. Retrying is allowed.
        this.sendError(context, "identity_creation_conflict", "The world changed while the identity was being created. Try again.", requestId);
      } else {
        // The identity may still be in the saved file. It stays unresolved: this key is refused until a save succeeds,
        // and the identity holds one per-IP slot until then (R4). It is not returned to the player.
        this.markCreationPending(creationKeyHash, context.remoteAddress, budgetNow, true);
        this.sendError(context, IDENTITY_PENDING_CODE, IDENTITY_PENDING_MESSAGE, requestId);
      }
      return;
    }
    monitoring.recordIdentityCreation("accepted");
    this.recordIdentityCreated(context.remoteAddress, budgetNow);
    this.playerByTokenHash.set(tokenHash, playerId);
    this.playerByCreationKeyHash.set(creationKeyHash, playerId);
    this.lastPersistAt = this.now();
    context.identityCreated = true;
    this.send(context, appendOptionalRequestId({ type: "identity.created", playerId, sessionToken }, requestId));
  }

  /** The world records a new identity needs, written into the draft. Order matches the original path. */
  private seedNewIdentityWorlds(draft: PersistentWorldState): void {
    initializeEconomyWorldState(draft, this.now());
    this.creationFaultHook?.("economy");
    initializeBusinessWorldState(draft);
    initializePropertyWorldState(draft);
    seedProperties(draft, draft.worldClock.world_date, this.now(), this.propertyCatalog);
    this.creationFaultHook?.("property");
    initializeGovernmentWorldState(draft);
    seedGovernmentWorld(draft, draft.worldClock.world_date, this.now(), this.governmentCatalog);
    this.creationFaultHook?.("government");
    initializeElectionWorldState(draft);
    initializeJusticeWorldState(draft);
    seedJusticeWorld(draft, draft.worldClock.world_date, this.now(), this.justiceCatalog);
    this.creationFaultHook?.("justice");
    initializePoliceWorldState(draft);
    seedPoliceWorld(draft, draft.worldClock.world_date);
    initializeMilitaryWorldState(draft);
    seedMilitaryWorld(draft, draft.worldClock.world_date);
    this.creationFaultHook?.("military");
    initializeCrimeWorldState(draft);
    seedCrimeWorld();
    initializeCultureWorldState(draft);
    seedCultureWorld();
    this.creationFaultHook?.("culture");
    initializeEntertainmentWorldState(draft);
    seedEntertainmentWorld();
    this.creationFaultHook?.("entertainment");
  }

  /**
   * Key-based recovery of an existing identity. Runs inside the persistence queue. It rotates the token,
   * saves, and on failure undoes only the values it set, and only where nothing else has changed them.
   */
  private async recoverIdentity(
    context: ConnectionContext,
    playerId: string,
    player: PersistentPlayer,
    requestId?: string,
  ): Promise<void> {
    const active = this.online.get(playerId);
    if (active && active.socket.readyState === WebSocket.OPEN) {
      this.sendError(context, "player_already_connected", "This identity is already connected.", requestId);
      context.socket.close(4409, "identity already connected");
      return;
    }
    const oldTokenHash = player.tokenHash;
    const oldLastSeen = player.lastSeen;
    const oldUpdatedAt = player.character.updated_at;
    const sessionToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
    const timestamp = new Date(this.now()).toISOString();
    player.tokenHash = tokenHash;
    player.lastSeen = timestamp;
    player.character.updated_at = timestamp;
    this.playerByTokenHash.delete(oldTokenHash);
    this.playerByTokenHash.set(tokenHash, playerId);
    // The upcoming snapshot includes all current changes; keep later concurrent dirtiness intact.
    this.dirty = false;
    try {
      await this.store.flush();
      this.lastPersistAt = this.now();
      this.noteSaveSucceeded();
    } catch {
      this.failedSaveAttemptsSinceSuccess += 1;
      this.dirty = true;
      if (player.tokenHash === tokenHash) player.tokenHash = oldTokenHash;
      if (player.lastSeen === timestamp) player.lastSeen = oldLastSeen;
      if (player.character.updated_at === timestamp) player.character.updated_at = oldUpdatedAt;
      if (this.playerByTokenHash.get(tokenHash) === playerId) this.playerByTokenHash.delete(tokenHash);
      this.playerByTokenHash.set(oldTokenHash, playerId);
      this.sendError(context, "persistence_failed", "The identity could not be recovered.", requestId);
      console.error("multiplayer identity recovery persistence failed");
      return;
    }
    context.identityCreated = true;
    this.send(context, appendOptionalRequestId({ type: "identity.created", playerId, sessionToken }, requestId));
  }

  private async resumeSession(context: ConnectionContext, message: Record<string, unknown>, requestId?: string): Promise<void> {
    if (context.playerId !== null) {
      this.sendError(context, "already_authenticated", "This connection already has an identity.", requestId);
      return;
    }
    const token = message.sessionToken;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
      this.sendError(context, "session_invalid", "The saved session is invalid.", requestId);
      return;
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const playerId = this.playerByTokenHash.get(tokenHash);
    const player = playerId ? this.store.state.players[playerId] : undefined;
    if (playerId === undefined || !player || isSessionRevoked(player.session)) {
      console.warn("multiplayer session rejected", "session_invalid");
      this.sendError(context, "session_invalid", "The saved session was not recognized.", requestId);
      return;
    }
    const existing = this.online.get(playerId);
    if (existing && existing !== context && existing.socket.readyState === WebSocket.OPEN) {
      this.sendError(context, "player_already_connected", "This identity is already connected.", requestId);
      context.socket.close(4409, "identity already connected");
      return;
    }
    advanceWorldLife(this.store.state, this.store.state.worldClock.world_date);
    processCareerWorldDate(this.store.state, this.store.state.worldClock.world_date, this.now(), this.careerCatalog,
      economyAccountPort(this.store.state, this.economyCatalog));
    processEconomyWorldDate(this.store.state, this.store.state.worldClock.world_date, this.now(), this.economyCatalog);
    processBusinessWorldDate(this.store.state, this.store.state.worldClock.world_date, this.now(), this.businessCatalog);
    processPropertyWorldDate(this.store.state);
    // Reconcile first (Stage 31): fills in missing organisations, offices, and treasury accounts on older worlds. It is
    // idempotent and changes nothing when the structure is already complete.
    if (reconcileGovernmentStructure(this.store.state, this.store.state.worldClock.world_date, this.now(), this.governmentCatalog) > 0) {
      this.dirty = true;
    }
    processGovernmentWorldDate(this.store.state, this.store.state.worldClock.world_date, this.now());
    processElectionWorldDate(this.store.state, this.store.state.worldClock.world_date, this.now());
    processJusticeWorldDate(this.store.state, this.store.state.worldClock.world_date, this.now());
    processCareerWorldMinute(this.store.state, this.store.state.worldClock.world_date,
      this.store.state.worldClock.minute_of_day, this.now(), this.careerCatalog);
    // Log-only (D-06): record whether this session would exceed the limits. Nothing is refused for it.
    console.info(describeSessionPolicy(evaluateSessionPolicy(player.session, player.lastSeen, this.now())), playerId);
    context.playerId = playerId;
    this.online.set(playerId, context);
    const timestamp = new Date(this.now()).toISOString();
    player.lastSeen = timestamp;
    if (player.session !== undefined) player.session.lastActivityAt = timestamp;
    player.character.updated_at = timestamp;
    this.dirty = true;
    this.send(context, appendOptionalRequestId({
      type: "session.ready", playerId, character: this.characterSnapshot(player),
      world: { id: WORLD_ID, clock: worldClockSnapshot(this.store.state.worldClock, this.lifeCatalog) },
      players: this.publicPresenceList(playerId),
    }, requestId));
    this.broadcastPresence({ type: "presence.joined", player: this.toPresence(player, "connected") });
    console.info("multiplayer player connected", playerId);
    await this.flushDirty();
  }

  /**
   * Logout (D-06 groundwork). Revokes the caller's session token and detaches the socket. The revocation is saved
   * before the player is told, and it is undone if the save fails, so a rejected logout changes nothing. The identity,
   * its character, and its world records are not changed. A revoked identity cannot resume until a verified
   * re-authentication path exists; that path is not implemented (D-05), so logout is not yet offered by the client.
   */
  private async logout(context: ConnectionContext, requestId?: string): Promise<void> {
    const playerId = context.playerId;
    const player = playerId === null ? undefined : this.store.state.players[playerId];
    if (playerId === null || !player) {
      this.sendError(context, "not_authenticated", "Connect with a valid identity first.", requestId);
      return;
    }
    const timestamp = new Date(this.now()).toISOString();
    const previousSession = player.session === undefined ? undefined : structuredClone(player.session);
    player.session = { ...(player.session ?? {}), lastActivityAt: timestamp, revokedAt: timestamp };
    const tokenHash = player.tokenHash;
    const wasIndexed = this.playerByTokenHash.get(tokenHash) === playerId;
    if (wasIndexed) this.playerByTokenHash.delete(tokenHash);
    const failure = await this.saveSessionChange();
    if (failure !== null) {
      // The revocation is not durable, so the session stays valid. Undo the in-memory change.
      if (previousSession === undefined) delete player.session;
      else player.session = previousSession;
      if (wasIndexed) this.playerByTokenHash.set(tokenHash, playerId);
      this.sendError(context, failure.code, failure.message, requestId);
      return;
    }
    if (this.online.get(playerId) === context) this.online.delete(playerId);
    this.pendingQuizzes.delete(playerId);
    context.playerId = null;
    this.broadcastPresence({ type: "presence.left", player: this.toPresence(player, "disconnected") });
    console.info("multiplayer session revoked by logout", playerId);
    this.send(context, appendOptionalRequestId({ type: "session.logged_out" }, requestId));
  }

  /** Saves the live world and reports the outcome, so the caller can undo an in-memory change when the save fails. */
  private async saveSessionChange(): Promise<{ code: string; message: string } | null> {
    try {
      await this.serialize(() => this.store.flush());
      this.lastPersistAt = this.now();
      this.noteSaveSucceeded();
      return null;
    } catch (error) {
      this.failedSaveAttemptsSinceSuccess += 1;
      if (error instanceof WorldStateCapacityError) {
        if (this.enterCapacityEpisode()) {
          this.openFailureNotice();
          console.error("multiplayer world state is over its size limit; saves are refused and the previous file is kept");
        }
        return { code: "world_capacity_reached", message: "The world data limit has been reached. The logout was not saved, so the session is still active." };
      }
      console.error("multiplayer logout could not be saved");
      return { code: "persistence_failed", message: "The logout could not be saved, so the session is still active. Try again." };
    }
  }

  private handleMovement(context: ConnectionContext, message: Record<string, unknown>, requestId?: string): void {
    const now = this.now();
    if (now - context.lastInputAt < MOVEMENT_MIN_INTERVAL_MS) {
      this.sendError(context, "rate_limited", "Movement input is arriving too quickly.", requestId);
      return;
    }
    if (!Number.isSafeInteger(message.sequence) || typeof message.sequence !== "number" ||
      message.sequence < 0 || message.sequence <= context.lastInputSequence) {
      this.sendError(context, "invalid_sequence", "Movement sequence must increase.", requestId);
      return;
    }
    const direction = pointFrom(message.direction);
    if (direction === null || Math.abs(direction.x) > 1 || Math.abs(direction.y) > 1 ||
      Math.hypot(direction.x, direction.y) > 1.05 || typeof message.running !== "boolean") {
      this.sendError(context, "invalid_movement", "Movement input is outside the allowed range.", requestId);
      return;
    }
    context.lastInputAt = now;
    context.lastInputSequence = message.sequence;
    context.inputDirection = normalizeDirection(direction);
    context.running = message.running;
    const player = this.playerFor(context);
    if (player) player.lastSeen = new Date(now).toISOString();
  }

  private async travel(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): Promise<void> {
    const exitId = message.exitId;
    if (typeof exitId !== "string" || exitId.length > 48) {
      this.sendError(context, "invalid_command", "The travel target is invalid.", requestId);
      return;
    }
    if (!LOCATIONS.has(player.character.current_location)) {
      this.sendError(context, "invalid_location", "The saved character location is invalid.", requestId);
      return;
    }
    const target = TRAVEL_TARGETS[player.character.current_location]?.[exitId];
    if (!target || distance(player.character.position, target.position) > ENTITY_INTERACTION_RADIUS) {
      this.sendError(context, "interaction_out_of_range", "Move closer to that entrance first.", requestId);
      return;
    }
    if (target.destination === "campus" &&
      (!player.character.education_record.tertiary_enrollment ||
        player.character.education_record.tertiary_enrollment.status === "completed")) {
      this.sendError(context, "education_not_enrolled", "Accept a tertiary offer before entering the campus.", requestId);
      return;
    }
    if (target.destination === "training_center" &&
      !player.character.education_record.vocational_enrollments.some((entry) => entry.status === "active") &&
      !player.character.education_record.apprenticeships.some((entry) => entry.status === "active")) {
      this.sendError(context, "education_training_not_enrolled", "Enroll in a vocational course or apprenticeship before entering the skills centre.", requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    player.character.current_location = target.destination;
    player.character.position = { ...target.spawn };
    if (target.destination !== "town") player.character.geographic_location = null;
    context.inputDirection = vectorZero();
    context.running = false;
    this.touchPlayer(player);
    this.sendCharacterSnapshot(context, requestId);
    this.broadcastPresence({ type: "presence.moved", player: this.toPresence(player, "connected") });
    await this.flushDirty();
  }

  private async takeBus(context: ConnectionContext, player: PersistentPlayer, requestId?: string): Promise<void> {
    if (player.character.current_location !== "town" ||
      distance(player.character.position, { x: 625, y: 495 }) > 82) {
      this.sendError(context, "interaction_out_of_range", "Move to the bus stop first.", requestId);
      return;
    }
    const fare = this.fixedCharge(BUS_FARE_CHARGE_ID);
    if ((cashBalanceForCharacter(this.store.state, player.character.character_id) ?? 0) < fare.amount_ngn) {
      this.sendError(context, "insufficient_funds", `The bus fare is ₦${fare.amount_ngn}.`, requestId);
      return;
    }
    if (requestId === undefined) {
      // Unreachable through dispatch (world.bus is in IDEMPOTENT_COMMANDS). Kept to narrow the type, with the right code.
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    if (!this.financialWritesOpen()) {
      // Stage 34: nothing is changed while saving is failing or this writer is fenced.
      this.sendError(context, "bus_persistence_unavailable", moneyPausedMessage("bus"), requestId);
      return;
    }
    // Stage 47: the fare is posted to the cash ledger before the request is recorded. A refused charge changes nothing.
    const chargeError = this.postFixedCharge(fare, player);
    if (chargeError !== undefined) {
      this.sendError(context, chargeError, economyErrorMessage(chargeError), requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    player.character.current_location = "schoolyard";
    player.character.position = { x: 240, y: 650 };
    player.character.geographic_location = null;
    context.inputDirection = vectorZero();
    context.running = false;
    this.touchPlayer(player);
    this.broadcastPresence({ type: "presence.moved", player: this.toPresence(player, "connected") });
    // Stage 34: the fare is confirmed (by the character snapshot carrying the request ID) only once it is saved.
    await this.chargeAndConfirm(context, requestId, "bus", player);
  }

  private async enterGeographicRegion(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (message.regionId !== this.geographyRegion.id) {
      this.sendError(context, "geography_region_unavailable", "That geographic sample is not available.", requestId);
      return;
    }
    if (player.character.current_location !== "town") {
      this.sendError(context, "geography_requires_town", "Enter the outdoor neighbourhood before opening geographic data.", requestId);
      return;
    }
    player.character.geographic_location = geographicLocationForMapPosition(
      player.character.position,
      this.geographyRegion,
    );
    this.touchPlayer(player);
    this.sendCharacterSnapshot(context, requestId);
    this.broadcastPresence({ type: "presence.moved", player: this.toPresence(player, "connected") });
    await this.flushDirty();
  }

  private async leaveGeographicRegion(
    context: ConnectionContext,
    player: PersistentPlayer,
    requestId?: string,
  ): Promise<void> {
    if (player.character.geographic_location === null) {
      this.sendCharacterSnapshot(context, requestId);
      return;
    }
    player.character.geographic_location = null;
    this.touchPlayer(player);
    this.sendCharacterSnapshot(context, requestId);
    this.broadcastPresence({ type: "presence.moved", player: this.toPresence(player, "connected") });
    await this.flushDirty();
  }

  /** Stage 47: a fixed fee from the economy catalogue. The catalogue is validated at load, so a missing charge is a defect. */
  private fixedCharge(id: string): EconomyFixedCharge {
    const charge = this.economyCatalog.fixed_charges.find((entry) => entry.id === id);
    if (!charge) throw new Error(`Economy fixed charge ${id} is missing.`);
    return charge;
  }

  /** Stage 47: posts a fixed fee to the cash ledger. Returns the refusal code, or undefined when the fee was posted. */
  private postFixedCharge(charge: EconomyFixedCharge, player: PersistentPlayer): string | undefined {
    try {
      chargeFixedFee(this.store.state, player.character.character_id, charge,
        this.store.state.worldClock.world_date, this.store.state.worldClock.minute_of_day, this.now(), this.economyCatalog);
      return undefined;
    } catch (error) {
      return this.errorCode(error);
    }
  }

  private async purchaseItem(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): Promise<void> {
    if (player.character.current_location !== "market" ||
      distance(player.character.position, { x: 1190, y: 440 }) > ENTITY_INTERACTION_RADIUS) {
      this.sendError(context, "interaction_out_of_range", "Visit the market shelf before buying.", requestId);
      return;
    }
    // Stage 47: the shelf's items and prices come from the economy catalogue (values unchanged).
    const itemId = message.itemId;
    const shelfItem = typeof itemId === "string" ? this.economyCatalog.shelf_items.find((entry) => entry.id === itemId) : undefined;
    if (!shelfItem) {
      this.sendError(context, "item_unavailable", "That item is not available.", requestId);
      return;
    }
    const definition: InventoryItem = {
      id: shelfItem.id, name: shelfItem.label, quantity: 1, category: shelfItem.category, hunger_restore: shelfItem.hunger_restore,
    };
    const price = shelfItem.price_ngn;
    // Stage 46: the cash account is the balance that is checked and debited (character.money follows it).
    if ((cashBalanceForCharacter(this.store.state, player.character.character_id) ?? 0) < price) {
      this.sendError(context, "insufficient_funds", `You need ₦${price}.`, requestId);
      return;
    }
    if (requestId === undefined) {
      // Unreachable through dispatch (shop.purchase is in IDEMPOTENT_COMMANDS). Kept to narrow the type, with the right code.
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    if (!this.financialWritesOpen()) {
      // Stage 34: nothing is changed while saving is failing or this writer is fenced.
      this.sendError(context, "shop_persistence_unavailable", moneyPausedMessage("shop"), requestId);
      return;
    }
    try {
      purchaseShopItem(this.store.state, player.character.character_id, shelfItem.id, price,
        this.store.state.worldClock.world_date, this.store.state.worldClock.minute_of_day, this.now(), this.economyCatalog);
    } catch (error) {
      const code = this.errorCode(error);
      this.sendError(context, code, economyErrorMessage(code), requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    this.addInventoryItem(player.character.inventory, definition);
    this.touchPlayer(player);
    if (requestId === undefined) {
      // Unreachable through dispatch (shop.purchase is in IDEMPOTENT_COMMANDS). Kept to narrow the type, with the right code.
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    await this.chargeAndConfirm(context, requestId, "shop", player);
  }

  private async consumeItem(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): Promise<void> {
    const itemId = message.itemId;
    if (typeof itemId !== "string" || itemId.length > 48) {
      this.sendError(context, "invalid_command", "The item identifier is invalid.", requestId);
      return;
    }
    const index = player.character.inventory.findIndex((item) => item.id === itemId);
    const item = player.character.inventory[index];
    if (!item || item.quantity < 1 || !item.hunger_restore || item.hunger_restore <= 0) {
      this.sendError(context, "item_not_usable", "That item cannot be consumed.", requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    item.quantity -= 1;
    if (item.quantity <= 0) player.character.inventory.splice(index, 1);
    player.character.hunger = clamp(player.character.hunger + item.hunger_restore, 0, 100);
    this.touchPlayer(player);
    this.sendCharacterSnapshot(context, requestId);
    await this.flushDirty();
  }

  private async visitClinic(context: ConnectionContext, player: PersistentPlayer, requestId?: string): Promise<void> {
    if (player.character.current_location !== "clinic" ||
      distance(player.character.position, { x: 1080, y: 470 }) > ENTITY_INTERACTION_RADIUS) {
      this.sendError(context, "interaction_out_of_range", "Visit the clinic reception desk first.", requestId);
      return;
    }
    if (player.character.health >= 99) {
      this.sendError(context, "care_not_needed", "You are already feeling well.", requestId);
      return;
    }
    const fee = this.fixedCharge(CLINIC_CARE_CHARGE_ID);
    if ((cashBalanceForCharacter(this.store.state, player.character.character_id) ?? 0) < fee.amount_ngn) {
      this.sendError(context, "insufficient_funds", `Basic care costs ₦${fee.amount_ngn}.`, requestId);
      return;
    }
    if (requestId === undefined) {
      // Unreachable through dispatch (clinic.care is in IDEMPOTENT_COMMANDS). Kept to narrow the type, with the right code.
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    if (!this.financialWritesOpen()) {
      // Stage 34: nothing is changed while saving is failing or this writer is fenced.
      this.sendError(context, "clinic_persistence_unavailable", moneyPausedMessage("clinic"), requestId);
      return;
    }
    // Stage 47: the fee is posted to the cash ledger before the request is recorded. A refused charge changes nothing.
    const chargeError = this.postFixedCharge(fee, player);
    if (chargeError !== undefined) {
      this.sendError(context, chargeError, economyErrorMessage(chargeError), requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    player.character.health = clamp(player.character.health + 35, 0, 100);
    this.touchPlayer(player);
    // Stage 34: the charge is confirmed (by the character snapshot carrying the request ID) only once it is saved.
    await this.chargeAndConfirm(context, requestId, "clinic", player);
  }

  private async rest(context: ConnectionContext, player: PersistentPlayer, requestId?: string): Promise<void> {
    if (requestId === undefined) {
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    if (player.character.current_location !== "home" ||
      distance(player.character.position, { x: 440, y: 350 }) > ENTITY_INTERACTION_RADIUS) {
      this.sendError(context, "interaction_out_of_range", "Rest at your bed at home.", requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    player.character.energy = 100;
    player.character.hunger = clamp(player.character.hunger - 18, 0, 100);
    player.character.health = clamp(player.character.health + 5, 0, 100);
    this.touchPlayer(player);
    // Stage 37: the rest is confirmed only once its save succeeds (it was replied before the save).
    await this.chargeAndConfirm(context, requestId, "rest", player);
  }

  private beginLesson(context: ConnectionContext, player: PersistentPlayer, requestId?: string, preferFinalExam = false): void {
    const character = player.character;
    if (this.pendingQuizzes.has(player.playerId)) {
      this.sendError(context, "quiz_in_progress", "Finish the current class activity first.", requestId);
      return;
    }
    const day = this.store.state.worldClock.day;
    const minuteOfDay = this.store.state.worldClock.minute_of_day;
    if (character.current_location === "classroom") {
      if (distance(character.position, { x: 820, y: 560 }) > ENTITY_INTERACTION_RADIUS) {
        this.sendError(context, "interaction_out_of_range", "Move to your desk to begin class or your registered examination.", requestId);
        return;
      }
      const lesson = preferFinalExam ? null : nextSchoolLesson(character.education_record, day, minuteOfDay, this.educationCatalog);
      if (lesson?.subject_id) {
        const question = findQuestionForSubject(lesson.subject_id, character.education_record.current_class_id, this.educationCatalog);
        if (!question) {
          this.sendError(context, "lesson_unavailable", "That lesson has no original game question configured.", requestId);
          return;
        }
        const quizId = randomUUID();
        const subject = this.educationCatalog.subjects.find((entry) => entry.id === lesson.subject_id)?.name ?? lesson.subject_id;
        recordSchoolAttendance(character.education_record, lesson, day, minuteOfDay, undefined, this.educationCatalog);
        this.pendingQuizzes.set(player.playerId, {
          quizId,
          mode: "school",
          subjectId: lesson.subject_id,
          subject,
          correctIndex: question.correct_choice_index,
          day,
          questionId: question.id,
          assessmentType: lesson.assessment_type ?? "continuous_assessment",
          scheduleId: lesson.id,
        });
        this.touchPlayer(player);
        this.send(context, appendOptionalRequestId({
          type: "school.quiz",
          quizId,
          mode: "school",
          ...publicSchoolQuiz(lesson, question, this.educationCatalog),
        }, requestId));
        void this.flushDirty();
        return;
      }
      const finalQuestion = nextFinalExamQuestion(character.education_record, day, this.educationCatalog);
      if (finalQuestion) {
        recordSchoolAttendance(character.education_record, {
          id: `final-${finalQuestion.registration.registration_id}-${finalQuestion.subject_id}`,
          start_minute: minuteOfDay,
          class_id: "SS3",
          subject_id: finalQuestion.subject_id,
        }, day, minuteOfDay, undefined, this.educationCatalog);
        const quizId = randomUUID();
        const subject = this.educationCatalog.subjects.find((entry) => entry.id === finalQuestion.subject_id)?.name ?? finalQuestion.subject_id;
        this.pendingQuizzes.set(player.playerId, {
          quizId,
          mode: "final_exam",
          subjectId: finalQuestion.subject_id,
          subject,
          correctIndex: finalQuestion.question.correct_choice_index,
          day,
          questionId: finalQuestion.question.id,
          assessmentType: "examination",
          registrationId: finalQuestion.registration.registration_id,
        });
        this.send(context, appendOptionalRequestId({
          type: "school.quiz",
          quizId,
          mode: "final_exam",
          subject,
          question: finalQuestion.question.prompt,
          options: [...finalQuestion.question.choices],
          question_id: finalQuestion.question.id,
          exam_name: this.educationCatalog.final_examination.name,
        }, requestId));
        return;
      }
      this.send(context, appendOptionalRequestId({ type: "school.complete" }, requestId));
      return;
    }
    if (character.current_location === "campus") {
      const course = beginTertiaryCoursePayload(character.education_record, this.educationCatalog);
      if (!course || typeof course.question_id !== "string") {
        this.sendError(context, "education_not_enrolled", "There is no available tertiary course assessment.", requestId);
        return;
      }
      const question = this.educationCatalog.questions.find((entry) => entry.id === course.question_id);
      if (!question || typeof course.subject_id !== "string" || typeof course.course_id !== "string") {
        this.sendError(context, "lesson_unavailable", "That course has no valid question in the education catalog.", requestId);
        return;
      }
      const enrollment = character.education_record.tertiary_enrollment;
      recordSchoolAttendance(character.education_record, {
        id: `tertiary-${enrollment?.program_id ?? "program"}-${enrollment?.semester ?? 1}-${course.course_id}`,
        start_minute: minuteOfDay,
        class_id: "TERTIARY",
        subject_id: course.subject_id,
      }, day, minuteOfDay, undefined, this.educationCatalog);
      const quizId = randomUUID();
      const subject = typeof course.course_name === "string" ? course.course_name : course.subject_id;
      const assessmentType = typeof course.assessment_type === "string" ? course.assessment_type : "assignment";
      this.pendingQuizzes.set(player.playerId, {
        quizId,
        mode: "tertiary",
        subjectId: course.subject_id,
        subject,
        correctIndex: question.correct_choice_index,
        day,
        questionId: question.id,
        assessmentType,
        courseId: course.course_id,
      });
      this.send(context, appendOptionalRequestId({
        type: "school.quiz",
        quizId,
        mode: "tertiary",
        subject,
        question: question.prompt,
        options: [...question.choices],
        question_id: question.id,
        course_id: course.course_id,
        assessment_type: assessmentType,
      }, requestId));
      return;
    }
    this.sendError(context, "invalid_location", "Go to your classroom or enrolled campus before beginning an education activity.", requestId);
  }

  private async answerLesson(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const pending = this.pendingQuizzes.get(player.playerId);
    const answerIndex = message.answerIndex;
    if (!pending || message.quizId !== pending.quizId || typeof answerIndex !== "number" ||
      !Number.isSafeInteger(answerIndex) || answerIndex < 0 || answerIndex > 20) {
      this.sendError(context, "quiz_invalid", "The education activity response is invalid.", requestId);
      return;
    }
    const expectedLocation = pending.mode === "tertiary" ? "campus" : "classroom";
    if (player.character.current_location !== expectedLocation) {
      this.pendingQuizzes.delete(player.playerId);
      this.sendError(context, "quiz_invalid", "Return to the correct learning location before answering.", requestId);
      return;
    }
    const question = this.educationCatalog.questions.find((entry) => entry.id === pending.questionId);
    if (!question || answerIndex >= question.choices.length) {
      this.pendingQuizzes.delete(player.playerId);
      this.sendError(context, "quiz_invalid", "The education question is no longer available.", requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    const correct = answerIndex === pending.correctIndex;
    let score: number;
    let certificateEligible: boolean | null = null;
    if (pending.mode === "school") {
      const result = recordSchoolQuizAnswer(player.character, {
        schedule_id: pending.scheduleId ?? "",
        subject_id: pending.subjectId,
        assessment_type: pending.assessmentType,
        question_id: pending.questionId,
        day: pending.day,
        question_correct_choice_index: pending.correctIndex,
      }, answerIndex, this.store.state.worldClock.minute_of_day, this.educationCatalog);
      score = result.score;
    } else if (pending.mode === "tertiary") {
      score = recordTertiaryCourseAnswer(player.character, {
        course_id: pending.courseId ?? "",
        subject_id: pending.subjectId,
        assessment_type: pending.assessmentType,
        question_id: pending.questionId,
      }, answerIndex, this.store.state.worldClock.day, this.educationCatalog);
    } else {
      const result = recordFinalExamAnswer(
        player.character.education_record,
        pending.registrationId ?? "",
        pending.subjectId,
        pending.questionId,
        answerIndex,
        this.store.state.worldClock.day,
        this.educationCatalog,
      );
      score = result.attempt.score;
      certificateEligible = result.certificate_eligible;
    }
    this.pendingQuizzes.delete(player.playerId);
    syncLegacyEducation(player.character, this.educationCatalog);
    this.touchPlayer(player);
    this.send(context, appendOptionalRequestId({
      type: "school.result",
      mode: pending.mode,
      subject: pending.subject,
      correct,
      score,
      ...(certificateEligible === null ? {} : { certificate_eligible: certificateEligible }),
    }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  private async educationAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (typeof message.action !== "string" || message.action.length > 48) {
      this.sendError(context, "education_action_invalid", "Select a valid education action.", requestId);
      return;
    }
    if (message.action === "begin_final_exam") {
      this.markRequestProcessed(player, requestId);
      this.beginLesson(context, player, requestId, true);
      void this.flushDirty();
      return;
    }
    // Stage 34: every education action other than begin_final_exam (above) can change the record or money, so a changing
    // action needs a request ID, and nothing is changed while saving is failing or this writer is fenced.
    if (requestId === undefined) {
      this.send(context, { type: "education.error", action: message.action, code: "request_id_required", message: "This action requires a unique request ID." });
      return;
    }
    if (!this.financialWritesOpen()) {
      this.send(context, appendOptionalRequestId({
        type: "education.error", action: message.action, code: "education_persistence_unavailable",
        message: SAVE_OUTCOME_MESSAGES.education_persistence_unavailable,
      }, requestId));
      return;
    }
    const payload = isRecord(message.payload) ? message.payload : {};
    const options: EducationActionOptions = {
      programSeatsUsed: this.programSeatCount(typeof payload.program_id === "string" ? payload.program_id : ""),
      scholarshipAwardsUsed: this.scholarshipAwardCounts(),
    };
    const result = applyEducationAction(player.character, message.action, payload, {
      day: this.store.state.worldClock.day,
      minuteOfDay: this.store.state.worldClock.minute_of_day,
      age: player.character.age,
      money: player.character.money,
      household: player.character.household,
      currentLocation: player.character.current_location,
    }, options, this.educationCatalog);
    if (result.ok && result.changed) {
      this.markRequestProcessed(player, requestId);
      syncLegacyEducation(player.character, this.educationCatalog);
      this.touchPlayer(player);
      // Stage 34: the change is in memory now. Its reply waits until a save has covered it.
      this.changeGeneration += 1;
      const key = moneyReplyKey(player, requestId);
      const pending: PendingMoneyReply = {
        kind: "education", generation: this.changeGeneration, reply: { type: "education.result", ...result }, delivered: false,
      };
      this.pendingMoneyReplies.set(key, pending);
      await this.confirmMoneyReply(context, key, requestId, pending, false);
      return;
    }
    this.send(context, appendOptionalRequestId({
      type: result.ok ? "education.result" : "education.error",
      ...result,
    }, requestId));
  }

  private async careerAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (typeof message.action !== "string" || message.action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "career.error", action: "", code: "career_action_invalid",
        message: "Choose a supported career action.",
      }, requestId));
      return;
    }
    const action = message.action;
    if (!CAREER_READ_ONLY_ACTIONS.has(action)) {
      // Stage 34: a changing career action needs a request ID, and nothing is changed while saving is failing or this writer is fenced.
      if (requestId === undefined) {
        this.send(context, { type: "career.error", action, code: "request_id_required", message: "This action requires a unique request ID." });
        return;
      }
      if (!this.financialWritesOpen()) {
        this.send(context, appendOptionalRequestId({
          type: "career.error", action, code: "career_persistence_unavailable",
          message: SAVE_OUTCOME_MESSAGES.career_persistence_unavailable,
        }, requestId));
        return;
      }
    }
    const payload = isRecord(message.payload) ? message.payload : {};
    const state = this.store.state;
    const characterId = player.character.character_id;
    const date = { ...state.worldClock.world_date };
    const minuteOfDay = state.worldClock.minute_of_day;
    const now = this.now();
    const data: Record<string, unknown> = {};
    let messageText = "Career records were refreshed from the shared server.";
    const requiredString = (key: string, maximumLength = 120): string => {
      const value = payload[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
        throw new Error("career_action_invalid");
      }
      return value.trim();
    };

    try {
      switch (action) {
        case "search_jobs": {
          const query: { text?: string; industry_id?: string; location_id?: string } = {};
          for (const key of ["text", "industry_id", "location_id"] as const) {
            const value = payload[key];
            if (value === undefined || value === "") continue;
            if (typeof value !== "string" || value.length > (key === "text" ? 80 : 120)) {
              throw new Error("career_query_invalid");
            }
            query[key] = value;
          }
          data.jobs = searchCareerJobsForCharacter(state, characterId, query, this.careerCatalog);
          messageText = `${(data.jobs as unknown[]).length} open prototype vacancy records matched this search.`;
          break;
        }
        case "apply": {
          const application = submitCareerApplication(state, characterId, requiredString("vacancy_id"), date, now, this.careerCatalog);
          data.application = application;
          messageText = `Application submitted for server review on ${application.review_due_date.year}-${String(application.review_due_date.month).padStart(2, "0")}-${String(application.review_due_date.day).padStart(2, "0")}.`;
          break;
        }
        case "withdraw_application": {
          const application = withdrawCareerApplication(state, characterId, requiredString("application_id"), date, now);
          data.application = application;
          messageText = "The application was withdrawn before the server decision.";
          break;
        }
        case "start_shift": {
          const session = startCareerWorkSession(state, characterId, date, minuteOfDay,
            player.character.current_location, now, this.careerCatalog);
          data.work_session = session;
          messageText = `Clocked in for ${this.careerCatalog.jobs.find((job) => job.id === session.job_id)?.title ?? session.job_id}.`;
          break;
        }
        case "complete_shift": {
          const session = completeCareerWorkSession(state, characterId, date, minuteOfDay,
            player.character.current_location, now, this.careerCatalog);
          data.work_session = session;
          messageText = `Session recorded: ₦${session.gross_earned_ngn.toLocaleString("en-NG")} gross earned; payment is scheduled through the existing character balance adapter.`;
          break;
        }
        case "request_leave": {
          const startDateValue = payload.start_date;
          let startDate = date;
          if (startDateValue !== undefined) {
            if (!isRecord(startDateValue) || !Number.isSafeInteger(startDateValue.year) ||
              !Number.isSafeInteger(startDateValue.month) || !Number.isSafeInteger(startDateValue.day)) {
              throw new Error("career_leave_request_invalid");
            }
            startDate = {
              year: startDateValue.year as number,
              month: startDateValue.month as number,
              day: startDateValue.day as number,
            };
            if (!isValidDate(startDate)) throw new Error("career_leave_request_invalid");
          }
          const days = payload.days === undefined ? 1 : payload.days;
          if (!Number.isSafeInteger(days)) throw new Error("career_leave_request_invalid");
          const leave = requestCareerLeave(state, characterId, requiredString("employment_id"),
            payload.leave_type, startDate, days as number, date, now, this.careerCatalog);
          data.leave_request = leave;
          messageText = `${leave.leave_type === "vacation" ? "Vacation" : "Personal"} leave is recorded as approved and unpaid in this prototype.`;
          break;
        }
        case "request_promotion": {
          const employment = requestCareerPromotion(state, characterId, requiredString("employment_id"),
            date, now, this.careerCatalog);
          data.employment = employment;
          messageText = `Promotion recorded: ${this.careerCatalog.jobs.find((job) => job.id === employment.job_id)?.title ?? employment.job_id}.`;
          break;
        }
        case "resign": {
          const employment = resignCareerEmployment(state, characterId, requiredString("employment_id"),
            date, minuteOfDay, now, economyAccountPort(state, this.economyCatalog));
          data.employment = employment;
          messageText = "Resignation recorded. Completed eligible work sessions were reconciled through payroll.";
          break;
        }
        case "retire": {
          const lifeEvent = recordRetirement(state, characterId);
          const employmentsEnded = requestCareerRetirement(state, characterId, date, minuteOfDay, now,
            economyAccountPort(state, this.economyCatalog));
          data.life_event = lifeEvent;
          data.employments_ended = employmentsEnded;
          messageText = `Retirement recorded at the Stage 5 age threshold; ${employmentsEnded} employment record(s) closed.`;
          break;
        }
        default:
          throw new Error("career_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "career.error",
        action,
        code,
        message: careerErrorMessage(code),
        career_profile: buildCareerProfile(state, player.character, this.careerCatalog),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (action !== "search_jobs") this.touchPlayer(player);
    data.career_profile = buildCareerProfile(state, player.character, this.careerCatalog);
    const reply: Record<string, unknown> = { type: "career.result", action, ok: true, message: messageText, data };
    if (!CAREER_READ_ONLY_ACTIONS.has(action) && requestId !== undefined) {
      // Stage 34: the change is in memory now. Its reply waits until a save has covered it.
      this.changeGeneration += 1;
      const key = moneyReplyKey(player, requestId);
      const pending: PendingMoneyReply = { kind: "career", generation: this.changeGeneration, reply, delivered: false };
      this.pendingMoneyReplies.set(key, pending);
      await this.confirmMoneyReply(context, key, requestId, pending, false);
      return;
    }
    this.send(context, appendOptionalRequestId(reply, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  private async economyAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (typeof message.action !== "string" || message.action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "economy.error", action: "", code: "economy_action_invalid",
        message: "Choose a supported economy action.",
      }, requestId));
      return;
    }
    const action = message.action;
    if (ECONOMY_MONEY_ACTIONS.has(action) && !this.financialWritesOpen()) {
      // Stage 34: nothing is changed while saving is failing or this writer is fenced. A retry is still answered.
      this.send(context, appendOptionalRequestId({
        type: "economy.error", action, code: "economy_persistence_unavailable",
        message: economyErrorMessage("economy_persistence_unavailable"),
      }, requestId));
      return;
    }
    const payload = isRecord(message.payload) ? message.payload : {};
    const state = this.store.state;
    const characterId = player.character.character_id;
    const date = { ...state.worldClock.world_date };
    const minuteOfDay = state.worldClock.minute_of_day;
    const now = this.now();
    const data: Record<string, unknown> = {};
    let messageText = "Economy records were refreshed from the shared server.";
    const requiredString = (key: string, maximumLength = 120): string => {
      const value = payload[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
        throw new Error("economy_action_invalid");
      }
      return value.trim();
    };
    const requiredInteger = (key: string, minimum = 0, maximum = 10_000_000_000): number => {
      const value = payload[key];
      if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error("economy_action_invalid");
      }
      return value as number;
    };

    try {
      switch (action) {
        case "profile": {
          data.economy_profile = buildEconomyProfile(state, characterId, this.economyCatalog);
          messageText = "Economy profile loaded from the shared server.";
          break;
        }
        case "list_goods": {
          const locationId = typeof payload.location_id === "string" ? payload.location_id : player.character.current_location;
          data.goods = listMarketGoodsForLocation(this.economyCatalog, locationId);
          data.location_id = locationId;
          messageText = `${(data.goods as unknown[]).length} market goods listed for ${locationId}.`;
          break;
        }
        case "open_account": {
          const account = openEconomyAccount(state, characterId, requiredString("bank_product_id"),
            requiredInteger("initial_deposit_ngn", 0, this.economyCatalog.rules.maximum_transaction_amount_ngn),
            date, minuteOfDay, now, this.economyCatalog);
          data.account = account;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Opened a ${this.economyCatalog.bank_products.find((product) => product.id === account.bank_product_id)?.label ?? account.bank_product_id ?? "account"}.`;
          break;
        }
        case "deposit": {
          const tx = depositToAccount(state, characterId, requiredString("account_id"),
            requiredInteger("amount_ngn", this.economyCatalog.rules.minimum_transaction_amount_ngn, this.economyCatalog.rules.maximum_transaction_amount_ngn),
            date, minuteOfDay, now, this.economyCatalog);
          data.transaction = tx;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Deposited ₦${tx.amount_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "withdraw": {
          const tx = withdrawFromAccount(state, characterId, requiredString("account_id"),
            requiredInteger("amount_ngn", this.economyCatalog.rules.minimum_transaction_amount_ngn, this.economyCatalog.rules.maximum_transaction_amount_ngn),
            date, minuteOfDay, now, this.economyCatalog);
          data.transaction = tx;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Withdrew ₦${tx.amount_ngn.toLocaleString("en-NG")} to cash.`;
          break;
        }
        case "transfer": {
          const tx = transferBetweenAccounts(state, characterId,
            requiredString("from_account_id"), requiredString("to_account_id"),
            requiredInteger("amount_ngn", this.economyCatalog.rules.minimum_transaction_amount_ngn, this.economyCatalog.rules.maximum_transfer_amount_ngn),
            date, minuteOfDay, now, this.economyCatalog);
          data.transaction = tx;
          messageText = `Transferred ₦${tx.amount_ngn.toLocaleString("en-NG")} between accounts.`;
          break;
        }
        case "purchase": {
          const goodId = requiredString("good_id");
          const quantity = requiredInteger("quantity", 1, 100);
          const locationId = typeof payload.location_id === "string" ? payload.location_id : player.character.current_location;
          // Stage 47: the buyer must be standing at the market they buy from (the shelf route checks the same).
          if (locationId !== player.character.current_location) throw new Error("economy_buyer_not_at_location");
          const result = purchaseMarketGood(state, characterId, goodId, quantity, locationId, date, minuteOfDay, now, this.economyCatalog);
          data.transaction = result.transaction;
          data.good = result.good;
          data.total_cost_ngn = result.total_cost_ngn;
          data.seller = result.seller;
          // Stage 47: market goods are eaten on purchase (there is no carried stock), so every unit bought is eaten.
          if (result.good.hunger_restore > 0) {
            player.character.hunger = Math.min(100, player.character.hunger + result.good.hunger_restore * quantity);
          }
          messageText = `Purchased ${quantity} × ${result.good.label} for ₦${result.total_cost_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "request_loan": {
          const loan = requestLoan(state, characterId, requiredString("loan_product_id"),
            requiredInteger("amount_ngn", this.economyCatalog.rules.minimum_transaction_amount_ngn, this.economyCatalog.rules.maximum_loan_amount_ngn),
            requiredInteger("term_months", 1, 360),
            date, minuteOfDay, now, this.economyCatalog);
          data.loan = loan;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Approved ${this.economyCatalog.loan_products.find((product) => product.id === loan.loan_product_id)?.label ?? loan.loan_product_id} of ₦${loan.principal_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "repay_loan": {
          const tx = repayLoan(state, characterId, requiredString("loan_id"),
            requiredInteger("amount_ngn", this.economyCatalog.rules.minimum_transaction_amount_ngn, this.economyCatalog.rules.maximum_transaction_amount_ngn),
            date, minuteOfDay, now, this.economyCatalog);
          data.transaction = tx;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Repaid ₦${tx.amount_ngn.toLocaleString("en-NG")} towards loan.`;
          break;
        }
        case "estimate_tax": {
          const monthlyIncome = requiredInteger("monthly_income_ngn", 0, this.economyCatalog.rules.maximum_account_balance_ngn);
          const { estimateIncomeTax } = await import("../economy/service.js");
          data.monthly_income_ngn = monthlyIncome;
          data.estimated_tax_ngn = estimateIncomeTax(monthlyIncome, this.economyCatalog);
          messageText = `Estimated monthly PAYE: ₦${(data.estimated_tax_ngn as number).toLocaleString("en-NG")}.`;
          break;
        }
        default:
          throw new Error("economy_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "economy.error",
        action,
        code,
        message: economyErrorMessage(code),
        economy_profile: buildEconomyProfile(state, characterId, this.economyCatalog),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (action !== "profile" && action !== "list_goods" && action !== "estimate_tax") this.touchPlayer(player);
    if (action === "profile") data.economy_profile = buildEconomyProfile(state, characterId, this.economyCatalog);
    const reply: Record<string, unknown> = { type: "economy.result", action, ok: true, message: messageText, data };
    if (!ECONOMY_MONEY_ACTIONS.has(action) || requestId === undefined) {
      this.send(context, appendOptionalRequestId(reply, requestId));
      this.sendCharacterSnapshot(context);
      await this.flushDirty();
      return;
    }
    // Stage 34: the money change is in memory now. Its reply waits until a save has covered it.
    this.changeGeneration += 1;
    const key = moneyReplyKey(player, requestId);
    const pending: PendingMoneyReply = { kind: "economy", generation: this.changeGeneration, reply, delivered: false };
    this.pendingMoneyReplies.set(key, pending);
    await this.confirmMoneyReply(context, key, requestId, pending, false);
  }

  private async businessAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (typeof message.action !== "string" || message.action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "business.error", action: "", code: "business_action_invalid",
        message: "Choose a supported business action.",
      }, requestId));
      return;
    }
    const action = message.action;
    if (!BUSINESS_READ_ONLY_ACTIONS.has(action)) {
      // Stage 34: a changing action needs a request ID, and nothing is changed while saving is failing or this writer is fenced.
      if (requestId === undefined) {
        this.send(context, { type: "business.error", action, code: "request_id_required", message: "This action requires a unique request ID." });
        return;
      }
      if (!this.financialWritesOpen()) {
        this.send(context, appendOptionalRequestId({
          type: "business.error", action, code: "business_persistence_unavailable",
          message: businessErrorMessage("business_persistence_unavailable"),
        }, requestId));
        return;
      }
    }
    const payload = isRecord(message.payload) ? message.payload : {};
    const state = this.store.state;
    const characterId = player.character.character_id;
    const date = { ...state.worldClock.world_date };
    const minuteOfDay = state.worldClock.minute_of_day;
    const now = this.now();
    const data: Record<string, unknown> = {};
    let messageText = "Business records refreshed.";
    const requiredString = (key: string, maximumLength = 120): string => {
      const value = payload[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
        throw new Error("business_action_invalid");
      }
      return value.trim();
    };
    const requiredInteger = (key: string, minimum = 0, maximum = 1_000_000_000): number => {
      const value = payload[key];
      if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error("business_action_invalid");
      }
      return value as number;
    };

    // Stage 43: the dispatch is one closure. A changing action runs under runBusinessChange, so a failure after the first
    // write leaves no partial stock, account, ledger or ownership change behind.
    const run = (): void => {
      switch (action) {
        case "discover": {
          const locationId = typeof payload.location_id === "string" ? payload.location_id : null;
          data.businesses = discoverBusinesses(state, locationId, this.businessCatalog);
          data.catalog_categories = this.businessCatalog.categories;
          data.catalog_templates = this.businessCatalog.templates.filter((t) => t.active);
          messageText = `Discovered ${(data.businesses as unknown[]).length} active businesses.`;
          break;
        }
        case "create": {
          const business = createBusiness(state, characterId,
            requiredString("template_id"),
            requiredString("name", this.businessCatalog.rules.maximum_business_name_length),
            typeof payload.description === "string" ? payload.description as string : "A new business.",
            typeof payload.location_id === "string" ? payload.location_id : player.character.current_location,
            requiredInteger("initial_capital_ngn", 0, this.businessCatalog.rules.maximum_capital_contribution_ngn),
            date, minuteOfDay, now, this.businessCatalog);
          data.business = business;
          data.business_profile = buildBusinessProfile(state, business.business_id, this.businessCatalog);
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Business '${business.name}' has been registered.`;
          break;
        }
        case "view": {
          const businessId = requiredString("business_id");
          const viewProfile = buildBusinessProfile(state, businessId, this.businessCatalog);
          data.business_profile = viewProfile;
          messageText = `Business profile for '${viewProfile.name}' loaded.`;
          break;
        }
        // Stage 43: products and services have separate listing routes. A stock product cannot be listed as a service, and
        // a service cannot be listed as a stock product (the service layer refuses the other kind).
        case "add_product": {
          const product = addBusinessProduct(state, requiredString("business_id"), characterId,
            requiredString("product_definition_id"),
            payload.custom_price_ngn !== undefined ? requiredInteger("custom_price_ngn", 0) : null,
            date, minuteOfDay, now, this.businessCatalog, "product");
          data.product = product;
          messageText = `Added '${product.display_name}' to the business at ₦${product.price_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "add_service": {
          const service = addBusinessProduct(state, requiredString("business_id"), characterId,
            requiredString("product_definition_id"),
            payload.custom_price_ngn !== undefined ? requiredInteger("custom_price_ngn", 0) : null,
            date, minuteOfDay, now, this.businessCatalog, "service");
          data.product = service;
          messageText = `Listed the service '${service.display_name}' at ₦${service.price_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "set_listing": {
          if (typeof payload.available !== "boolean") throw new Error("business_action_invalid");
          const listing = setBusinessListing(state, requiredString("business_id"), characterId,
            requiredString("product_record_id"), payload.available, date, minuteOfDay, now);
          data.product = listing;
          messageText = listing.available ? `'${listing.display_name}' is back on sale.` : `'${listing.display_name}' was taken off sale.`;
          break;
        }
        case "update_price": {
          const priced = updateBusinessPrice(state, requiredString("business_id"), characterId,
            requiredString("product_record_id"), requiredInteger("price_ngn", 1), date, minuteOfDay, now, this.businessCatalog);
          data.product = priced;
          messageText = `'${priced.display_name}' now sells at ₦${priced.price_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "restock": {
          const result = restockInventory(state, requiredString("business_id"), characterId,
            requiredString("product_definition_id"),
            requiredInteger("quantity", 1, this.businessCatalog.rules.maximum_stock_per_product),
            requiredInteger("unit_cost_ngn", 0),
            date, minuteOfDay, now, this.businessCatalog);
          data.inventory = result.inventory;
          data.movement = result.movement;
          data.cost_transaction = result.cost_transaction;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Restocked ${result.inventory.quantity} units.`;
          break;
        }
        // Stage 40: a sale is a purchase. The buyer is the character this session belongs to, and the buyer pays from
        // their own cash account. A seller cannot record a sale, and a payload cannot name another payer.
        case "buy_product": {
          const result = purchaseProduct(state, requiredString("business_id"), requiredString("product_record_id"),
            characterId, requiredInteger("quantity", 1), date, minuteOfDay, now, this.businessCatalog);
          data.sale = result.sale;
          data.revenue_transaction = result.revenue_transaction;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Purchase of ${result.sale.quantity} for ₦${result.sale.total_ngn.toLocaleString("en-NG")} completed.`;
          break;
        }
        case "buy_service": {
          const result = purchaseService(state, requiredString("business_id"), requiredString("product_record_id"),
            characterId, date, minuteOfDay, now, this.businessCatalog);
          data.sale = result.sale;
          data.revenue_transaction = result.revenue_transaction;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Service bought for ₦${result.sale.total_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "sell_product":
        case "sell_service":
          throw new Error("business_sale_must_be_purchase");
        case "pay_salary": {
          const tx = paySalary(state, requiredString("business_id"), characterId, requiredString("employee_character_id"),
            requiredInteger("amount_ngn", 1), date, minuteOfDay, now, this.businessCatalog);
          data.transaction = tx;
          messageText = `Salary of ₦${tx.amount_ngn.toLocaleString("en-NG")} paid.`;
          break;
        }
        case "transfer_funds": {
          const result = transferBetweenBusinesses(state, requiredString("business_id"), characterId,
            requiredString("to_business_id"), requiredInteger("amount_ngn", 1), date, minuteOfDay, now, this.businessCatalog);
          data.outgoing = result.outgoing;
          data.incoming = result.incoming;
          messageText = `Transferred ₦${result.outgoing.amount_ngn.toLocaleString("en-NG")} between businesses.`;
          break;
        }
        case "contribute_capital": {
          const tx = contributeCapital(state, requiredString("business_id"), characterId,
            requiredInteger("amount_ngn", 1, this.businessCatalog.rules.maximum_capital_contribution_ngn),
            date, minuteOfDay, now, this.businessCatalog);
          data.transaction = tx;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Contributed ₦${tx.amount_ngn.toLocaleString("en-NG")} as capital.`;
          break;
        }
        case "withdraw": {
          const tx = withdrawFromBusiness(state, requiredString("business_id"), characterId,
            requiredInteger("amount_ngn", 1, this.businessCatalog.rules.maximum_owner_withdrawal_ngn),
            date, minuteOfDay, now, this.businessCatalog);
          data.transaction = tx;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Withdrew ₦${tx.amount_ngn.toLocaleString("en-NG")} from the business.`;
          break;
        }
        case "record_expense": {
          const tx = recordBusinessExpense(state, requiredString("business_id"), characterId,
            requiredString("kind", 48), requiredInteger("amount_ngn", 1),
            requiredString("description", 300), date, minuteOfDay, now);
          data.transaction = tx;
          messageText = `Recorded ${tx.kind} expense of ₦${tx.amount_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "produce": {
          const run = runProduction(state, requiredString("business_id"), characterId,
            requiredString("recipe_id"), date, minuteOfDay, now, this.businessCatalog);
          data.production_run = run;
          messageText = `Production completed: ${this.businessCatalog.production_recipes.find((r) => r.id === run.recipe_id)?.label ?? run.recipe_id} (×${run.output_quantity}).`;
          break;
        }
        case "close": {
          const business = closeBusiness(state, requiredString("business_id"), characterId,
            typeof payload.reason === "string" ? payload.reason as string : "",
            date, minuteOfDay, now);
          data.business = business;
          messageText = `Business '${business.name}' has been closed.`;
          break;
        }
        case "add_branch": {
          const branchBusinessId = requiredString("business_id");
          const premisesType = (typeof payload.premises_type === "string" ? payload.premises_type : "shop") as BusinessPremisesType;
          const branch = addBranch(state, branchBusinessId, characterId,
            requiredString("name", 120),
            typeof payload.location_id === "string" ? payload.location_id : state.businesses[branchBusinessId]!.primary_location_id,
            premisesType, date, minuteOfDay, now, this.businessCatalog);
          data.branch = branch;
          messageText = `Branch '${branch.name}' opened.`;
          break;
        }
        case "transfer_ownership": {
          const result = transferOwnership(state, requiredString("business_id"), characterId,
            requiredString("to_character_id"),
            (typeof payload.new_role === "string" ? payload.new_role : "co_owner") as "owner" | "co_owner" | "manager" | "accountant" | "inventory_manager" | "employee",
            payload.share_percent !== undefined ? requiredInteger("share_percent", 0, 100) : 100,
            date, minuteOfDay, now, this.businessCatalog);
          data.ownership = result.ownership;
          data.previous = result.previous;
          messageText = `Ownership transferred to ${result.ownership.character_id} (${result.ownership.role}).`;
          break;
        }
        case "hire_employee": {
          const employment = hireEmployee(state, requiredString("business_id"), characterId,
            requiredString("employee_character_id"),
            date, minuteOfDay, now, this.businessCatalog);
          data.employment = employment;
          messageText = `Employee ${employment.character_id} hired.`;
          break;
        }
        case "fire_employee": {
          const employment = fireEmployee(state, requiredString("business_id"), characterId,
            requiredString("employee_character_id"),
            typeof payload.reason === "string" ? payload.reason as string : "",
            date, minuteOfDay, now);
          data.employment = employment;
          messageText = `Employee ${employment.character_id} released.`;
          break;
        }
        default:
          throw new Error("business_action_unknown");
      }
    };
    try {
      if (BUSINESS_READ_ONLY_ACTIONS.has(action)) run();
      else runBusinessChange(state, run);
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "business.error",
        action,
        code,
        message: businessErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["discover", "view"].includes(action)) this.touchPlayer(player);
    const reply: Record<string, unknown> = { type: "business.result", action, ok: true, message: messageText, data };
    if (!BUSINESS_READ_ONLY_ACTIONS.has(action) && requestId !== undefined) {
      // Stage 34: the change is in memory now. Its reply waits until a save has covered it.
      this.changeGeneration += 1;
      const key = moneyReplyKey(player, requestId);
      const pending: PendingMoneyReply = { kind: "business", generation: this.changeGeneration, reply, delivered: false };
      this.pendingMoneyReplies.set(key, pending);
      await this.confirmMoneyReply(context, key, requestId, pending, false);
      return;
    }
    this.send(context, appendOptionalRequestId(reply, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  private async propertyAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (typeof message.action !== "string" || message.action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "property.error", action: "", code: "property_action_invalid",
        message: "Choose a supported property action.",
      }, requestId));
      return;
    }
    const suspendedCode = PROPERTY_SUSPENDED_ACTIONS.get(message.action);
    if (suspendedCode !== undefined) {
      this.send(context, appendOptionalRequestId({
        type: "property.error", action: message.action, code: suspendedCode,
        message: "Paying rent is paused while the payment rules are being made safe. Nothing was changed.",
      }, requestId));
      return;
    }
    const action = message.action;
    const payload = isRecord(message.payload) ? message.payload : {};
    const changing = PROPERTY_CHANGING_ACTIONS.has(action);
    let fingerprint = "";
    if (changing) {
      // Stage 35: a changing property request needs a request ID. A repeat of a recorded request is answered without a
      // second change. A repeat with a different action or payload is refused. Only then is the write gate checked.
      if (requestId === undefined) {
        this.send(context, { type: "property.error", action, code: "request_id_required", message: "This action requires a unique request ID." });
        return;
      }
      fingerprint = propertyRequestFingerprint(action, payload);
      const key = moneyReplyKey(player, requestId);
      const inFlight = this.requestsInFlight.get(key);
      if (inFlight !== undefined) {
        inFlight.command = "property.action";
        inFlight.fingerprint = fingerprint;
      }
      const pending = this.pendingMoneyReplies.get(key);
      const recorded = (player.recentPropertyRequests ?? []).find((entry) => entry.request_id === requestId);
      if (pending !== undefined) {
        if (pending.kind !== "property" || pending.fingerprint !== fingerprint) {
          this.sendPropertyRequestReused(context, action, requestId);
          return;
        }
        // The first change is in memory and not yet confirmed: answer it once its save succeeds.
        await this.confirmMoneyReply(context, key, requestId, pending, true);
        return;
      }
      if (recorded !== undefined) {
        if (recorded.fingerprint !== fingerprint) {
          this.sendPropertyRequestReused(context, action, requestId);
          return;
        }
        this.send(context, { type: "command.duplicate", requestId });
        this.sendCharacterSnapshot(context, requestId);
        return;
      }
      if (player.recentRequestIds.includes(requestId)) {
        this.sendPropertyRequestReused(context, action, requestId);
        return;
      }
      // Stage 36: a request applied by another process is recorded durably. It is answered here, not applied again.
      let stored: StoredOperation | undefined;
      try {
        stored = await this.durableRequest(player, requestId);
      } catch {
        this.send(context, appendOptionalRequestId({
          type: "property.error", action, code: "property_persistence_unavailable",
          message: SAVE_OUTCOME_MESSAGES.property_persistence_unavailable,
        }, requestId));
        return;
      }
      if (stored !== undefined) {
        if (compareWithRecord(stored, "property.action", fingerprint) === "reused") {
          this.sendPropertyRequestReused(context, action, requestId);
          return;
        }
        this.send(context, { type: "command.duplicate", requestId });
        this.sendCharacterSnapshot(context, requestId);
        return;
      }
      if (!this.financialWritesOpen()) {
        this.send(context, appendOptionalRequestId({
          type: "property.error", action, code: "property_persistence_unavailable",
          message: SAVE_OUTCOME_MESSAGES.property_persistence_unavailable,
        }, requestId));
        return;
      }
    }
    const state = this.store.state;
    const characterId = player.character.character_id;
    const date = { ...state.worldClock.world_date };
    const minuteOfDay = state.worldClock.minute_of_day;
    const now = this.now();
    const data: Record<string, unknown> = {};
    let messageText = "Property records refreshed.";
    const requiredString = (key: string, maximumLength = 120): string => {
      const value = payload[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
        throw new Error("property_action_invalid");
      }
      return value.trim();
    };
    const requiredInteger = (key: string, minimum = 0, maximum = 10_000_000_000): number => {
      const value = payload[key];
      if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error("property_action_invalid");
      }
      return value as number;
    };

    try {
      switch (action) {
        case "market": {
          const filters = isRecord(payload.filters) ? payload.filters : {};
          const snapshot = searchPropertyMarket(state, {
            location_id: typeof filters.location_id === "string" ? filters.location_id : null,
            category_id: typeof filters.category_id === "string" ? filters.category_id : null,
            listing_type: typeof filters.listing_type === "string" ? filters.listing_type as PropertyListingType : null,
            min_price_ngn: typeof filters.min_price_ngn === "number" ? filters.min_price_ngn : null,
            max_price_ngn: typeof filters.max_price_ngn === "number" ? filters.max_price_ngn : null,
            min_bedrooms: typeof filters.min_bedrooms === "number" ? filters.min_bedrooms : null,
            condition: typeof filters.condition === "string" ? filters.condition as PropertyCondition : null,
          }, this.propertyCatalog);
          data.market = snapshot;
          messageText = `Found ${snapshot.listings.length} available properties.`;
          break;
        }
        case "view": {
          const profile = buildPropertyProfile(state, requiredString("property_id"));
          data.property_profile = profile;
          messageText = `Property '${profile.name}' details loaded.`;
          break;
        }
        case "my_properties": {
          const profiles = getCharacterProperties(state, characterId);
          data.properties = profiles;
          messageText = `You own ${profiles.length} properties.`;
          break;
        }
        case "my_rentals": {
          const rentals = getCharacterRentals(state, characterId);
          data.rentals = rentals;
          messageText = `You have ${rentals.length} rental agreements.`;
          break;
        }
        case "purchase": {
          const result = purchaseProperty(state, characterId, requiredString("listing_id"), date, minuteOfDay, now, this.propertyCatalog);
          data.property = result.property;
          data.sale = result.sale;
          data.ownership = result.ownership;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Property '${result.property.name}' purchased for ₦${result.sale.amount_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "list_for_sale": {
          const listing = listPropertyForSale(state, requiredString("property_id"), characterId,
            requiredInteger("asking_price_ngn", this.propertyCatalog.rules.minimum_property_price_ngn, this.propertyCatalog.rules.maximum_property_price_ngn),
            date, minuteOfDay, now, this.propertyCatalog);
          data.listing = listing;
          messageText = `Property listed for sale at ₦${listing.asking_price_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "list_for_rent": {
          const rentPeriod = (typeof payload.rent_period === "string" ? payload.rent_period : "yearly") as PropertyRentPeriod;
          const listing = listPropertyForRent(state, requiredString("property_id"), characterId,
            requiredInteger("rent_price_ngn", this.propertyCatalog.rules.minimum_rent_price_ngn, this.propertyCatalog.rules.maximum_rent_price_ngn),
            rentPeriod,
            requiredInteger("deposit_ngn", 0, this.propertyCatalog.rules.maximum_property_price_ngn),
            date, minuteOfDay, now, this.propertyCatalog);
          data.listing = listing;
          messageText = `Property listed for rent at ₦${listing.rent_price_ngn.toLocaleString("en-NG")}/${listing.rent_period}.`;
          break;
        }
        case "rent": {
          const result = createRentalAgreement(state, characterId, requiredString("listing_id"), date, minuteOfDay, now, this.propertyCatalog);
          data.agreement = result.agreement;
          data.payment = result.payment;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Rental agreement started. Rent: ₦${result.agreement.rent_ngn.toLocaleString("en-NG")}/${result.agreement.rent_period}.`;
          break;
        }
        case "pay_rent": {
          const payment = payRent(state, characterId, requiredString("agreement_id"), date, minuteOfDay, now);
          data.payment = payment;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Rent payment of ₦${payment.amount_ngn.toLocaleString("en-NG")} processed.`;
          break;
        }
        case "terminate_rental": {
          const agreement = terminateRentalAgreement(state, characterId, requiredString("agreement_id"),
            typeof payload.reason === "string" ? payload.reason as string : "",
            date, minuteOfDay, now);
          data.agreement = agreement;
          messageText = `Rental agreement terminated.`;
          break;
        }
        case "maintain": {
          const maintenance = recordMaintenance(state, requiredString("property_id"), characterId,
            requiredString("description", 500),
            requiredInteger("cost_ngn", 0),
            (typeof payload.condition === "string" ? payload.condition : "good") as PropertyCondition,
            date, minuteOfDay, now, this.propertyCatalog);
          data.maintenance = maintenance;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Maintenance recorded. Condition: ${maintenance.condition_before} → ${maintenance.condition_after}.`;
          break;
        }
        case "furnish": {
          const furnishing = purchaseFurniture(state, requiredString("property_id"), characterId,
            requiredString("furniture_id"),
            requiredInteger("quantity", 1, 10),
            date, minuteOfDay, now, this.propertyCatalog);
          data.furnishing = furnishing;
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Furniture purchased and placed.`;
          break;
        }
        case "remove_furnishing": {
          removeFurnishing(state, requiredString("property_id"), characterId,
            requiredString("furnishing_id"), date, now);
          syncCharacterCashFromEconomy(state, characterId);
          messageText = `Furnishing removed.`;
          break;
        }
        case "transfer": {
          const result = transferProperty(state, requiredString("property_id"), characterId,
            requiredString("to_character_id"), date, minuteOfDay, now, this.propertyCatalog);
          data.ownership = result.ownership;
          data.previous = result.previous;
          messageText = `Property transferred to ${result.ownership.owner_id}.`;
          break;
        }
        default:
          throw new Error("property_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "property.error",
        action,
        code,
        message: propertyErrorMessage(code),
      }, requestId));
      return;
    }

    if (!changing) {
      this.send(context, appendOptionalRequestId({
        type: "property.result", action, ok: true, message: messageText, data,
      }, requestId));
      this.sendCharacterSnapshot(context);
      await this.flushDirty();
      return;
    }
    // Stage 35: the change, its request record, and the touched player are in memory now, and they are saved together.
    // The reply waits until a save has covered this change; until then a retry with the same request ID is answered
    // from the pending record, and a failed save is reported as property_not_saved or property_outcome_unknown.
    this.markRequestProcessed(player, requestId);
    this.recordPropertyRequest(player, requestId!, fingerprint);
    this.touchPlayer(player);
    this.changeGeneration += 1;
    const key = moneyReplyKey(player, requestId!);
    const pending: PendingMoneyReply = {
      kind: "property", generation: this.changeGeneration, delivered: false, fingerprint,
      reply: { type: "property.result", action, ok: true, message: messageText, data },
    };
    this.pendingMoneyReplies.set(key, pending);
    await this.confirmMoneyReply(context, key, requestId!, pending, false);
  }

  /** Records a changing property request with its fingerprint, in the same save as the change (Stage 35). */
  private recordPropertyRequest(player: PersistentPlayer, requestId: string, fingerprint: string): void {
    const records = player.recentPropertyRequests ?? (player.recentPropertyRequests = []);
    records.push({ request_id: requestId, fingerprint });
    while (records.length > MAX_RECENT_REQUESTS) records.shift();
    this.dirty = true;
  }

  /** Stage 36: ends the in-flight state of a request, and wakes any copy that waits for it. */
  private releaseInFlight(key: string): void {
    const entry = this.requestsInFlight.get(key);
    if (entry !== undefined) this.releaseRequest(key, entry);
  }

  private releaseRequest(key: string, entry: InFlightRequest): void {
    if (this.requestsInFlight.get(key) === entry) this.requestsInFlight.delete(key);
    entry.release();
  }

  /** Stage 36: a reused request ID with a different command or payload. Nothing is changed. */
  private sendRequestReused(context: ConnectionContext, requestId: string): void {
    this.sendError(context, "request_id_reused", "This request ID was already used for a different request. Nothing was changed; use a new request ID for a new request.", requestId);
  }

  private sendPropertyRequestReused(context: ConnectionContext, action: string, requestId: string): void {
    this.send(context, appendOptionalRequestId({
      type: "property.error", action, code: "property_request_id_reused",
      message: "This request ID was already used for a different request. Nothing was changed; use a new request ID for a new request.",
    }, requestId));
  }

  private async governmentAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (typeof message.action !== "string" || message.action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "government.error", action: "", code: "government_action_invalid",
        message: "Choose a supported government action.",
      }, requestId));
      return;
    }
    const action = message.action;
    if (!GOVERNMENT_READ_ACTIONS.has(action) && !GOVERNMENT_TREASURY_ACTIONS.has(action)) {
      this.send(context, appendOptionalRequestId({
        type: "government.error", action, code: GOVERNMENT_WRITES_SUSPENDED_CODE,
        message: governmentErrorMessage(GOVERNMENT_WRITES_SUSPENDED_CODE),
      }, requestId));
      return;
    }
    const payload = isRecord(message.payload) ? message.payload : {};
    const state = this.store.state;
    const characterId = player.character.character_id;
    const date = { ...state.worldClock.world_date };
    const now = this.now();
    const data: Record<string, unknown> = {};
    let messageText = "Government records refreshed.";
    const requiredString = (key: string, maximumLength = 120): string => {
      const value = payload[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
        throw new Error("government_action_invalid");
      }
      return value.trim();
    };
    const requiredInteger = (key: string, minimum = 0, maximum = 1_000_000_000_000): number => {
      const value = payload[key];
      if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error("government_action_invalid");
      }
      return value as number;
    };

    try {
      switch (action) {
        case "view_federal": {
          const federal = getFederalGovernment(state);
          data.federal_government = federal;
          messageText = federal ? `Federal Government of Nigeria loaded.` : `No federal government found.`;
          break;
        }
        case "view_state": {
          const stateId = requiredString("state_id", 40);
          const stateGov = getStateGovernment(state, stateId);
          data.state_government = stateGov;
          messageText = stateGov ? `State government loaded.` : `No state government found for '${stateId}'.`;
          break;
        }
        case "view_local": {
          const lgaId = requiredString("lga_id", 80);
          const localGov = getLocalGovernment(state, lgaId);
          data.local_government = localGov;
          messageText = localGov ? `Local government loaded.` : `No local government found for '${lgaId}'.`;
          break;
        }
        case "appoint": {
          const appointment = appointOfficial(state, requiredString("office_id"),
            requiredString("character_id"), characterId, date, now, this.governmentCatalog);
          data.appointment = appointment;
          messageText = `Official appointed.`;
          break;
        }
        case "remove_official": {
          const appointment = removeOfficial(state, requiredString("appointment_id"),
            typeof payload.reason === "string" ? payload.reason as string : "",
            date, now);
          data.appointment = appointment;
          messageText = `Official removed from office.`;
          break;
        }
        case "approve_budget": {
          const budget = approveBudget(state, characterId, requiredString("budget_id", 120),
            requiredInteger("approved_amount_ngn", 1, this.governmentCatalog.rules.maximum_budget_amount_ngn),
            date, now, this.governmentCatalog, this.financialWritesOpen());
          data.budget = budget;
          messageText = `Budget ceiling set to ₦${budget.approved_amount_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "allocate_budget": {
          // The request ID is the top-level requestId, so a retry of the same message replays the first result.
          const result = allocateBudget(state, characterId, requiredString("budget_id", 120),
            requiredInteger("amount_ngn", 1, this.governmentCatalog.rules.maximum_budget_amount_ngn),
            requestId, date, now, this.governmentCatalog, this.financialWritesOpen());
          data.budget = result.budget;
          data.replayed = result.replayed;
          messageText = result.replayed ? "Allocation already recorded." : "Allocation recorded.";
          break;
        }
        case "spend_budget": {
          const destination = isRecord(payload.destination) ? payload.destination : {};
          const result = spendBudget(state, characterId, requiredString("budget_id", 120),
            requiredInteger("amount_ngn", this.governmentCatalog.rules.minimum_expenditure_amount_ngn,
              this.governmentCatalog.rules.maximum_expenditure_amount_ngn),
            { kind: typeof destination.kind === "string" ? destination.kind : "",
              id: typeof destination.id === "string" ? destination.id : "" },
            typeof payload.reason === "string" ? payload.reason : "",
            requestId, date, now, this.governmentCatalog, this.financialWritesOpen());
          data.expenditure = result.expenditure;
          data.replayed = result.replayed;
          messageText = result.replayed
            ? "Payment already recorded."
            : `Payment of ₦${result.expenditure.amount_ngn.toLocaleString("en-NG")} recorded.`;
          break;
        }
        case "create_budget": {
          const budget = createBudget(state, requiredString("organisation_id"),
            requiredInteger("fiscal_year", 2000, 3000),
            requiredString("category_id", 60),
            requiredInteger("amount_ngn", this.governmentCatalog.rules.minimum_budget_amount_ngn, this.governmentCatalog.rules.maximum_budget_amount_ngn),
            date, now, this.governmentCatalog);
          data.budget = budget;
          messageText = `Budget of ₦${budget.approved_amount_ngn.toLocaleString("en-NG")} created.`;
          break;
        }
        case "record_revenue": {
          const revenue = recordGovernmentRevenue(state, requiredString("organisation_id"),
            requiredString("category_id", 60),
            requiredInteger("amount_ngn", this.governmentCatalog.rules.minimum_revenue_amount_ngn, this.governmentCatalog.rules.maximum_revenue_amount_ngn),
            typeof payload.description === "string" ? payload.description as string : "",
            typeof payload.source_reference === "string" ? payload.source_reference as string : null,
            date, now, this.governmentCatalog);
          data.revenue = revenue;
          messageText = `Revenue of ₦${revenue.amount_ngn.toLocaleString("en-NG")} recorded.`;
          break;
        }
        case "record_expenditure": {
          const budgetId = typeof payload.budget_id === "string" ? payload.budget_id as string : null;
          const projectId = typeof payload.project_id === "string" ? payload.project_id as string : null;
          const expenditure = recordGovernmentExpenditure(state, requiredString("organisation_id"),
            budgetId,
            requiredString("category_id", 60),
            requiredInteger("amount_ngn", this.governmentCatalog.rules.minimum_expenditure_amount_ngn, this.governmentCatalog.rules.maximum_expenditure_amount_ngn),
            typeof payload.description === "string" ? payload.description as string : "",
            projectId,
            typeof payload.recipient_reference === "string" ? payload.recipient_reference as string : null,
            date, now, this.governmentCatalog);
          data.expenditure = expenditure;
          messageText = `Expenditure of ₦${expenditure.amount_ngn.toLocaleString("en-NG")} recorded.`;
          break;
        }
        case "create_project": {
          const budgetId = typeof payload.budget_id === "string" ? payload.budget_id as string : null;
          const project = createProject(state, requiredString("organisation_id"),
            budgetId,
            requiredString("category_id", 60),
            requiredString("name", this.governmentCatalog.rules.project_max_name_length),
            typeof payload.description === "string" ? payload.description as string : "",
            typeof payload.location_id === "string" ? payload.location_id as string : "unknown",
            requiredInteger("estimated_cost_ngn", this.governmentCatalog.rules.minimum_project_cost_ngn, this.governmentCatalog.rules.maximum_project_cost_ngn),
            date, now, this.governmentCatalog);
          data.project = project;
          messageText = `Project '${project.name}' created.`;
          break;
        }
        case "update_project": {
          const project = updateProjectStatus(state, requiredString("project_id"),
            (typeof payload.status === "string" ? payload.status : "proposed") as ProjectStatus,
            typeof payload.progress_percent === "number" ? payload.progress_percent as number : null,
            date, now, this.governmentCatalog);
          data.project = project;
          messageText = `Project status updated to ${project.status}.`;
          break;
        }
        case "fund_project": {
          const project = fundProject(state, requiredString("project_id"),
            requiredInteger("amount_ngn", 1),
            date, now);
          data.project = project;
          messageText = `Project funded. Total funding: ₦${project.approved_funding_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "publish_announcement": {
          const scopeLevel = (typeof payload.scope_level === "string" ? payload.scope_level : "federal") as GovernmentLevel;
          const scopeJurisdictionId = typeof payload.scope_jurisdiction_id === "string" ? payload.scope_jurisdiction_id as string : null;
          const projectId = typeof payload.project_id === "string" ? payload.project_id as string : null;
          const announcement = publishAnnouncement(state, requiredString("organisation_id"),
            requiredString("title", this.governmentCatalog.rules.announcement_max_title_length),
            requiredString("body", this.governmentCatalog.rules.announcement_max_body_length),
            scopeLevel, scopeJurisdictionId, projectId,
            date, now, this.governmentCatalog);
          data.announcement = announcement;
          messageText = `Announcement published.`;
          break;
        }
        case "search_projects": {
          const filters = isRecord(payload.filters) ? payload.filters : {};
          const projects = searchProjects(state, {
            organisation_id: typeof filters.organisation_id === "string" ? filters.organisation_id : null,
            location_id: typeof filters.location_id === "string" ? filters.location_id : null,
            category_id: typeof filters.category_id === "string" ? filters.category_id : null,
            status: typeof filters.status === "string" ? filters.status as ProjectStatus : null,
          });
          data.projects = projects;
          messageText = `Found ${projects.length} projects.`;
          break;
        }
        case "announcements": {
          const level = typeof payload.level === "string" ? payload.level as GovernmentLevel : null;
          const jurisdictionId = typeof payload.jurisdiction_id === "string" ? payload.jurisdiction_id as string : null;
          const announcements = getPublishedAnnouncements(state, level, jurisdictionId);
          data.announcements = announcements;
          messageText = `Found ${announcements.length} announcements.`;
          break;
        }
        case "my_appointments": {
          const appointments = getCharacterAppointments(state, characterId);
          data.appointments = appointments;
          messageText = `You hold ${appointments.filter((a) => a.status === "active").length} active government appointments.`;
          break;
        }
        default:
          throw new Error("government_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "government.error",
        action,
        code,
        message: governmentErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["view_federal", "view_state", "view_local", "search_projects", "announcements", "my_appointments"].includes(action)) this.touchPlayer(player);
    if (GOVERNMENT_TREASURY_ACTIONS.has(action)) {
      // A treasury reply is sent only once its change is saved. Until then the reply is an error, and a retry with the
      // same request ID returns the recorded result (replayed) after the save succeeds.
      this.changeGeneration += 1;
      const durability = await this.ensureDurable();
      if (!durability.durable) {
        // not_saved: the saved world does not hold this change. unknown: it may hold it. Both are retried with the same
        // request ID, which never applies a change twice.
        const code = durability.outcome === "unknown" ? "treasury_outcome_unknown" : "treasury_not_saved";
        this.send(context, appendOptionalRequestId({
          type: "government.error", action, code, message: governmentErrorMessage(code),
        }, requestId));
        return;
      }
    }
    this.send(context, appendOptionalRequestId({
      type: "government.result", action, ok: true, message: messageText, data,
    }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  private async electionAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const data = message;
    const action = typeof data.action === "string" ? data.action : "";
    if (!ELECTION_READ_ACTIONS.has(action)) {
      this.send(context, appendOptionalRequestId({
        type: "election.error", action, code: ELECTION_WRITES_SUSPENDED_CODE,
        message: electionsErrorMessage(ELECTION_WRITES_SUSPENDED_CODE),
      }, requestId));
      return;
    }
    const characterId = player.character.character_id;
    const date = this.store.state.worldClock.world_date;
    const now = this.now();
    let messageText = "";
    const responseData: Record<string, unknown> = {};
    const requiredString = (key: string, value: unknown, maxLength = 200): string => {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) throw new Error("elections_action_invalid");
      return value.trim();
    };
    const optionalString = (key: string, value: unknown, maxLength = 500): string | null => {
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || value.length > maxLength) throw new Error("elections_action_invalid");
      return value;
    };

    try {
      switch (action) {
        case "list_parties": {
          const statusFilter = optionalString("status", data.status) as PartyStatus | undefined;
          responseData.parties = listParties(this.store.state, statusFilter);
          messageText = "Parties loaded.";
          break;
        }
        case "create_party": {
          const name = requiredString("name", data.name);
          const abbreviation = requiredString("abbreviation", data.abbreviation);
          const description = optionalString("description", data.description) ?? "";
          const policyPositions = Array.isArray(data.policy_positions) ? data.policy_positions.map((p) => String(p)) : [];
          const party = createPoliticalParty(this.store.state, name, abbreviation, description, characterId, policyPositions, date, now, this.electionsCatalog);
          responseData.party = party;
          messageText = `Party "${party.name}" created.`;
          break;
        }
        case "register_party": {
          const partyId = requiredString("party_id", data.party_id);
          const party = registerPoliticalParty(this.store.state, partyId, characterId, date, now);
          responseData.party = party;
          messageText = "Party registered as active.";
          break;
        }
        case "join_party": {
          const partyId = requiredString("party_id", data.party_id);
          const membership = joinPoliticalParty(this.store.state, partyId, characterId, date, now, this.electionsCatalog);
          responseData.membership = membership;
          messageText = "Joined party.";
          break;
        }
        case "leave_party": {
          const membershipId = requiredString("membership_id", data.membership_id);
          const reason = optionalString("reason", data.reason);
          const membership = leavePoliticalParty(this.store.state, membershipId, reason ?? "", date, now);
          responseData.membership = membership;
          messageText = "Left party.";
          break;
        }
        case "political_profile": {
          const profile = getPoliticalProfile(this.store.state, characterId);
          responseData.profile = profile;
          messageText = "Political profile loaded.";
          break;
        }
        case "update_profile": {
          const statement = requiredString("public_statement", data.public_statement);
          const profile = updatePoliticalProfile(this.store.state, characterId, statement, date, now);
          responseData.profile = profile;
          messageText = "Political profile updated.";
          break;
        }
        case "list_elections": {
          const phaseFilter = optionalString("phase", data.phase) as ElectionPhase | undefined;
          responseData.elections = listElections(this.store.state, phaseFilter);
          messageText = "Elections loaded.";
          break;
        }
        case "view_election": {
          const electionId = requiredString("election_id", data.election_id);
          const election = getElection(this.store.state, electionId);
          if (!election) throw new Error("elections_election_not_found");
          responseData.election = election;
          messageText = "Election loaded.";
          break;
        }
        case "create_election": {
          const electionType = requiredString("election_type", data.election_type);
          const jurisdictionId = optionalString("jurisdiction_id", data.jurisdiction_id) ?? null;
          const constituencyId = optionalString("constituency_id", data.constituency_id) ?? null;
          const registrationOpenDate = requiredString("registration_open_date", data.registration_open_date);
          const registrationCloseDate = requiredString("registration_close_date", data.registration_close_date);
          const campaignStartDate = requiredString("campaign_start_date", data.campaign_start_date);
          const campaignEndDate = requiredString("campaign_end_date", data.campaign_end_date);
          const votingOpenDate = requiredString("voting_open_date", data.voting_open_date);
          const votingCloseDate = requiredString("voting_close_date", data.voting_close_date);
          const election = createElection(
            this.store.state, electionType, jurisdictionId, constituencyId, characterId,
            registrationOpenDate, registrationCloseDate, campaignStartDate, campaignEndDate,
            votingOpenDate, votingCloseDate, date, now, this.electionsCatalog,
          );
          responseData.election = election;
          messageText = "Election created.";
          break;
        }
        case "advance_phase": {
          const electionId = requiredString("election_id", data.election_id);
          const newPhase = requiredString("phase", data.phase) as ElectionPhase;
          const election = advanceElectionPhase(this.store.state, electionId, newPhase, characterId, date, now);
          responseData.election = election;
          messageText = `Election phase advanced to ${newPhase}.`;
          break;
        }
        case "register_candidate": {
          const electionId = requiredString("election_id", data.election_id);
          const partyId = optionalString("party_id", data.party_id) ?? null;
          let manifesto: ManifestoRecord | null = null;
          if (isRecord(data.manifesto)) {
            const m = data.manifesto;
            manifesto = {
              title: String(m.title ?? ""),
              summary: String(m.summary ?? ""),
              policies: Array.isArray(m.policies) ? m.policies.map((p) => ({
                category: String((p as Record<string, unknown>).category ?? ""),
                statement: String((p as Record<string, unknown>).statement ?? ""),
              })) : [],
              published_at: new Date(now).toISOString(),
              published_world_date: { ...date },
            };
          }
          const candidate = registerCandidate(this.store.state, electionId, characterId, partyId, manifesto, date, now, this.electionsCatalog);
          responseData.candidate = candidate;
          messageText = "Candidate registration submitted.";
          break;
        }
        case "approve_candidate": {
          const candidateId = requiredString("candidate_id", data.candidate_id);
          const candidate = approveCandidate(this.store.state, candidateId, characterId, date, now);
          responseData.candidate = candidate;
          messageText = "Candidate approved.";
          break;
        }
        case "reject_candidate": {
          const candidateId = requiredString("candidate_id", data.candidate_id);
          const reason = requiredString("reason", data.reason);
          const candidate = rejectCandidate(this.store.state, candidateId, reason, characterId, date, now);
          responseData.candidate = candidate;
          messageText = "Candidate rejected.";
          break;
        }
        case "withdraw_candidate": {
          const candidateId = requiredString("candidate_id", data.candidate_id);
          const candidate = withdrawCandidate(this.store.state, candidateId, date, now);
          responseData.candidate = candidate;
          messageText = "Candidate withdrawn.";
          break;
        }
        case "list_candidates": {
          const electionId = requiredString("election_id", data.election_id);
          responseData.candidates = listCandidates(this.store.state, electionId);
          messageText = "Candidates loaded.";
          break;
        }
        case "create_campaign": {
          const candidateId = requiredString("candidate_id", data.candidate_id);
          const title = requiredString("title", data.title);
          const description = optionalString("description", data.description);
          const themes = Array.isArray(data.themes) ? data.themes.map((t) => String(t)) : [];
          const campaign = createCampaign(this.store.state, candidateId, title, description ?? "", themes, date, now, this.electionsCatalog);
          responseData.campaign = campaign;
          messageText = "Campaign created.";
          break;
        }
        case "view_campaign": {
          const campaignId = requiredString("campaign_id", data.campaign_id);
          const campaign = getCampaign(this.store.state, campaignId);
          if (!campaign) throw new Error("elections_campaign_not_found");
          responseData.campaign = campaign;
          messageText = "Campaign loaded.";
          break;
        }
        case "check_eligibility": {
          const electionId = requiredString("election_id", data.election_id);
          const result = checkVoterEligibility(this.store.state, electionId, characterId, this.electionsCatalog);
          responseData.eligible = result.eligible;
          responseData.reason = result.reason;
          messageText = result.eligible ? "Eligible to vote." : `Not eligible: ${result.reason}`;
          break;
        }
        case "cast_ballot": {
          const electionId = requiredString("election_id", data.election_id);
          const candidateId = requiredString("candidate_id", data.candidate_id);
          const result = castBallot(this.store.state, electionId, characterId, candidateId, date, now, this.electionsCatalog);
          responseData.ballot_id = result.ballot.ballot_id;
          messageText = "Ballot cast successfully.";
          break;
        }
        case "count_votes": {
          const electionId = requiredString("election_id", data.election_id);
          const result = countVotes(this.store.state, electionId, date, now);
          responseData.results = result;
          messageText = "Votes counted.";
          break;
        }
        case "certify_result": {
          const electionId = requiredString("election_id", data.election_id);
          const result = certifyElectionResult(this.store.state, electionId, characterId, date, now);
          responseData.results = result;
          messageText = "Result certified.";
          break;
        }
        case "publish_result": {
          const electionId = requiredString("election_id", data.election_id);
          const result = publishElectionResult(this.store.state, electionId, characterId, date, now);
          responseData.results = result;
          messageText = "Result published.";
          break;
        }
        case "transfer_office": {
          const electionId = requiredString("election_id", data.election_id);
          const appointment = transferElectedOffice(this.store.state, electionId, date, now);
          responseData.appointment = appointment;
          messageText = "Office transferred to elected winner.";
          break;
        }
        case "submit_dispute": {
          const electionId = requiredString("election_id", data.election_id);
          const category = requiredString("category", data.category);
          const description = requiredString("description", data.description);
          const evidence = Array.isArray(data.evidence) ? data.evidence.map((e) => String(e)) : [];
          const dispute = submitDispute(this.store.state, electionId, characterId, category, description, evidence, date, now, this.electionsCatalog);
          responseData.dispute = dispute;
          messageText = "Dispute submitted.";
          break;
        }
        case "audit_log": {
          const electionId = requiredString("election_id", data.election_id);
          responseData.audits = getElectionAuditLog(this.store.state, electionId);
          messageText = "Audit log loaded.";
          break;
        }
        case "my_history": {
          responseData.history = getCharacterElectionHistory(this.store.state, characterId);
          responseData.membership = getCharacterPartyMembership(this.store.state, characterId);
          messageText = "Election history loaded.";
          break;
        }
        default:
          throw new Error("elections_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "election.error",
        action,
        code,
        message: electionsErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["list_parties", "list_elections", "view_election", "political_profile", "list_candidates", "view_campaign", "check_eligibility", "audit_log", "my_history"].includes(action)) this.touchPlayer(player);
    this.send(context, appendOptionalRequestId({
      type: "election.result", action, ok: true, message: messageText, data: responseData,
    }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  private async justiceAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const data = message;
    const action = typeof data.action === "string" ? data.action : "";
    if (!action || action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "justice.error", action: "", code: "justice_action_invalid",
        message: "Choose a supported justice action.",
      }, requestId));
      return;
    }
    const suspendedCode = JUSTICE_SUSPENDED_ACTIONS.get(action);
    if (suspendedCode) {
      this.send(context, appendOptionalRequestId({
        type: "justice.error", action, code: suspendedCode,
        message: justiceErrorMessage(suspendedCode),
      }, requestId));
      return;
    }
    const characterId = player.character.character_id;
    const date = this.store.state.worldClock.world_date;
    const now = this.now();
    let messageText = "";
    const responseData: Record<string, unknown> = {};
    const requiredString = (key: string, value: unknown, maxLength = 200): string => {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) throw new Error("justice_action_invalid");
      return value.trim();
    };
    const optionalString = (key: string, value: unknown, maxLength = 500): string | null => {
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || value.length > maxLength) throw new Error("justice_action_invalid");
      return value;
    };

    try {
      switch (action) {
        case "search_laws": {
          const query = optionalString("query", data.query);
          const category = optionalString("category", data.category) as import("../justice/types.js").LawCategoryId | undefined;
          const jurisdiction = optionalString("jurisdiction", data.jurisdiction);
          responseData.laws = searchLaws(this.store.state, query ?? undefined, category, jurisdiction ?? undefined);
          messageText = "Laws loaded.";
          break;
        }
        case "active_laws": {
          const jurisdiction = optionalString("jurisdiction", data.jurisdiction);
          responseData.laws = getActiveLaws(this.store.state, jurisdiction ?? undefined);
          messageText = "Active laws loaded.";
          break;
        }
        case "list_courts": {
          const jurisdiction = optionalString("jurisdiction", data.jurisdiction);
          responseData.courts = listCourts(this.store.state, jurisdiction ?? undefined);
          messageText = "Courts loaded.";
          break;
        }
        case "view_court": {
          const courtId = requiredString("court_id", data.court_id);
          const court = getCourt(this.store.state, courtId);
          if (!court) throw new Error("justice_court_not_found");
          responseData.court = court;
          messageText = "Court loaded.";
          break;
        }
        case "create_proposal": {
          const title = requiredString("title", data.title, 200);
          const description = requiredString("description", data.description, 2000);
          const purpose = requiredString("purpose", data.purpose, 1000);
          const jurisdiction = requiredString("jurisdiction", data.jurisdiction);
          const applicableStateId = optionalString("applicable_state_id", data.applicable_state_id);
          const supportingExplanation = optionalString("supporting_explanation", data.supporting_explanation, 2000) ?? "";
          const provisions = Array.isArray(data.provisions) ? data.provisions.map((p) => {
            const pp = p as Record<string, unknown>;
            return { section: String(pp.section ?? ""), title: String(pp.title ?? ""), description: String(pp.description ?? "") };
          }) : [];
          const proposal = createLegislativeProposal(
            this.store.state, title, description, purpose, characterId,
            jurisdiction, applicableStateId ?? null, provisions, supportingExplanation,
            date, now, this.justiceCatalog,
          );
          responseData.proposal = proposal;
          messageText = "Legislative proposal created.";
          break;
        }
        case "submit_proposal": {
          const proposalId = requiredString("proposal_id", data.proposal_id);
          const proposal = submitProposal(this.store.state, proposalId, characterId, date, now);
          responseData.proposal = proposal;
          messageText = "Proposal submitted for review.";
          break;
        }
        case "file_case": {
          const category = requiredString("category", data.category) as CaseCategoryId;
          const courtId = requiredString("court_id", data.court_id);
          const respondentId = optionalString("respondent_character_id", data.respondent_character_id);
          const summary = requiredString("summary", data.summary, 3000);
          const description = optionalString("description", data.description, 5000) ?? "";
          const relevantLawIds = Array.isArray(data.relevant_law_ids) ? data.relevant_law_ids.map(String) : [];
          const relevantEventDate = optionalString("relevant_event_date", data.relevant_event_date);
          const caseRec = fileCase(
            this.store.state, category, courtId, characterId, respondentId,
            summary, description, relevantLawIds, relevantEventDate, date, now, this.justiceCatalog,
          );
          responseData.case = getCase(this.store.state, caseRec.case_id);
          messageText = "Case filed successfully.";
          break;
        }
        case "my_cases": {
          responseData.cases = getCharacterCases(this.store.state, characterId);
          messageText = "Your cases loaded.";
          break;
        }
        case "view_case": {
          const caseId = requiredString("case_id", data.case_id);
          // Parties only: a non-party gets justice_case_not_found, the same as a missing case.
          const caseSnap = viewCaseForCharacter(this.store.state, caseId, characterId);
          responseData.case = caseSnap;
          messageText = "Case loaded.";
          break;
        }
        case "submit_evidence": {
          const caseId = requiredString("case_id", data.case_id);
          const category = requiredString("category", data.category);
          const description = requiredString("description", data.description, 2000);
          const sourceRef = optionalString("source_reference", data.source_reference);
          const evidence = submitEvidence(this.store.state, caseId, category, description, characterId, sourceRef, date, now, this.justiceCatalog);
          responseData.evidence = evidence;
          messageText = "Evidence submitted.";
          break;
        }
        case "issue_judgment": {
          const caseId = requiredString("case_id", data.case_id);
          const outcome = requiredString("outcome", data.outcome) as JudgmentOutcomeId;
          const findings = requiredString("findings", data.findings, 2000);
          const reasoning = requiredString("reasoning", data.reasoning, 5000);
          const remedies = Array.isArray(data.remedies) ? data.remedies.map((r) => {
            const rr = r as Record<string, unknown>;
            const rem: { type: string; description: string; amount_ngn?: number; duration_days?: number } = { type: String(rr.type ?? ""), description: String(rr.description ?? "") };
            if (rr.amount_ngn !== undefined && rr.amount_ngn !== null) rem.amount_ngn = Number(rr.amount_ngn);
            if (rr.duration_days !== undefined && rr.duration_days !== null) rem.duration_days = Number(rr.duration_days);
            return rem;
          }) : [];
          const appealEligible = data.appeal_eligible !== false;
          const judgment = issueJudgment(this.store.state, caseId, characterId, outcome, findings, reasoning, remedies, appealEligible, date, now, this.justiceCatalog);
          responseData.judgment = judgment;
          messageText = "Judgment issued.";
          break;
        }
        case "file_appeal": {
          const caseId = requiredString("case_id", data.case_id);
          const judgmentId = requiredString("judgment_id", data.judgment_id);
          const grounds = requiredString("grounds", data.grounds, 3000);
          const appellateCourtId = requiredString("appellate_court_id", data.appellate_court_id);
          const appeal = fileAppeal(this.store.state, caseId, judgmentId, characterId, grounds, appellateCourtId, date, now, this.justiceCatalog);
          responseData.appeal = appeal;
          messageText = "Appeal filed.";
          break;
        }
        case "decide_appeal": {
          const appealId = requiredString("appeal_id", data.appeal_id);
          const outcome = requiredString("outcome", data.outcome) as AppealOutcomeId;
          const reasoning = requiredString("reasoning", data.reasoning, 3000);
          const appeal = decideAppeal(this.store.state, appealId, outcome, reasoning, characterId, date, now);
          responseData.appeal = appeal;
          messageText = "Appeal decided.";
          break;
        }
        case "pay_fine": {
          const fineId = requiredString("fine_id", data.fine_id);
          const amountNgn = Number(data.amount_ngn);
          const transactionId = requiredString("transaction_id", data.transaction_id);
          const fine = payFine(this.store.state, fineId, amountNgn, transactionId, date, now);
          responseData.fine = fine;
          messageText = "Fine payment recorded.";
          break;
        }
        case "my_fines": {
          responseData.fines = getCharacterFines(this.store.state, characterId);
          messageText = "Your fines loaded.";
          break;
        }
        case "legal_profile": {
          const profile = getLegalProfile(this.store.state, characterId);
          responseData.profile = profile;
          messageText = "Legal profile loaded.";
          break;
        }
        default:
          throw new Error("justice_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "justice.error",
        action,
        code,
        message: justiceErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["search_laws", "active_laws", "list_courts", "view_court", "my_cases", "view_case", "my_fines", "legal_profile"].includes(action)) this.touchPlayer(player);
    await this.answerFamilyReply(context, player, message, requestId, "justice", {
      type: "justice.result", action, ok: true, message: messageText, data: responseData,
    });
  }

  private async policeAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const data = message;
    const action = typeof data.action === "string" ? data.action : "";
    if (!action || action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "police.error", action: "", code: "police_action_invalid",
        message: "Choose a supported police action.",
      }, requestId));
      return;
    }
    const suspendedPoliceCode = POLICE_SUSPENDED_ACTIONS.get(action);
    if (suspendedPoliceCode) {
      this.send(context, appendOptionalRequestId({
        type: "police.error", action, code: suspendedPoliceCode,
        message: policeErrorMessage(suspendedPoliceCode),
      }, requestId));
      return;
    }

    const characterId = player.character.character_id;
    const worldDate = this.store.state.worldClock.world_date;
    const policeService = new PoliceService(this.store.state, this.policeCatalog);
    let messageText = "";
    const responseData: Record<string, unknown> = {};

    try {
      switch (action) {
        case "list_stations": {
          const stations = policeService.listStations();
          responseData.stations = stations.map((s) => policeService.getStationSnapshot(s.unit_id));
          messageText = `Found ${stations.length} police station(s).`;
          break;
        }
        case "view_station": {
          const stationId = typeof data.station_id === "string" ? data.station_id : "";
          if (!stationId) throw new Error("police_station_required");
          const snapshot = policeService.getStationSnapshot(stationId);
          if (!snapshot) throw new Error("police_station_not_found");
          responseData.station = snapshot;
          messageText = `Station: ${snapshot.name}`;
          break;
        }
        case "list_officers": {
          const stationId = typeof data.station_id === "string" ? data.station_id : undefined;
          const officers = policeService.listOfficers(stationId);
          responseData.officers = officers.map((o) => policeService.getOfficerSnapshot(o.officer_id)).filter(Boolean);
          messageText = `Found ${officers.length} officer(s).`;
          break;
        }
        case "apply_recruitment": {
          const stationId = typeof data.station_id === "string" ? data.station_id : "";
          if (!stationId) throw new Error("police_station_required");
          // Education comes from the character's authoritative record only; a client-supplied value is ignored.
          const education = player.character.education_level;
          // Stage 38: the age comes from the character's own date of birth. A character without one is refused, not
          // assumed to be 20 (characters are always created with one; this removes the silent fallback).
          if (!player.character.date_of_birth) throw new Error("police_age_ineligible");
          const birthDate = player.character.date_of_birth;
          let app: ReturnType<PoliceService["applyForRecruitment"]>;
          try {
            app = policeService.applyForRecruitment({ character_id: characterId, station_id: stationId, education, birth_date: birthDate }, worldDate);
          } catch (error) {
            // The service reports these refusals as descriptive messages; map them to the catalogued stable codes.
            if (error instanceof Error && error.message.startsWith("Must be at least ")) throw new Error("police_age_ineligible");
            if (error instanceof Error && error.message.startsWith("Minimum education requirement")) throw new Error("police_education_ineligible");
            throw error;
          }
          responseData.application = app;
          messageText = "Recruitment application submitted.";
          break;
        }
        case "submit_incident": {
          const category = typeof data.category === "string" ? data.category as IncidentCategoryId : "" as IncidentCategoryId;
          const description = typeof data.description === "string" ? data.description : "";
          const summary = typeof data.summary === "string" ? data.summary : "";
          if (!category || !description || !summary) throw new Error("police_incident_fields_required");
          const inc = policeService.submitIncident({
            category,
            description,
            summary,
            reporter_character_id: characterId,
            reported_character_id: typeof data.reported_character_id === "string" ? data.reported_character_id : null,
            location_id: typeof data.location_id === "string" ? data.location_id : null,
            priority: typeof data.priority === "string" ? data.priority as DispatchPriorityId : "normal",
            confidentiality: typeof data.confidentiality === "string" ? data.confidentiality as "public" | "confidential" | "anonymous" : "public",
          }, worldDate);
          responseData.incident = inc;
          messageText = `Incident reported: ${inc.reference_number}`;
          break;
        }
        case "list_incidents": {
          const stationId = typeof data.station_id === "string" ? data.station_id : undefined;
          const status = typeof data.status === "string" ? data.status as import("../police/types.js").IncidentStatusId : undefined;
          const incidents = policeService.listIncidents(stationId, status);
          responseData.incidents = incidents.map((i) => ({
            incident_id: i.incident_id,
            reference_number: i.reference_number,
            category: i.category,
            summary: i.summary,
            priority: i.priority,
            status: i.status,
            reported_at: i.reported_at,
          }));
          messageText = `Found ${incidents.length} incident(s).`;
          break;
        }
        case "view_incident": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          if (!incidentId) throw new Error("police_incident_required");
          const inc = policeService.getIncident(incidentId);
          if (!inc) throw new Error("police_incident_not_found");
          responseData.incident = inc;
          messageText = `Incident ${inc.reference_number}: ${inc.status}`;
          break;
        }
        case "dispatch_unit": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const stationId = typeof data.station_id === "string" ? data.station_id : "";
          const notes = typeof data.notes === "string" ? data.notes : "";
          if (!incidentId || !stationId || !notes) throw new Error("police_dispatch_fields_required");
          const officer = policeService.getOfficerByCharacter(characterId);
          if (!officer) throw new Error("police_not_an_officer");
          const dispatchParams: { incident_id: string; station_id: string; notes: string; priority?: DispatchPriorityId; requesting_officer_id: string } = {
            incident_id: incidentId,
            station_id: stationId,
            notes,
            requesting_officer_id: officer.officer_id,
          };
          if (typeof data.priority === "string") dispatchParams.priority = data.priority as DispatchPriorityId;
          const dispatch = policeService.dispatchUnit(dispatchParams, worldDate);
          responseData.dispatch = dispatch;
          messageText = "Unit dispatched.";
          break;
        }
        case "open_investigation": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const stationId = typeof data.station_id === "string" ? data.station_id : "";
          const summary = typeof data.summary === "string" ? data.summary : "";
          const category = typeof data.category === "string" ? data.category as IncidentCategoryId : "" as IncidentCategoryId;
          if (!incidentId || !stationId || !summary || !category) throw new Error("police_investigation_fields_required");
          const officer = policeService.getOfficerByCharacter(characterId);
          if (!officer) throw new Error("police_not_an_officer");
          const inv = policeService.openInvestigation({
            incident_id: incidentId,
            station_id: stationId,
            lead_officer_id: officer.officer_id,
            category,
            summary,
          }, worldDate);
          responseData.investigation = inv;
          messageText = "Investigation opened.";
          break;
        }
        case "list_investigations": {
          const officer = policeService.getOfficerByCharacter(characterId);
          const officerId = officer?.officer_id;
          const status = typeof data.status === "string" ? data.status as import("../police/types.js").InvestigationStatusId : undefined;
          const investigations = policeService.listInvestigations(officerId, status);
          responseData.investigations = investigations.map((i) => ({
            investigation_id: i.investigation_id,
            incident_id: i.incident_id,
            category: i.category,
            summary: i.summary,
            status: i.status,
            evidence_count: i.evidence_ids.length,
            opened_at: i.opened_at,
          }));
          messageText = `Found ${investigations.length} investigation(s).`;
          break;
        }
        case "submit_evidence": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const investigationId = typeof data.investigation_id === "string" ? data.investigation_id : null;
          const evidenceCategory = typeof data.category === "string" ? data.category : "";
          const description = typeof data.description === "string" ? data.description : "";
          if (!incidentId || !evidenceCategory || !description) throw new Error("police_evidence_fields_required");
          const officer = policeService.getOfficerByCharacter(characterId);
          if (!officer) throw new Error("police_not_an_officer");
          const ev = policeService.submitEvidence({
            incident_id: incidentId,
            investigation_id: investigationId,
            category: evidenceCategory,
            description,
            collected_by_officer_id: officer.officer_id,
          }, worldDate);
          responseData.evidence = ev;
          messageText = "Evidence submitted.";
          break;
        }
        case "request_wanted": {
          const targetCharacterId = typeof data.character_id === "string" ? data.character_id : "";
          const reason = typeof data.reason === "string" ? data.reason : "";
          const legalBasis = typeof data.legal_basis === "string" ? data.legal_basis : "";
          if (!targetCharacterId || !reason || !legalBasis) throw new Error("police_wanted_fields_required");
          const officer = policeService.getOfficerByCharacter(characterId);
          if (!officer) throw new Error("police_not_an_officer");
          const wanted = policeService.requestWantedRecord({
            character_id: targetCharacterId,
            reason,
            legal_basis: legalBasis,
            issuing_officer_id: officer.officer_id,
            incident_id: typeof data.incident_id === "string" ? data.incident_id : null,
            investigation_id: typeof data.investigation_id === "string" ? data.investigation_id : null,
          }, worldDate);
          responseData.wanted = wanted;
          messageText = "Wanted record request submitted.";
          break;
        }
        case "list_wanted": {
          const records = policeService.listWantedRecords();
          const activeWanted = records.filter((w) => w.status === "active").map((w) => ({
            wanted_id: w.wanted_id,
            character_id: w.character_id,
            reason: w.reason,
            legal_basis: w.legal_basis,
            priority: w.priority,
            status: w.status,
            issued_at: w.issued_at,
          }));
          responseData.wanted_records = activeWanted;
          messageText = `Found ${activeWanted.length} active wanted record(s).`;
          break;
        }
        case "execute_arrest": {
          const targetCharacterId = typeof data.character_id === "string" ? data.character_id : "";
          const reason = typeof data.reason === "string" ? data.reason : "";
          const legalBasis = typeof data.legal_basis === "string" ? data.legal_basis : "";
          if (!targetCharacterId || !reason || !legalBasis) throw new Error("police_arrest_fields_required");
          const officer = policeService.getOfficerByCharacter(characterId);
          if (!officer) throw new Error("police_not_an_officer");
          const arrest = policeService.executeArrest({
            character_id: targetCharacterId,
            arresting_officer_id: officer.officer_id,
            reason,
            legal_basis: legalBasis,
            incident_id: typeof data.incident_id === "string" ? data.incident_id : null,
            wanted_id: typeof data.wanted_id === "string" ? data.wanted_id : null,
          }, worldDate);
          responseData.arrest = arrest;
          messageText = "Arrest executed.";
          break;
        }
        case "file_complaint": {
          const accusedOfficerId = typeof data.accused_officer_id === "string" ? data.accused_officer_id : "";
          const category = typeof data.category === "string" ? data.category as MisconductCategoryId : "" as MisconductCategoryId;
          const description = typeof data.description === "string" ? data.description : "";
          if (!accusedOfficerId || !category || !description) throw new Error("police_complaint_fields_required");
          const complaint = policeService.submitMisconductComplaint({
            complainant_character_id: characterId,
            accused_officer_id: accusedOfficerId,
            category,
            description,
          }, worldDate);
          responseData.complaint = complaint;
          messageText = "Misconduct complaint filed.";
          break;
        }
        case "police_profile": {
          const profile = policeService.getPoliceProfile(characterId);
          responseData.profile = profile;
          messageText = profile.is_officer ? `Officer profile: ${profile.rank_label} (${profile.badge_number})` : "No police record.";
          break;
        }
        case "list_arrests": {
          const targetId = typeof data.character_id === "string" ? data.character_id : undefined;
          const arrests = policeService.listArrests(targetId);
          responseData.arrests = arrests.map((a) => ({
            arrest_id: a.arrest_id,
            character_id: a.character_id,
            reason: a.reason,
            legal_basis: a.legal_basis,
            status: a.status,
            arrested_at: a.arrested_at,
          }));
          messageText = `Found ${arrests.length} arrest record(s).`;
          break;
        }
        case "list_complaints": {
          const officerId = typeof data.officer_id === "string" ? data.officer_id : undefined;
          const complaints = policeService.listComplaints(officerId);
          responseData.complaints = complaints.map((c) => ({
            complaint_id: c.complaint_id,
            accused_officer_id: c.accused_officer_id,
            category: c.category,
            status: c.status,
            submitted_at: c.submitted_at,
          }));
          messageText = `Found ${complaints.length} complaint(s).`;
          break;
        }
        default:
          throw new Error("police_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "police.error",
        action,
        code,
        message: policeErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["list_stations", "view_station", "list_officers", "list_incidents", "view_incident", "list_investigations", "list_wanted", "list_arrests", "list_complaints", "police_profile"].includes(action)) this.touchPlayer(player);
    await this.answerFamilyReply(context, player, message, requestId, "police", {
      type: "police.result", action, ok: true, message: messageText, data: responseData,
    });
  }

  private async militaryAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const data = message;
    const action = typeof data.action === "string" ? data.action : "";
    if (!action || action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "military.error", action: "", code: "military_action_invalid",
        message: "Choose a supported military action.",
      }, requestId));
      return;
    }

    const suspendedMilitaryCode = MILITARY_SUSPENDED_ACTIONS.get(action);
    if (suspendedMilitaryCode) {
      this.send(context, appendOptionalRequestId({
        type: "military.error", action, code: suspendedMilitaryCode,
        message: militaryErrorMessage(suspendedMilitaryCode),
      }, requestId));
      return;
    }
    const characterId = player.character.character_id;
    const worldDate = this.store.state.worldClock.world_date;
    const militaryService = new MilitaryService(this.store.state, this.militaryCatalog);
    let messageText = "";
    const responseData: Record<string, unknown> = {};

    try {
      switch (action) {
        case "list_branches": {
          const branches = this.militaryCatalog.get().service_branches;
          responseData.branches = branches;
          messageText = `Found ${branches.length} service branch(es).`;
          break;
        }
        case "list_organizations": {
          const branch = typeof data.branch === "string" ? data.branch as ServiceBranchId : undefined;
          const orgs = militaryService.listOrganizations(branch);
          responseData.organizations = orgs.map((o) => ({ org_id: o.org_id, name: o.name, branch: o.branch, org_type: o.org_type, status: o.status }));
          messageText = `Found ${orgs.length} organization(s).`;
          break;
        }
        case "view_organization": {
          const orgId = typeof data.org_id === "string" ? data.org_id : "";
          if (!orgId) throw new Error("military_org_not_found");
          const org = militaryService.getOrganization(orgId);
          if (!org) throw new Error("military_org_not_found");
          responseData.organization = org;
          messageText = `Organization: ${org.name}`;
          break;
        }
        case "list_bases": {
          const branch = typeof data.branch === "string" ? data.branch as ServiceBranchId : undefined;
          const bases = militaryService.listBases(branch);
          responseData.bases = bases.map((b) => militaryService.getBaseSnapshot(b.base_id)).filter(Boolean);
          messageText = `Found ${bases.length} base(s).`;
          break;
        }
        case "view_base": {
          const baseId = typeof data.base_id === "string" ? data.base_id : "";
          if (!baseId) throw new Error("military_base_not_found");
          const snapshot = militaryService.getBaseSnapshot(baseId);
          if (!snapshot) throw new Error("military_base_not_found");
          responseData.base = snapshot;
          messageText = `Base: ${snapshot.name}`;
          break;
        }
        case "list_units": {
          const branch = typeof data.branch === "string" ? data.branch as ServiceBranchId : undefined;
          const units = militaryService.listUnits(branch);
          responseData.units = units.map((u) => militaryService.getUnitSnapshot(u.unit_id)).filter(Boolean);
          messageText = `Found ${units.length} unit(s).`;
          break;
        }
        case "apply_for_service": {
          const branch = typeof data.branch === "string" ? data.branch as ServiceBranchId : "" as ServiceBranchId;
          if (!branch) throw new Error("military_branch_invalid");
          // Education comes from the character's authoritative record only; a client-supplied value is ignored.
          const education = player.character.education_level;
          // Stage 38: the age comes from the character's own date of birth. A character without one is refused.
          if (!player.character.date_of_birth) throw new Error("military_age_ineligible");
          const birthDate = player.character.date_of_birth;
          const app = militaryService.applyForService({ character_id: characterId, branch, education, birth_date: birthDate }, worldDate);
          responseData.application = app;
          messageText = "Military application submitted.";
          break;
        }
        case "enlist": {
          const applicationId = typeof data.application_id === "string" ? data.application_id : "";
          if (!applicationId) throw new Error("military_application_not_found");
          const svc = militaryService.enrollServiceMember(applicationId, worldDate);
          responseData.service = militaryService.getServiceSnapshot(svc.service_id);
          messageText = `Enlisted: ${svc.service_number}`;
          break;
        }
        case "military_profile": {
          const profile = militaryService.getMilitaryProfile(characterId);
          responseData.profile = profile;
          messageText = profile.is_service_member ? `Service: ${profile.branch} — ${profile.rank_label} (${profile.service_number})` : "No military record.";
          break;
        }
        case "list_training": {
          const branch = typeof data.branch === "string" ? data.branch as ServiceBranchId : undefined;
          const courses = branch ? this.militaryCatalog.getTrainingCoursesForBranch(branch) : this.militaryCatalog.get().training_courses;
          responseData.courses = courses.map((c) => ({ id: c.id, label: c.label, duration_days: c.duration_days, branch: c.branch }));
          messageText = `Found ${courses.length} training course(s).`;
          break;
        }
        case "enroll_training": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : "";
          const courseId = typeof data.course_id === "string" ? data.course_id : "";
          if (!serviceId || !courseId) throw new Error("military_training_course_not_found");
          const t = militaryService.enrollInTraining({ service_id: serviceId, course_id: courseId }, worldDate);
          responseData.training = t;
          messageText = "Enrolled in training.";
          break;
        }
        case "complete_training": {
          const trainingId = typeof data.training_record_id === "string" ? data.training_record_id : "";
          const result = typeof data.result === "string" && data.result === "fail" ? "fail" as const : "pass" as const;
          if (!trainingId) throw new Error("military_training_not_found");
          const t = militaryService.completeTraining(trainingId, result, worldDate);
          responseData.training = t;
          messageText = `Training ${result === "pass" ? "completed" : "failed"}.`;
          break;
        }
        case "promote": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : "";
          const newRank = typeof data.rank === "string" ? data.rank : "";
          const reason = typeof data.reason === "string" ? data.reason : "Promotion";
          if (!serviceId || !newRank) throw new Error("military_rank_not_found");
          const svc = militaryService.promoteServiceMember(serviceId, newRank, characterId, reason, worldDate);
          responseData.service = militaryService.getServiceSnapshot(svc.service_id);
          messageText = `Promoted to ${newRank}.`;
          break;
        }
        case "rank_history": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : "";
          if (!serviceId) throw new Error("military_service_not_found");
          const history = militaryService.getRankHistory(serviceId);
          responseData.history = history;
          messageText = `Found ${history.length} rank record(s).`;
          break;
        }
        case "create_appointment": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : "";
          const orgId = typeof data.org_id === "string" ? data.org_id : "";
          const role = typeof data.role === "string" ? data.role : "";
          if (!serviceId || !orgId || !role) throw new Error("military_org_not_found");
          const apt = militaryService.createCommandAppointment({ service_id: serviceId, org_id: orgId, role, appointing_authority: characterId }, worldDate);
          responseData.appointment = apt;
          messageText = "Command appointment created.";
          break;
        }
        case "assign": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : "";
          const assignmentType = typeof data.assignment_type === "string" ? data.assignment_type as AssignmentTypeId : "" as AssignmentTypeId;
          if (!serviceId || !assignmentType) throw new Error("military_assignment_type_invalid");
          const assignParams: { service_id: string; assignment_type: AssignmentTypeId; unit_id?: string | null; base_id?: string | null; assigned_by: string; description?: string } = {
            service_id: serviceId,
            assignment_type: assignmentType,
            assigned_by: characterId,
          };
          if (typeof data.unit_id === "string") assignParams.unit_id = data.unit_id;
          if (typeof data.base_id === "string") assignParams.base_id = data.base_id;
          if (typeof data.description === "string") assignParams.description = data.description;
          const a = militaryService.assignServiceMember(assignParams, worldDate);
          responseData.assignment = a;
          messageText = "Assignment created.";
          break;
        }
        case "request_leave": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : "";
          const leaveType = typeof data.leave_type === "string" ? data.leave_type : "annual";
          const startDate = typeof data.start_date === "string" ? data.start_date : "";
          const endDate = typeof data.end_date === "string" ? data.end_date : "";
          const reason = typeof data.reason === "string" ? data.reason : "";
          if (!serviceId || !startDate || !endDate) throw new Error("military_leave_not_found");
          // Stage 37: leave is requested only on the caller's own service record. Another character's record is
          // reported as not found, the same as a missing one.
          const ownRecord = militaryService.getServiceRecord(serviceId);
          if (!ownRecord || ownRecord.character_id !== player.character.character_id) throw new Error("military_service_not_found");
          const l = militaryService.requestLeave({
            service_id: serviceId, leave_type: leaveType,
            start_date: startDate, end_date: endDate, reason,
            start_world_date: worldDate, end_world_date: worldDate,
          }, worldDate);
          responseData.leave = l;
          messageText = "Leave requested.";
          break;
        }
        case "create_asset": {
          const name = typeof data.name === "string" ? data.name : "";
          const category = typeof data.category === "string" ? data.category as EquipmentCategoryId : "" as EquipmentCategoryId;
          if (!name || !category) throw new Error("military_equipment_category_invalid");
          const asset = militaryService.createAsset({
            name, category,
            org_id: typeof data.org_id === "string" ? data.org_id : null,
            base_id: typeof data.base_id === "string" ? data.base_id : null,
          }, worldDate);
          responseData.asset = asset;
          messageText = `Asset created: ${asset.name}`;
          break;
        }
        case "list_assets": {
          const baseId = typeof data.base_id === "string" ? data.base_id : undefined;
          const assets = militaryService.listAssets(baseId);
          responseData.assets = assets.map((a) => ({ asset_id: a.asset_id, name: a.name, category: a.category, status: a.status, base_id: a.base_id }));
          messageText = `Found ${assets.length} asset(s).`;
          break;
        }
        case "create_security_event": {
          const category = typeof data.category === "string" ? data.category as NationalSecurityEventCategoryId : "" as NationalSecurityEventCategoryId;
          const title = typeof data.title === "string" ? data.title : "";
          const description = typeof data.description === "string" ? data.description : "";
          if (!category || !title || !description) throw new Error("military_event_category_invalid");
          const ev = militaryService.createNationalSecurityEvent({
            category, title, description,
            authorizing_authority: characterId,
            state_id: typeof data.state_id === "string" ? data.state_id : null,
            public_info: typeof data.public_info === "string" ? data.public_info : null,
          }, worldDate);
          responseData.event = ev;
          messageText = `Security event: ${ev.category}`;
          break;
        }
        case "list_security_events": {
          const status = typeof data.status === "string" ? data.status as import("../military/types.js").NationalSecurityEventStatusId : undefined;
          const events = militaryService.listNationalSecurityEvents(status);
          responseData.events = events.map((e) => ({ event_id: e.event_id, category: e.category, title: e.title, status: e.status, started_at: e.started_at }));
          messageText = `Found ${events.length} security event(s).`;
          break;
        }
        case "file_disciplinary_case": {
          const accusedServiceId = typeof data.accused_service_id === "string" ? data.accused_service_id : "";
          const conduct = typeof data.alleged_conduct === "string" ? data.alleged_conduct : "";
          if (!accusedServiceId || !conduct) throw new Error("military_disciplinary_not_found");
          const c = militaryService.submitDisciplinaryCase({
            accused_service_id: accusedServiceId,
            alleged_conduct: conduct,
            reviewing_authority: characterId,
          }, worldDate);
          responseData.case = c;
          messageText = "Disciplinary case filed.";
          break;
        }
        case "list_disciplinary_cases": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : undefined;
          const cases = militaryService.listDisciplinaryCases(serviceId);
          responseData.cases = cases.map((c) => ({ case_id: c.case_id, accused_service_id: c.accused_service_id, status: c.status, outcome: c.outcome, submitted_at: c.submitted_at }));
          messageText = `Found ${cases.length} case(s).`;
          break;
        }
        case "service_profile": {
          const serviceId = typeof data.service_id === "string" ? data.service_id : "";
          if (!serviceId) throw new Error("military_service_not_found");
          responseData.service = militaryService.getServiceSnapshot(serviceId);
          const serviceSnap = responseData.service as { service_number?: string } | null;
          messageText = serviceSnap ? `Service: ${serviceSnap.service_number ?? "unknown"}` : "Service record not found.";
          break;
        }
        default:
          throw new Error("military_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "military.error",
        action,
        code,
        message: militaryErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["list_branches", "list_organizations", "view_organization", "list_bases", "view_base", "list_units", "list_training", "list_assets", "list_security_events", "list_disciplinary_cases", "military_profile", "service_profile", "rank_history"].includes(action)) this.touchPlayer(player);
    await this.answerFamilyReply(context, player, message, requestId, "military", {
      type: "military.result", action, ok: true, message: messageText, data: responseData,
    });
  }

  private async crimeAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const data = message;
    const action = typeof data.action === "string" ? data.action : "";
    if (!action || action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "crime.error", action: "", code: "crime_action_invalid",
        message: "Choose a supported crime action.",
      }, requestId));
      return;
    }
    const suspendedCrimeCode = CRIME_SUSPENDED_ACTIONS.get(action);
    if (suspendedCrimeCode) {
      this.send(context, appendOptionalRequestId({
        type: "crime.error", action, code: suspendedCrimeCode,
        message: crimeErrorMessage(suspendedCrimeCode),
      }, requestId));
      return;
    }

    const characterId = player.character.character_id;
    const worldDate = this.store.state.worldClock.world_date;
    const crimeService = new CrimeService(this.store.state, this.crimeCatalog);
    let messageText = "";
    const responseData: Record<string, unknown> = {};

    try {
      switch (action) {
        case "list_crime_definitions": {
          const category = typeof data.category === "string" ? data.category as CrimeCategoryId : undefined;
          const defs = category ? this.crimeCatalog.getDefinitionsByCategory(category) : this.crimeCatalog.get().crime_definitions;
          responseData.definitions = defs.map((d) => ({ id: d.id, category: d.category, label: d.label, severity: d.severity, cooldown_hours: d.cooldown_hours }));
          messageText = `Found ${defs.length} crime definition(s).`;
          break;
        }
        case "list_categories": {
          const categories = this.crimeCatalog.get().crime_categories;
          responseData.categories = categories;
          messageText = `Found ${categories.length} crime categor(y/ies).`;
          break;
        }
        case "commit_crime": {
          const crimeId = typeof data.crime_definition_id === "string" ? data.crime_definition_id : "";
          if (!crimeId) throw new Error("crime_definition_not_found");
          const definition = this.crimeCatalog.getCrimeDefinition(crimeId);
          if (!definition) throw new Error("crime_definition_not_found");
          // Stage 38: each named target is checked against the saved world. Only the checked identifiers are used.
          const targets = validateCrimeTargets(this.store.state, definition, characterId, {
            victim_character_id: parseTargetId(data.victim_character_id),
            victim_property_id: parseTargetId(data.victim_property_id),
            victim_business_id: parseTargetId(data.victim_business_id),
          });
          const perpetratorAge = player.character.age;
          const result = crimeService.resolveCrimeAction({
            crime_definition_id: crimeId,
            perpetrator_character_id: characterId,
            victim_character_id: targets.victim_character_id,
            victim_property_id: targets.victim_property_id,
            victim_business_id: targets.victim_business_id,
            location_id: typeof data.location_id === "string" ? data.location_id : null,
            state_id: typeof data.state_id === "string" ? data.state_id : null,
            perpetrator_age: perpetratorAge,
          }, worldDate);
          responseData.incident = result.incident;
          responseData.detected = result.detected;
          responseData.value_gained = result.value_gained;
          responseData.outcome = result.outcome;
          messageText = result.detected ? "Crime detected! An incident has been recorded." : "Crime completed.";
          break;
        }
        case "report_crime": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const description = typeof data.description === "string" ? data.description : "Reported a crime.";
          if (!incidentId) throw new Error("crime_incident_not_found");
          const report = crimeService.reportCrime(incidentId, characterId, description, worldDate);
          responseData.report = report;
          messageText = "Crime reported successfully.";
          break;
        }
        case "view_incident": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          if (!incidentId) throw new Error("crime_incident_not_found");
          const inc = crimeService.getIncident(incidentId);
          if (!inc) throw new Error("crime_incident_not_found");
          responseData.incident = inc;
          messageText = `Incident: ${inc.summary} (${inc.status})`;
          break;
        }
        case "list_incidents": {
          const perpId = typeof data.perpetrator_id === "string" ? data.perpetrator_id : undefined;
          const victimId = typeof data.victim_id === "string" ? data.victim_id : undefined;
          const status = typeof data.status === "string" ? data.status as CrimeIncidentStatusId : undefined;
          const incidents = crimeService.listIncidents(perpId, victimId, status);
          responseData.incidents = incidents.map((i) => ({ incident_id: i.incident_id, category: i.category, severity: i.severity, status: i.status, summary: i.summary, detected: i.detected, created_at: i.created_at }));
          messageText = `Found ${incidents.length} incident(s).`;
          break;
        }
        case "transition_incident": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const newStatus = typeof data.new_status === "string" ? data.new_status as CrimeIncidentStatusId : "" as CrimeIncidentStatusId;
          const reason = typeof data.reason === "string" ? data.reason : null;
          if (!incidentId || !newStatus) throw new Error("crime_incident_not_found");
          const inc = crimeService.transitionIncident(incidentId, newStatus, reason, worldDate);
          responseData.incident = inc;
          messageText = `Incident status: ${inc.status}`;
          break;
        }
        case "add_evidence": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const evidenceType = typeof data.evidence_type === "string" ? data.evidence_type : "";
          const sourceDesc = typeof data.source_description === "string" ? data.source_description : "";
          if (!incidentId || !evidenceType || !sourceDesc) throw new Error("crime_incident_not_found");
          const ev = crimeService.addEvidence(incidentId, evidenceType, sourceDesc, typeof data.source_reference === "string" ? data.source_reference : null, characterId, worldDate);
          responseData.evidence = ev;
          messageText = "Evidence added.";
          break;
        }
        case "link_to_police": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const policeId = typeof data.police_incident_id === "string" ? data.police_incident_id : "";
          if (!incidentId || !policeId) throw new Error("crime_incident_not_found");
          crimeService.linkToPoliceIncident(incidentId, policeId);
          messageText = "Linked to police incident.";
          break;
        }
        case "link_to_justice": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const caseId = typeof data.case_id === "string" ? data.case_id : "";
          if (!incidentId || !caseId) throw new Error("crime_incident_not_found");
          crimeService.linkToJusticeCase(incidentId, caseId);
          messageText = "Linked to justice case.";
          break;
        }
        case "criminal_profile": {
          const profile = crimeService.getCriminalProfile(characterId);
          responseData.profile = profile;
          messageText = profile.has_criminal_record ? `Criminal record: ${profile.convictions_count} conviction(s), notoriety ${(profile.notoriety_score * 100).toFixed(0)}%` : "No criminal record.";
          break;
        }
        case "create_criminal_record": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const targetId = typeof data.character_id === "string" ? data.character_id : characterId;
          const category = typeof data.category === "string" ? data.category as CrimeCategoryId : "" as CrimeCategoryId;
          const severity = typeof data.severity === "string" ? data.severity as import("../crime/types.js").CrimeSeverityId : "minor" as import("../crime/types.js").CrimeSeverityId;
          const conviction = typeof data.conviction === "boolean" ? data.conviction : false;
          if (!incidentId || !category) throw new Error("crime_definition_not_found");
          const record = crimeService.createCriminalRecord({
            character_id: targetId, incident_id: incidentId, category, severity, conviction,
            outcome: conviction ? "convicted" : null,
            fine_amount: typeof data.fine_amount === "number" ? data.fine_amount : 0,
          }, worldDate);
          responseData.record = record;
          messageText = `Criminal record ${conviction ? "conviction" : "created"}.`;
          break;
        }
        case "list_criminal_records": {
          const targetId = typeof data.character_id === "string" ? data.character_id : characterId;
          const records = crimeService.getCriminalRecords(targetId);
          responseData.records = records.map((r) => ({ record_id: r.record_id, category: r.category, severity: r.severity, conviction: r.conviction, created_at: r.created_at }));
          messageText = `Found ${records.length} record(s).`;
          break;
        }
        case "create_restitution": {
          const incidentId = typeof data.incident_id === "string" ? data.incident_id : "";
          const creditorId = typeof data.creditor_character_id === "string" ? data.creditor_character_id : "";
          const debtorId = typeof data.debtor_character_id === "string" ? data.debtor_character_id : characterId;
          const amount = typeof data.amount === "number" ? data.amount : 0;
          if (!incidentId || !creditorId || amount <= 0) throw new Error("crime_incident_not_found");
          const rest = crimeService.createRestitution(incidentId, creditorId, debtorId, amount, worldDate);
          responseData.restitution = rest;
          messageText = `Restitution of ${amount} created.`;
          break;
        }
        case "start_rehabilitation": {
          const activityType = typeof data.activity_type === "string" ? data.activity_type : "community_service";
          const durationDays = typeof data.duration_days === "number" ? data.duration_days : 30;
          const rehab = crimeService.startRehabilitation({ character_id: characterId, activity_type: activityType, duration_days: durationDays }, worldDate);
          responseData.rehabilitation = rehab;
          messageText = `Rehabilitation started: ${activityType} for ${durationDays} days.`;
          break;
        }
        case "notoriety": {
          const targetId = typeof data.character_id === "string" ? data.character_id : characterId;
          const notoriety = crimeService.getNotoriety(targetId);
          responseData.notoriety = notoriety;
          messageText = notoriety ? `Notoriety: ${(notoriety.notoriety_score * 100).toFixed(0)}%` : "No notoriety record.";
          break;
        }
        default:
          throw new Error("crime_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "crime.error", action, code, message: crimeErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["list_crime_definitions", "list_categories", "view_incident", "list_incidents", "criminal_profile", "list_criminal_records", "notoriety"].includes(action)) this.touchPlayer(player);
    await this.answerFamilyReply(context, player, message, requestId, "crime", {
      type: "crime.result", action, ok: true, message: messageText, data: responseData,
    });
  }

  private async cultureAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const data = message;
    const action = typeof data.action === "string" ? data.action : "";
    if (!action || action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "culture.error", action: "", code: "culture_action_invalid",
        message: "Choose a supported culture action.",
      }, requestId));
      return;
    }

    const characterId = player.character.character_id;
    const worldDate = this.store.state.worldClock.world_date;
    const cultureService = new CultureService(this.store.state, this.cultureCatalog);
    let messageText = "";
    const responseData: Record<string, unknown> = {};

    try {
      switch (action) {
        case "list_community_types": {
          const types = this.cultureCatalog.get().community_types;
          responseData.types = types;
          messageText = `Found ${types.length} community types.`;
          break;
        }
        case "list_institution_categories": {
          const categories = this.cultureCatalog.get().institution_categories;
          responseData.categories = categories;
          messageText = `Found ${categories.length} institution categories.`;
          break;
        }
        case "list_languages": {
          const languages = this.cultureCatalog.get().languages;
          responseData.languages = languages;
          messageText = `Found ${languages.length} languages.`;
          break;
        }
        case "list_festivals": {
          const festivals = this.cultureCatalog.get().festival_definitions;
          responseData.festivals = festivals;
          messageText = `Found ${festivals.length} festival definitions.`;
          break;
        }
        case "list_religious_categories": {
          const categories = this.cultureCatalog.get().religious_categories;
          responseData.categories = categories;
          messageText = `Found ${categories.length} religious categories.`;
          break;
        }
        case "create_community": {
          const name = typeof data.name === "string" ? data.name : "";
          const description = typeof data.description === "string" ? data.description : "";
          const communityType = typeof data.community_type === "string" ? data.community_type as CommunityTypeId : "" as CommunityTypeId;
          if (!name || !communityType) throw new Error("culture_community_type_invalid");
          const community = cultureService.createCommunity({
            name, description, community_type: communityType,
            state_id: typeof data.state_id === "string" ? data.state_id : null,
            lga_id: typeof data.lga_id === "string" ? data.lga_id : null,
            ward_id: typeof data.ward_id === "string" ? data.ward_id : null,
            settlement_id: typeof data.settlement_id === "string" ? data.settlement_id : null,
            cultural_associations: Array.isArray(data.cultural_associations) ? data.cultural_associations as string[] : [],
            languages: Array.isArray(data.languages) ? data.languages as string[] : [],
            creator_character_id: characterId,
            creator_age: player.character.age,
          }, worldDate);
          responseData.community = community;
          messageText = `Community "${name}" created.`;
          break;
        }
        case "list_communities": {
          const stateId = typeof data.state_id === "string" ? data.state_id : undefined;
          const lgaId = typeof data.lga_id === "string" ? data.lga_id : undefined;
          const type = typeof data.community_type === "string" ? data.community_type as CommunityTypeId : undefined;
          const communities = cultureService.listCommunities(stateId, lgaId, type);
          responseData.communities = communities.map((c) => ({ community_id: c.community_id, name: c.name, community_type: c.community_type, state_id: c.state_id, lga_id: c.lga_id, status: c.status }));
          messageText = `Found ${communities.length} communities.`;
          break;
        }
        case "view_community": {
          const communityId = typeof data.community_id === "string" ? data.community_id : "";
          if (!communityId) throw new Error("culture_community_not_found");
          const snapshot = cultureService.getCommunitySnapshot(communityId);
          if (!snapshot) throw new Error("culture_community_not_found");
          responseData.community = snapshot;
          messageText = `Community: ${snapshot.name} (${snapshot.member_count} members)`;
          break;
        }
        case "join_community": {
          const communityId = typeof data.community_id === "string" ? data.community_id : "";
          if (!communityId) throw new Error("culture_community_not_found");
          const membership = cultureService.joinCommunity(communityId, characterId, player.character.age, worldDate);
          responseData.membership = membership;
          messageText = "Joined community.";
          break;
        }
        case "leave_community": {
          const communityId = typeof data.community_id === "string" ? data.community_id : "";
          if (!communityId) throw new Error("culture_community_not_found");
          cultureService.leaveCommunity(communityId, characterId, worldDate);
          messageText = "Left community.";
          break;
        }
        case "my_memberships": {
          const memberships = cultureService.getCharacterMemberships(characterId);
          responseData.memberships = memberships.map((m) => ({ membership_id: m.membership_id, community_id: m.community_id, status: m.status, roles: m.roles, joined_at: m.joined_at }));
          messageText = `Found ${memberships.length} memberships.`;
          break;
        }
        case "create_institution": {
          const name = typeof data.name === "string" ? data.name : "";
          const category = typeof data.category === "string" ? data.category as InstitutionCategoryId : "" as InstitutionCategoryId;
          const generalCategory = typeof data.general_category === "string" ? data.general_category as import("../culture/types.js").InstitutionGeneralCategory : "community" as import("../culture/types.js").InstitutionGeneralCategory;
          const description = typeof data.description === "string" ? data.description : "";
          if (!name || !category) throw new Error("culture_institution_category_invalid");
          const institution = cultureService.createInstitution({
            name, category, general_category: generalCategory,
            religious_category: typeof data.religious_category === "string" ? data.religious_category as ReligiousCategoryId : null,
            description,
            community_id: typeof data.community_id === "string" ? data.community_id : null,
            state_id: typeof data.state_id === "string" ? data.state_id : null,
            lga_id: typeof data.lga_id === "string" ? data.lga_id : null,
            settlement_id: typeof data.settlement_id === "string" ? data.settlement_id : null,
            creator_character_id: characterId,
            creator_age: player.character.age,
          }, worldDate);
          responseData.institution = institution;
          messageText = `Institution "${name}" created.`;
          break;
        }
        case "list_institutions": {
          const communityId = typeof data.community_id === "string" ? data.community_id : undefined;
          const stateId = typeof data.state_id === "string" ? data.state_id : undefined;
          const institutions = cultureService.listInstitutions(communityId, stateId);
          responseData.institutions = institutions.map((i) => ({ institution_id: i.institution_id, name: i.name, category: i.category, general_category: i.general_category, community_id: i.community_id, state_id: i.state_id, member_count: i.member_count, status: i.status }));
          messageText = `Found ${institutions.length} institutions.`;
          break;
        }
        case "join_institution": {
          const institutionId = typeof data.institution_id === "string" ? data.institution_id : "";
          if (!institutionId) throw new Error("culture_institution_not_found");
          const membership = cultureService.joinInstitution(institutionId, characterId, player.character.age, worldDate);
          responseData.membership = membership;
          messageText = "Joined institution.";
          break;
        }
        case "leave_institution": {
          const institutionId = typeof data.institution_id === "string" ? data.institution_id : "";
          if (!institutionId) throw new Error("culture_institution_not_found");
          cultureService.leaveInstitution(institutionId, characterId, worldDate);
          messageText = "Left institution.";
          break;
        }
        case "update_cultural_profile": {
          const languagesSpoken = Array.isArray(data.languages_spoken) ? data.languages_spoken as string[] : undefined;
          const preferredLanguage = typeof data.preferred_language === "string" ? data.preferred_language : (data.preferred_language === null ? null : undefined);
          const religiousAffiliation = typeof data.religious_affiliation === "string" ? data.religious_affiliation as ReligiousCategoryId : (data.religious_affiliation === null ? null : undefined);
          const culturalInterests = Array.isArray(data.cultural_interests) ? data.cultural_interests as string[] : undefined;
          const profile = cultureService.updateCulturalProfile({
            character_id: characterId,
            ...(languagesSpoken !== undefined ? { languages_spoken: languagesSpoken } : {}),
            ...(preferredLanguage !== undefined ? { preferred_language: preferredLanguage } : {}),
            ...(religiousAffiliation !== undefined ? { religious_affiliation: religiousAffiliation } : {}),
            ...(culturalInterests !== undefined ? { cultural_interests: culturalInterests } : {}),
          }, worldDate);
          responseData.profile = profile;
          messageText = "Cultural profile updated.";
          break;
        }
        case "view_cultural_profile": {
          const profile = cultureService.getCulturalProfileSnapshot(characterId);
          responseData.profile = profile;
          messageText = `Cultural profile: ${profile.community_memberships_count} communities, ${profile.institution_memberships_count} institutions`;
          break;
        }
        case "create_event": {
          const name = typeof data.name === "string" ? data.name : "";
          const description = typeof data.description === "string" ? data.description : "";
          if (!name) throw new Error("culture_name_invalid");
          const event = cultureService.createEvent({
            community_id: typeof data.community_id === "string" ? data.community_id : null,
            institution_id: typeof data.institution_id === "string" ? data.institution_id : null,
            festival_definition_id: typeof data.festival_definition_id === "string" ? data.festival_definition_id : null,
            name, description,
            category: typeof data.category === "string" ? data.category : "cultural",
            organizer_character_id: characterId,
            state_id: typeof data.state_id === "string" ? data.state_id : null,
            lga_id: typeof data.lga_id === "string" ? data.lga_id : null,
            settlement_id: typeof data.settlement_id === "string" ? data.settlement_id : null,
            start_world_date: worldDate,
            capacity: typeof data.capacity === "number" ? data.capacity : null,
          }, worldDate);
          responseData.event = event;
          messageText = `Event "${name}" scheduled.`;
          break;
        }
        case "attend_event": {
          const eventId = typeof data.event_id === "string" ? data.event_id : "";
          if (!eventId) throw new Error("culture_event_not_found");
          cultureService.attendEvent(eventId, characterId, worldDate);
          messageText = "Event attendance recorded.";
          break;
        }
        case "list_events": {
          const communityId = typeof data.community_id === "string" ? data.community_id : undefined;
          const institutionId = typeof data.institution_id === "string" ? data.institution_id : undefined;
          const events = cultureService.listEvents(communityId, institutionId);
          responseData.events = events.map((e) => ({ event_id: e.event_id, name: e.name, category: e.category, status: e.status, attendee_count: e.attendee_character_ids.length, start_world_date: e.start_world_date }));
          messageText = `Found ${events.length} events.`;
          break;
        }
        case "create_project": {
          const communityId = typeof data.community_id === "string" ? data.community_id : "";
          const name = typeof data.name === "string" ? data.name : "";
          const description = typeof data.description === "string" ? data.description : "";
          const category = typeof data.category === "string" ? data.category as ProjectCategoryId : "community" as ProjectCategoryId;
          const budget = typeof data.budget === "number" ? data.budget : 0;
          if (!communityId || !name) throw new Error("culture_community_not_found");
          const project = cultureService.createProject({
            community_id: communityId, name, description, category,
            organizing_institution_id: typeof data.organizing_institution_id === "string" ? data.organizing_institution_id : null,
            leader_character_id: characterId, budget,
          }, worldDate);
          responseData.project = project;
          messageText = `Project "${name}" proposed.`;
          break;
        }
        case "contribute_to_project": {
          const projectId = typeof data.project_id === "string" ? data.project_id : "";
          const contributionType = typeof data.contribution_type === "string" ? data.contribution_type as "financial" | "labor" | "materials" | "expertise" : "labor";
          const amount = typeof data.amount === "number" ? data.amount : 0;
          const description = typeof data.description === "string" ? data.description : "";
          if (!projectId) throw new Error("culture_project_not_found");
          const contribution = cultureService.contributeToProject(projectId, characterId, contributionType, amount, description, worldDate);
          responseData.contribution = contribution;
          messageText = "Contribution recorded.";
          break;
        }
        case "list_projects": {
          const communityId = typeof data.community_id === "string" ? data.community_id : undefined;
          const status = typeof data.status === "string" ? data.status as ProjectStatusId : undefined;
          const projects = cultureService.listProjects(communityId, status);
          responseData.projects = projects.map((p) => ({ project_id: p.project_id, name: p.name, category: p.category, status: p.status, budget: p.budget, funds_raised: p.funds_raised, volunteer_count: p.volunteer_character_ids.length }));
          messageText = `Found ${projects.length} projects.`;
          break;
        }
        case "publish_announcement": {
          const title = typeof data.title === "string" ? data.title : "";
          const body = typeof data.body === "string" ? data.body : "";
          if (!title) throw new Error("culture_name_invalid");
          const announcement = cultureService.publishAnnouncement({
            community_id: typeof data.community_id === "string" ? data.community_id : null,
            institution_id: typeof data.institution_id === "string" ? data.institution_id : null,
            author_character_id: characterId,
            title, body,
            scope: typeof data.scope === "string" ? data.scope as "community" | "institution" | "regional" : "community",
          }, worldDate);
          responseData.announcement = announcement;
          messageText = `Announcement "${title}" published.`;
          break;
        }
        case "list_announcements": {
          const communityId = typeof data.community_id === "string" ? data.community_id : undefined;
          const institutionId = typeof data.institution_id === "string" ? data.institution_id : undefined;
          const announcements = cultureService.listAnnouncements(communityId, institutionId);
          responseData.announcements = announcements.map((a) => ({ announcement_id: a.announcement_id, title: a.title, scope: a.scope, published_at: a.published_at, author_character_id: a.author_character_id }));
          messageText = `Found ${announcements.length} announcements.`;
          break;
        }
        default:
          throw new Error("culture_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "culture.error", action, code, message: cultureErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["list_community_types", "list_institution_categories", "list_languages", "list_festivals", "list_religious_categories", "list_communities", "view_community", "my_memberships", "list_institutions", "view_cultural_profile", "list_events", "list_projects", "list_announcements"].includes(action)) this.touchPlayer(player);
    this.send(context, appendOptionalRequestId({
      type: "culture.result", action, ok: true, message: messageText, data: responseData,
    }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  private async entertainmentAction(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const data = message;
    const action = typeof data.action === "string" ? data.action : "";
    if (!action || action.length > 48) {
      this.send(context, appendOptionalRequestId({
        type: "entertainment.error", action: "", code: "entertainment_action_invalid",
        message: "Choose a supported entertainment action.",
      }, requestId));
      return;
    }

    const characterId = player.character.character_id;
    const worldDate = this.store.state.worldClock.world_date;
    const service = new EntertainmentService(this.store.state, this.entertainmentCatalog);
    let messageText = "";
    const responseData: Record<string, unknown> = {};

    try {
      switch (action) {
        case "list_professions": {
          const category = typeof data.category === "string" ? data.category : undefined;
          const professions = category ? this.entertainmentCatalog.getProfessionsByCategory(category) : this.entertainmentCatalog.get().professions;
          responseData.professions = professions.map((p) => ({ id: p.id, category: p.category, label: p.label }));
          messageText = `Found ${professions.length} profession(s).`;
          break;
        }
        case "list_profession_categories": {
          const categories = this.entertainmentCatalog.get().profession_categories;
          responseData.categories = categories;
          messageText = `Found ${categories.length} profession categories.`;
          break;
        }
        case "list_skills": {
          const skills = this.entertainmentCatalog.get().skills;
          responseData.skills = skills;
          messageText = `Found ${skills.length} skills.`;
          break;
        }
        case "list_genres": {
          const genres = this.entertainmentCatalog.get().genres;
          responseData.genres = genres;
          messageText = `Found ${genres.length} genres.`;
          break;
        }
        case "list_content_types": {
          const contentTypes = this.entertainmentCatalog.get().content_types;
          responseData.content_types = contentTypes;
          messageText = `Found ${contentTypes.length} content types.`;
          break;
        }
        case "list_event_types": {
          const eventTypes = this.entertainmentCatalog.get().event_types;
          responseData.event_types = eventTypes;
          messageText = `Found ${eventTypes.length} event types.`;
          break;
        }
        case "create_profile": {
          const stageName = typeof data.stage_name === "string" ? data.stage_name : "";
          if (!stageName) throw new Error("entertainment_stage_name_invalid");
          const professions = Array.isArray(data.professions) ? data.professions as string[] : [];
          const profile = service.createProfile({
            character_id: characterId, stage_name: stageName,
            biography: typeof data.biography === "string" ? data.biography : "",
            professions, character_age: player.character.age,
          }, worldDate);
          responseData.profile = profile;
          messageText = `Profile "${stageName}" created.`;
          break;
        }
        case "view_profile": {
          const targetId = typeof data.character_id === "string" ? data.character_id : characterId;
          const snapshot = service.getProfileSnapshot(targetId);
          if (!snapshot) { messageText = "No entertainment profile found."; break; }
          responseData.profile = snapshot;
          messageText = `${snapshot.stage_name}: ${snapshot.career_stage}, fame ${(snapshot.fame_score).toFixed(0)}`;
          break;
        }
        case "create_music_project": {
          const profile = service.getProfile(characterId);
          if (!profile) throw new Error("entertainment_profile_not_found");
          const title = typeof data.title === "string" ? data.title : "";
          const genre = typeof data.genre === "string" ? data.genre : "";
          const releaseType = typeof data.release_type === "string" ? data.release_type : "single";
          if (!title || !genre) throw new Error("entertainment_title_invalid");
          const project = service.createMusicProject({
            artist_character_id: characterId, artist_profile_id: profile.profile_id,
            title, description: typeof data.description === "string" ? data.description : "",
            genre, release_type: releaseType,
            budget: typeof data.budget === "number" ? data.budget : 0,
          }, worldDate);
          responseData.project = project;
          messageText = `Music project "${title}" created.`;
          break;
        }
        case "transition_music_project": {
          const projectId = typeof data.project_id === "string" ? data.project_id : "";
          const newStatus = typeof data.new_status === "string" ? data.new_status as ProductionStatusId : "" as ProductionStatusId;
          if (!projectId || !newStatus) throw new Error("entertainment_project_not_found");
          const project = service.transitionMusicProject(projectId, newStatus, worldDate);
          responseData.project = project;
          messageText = `Music project status: ${project.status}`;
          break;
        }
        case "create_film_project": {
          const title = typeof data.title === "string" ? data.title : "";
          const genre = typeof data.genre === "string" ? data.genre : "";
          const contentType = typeof data.content_type === "string" ? data.content_type : "short_film";
          if (!title || !genre) throw new Error("entertainment_title_invalid");
          const project = service.createFilmProject({
            producer_character_id: characterId,
            title, description: typeof data.description === "string" ? data.description : "",
            genre, content_type: contentType,
            budget: typeof data.budget === "number" ? data.budget : 0,
            business_id: typeof data.business_id === "string" ? data.business_id : null,
          }, worldDate);
          responseData.project = project;
          messageText = `Film project "${title}" created.`;
          break;
        }
        case "transition_film_project": {
          const projectId = typeof data.project_id === "string" ? data.project_id : "";
          const newStatus = typeof data.new_status === "string" ? data.new_status as ProductionStatusId : "" as ProductionStatusId;
          if (!projectId || !newStatus) throw new Error("entertainment_project_not_found");
          const project = service.transitionFilmProject(projectId, newStatus, worldDate);
          responseData.project = project;
          messageText = `Film project status: ${project.status}`;
          break;
        }
        case "create_content": {
          const profile = service.getProfile(characterId);
          if (!profile) throw new Error("entertainment_profile_not_found");
          const title = typeof data.title === "string" ? data.title : "";
          const contentType = typeof data.content_type === "string" ? data.content_type : "";
          if (!title || !contentType) throw new Error("entertainment_title_invalid");
          const content = service.createContent({
            creator_character_id: characterId, creator_profile_id: profile.profile_id,
            title, description: typeof data.description === "string" ? data.description : "",
            content_type: contentType,
            genre: typeof data.genre === "string" ? data.genre : null,
          }, worldDate);
          responseData.content = content;
          messageText = `Content "${title}" drafted.`;
          break;
        }
        case "publish_content": {
          const contentId = typeof data.content_id === "string" ? data.content_id : "";
          if (!contentId) throw new Error("entertainment_content_not_found");
          const content = service.publishContent(contentId, worldDate);
          responseData.content = content;
          messageText = `Content published. Views: ${content.views}, Revenue: ₦${content.revenue}`;
          break;
        }
        case "create_event": {
          const profile = service.getProfile(characterId);
          const name = typeof data.name === "string" ? data.name : "";
          const eventType = typeof data.event_type === "string" ? data.event_type as EventTypeId : "concert" as EventTypeId;
          if (!name) throw new Error("entertainment_title_invalid");
          const event = service.createEvent({
            organizer_character_id: characterId,
            organizer_profile_id: profile?.profile_id ?? null,
            name, description: typeof data.description === "string" ? data.description : "",
            event_type: eventType,
            venue_name: typeof data.venue_name === "string" ? data.venue_name : null,
            state_id: typeof data.state_id === "string" ? data.state_id : null,
            start_world_date: worldDate,
            capacity: typeof data.capacity === "number" ? data.capacity : 100,
            ticket_price: typeof data.ticket_price === "number" ? data.ticket_price : 0,
          }, worldDate);
          responseData.event = event;
          messageText = `Event "${name}" scheduled.`;
          break;
        }
        case "purchase_ticket": {
          const eventId = typeof data.event_id === "string" ? data.event_id : "";
          if (!eventId) throw new Error("entertainment_event_not_found");
          service.purchaseTicket(eventId, characterId);
          messageText = "Ticket purchased.";
          break;
        }
        case "list_events": {
          const events = service.listEvents();
          responseData.events = events.map((e) => ({ event_id: e.event_id, name: e.name, event_type: e.event_type, status: e.status, tickets_sold: e.tickets_sold, capacity: e.capacity, ticket_price: e.ticket_price }));
          messageText = `Found ${events.length} events.`;
          break;
        }
        case "create_contract": {
          const title = typeof data.title === "string" ? data.title : "";
          const contractType = typeof data.contract_type === "string" ? data.contract_type : "";
          const acceptingId = typeof data.accepting_character_id === "string" ? data.accepting_character_id : "";
          if (!title || !contractType || !acceptingId) throw new Error("entertainment_contract_title_invalid");
          const contract = service.createContract({
            title, contract_type: contractType,
            initiating_character_id: characterId, accepting_character_id: acceptingId,
            project_id: typeof data.project_id === "string" ? data.project_id : null,
            terms: typeof data.terms === "string" ? data.terms : "",
            compensation: typeof data.compensation === "number" ? data.compensation : 0,
          }, worldDate);
          responseData.contract = contract;
          messageText = `Contract "${title}" proposed.`;
          break;
        }
        case "accept_contract": {
          const contractId = typeof data.contract_id === "string" ? data.contract_id : "";
          if (!contractId) throw new Error("entertainment_contract_not_found");
          const contract = service.acceptContract(contractId, characterId);
          responseData.contract = contract;
          messageText = "Contract accepted.";
          break;
        }
        case "create_news_report": {
          const headline = typeof data.headline === "string" ? data.headline : "";
          const topic = typeof data.topic === "string" ? data.topic : "";
          if (!headline || !topic) throw new Error("entertainment_title_invalid");
          const report = service.createNewsReport({
            author_character_id: characterId, headline,
            summary: typeof data.summary === "string" ? data.summary : "",
            topic,
            organization_id: typeof data.organization_id === "string" ? data.organization_id : null,
          }, worldDate);
          responseData.report = report;
          messageText = `News report "${headline}" drafted.`;
          break;
        }
        case "publish_news_report": {
          const reportId = typeof data.report_id === "string" ? data.report_id : "";
          if (!reportId) throw new Error("entertainment_report_not_found");
          const report = service.publishNewsReport(reportId, typeof data.editorial_review === "string" ? data.editorial_review : null, worldDate);
          responseData.report = report;
          messageText = `News report published. Views: ${report.views}`;
          break;
        }
        case "list_news_reports": {
          const reports = Object.values(service.getMaps().newsReports);
          responseData.reports = reports.map((r) => ({ report_id: r.report_id, headline: r.headline, topic: r.topic, status: r.status, views: r.views, published_at: r.published_at }));
          messageText = `Found ${reports.length} report(s).`;
          break;
        }
        default:
          throw new Error("entertainment_action_unknown");
      }
    } catch (error) {
      const code = this.errorCode(error);
      this.send(context, appendOptionalRequestId({
        type: "entertainment.error", action, code, message: entertainmentErrorMessage(code),
      }, requestId));
      return;
    }

    this.markRequestProcessed(player, requestId);
    if (!["list_professions", "list_profession_categories", "list_skills", "list_genres", "list_content_types", "list_event_types", "view_profile", "list_events", "list_news_reports"].includes(action)) this.touchPlayer(player);
    this.send(context, appendOptionalRequestId({
      type: "entertainment.result", action, ok: true, message: messageText, data: responseData,
    }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  private programSeatCount(programId: string): number {
    if (!programId) return 0;
    const occupied = new Set<string>();
    for (const player of Object.values(this.store.state.players)) {
      const record = player.character.education_record;
      if (record.tertiary_enrollment?.program_id === programId && record.tertiary_enrollment.status !== "completed") {
        occupied.add(player.playerId);
      }
      if (record.admission_applications.some((application) => application.program_id === programId &&
        (application.status === "offered" || application.status === "accepted"))) {
        occupied.add(player.playerId);
      }
    }
    return occupied.size;
  }

  private scholarshipAwardCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const player of Object.values(this.store.state.players)) {
      for (const award of player.character.education_record.scholarships) {
        counts[award.scholarship_id] = (counts[award.scholarship_id] ?? 0) + 1;
      }
    }
    return counts;
  }

  private handleChat(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): void {
    const rawText = message.text;
    if (typeof rawText !== "string") {
      this.sendError(context, "chat_invalid", "Chat text must be a string.", requestId);
      return;
    }
    const text = rawText.normalize("NFC").trim();
    if (text.length < 1 || text.length > MAX_CHAT_LENGTH || /[\u0000-\u001f\u007f]/u.test(text)) {
      this.sendError(context, "chat_invalid", "Chat must be 1–200 characters without control characters.", requestId);
      return;
    }
    const now = this.now();
    context.chatTimes = context.chatTimes.filter((time) => now - time < CHAT_WINDOW_MS);
    if (context.chatTimes.length >= CHAT_MAX_MESSAGES) {
      this.sendError(context, "rate_limited", "Please wait before sending another message.", requestId);
      return;
    }
    context.chatTimes.push(now);
    const payload = {
      type: "chat.message", worldId: WORLD_ID, playerId: player.playerId,
      characterName: player.character.name, worldLocation: player.character.current_location,
      text, timestamp: new Date(now).toISOString(),
    };
    for (const recipient of this.online.values()) {
      const recipientPlayer = this.playerFor(recipient);
      if (recipientPlayer && this.arePlayersNearby(player, recipientPlayer, CHAT_RADIUS)) {
        this.send(recipient, payload);
      }
    }
  }

  private handlePlayerInteraction(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): void {
    const targetId = message.targetPlayerId;
    const now = this.now();
    if (message.action !== "wave" || typeof targetId !== "string" || targetId === player.playerId) {
      this.sendError(context, "interaction_invalid", "That player interaction is not available.", requestId);
      return;
    }
    if (now - context.lastWaveAt < 1000) {
      this.sendError(context, "rate_limited", "Wait before waving again.", requestId);
      return;
    }
    const targetContext = this.online.get(targetId);
    const target = targetContext ? this.playerFor(targetContext) : undefined;
    if (!targetContext || !target || !this.arePlayersNearby(player, target, INTERACTION_RADIUS)) {
      this.sendError(context, "player_out_of_range", "Move closer to another connected player.", requestId);
      return;
    }
    context.lastWaveAt = now;
    const event = {
      type: "player.interaction", action: "wave", playerId: player.playerId,
      characterName: player.character.name, targetPlayerId: target.playerId,
      targetCharacterName: target.character.name, timestamp: new Date(now).toISOString(),
    };
    this.send(context, event);
    if (targetContext !== context) this.send(targetContext, event);
  }

  private findOnlineCharacter(characterId: string): { player: PersistentPlayer; context: ConnectionContext } | null {
    for (const [playerId, context] of this.online) {
      const player = this.store.state.players[playerId];
      if (player?.character.character_id === characterId && canTakeActiveAction(player.character)) {
        return { player, context };
      }
    }
    return null;
  }

  /**
   * Stage 42: a server-validated social action toward an NPC the character can see. The client sends only the NPC ID and
   * the action name. Affinity, cooldowns, and history are computed here. A refusal changes nothing and is not recorded,
   * so the same request ID may be retried. A success is recorded and replied to only after its save succeeds.
   */
  private async npcAction(
    context: ConnectionContext,
    actor: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (requestId === undefined) {
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    const action = typeof message.action === "string" && message.action.length <= 32 ? message.action : "";
    const npcId = typeof message.npcId === "string" && message.npcId.length > 0 && message.npcId.length <= 96 ? message.npcId : "";
    if (npcId === "") {
      this.send(context, appendOptionalRequestId({ type: "npc.error", action, code: "npc_id_invalid", message: npcSocialMessage("npc_id_invalid") }, requestId));
      return;
    }
    let outcome: NPCSocialOutcome;
    try {
      outcome = applyNPCSocialAction(
        this.store.state,
        { character: actor.character, npcId, action, now: this.now() },
        this.socialCatalog,
        this.educationCatalog.calendar.school_days_of_week,
      );
    } catch (error) {
      const refusal = error instanceof NPCSocialError ? error : undefined;
      this.send(context, appendOptionalRequestId({
        type: "npc.error", action, npcId,
        code: refusal?.code ?? "npc_action_failed",
        message: refusal?.message ?? npcSocialMessage("npc_action_unknown"),
        ...(refusal?.dialogue !== undefined ? { dialogue: refusal.dialogue } : {}),
      }, requestId));
      return;
    }
    this.markRequestProcessed(actor, requestId);
    this.touchPlayer(actor);
    const payload = appendOptionalRequestId({
      type: "npc.result",
      action: outcome.action,
      npcId: outcome.npc_id,
      ok: true,
      message: outcome.message,
      dialogue: outcome.dialogue,
      affinityChange: outcome.affinity_change,
      event: outcome.event === null ? null : { kind: outcome.event.kind, summary: outcome.event.summary },
      npc: outcome.profile,
    }, requestId);
    await this.replyAfterSave(context, actor, requestId, "npc", payload);
  }

  /** Stage 42: read-only summary and bounded history of one visible NPC, for the requesting character only. */
  private npcView(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): void {
    const npcId = typeof message.npcId === "string" && message.npcId.length > 0 && message.npcId.length <= 96 ? message.npcId : "";
    if (npcId === "") {
      this.send(context, appendOptionalRequestId({ type: "npc.error", action: "view", code: "npc_id_invalid", message: npcSocialMessage("npc_id_invalid") }, requestId));
      return;
    }
    try {
      const view = npcBondView(this.store.state, player.character, npcId, this.socialCatalog, this.educationCatalog.calendar.school_days_of_week);
      this.send(context, appendOptionalRequestId({ type: "npc.view", npcId, npc: view.profile, history: view.history }, requestId));
    } catch (error) {
      const refusal = error instanceof NPCSocialError ? error : undefined;
      this.send(context, appendOptionalRequestId({
        type: "npc.error", action: "view", npcId,
        code: refusal?.code ?? "npc_view_failed",
        message: refusal?.message ?? "Those details are not available.",
      }, requestId));
    }
  }

  private async progressRelationship(
    context: ConnectionContext,
    actor: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (requestId === undefined) {
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    const targetCharacterId = message.targetCharacterId;
    if (typeof targetCharacterId !== "string" || targetCharacterId.length > 96) {
      this.sendError(context, "relationship_target_invalid", "Select another character first.", requestId);
      return;
    }
    const targetEntry = this.findOnlineCharacter(targetCharacterId);
    if (!targetEntry || targetEntry.player.playerId === actor.playerId ||
      !this.arePlayersNearby(actor, targetEntry.player, INTERACTION_RADIUS)) {
      this.sendError(context, "relationship_partner_unavailable", "The other living character must be nearby and connected.", requestId);
      return;
    }
    let result: ReturnType<typeof proposeRelationship>;
    try {
      result = proposeRelationship(
        this.store.state,
        actor.character.character_id,
        targetCharacterId,
        message.stage,
      );
    } catch (error) {
      this.sendError(context, this.errorCode(error), "That relationship update is not available.", requestId);
      return;
    }
    this.markRequestProcessed(actor, requestId);
    this.touchPlayer(actor);
    this.touchPlayer(targetEntry.player);
    const payload = appendOptionalRequestId({
      type: "relationship.progress",
      status: result.status,
      relationshipId: result.relationship.relationship_id,
      stage: result.relationship.stage ?? result.relationship.pending_stage ?? null,
      actorCharacterId: actor.character.character_id,
      targetCharacterId,
      ...(result.marriage ? { marriageId: result.marriage.marriage_id } : {}),
    }, requestId);
    // Stage 37: the reply and the partner's notice are sent only once the change is saved.
    const notifyPartner = (): void => {
      if (targetEntry.context !== context) this.send(targetEntry.context, payload);
      this.sendCharacterSnapshot(targetEntry.context);
    };
    await this.replyAfterSave(context, actor, requestId, "relationship", payload, notifyPartner);
  }

  private async recordChildbirth(
    context: ConnectionContext,
    parent: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (requestId === undefined) {
      this.sendError(context, "request_id_required", "This action requires a unique request ID.");
      return;
    }
    const parentId = parent.character.character_id;
    const marriage = Object.values(this.store.state.marriages).find((entry) =>
      entry.status === "active" && entry.spouse_ids.includes(parentId) &&
      (!isRecord(message) || message.marriageId === undefined || message.marriageId === entry.marriage_id));
    if (!marriage) {
      this.sendError(context, "marriage_not_active", "An active marriage is required for this family event.", requestId);
      return;
    }
    let requestedName: string | undefined;
    if (message.name !== undefined) {
      const validatedName = validName(message.name);
      if (validatedName === null) {
        this.sendError(context, "invalid_name", "The child's name is not valid.", requestId);
        return;
      }
      requestedName = validatedName;
    }
    let child: ReturnType<typeof createChildForMarriage>;
    try {
      child = createChildForMarriage(this.store.state, marriage.marriage_id, requestedName, this.now());
    } catch (error) {
      this.sendError(context, this.errorCode(error), "The family event could not be recorded.", requestId);
      return;
    }
    this.markRequestProcessed(parent, requestId);
    this.dirty = true;
    const payload = appendOptionalRequestId({
      type: "family.childborn",
      child: {
        person_id: child.person_id,
        name: child.name,
        date_of_birth: child.date_of_birth,
        age: child.age,
        life_stage_id: child.life_stage_id,
        household_id: child.household_id,
        family_ids: child.family_ids,
      },
    }, requestId);
    for (const spouseId of marriage.spouse_ids) {
      const spouse = Object.values(this.store.state.players).find((entry) => entry.character.character_id === spouseId);
      if (spouse) this.touchPlayer(spouse);
    }
    // Stage 37: the parent's reply and the spouses' notices are sent only once the birth is saved.
    const notifySpouses = (): void => {
      for (const spouseId of marriage.spouse_ids) {
        const spouse = Object.values(this.store.state.players).find((entry) => entry.character.character_id === spouseId);
        // The parent receives the reply itself.
        if (!spouse || spouse.playerId === parent.playerId) continue;
        const spouseContext = this.online.get(spouse.playerId);
        if (spouseContext) {
          this.send(spouseContext, payload);
          this.sendCharacterSnapshot(spouseContext);
        }
      }
    };
    await this.replyAfterSave(context, parent, requestId, "family", payload, notifySpouses);
  }

  private advanceWorldMilliseconds(milliseconds: number, now: number): void {
    const clock = this.store.state.worldClock;
    const accumulated = clock.millisecond_of_minute + milliseconds;
    const wholeMinutes = Math.floor(accumulated / 60_000);
    clock.millisecond_of_minute = accumulated % 60_000;
    for (let index = 0; index < wholeMinutes; index += 1) this.advanceWorldMinute(now);
    clock.updated_at = new Date(now).toISOString();
    this.dirty = true;
  }

  private advanceWorldMinute(now: number): void {
    const clock = this.store.state.worldClock;
    let dateChanged = false;
    if (clock.minute_of_day + 1 >= MINUTES_PER_DAY) {
      clock.day += 1;
      clock.minute_of_day = 0;
      clock.world_date = dateForWorldDay(clock.day, this.lifeCatalog);
      dateChanged = true;
    } else clock.minute_of_day += 1;
    clock.updated_at = new Date(now).toISOString();
    // Stage 42: NPC activity follows the same clock. Records change only at transitions, so this is one comparison per NPC.
    syncNPCActivities(this.store.state, this.socialCatalog, this.educationCatalog.calendar.school_days_of_week);
    if (dateChanged) {
      advanceWorldLife(this.store.state, clock.world_date);
      processCareerWorldDate(this.store.state, clock.world_date, now, this.careerCatalog,
        economyAccountPort(this.store.state, this.economyCatalog));
      processEconomyWorldDate(this.store.state, clock.world_date, now, this.economyCatalog);
      processBusinessWorldDate(this.store.state, clock.world_date, now, this.businessCatalog);
      processPropertyWorldDate(this.store.state);
    }
    if (processCareerWorldMinute(this.store.state, clock.world_date, clock.minute_of_day, now, this.careerCatalog) > 0) {
      this.dirty = true;
    }
    const attendanceDeadlinePassed = this.educationCatalog.timetable.some((entry) =>
      entry.kind !== "break" &&
      entry.start_minute + entry.duration_minutes + this.educationCatalog.calendar.late_grace_minutes + 1 === clock.minute_of_day);
    if (attendanceDeadlinePassed && this.educationCatalog.calendar.school_days_of_week.includes((clock.day - 1) % 7)) {
      for (const storedPlayer of Object.values(this.store.state.players)) {
        if (markMissedSchoolPeriods(storedPlayer.character.education_record, clock.day, clock.minute_of_day, this.educationCatalog) > 0) {
          syncLegacyEducation(storedPlayer.character, this.educationCatalog);
        }
      }
    }
    for (const context of this.online.values()) {
      const player = this.playerFor(context);
      if (!player || !canTakeActiveAction(player.character)) continue;
      player.character.hunger = Math.max(0, player.character.hunger - 0.012);
      player.character.energy = Math.max(0, player.character.energy - 0.004);
      if (player.character.hunger < 8 && player.character.energy < 8) {
        player.character.health = Math.max(1, player.character.health - 0.015);
      }
      player.character.updated_at = clock.updated_at;
      player.lastSeen = clock.updated_at;
      this.sendMinuteSnapshot(context);
    }
    this.dirty = true;
  }

  /**
   * Stage 38 (R5). Sends the per-minute character snapshot, unless this socket already has a backlog. A held-back
   * snapshot is not lost: releaseHeldSnapshots sends the then-current state once the backlog drains. A socket that is
   * closed is skipped by send(), as for every other message.
   */
  private sendMinuteSnapshot(context: ConnectionContext): void {
    if (context.socket.bufferedAmount > SNAPSHOT_BACKLOG_LIMIT_BYTES) {
      this.snapshotHeldBack.add(context);
      return;
    }
    this.snapshotHeldBack.delete(context);
    this.sendCharacterSnapshot(context);
  }

  /** Stage 38 (R5). Sends one held-back snapshot to each online socket whose backlog has drained. */
  private releaseHeldSnapshots(): void {
    for (const context of this.online.values()) {
      if (!this.snapshotHeldBack.has(context)) continue;
      if (context.socket.bufferedAmount > SNAPSHOT_BACKLOG_LIMIT_BYTES) continue;
      this.snapshotHeldBack.delete(context);
      this.sendCharacterSnapshot(context);
    }
  }

  private addInventoryItem(inventory: InventoryItem[], purchased: InventoryItem): void {
    const existing = inventory.find((item) => item.id === purchased.id);
    if (existing) existing.quantity += purchased.quantity;
    else inventory.push({ ...purchased });
  }

  private touchPlayer(player: PersistentPlayer): void {
    const timestamp = new Date(this.now()).toISOString();
    player.lastSeen = timestamp;
    player.character.updated_at = timestamp;
    this.dirty = true;
  }

  private characterSnapshot(player: PersistentPlayer): CharacterRecord {
    const snapshot = safeClone(player.character);
    snapshot.life_profile = buildLifeProfile(this.store.state, player.character);
    snapshot.career_profile = buildCareerProfile(this.store.state, player.character, this.careerCatalog);
    snapshot.economy_profile = buildEconomyProfile(this.store.state, player.character.character_id, this.economyCatalog);
    // Stage 41: "owned" means an active owner or co-owner record. The founder field is not updated by a transfer, so it
    // cannot identify the current owners, and it would hide a co-owned business from its co-owner.
    const characterId = player.character.character_id;
    const ownedBusinessIds = new Set(
      Object.values(this.store.state.businessOwnership)
        .filter((o) => o.character_id === characterId && o.active && (o.role === "owner" || o.role === "co_owner"))
        .map((o) => o.business_id),
    );
    const ownedBusinesses = Object.values(this.store.state.businesses).filter((biz) => ownedBusinessIds.has(biz.business_id));
    snapshot.business_profiles = ownedBusinesses.map((biz) => {
      try { return buildBusinessProfile(this.store.state, biz.business_id, this.businessCatalog); } catch { return null; }
    }).filter((profile): profile is NonNullable<typeof profile> => profile !== null);
    try { snapshot.property_profiles = getCharacterProperties(this.store.state, player.character.character_id); } catch { snapshot.property_profiles = []; }
    try { snapshot.rental_agreements = getCharacterRentals(this.store.state, player.character.character_id); } catch { snapshot.rental_agreements = []; }
    try { snapshot.government_appointments = getCharacterAppointments(this.store.state, player.character.character_id); } catch { snapshot.government_appointments = []; }
    try { const pp = getPoliticalProfile(this.store.state, player.character.character_id); if (pp) snapshot.political_profile = pp; } catch { /* ignore */ }
    try { const lp = getLegalProfile(this.store.state, player.character.character_id); if (lp) snapshot.legal_profile = lp; } catch { /* ignore */ }
    try { const policeService = new PoliceService(this.store.state, this.policeCatalog); const pp = policeService.getPoliceProfile(player.character.character_id); if (pp.is_officer) snapshot.police_profile = pp; } catch { /* ignore */ }
    try { const militaryService = new MilitaryService(this.store.state, this.militaryCatalog); const mp = militaryService.getMilitaryProfile(player.character.character_id); if (mp.is_service_member) snapshot.military_profile = mp; } catch { /* ignore */ }
    try { const crimeService = new CrimeService(this.store.state, this.crimeCatalog); const cp = crimeService.getCriminalProfile(player.character.character_id); if (cp.has_criminal_record || cp.notoriety_score > 0) snapshot.criminal_profile = cp; } catch { /* ignore */ }
    try { const cultureService = new CultureService(this.store.state, this.cultureCatalog); const cup = cultureService.getCulturalProfileSnapshot(player.character.character_id); if (cup.languages_spoken.length > 0 || cup.community_memberships_count > 0 || cup.institution_memberships_count > 0) snapshot.cultural_profile = cup; } catch { /* ignore */ }
    snapshot.npc_profiles = visibleNPCProfiles(this.store.state, player.character, this.socialCatalog, this.educationCatalog.calendar.school_days_of_week);
    try { const entertainmentService = new EntertainmentService(this.store.state, this.entertainmentCatalog); const ep = entertainmentService.getProfileSnapshot(player.character.character_id); if (ep) snapshot.entertainment_profile = ep; } catch { /* ignore */ }
    return snapshot;
  }

  private sendCharacterSnapshot(context: ConnectionContext, requestId?: string): void {
    const player = this.playerFor(context);
    if (!player) return;
    this.send(context, appendOptionalRequestId({ type: "character.snapshot", character: this.characterSnapshot(player) }, requestId));
  }

  private toPresence(player: PersistentPlayer, connectionStatus: "connected" | "disconnected"): PublicPresence {
    return {
      playerId: player.playerId,
      characterId: player.character.character_id,
      characterName: player.character.name,
      worldLocation: player.character.current_location,
      position: { ...player.character.position },
      direction: { ...player.character.direction },
      connectionStatus,
      lastSeen: player.lastSeen,
      appearance: { ...player.character.appearance },
      geographicLocation:
        player.character.geographic_location === null
          ? null
          : safeClone(player.character.geographic_location),
      regionId: player.character.geographic_location?.region_id ?? null,
      chunkId: player.character.geographic_location?.chunk_id ?? null,
    };
  }

  private publicPresenceList(viewerId: string): PublicPresence[] {
    const viewer = this.store.state.players[viewerId];
    if (!viewer) return [];
    const list: PublicPresence[] = [];
    for (const context of this.online.values()) {
      const player = this.playerFor(context);
      if (player && canTakeActiveAction(player.character) &&
        (player.playerId === viewerId || this.sharesGeographicInterest(viewer, player))) {
        list.push(this.toPresence(player, "connected"));
      }
    }
    return list;
  }

  private sharesGeographicInterest(viewer: PersistentPlayer, subject: PersistentPlayer): boolean {
    if (viewer.character.current_location !== subject.character.current_location) return false;
    const viewerLocation = viewer.character.geographic_location;
    const subjectLocation = subject.character.geographic_location;
    if (viewerLocation === null && subjectLocation === null) return true;
    if (viewerLocation === null || subjectLocation === null) return false;
    return (
      viewerLocation.region_id === subjectLocation.region_id &&
      chunksAreWithinRadius(
        viewerLocation.chunk_id,
        subjectLocation.chunk_id,
        GEOGRAPHIC_INTEREST_RADIUS_CHUNKS,
      ) &&
      geographicDistanceMeters(viewerLocation, subjectLocation) <= GEOGRAPHIC_INTEREST_RADIUS_METERS
    );
  }

  private arePlayersNearby(left: PersistentPlayer, right: PersistentPlayer, radiusMeters: number): boolean {
    if (left.character.current_location !== right.character.current_location) return false;
    const leftLocation = left.character.geographic_location;
    const rightLocation = right.character.geographic_location;
    if (leftLocation === null && rightLocation === null) {
      return distance(left.character.position, right.character.position) <= radiusMeters;
    }
    if (leftLocation === null || rightLocation === null || leftLocation.region_id !== rightLocation.region_id) {
      return false;
    }
    return (
      chunksAreWithinRadius(leftLocation.chunk_id, rightLocation.chunk_id, GEOGRAPHIC_INTEREST_RADIUS_CHUNKS) &&
      geographicDistanceMeters(leftLocation, rightLocation) <= radiusMeters
    );
  }

  private broadcastPresence(message: Record<string, unknown>): void {
    const payload = isRecord(message.player) ? message.player : null;
    const subjectId = payload && typeof payload.playerId === "string" ? payload.playerId : null;
    const subject = subjectId === null ? undefined : this.store.state.players[subjectId];
    for (const context of this.online.values()) {
      const viewer = this.playerFor(context);
      if (
        subject === undefined ||
        viewer === undefined ||
        viewer.playerId === subject.playerId ||
        this.sharesGeographicInterest(viewer, subject)
      ) {
        this.send(context, message);
      }
    }
  }

  private broadcastWorldSnapshot(): void {
    for (const context of this.online.values()) {
      const player = this.playerFor(context);
      if (!player) continue;
      this.send(context, {
        type: "world.snapshot",
        worldId: WORLD_ID,
        clock: worldClockSnapshot(this.store.state.worldClock, this.lifeCatalog),
        players: this.publicPresenceList(player.playerId),
      });
    }
  }

  private async disconnect(context: ConnectionContext): Promise<void> {
    if (context.closed) return;
    context.closed = true;
    this.contexts.delete(context);
    if (context.playerId === null) return;
    const playerId = context.playerId;
    const player = this.store.state.players[playerId];
    if (this.online.get(playerId) !== context) return;
    this.online.delete(playerId);
    this.pendingQuizzes.delete(playerId);
    if (player) {
      player.lastSeen = new Date(this.now()).toISOString();
      player.character.updated_at = player.lastSeen;
      this.dirty = true;
      this.broadcastPresence({ type: "presence.left", player: this.toPresence(player, "disconnected") });
      console.info("multiplayer player disconnected", playerId);
    }
    await this.flushDirty();
  }

  private playerFor(context: ConnectionContext): PersistentPlayer | undefined {
    return context.playerId === null ? undefined : this.store.state.players[context.playerId];
  }

  private send(context: ConnectionContext, payload: Record<string, unknown>): void {
    if (context.socket.readyState !== WebSocket.OPEN) return;
    context.socket.send(JSON.stringify(payload), (error) => {
      if (error) console.warn("multiplayer send failed");
    });
  }

  private sendError(context: ConnectionContext, code: string, message: string, requestId?: string, retryAfterSeconds?: number): void {
    const payload: Record<string, unknown> = { type: "error", code, message };
    if (retryAfterSeconds !== undefined) payload.retry_after_seconds = retryAfterSeconds;
    this.send(context, appendOptionalRequestId(payload, requestId));
  }

  private invalid(context: ConnectionContext, code: string, requestId?: string): void {
    context.invalidCount += 1;
    this.sendError(context, code, "The request was not valid.", requestId);
    if (context.invalidCount >= MAX_INVALID_MESSAGES) context.socket.close(1008, "too many invalid requests");
  }

  private errorCode(error: unknown): string {
    return error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "internal_error";
  }

  /** Returns true when this refusal opens a new capacity episode (the first refusal since the last successful save). */
  private enterCapacityEpisode(): boolean {
    if (this.capacityEpisodeOpen) return false;
    this.capacityEpisodeOpen = true;
    return true;
  }

  /** Returns true when this failure opens a new persistence episode (the first failure since the last successful save). */
  private enterPersistenceEpisode(): boolean {
    if (this.persistenceEpisodeOpen) return false;
    this.persistenceEpisodeOpen = true;
    return true;
  }

  private openFailureNotice(): void {
    if (this.failureNoticeOpenedAt === null) this.failureNoticeOpenedAt = this.now();
  }

  /**
   * Called after every successful save. Clears the notice episodes. If a failure notice was sent, sends exactly one
   * persistence.restored signal to online players and one log line. The signal says only that the save succeeded.
   * It does not claim anything about changes that were not part of that save (G3).
   */
  private noteSaveSucceeded(): void {
    this.resolvePendingCreations();
    this.capacityEpisodeOpen = false;
    this.persistenceEpisodeOpen = false;
    const failedAttempts = this.failedSaveAttemptsSinceSuccess;
    this.failedSaveAttemptsSinceSuccess = 0;
    const openedAt = this.failureNoticeOpenedAt;
    if (openedAt === null) return;
    this.failureNoticeOpenedAt = null;
    const outageSeconds = Math.max(0, Math.round((this.now() - openedAt) / 1000));
    console.info(
      `multiplayer world saves recovered after ${failedAttempts} failed attempts over ${outageSeconds} s; this save is complete`,
    );
    for (const context of this.online.values()) {
      this.send(context, { type: "persistence.restored", failedAttempts, outageSeconds });
    }
  }

  private async flushDirty(): Promise<void> {
    if (!this.dirty || this.flushInFlight) return;
    this.flushInFlight = true;
    this.dirty = false;
    let writeFailed = false;
    try {
      writeFailed = !(await this.persistOnce());
    } finally {
      this.flushInFlight = false;
      if (this.dirty && !writeFailed && !this.closed) void this.flushDirty();
    }
  }

  /**
   * One save of the live world, queued behind every earlier save. Resolves true when it succeeded. On failure it keeps
   * the world marked dirty (the background retry saves it later), records the failure, and sends the persistence
   * notice once per episode. The memory state is not rolled back: a later successful save writes all of it.
   */
  private async persistOnce(): Promise<boolean> {
    const captured = this.changeGeneration;
    try {
      await this.serialize(() => this.store.flush());
      this.savedGeneration = Math.max(this.savedGeneration, captured);
      this.lastPersistAt = this.now();
      this.noteSaveSucceeded();
      this.pruneMoneyReplies();
      return true;
    } catch (error) {
      this.dirty = true;
      this.failedSaveAttemptsSinceSuccess += 1;
      this.lastFailedSaveOutcome = saveOutcomeOf(error);
      // A refused save keeps the previous valid file. Nothing is removed to make room.
      if (error instanceof WorldStateCapacityError) {
        // One notice and one log line per episode; retries stay silent until a save succeeds.
        if (this.enterCapacityEpisode()) {
          this.openFailureNotice();
          console.error("multiplayer world state is over its size limit; saves are refused and the previous file is kept");
          for (const context of this.online.values()) {
            this.sendError(context, "world_capacity_reached", "The world has reached its size limit. Recent changes are not saved yet.");
          }
        }
      } else if (this.enterPersistenceEpisode()) {
        // One notice and one log line per episode, as for capacity. Retries continue about once a second until a
        // save succeeds; the first successful save then sends one persistence.restored signal (G3).
        this.openFailureNotice();
        console.error("multiplayer persistence failed; retries continue until a save succeeds");
        for (const context of this.online.values()) {
          this.sendError(
            context,
            "persistence_failed",
            "Server state could not be saved. Changes made now may be lost if the server restarts before saving works again.",
          );
        }
      }
      return false;
    }
  }

  /**
   * Makes every treasury change made so far durable before its reply is sent (Stage 32, Stage 33). Saves at most
   * three times. When the change is still not covered, the result says whether the save is known to have failed
   * (not_saved) or may have happened (unknown). The reply is then an error, and the retry uses the same request ID.
   */
  private async ensureDurable(
    target: number = this.changeGeneration,
  ): Promise<{ durable: true } | { durable: false; outcome: SaveOutcome }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.savedGeneration >= target) return { durable: true };
      if (!(await this.persistOnce())) return { durable: false, outcome: this.lastFailedSaveOutcome };
    }
    // Not reached in practice: a save captures a generation no lower than this request's, so one successful save covers
    // it. If it were reached, a save may have happened, so the outcome is reported as unknown (retry-safe).
    return this.savedGeneration >= target ? { durable: true } : { durable: false, outcome: "unknown" };
  }

  /**
   * Answers a changing request once its change is saved (Stage 34), for every family: economy, business, education,
   * career (a result reply), and shop, bus, clinic (a character snapshot). ensureDurable waits for a save that covers the
   * change. On success the reply is sent (a replay carries replayed: true). On failure the reply is an error that names the
   * outcome: `<family>_not_saved` when the save is known to have failed before any write, and `<family>_outcome_unknown`
   * when it may have committed. The replay record is kept, so a retry is answered without applying the change again.
   */
  private async confirmMoneyReply(
    context: ConnectionContext,
    key: string,
    requestId: string,
    pending: PendingMoneyReply,
    replay: boolean,
  ): Promise<void> {
    const durability = await this.ensureDurable(pending.generation);
    if (!durability.durable) {
      // The record stays, so a retry with the same request ID is answered once the change is saved.
      const unknown = durability.outcome === "unknown";
      if (pending.kind !== "snapshot") {
        const code = `${pending.kind}_${unknown ? "outcome_unknown" : "not_saved"}`;
        const message = pending.kind === "economy" ? economyErrorMessage(code)
          : pending.kind === "business" ? businessErrorMessage(code)
            : (SAVE_OUTCOME_MESSAGES[code] ?? "The change could not be saved, so it is not confirmed.");
        this.send(context, appendOptionalRequestId({
          type: `${pending.kind}.error`, action: pending.reply.action, code, message,
        }, requestId));
      } else {
        const code = `${pending.family}_${unknown ? "outcome_unknown" : "not_saved"}`;
        const what = MONEY_FAMILY_TEXT[pending.family];
        // A rest changes no money, so its retry wording does not mention a charge.
        const effect = pending.family === "rest" ? "applied" : "charged";
        this.sendError(context, code, unknown
          ? `${what} may or may not have been saved, so it is not confirmed. Retry with the same request ID; it will not be ${effect} twice.`
          : `${what} could not be saved, so it is not confirmed. Retry with the same request ID; it will not be ${effect} twice.`,
        requestId);
      }
      return;
    }
    if (pending.delivered) {
      // A success was already sent for this request, so a resend is a duplicate, as for any idempotent command.
      this.pendingMoneyReplies.delete(key);
      this.send(context, { type: "command.duplicate", requestId });
      this.sendCharacterSnapshot(context, requestId);
      return;
    }
    // The first success for this request. Once sent, the record is no longer needed: a later resend is a duplicate.
    pending.delivered = true;
    this.pendingMoneyReplies.delete(key);
    // The request is answered and recorded, so a retry is a duplicate from here on (the record is in memory). Releasing
    // the in-flight guard now means a retry that arrives during the flush below is answered from the record at once,
    // rather than waiting behind this reply.
    this.releaseInFlight(key);
    if (pending.kind !== "snapshot") {
      const reply = replay
        ? { ...pending.reply, data: { ...(pending.reply.data as Record<string, unknown>), replayed: true } }
        : pending.reply;
      this.send(context, appendOptionalRequestId(reply, requestId));
      this.sendCharacterSnapshot(context);
      // Stage 37: effects on other players (a partner's or spouse's notice) are sent only once the change is saved.
      pending.afterConfirm?.();
    } else {
      this.sendCharacterSnapshot(context, requestId);
    }
    await this.flushDirty();
  }

  /**
   * Stage 37: answers a changing request of a consequential family once its change is saved. A read-only action of the
   * same family keeps its immediate reply and flush.
   */
  private async answerFamilyReply(
    context: ConnectionContext,
    player: PersistentPlayer,
    message: Record<string, unknown>,
    requestId: string | undefined,
    family: ConsequentialFamily,
    reply: Record<string, unknown>,
  ): Promise<void> {
    if (requestId !== undefined && consequentialFamilyOf(message) !== undefined) {
      await this.replyAfterSave(context, player, requestId, family, reply);
      return;
    }
    this.send(context, appendOptionalRequestId(reply, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
  }

  /**
   * Stage 37: the reply for a changing consequential request, sent only after its save succeeds (through the same
   * confirmMoneyReply path as Stage 34). afterConfirm sends any notice to another player, once the change is saved.
   */
  private async replyAfterSave(
    context: ConnectionContext,
    player: PersistentPlayer,
    requestId: string,
    family: ConsequentialFamily,
    reply: Record<string, unknown>,
    afterConfirm?: () => void,
  ): Promise<void> {
    this.changeGeneration += 1;
    const key = moneyReplyKey(player, requestId);
    const pending: PendingMoneyReply = {
      kind: family, generation: this.changeGeneration, reply, delivered: false,
      ...(afterConfirm !== undefined ? { afterConfirm } : {}),
    };
    this.pendingMoneyReplies.set(key, pending);
    await this.confirmMoneyReply(context, key, requestId, pending, false);
  }

  /**
   * Confirms a change whose reply waits for its save (Stage 34): a cash charge (shop, bus, clinic) or a rest (Stage 37),
   * replied with the character snapshot carrying the request ID. Callers have validated the request and checked the write gate.
   */
  private async chargeAndConfirm(
    context: ConnectionContext,
    requestId: string,
    family: MoneyFamily,
    player: PersistentPlayer,
  ): Promise<void> {
    this.changeGeneration += 1;
    const key = moneyReplyKey(player, requestId);
    const pending: PendingMoneyReply = { kind: "snapshot", generation: this.changeGeneration, family, delivered: false };
    this.pendingMoneyReplies.set(key, pending);
    await this.confirmMoneyReply(context, key, requestId, pending, false);
  }

  /** Drops the oldest replay records that are already saved, once there are more than the cap (Stage 34). */
  private pruneMoneyReplies(): void {
    if (this.pendingMoneyReplies.size <= MAX_PENDING_MONEY_REPLIES) return;
    for (const [key, pending] of this.pendingMoneyReplies) {
      if (this.pendingMoneyReplies.size <= MAX_PENDING_MONEY_REPLIES) break;
      if (pending.generation <= this.savedGeneration) this.pendingMoneyReplies.delete(key);
    }
  }

  /**
   * Whether a new financial write may start (Stage 33). It may not while the last save failed, or while the store is
   * fenced: a new treasury change would only widen the gap between memory and storage. The service refuses such a
   * write before it changes anything. Replays of recorded requests are still answered, and are confirmed only after
   * a save succeeds.
   */
  private financialWritesOpen(): boolean {
    if (this.store.isFenced?.() === true) return false;
    return this.failedSaveAttemptsSinceSuccess === 0;
  }
}
