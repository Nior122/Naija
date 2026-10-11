// Single-writer protection for the file backend (Stage 33).
//
// Part A: the lock in this process (acquire, refuse, release, stale takeover, fencing of a store that lost its lock,
// and the outcome of each kind of failed save).
// Part B: real child processes. A second server process is refused while the first runs. A SIGKILL releases a stale
// lock. A SIGKILL during a save leaves the previous world intact (before the rename) or the new one (after it).
//
// Every test uses its own temporary directory; none touches the live world file.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { initialState, WorldStore, WorldStateCapacityError } from "../dist/multiplayer/persistence.js";
import { openWorldPersistence } from "../dist/persistence/open.js";
import { processIsAlive, WorldFileLockedError, WorldFileLockLostError, WorldFileWriterLock } from "../dist/persistence/writer-lock.js";
import { saveOutcomeOf } from "../dist/persistence-status.js";

const here = dirname(fileURLToPath(import.meta.url));
const childPath = join(here, "support", "writer-lock-child.mjs");
const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileInDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "naija-writer-lock-"));
  directories.push(directory);
  return join(directory, "world-state.json");
}

const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const minuteIn = (file) => JSON.parse(readFileSync(file, "utf8")).worldClock.minute_of_day;
const lockPathOf = (file) => `${file}.lock`;
const readLock = (file) => JSON.parse(readFileSync(lockPathOf(file), "utf8"));

/** A pid of a process that has exited, so it is certainly not alive now. */
function deadPid() {
  const result = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(result.status, 0, "premise: a short-lived child exits cleanly");
  assert.equal(processIsAlive(result.pid), false, "premise: the child has exited");
  return result.pid;
}

/** The production open path, with the file backend selected for this call only. */
async function openFile(file) {
  const saved = { NAIJA_ENV: process.env.NAIJA_ENV, PERSISTENCE_BACKEND: process.env.PERSISTENCE_BACKEND };
  process.env.NAIJA_ENV = "test";
  process.env.PERSISTENCE_BACKEND = "file";
  try {
    return await openWorldPersistence({ stateFile: file, log: () => {} });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Saves a world whose minute_of_day is `minute` through a store that holds no lock (for setup). */
async function saveMinute(file, minute) {
  const store = new WorldStore(file, Date.now());
  store.state.worldClock.minute_of_day = minute;
  await store.saveState(store.state);
}

// ─── Part A: in this process ──────────────────────────────────────────────────

test("acquire writes a lock with this process and a token, and a second acquire here is refused", () => {
  const file = fileInDirectory();
  const lock = WorldFileWriterLock.acquire(file);
  try {
    assert.equal(readLock(file).pid, process.pid);
    assert.equal(readLock(file).token, lock.token);
    assert.throws(() => WorldFileWriterLock.acquire(file), (error) => error instanceof WorldFileLockedError && error.code === "world_file_locked");
    assert.equal(readLock(file).token, lock.token, "the refused acquire did not replace the lock");
  } finally {
    lock.release();
  }
});

test("release removes only this writer's lock; a released file can be locked again", () => {
  const file = fileInDirectory();
  const first = WorldFileWriterLock.acquire(file);
  first.release();
  assert.equal(existsSync(lockPathOf(file)), false);
  first.release(); // a second release is a no-op
  const second = WorldFileWriterLock.acquire(file);
  first.release(); // the released writer must not remove the new writer's lock
  assert.equal(readLock(file).token, second.token);
  second.release();
});

test("a lock held by a live process is refused, with that process named", () => {
  const file = fileInDirectory();
  assert.equal(processIsAlive(process.ppid), true, "premise: the parent process is alive");
  writeFileSync(lockPathOf(file), `${JSON.stringify({ pid: process.ppid, token: "other", acquired_at: "x" })}\n`);
  assert.throws(() => WorldFileWriterLock.acquire(file), (error) => error instanceof WorldFileLockedError && /pid \d+/.test(error.message));
  assert.equal(readLock(file).token, "other", "a live holder's lock is not touched");
});

test("a lock whose holder has exited is taken over", () => {
  const file = fileInDirectory();
  writeFileSync(lockPathOf(file), `${JSON.stringify({ pid: deadPid(), token: "gone", acquired_at: "x" })}\n`);
  const lock = WorldFileWriterLock.acquire(file);
  try {
    assert.equal(readLock(file).pid, process.pid);
    assert.notEqual(readLock(file).token, "gone");
  } finally {
    lock.release();
  }
});

test("an unreadable lock is refused while it is recent, and taken over once it is old", () => {
  const file = fileInDirectory();
  writeFileSync(lockPathOf(file), "not json");
  assert.throws(() => WorldFileWriterLock.acquire(file), WorldFileLockedError);
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockPathOf(file), old, old);
  const lock = WorldFileWriterLock.acquire(file);
  lock.release();
});

test("a world in a data directory that does not exist yet can be locked, and the directory is created", () => {
  const file = join(fileInDirectory(), "nested", "world-state.json");
  const lock = WorldFileWriterLock.acquire(file);
  try {
    assert.equal(readLock(file).token, lock.token);
  } finally {
    lock.release();
  }
});

test("a store that lost its lock is fenced: its save is refused as not_saved, and the file is unchanged", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const store = new WorldStore(file, Date.now());
  store.acquireWriterLock();
  store.state.worldClock.minute_of_day = 200;
  await store.saveState(store.state);
  assert.equal(minuteIn(file), 200, "premise: the locked store saves");
  const saved = digest(file);

  // Another writer takes the lock.
  const foreign = `foreign-${process.pid}`;
  writeFileSync(lockPathOf(file), `${JSON.stringify({ pid: process.pid, token: foreign, acquired_at: "x" })}\n`);
  store.state.worldClock.minute_of_day = 300;
  await assert.rejects(store.saveState(store.state), (error) => error instanceof WorldFileLockLostError);
  assert.equal(saveOutcomeOf(await store.saveState(store.state).catch((error) => error)), "not_saved");
  assert.equal(store.isFenced(), true);
  assert.equal(digest(file), saved, "a fenced store never writes the file");

  store.releaseWriterLock();
  assert.equal(readLock(file).token, foreign, "a fenced store does not remove the other writer's lock");
});

