import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { buildPoolConfig } from "../dist/database/connection.js";
import { openWorldPersistence, resolvePersistenceBackend } from "../dist/persistence/open.js";

/**
 * Offline tests for the startup persistence policy. No database is contacted except the
 * unreachable-host case, which uses a closed local port and must fail without a password leak.
 */

const SECRET = "t28-secret-do-not-print";
const envKeys = ["DATABASE_URL", "DB_HOST", "DB_SSL", "DB_SSL_REJECT_UNAUTHORIZED", "PERSISTENCE_BACKEND"];
const saved = {};
const tempDirs = [];

beforeEach(() => {
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
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

test("Backend resolution: defaults to file when DATABASE_URL is unset", () => {
  assert.equal(resolvePersistenceBackend({}), "file");
});

test("Backend resolution: defaults to postgres when DATABASE_URL is set", () => {
  assert.equal(resolvePersistenceBackend({ DATABASE_URL: "postgresql://u@h/d" }), "postgres");
});

test("Backend resolution: an explicit PERSISTENCE_BACKEND overrides the default", () => {
  assert.equal(resolvePersistenceBackend({ DATABASE_URL: "postgresql://u@h/d", PERSISTENCE_BACKEND: "file" }), "file");
  assert.equal(resolvePersistenceBackend({ PERSISTENCE_BACKEND: "postgres" }), "postgres");
  assert.equal(resolvePersistenceBackend({ PERSISTENCE_BACKEND: "  POSTGRES " }), "postgres");
});

test("Backend resolution: unknown backend names are rejected, not silently defaulted", () => {
  assert.throws(() => resolvePersistenceBackend({ PERSISTENCE_BACKEND: "sqlite" }), /must be "postgres" or "file"/);
  assert.throws(() => resolvePersistenceBackend({ PERSISTENCE_BACKEND: "memory" }), /must be "postgres" or "file"/);
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
