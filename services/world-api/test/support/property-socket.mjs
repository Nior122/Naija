// Socket-level helpers for the Stage 35 property tests. Every world is disposable: a backend (file or PostgreSQL), a
// started server, and players whose sockets are tracked so that a test can close them all. Test-side setup (cash
// balances, birth dates) is written to the disposable world's state and flushed, before the socket requests run.
import assert from "node:assert/strict";
import { openBackend, openPeerFrom, startOver } from "./creation-backends.mjs";
import { createIdentity, resumeSession } from "./harness.mjs";
import { cashAccountOf } from "./property-world.mjs";

export const STARTUP = { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } };

export async function openWorld(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, STARTUP);
  return { backend, started, peers: [] };
}

/** Creates a player with an adult age and a cash balance (test-side setup in memory, then flushed to storage). */
export async function player(world, name, balance) {
  const peer = await openPeerFrom(world.started.websocketUrl, "127.0.0.1");
  world.peers.push(peer);
  const identity = await createIdentity(peer, name);
  assert.equal((await resumeSession(peer, identity.sessionToken)).type, "session.ready");
  const character = world.backend.store.state.players[identity.playerId].character;
  // The engine derives age from date_of_birth on each world-date change, so the birth date is set too.
  const worldYear = world.backend.store.state.worldClock.world_date.year;
  character.date_of_birth = { year: worldYear - 30, month: 6, day: 15 };
  character.age = 30;
  const account = cashAccountOf(world.backend.store.state, character.character_id);
  account.balance_ngn = balance;
  account.total_deposited_ngn = balance;
  await world.backend.store.flush();
  return { peer, identity, playerId: identity.playerId, characterId: character.character_id, sessionToken: identity.sessionToken };
}

/** Sets a player's cash balance in the disposable world (test-side setup, flushed). */
export async function setCash(world, characterId, amount) {
  const account = cashAccountOf(world.backend.store.state, characterId);
  account.balance_ngn = amount;
  await world.backend.store.flush();
}

export const live = (world) => world.backend.store.state;
export const stored = async (world) => world.backend.durableState();

/** The first property reply for this request ID: a result, an error, or a duplicate notice. */
export function settle(peer, requestId) {
  return peer.waitFor((message) => message.requestId === requestId &&
    (message.type === "property.result" || message.type === "property.error" || message.type === "command.duplicate"), 5000);
}

/** Waits for a property error with this code (for refusals that carry no request ID, or whose ID is not matched). */
export function refusal(peer, code) {
  return peer.waitFor((message) => message.type === "property.error" && message.code === code, 5000);
}

export async function market(peer) {
  peer.send({ type: "property.action", action: "market", requestId: `market-${Math.random()}` });
  const reply = await peer.waitFor((message) => message.type === "property.result" || message.type === "property.error", 5000);
  assert.equal(reply.type, "property.result", JSON.stringify(reply));
  return reply.data.market.listings;
}

export function saleFor(listings, state) {
  const sale = listings
    .filter((listing) => listing.listing_type === "sale" && !state.properties[listing.property_id].is_land)
    .sort((a, b) => a.asking_price_ngn - b.asking_price_ngn)[0];
  assert.ok(sale, "premise: the seeded world has a non-land sale listing");
  return sale;
}

/** The open listing of one property of one type ("sale" or "rent"). */
export function listingFor(listings, propertyId, type) {
  const listing = listings.find((item) => item.property_id === propertyId && item.listing_type === type);
  assert.ok(listing, `premise: an open ${type} listing for ${propertyId}`);
  return listing;
}

/** Funding rows written once by the treasury rules. They must not be recreated by a restart or a retry. */
export function fundingRows(state) {
  return Object.values(state.governmentRevenue ?? {})
    .filter((row) => row.funding_rule_id)
    .map((row) => `${row.funding_rule_id}:${row.amount_ngn}`)
    .sort();
}

export function purchase(peer, requestId, listingId) {
  peer.send({ type: "property.action", action: "purchase", requestId, payload: { listing_id: listingId } });
}

/** Stops the running server, reopens the storage, and starts a fresh server over it (a process restart). */
export async function restart(world) {
  await world.started.stop();
  await world.backend.reopen();
  const started = await startOver(world.backend, STARTUP);
  world.started = started;
  return { started };
}

/** A new socket on a restarted server, with the same session resumed. */
export async function resumed(restarted, sessionToken) {
  const peer = await openPeerFrom(restarted.started.websocketUrl, "127.0.0.1");
  assert.equal((await resumeSession(peer, sessionToken)).type, "session.ready");
  return peer;
}

/** Runs one test body in its own disposable world, and always closes the sockets, stops the server, and cleans up. */
export async function inWorld(backendName, body) {
  const world = await openWorld(backendName);
  try {
    await body(world);
  } finally {
    for (const peer of world.peers) await peer.close().catch(() => undefined);
    await world.started.stop().catch(() => undefined);
    await world.backend.cleanup();
  }
}
