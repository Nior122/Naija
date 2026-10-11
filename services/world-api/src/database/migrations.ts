import { database, type DatabaseConnection } from "./connection.js";
import { CREATE_SCHEMA_SQL, MIGRATION_V2_UP_SQL, MIGRATION_V2_DOWN_SQL } from "./schema.js";

/**
 * Database migration system for Naija: One World
 * Provides versioned schema management
 */

export interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
}

/**
 * Advisory lock key that serialises schema changes. Two connections that migrate an empty database at the same moment
 * (two processes starting, or parallel test files) would otherwise both run the same DDL: one fails with a unique
 * violation (for example on pg_extension). The lock is transaction-scoped (pg_advisory_xact_lock), so it is released by
 * the commit or rollback that ends each transaction that takes it.
 */
const MIGRATION_LOCK_KEY = 7273740;

const SCHEMA_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )
`;

export class MigrationManager {
  constructor(private readonly db: DatabaseConnection = database) {}

  /**
   * Initialize the migrations table. Runs under the migration lock, so concurrent callers do not race on creating it.
   */
  async initialize(): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(SCHEMA_MIGRATIONS_TABLE_SQL);
    });
  }

  /**
   * Get the current schema version
   */
  async getCurrentVersion(): Promise<number> {
    try {
      const result = await this.db.queryOne<{ version: number }>(
        "SELECT MAX(version) as version FROM schema_migrations"
      );
      return result?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get list of applied migrations
   */
  async getAppliedMigrations(): Promise<Array<{ version: number; name: string; applied_at: Date }>> {
    return this.db.query<{ version: number; name: string; applied_at: Date }>(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version"
    );
  }

  /**
   * Apply a migration. Resolves true when this call applied it, and false when it was already applied (by this or
   * another connection) and was skipped.
   */
  async applyMigration(migration: Migration): Promise<boolean> {
    // The version is read again inside the lock. The caller's earlier read can be stale: another connection may have
    // applied this migration since then. A migration that is already applied is skipped, not applied twice.
    let skipped = false;
    console.log(`[Migration] Applying migration ${migration.version}: ${migration.name}`);

    try {
      await this.db.transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
        await client.query(SCHEMA_MIGRATIONS_TABLE_SQL);
        const current = await client.query<{ version: number | string | null }>(
          "SELECT MAX(version) AS version FROM schema_migrations",
        );
        const currentVersion = Number(current.rows[0]?.version ?? 0);
        if (migration.version <= currentVersion) {
          skipped = true;
          return;
        }

        // Apply the migration SQL
        await client.query(migration.up);

        // Record the migration
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [migration.version, migration.name]
        );
      });

      if (skipped) {
        console.log(`[Migration] Skipping migration ${migration.version} (${migration.name}) - already applied`);
        return false;
      }
      console.log(`[Migration] Successfully applied migration ${migration.version}`);
      return true;
    } catch (error) {
      console.error(`[Migration] Failed to apply migration ${migration.version}:`, error);
      throw error;
    }
  }

  /**
   * Apply all pending migrations
   */
  async migrate(): Promise<number> {
    await this.initialize();

    const migrations = this.getMigrations();
    const currentVersion = await this.getCurrentVersion();
    let appliedCount = 0;

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        // Counts only migrations this call applied. Another connection may have applied one since the read above.
        if (await this.applyMigration(migration)) appliedCount++;
      }
    }

    return appliedCount;
  }

  /**
   * Get all defined migrations
   */
  private getMigrations(): Migration[] {
    return [
      {
        version: 1,
        name: "initial_schema",
        up: CREATE_SCHEMA_SQL,
        down: "", // No down migration for initial schema
      },
      {
        version: 2,
        name: "scope_idempotency_keys_per_character",
        up: MIGRATION_V2_UP_SQL,
        down: MIGRATION_V2_DOWN_SQL,
      },
    ];
  }

  /**
   * Check if database is up to date
   */
  async isUpToDate(): Promise<boolean> {
    const currentVersion = await this.getCurrentVersion();
    const migrations = this.getMigrations();
    const lastMigration = migrations.length > 0 ? migrations[migrations.length - 1] : null;
    const latestVersion = lastMigration?.version ?? 0;
    return currentVersion >= latestVersion;
  }

  /**
   * Get migration status
   */
  async getStatus(): Promise<{
    currentVersion: number;
    latestVersion: number;
    isUpToDate: boolean;
    pendingMigrations: number;
  }> {
    const currentVersion = await this.getCurrentVersion();
    const migrations = this.getMigrations();
    const lastMigration = migrations.length > 0 ? migrations[migrations.length - 1] : null;
    const latestVersion = lastMigration?.version ?? 0;
    const pendingMigrations = migrations.filter(m => m.version > currentVersion).length;

    return {
      currentVersion,
      latestVersion,
      isUpToDate: currentVersion >= latestVersion,
      pendingMigrations,
    };
  }
}

export const migrationManager = new MigrationManager();
