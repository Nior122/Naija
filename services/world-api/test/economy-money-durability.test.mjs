// Money durability for economy actions (Stage 34).
//
// Part A calls the economy services on an in-memory state. Every refusal is checked against a full snapshot of the
// world: a refused money action must leave no trace. This includes the daily withdrawal total, which used to be reset
// before a later check could refuse the withdrawal.
//
// Part B drives the real socket path on every configured backend (file always; PostgreSQL when the live database is
// configured). It injects persistence failures through FaultyStore: a failed save, a lost reply, a crash and restart,
// concurrent requests, a held save, and a fenced writer. The rules under test:
//   - "economy.result" is sent only after the change is saved;
//   - a save that is known to have failed is "economy_not_saved", and a save that may have committed is
//     "economy_outcome_unknown";
//   - a retry with the same request ID never applies the change twice, and replays the first result when it can;
//   - while saving is failing, or this writer is fenced, a new money change is refused before it changes anything.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import { waitUntil } from "./support/faulty-store.mjs";
import {
  depositToAccount,
  processEconomyWorldDate,
  initializeEconomyWorldState,
  openEconomyAccount,
  transferBetweenAccounts,
  withdrawFromAccount,
} from "../dist/economy/service.js";
import { loadEconomyCatalog } from "../dist/economy/catalog.js";

const CATALOG = loadEconomyCatalog();
const DATE = { year: 2026, month: 10, day: 11 };
const YESTERDAY = { year: 2026, month: 10, day: 10 };
const NOW = Date.UTC(2026, 9, 11);
const RULES = CATALOG.rules;
const CURRENT = "bank-product:current";

// ─── Part A: service level ────────────────────────────────────────────────────

function makeState() {
  const state = {
    worldClock: { world_date: { ...DATE }, minute_of_day: 600 }, players: {}, people: {}, businesses: {},
    relationships: {}, marriages: {},
  };
  return state;
}

/** A living citizen with a cash account, created by the economy as in a real world. */
function addCitizen(state, name, { age = 40 } = {}) {
  const characterId = `char-${name.toLowerCase()}`;
  const character = { character_id: characterId, name, life_status: "alive", age, money: 0 };
  character.date_of_birth = { year: DATE.year - age, month: 1, day: 1 };
  state.players[`player-${characterId}`] = { playerId: `player-${characterId}`, character };
  initializeEconomyWorldState(state, NOW);
  return characterId;
}

const cashOf = (state, characterId) =>
  Object.values(state.economyAccounts).find((a) => a.character_id === characterId && a.kind === "cash");
const snapshot = (state) => JSON.stringify(state);

function assertRefusedWithoutChange(state, action, pattern) {
  const before = snapshot(state);
  assert.throws(action, pattern);
  assert.equal(snapshot(state), before, "a refused action leaves the world exactly as it was");
}

test("economy service: a withdrawal refused by a later check leaves the daily total untouched", () => {
  const state = makeState();
  const characterId = addCitizen(state, "Refused");
  const account = openEconomyAccount(state, characterId, CURRENT, 0, DATE, 600, NOW, CATALOG);
  // Last withdrawal was on an earlier world day: the total would reset, but the cash balance limit refuses the withdrawal.
  state.economyAccounts[account.account_id].daily_withdrawal_date = { ...YESTERDAY };
  state.economyAccounts[account.account_id].daily_withdrawal_total_ngn = 400_000;
  state.economyAccounts[account.account_id].balance_ngn = 50_000;
  cashOf(state, characterId).balance_ngn = RULES.maximum_account_balance_ngn - 50;
  assertRefusedWithoutChange(state, () => withdrawFromAccount(state, characterId, account.account_id, 100, DATE, 600, NOW, CATALOG),
    /economy_balance_limit_exceeded/);
  assert.equal(state.economyAccounts[account.account_id].daily_withdrawal_total_ngn, 400_000);
  assert.deepEqual(state.economyAccounts[account.account_id].daily_withdrawal_date, YESTERDAY);
});

