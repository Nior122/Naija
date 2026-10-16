// The initial funding with two writers on one PostgreSQL world (Stage 33).
//
// Each writer is its own PostgresWorldStore instance with its own copy of the world, loaded at the same version. Both
// set up the government structure and apply the catalogue funding in memory. The version check must let exactly one
// of them save, so the funding is saved once and no restart adds it again. Two writers on treasury payments are in
// government-treasury-payments.test.mjs, where the citizens they need are created over the socket.
//
// These run only on a disposable PostgreSQL database (DATABASE_URL with a name containing "test", and
// NAIJA_ALLOW_DB_TESTS=true). Without them the test is reported as skipped, not as passed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { database } from "../dist/database/connection.js";
import { PostgresWorldStore, WorldStateConflictError } from "../dist/database/world-store.js";
import { loadGovernmentCatalog } from "../dist/government/catalog.js";
import { applyInitialTreasuryFunding, reconcileGovernmentStructure } from "../dist/government/service.js";
import { saveOutcomeOf } from "../dist/persistence-status.js";
import { connectBackends, disconnectBackends, PG_LIVE } from "./support/creation-backends.mjs";

const live = { skip: !PG_LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false, timeout: 120_000 };
const CATALOG = loadGovernmentCatalog();
const FINANCE = "gov:min:finance";
const FUNDING = CATALOG.treasury_funding[0];
const NOW = Date.now();

const worldKeys = [];
before(connectBackends);
after(async () => {
  for (const key of worldKeys) await database.query("DELETE FROM world_state WHERE key = $1", [key]);
  await disconnectBackends();
});

async function freshWorldKey() {
  const key = `treasury-funding-${randomUUID()}`;
  worldKeys.push(key);
  return key;
}

async function savedWorld(worldKey) {
  const row = await database.queryOne("SELECT value FROM world_state WHERE key = $1", [worldKey]);
  return row.value;
}

/** A test that runs only against the disposable database (see `live`). */
function liveTest(name, fn) {
  return test(name, live, fn);
}

liveTest("two writers: the initial funding is saved once, even though both writers applied it in memory", async () => {
  const worldKey = await freshWorldKey();
  const first = await PostgresWorldStore.open({ db: database, worldKey });
  const second = await PostgresWorldStore.open({ db: database, worldKey });
  const date = first.state.worldClock.world_date;
  const fundingRows = (state) => Object.values(state.governmentRevenue ?? {}).filter((r) => r.funding_rule_id === FUNDING.rule_id).length;
  assert.equal(Object.keys(first.state.governmentOrganisations ?? {}).length, 0, "premise: a new world has no government structure");

  // The first reconciliation of an empty world seeds the structure and applies the catalogue funding, in memory.
  // Both writers do this on their own copy.
  reconcileGovernmentStructure(first.state, date, NOW, CATALOG);
  reconcileGovernmentStructure(second.state, date, NOW, CATALOG);
  assert.equal(fundingRows(first.state), 1, "premise: the first writer funds once in memory");
  assert.equal(fundingRows(second.state), 1, "premise: the second writer funds once in memory");

  await first.flush();
  const refused = await second.flush().then(() => null, (error) => error);
  assert.ok(refused instanceof WorldStateConflictError, "the second writer's funding is refused");
  assert.equal(saveOutcomeOf(refused), "not_saved");

  const durable = await savedWorld(worldKey);
  assert.equal(Object.values(durable.governmentRevenue).filter((r) => r.funding_rule_id === FUNDING.rule_id).length, 1,
    "the saved world has one funding row");
  assert.equal(durable.governmentOrganisations[FINANCE].treasury_account.balance_ngn, FUNDING.amount_ngn, "funded once");

  // A later process, and a reconciliation in it, add nothing.
  const restarted = await PostgresWorldStore.open({ db: database, worldKey });
  assert.equal(applyInitialTreasuryFunding(restarted.state, date, NOW, CATALOG), 0);
  assert.equal(reconcileGovernmentStructure(restarted.state, date, NOW, CATALOG), 0);
  assert.equal(restarted.state.governmentOrganisations[FINANCE].treasury_account.balance_ngn, FUNDING.amount_ngn);
  assert.equal(fundingRows(restarted.state), 1);
});
