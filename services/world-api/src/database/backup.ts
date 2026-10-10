import { createHash } from "node:crypto";
import { validateState } from "../multiplayer/persistence.js";
import type { DatabaseConnection } from "./connection.js";

/**
 * Backup and restore of one world document (the `world_state` row), Stage 28.
 *
 * Scope: this covers the snapshot the engine actually uses. The account, character and session tables are not
 * part of the engine's state (see docs/STAGE_28_ACCOUNT_CHARACTER_DESIGN.md), so they are not in these backups.
 *
 * Safety rules:
 * - A backup is accepted only if its format, its SHA-256 digest of the canonical snapshot, and the engine's
 *   own snapshot validation all pass. Any failure throws before anything is written.
 * - Restore never overwrites: it inserts a new key and fails if that key already exists.
 * - This module has no command-line entry point. Running it against live data is a separate, reviewed step.
 */

export const BACKUP_FORMAT = "naija-world-backup";
export const BACKUP_FORMAT_VERSION = 1;

export interface WorldBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  worldKey: string;
  stateVersion: number;
  exportedAt: string;
  /** SHA-256 hex digest of the canonical JSON of `snapshot`. */
  sha256: string;
  snapshot: unknown;
}

export type BackupErrorCode =
  | "backup_format_invalid"
  | "backup_checksum_mismatch"
  | "backup_snapshot_invalid"
  | "backup_world_missing"
  | "backup_target_exists";

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** JSON with object keys sorted at every level, so equal values always produce equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function snapshotDigest(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

/**
 * Reads the stored world document and wraps it with its digest. The stored value is not normalised, so the
 * backup holds exactly what the database holds. It must pass the engine's validation to be exported.
 */
export async function exportWorldBackup(
  db: DatabaseConnection,
  worldKey: string,
  now: number = Date.now(),
): Promise<WorldBackup> {
  const row = await db.queryOne<{ value: unknown; version: string | number }>(
    "SELECT value, version FROM world_state WHERE key = $1",
    [worldKey],
  );
  if (!row) {
    throw new BackupError("backup_world_missing", "No world document exists for that key.");
  }
  // Validate a copy: validateState may normalise what it is given.
  validateSnapshot(structuredClone(row.value), now);
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    worldKey,
    stateVersion: Number(row.version),
    exportedAt: new Date(now).toISOString(),
    sha256: snapshotDigest(row.value),
    snapshot: row.value,
  };
}

/** Checks a backup object read from a file. Throws BackupError; never writes. */
export function verifyWorldBackup(input: unknown, now: number = Date.now()): WorldBackup {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new BackupError("backup_format_invalid", "Backup is not an object.");
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.format !== BACKUP_FORMAT || candidate.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupError("backup_format_invalid", "Backup format or version is not supported.");
  }
  if (typeof candidate.worldKey !== "string" || candidate.worldKey.length === 0 || candidate.worldKey.length > 255) {
    throw new BackupError("backup_format_invalid", "Backup world key is missing or invalid.");
  }
  if (!Number.isSafeInteger(candidate.stateVersion) || (candidate.stateVersion as number) < 1) {
    throw new BackupError("backup_format_invalid", "Backup state version is missing or invalid.");
  }
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
    throw new BackupError("backup_format_invalid", "Backup checksum is missing or malformed.");
  }
  if (snapshotDigest(candidate.snapshot) !== candidate.sha256) {
    throw new BackupError("backup_checksum_mismatch", "Backup checksum does not match its snapshot.");
  }
  validateSnapshot(structuredClone(candidate.snapshot), now);
  return candidate as unknown as WorldBackup;
}

function validateSnapshot(snapshot: unknown, now: number): void {
  try {
    validateState(snapshot, now);
  } catch {
    throw new BackupError("backup_snapshot_invalid", "Backup snapshot fails the engine's validation.");
  }
}

/**
 * Inserts a verified backup under a new key. Fails without changing anything if the key already exists or the
 * backup is invalid. The restored row keeps the backup's state version.
 */
export async function restoreWorldBackup(
  db: DatabaseConnection,
  backup: unknown,
  targetKey: string,
  now: number = Date.now(),
): Promise<{ worldKey: string; version: number }> {
  const verified = verifyWorldBackup(backup, now);
  if (typeof targetKey !== "string" || targetKey.length === 0 || targetKey.length > 255) {
    throw new BackupError("backup_format_invalid", "Target world key is missing or invalid.");
  }
  const inserted = await db.query<{ version: string | number }>(
    `INSERT INTO world_state (key, value, version)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO NOTHING
     RETURNING version`,
    [targetKey, JSON.stringify(verified.snapshot), verified.stateVersion],
  );
  const row = inserted[0];
  if (!row) {
    throw new BackupError("backup_target_exists", "A world already exists under the target key; nothing was restored.");
  }
  return { worldKey: targetKey, version: Number(row.version) };
}
