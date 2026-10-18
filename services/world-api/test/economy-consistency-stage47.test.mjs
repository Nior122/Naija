// Economy consistency on the real socket path (Stage 47).
//
// The audit found three places where money moved without the cash ledger: the town bus fare and the clinic's basic
// care wrote `character.money` directly, so a later ledger sync (any market or bank action) silently reversed them.
// Market purchases also restored hunger only for a single unit, and a buyer could purchase a good sold at a location
// they were not standing in. These tests drive each route on every configured backend (file always; PostgreSQL when
// the live database is configured) and check the cash account, `character.money`, the ledger, and the saved world.
//
// Prices are unchanged by this stage: the bus fare is ₦150, basic care is ₦300, and the market prices are the catalogue's.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import { loadEconomyCatalog, validateEconomyCatalogForTest } from "../dist/economy/catalog.js";
import { chargeFixedFee, initializeEconomyWorldState } from "../dist/economy/service.js";

const CATALOG = loadEconomyCatalog();
const BREAD = CATALOG.market_goods.find((good) => good.id === "goods:bread");
const START_CASH = 10_000;
const BUS_FARE = 150;
const CLINIC_FEE = 300;
const TOWN_STOP = { x: 625, y: 495 };
const CLINIC_DESK = { x: 1080, y: 470 };
const SERVER_OPTIONS = { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } };

const opened = [];
before(connectBackends);
after(disconnectBackends);
afterEach(async () => {
  while (opened.length > 0) {
    const entry = opened.pop();
    for (const peer of entry.peers) peer.close();
    await entry.started.stop();
    await entry.backend.cleanup();
  }
});

async function session(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, SERVER_OPTIONS);
  const entry = { backend, started, peers: [] };
  opened.push(entry);
  return entry;
}

/** A real citizen over the socket, with a known cash balance saved before the test acts. */
async function citizen(entry, name) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = entry.backend.store.state.players[identity.playerId].character;
  const who = { peer, playerId: identity.playerId, sessionToken: identity.sessionToken, characterId: character.character_id };
  setCash(entry, who, START_CASH);
  character.money = START_CASH;
  await entry.backend.store.flush();
  return who;
}

const characterOf = (entry, who) => entry.backend.store.state.players[who.playerId].character;
const cashAccountOf = (entry, who) => Object.values(entry.backend.store.state.economyAccounts)
  .find((account) => account.character_id === who.characterId && account.kind === "cash");
const cashOf = (entry, who) => cashAccountOf(entry, who).balance_ngn;
const ledgerRows = (entry, kind) => Object.values(entry.backend.store.state.economyTransactions).filter((t) => t.kind === kind);

function setCash(entry, who, amount) {
  cashAccountOf(entry, who).balance_ngn = amount;
}

/** The reply to one request: a confirmed change, a duplicate, or a refusal, all carrying the same request ID. */
const REPLY = (requestId) => (message) => message.requestId === requestId && (
  message.type === "character.snapshot" || message.type === "command.duplicate"
  || message.type === "economy.result" || message.type === "economy.error" || message.type === "error"
  || message.type === "clinic.error" || message.type === "world.error" || message.type.endsWith(".error"));

async function send(who, message, requestId) {
  who.peer.send({ ...message, requestId });
  return who.peer.waitFor(REPLY(requestId), 20000);
}

const bus = (who, requestId) => send(who, { type: "world.bus" }, requestId);
const clinic = (who, requestId) => send(who, { type: "clinic.care" }, requestId);
const purchase = (who, requestId, goodId, quantity = 1, locationId = "market") =>
  send(who, { type: "economy.action", action: "purchase", payload: { good_id: goodId, quantity, location_id: locationId } }, requestId);

/** Places the character where the route expects it, and sets the stats the route reads. */
function place(entry, who, { location, position, hunger, health } = {}) {
  const character = characterOf(entry, who);
  if (location !== undefined) character.current_location = location;
  if (position !== undefined) character.position = { ...position };
  if (hunger !== undefined) character.hunger = hunger;
  if (health !== undefined) character.health = health;
}

/** A process restart over the same storage: the old server stops, then a new one reloads what was saved. */
async function restart(entry) {
  await entry.started.stop();
  await entry.backend.reopen();
  entry.started = await startOver(entry.backend, SERVER_OPTIONS);
}

