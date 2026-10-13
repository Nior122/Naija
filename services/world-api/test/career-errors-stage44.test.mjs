// Stage 44: a career action refused by the command limit is answered with a generic "error" that carries the request ID
// (code rate_limited), not with career.error. The Godot career panel is busy until it gets a reply, so it can only
// recover if that generic error echoes the ID it sent. This file checks that server contract over the socket on each
// configured backend. The client side (matching the ID and clearing the busy state) is checked by
// client-career-routing-stage44.test.mjs; the Godot screen itself was not run in this file.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, openPeerFrom, startOver } from "./support/creation-backends.mjs";
import { createIdentity, resumeSession } from "./support/harness.mjs";

before(connectBackends);
after(disconnectBackends);

/** The first reply for this request ID from the career handler, or from the generic error path. */
const settle = (peer, requestId) => peer.waitFor(
  (message) => message.requestId === requestId
    && ["career.result", "career.error", "command.duplicate", "error"].includes(message.type),
  20000,
);

for (const backendName of backendNames) {
  describe(`career action replies over the socket (${backendName} backend)`, () => {
    test("a career action refused by the command limit gets a generic error with its request ID, not career.error", async () => {
      const backend = await openBackend(backendName);
      const started = await startOver(backend, {});
      const peer = await openPeerFrom(started.websocketUrl, "127.0.0.1");
      try {
        const identity = await createIdentity(peer, "Refused Career");
        assert.equal((await resumeSession(peer, identity.sessionToken)).type, "session.ready");
        // identity.create, session.resume and every command count toward the limit (20 per 10 seconds), so send
        // read-only career searches until the server refuses one.
        let reads = 0;
        for (; reads < 40; reads += 1) {
          const requestId = `search-${randomUUID()}`;
          peer.send({ type: "career.action", action: "search_jobs", requestId, payload: { text: "" } });
          const reply = await settle(peer, requestId);
          if (reply.type === "error") {
            assert.equal(reply.code, "rate_limited", JSON.stringify(reply));
            assert.equal(reply.requestId, requestId);
            break;
          }
          assert.equal(reply.type, "career.result", `read ${reads}: ${JSON.stringify(reply)}`);
        }
        assert.ok(reads < 40, "the command limit is reached within 40 reads");

        // A changing action refused by the limit is answered the same way: generic error, same ID, no career.error.
        const requestId = `apply-${randomUUID()}`;
        peer.send({ type: "career.action", action: "apply_job", requestId, payload: { vacancy_id: "vacancy:none" } });
        const refused = await settle(peer, requestId);
        assert.equal(refused.type, "error", JSON.stringify(refused));
        assert.equal(refused.code, "rate_limited");
        assert.equal(refused.requestId, requestId);
      } finally {
        peer.socket.close();
        await started.stop();
        await backend.cleanup();
      }
    });
  });
}
