// Socket-level tests for the changing property actions other than purchase (Stage 35). Every action goes through the
// same gate (request ID, duplicate, reuse, save outcome, restart) as purchase, on every configured backend (file always;
// PostgreSQL when it is live). The conflict tests send two requests at once on separate sockets.
//
// For each action the tests check: a valid request is confirmed after its save and its effect is stored once; refused
// requests change nothing, live or stored; a repeat is a duplicate and a reused ID with another payload is refused;
// a save known to have failed is property_not_saved, and the retry applies once with no second charge; a save that may
// have committed is property_outcome_unknown, and the retry does not charge again; a confirmed change survives a restart
// and its retry is a duplicate.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends } from "./support/creation-backends.mjs";
import { activeOwnersOf, balanceOf, propertyContent } from "./support/property-world.mjs";
import { inWorld, live, listingFor, market, player, refusal, restart, resumed, saleFor, setCash, settle, stored } from "./support/property-socket.mjs";

before(connectBackends);
after(disconnectBackends);

const message = (action, requestId, payload) => ({ type: "property.action", action, requestId, payload });

/** Sends a setup request and requires its success. Setup requests have their own IDs and are not under test. */
async function ok(actor, requestId, action, payload) {
  actor.peer.send(message(action, requestId, payload));
  const reply = await settle(actor.peer, requestId);
  assert.equal(reply.type, "property.result", `setup ${action}: ${JSON.stringify(reply)}`);
  return reply;
}

/** `owner` buys a flat from the market. `other` and `third` are players with cash, and are not involved yet. */
async function ownedWorld(world) {
  const owner = await player(world, "Owner", 50_000_000);
  const other = await player(world, "Other", 50_000_000);
  const third = await player(world, "Third", 50_000_000);
  const sale = saleFor(await market(owner.peer), live(world));
  await ok(owner, "setup-buy", "purchase", { listing_id: sale.listing_id });
  return { owner, other, third, property_id: sale.property_id };
}

/** `owner` lists the property for rent, and `other` rents it. Returns the agreement ID. */
async function rentedWorld(world) {
  const ctx = await ownedWorld(world);
  await ok(ctx.owner, "setup-rent-listing", "list_for_rent", { property_id: ctx.property_id, rent_price_ngn: 100_000, deposit_ngn: 0 });
  const listing = listingFor(await market(ctx.other.peer), ctx.property_id, "rent");
  const reply = await ok(ctx.other, "setup-rent", "rent", { listing_id: listing.listing_id });
  ctx.agreement_id = reply.data.agreement.agreement_id;
  ctx.listing_id = listing.listing_id;
  return ctx;
}

const activeOwnershipsOf = (state, propertyId) => Object.values(state.propertyOwnership)
  .filter((o) => o.property_id === propertyId && o.active);

const furnitureQuantity = (state, propertyId) => Object.values(state.propertyFurnishings)
  .filter((f) => f.property_id === propertyId).reduce((sum, f) => sum + f.quantity, 0);

/**
 * One changing action. `prepare` builds the world; `request` builds one request (variant "alt" has a different payload);
 * `count` counts the effect (it is `before` before the action and `after` after one successful application); `payer`
 * names the character whose cash the action moves; `cost` (if set) is the exact debit of one application.
 */
