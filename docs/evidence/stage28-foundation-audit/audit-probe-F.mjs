// READ-ONLY AUDIT PROBE F (Stage 28 foundation audit). Throwaway file backend in a temp dir. No repo writes.
import { randomBytes } from "node:crypto";
const SRC = "/home/user/Naija/services/world-api";
const { openBackend, startOver } = await import(`${SRC}/test/support/creation-backends.mjs`);
const { openPeer, resumeSession } = await import(`${SRC}/test/support/harness.mjs`);
const backend = await openBackend("file");
const started = await startOver(backend, { identityBudget: { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 } });
const profile = (name) => ({ name, age: 16, character_type: "girl", appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" } });
const peer = await openPeer(started.websocketUrl);
peer.send({ type: "identity.create", creationKey: randomBytes(32).toString("hex"), profile: profile("Recruit") });
const created = await peer.waitForType("identity.created");
await resumeSession(peer, created.sessionToken);
await new Promise((r) => setTimeout(r, 400));
{ const wd = backend.store.state.worldClock.world_date; backend.store.state.players[created.playerId].character.date_of_birth = { year: wd.year - 28, month: 1, day: 1 }; backend.store.state.players[created.playerId].character.age = 28; }
await new Promise((r) => setTimeout(r, 300));
const ask = (message) => { peer.send(message); return peer.waitFor((r) => /\.(result|error)$/.test(r.type) || r.type === "error", 5000); };
const apply = await ask({ type: "military.action", action: "apply_for_service", requestId: "probe-mil-1", branch: "army", education: "tertiary" });
console.log("F_apply_reply", apply.type, apply.code ?? "", apply.message ?? "");
const appId = apply.data?.application?.application_id ?? null;
const enlist = await ask({ type: "military.action", action: "enlist", requestId: "probe-mil-2", application_id: appId ?? "none" });
const decide = await ask({ type: "military.action", action: "decide_application", requestId: "probe-mil-3", application_id: appId ?? "none", approved: true, reviewing_authority: "self" });
const recs = Object.keys(backend.store.state.militaryServiceRecords ?? {}).length;
console.log("F_military_self_enlist", JSON.stringify({ applyType: apply.type, applyStatus: apply.data?.application?.status ?? null, enlistReply: `${enlist.type}:${enlist.code ?? ""}`, decideAction: `${decide.type}:${decide.code ?? ""}`, serviceRecordsCreated: recs }));
peer.close(); await started.stop(); await backend.cleanup();
