// Treasury and financial authority (Stage 31).
//
// Part A calls the trusted government functions on an in-memory state. Part B drives the real socket path
// (government.action) for the three treasury routes that are open: approve_budget, allocate_budget, spend_budget.
//
// Every rejection is checked against a full snapshot of the world state. A refused request must leave no trace: no
// balance change, no ledger row, no budget change, no event, no idempotency record. Authority comes from the server
// (office, permission, and age on the server record). Fields the client sends for actor, owner, organisation, account,
// or independence are ignored, and the tests prove that.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import { loadGovernmentCatalog } from "../dist/government/catalog.js";
import { authorizeOfficePermission, characterAgeOn } from "../dist/government/authority.js";
import { auditGovernmentStructure, officePlacement } from "../dist/government/hierarchy.js";
import {
  allocateBudget,
  appointOfficial,
  approveBudget,
  auditTreasuryLedger,
  createBudget,
  initializeGovernmentWorldState,
  recordGovernmentExpenditure,
  recordGovernmentRevenue,
  reconcileGovernmentStructure,
  seedGovernmentWorld,
  spendBudget,
} from "../dist/government/service.js";
import { validateGovernmentRecords } from "../dist/multiplayer/record-validation.js";
import { initializeEconomyWorldState } from "../dist/economy/service.js";

const CATALOG = loadGovernmentCatalog();
const DATE = { year: 2026, month: 10, day: 11 };
const NOW = Date.UTC(2026, 9, 11);
const FEDERAL = "gov:federal";
const FINANCE = "gov:min:finance";
const HEALTH = "gov:min:health";
const EDUCATION = "gov:min:education";

// ─── Part A: service-level ────────────────────────────────────────────────────

/**
 * A world with the seeded federal government and ministries, and the economy maps. The seed uses a catalogue with no
 * funding rule, so every treasury starts at zero and each test states its own money. The funding rule is tested on
 * its own (government-treasury-payments.test.mjs).
 */
function makeState({ withFunding = false } = {}) {
  const state = {
    worldClock: { world_date: { ...DATE } }, players: {}, people: {}, businesses: {}, relationships: {}, marriages: {},
  };
  initializeGovernmentWorldState(state);
  initializeEconomyWorldState(state, NOW);
  seedGovernmentWorld(state, DATE, NOW, withFunding ? CATALOG : { ...CATALOG, treasury_funding: [] });
  return state;
}

/** A citizen. The date of birth is set so that the age on DATE is exactly `age` (null means no usable birth date). */
function addCitizen(state, name, { age = 40, status = "alive" } = {}) {
  const characterId = `char-${name.toLowerCase()}`;
  // `age` is the field the appointment check reads; date_of_birth is what the approval-age check reads. Both are set.
  const character = { character_id: characterId, name, life_status: status, age: age ?? 40, money: 0 };
  if (age !== null) character.date_of_birth = { year: DATE.year - age, month: 1, day: 1 };
  state.players[`player-${characterId}`] = { playerId: `player-${characterId}`, character };
  // Living citizens get a cash account from the economy, as they do in a real world (the payee needs one).
  initializeEconomyWorldState(state, NOW);
  return characterId;
}

function appointTo(state, definitionId, organisationId, characterId, date = DATE) {
  const office = Object.values(state.governmentOffices)
    .find((o) => o.definition_id === definitionId && o.organisation_id === organisationId);
  assert.ok(office, `premise: ${definitionId} exists in ${organisationId}`);
  return appointOfficial(state, office.office_id, characterId, "operator-seed", date, NOW, CATALOG);
}

const budgetFor = (state, organisationId) => Object.values(state.governmentBudgets)
  .find((b) => b.organisation_id === organisationId);

const snapshot = (state) => JSON.stringify(state);

/** Asserts that `action` throws `pattern` and that the state is byte-for-byte unchanged afterwards. */
function assertRefusedWithoutChange(state, action, pattern) {
  const before = snapshot(state);
  assert.throws(action, pattern);
  assert.equal(snapshot(state), before, "a refused request changes nothing");
}

let fundingCounter = 0;
/** Trusted funding for a test treasury. Revenue has no player route, so this is the only way money arrives. */
function fund(state, organisationId, amountNgn) {
  fundingCounter += 1;
  return recordGovernmentRevenue(state, organisationId, "rev:transfer_in", amountNgn, "Test funding",
    `test-funding-${fundingCounter}`, DATE, NOW, CATALOG);
}

test("the seeded world is fully placed, and reconciling it again changes nothing", () => {
  const state = makeState({ withFunding: true });
  assert.deepEqual(auditGovernmentStructure(state, CATALOG).unresolved, []);
  const before = snapshot(state);
  assert.equal(reconcileGovernmentStructure(state, DATE, NOW, CATALOG), 0, "nothing to add on a complete world");
  assert.equal(snapshot(state), before);
});

