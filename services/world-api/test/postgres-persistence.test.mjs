import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { database, DatabaseConnection, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { AccountRepository, CharacterRepository } from "../dist/database/repositories.js";
import { PostgresWorldStore, WorldStateConflictError } from "../dist/database/world-store.js";
import { createIdentity, identityCreateMessage, openPeer, resumeSession, startApi, stopApi } from "./support/harness.mjs";

/**
 * Stage 28 live PostgreSQL tests.
 *
 * These run only when DATABASE_URL points at a DISPOSABLE test database AND
 * NAIJA_ALLOW_DB_TESTS=true is set. They write rows and apply additive migrations.
 * Results are reported as "local PostgreSQL" or "Neon" depending on the server used;
 * they are never presented as production evidence.
 */

const LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
const live = { skip: !LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false };

if (LIVE) {
  // These tests write rows and apply migrations. Refuse to run unless the database name says it is a test database,
  // so a misconfigured DATABASE_URL cannot point them at real data.
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

const accounts = new AccountRepository();
const characters = new CharacterRepository();
const createdAccountIds = [];

before(async () => {
  if (!LIVE) return;
  await database.connect();
  await new MigrationManager(database).migrate();
});

after(async () => {
  if (!LIVE) return;
  for (const id of createdAccountIds) {
    await accounts.delete(id).catch(() => undefined);
  }
  await database.disconnect();
});

async function newCharacter(money) {
  const suffix = randomUUID().slice(0, 8);
  const account = await accounts.create({ username: `t28_${suffix}`, password_hash: "not-a-real-hash" });
  createdAccountIds.push(account.id);
  const character = await characters.create({
    account_id: account.id,
    character_id: `t28-char-${suffix}`,
    name: "Test Character",
    character_type: "girl",
    age: 16,
    money,
  });
  return character;
}

// ---------------------------------------------------------------- schema and migrations

test("PostgreSQL schema: migrations are applied through version 2", live, async () => {
  const status = await new MigrationManager(database).getStatus();
  assert.equal(status.isUpToDate, true);
  assert.ok(status.currentVersion >= 2);
  const index = await database.queryOne(
    "SELECT indexname FROM pg_indexes WHERE indexname = 'financial_transactions_character_idempotency_key'",
  );
  assert.ok(index, "scoped idempotency index must exist");
  const oldConstraint = await database.queryOne(
    "SELECT conname FROM pg_constraint WHERE conname = 'financial_transactions_idempotency_key_key'",
  );
  assert.equal(oldConstraint, null, "global idempotency uniqueness must be removed by migration 2");
});

test("PostgreSQL schema: a migration manager on its own connection reports the real version", live, async () => {
  // Regression: the manager once read the global connection, so a CLI-owned connection reported version 0.
  const separate = new DatabaseConnection(loadDatabaseConfigFromEnv());
  await separate.connect();
  try {
    const status = await new MigrationManager(separate).getStatus();
    assert.equal(status.currentVersion, status.latestVersion);
    assert.equal(status.isUpToDate, true);
  } finally {
    await separate.disconnect();
  }
});

test("PostgreSQL schema: re-running migrations applies nothing", live, async () => {
  assert.equal(await new MigrationManager(database).migrate(), 0);
});

test("PostgreSQL schema: idempotency keys are unique per character, not globally", live, async () => {
  const first = await newCharacter(0);
  const second = await newCharacter(0);
  const key = `shared-key-${randomUUID()}`;
  await characters.updateMoney(first.character_id, 10, key);
  const other = await characters.updateMoney(second.character_id, 10, key);
  assert.equal(other.money, 10, "the same key on a different character must apply");
  await characters.delete(first.id);
  await characters.delete(second.id);
});

// ---------------------------------------------------------------- financial integrity

test("Money: concurrent debits cannot overdraw a balance", live, async () => {
  const character = await newCharacter(100);
  const attempts = await Promise.allSettled(
    Array.from({ length: 25 }, () => characters.updateMoney(character.character_id, -10, `debit-${randomUUID()}`)),
  );
  const succeeded = attempts.filter((result) => result.status === "fulfilled").length;
  const failed = attempts.filter((result) => result.status === "rejected");
  assert.equal(succeeded, 10, "exactly the affordable debits must succeed");
  assert.ok(failed.every((result) => result.reason.message === "Insufficient funds"));
  const final = await characters.findByCharacterId(character.character_id);
  assert.equal(final.money, 0);
  await characters.delete(character.id);
});

test("Money: a retried idempotency key is applied exactly once under concurrency", live, async () => {
  const character = await newCharacter(0);
  const key = `credit-${randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: 10 }, () => characters.updateMoney(character.character_id, 50, key)),
  );
  assert.ok(results.every((result) => result.money >= 50));
  const final = await characters.findByCharacterId(character.character_id);
  assert.equal(final.money, 50, "the amount must be applied once, not once per retry");
  const ledger = await database.query(
    "SELECT id FROM financial_transactions WHERE character_id = $1 AND idempotency_key = $2",
    [character.id, key],
  );
  assert.equal(ledger.length, 1);
  await characters.delete(character.id);
});

test("Money: a failed transaction rolls back the balance and the ledger together", live, async () => {
  const character = await newCharacter(40);
  await assert.rejects(
    database.transaction(async (client) => {
      await client.query("UPDATE characters SET money = money + 5 WHERE id = $1", [character.id]);
      await client.query(
        "INSERT INTO financial_transactions (character_id, transaction_type, amount, balance_after) VALUES ($1, 'credit', 5, 45)",
        [character.id],
      );
      throw new Error("simulated failure after writes");
    }),
    /simulated failure/,
  );
  const after = await characters.findByCharacterId(character.character_id);
  assert.equal(after.money, 40, "balance must be unchanged after rollback");
  const ledger = await database.query("SELECT id FROM financial_transactions WHERE character_id = $1", [character.id]);
  assert.equal(ledger.length, 0, "no ledger row may remain after rollback");
  await characters.delete(character.id);
});

test("Money: a debit that would make the balance negative is rejected by the database as well", live, async () => {
  const character = await newCharacter(5);
  await assert.rejects(
    database.query("UPDATE characters SET money = money - 10 WHERE id = $1", [character.id]),
    /check constraint|violates/i,
  );
  await characters.delete(character.id);
});

// ---------------------------------------------------------------- world-state storage

test("World state: first open creates the snapshot; later opens load the same version", live, async () => {
  const worldKey = `t28-world-${randomUUID()}`;
  const first = await PostgresWorldStore.open({ worldKey, db: database });
  assert.equal(first.getVersion(), 1);
  const second = await PostgresWorldStore.open({ worldKey, db: database });
  assert.equal(second.getVersion(), 1);
  await first.flush();
  assert.equal(first.getVersion(), 2);
  const third = await PostgresWorldStore.open({ worldKey, db: database });
  assert.equal(third.getVersion(), 2);
});

test("World state: a stale writer is fenced and cannot overwrite a newer snapshot", live, async () => {
  const worldKey = `t28-fence-${randomUUID()}`;
  const writerA = await PostgresWorldStore.open({ worldKey, db: database });
  const writerB = await PostgresWorldStore.open({ worldKey, db: database });

  writerA.state.worldClock.minute_of_day = 123;
  await writerA.flush();
  assert.equal(writerA.getVersion(), 2);

  writerB.state.worldClock.minute_of_day = 456;
  await assert.rejects(writerB.flush(), WorldStateConflictError);
  assert.equal(writerB.isFenced(), true);
  await assert.rejects(writerB.flush(), WorldStateConflictError, "a fenced store must keep refusing writes");

  const stored = await database.queryOne("SELECT value, version FROM world_state WHERE key = $1", [worldKey]);
  assert.equal(Number(stored.version), 2);
  assert.equal(stored.value.worldClock.minute_of_day, 123, "the stale writer's change must not be stored");

  const health = await writerB.health();
  assert.equal(health.status, "fail");
  const healthyA = await writerA.health();
  assert.equal(healthyA.status, "pass");
});

// ---------------------------------------------------------------- restart and multi-instance behavior

test("Restart: an identity saved before a crash is recovered by a fresh application context", live, async () => {
  const worldKey = `t28-restart-${randomUUID()}`;
  const storeOne = await PostgresWorldStore.open({ worldKey, db: database });
  const instanceOne = await startApi({ worldStore: storeOne, allowedOrigins: [] });
  const peer = await openPeer(instanceOne.websocketUrl);
  const identity = await createIdentity(peer, "Restart Test");
  await peer.close();

  // Simulate a crash: the final save at shutdown never happens. Identity creation already saved.
  storeOne.flush = async () => undefined;
  await stopApi(instanceOne.server);

  const storeTwo = await PostgresWorldStore.open({ worldKey, db: database });
  const instanceTwo = await startApi({ worldStore: storeTwo, allowedOrigins: [] });
  try {
    const peerTwo = await openPeer(instanceTwo.websocketUrl);
    const ready = await resumeSession(peerTwo, identity.sessionToken);
    assert.equal(ready.type, "session.ready");
    assert.equal(ready.playerId, identity.playerId);
    assert.equal(ready.character.name, "Restart Test");
    assert.equal(ready.character.age, 16);
    assert.equal(ready.character.character_type, "girl");
    await peerTwo.close();
  } finally {
    await stopApi(instanceTwo.server);
  }
});

test("Restart: a graceful shutdown saves the final state and it is recovered on restart", live, async () => {
  const worldKey = `t28-graceful-${randomUUID()}`;
  const storeOne = await PostgresWorldStore.open({ worldKey, db: database });
  const instanceOne = await startApi({ worldStore: storeOne, allowedOrigins: [] });
  const peer = await openPeer(instanceOne.websocketUrl);
  const identity = await createIdentity(peer, "Graceful Test");
  await peer.close();
  const versionBeforeShutdown = storeOne.getVersion();
  await stopApi(instanceOne.server);

  const storeTwo = await PostgresWorldStore.open({ worldKey, db: database });
  assert.ok(storeTwo.getVersion() >= versionBeforeShutdown);
  const instanceTwo = await startApi({ worldStore: storeTwo, allowedOrigins: [] });
  try {
    const peerTwo = await openPeer(instanceTwo.websocketUrl);
    const ready = await resumeSession(peerTwo, identity.sessionToken);
    assert.equal(ready.playerId, identity.playerId);
    await peerTwo.close();
  } finally {
    await stopApi(instanceTwo.server);
  }
});

test("Multi-instance: a second instance with stale state cannot save, is unhealthy, and cannot shut down cleanly", live, async () => {
  const worldKey = `t28-two-${randomUUID()}`;
  const storeA = await PostgresWorldStore.open({ worldKey, db: database });
  const storeB = await PostgresWorldStore.open({ worldKey, db: database });
  const instanceA = await startApi({ worldStore: storeA, allowedOrigins: [] });
  const instanceB = await startApi({
    worldStore: storeB,
    allowedOrigins: [],
    persistenceHealth: () => storeB.health(),
  });
  let identityA;
  try {
    const peerA = await openPeer(instanceA.websocketUrl);
    identityA = await createIdentity(peerA, "Instance A");
    await peerA.close();

    // Instance B still holds the pre-A snapshot, so its save must be refused.
    const peerB = await openPeer(instanceB.websocketUrl);
    peerB.send(identityCreateMessage("Instance B", { character_type: "boy" }));
    const failure = await peerB.waitForType("error");
    assert.equal(failure.code, "persistence_failed");
    await peerB.close();

    const health = await fetch(`${instanceB.baseUrl}/health`);
    assert.equal(health.status, 503, "a fenced instance must report unhealthy");
    const body = await health.json();
    assert.equal(body.checks.persistence.status, "fail");

    // A fenced instance must not overwrite newer state on shutdown either.
    await assert.rejects(stopApi(instanceB.server), WorldStateConflictError);
  } finally {
    await stopApi(instanceA.server);
  }

  // Only after A has stopped does a fresh instance start, so no two live writers overlap.
  const storeC = await PostgresWorldStore.open({ worldKey, db: database });
  const instanceC = await startApi({ worldStore: storeC, allowedOrigins: [] });
  try {
    const peerC = await openPeer(instanceC.websocketUrl);
    const ready = await resumeSession(peerC, identityA.sessionToken);
    assert.equal(ready.character.name, "Instance A", "B's failed identity must not be stored");
    await peerC.close();
  } finally {
    await stopApi(instanceC.server);
  }
});

test("Health: a PostgreSQL-backed instance whose connection is closed reports persistence failing over HTTP 503", live, async () => {
  // A separate connection, so the shared test connection is not affected.
  const separate = new DatabaseConnection(loadDatabaseConfigFromEnv());
  await separate.connect();
  const store = await PostgresWorldStore.open({ worldKey: `t28-down-${randomUUID()}`, db: separate });
  await separate.disconnect();
  const instance = await startApi({ worldStore: store, allowedOrigins: [], persistenceHealth: () => store.health() });
  try {
    const response = await fetch(`${instance.baseUrl}/health`);
    const body = await response.json();
    assert.equal(body.checks.persistence.status, "fail");
    assert.equal(body.checks.persistence.message, "PostgreSQL is unreachable or not responding.");
    assert.equal(body.status, "unhealthy");
    assert.equal(response.status, 503);
  } finally {
    // Shutdown may try to flush the store through the closed connection. That failure is expected here.
    await stopApi(instance.server).catch(() => undefined);
  }
});

test("Health: a healthy PostgreSQL-backed instance reports persistence as passing", live, async () => {
  const worldKey = `t28-health-${randomUUID()}`;
  const store = await PostgresWorldStore.open({ worldKey, db: database });
  const instance = await startApi({ worldStore: store, allowedOrigins: [], persistenceHealth: () => store.health() });
  try {
    const response = await fetch(`${instance.baseUrl}/health`);
    const body = await response.json();
    // The persistence check must pass. The overall status depends on the single-sample host checks, so it is not fixed here.
    assert.equal(body.checks.persistence.status, "pass");
    assert.equal(response.status, body.status === "unhealthy" ? 503 : 200);
    assert.match(body.checks.persistence.message, /PostgreSQL reachable/);
  } finally {
    await stopApi(instance.server);
  }
});
