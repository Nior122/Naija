import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildPoolConfig, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";

/**
 * Stage 28 TLS tests.
 *
 * Part 1 (always runs): the connection policy as pure configuration. No server needed.
 * Part 2 (runs only with TLS_TEST_DATABASE_URL): a LOCAL PostgreSQL started with ssl=on and a certificate
 * issued by a private test CA. This shows certificate verification is enforced by the app's pool, and that the
 * documented test-only escape hatch still encrypts. It is NOT evidence about Neon or production.
 * Set TLS_TEST_CA_FILE to the test CA certificate (PEM) for the verified case.
 */

const DATABASE_KEYS = ["DATABASE_URL", "DB_SSL", "DB_SSL_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS"];

// ---- Part 1: pure policy ---------------------------------------------------------------------

test("TLS policy: default pool config verifies the server certificate", () => {
  const config = buildPoolConfig({ connectionString: "postgres://user@db.example.test/naija" });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("TLS policy: verified sslmode values are accepted and removed from the URL, so they cannot weaken the policy", () => {
  for (const mode of ["verify-full", "verify-ca", "require"]) {
    const config = buildPoolConfig({ connectionString: `postgres://user@db.example.test/naija?sslmode=${mode}` });
    assert.deepEqual(config.ssl, { rejectUnauthorized: true }, mode);
    assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false, mode);
  }
});

test("TLS policy: sslmode=prefer, allow, no-verify and unknown values are rejected", () => {
  for (const mode of ["prefer", "allow", "no-verify", "bogus"]) {
    assert.throws(
      () => buildPoolConfig({ connectionString: `postgres://user@db.example.test/naija?sslmode=${mode}` }),
      /sslmode is not supported/,
      mode,
    );
  }
});

test("TLS policy: sslmode=disable is rejected unless DB_SSL=false is also set", () => {
  assert.throws(
    () => buildPoolConfig({ connectionString: "postgres://user@localhost/naija?sslmode=disable" }),
    /requires DB_SSL=false/,
  );
  const config = buildPoolConfig({ connectionString: "postgres://user@localhost/naija?sslmode=disable", ssl: false });
  assert.equal(config.ssl, false);
});

test("TLS policy: DB_SSL=false conflicts with a verified sslmode in the URL", () => {
  assert.throws(
    () => buildPoolConfig({ connectionString: "postgres://user@db.example.test/naija?sslmode=verify-full", ssl: false }),
    /conflicts with the sslmode/,
  );
});

test("TLS policy: DB_SSL_REJECT_UNAUTHORIZED=false is the only way to turn off certificate checks", () => {
  const config = buildPoolConfig({ connectionString: "postgres://user@db.example.test/naija", rejectUnauthorized: false });
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("TLS policy: environment variables are read into the same policy", () => {
  const saved = Object.fromEntries(DATABASE_KEYS.map((key) => [key, process.env[key]]));
  try {
    process.env.DATABASE_URL = "postgres://user@db.example.test/naija";
    delete process.env.DB_SSL;
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
    assert.deepEqual(buildPoolConfig(loadDatabaseConfigFromEnv()).ssl, { rejectUnauthorized: true });
    process.env.DB_SSL_REJECT_UNAUTHORIZED = "false";
    assert.deepEqual(buildPoolConfig(loadDatabaseConfigFromEnv()).ssl, { rejectUnauthorized: false });
  } finally {
    for (const key of DATABASE_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("Credential redaction: configuration errors never echo the password in the connection string", () => {
  const marker = "SECRETMARKER-7f3a";
  const badUrls = [
    `postgres://user:${marker}@db.example.test/naija?sslmode=prefer`,
    `postgres://user:${marker}@db.example.test/naija?sslmode=bogus`,
    `mysql://user:${marker}@db.example.test/naija`,
    `postgres://user:${marker}@[bad/naija`,
  ];
  for (const url of badUrls) {
    assert.throws(() => buildPoolConfig({ connectionString: url }), (error) => {
      assert.equal(String(error.message).includes(marker), false, "message must not contain the password");
      assert.equal(String(error.stack ?? "").includes(marker), false, "stack must not contain the password");
      return true;
    });
  }
});

// ---- Part 2: local TLS server (gated) --------------------------------------------------------

const TLS_URL = process.env.TLS_TEST_DATABASE_URL;
const tlsLive = { skip: !TLS_URL ? "requires TLS_TEST_DATABASE_URL (a local ssl=on disposable server)" : false };

if (TLS_URL) {
  const databaseName = decodeURIComponent(new URL(TLS_URL).pathname.replace(/^\//, ""));
  if (!databaseName.includes("test")) {
    throw new Error("TLS_TEST_DATABASE_URL must name a disposable database whose name contains \"test\".");
  }
}

/** Runs the probe in a child process with a controlled environment. Returns the parsed result. */
function probe(extraEnv) {
  const env = { ...process.env };
  for (const key of DATABASE_KEYS) delete env[key];
  Object.assign(env, extraEnv);
  const script = fileURLToPath(new URL("./support/tls-probe.mjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      const line = out.split("\n").find((l) => l.startsWith("@@TLS "));
      if (!line) reject(new Error("probe produced no result"));
      else resolve(JSON.parse(line.slice("@@TLS ".length)));
    });
  });
}

test("TLS live: default policy with the private CA trusted connects over verified TLS", tlsLive, async () => {
  assert.ok(process.env.TLS_TEST_CA_FILE, "TLS_TEST_CA_FILE is required for the verified case");
  const result = await probe({ DATABASE_URL: TLS_URL, NODE_EXTRA_CA_CERTS: process.env.TLS_TEST_CA_FILE });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.ssl, true);
});

test("TLS live: default policy without the CA refuses the untrusted certificate (no plaintext fallback)", tlsLive, async () => {
  const result = await probe({ DATABASE_URL: TLS_URL });
  assert.equal(result.ok, false);
  assert.match(result.message, /certificate|self[- ]signed|unable to verify|UNABLE_TO/i);
});

test("TLS live: DB_SSL_REJECT_UNAUTHORIZED=false still encrypts (test-only escape hatch)", tlsLive, async () => {
  const result = await probe({ DATABASE_URL: TLS_URL, DB_SSL_REJECT_UNAUTHORIZED: "false" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.ssl, true);
});

test("TLS live: DB_SSL=false connects in plaintext (local development only)", tlsLive, async () => {
  const result = await probe({ DATABASE_URL: TLS_URL.replace(/\?.*$/, "") + "?sslmode=disable", DB_SSL: "false" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.ssl, false);
});
