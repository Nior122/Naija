/**
 * World Identity Management
 * 
 * Ensures there is exactly one authoritative Nigerian world across all servers.
 * Prevents accidental creation of duplicate worlds during server restarts or scaling.
 */

import { randomUUID } from "node:crypto";

export const WORLD_ID = "nigeria-main";
export const WORLD_VERSION = "1.0.0";

export interface WorldIdentity {
  readonly worldId: string;
  readonly worldVersion: string;
  readonly createdAt: string;
  readonly lastValidated: string;
  readonly authoritative: boolean;
}

export interface WorldValidationResult {
  valid: boolean;
  reason?: string;
  worldIdentity?: WorldIdentity;
}

/**
 * Validates that a world state belongs to the authoritative Nigeria world.
 * Prevents accidental forking into multiple independent worlds.
 */
export function validateWorldIdentity(worldId: string, worldVersion?: string): WorldValidationResult {
  if (worldId !== WORLD_ID) {
    return {
      valid: false,
      reason: `World ID mismatch: expected ${WORLD_ID}, got ${worldId}. This would create a separate world.`,
    };
  }

  // Version check is informational for now - we accept older versions but log warnings
  if (worldVersion && worldVersion !== WORLD_VERSION) {
    console.warn(`World version mismatch: expected ${WORLD_VERSION}, got ${worldVersion}. Migration may be needed.`);
  }

  return {
    valid: true,
    worldIdentity: {
      worldId: WORLD_ID,
      worldVersion: WORLD_VERSION,
      createdAt: new Date().toISOString(),
      lastValidated: new Date().toISOString(),
      authoritative: true,
    },
  };
}

/**
 * Ensures a new world state cannot accidentally create a second Nigeria.
 * This is a safety check during server initialization.
 */
export function assertSingleAuthoritativeWorld(existingWorldId: string | undefined): void {
  if (existingWorldId && existingWorldId !== WORLD_ID) {
    throw new Error(
      `CRITICAL: Attempted to load world with ID ${existingWorldId}. ` +
      `Only ${WORLD_ID} is authoritative. This would create a separate Nigerian world, ` +
      `violating the one-world principle.`
    );
  }
}

/**
 * Generates a unique instance ID for this server/process.
 * Used for tracking which server owns which regions.
 */
export function generateServerInstanceId(): string {
  return `server-${randomUUID().substring(0, 8)}`;
}

/**
 * Metadata about the authoritative world for diagnostics and monitoring.
 */
export const WORLD_METADATA = {
  worldId: WORLD_ID,
  worldVersion: WORLD_VERSION,
  worldName: "Nigeria",
  worldDescription: "One persistent Nigerian world shared by all players",
  topology: "single-logical-world",
  authoritativeServer: true,
  supportsMultiplePhysicalServers: true,
  dataClassification: {
    global: ["world_identity", "national_government", "election_results", "currency_rules"],
    player: ["character", "inventory", "education", "employment", "family"],
    financial: ["accounts", "transactions", "businesses", "properties", "loans"],
    regional: ["npc_state", "local_environment", "nearby_players"],
    transient: ["movement_updates", "presence", "session_state"],
  },
} as const;
