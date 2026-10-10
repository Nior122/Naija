import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import {
  createMessage,
  newCreationKey,
  orphanProblems,
  recordCounts,
  startCreationServer,
  tempDirectory,
} from "./support/creation-fixture.mjs";
import { openPeer, stopApi } from "./support/harness.mjs";

/**
 * Capacity behaviour around the 16 MiB state limit (file backend).
 *
 * The limit is a fixed constant. These tests reach it by padding one test-only record in the
 * in-memory world; they never touch data/world-state.json.
 */

const MiB = 1024 * 1024;
const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend() {
  const directory = tempDirectory("naija-capacity-");
  directories.push(directory);
  const file = join(directory, "world-state.json");
  return { store: new FaultyStore(new WorldStore(file, Date.now())), file };
}

test("R5 capacity: a save over the size limit is refused, the saved file is unchanged, and the live world is unchanged", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend);
  const peer = await openPeer(started.websocketUrl);
  try {
    const seed = await (async () => {
      peer.send(createMessage(newCreationKey(), "Seed"));
      return peer.waitFor((message) => message.type === "identity.created", 5000);
    })();
    assert.ok(seed.playerId);
    const durableBefore = readFileSync(backend.file);
    const liveBefore = structuredClone(backend.store.state);
    const countsBefore = recordCounts(liveBefore);

    // Pad one existing record so the next save exceeds the 16 MiB limit.
    const pad = "x".repeat(17 * MiB);
    backend.store.state.players[seed.playerId].character.test_padding = pad;
    const withPad = structuredClone(backend.store.state);

    const second = await openPeer(started.websocketUrl);
    second.send(createMessage(newCreationKey(), "Over"));
    const reply = await second.waitFor((message) => message.type === "error", 5000);
    await second.close();
    assert.equal(reply.code, "world_capacity_reached", "a clear capacity error, not a generic failure");

    assert.deepEqual(readFileSync(backend.file), durableBefore, "the previous saved world is preserved byte for byte");
    delete backend.store.state.players[seed.playerId].character.test_padding;
    assert.deepEqual(backend.store.state, liveBefore, "no record from the refused creation remains in memory");
    assert.deepEqual(recordCounts(backend.store.state), countsBefore);
    assert.notDeepEqual(withPad, liveBefore);
    assert.deepEqual(orphanProblems(backend.store.state), []);
  } finally {
    await peer.close();
    const padded = backend.store.state.players[peerSeedId(backend)];
    if (padded) delete padded.character.test_padding;
    await started.stop();
  }
});

function peerSeedId(backend) {
  return Object.keys(backend.store.state.players)[0];
}

test("R5 capacity: a shutdown whose final save exceeds the limit reports the failure and keeps the previous file", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend);
  const peer = await openPeer(started.websocketUrl);
  peer.send(createMessage(newCreationKey(), "Seed"));
  await peer.waitFor((message) => message.type === "identity.created", 5000);
  await peer.close();
  const durableAfterSeed = readFileSync(backend.file);
  backend.store.state.players[peerSeedId(backend)].character.test_padding = "x".repeat(17 * MiB);
  await assert.rejects(stopApi(started.server), /world_capacity_reached/);
  assert.deepEqual(readFileSync(backend.file), durableAfterSeed, "the previous saved file is untouched");
});
