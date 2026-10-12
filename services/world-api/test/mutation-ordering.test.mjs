import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  backendNames,
  connectBackends,
  disconnectBackends,
  openBackend,
  openPeerFrom,
  startOver,
} from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";

/**
 * Mutation response ordering (Stage 28, docs/STAGE_28_MUTATION_ORDERING_AUDIT.md).
 *
 * These tests cover shop.purchase (money and inventory). Stage 34 changed the contract: a purchase is confirmed (the
 * character snapshot carrying its request ID) only after its save succeeds. A failed save is answered with shop_not_saved
 * for that request, and the connection-wide persistence_failed notice still follows. The earlier Stage 28 tests recorded
 * the success reply sent before the save; those expectations were replaced deliberately (docs/STAGE_34_MUTATION_OUTCOMES_AND_RISK_CONTAINMENT.md section 3.5).
 *
 * Runs on the file backend always, and on PostgreSQL when a disposable database is configured. No real world file is used.
 */

const MARKET = { x: 1190, y: 440 };
const MEAT_PIE_PRICE = 350;

before(connectBackends);
after(disconnectBackends);

/** Waits for the next message of any of the given types, in arrival order. */
function nextOf(peer, types, timeoutMs = 5000) {
  return peer.waitFor((message) => types.includes(message.type) || (message.type === "error" && types.includes(message.code)), timeoutMs);
}

/** The label used for arrival order: the message type, or the error code for an error. */
function labelOf(message) {
  return message.type === "error" ? message.code : message.type;
}

