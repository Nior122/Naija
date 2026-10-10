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

test("R5 format: an explicitly compact save is compact JSON and reloads to an equal state", async () => {
  const file = tempFile();
  const store = new WorldStore(file, Date.UTC(2026, 9, 10), { format: "compact" });
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

  // Re-saving with the compact format keeps the content.
  const compact = new WorldStore(file, Date.UTC(2026, 9, 10), { format: "compact" });
  await compact.flush();
  assert.equal(readFileSync(file, "utf8").includes("\n"), false);
  assert.deepEqual(new WorldStore(file, Date.UTC(2026, 9, 10)).state, expected);
});

test("R5 format: compact saves are smaller than the pretty-printed form of the same state", async () => {
  const file = tempFile();
  const store = new WorldStore(file, Date.UTC(2026, 9, 10), { format: "compact" });
  await store.flush();
  const compactBytes = statSync(file).size;
  const prettyBytes = Buffer.byteLength(JSON.stringify(store.state, null, 2), "utf8");
  assert.ok(compactBytes < prettyBytes, `compact ${compactBytes} bytes should be below pretty ${prettyBytes} bytes`);
});

/*
 * Rollout guard (Decision 1, Stage 28). Compact output is opt-in. The default keeps writing the pretty-printed
 * format, so loading and saving an existing file does not convert it until an operator enables compact output
 * after the saved-world validation has been approved (docs/STAGE_28_COMPACT_JSON_ROLLOUT.md).
 */

test("R5 rollout guard: by default a save keeps the pretty-printed format, so an existing file is not converted", async () => {
  const file = tempFile();
  const seeded = new WorldStore(file, Date.UTC(2026, 9, 10));
  const state = structuredClone(seeded.state);
  writeFileSync(file, JSON.stringify(state, null, 2));
  const before = readFileSync(file);

  const loaded = new WorldStore(file, Date.UTC(2026, 9, 10));
  await loaded.flush();
  const after = readFileSync(file);
  assert.equal(after.toString("utf8"), JSON.stringify(loaded.state, null, 2), "the default save writes pretty-printed JSON");
  assert.ok(after.includes(Buffer.from("\n")), "the file still has line breaks after a default save");
  assert.deepEqual(JSON.parse(after.toString("utf8")), JSON.parse(before.toString("utf8")), "the content is unchanged");
});

test("R5 rollout guard: compact output is written only when the format is explicitly set", async () => {
  const file = tempFile();
  const pretty = new WorldStore(file, Date.UTC(2026, 9, 10));
  await pretty.flush();
  assert.ok(readFileSync(file, "utf8").includes("\n"), "the default writes pretty-printed JSON");

  const compact = new WorldStore(file, Date.UTC(2026, 9, 10), { format: "compact" });
  await compact.flush();
  assert.equal(readFileSync(file, "utf8").includes("\n"), false, "the explicit compact format writes compact JSON");
});

test("R5 rollout guard: an unknown format is rejected when the store is created", () => {
  assert.throws(() => new WorldStore(tempFile(), Date.UTC(2026, 9, 10), { format: "yaml" }), /format must be/);
});
