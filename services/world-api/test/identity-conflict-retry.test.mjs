import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { keyHashOf, newCreationKey, orphanProblems } from "./support/creation-fixture.mjs";
import {
  backendNames,
  connectBackends,
  createFrom,
  disconnectBackends,
  openBackend,
  openPeerFrom,
  playersWithKey,
  startOver,
} from "./support/creation-backends.mjs";

/**
 * Same-key identity conflict (Stage 28, docs/STAGE_28_CREATION_ATOMICITY.md, "Same-key conflict").
 *
 * A merge conflict after a committed save leaves the new identity in the saved file while the live world does not hold
 * it. Policy (REFUSE UNTIL RESOLVED): the key is refused with identity_creation_pending until a successful save of the
 * live world removes that identity from the file. No second identity is created, no token is issued for the conflicted
 * identity, and the conflicted identity holds one per-IP budget slot only while it is unresolved.
 *
 * Runs on the file backend always, and on PostgreSQL when a disposable database is configured. No real world file is used.
 */

const HOUR_MS = 60 * 60_000;
const COURT = "court:magistrate-fct";

before(connectBackends);
after(disconnectBackends);

const budget = (perIpLimit) => ({ perIpLimit, globalLimit: 1000, windowMs: HOUR_MS });

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Arms one conflict. After the creation's save commits, the live world gets a court that the creation also adds, so
 * the merge conflicts. With failCompensation, the next write (the compensating save) also fails.
 */
function conflictHook(backend, { failCompensation }) {
  let armed = true;
  return (point) => {
    if (!armed || point !== "after-save") return;
    armed = false;
    backend.store.state.courts[COURT] = { court_id: COURT, concurrent: true };
    if (failCompensation) backend.store.failNextWrite();
  };
}

/** Resumes a session on a new socket. Returns "session.ready", or the error code the server sent. */
async function resumes(url, token) {
  const socket = await openPeerFrom(url, "127.0.0.1");
  try {
    socket.send({ type: "session.resume", sessionToken: token });
    const reply = await socket.waitFor((message) => message.type === "session.ready" || message.type === "error", 20000);
    return reply.type === "session.ready" ? "session.ready" : reply.code;
  } finally {
    await socket.close();
  }
}

