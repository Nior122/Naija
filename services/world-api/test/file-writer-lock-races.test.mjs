// File-lock races and lock release (Stage 34; Stage 35 replaces the lock mechanism with flock(2)).
//
// The lock is an OS advisory lock held through a holder process (src/persistence/writer-lock.ts). The two races that
// Stage 34 reproduced are tested here with the real coordination path, and where the race needs more than one starter,
// with separate OS processes (test/support/writer-lock-race-child.mjs).
//
// Status of each race, as the tests show (see docs/STAGE_35_PROPERTY_MUTATION_SAFETY_AND_FILE_PERSISTENCE.md section 7):
//   - Race 2 (two starters take one stale lock): RESOLVED for protocol-following starters on one Linux host. Tested with
//     separate processes, five rounds, below. A starter that did not take the flock cannot take the lock.
//   - Race 1 (a lock replaced between the check and the rename): RESOLVED for protocol-following writers on one Linux
//     host. The lock is a flock on the world file's directory, so a lock file replaced by an outside process (in any
//     window, including after the check) does not let a second protocol writer in. Tested with a separate process in the
//     window (the "race 1, window" test). The boundary: a process that writes the world file without the directory lock is
//     outside the guarantee, as for race 2. Before this change this race was an OPEN todo.
//
// Part A is deterministic: an unreadable lock refuses only that save, and a clean SIGTERM releases the lock.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { WorldStore } from "../dist/multiplayer/persistence.js";
import { WorldFileLockedError, WorldFileWriterLock, processIsAlive } from "../dist/persistence/writer-lock.js";
import { saveOutcomeOf } from "../dist/persistence-status.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "..", "dist", "index.js");
const starterChild = join(here, "support", "writer-lock-race-child.mjs");
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

/** Starts a separate starter process. Resolves when it is READY. Its outcome is read with settle(). */
function startStarter(file) {
  const child = spawn(process.execPath, [starterChild], {
    env: { PATH: process.env.PATH, WORLD_FILE: file },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const waitFor = (pattern, timeoutMs = 20_000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const line = output.split("\n").find((entry) => pattern.test(entry));
      if (line !== undefined) { clearInterval(poll); resolve(line); return; }
      if (Date.now() - started > timeoutMs) { clearInterval(poll); reject(new Error(`starter timed out: ${output.slice(-300)}`)); }
    }, 10);
  });
  return {
    child,
    exited,
    ready: waitFor(/^@@ READY$/),
    go: () => child.stdin.write("GO\n"),
    settle: () => waitFor(/^@@ (ACQUIRED|REFUSED) /),
    output: () => output,
  };
}

// ─── Part A: deterministic ────────────────────────────────────────────────────

test("a lock file that cannot be read refuses only that save: not_saved, not fenced, file unchanged; the next save works once the lock reads again", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const store = new WorldStore(file, Date.now());
  store.acquireWriterLock();
  const lock = lockPathOf(file);
  // Make the lock unreadable: a directory where the lock file is, with the same inode kept aside, so that the lock
  // reads again later as the same lock (same inode, same record, same holder).
  const aside = `${lock}.aside`;
  renameSync(lock, aside);
  mkdirSync(lock);
  store.state.worldClock.minute_of_day = 200;
  const error = await store.saveState(store.state).then(() => null, (failure) => failure);
  assert.ok(error, "the save is refused");
  assert.equal(saveOutcomeOf(error), "not_saved", "a refusal before the rename is not_saved");
  assert.equal(store.isFenced(), false, "an unreadable lock does not fence the store (only a confirmed takeover does)");
  assert.equal(minuteIn(file), 100, "the file is unchanged");

  // The lock reads again, and it is the same lock: the next save is accepted.
  rmdirSync(lock);
  renameSync(aside, lock);
  await store.saveState(store.state);
  assert.equal(minuteIn(file), 200, "the save after recovery is written");
  store.releaseWriterLock();
  assert.equal(existsSync(lock), false);
});

