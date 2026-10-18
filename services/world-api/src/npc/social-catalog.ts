import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NPCSocialAction, NPCSocialActivity } from "./types.js";

/**
 * Stage 42 NPC social catalog (game/data/npc/social_catalog.json). It holds the activity hours, bond thresholds,
 * action rules, dialogue, and the fixed set of neighbourhood residents. It is data, not player input: the server
 * reads it once and never takes a value from a client.
 */
const CATALOG_FILE = "game/data/npc/social_catalog.json";
export const NPC_SOCIAL_ACTIONS: readonly NPCSocialAction[] = ["greet", "talk", "acquaint", "argue", "apologise"];
export const NPC_SOCIAL_ACTIVITIES: readonly NPCSocialActivity[] = ["sleeping", "studying", "socializing", "relaxing"];
const DIALOGUE_CONTEXTS: Readonly<Record<"greet" | "talk", readonly string[]>> = {
  greet: ["first_meeting", "returning", "family", "friend", "hostile"],
  talk: ["stranger", "acquaintance", "family", "friend", "hostile"],
};
const MAX_LINE_LENGTH = 240;

export interface NPCSocialActivityState {
  readonly activity: NPCSocialActivity;
  readonly label: string;
  readonly location_id: string;
  readonly location_label: string;
}

export interface NPCSocialResident {
  readonly person_id: string;
  readonly name: string;
  readonly age: number;
  readonly household_key: string;
  readonly home_type: string;
}

export interface NPCSocialCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly activity: {
    readonly sleep_start_hour: number;
    readonly sleep_end_hour: number;
    readonly school_start_hour: number;
    readonly school_end_hour: number;
    readonly school_age_min: number;
    readonly school_age_max: number;
    readonly socialising_start_hour: number;
    readonly socialising_end_hour: number;
    readonly states: readonly NPCSocialActivityState[];
  };
  readonly bonds: {
    readonly affinity_min: number;
    readonly affinity_max: number;
    readonly start_affinity_neighbour: number;
    readonly start_affinity_household: number;
    readonly hostile_at_or_below: number;
    readonly friend_at_or_above: number;
    readonly friend_min_talks: number;
    readonly acquaint_min_affinity: number;
    readonly history_limit: number;
  };
  readonly actions: Readonly<Record<NPCSocialAction, { label: string; affinity_change: number; cooldown_minutes: number }>>;
  readonly dialogue: {
    readonly greet: Readonly<Record<string, readonly string[]>>;
    readonly talk: Readonly<Record<string, readonly string[]>>;
    readonly acquaint: Readonly<Record<string, readonly string[]>>;
    readonly argue: Readonly<Record<string, readonly string[]>>;
    readonly apologise: Readonly<Record<string, readonly string[]>>;
  };
  readonly residents: readonly NPCSocialResident[];
  readonly neighbourhood_id: string;
}

let cachedCatalog: NPCSocialCatalog | null = null;

function repositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, CATALOG_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate ${CATALOG_FILE}; the NPC social catalog is required.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHour(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 23;
}

function isLine(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_LINE_LENGTH;
}

function fail(reason: string): never {
  throw new Error(`NPC social catalog is invalid: ${reason}`);
}

function validateDialogue(
  action: "greet" | "talk" | "acquaint" | "argue" | "apologise",
  block: unknown,
): Record<string, readonly string[]> {
  if (!isRecord(block)) fail(`dialogue.${action} must be an object`);
  const contexts: readonly string[] = action === "greet" || action === "talk" ? DIALOGUE_CONTEXTS[action] : ["success"];
  const out: Record<string, readonly string[]> = {};
  for (const context of contexts) {
    const lines = block[context];
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 5 || !lines.every(isLine)) {
      fail(`dialogue.${action}.${context} needs 1 to 5 non-empty lines`);
    }
    out[context] = lines as string[];
  }
  return out;
}

