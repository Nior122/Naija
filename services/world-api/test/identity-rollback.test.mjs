import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { database } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { PostgresWorldStore } from "../dist/database/world-store.js";
import { FaultyStore, waitUntil } from "./support/faulty-store.mjs";
import {
  createMessage,
  keyHashOf,
  newCreationKey,
  openFileBackend,
  orphanProblems,
  recordCounts,
  startCreationServer,
  uniqueWorldKey,
} from "./support/creation-fixture.mjs";
import { openPeer } from "./support/harness.mjs";

/**
 * R2: a failed identity creation must leave no partial authoritative state.
 *
 * Runs against the file backend always, and against PostgreSQL when DATABASE_URL points at a
 * disposable database (NAIJA_ALLOW_DB_TESTS=true). Database rows use unique world keys.
 */

const PG_LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
if (PG_LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

/**
 * Starter families are generated with random sibling counts, so the number of people per identity varies.
 * Players, households, and families are exact. People are checked for orphans instead (orphanProblems).
 */
const EXACT_FIELDS = ["players", "households", "families"];

const POINTS = [
  "player-inserted",
  "starter-family",
  "economy",
  "property",
  "government",
  "justice",
  "military",
  "culture",
  "entertainment",
  "before-save",
];

before(async () => {
  if (!PG_LIVE) return;
  await database.connect();
  await new MigrationManager(database).migrate();
});

after(async () => {
  if (!PG_LIVE) return;
  await database.disconnect();
});

async function openBackend(name) {
  if (name === "file") return openFileBackend();
  const worldKey = uniqueWorldKey();
  const store = new FaultyStore(await PostgresWorldStore.open({ worldKey, db: database }));
  return {
    name: "postgres",
    store,
    async durableState() {
      const row = await database.queryOne("SELECT value FROM world_state WHERE key = $1", [worldKey]);
      return row.value;
    },
    async cleanup() {
      await database.query("DELETE FROM world_state WHERE key = $1", [worldKey]);
    },
  };
}

const backendNames = ["file", ...(PG_LIVE ? ["postgres"] : [])];

async function sendAndWaitForReply(url, message, timeoutMs = 5000) {
  const peer = await openPeer(url);
  try {
    peer.send(message);
    return await peer.waitFor((reply) => reply.type === "identity.created" || reply.type === "error", timeoutMs);
  } finally {
    await peer.close();
  }
}

/** The number of records one successful identity adds to an otherwise empty world. */
async function perIdentityDelta(name) {
  const backend = await openBackend(name);
  const started = await startCreationServer(backend);
  try {
    const before = recordCounts(backend.store.state);
    const reply = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Control"));
    assert.equal(reply.type, "identity.created");
    const after = recordCounts(backend.store.state);
    return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  } finally {
    await started.stop();
    await backend.cleanup();
  }
}

for (const name of backendNames) {
  describe(`R2 identity creation rollback (${name} backend)`, () => {
    test("R2 reproduction: a failed save leaves the in-memory world identical to its pre-attempt state", async () => {
      const backend = await openBackend(name);
      const started = await startCreationServer(backend);
      try {
        const before = structuredClone(backend.store.state);
        backend.store.failNextWrite();
        const reply = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Failed"));
        assert.equal(reply.type, "error");
        assert.equal(reply.code, "persistence_failed");
        assert.deepEqual(backend.store.state, before, "the failed attempt must leave no record behind");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("R2 reproduction: after a failed save, the next successful creation persists no orphaned records", async () => {
      const delta = await perIdentityDelta(name);
      const backend = await openBackend(name);
      const started = await startCreationServer(backend);
      try {
        const first = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "First"));
        assert.equal(first.type, "identity.created");
        const afterFirst = recordCounts(backend.store.state);

        backend.store.failNextWrite();
        const failed = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Failed"));
        assert.equal(failed.code, "persistence_failed");
        assert.deepEqual(recordCounts(backend.store.state), afterFirst, "no households, families, or people from the failed attempt");

        const next = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Next"));
        assert.equal(next.type, "identity.created", "the next creation must work normally");

        const durable = await backend.durableState();
        assert.deepEqual(orphanProblems(durable), [], "the saved state must contain no orphaned records");
        const counts = recordCounts(durable);
        for (const field of EXACT_FIELDS) {
          assert.equal(counts[field], afterFirst[field] + delta[field], `${field}: exactly one identity more`);
        }
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    for (const point of POINTS) {
      test(`R2 failure injected at "${point}" leaves no partial state, and the next creation works`, async () => {
        const delta = await perIdentityDelta(name);
        let armed = false;
        const backend = await openBackend(name);
        const started = await startCreationServer(backend, {
          creationFaultHook: (current) => {
            if (armed && current === point) throw new Error("injected");
          },
        });
        try {
          const before = structuredClone(backend.store.state);
          armed = true;
          const failed = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Injected"), 3000);
          armed = false;
          assert.equal(failed?.type, "error", "the failed creation must return an error");
          assert.deepEqual(backend.store.state, before, `state after a failure at "${point}"`);

          const next = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Next"));
          assert.equal(next.type, "identity.created");
          const durable = await backend.durableState();
          assert.deepEqual(orphanProblems(durable), []);
          const counts = recordCounts(durable);
          for (const field of EXACT_FIELDS) {
            assert.equal(counts[field], delta[field], `${field} after one successful identity`);
          }
        } finally {
          await started.stop();
          await backend.cleanup();
        }
      });
    }

    test("R2: a save that commits but reports failure (lost response) leaves no orphans; the retry creates one identity", async () => {
      const backend = await openBackend(name);
      const started = await startCreationServer(backend);
      const key = newCreationKey();
      try {
        const before = structuredClone(backend.store.state);
        backend.store.failNextWriteAfterCommit();
        const failed = await sendAndWaitForReply(started.websocketUrl, createMessage(key, "Lost"));
        assert.equal(failed.code, "persistence_failed");
        assert.deepEqual(backend.store.state, before, "the in-memory world must not keep the failed identity");

        const retried = await sendAndWaitForReply(started.websocketUrl, createMessage(key, "Lost"));
        assert.equal(retried.type, "identity.created");
        const durable = await backend.durableState();
        assert.deepEqual(orphanProblems(durable), []);
        const matches = Object.values(durable.players).filter((player) => player.creationKeyHash === keyHashOf(key));
        assert.equal(matches.length, 1, "exactly one identity for the key in saved state");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("R2 guard: a concurrent change to an unrelated record survives a failed save and is saved later", async () => {
      const backend = await openBackend(name);
      const started = await startCreationServer(backend);
      try {
        const existing = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Existing"));
        assert.equal(existing.type, "identity.created");
        const existingId = existing.playerId;

        backend.store.failNextWrite();
        const release = backend.store.holdNextWrite();
        const failing = await openPeer(started.websocketUrl);
        failing.send(createMessage(newCreationKey(), "Failing"));
        await waitUntil(() => backend.store.heldCount === 1);
        const marker = "changed-during-save";
        backend.store.state.players[existingId].character.updated_at = marker;
        release();
        const reply = await failing.waitFor((message) => message.type === "error", 5000);
        await failing.close();
        assert.equal(reply.code, "persistence_failed");
        assert.equal(backend.store.state.players[existingId].character.updated_at, marker, "live change kept");

        const next = await sendAndWaitForReply(started.websocketUrl, createMessage(newCreationKey(), "Next"));
        assert.equal(next.type, "identity.created");
        const durable = await backend.durableState();
        assert.equal(durable.players[existingId].character.updated_at, marker, "saved later");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("R2 guard: a concurrent creation for another key is not affected by a failed one", async () => {
      const backend = await openBackend(name);
      const started = await startCreationServer(backend);
      try {
        const before = structuredClone(backend.store.state);
        const failedKey = newCreationKey();
        const okKey = newCreationKey();
        backend.store.failNextWrite();
        const release = backend.store.holdNextWrite();
        const failing = await openPeer(started.websocketUrl);
        const succeeding = await openPeer(started.websocketUrl);
        try {
          failing.send(createMessage(failedKey, "Failing"));
          await waitUntil(() => backend.store.heldCount === 1);
          succeeding.send(createMessage(okKey, "Succeeding"));
          await new Promise((resolve) => setTimeout(resolve, 50));
          release();
          const failedReply = await failing.waitFor((message) => message.type === "error", 5000);
          const okReply = await succeeding.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
          assert.equal(failedReply.code, "persistence_failed");
          assert.equal(okReply.type, "identity.created");
        } finally {
          await failing.close();
          await succeeding.close();
        }
        const durable = await backend.durableState();
        const players = Object.values(durable.players);
        assert.equal(players.length, Object.keys(before.players).length + 1, "only the successful identity is added");
        assert.equal(players.filter((player) => player.creationKeyHash === keyHashOf(failedKey)).length, 0);
        assert.equal(players.filter((player) => player.creationKeyHash === keyHashOf(okKey)).length, 1);
        assert.deepEqual(orphanProblems(durable), []);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
