// Career and education changes are confirmed only after they are saved (Stage 34).
//
// A changing career action (every action except search_jobs) and a changing education action reply with their result
// only after the save covers the change. A failed save is career.error or education.error with *_not_saved; a save that may
// have committed is *_outcome_unknown. A retry with the same request ID is answered once and never applies twice. While
// saving is failing, a changing action is refused before any change (*_persistence_unavailable), but a read still answers.
//
// Runs on the file backend always, and on PostgreSQL when a disposable database is configured.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";

before(connectBackends);
after(disconnectBackends);

async function citizen(backend, started, name) {
  const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
  const identity = await createIdentity(peer, name);
  assert.equal((await resumeSession(peer, identity.sessionToken)).type, "session.ready");
  await backend.store.flush();
  return {
    peer,
    playerId: identity.playerId,
    sessionToken: identity.sessionToken,
    characterId: backend.store.state.players[identity.playerId].character.character_id,
  };
}

/** The first reply for this request ID: a result, a duplicate notice, or an error. */
function settle(peer, requestId, types) {
  return peer.waitFor((message) => message.requestId === requestId && types.includes(message.type), 20000);
}

const applicationsOf = (state, characterId) =>
  Object.values(state.careerApplications).filter((application) => application.character_id === characterId).length;

/** Finds the market vacancy this character can apply for, as the careers test does. */
async function marketVacancy(peer) {
  const search = peer.waitFor((message) => message.type === "career.result" && message.action === "search_jobs", 20000);
  peer.send({ type: "career.action", action: "search_jobs", payload: { text: "market" }, requestId: `search-${Math.random()}` });
  const result = await search;
  const vacancy = result.data.jobs.find((entry) => entry.vacancy_id === "vacancy-market-sales-assistant");
  assert.ok(vacancy, "the market vacancy is listed");
  assert.equal(vacancy.eligible, true, "the character is eligible for the market vacancy");
  return vacancy.vacancy_id;
}

for (const backendName of backendNames) {
  describe(`career and education confirmation (${backendName} backend)`, () => {
    test("career apply: a failed save is career_not_saved; the retry is answered once and the application is made once", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      let peer;
      try {
        const who = await citizen(backend, started, "Applicant");
        peer = who.peer;
        const vacancy = await marketVacancy(peer);
        const before = applicationsOf(backend.store.state, who.characterId);

        backend.store.failNextWrite("disk full");
        peer.send({ type: "career.action", action: "apply", payload: { vacancy_id: vacancy }, requestId: "apply-1" });
        const first = await settle(peer, "apply-1", ["career.result", "career.error"]);
        assert.equal(first.type, "career.error", JSON.stringify(first));
        assert.equal(first.code, "career_not_saved");

        peer.send({ type: "career.action", action: "apply", payload: { vacancy_id: vacancy }, requestId: "apply-1" });
        const retry = await settle(peer, "apply-1", ["career.result", "career.error", "command.duplicate"]);
        assert.equal(retry.type, "career.result", JSON.stringify(retry));
        assert.equal(applicationsOf(backend.store.state, who.characterId), before + 1, "one application");
        const saved = await backend.durableState();
        assert.equal(applicationsOf(saved, who.characterId), before + 1, "the saved world holds the application");
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });

    test("career apply: while saving fails, a new change is refused before any change, and a search is still answered", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      let peer;
      try {
        const who = await citizen(backend, started, "Gated");
        peer = who.peer;
        const vacancy = await marketVacancy(peer);

        backend.store.failNextWrite("disk full");
        peer.send({ type: "career.action", action: "apply", payload: { vacancy_id: vacancy }, requestId: "gate-a" });
        await settle(peer, "gate-a", ["career.result", "career.error"]);

        const before = applicationsOf(backend.store.state, who.characterId);
        peer.send({ type: "career.action", action: "apply", payload: { vacancy_id: vacancy }, requestId: "gate-b" });
        const refused = await settle(peer, "gate-b", ["career.result", "career.error"]);
        assert.equal(refused.type, "career.error", JSON.stringify(refused));
        assert.equal(refused.code, "career_persistence_unavailable");
        assert.equal(applicationsOf(backend.store.state, who.characterId), before, "the refused request changed nothing");

        peer.send({ type: "career.action", action: "search_jobs", payload: { text: "market" }, requestId: "gate-read" });
        const read = await settle(peer, "gate-read", ["career.result", "career.error"]);
        assert.equal(read.type, "career.result", "a read is not paused by the save gate");
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });

    test("career apply: a confirmed application survives a restart, and its request ID is then a duplicate", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      let who;
      let count;
      try {
        who = await citizen(backend, started, "Restart");
        const vacancy = await marketVacancy(who.peer);
        who.peer.send({ type: "career.action", action: "apply", payload: { vacancy_id: vacancy }, requestId: "apply-restart" });
        const confirmed = await settle(who.peer, "apply-restart", ["career.result", "career.error"]);
        assert.equal(confirmed.type, "career.result", JSON.stringify(confirmed));
        count = applicationsOf(backend.store.state, who.characterId);
        await who.peer.close();
      } finally {
        await started.stop();
      }
      await backend.reopen();
      const restarted = await startOver(backend, {});
      let again;
      try {
        again = await openPeerFrom(restarted.websocketUrl, "127.0.0.1");
        assert.equal((await resumeSession(again, who.sessionToken)).type, "session.ready");
        assert.equal(applicationsOf(await backend.durableState(), who.characterId), count, "the application survived the restart");
        again.send({ type: "career.action", action: "apply", payload: { vacancy_id: "vacancy-market-sales-assistant" }, requestId: "apply-restart" });
        await again.waitFor((message) => message.type === "command.duplicate" && message.requestId === "apply-restart", 20000);
        assert.equal(applicationsOf(await backend.durableState(), who.characterId), count, "not applied a second time");
      } finally {
        await again?.close();
        await restarted.stop();
        await backend.cleanup();
      }
    });

    test("education choose_elective: a failed save is education_not_saved; the retry is answered once and the subject is selected once", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      let peer;
      try {
        const who = await citizen(backend, started, "Student");
        peer = who.peer;
        const character = () => backend.store.state.players[who.playerId].character;
        const subjectsBefore = JSON.stringify(character().education_record.subject_ids);
        const eventsBefore = character().education_record.education_events.length;

        backend.store.failNextWrite("disk full");
        peer.send({ type: "education.action", action: "choose_elective", requestId: "elect-1", payload: { subject_id: "chemistry" } });
        const first = await settle(peer, "elect-1", ["education.result", "education.error"]);
        assert.equal(first.type, "education.error", JSON.stringify(first));
        assert.equal(first.code, "education_not_saved");

        peer.send({ type: "education.action", action: "choose_elective", requestId: "elect-1", payload: { subject_id: "chemistry" } });
        const retry = await settle(peer, "elect-1", ["education.result", "education.error", "command.duplicate"]);
        assert.equal(retry.type, "education.result", JSON.stringify(retry));
        assert.equal(character().education_record.education_events.length, eventsBefore + 1, "one selection event");
        assert.notEqual(JSON.stringify(character().education_record.subject_ids), subjectsBefore, "the elective is selected");
        const saved = await backend.durableState();
        assert.equal(saved.players[who.playerId].character.education_record.education_events.length, eventsBefore + 1, "saved once");
      } finally {
        await peer?.close();
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