test("a store without a lock writes exactly as before, and creates no lock file", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 42);
  assert.equal(minuteIn(file), 42);
  assert.equal(existsSync(lockPathOf(file)), false);
});

test("a failure before the rename is not_saved and leaves the previous world; a failure after the rename is unknown", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 10);
  const before = digest(file);

  for (const phase of ["before-temp", "after-temp-sync"]) {
    const store = new WorldStore(file, Date.now(), {
      fileWriteFaultHook: (current) => {
        if (current === phase) throw new Error(`injected ${phase}`);
      },
    });
    store.state.worldClock.minute_of_day = 20;
    const error = await store.saveState(store.state).catch((caught) => caught);
    assert.ok(error instanceof Error, `${phase}: the save fails`);
    assert.equal(saveOutcomeOf(error), "not_saved", `${phase}: nothing became visible`);
    assert.equal(digest(file), before, `${phase}: the previous world is still the saved one`);
  }

  const renamed = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: (current) => {
      if (current === "after-rename") throw new Error("injected after-rename");
    },
  });
  renamed.state.worldClock.minute_of_day = 30;
  const error = await renamed.saveState(renamed.state).catch((caught) => caught);
  assert.ok(error instanceof Error);
  assert.equal(saveOutcomeOf(error), "unknown", "the new world was already visible when the failure happened");
  assert.equal(minuteIn(file), 30, "the file holds the new world even though the save reported failure");
});

test("a capacity refusal is not_saved, and nothing is written", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 5);
  const before = digest(file);
  // The limit equals the saved file, so the file still loads, and a larger candidate is refused.
  const store = new WorldStore(file, Date.now(), { maxBytes: statSync(file).size });
  const candidate = initialState(Date.now());
  candidate.padding = "x".repeat(200);
  const error = await store.saveState(candidate).catch((caught) => caught);
  assert.ok(error instanceof WorldStateCapacityError);
  assert.equal(saveOutcomeOf(error), "not_saved");
  assert.equal(digest(file), before);
});

test("openWorldPersistence refuses a second open of the same file in this process; close releases it", async () => {
  const file = fileInDirectory();
  const first = await openFile(file);
  await assert.rejects(openFile(file), (error) => error.code === "world_file_locked");
  await first.close();
  const second = await openFile(file);
  await second.close();
  assert.equal(existsSync(lockPathOf(file)), false, "a closed world leaves no lock behind");
});