async function resumed(entry, who) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  await resumeSession(peer, who.sessionToken);
  return { ...who, peer };
}

for (const backendName of backendNames) {
  const label = (text) => `${backendName}: ${text}`;

  test(label("the town bus fare is debited from the cash ledger, once, and recorded"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Commuter");
    place(entry, who, { location: "town", position: TOWN_STOP });
    const reply = await bus(who, "bus-1");
    assert.equal(reply.type, "character.snapshot", JSON.stringify(reply));
    assert.equal(cashOf(entry, who), START_CASH - BUS_FARE, "the cash account pays the fare");
    assert.equal(characterOf(entry, who).money, START_CASH - BUS_FARE, "character.money mirrors the ledger");
    const rows = ledgerRows(entry, "bus_fare");
    assert.equal(rows.length, 1, "one bus_fare row is posted");
    assert.equal(rows[0].amount_ngn, BUS_FARE);
    assert.equal(rows[0].account_id, cashAccountOf(entry, who).account_id);
    assert.equal(rows[0].counterparty_account_id, null, "no seller receives a fare (no operator is decided)");
  });

  test(label("basic clinic care is debited from the cash ledger, and still heals"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Patient");
    place(entry, who, { location: "clinic", position: CLINIC_DESK, health: 40 });
    const reply = await clinic(who, "clinic-1");
    assert.equal(reply.type, "character.snapshot", JSON.stringify(reply));
    assert.equal(cashOf(entry, who), START_CASH - CLINIC_FEE);
    assert.equal(characterOf(entry, who).money, START_CASH - CLINIC_FEE);
    assert.equal(characterOf(entry, who).health, 75);
    assert.equal(ledgerRows(entry, "clinic_payment").length, 1);
  });

  test(label("a later market purchase keeps the bus fare: the ledger and character.money agree"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Shopper");
    place(entry, who, { location: "town", position: TOWN_STOP });
    assert.equal((await bus(who, "bus-2")).type, "character.snapshot");
    place(entry, who, { location: "market" });
    const reply = await purchase(who, "buy-2", BREAD.id);
    assert.equal(reply.type, "economy.result", JSON.stringify(reply));
    const expected = START_CASH - BUS_FARE - BREAD.base_price_ngn;
    assert.equal(cashOf(entry, who), expected, "the fare is still paid after a later sync");
    assert.equal(characterOf(entry, who).money, expected);
  });

  test(label("a bus fare the citizen cannot pay is refused, and nothing moves"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Broke");
    setCash(entry, who, BUS_FARE - 1);
    characterOf(entry, who).money = BUS_FARE - 1;
    place(entry, who, { location: "town", position: TOWN_STOP });
    const reply = await bus(who, "bus-broke");
    assert.equal(reply.type, "error", JSON.stringify(reply));
    assert.equal(reply.code, "insufficient_funds");
    assert.equal(cashOf(entry, who), BUS_FARE - 1);
    assert.equal(characterOf(entry, who).money, BUS_FARE - 1);
    assert.equal(ledgerRows(entry, "bus_fare").length, 0);
  });

  test(label("a bus fare whose save fails is not confirmed, and its retry charges once"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Retry");
    place(entry, who, { location: "town", position: TOWN_STOP });
    entry.backend.store.failNextWrite("disk full");
    const first = await bus(who, "bus-save");
    assert.equal(first.type, "error", JSON.stringify(first));
    assert.equal(first.code, "bus_not_saved");
    const retry = await bus(who, "bus-save");
    assert.equal(retry.type, "character.snapshot", JSON.stringify(retry));
    assert.equal(cashOf(entry, who), START_CASH - BUS_FARE, "charged once, in the ledger");
    assert.equal(ledgerRows(entry, "bus_fare").length, 1);
  });

  test(label("a repeated bus request with the same request ID charges once"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Double");
    place(entry, who, { location: "town", position: TOWN_STOP });
    assert.equal((await bus(who, "bus-dup")).type, "character.snapshot");
    const again = await bus(who, "bus-dup");
    assert.equal(again.type, "command.duplicate", JSON.stringify(again));
    assert.equal(cashOf(entry, who), START_CASH - BUS_FARE);
    assert.equal(ledgerRows(entry, "bus_fare").length, 1);
  });

  test(label("the bus fare and the cash balance survive a restart"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Saved");
    place(entry, who, { location: "town", position: TOWN_STOP });
    assert.equal((await bus(who, "bus-restart")).type, "character.snapshot");
    await restart(entry);
    const back = await resumed(entry, who);
    assert.equal(cashOf(entry, back), START_CASH - BUS_FARE, "the saved ledger holds the fare");
    assert.equal(characterOf(entry, back).money, START_CASH - BUS_FARE, "the reloaded character agrees");
    assert.equal(ledgerRows(entry, "bus_fare").length, 1);
  });

  test(label("a market purchase of several units restores hunger for each unit"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Eater");
    place(entry, who, { location: "market", hunger: 40 });
    const reply = await purchase(who, "buy-two", BREAD.id, 2);
    assert.equal(reply.type, "economy.result", JSON.stringify(reply));
    assert.equal(cashOf(entry, who), START_CASH - 2 * BREAD.base_price_ngn);
    assert.equal(characterOf(entry, who).hunger, 40 + 2 * BREAD.hunger_restore,
      "every unit bought is eaten, not only a single unit");
  });

  test(label("a market purchase is refused when the buyer is not at that location"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Elsewhere");
    place(entry, who, { location: "town", position: TOWN_STOP, hunger: 40 });
    const reply = await purchase(who, "buy-remote", BREAD.id, 1, "market");
    assert.equal(reply.type, "economy.error", JSON.stringify(reply));
    assert.equal(reply.code, "economy_buyer_not_at_location");
    assert.equal(cashOf(entry, who), START_CASH, "nothing is charged");
    assert.equal(characterOf(entry, who).hunger, 40, "nothing is eaten");
    assert.equal(ledgerRows(entry, "market_purchase").length, 0);
  });

  test(label("a market sale and its seller account survive a restart"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Trader");
    place(entry, who, { location: "market" });
    const reply = await purchase(who, "buy-saved", BREAD.id, 3);
    assert.equal(reply.type, "economy.result", JSON.stringify(reply));
    const sellerBefore = Object.values(entry.backend.store.state.economyAccounts)
      .find((account) => account.character_id === "market-seller:idera-market")?.balance_ngn ?? null;
    assert.notEqual(sellerBefore, null, "the stall holder has a cash account after the sale");
    await restart(entry);
    const back = await resumed(entry, who);
    const seller = Object.values(entry.backend.store.state.economyAccounts)
      .find((account) => account.character_id === "market-seller:idera-market");
    assert.equal(seller.balance_ngn, sellerBefore, "the seller balance is saved");
    assert.equal(cashOf(entry, back), START_CASH - 3 * BREAD.base_price_ngn);
    assert.equal(ledgerRows(entry, "market_purchase").length, 1);
  });
  test(label("a market purchase whose save fails is not confirmed; its retry charges and feeds once"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Unsaved");
    place(entry, who, { location: "market", hunger: 40 });
    entry.backend.store.failNextWrite("disk full");
    const first = await purchase(who, "buy-unsaved", BREAD.id, 1);
    assert.equal(first.type, "economy.error", JSON.stringify(first));
    assert.equal(first.code, "economy_not_saved");
    const retry = await purchase(who, "buy-unsaved", BREAD.id, 1);
    assert.equal(retry.type, "economy.result", JSON.stringify(retry));
    assert.equal(cashOf(entry, who), START_CASH - BREAD.base_price_ngn, "charged once");
    assert.equal(characterOf(entry, who).money, START_CASH - BREAD.base_price_ngn);
    assert.equal(characterOf(entry, who).hunger, 40 + BREAD.hunger_restore, "eaten once");
    assert.equal(ledgerRows(entry, "market_purchase").length, 1, "one purchase row");
  });

  test(label("a repeated market purchase with the same request ID is a duplicate, not a second charge"), async () => {
    const entry = await session(backendName);
    const who = await citizen(entry, "Repeat");
    place(entry, who, { location: "market", hunger: 40 });
    assert.equal((await purchase(who, "buy-repeat", BREAD.id, 1)).type, "economy.result");
    const again = await purchase(who, "buy-repeat", BREAD.id, 1);
    assert.ok(again.type === "command.duplicate" || again.type === "economy.result", JSON.stringify(again));
    assert.equal(cashOf(entry, who), START_CASH - BREAD.base_price_ngn);
    assert.equal(characterOf(entry, who).hunger, 40 + BREAD.hunger_restore);
    assert.equal(ledgerRows(entry, "market_purchase").length, 1);
  });
}

