import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Stage 28 entry-point startup policy. These run the real dist/index.js in a child process with a minimal,
 * explicit environment (the parent's NAIJA_* and DATABASE_* variables are not inherited). Each case must refuse
 * to start (non-zero exit) and must not listen. The live world file is hashed before and after and must not change.
 */

const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const LIVE = fileURLToPath(new URL("../data/world-state.json", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "naija-entry-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function digest(path) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent";
}

function runEntry(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: { PATH: process.env.PATH, HOME: dir, PORT: "3999", ...env },
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, output: stdout + stderr });
    });
  });
}

test("Entry: NAIJA_ENV unset refuses to start", async () => {
  const before = digest(LIVE);
  const result = await runEntry({});
  assert.equal(result.code, 1);
  assert.match(result.output, /NAIJA_ENV must be set/);
  assert.equal(digest(LIVE), before);
});

test("Entry: production without DATABASE_URL refuses to start and writes no file", async () => {
  const result = await runEntry({ NAIJA_ENV: "production", NAIJA_METRICS_ACCESS: "ingress", DATA_FILE: join(dir, "prod.json") });
  assert.equal(result.code, 1);
  assert.match(result.output, /requires DATABASE_URL/);
  assert.equal(existsSync(join(dir, "prod.json")), false);
});

test("Entry: production without a metrics policy refuses to start", async () => {
  const result = await runEntry({ NAIJA_ENV: "production", DATABASE_URL: "postgresql://u@127.0.0.1:1/d?sslmode=verify-full" });
  assert.equal(result.code, 1);
  assert.match(result.output, /NAIJA_METRICS_ACCESS is required in production/);
});

test("Entry: production with an unreachable database refuses to start without a file fallback", async () => {
  const stateFile = join(dir, "prod-fallback.json");
  const result = await runEntry({
    NAIJA_ENV: "production",
    NAIJA_METRICS_ACCESS: "ingress",
    DATABASE_URL: "postgresql://probe:probe@127.0.0.1:1/probe?sslmode=verify-full",
    DATA_FILE: stateFile,
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /connection failed/i);
  assert.equal(existsSync(stateFile), false);
});

test("Entry: production with DB_SSL=false is refused, even to loopback", async () => {
  const result = await runEntry({
    NAIJA_ENV: "production",
    NAIJA_METRICS_ACCESS: "ingress",
    DATABASE_URL: "postgresql://probe:probe@127.0.0.1:1/probe",
    DB_SSL: "false",
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /DB_SSL=false is allowed only when NAIJA_ENV is development or test/);
});

test("Entry: development with no backend configured refuses to start, and says file mode is explicit", async () => {
  const result = await runEntry({ NAIJA_ENV: "development", DATA_FILE: join(dir, "dev.json") });
  assert.equal(result.code, 1);
  assert.match(result.output, /never selected automatically/);
  assert.equal(existsSync(join(dir, "dev.json")), false);
});

test("Entry: test environment with file mode and no state file never touches the live world file", async () => {
  const before = digest(LIVE);
  const result = await runEntry({ NAIJA_ENV: "test", PERSISTENCE_BACKEND: "file" });
  assert.equal(result.code, 1);
  assert.match(result.output, /refuses the live world file|requires an explicit test world file/);
  assert.equal(digest(LIVE), before, "the live world file must be byte-identical after the test");
});

test("Entry: an invalid metrics token is refused at startup, and the token is not printed", async () => {
  const token = "short-but-secret-token";
  const result = await runEntry({
    NAIJA_ENV: "development",
    NAIJA_METRICS_ACCESS: "token",
    NAIJA_METRICS_TOKEN: token,
    PERSISTENCE_BACKEND: "file",
    DATA_FILE: join(dir, "tok.json"),
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /at least 32 characters/);
  assert.equal(result.output.includes(token), false);
});
