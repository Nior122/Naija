// Stage 44: business error replies seen through the Godot client.
//
//   1. A business request that fails validation (for example a restock of zero units) was answered with the economy
//      fallback text ("The economy request could not be completed."), because businessErrorMessage fell through to
//      economyErrorMessage, which always returns text. Business codes now get business wording, and the two codes the
//      server emits without a map entry (business_action_invalid, business_action_unknown) have messages.
//   2. A refused command (the 20-per-10-seconds limit, which counts session.resume too) is answered with a generic
//      "error" carrying the request ID and code rate_limited, not with business.error. The client must resolve the
//      pending business request from that reply. This file checks the server side of that contract: the reply shape,
//      and that a refused business change applies nothing.
//
// Part 1 tests the message map directly. Parts 2 and 3 run through the socket on each configured backend.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";
import { businessAccountKey, businessErrorMessage } from "../dist/businesses/service.js";

before(connectBackends);
after(disconnectBackends);

// ---------------------------------------------------------------------------------------------------------------------
// Part 1: message map.
// ---------------------------------------------------------------------------------------------------------------------

test("a validation failure on a business action gets business wording, not economy wording", () => {
  const message = businessErrorMessage("business_action_invalid");
  assert.equal(message, "A value in this business request is missing or outside the allowed range. Nothing was changed.");
  assert.doesNotMatch(message, /economy/i);
  assert.equal(businessErrorMessage("business_action_unknown"), "The server does not support this business action. Nothing was changed.");
});

test("an unmapped business code gets the business fallback, and an economy code keeps the economy text", () => {
  assert.equal(businessErrorMessage("business_code_that_has_no_entry"), "The business request could not be completed.");
  assert.equal(businessErrorMessage("economy_code_that_has_no_entry"), "The economy request could not be completed.");
  assert.equal(businessErrorMessage("economy_salary_balance_limit"), "The account cannot accept this salary payment.");
});

// ---------------------------------------------------------------------------------------------------------------------
// Parts 2 and 3: through the socket, on each backend.
// ---------------------------------------------------------------------------------------------------------------------

const cashOf = (state, characterId) => Object.values(state.economyAccounts)
  .find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;
const accountOf = (state, businessId) => state.economyAccounts[businessAccountKey(businessId)].balance_ngn;
const stockOf = (state, businessId, definitionId) => Object.values(state.businessInventory)
  .filter((item) => item.business_id === businessId && item.product_definition_id === definitionId)
  .reduce((sum, item) => sum + item.quantity, 0);

/** A citizen with money in hand, as business-client-stage41.test.mjs creates them. */
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
  return { peer, characterId: player.character.character_id };
}

/** The first reply for this request ID, including a generic error that carries the ID. */
const settle = (peer, requestId) => peer.waitFor(
  (message) => message.requestId === requestId
    && ["business.result", "business.error", "command.duplicate", "error"].includes(message.type),
  20000,
);

async function businessAction(peer, action, payload) {
  const requestId = `${action}-${randomUUID()}`;
  peer.send({ type: "business.action", action, requestId, payload });
  return settle(peer, requestId);
}

for (const backendName of backendNames) {
  describe(`business error replies over the socket (${backendName} backend)`, () => {
    test("a restock of zero units is refused with business wording, and no stock or money moves", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Grocer", 500_000);
        const created = await businessAction(owner.peer, "create", {
          template_id: "template:provision-store", name: "Error Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 50_000,
        });
        assert.equal(created.type, "business.result", JSON.stringify(created));
        const businessId = created.data.business.business_id;
        const added = await businessAction(owner.peer, "add_product", { business_id: businessId, product_definition_id: "biz-goods:rice-5kg" });
        assert.equal(added.type, "business.result", JSON.stringify(added));

        const cashBefore = cashOf(backend.store.state, owner.characterId);
        const accountBefore = accountOf(backend.store.state, businessId);
        const stockBefore = stockOf(backend.store.state, businessId, "biz-goods:rice-5kg");

        const refused = await businessAction(owner.peer, "restock", {
          business_id: businessId, product_definition_id: "biz-goods:rice-5kg", quantity: 0, unit_cost_ngn: 1000,
        });
        assert.equal(refused.type, "business.error", JSON.stringify(refused));
        assert.equal(refused.code, "business_action_invalid");
        assert.equal(refused.message, businessErrorMessage("business_action_invalid"));
        assert.doesNotMatch(refused.message, /economy/i);
        assert.equal(cashOf(backend.store.state, owner.characterId), cashBefore);
        assert.equal(accountOf(backend.store.state, businessId), accountBefore);
        assert.equal(stockOf(backend.store.state, businessId, "biz-goods:rice-5kg"), stockBefore);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });

    test("a business change refused by the command limit gets a generic error with its request ID, and applies nothing", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      try {
        const owner = await citizen(backend, started, "Limited", 500_000);
        // identity.create, session.resume and every command count toward the limit, so the number of reads that fill
        // the window is not fixed. Send reads until the server refuses one (the limit is 20 per 10 seconds).
        let reads = 0;
        for (; reads < 40; reads += 1) {
          const requestId = `discover-${randomUUID()}`;
          owner.peer.send({ type: "business.action", action: "discover", requestId, payload: {} });
          const reply = await settle(owner.peer, requestId);
          if (reply.type === "error") {
            assert.equal(reply.code, "rate_limited", JSON.stringify(reply));
            assert.equal(reply.requestId, requestId);
            break;
          }
          assert.equal(reply.type, "business.result", `read ${reads}: ${JSON.stringify(reply)}`);
        }
        assert.ok(reads < 40, "the command limit is reached within 40 reads");
        const requestId = `create-${randomUUID()}`;
        const cashBefore = cashOf(backend.store.state, owner.characterId);
        const businessesBefore = Object.keys(backend.store.state.businesses).length;
        owner.peer.send({
          type: "business.action", action: "create", requestId,
          payload: { template_id: "template:provision-store", name: "Refused Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 50_000 },
        });
        const refused = await settle(owner.peer, requestId);
        assert.equal(refused.type, "error", JSON.stringify(refused));
        assert.equal(refused.code, "rate_limited");
        assert.equal(refused.requestId, requestId);
        assert.equal(cashOf(backend.store.state, owner.characterId), cashBefore);
        assert.equal(Object.keys(backend.store.state.businesses).length, businessesBefore);
      } finally {
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
