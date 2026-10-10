import { database, DatabaseConnection } from "./connection.js";
import { initialState, validateState, type WorldStoreLike } from "../multiplayer/persistence.js";
import { WORLD_ID, type PersistentWorldState } from "../multiplayer/types.js";
import type { HealthCheck } from "../monitoring.js";
import { monitoring } from "../monitoring.js";
import { performance } from "node:perf_hooks";

/**
 * PostgreSQL-backed world state for Naija: One World.
 *
 * The authoritative world is one JSONB snapshot in the existing world_state table, keyed by
 * the world identifier. Every save is a single conditional UPDATE:
 *
 *   UPDATE world_state SET value = $new, version = version + 1
 *   WHERE key = $key AND version = $the_version_this_instance_loaded
 *
 * If another writer has saved since this instance loaded (version mismatch), the update
 * affects zero rows. The instance is then FENCED: it refuses every further save until it is
 * restarted and reloads the current state. This prevents a stale instance from silently
 * overwriting another instance's authoritative state.
 *
 * Limitations (see docs/STAGE_28_AUDIT.md section 11.9 and docs/STAGE_28_OPERATIONS_REVIEW.md):
 * - Whole-world snapshots: each save rewrites the full state. Acceptable for the current size
 *   limit (16 MiB), not for large worlds.
 * - A save whose response is lost after the server committed it is reported as a failure. The
 *   next save then fences this instance, which requires a restart. This is fail-closed, not
 *   silently lossy.
 * - A process killed while its UPDATE waits on a row lock can still have that UPDATE commit once
 *   the lock is released (observed in test/multiprocess-persistence.test.mjs). A restart loads
 *   whatever is committed; the killed process never learns the outcome.
 */

export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export class WorldStateConflictError extends Error {
  constructor() {
    super("World state was changed by another writer. This instance is fenced and must restart before saving again.");
    this.name = "WorldStateConflictError";
  }
}

export class PostgresWorldStore implements WorldStoreLike {
  private version: number;
  private fenced = false;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly db: DatabaseConnection,
    private readonly worldKey: string,
    readonly state: PersistentWorldState,
    version: number,
  ) {
    this.version = version;
  }

  /**
   * Load the world, creating the initial snapshot if none exists.
   * Safe when several instances start at once: only one insert wins, the others load its row.
   */
  static async open(options: { db?: DatabaseConnection; worldKey?: string; now?: number } = {}): Promise<PostgresWorldStore> {
    const db = options.db ?? database;
    const worldKey = options.worldKey ?? WORLD_ID;
    const now = options.now ?? Date.now();

    let row = await db.queryOne<{ value: unknown; version: string | number }>(
      "SELECT value, version FROM world_state WHERE key = $1",
      [worldKey],
    );
    if (!row) {
      const fresh = initialState(now);
      const inserted = await db.query(
        "INSERT INTO world_state (key, value, version) VALUES ($1, $2::jsonb, 1) ON CONFLICT (key) DO NOTHING RETURNING version",
        [worldKey, JSON.stringify(fresh)],
      );
      if (inserted.length > 0) {
        return new PostgresWorldStore(db, worldKey, fresh, 1);
      }
      row = await db.queryOne<{ value: unknown; version: string | number }>(
        "SELECT value, version FROM world_state WHERE key = $1",
        [worldKey],
      );
      if (!row) {
        throw new Error("World state row is missing after initialization.");
      }
    }

    const state = validateState(row.value, now);
    return new PostgresWorldStore(db, worldKey, state, Number(row.version));
  }

  /** Version this instance last loaded or saved. Exposed for health reporting and tests. */
  getVersion(): number {
    return this.version;
  }

  isFenced(): boolean {
    return this.fenced;
  }

  async flush(): Promise<void> {
    const started = performance.now();
    const write = async (): Promise<void> => {
      try {
        await this.writeSnapshot();
        monitoring.recordPersistenceFlush(true, performance.now() - started);
      } catch (error) {
        monitoring.recordPersistenceFlush(false, performance.now() - started);
        throw error;
      }
    };
    // Saves are serialized per instance; the database version check orders them across instances.
    const nextWrite = this.writeQueue.then(write, write);
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  private async writeSnapshot(): Promise<void> {
    if (this.fenced) {
      throw new WorldStateConflictError();
    }
    const snapshot = JSON.stringify(this.state);
    if (Buffer.byteLength(snapshot, "utf8") > MAX_SNAPSHOT_BYTES) {
      throw new Error("World state exceeds the snapshot size limit.");
    }
    const rows = await this.db.query<{ version: string | number }>(
      `UPDATE world_state
          SET value = $1::jsonb, version = version + 1, updated_at = NOW()
        WHERE key = $2 AND version = $3
        RETURNING version`,
      [snapshot, this.worldKey, this.version],
    );
    if (rows.length === 0) {
      this.fenced = true;
      throw new WorldStateConflictError();
    }
    this.version = Number(rows[0]!.version);
  }

  /** Health of this store: fenced stores and unreachable databases report failure. */
  async health(): Promise<HealthCheck> {
    if (this.fenced) {
      return { status: "fail", message: "World state was superseded by another writer; restart required." };
    }
    const result = await this.db.healthCheck();
    if (!result.healthy) {
      return { status: "fail", message: "PostgreSQL is unreachable or not responding." };
    }
    return {
      status: "pass",
      message: `PostgreSQL reachable; world state version ${this.version}.`,
      duration_ms: result.latencyMs,
    };
  }
}
