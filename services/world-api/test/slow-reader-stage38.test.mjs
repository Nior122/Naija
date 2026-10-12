// Slow reader (Stage 38, R5). The world sends each online character a snapshot at every game minute. Before this stage
// that send ignored the socket's backlog, so a reader that stopped reading accumulated one full snapshot per game minute.
// The heartbeat then terminated the connection, because its ping waited behind the backlog (observed: about 678 MB queued
// to one socket, ping wait 16.9 s).
//
// These tests use the real tick loop with a short game minute, and a padded character record (test-only, in memory) so
// each snapshot is large. They prove:
//   - a paused reader is not sent one snapshot per game minute: after it resumes, it receives a bounded number, and the
//     last one it receives is newer than the first (the latest state is delivered);
//   - a reader that keeps reading still receives one snapshot per game minute (the cadence is unchanged).
// What they do NOT prove: anything about the production game-minute length, or the heartbeat's own timing (see
// heartbeat-stage38.test.mjs), or about a real network. The padding is a test device, not a model of real records.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import { createMessage, newCreationKey, startCreationServer, tempDirectory } from "./support/creation-fixture.mjs";
import { openPeer } from "./support/harness.mjs";
import WebSocket from "ws";

/** Must equal SNAPSHOT_BACKLOG_LIMIT_BYTES in src/multiplayer/world-engine.ts. */
const LIMIT = 1024 * 1024;

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend() {
  const directory = tempDirectory("naija-slow-reader-");
  directories.push(directory);
  const file = join(directory, "world-state.json");
  return { store: new FaultyStore(new WorldStore(file, Date.now())), file };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts a server with real ticks and a 10 ms game minute, and one seeded, resumed character. */
async function session(padding) {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { tickIntervalMs: 10, gameMinuteMs: 10 });
  const seedPeer = await openPeer(started.websocketUrl);
  seedPeer.send(createMessage(newCreationKey(), "Slow"));
  const seed = await seedPeer.waitFor((message) => message.type === "identity.created", 20000);
  await seedPeer.close();
  const reader = await openPeer(started.websocketUrl);
  reader.send({ type: "session.resume", sessionToken: seed.sessionToken });
  await reader.waitFor((message) => message.type === "session.ready", 20000);
  if (padding > 0) backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(padding);
  return { backend, started, reader, playerId: seed.playerId };
}

function snapshots(peer) {
  return peer.messages.filter((message) => message.type === "character.snapshot");
}

test("R5 slow reader: while a reader is paused, no snapshot is queued past the backlog limit, and far fewer than one per game minute are sent; the latest state arrives after resume", async () => {
  // Half a megabyte per snapshot: large enough to exceed the one-megabyte limit within the pause, small enough to keep
  // the test's memory bounded (the test client keeps every message it receives).
  const { backend, started, reader, playerId } = await session(512 * 1024);
  let sendsWhilePaused = 0;
  let sentOverLimit = 0;
  let pausedFor = 0;
  const originalSend = WebSocket.prototype.send;
  // Counts the character snapshots the server sends, and the backlog on the server's socket at each send. The test client
  // never sends this frame text, and only this one server socket is open here, so every match is a server send to the
  // paused reader.
  WebSocket.prototype.send = function patchedSend(data, ...rest) {
    if (typeof data === "string" && data.startsWith('{"type":"character.snapshot"')) {
      sendsWhilePaused += 1;
      if (this.bufferedAmount > LIMIT) sentOverLimit += 1;
    }
    return originalSend.call(this, data, ...rest);
  };
  try {
    reader.socket.pause();
    const pauseStarted = Date.now();
    await sleep(1500); // about 150 game minutes at 10 ms each
    pausedFor = Date.now() - pauseStarted;
    const latestBeforeResume = backend.store.state.worldClock.updated_at;
    reader.socket.resume();
    // With a 10 ms game minute the stream does not go quiet, so wait for the first snapshot that is as new as the world
    // was when the reader resumed. It must arrive; a backlog that never drains would fail here.
    const newer = await reader.waitFor(
      (message) => message.type === "character.snapshot" && message.character.updated_at >= latestBeforeResume,
      10000,
    );
    const minutesWhilePaused = Math.floor(pausedFor / 10);
    assert.equal(sentOverLimit, 0, "no snapshot was sent to the paused socket while its backlog was over the limit");
    assert.ok(sendsWhilePaused < minutesWhilePaused / 4,
      `far fewer than one snapshot per game minute were sent while paused (sent ${sendsWhilePaused} over about ${minutesWhilePaused} game minutes)`);
    assert.ok(newer.character.updated_at >= latestBeforeResume, "the latest state arrives after the reader resumes");
  } finally {
    WebSocket.prototype.send = originalSend;
    reader.socket.terminate();
    await started.stop();
  }
});

test("R5 slow reader: a reader that keeps reading still gets one snapshot per game minute", async () => {
  const { started, reader } = await session(0);
  try {
    const before = snapshots(reader).length;
    await sleep(1500); // about 150 game minutes at 10 ms each
    const received = snapshots(reader).length - before;
    assert.ok(received >= 50, `an active reader was sent about one snapshot per game minute (received ${received})`);
  } finally {
    reader.socket.terminate();
    await started.stop();
  }
});