test("a legacy world is completed on load without rewriting its existing records", () => {
  const state = makeState();
  // Simulate a world saved before Stage 31: no treasury accounts, no ledger rows, and a legacy federal minister record.
  for (const organisation of Object.values(state.governmentOrganisations)) delete organisation.treasury_account;
  state.governmentRevenue = {};
  const legacyOfficeId = "office:minister:legacy-federal";
  state.governmentOffices[legacyOfficeId] = {
    office_id: legacyOfficeId, definition_id: "office:minister", organisation_id: FEDERAL, label: "Minister (legacy)",
    unique: true, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(),
  };
  const legacyBefore = JSON.stringify(state.governmentOffices[legacyOfficeId]);

  assert.ok(reconcileGovernmentStructure(state, DATE, NOW, CATALOG) > 0, "missing treasury accounts are added");
  for (const organisation of Object.values(state.governmentOrganisations)) {
    assert.ok(organisation.treasury_account, `${organisation.organisation_id} has a treasury account`);
    // The one-time initial funding (Stage 32) lands on the finance treasury at the upgrade. Nothing else is funded.
    const expected = organisation.organisation_id === FINANCE ? CATALOG.treasury_funding[0].amount_ngn : 0;
    assert.equal(organisation.treasury_account.balance_ngn, expected, `${organisation.organisation_id} balance`);
  }
  const funded = JSON.stringify(state.governmentOrganisations[FINANCE].treasury_account);
  assert.equal(reconcileGovernmentStructure(state, DATE, NOW, CATALOG), 0, "a second load funds nothing");
  assert.equal(JSON.stringify(state.governmentOrganisations[FINANCE].treasury_account), funded);
  assert.equal(JSON.stringify(state.governmentOffices[legacyOfficeId]), legacyBefore,
    "the legacy record is not rewritten (no status, no new fields)");
  assert.equal(officePlacement(state, state.governmentOffices[legacyOfficeId], CATALOG).code, "office_scope_incompatible",
    "a legacy federal minister is not placed, so it confers no authority");
  assert.deepEqual(validateGovernmentRecords(state).issues, [], "the completed world validates");
});

test("placement refuses every office that does not fit its organisation, with a stable code", () => {
  const state = makeState();
  const base = { created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() };
  state.governmentOffices["office:probe-unknown"] = { office_id: "office:probe-unknown", definition_id: "office:unknown", organisation_id: FEDERAL, ...base };
  state.governmentOffices["office:probe-missing-org"] = { office_id: "office:probe-missing-org", definition_id: "office:president", organisation_id: "gov:none", ...base };
  state.governmentOffices["office:probe-president-ministry"] = { office_id: "office:probe-president-ministry", definition_id: "office:president", organisation_id: FINANCE, ...base };
  state.governmentOffices["office:probe-minister-electoral"] = { office_id: "office:probe-minister-electoral", definition_id: "office:minister", organisation_id: "gov:electoral", ...base };
  state.governmentOrganisations["gov:probe-state"] = {
    organisation_id: "gov:probe-state", level: "state", name: "Probe", description: "", institution: "executive",
    jurisdiction_id: "ng:state:fc", parent_organisation_id: null, ministry_id: null, status: "active", ...base,
    created_world_date: { ...DATE },
  };
  state.governmentOffices["office:probe-governor"] = { office_id: "office:probe-governor", definition_id: "office:governor", organisation_id: "gov:probe-state", ...base };

  const codeOf = (officeId) => officePlacement(state, state.governmentOffices[officeId], CATALOG).code;
  assert.equal(codeOf("office:probe-unknown"), "office_definition_missing");
  assert.equal(codeOf("office:probe-missing-org"), "organisation_missing");
  assert.equal(codeOf("office:probe-president-ministry"), "office_scope_incompatible");
  assert.equal(codeOf("office:probe-minister-electoral"), "office_institution_incompatible");
  assert.equal(codeOf("office:probe-governor"), "organisation_kind_unrecognised", "a state government with no federal parent");

  // A new appointment to a misplaced office is refused, and nothing is written.
  const characterId = addCitizen(state, "Probe");
  assertRefusedWithoutChange(state, () => appointOfficial(state, "office:probe-president-ministry", characterId,
    "operator-seed", DATE, NOW, CATALOG), /government_office_placement_invalid/);
});

test("a seeded office that does not fit its organisation is not created, and a misplaced seat grants nothing", () => {
  const state = makeState();
  const offices = Object.values(state.governmentOffices);
  for (const office of offices) {
    assert.equal(officePlacement(state, office, CATALOG).ok, true, `${office.office_id} is placed`);
  }
  assert.ok(!offices.some((o) => o.definition_id === "office:governor"), "no governor is seeded without a state government");
});

test("revenue is credited to the treasury, is recorded once per source reference, and rejects invalid input without writing", () => {
  const state = makeState();
  const first = recordGovernmentRevenue(state, FINANCE, "rev:tax", 250000, "Levy", "levy-2026-q1", DATE, NOW, CATALOG);
  assert.equal(first.account_id, `treasury:${FINANCE}`);
  assert.equal(first.actor_character_id, null, "trusted intake has no actor");
  assert.equal(first.balance_after_ngn, 250000);
  assert.equal(state.governmentOrganisations[FINANCE].treasury_account.balance_ngn, 250000);

  const repeat = recordGovernmentRevenue(state, FINANCE, "rev:tax", 250000, "Levy", "levy-2026-q1", DATE, NOW, CATALOG);
  assert.equal(repeat.revenue_id, first.revenue_id, "the same source is recorded once");
  assert.equal(state.governmentOrganisations[FINANCE].treasury_account.balance_ngn, 250000);

  recordGovernmentRevenue(state, FINANCE, "rev:tax", 250000, "Levy", null, DATE, NOW, CATALOG);
  recordGovernmentRevenue(state, FINANCE, "rev:tax", 250000, "Levy", null, DATE, NOW, CATALOG);
  assert.equal(state.governmentOrganisations[FINANCE].treasury_account.balance_ngn, 750000, "without a source, each intake is separate");

  assertRefusedWithoutChange(state, () => recordGovernmentRevenue(state, FINANCE, "rev:unknown", 100, "x", null, DATE, NOW, CATALOG),
    /government_revenue_category_invalid/);
  assertRefusedWithoutChange(state, () => recordGovernmentRevenue(state, FINANCE, "rev:tax", 1.5, "x", null, DATE, NOW, CATALOG),
    /government_revenue_amount_invalid/);
  assertRefusedWithoutChange(state, () => recordGovernmentRevenue(state, "gov:none", "rev:tax", 100, "x", null, DATE, NOW, CATALOG),
    /government_organisation_not_found/);
  assert.deepEqual(auditTreasuryLedger(state), []);
});

