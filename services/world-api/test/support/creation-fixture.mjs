import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore } from "../../dist/multiplayer/persistence.js";
import { FaultyStore } from "./faulty-store.mjs";
import { startApi, stopApi } from "./harness.mjs";

/** Shared helpers for identity-creation tests. Nothing here logs or prints a creation key or token. */

export const TEST_PROFILE = {
  name: "Ada",
  age: 16,
  character_type: "girl",
  appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
};

export const NO_TICKS = { tickIntervalMs: 3_600_000 };

export function newCreationKey() {
  return randomBytes(32).toString("hex");
}

export function keyHashOf(creationKey) {
  return createHash("sha256").update(creationKey).digest("hex");
}

export function createMessage(creationKey, name = "Ada") {
  return { type: "identity.create", creationKey, profile: { ...TEST_PROFILE, name } };
}

export function tempDirectory(prefix = "naija-creation-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A file-backed store wrapped for fault injection. Uses a temporary file only. */
export function openFileBackend() {
  const directory = tempDirectory();
  const file = join(directory, "world-state.json");
  const store = new FaultyStore(new WorldStore(file, Date.now()));
  return {
    name: "file",
    store,
    async durableState() {
      return JSON.parse(readFileSync(file, "utf8"));
    },
    async cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Record counts used by the orphan and count checks. */
export function recordCounts(state) {
  return {
    players: Object.keys(state.players).length,
    people: Object.keys(state.people).length,
    households: Object.keys(state.households).length,
    families: Object.keys(state.families).length,
  };
}

/**
 * Orphan check: every household must be the home of some player's character, and every family
 * must be referenced by some player's character. Returns a list of problems (empty when clean).
 */
export function orphanProblems(state) {
  const problems = [];
  const referencedPeople = new Set([
    ...Object.values(state.players).map((player) => player.character.character_id),
    ...Object.values(state.households).flatMap((household) => household.member_ids ?? []),
    ...Object.values(state.families).flatMap((family) => family.member_ids ?? []),
  ]);
  for (const id of Object.keys(state.people)) {
    if (!referencedPeople.has(id)) problems.push(`person without a household or family: ${id}`);
  }
  const householdIds = new Set(Object.values(state.players).map((player) => player.character.household_id));
  for (const id of Object.keys(state.households)) {
    if (!householdIds.has(id)) problems.push(`household without a player: ${id}`);
  }
  const familyIds = new Set(Object.values(state.players).flatMap((player) => player.character.family_ids ?? []));
  for (const id of Object.keys(state.families)) {
    if (!familyIds.has(id)) problems.push(`family without a player: ${id}`);
  }
  return problems;
}

/** Start an API server over a fault-injecting store. Returns helpers and a cleanup function. */
export async function startCreationServer(backend, options = {}) {
  const started = await startApi({
    worldStore: backend.store,
    allowedOrigins: [],
    ...NO_TICKS,
    ...options,
  });
  return {
    ...started,
    async stop() {
      await stopApi(started.server);
    },
  };
}

export function uniqueWorldKey() {
  return `test-creation-${randomUUID()}`;
}
