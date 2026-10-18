// The one-time treasury allocation under retry, restart, and reconciliation (Stage 35).
//
// The catalogue's treasury_funding rules are the ₦100,000,000 initial allocation. applyInitialTreasuryFunding writes one
// revenue row per rule, marked with funding_rule_id and source_reference `treasury-funding:<rule_id>`, and skips a rule
// whose row already exists. These socket tests check that the rows stay exactly as first written, across repeated
// application, a restart, a definite save failure followed by a retry, and a save that committed but lost its reply.
//
// Both backends run the same assertions. The file backend is single-process; the PostgreSQL backend needs
// NAIJA_ALLOW_DB_TESTS and DATABASE_URL, as the other PostgreSQL tests do.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends } from "./support/creation-backends.mjs";
import { propertyContent } from "./support/property-world.mjs";
import { fundingRows, inWorld, live, market, player, purchase, restart, saleFor, settle, stored } from "./support/property-socket.mjs";
import { loadGovernmentCatalog } from "../dist/government/catalog.js";
import { applyInitialTreasuryFunding } from "../dist/government/service.js";

const CATALOG = loadGovernmentCatalog();
const EXPECTED_ROWS = CATALOG.treasury_funding.map((rule) => `${rule.rule_id}:${rule.amount_ngn}`).sort();

before(async () => {
  await connectBackends();
});

after(async () => {
  await disconnectBackends();
});

/**
 * The allocation is written when a player joins (reconcileGovernmentStructure runs on the join path), not when the world
 * is created or loaded. So each test opens a world, has one founder join, and then checks the rows.
 */
function founded(backendName, body) {
  return inWorld(backendName, async (world) => {
    await player(world, "Founder", 0);
    await body(world);
  });
}

function allocationRows(state) {
  return Object.values(state.governmentRevenue ?? {})
    .filter((row) => row.funding_rule_id)
    .map((row) => ({ id: row.revenue_id, rule: row.funding_rule_id, amount: row.amount_ngn, ref: row.source_reference }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A player who owns one flat, and a changing request that will be sent after faults are armed. */
async function ownerWorld(world) {
  const owner = await player(world, "Owner", 50_000_000);
  const listings = await market(owner.peer);
  const sale = saleFor(listings, live(world));
  purchase(owner.peer, "buy-1", sale.listing_id);
  const reply = await settle(owner.peer, "buy-1");
  assert.equal(reply.type, "property.result", JSON.stringify(reply));
  return { owner, property_id: sale.property_id };
}

for (const backendName of backendNames) {
  test(`${backendName}: the allocation is exactly the catalogue rules (₦100,000,000 in total), one row each`, () => founded(backendName, async (world) => {
    const total = CATALOG.treasury_funding.reduce((sum, rule) => sum + rule.amount_ngn, 0);
    assert.equal(total, 100_000_000, "the catalogue allocation is ₦100,000,000");
    assert.deepEqual(fundingRows(live(world)).sort(), EXPECTED_ROWS);
    assert.equal(allocationRows(live(world)).reduce((sum, row) => sum + row.amount, 0), total);
  }));

  test(`${backendName}: applying the allocation again changes no row, in memory or in storage`, () => founded(backendName, async (world) => {
    const before = JSON.stringify(allocationRows(live(world)));
    const storedBefore = JSON.stringify(allocationRows(await stored(world)));
    for (let i = 0; i < 3; i += 1) {
      assert.equal(applyInitialTreasuryFunding(live(world), world.backend.store.state.worldClock.world_date, Date.now(), CATALOG), 0);
    }
    assert.equal(JSON.stringify(allocationRows(live(world))), before, "live rows unchanged");
    assert.equal(JSON.stringify(allocationRows(await stored(world))), storedBefore, "stored rows unchanged");
  }));

  test(`${backendName}: a restart keeps the same allocation rows and funds nothing new`, () => founded(backendName, async (world) => {
    const before = JSON.stringify(allocationRows(live(world)));
    await restart(world);
    assert.equal(JSON.stringify(allocationRows(live(world))), before, "rows after restart");
    assert.equal(JSON.stringify(allocationRows(await stored(world))), before, "stored rows after restart");
    assert.deepEqual(fundingRows(live(world)).sort(), EXPECTED_ROWS);
  }));

  test(`${backendName}: a save that fails definitely, then a retry, leaves the allocation unchanged and not duplicated`, () => founded(backendName, async (world) => {
    const { owner, property_id: propertyId } = await ownerWorld(world);
    const before = JSON.stringify(allocationRows(live(world)));

    world.backend.store.failNextWrite("disk full");
    owner.peer.send({ type: "property.action", action: "list_for_sale", requestId: "list-fail", payload: { property_id: propertyId, asking_price_ngn: 5_000_000 } });
    const failed = await settle(owner.peer, "list-fail");
    assert.equal(failed.code, "property_not_saved", JSON.stringify(failed));
    assert.equal(JSON.stringify(allocationRows(live(world))), before, "live rows unchanged after the failed save");
    assert.equal(applyInitialTreasuryFunding(live(world), world.backend.store.state.worldClock.world_date, Date.now(), CATALOG), 0);

    owner.peer.send({ type: "property.action", action: "list_for_sale", requestId: "list-fail", payload: { property_id: propertyId, asking_price_ngn: 5_000_000 } });
    const retried = await settle(owner.peer, "list-fail");
    assert.equal(retried.type, "property.result", JSON.stringify(retried));
    assert.equal(JSON.stringify(allocationRows(live(world))), before, "live rows unchanged after the retry");
    assert.equal(JSON.stringify(allocationRows(await stored(world))), before, "stored rows unchanged after the retry");

    await restart(world);
    assert.equal(JSON.stringify(allocationRows(live(world))), before, "rows after restart");
    assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live after restart");
  }));

  test(`${backendName}: a save that committed but lost its reply does not duplicate the allocation after restart`, () => founded(backendName, async (world) => {
    const { owner, property_id: propertyId } = await ownerWorld(world);
    const before = JSON.stringify(allocationRows(live(world)));

    world.backend.store.failNextWriteAfterCommit("reply lost");
    owner.peer.send({ type: "property.action", action: "list_for_sale", requestId: "list-lost", payload: { property_id: propertyId, asking_price_ngn: 5_000_000 } });
    const unknown = await settle(owner.peer, "list-lost");
    assert.equal(unknown.code, "property_outcome_unknown", JSON.stringify(unknown));

    await restart(world);
    assert.equal(JSON.stringify(allocationRows(live(world))), before, "rows after restart");
    assert.equal(JSON.stringify(allocationRows(await stored(world))), before, "stored rows after restart");
    assert.deepEqual(fundingRows(live(world)).sort(), EXPECTED_ROWS);
  }));
}
