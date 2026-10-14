// Stage 44: the Godot check runner (tools/godot/run-godot-checks.sh) and the business UI runner
// (tools/business-fixture/run-business-ui.sh).
//
// These tests run the scripts themselves. They never run Godot. The "binary" is a stub written by this file. It
// answers --version with a chosen line, answers the user-data-directory query with a chosen path, and otherwise
// behaves as STUB_MODE says ("fail", "clean", "scripterror", "savewrite"). The stub is not Godot, so a passing run
// here shows only that the runner's own logic works. It says nothing about the Godot scripts. Those are run on a
// machine with Godot 4.7.2 (docs/STAGE_44_BUSINESS_VERIFICATION.md section 7.5).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const runner = join(root, "tools/godot/run-godot-checks.sh");
const businessRunner = join(root, "tools/business-fixture/run-business-ui.sh");
const scratch = mkdtempSync(join(tmpdir(), "naija-godot-runner-"));
const STAGE1_SAVE = "original stage 1 save\n";

after(() => rmSync(scratch, { recursive: true, force: true }));

const STUB_SOURCE = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "$STUB_VERSION"; exit 0; fi
case "$*" in
  *user_data_dir_headless.gd*) echo "USER_DATA_DIR: $STUB_USER_DIR"; exit 0 ;;
esac
echo "stub: not Godot ($*)"
case "$STUB_MODE" in
  clean) exit 0 ;;
  sleep) echo "$*" >> "$STUB_CALLS"; sleep 3; exit 0 ;;
  leave) printf 'left behind\\n' > "$STUB_USER_DIR/naija-leftover.json"; exit 1 ;;
  scripterror) echo "SCRIPT ERROR: stub error line"; exit 0 ;;
  savewrite) printf 'changed by a test\\n' > "$STUB_USER_DIR/naija-stage1-save.json"; exit 1 ;;
  *) exit 1 ;;
