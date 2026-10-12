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
  return peer.waitFor((reply) => reply.requestId === message.requestId && /\.(result|error)$/.test(reply.type), 20000);
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

/** The part of the world a case request could change: the case, its evidence, participants, hearings, and audit. */
function caseFootprint(state, caseId) {
  const pick = (map) => Object.values(map ?? {}).filter((r) => r.case_id === caseId);
  return JSON.parse(JSON.stringify({
    cases: state.cases[caseId] ?? null,
    evidence: pick(state.evidence),
    caseParticipants: pick(state.caseParticipants),
    hearings: pick(state.hearings),
    legalAudits: pick(state.legalAudits),
  }));
}

/** The fields a player can see on a refusal. Two refusals are indistinguishable when these match. */
function refusalShape(reply) {
  return { type: reply.type, action: reply.action, code: reply.code, message: reply.message, data: reply.data, case: reply.case };
}

const OPEN_STATUSES = ["submitted", "accepted", "awaiting_response", "pretrial", "awaiting_hearing", "in_hearing"];
const CLOSED_STATUSES = ["draft", "rejected", "awaiting_judgment", "judgment_issued", "eligible_for_appeal", "appeal_pending", "settled", "withdrawn", "dismissed", "closed"];

for (const backendName of backendNames) {
  test(`[${backendName}] an unrelated player gets the same refusal for view_case and submit_evidence as for a missing case; nothing changes`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const stranger = await citizen(entry, backend, "Stranger", 30);
    const seed = seedCase(backend, filer, respondent);
    const state = backend.store.state;
    const footprint = caseFootprint(state, seed.caseId);
    // lastSeen and session.lastActivityAt are activity markers, refreshed for any authenticated request (existing
    // behaviour). Everything else on the player record must be unchanged by a refusal.
    const playerRecord = () => JSON.stringify(state.players[stranger.playerId], (key, value) => (key === "lastSeen" || key === "lastActivityAt" ? undefined : value));
    const strangerRecord = playerRecord();

    const viewMissing = await ask(stranger.peer, { type: "justice.action", action: "view_case", requestId: "v-missing", case_id: "case-made-up-by-player" });
    const viewPrivate = await ask(stranger.peer, { type: "justice.action", action: "view_case", requestId: "v-private", case_id: seed.caseId });
    const evidenceMissing = await ask(stranger.peer, {
      type: "justice.action", action: "submit_evidence", requestId: "e-missing", case_id: "case-made-up-by-player", category: "document", description: "Attempt.",
    });
    const evidencePrivate = await ask(stranger.peer, {
      type: "justice.action", action: "submit_evidence", requestId: "e-private", case_id: seed.caseId, category: "document", description: "Attempt.",
    });

    assert.equal(viewPrivate.code, "justice_case_not_found");
    assert.deepEqual(refusalShape(viewPrivate), refusalShape({ ...viewMissing, requestId: undefined }), "view: same as a missing case");
    assert.equal(evidencePrivate.code, "justice_case_not_found");
    assert.deepEqual(refusalShape(evidencePrivate), refusalShape({ ...evidenceMissing, requestId: undefined }), "evidence: same as a missing case");
    assert.deepEqual(caseFootprint(state, seed.caseId), footprint, "a refused request changes no case data");
    assert.equal(playerRecord(), strangerRecord, "a refused request changes no player record (activity markers aside)");
  });

  test(`[${backendName}] a judge not assigned to the case, or listed as assigned without an authority record, gets the missing-case refusal`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const unassigned = await citizen(entry, backend, "UnassignedJudge", 45);
    const ghost = await citizen(entry, backend, "GhostJudge", 45);
    const seed = seedCase(backend, filer, respondent);
    const state = backend.store.state;
    // Appointed to the same court, but never assigned to this case's court assignment list.
    J.appointLegalProfessional(state, unassigned.characterId, "judge", [], "operator-seed", seed.date, seed.now, seed.catalog);
    // Listed on the court's assignment list with no active authority record: an invalid assignment.
    assert.equal(state.courts[COURT_ID].assigned_judge_ids.includes(unassigned.characterId), false, "premise: not assigned");
    state.courts[COURT_ID].assigned_judge_ids.push(ghost.characterId);

    const footprint = caseFootprint(state, seed.caseId);
    const missing = await ask(unassigned.peer, { type: "justice.action", action: "view_case", requestId: "missing-ref", case_id: "case-made-up-by-player" });
    for (const [label, actor] of [["unassigned judge", unassigned], ["judge with no authority record", ghost]]) {
      const view = await ask(actor.peer, { type: "justice.action", action: "view_case", requestId: `view-${label.replace(/\W+/g, "-")}`, case_id: seed.caseId });
      assert.equal(view.code, "justice_case_not_found", `${label}: view`);
      assert.deepEqual(refusalShape(view), refusalShape({ ...missing, requestId: undefined }), `${label}: view is the missing-case refusal`);
      const evidence = await ask(actor.peer, { type: "justice.action", action: "submit_evidence", requestId: `ev-${label.replace(/\W+/g, "-")}`, case_id: seed.caseId, category: "document", description: "Attempt." });
      assert.equal(evidence.code, "justice_case_not_found", `${label}: evidence`);
    }
    assert.deepEqual(caseFootprint(state, seed.caseId), footprint, "refusals change no case data");
  });

  test(`[${backendName}] an assigned judge who is also an active participant is still refused evidence; the judicial role is not a party role`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const seed = seedCase(backend, filer, respondent);
    appointJudge(seed, judge, COURT_ID);
    const state = backend.store.state;
    state.caseParticipants["part-judge-as-witness"] = {
      participant_id: "part-judge-as-witness", case_id: seed.caseId, character_id: judge.characterId, role: "witness",
      joined_at: new Date().toISOString(), joined_world_date: state.worldClock.world_date, status: "active", updated_at: new Date().toISOString(),
    };
    const before = evidenceCount(state, seed.caseId);
    const reply = await ask(judge.peer, { type: "justice.action", action: "submit_evidence", requestId: "judge-participant", case_id: seed.caseId, category: "document", description: "Attempt." });
    assert.equal(reply.code, "justice_judge_cannot_submit_evidence");
    assert.equal(evidenceCount(state, seed.caseId), before);
  });

  test(`[${backendName}] evidence is accepted only while the case is open to evidence, for parties; refusals are the same for every closed status and change nothing`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const seed = seedCase(backend, filer, respondent);
    const state = backend.store.state;
    const caseRec = state.cases[seed.caseId];
    const problems = [];
    let n = 0;
    for (const status of [...OPEN_STATUSES, ...CLOSED_STATUSES]) {
      caseRec.status = status;
      const actor = n % 2 === 0 ? filer : respondent;
      const before = caseFootprint(state, seed.caseId);
      const reply = await ask(actor.peer, {
        type: "justice.action", action: "submit_evidence", requestId: `status-${n++}`, case_id: seed.caseId, category: "document", description: `In ${status}.`,
      });
      const open = OPEN_STATUSES.includes(status);
      if (open) {
        if (reply.type !== "justice.result") problems.push(`${status}: expected acceptance, got ${reply.code}`);
      } else {
        if (reply.code !== "justice_case_not_open_for_evidence") problems.push(`${status}: expected justice_case_not_open_for_evidence, got ${reply.code}`);
        if (JSON.stringify(caseFootprint(state, seed.caseId)) !== JSON.stringify(before)) problems.push(`${status}: refusal changed state`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test(`[${backendName}] client-supplied authority fields are ignored: the server identity decides, for view and evidence`, async () => {
    const { backend, entry } = await session(backendName);
    const filer = await citizen(entry, backend, "Filer", 30);
    const respondent = await citizen(entry, backend, "Respondent", 30);
    const stranger = await citizen(entry, backend, "Stranger", 30);
    const judge = await citizen(entry, backend, "Judge", 45);
    const seed = seedCase(backend, filer, respondent);
    appointJudge(seed, judge, COURT_ID);
    const state = backend.store.state;
    const forged = {
      character_id: filer.characterId, characterId: filer.characterId, player_id: filer.playerId,
      submitted_by_character_id: filer.characterId, actor_character_id: filer.characterId,
      party: true, role: "judge", is_judge: true, judge_character_id: judge.characterId,
      assigned_judge_character_id: judge.characterId, court_id: COURT_ID,
    };

    // A stranger who forges party and judge fields is still a stranger.
    const forgedView = await ask(stranger.peer, { type: "justice.action", action: "view_case", requestId: "forged-view", case_id: seed.caseId, ...forged });
    assert.equal(forgedView.code, "justice_case_not_found");
    const forgedEvidence = await ask(stranger.peer, { type: "justice.action", action: "submit_evidence", requestId: "forged-ev", case_id: seed.caseId, category: "document", description: "Attempt.", ...forged });
    assert.equal(forgedEvidence.code, "justice_case_not_found");

    // A judge who forges another character's id is still judged on the server identity: refused as the judge.
    const judgeEvidence = await ask(judge.peer, { type: "justice.action", action: "submit_evidence", requestId: "judge-forged-ev", case_id: seed.caseId, category: "document", description: "Attempt.", submitted_by_character_id: respondent.characterId, character_id: respondent.characterId });
    assert.equal(judgeEvidence.code, "justice_judge_cannot_submit_evidence");

    // A party who forges another party's id gets evidence recorded under their own server identity.
    const before = evidenceCount(state, seed.caseId);
    const partyEvidence = await ask(respondent.peer, { type: "justice.action", action: "submit_evidence", requestId: "party-forged-ev", case_id: seed.caseId, category: "document", description: "Respondent's exhibit.", submitted_by_character_id: filer.characterId, character_id: filer.characterId });
    assert.equal(partyEvidence.type, "justice.result");
    assert.equal(evidenceCount(state, seed.caseId), before + 1);
    const recorded = Object.values(state.evidence).find((e) => e.case_id === seed.caseId && e.description === "Respondent's exhibit.");
    assert.equal(recorded.submitted_by_character_id, respondent.characterId, "the recorded submitter is the server identity, not the forged id");

    // The judge's view is still the judge's own: forged fields do not change it.
    const judgeView = await ask(judge.peer, { type: "justice.action", action: "view_case", requestId: "judge-forged-view", case_id: seed.caseId, character_id: stranger.characterId });
    assert.equal(judgeView.type, "justice.result");
  });
}
