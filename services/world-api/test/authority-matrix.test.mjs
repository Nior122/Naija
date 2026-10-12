// Authority matrix across families (Stage 28 authority model, principles 1 to 3).
//
// Every test drives the real WebSocket request path and then reads the actual world state. The checks cover:
//   - an unauthenticated socket cannot reach any protected write (refused with `not_authenticated`);
//   - client-supplied actor, owner, role, and account fields never grant authority (the server's session identity decides);
//   - a refused, authenticated request changes no authoritative state and still refreshes the in-memory activity marker
//     (`lastSeen`, existing behaviour);
//   - two concurrent transfers that compete for the same funds keep balances consistent, and a repeated requestId
//     for an idempotent command is applied once.
//
// `recentRequestIds` is a request de-duplication cache rather than world state, so the fingerprint leaves it out, as it
// leaves out the activity markers. Everything else in the world state is compared.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import { loadEconomyCatalog } from "../dist/economy/catalog.js";

const VOLATILE_KEYS = new Set(["lastSeen", "lastActivityAt", "recentRequestIds"]);
const OLD_TIME = "2000-01-01T00:00:00.000Z";

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

async function session(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } });
  const entry = { backend, started, peers: [] };
  opened.push(entry);
  return { backend, started, entry };
}

/** An identity created and resumed through the socket. Age and cash are set on the disposable in-memory state. */
async function citizen(entry, backend, name, { age = 30, money = 0 } = {}) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const player = backend.store.state.players[identity.playerId];
  // Age is derived from date_of_birth on the world date (life service), so the birth date is what is set.
  const worldDate = backend.store.state.worldClock.world_date;
  player.character.date_of_birth = { year: worldDate.year - age, month: 1, day: 1 };
  player.character.age = age;
  player.character.money = money;
  // Spendable cash lives in the cash account (created lazily from money). Set it too, in case identity creation made one.
  for (const account of Object.values(backend.store.state.economyAccounts)) {
    if (account.character_id === player.character.character_id && account.kind === "cash") account.balance_ngn = money;
  }
  return { peer, playerId: identity.playerId, characterId: player.character.character_id, player };
}

function fingerprint(state) {
  return JSON.stringify(state, (key, value) => (VOLATILE_KEYS.has(key) ? undefined : value));
}

/** Sends one request and waits for its reply (a family result or error, or the generic error for a refused socket). */
async function request(peer, message) {
  peer.send(message);
  // Match on requestId so that concurrent requests on one socket cannot take each other's replies. The generic
  // socket-level error carries no requestId, so it is matched on its own.
  try {
    return await peer.waitFor((reply) => (reply.requestId === message.requestId || (reply.type === "error" && reply.requestId === undefined))
      && (reply.type === "error" || /\.(result|error)$/.test(reply.type)), 5000);
  } catch (error) {
    throw new Error(`no reply to ${message.type} ${message.action} (requestId ${message.requestId}): ${error.message}`);
  }
}

const isRefusal = (reply) => reply.type.endsWith(".error") || reply.type === "error";
const isSuccess = (reply) => reply.type.endsWith(".result");

// Protected writes, one per family where the family has a player-initiated write. Each is sent by an unauthenticated socket.
const UNAUTHENTICATED_WRITES = [
  { type: "economy.action", action: "transfer", payload: { from_account_id: "x", to_account_id: "y", amount_ngn: 100 } },
  { type: "business.action", action: "close", payload: { business_id: "x" } },
  { type: "property.action", action: "transfer", payload: { property_id: "x", to_character_id: "y" } },
  { type: "justice.action", action: "file_case", payload: { category: "contract", court_id: "x", summary: "x" } },
  { type: "justice.action", action: "pay_fine", payload: { fine_id: "x", amount_ngn: 1, transaction_id: "t" } },
  { type: "justice.action", action: "issue_judgment", payload: { case_id: "x", outcome: "x", findings: "x", reasoning: "x" } },
  { type: "government.action", action: "create_budget", payload: { organisation_id: "gov:federal" } },
  { type: "military.action", action: "enlist", payload: { application_id: "x" } },
  { type: "police.action", action: "execute_arrest", payload: { target_character_id: "x" } },
  { type: "crime.action", action: "create_criminal_record", payload: { character_id: "x" } },
];

