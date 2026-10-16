import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { keyHashOf, newCreationKey, orphanProblems } from "./support/creation-fixture.mjs";
import {
  backendNames,
  connectBackends,
  createFrom,
  disconnectBackends,
  openBackend,
  playersWithKey,
  startOver,
} from "./support/creation-backends.mjs";

/**
 * Characterization of the unresolved same-key identity (Stage 28, docs/STAGE_28_SAME_KEY_CONFLICT.md, "Open policy
 * conflict"). These tests pin what the code does today, so the open policy decision is visible in the suite. They do
 * not endorse the behaviour. A test whose name starts with CHARACTERIZATION will change when the policy is decided.
 *
 * Runs on the file backend always, and on PostgreSQL when a disposable database is configured. No real world file is used.
 */

const HOUR_MS = 60 * 60_000;
const COURT = "court:magistrate-fct";

before(connectBackends);
after(disconnectBackends);

const budget = (perIpLimit) => ({ perIpLimit, globalLimit: 1000, windowMs: HOUR_MS });

function conflictHook(backend, { failCompensation }) {
  let armed = true;
  return (point) => {
    if (!armed || point !== "after-save") return;
    armed = false;
    backend.store.state.courts[COURT] = { court_id: COURT, concurrent: true };
    if (failCompensation) backend.store.failNextWrite();
  };
}

async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

/**
 * Records every write the engine asks the store for, as the list of identities with this key that the write holds.
 * The engine writes the live world through flush() and a draft through saveState(). Failed writes are recorded too.
 */
function recordWrites(backend, keyHash) {
  const writes = [];
  const store = backend.store;
  const originalFlush = store.flush.bind(store);
  const originalSave = store.saveState.bind(store);
  store.flush = () => {
    writes.push({ kind: "flush", ids: playersWithKey(store.state, keyHash) });
    return originalFlush();
  };
  store.saveState = (candidate) => {
    writes.push({ kind: "saveState", ids: playersWithKey(candidate, keyHash) });
    return originalSave(candidate);
  };
  return writes;
}

for (const name of backendNames) {
  describe(`unresolved same-key identity: current behaviour (${name} backend)`, () => {
    test("CHARACTERIZATION: the tick drops the unresolved identity within seconds with no client action, and releases its slot", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(1),
        tickIntervalMs: 50,
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      try {
        const key = newCreationKey();
        assert.equal((await createFrom(started, "127.0.0.1", key, "First")).code, "identity_creation_pending");
        const unresolvedId = playersWithKey(await backend.durableState(), keyHashOf(key))[0];
        assert.ok(unresolvedId, "premise: the saved file holds the unresolved identity");

        // No retry is sent. The tick's own save (dirty, at least 1 s since the last save) writes the live world.
        const startedAt = Date.now();
        const gone = await until(async () => playersWithKey(await backend.durableState(), keyHashOf(key)).length === 0, 8000);
        const elapsedMs = Date.now() - startedAt;
        assert.ok(gone, "the tick removed the unresolved identity from the saved file");
        console.log(`[${name}] unresolved identity dropped by tick after ${elapsedMs} ms`);
        assert.ok(elapsedMs < 3000, `dropped within 3 s (measured ${elapsedMs} ms)`);
        assert.deepEqual(orphanProblems(await backend.durableState()), []);

        // The slot was released: with a limit of 1, another key from the same address is accepted.
        const other = await createFrom(started, "127.0.0.1", newCreationKey(), "Other");
        assert.equal(other.type, "identity.created", "the released slot allows a creation from the same address");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("CHARACTERIZATION: a retry after resolution writes the live world first, so no write ever holds two identities for the key", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(5),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      try {
        const key = newCreationKey();
        const keyHash = keyHashOf(key);
        assert.equal((await createFrom(started, "127.0.0.1", key, "First")).code, "identity_creation_pending");
        const unresolvedId = playersWithKey(await backend.durableState(), keyHash)[0];

        const writes = recordWrites(backend, keyHash);
        const created = await createFrom(started, "127.0.0.1", key, "Retry");
        assert.equal(created.type, "identity.created");

        assert.ok(writes.length >= 2, "the retry wrote at least twice");
        assert.equal(writes[0].kind, "flush", "the first write is the live-world save that resolves the pending identity");
        assert.deepEqual(writes[0].ids, [], "that save holds no identity for the key");
        for (const write of writes) assert.ok(write.ids.length <= 1, "no write holds two identities for the key");
        assert.deepEqual(writes.at(-1).ids, [created.playerId], "the final write holds only the new identity");

        const durable = await backend.durableState();
        assert.equal(durable.players[unresolvedId], undefined, "the unresolved identity is gone");
        assert.deepEqual(playersWithKey(durable, keyHash), [created.playerId]);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("CHARACTERIZATION: a graceful restart drops the unresolved identity from the saved file, so the key then gets a new identity", async () => {
      const backend = await openBackend(name);
      const key = newCreationKey();
      const keyHash = keyHashOf(key);
      const first = await startOver(backend, {
        identityBudget: budget(2),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      let unresolvedId;
      try {
        assert.equal((await createFrom(first, "127.0.0.1", key, "First")).code, "identity_creation_pending");
        unresolvedId = playersWithKey(await backend.durableState(), keyHash)[0];
        assert.ok(unresolvedId, "premise: the saved file holds the unresolved identity");
      } finally {
        // The conflict hook put a court record in the live world that has no required fields, and the stop below would
        // save it. Remove it first so the saved file can load. This changes only the test's live world, not the identity.
        delete backend.store.state.courts[COURT];
        // A graceful stop flushes the live world (which does not hold the identity). Unlike a crash, nothing restores it.
        await first.stop();
      }
      assert.deepEqual(playersWithKey(await backend.durableState(), keyHash), [], "the graceful stop removed it from the file");

      await backend.reopen();
      const second = await startOver(backend, { identityBudget: budget(2) });
      try {
        const created = await createFrom(second, "127.0.0.1", key, "After restart");
        assert.equal(created.type, "identity.created");
        assert.notEqual(created.playerId, unresolvedId, "the new identity is not the unresolved one");
        assert.deepEqual(playersWithKey(await backend.durableState(), keyHash), [created.playerId]);
      } finally {
        await second.stop();
        await backend.cleanup();
      }
    });

    test("the unresolved identity is never sent a token: no reply to its key carries one, and its saved record holds only a hash", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(2),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      try {
        const key = newCreationKey();
        const reply = await createFrom(started, "127.0.0.1", key, "First");
        assert.equal(reply.type, "error");
        assert.ok(!("sessionToken" in reply), "the pending reply carries no token");
        const record = (await backend.durableState()).players[playersWithKey(await backend.durableState(), keyHashOf(key))[0]];
        assert.ok(record, "premise: the saved file holds the unresolved identity");
        assert.equal(typeof record.tokenHash, "string", "the saved record holds a token hash");
        assert.ok(!("sessionToken" in record), "no plaintext token is saved");
        assert.match(record.tokenHash, /^[0-9a-f]{64}$/, "the stored value is a SHA-256 hex digest");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
