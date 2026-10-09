import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket, type RawData } from "ws";
import { chunksAreWithinRadius, geographicDistanceMeters } from "../geography/coordinates.js";
import {
  geographicLocationForMapPosition,
  geographicLocationFromProfile,
  geographicLocationToMapPosition,
  loadAkureSouthRegion,
} from "../geography/catalog.js";
import type { GeographicRegion } from "../geography/types.js";
import { loadEducationCatalog } from "../education/catalog.js";
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
import {
  buildEconomyProfile,
  depositToAccount,
  economyAccountPort,
  economyErrorMessage,
  initializeEconomyWorldState,
  listMarketGoodsForLocation,
  openEconomyAccount,
  processEconomyWorldDate,
  purchaseMarketGood,
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
  runProduction,
  sellProduct,
  sellService,
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
  recordGovernmentExpenditure,
  recordGovernmentRevenue,
  removeOfficial,
  searchProjects,
  seedGovernmentWorld,
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
import { WorldStore } from "./persistence.js";
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
const STARTING_MONEY = 5000;
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

export interface WorldEngineOptions {
  readonly tickIntervalMs?: number;
  readonly gameMinuteMs?: number;
  readonly broadcastIntervalMs?: number;
  readonly maxConnections?: number;
  readonly connectionAttemptsPerMinute?: number;
  readonly now?: () => number;
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
  private readonly pendingQuizzes = new Map<string, PendingQuiz>();
  private readonly connectionWindows = new Map<string, WindowCounter>();
  private readonly now: () => number;
  private readonly gameMinuteMs: number;
  private readonly broadcastIntervalMs: number;
  private readonly maxConnections: number;
  private readonly connectionAttemptsPerMinute: number;
  private readonly geographyRegion: GeographicRegion;
  private readonly educationCatalog: EducationCatalog;
  private readonly careerCatalog: CareerCatalog = loadCareerCatalog();
  private readonly economyCatalog: EconomyCatalog = loadEconomyCatalog();
  private readonly businessCatalog: BusinessCatalog = loadBusinessCatalog();
  private readonly propertyCatalog: PropertyCatalog = loadPropertyCatalog();
  private readonly governmentCatalog: GovernmentCatalog = loadGovernmentCatalog();
  private readonly electionsCatalog: ElectionsCatalog = loadElectionsCatalog();
  private readonly lifeCatalog = loadLifeCatalog();
  private lastTickAt: number;
  private lastBroadcastAt = 0;
  private lastPersistAt: number;
  private gameMillisecondRemainder = 0;
  private dirty = false;
  private flushInFlight = false;
  private closed = false;

  constructor(private readonly store: WorldStore, options: WorldEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.gameMinuteMs = Math.max(1, options.gameMinuteMs ?? this.lifeCatalog.calendar.real_milliseconds_per_game_minute);
    this.broadcastIntervalMs = Math.max(50, options.broadcastIntervalMs ?? 100);
    this.maxConnections = Math.max(1, options.maxConnections ?? 64);
    this.connectionAttemptsPerMinute = Math.max(1, options.connectionAttemptsPerMinute ?? 30);
    this.geographyRegion = loadAkureSouthRegion();
    this.educationCatalog = loadEducationCatalog();
    this.lastTickAt = this.now();
    this.lastPersistAt = this.lastTickAt;
    for (const player of Object.values(this.store.state.players)) {
      this.playerByTokenHash.set(player.tokenHash, player.playerId);
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

  attach(socket: WebSocket, request: IncomingMessage): void {
    const now = this.now();
    const remoteAddress = request.socket.remoteAddress ?? "unknown";
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
    await this.store.flush();
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

  private markRequestProcessed(player: PersistentPlayer, requestId: string | undefined): void {
    if (requestId === undefined || player.recentRequestIds.includes(requestId)) return;
    player.recentRequestIds.push(requestId);
    if (player.recentRequestIds.length > MAX_RECENT_REQUESTS) player.recentRequestIds.shift();
    this.dirty = true;
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
    if (IDEMPOTENT_COMMANDS.has(message.type)) {
      if (requestId === undefined) {
        this.sendError(context, "request_id_required", "This action requires a unique request ID.");
        return;
      }
      if (player.recentRequestIds.includes(requestId)) {
        this.send(context, { type: "command.duplicate", requestId });
        this.sendCharacterSnapshot(context, requestId);
        return;
      }
    }
    player.lastSeen = new Date(now).toISOString();
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
      case "chat.send": this.handleChat(context, player, message, requestId); return;
      case "player.interact": this.handlePlayerInteraction(context, player, message, requestId); return;
      case "relationship.progress": await this.progressRelationship(context, player, message, requestId); return;
      case "family.childbirth": await this.recordChildbirth(context, player, message, requestId); return;
      default: this.invalid(context, "unknown_message", requestId);
    }
  }

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
    const existingPlayerId = this.playerByCreationKeyHash.get(creationKeyHash);
    const existingPlayer = existingPlayerId ? this.store.state.players[existingPlayerId] : undefined;
    if (existingPlayerId && existingPlayer) {
      const active = this.online.get(existingPlayerId);
      if (active && active.socket.readyState === WebSocket.OPEN) {
        this.sendError(context, "player_already_connected", "This identity is already connected.", requestId);
        context.socket.close(4409, "identity already connected");
        return;
      }
      const oldTokenHash = existingPlayer.tokenHash;
      const sessionToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
      const timestamp = new Date(this.now()).toISOString();
      existingPlayer.tokenHash = tokenHash;
      existingPlayer.lastSeen = timestamp;
      existingPlayer.character.updated_at = timestamp;
      this.playerByTokenHash.delete(oldTokenHash);
      this.playerByTokenHash.set(tokenHash, existingPlayerId);
      // The upcoming snapshot includes all current changes; keep later concurrent dirtiness intact.
      this.dirty = false;
      try {
        await this.store.flush();
        this.lastPersistAt = this.now();
      } catch {
        this.dirty = true;
        existingPlayer.tokenHash = oldTokenHash;
        this.playerByTokenHash.delete(tokenHash);
        this.playerByTokenHash.set(oldTokenHash, existingPlayerId);
        this.sendError(context, "persistence_failed", "The identity could not be recovered.", requestId);
        console.error("multiplayer identity recovery persistence failed");
        return;
      }
      context.identityCreated = true;
      this.send(context, appendOptionalRequestId({ type: "identity.created", playerId: existingPlayerId, sessionToken }, requestId));
      return;
    }
    this.playerByCreationKeyHash.delete(creationKeyHash);
    if (Object.keys(this.store.state.players).length >= MAX_PERSISTED_PLAYERS) {
      this.sendError(context, "world_capacity_reached", "The prototype player record limit has been reached.", requestId);
      return;
    }
    let playerId: string;
    let character: CharacterRecord;
    try {
      playerId = `player-${randomUUID()}`;
      character = createCharacter(
        profile,
        playerId,
        this.now(),
        this.geographyRegion,
        this.educationCatalog,
        this.store.state.worldClock.world_date,
      );
    } catch (error) {
      this.sendError(context, this.errorCode(error), "The character profile was not accepted.", requestId);
      return;
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
    const timestamp = new Date(this.now()).toISOString();
    const player: PersistentPlayer = {
      playerId, tokenHash, creationKeyHash, recentRequestIds: [],
      createdAt: timestamp, lastSeen: timestamp, character,
    };
    this.store.state.players[playerId] = player;
    try {
      createStarterFamily(this.store.state, playerId, character, this.now());
    } catch (error) {
      delete this.store.state.players[playerId];
      this.sendError(context, this.errorCode(error), "The character family could not be created.", requestId);
      return;
    }
    initializeEconomyWorldState(this.store.state, this.now());
    initializeBusinessWorldState(this.store.state);
    initializePropertyWorldState(this.store.state);
    seedProperties(this.store.state, this.store.state.worldClock.world_date, this.now(), this.propertyCatalog);
    initializeGovernmentWorldState(this.store.state);
    seedGovernmentWorld(this.store.state, this.store.state.worldClock.world_date, this.now(), this.governmentCatalog);
    initializeElectionWorldState(this.store.state);
    this.playerByTokenHash.set(tokenHash, playerId);
    this.playerByCreationKeyHash.set(creationKeyHash, playerId);
    // The upcoming snapshot includes all current changes; keep later concurrent dirtiness intact.
    this.dirty = false;
    try {
      await this.store.flush();
      this.lastPersistAt = this.now();
    } catch {
      this.dirty = true;
      delete this.store.state.players[playerId];
      this.playerByTokenHash.delete(tokenHash);
      this.playerByCreationKeyHash.delete(creationKeyHash);
      this.sendError(context, "persistence_failed", "The new identity could not be saved.", requestId);
      console.error("multiplayer identity persistence failed");
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
    if (playerId === undefined || !player) {
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
    processGovernmentWorldDate(this.store.state);
    processElectionWorldDate(this.store.state, this.store.state.worldClock.world_date, this.now());
    processCareerWorldMinute(this.store.state, this.store.state.worldClock.world_date,
      this.store.state.worldClock.minute_of_day, this.now(), this.careerCatalog);
    context.playerId = playerId;
    this.online.set(playerId, context);
    const timestamp = new Date(this.now()).toISOString();
    player.lastSeen = timestamp;
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
    if (player.character.money < 150) {
      this.sendError(context, "insufficient_funds", "The bus fare is ₦150.", requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    player.character.money -= 150;
    player.character.current_location = "schoolyard";
    player.character.position = { x: 240, y: 650 };
    player.character.geographic_location = null;
    context.inputDirection = vectorZero();
    context.running = false;
    this.touchPlayer(player);
    this.sendCharacterSnapshot(context, requestId);
    this.broadcastPresence({ type: "presence.moved", player: this.toPresence(player, "connected") });
    await this.flushDirty();
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

  private async purchaseItem(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): Promise<void> {
    if (player.character.current_location !== "market" ||
      distance(player.character.position, { x: 1190, y: 440 }) > ENTITY_INTERACTION_RADIUS) {
      this.sendError(context, "interaction_out_of_range", "Visit the market shelf before buying.", requestId);
      return;
    }
    const definitions: Record<string, InventoryItem> = {
      meat_pie: { id: "meat_pie", name: "Meat pie", quantity: 1, category: "food", hunger_restore: 24 },
      bottled_water: { id: "bottled_water", name: "Bottled water", quantity: 1, category: "food", hunger_restore: 8 },
    };
    const prices: Record<string, number> = { meat_pie: 350, bottled_water: 100 };
    const itemId = message.itemId;
    if (typeof itemId !== "string" || !definitions[itemId]) {
      this.sendError(context, "item_unavailable", "That item is not available.", requestId);
      return;
    }
    const price = prices[itemId] ?? 0;
    if (player.character.money < price) {
      this.sendError(context, "insufficient_funds", `You need ₦${price}.`, requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    player.character.money -= price;
    this.addInventoryItem(player.character.inventory, definitions[itemId]);
    this.touchPlayer(player);
    this.sendCharacterSnapshot(context, requestId);
    await this.flushDirty();
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
    if (player.character.money < 300) {
      this.sendError(context, "insufficient_funds", "Basic care costs ₦300.", requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    player.character.money -= 300;
    player.character.health = clamp(player.character.health + 35, 0, 100);
    this.touchPlayer(player);
    this.sendCharacterSnapshot(context, requestId);
    await this.flushDirty();
  }

  private async rest(context: ConnectionContext, player: PersistentPlayer, requestId?: string): Promise<void> {
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
    this.sendCharacterSnapshot(context, requestId);
    await this.flushDirty();
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
      this.send(context, appendOptionalRequestId({ type: "education.result", ...result }, requestId));
      this.sendCharacterSnapshot(context);
      await this.flushDirty();
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
    this.send(context, appendOptionalRequestId({
      type: "career.result", action, ok: true, message: messageText, data,
    }, requestId));
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
          const result = purchaseMarketGood(state, characterId, goodId, quantity, locationId, date, minuteOfDay, now, this.economyCatalog);
          data.transaction = result.transaction;
          data.good = result.good;
          data.total_cost_ngn = result.total_cost_ngn;
          if (result.good.hunger_restore > 0 && quantity === 1) {
            player.character.hunger = Math.min(100, player.character.hunger + result.good.hunger_restore);
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
    this.send(context, appendOptionalRequestId({
      type: "economy.result", action, ok: true, message: messageText, data,
    }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
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

    try {
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
        case "add_product": {
          const product = addBusinessProduct(state, requiredString("business_id"), characterId,
            requiredString("product_definition_id"),
            payload.custom_price_ngn !== undefined ? requiredInteger("custom_price_ngn", 0) : null,
            date, minuteOfDay, now, this.businessCatalog);
          data.product = product;
          messageText = `Added '${product.display_name}' to the business at ₦${product.price_ngn.toLocaleString("en-NG")}.`;
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
        case "sell_product": {
          const buyerId = typeof payload.buyer_character_id === "string" ? payload.buyer_character_id : null;
          const result = sellProduct(state, requiredString("business_id"), requiredString("product_record_id"),
            buyerId, requiredInteger("quantity", 1), date, minuteOfDay, now, this.businessCatalog);
          data.sale = result.sale;
          data.revenue_transaction = result.revenue_transaction;
          messageText = `Sale of ${result.sale.quantity} × ₦${result.sale.unit_price_ngn.toLocaleString("en-NG")} = ₦${result.sale.total_ngn.toLocaleString("en-NG")}.`;
          break;
        }
        case "sell_service": {
          const buyerId = typeof payload.buyer_character_id === "string" ? payload.buyer_character_id : null;
          const result = sellService(state, requiredString("business_id"), requiredString("product_record_id"),
            buyerId, date, minuteOfDay, now, this.businessCatalog);
          data.sale = result.sale;
          data.revenue_transaction = result.revenue_transaction;
          messageText = `Service sold for ₦${result.sale.total_ngn.toLocaleString("en-NG")}.`;
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
            typeof payload.share_percent === "number" ? payload.share_percent as number : 100,
            date, minuteOfDay, now);
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
    this.send(context, appendOptionalRequestId({
      type: "business.result", action, ok: true, message: messageText, data,
    }, requestId));
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
    const action = message.action;
    const payload = isRecord(message.payload) ? message.payload : {};
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
            requiredString("to_character_id"), date, minuteOfDay, now);
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

    this.markRequestProcessed(player, requestId);
    if (!["market", "view", "my_properties", "my_rentals"].includes(action)) this.touchPlayer(player);
    this.send(context, appendOptionalRequestId({
      type: "property.result", action, ok: true, message: messageText, data,
    }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
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

  private async progressRelationship(
    context: ConnectionContext,
    actor: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
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
    this.send(context, payload);
    if (targetEntry.context !== context) this.send(targetEntry.context, payload);
    this.sendCharacterSnapshot(context);
    this.sendCharacterSnapshot(targetEntry.context);
    await this.flushDirty();
  }

  private async recordChildbirth(
    context: ConnectionContext,
    parent: PersistentPlayer,
    message: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
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
      if (!spouse) continue;
      this.touchPlayer(spouse);
      const spouseContext = this.online.get(spouse.playerId);
      if (spouseContext) {
        this.send(spouseContext, payload);
        this.sendCharacterSnapshot(spouseContext);
      }
    }
    if (!this.online.has(parent.playerId)) this.send(context, payload);
    await this.flushDirty();
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
      this.sendCharacterSnapshot(context);
    }
    this.dirty = true;
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
    const ownedBusinesses = Object.values(this.store.state.businesses).filter((biz) => biz.owner_character_id === player.character.character_id);
    snapshot.business_profiles = ownedBusinesses.map((biz) => {
      try { return buildBusinessProfile(this.store.state, biz.business_id, this.businessCatalog); } catch { return null; }
    }).filter((profile): profile is NonNullable<typeof profile> => profile !== null);
    try { snapshot.property_profiles = getCharacterProperties(this.store.state, player.character.character_id); } catch { snapshot.property_profiles = []; }
    try { snapshot.rental_agreements = getCharacterRentals(this.store.state, player.character.character_id); } catch { snapshot.rental_agreements = []; }
    try { snapshot.government_appointments = getCharacterAppointments(this.store.state, player.character.character_id); } catch { snapshot.government_appointments = []; }
    try { const pp = getPoliticalProfile(this.store.state, player.character.character_id); if (pp) snapshot.political_profile = pp; } catch { /* ignore */ }
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

  private sendError(context: ConnectionContext, code: string, message: string, requestId?: string): void {
    this.send(context, appendOptionalRequestId({ type: "error", code, message }, requestId));
  }

  private invalid(context: ConnectionContext, code: string, requestId?: string): void {
    context.invalidCount += 1;
    this.sendError(context, code, "The request was not valid.", requestId);
    if (context.invalidCount >= MAX_INVALID_MESSAGES) context.socket.close(1008, "too many invalid requests");
  }

  private errorCode(error: unknown): string {
    return error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "internal_error";
  }

  private async flushDirty(): Promise<void> {
    if (!this.dirty || this.flushInFlight) return;
    this.flushInFlight = true;
    this.dirty = false;
    let writeFailed = false;
    try {
      await this.store.flush();
      this.lastPersistAt = this.now();
    } catch {
      writeFailed = true;
      this.dirty = true;
      console.error("multiplayer persistence failed");
      for (const context of this.online.values()) this.sendError(context, "persistence_failed", "Server state could not be saved.");
    } finally {
      this.flushInFlight = false;
      if (this.dirty && !writeFailed && !this.closed) void this.flushDirty();
    }
  }
}
