// Stage 43: socket helpers for the business lifecycle tests. They use the same harness as the Stage 40 and Stage 41
// business tests (creation-backends.mjs and harness.mjs). They are kept here so that the lifecycle file does not copy
// them a third time.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessAccountKey } from "../../dist/businesses/service.js";
import { createIdentity, resumeSession } from "./harness.mjs";
import { openPeerFrom } from "./creation-backends.mjs";

export const cashOf = (state, characterId) =>
  Object.values(state.economyAccounts).find((a) => a.kind === "cash" && a.character_id === characterId).balance_ngn;

export const accountOf = (state, businessId) => state.economyAccounts[businessAccountKey(businessId)].balance_ngn;

export const stockOf = (state, businessId, definitionId) =>
  Object.values(state.businessInventory).find((inv) => inv.business_id === businessId && inv.product_definition_id === definitionId)?.quantity ?? null;

/** A citizen with the given cash, created over the socket and resumed on it. */
export async function citizen(backend, started, name, money) {
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

/** The first reply for this request ID: a result, a refusal, or a duplicate notice. */
export function settle(peer, requestId, types = ["business.result", "business.error", "command.duplicate"]) {
  return peer.waitFor((message) => message.requestId === requestId && types.includes(message.type), 20000);
}

/** Sends one business.action with a fresh request ID and returns the first reply for it. */
export async function businessAction(peer, action, payload, requestId = `${action}-${randomUUID()}`) {
  peer.send({ type: "business.action", action, requestId, payload });
  return settle(peer, requestId);
}

/**
 * Closes this citizen's connection and resumes on a new one, and returns the session.ready snapshot. The server refuses a
 * second connection for an identity that is still connected, so the old connection is closed first.
 */
export async function reconnect(started, record) {
  await record.peer.close();
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const ready = await resumeSession(peer, record.sessionToken);
  assert.equal(ready.type, "session.ready", JSON.stringify(ready));
  record.peer = peer;
  return ready;
}

/** Waits until the saved world (the durable copy) satisfies the predicate. */
export async function savedUntil(backend, predicate) {
  const started = Date.now();
  for (;;) {
    const state = await backend.durableState();
    if (predicate(state)) return state;
    if (Date.now() - started > 4000) throw new Error("The saved world did not reach the expected value.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Creates a provision store over the socket and returns its business ID. */
export async function createShop(owner, label = "Lifecycle Shop", capital = 50_000) {
  const created = await businessAction(owner.peer, "create", {
    template_id: "template:provision-store", name: label, description: "A shop.", location_id: "market", initial_capital_ngn: capital,
  });
  assert.equal(created.type, "business.result", JSON.stringify(created));
  return created.data.business.business_id;
}

/** Lists rice, restocks it, and returns the listing's record ID. */
export async function stockedRice(owner, businessId, units = 10, unitCost = 1000) {
  const added = await businessAction(owner.peer, "add_product", { business_id: businessId, product_definition_id: "biz-goods:rice-5kg" });
  assert.equal(added.type, "business.result", JSON.stringify(added));
  const restocked = await businessAction(owner.peer, "restock", {
    business_id: businessId, product_definition_id: "biz-goods:rice-5kg", quantity: units, unit_cost_ngn: unitCost,
  });
  assert.equal(restocked.type, "business.result", JSON.stringify(restocked));
  return added.data.product.product_record_id;
}
