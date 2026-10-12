// Money routes for bus fares and clinic care, and the pay_rent containment (Stage 34).
//
// Each route is driven over the real socket on every configured backend (file always; PostgreSQL when the live database is
// configured), with persistence failures injected through FaultyStore. The rules under test, as in
// economy-money-durability.test.mjs:
//   - a refused request (validation or authority) changes nothing, in memory or in storage;
//   - the charge is confirmed (a character snapshot carrying the request ID) only after its save succeeds;
//   - a save known to have failed is "<family>_not_saved"; a save that may have committed is "<family>_outcome_unknown";
//   - a retry with the same request ID never charges twice, and is answered once the change is saved;
//   - while saving is failing, a new charge is refused before it changes anything ("<family>_persistence_unavailable");
//   - a confirmed charge survives a restart, and its request ID is then a duplicate, not a second charge.
// pay_rent is refused on player routes with property_rent_payment_suspended, and nothing changes.
//
// This server runs with timed ticks off (startOver's NO_TICKS), so a save happens only when a request needs one.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";

before(connectBackends);
after(disconnectBackends);

const ROUTES = [
  {
    family: "bus",
    type: "world.bus",
    charge: 150,
    place(character) {
      character.current_location = "town";
      character.position = { x: 625, y: 495 };
      character.geographic_location = null;
      character.money = 1000;
    },
    stand(character) {
      character.current_location = "town";
      character.position = { x: 625, y: 495 };
    },
    moved(character) {
      return character.current_location === "schoolyard";
    },
    outOfRange(character) {
      character.position = { x: 40, y: 40 };
    },
    poor(character) {
      character.money = 100;
    },
  },
  {
    family: "clinic",
    type: "clinic.care",
    charge: 300,
    place(character) {
      character.current_location = "clinic";
      character.position = { x: 1080, y: 470 };
      character.health = 50;
      character.money = 1000;
    },
    stand(character) {
      character.current_location = "clinic";
      character.position = { x: 1080, y: 470 };
    },
    moved(character) {
      return character.health === 85;
    },
    outOfRange(character) {
      character.position = { x: 40, y: 40 };
    },
    poor(character) {
      character.money = 100;
    },
  },
];

/** Creates a player, puts it where the route is used, and saves that baseline. */
async function setUp(backend, started, route) {
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const session = await createIdentity(peer, "Rider");
  assert.equal((await resumeSession(peer, session.sessionToken)).type, "session.ready");
  const character = backend.store.state.players[session.playerId].character;
  route.place(character);
  await backend.store.flush();
  return { peer, session };
}

/**
 * The world content a money action could change, as JSON. Request bookkeeping is left out: lastSeen and session activity
 * are updated for every request before it is dispatched, and the world clock's updated_at moves with the ticks. A refused
 * money request must leave every other field identical.
 */
function contentOf(state) {
  const BOOKKEEPING = new Set(["lastSeen", "lastActivityAt", "updated_at", "updatedAt", "worldClock"]);
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !BOOKKEEPING.has(key)).map(([key, inner]) => [key, strip(inner)]));
  };
  return JSON.stringify(strip(state));
}

const liveCharacter = (backend, playerId) => backend.store.state.players[playerId].character;
const savedCharacter = async (backend, playerId) => (await backend.durableState()).players[playerId].character;

/** The first reply for this request: a confirmation, a duplicate notice, or an error with the request ID. */
function settle(peer, requestId) {
  return peer.waitFor(
    (message) => message.requestId === requestId &&
      (message.type === "character.snapshot" || message.type === "command.duplicate" || message.type === "error"),
    5000,
  );
}

