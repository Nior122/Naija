import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { newCreationKey, orphanProblems, startCreationServer, tempDirectory } from "./support/creation-fixture.mjs";
import { createFrom, openPeerFrom } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";
import { FaultyStore, waitUntil } from "./support/faulty-store.mjs";

/**
 * Stage 28, item 4: save failure states in the file store, observed through the engine (file backend only).
 *
 * A file save runs in this order: write and fsync a temporary file (before-temp, after-temp-sync), rename it over the
 * saved file (after-rename), then fsync the directory. The save is reported as successful only after the directory sync.
 * A failure at any point is reported as persistence_failed to the online players. The live world is never rolled back.
 *
 * Per state, these tests check the failure report, the live world, the saved file, a later successful save, and the
 * world loaded after a restart:
 *   - before-temp, after-temp-sync: the saved file is the previous world. Changes made since then are not in the file.
 *   - after-rename: the saved file is the NEW world, although the save was reported as failed. A failure report does not
 *     prove that the previous world is authoritative.
 *
 * Not tested: power loss. These are in-process faults, so the operating system's page cache is intact. A power cut
 * between the rename and the directory sync can undo the rename. That case is analysed in docs/STAGE_28_DIRECTORY_SYNC.md
 * and is NOT verified here. The replacement-failure state (a rename that fails) is not injected: rename is atomic, so a
 * failed rename leaves the saved file unchanged, the same as the after-temp-sync state.
 *
 * Each test uses its own temporary directory. No test reads or writes services/world-api/data.
 */

const HOUR_MS = 60 * 60_000;
const MARKER_CHANGE = 111;
const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

const budget = { perIpLimit: 100, globalLimit: 1000, windowMs: HOUR_MS };

/** A file store whose next save fails at the armed phase. */
function fileWorld() {
  const directory = tempDirectory("naija-dirsync-");
  directories.push(directory);
  const file = join(directory, "world-state.json");
  const armed = { phase: null };
  const store = new FaultyStore(
    new WorldStore(file, Date.now(), {
      fileWriteFaultHook: (phase) => {
        if (armed.phase !== phase) return;
        armed.phase = null;
        throw new Error(`injected save failure at ${phase}`);
      },
    }),
  );
  return { directory, file, store, armed };
}

const temporaryFiles = (directory) => readdirSync(directory).filter((name) => name.endsWith(".tmp"));
const moneyIn = (state, playerId) => state.players[playerId].character.money;
const savedState = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Waits for the first message on a peer that matches `predicate`, using the peer's buffered messages. */
function nextMatching(peer, predicate, timeoutMs = 5000) {
  return peer.waitFor(predicate, timeoutMs);
}

/**
 * session.resume replies before its background save commits, so a save can still be in flight afterwards. Waiting for
 * every started write to commit makes the next write the one this test controls.
 */
const quiet = (store) => waitUntil(() => store.committedCount === store.writeCount);

const SCENARIOS = [
  { phase: "before-temp", savedIsPrevious: true, label: "before the temporary file is written" },
  { phase: "after-temp-sync", savedIsPrevious: true, label: "after the temporary file is synced, before the rename" },
  { phase: "after-rename", savedIsPrevious: false, label: "after the rename, before the directory sync" },
];

for (const scenario of SCENARIOS) {
  test(`save failure ${scenario.label}: reported as failed; the live world is not rolled back; the saved file and the loaded world after a restart match the state`, async () => {
    const world = fileWorld();
    const started = await startCreationServer({ store: world.store }, { identityBudget: budget });
    let owner;
    let other;
    let restarted;
    let startedStopped = false;
    try {
      // The owner stays online, so it receives the failure report and the restored signal.
      owner = await openPeerFrom(started.websocketUrl, "127.0.0.1");
      const ownerIdentity = await createIdentity(owner, "Owner");
      const ownerId = ownerIdentity.playerId;
      assert.equal((await resumeSession(owner, ownerIdentity.sessionToken)).type, "session.ready");
      await quiet(world.store);
      const baseline = moneyIn(world.store.state, ownerId);
      assert.equal(moneyIn(savedState(world.file), ownerId), baseline, "premise: the baseline is saved");

      // A second player goes online. Its disconnect is the save that will fail (disconnect saves through the queue).
      other = await openPeerFrom(started.websocketUrl, "127.0.0.2");
      const otherIdentity = await createIdentity(other, "Other");
      assert.equal((await resumeSession(other, otherIdentity.sessionToken)).type, "session.ready");
      await quiet(world.store);

      // A change that is in memory and not yet saved (the live world is the engine's store.state).
      world.store.state.players[ownerId].character.money = baseline + MARKER_CHANGE;
      world.armed.phase = scenario.phase;
      await other.close();
      other = undefined;

      const failure = await nextMatching(owner, (message) => message.type === "error" && message.code === "persistence_failed");
      assert.equal(failure.code, "persistence_failed");
      assert.equal(world.armed.phase, null, "the armed fault was used by the failing save");

      // The live world keeps the change. No state rolls back.
      assert.equal(moneyIn(world.store.state, ownerId), baseline + MARKER_CHANGE, "the live world is not rolled back");
      assert.deepEqual(temporaryFiles(world.directory), [], "no temporary file is left behind");

      // The saved file as the failed save left it.
      const expectedAfterFailure = scenario.savedIsPrevious ? baseline : baseline + MARKER_CHANGE;
      assert.equal(moneyIn(savedState(world.file), ownerId), expectedAfterFailure, `after ${scenario.phase}, the saved file is ${scenario.savedIsPrevious ? "the previous" : "the new"} world`);
      const failedFile = readFileSync(world.file);

      // A later successful save: the owner receives one persistence.restored, and the file matches the live world.
      const created = await createFrom(started, "127.0.0.3", newCreationKey(), "Later");
      assert.equal(created.type, "identity.created");
      const restored = await nextMatching(owner, (message) => message.type === "persistence.restored");
      assert.equal(restored.type, "persistence.restored");
      assert.equal(owner.messages.filter((message) => message.type === "persistence.restored").length, 0, "one restored signal for the episode");
      const afterSuccess = savedState(world.file);
      assert.equal(moneyIn(afterSuccess, ownerId), baseline + MARKER_CHANGE, "the next successful save writes the live world");
      assert.deepEqual(orphanProblems(afterSuccess), []);

      // Restart from the file as the failed save left it. Stop the server first: its shutdown flush would overwrite it.
      await owner.close();
      owner = undefined;
      await started.stop();
      startedStopped = true;
      writeFileSync(world.file, failedFile);
      const restartedStore = new WorldStore(world.file, Date.now());
      restarted = await startCreationServer({ store: restartedStore }, { identityBudget: budget });
      assert.equal(
        moneyIn(restartedStore.state, ownerId),
        expectedAfterFailure,
        `after a restart from the ${scenario.phase} state, the loaded world is ${scenario.savedIsPrevious ? "the previous" : "the new"} one`,
      );
      // The owner's session was saved with the creation, before the failure, so it still resumes after the restart.
      const resumed = await openPeerFrom(restarted.websocketUrl, "127.0.0.1");
      try {
        resumed.send({ type: "session.resume", sessionToken: ownerIdentity.sessionToken });
        const reply = await resumed.waitFor((message) => message.type === "session.ready" || message.type === "error", 5000);
        assert.equal(reply.type, "session.ready", "the owner's token resumes after the restart");
      } finally {
        await resumed.close();
      }
    } finally {
      if (other) await other.close();
      if (owner) await owner.close();
      if (restarted) await restarted.stop();
      if (!startedStopped) await started.stop().catch(() => {});
    }
  });
}
