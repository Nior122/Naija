import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { diffState, mergeStateChanges } from "../dist/multiplayer/state-merge.js";
import { orphanProblems, createMessage, newCreationKey, openFileBackend, startCreationServer, keyHashOf } from "./support/creation-fixture.mjs";
import { openPeer } from "./support/harness.mjs";

/**
 * Transactional merge of identity creation (R2).
 *
 * Unit tests cover diffState and mergeStateChanges. Integration tests cover a creation whose
 * candidate save succeeds but whose changes conflict with the live world, and an inventory check
 * that a creation only adds records.
 */

const backends = [];
after(async () => {
  for (const backend of backends) await backend.cleanup();
});

describe("state-merge unit behaviour", () => {
  test("diffState reports added keys as subtrees, changed leaves as set, and removed keys as delete", () => {
    const base = { a: { x: 1, list: [1, 2] }, gone: true };
    const next = { a: { x: 2, list: [1, 2] }, added: { deep: { y: 1 } } };
    const changes = diffState(base, next);
    assert.deepEqual(
      changes.map((change) => [change.kind, change.path.join(".")]).sort(),
      [["add", "added"], ["delete", "gone"], ["set", "a.x"]],
    );
  });

  test("diffState treats arrays as leaves compared by value", () => {
    assert.deepEqual(diffState({ list: [1, 2] }, { list: [1, 2] }), []);
    const changes = diffState({ list: [1, 2] }, { list: [1, 3] });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, "set");
    assert.equal(changes[0].path.join("."), "list");
  });

  test("mergeStateChanges applies every change when the live world still matches the base", () => {
    const base = { players: {}, counter: 1 };
    const draft = structuredClone(base);
    draft.players.p1 = { name: "New" };
    draft.counter = 2;
    const live = structuredClone(base);
    const conflicts = mergeStateChanges(live, diffState(base, draft));
    assert.deepEqual(conflicts, []);
    assert.deepEqual(live, draft);
  });

  test("mergeStateChanges applies nothing when any change conflicts", () => {
    const base = { players: {}, counter: 1 };
    const draft = structuredClone(base);
    draft.players.p1 = { name: "New" };
    draft.counter = 2;
    const live = structuredClone(base);
    live.players.p1 = { name: "Someone else" };
    const before = structuredClone(live);
    const conflicts = mergeStateChanges(live, diffState(base, draft));
    assert.deepEqual(conflicts, ["players.p1"]);
    assert.deepEqual(live, before, "a conflicting merge must leave the live world untouched");
  });

  test("mergeStateChanges refuses a set whose live value has changed since the draft was taken", () => {
    const base = { counter: 1, other: 0 };
    const draft = { counter: 2, other: 0 };
    const live = { counter: 5, other: 0 };
    const conflicts = mergeStateChanges(live, diffState(base, draft));
    assert.deepEqual(conflicts, ["counter"]);
    assert.equal(live.counter, 5);
  });
});

describe("R2 merge conflict during identity creation", () => {
  test("a concurrent live change to a key the creation adds refuses the creation with no partial state", async () => {
    const backend = openFileBackend();
    backends.push(backend);
    let armed = false;
    const started = await startCreationServer(backend, {
      creationFaultHook: (point) => {
        if (!armed || point !== "before-save") return;
        // Another writer adds the same court between the draft and the merge. The creation must not overwrite it.
        backend.store.state.courts["court:magistrate-fct"] = { court_id: "court:magistrate-fct", concurrent: true };
        armed = false;
      },
    });
    const peer = await openPeer(started.websocketUrl);
    const key = newCreationKey();
    try {
      const before = structuredClone(backend.store.state);
      armed = true;
      peer.send(createMessage(key, "Conflicted"));
      const reply = await peer.waitFor((message) => message.type === "error" || message.type === "identity.created", 5000);
      assert.equal(reply.type, "error");
      assert.equal(reply.code, "identity_creation_conflict");
      assert.ok(!JSON.stringify(reply).includes(key), "the error must not echo the creation key");

      // The live world has the concurrent court and no player for the key.
      assert.equal(backend.store.state.courts["court:magistrate-fct"].concurrent, true, "the concurrent record must survive");
      const liveMatches = Object.values(backend.store.state.players).filter((player) => player.creationKeyHash === keyHashOf(key));
      assert.equal(liveMatches.length, 0);
      assert.equal(Object.keys(backend.store.state.players).length, Object.keys(before.players).length);
      assert.deepEqual(orphanProblems(backend.store.state), []);

      // The durable file (written by the compensating save) matches the live world.
      const durable = await backend.durableState();
      assert.deepEqual(durable.players, backend.store.state.players);
      assert.deepEqual(durable.people, backend.store.state.people);
      assert.deepEqual(durable.courts, backend.store.state.courts);
    } finally {
      await peer.close();
      await started.stop();
    }
  });

  test("after a merge conflict, the same key creates an identity normally", async () => {
    const backend = openFileBackend();
    backends.push(backend);
    let armed = false;
    const started = await startCreationServer(backend, {
      creationFaultHook: (point) => {
        if (!armed || point !== "before-save") return;
        backend.store.state.courts["court:magistrate-fct"] = { court_id: "court:magistrate-fct", concurrent: true };
        armed = false;
      },
    });
    const key = newCreationKey();
    const first = await openPeer(started.websocketUrl);
    const retry = await openPeer(started.websocketUrl);
    try {
      armed = true;
      first.send(createMessage(key, "First"));
      const failed = await first.waitFor((message) => message.type === "error" || message.type === "identity.created", 5000);
      assert.equal(failed.code, "identity_creation_conflict");

      retry.send(createMessage(key, "Retry"));
      const created = await retry.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
      assert.equal(created.type, "identity.created");
      const players = Object.values(backend.store.state.players).filter((player) => player.creationKeyHash === keyHashOf(key));
      assert.equal(players.length, 1);
      assert.deepEqual(orphanProblems(backend.store.state), []);
    } finally {
      await first.close();
      await retry.close();
      await started.stop();
    }
  });
});

describe("R2 change inventory: identity creation only adds records", () => {
  test("three sequential creations change no existing value, only add new keys", async () => {
    const backend = openFileBackend();
    backends.push(backend);
    const captured = [];
    const original = backend.store.saveState.bind(backend.store);
    backend.store.saveState = (candidate) => {
      // The live world is unchanged at save time, so the diff is exactly what this creation would add or change.
      captured.push(diffState(backend.store.state, candidate));
      return original(candidate);
    };
    const started = await startCreationServer(backend);
    try {
      for (let index = 0; index < 3; index += 1) {
        const peer = await openPeer(started.websocketUrl);
        try {
          peer.send(createMessage(newCreationKey(), `Inventory${index}`));
          const reply = await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
          assert.equal(reply.type, "identity.created");
        } finally {
          await peer.close();
        }
      }
    } finally {
      await started.stop();
    }
    assert.equal(captured.length, 3, "one candidate save per creation");
    for (const [index, changes] of captured.entries()) {
      const nonAdd = changes.filter((change) => change.kind !== "add");
      assert.deepEqual(
        nonAdd.map((change) => `${change.kind} ${change.path.join(".")}`),
        [],
        `creation ${index}: a creation must not modify or remove existing records`,
      );
      assert.ok(changes.some((change) => change.kind === "add" && change.path[0] === "players"), `creation ${index}: adds a player`);
    }
  });
});