test("only a treasury-permitted office can approve, at age 25 or over, and the approver is the server's record", () => {
  const state = makeState();
  // Each ministry has one seat (unique office), so each case uses its own ministry.
  const citizen = addCitizen(state, "Citizen");
  const vp = addCitizen(state, "Deputy", { age: 50 });
  appointTo(state, "office:vice-president", FEDERAL, vp);
  const young = addCitizen(state, "Young", { age: 24 });
  appointTo(state, "office:minister", FINANCE, young);
  const noBirth = addCitizen(state, "Unknown", { age: null });
  appointTo(state, "office:minister", HEALTH, noBirth);
  const adult = addCitizen(state, "Adult", { age: 25 });
  appointTo(state, "office:minister", EDUCATION, adult);
  const financeBudget = budgetFor(state, FINANCE);
  const educationBudget = budgetFor(state, EDUCATION);
  const healthBudget = budgetFor(state, HEALTH);
  const federalBudget = budgetFor(state, FEDERAL);

  assertRefusedWithoutChange(state, () => approveBudget(state, citizen, financeBudget.budget_id, 500000000, DATE, NOW, CATALOG),
    /government_authority_none/);
  assertRefusedWithoutChange(state, () => approveBudget(state, vp, federalBudget.budget_id, 500000000, DATE, NOW, CATALOG),
    /government_permission_none/, "the vice-president holds an office over the federal government but no treasury permission");
  assertRefusedWithoutChange(state, () => approveBudget(state, vp, financeBudget.budget_id, 500000000, DATE, NOW, CATALOG),
    /government_authority_scope/, "the vice-president has no office over a ministry");
  assertRefusedWithoutChange(state, () => approveBudget(state, young, financeBudget.budget_id, 500000000, DATE, NOW, CATALOG),
    /treasury_approval_age_ineligible/);
  assertRefusedWithoutChange(state, () => approveBudget(state, noBirth, healthBudget.budget_id, 500000000, DATE, NOW, CATALOG),
    /government_age_unknown/);
  assertRefusedWithoutChange(state, () => approveBudget(state, adult, financeBudget.budget_id, 500000000, DATE, NOW, CATALOG),
    /government_authority_scope/, "a minister of education cannot approve the finance budget");

  const approved = approveBudget(state, adult, educationBudget.budget_id, 500000000, DATE, NOW, CATALOG);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approved_amount_ngn, 500000000);
  assert.equal(approved.approved_by_character_id, adult, "the approver is the server's authenticated character");

  approveBudget(state, adult, educationBudget.budget_id, 600000000, DATE, NOW, CATALOG);
  assert.equal(state.governmentBudgets[educationBudget.budget_id].approved_amount_ngn, 600000000, "approval is an absolute ceiling");
  assert.equal(authorizeOfficePermission(state, adult, EDUCATION, "budget_approve", DATE, CATALOG).ok, true);
  assert.equal(authorizeOfficePermission(state, vp, FEDERAL, "budget_approve", DATE, CATALOG).code, "government_permission_none");
  assert.equal(characterAgeOn(state, young, DATE), 24, "the age is server-computed");
});

test("the approval age rule is not applied to allocation or spending", () => {
  const state = makeState();
  const young = addCitizen(state, "Young", { age: 20 });
  appointTo(state, "office:minister", HEALTH, young);
  // A ceiling trusted-created by the seeding path (createBudget, status approved). The minister is 20, below the
  // approval age. That does not block allocation or spending, which are not age-gated (Stage 31 decision).
  const budget = createBudget(state, HEALTH, 2027, "bud:healthcare", 500000000, DATE, NOW, CATALOG);
  assert.equal(budget.status, "approved");
  // createBudget sets allocated equal to approved. Setup leaves 400m of headroom for the allocation below.
  state.governmentBudgets[budget.budget_id].allocated_amount_ngn = 100000000;
  assert.equal(authorizeOfficePermission(state, young, HEALTH, "budget_approve", DATE, CATALOG).code, "treasury_approval_age_ineligible",
    "premise: approval is refused at age 20");
  allocateBudget(state, young, budget.budget_id, 100000000, "young-alloc", DATE, NOW, CATALOG);
  fund(state, HEALTH, 50000000);
  const payee = addCitizen(state, "Payee", { age: 30 });
  const spent = spendBudget(state, young, budget.budget_id, 1000000, { kind: "character", id: payee }, "Clinic supplies",
    "young-spend", DATE, NOW, CATALOG);
  assert.equal(spent.expenditure.actor_character_id, young);
});

