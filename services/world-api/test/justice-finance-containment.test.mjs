// Justice and financial containment (Stage 28 hardening, slice 1). TEMPORARY, fail-closed, server-side.
//
// Player-initiated routes that cannot yet be authorised or made atomic are refused on the real socket path:
//   - justice.action decide_appeal   -> justice_appeal_decision_suspended   (decision D-01)
//   - justice.action pay_fine        -> justice_fine_payment_suspended      (decision D-02)
//   - crime.action create_criminal_record -> crime_record_creation_suspended (decision D-03)
// Evidence submission and case viewing are restricted to parties to the case (filing party, respondent, or an
// active case-participant record). Non-parties are refused with justice_not_case_party (evidence) or
// justice_case_not_found (view, which does not reveal whether a case exists).
//
// Every refusal test compares the justice, crime, and economy state before and after the request. A refused request
// must change nothing. Positive controls show that the same routes still work for parties where they are allowed,
// and that read-only routes stay available. Trusted service functions are called directly in the setup helpers and
// in the last test, which documents the internal exemption.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import * as J from "../dist/justice/index.js";

const JUSTICE_STATE_MAPS = ["cases", "judgments", "appeals", "fines", "evidence", "caseParticipants", "hearings"];
const COURT_ID = "court:state-high-fct";
const CRIME_CATALOG = JSON.parse(readFileSync(new URL("../../../game/data/crime/catalog.json", import.meta.url), "utf8"));
const CRIME_CATEGORY = CRIME_CATALOG.crime_categories[0].id;

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

/** A real identity over the socket. Age is set through date_of_birth, the field the engine recomputes age from. */
async function citizen(entry, backend, name, age) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  const identity = await createIdentity(peer, name);
  await resumeSession(peer, identity.sessionToken);
  const character = backend.store.state.players[identity.playerId].character;
  const worldDate = backend.store.state.worldClock.world_date;
  character.date_of_birth = { year: worldDate.year - age, month: 1, day: 1 };
  character.age = age;
  return { peer, playerId: identity.playerId, characterId: character.character_id };
}

/** Sends one request and waits for the reply that carries the same requestId. */
function ask(peer, message) {
  peer.send(message);
  return peer.waitFor((reply) => reply.requestId === message.requestId && /\.(result|error)$/.test(reply.type), 5000);
}

/** Deterministic copy of the justice, crime, and economy state that a refused request must not change. */
function protectedState(state) {
  const pick = {};
  for (const key of JUSTICE_STATE_MAPS) pick[key] = state[key] ?? {};
  pick.criminalRecords = state.criminalRecords ?? {};
  pick.crimeIncidents = state.crimeIncidents ?? {};
  pick.economyAccounts = state.economyAccounts ?? {};
  pick.economyTransactions = state.economyTransactions ?? state.financialTransactions ?? {};
  return JSON.parse(JSON.stringify(pick));
}

function cashAccount(state, characterId) {
  return Object.values(state.economyAccounts).find((a) => a.character_id === characterId && a.kind === "cash");
}

/**
 * Builds a case with a judgment and an appeal using trusted service functions on the test state. The judge is an
 * assigned judge of the court, which no player route can do yet. Returns the identifiers the requests need.
 */
function buildAppealChain(backend, filer, respondent, judge) {
  const state = backend.store.state;
  const date = state.worldClock.world_date;
  const now = Date.now();
  const catalog = J.loadJusticeCatalog();
  J.seedJusticeWorld(state, date, now, catalog);
  state.courts[COURT_ID].assigned_judge_ids = [judge.characterId];
  const caseRec = J.fileCase(state, "civil_general", COURT_ID, filer.characterId, respondent.characterId, "Summary.", "Desc.", [], null, date, now, catalog);
  for (const status of ["accepted", "pretrial", "awaiting_hearing", "in_hearing", "awaiting_judgment"]) {
    J.advanceCaseStatus(state, caseRec.case_id, status, filer.characterId, date, now);
  }
  const judgment = J.issueJudgment(state, caseRec.case_id, judge.characterId, "dismissal", "Dismissed.", "Reasoning.", [], true, date, now, catalog);
  const appeal = J.fileAppeal(state, caseRec.case_id, judgment.judgment_id, filer.characterId, "Wrongful dismissal.", "court:appeal-federal", date, now, catalog);
  return { caseId: caseRec.case_id, judgmentId: judgment.judgment_id, appealId: appeal.appeal_id };
}

