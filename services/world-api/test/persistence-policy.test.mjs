import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { buildPoolConfig } from "../dist/database/connection.js";
import { openWorldPersistence, resolvePersistenceBackend } from "../dist/persistence/open.js";
import { LIVE_WORLD_FILE } from "../dist/runtime-environment.js";

/**
 * Offline tests for the startup persistence policy. No database is contacted except the
 * unreachable-host case, which uses a closed local port and must fail without a password leak.
 */

const SECRET = "t28-secret-do-not-print";
const envKeys = ["NAIJA_ENV", "DATABASE_URL", "DB_HOST", "DB_SSL", "DB_SSL_REJECT_UNAUTHORIZED", "PERSISTENCE_BACKEND", "DATA_FILE"];
const saved = {};
const tempDirs = [];

beforeEach(() => {
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NAIJA_ENV = "test";
});

afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempStateFile() {
  const dir = mkdtempSync(join(tmpdir(), "naija-policy-"));
  tempDirs.push(dir);
  return join(dir, "world-state.json");
}

const quietLog = () => undefined;

test("Backend resolution: with no configured backend, startup is refused; file mode is never selected automatically", () => {
  assert.throws(() => resolvePersistenceBackend({ NAIJA_ENV: "development" }), /never selected automatically/);
  assert.throws(() => resolvePersistenceBackend({ NAIJA_ENV: "test" }), /never selected automatically/);
});

test("Backend resolution: development and test default to postgres when DATABASE_URL is set", () => {
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "development", DATABASE_URL: "postgresql://u@h/d" }), "postgres");
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "test", DATABASE_URL: "postgresql://u@h/d" }), "postgres");
});

test("Backend resolution: an explicit PERSISTENCE_BACKEND is honoured in development and test", () => {
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "development", DATABASE_URL: "postgresql://u@h/d", PERSISTENCE_BACKEND: "file" }), "file");
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "test", PERSISTENCE_BACKEND: "file" }), "file");
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "development", PERSISTENCE_BACKEND: "postgres" }), "postgres");
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "development", PERSISTENCE_BACKEND: "  POSTGRES " }), "postgres");
});

test("Backend resolution: unknown backend names are rejected, not silently defaulted", () => {
  assert.throws(() => resolvePersistenceBackend({ NAIJA_ENV: "development", PERSISTENCE_BACKEND: "sqlite" }), /must be "postgres" or "file"/);
  assert.throws(() => resolvePersistenceBackend({ NAIJA_ENV: "development", PERSISTENCE_BACKEND: "memory" }), /must be "postgres" or "file"/);
});

test("Backend resolution: NAIJA_ENV is required and must be a known value", () => {
  assert.throws(() => resolvePersistenceBackend({ DATABASE_URL: "postgresql://u@h/d" }), /NAIJA_ENV must be set/);
  assert.throws(() => resolvePersistenceBackend({ NAIJA_ENV: "staging", DATABASE_URL: "postgresql://u@h/d" }), /NAIJA_ENV must be production, development, or test/);
});

test("Production: DATABASE_URL is required; without it the server refuses to start and writes no file", async () => {
  process.env.NAIJA_ENV = "production";
  const stateFile = tempStateFile();
  assert.throws(() => resolvePersistenceBackend({ NAIJA_ENV: "production" }), /requires DATABASE_URL/);
  await assert.rejects(openWorldPersistence({ stateFile, log: quietLog }), /requires DATABASE_URL/);
  assert.equal(existsSync(stateFile), false, "no world file may be created in production");
});

test("Production: explicit file mode is refused, even when DATABASE_URL is set", () => {
  assert.throws(
    () => resolvePersistenceBackend({ NAIJA_ENV: "production", PERSISTENCE_BACKEND: "file", DATABASE_URL: "postgresql://u@h/d" }),
    /not allowed when NAIJA_ENV=production/,
  );
});

test("Production: PostgreSQL is selected without any PERSISTENCE_BACKEND setting", () => {
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "production", DATABASE_URL: "postgresql://u@h/d" }), "postgres");
  assert.equal(resolvePersistenceBackend({ NAIJA_ENV: "production", DATABASE_URL: "postgresql://u@h/d", PERSISTENCE_BACKEND: "postgres" }), "postgres");
});

test("Production: DB_HOST alone is not a substitute for DATABASE_URL", () => {
  assert.throws(() => resolvePersistenceBackend({ NAIJA_ENV: "production", DB_HOST: "db.example.test" }), /requires DATABASE_URL/);
});

test("Production: an unreachable database does not fall back to the JSON file", async () => {
  process.env.NAIJA_ENV = "production";
  process.env.DATABASE_URL = `postgresql://naija:${SECRET}@127.0.0.1:1/naija?sslmode=verify-full`;
  const stateFile = tempStateFile();
  await assert.rejects(openWorldPersistence({ stateFile, log: quietLog }), /connection failed/i);
  assert.equal(existsSync(stateFile), false, "a database failure must not create or use the world file");
});

