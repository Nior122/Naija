import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";

/**
 * Saved-file format: compact JSON (decision approved for R5 Decision 2).
 *
 * Saves are compact. Files written in the older pretty-printed format must still load, and a save
 * must reload to the same state. These tests use temporary directories only.
 */

const directories = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function tempFile() {
  const directory = mkdtempSync(join(tmpdir(), "naija-format-"));
  directories.push(directory);
  return join(directory, "world-state.json");
}

test("R5 format: a save is compact JSON and reloads to an equal state", async () => {
  const file = tempFile();
  const store = new WorldStore(file, Date.UTC(2026, 9, 10));
  const original = structuredClone(store.state);
  await store.flush();

  const text = readFileSync(file, "utf8");
  assert.equal(text.includes("\n"), false, "the saved file has no line breaks");
  assert.deepEqual(JSON.parse(text), original, "the saved JSON is the same content as the state");

  const reloaded = new WorldStore(file, Date.UTC(2026, 9, 10));
  assert.deepEqual(reloaded.state, original, "reloading the compact save gives the same state");
});

test("R5 format: a pretty-printed file from the earlier format still loads to the same state", async () => {
  const file = tempFile();
  const seeded = new WorldStore(file, Date.UTC(2026, 9, 10));
  const expected = structuredClone(seeded.state);
  writeFileSync(file, JSON.stringify(expected, null, 2));
  assert.ok(readFileSync(file, "utf8").includes("\n"), "the fixture is pretty-printed");

  const loaded = new WorldStore(file, Date.UTC(2026, 9, 10));
  assert.deepEqual(loaded.state, expected, "the pretty-printed file loads unchanged");

  // Re-saving the same state in the new format keeps the content.
  await loaded.flush();
  assert.equal(readFileSync(file, "utf8").includes("\n"), false);
  assert.deepEqual(new WorldStore(file, Date.UTC(2026, 9, 10)).state, expected);
});

test("R5 format: compact saves are smaller than the pretty-printed form of the same state", async () => {
  const file = tempFile();
  const store = new WorldStore(file, Date.UTC(2026, 9, 10));
  await store.flush();
  const compactBytes = statSync(file).size;
  const prettyBytes = Buffer.byteLength(JSON.stringify(store.state, null, 2), "utf8");
  assert.ok(compactBytes < prettyBytes, `compact ${compactBytes} bytes should be below pretty ${prettyBytes} bytes`);
});