const SPECS = [
  {
    name: "list_for_sale",
    prepare: ownedWorld,
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.owner,
      message: message("list_for_sale", requestId, { property_id: ctx.property_id, asking_price_ngn: variant === "valid" ? 5_000_000 : 6_000_000 }),
    }),
    count: (state, ctx) => Object.values(state.propertyListings)
      .filter((l) => l.property_id === ctx.property_id && l.listing_type === "sale" && l.available).length,
    before: 0,
    after: 1,
    payer: null,
    refusals: [
      { label: "a stranger cannot list it", code: "property_not_owner", build: (ctx, id) => ({ actor: ctx.other, message: message("list_for_sale", id, { property_id: ctx.property_id, asking_price_ngn: 5_000_000 }) }) },
      { label: "an asking price below the minimum", code: "property_action_invalid", build: (ctx, id) => ({ actor: ctx.owner, message: message("list_for_sale", id, { property_id: ctx.property_id, asking_price_ngn: 1 }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.owner, message: message("list_for_sale", undefined, { property_id: ctx.property_id, asking_price_ngn: 5_000_000 }) }) },
    ],
  },
  {
    name: "list_for_rent",
    prepare: ownedWorld,
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.owner,
      message: message("list_for_rent", requestId, { property_id: ctx.property_id, rent_price_ngn: variant === "valid" ? 100_000 : 200_000, deposit_ngn: 0 }),
    }),
    count: (state, ctx) => Object.values(state.propertyListings)
      .filter((l) => l.property_id === ctx.property_id && l.listing_type === "rent" && l.available).length,
    before: 0,
    after: 1,
    payer: null,
    refusals: [
      { label: "a stranger cannot list it", code: "property_not_owner", build: (ctx, id) => ({ actor: ctx.other, message: message("list_for_rent", id, { property_id: ctx.property_id, rent_price_ngn: 100_000, deposit_ngn: 0 }) }) },
      { label: "a rent below the minimum", code: "property_action_invalid", build: (ctx, id) => ({ actor: ctx.owner, message: message("list_for_rent", id, { property_id: ctx.property_id, rent_price_ngn: 1, deposit_ngn: 0 }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.owner, message: message("list_for_rent", undefined, { property_id: ctx.property_id, rent_price_ngn: 100_000, deposit_ngn: 0 }) }) },
    ],
  },
  {
    name: "rent",
    prepare: async (world) => {
      const ctx = await ownedWorld(world);
      await ok(ctx.owner, "setup-rent-listing", "list_for_rent", { property_id: ctx.property_id, rent_price_ngn: 100_000, deposit_ngn: 0 });
      ctx.listing_id = listingFor(await market(ctx.other.peer), ctx.property_id, "rent").listing_id;
      return ctx;
    },
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.other,
      message: message("rent", requestId, { listing_id: variant === "valid" ? ctx.listing_id : "listing:other" }),
    }),
    count: (state, ctx) => Object.values(state.rentalAgreements)
      .filter((a) => a.property_id === ctx.property_id && a.status === "active").length,
    before: 0,
    after: 1,
    payer: (ctx) => ctx.other.characterId,
    costPositive: true,
    refusals: [
      { label: "the owner cannot rent their own listing", code: "property_cannot_rent_own", build: (ctx, id) => ({ actor: ctx.owner, message: message("rent", id, { listing_id: ctx.listing_id }) }) },
      { label: "an unknown listing", code: "property_listing_not_found", build: (ctx, id) => ({ actor: ctx.other, message: message("rent", id, { listing_id: "listing:missing" }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.other, message: message("rent", undefined, { listing_id: ctx.listing_id }) }) },
      { label: "insufficient funds", code: "property_insufficient_funds", arrange: (world, ctx) => setCash(world, ctx.other.characterId, 0), build: (ctx, id) => ({ actor: ctx.other, message: message("rent", id, { listing_id: ctx.listing_id }) }) },
    ],
  },
  {
    name: "terminate_rental",
    prepare: rentedWorld,
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.other,
      message: message("terminate_rental", requestId, { agreement_id: ctx.agreement_id, reason: variant === "valid" ? "moved out" : "another reason" }),
    }),
    count: (state, ctx) => Object.values(state.rentalAgreements)
      .filter((a) => a.property_id === ctx.property_id && a.status === "active").length,
    before: 1,
    after: 0,
    payer: null,
    refusals: [
      { label: "a stranger cannot end the tenancy", code: "property_unauthorized", build: (ctx, id) => ({ actor: ctx.third, message: message("terminate_rental", id, { agreement_id: ctx.agreement_id }) }) },
      { label: "an unknown agreement", code: "property_agreement_not_found", build: (ctx, id) => ({ actor: ctx.other, message: message("terminate_rental", id, { agreement_id: "agreement:missing" }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.other, message: message("terminate_rental", undefined, { agreement_id: ctx.agreement_id }) }) },
    ],
  },
  {
    name: "maintain",
    prepare: ownedWorld,
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.owner,
      message: message("maintain", requestId, { property_id: ctx.property_id, description: variant === "valid" ? "Fixed the roof" : "Fixed the gate", cost_ngn: 100_000, condition: "good" }),
    }),
    count: (state, ctx) => Object.values(state.propertyMaintenance).filter((m) => m.property_id === ctx.property_id).length,
    before: 0,
    after: 1,
    payer: (ctx) => ctx.owner.characterId,
    cost: 100_000,
    refusals: [
      { label: "a stranger cannot record maintenance", code: "property_not_owner", build: (ctx, id) => ({ actor: ctx.other, message: message("maintain", id, { property_id: ctx.property_id, description: "Fixed the roof", cost_ngn: 100_000, condition: "good" }) }) },
      { label: "a negative cost", code: "property_action_invalid", build: (ctx, id) => ({ actor: ctx.owner, message: message("maintain", id, { property_id: ctx.property_id, description: "Fixed the roof", cost_ngn: -1, condition: "good" }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.owner, message: message("maintain", undefined, { property_id: ctx.property_id, description: "Fixed the roof", cost_ngn: 100_000, condition: "good" }) }) },
      { label: "insufficient funds", code: "property_insufficient_funds", arrange: (world, ctx) => setCash(world, ctx.owner.characterId, 0), build: (ctx, id) => ({ actor: ctx.owner, message: message("maintain", id, { property_id: ctx.property_id, description: "Fixed the roof", cost_ngn: 100_000, condition: "good" }) }) },
    ],
  },
  {
    name: "furnish",
    prepare: ownedWorld,
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.owner,
      message: message("furnish", requestId, { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: variant === "valid" ? 2 : 3 }),
    }),
    count: (state, ctx) => furnitureQuantity(state, ctx.property_id),
    before: 0,
    after: 2,
    payer: (ctx) => ctx.owner.characterId,
    cost: 70_000,
    refusals: [
      { label: "a stranger cannot furnish it", code: "property_not_owner", build: (ctx, id) => ({ actor: ctx.other, message: message("furnish", id, { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: 2 }) }) },
      { label: "an unknown furniture item", code: "property_furniture_not_found", build: (ctx, id) => ({ actor: ctx.owner, message: message("furnish", id, { property_id: ctx.property_id, furniture_id: "furn:missing", quantity: 2 }) }) },
      { label: "a quantity of zero", code: "property_action_invalid", build: (ctx, id) => ({ actor: ctx.owner, message: message("furnish", id, { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: 0 }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.owner, message: message("furnish", undefined, { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: 2 }) }) },
      { label: "insufficient funds", code: "property_insufficient_funds", arrange: (world, ctx) => setCash(world, ctx.owner.characterId, 0), build: (ctx, id) => ({ actor: ctx.owner, message: message("furnish", id, { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: 2 }) }) },
    ],
  },
  {
    name: "remove_furnishing",
    prepare: async (world) => {
      const ctx = await ownedWorld(world);
      const reply = await ok(ctx.owner, "setup-furnish", "furnish", { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: 1 });
      ctx.furnishing_id = reply.data.furnishing.furnishing_id;
      return ctx;
    },
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.owner,
      message: message("remove_furnishing", requestId, { property_id: ctx.property_id, furnishing_id: variant === "valid" ? ctx.furnishing_id : "furnishing:other" }),
    }),
    count: (state, ctx) => furnitureQuantity(state, ctx.property_id),
    before: 1,
    after: 0,
    payer: null,
    refusals: [
      { label: "a stranger cannot remove it", code: "property_not_owner", build: (ctx, id) => ({ actor: ctx.third, message: message("remove_furnishing", id, { property_id: ctx.property_id, furnishing_id: ctx.furnishing_id }) }) },
      { label: "an unknown furnishing", code: "property_furnishing_not_found", build: (ctx, id) => ({ actor: ctx.owner, message: message("remove_furnishing", id, { property_id: ctx.property_id, furnishing_id: "furnishing:missing" }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.owner, message: message("remove_furnishing", undefined, { property_id: ctx.property_id, furnishing_id: ctx.furnishing_id }) }) },
    ],
  },
  {
    name: "transfer",
    prepare: ownedWorld,
    request: (ctx, requestId, variant = "valid") => ({
      actor: ctx.owner,
      message: message("transfer", requestId, { property_id: ctx.property_id, to_character_id: variant === "valid" ? ctx.other.characterId : ctx.third.characterId }),
    }),
    count: (state, ctx) => activeOwnershipsOf(state, ctx.property_id).filter((o) => o.owner_id === ctx.other.characterId).length,
    before: 0,
    after: 1,
    payer: null,
    refusals: [
      { label: "a stranger cannot transfer it", code: "property_not_owner", build: (ctx, id) => ({ actor: ctx.third, message: message("transfer", id, { property_id: ctx.property_id, to_character_id: ctx.other.characterId }) }) },
      { label: "a transfer to oneself", code: "property_transfer_same_character", build: (ctx, id) => ({ actor: ctx.owner, message: message("transfer", id, { property_id: ctx.property_id, to_character_id: ctx.owner.characterId }) }) },
      { label: "an unknown recipient", code: "property_character_not_found", build: (ctx, id) => ({ actor: ctx.owner, message: message("transfer", id, { property_id: ctx.property_id, to_character_id: "character:missing" }) }) },
      { label: "no request ID", code: "request_id_required", build: (ctx) => ({ actor: ctx.owner, message: message("transfer", undefined, { property_id: ctx.property_id, to_character_id: ctx.other.characterId }) }) },
    ],
  },
];

