import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import { after, afterEach, beforeEach, test } from "node:test";
import pg from "pg";
import {
  DatabaseConnection,
  loadDatabaseConfigFromEnv,
  resolveDatabasePoolConfig,
  buildPoolConfig,
} from "../dist/database/connection.js";
import { resolvePlaintextAddresses } from "../dist/database/host-policy.js";

/**
 * Stage 28 Task 1: the "localhost" DNS race.
 *
 * Before this change, DB_SSL=false to "localhost" was validated once and then left to the driver, which resolved the
 * name again for every new pooled socket. These tests show the validated addresses are the only ones used.
 *
 * A "hostile" system resolver answers every name with 203.0.113.9 (TEST-NET-3, never reachable here). It records
 * each call. The tests below run against a fake loopback server that accepts connections and closes them, so no
 * real database or external network is needed. A live section runs against a disposable PostgreSQL when configured.
 */

const HOSTILE_ADDRESS = "203.0.113.9";
const LOOPBACK = [{ address: "127.0.0.1", family: 4 }];
const realLookup = dns.lookup;
let systemLookups = 0;

/** Replaces dns.lookup with a resolver that answers every name with the hostile address and counts calls. */
function installHostileSystemResolver() {
  systemLookups = 0;
  dns.lookup = (hostname, options, callback) => {
    systemLookups += 1;
    const done = typeof options === "function" ? options : callback;
    const wantsAll = typeof options === "object" && options !== null && options.all === true;
    process.nextTick(() => {
      if (wantsAll) done(null, [{ address: HOSTILE_ADDRESS, family: 4 }]);
      else done(null, HOSTILE_ADDRESS, 4);
    });
  };
}

afterEach(() => {
  dns.lookup = realLookup;
});

/** A fake PostgreSQL port: accepts TCP connections, records their source, and closes them at once. */
async function fakeServer() {
  const accepted = [];
  const server = net.createServer((socket) => {
    accepted.push(socket.remoteAddress);
    socket.on("error", () => undefined);
    socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port, accepted };
}

function plaintextConfig(port, extra = {}) {
  return {
    host: "localhost",
    port,
    user: "naija_pin_test",
    password: "not-a-real-password",
    database: "naija_pin_test",
    ssl: false,
    environment: "development",
    connectionTimeoutMs: 1500,
    ...extra,
  };
}

// ---- the validated list ----

test("Validation: localhost is resolved once with all answers, and the validated list is what is returned", async () => {
  const calls = [];
  const addresses = await resolvePlaintextAddresses("localhost", async (name, options) => {
    calls.push({ name, options });
    return [
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ];
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "localhost");
  assert.equal(calls[0].options.all, true, "every answer must be seen");
  assert.deepEqual(addresses, [
    { address: "::1", family: 6 },
    { address: "127.0.0.1", family: 4 },
  ]);
});

test("Validation: an IP literal is its own address and triggers no lookup", async () => {
  let called = false;
  const lookup = async () => {
    called = true;
    return [];
  };
  assert.deepEqual(await resolvePlaintextAddresses("127.0.0.1", lookup), [{ address: "127.0.0.1", family: 4 }]);
  assert.deepEqual(await resolvePlaintextAddresses("[::1]", lookup), [{ address: "::1", family: 6 }]);
  assert.equal(called, false);
});

test("Validation: a localhost answer that includes any non-loopback address yields no list at all", async () => {
  await assert.rejects(
    resolvePlaintextAddresses("localhost", async () => [
      { address: "127.0.0.1", family: 4 },
      { address: HOSTILE_ADDRESS, family: 4 },
    ]),
    /non-loopback/,
  );
});

// ---- pool configuration contract ----

test("Pool config: plaintext to localhost without a validated list is refused, so the lookup cannot be skipped", () => {
  assert.throws(
    () => buildPoolConfig({ host: "localhost", ssl: false, environment: "development" }),
    /requires validated loopback addresses/,
  );
});

test("Pool config: plaintext to localhost with a validated list gets a pinned socket factory", () => {
  const config = buildPoolConfig({ host: "localhost", ssl: false, environment: "development" }, LOOPBACK);
  assert.equal(typeof config.stream, "function");
});

test("Pool config: plaintext to an IP literal needs no pin, because no name is resolved", () => {
  const config = buildPoolConfig({ host: "127.0.0.1", ssl: false, environment: "development" });
  assert.equal(config.stream, undefined);
  assert.equal(config.host, "127.0.0.1");
});

test("Pool config: remote TLS keeps the host name, so the driver resolves it and the certificate is checked against it", async () => {
  let lookups = 0;
  const config = await resolveDatabasePoolConfig(
    { host: "db.example.test", environment: "production" },
    async () => {
      lookups += 1;
      return [];
    },
  );
  assert.equal(config.host, "db.example.test", "the name, not an address, is kept for SNI and hostname verification");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.stream, undefined, "remote TLS does not use the plaintext pin");
  assert.equal(lookups, 0, "no validation lookup is made for remote TLS");
});

test("Pool config: remote plaintext is refused before any lookup", async () => {
  let lookups = 0;
  await assert.rejects(
    resolveDatabasePoolConfig({ host: "db.example.test", ssl: false, environment: "development" }, async () => {
      lookups += 1;
      return LOOPBACK;
    }),
    /not localhost or a loopback address/,
  );
  assert.equal(lookups, 0);
});

test("Pool config: plaintext in production is refused before any lookup", async () => {
  let lookups = 0;
  await assert.rejects(
    resolveDatabasePoolConfig({ host: "localhost", ssl: false, environment: "production" }, async () => {
      lookups += 1;
      return LOOPBACK;
    }),
    /only when NAIJA_ENV is development or test/,
  );
  assert.equal(lookups, 0);
});

// ---- the race itself, against a fake server ----

test("Control: a plain driver connection to localhost follows the system resolver, so the race is real", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.server.close());
  installHostileSystemResolver();
  const client = new pg.Client({ host: "localhost", port: fake.port, user: "u", password: "p", database: "d", connectionTimeoutMillis: 1500 });
  await client.connect().catch(() => undefined);
  await client.end().catch(() => undefined);
  assert.ok(systemLookups >= 1, "the driver asked the system resolver for localhost");
  assert.equal(fake.accepted.length, 0, "the driver's connection went to the hostile address, not to loopback");
});