esac
`;

/** A stub binary. It answers --version with the given line. */
function stubBinary(name, versionLine = "4.7.2.stable.official.0000000") {
  const path = join(scratch, name);
  writeFileSync(path, STUB_SOURCE.replace('"$STUB_VERSION"', `'${versionLine}'`));
  chmodSync(path, 0o755);
  return path;
}

const RIGHT = stubBinary("godot-4-7-2");

/**
 * A fresh case: its own work directory and its own "user data directory", named like Godot's
 * (project name "Naija: One World"), with a stage 1 save, a save-test lock folder, and a file that is not naija-*.
 */
function freshCase(name) {
  const work = join(scratch, name, "work");
  const saveDir = join(scratch, name, "user-data", "Naija: One World");
  mkdirSync(join(saveDir, "naija-save-test.lock.d"), { recursive: true });
  writeFileSync(join(saveDir, "naija-stage1-save.json"), STAGE1_SAVE);
  writeFileSync(join(saveDir, "naija-save-test.lock.d", "owner.json"), "{}\n");
  writeFileSync(join(saveDir, "user-settings.cfg"), "not a naija file\n");
  return { work, saveDir };
}

/** Runs the script with a clean environment, so a developer's GODOT_BIN or FIXTURE_WORLD cannot leak in. */
function runRunner(extra = {}, scriptPath = runner) {
  return spawnSync("bash", [scriptPath], {
    env: { PATH: process.env.PATH, ...extra },
    encoding: "utf8",
    timeout: 300000,
  });
}

function runCase(name, mode, extra = {}) {
  const c = freshCase(name);
  const result = runRunner({
    GODOT_BIN: RIGHT,
    STUB_MODE: mode,
    STUB_USER_DIR: c.saveDir,
    GDPARSE: join(scratch, "no-such-gdparse"),
    WORK_DIR: c.work,
    ...extra,
  });
  return { ...c, result, out: `${result.stdout}${result.stderr}` };
}

function backupDirs(work) {
  return existsSync(work) ? readdirSync(work).filter((n) => n.startsWith("save-backup-")) : [];
}

describe("Godot check runner: inputs and version (nothing runs)", () => {
  test("it refuses to run when GODOT_BIN is unset, and says where to get Godot", () => {
    const result = runRunner({ WORK_DIR: join(scratch, "unset") });
    assert.equal(result.status, 3, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /GODOT_BIN is not set/);
    assert.match(result.stdout, /github\.com\/godotengine\/godot\/releases\/tag\/4\.7\.2-stable/);
  });

  test("it refuses a file that is not executable", () => {
    const notExecutable = join(scratch, "not-executable");
    writeFileSync(notExecutable, "text\n");
    chmodSync(notExecutable, 0o644);
    const result = runRunner({ GODOT_BIN: notExecutable, WORK_DIR: join(scratch, "nx") });
    assert.equal(result.status, 3);
    assert.match(result.stdout, /GODOT_BIN is not set to an executable/);
  });

  test("it refuses a binary whose version is not 4.7.2.stable, and runs no check", () => {
    const wrong = stubBinary("godot-4-6", "4.6.0.stable.official.abc123");
    const result = runRunner({ GODOT_BIN: wrong, WORK_DIR: join(scratch, "wrong-version") });
    assert.equal(result.status, 3, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /reports '4\.6\.0\.stable\.official\.abc123'; this script requires 4\.7\.2\.stable/);
    assert.match(result.stdout, /Nothing was run/);
    assert.doesNotMatch(result.stdout, /^(PASS|FAIL|SKIP)\s/m);
  });

  test("a PORT that is not a number, or is outside 1024-65535, is refused before anything runs", () => {
    for (const port of ["abc", "80", "70000", "3200;rm"]) {
      const result = runRunner({ GODOT_BIN: RIGHT, PORT: port, WORK_DIR: join(scratch, `port-${port.length}`) });
      assert.equal(result.status, 3, `PORT=${port}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /PORT must be/);
      assert.doesNotMatch(result.stdout, /^(PASS|FAIL|SKIP)\s/m);
    }
  });

  test("a missing required file is refused before anything runs", () => {
    const fakeRepo = join(scratch, "fake-repo");
    mkdirSync(join(fakeRepo, "tools/godot"), { recursive: true });
    mkdirSync(join(fakeRepo, "game"), { recursive: true });
    copyFileSync(runner, join(fakeRepo, "tools/godot/run-godot-checks.sh"));
    writeFileSync(join(fakeRepo, "game/project.godot"), "");
    const result = runRunner(
      { GODOT_BIN: RIGHT, WORK_DIR: join(scratch, "fake-work") },
      join(fakeRepo, "tools/godot/run-godot-checks.sh"),
    );
    assert.equal(result.status, 3, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /Required files are missing from this checkout: .*tests\/domain_smoke\.gd/);
    assert.doesNotMatch(result.stdout, /^(PASS|FAIL|SKIP)\s/m);
  });
});

