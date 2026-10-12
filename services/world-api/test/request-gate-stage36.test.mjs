/**
 * Stage 36 request gate: the two cases not covered elsewhere.
 *   - a legacy request ID (recorded before Stage 36, so it has no fingerprint) is answered as a duplicate, never applied;
 *   - a request ID reused for a different command is refused, even when the body is the same.
 * Other gate cases are covered by existing tests: a reused ID with a different payload (economy-money-durability and
 * property-actions-stage35), the same ID sent twice at once (economy-money-durability), a pending reply that waits for
 * its save (mutation-ordering), and durable-only and cross-process cases (cross-process-requests-stage36).
 * Live PostgreSQL only: the test is skipped, with its reason, when DATABASE_URL and NAIJA_ALLOW_DB_TESTS are not set.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { database } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { live, openWorld, player } from "./support/property-socket.mjs";
import { openPeer, resumeSession } from "./support/harness.mjs";

const LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
const live_ = { skip: !LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false };

if (LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

const worlds = [];
const peers = [];

before(async () => {
  if (!LIVE) return;
  await database.connect();
  await new MigrationManager(database).migrate();
});

after(async () => {
  if (!LIVE) return;
  for (const peer of peers) await peer.close().catch(() => undefined);
  for (const world of worlds) {
    await world.started.stop().catch(() => undefined);
    await world.backend.cleanup();
  }
  await database.disconnect();
});

test("Stage 36 gate: a legacy request ID with no fingerprint is answered as a duplicate and is not applied", live_, async () => {
  const world = await openWorld("postgres");
  worlds.push(world);
  const owner = await player(world, "Legacy", 1_000_000);
  const state = live(world).players[owner.playerId];
  state.character.current_location = "home";
  state.character.position = { x: 440, y: 350 };
  state.character.energy = 40;
  // A request recorded before Stage 36: the ID is known, and there is no record with a fingerprint.
  state.recentRequestIds.push("legacy-1");
  const records = (state.recentRequestRecords ?? []).length;

  const energyBefore = state.character.energy;
  owner.peer.send({ type: "character.rest", requestId: "legacy-1" });
  const reply = await owner.peer.waitFor((message) => message.requestId === "legacy-1" && (message.type === "command.duplicate" || message.type === "error"), 20_000);
  assert.equal(reply.type, "command.duplicate", JSON.stringify(reply));
  assert.equal(live(world).players[owner.playerId].character.energy, energyBefore, "the legacy request is not applied again");
  assert.equal((live(world).players[owner.playerId].recentRequestRecords ?? []).length, records, "no record is added for a legacy ID");
});

test("Stage 36 gate: a request ID reused for a different command is refused, even with the same body", live_, async () => {
  const world = await openWorld("postgres");
  worlds.push(world);
  const owner = await player(world, "Reuse", 1_000_000);
  const state = live(world).players[owner.playerId];
  state.character.current_location = "home";
  state.character.position = { x: 440, y: 350 };
  state.character.energy = 40;
  await world.backend.store.flush();

  // character.rest with the ID applies once.
  owner.peer.send({ type: "character.rest", requestId: "shared-1" });
  const applied = await owner.peer.waitFor((message) => message.requestId === "shared-1" && (message.type === "character.snapshot" || message.type === "error"), 20_000);
  assert.equal(applied.type, "character.snapshot", JSON.stringify(applied));
  const energyAfterRest = live(world).players[owner.playerId].character.energy;
  assert.ok(energyAfterRest > 40, "the rest was applied");

  // The same ID, sent as a different command (clinic.care), is refused and changes nothing.
  owner.peer.send({ type: "clinic.care", requestId: "shared-1" });
  const reused = await owner.peer.waitFor((message) => message.requestId === "shared-1" && (message.type === "error" || message.type === "command.duplicate"), 20_000);
  assert.equal(reused.code, "request_id_reused", JSON.stringify(reused));
  assert.equal(live(world).players[owner.playerId].character.energy, energyAfterRest, "nothing changed");
});
