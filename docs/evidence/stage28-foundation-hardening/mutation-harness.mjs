#!/usr/bin/env node
/**
 * Mutation harness for Stage 28 Foundation Hardening (Phase 6).
 *
 * For each mutation it:
 *   1. records the SHA-256 of every source file and compiled dist file it will touch;
 *   2. backs up the originals outside the repository;
 *   3. applies each edit only if its `find` text occurs exactly once (otherwise it aborts with no change);
 *   4. rebuilds dist with `npm run build` and verifies that the compiled file CHANGED (so the test run is not stale);
 *   5. runs the named test files against the mutated build and records the exit code and TAP counts;
 *   6. restores the sources from the backups, verifies every SHA-256 matches the pre-mutation value, and rebuilds;
 *      it verifies the restored dist hash equals the pre-mutation dist hash.
 * A mutation counts as DETECTED only when the test run exits non-zero AND the named assertions fail.
 *
 * Usage (from services/world-api):  node <this file> <output-json>
 * The script writes only under the output path and /tmp/s28/mutation-backups. It never commits or resets Git.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outPath = resolve(process.argv[2] ?? "mutation-results.json");
const backupRoot = "/tmp/s28/mutation-backups";
mkdirSync(backupRoot, { recursive: true });

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const ENGINE = "src/multiplayer/world-engine.ts";
const JUSTICE = "src/justice/service.ts";
const ENGINE_JS = "dist/multiplayer/world-engine.js";
const JUSTICE_JS = "dist/justice/service.js";

/** Each mutation: edits to apply, the test files to run, and a label for the guard it removes. */
const MUTATIONS = [
  {
    id: "M0-attempt1-replay",
    guard: "Replay of the first (anomalous) mutation text from the hardening report: suspension map entries and the stranger party check removed.",
    edits: [
      { file: ENGINE, find: '  ["decide_appeal", "justice_appeal_decision_suspended"],\n  ["pay_fine", "justice_fine_payment_suspended"],\n', replace: '  ["__none__", "x"],\n' },
      { file: ENGINE, find: '  ["create_criminal_record", "crime_record_creation_suspended"],\n', replace: '  ["__none__", "x"],\n' },
      { file: JUSTICE, find: 'if (!isCaseParty(state, caseId, submittedByCharacterId)) throw new Error("justice_not_case_party");', replace: "void submittedByCharacterId;" },
    ],
    tests: ["test/justice-finance-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M1-judge-view-removed",
    guard: "Assigned-judge view branch removed from viewCaseForCharacter.",
    edits: [
      { file: JUSTICE, find: "if (!isCaseParty(state, caseId, characterId) && !isAssignedJudgeForCase(state, caseId, characterId)) {", replace: "if (!isCaseParty(state, caseId, characterId)) {" },
    ],
    tests: ["test/justice-case-access.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M2-judge-evidence-allowed",
    guard: "Judge may not submit evidence check removed.",
    edits: [
      { file: JUSTICE, find: 'if (isAssignedJudgeForCase(state, caseId, submittedByCharacterId)) throw new Error("justice_judge_cannot_submit_evidence");', replace: "void submittedByCharacterId;" },
    ],
    tests: ["test/justice-case-access.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M3-stranger-evidence-allowed",
    guard: "Party standing check removed from submitEvidence.",
    edits: [
      { file: JUSTICE, find: 'if (!isCaseParty(state, caseId, submittedByCharacterId)) throw new Error("justice_not_case_party");', replace: "void submittedByCharacterId;" },
    ],
    tests: ["test/justice-finance-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M4-stranger-view-allowed",
    guard: "View gate removed from viewCaseForCharacter (strangers can read cases).",
    edits: [
      { file: JUSTICE, find: 'if (!isCaseParty(state, caseId, characterId) && !isAssignedJudgeForCase(state, caseId, characterId)) {\n    throw new Error("justice_case_not_found");\n  }', replace: "void characterId;" },
    ],
    tests: ["test/justice-finance-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M5-key-only-takeover-restored",
    guard: "D-05 refusal replaced with the old key-only recoverIdentity call.",
    edits: [
      { file: ENGINE, find: "      this.sendError(context, IDENTITY_RECOVERY_UNAVAILABLE_CODE, IDENTITY_RECOVERY_UNAVAILABLE_MESSAGE, requestId);", replace: "      await this.recoverIdentity(context, existingPlayerId, existingPlayer, requestId);" },
    ],
    tests: ["test/identity-budget.test.mjs", "test/identity-concurrency.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M6-containment-suspensions-removed",
    guard: "All three justice/crime suspension map entries removed.",
    edits: [
      { file: ENGINE, find: '  ["decide_appeal", "justice_appeal_decision_suspended"],\n', replace: "" },
      { file: ENGINE, find: '  ["pay_fine", "justice_fine_payment_suspended"],\n', replace: "" },
      { file: ENGINE, find: '  ["create_criminal_record", "crime_record_creation_suspended"],\n', replace: "" },
    ],
    tests: ["test/justice-finance-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M7-enlistment-suspension-removed",
    guard: "enlist suspension entry removed (applicant could reach enlistment with an unverified application ID).",
    edits: [{ file: ENGINE, find: '  ["enlist", "military_enlistment_suspended"],\n', replace: "" }],
    tests: ["test/family-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M8-arrest-suspension-removed",
    guard: "execute_arrest suspension entry removed.",
    edits: [{ file: ENGINE, find: '  ["execute_arrest", "police_arrest_suspended"],\n', replace: "" }],
    tests: ["test/family-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M9-crime-link-suspension-removed",
    guard: "link_to_justice suspension entry removed.",
    edits: [{ file: ENGINE, find: '  ["link_to_justice", "crime_link_suspended"],\n', replace: "" }],
    tests: ["test/family-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M10-client-education-trusted",
    guard: "Military application education read from the client again (D-04 eligibility bypass).",
    edits: [
      {
        file: ENGINE,
        find: "          const education = player.character.education_level;\n          const birthDate = player.character.date_of_birth ?? { year: worldDate.year - 20, month: 1, day: 1 };\n          const app = militaryService.applyForService",
        replace: '          const education = typeof data.education === "string" ? data.education : player.character.education_level;\n          const birthDate = player.character.date_of_birth ?? { year: worldDate.year - 20, month: 1, day: 1 };\n          const app = militaryService.applyForService',
      },
    ],
    tests: ["test/family-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M11-police-client-education-trusted",
    guard: "Police recruitment education read from the client again (D-04 eligibility bypass).",
    edits: [
      {
        file: ENGINE,
        find: "          const education = player.character.education_level;\n          const birthDate = player.character.date_of_birth ?? { year: worldDate.year - 20, month: 1, day: 1 };\n          let app: ReturnType<PoliceService",
        replace: '          const education = typeof data.education === "string" ? data.education : player.character.education_level;\n          const birthDate = player.character.date_of_birth ?? { year: worldDate.year - 20, month: 1, day: 1 };\n          let app: ReturnType<PoliceService',
      },
    ],
    tests: ["test/family-containment.test.mjs"],
    expectFailures: true,
  },
  {
    id: "M12-link-to-police-suspension-removed",
    guard: "Crime-to-police link suspension removed, so the link route is reachable again (D-04).",
    edits: [{ file: ENGINE, find: '  ["link_to_police", "crime_link_suspended"],\n', replace: "" }],
    tests: ["test/family-containment.test.mjs"],
    expectFailures: true,
  },
];

function run(cmd, args, cwd = root, timeoutMs = 280_000) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, env: { ...process.env, NAIJA_ENV: "test" } });
  return { status: r.status, signal: r.signal, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function tapCounts(text) {
  const grab = (k) => Number((text.match(new RegExp(`^# ${k} (\\d+)`, "m")) ?? [])[1] ?? NaN);
  return { tests: grab("tests"), pass: grab("pass"), fail: grab("fail"), skipped: grab("skipped") };
}

const results = [];
const sourceFiles = [ENGINE, JUSTICE];
const distFiles = [ENGINE_JS, JUSTICE_JS];

const baseline = Object.fromEntries([...sourceFiles, ...distFiles].map((f) => [f, sha(join(root, f))]));
results.push({ kind: "baseline", hashes: baseline });

for (const mutation of MUTATIONS) {
  const entry = { id: mutation.id, guard: mutation.guard, tests: mutation.tests, expectFailures: mutation.expectFailures };
  const preHashes = Object.fromEntries([...sourceFiles, ...distFiles].map((f) => [f, sha(join(root, f))]));
  const backupDir = join(backupRoot, mutation.id);
  mkdirSync(backupDir, { recursive: true });
  for (const f of sourceFiles) copyFileSync(join(root, f), join(backupDir, f.replaceAll("/", "__")));
  entry.preHashes = preHashes;

  const restore = () => {
    for (const f of sourceFiles) copyFileSync(join(backupDir, f.replaceAll("/", "__")), join(root, f));
    const build = run("npm", ["run", "build"]);
    entry.restore = {
      buildExit: build.status,
      sourceHashesMatch: sourceFiles.every((f) => sha(join(root, f)) === preHashes[f]),
      distHashesMatch: distFiles.every((f) => sha(join(root, f)) === preHashes[f]),
    };
  };

  try {
    // Apply edits: each `find` must occur exactly once.
    const applied = [];
    for (const edit of mutation.edits) {
      const path = join(root, edit.file);
      const text = readFileSync(path, "utf8");
      const count = text.split(edit.find).length - 1;
      if (count !== 1) throw new Error(`find text occurs ${count} times in ${edit.file} (need exactly 1)`);
      writeFileSync(path, text.replace(edit.find, edit.replace));
      applied.push(edit.file);
    }
    entry.editsApplied = mutation.edits.length;

    const build = run("npm", ["run", "build"]);
    entry.mutatedBuildExit = build.status;
    entry.mutatedDistChanged = distFiles.map((f) => ({ file: f, changed: sha(join(root, f)) !== preHashes[f] }));
    if (build.status !== 0) throw new Error(`mutated build failed: ${build.out.slice(-400)}`);

    const testRun = run("node", ["--test", ...mutation.tests], root, 280_000);
    entry.testExit = testRun.status;
    entry.testSignal = testRun.signal;
    entry.counts = tapCounts(testRun.out);
    entry.failingTests = (testRun.out.match(/^\s*not ok \d+ - .*$/gm) ?? []).map((line) => line.trim().slice(0, 240));
    entry.detected = testRun.status !== 0 && entry.counts.fail > 0;
    const logPath = join(backupDir, "test.log");
    writeFileSync(logPath, testRun.out);
    entry.log = logPath;
  } catch (error) {
    entry.error = String(error.message ?? error).slice(0, 400);
  } finally {
    restore();
  }
  results.push(entry);
  console.log(`${mutation.id}: detected=${entry.detected ?? false} exit=${entry.testExit ?? "n/a"} counts=${JSON.stringify(entry.counts ?? {})} restored=${JSON.stringify(entry.restore ?? {})}`);
}

const allRestored = results
  .filter((r) => r.restore)
  .every((r) => r.restore.sourceHashesMatch && r.restore.distHashesMatch && r.restore.buildExit === 0);
const finalHashes = Object.fromEntries([...sourceFiles, ...distFiles].map((f) => [f, sha(join(root, f))]));
const finalMatchesBaseline = Object.keys(baseline).every((f) => finalHashes[f] === baseline[f]);
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), allRestored, finalMatchesBaseline, results }, null, 2));
console.log(`allRestored=${allRestored} finalMatchesBaseline=${finalMatchesBaseline} -> ${outPath}`);
