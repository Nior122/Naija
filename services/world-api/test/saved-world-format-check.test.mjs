import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { initialState } from "../dist/multiplayer/persistence.js";

/*
 * Self-test of scripts/saved-world-format-check.mjs. The files here are GENERATED. They prove only that the tool
 * behaves as documented. They are not the historical saved-world corpus and must not be cited as corpus evidence.
 */
const scriptPath = fileURLToPath(new URL("../scripts/saved-world-format-check.mjs", import.meta.url));

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makeDir() {
  const root = mkdtempSync(join(tmpdir(), "naija-format-selftest-"));
  const dir = join(root, "saved");
  mkdirSync(dir);
  return { root, dir };
}

function prettyWorld(dir, name) {
  // A valid, empty world in the pretty-printed format that existed before compact output.
  writeFileSync(join(dir, name), JSON.stringify(initialState(Date.UTC(2026, 9, 10)), null, 2));
}

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8", timeout: 120000 });
}

test("format check self-test (generated files, not corpus): pretty files pass and originals are unchanged", () => {
  const { root, dir } = makeDir();
  try {
    prettyWorld(dir, "a.json");
    prettyWorld(dir, "b.json");
    const before = readdirSync(dir).map((name) => [name, sha(join(dir, name))]);
    const outPath = join(root, "report.json");
    const result = run([dir, "--out", outPath]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(report.fileCount, 2);
    assert.equal(report.passed, 2);
    assert.equal(report.failed, 0);
    assert.ok(report.totalBytesCompact < report.totalBytesOriginal, "compact output is smaller than pretty output");
    for (const file of report.files) {
      assert.equal(file.status, "pass");
      assert.equal(file.sourceUnchanged, true);
      assert.equal(file.compactLayoutIsSingleLine, true);
      assert.ok(file.collections && typeof file.collections === "object");
    }
    const after = readdirSync(dir).map((name) => [name, sha(join(dir, name))]);
    assert.deepEqual(after, before, "the source directory is not modified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("format check self-test: a corrupt file is reported as a load failure and the run exits 1", () => {
  const { root, dir } = makeDir();
  try {
    prettyWorld(dir, "good.json");
    writeFileSync(join(dir, "bad.json"), "{ not json");
    const result = run([dir]);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    const bad = report.files.find((file) => file.file === "bad.json");
    assert.equal(bad.status, "fail");
    assert.ok(bad.failures.some((failure) => failure.startsWith("load-failed")));
    assert.equal(bad.sourceUnchanged, true, "the corrupt original is left as it was");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("format check self-test: a report written inside the checked directory is refused", () => {
  const { root, dir } = makeDir();
  try {
    prettyWorld(dir, "a.json");
    const result = run([dir, "--out", join(dir, "report.json")]);
    assert.equal(result.status, 2);
    assert.equal(readdirSync(dir).includes("report.json"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("format check self-test: an empty directory is reported as nothing checked, not a pass", () => {
  const { root, dir } = makeDir();
  try {
    const result = run([dir]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