describe("Godot check runner: a run without Godot never reports a pass", () => {
  test("with no real Godot, every headless check fails, and the saves are backed up first", () => {
    const { work, saveDir, out, result } = runCase("fail-mode", "fail");
    assert.equal(result.status, 1, out);
    assert.match(out, /Godot version: 4\.7\.2\.stable/);
    assert.doesNotMatch(out, /^PASS\s+(domain_smoke|save_restart)/m);
    assert.match(out, /^FAIL\s+domain_smoke/m);
    assert.match(out, /^FAIL\s+save_restart_read/m);
    assert.match(out, /^SKIP\s+gdparse: /m, "a missing gdparse is a skip");
    assert.match(out, /^SKIP\s+server-backed UI phases: /m, "missing fixture inputs are a skip");
    // 13 headless scripts + 2 save_restart runs fail. The save protection and save check pass.
    assert.match(out, /SUMMARY: 2 passed, 15 failed, 2 skipped/);
    assert.match(out, /^PASS\s+save protection: backup written/m);
    assert.match(out, /^PASS\s+save check: the local naija-\* saves are unchanged/m);
    // The save-directory warning names the real directory, including its colon and space.
    assert.match(out, new RegExp(`Godot's user data directory for this project: ${escapeRe(saveDir)}`));
    assert.match(out, /NOTE: the folder naija-save-test\.lock\.d exists/);
    // The backup holds the naija-* files only, with byte-identical content and a manifest.
    const dirs = backupDirs(work);
    assert.equal(dirs.length, 1, `one backup folder: ${dirs}`);
    const backup = join(work, dirs[0]);
    assert.equal(readFileSync(join(backup, "naija-stage1-save.json"), "utf8"), STAGE1_SAVE);
    assert.equal(readFileSync(join(backup, "naija-save-test.lock.d", "owner.json"), "utf8"), "{}\n");
    assert.equal(existsSync(join(backup, "user-settings.cfg")), false, "a non-naija file is not backed up");
    assert.equal(readFileSync(join(backup, "manifest.sha256"), "utf8").trim().split("\n").length, 2);
    // The originals are untouched.
    assert.equal(readFileSync(join(saveDir, "naija-stage1-save.json"), "utf8"), STAGE1_SAVE);
  });

  test("a save that a test changes is reported as FAIL, and the backup is named for restore", () => {
    const { work, saveDir, out, result } = runCase("savewrite-mode", "savewrite");
    assert.equal(result.status, 1, out);
    assert.match(out, /^FAIL\s+save check: a local naija-\* save changed or disappeared/m);
    assert.match(out, /Restore it from /);
    assert.doesNotMatch(out, /^PASS\s+save check/m);
    // The runner reports the change and does not restore by itself.
    assert.equal(readFileSync(join(saveDir, "naija-stage1-save.json"), "utf8"), "changed by a test\n");
    const [dir] = backupDirs(work);
    assert.equal(readFileSync(join(work, dir, "naija-stage1-save.json"), "utf8"), STAGE1_SAVE);
  });

  test("a script error in a log fails the check even when the process exits 0", () => {
    const { out, result } = runCase("scripterror-mode", "scripterror");
    assert.equal(result.status, 1, out);
    assert.match(out, /^FAIL\s+domain_smoke \(exit 0, but its log has a script error\)/m);
    assert.doesNotMatch(out, /^PASS\s+domain_smoke/m);
  });

  test("a run that passed everything it ran, but skipped checks, exits 2 and never 0", () => {
    const { out, result } = runCase("clean-mode", "clean");
    assert.equal(result.status, 2, out);
    assert.match(out, /SUMMARY: 17 passed, 0 failed, 2 skipped/);
    assert.match(out, /Incomplete: 2 check\(s\) were skipped/);
  });

  test("setting only one of FIXTURE_WORLD and SESSIONS is a failure, not a skip", () => {
    const fixture = join(scratch, "fixture.json");
    writeFileSync(fixture, "{}\n");
    const { out, result } = runCase("half-fixture", "clean", { FIXTURE_WORLD: fixture });
    assert.equal(result.status, 1, out);
    assert.match(out, /^FAIL\s+server-backed UI phases: set both FIXTURE_WORLD and SESSIONS/m);
  });

  test("if the user data directory cannot be found, no Godot test runs", () => {
    const work = join(scratch, "no-user-dir", "work");
    const result = runRunner({ GODOT_BIN: RIGHT, STUB_MODE: "fail", STUB_USER_DIR: "", WORK_DIR: work });
    const out = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, out);
    assert.match(out, /Could not find Godot's user data directory/);
    assert.match(out, /no Godot test was run/);
    assert.doesNotMatch(out, /^(PASS|FAIL)\s+(domain_smoke|save_restart)/m);
  });

  test("GODOT_USER_DIR, when set, is used as the directory to protect", () => {
    const c = freshCase("explicit-dir");
    const result = runRunner({
      GODOT_BIN: RIGHT,
      STUB_MODE: "clean",
      GODOT_USER_DIR: c.saveDir,
      GDPARSE: join(scratch, "no-such-gdparse"),
      WORK_DIR: c.work,
    });
    const out = `${result.stdout}${result.stderr}`;
    assert.match(out, new RegExp(`directory for this project: ${escapeRe(c.saveDir)}`));
  });
});