for (const backendName of backendNames) {
  test(`[${backendName}] decide_appeal is refused for an assigned judge, a party, and a stranger; state is unchanged`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const stranger = await citizen(entry, backend, "Stranger", 30);
    const chain = buildAppealChain(backend, filer, respondent, judge);
    const before = protectedState(backend.store.state);

    for (const [label, actor] of [["stranger", stranger], ["party", filer], ["assigned judge", judge]]) {
      const reply = await ask(actor.peer, {
        type: "justice.action", action: "decide_appeal", requestId: `decide-${label.replace(/\W+/g, "-")}`,
        appeal_id: chain.appealId, outcome: "reversed", reasoning: "Attempt.",
        decided_by_character_id: actor.characterId, judge_character_id: judge.characterId,
      });
      assert.equal(reply.type, "justice.error", label);
      assert.equal(reply.code, "justice_appeal_decision_suspended", label);
    }
    assert.deepEqual(protectedState(backend.store.state), before);
    assert.equal(backend.store.state.appeals[chain.appealId].status, "filed");
    assert.equal(backend.store.state.judgments[chain.judgmentId].status, "under_appeal");
    assert.equal(backend.store.state.cases[chain.caseId].status, "appeal_pending");
  });

  test(`[${backendName}] pay_fine is refused for the responsible character and for a third party; no fine or money changes`, async () => {
    const { backend, entry } = await session(backendName);
    const debtor = await citizen(entry, backend, "Debtor", 30);
    const payer = await citizen(entry, backend, "Payer", 30);
    const state = backend.store.state;
    const date = state.worldClock.world_date;
    const fine = J.createFine(state, "case-containment", "judgment-containment", "sentence-containment", debtor.characterId, 500000, "2026-12-31", date, Date.now());
    const debtorCash = cashAccount(state, debtor.characterId);
    const payerCash = cashAccount(state, payer.characterId);
    const before = protectedState(state);
    const beforeBalances = { debtor: debtorCash?.balance_ngn ?? null, payer: payerCash?.balance_ngn ?? null };

    const attempts = [
      { actor: debtor, label: "responsible character", transaction_id: "tx-self-1" },
      { actor: payer, label: "third party", transaction_id: "tx-third-1" },
      { actor: payer, label: "fabricated transaction id", transaction_id: "tx-" + "a".repeat(20) },
    ];
    for (const attempt of attempts) {
      const reply = await ask(attempt.actor.peer, {
        type: "justice.action", action: "pay_fine", requestId: `pay-${attempt.label.replace(/\W+/g, "-")}`,
        fine_id: fine.fine_id, amount_ngn: 500000, transaction_id: attempt.transaction_id,
        payer_character_id: attempt.actor.characterId,
      });
      assert.equal(reply.type, "justice.error", attempt.label);
      assert.equal(reply.code, "justice_fine_payment_suspended", attempt.label);
    }
    assert.equal(state.fines[fine.fine_id].status, "outstanding");
    assert.equal(state.fines[fine.fine_id].amount_paid_ngn, 0);
    assert.deepEqual(protectedState(state), before);
    assert.deepEqual({ debtor: cashAccount(state, debtor.characterId)?.balance_ngn ?? null, payer: cashAccount(state, payer.characterId)?.balance_ngn ?? null }, beforeBalances);
  });

  test(`[${backendName}] create_criminal_record is refused against another character, against self, and with a made-up incident; no record is created`, async () => {
    const { backend, entry } = await session(backendName);
    const victim = await citizen(entry, backend, "Victim", 35);
    const offender = await citizen(entry, backend, "Offender", 30);
    const before = protectedState(backend.store.state);
    const requests = [
      { label: "other character", character_id: victim.characterId, conviction: true },
      { label: "self", character_id: offender.characterId, conviction: true },
      { label: "no conviction flag", character_id: victim.characterId, conviction: false },
    ];
    for (const request of requests) {
      const reply = await ask(offender.peer, {
        type: "crime.action", action: "create_criminal_record", requestId: `record-${request.label.replace(/\W+/g, "-")}`,
        incident_id: "inc-made-up-by-player", category: CRIME_CATEGORY, severity: "minor", ...request,
      });
      assert.equal(reply.type, "crime.error", request.label);
      assert.equal(reply.code, "crime_record_creation_suspended", request.label);
    }
    assert.deepEqual(protectedState(backend.store.state), before);
    assert.equal(Object.keys(backend.store.state.criminalRecords).length, 0);
  });

  test(`[${backendName}] submit_evidence: parties may submit; a stranger, a forged party field, and a withdrawn participant are refused`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const stranger = await citizen(entry, backend, "Stranger", 30);
    const witness = await citizen(entry, backend, "Witness", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const chain = buildAppealChain(backend, filer, respondent, judge);
    const state = backend.store.state;
    // An active participant record for the witness, written through the trusted path (no player route adds one yet).
    state.caseParticipants["part-containment-witness"] = {
      participant_id: "part-containment-witness", case_id: chain.caseId, character_id: witness.characterId, role: "witness",
      joined_at: new Date().toISOString(), joined_world_date: state.worldClock.world_date, status: "active", updated_at: new Date().toISOString(),
    };
    state.caseParticipants["part-containment-withdrawn"] = {
      participant_id: "part-containment-withdrawn", case_id: chain.caseId, character_id: stranger.characterId, role: "witness",
      joined_at: new Date().toISOString(), joined_world_date: state.worldClock.world_date, status: "withdrawn", updated_at: new Date().toISOString(),
    };

    const evidenceCount = () => Object.values(state.evidence).filter((e) => e.case_id === chain.caseId).length;
    for (const [label, actor] of [["filing party", filer], ["respondent", respondent], ["active witness", witness]]) {
      const before = evidenceCount();
      const reply = await ask(actor.peer, {
        type: "justice.action", action: "submit_evidence", requestId: `ev-ok-${label.replace(/\W+/g, "-")}`,
        case_id: chain.caseId, category: "document", description: `Evidence by ${label}.`,
      });
      assert.equal(reply.type, "justice.result", label);
      assert.equal(evidenceCount(), before + 1, label);
    }

    const beforeRefusals = protectedState(state);
    const refusals = [
      { label: "stranger", actor: stranger, extra: {} },
      { label: "stranger with forged party fields", actor: stranger, extra: { actor_character_id: filer.characterId, character_id: filer.characterId, party: true } },
      { label: "withdrawn participant", actor: stranger, extra: { role: "claimant" } },
    ];
    for (const refusal of refusals) {
      const reply = await ask(refusal.actor.peer, {
        type: "justice.action", action: "submit_evidence", requestId: `ev-no-${refusal.label.replace(/\W+/g, "-")}`,
        case_id: chain.caseId, category: "document", description: "Attempt.", ...refusal.extra,
      });
      assert.equal(reply.type, "justice.error", refusal.label);
      assert.equal(reply.code, "justice_not_case_party", refusal.label);
    }
    assert.deepEqual(protectedState(state), beforeRefusals);
  });

  test(`[${backendName}] view_case: parties see the case; a stranger and a made-up ID get the same refusal with no case data`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const stranger = await citizen(entry, backend, "Stranger", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const chain = buildAppealChain(backend, filer, respondent, judge);

    const partyView = await ask(filer.peer, { type: "justice.action", action: "view_case", requestId: "view-party", case_id: chain.caseId });
    assert.equal(partyView.type, "justice.result");
    assert.equal(partyView.data.case.case_id, chain.caseId);

    const strangerView = await ask(stranger.peer, { type: "justice.action", action: "view_case", requestId: "view-stranger", case_id: chain.caseId });
    const madeUpView = await ask(stranger.peer, { type: "justice.action", action: "view_case", requestId: "view-made-up", case_id: "case-made-up-by-player" });
    for (const reply of [strangerView, madeUpView]) {
      assert.equal(reply.type, "justice.error");
      assert.equal(reply.code, "justice_case_not_found");
      assert.equal(reply.data, undefined);
      assert.equal(reply.case, undefined);
    }
    assert.equal(strangerView.message, madeUpView.message);
  });

  test(`[${backendName}] read-only justice routes stay available to any player`, async () => {
    const { backend, entry } = await session(backendName);
    const player = await citizen(entry, backend, "Reader", 30);
    for (const action of ["search_laws", "active_laws", "list_courts", "my_cases", "my_fines", "legal_profile"]) {
      const reply = await ask(player.peer, { type: "justice.action", action, requestId: `read-${action}` });
      assert.equal(reply.type, "justice.result", action);
    }
    const court = await ask(player.peer, { type: "justice.action", action: "view_court", requestId: "read-view-court", court_id: COURT_ID });
    assert.equal(court.type, "justice.result", "view_court");
  });

  test(`[${backendName}] the trusted service path is unchanged: direct calls still decide, pay, and record (internal exemption)`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const chain = buildAppealChain(backend, filer, respondent, judge);
    const state = backend.store.state;
    const date = state.worldClock.world_date;
    const decided = J.decideAppeal(state, chain.appealId, "affirmed", "Affirmed on review.", judge.characterId, date, Date.now());
    assert.equal(decided.status, "decided");
    const fine = J.createFine(state, chain.caseId, chain.judgmentId, "sentence-trusted", respondent.characterId, 1000, "2026-12-31", date, Date.now());
    J.payFine(state, fine.fine_id, 400, "tx-trusted-1", date, Date.now());
    assert.equal(state.fines[fine.fine_id].amount_paid_ngn, 400);
  });
}
