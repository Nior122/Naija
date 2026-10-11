// Stage 28 hardening, slice 1, PRE-CHANGE probe G. Throwaway file backend in a temp dir. Real socket path.
import { randomBytes } from "node:crypto";
const SRC = "/home/user/Naija/services/world-api";
const { openBackend, startOver } = await import(`${SRC}/test/support/creation-backends.mjs`);
const { openPeer, resumeSession } = await import(`${SRC}/test/support/harness.mjs`);
const backend = await openBackend("file");
const started = await startOver(backend, { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } });
const peers = [];
const profile = (name) => ({ name, age: 16, character_type: "girl", appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" } });
async function citizen(name) {
  const peer = await openPeer(started.websocketUrl); peers.push(peer);
  peer.send({ type: "identity.create", creationKey: randomBytes(32).toString("hex"), profile: profile(name) });
  const created = await peer.waitForType("identity.created");
  await resumeSession(peer, created.sessionToken);
  await new Promise((r) => setTimeout(r, 400));
  const character = backend.store.state.players[created.playerId].character;
  // Authoritative field is date_of_birth; age is recomputed from it. Set DOB so age is 30 on the world date.
  const wd = backend.store.state.worldClock.world_date;
  character.date_of_birth = { year: wd.year - 30, month: 1, day: 1 };
  character.age = 30;
  await new Promise((r) => setTimeout(r, 300));
  return { peer, playerId: created.playerId, characterId: character.character_id };
}
const ask = (peer, message) => { peer.send(message); return peer.waitFor((r) => /\.(result|error)$/.test(r.type) || r.type === "error", 5000); };
const out = (k, v) => console.log(k, JSON.stringify(v));
try {
  const filer = await citizen("Filer");
  const stranger = await citizen("Stranger");
  const courtId = "court:state-high-fct";
  const filed = await ask(filer.peer, { type: "justice.action", action: "file_case", requestId: "g-file", category: "civil_general", court_id: courtId, summary: "Summary.", description: "Desc.", relevant_law_ids: [] });
  const caseId = filed.data?.case?.case_id ?? null;
  out("G0_file_case", { type: filed.type, code: filed.code ?? null, caseId: Boolean(caseId) });
  const before = { evidence: Object.keys(backend.store.state.evidence ?? {}).length, judgments: Object.keys(backend.store.state.judgments ?? {}).length, fines: Object.keys(backend.store.state.fines ?? {}).length };
  const j = await ask(filer.peer, { type: "justice.action", action: "issue_judgment", requestId: "g-judge", case_id: caseId, outcome: "dismissal", findings: "F.", reasoning: "R.", remedies: [], appeal_eligible: true });
  out("G1_issue_judgment_by_party", { type: j.type, code: j.code ?? null, message: j.message ?? null });
  const ev = await ask(stranger.peer, { type: "justice.action", action: "submit_evidence", requestId: "g-ev", case_id: caseId, category: "document", description: "Evidence from a stranger." });
  out("G2_submit_evidence_by_stranger", { type: ev.type, code: ev.code ?? null });
  const view = await ask(stranger.peer, { type: "justice.action", action: "view_case", requestId: "g-view", case_id: caseId });
  out("G3_view_case_by_stranger", { type: view.type, code: view.code ?? null, returnsCase: Boolean(view.data?.case) });
  const after = { evidence: Object.keys(backend.store.state.evidence ?? {}).length, judgments: Object.keys(backend.store.state.judgments ?? {}).length, fines: Object.keys(backend.store.state.fines ?? {}).length };
  out("G4_state_before_after", { before, after });
} catch (error) {
  out("PROBE_ERROR", { message: String(error?.message ?? error).slice(0, 300) });
} finally {
  for (const p of peers) p.close();
  await started.stop(); await backend.cleanup();
}