test("economy service: the daily limit holds within a world day, and a new day starts a fresh total", () => {
  const state = makeState();
  const characterId = addCitizen(state, "Daily");
  const account = openEconomyAccount(state, characterId, CURRENT, 0, DATE, 600, NOW, CATALOG);
  const record = state.economyAccounts[account.account_id];
  record.balance_ngn = 5_000_000;
  const limit = CATALOG.bank_products.find((p) => p.id === CURRENT).max_withdrawal_daily_ngn ?? RULES.maximum_transaction_amount_ngn;

  record.daily_withdrawal_date = { ...DATE };
  record.daily_withdrawal_total_ngn = limit;
  assertRefusedWithoutChange(state, () => withdrawFromAccount(state, characterId, account.account_id, 1, DATE, 600, NOW, CATALOG),
    /economy_daily_withdrawal_limit/);

  record.daily_withdrawal_date = { ...YESTERDAY };
  const tx = withdrawFromAccount(state, characterId, account.account_id, 100, DATE, 600, NOW, CATALOG);
  assert.equal(tx.amount_ngn, 100);
  assert.equal(record.daily_withdrawal_total_ngn, 100, "a new world day starts a fresh total");
  assert.deepEqual(record.daily_withdrawal_date, DATE);
});

test("economy service: a deposit, transfer, or withdrawal that fails validation changes nothing", () => {
  const state = makeState();
  const characterId = addCitizen(state, "Checked");
  const account = openEconomyAccount(state, characterId, CURRENT, 0, DATE, 600, NOW, CATALOG);
  cashOf(state, characterId).balance_ngn = 100_000;
  const second = openEconomyAccount(state, characterId, "bank-product:savings", 1000, DATE, 600, NOW, CATALOG);
  cashOf(state, characterId).balance_ngn = 10_000;
  assertRefusedWithoutChange(state, () => depositToAccount(state, characterId, account.account_id, 999_999_999, DATE, 600, NOW, CATALOG),
    /economy_deposit_amount_invalid|economy_insufficient_funds|economy_balance_limit_exceeded/);
  assertRefusedWithoutChange(state, () => depositToAccount(state, characterId, account.account_id, 50_000, DATE, 600, NOW, CATALOG),
    /economy_insufficient_funds/);
  assertRefusedWithoutChange(state, () => transferBetweenAccounts(state, characterId, account.account_id, second.account_id,
    5_000_000, DATE, 600, NOW, CATALOG), /economy_insufficient_funds|economy_transfer_amount_invalid/);
  assertRefusedWithoutChange(state, () => withdrawFromAccount(state, characterId, account.account_id, 10, DATE, 600, NOW, CATALOG),
    /economy_insufficient_funds/);
});

test("the monthly account fee is charged once per calendar month, however often the world date is processed (Stage 34)", () => {
  const state = makeState();
  const characterId = addCitizen(state, "Fee");
  const account = openEconomyAccount(state, characterId, CURRENT, 0, DATE, 600, NOW, CATALOG);
  const fee = CATALOG.bank_products.find((product) => product.id === CURRENT).monthly_fee_ngn;
  assert.ok(fee > 0, "premise: the current account has a monthly fee");
  state.economyAccounts[account.account_id].balance_ngn = 5_000;
  const balance = () => state.economyAccounts[account.account_id].balance_ngn;

  // The world date is processed on every date change and on every session resume: several times in October.
  processEconomyWorldDate(state, { year: 2026, month: 10, day: 12 }, NOW, CATALOG);
  assert.equal(balance(), 5_000 - fee, "the first processing in October charges the fee");
  processEconomyWorldDate(state, { year: 2026, month: 10, day: 12 }, NOW, CATALOG);
  processEconomyWorldDate(state, { year: 2026, month: 10, day: 20 }, NOW, CATALOG);
  assert.equal(balance(), 5_000 - fee, "later processing in October charges nothing more");

  // The next calendar month charges once more.
  processEconomyWorldDate(state, { year: 2026, month: 11, day: 1 }, NOW, CATALOG);
  assert.equal(balance(), 5_000 - 2 * fee, "the fee is charged once for November");
  processEconomyWorldDate(state, { year: 2026, month: 11, day: 2 }, NOW, CATALOG);
  assert.equal(balance(), 5_000 - 2 * fee, "and not again in November");
});

// ─── Part B: socket path, every backend ───────────────────────────────────────

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

const SAVINGS = "bank-product:savings";
const SAVINGS_MINIMUM = CATALOG.bank_products.find((p) => p.id === SAVINGS).minimum_balance_ngn;

const SERVER_OPTIONS = { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } };

async function session(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, SERVER_OPTIONS);
  const entry = { backend, started, peers: [] };
  opened.push(entry);
  return entry;
}