describe("Godot check runner: signals, directories, and the save check (review fixes)", () => {
  test("Ctrl-C to the run's process group: no further check starts, the running one is not a pass, exit 130", async () => {
    const c = freshCase("ctrl-c");
    const calls = join(scratch, "ctrl-c", "calls.log");
    const child = spawn("bash", [runner], {
      detached: true, // its own process group, so the signal below reaches it and its children, as Ctrl-C does
      env: {
        PATH: process.env.PATH,
        GODOT_BIN: RIGHT,
        STUB_MODE: "sleep",
        STUB_USER_DIR: c.saveDir,
        STUB_CALLS: calls,
        GDPARSE: join(scratch, "no-such-gdparse"),
        WORK_DIR: c.work,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    process.kill(-child.pid, "SIGINT");
    const code = await exited;
    assert.equal(code, 130, out);
    const started = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
    assert.equal(started, 1, "only the check that was already running started");
    assert.match(out, /^FAIL\s+domain_smoke \(interrupted; not counted as a pass\)/m);
    assert.match(out, /^SKIP\s+player_movement: not started: the run was interrupted/m);
    assert.doesNotMatch(out, /^PASS\s+(domain_smoke|player_movement)/m);
    assert.match(out, /Interrupted \(Ctrl-C or TERM\)/);
    assert.match(out, /^PASS\s+save check: the local naija-\* saves are unchanged/m, "the save check still runs");
  });

  test("a WORK_DIR that already exists keeps its permissions (the runner does not chmod it)", () => {
    const existing = join(scratch, "existing-shared");
    mkdirSync(existing);
    chmodSync(existing, 0o755);
    const c = freshCase("existing-dir");
    const result = runRunner({
      GODOT_BIN: RIGHT,
      STUB_MODE: "clean",
      STUB_USER_DIR: c.saveDir,
      GDPARSE: join(scratch, "no-such-gdparse"),
      WORK_DIR: existing,
    });
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`);
    assert.equal(statSync(existing).mode & 0o777, 0o755);
  });

  test("with no naija-* files before the run, the save check is an explicit note and is not counted", () => {
    const base = join(scratch, "fresh-empty");
    const saveDir = join(base, "user-data", "Naija: One World");
    mkdirSync(saveDir, { recursive: true });
    const result = runRunner({
      GODOT_BIN: RIGHT,
      STUB_MODE: "clean",
      STUB_USER_DIR: saveDir,
      GDPARSE: join(scratch, "no-such-gdparse"),
      WORK_DIR: join(base, "work"),
    });
    const out = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 2, out);
    assert.match(out, /NOTE: no naija-\* files existed before the run, so the save check had nothing to compare/);
    assert.doesNotMatch(out, /^(PASS|FAIL)\s+save check/m);
    assert.match(out, /SUMMARY: 16 passed, 0 failed, 2 skipped/);
  });

  test("a naija-* file that a run leaves behind is reported in a note, with its name", () => {
    const { out, result } = runCase("leftover", "leave");
    assert.equal(result.status, 1, out);
    assert.match(out, /NOTE: these naija-\* files exist after the run but did not exist before it: naija-leftover\.json/);
    assert.match(out, /^PASS\s+save check: the local naija-\* saves are unchanged/m, "a new file does not fail the check on the pre-run files");
  });

  test("both runners create WORK_DIR with mode 700 only when it does not exist", () => {
    for (const path of [runner, businessRunner]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /if \[ ! -d "\$WORK_DIR" \]; then/, `${path} creates WORK_DIR only when missing`);
      assert.match(source, /^umask 077$/m, `${path} makes files private`);
    }
  });

  test("the runbook does not tell the reader to isolate the online test with a variable the test overrides", () => {
    const doc = readFileSync(join(root, "docs/STAGE_44_BUSINESS_VERIFICATION.md"), "utf8");
    assert.doesNotMatch(doc, /NAIJA_MULTIPLAYER_SESSION_PATH=\$WORK_DIR\/online-smoke\.cfg/);
    assert.match(doc, /naija-online-businesses-test\.cfg/, "the runbook names the file the online test actually uses");
  });
});

describe("Business UI runner: contract (static, plus dynamic input checks)", () => {
  test("every optional phase is a separate call with its own fresh copy in the Godot runner", () => {
    const source = readFileSync(runner, "utf8");
    for (const phase of ["default", "career_rate_limit career_rate_limit", "lifecycle lifecycle",
      "rate_limit rate_limit", "remaining remaining"]) {
      assert.match(source, new RegExp(`^  ui_run ${phase}$`, "m"), `ui_run ${phase}`);
    }
    assert.match(source, /ui_run\(\) \{[\s\S]*?WORK_DIR="\$dir"/, "each call gets its own WORK_DIR");
  });

  test("the business runner: the trap covers INT and TERM, a log scan, and an absolute WORK_DIR", () => {
    const source = readFileSync(businessRunner, "utf8");
    assert.match(source, /trap 'stop_server' EXIT/);
    assert.match(source, /trap 'stop_server; exit 130' INT TERM/);
    assert.match(source, /WORK_DIR="\$\(cd "\$WORK_DIR" && pwd\)"/);
    assert.match(source, /SCRIPT ERROR\|Parse Error\|Compile Error/);
    assert.match(source, /PRE_EXISTING/, "stops only servers this run started");
    // The trap must be set before the server is launched, so an interrupt during startup still stops it.
    assert.ok(source.indexOf("trap 'stop_server' EXIT") < source.indexOf("NAIJA_ENV=development"));
  });

  test("the business runner refuses a bad PORT before it starts anything", () => {
    for (const port of ["abc", "1023", "65536"]) {
      const result = spawnSync("bash", [businessRunner], {
        env: { PATH: process.env.PATH, PORT: port, GODOT_BIN: RIGHT, FIXTURE_WORLD: "x", SESSIONS: "x" },
        encoding: "utf8",
        timeout: 60000,
      });
      assert.equal(result.status, 3, `${port}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /PORT must be/);
    }
  });

  test("every headless script the Godot runner lists exists in game/tests", () => {
    const source = readFileSync(runner, "utf8");
    const block = source.match(/HEADLESS_TESTS=\(([\s\S]*?)\n\)/);
    assert.ok(block, "the HEADLESS_TESTS list is present");
    const names = block[1].split(/\s+/).filter(Boolean);
    assert.equal(names.length, 13, `found ${names.length} names`);
    for (const name of names) {
      assert.ok(existsSync(join(root, "game/tests", `${name}.gd`)), `${name}.gd exists`);
    }
  });

  test("the career scenario is present and says it has not been run", () => {
    const scenario = readFileSync(join(root, "game/tests/career_rate_limit_ui_headless.gd"), "utf8");
    assert.match(scenario, /extends SceneTree/);
    assert.match(scenario, /_career_request_id\.is_empty\(\)/, "checks the matched request ID is cleared");
    assert.match(scenario, /_on_online_message\(\{/, "checks a non-matching refusal does not reach the career panel");
    assert.match(scenario, /WRITTEN BUT NOT EXECUTED/, "states that it has not been run");
  });
});

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