test("allocation needs a request ID, an approved budget, and the ceiling; retries replay and a changed payload is refused", () => {
  const state = makeState();
  const minister = addCitizen(state, "Minister", { age: 40 });
  appointTo(state, "office:minister", FINANCE, minister);
  const budget = budgetFor(state, FINANCE);

  assertRefusedWithoutChange(state, () => allocateBudget(state, minister, budget.budget_id, 100, undefined, DATE, NOW, CATALOG),
    /treasury_request_id_required/);
  assertRefusedWithoutChange(state, () => allocateBudget(state, minister, budget.budget_id, 100, "bad id with spaces", DATE, NOW, CATALOG),
    /treasury_request_id_required/);
  assertRefusedWithoutChange(state, () => allocateBudget(state, minister, budget.budget_id, 100, "alloc-draft", DATE, NOW, CATALOG),
    /government_budget_not_approved/, "a draft budget cannot be allocated");

  approveBudget(state, minister, budget.budget_id, 500000000, DATE, NOW, CATALOG);
  const first = allocateBudget(state, minister, budget.budget_id, 300000000, "alloc-1", DATE, NOW, CATALOG);
  assert.equal(first.replayed, false);
  assert.equal(state.governmentBudgets[budget.budget_id].allocated_amount_ngn, 300000000);

  const replay = allocateBudget(state, minister, budget.budget_id, 300000000, "alloc-1", DATE, NOW, CATALOG);
  assert.equal(replay.replayed, true);
  assert.equal(state.governmentBudgets[budget.budget_id].allocated_amount_ngn, 300000000, "a replay adds nothing");

  assertRefusedWithoutChange(state, () => allocateBudget(state, minister, budget.budget_id, 200000000, "alloc-1", DATE, NOW, CATALOG),
    /treasury_idempotency_conflict/);
  assertRefusedWithoutChange(state, () => allocateBudget(state, minister, budget.budget_id, 300000000, "alloc-2", DATE, NOW, CATALOG),
    /government_budget_over_approval/, "allocations cannot exceed the approved ceiling");
  assertRefusedWithoutChange(state, () => approveBudget(state, minister, budget.budget_id, 200000000, DATE, NOW, CATALOG),
    /treasury_approval_below_allocation/, "the ceiling cannot drop below what is allocated");
});

test("spending debits the treasury, records one ledger row with server-side actor, and a retry replays the first payment", () => {
  const state = makeState();
  const minister = addCitizen(state, "Minister", { age: 40 });
  const payee = addCitizen(state, "Payee", { age: 30 });
  appointTo(state, "office:minister", FINANCE, minister);
  const budget = budgetFor(state, FINANCE);
  approveBudget(state, minister, budget.budget_id, 500000000, DATE, NOW, CATALOG);
  allocateBudget(state, minister, budget.budget_id, 300000000, "alloc-1", DATE, NOW, CATALOG);
  fund(state, FINANCE, 400000000);

  const destination = { kind: "character", id: payee };
  const first = spendBudget(state, minister, budget.budget_id, 40000000, destination, "Civil service salaries", "spend-1",
    DATE, NOW, CATALOG);
  assert.equal(first.replayed, false);
  assert.equal(first.expenditure.actor_character_id, minister, "the actor is the authenticated character");
  assert.equal(first.expenditure.destination_id, payee);
  assert.equal(first.expenditure.balance_after_ngn, 360000000);
  assert.equal(state.governmentOrganisations[FINANCE].treasury_account.balance_ngn, 360000000);
  assert.equal(state.governmentBudgets[budget.budget_id].spent_amount_ngn, 40000000);
  assert.equal(state.governmentBudgets[budget.budget_id].status, "active");
  assert.match(first.expenditure.request_fingerprint, /^[0-9a-f]{64}$/);
  // The payee is credited in the same write: one payment row, and one credit on the payee's cash account.
  assert.equal(state.economyAccounts[first.expenditure.recipient_account_id].balance_ngn, 40000000);
  assert.equal(state.economyTransactions[first.expenditure.recipient_transaction_id].kind, "government_payment");

  const replay = spendBudget(state, minister, budget.budget_id, 40000000, destination, "Civil service salaries", "spend-1",
    DATE, NOW, CATALOG);
  assert.equal(replay.replayed, true);
  assert.equal(replay.expenditure.expenditure_id, first.expenditure.expenditure_id);
  assert.equal(state.governmentOrganisations[FINANCE].treasury_account.balance_ngn, 360000000, "money moved once");
  assert.equal(state.economyAccounts[first.expenditure.recipient_account_id].balance_ngn, 40000000, "credited once");
  assert.equal(Object.keys(state.governmentExpenditure).length, 1);

  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 20000000, destination,
    "Civil service salaries", "spend-1", DATE, NOW, CATALOG), /treasury_idempotency_conflict/);
  assert.deepEqual(auditTreasuryLedger(state), [], "balances agree with the ledger");
});