/** A real identity over the socket. Its cash account is created by the economy when the identity is created. */
async function citizen(entry, name, age = 30) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = entry.backend.store.state.players[identity.playerId].character;
  character.age = age;
  character.date_of_birth = { year: entry.backend.store.state.worldClock.world_date.year - age, month: 1, day: 1 };
  return { peer, playerId: identity.playerId, sessionToken: identity.sessionToken, characterId: character.character_id };
}

const ECONOMY_REPLY = (requestId) => (message) => message.requestId === requestId
  && (message.type === "economy.result" || message.type === "economy.error" || message.type === "command.duplicate");

/** Sends one economy action and waits for its reply (result, error, or duplicate) for the same request ID. */
async function economy(peer, requestId, action, payload = {}) {
  peer.send({ type: "economy.action", action, requestId, payload });
  return peer.waitFor(ECONOMY_REPLY(requestId), 20000);
}

const cashBalance = (backend, characterId) => cashOf(backend.store.state, characterId).balance_ngn;
const accountBalance = (backend, accountId) => backend.store.state.economyAccounts[accountId].balance_ngn;
const depositCount = (backend) => Object.values(backend.store.state.economyTransactions)
  .filter((t) => t.kind === "bank_deposit" && t.description === "Cash deposit.").length;

/**
 * A citizen with a savings account and cash, saved so that it survives a restart. The opening deposit is the savings
 * minimum. A savings account has no monthly fee and accrues interest only when the month changes, so its balance
 * moves only through the actions under test. Balances are checked relative to `base`, the opening balance.
 */
async function bankSetup(entry, { cash = 300_000 } = {}) {
  const saver = await citizen(entry, "Saver");
  cashOf(entry.backend.store.state, saver.characterId).balance_ngn = cash;
  await entry.backend.store.flush();
  const opened = await economy(saver.peer, "setup-open", "open_account", { bank_product_id: SAVINGS, initial_deposit_ngn: SAVINGS_MINIMUM });
  assert.equal(opened.type, "economy.result", JSON.stringify(opened));
  const accountId = opened.data.account.account_id;
  await entry.backend.store.flush();
  return { saver, accountId, base: SAVINGS_MINIMUM };
}

/**
 * Makes this writer lose its storage: another writer has taken over. PostgreSQL: the saved version moves on. File: the
 * lock file is replaced by a token this writer does not hold.
 */
async function fenceWriter(entry) {
  if (entry.backend.name === "postgres") {
    await entry.backend.restoreDurable(await entry.backend.durableState());
    return;
  }
  entry.backend.store.inner.acquireWriterLock();
  writeFileSync(`${entry.backend.filePath}.lock`, `${JSON.stringify({ pid: process.pid, token: randomUUID(), acquired_at: new Date().toISOString() })}\n`);
}

/**
 * Simulates a crash. The store is killed first, so no write reaches storage from here on: a closing socket runs its
 * disconnect save, and that save must not happen in a process that has died.
 */
async function crash(entry) {
  entry.backend.store.kill();
  entry.started.server.closeAllConnections();
  entry.started.server.close();
  for (const peer of entry.peers) peer.close();
  entry.peers = [];
  entry.started = { stop: async () => {} };
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/** A new server process over the same storage, reloaded from what was saved. */
async function restart(entry) {
  await entry.backend.reopen();
  entry.started = await startOver(entry.backend, SERVER_OPTIONS);
}

async function resumeAs(entry, who) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  await resumeSession(peer, who.sessionToken);
  return peer;
}