/** Polls the saved state until `predicate` holds (a save runs after its reply). Fails after two seconds. */
async function waitForDurable(backend, predicate, timeoutMs = 2000) {
  const started = Date.now();
  for (;;) {
    const state = await backend.durableState();
    if (predicate(state)) return state;
    if (Date.now() - started > timeoutMs) throw new Error("The saved state did not reach the expected value.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Creates a player, resumes its session, and puts it at the market with a saved baseline. */
async function setUpBuyer(backend, started) {
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const session = await createIdentity(peer, "Buyer");
  assert.equal((await resumeSession(peer, session.sessionToken)).type, "session.ready");
  const player = backend.store.state.players[session.playerId];
  player.character.current_location = "market";
  player.character.position = { ...MARKET };
  await backend.store.flush();
  return { peer, session, player };
}

function moneyOf(record) {
  return record.players[Object.keys(record.players)[0]].character.money;
}

for (const name of backendNames) {
  describe(`mutation ordering, shop.purchase (${name} backend)`, () => {
    test("the purchase reply waits for the save: a failed save sends shop_not_saved, never a success; the live world keeps the purchase, the saved file does not", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {});
      let peer;
      try {
        const setup = await setUpBuyer(backend, started);
        peer = setup.peer;
        const { playerId } = setup.session;
        const baseline = await backend.durableState();
        const startMoney = baseline.players[playerId].character.money;
        const startInventory = baseline.players[playerId].character.inventory.length;

        // Record every message on this socket, in arrival order, with its request ID.
        const arrivals = [];
        peer.socket.on("message", (data) => {
          const message = JSON.parse(data.toString());
          arrivals.push({ label: labelOf(message), requestId: message.requestId });
        });

        backend.store.failNextWrite();
        peer.send({ type: "shop.purchase", requestId: "req-1", itemId: "meat_pie" });
        const failure = await peer.waitFor((message) => message.type === "error" && message.code === "shop_not_saved" && message.requestId === "req-1", 20000);
        assert.equal(failure.code, "shop_not_saved");
        await peer.waitFor((message) => message.type === "error" && message.code === "persistence_failed", 20000);
        assert.ok(!arrivals.some((arrival) => arrival.label === "character.snapshot" && arrival.requestId === "req-1"),
          `no confirmation for req-1 arrives before its save (arrivals: ${arrivals.map((a) => a.label).join(", ")})`);

        // The live world holds the purchase (it is not rolled back), but nothing has confirmed it. The file does not hold it.
        assert.equal(backend.store.state.players[playerId].character.money, startMoney - MEAT_PIE_PRICE);
        const durable = await backend.durableState();
        assert.equal(durable.players[playerId].character.money, startMoney, "the saved file still has the old balance");
        assert.equal(durable.players[playerId].character.inventory.length, startInventory, "the saved file has no new item");
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a repeated request while its save is failing is answered once the save succeeds, and the purchase is charged once", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {});
      let peer;
      try {
        const setup = await setUpBuyer(backend, started);
        peer = setup.peer;
        const { playerId } = setup.session;
        const startMoney = backend.store.state.players[playerId].character.money;

        backend.store.failNextWrite();
        peer.send({ type: "shop.purchase", requestId: "req-dup", itemId: "meat_pie" });
        await peer.waitFor((message) => message.type === "error" && message.code === "shop_not_saved" && message.requestId === "req-dup", 20000);

        // The same request ID again: it is recorded but not confirmed, so the reply waits for a successful save.
        peer.send({ type: "shop.purchase", requestId: "req-dup", itemId: "meat_pie" });
        const confirmed = await peer.waitFor((message) => message.requestId === "req-dup" && (message.type === "character.snapshot" || message.type === "error" || message.type === "command.duplicate"), 20000);
        assert.equal(confirmed.type, "character.snapshot", JSON.stringify(confirmed));
        assert.equal(backend.store.state.players[playerId].character.money, startMoney - MEAT_PIE_PRICE, "charged once");
        const durable = await waitForDurable(backend, (state) => state.players[playerId].character.money === startMoney - MEAT_PIE_PRICE);
        assert.equal(durable.players[playerId].character.money, startMoney - MEAT_PIE_PRICE);
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });

    test("while saving fails, a new purchase is refused before it changes anything; the background retry saves the unsaved purchase, and the player gets one persistence.restored signal", async () => {
      const backend = await openBackend(name);
      // Timed ticks run here (the default interval), so the background retry is the real production path: a tick saves
      // the dirty world about once a second. A queue of failures holds the outage open until the test clears it.
      const started = await startOver(backend, { tickIntervalMs: 50 });
      let peer;
      try {
        const setup = await setUpBuyer(backend, started);
        peer = setup.peer;
        const { playerId } = setup.session;
        const startMoney = backend.store.state.players[playerId].character.money;

        for (let i = 0; i < 200; i += 1) backend.store.failNextWrite();
        peer.send({ type: "shop.purchase", requestId: "req-a", itemId: "meat_pie" });
        await peer.waitFor((message) => message.type === "error" && message.code === "shop_not_saved" && message.requestId === "req-a", 20000);
        await peer.waitFor((message) => message.type === "error" && message.code === "persistence_failed", 20000);

        // Saving is still failing: a new purchase is refused before any change, and nothing is charged.
        peer.send({ type: "shop.purchase", requestId: "req-refused", itemId: "meat_pie" });
        const refused = await peer.waitFor((message) => message.requestId === "req-refused" && message.type === "error", 20000);
        assert.equal(refused.code, "shop_persistence_unavailable");
        assert.equal(backend.store.state.players[playerId].character.money, startMoney - MEAT_PIE_PRICE, "the refused purchase charged nothing");

        // Saving recovers: the background retry writes req-a's unsaved charge, and the signal is sent once.
        backend.store.clearFailures();
        await peer.waitFor((message) => message.type === "persistence.restored", 8000);
        const durable = await waitForDurable(backend, (state) => state.players[playerId].character.money === startMoney - MEAT_PIE_PRICE);
        assert.equal(durable.players[playerId].character.money, startMoney - MEAT_PIE_PRICE, "the unsaved charge is now in the saved file");

        // A later purchase is confirmed, and an ordinary save after recovery does not repeat the signal.
        peer.send({ type: "shop.purchase", requestId: "req-b", itemId: "meat_pie" });
        const confirmed = await peer.waitFor((message) => message.requestId === "req-b" && message.type === "character.snapshot", 20000);
        assert.equal(confirmed.character.money, startMoney - 2 * MEAT_PIE_PRICE);
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(peer.messages.filter((message) => message.type === "persistence.restored").length, 0, "no second persistence.restored");
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });

    test("after a restart that loses the unsaved purchase, the same request ID applies it once: the saved file never had it", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {});
      let session;
      let startMoney;
      let saved;
      let peer;
      try {
        const setup = await setUpBuyer(backend, started);
        peer = setup.peer;
        session = setup.session;
        startMoney = backend.store.state.players[session.playerId].character.money;
        backend.store.failNextWrite();
        peer.send({ type: "shop.purchase", requestId: "req-lost", itemId: "meat_pie" });
        await peer.waitFor((message) => message.type === "error" && message.code === "shop_not_saved" && message.requestId === "req-lost", 20000);
        await peer.waitFor((message) => message.type === "error" && message.code === "persistence_failed", 20000);
        // The file as the failed save left it. Taken now, before shutdown, because shutdown writes the live world.
        saved = await backend.durableState();
        assert.equal(saved.players[session.playerId].character.money, startMoney, "premise: the file does not hold the purchase");
        await peer.close();
        peer = undefined;
      } finally {
        await started.stop();
      }
      // A restart from that file: the purchase was never saved, so the process that made it is gone without it.
      await backend.restoreDurable(saved);
      await backend.reopen();

      const restarted = await startOver(backend, {});
      let again;
      try {
        again = await openPeerFrom(restarted.websocketUrl, "127.0.0.1");
        assert.equal((await resumeSession(again, session.sessionToken)).type, "session.ready");
        again.send({ type: "shop.purchase", requestId: "req-lost", itemId: "meat_pie" });
        const reply = await nextOf(again, ["character.snapshot", "command.duplicate"]);
        assert.equal(reply.type, "character.snapshot", "the request is applied, not reported as a duplicate");
        assert.equal(reply.character.money, startMoney - MEAT_PIE_PRICE, "applied once");
        // The save runs before the confirmation, so the saved file holds the purchase when the reply arrives.
        const durable = await backend.durableState();
        assert.equal(durable.players[session.playerId].character.money, startMoney - MEAT_PIE_PRICE);
      } finally {
        await again?.close();
        await restarted.stop();
        await backend.cleanup();
      }
    });
  });
}
