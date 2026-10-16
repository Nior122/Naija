// Property mutations over the real socket, on every configured backend (file always; PostgreSQL when it is live) (Stage 35).
//
// The contract under test (see docs/STAGE_35_PROPERTY_MUTATION_SAFETY_AND_FILE_PERSISTENCE.md):
//   - a changing property action needs a request ID; a refused request changes nothing, in memory or in storage;
//   - its success reply (property.result) is sent only after a save covers the change;
//   - a save known to have failed is property_not_saved; a save that may have committed is property_outcome_unknown;
//     the retry with the same request ID is answered once and applies at most once;
//   - a repeat of a recorded request is command.duplicate; the same request ID with a different action or payload is
//     property_request_id_reused, and nothing changes;
//   - concurrent duplicates and conflicting purchases apply at most once;
//   - a restart keeps the confirmed change, the request record, and the one-time treasury funding rows (never recreated).
// Every test uses its own world. Refusals are compared with the live state and the stored state, field by field.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, startOver } from "./support/creation-backends.mjs";
import { activeOwnersOf, balanceOf, propertyContent } from "./support/property-world.mjs";
import { fundingRows, live, market, openWorld, player, purchase, restart, resumed, saleFor, settle, stored, STARTUP } from "./support/property-socket.mjs";

before(connectBackends);
after(disconnectBackends);

