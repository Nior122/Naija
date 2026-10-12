// Housing rent and property money (Stage 39), on every configured backend (file always; PostgreSQL when it is live).
//
// What these tests establish, through the socket and against the stored state:
// - a rental start pays the first rent period and the deposit, and the agreement is covered to the end of that period;
// - pay_rent pays one period, and only once that period is due (the day the previous period ends);
// - a monthly period is clamped to the month end (31 January + 1 month = 28 February);
// - a payment for a period that is already paid is refused and changes nothing;
// - NPC landlords and sellers receive money into an NPC cash account in the same ledger (no bank product: no interest or
//   fee), and player landlords and sellers receive it into their own cash account;
// - every property debit and credit writes a ledger row with matching balances;
// - a counterparty that is neither a player nor an NPC is refused before any debit (property_counterparty_unsupported);
// - a repeated request is a duplicate, and the rent state survives a restart.
// These tests do not show that concurrent payments are serialised across processes. That is covered only by the
// single-process socket tests in property-actions-stage35.test.mjs.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends } from "./support/creation-backends.mjs";
import { balanceOf, cashAccountOf, propertyContent } from "./support/property-world.mjs";
import { inWorld, live, listingFor, market, player, refusal, restart, resumed, saleFor, settle, stored } from "./support/property-socket.mjs";

before(connectBackends);
after(disconnectBackends);

const message = (action, requestId, payload) => ({ type: "property.action", action, requestId, payload });
const JAN31 = { year: 2026, month: 1, day: 31 };

/** Sends a setup request and requires its success. Setup requests have their own IDs and are not under test. */
async function ok(actor, requestId, action, payload) {
  actor.peer.send(message(action, requestId, payload));
  const reply = await settle(actor.peer, requestId);
  assert.equal(reply.type, "property.result", `setup ${action}: ${JSON.stringify(reply)}`);
  return reply;
}

/** Moves the disposable world's calendar date (test-side setup, flushed), as a real day change would. */
async function setWorldDate(world, date) {
  live(world).worldClock.world_date = { ...date };
  await world.backend.store.flush();
}

/** Canonical JSON (keys sorted at every level), so that live and stored state compare equal across backends. */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  }
  return value;
}

const rentContent = (state) => JSON.stringify(canon({
  rentalAgreements: state.rentalAgreements,
  rentalPayments: state.rentalPayments,
  economyAccounts: state.economyAccounts,
  economyTransactions: state.economyTransactions,
  properties: state.properties,
  propertyOwnership: state.propertyOwnership,
}));

const ledgerFor = (state, referenceId) => Object.values(state.economyTransactions)
  .filter((row) => row.reference_id === referenceId)
  .sort((a, b) => a.kind.localeCompare(b.kind));

const sameDate = (actual, expected) => assert.deepEqual(
  { year: actual.year, month: actual.month, day: actual.day }, expected,
);

/** The active NPC owner of a property, or undefined. */
function npcOwnerOf(state, propertyId) {
  return Object.values(state.propertyOwnership).find((o) => o.property_id === propertyId && o.active && o.owner_kind === "npc");
}

/** A rent listing of a seeded NPC-owned property (seeded NPC landlords rent yearly). */
async function npcRentListing(world, peer) {
  const rents = (await market(peer)).filter((l) => l.listing_type === "rent");
  const listing = rents.find((l) => npcOwnerOf(live(world), l.property_id));
  assert.ok(listing, "premise: an open NPC rent listing in the seeded world");
  return listing;
}

/**
 * `owner` buys a flat from the market (its seller is an NPC), lists it for rent with `period`, and `tenant` rents it.
 * The world date is set to 31 January 2026 first, so the period arithmetic is exact.
 */
