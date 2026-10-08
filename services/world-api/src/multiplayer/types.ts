import type { GeographicLocation } from "../geography/types.js";

export const WORLD_ID = "nigeria-main" as const;
export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 900;
export const STARTING_POSITION = { x: 720, y: 540 } as const;

export interface Point2D {
  x: number;
  y: number;
}

export interface WorldClockState {
  day: number;
  minute_of_day: number;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  category: string;
  hunger_restore?: number;
}

/** Mirrors the Stage 1 CharacterState JSON fields; server-owned online state. */
export interface CharacterRecord {
  player_id: string;
  character_id: string;
  name: string;
  age: 15 | 16;
  character_type: "girl" | "boy" | "androgynous";
  appearance: Record<string, string>;
  money: number;
  health: number;
  energy: number;
  hunger: number;
  education_level: string;
  school_id: string;
  home_id: string;
  current_location: string;
  position: Point2D;
  direction: Point2D;
  inventory: InventoryItem[];
  academic_scores: Record<string, number>;
  attendance: Array<Record<string, string | number>>;
  reputation: number;
  household: Record<string, unknown>;
  geographic_location: GeographicLocation | null;
  created_at: string;
  updated_at: string;
}

export interface PersistentPlayer {
  playerId: string;
  tokenHash: string;
  creationKeyHash: string;
  recentRequestIds: string[];
  createdAt: string;
  lastSeen: string;
  character: CharacterRecord;
}

export interface PersistentWorldState {
  schemaVersion: 1;
  worldId: typeof WORLD_ID;
  worldClock: WorldClockState;
  players: Record<string, PersistentPlayer>;
}

export interface PublicPresence {
  playerId: string;
  characterId: string;
  characterName: string;
  worldLocation: string;
  position: Point2D;
  direction: Point2D;
  connectionStatus: "connected" | "disconnected";
  lastSeen: string;
  appearance: Record<string, string>;
  geographicLocation: GeographicLocation | null;
  regionId: string | null;
  chunkId: string | null;
}

export interface ServerOptions {
  readonly stateFile?: string;
  readonly tickIntervalMs?: number;
  readonly gameMinuteMs?: number;
  readonly broadcastIntervalMs?: number;
  readonly maxConnections?: number;
  readonly connectionAttemptsPerMinute?: number;
  readonly allowedOrigins?: readonly string[];
  readonly websocketPath?: string;
  readonly now?: () => number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
