import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { keyHashOf, newCreationKey, orphanProblems, createMessage } from "./support/creation-fixture.mjs";
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
import WebSocket from "ws";
import { waitUntil } from "./support/faulty-store.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";

/**
 * Identity creation safety around the same creation key (Stage 28). Each test states its contract and asserts the saved
 * file and the live world directly: player counts, the key's identities, tokens, sessions, and budget behaviour.
 * File backend always; PostgreSQL when a disposable database is configured. No real world file is used.
 */

const HOUR_MS = 60 * 60_000;
const COURT = "court:magistrate-fct";

before(connectBackends);
after(disconnectBackends);

const budget = (perIpLimit) => ({ perIpLimit, globalLimit: 1000, windowMs: HOUR_MS });

/** Resumes a session on a new socket. Returns "session.ready", or the error code the server sent. */
async function resumes(url, token, address = "127.0.0.1") {
  const socket = await openPeerFrom(url, address);
  try {
    socket.send({ type: "session.resume", sessionToken: token });
    const reply = await socket.waitFor((message) => message.type === "session.ready" || message.type === "error", 5000);
    return reply.type === "session.ready" ? "session.ready" : reply.code;
  } finally {
    await socket.close();
  }
}

for (const name of backendNames) {
  describe(`identity creation safety (${name} backend)`, () => {
    test("two simultaneous requests with one key, on separate sockets, create exactly one identity", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, { identityBudget: budget(5) });
      const key = newCreationKey();
      const first = await openPeerFrom(started.websocketUrl, "127.0.0.1");
      const second = await openPeerFrom(started.websocketUrl, "127.0.0.2");
      try {
        // Hold the first request's save so the second request arrives while the first is still in flight.
        const release = backend.store.holdNextWrite();
        first.send(createMessage(key, "First"));
        await waitUntil(() => backend.store.heldCount === 1);
        second.send(createMessage(key, "Second"));
        const secondReply = await second.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
        assert.equal(secondReply.type, "error");
        assert.equal(secondReply.code, "identity_creation_in_progress", "the second request is refused while the first is in flight");

        release();
        const firstReply = await first.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
        assert.equal(firstReply.type, "identity.created");

        const durable = await backend.durableState();
        assert.deepEqual(playersWithKey(durable, keyHashOf(key)), [firstReply.playerId], "one identity in the saved file");
        assert.deepEqual(playersWithKey(backend.store.state, keyHashOf(key)), [firstReply.playerId], "one identity live");
        assert.equal(Object.keys(durable.players).length, Object.keys(backend.store.state.players).length);
        assert.deepEqual(orphanProblems(durable), []);
        assert.equal(await resumes(started.websocketUrl, firstReply.sessionToken), "session.ready", "the created session works");
      } finally {
        await first.close();
        await second.close();
        await started.stop();
        await backend.cleanup();
      }
    });

    test("failed persistence during creation: no record remains, the retry is refused while saving fails, then creates one identity", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, { identityBudget: budget(1) });
      try {
        const before = structuredClone(backend.store.state);
        const key = newCreationKey();

        backend.store.failNextWrite();
        const failed = await createFrom(started, "127.0.0.1", key, "Failed");
        assert.equal(failed.code, "persistence_failed");
        assert.deepEqual(backend.store.state, before, "the failed attempt leaves the live world unchanged");

        // Saving still fails when the retry arrives: the outcome of the earlier save cannot be confirmed, so it is refused.
        backend.store.failNextWrite();
        const refused = await createFrom(started, "127.0.0.1", key, "Retry");
        assert.equal(refused.code, "identity_creation_pending");
        assert.deepEqual(backend.store.state, before, "the refused retry changes nothing");

        // Saving works again. The retry resolves and creates one identity. Budget: with a limit of 1, the creation is
        // allowed only because the failed saves consumed no budget.
        const created = await createFrom(started, "127.0.0.1", key, "Retry");
        assert.equal(created.type, "identity.created");
        const durable = await backend.durableState();
        assert.deepEqual(playersWithKey(durable, keyHashOf(key)), [created.playerId]);
        assert.deepEqual(orphanProblems(durable), []);
        assert.equal(await resumes(started.websocketUrl, created.sessionToken), "session.ready");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("ambiguous save (committed, response lost): the reply says failed; the retry resolves the file and creates one new identity", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, { identityBudget: budget(1) });
      try {
        const key = newCreationKey();
        backend.store.failNextWriteAfterCommit();
        const failed = await createFrom(started, "127.0.0.1", key, "Ambiguous");
        assert.equal(failed.code, "persistence_failed");

        // The save committed before the failure was reported, so the file holds the identity; the live world does not.
        const committed = await backend.durableState();
        const committedIds = playersWithKey(committed, keyHashOf(key));
        assert.equal(committedIds.length, 1, "premise: the saved file holds the committed identity");
        assert.equal(playersWithKey(backend.store.state, keyHashOf(key)).length, 0, "the live world does not");

        const created = await createFrom(started, "127.0.0.1", key, "Retry");
        assert.equal(created.type, "identity.created");
        assert.notEqual(created.playerId, committedIds[0], "the committed identity is not returned as a new one");
        const durable = await backend.durableState();
        assert.deepEqual(playersWithKey(durable, keyHashOf(key)), [created.playerId], "the committed identity was removed");
        assert.deepEqual(orphanProblems(durable), []);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("existing-key recovery is unchanged: the same key returns the same identity with a new token, and the old token stops working", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, { identityBudget: budget(5) });
      try {
        const key = newCreationKey();
        const created = await createFrom(started, "127.0.0.1", key, "Owner");
        assert.equal(created.type, "identity.created");
        const recovered = await createFrom(started, "127.0.0.1", key, "Owner");
        assert.equal(recovered.type, "identity.created");
        assert.equal(recovered.playerId, created.playerId, "the same identity");
        assert.notEqual(recovered.sessionToken, created.sessionToken, "recovery issues a new token");

        assert.equal(await resumes(started.websocketUrl, created.sessionToken), "session_invalid", "the old token no longer resumes");
        assert.equal(await resumes(started.websocketUrl, recovered.sessionToken), "session.ready", "the new token resumes");

        const durable = await backend.durableState();
        assert.deepEqual(playersWithKey(durable, keyHashOf(key)), [created.playerId]);
        assert.equal(Object.keys(durable.players).length, 1, "recovery creates no identity");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("session ownership: an unresolved conflict for one key does not disconnect, rotate, or take over another player's session", async () => {
      const backend = await openBackend(name);
      let armed = false;
      const started = await startOver(backend, {
        identityBudget: budget(5),
        creationFaultHook: (point) => {
          if (!armed || point !== "after-save") return;
          armed = false;
          backend.store.state.courts[COURT] = { court_id: COURT, concurrent: true };
          backend.store.failNextWrite();
        },
      });
      const owner = await openPeerFrom(started.websocketUrl, "127.0.0.1");
      const intruder = await openPeerFrom(started.websocketUrl, "127.0.0.3");
      try {
        const session = await createIdentity(owner, "Owner");
        // Creation does not bind the socket to the player; the client resumes the session. The owner must be online
        // for the takeover check below to mean anything.
        assert.equal((await resumeSession(owner, session.sessionToken)).type, "session.ready");
        const ownerHashBefore = (await backend.durableState()).players[session.playerId].tokenHash;
        // The owner's creation seeded the court, so the conflicting creation would not add it and nothing would conflict.
        // Remove it from the live world first, so the conflicting creation adds it, as the other conflict tests do.
        delete backend.store.state.courts[COURT];

        armed = true;
        const key = newCreationKey();
        const reply = await createFrom(started, "127.0.0.2", key, "Conflicted");
        assert.equal(reply.code, "identity_creation_pending");

        assert.equal(owner.socket.readyState, WebSocket.OPEN, "the owner's socket stays open");
        const durable = await backend.durableState();
        assert.equal(durable.players[session.playerId].tokenHash, ownerHashBefore, "the owner's token is not rotated");
        assert.equal(backend.store.state.players[session.playerId].tokenHash, ownerHashBefore, "live agrees");

        // Another socket cannot take the owner's session over: it is refused as already connected.
        intruder.send({ type: "session.resume", sessionToken: session.sessionToken });
        const refused = await intruder.waitFor((message) => message.type === "error" || message.type === "session.ready", 5000);
        assert.equal(refused.code, "player_already_connected");
        assert.equal(owner.socket.readyState, WebSocket.OPEN, "the owner is still connected after the attempt");
      } finally {
        await owner.close();
        await intruder.close();
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