function spawnServer(dataFile, port, options = {}) {
  const env = {
    PATH: process.env.PATH,
    NAIJA_ENV: "test",
    PERSISTENCE_BACKEND: "file",
    DATA_FILE: dataFile,
    PORT: String(port),
  };
  // detached: the server leads its own process group, so a signal to the group reaches it and its lock holder.
  const child = spawn(process.execPath, [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"], detached: options.detached === true });
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

// Stage 44: a signal to the whole process group (Ctrl-C in a terminal, or a supervisor that signals the group) also
// reached the lock holder, which is a child of the server in the same group. The holder died, the lock was lost, and
// the final save was refused (WorldFileLockLostError). The holder now ignores INT and TERM, so the server alone handles
// them, saves, and then releases the holder. The holder still ends when the server exits (its stdin pipe closes).
for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`a group ${signal} saves the world, exits 0, and removes the lock (the lock holder does not die first)`, async () => {
    const file = fileInDirectory();
    await saveMinute(file, 100);
    const run = spawnServer(file, await freePort(), { detached: true });
    await run.listening;
    assert.ok(existsSync(lockPathOf(file)), "premise: the running server holds the lock");
    process.kill(-run.child.pid, signal);
    const { code, signal: exitSignal } = await run.exited;
    const output = run.output();
    assert.equal(exitSignal, null, output.slice(-300));
    assert.equal(code, 0, `exit code (output tail: ${output.slice(-300)})`);
    assert.doesNotMatch(output, /WorldFileLockLostError|world_file_lock_lost/, output.slice(-300));
    assert.equal(existsSync(lockPathOf(file)), false, "the lock is released after the final save");
  });
}

// Stage 44 (Stage 43 section 8.3): a store whose lock was released must not write again. In production the final
// save is followed by releasing the lock; a save that was still queued then used to write the file with no lock at all,
// over a file that another process had taken the lock for.
test("a store whose lock was released is fenced: a later save is refused and does not overwrite another writer's file", async () => {
  const file = fileInDirectory();
  const first = new WorldStore(file, Date.now());
  first.acquireWriterLock();
  first.state.worldClock.minute_of_day = 100;
  await first.saveState(first.state);
  first.releaseWriterLock();
  const second = new WorldStore(file, Date.now());
  second.acquireWriterLock();
  second.state.worldClock.minute_of_day = 200;
  await second.saveState(second.state);
  first.state.worldClock.minute_of_day = 300;
  await assert.rejects(first.saveState(first.state), (error) => {
    assert.equal(saveOutcomeOf(error), "not_saved", "the released store reports that nothing was saved");
    return true;
  });
  assert.equal(minuteIn(file), 200, "the released store does not overwrite the second writer's file");
  assert.equal(first.isFenced(), true, "a released store is fenced");
  second.releaseWriterLock();
});

// Stage 44: the lock is held by a holder process that the server starts. The holder ends when its stdin pipe closes,
// and a server that exits normally or is killed with SIGKILL closes that pipe. So the holder ends with its server, and
// the lock is then free for the next start. (Ending a holder while its server still runs is a different case, not
// tested here.)
const holderChild = join(here, "support", "writer-lock-holder-child.mjs");
for (const how of ["exit", "SIGKILL"]) {
  test(`the lock holder ends when its server ends (${how}), and the lock is then free`, async () => {
    const file = fileInDirectory();
    const child = spawn(process.execPath, [holderChild], {
      env: { ...process.env, WORLD_FILE: file },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const holderPid = await new Promise((resolve, reject) => {
      let text = "";
      child.stdout.on("data", (chunk) => {
        text += chunk;
        const match = /HOLDER (\d+)/.exec(text);
        if (match) resolve(Number(match[1]));
      });
      child.once("exit", (code) => reject(new Error(`the server stand-in exited early (${code}): ${stderr.slice(-300)}`)));
    });
    assert.ok(processIsAlive(holderPid), "premise: the holder is running while its server holds the lock");
    if (how === "exit") child.stdin.write("QUIT\n");
    else child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const deadline = Date.now() + 5000;
    while (processIsAlive(holderPid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(processIsAlive(holderPid), false, "the holder ends with its server");
    const next = WorldFileWriterLock.acquire(file);
    assert.ok(next.isHeld(), "the lock is free for the next start");
    next.release();
  });
}

// ─── Part B: race 1 (a lock replaced between the check and the rename) ────────

test("race 1, protocol: while the owner holds the lock, another starter cannot take it, and the lock file is not replaced", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const store = new WorldStore(file, Date.now());
  store.acquireWriterLock();
  const before = statSync(lockPathOf(file)).ino;
  const starter = startStarter(file);
  try {
    await starter.ready;
    starter.go();
    const line = await starter.settle();
    assert.match(line, /^@@ REFUSED world_file_locked /, starter.output());
    assert.equal(statSync(lockPathOf(file)).ino, before, "the lock file is the same file");
    assert.equal(readLock(file).pid, process.pid, "the record still names the owner");
    store.state.worldClock.minute_of_day = 200;
    await store.saveState(store.state);
    assert.equal(minuteIn(file), 200, "the owner's save still goes through");
  } finally {
    starter.child.kill("SIGKILL");
    store.releaseWriterLock();
  }
});

test("race 1, out-of-protocol replacement before the check: a lock file with the same token but a new inode refuses the save; the file is unchanged and the store is fenced", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const lock = lockPathOf(file);
  const store = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: async (point) => {
      if (point !== "after-temp-sync") return;
      // Replace the lock file: a new file (new inode) with the same token. Only the inode check can see this.
      const token = readLock(file).token;
      rmSync(lock);
      writeFileSync(lock, recordText(process.pid, token));
    },
  });
  store.acquireWriterLock();
  store.state.worldClock.minute_of_day = 200;
  const error = await store.saveState(store.state).then(() => null, (failure) => failure);
  assert.ok(error, "the save must be refused: the lock file is no longer the one this writer locked");
  assert.equal(saveOutcomeOf(error), "not_saved", "the refusal happens before the rename");
  assert.equal(minuteIn(file), 100, "the file must be unchanged; a stale writer must not rename over another writer's world");
  assert.equal(store.isFenced(), true);
});

test("race 1, out-of-protocol replacement by different content before the check: the save is refused and the store is fenced", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const lock = lockPathOf(file);
  const store = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: async (point) => {
      if (point === "after-temp-sync") writeFileSync(lock, recordText(process.pid, `foreign-${randomUUID()}`));
    },
  });
  store.acquireWriterLock();
  store.state.worldClock.minute_of_day = 200;
  const error = await store.saveState(store.state).then(() => null, (failure) => failure);
  assert.ok(error, "the save must be refused: the lock is no longer this writer's");
  assert.equal(minuteIn(file), 100, "the file must be unchanged");
  assert.equal(store.isFenced(), true);
});

