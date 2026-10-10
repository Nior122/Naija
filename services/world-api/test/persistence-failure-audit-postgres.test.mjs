import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { database } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { PostgresWorldStore } from "../dist/database/world-store.js";
import { initialState, WorldStateCapacityError } from "../dist/multiplayer/persistence.js";
import { uniqueWorldKey } from "./support/creation-fixture.mjs";

/**
 * Persistence failure audit (PostgreSQL). Stage 28, Task 1.
 *
 * Runs only when DATABASE_URL points at a disposable database (NAIJA_ALLOW_DB_TESTS=true). Every row uses a unique
 * world key and is removed afterwards. Tests marked CURRENT BEHAVIOUR record a gap; they do not endorse it.
 * Local PostgreSQL results do not prove Neon or production behaviour.
 */

const PG_LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
if (PG_LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

const MiB = 1024 * 1024;

describe("persistence failure audit (postgres backend)", { skip: PG_LIVE ? false : "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" }, () => {
  const keys = [];
  const freshKey = () => {
    const key = uniqueWorldKey();
    keys.push(key);
    return key;
  };

  before(async () => {
    await database.connect();
    await new MigrationManager(database).migrate();
  });

  after(async () => {
    for (const key of keys) await database.query("DELETE FROM world_state WHERE key = $1", [key]);
    await database.disconnect();
  });

  async function storedRow(key) {
    return database.queryOne("SELECT value, version FROM world_state WHERE key = $1", [key]);
  }

  test("a refused save leaves the stored row unchanged, and a new store instance loads the previous version", async () => {
    const key = freshKey();
    const store = await PostgresWorldStore.open({ worldKey: key, db: database });
    await store.flush();
    const before = await storedRow(key);

    const candidate = structuredClone(store.state);
    candidate.lifeEvents["pad-record"] = { payload: "x".repeat(16 * MiB) };
    await assert.rejects(store.saveState(candidate), (error) => error instanceof WorldStateCapacityError);

    const after = await storedRow(key);
    assert.equal(String(after.version), String(before.version), "the version does not advance");
    assert.deepEqual(after.value, before.value, "the stored world is unchanged");
    assert.equal(store.isFenced(), false, "a refused save does not fence the instance");

    const reloaded = await PostgresWorldStore.open({ worldKey: key, db: database });
    assert.equal(reloaded.getVersion(), Number(before.version));
    assert.equal(reloaded.state.lifeEvents["pad-record"], undefined, "the refused candidate is not loaded");
  });

  test("a restart after a refused save loads the last saved world, not the live world", async () => {
    const key = freshKey();
    const store = await PostgresWorldStore.open({ worldKey: key, db: database });
    store.state.worldClock.minute_of_day = 100;
    await store.flush();

    // Live-only changes after the last save, and then a refused save.
    store.state.worldClock.minute_of_day = 900;
    store.state.lifeEvents["pad-record"] = { payload: "x".repeat(16 * MiB) };
    await assert.rejects(store.flush(), (error) => error instanceof WorldStateCapacityError);

    const restarted = await PostgresWorldStore.open({ worldKey: key, db: database });
    assert.equal(restarted.state.worldClock.minute_of_day, 100, "the restarted world has the last saved clock");
    assert.equal(restarted.state.lifeEvents["pad-record"], undefined);
  });

  test("a later normal save after the refusal succeeds and advances the version once", async () => {
    const key = freshKey();
    const store = await PostgresWorldStore.open({ worldKey: key, db: database });
    await store.flush();
    const before = await storedRow(key);

    store.state.lifeEvents["pad-record"] = { payload: "x".repeat(16 * MiB) };
    await assert.rejects(store.flush(), (error) => error instanceof WorldStateCapacityError);
    delete store.state.lifeEvents["pad-record"];
    store.state.worldClock.minute_of_day = 42;
    await store.flush();

    const after = await storedRow(key);
    assert.equal(Number(after.version), Number(before.version) + 1);
    assert.equal(after.value.worldClock.minute_of_day, 42);
  });

  test("CURRENT BEHAVIOUR: health() reports pass while saves are refused by the size limit", async (t) => {
    const key = freshKey();
    const store = await PostgresWorldStore.open({ worldKey: key, db: database });
    await store.flush();
    store.state.lifeEvents["pad-record"] = { payload: "x".repeat(16 * MiB) };
    await assert.rejects(store.flush(), (error) => error instanceof WorldStateCapacityError);

    const health = await store.health();
    t.diagnostic(`health after refusal: ${health.status}: ${health.message}`);
    // Recorded, not endorsed: health reports reachability and the fence only, not the last save result.
    assert.equal(health.status, "pass");
    delete store.state.lifeEvents["pad-record"];
  });

  test("a malformed stored row is refused at startup and the row is not overwritten", async () => {
    const key = freshKey();
    await database.query(
      "INSERT INTO world_state (key, value, version) VALUES ($1, $2::jsonb, 1)",
      [key, JSON.stringify({ schemaVersion: 999, players: "not-an-object" })],
    );
    const before = await storedRow(key);
    await assert.rejects(PostgresWorldStore.open({ worldKey: key, db: database }));
    const after = await storedRow(key);
    assert.deepEqual(after.value, before.value, "the malformed row is left as it was");
    assert.equal(String(after.version), String(before.version));
  });

  test("CURRENT BEHAVIOUR: an oversized stored row loads without a size check, and the next save is refused", async (t) => {
    const key = freshKey();
    const fresh = initialState(Date.now());
    // A valid life-event record (the loader checks lifecycle records), with a 16 MiB payload in its data.
    fresh.lifeEvents["pad-record"] = {
      event_id: "pad-record",
      event_type: "character_created",
      world_date: fresh.worldClock.world_date,
      world_day: fresh.worldClock.day,
      minute_of_day: 0,
      participant_ids: [],
      summary: "audit padding",
      data: { payload: "x".repeat(16 * MiB) },
    };
    await database.query(
      "INSERT INTO world_state (key, value, version) VALUES ($1, $2::jsonb, 1)",
      [key, JSON.stringify(fresh)],
    );
    const before = await storedRow(key);

    // Recorded, not endorsed: the file backend refuses an oversized file at startup; PostgreSQL does not check on load.
    const store = await PostgresWorldStore.open({ worldKey: key, db: database });
    t.diagnostic(`oversized row loaded: ${Buffer.byteLength(JSON.stringify(store.state), "utf8")} bytes of state`);
    await assert.rejects(store.flush(), (error) => error instanceof WorldStateCapacityError);
    const after = await storedRow(key);
    assert.deepEqual(after.value, before.value, "the oversized row is left as it was");
  });
});
