import { DatabaseConnection, loadDatabaseConfigFromEnv } from "../database/connection.js";
import { MigrationManager } from "../database/migrations.js";
import { PostgresWorldStore } from "../database/world-store.js";
import { WorldStore, type WorldStoreLike } from "../multiplayer/persistence.js";
import type { HealthCheck } from "../monitoring.js";
import { assertTestWorldFileIsolation, readRuntimeEnvironment } from "../runtime-environment.js";

/**
 * Startup policy for world persistence (Stage 28).
 *
 * NAIJA_ENV decides which backends are allowed:
 * - "production": PostgreSQL only. DATABASE_URL is required. PERSISTENCE_BACKEND=file is refused.
 * - "development" and "test": PostgreSQL when PERSISTENCE_BACKEND=postgres, or when it is unset and DATABASE_URL is set.
 *   The JSON file only when PERSISTENCE_BACKEND=file is set explicitly. With neither, startup is refused.
 *
 * There is no automatic fallback. A PostgreSQL connection failure, a missing or unmigrated schema, or an invalid
 * configuration stops startup. It never switches to the JSON file.
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
  const environment = readRuntimeEnvironment(env, { required: true });
  const requestedRaw = env.PERSISTENCE_BACKEND?.trim().toLowerCase();
  if (requestedRaw !== undefined && requestedRaw !== "" && requestedRaw !== "postgres" && requestedRaw !== "file") {
    throw new Error('PERSISTENCE_BACKEND must be "postgres" or "file".');
  }
  const requested: PersistenceBackend | undefined =
    requestedRaw === "postgres" || requestedRaw === "file" ? requestedRaw : undefined;
  const hasDatabaseUrl = Boolean(env.DATABASE_URL);

  if (environment === "production") {
    if (requested === "file") {
      throw new Error('PERSISTENCE_BACKEND=file is not allowed when NAIJA_ENV=production. Production requires PostgreSQL.');
    }
    if (!hasDatabaseUrl) {
      throw new Error(
        "NAIJA_ENV=production requires DATABASE_URL. The server will not start without PostgreSQL; there is no file fallback.",
      );
    }
    return "postgres";
  }

  if (requested !== undefined) {
    return requested;
  }
  if (hasDatabaseUrl) {
    return "postgres";
  }
  throw new Error(
    "No persistence backend is configured. Set DATABASE_URL for PostgreSQL, or PERSISTENCE_BACKEND=file for local development or tests. File mode is never selected automatically.",
  );
}

export async function openWorldPersistence(options: OpenPersistenceOptions): Promise<WorldPersistence> {
  const log = options.log ?? ((message: string) => console.info(message));
  const now = options.now ?? Date.now();
  const backend = resolvePersistenceBackend();

  if (backend === "file") {
    assertTestWorldFileIsolation(options.stateFile);
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

