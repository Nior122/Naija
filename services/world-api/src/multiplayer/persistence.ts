import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  WORLD_ID,
  isFiniteNumber,
  isRecord,
  type CharacterRecord,
  type PersistentPlayer,
  type PersistentWorldState,
  type Point2D,
} from "./types.js";

const MAX_STATE_FILE_BYTES = 16 * 1024 * 1024;

function isPoint(value: unknown): value is Point2D {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isCharacter(value: unknown): value is CharacterRecord {
  if (!isRecord(value)) return false;
  if (
    typeof value.player_id !== "string" ||
    typeof value.character_id !== "string" ||
    typeof value.name !== "string" ||
    (value.age !== 15 && value.age !== 16) ||
    !["girl", "boy", "androgynous"].includes(String(value.character_type)) ||
    !isStringRecord(value.appearance) ||
    !isFiniteNumber(value.money) ||
    value.money < 0 ||
    !isFiniteNumber(value.health) ||
    value.health < 0 ||
    value.health > 100 ||
    !isFiniteNumber(value.energy) ||
    value.energy < 0 ||
    value.energy > 100 ||
    !isFiniteNumber(value.hunger) ||
    value.hunger < 0 ||
    value.hunger > 100 ||
    typeof value.education_level !== "string" ||
    typeof value.school_id !== "string" ||
    typeof value.home_id !== "string" ||
    typeof value.current_location !== "string" ||
    !isPoint(value.position) ||
    !isPoint(value.direction) ||
    !Array.isArray(value.inventory) ||
    !value.inventory.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        isFiniteNumber(item.quantity) &&
        item.quantity >= 0 &&
        typeof item.category === "string" &&
        (item.hunger_restore === undefined || isFiniteNumber(item.hunger_restore)),
    ) ||
    !isRecord(value.academic_scores) ||
    !Object.values(value.academic_scores).every(
      (score) => isFiniteNumber(score) && score >= 0 && score <= 100,
    ) ||
    !Array.isArray(value.attendance) ||
    !value.attendance.every(isRecord) ||
    !isFiniteNumber(value.reputation) ||
    !isRecord(value.household) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return false;
  }
  return true;
}

function isPersistentPlayer(value: unknown, playerId: string): value is PersistentPlayer {
  return (
    isRecord(value) &&
    value.playerId === playerId &&
    typeof value.tokenHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.tokenHash) &&
    typeof value.creationKeyHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.creationKeyHash) &&
    Array.isArray(value.recentRequestIds) &&
    value.recentRequestIds.length <= 256 &&
    value.recentRequestIds.every((requestId) => typeof requestId === "string" && requestId.length <= 80) &&
    typeof value.createdAt === "string" &&
    typeof value.lastSeen === "string" &&
    isCharacter(value.character) &&
    value.character.player_id === playerId
  );
}

function validateState(value: unknown): PersistentWorldState {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.worldId !== WORLD_ID ||
    !isRecord(value.worldClock) ||
    !isFiniteNumber(value.worldClock.day) ||
    value.worldClock.day < 1 ||
    !isFiniteNumber(value.worldClock.minute_of_day) ||
    value.worldClock.minute_of_day < 0 ||
    value.worldClock.minute_of_day >= 1440 ||
    typeof value.worldClock.updated_at !== "string" ||
    !isRecord(value.players)
  ) {
    throw new Error("World data has an invalid schema; refusing to start with reset state.");
  }

  for (const [playerId, player] of Object.entries(value.players)) {
    if (!isPersistentPlayer(player, playerId)) {
      throw new Error(`World data contains an invalid player record (${playerId}).`);
    }
  }

  return value as unknown as PersistentWorldState;
}

function initialState(now: number): PersistentWorldState {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    worldClock: {
      day: 1,
      minute_of_day: 7 * 60 + 50,
      updated_at: new Date(now).toISOString(),
    },
    players: {},
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
      if (size > MAX_STATE_FILE_BYTES) {
        throw new Error("World data file exceeds the 16 MiB prototype limit.");
      }
      this.state = validateState(JSON.parse(readFileSync(this.filePath, "utf8")) as unknown);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        this.state = initialState(now);
      } else {
        throw new Error(`Could not load multiplayer world data: ${String(error)}`, { cause: error });
      }
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
