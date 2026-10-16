import { database, DatabaseConnection } from "./connection.js";
import { initialState, validateState, WorldStateCapacityError, type WorldStoreLike } from "../multiplayer/persistence.js";
import { WORLD_ID, type PersistentWorldState } from "../multiplayer/types.js";
import type { HealthCheck } from "../monitoring.js";
import { monitoring } from "../monitoring.js";
import { performance } from "node:perf_hooks";
import { classifySaveFailure, markSaveOutcome, SaveStatusTracker } from "../persistence-status.js";
import { OPERATION_RECORD_RETENTION_DAYS, type OperationRecord, type StoredOperation } from "../persistence/request-records.js";

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
 *
 * Stage 36: the UPDATE and the durable request records (world_operations, migration 3) are one transaction. A save
 * commits the world and the records of the requests it applied together, or neither. A save whose COMMIT outcome is
 * unknown is reported as unknown, and the instance fences on its next save.
 */

export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export class WorldStateConflictError extends Error {
  constructor() {
    super("World state was changed by another writer. This instance is fenced and must restart before saving again.");
    this.name = "WorldStateConflictError";
    // Raised only when the version check matched no row, so this write was not applied.
    markSaveOutcome(this, "not_saved");
  }
}

/**
 * A stored world is refused at load when its serialized size exceeds the save limit. The size is measured as the save
 * path measures it (compact JSON, UTF-8 bytes), so a row that the save path could have written loads, and a row it
 * could not write is refused. The row is not changed, truncated, or migrated. See docs/STAGE_28_PERSISTENCE_SAFETY.md.
 */
export class StoredWorldTooLargeError extends Error {
  constructor(readonly storedBytes: number) {
    super(
      `The stored world state is ${storedBytes} bytes, above the ${MAX_SNAPSHOT_BYTES}-byte limit. ` +
        "The server did not load it, and the database row was not changed. Review it under a documented plan.",
    );
    this.name = "StoredWorldTooLargeError";
  }
}

export class PostgresWorldStore implements WorldStoreLike {
  private version: number;
  private fenced = false;
  private writeQueue: Promise<void> = Promise.resolve();
  /** Stage 36: durable request records waiting for the next successful save (see queueOperation). */
  private queuedOperations: OperationRecord[] = [];
  /** Outcome of every save this instance has attempted (G1). Reported by health(). */
  readonly saveStatus = new SaveStatusTracker();

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

    // Size is checked before validation and before any write. An oversized row is refused, never loaded.
    const storedBytes = Buffer.byteLength(JSON.stringify(row.value), "utf8");
    if (storedBytes > MAX_SNAPSHOT_BYTES) {
      throw new StoredWorldTooLargeError(storedBytes);
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
    await this.saveState(this.state);
  }

  async saveState(candidate: PersistentWorldState): Promise<void> {
    const started = performance.now();
    const write = async (): Promise<void> => {
      try {
        await this.writeSnapshot(candidate);
        monitoring.recordPersistenceFlush(true, performance.now() - started);
        this.saveStatus.recordSuccess(Date.now());
      } catch (error) {
        monitoring.recordPersistenceFlush(false, performance.now() - started);
        this.saveStatus.recordFailure(classifySaveFailure(error), Date.now());
        throw error;
      }
    };
    // Saves are serialized per instance; the database version check orders them across instances.
    const nextWrite = this.writeQueue.then(write, write);
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  /**
   * Stage 36: record a request that the engine applied. The record is written by the next save that commits, in the same
   * transaction as the world. A record that is queued but never committed is never visible to another process.
   */
  queueOperation(record: OperationRecord): void {
    this.queuedOperations.push({ ...record });
  }

  /**
   * Stage 36: the durable record of a request ID for this world, or undefined when none exists. A query failure throws;
   * the caller must refuse the request in that case, not treat it as new.
   */
  async findOperation(playerId: string, requestId: string): Promise<StoredOperation | undefined> {
    const row = await this.db.queryOne<{ command: string; fingerprint: string; world_version: string | number }>(
      `SELECT command, fingerprint, world_version FROM world_operations
        WHERE world_key = $1 AND player_id = $2 AND request_id = $3`,
      [this.worldKey, playerId, requestId],
    );
    if (!row) return undefined;
    return { command: row.command, fingerprint: row.fingerprint, worldVersion: Number(row.world_version) };
  }

  private async writeSnapshot(state: PersistentWorldState): Promise<void> {
    if (this.fenced) {
      throw new WorldStateConflictError();
    }
    // Serialized when the write runs, so it reflects every earlier save in this instance.
    const snapshot = JSON.stringify(state);
    if (Buffer.byteLength(snapshot, "utf8") > MAX_SNAPSHOT_BYTES) {
      throw new WorldStateCapacityError();
    }
    // Records queued so far are written by this save. Records queued during the save stay queued for the next one.
    const batch = this.queuedOperations.slice();
    // Set once every statement in the transaction has run. An error after that point comes from COMMIT, so the
    // outcome is unknown: the commit may have happened. An error before it means the transaction was rolled back.
    let bodyFinished = false;
    let version: number;
    try {
      version = await this.db.transaction(async (client) => {
        const updated = await client.query<{ version: string | number }>(
          `UPDATE world_state
              SET value = $1::jsonb, version = version + 1, updated_at = NOW()
            WHERE key = $2 AND version = $3
            RETURNING version`,
          [snapshot, this.worldKey, this.version],
        );
        if (updated.rows.length === 0) {
          throw new WorldStateConflictError();
        }
        const newVersion = Number(updated.rows[0]!.version);
        for (const record of batch) {
          await client.query(
            `INSERT INTO world_operations (world_key, player_id, request_id, command, fingerprint, world_version)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [this.worldKey, record.playerId, record.requestId, record.command, record.fingerprint, newVersion],
          );
        }
        await client.query(
          `DELETE FROM world_operations
            WHERE ctid IN (
              SELECT ctid FROM world_operations
               WHERE world_key = $1 AND recorded_at < NOW() - make_interval(days => $2)
               LIMIT 1000
            )`,
          [this.worldKey, OPERATION_RECORD_RETENTION_DAYS],
        );
        bodyFinished = true;
        return newVersion;
      });
    } catch (error) {
      if (error instanceof WorldStateConflictError) {
        this.fenced = true;
      } else if (bodyFinished) {
        markSaveOutcome(error, "unknown");
      } else {
        markSaveOutcome(error, "not_saved");
      }
      throw error;
    }
    this.version = version;
    // The batch is committed with the world. Only those records are removed from the queue.
    this.queuedOperations = this.queuedOperations.filter((record) => !batch.includes(record));
    monitoring.recordWorldStateSaved(Buffer.byteLength(snapshot, "utf8"), Object.keys(state.players).length, MAX_SNAPSHOT_BYTES);
  }

  /**
   * Health of this store. Fenced stores, unreachable databases, and a failing latest save report failure. A reachable
   * database alone is not enough: the outcome of the latest save decides whether persistence is healthy (G1).
   */
  async health(): Promise<HealthCheck> {
    if (this.fenced) {
      return { status: "fail", message: "World state was superseded by another writer; restart required." };
    }
    const result = await this.db.healthCheck();
    if (!result.healthy) {
      return { status: "fail", message: "PostgreSQL is unreachable or not responding." };
    }
    const saves = this.saveStatus.check();
    if (saves.status === "fail") return saves;
    return {
      status: "pass",
      message: `PostgreSQL reachable; world state version ${this.version}.`,
      duration_ms: result.latencyMs,
    };
  }
}
