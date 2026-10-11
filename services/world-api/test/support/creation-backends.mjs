import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { database } from "../../dist/database/connection.js";
import { MigrationManager } from "../../dist/database/migrations.js";
import { PostgresWorldStore } from "../../dist/database/world-store.js";
import { WorldStore } from "../../dist/multiplayer/persistence.js";
import { FaultyStore } from "./faulty-store.mjs";
import { createMessage, startCreationServer, tempDirectory, uniqueWorldKey } from "./creation-fixture.mjs";
import WebSocket from "ws";
import { TestPeer } from "./harness.mjs";

/**
 * Backend helpers for identity-creation tests that must run on the file backend and, when a disposable database is
 * configured, on PostgreSQL. Nothing here touches services/world-api/data/. The PostgreSQL gate matches the other suites:
 * DATABASE_URL plus NAIJA_ALLOW_DB_TESTS=true, and a database name containing "test".
 */

export const PG_LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
if (PG_LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

export const backendNames = ["file", ...(PG_LIVE ? ["postgres"] : [])];

/** Connect and migrate once per test file, when PostgreSQL is configured. */
export async function connectBackends() {
  if (!PG_LIVE) return;
  await database.connect();
  await new MigrationManager(database).migrate();
}

export async function disconnectBackends() {
  if (!PG_LIVE) return;
  await database.disconnect();
}

/**
 * Opens a backend. The returned object exposes `store` (a FaultyStore over the backend), `durableState()` (what the
 * backend holds), `restoreDurable(snapshot)` (writes a snapshot back, for restart tests), `reopen()` (a fresh store over
 * the same storage, as after a process restart), and `cleanup()`.
 */
export async function openBackend(name) {
  if (name === "file") return openFileBackend();
  return openPostgresBackend();
}

function openFileBackend() {
  const directory = tempDirectory("naija-creation-backend-");
  const file = join(directory, "world-state.json");
  const backend = {
    name: "file",
    store: new FaultyStore(new WorldStore(file, Date.now())),
    async durableState() {
      return JSON.parse(readFileSync(file, "utf8"));
    },
    async restoreDurable(snapshot) {
      writeFileSync(file, JSON.stringify(snapshot));
    },
    async reopen() {
      backend.store = new FaultyStore(new WorldStore(file, Date.now()));
    },
    async cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
  return backend;
}

async function openPostgresBackend() {
  const worldKey = uniqueWorldKey();
  const backend = {
    name: "postgres",
    store: new FaultyStore(await PostgresWorldStore.open({ worldKey, db: database })),
    async durableState() {
      const row = await database.queryOne("SELECT value FROM world_state WHERE key = $1", [worldKey]);
      return row.value;
    },
    async restoreDurable(snapshot) {
      await database.query(
        "UPDATE world_state SET value = $1::jsonb, version = version + 1, updated_at = NOW() WHERE key = $2",
        [JSON.stringify(snapshot), worldKey],
      );
    },
    async reopen() {
      backend.store = new FaultyStore(await PostgresWorldStore.open({ worldKey, db: database }));
    },
    async cleanup() {
      await database.query("DELETE FROM world_state WHERE key = $1", [worldKey]);
    },
  };
  return backend;
}

/** Opens a socket from a given local address (127.0.0.1, 127.0.0.2, ...), so the per-IP budget sees that address. */
export async function openPeerFrom(url, address) {
  const socket = new WebSocket(url, { localAddress: address });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new TestPeer(socket);
}

/** Sends one identity.create on a new socket from `address` and returns the first identity.created or error reply. */
export async function createFrom(started, address, creationKey, name = "Ada") {
  const peer = await openPeerFrom(started.websocketUrl, address);
  try {
    peer.send(createMessage(creationKey, name));
    return await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 10_000);
  } finally {
    await peer.close();
  }
}

/** Starts a server over a backend. `options.creationFaultHook` is passed through. */
export async function startOver(backend, options = {}) {
  return startCreationServer(backend, options);
}

export function playersWithKey(state, keyHash) {
  return Object.entries(state.players)
    .filter(([, player]) => player.creationKeyHash === keyHash)
    .map(([playerId]) => playerId);
}