test("Pinned: the connection reaches only the validated loopback address, and the system resolver is never asked", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.server.close());
  installHostileSystemResolver();
  let validations = 0;
  const db = new DatabaseConnection(plaintextConfig(fake.port), {
    hostLookup: async () => {
      validations += 1;
      return LOOPBACK;
    },
  });
  await db.connect().catch(() => undefined); // the fake server closes at once, so the protocol handshake fails
  assert.equal(validations, 1, "localhost is validated once, at connect");
  assert.equal(systemLookups, 0, "the driver never consulted the system resolver");
  assert.ok(fake.accepted.length >= 1, "the connection reached the validated loopback address");
  assert.ok(fake.accepted.every((address) => address === "127.0.0.1" || address === "::ffff:127.0.0.1"));
});

test("Pinned: a validation answer that is not loopback refuses the connection before any socket is opened", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.server.close());
  installHostileSystemResolver();
  const db = new DatabaseConnection(plaintextConfig(fake.port), {
    hostLookup: async () => [{ address: HOSTILE_ADDRESS, family: 4 }],
  });
  await assert.rejects(db.connect(), /non-loopback/);
  assert.equal(fake.accepted.length, 0);
  assert.equal(systemLookups, 0);
});

test("Pinned: an IP-literal loopback host connects without any lookup at all", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.server.close());
  installHostileSystemResolver();
  let validations = 0;
  const db = new DatabaseConnection(plaintextConfig(fake.port, { host: "127.0.0.1" }), {
    hostLookup: async () => {
      validations += 1;
      return LOOPBACK;
    },
  });
  await db.connect().catch(() => undefined);
  assert.equal(validations, 0);
  assert.equal(systemLookups, 0);
  assert.ok(fake.accepted.length >= 1);
});

test("Remote TLS: the driver is not given a pinned address and does not use the plaintext lookup", async () => {
  // A remote name in the reserved .test domain: resolution fails or times out quickly. Either way, no plaintext
  // lookup is made, and no connection is attempted without verification.
  let validations = 0;
  const db = new DatabaseConnection(
    { host: "db.example.test", port: 5432, user: "u", password: "p", database: "d", environment: "production", connectionTimeoutMs: 1500 },
    {
      hostLookup: async () => {
        validations += 1;
        return LOOPBACK;
      },
    },
  );
  await assert.rejects(db.connect(), /Database connection failed/);
  assert.equal(validations, 0);
});

// ---- live: real PostgreSQL, several pooled sockets ----

const LIVE_URL = process.env.DATABASE_URL;
const live = {
  skip: !LIVE_URL || process.env.NAIJA_ALLOW_DB_TESTS !== "true" ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false,
};

test("Live: a pool to localhost opens several sockets, all to the validated address, while the system resolver is hostile", live, async () => {
  const url = new URL(LIVE_URL);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  assert.match(databaseName, /test/i, "live tests need a disposable database whose name contains 'test'");
  installHostileSystemResolver();
  let validations = 0;
  const db = new DatabaseConnection(
    {
      host: "localhost",
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: databaseName,
      ssl: false,
      environment: "test",
      maxConnections: 5,
    },
    {
      hostLookup: async () => {
        validations += 1;
        return LOOPBACK;
      },
    },
  );
  await db.connect();
  try {
    const rows = await Promise.all([1, 2, 3, 4].map(() => db.query("SELECT 1 AS one")));
    assert.ok(rows.every((result) => result[0].one === 1));
    assert.equal(validations, 1, "one validation, at connect");
    assert.equal(systemLookups, 0, "every pooled socket used the pinned list");
  } finally {
    await db.disconnect();
  }
});

after(() => {
  dns.lookup = realLookup;
});
