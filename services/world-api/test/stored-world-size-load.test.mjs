import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { database } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { MAX_SNAPSHOT_BYTES, PostgresWorldStore, StoredWorldTooLargeError } from "../dist/database/world-store.js";
import { initialState } from "../dist/multiplayer/persistence.js";
import { uniqueWorldKey } from "./support/creation-fixture.mjs";

/**
 * Stage 28, G2: a stored PostgreSQL world above the save limit is refused at load. The size is the serialized UTF-8
 * size of the compact JSON, the same measure the save path uses. The row is never changed, truncated, or deleted.
 *
 * Runs only when DATABASE_URL points at a disposable database (NAIJA_ALLOW_DB_TESTS=true). Every row uses a unique
 * world key and is removed afterwards. Local PostgreSQL results do not prove Neon or production behaviour.
 */

const PG_LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
if (PG_LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

/** A valid world whose compact JSON is exactly `targetBytes` UTF-8 bytes (padding is ASCII, one byte per character). */
function worldOfBytes(targetBytes) {
  const state = initialState(Date.now());
  const record = (payload) => ({
    event_id: "size-record",
    event_type: "character_created",
    world_date: state.worldClock.world_date,
    world_day: state.worldClock.day,
    minute_of_day: 0,
    participant_ids: [],
    summary: "size test",
    data: { payload },
  });
  state.lifeEvents["size-record"] = record("");
  const base = Buffer.byteLength(JSON.stringify(state), "utf8");
  const padding = targetBytes - base;
  if (padding < 0) throw new Error("target is smaller than the minimal world");
  state.lifeEvents["size-record"] = record("x".repeat(padding));
  assert.equal(Buffer.byteLength(JSON.stringify(state), "utf8"), targetBytes, "the padded world has the target size");
  return state;
}

describe("stored world size limit at load (postgres backend)", { skip: PG_LIVE ? false : "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" }, () => {
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

  async function insertRow(key, value) {
    await database.query("INSERT INTO world_state (key, value, version) VALUES ($1, $2::jsonb, 1)", [key, JSON.stringify(value)]);
  }

  async function storedRow(key) {
    return database.queryOne("SELECT value, version FROM world_state WHERE key = $1", [key]);
  }

  test("a stored world of exactly the limit loads; one byte more is refused", async () => {
    const atLimit = freshKey();
    await insertRow(atLimit, worldOfBytes(MAX_SNAPSHOT_BYTES));
    const store = await PostgresWorldStore.open({ worldKey: atLimit, db: database });
    assert.equal(store.getVersion(), 1, "loading does not advance the version");
    assert.equal(Buffer.byteLength(JSON.stringify(store.state), "utf8"), MAX_SNAPSHOT_BYTES);

    const overByOne = freshKey();
    await insertRow(overByOne, worldOfBytes(MAX_SNAPSHOT_BYTES + 1));
    const before = await storedRow(overByOne);
    await assert.rejects(PostgresWorldStore.open({ worldKey: overByOne, db: database }), (error) => {
      assert.ok(error instanceof StoredWorldTooLargeError);
      assert.equal(error.storedBytes, MAX_SNAPSHOT_BYTES + 1);
      return true;
    });
    const after = await storedRow(overByOne);
    assert.deepEqual(after.value, before.value, "the row is unchanged");
    assert.equal(String(after.version), String(before.version), "the version is unchanged");
  });

  test("the size check runs before validation: an oversized invalid row gets the size error, not a validation error", async () => {
    const key = freshKey();
    await insertRow(key, { schemaVersion: 999, players: "not-an-object", pad: "x".repeat(MAX_SNAPSHOT_BYTES) });
    const before = await storedRow(key);
    await assert.rejects(PostgresWorldStore.open({ worldKey: key, db: database }), (error) => error instanceof StoredWorldTooLargeError);
    const after = await storedRow(key);
    assert.deepEqual(after.value, before.value);
    assert.equal(String(after.version), String(before.version));
  });

  test("repeated load attempts keep refusing and never write, and loading resumes once a smaller valid row is in place", async () => {
    const key = freshKey();
    await insertRow(key, worldOfBytes(MAX_SNAPSHOT_BYTES + 1024));
    const before = await storedRow(key);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(PostgresWorldStore.open({ worldKey: key, db: database }), (error) => error instanceof StoredWorldTooLargeError);
    }
    assert.deepEqual((await storedRow(key)).value, before.value, "three refused loads leave the row unchanged");

    // A test-owned row replaced by a valid, smaller world. This checks that the load path recovers; it is not an
    // operator procedure for production data (see docs/STAGE_28_PERSISTENCE_SAFETY.md).
    await database.query("UPDATE world_state SET value = $2::jsonb WHERE key = $1", [key, JSON.stringify(initialState(Date.now()))]);
    const store = await PostgresWorldStore.open({ worldKey: key, db: database });
    assert.equal(store.getVersion(), 1);
  });
});
