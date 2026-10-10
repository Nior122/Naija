import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore, waitUntil } from "./support/faulty-store.mjs";
import { createMessage, keyHashOf, newCreationKey, startCreationServer, tempDirectory } from "./support/creation-fixture.mjs";
import { openPeer } from "./support/harness.mjs";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * R1: concurrent identity creation with the same creation key.
 *
 * Each test uses its own temporary state file. Requests go over separate WebSocket connections.
 */

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend() {
  const directory = tempDirectory("naija-r1-");
  directories.push(directory);
  const file = join(directory, "world-state.json");
  return { store: new FaultyStore(new WorldStore(file, Date.now())), file };
}

function durable(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Resolve with the first identity-related reply on the peer (created or error), or null after a timeout. */
function firstOutcome(peer, timeoutMs = 1500) {
  return Promise.race([
    peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 10_000),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

describe("R1 concurrent identity creation", () => {
  test("R1 reproduction: a second socket with the same new key during the first save is refused", async () => {
    const backend = fileBackend();
    const started = await startCreationServer(backend);
    const key = newCreationKey();
    const first = await openPeer(started.websocketUrl);
    const second = await openPeer(started.websocketUrl);
    try {
      const release = backend.store.holdNextWrite();
      first.send(createMessage(key, "First"));
      await waitUntil(() => backend.store.heldCount === 1);

      second.send(createMessage(key, "Second"));
      const secondReply = await firstOutcome(second);
      release();
      const firstReply = await firstOutcome(first, 5000);

      assert.equal(firstReply?.type, "identity.created", "the first request must create the identity");
      assert.equal(secondReply?.type, "error", "the concurrent request must receive an error, not a second identity");
      assert.equal(secondReply.code, "identity_creation_in_progress");
      assert.ok(!JSON.stringify(secondReply).includes(key), "the error must not echo the creation key");

      const state = durable(backend.file);
      const matches = Object.values(state.players).filter((player) => player.creationKeyHash === keyHashOf(key));
      assert.equal(matches.length, 1, "exactly one authoritative identity for the key");
      assert.equal(Object.keys(state.players).length, 1);
      assert.equal(backend.store.state.players[matches[0].playerId]?.tokenHash, matches[0].tokenHash);

      // The first request's token must still be the working token.
      first.send({ type: "session.resume", sessionToken: firstReply.sessionToken });
      const ready = await first.waitFor((message) => message.type === "session.ready" || message.type === "error", 5000);
      assert.equal(ready.type, "session.ready", "the winning token must still resume");
    } finally {
      await first.close();
      await second.close();
      await started.stop();
    }
  });

  test("R1 timing: 15 simultaneous same-key pairs over separate sockets never yield two identities", async () => {
    const backend = fileBackend();
    const started = await startCreationServer(backend);
    const summary = { trials: 0, twoCreated: 0, oneCreatedOneError: 0, otherOutcomes: [] };
    try {
      for (let trial = 0; trial < 15; trial += 1) {
        const key = newCreationKey();
        const [a, b] = await Promise.all([openPeer(started.websocketUrl), openPeer(started.websocketUrl)]);
        try {
          a.send(createMessage(key, `A${trial}`));
          b.send(createMessage(key, `B${trial}`));
          const [replyA, replyB] = await Promise.all([firstOutcome(a, 5000), firstOutcome(b, 5000)]);
          summary.trials += 1;
          const types = [replyA?.type, replyB?.type].sort().join("+");
          if (types === "error+identity.created") summary.oneCreatedOneError += 1;
          else if (types === "identity.created+identity.created") summary.twoCreated += 1;
          else summary.otherOutcomes.push(types);
        } finally {
          await a.close();
          await b.close();
        }
        const state = durable(backend.file);
        const count = Object.values(state.players).filter((player) => player.creationKeyHash === keyHashOf(key)).length;
        assert.equal(count, 1, `trial ${trial}: exactly one identity for the key in durable state`);
      }
    } finally {
      await started.stop();
    }
    assert.equal(summary.twoCreated, 0, `pairs that both received identity.created: ${JSON.stringify(summary)}`);
    assert.deepEqual(summary.otherOutcomes, [], "unexpected outcomes");
    assert.equal(summary.oneCreatedOneError, 15);
  });

  test("R1: a failed save releases the reservation, so the same key succeeds on retry", async () => {
    const backend = fileBackend();
    const started = await startCreationServer(backend);
    const key = newCreationKey();
    const first = await openPeer(started.websocketUrl);
    const retry = await openPeer(started.websocketUrl);
    try {
      backend.store.failNextWrite();
      first.send(createMessage(key, "Failed"));
      const failed = await first.waitFor((message) => message.type === "error", 5000);
      assert.equal(failed.code, "persistence_failed");

      retry.send(createMessage(key, "Retry"));
      const created = await retry.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
      assert.equal(created.type, "identity.created");
      const state = durable(backend.file);
      assert.equal(Object.values(state.players).filter((player) => player.creationKeyHash === keyHashOf(key)).length, 1);
    } finally {
      await first.close();
      await retry.close();
      await started.stop();
    }
  });

  test("R1: after success, a later request with the key recovers the same identity (existing behaviour)", async () => {
    const backend = fileBackend();
    const started = await startCreationServer(backend);
    const key = newCreationKey();
    const first = await openPeer(started.websocketUrl);
    const later = await openPeer(started.websocketUrl);
    try {
      first.send(createMessage(key, "Original"));
      const created = await first.waitFor((message) => message.type === "identity.created", 5000);
      await first.close();

      later.send(createMessage(key, "Original"));
      const recovered = await later.waitFor((message) => message.type === "identity.created", 5000);
      assert.equal(recovered.playerId, created.playerId);
      const state = durable(backend.file);
      assert.equal(Object.keys(state.players).length, 1);
    } finally {
      await first.close();
      await later.close();
      await started.stop();
    }
  });

  test("R1: the first socket closing mid-save does not leave a reservation; the committed identity is recovered once", async () => {
    const backend = fileBackend();
    const started = await startCreationServer(backend);
    const key = newCreationKey();
    const first = await openPeer(started.websocketUrl);
    const other = await openPeer(started.websocketUrl);
    try {
      const release = backend.store.holdNextWrite();
      first.send(createMessage(key, "Dropped"));
      await waitUntil(() => backend.store.heldCount === 1);
      await first.close();
      release();
      await waitUntil(() => Object.keys(backend.store.state.players).length === 1);

      other.send(createMessage(key, "Dropped"));
      const recovered = await other.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
      assert.equal(recovered.type, "identity.created", "the committed identity must be recoverable by key");
      const state = durable(backend.file);
      assert.equal(Object.keys(state.players).length, 1, "no second identity");
    } finally {
      await first.close();
      await other.close();
      await started.stop();
    }
  });
});

describe("R1 concurrent recovery of an existing identity", () => {
  test("two sockets recovering the same key at once: one session is issued, the other is refused, the winner's token works", async () => {
    const backend = fileBackend();
    const started = await startCreationServer(backend);
    const key = newCreationKey();
    const creator = await openPeer(started.websocketUrl);
    let original;
    try {
      creator.send(createMessage(key, "Recovered"));
      original = await creator.waitFor((message) => message.type === "identity.created", 5000);
    } finally {
      await creator.close();
    }

    const first = await openPeer(started.websocketUrl);
    const second = await openPeer(started.websocketUrl);
    try {
      const release = backend.store.holdNextWrite();
      first.send(createMessage(key, "Recovered"));
      await waitUntil(() => backend.store.heldCount === 1);

      second.send(createMessage(key, "Recovered"));
      const secondReply = await firstOutcome(second);
      release();
      const firstReply = await firstOutcome(first, 5000);

      assert.equal(firstReply?.type, "identity.created", "the first recovery must succeed");
      assert.equal(secondReply?.type, "error", "the concurrent recovery must not issue a second session");
      assert.equal(secondReply.code, "identity_creation_in_progress");
      assert.equal(firstReply.playerId, original.playerId, "recovery returns the same identity");

      // The first recovery's token is the working token; the original token was rotated away by the recovery.
      first.send({ type: "session.resume", sessionToken: firstReply.sessionToken });
      const ready = await first.waitFor((message) => message.type === "session.ready" || message.type === "error", 5000);
      assert.equal(ready.type, "session.ready");
      const state = durable(backend.file);
      assert.equal(Object.values(state.players).filter((player) => player.creationKeyHash === keyHashOf(key)).length, 1);
    } finally {
      await first.close();
      await second.close();
      await started.stop();
    }
  });
});
