#!/usr/bin/env node
/**
 * PostgreSQL capacity probe (real saves, isolated database). Creates identities through the real WebSocket path
 * until the first refusal or the target count, then shuts down and reports. Each save is a real UPDATE of the
 * world_state row used by this probe only.
 *
 * Safety (the script refuses to run otherwise):
 *   - DATABASE_URL must name a database whose name contains "test" or "probe".
 *   - --confirm-database must repeat that database name exactly (typed by the operator; the URL is never printed).
 *   - Only the probe's own world key is written and then deleted. No other rows are read or changed.
 *
 * Usage: DATABASE_URL=... node scripts/capacity-probe-postgres.mjs --confirm-database <name> --identities 2500 --out <file>
 * The report contains counts, sizes and latencies only (no names, keys, tokens or connection strings).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { database } from "../dist/database/connection.js";
import { MigrationManager } from "../dist/database/migrations.js";
import { PostgresWorldStore } from "../dist/database/world-store.js";

const args = parseArgs(process.argv.slice(2));
const target = Number(args.identities ?? 1000);
if (!Number.isInteger(target) || target < 1) throw new Error("--identities must be a positive integer");
if (!args.out) throw new Error("--out is required");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
let databaseName;
try {
  databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  throw new Error("DATABASE_URL could not be read");
}
if (!/test|probe/i.test(databaseName)) throw new Error("refusing: the database name must contain 'test' or 'probe'");
if (args["confirm-database"] !== databaseName) throw new Error("refusing: --confirm-database must match the database name");

const profile = {
  name: "Ada", age: 16, character_type: "girl",
  appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
};
const worldKey = `capacity-probe-${randomUUID()}`;
const started = performance.now();

await database.connect();
const migrations = new MigrationManager(database);
const status = await migrations.getStatus();
if (!status.isUpToDate) throw new Error("the database is not migrated to the latest schema");

const store = await PostgresWorldStore.open({ worldKey, db: database });
const server = createApiServer({
  worldStore: store, allowedOrigins: [], tickIntervalMs: 3_600_000, connectionAttemptsPerMinute: 1_000_000_000,
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `ws://127.0.0.1:${server.address().port}/ws`;

function createOnce(name) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("no reply within 60 seconds")), 60_000);
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "identity.create", creationKey: randomBytes(32).toString("hex"), profile: { ...profile, name } }));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "identity.created" && message.type !== "error") return;
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
  });
}

const latencies = [];
let created = 0;
let firstFailure = null;
for (let index = 1; index <= target; index += 1) {
  const began = performance.now();
  const reply = await createOnce(`Probe ${index}`);
  latencies.push(performance.now() - began);
  if (reply.type === "error") {
    firstFailure = { attempt: index, code: reply.code };
    break;
  }
  created = index;
}
const creationSeconds = Math.round((performance.now() - started) / 1000);

const shutdownStarted = performance.now();
let shutdownError = null;
try {
  await server.shutdown();
} catch (error) {
  shutdownError = error instanceof Error ? error.constructor.name : "error";
}
const shutdownMs = Math.round(performance.now() - shutdownStarted);

const [sizeRow] = await database.query("SELECT octet_length(value::text) AS bytes FROM world_state WHERE key = $1", [worldKey]);
const finalBytes = sizeRow ? Number(sizeRow.bytes) : null;
await database.query("DELETE FROM world_state WHERE key = $1", [worldKey]);
await database.disconnect();

const sorted = [...latencies].sort((a, b) => a - b);
const pick = (p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0) : null);
const report = {
  backend: "postgres",
  database_name_class: "test-or-probe (name not recorded)",
  requested_identities: target,
  created_identities: created,
  first_failure: firstFailure,
  size_limit_bytes: 16 * 1024 * 1024,
  final_snapshot_bytes: finalBytes,
  bytes_per_identity_marginal: created > 0 && finalBytes ? Math.round(finalBytes / created) : null,
  creation_latency_ms: { p50: pick(50), p95: pick(95), max: sorted.length ? Math.round(sorted[sorted.length - 1]) : null },
  creation_phase_seconds: creationSeconds,
  shutdown_ms: shutdownMs,
  shutdown_error: shutdownError,
  probe_rows_deleted: true,
  node: process.version,
  finished_at: new Date().toISOString(),
};
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ created, firstFailure, finalBytes, shutdownError, creationSeconds }));
process.exit(0);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    parsed[key.slice(2)] = argv[i + 1];
  }
  return parsed;
}