/** Waits until the saved character holds the expected value. Used after a confirmed reply, when the save has finished. */
async function savedUntil(backend, playerId, predicate) {
  const started = Date.now();
  for (;;) {
    const character = await savedCharacter(backend, playerId);
    if (predicate(character)) return character;
    if (Date.now() - started > 2000) throw new Error("The saved character did not reach the expected value.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

for (const backendName of backendNames) {
  for (const route of ROUTES) {
    describe(`${route.family} (${backendName} backend)`, () => {
      test("validation refusals change nothing, in memory or in storage", async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        let peer;
        try {
          const setup = await setUp(backend, started, route);
          peer = setup.peer;
          const { playerId } = setup.session;
          const character = () => liveCharacter(backend, playerId);

          // Out of range: the request is refused before any change. Set the position as a setup step, then record.
          route.outOfRange(character());
          await backend.store.flush();
          const liveFar = JSON.stringify(character());
          const savedFar = JSON.stringify(await savedCharacter(backend, playerId));
          peer.send({ type: route.type, requestId: `${route.family}-far` });
          const far = await settle(peer, `${route.family}-far`);
          assert.equal(far.type, "error", JSON.stringify(far));
          assert.equal(far.code, "interaction_out_of_range");
          assert.equal(JSON.stringify(character()), liveFar, "live state unchanged");
          assert.equal(JSON.stringify(await savedCharacter(backend, playerId)), savedFar, "saved state unchanged");

          // Not enough money: refused before any change. Put the character back in place, then set the money as setup.
          route.place(character());
          route.poor(character());
          await backend.store.flush();
          const livePoor = JSON.stringify(character());
          const savedPoor = JSON.stringify(await savedCharacter(backend, playerId));
          peer.send({ type: route.type, requestId: `${route.family}-poor` });
          const poor = await settle(peer, `${route.family}-poor`);
          assert.equal(poor.type, "error", JSON.stringify(poor));
          assert.equal(poor.code, "insufficient_funds");
          assert.equal(JSON.stringify(character()), livePoor, "live state unchanged");
          assert.equal(JSON.stringify(await savedCharacter(backend, playerId)), savedPoor, "saved state unchanged");
        } finally {
          await peer?.close();
          await started.stop();
          await backend.cleanup();
        }
      });

      test("a failed save is not confirmed; the retry with the same request ID is answered once the change is saved, and charged once", async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        let peer;
        try {
          const setup = await setUp(backend, started, route);
          peer = setup.peer;
          const { playerId } = setup.session;
          const money = liveCharacter(backend, playerId).money;

          backend.store.failNextWrite("disk full");
          peer.send({ type: route.type, requestId: `${route.family}-1` });
          const first = await settle(peer, `${route.family}-1`);
          assert.equal(first.type, "error", JSON.stringify(first));
          assert.equal(first.code, `${route.family}_not_saved`, "a save known to have failed is not_saved");
          assert.equal((await savedCharacter(backend, playerId)).money, money, "nothing reached storage");

          peer.send({ type: route.type, requestId: `${route.family}-1` });
          const retry = await settle(peer, `${route.family}-1`);
          assert.equal(retry.type, "character.snapshot", JSON.stringify(retry));
          assert.equal(liveCharacter(backend, playerId).money, money - route.charge, "charged once");
          await savedUntil(backend, playerId, (character) => character.money === money - route.charge);
        } finally {
          await peer?.close();
          await started.stop();
          await backend.cleanup();
        }
      });

      test("a save that commits but loses its reply is outcome_unknown; the retry is answered once and charged once", async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        let peer;
        try {
          const setup = await setUp(backend, started, route);
          peer = setup.peer;
          const { playerId } = setup.session;
          const money = liveCharacter(backend, playerId).money;

          backend.store.failNextWriteAfterCommit("reply lost");
          peer.send({ type: route.type, requestId: `${route.family}-2` });
          const first = await settle(peer, `${route.family}-2`);
          assert.equal(first.type, "error", JSON.stringify(first));
          assert.equal(first.code, `${route.family}_outcome_unknown`, "the save committed before the failure, so the outcome is unknown");

          peer.send({ type: route.type, requestId: `${route.family}-2` });
          const retry = await settle(peer, `${route.family}-2`);
          assert.equal(retry.type, "character.snapshot", JSON.stringify(retry));
          assert.equal(liveCharacter(backend, playerId).money, money - route.charge, "charged once");
          assert.equal((await savedCharacter(backend, playerId)).money, money - route.charge, "storage holds one charge");
        } finally {
          await peer?.close();
          await started.stop();
          await backend.cleanup();
        }
      });

      test("while saving fails, a new charge is refused before any change; the earlier request is still answered once after recovery", async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        let peer;
        try {
          const setup = await setUp(backend, started, route);
          peer = setup.peer;
          const { playerId } = setup.session;
          const money = liveCharacter(backend, playerId).money;

          backend.store.failNextWrite("disk full");
          peer.send({ type: route.type, requestId: `${route.family}-a` });
          await settle(peer, `${route.family}-a`);

          // The failed charge already moved the character in memory (it is not rolled back). Stand it where the route is used again,
          // so this request reaches the save gate and not the location check. This is a setup step, not a request.
          route.stand(liveCharacter(backend, playerId));
          await backend.store.flush();
          const before = JSON.stringify(liveCharacter(backend, playerId));
          peer.send({ type: route.type, requestId: `${route.family}-b` });
          const refused = await settle(peer, `${route.family}-b`);
          assert.equal(refused.type, "error", JSON.stringify(refused));
          assert.equal(refused.code, `${route.family}_persistence_unavailable`);
          assert.equal(JSON.stringify(liveCharacter(backend, playerId)), before, "the refused request changed nothing");

          // The first request, retried after the gate has been seen, is confirmed: the save succeeds now.
          peer.send({ type: route.type, requestId: `${route.family}-a` });
          const confirmed = await settle(peer, `${route.family}-a`);
          assert.equal(confirmed.type, "character.snapshot", JSON.stringify(confirmed));
          assert.equal(liveCharacter(backend, playerId).money, money - route.charge, "charged once");
          await savedUntil(backend, playerId, (character) => character.money === money - route.charge);
        } finally {
          await peer?.close();
          await started.stop();
          await backend.cleanup();
        }
      });

      test("a confirmed charge survives a restart, and its request ID is then a duplicate, not a second charge", async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        let session;
        let money;
        let peer;
        try {
          const setup = await setUp(backend, started, route);
          peer = setup.peer;
          session = setup.session;
          money = liveCharacter(backend, session.playerId).money;
          peer.send({ type: route.type, requestId: `${route.family}-3` });
          const confirmed = await settle(peer, `${route.family}-3`);
          assert.equal(confirmed.type, "character.snapshot", JSON.stringify(confirmed));
          await peer.close();
          peer = undefined;
        } finally {
          await started.stop();
        }
        await backend.reopen();
        const restarted = await startOver(backend, {});
        let again;
        try {
          again = await openPeerFrom(restarted.websocketUrl, "127.0.0.1");
          assert.equal((await resumeSession(again, session.sessionToken)).type, "session.ready");
          assert.equal((await savedCharacter(backend, session.playerId)).money, money - route.charge, "the saved charge survived the restart");

          again.send({ type: route.type, requestId: `${route.family}-3` });
          const duplicate = await again.waitFor((message) => message.type === "command.duplicate" && message.requestId === `${route.family}-3`, 20000);
          assert.equal(duplicate.requestId, `${route.family}-3`);
          await again.waitFor((message) => message.type === "character.snapshot" && message.requestId === `${route.family}-3`, 20000);
          assert.equal((await savedCharacter(backend, session.playerId)).money, money - route.charge, "not charged a second time");
        } finally {
          await again?.close();
          await restarted.stop();
          await backend.cleanup();
        }
      });

      test("a crash after an outcome_unknown commit does not charge the retry again: the restart keeps the saved charge and its request ID", async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        let session;
        let money;
        try {
          const setup = await setUp(backend, started, route);
          session = setup.session;
          money = liveCharacter(backend, session.playerId).money;
          backend.store.failNextWriteAfterCommit("reply lost");
          setup.peer.send({ type: route.type, requestId: `${route.family}-4` });
          const first = await settle(setup.peer, `${route.family}-4`);
          assert.equal(first.code, `${route.family}_outcome_unknown`);
          // The process dies before any retry. Killing the store stops every later write, including the disconnect save.
          backend.store.kill();
          started.server.closeAllConnections();
          started.server.close();
          await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
          await started.stop().catch(() => {});
        }
        await backend.reopen();
        const restarted = await startOver(backend, {});
        let again;
        try {
          again = await openPeerFrom(restarted.websocketUrl, "127.0.0.1");
          assert.equal((await resumeSession(again, session.sessionToken)).type, "session.ready");
          assert.equal((await savedCharacter(backend, session.playerId)).money, money - route.charge, "the committed charge is in storage");
          again.send({ type: route.type, requestId: `${route.family}-4` });
          await again.waitFor((message) => message.requestId === `${route.family}-4` && (message.type === "command.duplicate" || message.type === "character.snapshot"), 20000);
          assert.equal((await savedCharacter(backend, session.playerId)).money, money - route.charge, "charged once across the crash");
        } finally {
          await again?.close();
          await restarted.stop();
          await backend.cleanup();
        }
      });
    });
  }

  describe(`pay_rent containment (${backendName} backend)`, () => {
    test("pay_rent is refused with property_rent_payment_suspended, and no state changes in memory or storage", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      let peer;
      try {
        const setup = await setUp(backend, started, ROUTES[0]);
        peer = setup.peer;
        const { playerId } = setup.session;
        const liveBefore = contentOf(backend.store.state);
        const savedBefore = contentOf(await backend.durableState());

        peer.send({ type: "property.action", action: "pay_rent", requestId: "rent-1", payload: { agreement_id: "agreement-none" } });
        const refused = await peer.waitFor((message) => message.type === "property.error" && message.requestId === "rent-1", 20000);
        assert.equal(refused.code, "property_rent_payment_suspended");
        assert.equal(refused.action, "pay_rent");

        assert.equal(contentOf(backend.store.state), liveBefore, "live world content unchanged");
        assert.equal(contentOf(await backend.durableState()), savedBefore, "saved world content unchanged");
        assert.ok(playerId);
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
