import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseConnection, buildPoolConfig, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";

/** Validated loopback addresses for plaintext to localhost (what resolvePlaintextAddresses returns). */
const LOOPBACK = [{ address: "127.0.0.1", family: 4 }];

/**
 * Stage 28: database configuration and TLS rules. These tests never contact a database.
 * Connection-failure coverage uses a closed local port, so it exercises the error path only.
 */

const DB_ENV_KEYS = [
  "DATABASE_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_SSL",
  "DB_SSL_REJECT_UNAUTHORIZED",
  "DB_MAX_CONNECTIONS",
];

function withEnv(overrides, fn) {
  const saved = new Map(DB_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of DB_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Database config: certificate verification is on by default for a connection string", () => {
  const poolConfig = buildPoolConfig({ connectionString: "postgresql://user:pw@db.example.invalid/naija" });
  assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: true });
});

test("Database config: certificate verification is on by default for individual fields", () => {
  const poolConfig = buildPoolConfig({ host: "db.example.invalid", password: "pw" });
  assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: true });
});

test("Database config: verification can be disabled only by explicit opt-out in a local environment", () => {
  const poolConfig = buildPoolConfig({
    connectionString: "postgresql://user:pw@db.example.invalid/naija",
    rejectUnauthorized: false,
    environment: "test",
  });
  assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: false });
});

test("Database config: ssl=false disables TLS entirely and is explicit", () => {
  const poolConfig = buildPoolConfig({ host: "localhost", ssl: false, environment: "development" }, LOOPBACK);
  assert.equal(typeof poolConfig.stream, "function", "localhost plaintext is pinned to the validated addresses");
  assert.equal(poolConfig.ssl, false);
});

test("Database config: pool limits keep their documented defaults", () => {
  const poolConfig = buildPoolConfig({ host: "localhost" });
  assert.equal(poolConfig.max, 20);
  assert.equal(poolConfig.idleTimeoutMillis, 30000);
});

test("Database config: rejects non-PostgreSQL URL schemes without echoing the value", () => {
  const secretLikeValue = "mysql://naija_user:SENTINEL-SECRET-VALUE@db.example.invalid/naija";
  assert.throws(
    () => buildPoolConfig({ connectionString: secretLikeValue }),
    (error) => {
      assert.match(error.message, /postgres:\/\/ or postgresql:\/\//);
      assert.ok(!error.message.includes("SENTINEL-SECRET-VALUE"), "error must not echo the credential");
      assert.ok(!error.message.includes("naija_user"), "error must not echo the username");
      return true;
    },
  );
});

test("Database config: DATABASE_URL is read from the environment without printing it", () => {
  withEnv({ DATABASE_URL: "postgresql://user:pw@db.example.invalid/naija?sslmode=verify-full" }, () => {
    const config = loadDatabaseConfigFromEnv();
    assert.equal(config.connectionString, "postgresql://user:pw@db.example.invalid/naija?sslmode=verify-full");
    assert.equal(config.rejectUnauthorized, undefined, "unset opt-out must keep the secure default");
  });
});

test("Database config: DB_SSL_REJECT_UNAUTHORIZED accepts only true or false", () => {
  withEnv({ DB_HOST: "localhost", DB_SSL_REJECT_UNAUTHORIZED: "maybe" }, () => {
    assert.throws(() => loadDatabaseConfigFromEnv(), /DB_SSL_REJECT_UNAUTHORIZED must be either "true" or "false"/);
  });
  withEnv({ DB_HOST: "localhost", DB_SSL_REJECT_UNAUTHORIZED: "false" }, () => {
    assert.equal(loadDatabaseConfigFromEnv().rejectUnauthorized, false);
  });
});

test("Database connection: a failed connect is reported and the pool is discarded for retry", async () => {
  // Closed local port: the connection is refused immediately, so no credentials or server are involved.
  const db = new DatabaseConnection({
    connectionString: "postgresql://probe:probe@127.0.0.1:1/probe?sslmode=disable",
    ssl: false, // sslmode=disable is only accepted with an explicit opt-out
    environment: "development", // plaintext is allowed only in a local environment, and only to loopback
  });
  await assert.rejects(() => db.connect(), /^Error: Database connection failed: /);
  assert.equal(db.isConnectedToDatabase(), false);
  assert.equal(db.getPoolStats(), null, "a failed pool must not be retained");
  await db.disconnect();
});
