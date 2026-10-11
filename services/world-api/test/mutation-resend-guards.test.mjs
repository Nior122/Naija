// Stage 28 mutation-ordering guards. These tests re-send a mutating request with the same requestId.
// The server does not deduplicate these commands (see IDEMPOTENT_COMMANDS in world-engine.ts), so each test
// records what the current code actually does. Tests marked "gap" assert the current, unfixed behaviour so the
// gap stays visible; they are not evidence that the behaviour is correct.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";

const opened = [];

before(connectBackends);
after(disconnectBackends);

async function session(backendName) {
  const backend = await openBackend(backendName);
  const started = await startOver(backend, { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } });
  const peer = await openPeer(started.websocketUrl);
  opened.push({ backend, started, peer });
  return { backend, started, peer };
}

/** Test-side setup on disposable in-memory state: an adult whose existing cash account holds the given balance. */
function fundAdult(backend, playerId, balance) {
  const state = backend.store.state;
  const character = state.players[playerId].character;
  character.age = 30;
  const accounts = Object.values(state.economyAccounts)
    .filter((account) => account.kind === "cash" && account.character_id === character.character_id);
  assert.equal(accounts.length, 1, "a new character has exactly one cash account");
  accounts[0].balance_ngn = balance;
  accounts[0].total_deposited_ngn = balance;
  return accounts[0].account_id;
}

function cashBalance(backend, characterId) {
  const accounts = Object.values(backend.store.state.economyAccounts)
    .filter((account) => account.kind === "cash" && account.character_id === characterId);
  return accounts[0].balance_ngn;
}

function ask(peer, message, types) {
  peer.send(message);
  return peer.waitFor((reply) => types.includes(reply.type), 5000);
}

afterEach(async () => {
  while (opened.length > 0) {
    const { backend, started, peer } = opened.pop();
    peer.close();
    await started.stop();
    await backend.cleanup();
  }
});

for (const backendName of backendNames) {
  test(`${backendName}: property purchase re-sent with the same requestId is refused and charges once`, async () => {
    const { backend, peer } = await session(backendName);
    const identity = await createIdentity(peer, "Buyer");
    await resumeSession(peer, identity.sessionToken);
    fundAdult(backend, identity.playerId, 50_000_000);
    const characterId = backend.store.state.players[identity.playerId].character.character_id;

    const market = await ask(peer, { type: "property.action", action: "market", requestId: "guard-market" }, ["property.result", "property.error"]);
    const sale = (market.data?.market?.listings ?? [])
      .filter((listing) => listing.listing_type === "sale")
      .sort((a, b) => a.asking_price_ngn - b.asking_price_ngn)[0];
    assert.ok(sale, "seeded world has a sale listing");

    const before = cashBalance(backend, characterId);
    const first = await ask(peer, {
      type: "property.action", action: "purchase", requestId: "guard-buy-1", payload: { listing_id: sale.listing_id },
    }, ["property.result", "property.error"]);
    assert.equal(first.type, "property.result", first.code);
    const afterFirst = cashBalance(backend, characterId);
    assert.equal(before - afterFirst, sale.asking_price_ngn);

    const resent = await ask(peer, {
      type: "property.action", action: "purchase", requestId: "guard-buy-1", payload: { listing_id: sale.listing_id },
    }, ["property.result", "property.error"]);
    assert.equal(resent.type, "property.error");
    assert.equal(cashBalance(backend, characterId), afterFirst, "the re-sent purchase must not charge again");
  });

  test(`${backendName}: justice file_case re-sent with the same requestId files a second case (gap, current behaviour)`, async () => {
    const { backend, peer } = await session(backendName);
    const identity = await createIdentity(peer, "Filer");
    await resumeSession(peer, identity.sessionToken);
    fundAdult(backend, identity.playerId, 0);
    const courts = await ask(peer, { type: "justice.action", action: "list_courts", requestId: "guard-courts" }, ["justice.result", "justice.error"]);
    assert.equal(courts.type, "justice.result", courts.code);
    const court = (courts.data?.courts ?? []).find((entry) => entry.court_id === "court:federal-high" && entry.status === "active");
    assert.ok(court, "seeded world has the active Federal High Court");
    const category = "civil_general";

    const filing = {
      type: "justice.action", action: "file_case", requestId: "guard-file-1",
      category, court_id: court.court_id, summary: "Guard test filing", description: "Re-sent filing",
    };
    const first = await ask(peer, filing, ["justice.result", "justice.error"]);
    assert.equal(first.type, "justice.result", first.code);
    const resent = await ask(peer, filing, ["justice.result", "justice.error"]);
    assert.equal(resent.type, "justice.result", resent.code);

    const mine = await ask(peer, { type: "justice.action", action: "my_cases", requestId: "guard-my-cases" }, ["justice.result", "justice.error"]);
    const cases = mine.data?.cases ?? [];
    assert.equal(cases.length, 2, "current code does not deduplicate file_case on requestId");
  });

  test(`${backendName}: government create_budget re-sent with the same requestId is refused while government writes are suspended`, async () => {
    const { backend, peer } = await session(backendName);
    const identity = await createIdentity(peer, "Citizen");
    await resumeSession(peer, identity.sessionToken);
    const budgetsBefore = Object.keys(backend.store.state.governmentBudgets).length;
    const characterId = backend.store.state.players[identity.playerId].character.character_id;
    const holdsOffice = Object.values(backend.store.state.governmentAppointments)
      .some((appointment) => appointment.character_id === characterId && appointment.status === "active");
    assert.equal(holdsOffice, false, "the test character holds no government office");
    const request = {
      type: "government.action", action: "create_budget", requestId: "guard-budget-1",
      payload: { organisation_id: "gov:min:health", fiscal_year: 2026, category_id: "bud:healthcare", amount_ngn: 1_000_000 },
    };
    // Containment (Stage 28): player-initiated government writes are refused on the server, for every requestId.
    // The first and the re-sent request are both refused, so no budget exists to deduplicate.
    const first = await ask(peer, request, ["government.result", "government.error"]);
    assert.equal(first.type, "government.error", first.code);
    assert.equal(first.code, "government_writes_suspended");
    const resent = await ask(peer, request, ["government.result", "government.error"]);
    assert.equal(resent.type, "government.error", resent.code);
    assert.equal(resent.code, "government_writes_suspended");
    assert.equal(Object.keys(backend.store.state.governmentBudgets).length, budgetsBefore, "no budget was created");
  });

  test(`${backendName}: school.begin re-sent while the quiz is pending is refused and records one attendance`, async () => {
    const { backend, peer } = await session(backendName);
    const identity = await createIdentity(peer, "Pupil");
    await resumeSession(peer, identity.sessionToken);
    const character = backend.store.state.players[identity.playerId].character;
    // Test-side placement at the classroom desk on disposable state. The walking route is covered by education.test.mjs.
    character.current_location = "classroom";
    character.position = { x: 820, y: 560 };
    const attendanceBefore = character.education_record.attendance_records.length;

    const request = { type: "school.begin", requestId: "guard-school-1" };
    const quiz = await ask(peer, request, ["school.quiz", "error"]);
    assert.equal(quiz.type, "school.quiz", quiz.code ?? quiz.description);
    const resent = await ask(peer, request, ["school.quiz", "error"]);
    assert.equal(resent.type, "error");
    assert.equal(resent.code, "quiz_in_progress");
    assert.equal(character.education_record.attendance_records.length, attendanceBefore + 1,
      "the re-sent school.begin must not record a second attendance");
  });
}