async function playerRentedWorld(world, period) {
  const owner = await player(world, "Landlord", 50_000_000);
  const tenant = await player(world, "Tenant", 50_000_000);
  await setWorldDate(world, JAN31);
  const sale = saleFor(await market(owner.peer), live(world));
  await ok(owner, "setup-buy", "purchase", { listing_id: sale.listing_id });
  await ok(owner, "setup-list", "list_for_rent", { property_id: sale.property_id, rent_price_ngn: 100_000, deposit_ngn: 0, rent_period: period });
  const listing = listingFor(await market(tenant.peer), sale.property_id, "rent");
  const reply = await ok(tenant, "setup-rent", "rent", { listing_id: listing.listing_id });
  return { owner, tenant, property_id: sale.property_id, agreement_id: reply.data.agreement.agreement_id };
}

for (const backendName of backendNames) {
  test(`${backendName}: a yearly NPC rental pays the first period and the deposit at the start; the NPC landlord is credited once, with ledger rows; the next period is due a year later`, () => inWorld(backendName, async (world) => {
    const tenant = await player(world, "Tenant", 10_000_000);
    await setWorldDate(world, JAN31);
    const listing = await npcRentListing(world, tenant.peer);
    const before = balanceOf(live(world), tenant.characterId);

    const reply = await ok(tenant, "rent-start", "rent", { listing_id: listing.listing_id });
    const agreementId = reply.data.agreement.agreement_id;
    const state = live(world);
    const agreement = state.rentalAgreements[agreementId];
    sameDate(agreement.paid_through_world_date, { year: 2027, month: 1, day: 31 });
    const paidNow = agreement.rent_ngn + agreement.deposit_ngn;
    assert.equal(balanceOf(state, tenant.characterId), before - paidNow, "tenant charged rent and deposit once");

    // The NPC landlord has its own cash account in the same ledger, with no bank product (so no interest or fee).
    const npc = cashAccountOf(state, agreement.landlord_id);
    assert.ok(npc, "NPC landlord cash account opened");
    assert.equal(npc.bank_product_id, null, "no bank product");
    assert.equal(npc.balance_ngn, paidNow, "NPC credited with rent and deposit");

    const rows = ledgerFor(state, agreementId);
    assert.deepEqual(rows.map((r) => [r.kind, r.character_id, r.amount_ngn]).sort(), [
      ["rent_payment", tenant.characterId, paidNow],
      ["rent_receipt", agreement.landlord_id, paidNow],
    ].sort(), "one debit row and one credit row");
    const debit = rows.find((r) => r.kind === "rent_payment");
    assert.equal(debit.balance_after_ngn, debit.balance_before_ngn - paidNow, "debit row balances");

    // Not due again until 31 January 2027. A repeat now is refused and changes nothing.
    tenant.peer.send(message("pay_rent", "early", { agreement_id: agreementId }));
    assert.equal((await refusal(tenant.peer, "property_rent_not_due")).action, "pay_rent");
    assert.equal(balanceOf(live(world), tenant.characterId), before - paidNow, "early repeat not charged");

    // On the due day the next year is paid, once.
    await setWorldDate(world, { year: 2027, month: 1, day: 31 });
    await ok(tenant, "pay-due", "pay_rent", { agreement_id: agreementId });
    const after = live(world);
    sameDate(after.rentalAgreements[agreementId].paid_through_world_date, { year: 2028, month: 1, day: 31 });
    assert.equal(after.rentalAgreements[agreementId].total_paid_ngn, paidNow + agreement.rent_ngn, "total paid includes the second period");
    assert.equal(cashAccountOf(after, agreement.landlord_id).balance_ngn, paidNow + agreement.rent_ngn, "NPC credited for the second period");
    // Two rows in total: the rental start (first period and deposit) and this payment (second period).
    const payments = Object.values(after.rentalPayments).filter((p) => p.agreement_id === agreementId)
      .sort((a, b) => a.covered_from_world_date.year - b.covered_from_world_date.year);
    assert.equal(payments.length, 2, "one row for the start and one for the due period");
    sameDate(payments[1].covered_from_world_date, { year: 2027, month: 1, day: 31 });
    sameDate(payments[1].covered_until_world_date, { year: 2028, month: 1, day: 31 });

    // The same period cannot be paid twice.
    tenant.peer.send(message("pay_rent", "again", { agreement_id: agreementId }));
    assert.equal((await refusal(tenant.peer, "property_rent_not_due")).code, "property_rent_not_due");
    assert.equal(balanceOf(live(world), tenant.characterId), before - paidNow - agreement.rent_ngn, "repeat not charged");
    assert.equal(rentContent(await stored(world)), rentContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: a monthly rental is clamped to the month end (31 January + 1 month = 28 February), pays one month per payment, and a player landlord is credited`, () => inWorld(backendName, async (world) => {
    const ctx = await playerRentedWorld(world, "monthly");
    const agreement = live(world).rentalAgreements[ctx.agreement_id];
    sameDate(agreement.paid_through_world_date, { year: 2026, month: 2, day: 28 });

    // One day early: refused.
    await setWorldDate(world, { year: 2026, month: 2, day: 27 });
    const beforeTenant = balanceOf(live(world), ctx.tenant.characterId);
    const beforeLandlord = balanceOf(live(world), ctx.owner.characterId);
    ctx.tenant.peer.send(message("pay_rent", "feb-early", { agreement_id: ctx.agreement_id }));
    assert.equal((await refusal(ctx.tenant.peer, "property_rent_not_due")).code, "property_rent_not_due");
    assert.equal(balanceOf(live(world), ctx.tenant.characterId), beforeTenant, "tenant not charged early");

    // On the due day: pays February, covering 28 February to 28 March, and credits the player landlord.
    await setWorldDate(world, { year: 2026, month: 2, day: 28 });
    await ok(ctx.tenant, "feb-due", "pay_rent", { agreement_id: ctx.agreement_id });
    const state = live(world);
    // The rental start also has a row (covering January). Select the February row by its covered period.
    const payment = Object.values(state.rentalPayments).find((p) => p.agreement_id === ctx.agreement_id
      && p.covered_from_world_date?.month === 2);
    assert.ok(payment, "the February payment row exists");
    sameDate(payment.covered_from_world_date, { year: 2026, month: 2, day: 28 });
    sameDate(payment.covered_until_world_date, { year: 2026, month: 3, day: 28 });
    sameDate(state.rentalAgreements[ctx.agreement_id].paid_through_world_date, { year: 2026, month: 3, day: 28 });
    assert.equal(balanceOf(state, ctx.tenant.characterId), beforeTenant - 100_000, "tenant charged one month");
    assert.equal(balanceOf(state, ctx.owner.characterId), beforeLandlord + 100_000, "player landlord credited one month");
    const rows = ledgerFor(state, payment.payment_id);
    assert.deepEqual(rows.map((r) => [r.kind, r.character_id]).sort(), [
      ["rent_payment", ctx.tenant.characterId],
      ["rent_receipt", ctx.owner.characterId],
    ].sort(), "ledger rows for both sides of the payment");

    // The same month cannot be paid twice.
    ctx.tenant.peer.send(message("pay_rent", "feb-again", { agreement_id: ctx.agreement_id }));
    assert.equal((await refusal(ctx.tenant.peer, "property_rent_not_due")).code, "property_rent_not_due");
    assert.equal(balanceOf(live(world), ctx.tenant.characterId), beforeTenant - 100_000, "repeat not charged");
  }));

  test(`${backendName}: an agreement saved before Stage 39 (no paid-through date) is due one period after its last payment, not from its start`, () => inWorld(backendName, async (world) => {
    const ctx = await playerRentedWorld(world, "yearly");
    const agreement = live(world).rentalAgreements[ctx.agreement_id];
    // Test-side setup: the agreement looks as a Stage 38 record did. The last payment was on 15 June 2026.
    delete agreement.paid_through_world_date;
    agreement.last_payment_world_date = { year: 2026, month: 6, day: 15 };
    await world.backend.store.flush();
    const beforeTenant = balanceOf(live(world), ctx.tenant.characterId);

    // Due 15 June 2027 (one period after the last payment). Before then, refused, and nothing changes.
    await setWorldDate(world, { year: 2027, month: 6, day: 14 });
    ctx.tenant.peer.send(message("pay_rent", "legacy-early", { agreement_id: ctx.agreement_id }));
    assert.equal((await refusal(ctx.tenant.peer, "property_rent_not_due")).code, "property_rent_not_due");
    assert.equal(balanceOf(live(world), ctx.tenant.characterId), beforeTenant, "not charged before the legacy due date");

    await setWorldDate(world, { year: 2027, month: 6, day: 15 });
    await ok(ctx.tenant, "legacy-due", "pay_rent", { agreement_id: ctx.agreement_id });
    const state = live(world);
    const payment = Object.values(state.rentalPayments).find((p) => p.agreement_id === ctx.agreement_id
      && p.covered_from_world_date?.year === 2027);
    assert.ok(payment, "the payment covers the period from 15 June 2027");
    sameDate(payment.covered_until_world_date, { year: 2028, month: 6, day: 15 });
    sameDate(state.rentalAgreements[ctx.agreement_id].paid_through_world_date, { year: 2028, month: 6, day: 15 });
  }));

  test(`${backendName}: a rent payment to a landlord that is neither a player nor an NPC is refused before any debit`, () => inWorld(backendName, async (world) => {
    const ctx = await playerRentedWorld(world, "yearly");
    const agreement = live(world).rentalAgreements[ctx.agreement_id];
    // Test-side setup: the agreement's landlord becomes a business-kind holder with no account model.
    agreement.landlord_id = "business-unmodelled-001";
    agreement.landlord_kind = "business";
    await world.backend.store.flush();
    await setWorldDate(world, agreement.paid_through_world_date);
    const beforeTenant = balanceOf(live(world), ctx.tenant.characterId);
    const beforePayments = Object.keys(live(world).rentalPayments).length;
    const beforeTransactions = Object.keys(live(world).economyTransactions).length;
    const paidThrough = JSON.stringify(agreement.paid_through_world_date);

    ctx.tenant.peer.send(message("pay_rent", "biz-1", { agreement_id: ctx.agreement_id }));
    assert.equal((await refusal(ctx.tenant.peer, "property_counterparty_unsupported")).code, "property_counterparty_unsupported");

    assert.equal(balanceOf(live(world), ctx.tenant.characterId), beforeTenant, "tenant not charged");
    assert.equal(Object.keys(live(world).rentalPayments).length, beforePayments, "no payment row");
    assert.equal(Object.keys(live(world).economyTransactions).length, beforeTransactions, "no ledger row");
    assert.equal(JSON.stringify(live(world).rentalAgreements[ctx.agreement_id].paid_through_world_date), paidThrough, "paid-through unchanged");
    assert.equal(rentContent(await stored(world)), rentContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: renting from an owner that is neither a player nor an NPC is refused before any debit, and no agreement starts`, () => inWorld(backendName, async (world) => {
    const tenant = await player(world, "Tenant", 10_000_000);
    await setWorldDate(world, JAN31);
    const listing = await npcRentListing(world, tenant.peer);
    // Test-side setup: the property's active owner becomes a business-kind holder with no account model.
    const owner = npcOwnerOf(live(world), listing.property_id);
    owner.owner_kind = "business";
    owner.owner_id = "business-unmodelled-002";
    // The listing belongs to the same owner, so the existing owner check passes and the counterparty check is reached.
    live(world).propertyListings[listing.listing_id].owner_id = "business-unmodelled-002";
    await world.backend.store.flush();
    const before = balanceOf(live(world), tenant.characterId);

    tenant.peer.send(message("rent", "biz-rent", { listing_id: listing.listing_id }));
    const refused = await settle(tenant.peer, "biz-rent");
    assert.equal(refused.type, "property.error", JSON.stringify(refused));
    assert.equal(refused.code, "property_counterparty_unsupported", JSON.stringify(refused));

    assert.equal(balanceOf(live(world), tenant.characterId), before, "tenant not charged");
    assert.equal(Object.values(live(world).rentalAgreements).filter((a) => a.property_id === listing.property_id).length, 0, "no agreement");
    assert.equal(rentContent(await stored(world)), rentContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: buying from an NPC seller debits the buyer, credits the NPC seller's cash account, and writes a ledger row for each side, once`, () => inWorld(backendName, async (world) => {
    const buyer = await player(world, "Buyer", 50_000_000);
    await setWorldDate(world, JAN31);
    const sale = saleFor(await market(buyer.peer), live(world));
    const seller = npcOwnerOf(live(world), sale.property_id);
    assert.ok(seller, "premise: the sale is held by an NPC seller");
    const sellerBefore = cashAccountOf(live(world), seller.owner_id)?.balance_ngn ?? 0;
    const buyerBefore = balanceOf(live(world), buyer.characterId);

    const reply = await ok(buyer, "buy-npc", "purchase", { listing_id: sale.listing_id });
    assert.ok(reply.data, "purchase confirmed");
    const state = live(world);
    assert.equal(balanceOf(state, buyer.characterId), buyerBefore - sale.asking_price_ngn, "buyer charged the asking price once");
    const sellerAccount = cashAccountOf(state, seller.owner_id);
    assert.equal(sellerAccount.bank_product_id, null, "NPC seller account has no bank product");
    assert.equal(sellerAccount.balance_ngn, sellerBefore + sale.asking_price_ngn, "NPC seller credited the asking price");

    const kinds = Object.values(state.economyTransactions)
      .filter((row) => row.kind === "property_purchase" || row.kind === "property_sale_proceeds")
      .filter((row) => row.reference_id.startsWith(`${sale.property_id}:`))
      .map((row) => [row.kind, row.character_id, row.amount_ngn]).sort();
    assert.deepEqual(kinds, [
      ["property_purchase", buyer.characterId, sale.asking_price_ngn],
      ["property_sale_proceeds", seller.owner_id, sale.asking_price_ngn],
    ].sort(), "one ledger row per side");

    // A repeat of the same purchase is refused: the property is no longer for sale.
    buyer.peer.send(message("purchase", "buy-npc-again", { listing_id: sale.listing_id }));
    const again = await settle(buyer.peer, "buy-npc-again");
    assert.notEqual(again.type, "property.result", "a repeat purchase is not confirmed");
    assert.equal(balanceOf(live(world), buyer.characterId), buyerBefore - sale.asking_price_ngn, "repeat not charged");
    assert.equal(rentContent(await stored(world)), rentContent(live(world)), "stored matches live");
  }));

  test(`${backendName}: a repeated pay_rent request is a duplicate and charges once; after a restart the paid period is still paid, so the same period is refused`, () => inWorld(backendName, async (world) => {
    const ctx = await playerRentedWorld(world, "monthly");
    await setWorldDate(world, { year: 2026, month: 2, day: 28 });
    await ok(ctx.tenant, "feb-first", "pay_rent", { agreement_id: ctx.agreement_id });
    const charged = balanceOf(live(world), ctx.tenant.characterId);

    // Same request ID and payload, sent again before the restart: a duplicate, not a second payment.
    ctx.tenant.peer.send(message("pay_rent", "feb-first", { agreement_id: ctx.agreement_id }));
    const duplicate = await settle(ctx.tenant.peer, "feb-first");
    assert.equal(duplicate.type, "command.duplicate", JSON.stringify(duplicate));
    assert.equal(balanceOf(live(world), ctx.tenant.characterId), charged, "duplicate not charged");

    await restart(world);
    const again = await resumed(world, ctx.tenant.sessionToken);
    again.send(message("pay_rent", "feb-after-restart", { agreement_id: ctx.agreement_id }));
    assert.equal((await settle(again, "feb-after-restart")).code, "property_rent_not_due", "the paid period survives the restart");
    assert.equal(balanceOf(live(world), ctx.tenant.characterId), charged, "still charged once after restart");
    assert.equal(rentContent(await stored(world)), rentContent(live(world)), "stored matches live after restart");
    assert.equal(propertyContent(await stored(world)), propertyContent(live(world)), "property state matches");
    await again.close();
  }));
}
