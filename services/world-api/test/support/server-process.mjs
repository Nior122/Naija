/**
 * A separate Node process that runs the game server over a PostgreSQL world store (Stage 36).
 *
 * Used only by test/cross-process-requests-stage36.test.mjs. Each process loads the world when it starts, exactly as a
 * production process does, so two processes over one world key are two independent writers.
 *
 * Environment:
 * - DATABASE_URL: a disposable test database only (the test refuses other names).
 * - WORLD_KEY: the world row this process serves.
 * - S36_CRASH (optional, test-only fault injection): "before-commit:<requestId>" exits the process inside the transaction
 *   that would record <requestId>, before COMMIT. "after-commit:<requestId>" exits after that transaction commits, before
 *   the reply is sent. Nothing else changes: the exit is an ordinary process death (process.exit, no cleanup).
 *
 * Prints one line, "@@READY <json>", with the websocket URL once it is listening.
 */

import { DatabaseConnection, loadDatabaseConfigFromEnv } from "../../dist/database/connection.js";
import { PostgresWorldStore } from "../../dist/database/world-store.js";
import { startApi, stopApi } from "./harness.mjs";

export const READY_PREFIX = "@@READY ";

const IDENTITY_BUDGET = { perIpLimit: 100, globalLimit: 1000, windowMs: 3_600_000 };

function parseCrash(value) {
  if (!value) return null;
  const match = /^(before-commit|after-commit):(.+)$/.exec(value);
  if (!match) throw new Error(`S36_CRASH is not valid: ${value}`);
  return { phase: match[1], requestId: match[2] };
}

function crashNow(reason) {
  process.stderr.write(`S36_CRASH ${reason}\n`);
  process.exit(3);
}

/**
 * Test-only: wraps the connection's transaction so that the transaction which writes the crash request's record can
 * exit the process before COMMIT, or after it. The world save is the only transaction that writes that record.
 */
function installCrashPoint(db, crash) {
  const original = db.transaction.bind(db);
  db.transaction = async (callback) => {
    let recordWritten = false;
    const result = await original(async (client) => {
      const wrapped = {
        query: async (text, params) => {
          const reply = await client.query(text, params);
          if (text.includes("INSERT INTO world_operations") && params[2] === crash.requestId) {
            recordWritten = true;
            if (crash.phase === "before-commit") crashNow(`before commit of ${crash.requestId}`);
          }
          return reply;
        },
      };
      return callback(wrapped);
    });
    if (crash.phase === "after-commit" && recordWritten) crashNow(`after commit of ${crash.requestId}`);
    return result;
  };
}

const worldKey = process.env.WORLD_KEY;
if (!worldKey) throw new Error("WORLD_KEY is required");

const db = new DatabaseConnection(loadDatabaseConfigFromEnv());
await db.connect();
const crash = parseCrash(process.env.S36_CRASH ?? "");
if (crash) installCrashPoint(db, crash);

const store = await PostgresWorldStore.open({ db, worldKey });
const started = await startApi({
  worldStore: store,
  allowedOrigins: [],
  tickIntervalMs: 3_600_000,
  identityBudget: IDENTITY_BUDGET,
});

process.stdout.write(`${READY_PREFIX}${JSON.stringify({ websocketUrl: started.websocketUrl })}\n`);

async function shutdown() {
  try {
    await stopApi(started.server);
  } finally {
    await db.disconnect();
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown());
