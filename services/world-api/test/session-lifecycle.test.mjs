/**
 * Session metadata, logout revocation, and log-only lifetime policy (Stage 28 decision D-06, option A, step 1).
 *
 * What these tests establish:
 *   - a new identity records when its session was issued, and the store holds only the token hash;
 *   - an accepted authenticated request updates last activity;
 *   - logout revokes the token: the revoked token is refused on a new socket, a restart does not re-enable it, and the
 *     connection that logged out can no longer act;
 *   - a failed logout save leaves the session valid (the change is undone);
 *   - records without the new metadata still resume and are not changed to add it;
 *   - the 30-day absolute and 7-day idle limits are REPORTED in the log and never enforced;
 *   - no token, token hash, or creation key appears in any log line;
 *   - a refused key-only request and an invalid session never create an identity (D-05, D-06).
 *
 * What these tests do NOT establish: that expiry is enforced (it is not), that the client logs out (it cannot yet),
 * or that the 24-hour recovery workflow exists (it does not).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { backendNames, connectBackends, disconnectBackends, openBackend, startOver } from "./support/creation-backends.mjs";
import { openPeer, startApi, stopApi } from "./support/harness.mjs";
import {
  describeSessionPolicy,
  evaluateSessionPolicy,
  isSessionMetadata,
  SESSION_ABSOLUTE_LIMIT_DAYS,
  SESSION_IDLE_LIMIT_DAYS,
} from "../dist/multiplayer/session-policy.js";

const DAY_MS = 86_400_000;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const iso = (ms) => new Date(ms).toISOString();

// ---- Pure policy (no server) ---------------------------------------------------------------------------------------

test("policy: the absolute limit is exceeded only after 30 days, not at exactly 30 days", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const atLimit = { lastActivityAt: iso(now), issuedAt: iso(now - SESSION_ABSOLUTE_LIMIT_DAYS * DAY_MS) };
  const past = { lastActivityAt: iso(now), issuedAt: iso(now - SESSION_ABSOLUTE_LIMIT_DAYS * DAY_MS - 1) };
  assert.equal(evaluateSessionPolicy(atLimit, iso(now), now).wouldExceedAbsolute, false);
  assert.equal(evaluateSessionPolicy(past, iso(now), now).wouldExceedAbsolute, true);
});

test("policy: the idle limit is exceeded only after 7 days without activity", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const atLimit = { issuedAt: iso(now), lastActivityAt: iso(now - SESSION_IDLE_LIMIT_DAYS * DAY_MS) };
  const past = { issuedAt: iso(now), lastActivityAt: iso(now - SESSION_IDLE_LIMIT_DAYS * DAY_MS - 1) };
  assert.equal(evaluateSessionPolicy(atLimit, iso(now), now).wouldExceedIdle, false);
  assert.equal(evaluateSessionPolicy(past, iso(now), now).wouldExceedIdle, true);
});

test("policy: a record without session metadata reports the absolute limit as unknown and idles from lastSeen", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const report = evaluateSessionPolicy(undefined, iso(now - 8 * DAY_MS), now);
  assert.equal(report.metadataPresent, false);
  assert.equal(report.wouldExceedAbsolute, null, "the true age is unknown, so it is not reported as exceeded");
  assert.equal(report.wouldExceedIdle, true, "idle time is known from the existing lastSeen field");
  assert.equal(report.revoked, false);
});

test("policy: metadata without an issue time has an unknown absolute age but a known idle time", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const report = evaluateSessionPolicy({ lastActivityAt: iso(now - DAY_MS) }, iso(now), now);
  assert.equal(report.wouldExceedAbsolute, null);
  assert.equal(report.wouldExceedIdle, false);
});

test("policy: a clock that moves backwards never reports an excess", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const future = { issuedAt: iso(now + 40 * DAY_MS), lastActivityAt: iso(now + 40 * DAY_MS) };
  const report = evaluateSessionPolicy(future, iso(now), now);
  assert.equal(report.wouldExceedAbsolute, false);
  assert.equal(report.wouldExceedIdle, false);
});

test("policy: a revoked session is reported as revoked", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const report = evaluateSessionPolicy({ issuedAt: iso(now), lastActivityAt: iso(now), revokedAt: iso(now) }, iso(now), now);
  assert.equal(report.revoked, true);
});

test("policy: the log line states only booleans and 'unknown' or 'absent', never identifiers or tokens", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  const line = describeSessionPolicy(evaluateSessionPolicy(undefined, iso(now), now));
  assert.equal(line, "session policy (log-only): metadata=absent would_exceed_absolute=unknown would_exceed_idle=false");
});

test("validation: only well-formed session metadata is accepted", () => {
  const now = iso(Date.parse("2026-10-11T12:00:00.000Z"));
  assert.equal(isSessionMetadata({ issuedAt: now, lastActivityAt: now }), true);
  assert.equal(isSessionMetadata({ lastActivityAt: now, revokedAt: now }), true);
  assert.equal(isSessionMetadata({ issuedAt: now }), false, "lastActivityAt is required");
  assert.equal(isSessionMetadata({ lastActivityAt: "not a date" }), false);
  assert.equal(isSessionMetadata({ lastActivityAt: now, revokedAt: 12 }), false);
  assert.equal(isSessionMetadata([]), false);
  assert.equal(isSessionMetadata(null), false);
});

// ---- Server behaviour ----------------------------------------------------------------------------------------------

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

/** A real identity over the socket, with a creation key this test controls. */
function identityMessage(name, creationKey) {
  return {
    type: "identity.create",
    creationKey,
    profile: {
      name,
      age: 16,
      character_type: "girl",
      appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
    },
  };
}