test("Test environment: the live world file is refused in file mode", async () => {
  process.env.PERSISTENCE_BACKEND = "file";
  process.env.NAIJA_ENV = "test";
  await assert.rejects(openWorldPersistence({ stateFile: LIVE_WORLD_FILE, log: quietLog }), /refuses the live world file/);
});

test("Test environment: file mode without an explicit state file is refused", async () => {
  process.env.PERSISTENCE_BACKEND = "file";
  await assert.rejects(openWorldPersistence({ stateFile: undefined, log: quietLog }), /requires an explicit test world file/);
});

test("Startup: postgres mode without DATABASE_URL or DB_HOST refuses to start", async () => {
  process.env.PERSISTENCE_BACKEND = "postgres";
  await assert.rejects(
    openWorldPersistence({ stateFile: tempStateFile(), log: quietLog }),
    /requires DATABASE_URL/,
  );
});

test("Startup: file mode opens the JSON store and reports itself as not PostgreSQL", async () => {
  process.env.PERSISTENCE_BACKEND = "file";
  const logged = [];
  const persistence = await openWorldPersistence({ stateFile: tempStateFile(), log: (m) => logged.push(m) });
  try {
    assert.equal(persistence.backend, "file");
    assert.ok(logged.some((line) => /single-instance/i.test(line)), "file mode must log the single-instance limit");
    const health = await persistence.health();
    assert.equal(health.status, "pass");
    assert.match(health.message, /not PostgreSQL/);
  } finally {
    await persistence.close();
  }
});

test("Startup: file mode with DATABASE_URL set logs that the database is NOT used", async () => {
  process.env.PERSISTENCE_BACKEND = "file";
  process.env.DATABASE_URL = `postgresql://naija:${SECRET}@127.0.0.1:1/naija`;
  const logged = [];
  const persistence = await openWorldPersistence({ stateFile: tempStateFile(), log: (m) => logged.push(m) });
  try {
    assert.equal(persistence.backend, "file");
    assert.ok(logged.some((line) => /NOT stored in PostgreSQL/.test(line)));
    assert.ok(!logged.some((line) => line.includes(SECRET)), "the URL secret must never be logged");
  } finally {
    await persistence.close();
  }
});

test("Startup: an unreachable database fails with a message that never contains the password", async () => {
  process.env.PERSISTENCE_BACKEND = "postgres";
  process.env.DATABASE_URL = `postgresql://naija:${SECRET}@127.0.0.1:1/naija?sslmode=verify-full`;
  let caught;
  try {
    await openWorldPersistence({ stateFile: tempStateFile(), log: quietLog });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "startup must fail when the database cannot be reached");
  assert.match(caught.message, /connection failed/i);
  assert.ok(!caught.message.includes(SECRET), "password must not appear in the error message");
  assert.ok(!String(caught.stack ?? "").includes(SECRET), "password must not appear in the stack");
  assert.ok(!caught.message.includes("postgresql://"), "the connection string must not be echoed");
});

test("TLS policy: sslmode=disable in the URL requires the explicit DB_SSL=false opt-out", () => {
  const url = `postgresql://naija:${SECRET}@db.example.com/naija?sslmode=disable`;
  assert.throws(() => buildPoolConfig({ connectionString: url }), /requires DB_SSL=false/);
  let caught;
  try {
    buildPoolConfig({ connectionString: url });
  } catch (error) {
    caught = error;
  }
  assert.ok(!caught.message.includes(SECRET));
});

test("TLS policy: DB_SSL=false conflicts with a verifying sslmode in the URL", () => {
  assert.throws(
    () => buildPoolConfig({ connectionString: `postgresql://u:${SECRET}@h/d?sslmode=verify-full`, ssl: false }),
    /conflicts with the sslmode/,
  );
});

test("TLS policy: unsupported sslmode values are rejected rather than downgraded", () => {
  for (const mode of ["prefer", "allow", "no-verify"]) {
    assert.throws(
      () => buildPoolConfig({ connectionString: `postgresql://u@h/d?sslmode=${mode}` }),
      /sslmode is not supported/,
      `sslmode=${mode} must be rejected`,
    );
  }
});

test("TLS policy: verify-full in the URL is accepted and certificate verification stays on", () => {
  const config = buildPoolConfig({ connectionString: "postgresql://u@h/d?sslmode=verify-full" });
  assert.ok(config.ssl, "TLS must be enabled");
  assert.notEqual(config.ssl.rejectUnauthorized, false, "certificate verification must not be disabled");
  assert.equal(config.connectionString.includes("sslmode"), false, "sslmode must be stripped from the URL");
});
