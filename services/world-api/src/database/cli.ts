import { fileURLToPath } from "node:url";
import { DatabaseConnection } from "./connection.js";
import { MigrationManager } from "./migrations.js";

/**
 * Database administration commands. Configuration comes from the environment; nothing here
 * prints connection strings or credentials.
 *
 *   node dist/database/cli.js status    Show the applied and latest schema versions.
 *   node dist/database/cli.js migrate   Apply pending versioned migrations (additive; each in a transaction).
 */

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "status" && command !== "migrate") {
    console.error("Usage: node dist/database/cli.js <status|migrate>");
    process.exitCode = 2;
    return;
  }

  const db = new DatabaseConnection();
  await db.connect();
  try {
    const manager = new MigrationManager(db);
    if (command === "migrate") {
      const applied = await manager.migrate();
      console.info(`Applied ${applied} migration(s).`);
    }
    const status = await manager.getStatus();
    console.info(
      JSON.stringify({
        currentVersion: status.currentVersion,
        latestVersion: status.latestVersion,
        isUpToDate: status.isUpToDate,
        pendingMigrations: status.pendingMigrations,
      }, null, 2),
    );
  } finally {
    await db.disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(`Database command failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
