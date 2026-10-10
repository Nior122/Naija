import { DatabaseConnection, loadDatabaseConfigFromEnv } from "../database/connection.js";
import { MigrationManager } from "../database/migrations.js";
import { PostgresWorldStore } from "../database/world-store.js";
import { WorldStore, type WorldStoreLike } from "../multiplayer/persistence.js";
import type { HealthCheck } from "../monitoring.js";

/**
 * Startup policy for world persistence.
 *
 * PERSISTENCE_BACKEND selects the backend:
 * - "postgres": required when DATABASE_URL is configured. The server refuses to start if the
 *   database is unreachable, the schema is not migrated, or no database is configured.
 * - "file": the JSON file at DATA_FILE. Single-instance development mode only. It is logged and
 *   reported in /health as file persistence, never as PostgreSQL persistence.
 *
 * When PERSISTENCE_BACKEND is unset: "postgres" if DATABASE_URL is set, otherwise "file".
 * There is no silent fallback from PostgreSQL to a file or memory store.
 */

export type PersistenceBackend = "postgres" | "file";

export interface WorldPersistence {
  readonly backend: PersistenceBackend;
  readonly store: WorldStoreLike;
  health(): Promise<HealthCheck>;
  close(): Promise<void>;
}

export interface OpenPersistenceOptions {
  readonly stateFile: string;
  readonly now?: number;
  readonly log?: (message: string) => void;
}

export function resolvePersistenceBackend(env: NodeJS.ProcessEnv = process.env): PersistenceBackend {
  const requested = env.PERSISTENCE_BACKEND?.trim().toLowerCase();
  if (requested === "postgres" || requested === "file") {
    return requested;
  }
  if (requested !== undefined && requested !== "") {
    throw new Error('PERSISTENCE_BACKEND must be "postgres" or "file".');
  }
  return env.DATABASE_URL ? "postgres" : "file";
}

export async function openWorldPersistence(options: OpenPersistenceOptions): Promise<WorldPersistence> {
  const log = options.log ?? ((message: string) => console.info(message));
  const now = options.now ?? Date.now();
  const backend = resolvePersistenceBackend();

  if (backend === "file") {
    if (process.env.DATABASE_URL) {
      log("[Persistence] PERSISTENCE_BACKEND=file overrides DATABASE_URL; world state is NOT stored in PostgreSQL.");
    }
    log("[Persistence] File backend (development mode). Single-instance only; not shared across instances.");
    const store = new WorldStore(options.stateFile, now);
    return {
      backend,
      store,
      health: async () => ({ status: "pass", message: "File persistence (development mode); not PostgreSQL." }),
      close: async () => undefined,
    };
  }

  if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    throw new Error(
      "PERSISTENCE_BACKEND=postgres requires DATABASE_URL. Configure it in the deployment environment; the server will not start without durable storage.",
    );
  }

  // Validates configuration (including TLS policy) before any connection attempt.
  const config = loadDatabaseConfigFromEnv();
  const db = new DatabaseConnection(config);
  await db.connect();

  try {
    const migrations = new MigrationManager(db);
    let status;
    try {
      status = await migrations.getStatus();
    } catch {
      throw new Error('The database has not been migrated. Run "npm run db:migrate" against this database, then start the server again.');
    }
    if (!status.isUpToDate) {
      throw new Error(
        `The database schema is at version ${status.currentVersion}; version ${status.latestVersion} is required. Run "npm run db:migrate" and start the server again.`,
      );
    }
    const store = await PostgresWorldStore.open({ db, now });
    log(`[Persistence] PostgreSQL backend. World state version ${store.getVersion()}.`);
    return {
      backend,
      store,
      health: () => store.health(),
      close: () => db.disconnect(),
    };
  } catch (error) {
    await db.disconnect().catch(() => undefined);
    throw error;
  }
}

