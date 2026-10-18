// Heartbeat diagnostics (Stage 38, R5). Runs the real heartbeat in app.ts with a short interval (the production interval
// is 15 s and is not changed; the test passes heartbeatIntervalMs). The test proves:
//   - a client that does not answer its ping is terminated on the second tick, not the first (a new connection counts as
//     responsive), and the server records one diagnostic line for that termination;
//   - the diagnostic line holds counts and times only: no address, player ID, session token, or world key;
//   - a client that answers its pings is not terminated across several intervals.
// What it does NOT prove: anything about the 15 s production interval, or about the R5 notice (see
// docs/STAGE_38_AUTHORITY_ENFORCEMENT_AND_MULTIPLAYER_RELIABILITY.md).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import { startCreationServer, tempDirectory } from "./support/creation-fixture.mjs";

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend() {
  const directory = tempDirectory("naija-heartbeat-");
  directories.push(directory);
  const file = join(directory, "world-state.json");
  return { store: new FaultyStore(new WorldStore(file, Date.now())), file };
}

/** Opens a raw client. With autoPong false it never answers a ping, so the server sees no pong. */
function openRaw(url, options) {
  const socket = new WebSocket(url, options);
  const info = { socket, pings: 0, closed: null };
  socket.on("ping", () => {
    info.pings += 1;
  });
  socket.on("close", (code) => {
    info.closed = code;
  });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(info));
    socket.once("error", reject);
  });
}

function captureWarnings(fn) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => {
    lines.push(args.map(String).join(" "));
  };
  return fn().finally(() => {
    console.warn = original;
  }).then(() => lines);
}

async function waitUntil(predicate, timeoutMs, message) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("R5 heartbeat: a client that never answers its ping is terminated on the second tick, with one diagnostic line and no identifiers", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { heartbeatIntervalMs: 50 });
  let silent = null;
  try {
    const lines = await captureWarnings(async () => {
      silent = await openRaw(started.websocketUrl, { autoPong: false });
      await waitUntil(() => silent.closed !== null, 5000, "the silent client was never terminated");
    });
    const heartbeatLines = lines.filter((line) => line.includes("heartbeat terminated"));
    assert.equal(heartbeatLines.length, 1, "exactly one diagnostic line for the termination");
    assert.ok(silent.pings >= 1, "the server pinged the client before it terminated it");
    assert.equal(silent.closed, 1006, "the connection ended without a close frame (the server terminated it)");

    const entry = JSON.parse(heartbeatLines[0].slice(heartbeatLines[0].indexOf("{")));
    assert.equal(typeof entry.queued_bytes, "number");
    assert.equal(typeof entry.ping_wait_ms, "number");
    assert.equal(typeof entry.connection_age_ms, "number");
    assert.ok(entry.connection_age_ms >= entry.ping_wait_ms, "the age covers the wait");
    // Nothing that identifies a client or a world is in the line.
    assert.ok(!heartbeatLines[0].includes("127.0.0.1"), "no address");
    assert.ok(!/player-|character-|session|token|world-state|naija-heartbeat/i.test(heartbeatLines[0]), "no identifier, token, or path");
  } finally {
    if (silent && silent.socket.readyState !== WebSocket.CLOSED) silent.socket.terminate();
    await started.stop();
  }
});

test("R5 heartbeat: a client that answers its pings is not terminated across several intervals", async () => {
  const backend = fileBackend();
  const started = await startCreationServer(backend, { heartbeatIntervalMs: 50 });
  let responsive = null;
  try {
    const lines = await captureWarnings(async () => {
      responsive = await openRaw(started.websocketUrl, {});
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    assert.ok(responsive.pings >= 3, `the client was pinged on several ticks (saw ${responsive.pings})`);
    assert.equal(responsive.closed, null, "the answering client was not closed");
    assert.equal(responsive.socket.readyState, WebSocket.OPEN);
    assert.equal(lines.filter((line) => line.includes("heartbeat terminated")).length, 0, "no termination was recorded");
  } finally {
    if (responsive && responsive.socket.readyState !== WebSocket.CLOSED) responsive.socket.close();
    await started.stop();
  }
});