for (const backendName of backendNames) {
  test(`[${backendName}] an unauthenticated socket cannot reach any protected write; nothing changes`, async () => {
    const { backend, started, entry } = await session(backendName);
    const before = fingerprint(backend.store.state);
    const peer = await openPeer(started.websocketUrl);
    entry.peers.push(peer);
    for (const [index, message] of UNAUTHENTICATED_WRITES.entries()) {
      const reply = await request(peer, { ...message, requestId: `anon-${index}` });
      assert.equal(reply.type, "error", `${message.type} ${message.action} is refused by the socket`);
      assert.equal(reply.code, "not_authenticated", `${message.type} ${message.action} reports not_authenticated`);
    }
    assert.equal(fingerprint(backend.store.state), before, "no world state changed by unauthenticated writes");
  });

  test(`[${backendName}] client-supplied owner, actor, and role fields do not grant authority over another character's assets`, async () => {
    const { backend, started, entry } = await session(backendName);
    const owner = await citizen(entry, backend, "Owner", { money: 500_000 });
    const victim = await citizen(entry, backend, "Victim", { money: 50_000 });
    const stranger = await citizen(entry, backend, "Stranger", { money: 1_000 });

    // The owner creates a business through the socket. The victim opens a savings account through the socket.
    const created = await request(owner.peer, {
      type: "business.action", action: "create", requestId: "own-create",
      payload: { template_id: "template:provision-store", name: "Owner Shop", description: "A shop.", location_id: "market", initial_capital_ngn: 50_000 },
    });
    assert.equal(created.type, "business.result", `owner creates a business: ${created.code ?? ""}`);
    const businessId = created.data.business.business_id;

    const opened = await request(victim.peer, {
      type: "economy.action", action: "open_account", requestId: "vic-open",
      payload: { bank_product_id: "bank-product:savings", initial_deposit_ngn: 10_000 },
    });
    assert.equal(opened.type, "economy.result", `victim opens an account: ${opened.code ?? ""}`);
    const victimAccountId = opened.data.account.account_id;
    const victimBalance = backend.store.state.economyAccounts[victimAccountId].balance_ngn;

    // Forged authority: the stranger claims to be the victim or the owner in several field names.
    const forged = { character_id: victim.characterId, actor_character_id: victim.characterId, owner_character_id: owner.characterId, role: "owner" };
    // The destination is the stranger's own real account, so only the source's ownership can refuse the transfer.
    const ownOpened = await request(stranger.peer, {
      type: "economy.action", action: "open_account", requestId: "str-open",
      payload: { bank_product_id: "bank-product:savings", initial_deposit_ngn: 1_000 },
    });
    assert.equal(ownOpened.type, "economy.result", "the stranger opens its own account");
    const strangerAccountId = ownOpened.data.account.account_id;
    const strangerAccountBefore = backend.store.state.economyAccounts[strangerAccountId].balance_ngn;
    const strangerCashBefore = backend.store.state.players[stranger.playerId].character.money;
    const transfer = await request(stranger.peer, {
      type: "economy.action", action: "transfer", requestId: "str-transfer",
      payload: { ...forged, from_account_id: victimAccountId, to_account_id: strangerAccountId, amount_ngn: 5_000 },
    });
    assert.equal(transfer.type, "economy.error");
    assert.equal(transfer.code, "economy_account_not_found", "a stranger cannot move money out of another character's account");
    assert.equal(backend.store.state.economyAccounts[victimAccountId].balance_ngn, victimBalance, "victim balance unchanged");
    assert.equal(backend.store.state.economyAccounts[strangerAccountId].balance_ngn, strangerAccountBefore, "the stranger's own account is unchanged");

    const actions = [
      { type: "business.action", action: "close", payload: { business_id: businessId, ...forged } },
      { type: "business.action", action: "transfer_ownership", payload: { business_id: businessId, to_character_id: stranger.characterId, new_role: "owner", share_percent: 100, ...forged } },
      { type: "business.action", action: "hire_employee", payload: { business_id: businessId, employee_character_id: stranger.characterId, ...forged } },
      { type: "business.action", action: "contribute_capital", payload: { business_id: businessId, amount_ngn: 1_000, ...forged } },
    ];
    const businessBefore = JSON.stringify(backend.store.state.businesses[businessId]);
    for (const [index, action] of actions.entries()) {
      const reply = await request(stranger.peer, { ...action, requestId: `str-${index}` });
      assert.equal(reply.type, "business.error", `${action.action} by a stranger is refused`);
      assert.equal(reply.code, "business_unauthorized", `${action.action} reports business_unauthorized`);
    }
    assert.equal(JSON.stringify(backend.store.state.businesses[businessId]), businessBefore, "the business record is unchanged");
    assert.equal(backend.store.state.players[stranger.playerId].character.money, strangerCashBefore, "the stranger's cash is unchanged");

    // Positive control: the same owner, the same request shape, is accepted only for the true owner.
    const ownerContribution = await request(owner.peer, {
      type: "business.action", action: "contribute_capital", requestId: "own-contribute",
      payload: { business_id: businessId, amount_ngn: 1_000 },
    });
    assert.equal(ownerContribution.type, "business.result", "the owner can still contribute capital to their own business");
  });

  test(`[${backendName}] P-4: a citizen may file a misconduct complaint against an existing officer; the complainant is the session character`, async () => {
    const { backend, started, entry } = await session(backendName);
    const complainant = await citizen(entry, backend, "Complainant", { money: 0 });
    const victim = await citizen(entry, backend, "Other", { money: 0 });
    // Test setup on disposable in-memory state: an officer record, as if an accepted recruit had been enrolled.
    // Enrolment itself is suspended (P-2 has no player route), so the complaint rule is the thing under test here.
    const officerId = "officer-test-p4";
    backend.store.state.policeOfficers = backend.store.state.policeOfficers ?? {};
    backend.store.state.policeOfficers[officerId] = {
      officer_id: officerId, character_id: victim.characterId, station_id: null, rank: "constable", status: "active",
    };
    const officerIds = [officerId];
    const complaintsBefore = Object.keys(backend.store.state.misconductComplaints ?? {}).length;

    // An unknown officer is refused and creates no complaint.
    const unknown = await request(complainant.peer, {
      type: "police.action", action: "file_complaint", requestId: "p4-unknown",
      accused_officer_id: "officer-does-not-exist", category: "abuse_of_authority", description: "No such officer.",
    });
    assert.equal(unknown.type, "police.error", "a complaint against a missing officer is refused");
    assert.equal(Object.keys(backend.store.state.misconductComplaints ?? {}).length, complaintsBefore, "no complaint is recorded");

    // A real officer is accepted. A client-supplied complainant field is ignored: the session identity is recorded.
    const accepted = await request(complainant.peer, {
      type: "police.action", action: "file_complaint", requestId: "p4-valid",
      accused_officer_id: officerIds[0], category: "abuse_of_authority", description: "The officer ignored my report.",
      complainant_character_id: victim.characterId,
    });
    assert.equal(accepted.type, "police.result", "a citizen may file against an existing officer");
    const recorded = Object.values(backend.store.state.misconductComplaints ?? {}).find((c) => c.accused_officer_id === officerIds[0]);
    assert.ok(recorded, "the complaint is recorded");
    assert.equal(recorded.complainant_character_id, complainant.characterId, "the complainant is the session character, not the forged field");
  });

  test(`[${backendName}] a refused authenticated request changes no state and still refreshes the activity marker`, async () => {
    const { backend, started, entry } = await session(backendName);
    const stranger = await citizen(entry, backend, "Marker", { money: 0 });
    const refusals = [
      { type: "government.action", action: "create_budget", payload: { organisation_id: "gov:federal", fiscal_year: 2026, category_id: "bud:healthcare", amount_ngn: 1 } },
      { type: "justice.action", action: "pay_fine", payload: { fine_id: "missing", amount_ngn: 1, transaction_id: "t" } },
      { type: "business.action", action: "close", payload: { business_id: "missing" } },
    ];
    for (const [index, message] of refusals.entries()) {
      const stateBefore = fingerprint(backend.store.state);
      backend.store.state.players[stranger.playerId].lastSeen = OLD_TIME;
      const reply = await request(stranger.peer, { ...message, requestId: `marker-${index}` });
      assert.ok(isRefusal(reply), `${message.type} ${message.action} is refused`);
      assert.notEqual(reply.code, undefined, "the refusal carries a stable code");
      const lastSeen = backend.store.state.players[stranger.playerId].lastSeen;
      assert.ok(Date.parse(lastSeen) > Date.parse(OLD_TIME), `${message.action} refreshes lastSeen on refusal`);
      assert.equal(fingerprint(backend.store.state), stateBefore, `${message.action} changes no authoritative state`);
    }
  });

  test(`[${backendName}] concurrent transfers that compete for the same funds keep balances consistent; a repeated requestId applies once`, async () => {
    const { backend, started, entry } = await session(backendName);
    const catalog = loadEconomyCatalog();
    const saver = await citizen(entry, backend, "Saver", { money: 50_000 });
    const savings = await request(saver.peer, {
      type: "economy.action", action: "open_account", requestId: "sv-open",
      payload: { bank_product_id: "bank-product:savings", initial_deposit_ngn: 10_000 },
    });
    assert.equal(savings.type, "economy.result", "savings account opened");
    const current = await request(saver.peer, {
      type: "economy.action", action: "open_account", requestId: "cu-open",
      payload: { bank_product_id: "bank-product:current", initial_deposit_ngn: 0 },
    });
    assert.equal(current.type, "economy.result", "current account opened");
    const fromId = savings.data.account.account_id;
    const toId = current.data.account.account_id;
    const product = catalog.bank_products.find((p) => p.id === "bank-product:savings");
    const fee = product?.transfer_fee_ngn ?? 0;
    const fromBefore = backend.store.state.economyAccounts[fromId].balance_ngn;
    const toBefore = backend.store.state.economyAccounts[toId].balance_ngn;
    const amount = 6_000;

    // Two different requests sent back to back, each for 6,000 from a balance that only covers one of them.
    const replies = await Promise.all([
      request(saver.peer, { type: "economy.action", action: "transfer", requestId: "race-a", payload: { from_account_id: fromId, to_account_id: toId, amount_ngn: amount } }),
      request(saver.peer, { type: "economy.action", action: "transfer", requestId: "race-b", payload: { from_account_id: fromId, to_account_id: toId, amount_ngn: amount } }),
    ]);
    const successes = replies.filter(isSuccess);
    const failures = replies.filter(isRefusal);
    assert.equal(successes.length, 1, "exactly one of the competing transfers succeeds");
    assert.equal(failures.length, 1, "the other is refused");
    assert.equal(failures[0].code, "economy_insufficient_funds", "the refusal is for insufficient funds");

    const fromAfter = backend.store.state.economyAccounts[fromId].balance_ngn;
    const toAfter = backend.store.state.economyAccounts[toId].balance_ngn;
    assert.equal(toAfter - toBefore, amount, "the receiving account gains exactly one transfer");
    assert.equal(fromBefore - fromAfter, amount + fee, "the paying account loses one transfer plus its fee, and nothing more");
    assert.ok(fromAfter >= 0, "no account is overdrawn");

    // The same requestId sent twice for an idempotent command is applied once.
    const repeat = { type: "economy.action", action: "transfer", requestId: "repeat-1", payload: { from_account_id: fromId, to_account_id: toId, amount_ngn: 500 } };
    const first = await request(saver.peer, repeat);
    assert.ok(isSuccess(first), "the first transfer is applied");
    const fromMid = backend.store.state.economyAccounts[fromId].balance_ngn;
    saver.peer.send(repeat);
    const second = await saver.peer.waitFor((reply) => reply.requestId === "repeat-1" && reply.type === "command.duplicate", 20000);
    assert.equal(second.type, "command.duplicate", "the engine reports the resend as a duplicate");
    assert.equal(backend.store.state.economyAccounts[fromId].balance_ngn, fromMid, "a resent requestId does not debit again");
  });
}
