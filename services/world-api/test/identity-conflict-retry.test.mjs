import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import { TestPeer } from "./support/harness.mjs";
import {
  createMessage,
  newCreationKey,
  startCreationServer,
  tempDirectory,
} from "./support/creation-fixture.mjs";

/**
 * CHARACTERIZATION of a known gap (Stage 28, docs/STAGE_28_CAPACITY_INCIDENT.md section 9).
 *
 * A creation is committed to the saved file, but the live world cannot take it (merge conflict), and the compensating
 * save also fails. The player is told "try again". The conflict branch does not register the creation key, so a retry
 * with the same key creates a NEW identity, unless the server has restarted (then the saved identity is recovered).
 * The assertions record what the code does now. They are not a statement of the intended contract. If the conflict
 * branch is fixed, these tests must change deliberately, and the change must be reviewed.
 */

const BUDGET = { perIpLimit: 2, globalLimit: 1000, windowMs: 60 * 60_000 };
const START = Date.UTC(2026, 9, 10, 12, 0, 0);
const COURT = "court:magistrate-fct";

function readSaved(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Arms one conflict. After the creation's save commits, the live world receives valid copies of every saved court
 * (so each court the creation adds is now already present), and the next write (the compensating save) fails.
 */
function conflictHook(store, file) {
  let armed = true;
  return (point) => {
    if (!armed || point !== "after-save") return;
    armed = false;
    const saved = readSaved(file).courts;
    for (const [id, court] of Object.entries(saved)) store.state.courts[id] = structuredClone(court);
    store.state.courts[COURT].name = `${saved[COURT].name} (concurrent edit)`;
    store.failNextWrite();
  };
}

async function createFrom(started, address, creationKey, name) {
  const socket = new WebSocket(started.websocketUrl, { localAddress: address });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const peer = new TestPeer(socket);
  try {
    peer.send(createMessage(creationKey, name));
    return await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 10_000);
  } finally {
    await peer.close();
  }
}

/** Starts a server over a file. `hookFor(store)` may return a creationFaultHook bound to that store. */
async function startOver(file, hookFor) {
  const store = new FaultyStore(new WorldStore(file, START));
  const options = hookFor ? { creationFaultHook: hookFor(store) } : {};
  const started = await startCreationServer({ store }, { identityBudget: BUDGET, ...options });
  return { store, started };
}

test("characterization: a conflict-then-retry with the same key (no restart) creates a second identity; the first is not kept", async () => {
  const directory = tempDirectory("naija-conflict-retry-");
  const file = join(directory, "world-state.json");
  const { store, started } = await startOver(file, (s) => conflictHook(s, file));
  try {
    const key = newCreationKey();
    const first = await createFrom(started, "127.0.0.1", key, "First");
    assert.equal(first.type, "error");
    assert.equal(first.code, "identity_creation_conflict");

    // The saved file holds the first identity (its token was never delivered); the live world does not.
    const savedIds = Object.keys(readSaved(file).players);
    assert.equal(savedIds.length, 1, "the saved file holds the conflicted identity");
    assert.equal(Object.keys(store.state.players).length, 0, "the live world does not");

    // Retry with the same creation key, as the player is told to do.
    const retry = await createFrom(started, "127.0.0.1", key, "Retry");
    assert.equal(retry.type, "identity.created", "the retry is accepted");
    assert.notEqual(retry.playerId, savedIds[0], "the retry is a different identity from the first");

    // The saved world now holds only the retry's identity: the first was not kept.
    assert.deepEqual(Object.keys(readSaved(file).players), [retry.playerId]);

    // The budget (limit 2 per IP) counted the first identity as well as the retry: the next creation is refused.
    const third = await createFrom(started, "127.0.0.1", newCreationKey(), "Third");
    assert.equal(third.type, "error");
    assert.equal(third.code, "identity_creation_limited", "the conflicted identity consumed budget");
  } finally {
    await started.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("characterization: after a crash-restart between the conflict and the retry, the same key recovers the saved identity", async () => {
  const directory = tempDirectory("naija-conflict-restart-");
  const file = join(directory, "world-state.json");
  const crashed = join(directory, "crash-time-world-state.json");
  const first = await startOver(file, (s) => conflictHook(s, file));
  const key = newCreationKey();
  let savedId;
  try {
    const conflicted = await createFrom(first.started, "127.0.0.1", key, "First");
    assert.equal(conflicted.code, "identity_creation_conflict");
    // The file as it stands at the moment of a crash, before any shutdown write.
    copyFileSync(file, crashed);
    savedId = Object.keys(readSaved(crashed).players)[0];
    assert.ok(savedId, "the crash-time file holds the conflicted identity");
  } finally {
    await first.started.stop();
  }

  const second = await startOver(crashed);
  try {
    const retry = await createFrom(second.started, "127.0.0.1", key, "Retry");
    assert.equal(retry.type, "identity.created");
    assert.equal(retry.playerId, savedId, "after a restart the retry gets the saved identity back");
    assert.deepEqual(Object.keys(readSaved(crashed).players), [savedId], "recovery creates no second identity");
  } finally {
    await second.started.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
