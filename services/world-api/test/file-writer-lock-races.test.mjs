// File-lock races and lock release (Stage 34).
//
// Part A is deterministic and passes: a lock file that cannot be read refuses only that save (not_saved, no fence),
// and the next save works once the lock reads again. A clean SIGTERM releases the lock, so a new start can take it.
//
// Part B reproduces the two races documented in Stage 33 section 3.5. They are OPEN, not fixed. Each one is written as
// a test of the required behaviour and marked `todo`, so it runs and reports the failure without failing the suite,
// and it is never counted as a pass. If one of them starts passing, the race is closed and the todo must be removed
// together with the documentation that says it is open:
//   - Race 1: the lock is replaced after the save's token check and before its rename. The save then renames.
//   - Race 2: a starter reads a stale lock, another starter takes it, and the first removes the new live lock.
// No reliable primitive in this runtime closes either race (see docs/STAGE_34_MUTATION_OUTCOMES_AND_RISK_CONTAINMENT.md section 5).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { WorldFileLockedError, WorldFileWriterLock } from "../dist/persistence/writer-lock.js";
import { saveOutcomeOf } from "../dist/persistence-status.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "..", "dist", "index.js");
const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function fileInDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "naija-lock-races-"));
  directories.push(directory);
  return join(directory, "world-state.json");
}

const lockPathOf = (file) => `${file}.lock`;
const readLock = (file) => JSON.parse(readFileSync(lockPathOf(file), "utf8"));
const minuteIn = (file) => JSON.parse(readFileSync(file, "utf8")).worldClock.minute_of_day;
const recordText = (pid, token) => `${JSON.stringify({ pid, token, acquired_at: new Date().toISOString() })}\n`;

/** A pid of a process that has exited, so it is certainly not alive now. */
function deadPid() {
  const result = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(result.status, 0, "premise: a short-lived child exits cleanly");
  return result.pid;
}

async function saveMinute(file, minute) {
  const store = new WorldStore(file, Date.now());
  store.state.worldClock.minute_of_day = minute;
  await store.saveState(store.state);
}

// ─── Part A: deterministic, passing ───────────────────────────────────────────

test("a lock file that cannot be read refuses only that save: not_saved, not fenced, file unchanged; the next save works once the lock reads again", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const store = new WorldStore(file, Date.now());
  store.acquireWriterLock();
  const token = readLock(file).token;
  const lock = lockPathOf(file);
  // Make the lock unreadable: a directory where the lock file should be.
  rmSync(lock);
  mkdirSync(lock);
  store.state.worldClock.minute_of_day = 200;
  const error = await store.saveState(store.state).then(() => null, (failure) => failure);
  assert.ok(error, "the save is refused");
  assert.equal(saveOutcomeOf(error), "not_saved", "a refusal before the rename is not_saved");
  assert.equal(store.isFenced(), false, "an unreadable lock does not fence the store (only a confirmed takeover does)");
  assert.equal(minuteIn(file), 100, "the file is unchanged");

  // The lock reads again and still holds this writer's token: the next save is accepted.
  rmSync(lock, { recursive: true, force: true });
  writeFileSync(lock, recordText(process.pid, token));
  await store.saveState(store.state);
  assert.equal(minuteIn(file), 200, "the save after recovery is written");
  store.releaseWriterLock();
  assert.equal(existsSync(lock), false);
});

function spawnServer(dataFile, port) {
  const env = {
    PATH: process.env.PATH,
    NAIJA_ENV: "test",
    PERSISTENCE_BACKEND: "file",
    DATA_FILE: dataFile,
    PORT: String(port),
  };
  const child = spawn(process.execPath, [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-400)}`)), 20_000);
    const check = setInterval(() => {
      if (output.includes("listening on")) { clearInterval(check); clearTimeout(timer); resolve(); }
    }, 50);
  });
  return { child, exited, listening, output: () => output };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test("a clean SIGTERM saves, exits 0, and removes the lock; a new start can take the lock", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const run = spawnServer(file, await freePort());
  await run.listening;
  assert.ok(existsSync(lockPathOf(file)), "premise: the running server holds the lock");
  run.child.kill("SIGTERM");
  const { code, signal } = await run.exited;
  assert.equal(signal, null, run.output().slice(-300));
  assert.equal(code, 0, `exit code (output tail: ${run.output().slice(-300)})`);
  assert.equal(existsSync(lockPathOf(file)), false, "the lock is released after the final save");
  const next = WorldFileWriterLock.acquire(file);
  assert.ok(next.isHeld(), "a new start takes the released lock");
  next.release();
});

// ─── Part B: open races, reproduced deterministically ─────────────────────────

const RACE_1 = "OPEN (Stage 34, race 1): a lock replaced after the token check and before the rename is not detected; the save renames. Not fixed: no reliable primitive in this runtime.";
const RACE_2 = "OPEN (Stage 34, race 2): a starter that read a stale lock removes a live lock another starter created meanwhile. Not fixed: no reliable primitive in this runtime.";

test("race 1: a lock replaced between the token check and the rename must refuse the save (currently it does not)", { todo: RACE_1 }, async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const lock = lockPathOf(file);
  const store = new WorldStore(file, Date.now(), {
    // "after-temp-sync" runs after the token check and before the rename. Another writer takes the lock in that gap.
    fileWriteFaultHook: async (point) => {
      if (point === "after-temp-sync") writeFileSync(lock, recordText(process.pid, `foreign-${randomUUID()}`));
    },
  });
  store.acquireWriterLock();
  store.state.worldClock.minute_of_day = 200;
  const error = await store.saveState(store.state).then(() => null, (failure) => failure);
  assert.ok(error, "the save must be refused: the lock is no longer this writer's");
  assert.equal(minuteIn(file), 100, "the file must be unchanged; a stale writer must not rename over another writer's world");
  assert.equal(store.isFenced(), true);
});

test("race 2: a starter must not remove a live lock that another starter created after it read the stale lock (currently it does)", { todo: RACE_2 }, () => {
  const file = fileInDirectory();
  const lock = lockPathOf(file);
  writeFileSync(lock, recordText(deadPid(), "stale-token"));
  const winner = `winner-${randomUUID()}`;
  assert.throws(() => WorldFileWriterLock.acquire(file, {
    // The other starter takes the stale lock in the gap. Its holder is alive: the parent of this test process.
    afterStaleRead: () => writeFileSync(lock, recordText(process.ppid, winner)),
  }), WorldFileLockedError, "the second starter must be refused while the live lock stands");
  assert.equal(readLock(file).token, winner, "the live holder's lock is still there");
});