async function createWithKey(entry, name, creationKey) {
  const peer = await openPeer(entry.started.websocketUrl);
  entry.peers.push(peer);
  peer.send(identityMessage(name, creationKey));
  const created = await peer.waitForType("identity.created");
  // identity.created does not authenticate the socket by itself; the client resumes the session next.
  const ready = await resumeReply(peer, created.sessionToken);
  assert.equal(ready.type, "session.ready", "the new identity resumes on its own connection");
  return { peer, playerId: created.playerId, token: created.sessionToken };
}

/** Sends one request and waits for the reply carrying the same requestId (any reply type). */
function ask(peer, message) {
  peer.send(message);
  return peer.waitFor((reply) => reply.requestId === message.requestId, 5000);
}

/** Resumes with a token on a socket and returns the first session.ready or error reply. */
async function resumeReply(peer, sessionToken) {
  peer.send({ type: "session.resume", sessionToken });
  return peer.waitFor((reply) => reply.type === "session.ready" || reply.type === "error", 5000);
}

/** Captures everything written to the console while `run` executes. */
async function captureConsole(run) {
  const lines = [];
  const levels = ["log", "info", "warn", "error"];
  const originals = Object.fromEntries(levels.map((level) => [level, console[level]]));
  for (const level of levels) {
    console[level] = (...args) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    };
  }
  try {
    await run();
  } finally {
    for (const level of levels) console[level] = originals[level];
  }
  return lines;
}

