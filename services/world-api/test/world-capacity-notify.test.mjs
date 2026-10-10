import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import {
  createMessage,
  newCreationKey,
  startCreationServer,
  tempDirectory,
} from "./support/creation-fixture.mjs";
import { openPeer } from "./support/harness.mjs";

/**
 * Notify-once behaviour for the 16 MiB size limit (file backend).
 *
 * One capacity episode starts at the first refused save and ends at the next successful save.
 * Within an episode: online players get one world_capacity_reached notice, the log gets one line,
 * and later refusals are silent except for the requester's own reply. Nothing is removed.
 * The padding is test-only and lives in memory; data/world-state.json is never touched.
 */

const MiB = 1024 * 1024;
const LIMIT_LOG = "over its size limit";
const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend() {
  const directory = tempDirectory("naija-capacity-notify-");
  directories.push(directory);
  const file = join(directory, "world-state.json");
  return { store: new FaultyStore(new WorldStore(file, Date.now())), file };
}

/**
 * Wait until the file on disk records the player's current lastSeen value, which a session resume
 * sets before it saves. The save is asynchronous, so the bytes are only stable after this.
 */
async function waitForResumeSave(file, playerId, store, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const expected = store.state.players[playerId].lastSeen;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (saved.players[playerId]?.lastSeen === expected) return;
    } catch {
      // The file may be mid-rename; retry.
    }
    if (Date.now() - started > timeoutMs) throw new Error("the resume save did not reach the file");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Capture console.error lines for the duration of fn. */
async function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.filter((line) => line.includes(LIMIT_LOG));
}

test("R5 notify-once: refused creations in one episode notify the online player once, log once, and each requester gets its own refusal", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend);
  const seedPeer = await openPeer(started.websocketUrl);
  const online = await openPeer(started.websocketUrl);
  try {
    seedPeer.send(createMessage(newCreationKey(), "Seed"));
    const seed = await seedPeer.waitFor((message) => message.type === "identity.created", 5000);
    await seedPeer.close();
    online.send({ type: "session.resume", sessionToken: seed.sessionToken });
    await online.waitFor((message) => message.type === "session.ready", 5000);
    await waitForResumeSave(backend.file, seed.playerId, backend.store);

    // Pad the online player's record so every save from now on is over the limit.
    const padding = "x".repeat(17 * MiB);
    backend.store.state.players[seed.playerId].character.test_padding = padding;
    const durableBefore = readFileSync(backend.file);

    const errors = await captureErrors(async () => {
      const requesters = [];
      for (let index = 0; index < 3; index += 1) {
        const requester = await openPeer(started.websocketUrl);
        requesters.push(requester);
        requester.send(createMessage(newCreationKey(), `Over${index}`));
        const reply = await requester.waitFor((message) => message.type === "error", 5000);
        assert.equal(reply.code, "world_capacity_reached", "each requester is told its own creation was refused");
        await requester.close();
      }
      // Give any stray broadcast time to arrive before counting.
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const notices = online.messages.filter((message) => message.type === "error" && message.code === "world_capacity_reached");
    assert.equal(notices.length, 1, "the online player is notified once for the whole episode");
    assert.equal(errors.length, 1, "exactly one log line for the whole episode");
    assert.deepEqual(readFileSync(backend.file), durableBefore, "the previous saved world is unchanged");
    assert.equal(
      backend.store.state.players[seed.playerId].character.test_padding,
      padding,
      "the refused episode removed nothing from the live record",
    );
  } finally {
    // Clear the test padding so the graceful shutdown save can succeed, then stop.
    for (const player of Object.values(backend.store.state.players)) delete player.character.test_padding;
    await online.close();
    await started.stop();
  }
});

test("R5 notify-once: a refused periodic save retries silently until a save succeeds, and a new episode notifies again", async () => {
  const backend = fileBackend();
  // A short tick so the periodic save retries while the limit is exceeded.
  const started = await startCreationServer(backend, { tickIntervalMs: 100 });
  const seedPeer = await openPeer(started.websocketUrl);
  const online = await openPeer(started.websocketUrl);
  try {
    seedPeer.send(createMessage(newCreationKey(), "Seed"));
    const seed = await seedPeer.waitFor((message) => message.type === "identity.created", 5000);
    await seedPeer.close();

    backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(17 * MiB);
    const durableBefore = readFileSync(backend.file);

    const firstErrors = await captureErrors(async () => {
      // Resuming marks the player dirty and flushes; the flush is refused.
      online.send({ type: "session.resume", sessionToken: seed.sessionToken });
      await online.waitFor((message) => message.type === "session.ready", 5000);
      // Let several one-second retries run while the limit is still exceeded.
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    const countNotices = () => online.messages.filter((message) => message.type === "error" && message.code === "world_capacity_reached").length;
    assert.equal(countNotices(), 1, "retries do not repeat the notice");
    assert.equal(firstErrors.length, 1, "retries do not repeat the log line");
    assert.deepEqual(readFileSync(backend.file), durableBefore, "the previous saved world is unchanged");

    // Remove the test padding; the next retry must succeed and close the episode.
    delete backend.store.state.players[seed.playerId].character.test_padding;
    const savedAt = Date.now();
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const size = statSync(backend.file).size;
        if (size !== durableBefore.length || !readFileSync(backend.file).equals(durableBefore)) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - savedAt > 5000) {
          clearInterval(timer);
          reject(new Error("the save did not succeed after the limit was cleared"));
        }
      }, 50);
    });
    const afterRecovery = readFileSync(backend.file);
    assert.ok(afterRecovery.length < 16 * MiB, "the recovered save is under the limit");

    // A new over-limit episode starts after the successful save and notifies once more.
    backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(17 * MiB);
    const secondErrors = await captureErrors(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    assert.equal(countNotices(), 2, "a new episode after a successful save notifies once");
    assert.equal(secondErrors.length, 1, "a new episode logs once");
  } finally {
    // Clear the test padding so the graceful shutdown save can succeed, then stop.
    for (const player of Object.values(backend.store.state.players)) delete player.character.test_padding;
    await online.close();
    await started.stop();
  }
});
