/**
 * Case access for judges (access policy, Stage 28 Foundation Hardening, D-01).
 *
 * Through the real WebSocket request path:
 *   - an assigned, active judge of the case's own court may view the case (positive);
 *   - that judge may not submit evidence in that capacity (negative);
 *   - a judge assigned to a different court, or with a suspended appointment, gets the same refusal as a missing case;
 *   - a party may still submit evidence (positive control).
 *
 * Judges are created only through the trusted justice service functions (appointLegalProfessional, then
 * assignJudgeToCourt), which no player request can call. Players reach the case only through socket requests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import * as J from "../dist/justice/index.js";

const COURT_ID = "court:state-high-fct";
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

function evidenceCount(state, caseId) {
  return Object.values(state.evidence ?? {}).filter((e) => e.case_id === caseId).length;
}

/**
 * Seeds a filed case on the test state using trusted service functions. The judge is appointed and assigned through the
 * same functions an operator-level process would use. Returns the identifiers the requests need.
 */
function seedCase(backend, filer, respondent) {
  const state = backend.store.state;
  const date = state.worldClock.world_date;
  const now = Date.now();
  const catalog = J.loadJusticeCatalog();
  J.seedJusticeWorld(state, date, now, catalog);
  const caseRec = J.fileCase(state, "civil_general", COURT_ID, filer.characterId, respondent.characterId, "Summary.", "Desc.", [], null, date, now, catalog);
  return { caseId: caseRec.case_id, date, now, catalog, state };
}

function appointJudge(seed, judge, courtId) {
  const pro = J.appointLegalProfessional(seed.state, judge.characterId, "judge", [], "operator-seed", seed.date, seed.now, seed.catalog);
  J.assignJudgeToCourt(seed.state, courtId, judge.characterId, pro.professional_id, seed.date, seed.now);
  return pro;
}

for (const backendName of backendNames) {
  test(`[${backendName}] an assigned judge of the case's court may view the case but may not submit evidence; a party still may`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const seed = seedCase(backend, filer, respondent);
    appointJudge(seed, judge, COURT_ID);

    const judgeView = await ask(judge.peer, { type: "justice.action", action: "view_case", requestId: "judge-view", case_id: seed.caseId });
    assert.equal(judgeView.type, "justice.result", "the assigned judge may view the case");
    assert.equal(judgeView.data.case.case_id, seed.caseId);

    const before = evidenceCount(backend.store.state, seed.caseId);
    const judgeEvidence = await ask(judge.peer, {
      type: "justice.action", action: "submit_evidence", requestId: "judge-evidence",
      case_id: seed.caseId, category: "document", description: "A judge's own exhibit.",
    });
    assert.equal(judgeEvidence.type, "justice.error");
    assert.equal(judgeEvidence.code, "justice_judge_cannot_submit_evidence", "a judge does not submit evidence in that capacity");
    assert.equal(evidenceCount(backend.store.state, seed.caseId), before, "the refused evidence was not recorded");

    const partyEvidence = await ask(filer.peer, {
      type: "justice.action", action: "submit_evidence", requestId: "party-evidence",
      case_id: seed.caseId, category: "document", description: "The filer's exhibit.",
    });
    assert.equal(partyEvidence.type, "justice.result", "a party may still submit evidence");
    assert.equal(evidenceCount(backend.store.state, seed.caseId), before + 1);
  });

  test(`[${backendName}] a judge of another court, or one with a suspended appointment, gets the same refusal as a missing case`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const otherJudge = await citizen(entry, backend, "OtherCourtJudge", 45);
    const suspendedJudge = await citizen(entry, backend, "SuspendedJudge", 45);
    const seed = seedCase(backend, filer, respondent);
    const otherCourtId = Object.keys(seed.state.courts).find((id) => id !== COURT_ID);
    assert.ok(otherCourtId, "premise: a second court exists in the seeded world");
    appointJudge(seed, otherJudge, otherCourtId);
    const suspended = appointJudge(seed, suspendedJudge, COURT_ID);
    suspended.status = "suspended";

    const otherView = await ask(otherJudge.peer, { type: "justice.action", action: "view_case", requestId: "other-court-view", case_id: seed.caseId });
    const suspendedView = await ask(suspendedJudge.peer, { type: "justice.action", action: "view_case", requestId: "suspended-view", case_id: seed.caseId });
    const madeUp = await ask(otherJudge.peer, { type: "justice.action", action: "view_case", requestId: "made-up-view", case_id: "case-made-up-by-player" });
    for (const reply of [otherView, suspendedView, madeUp]) {
      assert.equal(reply.type, "justice.error");
      assert.equal(reply.code, "justice_case_not_found", "no case data and no existence signal");
      assert.equal(reply.data, undefined, "the refusal carries no case data");
    }
  });
}
