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
const GUARDIAN_NAMES = [
  "Amina", "Bisi", "Chinwe", "Hauwa", "Ifeoma", "Kemi", "Ngozi", "Sadiya", "Tola", "Zainab",
];
const FAMILY_NAMES = ["Adeyemi", "Bello", "Eze", "Ibrahim", "Okafor", "Olawale", "Yusuf"];
const STARTING_SCORES: Record<string, number> = {
  Mathematics: 72,
  English: 68,
  "Computer Studies": 81,
  Biology: 64,
  "Civic Education": 75,
};
const TIMETABLE = [
  { minute: 480, subject: "Mathematics" },
  { minute: 540, subject: "English" },
  { minute: 600, subject: "Break" },
  { minute: 630, subject: "Computer Studies" },
  { minute: 690, subject: "Biology" },
  { minute: 750, subject: "Civic Education" },
] as const;
const QUESTIONS: Record<string, { question: string; options: string[]; correctIndex: number }> = {
  Mathematics: { question: "What is 7 × 8?", options: ["54", "56", "58"], correctIndex: 1 },
  English: {
    question: "Which sentence is grammatically correct?",
    options: ["She go to school.", "She goes to school.", "She going school."],
    correctIndex: 1,
  },
  "Computer Studies": {
    question: "Which part is often called the computer's brain?",
    options: ["CPU", "Keyboard", "Monitor"],
    correctIndex: 0,
  },
  Biology: {
    question: "What do green plants use to make food?",
    options: ["Sunlight", "Plastic", "Sand only"],
    correctIndex: 0,
  },
  "Civic Education": {
    question: "What is one responsibility of a citizen?",
    options: ["Respecting the law", "Ignoring neighbours", "Damaging public property"],
    correctIndex: 0,
  },
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
  },
  classroom: {
    "classroom-exit": {
      destination: "schoolyard", position: { x: 180, y: 650 }, spawn: { x: 1050, y: 560 },
    },
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
  readonly subject: string;
  readonly correctIndex: number;
  readonly day: number;
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

function makeHousehold(now: number): Record<string, unknown> {
  const familyName = FAMILY_NAMES[Math.floor(Math.random() * FAMILY_NAMES.length)] ?? "Adeyemi";
  const firstIndex = Math.floor(Math.random() * GUARDIAN_NAMES.length);
  let secondIndex = Math.floor(Math.random() * GUARDIAN_NAMES.length);
  while (secondIndex === firstIndex) secondIndex = Math.floor(Math.random() * GUARDIAN_NAMES.length);
  const id = `household-${randomUUID()}`;
  return {
    id,
    home_id: `home-${id}`,
    neighborhood_id: "idera-quarter",
    home_type: "Family compound home",
    rooms: ["Living area", "Bedroom", "Kitchen"],
    created_at: new Date(now).toISOString(),
    guardians: [
      { id: `npc-${randomUUID()}`, name: `${GUARDIAN_NAMES[firstIndex] ?? "Amina"} ${familyName}`, role: "parent" },
      { id: `npc-${randomUUID()}`, name: `${GUARDIAN_NAMES[secondIndex] ?? "Bisi"} ${familyName}`, role: "guardian" },
    ],
  };
}

function createCharacter(
  profile: Record<string, unknown>,
  playerId: string,
  now: number,
  geographyRegion: GeographicRegion,
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
  const household = makeHousehold(now);
  const timestamp = new Date(now).toISOString();
  let geographicLocation: CharacterRecord["geographic_location"] = null;
  let currentLocation = "home";
  let position: Point2D = { ...STARTING_POSITION };
  if (profile.geographic_location !== undefined && profile.geographic_location !== null) {
    geographicLocation = geographicLocationFromProfile(profile.geographic_location, geographyRegion);
    position = geographicLocationToMapPosition(geographicLocation, geographyRegion);
    currentLocation = "town";
  }
  return {
    player_id: playerId,
    character_id: `character-${randomUUID()}`,
    name,
    age,
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
    education_level: "Secondary school (prototype)",
    school_id: "idera_secondary_school",
    home_id: String(household.home_id),
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
    academic_scores: { ...STARTING_SCORES },
    attendance: [],
    reputation: 0,
    household,
    created_at: timestamp,
    updated_at: timestamp,
  };
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
  private lastTickAt: number;
  private lastBroadcastAt = 0;
  private lastPersistAt: number;
  private clockAccumulatorMs = 0;
  private dirty = false;
  private flushInFlight = false;
  private closed = false;

  constructor(private readonly store: WorldStore, options: WorldEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.gameMinuteMs = Math.max(100, options.gameMinuteMs ?? 650);
    this.broadcastIntervalMs = Math.max(50, options.broadcastIntervalMs ?? 100);
    this.maxConnections = Math.max(1, options.maxConnections ?? 64);
    this.connectionAttemptsPerMinute = Math.max(1, options.connectionAttemptsPerMinute ?? 30);
    this.geographyRegion = loadAkureSouthRegion();
    this.lastTickAt = this.now();
    this.lastPersistAt = this.lastTickAt;
    for (const player of Object.values(this.store.state.players)) {
      this.playerByTokenHash.set(player.tokenHash, player.playerId);
      this.playerByCreationKeyHash.set(player.creationKeyHash, player.playerId);
    }
  }

  get connectedPlayerCount(): number { return this.online.size; }
  get socketCount(): number { return this.contexts.size; }

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
    this.clockAccumulatorMs += elapsed;
    const deltaSeconds = elapsed / 1000;
    let changed = false;
    for (const context of this.online.values()) {
      const player = this.playerFor(context);
      if (!player) continue;
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
    while (this.clockAccumulatorMs >= this.gameMinuteMs) {
      this.clockAccumulatorMs -= this.gameMinuteMs;
      this.advanceWorldMinute(now);
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
      case "chat.send": this.handleChat(context, player, message, requestId); return;
      case "player.interact": this.handlePlayerInteraction(context, player, message, requestId); return;
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
      character = createCharacter(profile, playerId, this.now(), this.geographyRegion);
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
    context.playerId = playerId;
    this.online.set(playerId, context);
    const timestamp = new Date(this.now()).toISOString();
    player.lastSeen = timestamp;
    player.character.updated_at = timestamp;
    this.dirty = true;
    this.send(context, appendOptionalRequestId({
      type: "session.ready", playerId, character: safeClone(player.character),
      world: { id: WORLD_ID, clock: safeClone(this.store.state.worldClock) },
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

  private beginLesson(context: ConnectionContext, player: PersistentPlayer, requestId?: string): void {
    if (player.character.current_location !== "classroom" ||
      distance(player.character.position, { x: 820, y: 560 }) > ENTITY_INTERACTION_RADIUS) {
      this.sendError(context, "interaction_out_of_range", "Move to your desk to begin class.", requestId);
      return;
    }
    if (this.pendingQuizzes.has(player.playerId)) {
      this.sendError(context, "quiz_in_progress", "Finish the current class activity first.", requestId);
      return;
    }
    const subject = this.nextLessonSubject(player.character);
    if (!subject) {
      this.send(context, appendOptionalRequestId({ type: "school.complete" }, requestId));
      return;
    }
    const question = QUESTIONS[subject];
    if (!question) {
      this.sendError(context, "lesson_unavailable", "That lesson is not available.", requestId);
      return;
    }
    const quizId = randomUUID();
    this.pendingQuizzes.set(player.playerId, {
      quizId, subject, correctIndex: question.correctIndex, day: this.store.state.worldClock.day,
    });
    this.send(context, appendOptionalRequestId({
      type: "school.quiz", quizId, subject, question: question.question, options: question.options,
    }, requestId));
  }

  private async answerLesson(context: ConnectionContext, player: PersistentPlayer, message: Record<string, unknown>, requestId?: string): Promise<void> {
    const pending = this.pendingQuizzes.get(player.playerId);
    const answerIndex = message.answerIndex;
    if (!pending || message.quizId !== pending.quizId || !Number.isSafeInteger(answerIndex) ||
      typeof answerIndex !== "number" || answerIndex < 0 || answerIndex > 2) {
      this.sendError(context, "quiz_invalid", "The class activity response is invalid.", requestId);
      return;
    }
    if (player.character.current_location !== "classroom") {
      this.pendingQuizzes.delete(player.playerId);
      this.sendError(context, "quiz_invalid", "Return to class before answering.", requestId);
      return;
    }
    this.markRequestProcessed(player, requestId);
    const correct = answerIndex === pending.correctIndex;
    const previousScore = player.character.academic_scores[pending.subject] ?? 60;
    const activityScore = correct ? 95 : 45;
    const score = clamp(Math.round(previousScore * 0.7 + activityScore * 0.3), 0, 100);
    player.character.academic_scores[pending.subject] = score;
    player.character.attendance.push({
      day: pending.day, subject: pending.subject, score,
      attended_at: `Day ${pending.day} · ${this.clockLabel()}`,
    });
    if (player.character.attendance.length > 10_000) player.character.attendance.shift();
    this.pendingQuizzes.delete(player.playerId);
    this.touchPlayer(player);
    this.send(context, appendOptionalRequestId({ type: "school.result", subject: pending.subject, correct, score }, requestId));
    this.sendCharacterSnapshot(context);
    await this.flushDirty();
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

  private advanceWorldMinute(now: number): void {
    const clock = this.store.state.worldClock;
    if (clock.minute_of_day + 1 >= MINUTES_PER_DAY) {
      clock.day += 1;
      clock.minute_of_day = 0;
    } else clock.minute_of_day += 1;
    clock.updated_at = new Date(now).toISOString();
    for (const context of this.online.values()) {
      const player = this.playerFor(context);
      if (!player) continue;
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

  private clockLabel(): string {
    const minuteOfDay = this.store.state.worldClock.minute_of_day;
    return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
  }

  private nextLessonSubject(character: CharacterRecord): string | null {
    for (const lesson of TIMETABLE) {
      if (lesson.subject === "Break") continue;
      const attended = character.attendance.some((record) =>
        record.day === this.store.state.worldClock.day && record.subject === lesson.subject);
      if (!attended && this.store.state.worldClock.minute_of_day <= lesson.minute + 45) return lesson.subject;
    }
    return null;
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

  private sendCharacterSnapshot(context: ConnectionContext, requestId?: string): void {
    const player = this.playerFor(context);
    if (!player) return;
    this.send(context, appendOptionalRequestId({ type: "character.snapshot", character: safeClone(player.character) }, requestId));
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
      if (player && (player.playerId === viewerId || this.sharesGeographicInterest(viewer, player))) {
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
        clock: safeClone(this.store.state.worldClock),
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