const balanceOfPayer = (state, spec, ctx) => (spec.payer ? balanceOf(state, spec.payer(ctx)) : null);

for (const backendName of backendNames) {
  for (const spec of SPECS) {
    test(`${backendName}: ${spec.name}: a valid request is confirmed after the save, and its effect is stored once`, () => inWorld(backendName, async (world) => {
      const ctx = await spec.prepare(world);
      assert.equal(spec.count(live(world), ctx), spec.before, "premise: the effect is absent before the request");
      const payerBefore = balanceOfPayer(live(world), spec, ctx);
      const { actor, message: request } = spec.request(ctx, `${spec.name}-1`);
      actor.peer.send(request);
      const reply = await settle(actor.peer, `${spec.name}-1`);
      assert.equal(reply.type, "property.result", JSON.stringify(reply));
      assert.equal(spec.count(live(world), ctx), spec.after, "live: applied once");
      assert.equal(spec.count(await stored(world), ctx), spec.after, "stored: applied once");
      assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live");
      if (spec.payer) {
        const spent = payerBefore - balanceOfPayer(live(world), spec, ctx);
        if (spec.cost !== undefined) assert.equal(spent, spec.cost, "the exact price is debited once");
        if (spec.costPositive) assert.ok(spent > 0, "a cost is debited");
        assert.equal(balanceOfPayer(await stored(world), spec, ctx), payerBefore - spent, "stored balance matches");
      }
    }));

    test(`${backendName}: ${spec.name}: refused requests change nothing, live or stored`, () => inWorld(backendName, async (world) => {
      const ctx = await spec.prepare(world);
      for (const [index, refused] of spec.refusals.entries()) {
        if (refused.arrange) await refused.arrange(world, ctx);
        const liveBefore = propertyContent(live(world));
        const storedBefore = propertyContent(await stored(world));
        const { actor, message: request } = refused.build(ctx, `refuse-${spec.name}-${index}`);
        actor.peer.send(request);
        const reply = await refusal(actor.peer, refused.code);
        assert.equal(reply.code, refused.code, refused.label);
        assert.equal(propertyContent(live(world)), liveBefore, `${refused.label}: live unchanged`);
        assert.equal(propertyContent(await stored(world)), storedBefore, `${refused.label}: stored unchanged`);
      }
      assert.equal(spec.count(live(world), ctx), spec.before, "no refusal applied the effect");
    }));

    test(`${backendName}: ${spec.name}: a repeat is a duplicate, and a reused ID with another payload is refused; nothing applies twice`, () => inWorld(backendName, async (world) => {
      const ctx = await spec.prepare(world);
      const requestId = `${spec.name}-repeat`;
      const first = spec.request(ctx, requestId);
      first.actor.peer.send(first.message);
      assert.equal((await settle(first.actor.peer, requestId)).type, "property.result");
      const stateAfterFirst = propertyContent(live(world));
      const payerAfterFirst = balanceOfPayer(live(world), spec, ctx);

      first.actor.peer.send(first.message);
      assert.equal((await settle(first.actor.peer, requestId)).type, "command.duplicate", "a repeat is a duplicate");

      const reused = spec.request(ctx, requestId, "alt");
      reused.actor.peer.send(reused.message);
      assert.equal((await refusal(reused.actor.peer, "property_request_id_reused")).code, "property_request_id_reused");

      assert.equal(propertyContent(live(world)), stateAfterFirst, "live: nothing changed by the repeat or the reuse");
      assert.equal(balanceOfPayer(live(world), spec, ctx), payerAfterFirst, "not charged again");
      assert.equal(spec.count(await stored(world), ctx), spec.after, "stored: applied once");
    }));

    test(`${backendName}: ${spec.name}: a save that fails is property_not_saved; the retry applies once with no second charge`, () => inWorld(backendName, async (world) => {
      const ctx = await spec.prepare(world);
      const requestId = `${spec.name}-unsaved`;
      const request = spec.request(ctx, requestId);
      world.backend.store.failNextWrite("disk full");
      request.actor.peer.send(request.message);
      assert.equal((await refusal(request.actor.peer, "property_not_saved")).type, "property.error");
      assert.equal(spec.count(await stored(world), ctx), spec.before, "storage holds no change");
      const payerAfterFailure = balanceOfPayer(live(world), spec, ctx);

      request.actor.peer.send(request.message);
      assert.equal((await settle(request.actor.peer, requestId)).type, "property.result", "the retry confirms the pending change");
      assert.equal(spec.count(live(world), ctx), spec.after, "live: applied once");
      assert.equal(spec.count(await stored(world), ctx), spec.after, "stored: applied once");
      assert.equal(balanceOfPayer(live(world), spec, ctx), payerAfterFailure, "the retry did not charge again");
      assert.equal(balanceOfPayer(await stored(world), spec, ctx), payerAfterFailure, "stored balance matches");
    }));

    test(`${backendName}: ${spec.name}: a save that may have committed is property_outcome_unknown; the retry does not apply twice`, () => inWorld(backendName, async (world) => {
      const ctx = await spec.prepare(world);
      const requestId = `${spec.name}-unknown`;
      const request = spec.request(ctx, requestId);
      world.backend.store.failNextWriteAfterCommit("reply lost");
      request.actor.peer.send(request.message);
      assert.equal((await refusal(request.actor.peer, "property_outcome_unknown")).type, "property.error");
      assert.equal(spec.count(await stored(world), ctx), spec.after, "the committed change is in storage");
      const payerAfterCommit = balanceOfPayer(live(world), spec, ctx);

      request.actor.peer.send(request.message);
      assert.equal((await settle(request.actor.peer, requestId)).type, "property.result", "the retry confirms the change");
      assert.equal(spec.count(live(world), ctx), spec.after, "live: applied once");
      assert.equal(spec.count(await stored(world), ctx), spec.after, "stored: applied once");
      assert.equal(balanceOfPayer(live(world), spec, ctx), payerAfterCommit, "the retry did not charge again");
      assert.equal(balanceOfPayer(await stored(world), spec, ctx), payerAfterCommit, "stored balance matches");
    }));

    test(`${backendName}: ${spec.name}: after a restart a confirmed change is kept, and its retry is a duplicate`, () => inWorld(backendName, async (world) => {
      const ctx = await spec.prepare(world);
      const requestId = `${spec.name}-restart`;
      const request = spec.request(ctx, requestId);
      request.actor.peer.send(request.message);
      assert.equal((await settle(request.actor.peer, requestId)).type, "property.result");
      const payerConfirmed = balanceOfPayer(live(world), spec, ctx);

      const token = request.actor.sessionToken;
      await request.actor.peer.close();
      await restart(world);
      const again = await resumed(world, token);
      request.actor.peer = again;
      try {
        assert.equal(spec.count(await stored(world), ctx), spec.after, "stored after the restart");
        assert.equal(balanceOfPayer(await stored(world), spec, ctx), payerConfirmed, "the saved charge survived");
        request.actor.peer.send(request.message);
        assert.equal((await settle(again, requestId)).type, "command.duplicate", "the retry is a duplicate");
        assert.equal(spec.count(live(world), ctx), spec.after, "live: applied once");
        assert.equal(balanceOfPayer(live(world), spec, ctx), payerConfirmed, "not charged again");
      } finally {
        await again.close();
      }
    }));
  }

  // Conflicts: two requests on separate sockets, sent back to back. Exactly one applies, and the money agrees.

  test(`${backendName}: a transfer and a purchase of one listed property: exactly one applies, one active owner, and the money agrees`, () => inWorld(backendName, async (world) => {
    const ctx = await ownedWorld(world);
    await ok(ctx.owner, "setup-list", "list_for_sale", { property_id: ctx.property_id, asking_price_ngn: 5_000_000 });
    const listing = listingFor(await market(ctx.other.peer), ctx.property_id, "sale");
    const before = { owner: balanceOf(live(world), ctx.owner.characterId), buyer: balanceOf(live(world), ctx.other.characterId), third: balanceOf(live(world), ctx.third.characterId) };

    ctx.other.peer.send(message("purchase", "race-buy", { listing_id: listing.listing_id }));
    ctx.owner.peer.send(message("transfer", "race-transfer", { property_id: ctx.property_id, to_character_id: ctx.third.characterId }));
    const [buy, transfer] = await Promise.all([settle(ctx.other.peer, "race-buy"), settle(ctx.owner.peer, "race-transfer")]);
    const applied = [buy, transfer].filter((reply) => reply.type === "property.result");
    assert.equal(applied.length, 1, JSON.stringify([buy, transfer]));

    const owners = activeOwnersOf(live(world), ctx.property_id);
    assert.equal(owners.length, 1, "one active owner");
    const after = { owner: balanceOf(live(world), ctx.owner.characterId), buyer: balanceOf(live(world), ctx.other.characterId), third: balanceOf(live(world), ctx.third.characterId) };
    if (buy.type === "property.result") {
      assert.equal(transfer.code, "property_not_owner", "the transfer lost to the completed sale");
      assert.deepEqual(owners, [ctx.other.characterId]);
      assert.equal(before.buyer - after.buyer, listing.asking_price_ngn, "the buyer paid the price once");
      assert.equal(after.owner - before.owner, listing.asking_price_ngn, "the seller received the same amount");
      assert.equal(after.third, before.third);
    } else {
      assert.equal(buy.code, "property_listing_unavailable", "the purchase lost to the transfer, which closed the listing");
      assert.deepEqual(owners, [ctx.third.characterId]);
      assert.equal(after.buyer, before.buyer, "the buyer was not charged");
      assert.equal(after.owner, before.owner, "no money moved on a transfer");
    }
    assert.deepEqual(activeOwnersOf(await stored(world), ctx.property_id), owners, "stored owner matches live");
    assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: two tenants rent one listing at once: exactly one agreement, and only its tenant is charged`, () => inWorld(backendName, async (world) => {
    const ctx = await ownedWorld(world);
    await ok(ctx.owner, "setup-rent-listing", "list_for_rent", { property_id: ctx.property_id, rent_price_ngn: 100_000, deposit_ngn: 0 });
    const listing = listingFor(await market(ctx.other.peer), ctx.property_id, "rent");
    const before = { owner: balanceOf(live(world), ctx.owner.characterId), other: balanceOf(live(world), ctx.other.characterId), third: balanceOf(live(world), ctx.third.characterId) };

    ctx.other.peer.send(message("rent", "race-rent-a", { listing_id: listing.listing_id }));
    ctx.third.peer.send(message("rent", "race-rent-b", { listing_id: listing.listing_id }));
    const [a, b] = await Promise.all([settle(ctx.other.peer, "race-rent-a"), settle(ctx.third.peer, "race-rent-b")]);
    const applied = [a, b].filter((reply) => reply.type === "property.result");
    assert.equal(applied.length, 1, JSON.stringify([a, b]));
    const loser = a.type === "property.result" ? b : a;
    assert.equal(loser.code, "property_listing_unavailable", "the second tenant is refused");

    const agreements = Object.values(live(world).rentalAgreements).filter((r) => r.property_id === ctx.property_id && r.status === "active");
    assert.equal(agreements.length, 1, "exactly one active agreement");
    const winner = agreements[0].tenant_id;
    const after = { owner: balanceOf(live(world), ctx.owner.characterId), other: balanceOf(live(world), ctx.other.characterId), third: balanceOf(live(world), ctx.third.characterId) };
    const paid = before.other - after.other + (before.third - after.third);
    assert.ok(paid > 0, "the winning tenant paid");
    assert.equal(winner === ctx.other.characterId ? before.third - after.third : before.other - after.other, 0, "the loser paid nothing");
    assert.equal(after.owner - before.owner, paid, "the landlord received what the tenant paid");
    assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: two furnishing orders at once with cash for one: one applies, and the cash never goes negative`, () => inWorld(backendName, async (world) => {
    const ctx = await ownedWorld(world);
    await setCash(world, ctx.owner.characterId, 100_000);
    ctx.owner.peer.send(message("furnish", "race-furnish-a", { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: 2 }));
    ctx.owner.peer.send(message("furnish", "race-furnish-b", { property_id: ctx.property_id, furniture_id: "furn:bed-single", quantity: 2 }));
    const [a, b] = await Promise.all([settle(ctx.owner.peer, "race-furnish-a"), settle(ctx.owner.peer, "race-furnish-b")]);
    const applied = [a, b].filter((reply) => reply.type === "property.result");
    assert.equal(applied.length, 1, JSON.stringify([a, b]));
    const refused = a.type === "property.result" ? b : a;
    assert.equal(refused.code, "property_insufficient_funds");
    assert.equal(balanceOf(live(world), ctx.owner.characterId), 30_000, "live: one order paid, the rest kept");
    assert.equal(balanceOf(await stored(world), ctx.owner.characterId), 30_000, "stored: one order paid");
    assert.equal(furnitureQuantity(live(world), ctx.property_id), 2, "one order placed");
    assert.equal(furnitureQuantity(await stored(world), ctx.property_id), 2, "stored: one order placed");
  }));
}

// Stale listings (Stage 35). Before the fix, a purchase closed only the listing it named, so a rent listing made by the
// previous owner stayed open, and a transfer closed only one open listing. A rent of such a listing was accepted, and
// the rent was paid to a landlord who no longer owned the property.
for (const backendName of backendNames) {
  test(`${backendName}: a purchase closes the previous owner's open rent listing, which then cannot be rented`, () => inWorld(backendName, async (world) => {
    const buyer = await player(world, "Buyer", 50_000_000);
    const third = await player(world, "Third", 50_000_000);
    const listings = await market(buyer.peer);
    const sale = saleFor(listings, live(world));
    const stale = listings.find((l) => l.property_id === sale.property_id && l.listing_type === "rent");
    assert.ok(stale, "premise: the property has an open rent listing by its previous owner");

    await ok(buyer, "setup-buy", "purchase", { listing_id: sale.listing_id });
    assert.equal((await market(third.peer)).some((l) => l.listing_id === stale.listing_id), false, "the stale rent listing is no longer offered");

    const before = balanceOf(live(world), third.characterId);
    third.peer.send(message("rent", "stale-rent", { listing_id: stale.listing_id }));
    assert.equal((await refusal(third.peer, "property_listing_unavailable")).code, "property_listing_unavailable");
    assert.equal(balanceOf(live(world), third.characterId), before, "the refused renter is not charged");
    assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: a transfer closes every open listing of the property, sale and rent`, () => inWorld(backendName, async (world) => {
    const ctx = await ownedWorld(world);
    await ok(ctx.owner, "setup-list-sale", "list_for_sale", { property_id: ctx.property_id, asking_price_ngn: 5_000_000 });
    await ok(ctx.owner, "setup-list-rent", "list_for_rent", { property_id: ctx.property_id, rent_price_ngn: 100_000, deposit_ngn: 0 });
    const open = (await market(ctx.third.peer)).filter((l) => l.property_id === ctx.property_id);
    assert.equal(open.length, 2, "premise: a sale and a rent listing are open");
    const rentListing = open.find((l) => l.listing_type === "rent");

    await ok(ctx.owner, "setup-transfer", "transfer", { property_id: ctx.property_id, to_character_id: ctx.other.characterId });
    assert.equal((await market(ctx.third.peer)).filter((l) => l.property_id === ctx.property_id).length, 0, "no listing survives the transfer");
    assert.equal(Object.values(live(world).propertyListings).filter((l) => l.property_id === ctx.property_id && l.available).length, 0);

    const before = balanceOf(live(world), ctx.third.characterId);
    ctx.third.peer.send(message("rent", "after-transfer", { listing_id: rentListing.listing_id }));
    assert.equal((await refusal(ctx.third.peer, "property_listing_unavailable")).code, "property_listing_unavailable");
    assert.equal(balanceOf(live(world), ctx.third.characterId), before, "not charged");
  }));

  test(`${backendName}: an open listing whose owner is no longer the owner is closed on load, and cannot be rented`, () => inWorld(backendName, async (world) => {
    const ctx = await ownedWorld(world);
    await ok(ctx.owner, "setup-rent-listing", "list_for_rent", { property_id: ctx.property_id, rent_price_ngn: 100_000, deposit_ngn: 0 });
    const listing = listingFor(await market(ctx.third.peer), ctx.property_id, "rent");
    // A stale record, as a save written before the fix would hold it: the listing names someone who no longer owns it.
    live(world).propertyListings[listing.listing_id].owner_id = "npc-landlord-former";
    await world.backend.store.flush();

    await restart(world);
    const third = await resumed(world, ctx.third.sessionToken);
    try {
      assert.equal((await market(third)).some((l) => l.listing_id === listing.listing_id), false, "closed on load");
      const before = balanceOf(live(world), ctx.third.characterId);
      third.send(message("rent", "stale-on-load", { listing_id: listing.listing_id }));
      assert.equal((await refusal(third, "property_listing_unavailable")).code, "property_listing_unavailable");
      assert.equal(balanceOf(live(world), ctx.third.characterId), before, "not charged");
    } finally {
      await third.close();
    }
  }));
}

// Rent payment (Stage 35). pay_rent is suspended (property_rent_payment_suspended) until its money route is made safe.
// Socket tests here check that the refusal changes nothing, and that it cannot race a termination into a payment.
for (const backendName of backendNames) {
  test(`${backendName}: pay_rent is refused while suspended, and changes no money, agreement, or payment row`, () => inWorld(backendName, async (world) => {
    const ctx = await rentedWorld(world);
    const before = { tenant: balanceOf(live(world), ctx.other.characterId), landlord: balanceOf(live(world), ctx.owner.characterId), payments: Object.keys(live(world).rentalPayments).length };

    ctx.other.peer.send(message("pay_rent", "pay-1", { agreement_id: ctx.agreement_id }));
    const refused = await settle(ctx.other.peer, "pay-1");
    assert.equal(refused.type, "property.error");
    assert.equal(refused.code, "property_rent_payment_suspended");
    assert.equal(refused.action, "pay_rent");

    assert.equal(balanceOf(live(world), ctx.other.characterId), before.tenant, "tenant not charged");
    assert.equal(balanceOf(live(world), ctx.owner.characterId), before.landlord, "landlord not credited");
    assert.equal(Object.keys(live(world).rentalPayments).length, before.payments, "no payment row");
    assert.equal(live(world).rentalAgreements[ctx.agreement_id].status, "active", "agreement still active");
    assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: a termination and a pay_rent sent together: the termination applies once, and the payment never applies`, () => inWorld(backendName, async (world) => {
    const ctx = await rentedWorld(world);
    const before = { tenant: balanceOf(live(world), ctx.other.characterId), landlord: balanceOf(live(world), ctx.owner.characterId), payments: Object.keys(live(world).rentalPayments).length };

    ctx.other.peer.send(message("terminate_rental", "race-end", { agreement_id: ctx.agreement_id, reason: "moved out" }));
    ctx.other.peer.send(message("pay_rent", "race-pay", { agreement_id: ctx.agreement_id }));
    const [ended, paid] = await Promise.all([settle(ctx.other.peer, "race-end"), settle(ctx.other.peer, "race-pay")]);
    assert.equal(ended.type, "property.result", JSON.stringify(ended));
    assert.equal(paid.type, "property.error");
    assert.equal(paid.code, "property_rent_payment_suspended");

    assert.equal(live(world).rentalAgreements[ctx.agreement_id].status, "terminated", "terminated once");
    assert.equal(balanceOf(live(world), ctx.other.characterId), before.tenant, "tenant not charged");
    assert.equal(balanceOf(live(world), ctx.owner.characterId), before.landlord, "landlord not credited");
    assert.equal(Object.keys(live(world).rentalPayments).length, before.payments, "no new payment row");
    assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live");
  }));
}
