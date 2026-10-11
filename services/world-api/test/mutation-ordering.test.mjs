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
 * These tests PIN the current behaviour of a gameplay handler, shop.purchase (money and inventory). They do not endorse it.
 * A success reply is sent after the in-memory change and before the save is attempted. A failed save does not reach the
 * handler; the player sees only the connection-wide persistence_failed notice. Any change to this ordering must update these
 * tests deliberately, after the audit's review.
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
    test("the success reply is sent before the save is attempted; a failed save leaves the saved file behind the reply", async () => {
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

        // Record the arrival order of every message on this socket, independent of the test helper's buffering.
        const arrivals = [];
        peer.socket.on("message", (data) => arrivals.push(labelOf(JSON.parse(data.toString()))));

        backend.store.failNextWrite();
        peer.send({ type: "shop.purchase", requestId: "req-1", itemId: "meat_pie" });

        // The reply that claims success arrives first. The failed save is reported separately, afterwards.
        const first = await nextOf(peer, ["character.snapshot"]);
        assert.equal(first.character.money, startMoney - MEAT_PIE_PRICE, "the purchase is applied in the live world");
        const failure = await peer.waitFor((message) => message.type === "error" && message.code === "persistence_failed", 5000);
        assert.equal(failure.code, "persistence_failed");
        const replyAt = arrivals.indexOf("character.snapshot");
        const failureAt = arrivals.indexOf("persistence_failed");
        assert.ok(replyAt >= 0 && failureAt > replyAt, `the success reply arrives before the save failure (arrivals: ${arrivals.join(", ")})`);

        // The gap, stated exactly: the live world has the purchase, the saved file does not.
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

    test("a repeated request in the same process is a duplicate: the purchase is not applied twice, even though it is unsaved", async () => {
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
        await nextOf(peer, ["character.snapshot"]);
        await peer.waitFor((message) => message.type === "error" && message.code === "persistence_failed", 5000);

        peer.send({ type: "shop.purchase", requestId: "req-dup", itemId: "meat_pie" });
        const duplicate = await peer.waitFor((message) => message.type === "command.duplicate", 5000);
        assert.equal(duplicate.requestId, "req-dup");
        assert.equal(backend.store.state.players[playerId].character.money, startMoney - MEAT_PIE_PRICE, "charged once");
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });

    test("the next successful save persists the unsaved purchase, and the player gets one persistence.restored signal", async () => {
      const backend = await openBackend(name);
      const started = await startOver(backend, {});
      let peer;
      try {
        const setup = await setUpBuyer(backend, started);
        peer = setup.peer;
        const { playerId } = setup.session;
        const startMoney = backend.store.state.players[playerId].character.money;

        backend.store.failNextWrite();
        peer.send({ type: "shop.purchase", requestId: "req-a", itemId: "meat_pie" });
        await nextOf(peer, ["character.snapshot"]);
        await peer.waitFor((message) => message.type === "error" && message.code === "persistence_failed", 5000);

        // A later purchase saves successfully. The save writes the whole live world, so both purchases are saved.
        peer.send({ type: "shop.purchase", requestId: "req-b", itemId: "meat_pie" });
        await nextOf(peer, ["character.snapshot"]);
        const restored = await peer.waitFor((message) => message.type === "persistence.restored", 5000);
        assert.equal(restored.type, "persistence.restored");
        const durable = await backend.durableState();
        assert.equal(durable.players[playerId].character.money, startMoney - 2 * MEAT_PIE_PRICE, "both purchases are saved");

        // An ordinary save after recovery does not repeat the signal.
        peer.send({ type: "shop.purchase", requestId: "req-c", itemId: "meat_pie" });
        await nextOf(peer, ["character.snapshot"]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const repeats = peer.messages.filter((message) => message.type === "persistence.restored");
        assert.equal(repeats.length, 0, "no second persistence.restored for an ordinary save");
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
        await nextOf(peer, ["character.snapshot"]);
        await peer.waitFor((message) => message.type === "error" && message.code === "persistence_failed", 5000);
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
        // The save runs after the reply, so wait for it. The reply alone does not show the file has the purchase.
        const durable = await waitForDurable(backend, (state) => state.players[session.playerId].character.money === startMoney - MEAT_PIE_PRICE);
        assert.equal(durable.players[session.playerId].character.money, startMoney - MEAT_PIE_PRICE);
      } finally {
        await again?.close();
        await restarted.stop();
        await backend.cleanup();
      }
    });
  });
}
