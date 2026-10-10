import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import { startCreationServer } from "./support/creation-fixture.mjs";
import { createIdentity, openPeer, resumeSession, stopApi } from "./support/harness.mjs";

/**
 * Stage 28, G1 and G3. Save-outcome health and the recovery signal, against a real WebSocket server and a real file
 * store in a temporary directory. None of these tests touches services/world-api/data/world-state.json.
 *
 * Failures are injected with FaultyStore. Each queued failure is consumed by one save attempt. Retries run from the
 * tick, so N queued failures give N failed attempts and then a successful save.
 */

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileBackend() {
  const directory = mkdtempSync(join(tmpdir(), "naija-recovery-"));
  directories.push(directory);
  const file = join(directory, "world-state.json");
  const store = new FaultyStore(new WorldStore(file, Date.now()));
  return { store, file };
}

const TICK = { tickIntervalMs: 50, connectionAttemptsPerMinute: 1_000_000_000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Compare file contents by digest: a failing Buffer deepEqual builds a very large diff and can exhaust memory. */
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * Polls the messages the peer has already stored. The harness waitFor() removes the matched message from
 * peer.messages, which would make the counts below wrong, so these tests do not use it.
 */
async function until(predicate, timeoutMs = 20_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for a server message");
    await sleep(25);
  }
}
const notices = (peer) => count(peer, "error", "persistence_failed");
const restores = (peer) => count(peer, "persistence.restored");

async function startWithPeer(backend, name, { periodicSaves = true } = {}) {
  const started = await startCreationServer(
    { store: backend.store },
    { ...(periodicSaves ? TICK : {}), persistenceHealth: () => backend.store.health() },
  );
  const peer = await openPeer(started.websocketUrl);
  const { sessionToken } = await createIdentity(peer, name);
  await resumeSession(peer, sessionToken);
  return { started, peer };
}

const count = (peer, type, code) =>
  peer.messages.filter((message) => message.type === type && (code === undefined || message.code === code)).length;

test("G1: a failing save fails /health, /live stays up, and the next successful save restores /health", async () => {
  const backend = fileBackend();
  const { started, peer } = await startWithPeer(backend, "Health");
  try {
    const healthy = await fetch(`${started.baseUrl}/health`);
    assert.equal((await healthy.json()).checks.persistence.status, "pass");

    for (let index = 0; index < 1000; index += 1) backend.store.failNextWrite(`injected ${index}`);
    await until(() => notices(peer) === 1);

    const failing = await fetch(`${started.baseUrl}/health`);
    const failingBody = await failing.json();
    assert.equal(failing.status, 503, "readiness fails while saves fail");
    assert.equal(failingBody.checks.persistence.status, "fail");
    assert.match(failingBody.checks.persistence.message, /storage write failed/);
    assert.equal((await fetch(`${started.baseUrl}/live`)).status, 200, "liveness stays up");

    backend.store.failures.length = 0;
    await until(() => restores(peer) === 1, 15_000);
    const restored = await (await fetch(`${started.baseUrl}/health`)).json();
    assert.equal(restored.checks.persistence.status, "pass", "a successful save restores persistence health");
  } finally {
    backend.store.failures.length = 0;
    await peer.close();
    await stopApi(started.server);
  }
});

test("G1: health and liveness checks never write, save, or change the world file", async () => {
  const backend = fileBackend();
  // No periodic saves in this test, so every write counted below can only come from the checks themselves.
  const { started, peer } = await startWithPeer(backend, "ReadOnly", { periodicSaves: false });
  try {
    // Let saves that the identity setup started finish before the baseline is taken (their writes are counted when
    // they start, so a write still in flight would otherwise change the file after the baseline).
    await sleep(300);
    const fileBefore = digest(backend.file);
    const writesBefore = backend.store.writeCount;
    for (let index = 0; index < 10; index += 1) {
      await fetch(`${started.baseUrl}/health`).then((response) => response.text());
      await fetch(`${started.baseUrl}/live`).then((response) => response.text());
    }
    assert.equal(backend.store.writeCount, writesBefore, "no save was attempted by the checks");
    assert.equal(digest(backend.file), fileBefore, "the world file is byte-identical");
  } finally {
    await peer.close();
    await stopApi(started.server);
  }
});

test("G3: healthy -> failure -> repeated failures -> success -> normal saves sends one recovery signal, and no repeat", async () => {
  const backend = fileBackend();
  const { started, peer } = await startWithPeer(backend, "Sequence");
  try {
    assert.equal(restores(peer), 0, "no recovery signal while healthy");

    for (let index = 0; index < 3; index += 1) backend.store.failNextWrite(`sequence failure ${index}`);
    await until(() => restores(peer) === 1);
    assert.equal(notices(peer), 1, "one failure notice for the whole episode");

    assert.equal(notices(peer), 1);
    const signal = peer.messages.find((message) => message.type === "persistence.restored");
    assert.equal(signal.failedAttempts, 3, "the signal counts the failed attempts");
    assert.deepEqual(Object.keys(signal).sort(), ["failedAttempts", "outageSeconds", "type"], "only reason and timing are sent");

    // Normal saves continue after recovery (the world keeps changing), and no second signal is sent.
    const digestAfterRecovery = digest(backend.file);
    await sleep(2_500);
    assert.notEqual(digest(backend.file), digestAfterRecovery, "normal saves continue");
    assert.equal(restores(peer), 1, "exactly one recovery signal");
    assert.equal(notices(peer), 1, "exactly one failure notice");
  } finally {
    backend.store.failures.length = 0;
    await peer.close();
    await stopApi(started.server);
  }
});

test("G3: healthy -> failure -> recovery -> new failure -> recovery sends one signal per episode", async () => {
  const backend = fileBackend();
  const { started, peer } = await startWithPeer(backend, "TwoEpisodes");
  try {
    backend.store.failNextWrite("episode one");
    backend.store.failNextWrite("episode one again");
    await until(() => restores(peer) === 1);
    assert.equal(restores(peer), 1);
    assert.equal(peer.messages.find((message) => message.type === "persistence.restored").failedAttempts, 2);

    // A later, separate failure episode. Its notice is sent again, and its recovery is reported on its own.
    backend.store.failNextWrite("episode two");
    await until(() => restores(peer) === 2);
    assert.equal(restores(peer), 2, "one signal per episode");
    assert.equal(notices(peer), 2, "one notice per episode");
    const second = peer.messages.filter((message) => message.type === "persistence.restored")[1];
    assert.equal(second.failedAttempts, 1, "the second episode counts only its own failures");
  } finally {
    backend.store.failures.length = 0;
    await peer.close();
    await stopApi(started.server);
  }
});