// ─── Part A: service level (no socket) ────────────────────────────────────────


const DATE = { year: 2026, month: 10, day: 14 };
const NOW = Date.UTC(2026, 9, 14);
const BUS = CATALOG.fixed_charges.find((charge) => charge.id === "fixed:town-bus-stop-fare");
const CLINIC = CATALOG.fixed_charges.find((charge) => charge.id === "fixed:clinic-basic-care");

function serviceWorld(cash) {
  const state = {
    worldClock: { world_date: { ...DATE }, minute_of_day: 600 }, players: {}, people: {}, businesses: {},
    relationships: {}, marriages: {},
  };
  const characterId = "char-service";
  state.players["player-service"] = {
    playerId: "player-service",
    character: { character_id: characterId, name: "Service", life_status: "alive", age: 30, money: cash,
      date_of_birth: { year: 1996, month: 1, day: 1 } },
  };
  initializeEconomyWorldState(state, NOW);
  const cashAccount = Object.values(state.economyAccounts).find((account) => account.character_id === characterId && account.kind === "cash");
  cashAccount.balance_ngn = cash;
  state.players["player-service"].character.money = cash;
  return { state, characterId, cashAccount };
}

test("Stage 47 service: a fixed fee the citizen cannot pay is refused and nothing else changes", () => {
  const { state, characterId } = serviceWorld(BUS.amount_ngn - 1);
  const before = JSON.stringify(state);
  assert.throws(() => chargeFixedFee(state, characterId, BUS, DATE, 600, NOW, CATALOG), /economy_insufficient_funds/);
  assert.equal(JSON.stringify(state), before, "a refused fee leaves the world exactly as it was");
});

