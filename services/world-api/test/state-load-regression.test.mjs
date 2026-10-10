import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { validateState, WorldStore } from "../dist/multiplayer/persistence.js";
import { createIdentity, openPeer, startApi, stopApi } from "./support/harness.mjs";

/**
 * Offline regression test for the world-state loader (no database).
 */

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

test("State load (offline regression): economy data survives repeated loads of a saved world", async () => {
  // Before the fix, schema-18 loads discarded career, economy, business, property, government,
  // election and justice maps and regenerated them with new random IDs on every load.
  const dir = mkdtempSync(join(tmpdir(), "naija-load-"));
  dirs.push(dir);
  const jsonPath = join(dir, "world-state.json");
  const store = new WorldStore(jsonPath);
  const instance = await startApi({ worldStore: store, allowedOrigins: [] });
  try {
    const peer = await openPeer(instance.websocketUrl);
    await createIdentity(peer, "Load Regression");
    await peer.close();
  } finally {
    await stopApi(instance.server);
  }
  const saved = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(saved.schemaVersion, 18);
  assert.ok(Object.keys(saved.economyTransactions).length >= 1, "the engine must have recorded an economy transaction");

  const now = Date.now();
  const first = validateState(JSON.parse(JSON.stringify(saved)), now);
  const second = validateState(JSON.parse(JSON.stringify(first)), now);
  const third = validateState(JSON.parse(JSON.stringify(second)), now);
  assert.deepEqual(Object.keys(first.economyTransactions), Object.keys(saved.economyTransactions));
  assert.equal(canonicalJson(second), canonicalJson(third), "repeated loads must be stable");
  assert.equal(canonicalJson(first.economyAccounts), canonicalJson(saved.economyAccounts));
  assert.equal(canonicalJson(first.economyTransactions), canonicalJson(saved.economyTransactions));
});