for (const backendName of backendNames) {
  test(`[${backendName}] a new identity records its issue time; the store holds the token hash, never the token`, async () => {
    const { backend, entry } = await session(backendName);
    const key = randomBytes(32).toString("hex");
    const { playerId, token } = await createWithKey(entry, "Issued", key);
    const record = backend.store.state.players[playerId];

    assert.equal(record.tokenHash, sha256(token), "the stored value is the hash of the token");
    assert.equal(isSessionMetadata(record.session), true);
    const issued = Date.parse(record.session.issuedAt);
    assert.ok(Math.abs(Date.now() - issued) < 60_000, "the issue time is the creation time");
    assert.ok(Date.parse(record.session.lastActivityAt) >= issued, "activity is never earlier than the issue time");
    assert.equal(record.session.revokedAt, undefined);
    assert.equal(JSON.stringify(backend.store.state).includes(token), false, "the token is not stored in plain text");
  });

  test(`[${backendName}] an accepted authenticated request updates last activity and leaves the issue time alone`, async () => {
    const { backend, entry } = await session(backendName);
    const { peer, playerId } = await createWithKey(entry, "Active", randomBytes(32).toString("hex"));
    const record = backend.store.state.players[playerId];
    const issuedAt = record.session.issuedAt;
    const stale = iso(Date.now() - 2 * DAY_MS);
    record.session.lastActivityAt = stale;

    const reply = await ask(peer, { type: "military.action", action: "list_branches", requestId: "activity-1" });
    assert.match(reply.type, /\.result$/, "the read request is accepted");
    assert.ok(Date.parse(record.session.lastActivityAt) > Date.parse(stale), "last activity advanced");
    assert.equal(record.session.issuedAt, issuedAt, "the issue time is unchanged");
  });

  test(`[${backendName}] logout revokes the token: the revoked token is refused, and the logged-out connection can no longer act`, async () => {
    const { backend, entry } = await session(backendName);
    const { peer, playerId, token } = await createWithKey(entry, "Leaving", randomBytes(32).toString("hex"));

    const loggedOut = await ask(peer, { type: "session.logout", requestId: "logout-1" });
    assert.equal(loggedOut.type, "session.logged_out");
    assert.equal(loggedOut.requestId, "logout-1");
    assert.equal(typeof backend.store.state.players[playerId].session.revokedAt, "string");

    const refusedAction = await ask(peer, { type: "military.action", action: "list_branches", requestId: "after-logout" });
    assert.equal(refusedAction.type, "error");
    assert.equal(refusedAction.code, "not_authenticated", "the connection that logged out has no identity any more");

    const secondLogout = await ask(peer, { type: "session.logout", requestId: "logout-2" });
    assert.equal(secondLogout.code, "not_authenticated", "a second logout is refused and changes nothing");

    const other = await openPeer(entry.started.websocketUrl);
    entry.peers.push(other);
    const refused = await resumeReply(other, token);
    assert.equal(refused.type, "error");
    assert.equal(refused.code, "session_invalid", "a revoked token is refused on a new connection");
  });

  test(`[${backendName}] after logout, a key-only request is refused and creates no identity (D-05 regression)`, async () => {
    const { backend, entry } = await session(backendName);
    const key = randomBytes(32).toString("hex");
    const { peer } = await createWithKey(entry, "Keyed", key);
    await ask(peer, { type: "session.logout", requestId: "logout-k" });
    const before = Object.keys(backend.store.state.players).length;

    const other = await openPeer(entry.started.websocketUrl);
    entry.peers.push(other);
    other.send(identityMessage("Keyed again", key));
    const reply = await other.waitFor((message) => message.type === "error" || message.type === "identity.created", 5000);
    assert.equal(reply.type, "error");
    assert.equal(reply.code, "identity_recovery_unavailable");
    assert.equal(Object.keys(backend.store.state.players).length, before, "no second identity");
    assert.equal(JSON.stringify(backend.store.state).includes(key), false, "the creation key is not stored in plain text");
  });

  test(`[${backendName}] an unknown or malformed token is refused as session_invalid and creates no identity`, async () => {
    const { backend, entry } = await session(backendName);
    const before = Object.keys(backend.store.state.players).length;
    for (const token of [randomBytes(32).toString("base64url"), "short", undefined]) {
      const peer = await openPeer(entry.started.websocketUrl);
      entry.peers.push(peer);
      const reply = await resumeReply(peer, token);
      assert.equal(reply.type, "error");
      assert.equal(reply.code, "session_invalid");
      peer.close();
    }
    assert.equal(Object.keys(backend.store.state.players).length, before, "no identity was created by any refusal");
  });

  test(`[${backendName}] a failed logout save leaves the session valid: nothing is revoked and the token still resumes`, async () => {
    const { backend, entry } = await session(backendName);
    const { peer, playerId, token } = await createWithKey(entry, "Unsaved", randomBytes(32).toString("hex"));
    backend.store.failNextWrite("injected logout save failure");

    const failed = await ask(peer, { type: "session.logout", requestId: "logout-fail" });
    assert.equal(failed.type, "error");
    assert.equal(failed.code, "persistence_failed", "the rejected logout is reported, not reported as success");
    assert.equal(backend.store.state.players[playerId].session.revokedAt, undefined, "the in-memory revocation was undone");
    const stillActive = await ask(peer, { type: "military.action", action: "list_branches", requestId: "still-active" });
    assert.match(stillActive.type, /\.result$/, "the connection is still authenticated");

    peer.close();
    const again = await openPeer(entry.started.websocketUrl);
    entry.peers.push(again);
    const ready = await resumeReply(again, token);
    assert.equal(ready.type, "session.ready", "the same token still works after the failed logout");
  });

  test(`[${backendName}] log-only: a session past the absolute limit still resumes and is reported, not refused`, async () => {
    const { backend, entry } = await session(backendName);
    const { peer, playerId, token } = await createWithKey(entry, "Old", randomBytes(32).toString("hex"));
    const record = backend.store.state.players[playerId];
    const now = Date.now();
    record.session.issuedAt = iso(now - (SESSION_ABSOLUTE_LIMIT_DAYS + 1) * DAY_MS);
    record.session.lastActivityAt = iso(now - DAY_MS);
    peer.close();

    const other = await openPeer(entry.started.websocketUrl);
    entry.peers.push(other);
    let ready;
    const lines = await captureConsole(async () => {
      ready = await resumeReply(other, token);
    });
    assert.equal(ready.type, "session.ready", "log-only: the session is not refused");
    const policy = lines.find((line) => line.startsWith("session policy (log-only)"));
    assert.ok(policy, "the policy is logged");
    assert.match(policy, /would_exceed_absolute=true/);
    assert.match(policy, /would_exceed_idle=false/);
  });

  test(`[${backendName}] log-only: a session idle past the limit still resumes and is reported, not refused`, async () => {
    const { backend, entry } = await session(backendName);
    const { peer, playerId, token } = await createWithKey(entry, "Idle", randomBytes(32).toString("hex"));
    const record = backend.store.state.players[playerId];
    const now = Date.now();
    record.session.issuedAt = iso(now - DAY_MS);
    record.session.lastActivityAt = iso(now - (SESSION_IDLE_LIMIT_DAYS + 1) * DAY_MS);
    peer.close();

    const other = await openPeer(entry.started.websocketUrl);
    entry.peers.push(other);
    let ready;
    const lines = await captureConsole(async () => {
      ready = await resumeReply(other, token);
    });
    assert.equal(ready.type, "session.ready", "log-only: the session is not refused");
    const policy = lines.find((line) => line.startsWith("session policy (log-only)"));
    assert.match(policy, /would_exceed_absolute=false/);
    assert.match(policy, /would_exceed_idle=true/);
  });

  test(`[${backendName}] a session within both limits is reported as within both`, async () => {
    const { entry } = await session(backendName);
    const { peer, token } = await createWithKey(entry, "Fresh", randomBytes(32).toString("hex"));
    peer.close();
    const other = await openPeer(entry.started.websocketUrl);
    entry.peers.push(other);
    const lines = await captureConsole(async () => {
      await resumeReply(other, token);
    });
    const policy = lines.find((line) => line.startsWith("session policy (log-only)"));
    assert.match(policy, /would_exceed_absolute=false/);
    assert.match(policy, /would_exceed_idle=false/);
  });

  test(`[${backendName}] a record without session metadata still resumes, and no metadata is invented for it`, async () => {
    const { backend, entry } = await session(backendName);
    const { peer, playerId, token } = await createWithKey(entry, "Legacy", randomBytes(32).toString("hex"));
    delete backend.store.state.players[playerId].session;
    peer.close();

    const other = await openPeer(entry.started.websocketUrl);
    entry.peers.push(other);
    const lines = await captureConsole(async () => {
      const ready = await resumeReply(other, token);
      assert.equal(ready.type, "session.ready", "a record without metadata is not invalidated");
      const action = await ask(other, { type: "military.action", action: "list_branches", requestId: "legacy-read" });
      assert.match(action.type, /\.result$/);
    });
    assert.equal(backend.store.state.players[playerId].session, undefined, "no issue time was invented");
    const policy = lines.find((line) => line.startsWith("session policy (log-only)"));
    assert.match(policy, /metadata=absent/);
    assert.match(policy, /would_exceed_absolute=unknown/);
  });

  test(`[${backendName}] no log line contains the session token, its hash, or the creation key`, async () => {
    const { entry } = await session(backendName);
    const key = randomBytes(32).toString("hex");
    let token = "";
    const lines = await captureConsole(async () => {
      const created = await createWithKey(entry, "Quiet", key);
      const { peer } = created;
      token = created.token;
      await ask(peer, { type: "military.action", action: "list_branches", requestId: "quiet-1" });
      peer.close();
      const again = await openPeer(entry.started.websocketUrl);
      entry.peers.push(again);
      await resumeReply(again, token);
      await ask(again, { type: "session.logout", requestId: "quiet-logout" });
      const refused = await openPeer(entry.started.websocketUrl);
      entry.peers.push(refused);
      await resumeReply(refused, token);
      refused.send(identityMessage("Quiet again", key));
      await refused.waitFor((message) => message.type === "error", 5000);
    });
    assert.ok(token.length > 0, "premise: a token was issued");
    const joined = lines.join("\n");
    assert.equal(joined.includes(token), false, "no token in logs");
    assert.equal(joined.includes(sha256(token)), false, "no token hash in logs");
    assert.equal(joined.includes(key), false, "no creation key in logs");
  });
}

