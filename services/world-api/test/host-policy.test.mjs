import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { buildPoolConfig } from "../dist/database/connection.js";
import {
  assertPlaintextHostIsLoopback,
  classifyPlaintextHost,
  HostPolicyError,
  isLoopbackAddress,
} from "../dist/database/host-policy.js";

/**
 * Stage 28 host policy for plaintext PostgreSQL (DB_SSL=false). Pure tests: no sockets, no real DNS.
 * The "localhost" resolution cases inject the lookup function.
 */

const SECRET = "t28-host-secret-do-not-print";

test("Loopback addresses: IPv4 127.0.0.0/8 and IPv6 ::1 (including bracketed and expanded forms) are accepted", () => {
  for (const host of ["127.0.0.1", "127.255.255.254", "127.10.20.30", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"]) {
    assert.equal(classifyPlaintextHost(host), "loopback-address", host);
  }
});

test("Loopback boundaries: addresses just outside 127.0.0.0/8 are refused", () => {
  for (const host of ["126.255.255.255", "128.0.0.1", "0.0.0.0", "10.0.0.5", "192.168.1.10", "203.0.113.7"]) {
    assert.throws(() => classifyPlaintextHost(host), HostPolicyError, host);
  }
});

test("Non-loopback IPv6 and mapped addresses are refused", () => {
  for (const host of ["::", "fe80::1", "2001:db8::5", "::ffff:10.0.0.1", "::ffff:203.0.113.9"]) {
    assert.throws(() => classifyPlaintextHost(host), HostPolicyError, host);
    assert.equal(isLoopbackAddress(host), false, host);
  }
});

test("Hostnames: only the name localhost (any case, optional trailing dot) is a candidate", () => {
  assert.equal(classifyPlaintextHost("localhost"), "localhost-name");
  assert.equal(classifyPlaintextHost("LOCALHOST"), "localhost-name");
  assert.equal(classifyPlaintextHost("localhost."), "localhost-name");
  for (const host of ["localhost.localdomain", "localhost.example.com", "db.neon.tech", "127.0.0.1.nip.io", "db.internal"]) {
    assert.throws(() => classifyPlaintextHost(host), /not localhost or a loopback address/, host);
  }
});

test("Missing, empty, unix-socket and multiple hosts are refused as ambiguous", () => {
  assert.throws(() => classifyPlaintextHost(undefined), /requires an explicit loopback host/);
  assert.throws(() => classifyPlaintextHost("   "), /requires an explicit loopback host/);
  assert.throws(() => classifyPlaintextHost("/var/run/postgresql"), /unix socket/);
  assert.throws(() => classifyPlaintextHost("%2Fvar%2Frun%2Fpostgresql"), /unix socket/);
  assert.throws(() => classifyPlaintextHost("127.0.0.1,10.0.0.5"), /multiple hosts/);
});

test("Refusal messages never contain the connection string or password", () => {
  for (const host of ["db.example.test", "10.0.0.5", "/tmp/sock"]) {
    try {
      classifyPlaintextHost(host);
      assert.fail("expected a refusal");
    } catch (error) {
      assert.equal(String(error.message).includes(SECRET), false);
    }
  }
});

// ---- localhost resolution, checked at connect time with an injected lookup ----

const loopbackAnswer = [
  { address: "127.0.0.1", family: 4 },
  { address: "::1", family: 6 },
];

test("localhost resolution: all answers loopback is accepted", async () => {
  let asked = null;
  await assertPlaintextHostIsLoopback("localhost", async (name, options) => {
    asked = { name, options };
    return loopbackAnswer;
  });
  assert.equal(asked.name, "localhost");
  assert.equal(asked.options.all, true, "every answer must be checked, not only the first");
});

test("localhost resolution: a single non-loopback answer is refused", async () => {
  await assert.rejects(
    assertPlaintextHostIsLoopback("localhost", async () => [{ address: "203.0.113.9", family: 4 }]),
    /resolves to a non-loopback address/,
  );
});

test("localhost resolution: a mix of loopback and non-loopback answers is refused", async () => {
  await assert.rejects(
    assertPlaintextHostIsLoopback("localhost", async () => [...loopbackAnswer, { address: "10.0.0.5", family: 4 }]),
    /resolves to a non-loopback address/,
  );
});

test("localhost resolution: an empty answer is refused", async () => {
  await assert.rejects(assertPlaintextHostIsLoopback("localhost", async () => []), /resolves to a non-loopback address/);
});

test("localhost resolution: a lookup failure is refused, not treated as loopback", async () => {
  await assert.rejects(
    assertPlaintextHostIsLoopback("localhost", async () => {
      throw new Error("ENOTFOUND");
    }),
    /could not be resolved/,
  );
});

test("IP literals are checked without any DNS lookup", async () => {
  let called = false;
  const lookup = async () => {
    called = true;
    return [];
  };
  await assertPlaintextHostIsLoopback("127.0.0.1", lookup);
  await assertPlaintextHostIsLoopback("[::1]", lookup);
  assert.equal(called, false);
  await assert.rejects(assertPlaintextHostIsLoopback("10.0.0.5", lookup), HostPolicyError);
  assert.equal(called, false, "a refused literal must not trigger a lookup either");
});

// ---- the policy as it applies to pool configuration ----

const saved = {};
const KEYS = ["PGHOSTADDR", "PGHOST"];
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

test("Plaintext: refused in production, even to loopback", () => {
  assert.throws(() => buildPoolConfig({ host: "127.0.0.1", ssl: false, environment: "production" }), /only when NAIJA_ENV is development or test/);
});

test("Plaintext: refused when the environment is not set (strictest policy)", () => {
  assert.throws(() => buildPoolConfig({ host: "localhost", ssl: false }), /only when NAIJA_ENV is development or test/);
});

test("Plaintext: allowed in development and test to loopback, and refused to a remote host", () => {
  for (const environment of ["development", "test"]) {
    assert.equal(buildPoolConfig({ host: "127.0.0.1", ssl: false, environment }).ssl, false);
    assert.equal(buildPoolConfig({ host: "::1", ssl: false, environment }).ssl, false);
    assert.equal(buildPoolConfig({ host: "localhost", ssl: false, environment }).ssl, false);
    assert.throws(() => buildPoolConfig({ host: "db.example.test", ssl: false, environment }), HostPolicyError);
    assert.throws(() => buildPoolConfig({ host: "10.0.0.5", ssl: false, environment }), HostPolicyError);
  }
});

test("Plaintext: a connection string with a remote host is refused even with sslmode=disable and DB_SSL=false", () => {
  assert.throws(
    () => buildPoolConfig({ connectionString: `postgresql://naija:${SECRET}@db.example.test/naija?sslmode=disable`, ssl: false, environment: "development" }),
    (error) => error instanceof HostPolicyError && !String(error.message).includes(SECRET),
  );
});

test("Plaintext: a connection string with no host is refused rather than defaulting to the local machine", () => {
  assert.throws(
    () => buildPoolConfig({ connectionString: "postgresql:///naija?sslmode=disable", ssl: false, environment: "development" }),
    /requires an explicit loopback host/,
  );
});

test("Plaintext: a connection string to a loopback host is accepted in development", () => {
  const config = buildPoolConfig({
    connectionString: `postgresql://naija:${SECRET}@127.0.0.1:55433/naija_stage28_test?sslmode=disable`,
    ssl: false,
    environment: "development",
  });
  assert.equal(config.ssl, false);
  assert.equal(new URL(config.connectionString).hostname, "127.0.0.1");
});

test("Redirects: PGHOSTADDR in the environment is refused, whatever the host", () => {
  process.env.PGHOSTADDR = "10.0.0.5";
  assert.throws(() => buildPoolConfig({ host: "127.0.0.1", environment: "test" }), /PGHOSTADDR is not supported/);
  assert.throws(
    () => buildPoolConfig({ connectionString: "postgresql://u@db.example.test/d?sslmode=verify-full", environment: "production" }),
    /PGHOSTADDR is not supported/,
  );
});

test("Redirects: host and hostaddr URL parameters are refused in every environment", () => {
  for (const param of ["host=10.0.0.5", "hostaddr=10.0.0.5"]) {
    assert.throws(
      () => buildPoolConfig({ connectionString: `postgresql://u@127.0.0.1/d?sslmode=verify-full&${param}`, environment: "production" }),
      /host and hostaddr URL parameters are not supported/,
      param,
    );
    assert.throws(
      () => buildPoolConfig({ connectionString: `postgresql://u@127.0.0.1/d?${param}`, ssl: false, environment: "test" }),
      /host and hostaddr URL parameters are not supported/,
      param,
    );
  }
});

test("TLS verification is never weakened for production hosts", () => {
  assert.throws(
    () => buildPoolConfig({ host: "db.example.test", rejectUnauthorized: false, environment: "production" }),
    /DB_SSL_REJECT_UNAUTHORIZED=false is allowed only when NAIJA_ENV is development or test/,
  );
  assert.deepEqual(buildPoolConfig({ host: "db.example.test", environment: "production" }).ssl, { rejectUnauthorized: true });
  assert.deepEqual(buildPoolConfig({ host: "db.example.test", environment: "production", ssl: true }).ssl, { rejectUnauthorized: true });
});

test("Loader: DB_SSL=false from environment variables is refused in production", async () => {
  const { loadDatabaseConfigFromEnv: load } = await import("../dist/database/connection.js");
  const keys = ["NAIJA_ENV", "DATABASE_URL", "DB_SSL", "DB_HOST"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NAIJA_ENV = "production";
    process.env.DATABASE_URL = "postgresql://probe:probe@127.0.0.1:1/probe";
    process.env.DB_SSL = "false";
    delete process.env.DB_HOST;
    assert.throws(() => buildPoolConfig(load()), /DB_SSL=false is allowed only when NAIJA_ENV is development or test/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