function validate(parsed: unknown): NPCSocialCatalog {
  if (!isRecord(parsed) || parsed.schema_version !== 1 || parsed.world_id !== "nigeria-main") {
    fail("schema_version or world_id is wrong");
  }
  const catalog = parsed as unknown as NPCSocialCatalog;
  const activity = catalog.activity;
  if (!isRecord(activity) || !isHour(activity.sleep_start_hour) || !isHour(activity.sleep_end_hour) ||
    !isHour(activity.school_start_hour) || !isHour(activity.school_end_hour) ||
    !isHour(activity.socialising_start_hour) || !isHour(activity.socialising_end_hour)) {
    fail("activity hours must be whole hours from 0 to 23");
  }
  if (activity.school_start_hour >= activity.school_end_hour) fail("school hours must start before they end");
  if (activity.socialising_start_hour >= activity.socialising_end_hour) fail("socialising hours must start before they end");
  if (activity.sleep_start_hour === activity.sleep_end_hour) fail("sleep hours must not be empty");
  if (!Number.isSafeInteger(activity.school_age_min) || !Number.isSafeInteger(activity.school_age_max) ||
    activity.school_age_min < 0 || activity.school_age_max < activity.school_age_min) {
    fail("school age range is invalid");
  }
  const states = Array.isArray(activity.states) ? activity.states : [];
  const stateNames = states.map((state) => (isRecord(state) ? state.activity : undefined));
  if (states.length !== NPC_SOCIAL_ACTIVITIES.length ||
    !NPC_SOCIAL_ACTIVITIES.every((name) => stateNames.filter((n) => n === name).length === 1)) {
    fail("activity states must list each of the four states exactly once");
  }
  for (const state of states) {
    if (!isRecord(state) || typeof state.label !== "string" || typeof state.location_id !== "string" ||
      typeof state.location_label !== "string" || state.location_id.length === 0) {
      fail("each activity state needs a label and a location");
    }
  }
  const bonds = catalog.bonds;
  if (!isRecord(bonds) || !Number.isSafeInteger(bonds.affinity_min) || !Number.isSafeInteger(bonds.affinity_max) ||
    bonds.affinity_min >= bonds.affinity_max || bonds.affinity_min > 0 || bonds.affinity_max < 0 ||
    !Number.isSafeInteger(bonds.start_affinity_neighbour) || !Number.isSafeInteger(bonds.start_affinity_household) ||
    !Number.isSafeInteger(bonds.hostile_at_or_below) || !Number.isSafeInteger(bonds.friend_at_or_above) ||
    !Number.isSafeInteger(bonds.friend_min_talks) || bonds.friend_min_talks < 0 ||
    !Number.isSafeInteger(bonds.acquaint_min_affinity) || !Number.isSafeInteger(bonds.history_limit) ||
    bonds.history_limit < 1 || bonds.history_limit > 100 || bonds.hostile_at_or_below >= bonds.friend_at_or_above) {
    fail("bond thresholds are invalid");
  }
  const actions: Record<string, unknown> = isRecord(catalog.actions) ? catalog.actions : {};
  for (const name of NPC_SOCIAL_ACTIONS) {
    const rule = actions[name];
    if (!isRecord(rule) || typeof rule.label !== "string" || rule.label.trim().length === 0 ||
      !Number.isSafeInteger(rule.affinity_change) || Math.abs(rule.affinity_change as number) > 50 ||
      !Number.isSafeInteger(rule.cooldown_minutes) || (rule.cooldown_minutes as number) < 0 ||
      (rule.cooldown_minutes as number) > 1440) {
      fail(`action ${name} needs a label, an affinity change, and a cooldown`);
    }
  }
  if (Object.keys(actions).length !== NPC_SOCIAL_ACTIONS.length) fail("actions must list exactly the five Stage 42 actions");
  const dialogue: Record<string, unknown> = isRecord(catalog.dialogue) ? catalog.dialogue : {};
  const checkedDialogue = {
    greet: validateDialogue("greet", dialogue.greet),
    talk: validateDialogue("talk", dialogue.talk),
    acquaint: validateDialogue("acquaint", dialogue.acquaint),
    argue: validateDialogue("argue", dialogue.argue),
    apologise: validateDialogue("apologise", dialogue.apologise),
  };
  if (!Array.isArray(catalog.residents) || catalog.residents.length === 0 || catalog.residents.length > 50) {
    fail("residents must list between 1 and 50 people");
  }
  const seen = new Set<string>();
  for (const resident of catalog.residents) {
    if (!isRecord(resident) || typeof resident.person_id !== "string" || !/^npc-nb-[a-z0-9-]{1,60}$/.test(resident.person_id) ||
      seen.has(resident.person_id) || typeof resident.name !== "string" || resident.name.trim().length === 0 ||
      resident.name.length > 80 || !Number.isSafeInteger(resident.age) || (resident.age as number) < 0 ||
      (resident.age as number) > 120 || typeof resident.household_key !== "string" ||
      !/^[a-z0-9-]{1,40}$/.test(resident.household_key) || typeof resident.home_type !== "string") {
      fail("each resident needs a unique npc-nb- id, a name, an age from 0 to 120, a household key, and a home type");
    }
    seen.add(resident.person_id);
  }
  if (typeof catalog.neighbourhood_id !== "string" || catalog.neighbourhood_id.length === 0) fail("neighbourhood_id is required");
  return { ...catalog, dialogue: checkedDialogue };
}

export function loadNPCSocialCatalog(): NPCSocialCatalog {
  if (cachedCatalog) return cachedCatalog;
  const parsed: unknown = JSON.parse(readFileSync(join(repositoryRoot(), CATALOG_FILE), "utf8"));
  cachedCatalog = validate(parsed);
  return cachedCatalog;
}

/** Label for a state, from the catalog. Unknown states are never produced by the server. */
export function activityStateFor(catalog: NPCSocialCatalog, activity: NPCSocialActivity): NPCSocialActivityState {
  const state = catalog.activity.states.find((entry) => entry.activity === activity);
  if (!state) throw new Error(`no activity state ${activity}`);
  return state;
}
