#!/usr/bin/env node
/**
 * Read-only saved-world check for the compact JSON rollout (docs/STAGE_28_COMPACT_JSON_ROLLOUT.md).
 *
 * For every *.json file directly inside <directory>:
 *   1. Records the SHA-256 and size of the original (never written to).
 *   2. Copies the file to a private temp directory and loads the copy with the production WorldStore validation.
 *   3. Saves the loaded state in compact format to a second temp copy, reloads it, and compares the two loaded states.
 *   4. Reports per-collection record counts and any differing paths (paths only, never values).
 *   5. Re-checks the original's SHA-256 at the end. A changed original is a failed run.
 *
 * Usage: node scripts/saved-world-format-check.mjs <directory> [--out <report.json>]
 *   --out must not be inside <directory>. The report contains file names, sizes, hashes, counts and difference paths.
 *   It contains no record values, names, keys, or connection strings.
 *
 * Exit codes: 0 = every file passed; 1 = at least one failure; 2 = usage error or no files found.
 * A pass proves only that these files load and that the compact round-trip keeps their loaded state. It does not
 * prove historical integrity or anything about production data.
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { WorldStore } from "../dist/multiplayer/persistence.js";

const MAX_DIFF_PATHS = 20;

function parseArgs(argv) {
  const positional = [];
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") {
      out = argv[i + 1];
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 1 || (out !== null && out === undefined)) {
    throw new Error("Usage: node scripts/saved-world-format-check.mjs <directory> [--out <report.json>]");
  }
  return { directory: resolve(positional[0]), out: out === null ? null : resolve(out) };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Lists differing paths between two JSON-compatible values, without values. */
function diffPaths(a, b, path = "", acc = []) {
  if (acc.length >= MAX_DIFF_PATHS) return acc;
  if (Object.is(a, b)) return acc;
  const aIsContainer = a !== null && typeof a === "object";
  const bIsContainer = b !== null && typeof b === "object";
  if (!aIsContainer || !bIsContainer || Array.isArray(a) !== Array.isArray(b)) {
    acc.push(path || "<root>");
    return acc;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (acc.length >= MAX_DIFF_PATHS) break;
    const childPath = `${path}/${key}`;
    if (!(key in a) || !(key in b)) {
      acc.push(childPath);
    } else {
      diffPaths(a[key], b[key], childPath, acc);
    }
  }
  return acc;
}

function collectionCounts(state) {
  const counts = {};
  for (const [key, value] of Object.entries(state)) {
    if (Array.isArray(value)) counts[key] = value.length;
    else if (value !== null && typeof value === "object") counts[key] = Object.keys(value).length;
  }
  return counts;
}

function checkFile(sourcePath, workRoot, index) {
  const originalBytes = readFileSync(sourcePath);
  const before = sha256(originalBytes);
  const entry = {
    file: basename(sourcePath),
    bytes: originalBytes.length,
    sha256Before: before,
    layout: originalBytes.includes(0x0a) ? "pretty-or-multiline" : "compact",
    status: "fail",
    failures: [],
  };
  const dir = join(workRoot, String(index));
  mkdirSync(dir, { recursive: true });
  const loadCopy = join(dir, "load.json");
  const compactCopy = join(dir, "compact.json");
  copyFileSync(sourcePath, loadCopy);
  const now = Date.UTC(2026, 9, 10);

  return (async () => {
    let loaded;
    try {
      loaded = new WorldStore(loadCopy, now).state;
    } catch (error) {
      entry.failures.push(`load-failed: ${error instanceof Error ? error.constructor.name : "error"}`);
      return entry;
    }
    entry.collections = collectionCounts(loaded);

    try {
      // The compact copy starts as a byte copy of the original; a compact writer loads it and saves the same state.
      copyFileSync(sourcePath, compactCopy);
      const compactWriter = new WorldStore(compactCopy, now, { format: "compact" });
      await compactWriter.flush();
      const reloaded = new WorldStore(compactCopy, now).state;
      entry.compactBytes = statSync(compactCopy).size;
      entry.compactLayoutIsSingleLine = !readFileSync(compactCopy, "utf8").includes("\n");
      const differing = diffPaths(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(reloaded)));
      if (differing.length > 0) {
        entry.failures.push("compact-roundtrip-differs");
        entry.differingPaths = differing;
      }
      const reloadedCounts = collectionCounts(reloaded);
      if (JSON.stringify(reloadedCounts) !== JSON.stringify(entry.collections)) {
        entry.failures.push("collection-counts-differ");
      }
    } catch (error) {
      entry.failures.push(`compact-save-or-reload-failed: ${error instanceof Error ? error.constructor.name : "error"}`);
    }
    return entry;
  })();
}

async function main() {
  const { directory, out } = parseArgs(process.argv.slice(2));
  if (out !== null && (out === directory || out.startsWith(directory + sep))) {
    throw new Error("--out must not be inside the directory being checked.");
  }
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directory, entry.name))
    .sort();
  if (files.length === 0) {
    console.error("No *.json files found directly inside the directory. Nothing was checked.");
    process.exitCode = 2;
    return;
  }

  const workRoot = mkdtempSync(join(tmpdir(), `naija-format-check-${randomUUID()}-`));
  const results = [];
  try {
    for (let i = 0; i < files.length; i += 1) {
      const entry = await checkFile(files[i], workRoot, i);
      const after = sha256(readFileSync(files[i]));
      entry.sourceUnchanged = after === entry.sha256Before;
      if (!entry.sourceUnchanged) entry.failures.push("source-changed-during-check");
      entry.status = entry.failures.length === 0 ? "pass" : "fail";
      results.push(entry);
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }

  const failed = results.filter((r) => r.status !== "pass");
  const report = {
    directory: basename(directory),
    checkedAt: new Date().toISOString(),
    fileCount: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    totalBytesOriginal: results.reduce((sum, r) => sum + r.bytes, 0),
    totalBytesCompact: results.reduce((sum, r) => sum + (r.compactBytes ?? 0), 0),
    scope: "Load and compact round-trip of the listed files only. Not a historical-integrity proof.",
    files: results,
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out !== null) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text, { encoding: "utf8", flag: "wx" });
  }
  process.stdout.write(text);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unexpected error.");
  process.exitCode = 2;
});
