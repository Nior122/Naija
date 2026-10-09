import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { geographicLocationIsValid } from "../geography/catalog.js";
import { loadEducationCatalog } from "../education/catalog.js";
import { isEducationStudentRecord, normalizeEducationRecord, syncLegacyEducation } from "../education/service.js";
import { loadLifeCatalog, normalizeWorldClock, isValidDate } from "../life/calendar.js";
import { normalizeLifeWorldState } from "../life/service.js";
import type { LifeCatalog } from "../life/types.js";
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

function emptyLifeMaps(): Pick<
  PersistentWorldState,
  "people" | "households" | "families" | "relationships" | "lifeEvents" | "marriages" | "inheritanceEvents"
> {
  return {
    people: {}, households: {}, families: {}, relationships: {}, lifeEvents: {}, marriages: {}, inheritanceEvents: {},
  };
}

function validateState(value: unknown, now: number): PersistentWorldState {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    value.worldId !== WORLD_ID || !isRecord(value.worldClock) || !isRecord(value.players)) {
    throw new Error("World data has an invalid schema; refusing to start with reset state.");
  }
  const schemaVersion = value.schemaVersion;
  const clock = value.worldClock;
  if (!isFiniteNumber(clock.day) || !Number.isSafeInteger(clock.day) || clock.day < 1 ||
    !isFiniteNumber(clock.minute_of_day) || !Number.isSafeInteger(clock.minute_of_day) ||
    clock.minute_of_day < 0 || clock.minute_of_day >= 1440 || typeof clock.updated_at !== "string") {
    throw new Error("World data has an invalid clock; refusing to start with reset state.");
  }
  if (schemaVersion === 2) {
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

  const catalog: LifeCatalog = loadLifeCatalog();
  const state = {
    schemaVersion: 2 as const,
    worldId: WORLD_ID,
    worldClock: normalizeWorldClock(clock, now, catalog),
    players: {} as Record<string, PersistentPlayer>,
    ...(schemaVersion === 2 ? {
      people: value.people as PersistentWorldState["people"],
      households: value.households as PersistentWorldState["households"],
      families: value.families as PersistentWorldState["families"],
      relationships: value.relationships as PersistentWorldState["relationships"],
      lifeEvents: value.lifeEvents as PersistentWorldState["lifeEvents"],
      marriages: value.marriages as PersistentWorldState["marriages"],
      inheritanceEvents: value.inheritanceEvents as PersistentWorldState["inheritanceEvents"],
    } : emptyLifeMaps()),
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
    if (schemaVersion === 2 && (!isRecord(rawPlayer.character) || !hasLifeFields(rawPlayer.character))) {
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
  return state;
}

function initialState(now: number): PersistentWorldState {
  const catalog = loadLifeCatalog();
  return {
    schemaVersion: 2,
    worldId: WORLD_ID,
    worldClock: normalizeWorldClock({
      day: catalog.calendar.starting_world_day,
      minute_of_day: catalog.calendar.starting_minute_of_day,
      millisecond_of_minute: 0,
      updated_at: new Date(now).toISOString(),
    }, now, catalog),
    players: {},
    ...emptyLifeMaps(),
  };
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