test("Stage 47 service: a fixed fee is posted once to the cash ledger, with no receiving account", () => {
  const { state, characterId, cashAccount } = serviceWorld(5_000);
  const tx = chargeFixedFee(state, characterId, CLINIC, DATE, 600, NOW, CATALOG);
  assert.equal(tx.kind, "clinic_payment");
  assert.equal(tx.amount_ngn, CLINIC.amount_ngn);
  assert.equal(tx.balance_before_ngn, 5_000);
  assert.equal(tx.balance_after_ngn, 5_000 - CLINIC.amount_ngn);
  assert.equal(tx.counterparty_account_id, null);
  assert.equal(cashAccount.balance_ngn, 5_000 - CLINIC.amount_ngn);
  assert.equal(state.players["player-service"].character.money, 5_000 - CLINIC.amount_ngn, "character.money follows the ledger");
  assert.equal(Object.values(state.economyTransactions).filter((row) => row.kind === "clinic_payment").length, 1);
});

test("Stage 47 catalogue: the shelf and fixed-fee prices are the values the engine already charged", () => {
  const price = (id) => CATALOG.shelf_items.find((item) => item.id === id)?.price_ngn;
  assert.equal(price("meat_pie"), 350);
  assert.equal(price("bottled_water"), 100);
  assert.equal(BUS.amount_ngn, 150);
  assert.equal(CLINIC.amount_ngn, 300);
  assert.equal(BUS.kind, "bus_fare");
  assert.equal(CLINIC.kind, "clinic_payment");
});

test("Stage 47 catalogue: a shelf item or fixed fee with an invalid value is refused at load", () => {
  const base = () => structuredClone(CATALOG);
  const cheat = base();
  cheat.shelf_items[0].price_ngn = 0;
  assert.throws(() => validateEconomyCatalogForTest(cheat), /shelf item meat_pie has invalid configuration/);
  const kind = base();
  kind.fixed_charges[0].kind = "tax";
  assert.throws(() => validateEconomyCatalogForTest(kind), /fixed charge .* has invalid configuration/);
  const missing = base();
  delete missing.shelf_items;
  assert.throws(() => validateEconomyCatalogForTest(missing), /incomplete or has an unsupported schema/);
  const duplicate = base();
  duplicate.fixed_charges.push({ ...duplicate.fixed_charges[0] });
  assert.throws(() => validateEconomyCatalogForTest(duplicate), /duplicate ID/);
});
