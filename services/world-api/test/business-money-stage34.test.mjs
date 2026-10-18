// Business changes are confirmed only after they are saved (Stage 34).
//
// Every business action other than discover and view changes persistent state. Its business.result is sent only after the
// save covers the change. A save known to have failed is business.error business_not_saved; a save that may have committed
// is business_outcome_unknown. A retry with the same request ID is answered once, and never applies the change twice. While
// saving is failing, a changing action is refused before it changes anything (business_persistence_unavailable), but a read
// (discover, view) is still answered.
//
// Runs on the file backend always, and on PostgreSQL when a disposable database is configured.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";

before(connectBackends);
after(disconnectBackends);

/** A citizen with money in hand, as the authority-matrix test creates them. */
async function citizen(backend, started, name, money) {
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const identity = await createIdentity(peer, name);
  assert.equal((await resumeSession(peer, identity.sessionToken)).type, "session.ready");
  const player = backend.store.state.players[identity.playerId];
  const worldDate = backend.store.state.worldClock.world_date;
  player.character.date_of_birth = { year: worldDate.year - 30, month: 1, day: 1 };
  player.character.age = 30;
  player.character.money = money;
  for (const account of Object.values(backend.store.state.economyAccounts)) {
    if (account.character_id === player.character.character_id && account.kind === "cash") account.balance_ngn = money;
  }
  await backend.store.flush();
  return { peer, playerId: identity.playerId, characterId: player.character.character_id, sessionToken: identity.sessionToken };
}

/** The first reply for this request ID: a result, a duplicate notice, or an error. */
function settle(peer, requestId, types = ["business.result", "business.error", "command.duplicate"]) {
  return peer.waitFor((message) => message.requestId === requestId && types.includes(message.type), 20000);
}

