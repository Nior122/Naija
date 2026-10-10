import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { DatabaseConnection, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";
import { openWorldPersistence } from "../dist/persistence/open.js";

/**
 * Stage 28: fail-closed readiness. A database that is unreachable or not migrated must stop startup. It must never
 * fall back to the JSON file. The non-live tests run everywhere; the live test needs a DISPOSABLE PostgreSQL.
 */

const quiet = () => undefined;
const KEYS = ["NAIJA_ENV", "DATABASE_URL", "DB_SSL", "DB_SSL_REJECT_UNAUTHORIZED", "PERSISTENCE_BACKEND", "DB_HOST"];
const saved = {};
const dir = mkdtempSync(join(tmpdir(), "naija-readiness-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));


beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// A closed loopback port: the connection is refused at once. No server and no credentials are involved.
const CLOSED_LOOPBACK = "postgresql://probe:probe@127.0.0.1:1/probe";

test("Development: an explicit postgres backend that cannot connect fails without writing or reading the file", async () => {
  process.env.NAIJA_ENV = "development";
  process.env.PERSISTENCE_BACKEND = "postgres";
  process.env.DATABASE_URL = `${CLOSED_LOOPBACK}?sslmode=disable`;
  process.env.DB_SSL = "false";
  const stateFile = join(dir, "dev-no-fallback.json");
  await assert.rejects(openWorldPersistence({ stateFile, log: quiet }), /connection failed/i);
  assert.equal(existsSync(stateFile), false, "a failed PostgreSQL connection must not create the JSON file");
});

test("Development: with DATABASE_URL set and no backend named, a failed connection is still not a file fallback", async () => {
  process.env.NAIJA_ENV = "development";
  process.env.DATABASE_URL = `${CLOSED_LOOPBACK}?sslmode=disable`;
  process.env.DB_SSL = "false";
  const stateFile = join(dir, "dev-auto-no-fallback.json");
  await assert.rejects(openWorldPersistence({ stateFile, log: quiet }), /connection failed/i);
  assert.equal(existsSync(stateFile), false);
});

test("Production: an unreachable PostgreSQL with verified TLS fails without a file fallback", async () => {
  process.env.NAIJA_ENV = "production";
  process.env.DATABASE_URL = `${CLOSED_LOOPBACK}?sslmode=verify-full`;
  const stateFile = join(dir, "prod-no-fallback.json");
  await assert.rejects(openWorldPersistence({ stateFile, log: quiet }), /connection failed/i);
  assert.equal(existsSync(stateFile), false);
});

test("Development: explicit file mode is the only way to use the JSON file, and it works against a temporary file", async () => {
  process.env.NAIJA_ENV = "development";
  process.env.PERSISTENCE_BACKEND = "file";
  const stateFile = join(dir, "dev-explicit-file.json");
  const persistence = await openWorldPersistence({ stateFile, log: quiet });
  try {
    assert.equal(persistence.backend, "file");
  } finally {
    await persistence.close();
  }
});

// ---- live: an unmigrated disposable database ----

// Captured before beforeEach clears the database variables for each test.
const DATABASE_URL = process.env.DATABASE_URL;
const LIVE_DB_SSL = process.env.DB_SSL;
const LIVE = !!DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";

/** Points the environment at the disposable live database for the admin connection, then restores it. */
function liveAdminConfig() {
  process.env.NAIJA_ENV = "test";
  process.env.DATABASE_URL = DATABASE_URL;
  if (LIVE_DB_SSL === undefined) delete process.env.DB_SSL;
  else process.env.DB_SSL = LIVE_DB_SSL;
  return loadDatabaseConfigFromEnv();
}
const live = { skip: !LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false };
const createdDatabases = [];

if (LIVE) {
  const databaseName = decodeURIComponent(new URL(DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live readiness tests: the database name must contain 'test'");
  }
}

function urlWithDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

after(async () => {
  if (!LIVE) return;
  const admin = new DatabaseConnection(liveAdminConfig());
  await admin.connect();
  try {
    for (const name of createdDatabases) {
      // Only names this file created in this run, and only test databases, are dropped.
      if (/^naija_unmigrated_test_[a-f0-9]{12}$/.test(name)) {
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      }
    }
  } finally {
    await admin.disconnect();
  }
});

test("Live: a database with no migrations applied is not ready; the server does not start and writes no file", live, async () => {
  const name = `naija_unmigrated_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new DatabaseConnection(liveAdminConfig());
  await admin.connect();
  try {
    createdDatabases.push(name);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.disconnect();
  }

  process.env.NAIJA_ENV = "test";
  process.env.PERSISTENCE_BACKEND = "postgres";
  process.env.DATABASE_URL = urlWithDatabase(DATABASE_URL, name);
  const stateFile = join(dir, "unmigrated-no-file.json");
  await assert.rejects(openWorldPersistence({ stateFile, log: quiet }), /has not been migrated|schema is at version/);
  assert.equal(existsSync(stateFile), false, "an unmigrated database must not lead to the JSON file");
});
