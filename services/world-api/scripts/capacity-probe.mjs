#!/usr/bin/env node
/**
 * Synthetic capacity probe for the single-file world store (R5).
 *
 * Creates identities through real WebSocket connections against an in-process server, using a
 * temporary state file only. It never reads or writes the live world file (services/world-api/data).
 *
 * Modes:
 *   real      Every creation performs a real save (candidate write, then merge). Measures per-save latency
 *             and file size. Expensive: each save rewrites the whole world.
 *   default-cap
 *             Like real, but with the production 16 MiB limit. Runs until the first refused save and
 *             reports the identity count and size at that point.
 *   noop-flush
 *             LABELLED: creation saves are skipped (no serialization or disk write per creation), so the run
 *             measures the creation path and memory growth only. One real save is timed at the end.
 *
 * Usage:
 *   node scripts/capacity-probe.mjs --mode real --identities 1000 --out <file.json>
 *   node scripts/capacity-probe.mjs --mode default-cap --identities 2000 --out <file.json>
 *   node scripts/capacity-probe.mjs --mode noop-flush --identities 10000 --budget-seconds 900 --out <file.json>
 *
 * The output never contains creation keys, session tokens, or player names.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";
import { createApiServer } from "../dist/app.js";
import { WorldStore, WORLD_STATE_LIMIT_BYTES } from "../dist/multiplayer/persistence.js";

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? "real";
const target = Number(args.identities ?? 1000);
const budgetMs = Number(args["budget-seconds"] ?? 900) * 1000;
if (!["real", "default-cap", "noop-flush"].includes(mode)) throw new Error("mode must be real, default-cap, or noop-flush");
if (!Number.isInteger(target) || target < 1) throw new Error("--identities must be a positive integer");

const directory = mkdtempSync(join(tmpdir(), "naija-capacity-"));
const stateFile = join(directory, "world-state.json");
const cap = mode === "default-cap" ? WORLD_STATE_LIMIT_BYTES : Number(args["max-bytes"] ?? 1024 ** 3);
const inner = new WorldStore(stateFile, Date.now(), { maxBytes: cap });

const saveDurations = [];
const memory = [];
let skipSaves = false;
const store = {
  get state() {
    return inner.state;
  },
  get filePath() {
    return inner.filePath;
  },
  async flush() {
    if (skipSaves) return;
    const started = performance.now();
    await inner.flush();
    saveDurations.push(performance.now() - started);
  },
  async saveState(candidate) {
    if (skipSaves) return;
    const started = performance.now();
    await inner.saveState(candidate);
    saveDurations.push(performance.now() - started);
  },
};

const server = createApiServer({
  stateFile,
  worldStore: store,
  allowedOrigins: [],
  tickIntervalMs: 3_600_000,
  maxConnections: 1_000_000,
  connectionAttemptsPerMinute: 1_000_000_000,
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const url = `ws://127.0.0.1:${server.address().port}/ws`;

function sampleMemory(count) {
  const usage = process.memoryUsage();
  memory.push({ identities: count, rss_mb: round(usage.rss / 1048576), heap_used_mb: round(usage.heapUsed / 1048576) });
}

/** One real creation over its own socket. Returns the outcome; the key is random and not recorded. */
function createOne(index, latencies) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    const started = performance.now();
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ type: "timeout" }), 120_000);
    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "identity.create",
        creationKey: randomBytes(32).toString("hex"),
        profile: {
          name: `Probe ${index}`,
          age: 16,
          character_type: "girl",
          appearance: { skin_tone: "#9b654d", hairstyle: "Braids", clothing_color: "#27734a" },
        },
      }));
    });
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "identity.created") {
        latencies.push(performance.now() - started);
        finish({ type: "created" });
      } else if (message.type === "error") {
        finish({ type: "error", code: message.code });
      }
    });
    socket.on("error", () => finish({ type: "socket_error" }));
    socket.on("close", () => finish({ type: "closed" }));
  });
}

const latencies = [];
const started = performance.now();
let created = 0;
let firstFailure = null;
let lastCheckpoint = 0;
const sizeAtCheckpoints = [];

// noop-flush skips the per-creation saves only; the final save and shutdown below are real saves.
if (mode === "noop-flush") skipSaves = true;

for (let index = 0; index < target; index += 1) {
  if (performance.now() - started > budgetMs) break;
  const outcome = await createOne(index, latencies);
  if (outcome.type !== "created") {
    firstFailure = { after_identities: created, outcome: outcome.type, code: outcome.code ?? null };
    break;
  }
  created += 1;
  if (created - lastCheckpoint >= 250 || created === target) {
    lastCheckpoint = created;
    sampleMemory(created);
    if (mode !== "noop-flush") sizeAtCheckpoints.push({ identities: created, file_bytes: safeSize(stateFile) });
  }
}
const creationPhaseMs = performance.now() - started;

// noop-flush: one real save at the final size, so the serialization and write cost is measured once.
let finalSave = null;
if (mode === "noop-flush") {
  skipSaves = false;
  const before = performance.now();
  let saveError = null;
  try {
    await inner.flush();
  } catch (error) {
    saveError = error instanceof Error ? error.message : String(error);
  }
  finalSave = {
    duration_ms: round(performance.now() - before),
    file_bytes: safeSize(stateFile),
    exceeds_16_mib: safeSize(stateFile) > WORLD_STATE_LIMIT_BYTES,
    error: saveError,
  };
}

sampleMemory(created);
const shutdownStarted = performance.now();
let shutdownError = null;
try {
  await server.shutdown();
} catch (error) {
  shutdownError = error instanceof Error ? error.constructor.name : "error";
}
const shutdownMs = performance.now() - shutdownStarted;
await new Promise((resolve) => server.close(resolve));

const report = {
  mode,
  label: mode === "noop-flush"
    ? "NO-OP FLUSH during creations: no per-creation save; one real save timed at the end"
    : mode === "default-cap"
      ? "Real saves with the production 16 MiB limit; stops at the first refused save"
      : "Real saves on every creation (temporary file, size limit raised for this run)",
  requested_identities: target,
  created_identities: created,
  first_failure: firstFailure,
  size_limit_bytes: cap,
  creation_latency_ms: summarize(latencies),
  save_latency_ms: summarize(saveDurations),
  creation_phase_seconds: round(creationPhaseMs / 1000),
  final_file_bytes: safeSize(stateFile),
  bytes_per_identity_marginal: created > 0 ? Math.round(safeSize(stateFile) / created) : null,
  final_save: finalSave,
  shutdown_ms: round(shutdownMs),
  shutdown_error: shutdownError,
  memory,
  size_checkpoints: sizeAtCheckpoints,
  node: process.version,
  finished_at: new Date().toISOString(),
};

const out = args.out ?? join(tmpdir(), `naija-capacity-${mode}-${target}.json`);
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, memory: report.memory.slice(-2), size_checkpoints: report.size_checkpoints.slice(-3) }, null, 2));
console.log(`report written to ${out}`);
if (args["keep-file"]) {
  // Optional copy of the final saved file, for composition analysis. Never the live file.
  writeFileSync(args["keep-file"], readFileSync(stateFile));
}
rmSync(directory, { recursive: true, force: true });

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    parsed[key.slice(2)] = argv[i + 1];
  }
  return parsed;
}

function safeSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function summarize(values) {
  if (values.length === 0) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
  return { count: values.length, p50: at(50), p95: at(95), max: round(sorted[sorted.length - 1]) };
}