for (const backendName of backendNames) {
  test(`${backendName}: a purchase is confirmed after the save: the debit, the single active owner, and the stored record agree`, async () => {
    const world = await openWorld(backendName);
    let buyer;
    try {
      buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);
      purchase(buyer.peer, "buy-1", sale.listing_id);
      const reply = await settle(buyer.peer, "buy-1");
      assert.equal(reply.type, "property.result", JSON.stringify(reply));
      assert.equal(reply.ok, true);
      assert.equal(before - balanceOf(live(world), buyer.characterId), sale.asking_price_ngn, "the buyer is debited the price once");
      assert.deepEqual(activeOwnersOf(live(world), sale.property_id), [buyer.characterId]);
      // The reply means the save covered the change: the stored record already has it.
      assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored state matches live state");
    } finally {
      await buyer?.peer.close();
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: refusals (insufficient funds, unavailable listing, invalid price, not owner, no request ID) change nothing, live or stored`, async () => {
    const world = await openWorld(backendName);
    try {
      const rich = await player(world, "Rich", 50_000_000);
      const poor = await player(world, "Poor", 10);
      const sale = saleFor(await market(rich.peer), live(world));

      // Insufficient funds.
      let before = propertyContent(live(world));
      let storedBefore = propertyContent(await stored(world));
      purchase(poor.peer, "poor-1", sale.listing_id);
      let reply = await settle(poor.peer, "poor-1");
      assert.equal(reply.code, "property_insufficient_funds", JSON.stringify(reply));
      assert.equal(propertyContent(live(world)), before, "live: nothing changed");
      assert.equal(propertyContent(await stored(world)), storedBefore, "stored: nothing changed");

      // Not owner: a stranger cannot list a property they do not own.
      before = propertyContent(live(world));
      rich.peer.send({ type: "property.action", action: "list_for_sale", requestId: "list-stranger", payload: { property_id: sale.property_id, asking_price_ngn: 1_000_000 } });
      reply = await settle(rich.peer, "list-stranger");
      assert.equal(reply.code, "property_not_owner", JSON.stringify(reply));
      assert.equal(propertyContent(live(world)), before, "live: nothing changed");

      // No request ID on a changing action.
      before = propertyContent(live(world));
      rich.peer.send({ type: "property.action", action: "purchase", payload: { listing_id: sale.listing_id } });
      reply = await rich.peer.waitFor((message) => message.type === "property.error" && message.code === "request_id_required", 20000);
      assert.equal(propertyContent(live(world)), before, "live: nothing changed without a request ID");

      // Invalid price: a listing whose asking price is outside the rules (set in memory, as corrupt data would be).
      const badListing = live(world).propertyListings[sale.listing_id];
      badListing.asking_price_ngn = 1;
      before = propertyContent(live(world));
      purchase(rich.peer, "badprice-1", sale.listing_id);
      reply = await settle(rich.peer, "badprice-1");
      assert.equal(reply.code, "property_price_invalid", JSON.stringify(reply));
      assert.equal(propertyContent(live(world)), before, "live: nothing changed");
      badListing.asking_price_ngn = sale.asking_price_ngn;

      // Unavailable: the first buyer takes the listing; a second buyer is refused and not charged.
      const other = await player(world, "Other", 50_000_000);
      purchase(rich.peer, "first-1", sale.listing_id);
      assert.equal((await settle(rich.peer, "first-1")).type, "property.result");
      const otherBefore = balanceOf(live(world), other.characterId);
      before = propertyContent(live(world));
      purchase(other.peer, "second-1", sale.listing_id);
      reply = await settle(other.peer, "second-1");
      assert.equal(reply.code, "property_listing_unavailable", JSON.stringify(reply));
      assert.equal(balanceOf(live(world), other.characterId), otherBefore, "the second buyer is not charged");
      assert.equal(propertyContent(live(world)), before, "live: nothing changed");
      await other.peer.close();
    } finally {
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: a retry with the same request ID and payload is a duplicate, and is charged once`, async () => {
    const world = await openWorld(backendName);
    try {
      const buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);
      purchase(buyer.peer, "dup-1", sale.listing_id);
      assert.equal((await settle(buyer.peer, "dup-1")).type, "property.result");
      const afterFirst = balanceOf(live(world), buyer.characterId);
      purchase(buyer.peer, "dup-1", sale.listing_id);
      const reply = await settle(buyer.peer, "dup-1");
      assert.equal(reply.type, "command.duplicate", JSON.stringify(reply));
      assert.equal(balanceOf(live(world), buyer.characterId), afterFirst, "not charged again");
      assert.equal(before - afterFirst, sale.asking_price_ngn);
      assert.equal(balanceOf(await stored(world), buyer.characterId), afterFirst, "stored: charged once");
      await buyer.peer.close();
    } finally {
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: the same request ID with a different payload is refused and never replays the earlier result`, async () => {
    const world = await openWorld(backendName);
    try {
      const buyer = await player(world, "Buyer", 50_000_000);
      const listings = await market(buyer.peer);
      const sale = saleFor(listings, live(world));
      purchase(buyer.peer, "reuse-1", sale.listing_id);
      assert.equal((await settle(buyer.peer, "reuse-1")).type, "property.result");
      const before = propertyContent(live(world));
      // Same ID, different request: a listing for sale of a property the buyer owns.
      const owned = Object.values(live(world).propertyOwnership).find((o) => o.owner_id === buyer.characterId && o.active);
      buyer.peer.send({ type: "property.action", action: "list_for_sale", requestId: "reuse-1", payload: { property_id: owned.property_id, asking_price_ngn: 1_000_000 } });
      const reply = await settle(buyer.peer, "reuse-1");
      assert.equal(reply.type, "property.error", JSON.stringify(reply));
      assert.equal(reply.code, "property_request_id_reused");
      assert.equal(propertyContent(live(world)), before, "nothing changed");
      await buyer.peer.close();
    } finally {
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: concurrent duplicates (the same request sent twice at once) apply at most once`, async () => {
    const world = await openWorld(backendName);
    try {
      const buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);
      purchase(buyer.peer, "twice-1", sale.listing_id);
      purchase(buyer.peer, "twice-1", sale.listing_id);
      // Two replies for the same request ID: the first change is confirmed once, and the second copy is a duplicate.
      const messages = [await settle(buyer.peer, "twice-1"), await settle(buyer.peer, "twice-1")];
      const results = messages.filter((message) => message.type === "property.result");
      const duplicates = messages.filter((message) => message.type === "command.duplicate");
      assert.equal(results.length, 1, JSON.stringify(messages));
      assert.equal(duplicates.length, 1, JSON.stringify(messages));
      assert.equal(before - balanceOf(live(world), buyer.characterId), sale.asking_price_ngn, "charged once");
      assert.equal(balanceOf(await stored(world), buyer.characterId), before - sale.asking_price_ngn, "stored: charged once");
      assert.deepEqual(activeOwnersOf(live(world), sale.property_id), [buyer.characterId]);
      await buyer.peer.close();
    } finally {
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: two buyers race for one listing: exactly one purchase applies, and only that buyer is charged`, async () => {
    const world = await openWorld(backendName);
    try {
      const first = await player(world, "First", 50_000_000);
      const second = await player(world, "Second", 50_000_000);
      const sale = saleFor(await market(first.peer), live(world));
      const firstBefore = balanceOf(live(world), first.characterId);
      const secondBefore = balanceOf(live(world), second.characterId);
      purchase(first.peer, "race-a", sale.listing_id);
      purchase(second.peer, "race-b", sale.listing_id);
      const [a, b] = await Promise.all([settle(first.peer, "race-a"), settle(second.peer, "race-b")]);
      const winners = [a, b].filter((reply) => reply.type === "property.result");
      const losers = [a, b].filter((reply) => reply.type === "property.error");
      assert.equal(winners.length, 1, JSON.stringify([a, b]));
      assert.equal(losers.length, 1, JSON.stringify([a, b]));
      assert.equal(losers[0].code, "property_listing_unavailable");
      const charged = [firstBefore - balanceOf(live(world), first.characterId), secondBefore - balanceOf(live(world), second.characterId)];
      assert.deepEqual(charged.sort((x, y) => x - y), [0, sale.asking_price_ngn], "one buyer paid the price, the other paid nothing");
      assert.equal(Object.values(live(world).propertySales).filter((s) => s.listing_id === sale.listing_id).length, 1);
      await first.peer.close();
      await second.peer.close();
    } finally {
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: a save that fails before commit is property_not_saved; the retry with the same request ID applies once`, async () => {
    const world = await openWorld(backendName);
    try {
      const buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);
      const storedBefore = propertyContent(await stored(world));

      world.backend.store.failNextWrite("disk full");
      purchase(buyer.peer, "fail-1", sale.listing_id);
      const failed = await settle(buyer.peer, "fail-1");
      assert.equal(failed.type, "property.error", JSON.stringify(failed));
      assert.equal(failed.code, "property_not_saved", "a save known to have failed is not_saved");
      assert.equal(propertyContent(await stored(world)), storedBefore, "storage holds no change");

      purchase(buyer.peer, "fail-1", sale.listing_id);
      const retry = await settle(buyer.peer, "fail-1");
      assert.equal(retry.type, "property.result", JSON.stringify(retry));
      assert.equal(before - balanceOf(live(world), buyer.characterId), sale.asking_price_ngn, "charged once");
      assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "stored matches live after the retry");
      await buyer.peer.close();
    } finally {
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: a save that commits but loses its reply is property_outcome_unknown; the retry is answered once and charged once`, async () => {
    const world = await openWorld(backendName);
    try {
      const buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);

      world.backend.store.failNextWriteAfterCommit("reply lost");
      purchase(buyer.peer, "unknown-1", sale.listing_id);
      const unknown = await settle(buyer.peer, "unknown-1");
      assert.equal(unknown.type, "property.error", JSON.stringify(unknown));
      assert.equal(unknown.code, "property_outcome_unknown");

      purchase(buyer.peer, "unknown-1", sale.listing_id);
      const retry = await settle(buyer.peer, "unknown-1");
      assert.equal(retry.type, "property.result", JSON.stringify(retry));
      assert.equal(before - balanceOf(live(world), buyer.characterId), sale.asking_price_ngn, "charged once in memory");
      assert.equal(balanceOf(await stored(world), buyer.characterId), before - sale.asking_price_ngn, "charged once in storage");
      await buyer.peer.close();
    } finally {
      await world.started.stop();
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: after a restart, a confirmed purchase is kept, its request ID is a duplicate, and the treasury funding rows are not recreated`, async () => {
    const world = await openWorld(backendName);
    let buyer;
    try {
      buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const funding = fundingRows(live(world));
      assert.ok(funding.length > 0, "premise: the seeded world has one-time treasury funding rows");
      const before = balanceOf(live(world), buyer.characterId);
      purchase(buyer.peer, "restart-1", sale.listing_id);
      assert.equal((await settle(buyer.peer, "restart-1")).type, "property.result");
      const { characterId, sessionToken } = buyer;
      await buyer.peer.close();
      buyer = undefined;

      const restarted = await restart(world);
      try {
        assert.equal(balanceOf(await stored(world), characterId), before - sale.asking_price_ngn, "the confirmed charge survived the restart");
        assert.deepEqual(activeOwnersOf(await stored(world), sale.property_id), [characterId], "the confirmed ownership survived the restart");
        const again = await resumed(restarted, sessionToken);
        try {
          purchase(again, "restart-1", sale.listing_id);
          const duplicate = await settle(again, "restart-1");
          assert.equal(duplicate.type, "command.duplicate", JSON.stringify(duplicate));
          assert.equal(balanceOf(live(world), characterId), before - sale.asking_price_ngn, "not charged again after the restart");
          // The same request ID with a different payload is still refused after the restart.
          const owned = Object.values(live(world).propertyOwnership).find((o) => o.owner_id === characterId && o.active);
          again.send({ type: "property.action", action: "list_for_sale", requestId: "restart-1", payload: { property_id: owned.property_id, asking_price_ngn: 1_000_000 } });
          assert.equal((await settle(again, "restart-1")).code, "property_request_id_reused");
        } finally {
          await again.close();
        }
      } finally {
        await restarted.started.stop();
      }
      assert.deepEqual(fundingRows(await stored(world)), funding, "the one-time funding rows are unchanged");
      assert.deepEqual(fundingRows(live(world)), funding, "live funding rows are unchanged");
    } finally {
      await buyer?.peer.close();
      await world.started.stop().catch(() => undefined);
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: a graceful stop after a save that failed keeps the unconfirmed change in storage (shutdown save); the retry is a duplicate, charged once`, async () => {
    const world = await openWorld(backendName);
    let buyer;
    try {
      buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);
      world.backend.store.failNextWrite("disk full");
      purchase(buyer.peer, "graceful-1", sale.listing_id);
      assert.equal((await settle(buyer.peer, "graceful-1")).code, "property_not_saved");
      const { characterId, sessionToken } = buyer;
      await buyer.peer.close();
      buyer = undefined;

      // The shutdown save writes the in-memory state. The client was told not_saved, so the change is unconfirmed until a
      // retry is answered. The retry must not charge again.
      const restarted = await restart(world);
      try {
        const again = await resumed(restarted, sessionToken);
        try {
          purchase(again, "graceful-1", sale.listing_id);
          assert.equal((await settle(again, "graceful-1")).type, "command.duplicate");
          assert.equal(balanceOf(live(world), characterId), before - sale.asking_price_ngn, "charged once");
          assert.equal(balanceOf(await stored(world), characterId), before - sale.asking_price_ngn, "stored: charged once");
        } finally {
          await again.close();
        }
      } finally {
        await restarted.started.stop();
      }
    } finally {
      await buyer?.peer.close();
      await world.started.stop().catch(() => undefined);
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: a crash after a save that failed keeps no change on disk; the retry then applies once`, async () => {
    const world = await openWorld(backendName);
    let buyer;
    try {
      buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);
      const ownerBefore = activeOwnersOf(live(world), sale.property_id);
      const snapshotBefore = await stored(world);
      const recordsBefore = await world.backend.durableRecords();
      world.backend.store.failNextWrite("disk full");
      purchase(buyer.peer, "crash-1", sale.listing_id);
      assert.equal((await settle(buyer.peer, "crash-1")).code, "property_not_saved");
      const { characterId, sessionToken } = buyer;
      await buyer.peer.close();
      buyer = undefined;

      // A crash writes nothing more. Simulated by putting back the snapshot from before the failed request, and stopping
      // without a shutdown save (the server is stopped after the storage is restored, so its last save is undone).
      await world.started.stop();
      await world.backend.restoreDurable(snapshotBefore, recordsBefore);
      await world.backend.reopen();
      const restarted = { started: await startOver(world.backend, STARTUP) };
      try {
        assert.equal(balanceOf(await stored(world), characterId), before, "the unsaved charge is not in storage");
        assert.deepEqual(activeOwnersOf(await stored(world), sale.property_id), ownerBefore, "the unsaved ownership change is not in storage");
        const again = await resumed(restarted, sessionToken);
        try {
          purchase(again, "crash-1", sale.listing_id);
          const applied = await settle(again, "crash-1");
          assert.equal(applied.type, "property.result", JSON.stringify(applied));
          assert.equal(balanceOf(live(world), characterId), before - sale.asking_price_ngn, "charged once after the retry");
          assert.equal(balanceOf(await stored(world), characterId), before - sale.asking_price_ngn, "stored: charged once");
        } finally {
          await again.close();
        }
      } finally {
        await restarted.started.stop();
      }
    } finally {
      await buyer?.peer.close();
      await world.started.stop().catch(() => undefined);
      await world.backend.cleanup();
    }
  });

  test(`${backendName}: a restart after a save that committed but lost its reply keeps one charge; the retry is a duplicate`, async () => {
    const world = await openWorld(backendName);
    let buyer;
    try {
      buyer = await player(world, "Buyer", 50_000_000);
      const sale = saleFor(await market(buyer.peer), live(world));
      const before = balanceOf(live(world), buyer.characterId);
      world.backend.store.failNextWriteAfterCommit("reply lost");
      purchase(buyer.peer, "committed-1", sale.listing_id);
      assert.equal((await settle(buyer.peer, "committed-1")).code, "property_outcome_unknown");
      const { characterId, sessionToken } = buyer;
      await buyer.peer.close();
      buyer = undefined;

      const restarted = await restart(world);
      try {
        assert.equal(balanceOf(await stored(world), characterId), before - sale.asking_price_ngn, "the committed charge is in storage");
        const again = await resumed(restarted, sessionToken);
        try {
          purchase(again, "committed-1", sale.listing_id);
          assert.equal((await settle(again, "committed-1")).type, "command.duplicate");
          assert.equal(balanceOf(live(world), characterId), before - sale.asking_price_ngn, "charged once");
          assert.equal(balanceOf(await stored(world), characterId), before - sale.asking_price_ngn, "stored: charged once");
        } finally {
          await again.close();
        }
      } finally {
        await restarted.started.stop();
      }
    } finally {
      await buyer?.peer.close();
      await world.started.stop().catch(() => undefined);
      await world.backend.cleanup();
    }
  });
}

