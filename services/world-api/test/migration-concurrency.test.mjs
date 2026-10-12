// Regression test: schema migrations run concurrently against an empty database.
//
// Before the migration lock, two connections that migrated the same empty database at once both ran the same DDL, and
// one failed with a unique violation (on pg_extension). Parallel test files hit this, and so could two server processes
// starting on a new database. The lock serialises the migrations, and the version is checked again under the lock.
//
// Live only: it needs a PostgreSQL database whose name contains "test", and it creates and drops its own databases.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DatabaseConnection, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";

const LIVE = Boolean(process.env.DATABASE_URL) && process.env.NAIJA_ALLOW_DB_TESTS === "true";
const live = { skip: !LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false };

let admin = null;
const createdDatabases = [];

before(async () => {
  if (!LIVE) return;
  admin = new DatabaseConnection(loadDatabaseConfigFromEnv());
  await admin.connect();
});

after(async () => {
  if (!LIVE) return;
  for (const name of createdDatabases) {
    // Only names this file created in this run, and only test databases, are dropped.
    if (/^naija_migrate_test_[a-f0-9]{12}$/.test(name)) {
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    }
  }
  await admin.disconnect();
});

function urlWithDatabase(url, name) {
  const copy = new URL(url);
  copy.pathname = `/${name}`;
  return copy.toString();
}

async function freshDatabase() {
  const name = `naija_migrate_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  createdDatabases.push(name);
  await admin.query(`CREATE DATABASE ${name}`);
  return name;
}

test("parallel migrations of an empty database all succeed, and each migration is recorded once", live, async () => {
  for (let round = 0; round < 3; round += 1) {
    const name = await freshDatabase();
    const config = { ...loadDatabaseConfigFromEnv(), connectionString: urlWithDatabase(process.env.DATABASE_URL, name) };
    const connections = [];
    for (let i = 0; i < 4; i += 1) {
      const connection = new DatabaseConnection(config);
      await connection.connect();
      connections.push(connection);
    }
    try {
      // Four connections start together, as four processes would.
      const counts = await Promise.all(connections.map((connection) => new MigrationManager(connection).migrate()));
      // Exactly one connection applies each migration; the others see it applied under the lock and skip it.
      assert.equal(counts.reduce((sum, count) => sum + count, 0), 3, `applied counts ${counts.join(",")}`);

      const rows = await connections[0].query("SELECT version, name FROM schema_migrations ORDER BY version");
      assert.deepEqual(rows.map((row) => row.version), [1, 2, 3]);
      const tables = await connections[0].query("SELECT to_regclass('public.accounts') AS accounts");
      assert.notEqual(tables[0].accounts, null, "the schema was created");
    } finally {
      for (const connection of connections) await connection.disconnect();
    }
  }
});

test("a migration that is already applied is skipped when it is applied again", live, async () => {
  const name = await freshDatabase();
  const connection = new DatabaseConnection({ ...loadDatabaseConfigFromEnv(), connectionString: urlWithDatabase(process.env.DATABASE_URL, name) });
  await connection.connect();
  try {
    const manager = new MigrationManager(connection);
    assert.equal(await manager.migrate(), 3);
    // A caller with a stale view calls applyMigration directly: the re-check under the lock skips it, with no error.
    await manager.applyMigration({ version: 1, name: "initial_schema", up: "CREATE TABLE should_not_exist (id INT)" });
    const rows = await connection.query("SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(rows.map((row) => row.version), [1, 2, 3]);
    const absent = await connection.query("SELECT to_regclass('public.should_not_exist') AS t");
    assert.equal(absent[0].t, null, "the stale migration's SQL did not run");
    assert.equal(await manager.migrate(), 0);
  } finally {
    await connection.disconnect();
  }
});
