import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { validateState, WorldStore } from "../dist/multiplayer/persistence.js";
import { createBusiness, initializeBusinessWorldState } from "../dist/businesses/service.js";
import { loadBusinessCatalog } from "../dist/businesses/catalog.js";
import { createPoliticalParty, registerPoliticalParty, createElection, initializeElectionWorldState } from "../dist/elections/service.js";
import { loadElectionsCatalog } from "../dist/elections/catalog.js";
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

test("State load (offline regression): business, party and election records survive schema-18 loads and are validated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "naija-load-"));
  dirs.push(dir);
  const jsonPath = join(dir, "world-state.json");
  const store = new WorldStore(jsonPath);
  const instance = await startApi({ worldStore: store, allowedOrigins: [] });
  try {
    const peer = await openPeer(instance.websocketUrl);
    await createIdentity(peer, "Business Regression");
    await peer.close();
  } finally {
    await stopApi(instance.server);
  }
  const saved = JSON.parse(readFileSync(jsonPath, "utf8"));
  const now = Date.now();
  const state = validateState(JSON.parse(JSON.stringify(saved)), now);
  const characterId = Object.values(state.players)[0].character.character_id;

  // Test fixture: the saved character is too young to found a business or party. Raise the age and
  // fund the cash account in this in-memory copy only. The records are then created by the real services.
  Object.values(state.players)[0].character.age = 35;
  for (const account of Object.values(state.economyAccounts)) {
    if (account.kind === "cash" && account.character_id === characterId) account.balance_ngn = 100000000;
  }
  initializeBusinessWorldState(state);
  initializeElectionWorldState(state);
  const date = state.worldClock.world_date;
  const business = createBusiness(state, characterId, "template:provision-store", "Regression Shop", "Regression business.", "market", 0, date, 480, now, loadBusinessCatalog());
  const electionsCatalog = loadElectionsCatalog();
  const party = createPoliticalParty(state, "Regression Party", "RP", "Regression party.", characterId, [], date, now, electionsCatalog);
  registerPoliticalParty(state, party.party_id, characterId, date, now);
  const election = createElection(state, "presidential", null, null, characterId,
    "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", "2025-02-02T00:00:00Z",
    "2025-04-01T00:00:00Z", "2025-04-02T00:00:00Z", "2025-04-15T00:00:00Z", date, now);

  const reloaded = validateState(JSON.parse(JSON.stringify(state)), now);
  assert.ok(reloaded.businesses[business.business_id], "business record must survive a load");
  assert.ok(reloaded.politicalParties[party.party_id], "party record must survive a load");
  assert.ok(reloaded.elections[election.election_id], "election record must survive a load");
  assert.equal(canonicalJson(reloaded.businesses), canonicalJson(JSON.parse(JSON.stringify(state.businesses))));

  // Schema 18 must run the Stage 8 business validator. Before the fix, this corrupt record passed.
  const corrupt = JSON.parse(JSON.stringify(state));
  corrupt.businesses[business.business_id] = { invalid: true };
  assert.throws(() => validateState(corrupt, now), /invalid Stage 8 business record/);
});

