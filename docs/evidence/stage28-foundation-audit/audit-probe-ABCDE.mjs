// READ-ONLY AUDIT PROBE (Stage 28 foundation audit). Runs only on a throwaway file backend in a temp directory.
// It does not touch the repository, live data, or any database. Output contains no tokens or URLs.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const SRC = "/home/user/Naija/services/world-api";
const { openBackend, startOver } = await import(`${SRC}/test/support/creation-backends.mjs`);
const { createIdentity, openPeer, resumeSession } = await import(`${SRC}/test/support/harness.mjs`);
const J = await import(`${SRC}/dist/justice/index.js`);
const catalog = J.loadJusticeCatalog();

const results = {};
const note = (key, value) => { results[key] = value; console.log(key, JSON.stringify(value)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backend = await openBackend("file");
const started = await startOver(backend, { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } });
const peers = [];
const open = async () => { const p = await openPeer(started.websocketUrl); peers.push(p); return p; };
const profile = (name) => ({ name, age: 16, character_type: "girl", appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" } });

async function citizen(name, age, key = randomBytes(32).toString("hex")) {
  const peer = await open();
  peer.send({ type: "identity.create", creationKey: key, profile: profile(name) });
  const created = await peer.waitForType("identity.created");
  await resumeSession(peer, created.sessionToken);
  const character = backend.store.state.players[created.playerId].character;
  character.age = age;
  return { peer, playerId: created.playerId, characterId: character.character_id, token: created.sessionToken, key };
}
const ask = (peer, message) => { peer.send(message); return peer.waitFor((r) => /\.(result|error)$/.test(r.type) || r.type === "error", 5000); };

try {
  // ── Probe A: identity recovery with the creation key alone ─────────────────────────────────────────
  const owner = await citizen("Owner", 30);
  owner.peer.close();
  await sleep(150);
  const attackerPeer = await open();
  attackerPeer.send({ type: "identity.create", creationKey: owner.key, profile: profile("Other") });
  const recovered = await attackerPeer.waitFor((r) => r.type === "identity.created" || r.type === "error", 5000);
  const samePlayer = recovered.playerId === owner.playerId;
  // The old token should now be dead.
  const oldPeer = await open();
  oldPeer.send({ type: "session.resume", sessionToken: owner.token });
  const oldReply = await oldPeer.waitFor((r) => r.type === "session.ready" || r.type === "error", 5000);
  note("A_recovery_with_key_only", {
    recoveryReplyType: recovered.type,
    returnsSamePlayerId: samePlayer,
    returnsNewToken: typeof recovered.sessionToken === "string" && recovered.sessionToken !== owner.token,
    oldTokenReply: oldReply.type === "session.ready" ? "session.ready (old token still valid)" : `${oldReply.type}:${oldReply.code}`,
  });

  // ── Probe B: decide_appeal by a character who is not an assigned judge ─────────────────────────────
  const claimant = await citizen("Claimant", 30);
  const judge = await citizen("Judge", 45);
  const attacker = await citizen("Attacker", 30);
  const state = backend.store.state;
  // Setup note: session.resume recomputes age from date_of_birth for every character, so ages are re-set here, after all resumes.
  for (const c of [claimant, judge, attacker]) state.players[c.playerId].character.age = c.playerId === judge.playerId ? 45 : 30;
  await sleep(400); // let in-flight resumes settle so the in-memory age sticks
  const date = state.worldClock.world_date;
  const now = Date.now();
  J.seedJusticeWorld(state, date, now, catalog);
  const courtId = "court:state-high-fct";
  state.courts[courtId].assigned_judge_ids = [judge.characterId];
  const caseRec = J.fileCase(state, "civil_general", courtId, claimant.characterId, null, "Summary.", "Desc.", [], null, date, now, catalog);
  for (const s of ["accepted", "pretrial", "awaiting_hearing", "in_hearing", "awaiting_judgment"]) {
    J.advanceCaseStatus(state, caseRec.case_id, s, claimant.characterId, date, now);
  }
  const judgment = J.issueJudgment(state, caseRec.case_id, judge.characterId, "dismissal", "Case dismissed.", "Reasoning.", [], true, date, now, catalog);
  const appeal = J.fileAppeal(state, caseRec.case_id, judgment.judgment_id, claimant.characterId, "Wrongful dismissal.", "court:appeal-federal", date, now, catalog);
  const reply = await ask(attacker.peer, { type: "justice.action", action: "decide_appeal", requestId: "probe-appeal-1", appeal_id: appeal.appeal_id, outcome: "reversed", reasoning: "Probe." });
  note("B_decide_appeal_by_non_judge", {
    replyType: reply.type,
    replyCode: reply.code ?? null,
    appealStatus: state.appeals[appeal.appeal_id].status,
    decidedBy: state.appeals[appeal.appeal_id].assigned_judge_character_id === attacker.characterId ? "attacker" : "other",
    judgmentStatus: state.judgments[judgment.judgment_id].status,
    caseStatus: state.cases[caseRec.case_id].status,
    attackerIsAssignedJudge: state.courts[courtId].assigned_judge_ids.includes(attacker.characterId),
  });

  // ── Probe C: criminal record with conviction against another character ─────────────────────────────
  const victim = await citizen("Victim", 35);
  const offender = await citizen("Offender", 30);
  const categoryId = JSON.parse(readFileSync("/home/user/Naija/game/data/crime/catalog.json", "utf8")).crime_categories[0].id;
  const beforeRecords = Object.keys(backend.store.state.criminalRecords).length;
  const crimeReply = await ask(offender.peer, {
    type: "crime.action", action: "create_criminal_record", requestId: "probe-crime-1",
    incident_id: "inc-probe-not-real", character_id: victim.characterId, category: categoryId, severity: "minor", conviction: true,
  });
  const victimRecords = Object.values(backend.store.state.criminalRecords).filter((r) => r.character_id === victim.characterId);
  note("C_criminal_conviction_against_other", {
    replyType: crimeReply.type,
    replyCode: crimeReply.code ?? null,
    recordsCreatedDelta: Object.keys(backend.store.state.criminalRecords).length - beforeRecords,
    victimConvictions: victimRecords.filter((r) => r.conviction === true).length,
    recordCreatedByCharacter: "offender (no check of incident, target or actor role)",
  });

  // ── Probe D (negative control): economy transfer from another character's account ──────────────────
  const victimAccount = Object.values(backend.store.state.economyAccounts).find((a) => a.character_id === victim.characterId && a.kind === "cash");
  const offenderAccount = Object.values(backend.store.state.economyAccounts).find((a) => a.character_id === offender.characterId && a.kind === "cash");
  const offenderOther = Object.values(backend.store.state.economyAccounts).find((a) => a.character_id === offender.characterId && a.account_id !== offenderAccount?.account_id);
  if (victimAccount && offenderAccount) {
    const beforeVictim = victimAccount.balance_ngn;
    const transfer = await ask(offender.peer, {
      type: "economy.action", action: "transfer", requestId: "probe-econ-1",
      payload: { from_account_id: victimAccount.account_id, to_account_id: offenderAccount.account_id, amount_ngn: 1000 },
    });
    note("D_economy_transfer_from_other_account", {
      replyType: transfer.type, replyCode: transfer.code ?? null,
      victimBalanceChanged: backend.store.state.economyAccounts[victimAccount.account_id].balance_ngn !== beforeVictim,
      offenderHasSecondAccount: Boolean(offenderOther),
    });
  } else {
    note("D_economy_transfer_from_other_account", { skipped: "accounts not found", victimAccount: Boolean(victimAccount), offenderAccount: Boolean(offenderAccount) });
  }
  // ── Probe E: pay a fine that belongs to another character, with a made-up transaction id ─────────────
  const fineVictim = await citizen("FineVictim", 30);
  const payer = await citizen("Payer", 30);
  backend.store.state.players[fineVictim.playerId].character.age = 30;
  backend.store.state.players[payer.playerId].character.age = 30;
  const fine = J.createFine(backend.store.state, "case-probe", "jdg-probe", "sent-probe", fineVictim.characterId, 500000, "2026-01-01", backend.store.state.worldClock.world_date, Date.now());
  const fineBefore = { status: backend.store.state.fines[fine.fine_id].status, paid: backend.store.state.fines[fine.fine_id].amount_paid_ngn };
  const payerAccount = Object.values(backend.store.state.economyAccounts).find((a) => a.character_id === payer.characterId && a.kind === "cash");
  const payerBalanceBefore = payerAccount ? payerAccount.balance_ngn : null;
  const payReply = await ask(payer.peer, { type: "justice.action", action: "pay_fine", requestId: "probe-fine-1", fine_id: fine.fine_id, amount_ngn: 500000, transaction_id: "tx-made-up-by-payer" });
  const fineAfter = backend.store.state.fines[fine.fine_id];
  note("E_pay_fine_of_other_character_free", {
    replyType: payReply.type, replyCode: payReply.code ?? null,
    fineBefore, fineAfter: { status: fineAfter.status, paid: fineAfter.amount_paid_ngn },
    payerCashBalanceChanged: payerAccount ? backend.store.state.economyAccounts[payerAccount.account_id].balance_ngn !== payerBalanceBefore : null,
    fineOwnerIsPayer: fineAfter.responsible_character_id === payer.characterId,
  });

} catch (error) {
  note("PROBE_ERROR", { message: String(error?.message ?? error).slice(0, 300), stack: String(error?.stack ?? "").split("\n").slice(0, 4).join(" | ").replace(/file:\/\/[^ )]*\/s28\//g, "") });
} finally {
  for (const p of peers) p.close();
  await started.stop();
  await backend.cleanup();
}
