import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { initialState, WorldStore } from "../dist/multiplayer/persistence.js";

/**
 * Stage 28, G5: file-save durability facts, tested at the level a test can reach.
 *
 * What is tested: each phase of a save with an injected failure (the temporary file is written and synced, the
 * rename happens, the directory is synced), leftover temporary files, and a process killed with SIGKILL during
 * repeated saves. Each test uses its own temporary directory; no test reads or writes services/world-api/data.
 *
 * What is NOT tested: power loss. A SIGKILL leaves the operating system's page cache intact, so these tests cannot
 * show that a completed save survives a power cut. See docs/STAGE_28_PERSISTENCE_SAFETY.md.
 */

const here = dirname(fileURLToPath(import.meta.url));
const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function directory() {
  const created = mkdtempSync(join(tmpdir(), "naija-durability-"));
  directories.push(created);
  return created;
}

const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const temporaryFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith(".tmp"));

function worldWithMarker(marker) {
  const state = initialState(Date.now());
  state.worldClock.minute_of_day = marker;
  return state;
}

test("normal save: the file holds the saved world, and a new store loads it", async () => {
  const dir = directory();
  const file = join(dir, "world-state.json");
  const store = new WorldStore(file, Date.now());
  await store.saveState(worldWithMarker(42));
  const reloaded = new WorldStore(file, Date.now());
  assert.equal(reloaded.state.worldClock.minute_of_day, 42);
  assert.deepEqual(temporaryFiles(dir), [], "no temporary file is left after a successful save");
  assert.equal((await store.health()).status, "pass");
});

test("a failure before the temporary file is written leaves the previous file byte-identical, with no temporary file", async () => {
  const dir = directory();
  const file = join(dir, "world-state.json");
  await new WorldStore(file, Date.now()).saveState(worldWithMarker(1));
  const before = digest(file);

  const store = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: (phase) => {
      if (phase === "before-temp") throw new Error("injected: before temp");
    },
  });
  await assert.rejects(store.saveState(worldWithMarker(2)), /injected: before temp/);
  assert.equal(digest(file), before, "the previous file is unchanged");
  assert.deepEqual(temporaryFiles(dir), []);
  const health = await store.health();
  assert.equal(health.status, "fail", "a failed save is reported by health");
  assert.match(health.message, /storage write failed/);
});

test("a failure after the temporary file is synced leaves the previous file byte-identical, and the temporary file is removed", async () => {
  const dir = directory();
  const file = join(dir, "world-state.json");
  await new WorldStore(file, Date.now()).saveState(worldWithMarker(1));
  const before = digest(file);

  const store = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: (phase) => {
      if (phase === "after-temp-sync") throw new Error("injected: after temp sync");
    },
  });
  await assert.rejects(store.saveState(worldWithMarker(2)), /injected: after temp sync/);
  assert.equal(digest(file), before, "the rename has not happened, so the previous file stays");
  assert.deepEqual(temporaryFiles(dir), [], "the finally block removes the complete temporary file");
});

test("a failure after the rename reports failure, but the new file is already in place: reloading loads the new world", async () => {
  // This is the case a caller must understand. The save reported failure, yet the rename happened. A restart
  // loads the new world. Callers treat a failed save as "not known to be saved", not as "not saved".
  const dir = directory();
  const file = join(dir, "world-state.json");
  await new WorldStore(file, Date.now()).saveState(worldWithMarker(1));

  const store = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: (phase) => {
      if (phase === "after-rename") throw new Error("injected: after rename");
    },
  });
  await assert.rejects(store.saveState(worldWithMarker(2)), /injected: after rename/);
  assert.equal(new WorldStore(file, Date.now()).state.worldClock.minute_of_day, 2, "the replaced file holds the new world");
  assert.deepEqual(temporaryFiles(dir), []);
});

test("after an injected failure, the next save succeeds and health returns to pass", async () => {
  const dir = directory();
  const file = join(dir, "world-state.json");
  let failNext = true;
  const store = new WorldStore(file, Date.now(), {
    fileWriteFaultHook: (phase) => {
      if (failNext && phase === "before-temp") {
        failNext = false;
        throw new Error("injected once");
      }
    },
  });
  await assert.rejects(store.saveState(worldWithMarker(5)));
  assert.equal((await store.health()).status, "fail");
  await store.saveState(worldWithMarker(6));
  assert.equal((await store.health()).status, "pass", "a successful save restores health");
  assert.equal(new WorldStore(file, Date.now()).state.worldClock.minute_of_day, 6);
});

test("a leftover temporary file from an earlier crash is ignored at load and is not removed", async () => {
  const dir = directory();
  const file = join(dir, "world-state.json");
  await new WorldStore(file, Date.now()).saveState(worldWithMarker(7));
  const leftover = join(dir, `world-state.json.99999.${randomUUID()}.tmp`);
  writeFileSync(leftover, "{ partial");

  const store = new WorldStore(file, Date.now());
  assert.equal(store.state.worldClock.minute_of_day, 7, "the main file is loaded, not the leftover");
  await store.saveState(worldWithMarker(8));
  assert.equal(new WorldStore(file, Date.now()).state.worldClock.minute_of_day, 8);
  assert.ok(existsSync(leftover), "the leftover is not deleted automatically (no automatic pruning)");
});

test("a process killed with SIGKILL during repeated saves never leaves a partial main file", async () => {
  const helper = resolve(here, "support", "file-save-child.mjs");
  for (let round = 0; round < 3; round += 1) {
    const dir = directory();
    const file = join(dir, "world-state.json");
    const child = spawn(process.execPath, [helper, file], { stdio: ["ignore", "pipe", "pipe"] });
    let printed = 0;
    child.stdout.on("data", (chunk) => {
      printed += chunk.toString().split("\n").filter((line) => line.startsWith("saved ")).length;
    });
    const started = Date.now();
    while (printed < 4 + round * 3 && Date.now() - started < 30_000) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(printed >= 4, `the child completed saves before the kill (printed ${printed})`);

    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGKILL");
    const { signal } = await exited;
    assert.equal(signal, "SIGKILL");

    // Loading must succeed (the file parses and passes validation) and must hold a complete save: the marker is the
    // number of a save that the child completed, or the one it was writing when it was killed.
    const loaded = new WorldStore(file, Date.now());
    const record = loaded.state.lifeEvents["kill-record"];
    assert.ok(record, "the loaded world contains a complete save");
    const saved = Number(record.summary.replace("kill ", ""));
    assert.ok(saved >= printed, `the file holds at least every save the child reported (${saved} >= ${printed})`);
    assert.ok(saved <= printed + 1, `the file holds no save the child did not reach (${saved} <= ${printed + 1})`);
    assert.equal(record.data.payload.length, 512 * 1024, "the payload is complete");
  }
});
