import { database } from "./connection.js";
import { SCHEMA_VERSION, CREATE_SCHEMA_SQL } from "./schema.js";

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

export class MigrationManager {
  /**
   * Initialize the migrations table
   */
  async initialize(): Promise<void> {
    await database.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
  }

  /**
   * Get the current schema version
   */
  async getCurrentVersion(): Promise<number> {
    try {
      const result = await database.queryOne<{ version: number }>(
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
    return database.query<{ version: number; name: string; applied_at: Date }>(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version"
    );
  }

  /**
   * Apply a migration
   */
  async applyMigration(migration: Migration): Promise<void> {
    const currentVersion = await this.getCurrentVersion();
    
    if (migration.version <= currentVersion) {
      console.log(`[Migration] Skipping migration ${migration.version} (${migration.name}) - already applied`);
      return;
    }

    console.log(`[Migration] Applying migration ${migration.version}: ${migration.name}`);

    try {
      await database.transaction(async (client) => {
        // Apply the migration SQL
        await client.query(migration.up);

        // Record the migration
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [migration.version, migration.name]
        );
      });

      console.log(`[Migration] Successfully applied migration ${migration.version}`);
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
        await this.applyMigration(migration);
        appliedCount++;
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
      // Future migrations can be added here
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
