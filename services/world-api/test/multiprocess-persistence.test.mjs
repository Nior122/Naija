/**
 * Stage 28 multi-process persistence tests against a DISPOSABLE PostgreSQL database.
 *
 * Every writer is a separate Node process (test/support/persistence-process.mjs) with its own database pool.
 * Synchronization is explicit: each request gets a reply, and the only waits are bounded polls of pg_stat_activity
 * for a lock wait that the test itself caused. No sleeps decide an outcome.
 *
 * These run only when DATABASE_URL points at a database whose name contains "test" AND
 * NAIJA_ALLOW_DB_TESTS=true. Results are for local PostgreSQL only, not Neon or production.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import pg from "pg";
import { resolveDatabasePoolConfig, database, loadDatabaseConfigFromEnv } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";

const LIVE = !!process.env.DATABASE_URL && process.env.NAIJA_ALLOW_DB_TESTS === "true";
const live = { skip: !LIVE ? "requires DATABASE_URL and NAIJA_ALLOW_DB_TESTS=true" : false, timeout: 120_000 };

if (LIVE) {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName)) {
    throw new Error("refusing to run live database tests: the database name must contain 'test'");
  }
}

const REPLY_PREFIX = "@@REPLY ";
const CHILD = join(dirname(fileURLToPath(import.meta.url)), "support", "persistence-process.mjs");
const REQUEST_TIMEOUT_MS = 30_000;

const processes = [];

/** One separate Node process that opens the world store. */
class WriterProcess {
  constructor(worldKey, label) {
    this.label = label;
    this.pending = [];
    this.stderr = "";
    this.child = spawn(process.execPath, [CHILD], {
      env: { ...process.env, WORLD_KEY: worldKey },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exited = new Promise((resolve) => this.child.once("exit", (code, signal) => resolve({ code, signal })));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.startsWith(REPLY_PREFIX)) {
          const resolve = this.pending.shift();
          if (resolve) resolve(JSON.parse(line.slice(REPLY_PREFIX.length)));
        }
        newline = buffer.indexOf("\n");
      }
    });
    processes.push(this);
  }

  /** Sends one request and waits for its reply (bounded). */
  request(op, fields = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: no reply to ${op}. stderr: ${this.stderr.slice(-500)}`)), REQUEST_TIMEOUT_MS);
      this.pending.push((reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.child.stdin.write(`${JSON.stringify({ op, ...fields })}\n`);
    });
  }

  /** SIGKILL: no shutdown code runs in the process. Resolves when the OS reports the exit. */
  async kill() {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
    return this.exited;
  }
}

/** Graceful end: the process disconnects its pool, then exits when its input closes. */
async function endWriter(writer) {
  await writer.request("exit").catch(() => undefined);
  writer.child.stdin.end();
  await writer.exited;
}

/** Opens a store in a new process and returns it with its reply. */
async function openWriter(worldKey, label) {
  const writer = new WriterProcess(worldKey, label);
  const reply = await writer.request("open");
  assert.equal(reply.ok, true, `${label} open failed: ${reply.error ?? ""}`);
  return { writer, reply };
}

async function rowState(worldKey) {
  const row = await database.queryOne("SELECT value, version FROM world_state WHERE key = $1", [worldKey]);
  assert.ok(row, "the world row must exist");
  return { version: Number(row.version), minute: row.value.worldClock.minute_of_day };
}

/** Bounded poll: waits until `count` UPDATE statements on world_state are waiting on a lock. */
async function waitForLockWaiters(count) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rows = await database.query(
      `SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE world_state%'`,
    );
    if (rows.length >= count) return rows.length;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${count} blocked save(s)`);
}

/**
 * Bounded poll: waits until no other backend in this database is still running or inside a transaction on
 * world_state. Used after the lock is released: the killed writer's blocked UPDATE may still finish on the server,
 * so the durable row must be read only once that has settled.
 */
async function waitForOrphanedSaveToSettle() {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rows = await database.query(
      `SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')
          AND query LIKE '%world_state%'`,
    );
    if (rows.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the killed writer's save to settle");
}

/** A separate connection that holds the world row lock until it commits or rolls back. */
async function holdRowLock(worldKey) {
  const client = new pg.Client(await resolveDatabasePoolConfig(loadDatabaseConfigFromEnv()));
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT version FROM world_state WHERE key = $1 FOR UPDATE", [worldKey]);
  return client;
}

before(async () => {
  if (!LIVE) return;
  await database.connect();
  await new MigrationManager(database).migrate();
});

after(async () => {
  if (!LIVE) return;
  for (const writer of processes) await writer.kill();
  await database.query("DELETE FROM world_state WHERE key LIKE 't28-mp-%'").catch(() => undefined);
  await database.disconnect();
});

test("Multi-process: two processes opening the same new world both load version 1 and one row is created", live, async () => {
  const worldKey = `t28-mp-open-${randomUUID()}`;
  const [a, b] = await Promise.all([openWriter(worldKey, "A"), openWriter(worldKey, "B")]);
  assert.equal(a.reply.version, 1);
  assert.equal(b.reply.version, 1);
  assert.equal(a.reply.minute, b.reply.minute);
  const rows = await database.query("SELECT key FROM world_state WHERE key = $1", [worldKey]);
  assert.equal(rows.length, 1);
  await Promise.all([endWriter(a.writer), endWriter(b.writer)]);
});

test("Multi-process fencing: a stale process cannot save, is unhealthy, and a restarted process loads the current state", live, async () => {
  const worldKey = `t28-mp-fence-${randomUUID()}`;
  const current = await openWriter(worldKey, "A");
  const stale = await openWriter(worldKey, "B");

  await current.writer.request("set", { minute: 100 });
  const firstSave = await current.writer.request("flush");
  assert.deepEqual([firstSave.saved, firstSave.version], [true, 2]);

  await stale.writer.request("set", { minute: 200 });
  const rejected = await stale.writer.request("flush");
  assert.equal(rejected.saved, false);
  assert.equal(rejected.error, "WorldStateConflictError");
  assert.equal(rejected.fenced, true);
  // Once fenced, every later save is refused without touching the database.
  const again = await stale.writer.request("flush");
  assert.equal(again.saved, false);
  assert.equal(again.fenced, true);
  const health = await stale.writer.request("health");
  assert.equal(health.status, "fail");
  assert.match(health.message, /superseded/);

  assert.deepEqual(await rowState(worldKey), { version: 2, minute: 100 }, "the stale write must not reach the database");

  await current.writer.request("set", { minute: 300 });
  const secondSave = await current.writer.request("flush");
  assert.deepEqual([secondSave.saved, secondSave.version], [true, 3]);

  await stale.writer.kill();
  const restarted = await openWriter(worldKey, "C");
  assert.deepEqual([restarted.reply.version, restarted.reply.minute, restarted.reply.fenced], [3, 300, false]);
  assert.deepEqual(await rowState(worldKey), { version: 3, minute: 300 });
  await endWriter(current.writer);
  await endWriter(restarted.writer);
});

test("Multi-process recovery: a saved state survives a SIGKILL of the writer", live, async () => {
  const worldKey = `t28-mp-kill-saved-${randomUUID()}`;
  const writer = await openWriter(worldKey, "A");
  await writer.writer.request("set", { minute: 400 });
  const saved = await writer.writer.request("flush");
  assert.equal(saved.saved, true);
  await writer.writer.kill();

  const recovered = await openWriter(worldKey, "B");
  assert.deepEqual([recovered.reply.version, recovered.reply.minute], [saved.version, 400]);
  await endWriter(recovered.writer);
});

test("Multi-process recovery: an unsaved change in a killed process is not recovered", live, async () => {
  const worldKey = `t28-mp-kill-unsaved-${randomUUID()}`;
  const writer = await openWriter(worldKey, "A");
  await writer.writer.request("set", { minute: 100 });
  const saved = await writer.writer.request("flush");
  assert.equal(saved.saved, true);

  await writer.writer.request("set", { minute: 500 }); // in memory only
  await writer.writer.kill();

  const recovered = await openWriter(worldKey, "B");
  assert.deepEqual([recovered.reply.version, recovered.reply.minute], [saved.version, 100]);
  assert.deepEqual(await rowState(worldKey), { version: saved.version, minute: 100 });
  await endWriter(recovered.writer);
});

test("Multi-process recovery: a writer killed while its save waits on a row lock (state observed, not assumed)", live, async (t) => {
  const worldKey = `t28-mp-kill-blocked-${randomUUID()}`;
  const writer = await openWriter(worldKey, "A");
  const before = await rowState(worldKey);
  const holder = await holdRowLock(worldKey);
  try {
    await writer.writer.request("set", { minute: 600 });
    writer.writer.request("flush"); // the reply will never arrive: the process is killed below
    assert.equal(await waitForLockWaiters(1), 1, "the save must be blocked on the row lock before the kill");
    await writer.writer.kill();
  } finally {
    await holder.query("ROLLBACK"); // release the lock without changing the row
    await holder.end();
  }

  // The killed process's statement was already issued. Wait for the server to finish it (or discard it), then
  // record what the database holds. Reading earlier races with the orphaned statement.
  await waitForOrphanedSaveToSettle();
  const durable = await rowState(worldKey);
  const recovered = await openWriter(worldKey, "B");
  // A new process must load exactly the durable state, whatever it is.
  assert.deepEqual([recovered.reply.version, recovered.reply.minute], [durable.version, durable.minute]);
  assert.equal(recovered.reply.fenced, false);
  // Observed: the row is either unchanged (the orphaned save was discarded) or it holds the orphaned save (600).
  // Both are valid recoveries. Neither is a corrupt or partial state.
  const unchanged = durable.version === before.version && durable.minute === before.minute;
  const committed = durable.version === before.version + 1 && durable.minute === 600;
  assert.ok(unchanged || committed, `unexpected recovered state ${JSON.stringify(durable)}`);
  t.diagnostic(`observed after killing the blocked writer: ${unchanged ? "row unchanged (orphaned save discarded)" : "row holds the orphaned save (committed)"}; durable ${JSON.stringify(durable)}`);
  await endWriter(recovered.writer);
});

test("Multi-process concurrency: two processes save at the same time; exactly one succeeds and the other is fenced", live, async () => {
  const worldKey = `t28-mp-race-${randomUUID()}`;
  const a = await openWriter(worldKey, "A");
  const b = await openWriter(worldKey, "B");
  const holder = await holdRowLock(worldKey);
  let replies;
  try {
    await a.writer.request("set", { minute: 700 });
    await b.writer.request("set", { minute: 800 });
    const savingA = a.writer.request("flush");
    const savingB = b.writer.request("flush");
    assert.equal(await waitForLockWaiters(2), 2, "both saves must be blocked on the row lock");
    await holder.query("ROLLBACK");
    replies = await Promise.all([savingA, savingB]);
  } finally {
    await holder.end().catch(() => undefined);
  }
  const winners = replies.filter((reply) => reply.saved === true);
  const losers = replies.filter((reply) => reply.saved === false);
  assert.equal(winners.length, 1, `exactly one save must succeed: ${JSON.stringify(replies)}`);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].error, "WorldStateConflictError");
  assert.equal(losers[0].fenced, true);
  const winnerMinute = winners[0] === replies[0] ? 700 : 800;
  assert.deepEqual(await rowState(worldKey), { version: 2, minute: winnerMinute });
  await endWriter(a.writer);
  await endWriter(b.writer);
});