// ─── Part B: separate processes ───────────────────────────────────────────────

function childEnvironment(file, extra) {
  const { DATABASE_URL: _unused, ...rest } = process.env;
  return { ...rest, NAIJA_ENV: "test", PERSISTENCE_BACKEND: "file", WORLD_FILE: file, ...extra };
}

/** Starts a child process and collects the "@@" lines it prints. */
function spawnChild(file, mode, extra = {}) {
  const child = spawn(process.execPath, [childPath], {
    env: childEnvironment(file, { CHILD_MODE: mode, ...extra }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = [];
  const errors = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      if (line.startsWith("@@ ")) lines.push(line.slice(3));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk) => errors.push(String(chunk)));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  return {
    child,
    lines,
    exited,
    errors: () => errors.join(""),
    async waitForLine(prefix, timeoutMs = 15_000) {
      const started = Date.now();
      while (!lines.some((line) => line.startsWith(prefix))) {
        if (Date.now() - started > timeoutMs) {
          throw new Error(`timed out waiting for "${prefix}". Output: ${JSON.stringify(lines)} stderr: ${errors.join("")}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return lines.find((line) => line.startsWith(prefix));
    },
    kill() {
      child.kill("SIGKILL");
    },
  };
}

test("a second server process is refused while the first holds the world; a SIGKILL releases it for the next start", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 1);
  const first = spawnChild(file, "open");
  try {
    await first.waitForLine("OPENED");
    const second = spawnChild(file, "open");
    const refused = await second.waitForLine("REFUSED");
    assert.match(refused, /^REFUSED world_file_locked /, "the second process is refused, not started");
    assert.match(refused, new RegExp(`pid ${first.child.pid}\\b`), "the refusal names the process that holds the world");
    assert.deepEqual(await second.exited, { code: 3, signal: null });

    first.kill();
    await first.exited;
    const third = spawnChild(file, "open");
    try {
      await third.waitForLine("OPENED");
      assert.deepEqual(await Promise.race([third.exited, new Promise((resolve) => setTimeout(() => resolve("running"), 200))]), "running");
    } finally {
      third.kill();
      await third.exited;
    }
  } finally {
    first.kill();
    await first.exited;
  }
});

test("SIGKILL during a save, before the rename: the previous world is intact and the next start loads it", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 111);
  const before = digest(file);
  const saver = spawnChild(file, "hold-save", { HOLD_PHASE: "after-temp-sync", NEW_MINUTE: "222" });
  await saver.waitForLine("HOLD after-temp-sync");
  assert.equal(digest(file), before, "while the save is held, the file is still the previous world");
  saver.kill();
  await saver.exited;

  assert.equal(digest(file), before, "after the kill, the file is still the previous world");
  assert.equal(minuteIn(file), 111);
  const restarted = await openFile(file).catch((error) => error);
  assert.ok(!(restarted instanceof Error), `the next start takes over the stale lock: ${restarted?.message ?? ""}`);
  assert.equal(restarted.store.state.worldClock.minute_of_day, 111, "the next start loads the previous world");
  await restarted.close();
});

test("SIGKILL during a save, after the rename: the new world is in the file, which the killed process never confirmed", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 111);
  const saver = spawnChild(file, "hold-save", { HOLD_PHASE: "after-rename", NEW_MINUTE: "333" });
  await saver.waitForLine("HOLD after-rename");
  saver.kill();
  await saver.exited;

  assert.equal(minuteIn(file), 333, "the rename had happened, so the new world is saved");
  const restarted = await openFile(file);
  assert.equal(restarted.store.state.worldClock.minute_of_day, 333, "the restarted world holds the change the client never saw confirmed");
  await restarted.close();
});

test("a stale lock left by a process that died does not block a new writer", () => {
  // The same rule as the process tests above, without spawning a process: a lock whose holder is gone is replaced.
  const file = fileInDirectory();
  writeFileSync(lockPathOf(file), `${JSON.stringify({ pid: deadPid(), token: "stale", acquired_at: "x" })}\n`);
  const lock = WorldFileWriterLock.acquire(file);
  lock.release();
  assert.equal(existsSync(lockPathOf(file)), false);
});
