import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { database } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { PostgresWorldStore } from "../dist/database/world-store.js";
import { WorldStateCapacityError } from "../dist/multiplayer/persistence.js";
import { uniqueWorldKey } from "./support/creation-fixture.mjs";

/**
 * R5 on PostgreSQL: a save over the size limit is refused before the row is written.
 *
 * Runs only when DATABASE_URL points at a disposable database (NAIJA_ALLOW_DB_TESTS=true).
 * Rows use a unique world key, and the test removes its row afterwards.
 */

const PG_LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
if (PG_LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

const SIXTEEN_MIB = 16 * 1024 * 1024;

describe("R5 world capacity (postgres backend)", { skip: PG_LIVE ? false : "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" }, () => {
  let worldKey;

  before(async () => {
    await database.connect();
    await new MigrationManager(database).migrate();
    worldKey = uniqueWorldKey();
  });

  after(async () => {
    if (worldKey) await database.query("DELETE FROM world_state WHERE key = $1", [worldKey]);
    await database.disconnect();
  });

  test("a save over the limit is refused and the stored row, version, and value are unchanged", async () => {
    const store = await PostgresWorldStore.open({ worldKey, db: database });
    const before = await database.queryOne("SELECT value, version FROM world_state WHERE key = $1", [worldKey]);

    // Pad a copy of the live world past the limit. The candidate is only ever saved, never merged.
    const candidate = structuredClone(store.state);
    candidate.lifeEvents["pad-record"] = { payload: "x".repeat(SIXTEEN_MIB) };
    await assert.rejects(store.saveState(candidate), (error) => error instanceof WorldStateCapacityError);

    const after = await database.queryOne("SELECT value, version FROM world_state WHERE key = $1", [worldKey]);
    assert.equal(String(after.version), String(before.version), "the version must not advance");
    assert.deepEqual(after.value, before.value, "the stored world must be unchanged");
    assert.equal(store.state.lifeEvents["pad-record"], undefined, "the live world must not contain the refused candidate");
  });

  test("a flush over the limit is refused, and the next normal save still works", async () => {
    const store = await PostgresWorldStore.open({ worldKey, db: database });
    store.state.lifeEvents["pad-record"] = { payload: "x".repeat(SIXTEEN_MIB) };
    await assert.rejects(store.flush(), (error) => error instanceof WorldStateCapacityError);

    // Remove the padding from the live world; the next save must succeed and persist normally.
    delete store.state.lifeEvents["pad-record"];
    await store.flush();
    const row = await database.queryOne("SELECT value FROM world_state WHERE key = $1", [worldKey]);
    assert.equal(row.value.lifeEvents["pad-record"], undefined);
  });
});
