/**
 * A separate Node process that opens the PostgreSQL world store and performs one operation per request.
 *
 * Used only by test/multiprocess-persistence.test.mjs. It reads one JSON request per line from stdin and writes
 * one reply per line to stdout, prefixed with REPLY_PREFIX. The prefix is needed because the database layer logs to
 * stdout. Requests are handled one at a time by the test, so every synchronization point is explicit.
 *
 * Environment: DATABASE_URL (disposable test database only), WORLD_KEY (the world row this process uses).
 */

import { createInterface } from "node:readline";
import { DatabaseConnection, loadDatabaseConfigFromEnv } from "../../dist/database/connection.js";
import { PostgresWorldStore } from "../../dist/database/world-store.js";

export const REPLY_PREFIX = "@@REPLY ";

const worldKey = process.env.WORLD_KEY;
if (!worldKey) throw new Error("WORLD_KEY is required");

const db = new DatabaseConnection(loadDatabaseConfigFromEnv());
let store = null;

function reply(body) {
  process.stdout.write(`${REPLY_PREFIX}${JSON.stringify(body)}\n`);
}

function requireStore() {
  if (!store) throw new Error("not opened");
  return store;
}

async function handle(request) {
  switch (request.op) {
    case "open": {
      await db.connect();
      store = await PostgresWorldStore.open({ db, worldKey });
      return { version: store.getVersion(), minute: store.state.worldClock.minute_of_day, fenced: store.isFenced() };
    }
    case "set": {
      // An in-memory change only. It is durable only after a successful flush.
      requireStore().state.worldClock.minute_of_day = request.minute;
      return { minute: store.state.worldClock.minute_of_day };
    }
    case "flush": {
      const current = requireStore();
      try {
        await current.flush();
        return { saved: true, version: current.getVersion(), fenced: current.isFenced() };
      } catch (error) {
        return { saved: false, error: error.name, fenced: current.isFenced(), version: current.getVersion() };
      }
    }
    case "health": {
      const health = await requireStore().health();
      return { status: health.status, message: health.message };
    }
    case "status": {
      const current = requireStore();
      return { version: current.getVersion(), minute: current.state.worldClock.minute_of_day, fenced: current.isFenced() };
    }
    case "exit": {
      await db.disconnect();
      return { exited: true };
    }
    default:
      throw new Error(`unknown op ${request.op}`);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    reply({ ok: false, error: "bad request" });
    return;
  }
  handle(request).then(
    (body) => reply({ ok: true, ...body }),
    (error) => reply({ ok: false, error: error.message }),
  );
});
lines.on("close", () => {
  // stdin closed: the coordinator is gone. Exit without a graceful flush; this process holds no unsaved work it
  // should persist.
  process.exit(0);
});