test("race 1, window: a lock file replaced by an outside process after the check and before the rename does not admit a second writer", async () => {
  const file = fileInDirectory();
  await saveMinute(file, 100);
  const lock = lockPathOf(file);
  let starterLine = null;
  let starterOutput = "";
  const store = new WorldStore(file, Date.now(), {
    // "after-lock-check" runs after the lock was checked and before the rename: the window the Stage 34 race used.
    fileWriteFaultHook: async (point) => {
      if (point !== "after-lock-check") return;
      // The outside replacement: a new, empty lock file (new inode, no record), so it looks unowned to a starter.
      rmSync(lock);
      writeFileSync(lock, "");
      // A protocol-following starter, in a separate process, tries now. It contends for the directory lock, which the
      // owner still holds, so it must be refused.
      const starter = startStarter(file);
      try {
        await starter.ready;
        starter.go();
        starterLine = await starter.settle();
        starterOutput = starter.output();
      } finally {
        starter.child.kill("SIGKILL");
      }
    },
  });
  store.acquireWriterLock();
  store.state.worldClock.minute_of_day = 200;
  await store.saveState(store.state);
  assert.match(starterLine, /^@@ REFUSED world_file_locked /, starterOutput);
  assert.equal(minuteIn(file), 200, "the owner, as the only protocol writer, saves");

  // The replaced lock file is not the one the owner wrote, so the owner's next save is fenced: it fails closed.
  store.state.worldClock.minute_of_day = 300;
  const error = await store.saveState(store.state).then(() => null, (failure) => failure);
  assert.ok(error, "after the replacement is seen, the next save is refused");
  assert.equal(store.isFenced(), true);
  assert.equal(minuteIn(file), 200, "the refused save changed nothing");
  store.releaseWriterLock();
});

