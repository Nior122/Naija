import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionRegistry,
  DEFAULT_SESSION_DURATION_MS,
} from "../../dist/scaling/session-manager.js";

test("session manager - creates session successfully", () => {
  const result = sessionRegistry.createSession({
    playerId: "player-test1",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  assert.equal(result.success, true);
  assert.ok(result.session);
  assert.equal(result.session.playerId, "player-test1");
  assert.equal(result.session.serverInstanceId, "server-test1");
  assert.equal(result.session.regionId, "region-test1");
  assert.equal(result.session.status, "active");
});

test("session manager - rejects duplicate active session", () => {
  sessionRegistry.createSession({
    playerId: "player-test2",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  const result = sessionRegistry.createSession({
    playerId: "player-test2",
    serverInstanceId: "server-test2",
    regionId: "region-test2",
    connectionId: "conn-test2",
    sessionDurationMs: 5000,
  });

  assert.equal(result.success, false);
  assert.ok(result.reason?.includes("already has an active session"));
  assert.ok(result.existingSession);
});

test("session manager - validates active session", () => {
  const createResult = sessionRegistry.createSession({
    playerId: "player-test3",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  const validation = sessionRegistry.validateSession(createResult.session.sessionId);
  assert.equal(validation.valid, true);
  assert.ok(validation.session);
  assert.equal(validation.session.playerId, "player-test3");
});

test("session manager - rejects invalid session ID", () => {
  const validation = sessionRegistry.validateSession("invalid-session-id");
  assert.equal(validation.valid, false);
  assert.ok(validation.reason?.includes("not found"));
});

test("session manager - updates heartbeat", () => {
  const createResult = sessionRegistry.createSession({
    playerId: "player-test4",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  const heartbeatResult = sessionRegistry.heartbeat(createResult.session.sessionId);
  assert.equal(heartbeatResult, true);
});

test("session manager - marks session as disconnected", () => {
  const createResult = sessionRegistry.createSession({
    playerId: "player-test5",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  const disconnected = sessionRegistry.markDisconnected(createResult.session.sessionId);
  assert.equal(disconnected, true);

  const validation = sessionRegistry.validateSession(createResult.session.sessionId);
  assert.equal(validation.valid, false);
  assert.ok(validation.reason?.includes("disconnected"));
});

test("session manager - reconnects disconnected session", () => {
  const createResult = sessionRegistry.createSession({
    playerId: "player-test6",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 60000, // Long enough to not expire
  });

  sessionRegistry.markDisconnected(createResult.session.sessionId);

  const reconnectResult = sessionRegistry.reconnectSession(
    createResult.session.sessionId,
    "conn-test2"
  );

  assert.equal(reconnectResult.valid, true);
  assert.ok(reconnectResult.session);
  assert.equal(reconnectResult.session.status, "active");
  assert.equal(reconnectResult.session.connectionId, "conn-test2");
});

test("session manager - transfers session to different server", () => {
  const createResult = sessionRegistry.createSession({
    playerId: "player-test7",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  const transferResult = sessionRegistry.transferSession(
    createResult.session.sessionId,
    "server-test2",
    "region-test2"
  );

  assert.equal(transferResult.valid, true);
  assert.ok(transferResult.session);
  assert.equal(transferResult.session.serverInstanceId, "server-test2");
  assert.equal(transferResult.session.regionId, "region-test2");

  // Old session should be marked as transferred
  const oldSession = sessionRegistry.validateSession(createResult.session.sessionId);
  assert.equal(oldSession.valid, false);
});

test("session manager - ends session", () => {
  const createResult = sessionRegistry.createSession({
    playerId: "player-test8",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  const ended = sessionRegistry.endSession(createResult.session.sessionId);
  assert.equal(ended, true);

  const validation = sessionRegistry.validateSession(createResult.session.sessionId);
  assert.equal(validation.valid, false);
});

test("session manager - gets player session", () => {
  const createResult = sessionRegistry.createSession({
    playerId: "player-test9",
    serverInstanceId: "server-test1",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  const session = sessionRegistry.getPlayerSession("player-test9");
  assert.ok(session);
  assert.equal(session.sessionId, createResult.session.sessionId);
});

test("session manager - gets sessions on server", () => {
  sessionRegistry.createSession({
    playerId: "player-test10a",
    serverInstanceId: "server-test10",
    regionId: "region-test1",
    connectionId: "conn-test1",
    sessionDurationMs: 5000,
  });

  sessionRegistry.createSession({
    playerId: "player-test10b",
    serverInstanceId: "server-test10",
    regionId: "region-test2",
    connectionId: "conn-test2",
    sessionDurationMs: 5000,
  });

  const sessions = sessionRegistry.getSessionsOnServer("server-test10");
  assert.ok(sessions.length >= 2);
  assert.ok(sessions.every((s) => s.serverInstanceId === "server-test10"));
});

test("session manager - default session duration is reasonable", () => {
  assert.equal(DEFAULT_SESSION_DURATION_MS, 60 * 60 * 1000); // 1 hour
});