for (const backendName of backendNames) {
  const label = (text) => `${backendName}: ${text}`;

  test(label("a deposit is confirmed only once it is saved, and the saved world holds it"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const cashStart = cashBalance(entry.backend, saver.characterId);
    const reply = await economy(saver.peer, "dep-ok", "deposit", { account_id: accountId, amount_ngn: 50_000 });
    assert.equal(reply.type, "economy.result", JSON.stringify(reply));
    assert.equal(reply.data.transaction.amount_ngn, 50_000);
    assert.equal(reply.data.replayed, undefined, "the first result is not a replay");
    assert.equal(cashBalance(entry.backend, saver.characterId), cashStart - 50_000);
    assert.equal(accountBalance(entry.backend, accountId), base + 50_000);
    const durable = await entry.backend.durableState();
    assert.equal(durable.economyAccounts[accountId].balance_ngn, base + 50_000, "the reply is backed by a saved balance");
    assert.ok(durable.economyTransactions[reply.data.transaction.transaction_id], "the saved world holds the transaction");
  });

  test(label("a save that fails is not confirmed; the same request ID after recovery is replayed, and the deposit is made once"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const payload = { account_id: accountId, amount_ngn: 20_000 };
    entry.backend.store.failNextWrite("disk full");
    const first = await economy(saver.peer, "dep-fail", "deposit", payload);
    assert.equal(first.type, "economy.error", JSON.stringify(first));
    assert.equal(first.code, "economy_not_saved", "a save that failed before any write is reported as not saved");
    assert.equal((await entry.backend.durableState()).economyAccounts[accountId].balance_ngn, base, "nothing reached storage");

    const retry = await economy(saver.peer, "dep-fail", "deposit", payload);
    assert.equal(retry.type, "economy.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, true, "the recorded deposit is replayed, not made again");
    assert.equal(accountBalance(entry.backend, accountId), base + 20_000, "credited once");
    assert.equal(depositCount(entry.backend), 1);
    const durable = await entry.backend.durableState();
    assert.equal(durable.economyAccounts[accountId].balance_ngn, base + 20_000, "the confirmed deposit is in the saved world");
  });

  test(label("a save that commits but loses its reply is not confirmed as success or as not saved, and the retry is replayed"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const payload = { account_id: accountId, amount_ngn: 15_000 };
    entry.backend.store.failNextWriteAfterCommit("response lost");
    const first = await economy(saver.peer, "dep-lost", "deposit", payload);
    assert.equal(first.type, "economy.error");
    assert.equal(first.code, "economy_outcome_unknown", "the save committed before the failure was reported, so the outcome is unknown");

    const retry = await economy(saver.peer, "dep-lost", "deposit", payload);
    assert.equal(retry.type, "economy.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, true);
    assert.equal(accountBalance(entry.backend, accountId), base + 15_000, "credited once");
    assert.equal(depositCount(entry.backend), 1);
  });

  test(label("a refused request is not recorded: a corrected retry with the same request ID applies once"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const bad = await economy(saver.peer, "dep-bad", "deposit", { account_id: accountId, amount_ngn: 999_999_999 });
    assert.equal(bad.type, "economy.error");
    assert.equal(bad.code, "economy_action_invalid", "an amount outside the handler's range is refused as invalid");
    assert.equal(accountBalance(entry.backend, accountId), base);
    const good = await economy(saver.peer, "dep-bad", "deposit", { account_id: accountId, amount_ngn: 9_000 });
    assert.equal(good.type, "economy.result", JSON.stringify(good));
    assert.equal(good.data.replayed, undefined, "the refused attempt was never recorded, so this is the first success");
    assert.equal(accountBalance(entry.backend, accountId), base + 9_000);
  });

  test(label("a request ID reused with a different amount is refused as reused and changes nothing more"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const first = await economy(saver.peer, "dep-conflict", "deposit", { account_id: accountId, amount_ngn: 10_000 });
    assert.equal(first.type, "economy.result", JSON.stringify(first));
    // Stage 36: the same ID with a different amount is refused as a reused request ID. It is no longer answered as a
    // duplicate, because a duplicate would tell the client that its different request had succeeded.
    saver.peer.send({ type: "economy.action", action: "deposit", requestId: "dep-conflict", payload: { account_id: accountId, amount_ngn: 99_000 } });
    const conflicting = await saver.peer.waitFor((message) => message.requestId === "dep-conflict" && message.type === "error", 20000);
    assert.equal(conflicting.code, "request_id_reused", JSON.stringify(conflicting));
    assert.equal(accountBalance(entry.backend, accountId), base + 10_000);
    assert.equal(depositCount(entry.backend), 1);
  });

  test(label("the same request sent twice at once is applied once, and both replies agree"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const message = { type: "economy.action", action: "deposit", requestId: "dep-twice", payload: { account_id: accountId, amount_ngn: 7_000 } };
    saver.peer.send(message);
    saver.peer.send(message);
    const replies = [
      await saver.peer.waitFor(ECONOMY_REPLY("dep-twice")),
      await saver.peer.waitFor(ECONOMY_REPLY("dep-twice")),
    ];
    const results = replies.filter((reply) => reply.type === "economy.result");
    const duplicates = replies.filter((reply) => reply.type === "command.duplicate");
    assert.equal(results.length, 1, JSON.stringify(replies));
    assert.equal(duplicates.length, 1, "the second arrival is a duplicate: the result was already sent");
    assert.equal(results[0].data.transaction.amount_ngn, 7_000);
    assert.equal(accountBalance(entry.backend, accountId), base + 7_000, "credited once");
    assert.equal(depositCount(entry.backend), 1);
  });

  test(label("two different deposits sent while one save is held are both applied and confirmed by the same save"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const releaseSave = entry.backend.store.holdNextWrite();
    const heldBefore = entry.backend.store.heldCount;
    saver.peer.send({ type: "economy.action", action: "deposit", requestId: "dep-held-a", payload: { account_id: accountId, amount_ngn: 3_000 } });
    await waitUntil(() => entry.backend.store.heldCount > heldBefore);
    const second = economy(saver.peer, "dep-held-b", "deposit", { account_id: accountId, amount_ngn: 4_000 });
    releaseSave();
    const a = await saver.peer.waitFor(ECONOMY_REPLY("dep-held-a"), 20000);
    const b = await second;
    assert.equal(a.type, "economy.result", JSON.stringify(a));
    assert.equal(b.type, "economy.result", JSON.stringify(b));
    assert.equal(accountBalance(entry.backend, accountId), base + 7_000, "both deposits, once each");
    assert.equal(depositCount(entry.backend), 2);
    const durable = await entry.backend.durableState();
    assert.equal(durable.economyAccounts[accountId].balance_ngn, base + 7_000);
  });

  test(label("while saving fails, a new money change is refused before it changes anything; the recorded request is confirmed later"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    // Saving fails for as long as failures are queued, so no automatic retry can succeed during these checks.
    for (let i = 0; i < 1000; i += 1) entry.backend.store.failNextWrite("disk unavailable");
    const first = await economy(saver.peer, "gate-a", "deposit", { account_id: accountId, amount_ngn: 5_000 });
    assert.equal(first.code, "economy_not_saved");
    const memory = { balance: accountBalance(entry.backend, accountId), deposits: depositCount(entry.backend) };

    const refused = await economy(saver.peer, "gate-b", "deposit", { account_id: accountId, amount_ngn: 6_000 });
    assert.equal(refused.type, "economy.error");
    assert.equal(refused.code, "economy_persistence_unavailable");
    const transfer = await economy(saver.peer, "gate-c", "withdraw", { account_id: accountId, amount_ngn: 100 });
    assert.equal(transfer.code, "economy_persistence_unavailable");
    assert.equal(accountBalance(entry.backend, accountId), memory.balance, "a refused request changes nothing");
    assert.equal(depositCount(entry.backend), memory.deposits);

    entry.backend.store.clearFailures();
    const retry = await economy(saver.peer, "gate-a", "deposit", { account_id: accountId, amount_ngn: 5_000 });
    assert.equal(retry.type, "economy.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, true, "the recorded deposit is replayed, not applied again");
    assert.equal(accountBalance(entry.backend, accountId), base + 5_000, "credited once");
    const fresh = await economy(saver.peer, "gate-b", "deposit", { account_id: accountId, amount_ngn: 6_000 });
    assert.equal(fresh.type, "economy.result", JSON.stringify(fresh));
    assert.equal(accountBalance(entry.backend, accountId), base + 11_000);
    const durable = await entry.backend.durableState();
    assert.equal(durable.economyAccounts[accountId].balance_ngn, base + 11_000, "the saved world matches memory");
  });

  test(label("a crash after a failed save: the restarted world has no deposit, and the retry applies it once"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const payload = { account_id: accountId, amount_ngn: 8_000 };
    entry.backend.store.failNextWrite("disk gone");
    const refused = await economy(saver.peer, "dep-crash", "deposit", payload);
    assert.equal(refused.code, "economy_not_saved");
    await crash(entry);

    await restart(entry);
    assert.equal(accountBalance(entry.backend, accountId), base, "the restarted world has the balance it saved");
    const peer = await resumeAs(entry, saver);
    const retry = await economy(peer, "dep-crash", "deposit", payload);
    assert.equal(retry.type, "economy.result", JSON.stringify(retry));
    assert.equal(retry.data.replayed, undefined, "nothing was saved, so this is the first deposit");
    assert.equal(accountBalance(entry.backend, accountId), base + 8_000);
    assert.equal(depositCount(entry.backend), 1);
  });

  test(label("a crash after a committed save with a lost reply: the restarted world holds the deposit, and a retry is not applied again"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const payload = { account_id: accountId, amount_ngn: 6_500 };
    entry.backend.store.failNextWriteAfterCommit("reply lost");
    const unknown = await economy(saver.peer, "dep-committed", "deposit", payload);
    assert.equal(unknown.code, "economy_outcome_unknown");
    await crash(entry);

    await restart(entry);
    assert.equal(accountBalance(entry.backend, accountId), base + 6_500, "the restarted world holds the saved deposit");
    const peer = await resumeAs(entry, saver);
    const retry = await economy(peer, "dep-committed", "deposit", payload);
    assert.equal(retry.type, "command.duplicate", "the saved request ID is recognised after the restart");
    assert.equal(accountBalance(entry.backend, accountId), base + 6_500, "credited once");
    assert.equal(depositCount(entry.backend), 1);
  });

  test(label("a shop purchase is confirmed only once saved; a failed save is not charged twice on retry"), async () => {
    const entry = await session(backendName);
    const buyer = await citizen(entry, "Buyer");
    const character = entry.backend.store.state.players[buyer.playerId].character;
    character.current_location = "market";
    character.position = { x: 1190, y: 440 };
    character.money = 1_000;
    await entry.backend.store.flush();
    const shop = (requestId) => ({ type: "shop.purchase", itemId: "bottled_water", requestId });

    entry.backend.store.failNextWrite("disk full");
    buyer.peer.send(shop("shop-fail"));
    const first = await buyer.peer.waitFor((m) => m.requestId === "shop-fail" && (m.type === "error" || m.type === "character.snapshot"));
    assert.equal(first.type, "error", JSON.stringify(first));
    assert.equal(first.code, "shop_not_saved");

    buyer.peer.send(shop("shop-fail"));
    const retry = await buyer.peer.waitFor((m) => m.requestId === "shop-fail" && (m.type === "error" || m.type === "character.snapshot" || m.type === "command.duplicate"));
    assert.equal(retry.type, "character.snapshot", JSON.stringify(retry));
    const current = entry.backend.store.state.players[buyer.playerId].character;
    assert.equal(current.money, 900, "charged once");
    assert.equal(current.inventory.filter((item) => item.id === "bottled_water").reduce((sum, item) => sum + item.quantity, 0), 1);
    const durable = await entry.backend.durableState();
    assert.equal(durable.players[buyer.playerId].character.money, 900, "the saved world holds the purchase");
  });

  test(label("a validation failure over the socket leaves the economy exactly as it was"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry, { cash: 1_000 });
    const before = JSON.stringify(entry.backend.store.state.economyAccounts);
    const reply = await economy(saver.peer, "xfer-bad", "withdraw", { account_id: accountId, amount_ngn: 500_000 });
    assert.equal(reply.type, "economy.error");
    assert.equal(reply.code, "economy_insufficient_funds");
    assert.equal(JSON.stringify(entry.backend.store.state.economyAccounts), before, "nothing changed");
  });

  test(label("a fenced writer refuses new money changes after its first refused save, and never confirms one"), async () => {
    const entry = await session(backendName);
    const { saver, accountId, base } = await bankSetup(entry);
    const durableBefore = (await entry.backend.durableState()).economyAccounts[accountId].balance_ngn;
    await fenceWriter(entry);

    const first = await economy(saver.peer, "fence-a", "deposit", { account_id: accountId, amount_ngn: 2_000 });
    assert.equal(first.code, "economy_not_saved", "the fenced save is refused before any write");
    const memory = accountBalance(entry.backend, accountId);

    const second = await economy(saver.peer, "fence-b", "deposit", { account_id: accountId, amount_ngn: 2_500 });
    assert.equal(second.code, "economy_persistence_unavailable", "a fenced writer accepts no new money change");
    assert.equal(accountBalance(entry.backend, accountId), memory);
    const durable = await entry.backend.durableState();
    assert.equal(durable.economyAccounts[accountId].balance_ngn, durableBefore, "nothing from this writer reached storage");
    await crash(entry);
  });
}