test("spending refuses self-payment, owned businesses, unknown destinations, bad kinds, and bad reasons, with no writes", () => {
  const state = makeState();
  const minister = addCitizen(state, "Minister", { age: 40 });
  const other = addCitizen(state, "Other", { age: 30 });
  appointTo(state, "office:minister", FINANCE, minister);
  state.businesses["biz-minister"] = { business_id: "biz-minister", name: "Minister Ventures", owner_character_id: minister, status: "active" };
  state.businesses["biz-other"] = { business_id: "biz-other", name: "Other Ventures", owner_character_id: other, status: "active" };
  const relative = addCitizen(state, "Relative", { age: 30 });
  state.relationships["rel-sibling"] = { relationship_id: "rel-sibling", type: "sibling_of", participants: [minister, relative], status: "active" };
  const budget = budgetFor(state, FINANCE);
  approveBudget(state, minister, budget.budget_id, 500000000, DATE, NOW, CATALOG);
  allocateBudget(state, minister, budget.budget_id, 300000000, "alloc-1", DATE, NOW, CATALOG);
  fund(state, FINANCE, 400000000);

  // Every attempt gets its own request ID, so a refused attempt is never mistaken for a replay of another one.
  let attempt = 0;
  const spend = (destination, reason = "Supplies") => () => {
    attempt += 1;
    return spendBudget(state, minister, budget.budget_id, 1000000, destination, reason, `refuse-${attempt}`, DATE, NOW, CATALOG);
  };
  assertRefusedWithoutChange(state, spend({ kind: "character", id: minister }), /treasury_conflict_of_interest/);
  assertRefusedWithoutChange(state, spend({ kind: "character", id: relative }), /treasury_conflict_of_interest/);
  // Businesses have no receiving rule in Stage 32, so a payment to one is refused whoever owns it.
  assertRefusedWithoutChange(state, spend({ kind: "business", id: "biz-minister" }), /treasury_destination_unsupported/);
  assertRefusedWithoutChange(state, spend({ kind: "business", id: "biz-other" }), /treasury_destination_unsupported/);
  // A character payee with a cash account is a permitted destination. This one goes through.
  const permitted = spendBudget(state, minister, budget.budget_id, 1000000, { kind: "character", id: other }, "Supplies",
    "permitted-1", DATE, NOW, CATALOG);
  assert.equal(permitted.replayed, false);
  assert.equal(state.governmentBudgets[budget.budget_id].spent_amount_ngn, 1000000, "the one permitted payment went through");
  assertRefusedWithoutChange(state, spend({ kind: "character", id: "char-nobody" }), /treasury_destination_not_found/);
  assertRefusedWithoutChange(state, spend({ kind: "business", id: "biz-missing" }), /treasury_destination_unsupported/);
  assertRefusedWithoutChange(state, spend({ kind: "government_office", id: "office:president" }), /treasury_destination_invalid/);
  assertRefusedWithoutChange(state, spend({ kind: "character", id: "" }), /treasury_destination_invalid/);
  assertRefusedWithoutChange(state, spend({ kind: "character", id: other }, "   "), /treasury_reason_invalid/);
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, budget.budget_id, 1000000,
    { kind: "character", id: other }, "Supplies", undefined, DATE, NOW, CATALOG), /treasury_request_id_required/);
});

test("a spend is refused when the budget, the treasury, or the scope does not allow it, and nothing is written", () => {
  const state = makeState();
  const minister = addCitizen(state, "Minister", { age: 40 });
  const health = addCitizen(state, "HealthMinister", { age: 40 });
  const payee = addCitizen(state, "Payee", { age: 30 });
  appointTo(state, "office:minister", FINANCE, minister);
  appointTo(state, "office:minister", HEALTH, health);
  const financeBudget = budgetFor(state, FINANCE);
  const healthBudget = budgetFor(state, HEALTH);
  const destination = { kind: "character", id: payee };

  // Draft budget: nothing is approved, so nothing may be spent.
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, financeBudget.budget_id, 100, destination, "Draft", "d-1", DATE, NOW, CATALOG),
    /government_budget_not_approved/);

  // Another ministry's budget: the finance minister has no authority over it.
  approveBudget(state, health, healthBudget.budget_id, 500000000, DATE, NOW, CATALOG);
  allocateBudget(state, health, healthBudget.budget_id, 100000000, "h-1", DATE, NOW, CATALOG);
  fund(state, HEALTH, 100000000);
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, healthBudget.budget_id, 100, destination, "Cross", "c-1", DATE, NOW, CATALOG),
    /government_authority_scope/);

  // Federal budget: a ministry minister does not control the federal budget.
  const federalBudget = budgetFor(state, FEDERAL);
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, federalBudget.budget_id, 100, destination, "Federal", "f-1", DATE, NOW, CATALOG),
    /government_authority_scope/);

  approveBudget(state, minister, financeBudget.budget_id, 500000000, DATE, NOW, CATALOG);
  allocateBudget(state, minister, financeBudget.budget_id, 400000000, "alloc-1", DATE, NOW, CATALOG);
  // Budget capacity is fine (400m), but the treasury holds nothing yet.
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, financeBudget.budget_id, 100, destination, "No money", "m-1", DATE, NOW, CATALOG),
    /treasury_insufficient_funds/);
  fund(state, FINANCE, 100000000);
  // Treasury holds 100m, budget has 400m available, so a 150m payment fails on the treasury, not the budget.
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, financeBudget.budget_id, 150000000, destination, "Too big", "m-2", DATE, NOW, CATALOG),
    /treasury_insufficient_funds/);
  // Budget is short: 500m is more than the 400m allocated.
  fund(state, FINANCE, 600000000);
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, financeBudget.budget_id, 500000000, destination, "Over budget", "m-3", DATE, NOW, CATALOG),
    /government_insufficient_budget/);

  state.governmentBudgets[financeBudget.budget_id].status = "closed";
  assertRefusedWithoutChange(state, () => spendBudget(state, minister, financeBudget.budget_id, 100, destination, "Closed", "m-4", DATE, NOW, CATALOG),
    /government_budget_closed/);
  assert.deepEqual(auditTreasuryLedger(state), []);
});

