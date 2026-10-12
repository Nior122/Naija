// Judicial authority over judgments (Stage 30, rules J-2, J-3, J-8).
//
// `issue_judgment` is a live player route. Before this stage it checked only that the character was listed in the
// court's assigned-judge list. That allowed three things the authority model forbids:
//   - a judge listed on the court whose legal-professional record was no longer active (suspended or inactive) still
//     issued judgments (rule J-2 requires an active judicial appointment to the case's own court);
//   - a judge who was a party to the case (filing party, respondent, or active participant) judged their own case
//     (principle: judges must not determine a matter in which they are involved);
//   - a non-judge got `justice_judge_not_assigned` for an existing case, which told them the case existed
//     (rule J-3: anyone who is not a party or assigned judge gets `justice_case_not_found`).
//
// Every test drives the real WebSocket request path and then reads the authoritative state. Judges are appointed and
// assigned through the trusted justice service functions, which no player request can call. The case is moved to
// awaiting_judgment through the trusted status function, because no player route advances case status.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { createIdentity, openPeer, resumeSession } from "./support/harness.mjs";
import * as J from "../dist/justice/index.js";

const COURT_ID = "court:state-high-fct";
const OTHER_COURT_ID = "court:federal-high";
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

function ask(peer, message) {
  peer.send(message);
  return peer.waitFor((reply) => reply.requestId === message.requestId && /\.(result|error)$/.test(reply.type), 20000);
}

/** The state a judgment request could change: the case, its judgments, its evidence, and its audit trail. */
function caseFootprint(state, caseId) {
  const pick = (map) => Object.values(map ?? {}).filter((r) => r.case_id === caseId);
  return JSON.stringify({
    cases: state.cases[caseId] ?? null,
    judgments: pick(state.judgments),
    evidence: pick(state.evidence),
    legalAudits: pick(state.legalAudits),
  });
}

function judgmentCount(state, caseId) {
  return Object.values(state.judgments ?? {}).filter((j) => j.case_id === caseId).length;
}

/** Seeds the justice world once per test. Returns the trusted date, time, and catalogue. */
function seedWorld(backend) {
  const state = backend.store.state;
  const date = state.worldClock.world_date;
  const now = Date.now();
  const catalog = J.loadJusticeCatalog();
  J.seedJusticeWorld(state, date, now, catalog);
  return { state, date, now, catalog };
}

/** A case filed by `filer` against `respondent` in `courtId`, moved to awaiting_judgment through the trusted status function. */
function awaitingJudgmentCase(seed, filer, respondent, courtId = COURT_ID) {
  const caseRec = J.fileCase(seed.state, "civil_general", courtId, filer.characterId, respondent.characterId, "Summary.", "Desc.", [], null, seed.date, seed.now, seed.catalog);
  for (const status of ["accepted", "pretrial", "awaiting_hearing", "in_hearing", "awaiting_judgment"]) {
    J.advanceCaseStatus(seed.state, caseRec.case_id, status, filer.characterId, seed.date, seed.now);
  }
  return caseRec.case_id;
}

/** Appoints a judge through the trusted path (appointment, then assignment to the court). */
function appointJudge(seed, judge, courtId = COURT_ID) {
  const pro = J.appointLegalProfessional(seed.state, judge.characterId, "judge", [], "operator-seed", seed.date, seed.now, seed.catalog);
  J.assignJudgeToCourt(seed.state, courtId, judge.characterId, pro.professional_id, seed.date, seed.now);
  return pro;
}

const judgmentPayload = (caseId, extra = {}) => ({
  type: "justice.action", action: "issue_judgment", case_id: caseId,
  outcome: "civil_remedy", findings: "Found for the claimant.", reasoning: "Reasoning.", ...extra,
});

