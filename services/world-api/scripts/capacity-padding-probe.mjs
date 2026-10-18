#!/usr/bin/env node
/**
 * Mechanism probe for the 16 MiB world-state limit (file backend, pretty format, default limit).
 *
 * Question: does content that is NOT an identity count toward the same limit? The limit applies to the whole
 * serialized file. This probe seeds one identity, pads one test-only field with a chosen number of bytes, then
 * creates identities through real WebSocket connections until the first refused save.
 *
 * It uses a temporary file only. It never reads or writes services/world-api/data/world-state.json, and the
 * padding is a test-only field that exists only in the temporary world.
 *
 * Usage: node scripts/capacity-padding-probe.mjs --pad-bytes 1735956 [--out result.json]
 *
 * This shows whether a given amount of other content reduces the identity count. It does not show what the
 * historical E8 world contained.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { WorldStore, WORLD_STATE_LIMIT_BYTES } from "../dist/multiplayer/persistence.js";
import { FaultyStore } from "../test/support/faulty-store.mjs";
import { createMessage, newCreationKey, startCreationServer } from "../test/support/creation-fixture.mjs";
import { openPeer, stopApi } from "../test/support/harness.mjs";

const args = parseArgs(process.argv.slice(2));
const padBytes = Number(args["pad-bytes"] ?? 0);
const maxIdentities = Number(args.max ?? 1200);
if (!Number.isInteger(padBytes) || padBytes < 0) throw new Error("--pad-bytes must be a non-negative integer");

const directory = mkdtempSync(join(tmpdir(), "naija-pad-probe-"));
const file = join(directory, "world-state.json");
const started = performance.now();
const result = {
  mode: "synthetic padding, file backend, pretty format, default 16 MiB limit",
  limit_bytes: WORLD_STATE_LIMIT_BYTES,
  pad_bytes: padBytes,
  identities_created: 0,
  first_refusal: null,
  final_file_bytes: null,
  shutdown: null,
};

try {
  const backend = { store: new FaultyStore(new WorldStore(file, Date.now())) };
  // The production connection limit (30 new connections per minute per IP) would stop one socket per creation.
  // It is raised here for the test run only, as the other capacity tools do.
  const server = await startCreationServer(backend, { connectionAttemptsPerMinute: 1_000_000_000 });
  try {
    const seed = await createOne(server.websocketUrl, "Seed");
    if (!seed.ok) throw new Error(`seed creation failed: ${seed.code}`);
    backend.store.state.players[seed.playerId].character.test_padding = "x".repeat(padBytes);

    for (let attempt = 1; attempt <= maxIdentities; attempt += 1) {
      const reply = await createOne(server.websocketUrl, "Probe");
      if (!reply.ok) {
        result.first_refusal = { after_identities: result.identities_created, code: reply.code };
        break;
      }
      result.identities_created += 1;
    }
  } finally {
    try {
      await stopApi(server.server);
      result.shutdown = { ok: true };
    } catch (error) {
      result.shutdown = { ok: false, code: error instanceof Error ? error.message : "unknown" };
    }
  }
  result.final_file_bytes = statSync(file).size;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
result.elapsed_seconds = Math.round((performance.now() - started) / 1000);
const text = `${JSON.stringify(result, null, 2)}\n`;
if (args.out) writeFileSync(args.out, text, "utf8");
process.stdout.write(text);

async function createOne(url, name) {
  const peer = await openPeer(url);
  try {
    peer.send(createMessage(newCreationKey(), name));
    const reply = await peer.waitFor((message) => message.type === "identity.created" || message.type === "error", 60_000);
    if (reply.type === "identity.created") return { ok: true, playerId: reply.playerId };
    return { ok: false, code: reply.code };
  } finally {
    await peer.close();
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    parsed[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return parsed;
}