/** Waits until the saved world holds the expected value. Used after a confirmed reply, when the save has finished. */
async function savedUntil(backend, predicate) {
  const started = Date.now();
  for (;;) {
    const state = await backend.durableState();
    if (predicate(state)) return state;
    if (Date.now() - started > 2000) throw new Error("The saved world did not reach the expected value.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Creates the owner's business through the socket, as the authority-matrix test does. */
async function ownedBusiness(backend, started, owner) {
  owner.peer.send({
    type: "business.action", action: "create", requestId: "biz-create",
    payload: { template_id: "template:provision-store", name: "Owner Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 50_000 },
  });
  const reply = await settle(owner.peer, "biz-create");
  assert.equal(reply.type, "business.result", `owner creates a business: ${reply.code ?? ""}`);
  return reply.data.business.business_id;
}

const cashOf = (state, characterId) =>
  Object.values(state.economyAccounts).find((a) => a.character_id === characterId && a.kind === "cash").balance_ngn;

for (const backendName of backendNames) {
  describe(`business money confirmation (${backendName} backend)`, () => {
    const ACTIONS = [
      { label: "contribute_capital", action: "contribute_capital", payload: (id) => ({ business_id: id, amount_ngn: 1_000 }), cashDelta: -1_000 },
      { label: "withdraw", action: "withdraw", payload: (id) => ({ business_id: id, amount_ngn: 1_000 }), cashDelta: 1_000 },
    ];

    for (const row of ACTIONS) {
      test(`${row.label}: a failed save is business_not_saved; the retry is answered once and applied once`, async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        try {
          const owner = await citizen(backend, started, "Owner", 500_000);
          const businessId = await ownedBusiness(backend, started, owner);
          const cashBefore = cashOf(backend.store.state, owner.characterId);
          const requestId = `${row.label}-1`;

          backend.store.failNextWrite("disk full");
          owner.peer.send({ type: "business.action", action: row.action, requestId, payload: row.payload(businessId) });
          const first = await settle(owner.peer, requestId);
          assert.equal(first.type, "business.error", JSON.stringify(first));
          assert.equal(first.code, "business_not_saved");

          owner.peer.send({ type: "business.action", action: row.action, requestId, payload: row.payload(businessId) });
          const retry = await settle(owner.peer, requestId);
          assert.equal(retry.type, "business.result", JSON.stringify(retry));
          assert.equal(retry.data.replayed, true, "the recorded change is replayed, not made again");
          assert.equal(cashOf(backend.store.state, owner.characterId), cashBefore + row.cashDelta, "the change happened once");
          await savedUntil(backend, (state) => cashOf(state, owner.characterId) === cashBefore + row.cashDelta);
        } finally {
          await started.stop();
          await backend.cleanup();
        }
      });

      test(`${row.label}: a save that commits but loses its reply is business_outcome_unknown; the retry is answered once`, async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        try {
          const owner = await citizen(backend, started, "Owner", 500_000);
          const businessId = await ownedBusiness(backend, started, owner);
          const cashBefore = cashOf(backend.store.state, owner.characterId);
          const requestId = `${row.label}-2`;

          backend.store.failNextWriteAfterCommit("reply lost");
          owner.peer.send({ type: "business.action", action: row.action, requestId, payload: row.payload(businessId) });
          const first = await settle(owner.peer, requestId);
          assert.equal(first.code, "business_outcome_unknown", "the save committed before the failure, so the outcome is unknown");

          owner.peer.send({ type: "business.action", action: row.action, requestId, payload: row.payload(businessId) });
          const retry = await settle(owner.peer, requestId);
          assert.equal(retry.type, "business.result", JSON.stringify(retry));
          assert.equal(cashOf(backend.store.state, owner.characterId), cashBefore + row.cashDelta, "the change happened once");
          await savedUntil(backend, (state) => cashOf(state, owner.characterId) === cashBefore + row.cashDelta);
        } finally {
          await started.stop();
          await backend.cleanup();
        }
      });

      test(`${row.label}: a confirmed change survives a restart; its request ID is then a duplicate, not a second change`, async () => {
        const backend = await openBackend(backendName);
        const started = await startOver(backend, {});
        let owner;
        let businessId;
        let cashAfter;
        try {
          owner = await citizen(backend, started, "Owner", 500_000);
          businessId = await ownedBusiness(backend, started, owner);
          const cashBefore = cashOf(backend.store.state, owner.characterId);
          owner.peer.send({ type: "business.action", action: row.action, requestId: `${row.label}-3`, payload: row.payload(businessId) });
          const confirmed = await settle(owner.peer, `${row.label}-3`);
          assert.equal(confirmed.type, "business.result", JSON.stringify(confirmed));
          cashAfter = cashBefore + row.cashDelta;
          await owner.peer.close();
        } finally {
          await started.stop();
        }
        await backend.reopen();
        const restarted = await startOver(backend, {});
        let again;
        try {
          again = await openPeerFrom(restarted.websocketUrl, "127.0.0.1");
          assert.equal((await resumeSession(again, owner.sessionToken)).type, "session.ready");
          assert.equal(cashOf((await backend.durableState()), owner.characterId), cashAfter, "the saved world holds the confirmed change");
          again.send({ type: "business.action", action: row.action, requestId: `${row.label}-3`, payload: row.payload(businessId) });
          const duplicate = await settle(again, `${row.label}-3`, ["command.duplicate", "business.result", "business.error"]);
          assert.equal(duplicate.type, "command.duplicate", JSON.stringify(duplicate));
          assert.equal(cashOf((await backend.durableState()), owner.characterId), cashAfter, "not applied a second time");
        } finally {
          await again?.close();
          await restarted.stop();
          await backend.cleanup();
        }
      });
    }

    test("record_expense: a failed save is business_not_saved, and the retry is applied once", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(backend, started, owner);
        // Stage 43: the expense kind is operating or rent (Stage 40). This fixture used "utilities", which is now refused; the save-and-retry behaviour under test is unchanged.
        const payload = { business_id: businessId, kind: "operating", amount_ngn: 500, description: "Generator fuel" };
        const transactionsBefore = Object.keys(backend.store.state.businessTransactions).length;

        backend.store.failNextWrite("disk full");
        owner.peer.send({ type: "business.action", action: "record_expense", requestId: "exp-1", payload });
        const first = await settle(owner.peer, "exp-1");
        assert.equal(first.code, "business_not_saved", JSON.stringify(first));

        owner.peer.send({ type: "business.action", action: "record_expense", requestId: "exp-1", payload });
        const retry = await settle(owner.peer, "exp-1");
        assert.equal(retry.type, "business.result", JSON.stringify(retry));
        assert.equal(Object.keys(backend.store.state.businessTransactions).length, transactionsBefore + 1, "one expense is recorded");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("while saving fails, a changing business action is refused before any change; a read is still answered", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Owner", 500_000);
        const businessId = await ownedBusiness(backend, started, owner);
        const cashBefore = cashOf(backend.store.state, owner.characterId);

        backend.store.failNextWrite("disk full");
        owner.peer.send({ type: "business.action", action: "contribute_capital", requestId: "gate-a", payload: { business_id: businessId, amount_ngn: 1_000 } });
        await settle(owner.peer, "gate-a");

        const liveBefore = JSON.stringify(backend.store.state.businesses[businessId]);
        owner.peer.send({ type: "business.action", action: "contribute_capital", requestId: "gate-b", payload: { business_id: businessId, amount_ngn: 2_000 } });
        const refused = await settle(owner.peer, "gate-b");
        assert.equal(refused.code, "business_persistence_unavailable");
        assert.equal(JSON.stringify(backend.store.state.businesses[businessId]), liveBefore, "the refused change changed nothing");
        assert.equal(cashOf(backend.store.state, owner.characterId), cashBefore - 1_000, "only the first change is in memory");

        owner.peer.send({ type: "business.action", action: "discover", requestId: "gate-read" });
        const read = await settle(owner.peer, "gate-read");
        assert.equal(read.type, "business.result", "a read is not paused by the save gate");
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
