import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "./support/faulty-store.mjs";
import {
  createMessage,
  keyHashOf,
  newCreationKey,
  orphanProblems,
  recordCounts,
  startCreationServer,
  tempDirectory,
} from "./support/creation-fixture.mjs";
import { openPeer } from "./support/harness.mjs";

/**
 * R2/R1 process interruption (file backend). A child process runs a real server, is paused at a
 * known save point, and is killed with SIGKILL. The parent then restarts from the file on disk.
 *
 * Not covered here: a kill during a PostgreSQL UPDATE (see test/multiprocess-persistence.test.mjs),
 * and a kill between the disk rename and the client response. The outcome of the latter is only
 * known from the restart, which is what the "after-commit" test checks.
 */

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function runChild(file, key, point) {
  const child = spawn(process.execPath, ["test/support/creation-crash-child.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, NAIJA_CRASH_STATE_FILE: file, NAIJA_CRASH_KEY: key, NAIJA_CRASH_POINT: point },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("child did not reach the save point"));
    }, 15_000);
    const poll = setInterval(() => {
      if (output.includes("PAUSED")) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(child);
      } else if (output.includes("NOT-REACHED")) {
        clearInterval(poll);
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error("child did not reach the save point"));
      }
    }, 10);
  });
}

async function killed(child) {
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  child.kill("SIGKILL");
  return exited;
}

function loadFile(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

test("R2 interruption: a process killed before its save commits leaves the last committed world; the key works after restart", async () => {
  const directory = tempDirectory("naija-interrupt-");
  directories.push(directory);
  const file = join(directory, "world-state.json");

  // A committed baseline identity, written by a normal in-process server.
  const baselineStore = new FaultyStore(new WorldStore(file, Date.now()));
  const baseline = await startCreationServer({ store: baselineStore });
  const baselinePeer = await openPeer(baseline.websocketUrl);
  baselinePeer.send(createMessage(newCreationKey(), "Baseline"));
  await baselinePeer.waitFor((message) => message.type === "identity.created", 5000);
  await baselinePeer.close();
  await baseline.stop();
  const committed = loadFile(file);
  const committedCounts = recordCounts(committed);

  const key = newCreationKey();
  const child = await runChild(file, key, "before-commit");
  await killed(child);

  const afterKill = loadFile(file);
  assert.deepEqual(recordCounts(afterKill), committedCounts, "nothing from the killed request is saved");
  assert.deepEqual(orphanProblems(afterKill), []);
  assert.equal(Object.values(afterKill.players).filter((player) => player.creationKeyHash === keyHashOf(key)).length, 0);

  // Restart from disk. The key must create a new identity (no reservation survives a restart).
  const restartStore = new FaultyStore(new WorldStore(file, Date.now()));
  const restarted = await startCreationServer({ store: restartStore });
  const peer = await openPeer(restarted.websocketUrl);
  try {
    peer.send(createMessage(key, "Restarted"));
    const reply = await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
    assert.equal(reply.type, "identity.created");
  } finally {
    await peer.close();
    await restarted.stop();
  }
  const finalState = loadFile(file);
  assert.deepEqual(orphanProblems(finalState), []);
  assert.equal(Object.values(finalState.players).filter((player) => player.creationKeyHash === keyHashOf(key)).length, 1);
});

test("R2 interruption: a process killed after its save commits keeps one complete identity; the key recovers it after restart", async () => {
  const directory = tempDirectory("naija-interrupt-");
  directories.push(directory);
  const file = join(directory, "world-state.json");
  const key = newCreationKey();

  const child = await runChild(file, key, "after-commit");
  await killed(child);

  const afterKill = loadFile(file);
  assert.deepEqual(orphanProblems(afterKill), [], "the committed identity must be complete");
  const committedIds = Object.values(afterKill.players).filter((player) => player.creationKeyHash === keyHashOf(key)).map((player) => player.playerId);
  assert.equal(committedIds.length, 1);

  const restartStore = new FaultyStore(new WorldStore(file, Date.now()));
  const restarted = await startCreationServer({ store: restartStore });
  const peer = await openPeer(restarted.websocketUrl);
  try {
    peer.send(createMessage(key, "Restarted"));
    const reply = await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 5000);
    assert.equal(reply.type, "identity.created");
    assert.equal(reply.playerId, committedIds[0], "the key recovers the committed identity, not a duplicate");
  } finally {
    await peer.close();
    await restarted.stop();
  }
  const finalState = loadFile(file);
  assert.equal(Object.values(finalState.players).filter((player) => player.creationKeyHash === keyHashOf(key)).length, 1);
  assert.deepEqual(orphanProblems(finalState), []);
});
