import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApiServer } from "../../dist/app.js";
import WebSocket from "ws";

/**
 * Shared WebSocket and server helpers for persistence tests.
 * Mirrors the protocol used by app.test.mjs; kept separate so the persistence tests stay focused.
 */

export class TestPeer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  waitFor(predicate, timeoutMs = 5000) {
    const messageIndex = this.messages.findIndex(predicate);
    if (messageIndex >= 0) return Promise.resolve(this.messages.splice(messageIndex, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
          reject(new Error("Timed out waiting for a WebSocket event."));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  waitForType(type, timeoutMs) {
    return this.waitFor((message) => message.type === type, timeoutMs);
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, 1000);
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      else this.socket.terminate();
    });
  }
}

export async function openPeer(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new TestPeer(socket);
}

/** Start an API server on an ephemeral loopback port. */
export async function startApi(options) {
  const server = createApiServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    websocketUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

/** Graceful stop: saves state (flush) and closes sockets. */
export async function stopApi(server) {
  try {
    await server.shutdown();
  } finally {
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

/**
 * Create an identity through the real protocol and resume the session.
 * Returns the playerId, session token, and the session.ready character payload.
 */
export function identityCreateMessage(name, overrides = {}) {
  return {
    type: "identity.create",
    creationKey: randomBytes(32).toString("hex"),
    profile: {
      name,
      age: 16,
      character_type: "girl",
      appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
      ...overrides,
    },
  };
}

export async function createIdentity(peer, name, overrides = {}) {
  peer.send(identityCreateMessage(name, overrides));
  const created = await peer.waitForType("identity.created");
  return { playerId: created.playerId, sessionToken: created.sessionToken };
}

export async function resumeSession(peer, sessionToken) {
  peer.send({ type: "session.resume", sessionToken });
  return peer.waitForType("session.ready");
}