// ---- Restart durability (file backend) -----------------------------------------------------------------------------

test("[file] a logout survives a restart: the revoked token is refused by the restarted server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-session-lifecycle-"));
  const stateFile = join(directory, "world-state.json");
  const options = { stateFile, gameMinuteMs: 10_000, broadcastIntervalMs: 25, tickIntervalMs: 10 };
  let first;
  let second;
  let peer;
  let other;
  try {
    first = await startApi(options);
    const created = await createWithKey(
      { started: { websocketUrl: first.websocketUrl }, peers: [] },
      "Restarted",
      randomBytes(32).toString("hex"),
    );
    peer = created.peer;
    const loggedOut = await ask(peer, { type: "session.logout", requestId: "restart-logout" });
    assert.equal(loggedOut.type, "session.logged_out");
    peer.close();
    await stopApi(first.server);
    first = null;

    const onDisk = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(typeof onDisk.players[created.playerId].session.revokedAt, "string", "the revocation is saved");
    assert.equal(JSON.stringify(onDisk).includes(created.token), false, "the token is not in the file");

    second = await startApi(options);
    other = await openPeer(second.websocketUrl);
    const refused = await resumeReply(other, created.token);
    assert.equal(refused.type, "error");
    assert.equal(refused.code, "session_invalid", "the revocation holds after a restart");
  } finally {
    other?.close();
    peer?.close();
    if (first) await stopApi(first.server).catch(() => undefined);
    if (second) await stopApi(second.server).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("[file] a legacy record written without session metadata loads and resumes, and stays without metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "naija-session-legacy-"));
  const stateFile = join(directory, "world-state.json");
  const options = { stateFile, gameMinuteMs: 10_000, broadcastIntervalMs: 25, tickIntervalMs: 10 };
  let first;
  let second;
  let other;
  try {
    first = await startApi(options);
    const created = await createWithKey(
      { started: { websocketUrl: first.websocketUrl }, peers: [] },
      "Old record",
      randomBytes(32).toString("hex"),
    );
    created.peer.close();
    await stopApi(first.server);
    first = null;

    // Simulate a record saved before this change: remove the new field from the saved file only.
    const onDisk = JSON.parse(await readFile(stateFile, "utf8"));
    delete onDisk.players[created.playerId].session;
    await writeFile(stateFile, JSON.stringify(onDisk));

    second = await startApi(options);
    other = await openPeer(second.websocketUrl);
    const ready = await resumeReply(other, created.token);
    assert.equal(ready.type, "session.ready", "the legacy session is not invalidated");
    other.close();
    other = null;
    await stopApi(second.server);
    second = null;

    const after = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(after.players[created.playerId].session, undefined, "resuming did not invent metadata");
  } finally {
    other?.close();
    if (first) await stopApi(first.server).catch(() => undefined);
    if (second) await stopApi(second.server).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
