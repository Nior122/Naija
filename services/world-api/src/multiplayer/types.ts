import type { GeographicLocation } from "../geography/types.js";
import type { StudentEducationRecord } from "../education/types.js";
import type { WorldClockState } from "../life/calendar.js";
import type { CareerProfileSnapshot, PersistentCareerMaps } from "../careers/types.js";
import type { EconomyProfileSnapshot, PersistentEconomyMaps } from "../economy/types.js";
import type { BusinessProfileSnapshot, PersistentBusinessMaps } from "../businesses/types.js";
import type {
  FamilyPersonRecord,
  FamilyRecord,
  HouseholdRecord,
  InheritanceEventRecord,
  LifeEventRecord,
  LifeProfileSnapshot,
  MarriageRecord,
  RelationshipRecord,
  CharacterLifeFields,
} from "../life/types.js";

export const WORLD_ID = "nigeria-main" as const;
export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 900;
export const STARTING_POSITION = { x: 720, y: 540 } as const;

export interface Point2D {
  x: number;
  y: number;
}

export type { WorldClockState } from "../life/calendar.js";

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  category: string;
  hunger_restore?: number;
}

/** Mirrors the Stage 1 CharacterState JSON fields; server-owned online state. */
export interface CharacterRecord extends CharacterLifeFields {
  player_id: string;
  character_id: string;
  name: string;
  age: number;
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
  education_record: StudentEducationRecord;
  reputation: number;
  household: Record<string, unknown>;
  geographic_location: GeographicLocation | null;
  created_at: string;
  updated_at: string;
  life_profile?: LifeProfileSnapshot;
  /** Private projection of employment data for this character's authenticated session only. */
  career_profile?: CareerProfileSnapshot;
  /** Private projection of economy data for this character's authenticated session only. */
  economy_profile?: EconomyProfileSnapshot;
  /** List of business profile snapshots for businesses this character owns or manages. */
  business_profiles?: BusinessProfileSnapshot[];
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

export interface PersistentWorldState extends PersistentCareerMaps, PersistentEconomyMaps, PersistentBusinessMaps {
  schemaVersion: 5;
  worldId: typeof WORLD_ID;
  worldClock: WorldClockState;
  players: Record<string, PersistentPlayer>;
  people: Record<string, FamilyPersonRecord>;
  households: Record<string, HouseholdRecord>;
  families: Record<string, FamilyRecord>;
  relationships: Record<string, RelationshipRecord>;
  lifeEvents: Record<string, LifeEventRecord>;
  marriages: Record<string, MarriageRecord>;
  inheritanceEvents: Record<string, InheritanceEventRecord>;
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
