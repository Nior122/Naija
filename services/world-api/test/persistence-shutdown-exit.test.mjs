import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { WorldStore } from "../dist/multiplayer/persistence.js";

/**
 * Process-level shutdown exit code (file backend). Stage 28, Task 1.
 *
 * Starts the built server (dist/index.js) as a disposable child process with DATA_FILE in a temp directory.
 * Control: SIGTERM with no injected fault exits 0 and saves. Failure: the final flush throws the real
 * WorldStateCapacityError (injected through test/support/fail-final-flush.mjs) and the process must exit non-zero,
 * log the failure, and leave the previous file as it was.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "..", "dist", "index.js");
const preload = join(here, "support", "fail-final-flush.mjs");

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function runServer({ dataFile, port, failFinalFlush }) {
  const env = {
    PATH: process.env.PATH,
    NAIJA_ENV: "test",
    PERSISTENCE_BACKEND: "file",
    DATA_FILE: dataFile,
    PORT: String(port),
    ...(failFinalFlush ? { AUDIT_FAIL_FINAL_FLUSH: "1" } : {}),
  };
  const child = spawn(process.execPath, ["--import", preload, serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-400)}`)), 20_000);
    const check = setInterval(() => {
      if (output.includes("listening on")) { clearInterval(check); clearTimeout(timer); resolve(); }
    }, 50);
  });
  return { child, exited, listening, output: () => output };
}

function withTempFile(run) {
  const directory = mkdtempSync(join(tmpdir(), "naija-shutdown-exit-"));
  const dataFile = join(directory, "world-state.json");
  return run({ directory, dataFile }).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test("shutdown exit code: a clean SIGTERM saves and exits 0 (control)", () => withTempFile(async ({ dataFile }) => {
  // Seed a valid world, then stop the server with no injected fault.
  await new WorldStore(dataFile, Date.now()).flush();
  const before = readFileSync(dataFile);
  const run = runServer({ dataFile, port: await freePort(), failFinalFlush: false });
  await run.listening;
  run.child.kill("SIGTERM");
  const { code, signal } = await run.exited;
  assert.equal(signal, null);
  assert.equal(code, 0, `exit code (output tail: ${run.output().slice(-300)})`);
  assert.match(run.output(), /Multiplayer world state saved; API stopped\./);
  assert.ok(before.length > 0, "the seeded file existed before shutdown");
  assert.ok(new WorldStore(dataFile, Date.now()).state, "the file saved at shutdown loads as a valid world");
}));

test("shutdown exit code: a failed final flush exits 1, logs the failure, and keeps the previous file", () => withTempFile(async ({ dataFile }) => {
  await new WorldStore(dataFile, Date.now()).flush();
  const before = readFileSync(dataFile);
  const beforeStat = statSync(dataFile);
  const run = runServer({ dataFile, port: await freePort(), failFinalFlush: true });
  await run.listening;
  run.child.kill("SIGTERM");
  const { code, signal } = await run.exited;
  assert.equal(signal, null, "the process exits itself, not by signal");
  assert.equal(code, 1, `exit code (output tail: ${run.output().slice(-400)})`);
  assert.match(run.output(), /API shutdown failed/);
  assert.doesNotMatch(run.output(), /Multiplayer world state saved; API stopped\./);
  assert.deepEqual(readFileSync(dataFile), before, "the previous file is kept");
  assert.equal(statSync(dataFile).mtimeMs, beforeStat.mtimeMs, "the file was not rewritten");
  assert.equal(existsSync(`${dataFile}.tmp`), false);
}));