for (const name of backendNames) {
  describe(`same-key conflict contract (${name} backend)`, () => {
    test("an unresolved conflict returns no identity; the saved file holds it, the live world does not, and the key is refused", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(2),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      try {
        const key = newCreationKey();
        const reply = await createFrom(started, "127.0.0.1", key, "First");
        assert.equal(reply.type, "error");
        assert.equal(reply.code, "identity_creation_pending");
        assert.ok(!("sessionToken" in reply) && !("playerId" in reply), "no identity or token is returned");

        const durable = await backend.durableState();
        assert.equal(playersWithKey(durable, keyHashOf(key)).length, 1, "the saved file holds the unresolved identity");
        assert.equal(playersWithKey(backend.store.state, keyHashOf(key)).length, 0, "the live world does not hold it");
        assert.deepEqual(orphanProblems(durable), []);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("repeated requests with the key are refused while unresolved: nothing is written, and the held slot limits the address", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(1),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      try {
        const key = newCreationKey();
        assert.equal((await createFrom(started, "127.0.0.1", key, "First")).code, "identity_creation_pending");
        const durableBefore = digest(await backend.durableState());
        const liveBefore = digest(backend.store.state.players);

        // Each retry tries to resolve first; the save fails, so the retry is refused and writes nothing.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          backend.store.failNextWrite();
          const retry = await createFrom(started, "127.0.0.1", key, "Retry");
          assert.equal(retry.code, "identity_creation_pending", `retry ${attempt + 1} is refused`);
        }
        assert.equal(digest(await backend.durableState()), durableBefore, "the saved file is unchanged by the refused retries");
        assert.equal(digest(backend.store.state.players), liveBefore, "the live world is unchanged by the refused retries");

        // The unresolved identity holds the only slot of this address (limit 1), so another key from it is limited.
        const other = await createFrom(started, "127.0.0.1", newCreationKey(), "Other");
        assert.equal(other.code, "identity_creation_limited", "the unresolved identity holds its per-IP slot");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("once persistence works, the retry resolves the unresolved identity, creates one new identity, and releases the held slot", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(1),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      try {
        const key = newCreationKey();
        assert.equal((await createFrom(started, "127.0.0.1", key, "First")).code, "identity_creation_pending");
        const unresolvedId = playersWithKey(await backend.durableState(), keyHashOf(key))[0];
        assert.ok(unresolvedId, "premise: the saved file holds the unresolved identity");

        // Persistence works now. The retry resolves (its save removes the unresolved identity), then creates. With a
        // limit of 1, the creation succeeds only because the unresolved identity's slot was released.
        const created = await createFrom(started, "127.0.0.1", key, "Retry");
        assert.equal(created.type, "identity.created");
        assert.notEqual(created.playerId, unresolvedId, "the new identity is not the unresolved one");

        const durable = await backend.durableState();
        assert.deepEqual(playersWithKey(durable, keyHashOf(key)), [created.playerId], "exactly one identity for the key");
        assert.deepEqual(playersWithKey(backend.store.state, keyHashOf(key)), [created.playerId], "live agrees with the file");
        assert.deepEqual(orphanProblems(durable), []);
        assert.equal(await resumes(started.websocketUrl, created.sessionToken), "session.ready", "the new session works");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a conflict whose compensating save succeeds is rejected with no identity and consumes no budget", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(2),
        creationFaultHook: conflictHook(backend, { failCompensation: false }),
      });
      try {
        const key = newCreationKey();
        const conflicted = await createFrom(started, "127.0.0.1", key, "Conflicted");
        assert.equal(conflicted.code, "identity_creation_conflict");
        assert.ok(!("sessionToken" in conflicted));
        const durableAfterConflict = await backend.durableState();
        assert.equal(Object.keys(durableAfterConflict.players).length, 0, "the saved file holds no identity");
        assert.equal(Object.keys(backend.store.state.players).length, 0, "the live world holds no identity");

        // No slot was consumed: with a limit of 2, two more creations from this address succeed, a third is refused.
        const retry = await createFrom(started, "127.0.0.1", key, "Retry");
        assert.equal(retry.type, "identity.created", "the retry is a normal creation");
        const next = await createFrom(started, "127.0.0.1", newCreationKey(), "Next");
        assert.equal(next.type, "identity.created", "the second slot is free");
        const third = await createFrom(started, "127.0.0.1", newCreationKey(), "Third");
        assert.equal(third.code, "identity_creation_limited", "the limit of 2 applies to the two kept identities");

        const durable = await backend.durableState();
        assert.equal(Object.keys(durable.players).length, 2);
        assert.equal(Object.keys(backend.store.state.players).length, 2);
        assert.deepEqual(orphanProblems(durable), []);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("another player's successful save resolves the unresolved identity; the key then creates a normal identity", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {
        identityBudget: budget(5),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      try {
        const key = newCreationKey();
        assert.equal((await createFrom(started, "127.0.0.1", key, "First")).code, "identity_creation_pending");
        const unresolvedId = playersWithKey(await backend.durableState(), keyHashOf(key))[0];

        // A different key from another address succeeds. Its save writes the live world, which never held the
        // unresolved identity, so the file no longer holds it.
        const other = await createFrom(started, "127.0.0.2", newCreationKey(), "Other");
        assert.equal(other.type, "identity.created");
        const durable = await backend.durableState();
        assert.equal(durable.players[unresolvedId], undefined, "the unresolved identity is gone from the saved file");
        assert.deepEqual(playersWithKey(durable, keyHashOf(key)), [], "the key is free again");

        const created = await createFrom(started, "127.0.0.1", key, "Retry");
        assert.equal(created.type, "identity.created");
        assert.deepEqual(playersWithKey(await backend.durableState(), keyHashOf(key)), [created.playerId]);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("after a server restart a key-only retry of the saved identity is refused (D-05): the saved identity is kept, with no second identity", async () => {
      const backend = await openBackend(name);
      const key = newCreationKey();
      const first = await startOver(backend, {
        identityBudget: budget(2),
        creationFaultHook: conflictHook(backend, { failCompensation: true }),
      });
      let snapshot;
      let savedId;
      try {
        assert.equal((await createFrom(first, "127.0.0.1", key, "First")).code, "identity_creation_pending");
        snapshot = await backend.durableState();
        savedId = playersWithKey(snapshot, keyHashOf(key))[0];
        assert.ok(savedId, "premise: the saved file holds the unresolved identity");
      } finally {
        // Shutdown writes the live world, which does not hold the identity. Put back the file as it stood at the
        // conflict, which is what a crash at that moment would leave behind.
        await first.stop();
      }
      await backend.restoreDurable(snapshot);
      await backend.reopen();

      const second = await startOver(backend, { identityBudget: budget(2) });
      try {
        // D-05: the key alone does not re-issue the saved identity, so the retry is refused. The saved identity stays,
        // and no second identity is created. The player has no session token for it (documented limitation).
        const retry = await createFrom(second, "127.0.0.1", key, "Retry");
        assert.equal(retry.type, "error");
        assert.equal(retry.code, "identity_recovery_unavailable");
        const durable = await backend.durableState();
        assert.deepEqual(playersWithKey(durable, keyHashOf(key)), [savedId], "the saved identity is kept; no second identity");
        assert.deepEqual(orphanProblems(durable), []);
      } finally {
        await second.stop();
        await backend.cleanup();
      }
    });
  });
}
