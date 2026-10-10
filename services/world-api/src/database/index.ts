/**
 * Database module exports for Naija: One World
 */

export { DatabaseConnection, database, loadDatabaseConfigFromEnv } from "./connection.js";
export type { DatabaseConfig } from "./connection.js";

export { MigrationManager, migrationManager } from "./migrations.js";
export type { Migration } from "./migrations.js";

export { AccountRepository, CharacterRepository, accountRepository, characterRepository } from "./repositories.js";
export type { Account, Character } from "./repositories.js";

export { SCHEMA_VERSION, CREATE_SCHEMA_SQL, DROP_SCHEMA_SQL } from "./schema.js";