test("the trusted expenditure path keeps the exact organisation rule and the funds rule", () => {
  const state = makeState();
  const minister = addCitizen(state, "Minister", { age: 40 });
  appointTo(state, "office:minister", FINANCE, minister);
  const financeBudget = budgetFor(state, FINANCE);
  const federalBudget = budgetFor(state, FEDERAL);
  fund(state, FINANCE, 1000000);

  assertRefusedWithoutChange(state, () => recordGovernmentExpenditure(state, FINANCE, federalBudget.budget_id, "exp:salary", 100,
    "Wrong budget", null, null, DATE, NOW, CATALOG), /government_budget_wrong_organisation/, "a ministry may not spend from the federal budget");
  assertRefusedWithoutChange(state, () => recordGovernmentExpenditure(state, FEDERAL, financeBudget.budget_id, "exp:salary", 100,
    "Wrong budget", null, null, DATE, NOW, CATALOG), /government_budget_wrong_organisation/, "a parent may not spend from a ministry's budget");

  state.governmentBudgets[financeBudget.budget_id].approved_amount_ngn = 1000;
  state.governmentBudgets[financeBudget.budget_id].allocated_amount_ngn = 1000;
  state.governmentBudgets[financeBudget.budget_id].status = "active";
  const expenditure = recordGovernmentExpenditure(state, FINANCE, financeBudget.budget_id, "exp:salary", 500, "Salaries", null, null,
    DATE, NOW, CATALOG);
  assert.equal(expenditure.account_id, `treasury:${FINANCE}`, "the debit is recorded on the treasury");
  assert.equal(state.governmentOrganisations[FINANCE].treasury_account.balance_ngn, 1000000 - 500);
  assert.deepEqual(auditTreasuryLedger(state), []);
});

test("the ledger audit and the record validator detect a balance that does not match its rows", () => {
  const state = makeState();
  fund(state, FINANCE, 5000);
  assert.deepEqual(auditTreasuryLedger(state), []);
  assert.deepEqual(validateGovernmentRecords(state).issues, []);

  state.governmentOrganisations[FINANCE].treasury_account.balance_ngn = 999999;
  assert.ok(auditTreasuryLedger(state).some((problem) => problem.includes("balance does not match")));
  assert.ok(validateGovernmentRecords(state).issues.some((issue) => issue.field === "treasury_account"),
    "a load with a forged balance is refused");
});

test("the record validator accepts legacy ledger rows and does not add fields to them", () => {
  const state = makeState();
  const legacyId = "gov-rev-legacy";
  state.governmentRevenue[legacyId] = {
    revenue_id: legacyId, organisation_id: FEDERAL, category_id: "rev:tax", amount_ngn: 100, description: "Old",
    source_reference: null, received_at: new Date(NOW).toISOString(), received_world_date: { ...DATE },
    idempotency_key: "legacy-key",
  };
  const before = JSON.stringify(state.governmentRevenue[legacyId]);
  const result = validateGovernmentRecords(state);
  assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify(state.governmentRevenue[legacyId]), before, "no field was added to the legacy row");
});

test("a bad optional ledger field is refused by the validator", () => {
  const state = makeState();
  fund(state, FINANCE, 5000);
  const row = Object.values(state.governmentRevenue)[0];
  row.account_id = "treasury:gov:federal";
  assert.ok(validateGovernmentRecords(state).issues.some((i) => i.field === "account_id"));
  row.account_id = `treasury:${FINANCE}`;
  row.actor_character_id = { not: "an id" };
  assert.ok(validateGovernmentRecords(state).issues.some((i) => i.field === "actor_character_id"));
});

// ─── Part B: socket path ──────────────────────────────────────────────────────

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

/** A real socket identity. Its birth date is set so that the age on the world date is `age`. */
async function citizen(entry, backend, name, age) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = backend.store.state.players[identity.playerId].character;
  const worldYear = backend.store.state.worldClock.world_date.year;
  character.age = age;
  character.date_of_birth = { year: worldYear - age, month: 1, day: 1 };
  return { peer, playerId: identity.playerId, characterId: character.character_id };
}

/** Sets an active appointment with the real service (placement, age, and occupancy rules all apply). */
function appointReal(backend, characterId, definitionId, organisationId) {
  const state = backend.store.state;
  const office = Object.values(state.governmentOffices)
    .find((o) => o.definition_id === definitionId && o.organisation_id === organisationId);
  assert.ok(office, `premise: ${definitionId} in ${organisationId}`);
  appointOfficial(state, office.office_id, characterId, "operator-seed", state.worldClock.world_date, Date.now(), CATALOG);
}

/** Trusted funding and a business for the socket tests. These are setup on the in-memory state, not player actions. */
function setup(backend, { funding = 0, minister = null } = {}) {
  const state = backend.store.state;
  if (funding > 0) {
    recordGovernmentRevenue(state, FINANCE, "rev:transfer_in", funding, "Setup funding", `setup-${randomUUID()}`,
      state.worldClock.world_date, Date.now(), CATALOG);
  }
  if (minister) {
    state.businesses["biz-socket-minister"] = {
      business_id: "biz-socket-minister", name: "Ministry Supplies", owner_character_id: minister, status: "active",
    };
  }
}

/** A fingerprint of the world state, minus the engine's pre-dispatch activity markers (see government-authorization.test.mjs). */
function fingerprint(state) {
  return JSON.stringify(state, (key, value) => (key === "lastSeen" || key === "lastActivityAt" ? undefined : value));
}