test("one directory, one file-backend writer: a second world file in the same directory is refused while the first is open", () => {
  const first = fileInDirectory();
  const second = join(dirname(first), "second-world-state.json");
  const held = WorldFileWriterLock.acquire(first);
  try {
    assert.throws(() => WorldFileWriterLock.acquire(second), (error) => error instanceof WorldFileLockedError);
  } finally {
    held.release();
  }
  const next = WorldFileWriterLock.acquire(second);
  assert.ok(next.isHeld(), "after the first is released, the second world file can be taken");
  next.release();
});

// ─── Part C: race 2 (two starters take one stale lock) ────────────────────────

test("race 2: two separate starter processes that both find the same stale lock: exactly one takes it, the other is refused, and the winner's lock is not removed (five rounds)", async () => {
  for (let round = 0; round < 5; round += 1) {
    const file = fileInDirectory();
    writeFileSync(lockPathOf(file), recordText(deadPid(), `stale-${round}`));
    const first = startStarter(file);
    const second = startStarter(file);
    try {
      await Promise.all([first.ready, second.ready]);
      // Both are released at once, so their attempts overlap.
      first.go();
      second.go();
      const results = await Promise.all([first.settle(), second.settle()]);
      const acquired = results.filter((line) => line.startsWith("@@ ACQUIRED "));
      const refused = results.filter((line) => line.startsWith("@@ REFUSED "));
      assert.equal(acquired.length, 1, `round ${round}: exactly one starter takes the lock (${results.join(" | ")})`);
      assert.equal(refused.length, 1, `round ${round}: the other is refused (${results.join(" | ")})`);
      assert.match(refused[0], /^@@ REFUSED world_file_locked /, `round ${round}: refused with the lock code`);
      const winnerPid = Number(acquired[0].split(" ")[2]);
      assert.equal(readLock(file).pid, winnerPid, `round ${round}: the lock record names the winner`);
      const winner = [first, second].find((starter) => starter.output().includes(`ACQUIRED ${winnerPid}`));
      // The winner dies: the lock is free at once, with no manual step.
      winner.child.kill("SIGKILL");
      await winner.exited;
      const next = WorldFileWriterLock.acquire(file);
      assert.ok(next.isHeld(), `round ${round}: after the winner dies, a new starter takes the lock`);
      next.release();
    } finally {
      first.child.kill("SIGKILL");
      second.child.kill("SIGKILL");
    }
  }
});

test("race 2, in-process: a second starter in the same process is refused while the first holds the lock, whatever the record says", () => {
  const file = fileInDirectory();
  writeFileSync(lockPathOf(file), recordText(deadPid(), "stale"));
  const first = WorldFileWriterLock.acquire(file);
  try {
    assert.throws(() => WorldFileWriterLock.acquire(file), (error) => error instanceof WorldFileLockedError);
    assert.equal(readLock(file).token, first.token, "the live lock is not replaced");
  } finally {
    first.release();
  }
});
