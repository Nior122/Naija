import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer } from "../dist/app.js";

/**
 * Test isolation: the test suite must never read or write the live world file
 * (services/world-api/data/world-state.json). createApiServer() falls back to that file when no
 * stateFile or worldStore is given, so every test server must receive a temporary one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const liveFile = join(packageRoot, "data", "world-state.json");

function fingerprint(path) {
  if (!existsSync(path)) return { exists: false };
  const bytes = readFileSync(path);
  return { exists: true, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * Returns the text of every createApiServer(...) call in a source file, matching parentheses so that nested
 * braces and parentheses inside the options object do not end the call early.
 */
function createApiServerCalls(source) {
  const calls = [];
  const name = "createApiServer(";
  let index = source.indexOf(name);
  while (index !== -1) {
    let depth = 0;
    let end = source.length - 1;
    for (let i = index + name.length - 1; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    calls.push(source.slice(index, end + 1));
    index = source.indexOf(name, index + name.length);
  }
  return calls;
}

const PASSES_STATE = /\bstateFile\b|\bworldStore\b/;

test("Isolation: the call scanner accepts a stateFile after nested braces, and flags calls without one (controls)", () => {
  assert.deepEqual(createApiServerCalls("x = createApiServer({ a: async () => ({ b: 1 }), stateFile });").map((c) => PASSES_STATE.test(c)), [true]);
  assert.deepEqual(createApiServerCalls("x = createApiServer({ tickIntervalMs: 100 });").map((c) => PASSES_STATE.test(c)), [false]);
  assert.deepEqual(createApiServerCalls("x = createApiServer(options);").map((c) => PASSES_STATE.test(c)), [false]);
  assert.equal(createApiServerCalls("createApiServer({ stateFile }); createApiServer({ worldStore });").length, 2);
});

test("Isolation: every createApiServer call in the test suite passes a stateFile or worldStore", () => {
  const files = readdirSync(here).filter((name) => name.endsWith(".test.mjs") && name !== "isolation.test.mjs");
  let calls = 0;
  for (const file of files) {
    const source = readFileSync(join(here, file), "utf8");
    for (const call of createApiServerCalls(source)) {
      calls += 1;
      assert.ok(PASSES_STATE.test(call), `${file} has a createApiServer call without stateFile or worldStore: ${call.slice(0, 120)}`);
    }
  }
  assert.ok(calls > 0, "expected to find createApiServer calls in the suite");
});

test("Isolation: a server with a temporary stateFile writes only to that temporary file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "naija-isolation-"));
  const before = fingerprint(liveFile);
  try {
    const stateFile = join(directory, "world-state.json");
    const server = createApiServer({ stateFile, tickIntervalMs: 100 });
    await new Promise((resolve) => server.listen(0, resolve));
    await server.shutdown();
    // Positive control: shutdown flushes the world, so the temporary file must now exist.
    assert.equal(existsSync(stateFile), true, "the temporary stateFile should have been written");
    assert.deepEqual(fingerprint(liveFile), before, "the live world file must not change");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Isolation: running the integration test file leaves the live world file byte-for-byte unchanged", () => {
  const before = fingerprint(liveFile);
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-force-exit", join(here, "integration.test.mjs")],
    { cwd: packageRoot, encoding: "utf8", timeout: 240_000 },
  );
  const after = fingerprint(liveFile);
  assert.equal(result.status, 0, `integration tests failed:\n${(result.stdout + result.stderr).slice(-2000)}`);
  assert.deepEqual(after, before, "the live world file changed during the integration tests");
});