const financeBalance = (backend) => backend.store.state.governmentOrganisations[FINANCE].treasury_account.balance_ngn;

const TREASURY_REPLY = (reply) => reply.type === "government.result" || reply.type === "government.error";
const waitForGovernment = (peer) => peer.waitFor(TREASURY_REPLY, 20000);

function treasuryRequest(action, requestId, payload = {}) {
  return { type: "government.action", action, requestId, payload };
}

async function sendTreasury(peer, message) {
  peer.send(message);
  return waitForGovernment(peer);
}

for (const backendName of backendNames) {
  const label = (text) => `${backendName}: ${text}`;

  test(label("a minister approves a ceiling over the socket; the actor is the session character, whatever the payload claims"), async () => {
    const { backend, entry } = await session(backendName);
    const minister = await citizen(entry, backend, "Minister", 40);
    appointReal(backend, minister.characterId, "office:minister", FINANCE);
    const budget = budgetFor(backend.store.state, FINANCE);
    const reply = await sendTreasury(minister.peer, treasuryRequest("approve_budget", "sock-approve-1", {
      budget_id: budget.budget_id, approved_amount_ngn: 500000000,
      // Client-supplied authority and identity fields. None of them may be used.
      approved_by_character_id: "char-somebody-else", actor_character_id: "char-somebody-else",
      organisation_id: FEDERAL, owner_character_id: "char-somebody-else",
    }));
    assert.equal(reply.type, "government.result", JSON.stringify(reply));
    const stored = backend.store.state.governmentBudgets[budget.budget_id];
    assert.equal(stored.approved_amount_ngn, 500000000);
    assert.equal(stored.approved_by_character_id, minister.characterId);
    assert.equal(stored.organisation_id, FINANCE, "the organisation is not taken from the payload");
  });

  test(label("a citizen or a non-treasury office holder is refused on every treasury route, and no state changes"), async () => {
    const { backend, entry } = await session(backendName);
    const citizenPeer = await citizen(entry, backend, "Citizen", 40);
    const vp = await citizen(entry, backend, "Deputy", 50);
    appointReal(backend, vp.characterId, "office:vice-president", FEDERAL);
    const payee = await citizen(entry, backend, "Payee", 30);
    setup(backend, { funding: 100000000 });
    const budget = budgetFor(backend.store.state, FINANCE);
    const before = fingerprint(backend.store.state);
    const requests = [
      ["approve_budget", { budget_id: budget.budget_id, approved_amount_ngn: 100 }],
      ["allocate_budget", { budget_id: budget.budget_id, amount_ngn: 100 }],
      ["spend_budget", { budget_id: budget.budget_id, amount_ngn: 100, destination: { kind: "character", id: payee.characterId }, reason: "x" }],
    ];
    const problems = [];
    for (const [action, payload] of requests) {
      for (const [who, peer] of [["citizen", citizenPeer.peer], ["deputy", vp.peer]]) {
        const reply = await sendTreasury(peer, treasuryRequest(action, `sock-deny-${action}-${who}`, payload));
        if (reply.type !== "government.error") problems.push(`${who} ${action}: not refused (${reply.type})`);
        else if (!["government_authority_none", "government_authority_scope", "government_permission_none"].includes(reply.code)) {
          problems.push(`${who} ${action}: unexpected code ${reply.code}`);
        }
      }
    }
    assert.deepEqual(problems, []);
    assert.equal(fingerprint(backend.store.state), before, "no state changed by any refused request");
  });

  test(label("a retry of the same spend replays the first payment and moves the money once"), async () => {
    const { backend, entry } = await session(backendName);
    const minister = await citizen(entry, backend, "Minister", 40);
    const payee = await citizen(entry, backend, "Payee", 30);
    appointReal(backend, minister.characterId, "office:minister", FINANCE);
    const budget = budgetFor(backend.store.state, FINANCE);
    setup(backend, { funding: 400000000 });
    await sendTreasury(minister.peer, treasuryRequest("approve_budget", "sock-a-1", { budget_id: budget.budget_id, approved_amount_ngn: 500000000 }));
    await sendTreasury(minister.peer, treasuryRequest("allocate_budget", "sock-al-1", { budget_id: budget.budget_id, amount_ngn: 300000000 }));

    const start = financeBalance(backend);
    // A socket identity starts with its own cash (from the character record), so the payee is checked by its change.
    const payeeStart = backend.store.state.economyAccounts[Object.values(backend.store.state.economyAccounts)
      .find((a) => a.character_id === payee.characterId && a.kind === "cash").account_id].balance_ngn;
    const payload = { budget_id: budget.budget_id, amount_ngn: 40000000, destination: { kind: "character", id: payee.characterId }, reason: "Salaries" };
    const first = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "sock-spend-1", payload));
    const second = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "sock-spend-1", payload));
    assert.equal(first.type, "government.result", JSON.stringify(first));
    assert.equal(second.type, "government.result");
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.expenditure.expenditure_id, first.data.expenditure.expenditure_id);
    assert.equal(financeBalance(backend), start - 40000000, "debited once");
    assert.equal(Object.keys(backend.store.state.governmentExpenditure).length, 1);
    const payeeAccount = backend.store.state.economyAccounts[first.data.expenditure.recipient_account_id];
    assert.equal(payeeAccount.balance_ngn, payeeStart + 40000000, "credited once to the payee's cash account");
    assert.deepEqual(auditTreasuryLedger(backend.store.state), []);
  });

  test(label("two identical spends sent together move the money once"), async () => {
    const { backend, entry } = await session(backendName);
    const minister = await citizen(entry, backend, "Minister", 40);
    const payee = await citizen(entry, backend, "Payee", 30);
    appointReal(backend, minister.characterId, "office:minister", FINANCE);
    const budget = budgetFor(backend.store.state, FINANCE);
    setup(backend, { funding: 400000000 });
    await sendTreasury(minister.peer, treasuryRequest("approve_budget", "race-a", { budget_id: budget.budget_id, approved_amount_ngn: 500000000 }));
    await sendTreasury(minister.peer, treasuryRequest("allocate_budget", "race-al", { budget_id: budget.budget_id, amount_ngn: 300000000 }));

    const start = financeBalance(backend);
    const payload = { budget_id: budget.budget_id, amount_ngn: 40000000, destination: { kind: "character", id: payee.characterId }, reason: "Race" };
    minister.peer.send(treasuryRequest("spend_budget", "race-spend", payload));
    minister.peer.send(treasuryRequest("spend_budget", "race-spend", payload));
    const replies = [await waitForGovernment(minister.peer), await waitForGovernment(minister.peer)];
    assert.ok(replies.every((r) => r.type === "government.result"), JSON.stringify(replies));
    assert.equal(replies.filter((r) => r.data.replayed === true).length, 1, "exactly one of them is a replay");
    assert.equal(financeBalance(backend), start - 40000000);
    assert.equal(Object.keys(backend.store.state.governmentExpenditure).length, 1);
  });

  test(label("two different spends that together exceed the treasury: one succeeds, the other is refused, and nothing goes negative"), async () => {
    const { backend, entry } = await session(backendName);
    const minister = await citizen(entry, backend, "Minister", 40);
    const payee = await citizen(entry, backend, "Payee", 30);
    appointReal(backend, minister.characterId, "office:minister", FINANCE);
    const budget = budgetFor(backend.store.state, FINANCE);
    setup(backend, { funding: 100000000 });
    await sendTreasury(minister.peer, treasuryRequest("approve_budget", "fund-a", { budget_id: budget.budget_id, approved_amount_ngn: 500000000 }));
    await sendTreasury(minister.peer, treasuryRequest("allocate_budget", "fund-al", { budget_id: budget.budget_id, amount_ngn: 400000000 }));
    // Leave exactly 60m in the treasury through the trusted expenditure path (no player route), so two 40m payments
    // cannot both be paid. Each payment is within the per-payment limit.
    recordGovernmentExpenditure(backend.store.state, FINANCE, null, "exp:other", financeBalance(backend) - 60000000,
      "Test drain", null, null, backend.store.state.worldClock.world_date, Date.now(), CATALOG);
    assert.equal(financeBalance(backend), 60000000, "premise: 60m left");

    const destination = { kind: "character", id: payee.characterId };
    minister.peer.send(treasuryRequest("spend_budget", "pay-a", { budget_id: budget.budget_id, amount_ngn: 40000000, destination, reason: "A" }));
    minister.peer.send(treasuryRequest("spend_budget", "pay-b", { budget_id: budget.budget_id, amount_ngn: 40000000, destination, reason: "B" }));
    const replies = [await waitForGovernment(minister.peer), await waitForGovernment(minister.peer)];
    const successes = replies.filter((r) => r.type === "government.result").length;
    const refusals = replies.filter((r) => r.type === "government.error" && r.code === "treasury_insufficient_funds").length;
    assert.equal(successes, 1);
    assert.equal(refusals, 1);
    assert.equal(financeBalance(backend), 20000000);
    assert.ok(backend.store.state.governmentOrganisations[FINANCE].treasury_account.balance_ngn >= 0);
    assert.deepEqual(auditTreasuryLedger(backend.store.state), []);
  });

  test(label("a minister cannot pay themselves or their own business, and the refusal changes nothing"), async () => {
    const { backend, entry } = await session(backendName);
    const minister = await citizen(entry, backend, "Minister", 40);
    appointReal(backend, minister.characterId, "office:minister", FINANCE);
    const budget = budgetFor(backend.store.state, FINANCE);
    setup(backend, { funding: 100000000, minister: minister.characterId });
    await sendTreasury(minister.peer, treasuryRequest("approve_budget", "self-a", { budget_id: budget.budget_id, approved_amount_ngn: 500000000 }));
    await sendTreasury(minister.peer, treasuryRequest("allocate_budget", "self-al", { budget_id: budget.budget_id, amount_ngn: 300000000 }));
    const before = fingerprint(backend.store.state);

    const self = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "self-pay", {
      budget_id: budget.budget_id, amount_ngn: 1000, destination: { kind: "character", id: minister.characterId }, reason: "Self",
    }));
    assert.equal(self.code, "treasury_conflict_of_interest");
    // Businesses have no receiving rule yet, so a payment to the minister's own business is refused as unsupported.
    const business = await sendTreasury(minister.peer, treasuryRequest("spend_budget", "biz-pay", {
      budget_id: budget.budget_id, amount_ngn: 1000, destination: { kind: "business", id: "biz-socket-minister" }, reason: "Biz",
    }));
    assert.equal(business.code, "treasury_destination_unsupported");
    assert.equal(fingerprint(backend.store.state), before, "neither refusal changed the state");
  });
}