for (const backendName of backendNames) {
  test(`[${backendName}] an active, assigned, non-party judge issues the judgment; a second judgment on the same case is refused`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const seed = seedWorld(backend);
    const caseId = awaitingJudgmentCase(seed, filer, respondent);
    appointJudge(seed, judge);

    const issued = await ask(judge.peer, judgmentPayload(caseId, { requestId: "judge-issue-1" }));
    assert.equal(issued.type, "justice.result", "the active, assigned, non-party judge issues the judgment");
    assert.equal(judgmentCount(backend.store.state, caseId), 1, "exactly one judgment is recorded");
    assert.equal(backend.store.state.cases[caseId].status, "judgment_issued");

    const again = await ask(judge.peer, judgmentPayload(caseId, { requestId: "judge-issue-2" }));
    assert.equal(again.type, "justice.error");
    assert.equal(again.code, "justice_case_not_awaiting_judgment", "a second judgment is refused once the case is decided");
    assert.equal(judgmentCount(backend.store.state, caseId), 1, "no second judgment is created");
  });

  test(`[${backendName}] judgment refusals: each non-authorised actor gets the refusal their standing earns; state is unchanged`, async () => {
    const { backend, entry } = await session(backendName);
    const seed = seedWorld(backend);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const stranger = await citizen(entry, backend, "Stranger", 30);
    const filerJudge = await citizen(entry, backend, "FilerJudge", 45);
    const respondentJudge = await citizen(entry, backend, "RespondentJudge", 45);
    const participantJudge = await citizen(entry, backend, "ParticipantJudge", 45);
    const otherCourtJudge = await citizen(entry, backend, "OtherCourtJudge", 45);
    const suspendedJudge = await citizen(entry, backend, "SuspendedJudge", 45);
    const inactiveJudge = await citizen(entry, backend, "InactiveJudge", 45);
    const unassignedJudge = await citizen(entry, backend, "UnassignedJudge", 45);
    const ghostJudge = await citizen(entry, backend, "GhostJudge", 45);

    // Case A: the filing party is an assigned judge of the court (party conflict).
    const caseA = awaitingJudgmentCase(seed, filerJudge, respondent);
    // Case B: the respondent is an assigned judge, and a second judge is an active participant (conflicts).
    const caseB = awaitingJudgmentCase(seed, await citizen(entry, backend, "CaseBFiler", 30), respondentJudge);
    seed.state.caseParticipants = seed.state.caseParticipants ?? {};
    seed.state.caseParticipants["part-judge-participant"] = {
      participant_id: "part-judge-participant", case_id: caseB, character_id: participantJudge.characterId,
      role: "witness", status: "active",
    };

    appointJudge(seed, filerJudge);
    appointJudge(seed, respondentJudge);
    appointJudge(seed, participantJudge);
    appointJudge(seed, otherCourtJudge, OTHER_COURT_ID);
    appointJudge(seed, suspendedJudge).status = "suspended";
    appointJudge(seed, inactiveJudge).status = "inactive";
    J.appointLegalProfessional(seed.state, unassignedJudge.characterId, "judge", [], "operator-seed", seed.date, seed.now, seed.catalog);
    // The ghost is listed on the court's assigned list with no authority record behind it.
    seed.state.courts[COURT_ID].assigned_judge_ids.push(ghostJudge.characterId);

    const beforeA = caseFootprint(backend.store.state, caseA);
    const beforeB = caseFootprint(backend.store.state, caseB);

    const refusalsA = [
      [stranger, "stranger", "justice_case_not_found"],
      [otherCourtJudge, "judge of another court", "justice_case_not_found"],
      [suspendedJudge, "judge with a suspended appointment", "justice_case_not_found"],
      [inactiveJudge, "judge with an inactive appointment", "justice_case_not_found"],
      [unassignedJudge, "judge with an appointment but no court assignment", "justice_case_not_found"],
      [ghostJudge, "judge listed on the court with no authority record", "justice_case_not_found"],
      [filerJudge, "judge who is the filing party", "justice_judge_conflicted"],
    ];
    for (const [index, [actor, label, code]] of refusalsA.entries()) {
      const reply = await ask(actor.peer, judgmentPayload(caseA, { requestId: `refuse-a-${index}` }));
      assert.equal(reply.type, "justice.error", `${label}: refused`);
      assert.equal(reply.code, code, `${label}: ${code}`);
      assert.equal(reply.data, undefined, `${label}: no case data in the refusal`);
    }
    // Forged judge identity fields in the request are ignored: the server identity decides.
    const forged = await ask(stranger.peer, judgmentPayload(caseA, { requestId: "refuse-forged", judge_character_id: otherCourtJudge.characterId, character_id: respondentJudge.characterId }));
    assert.equal(forged.code, "justice_case_not_found", "forged judge fields do not confer standing");

    const respondentRefusal = await ask(respondentJudge.peer, judgmentPayload(caseB, { requestId: "refuse-b-respondent" }));
    assert.equal(respondentRefusal.code, "justice_judge_conflicted", "a judge who is the respondent may not judge the case");
    const participantRefusal = await ask(participantJudge.peer, judgmentPayload(caseB, { requestId: "refuse-b-participant" }));
    assert.equal(participantRefusal.code, "justice_judge_conflicted", "a judge who is an active participant may not judge the case");

    assert.equal(caseFootprint(backend.store.state, caseA), beforeA, "no change to case A");
    assert.equal(caseFootprint(backend.store.state, caseB), beforeB, "no change to case B");
    assert.equal(judgmentCount(backend.store.state, caseA), 0, "no judgment was created on case A");
    assert.equal(judgmentCount(backend.store.state, caseB), 0, "no judgment was created on case B");
  });

  test(`[${backendName}] a judge's authority ends with the appointment: a judge suspended after assignment is refused at once`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const seed = seedWorld(backend);
    const caseId = awaitingJudgmentCase(seed, filer, respondent);
    const pro = appointJudge(seed, judge);

    // Premise: the judge is able to act before the suspension.
    const premise = await ask(judge.peer, { type: "justice.action", action: "view_case", requestId: "premise-view", case_id: caseId });
    assert.equal(premise.type, "justice.result", "premise: the assigned judge can view the case");

    // The appointment is suspended by a trusted path. The judge's next judgment is refused.
    pro.status = "suspended";
    const reply = await ask(judge.peer, judgmentPayload(caseId, { requestId: "after-suspension" }));
    assert.equal(reply.type, "justice.error");
    assert.equal(reply.code, "justice_case_not_found", "a suspended judge is refused as if the case did not exist to them");
    assert.equal(judgmentCount(backend.store.state, caseId), 0, "no judgment is issued after suspension");
  });
}
