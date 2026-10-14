#!/bin/bash
# Stage 44: runs the Godot checks on a machine that has a Godot 4.7.2-stable binary.
#
# This script does NOT download Godot and does NOT change any Godot save except through the tests themselves.
# Get the official Linux build from https://github.com/godotengine/godot/releases/tag/4.7.2-stable
# (Godot_v4.7.2-stable_linux.x86_64.zip). Check its SHA-256 against the digest in
# docs/STAGE_44_BUSINESS_VERIFICATION.md section 7.5 before you use it. The script refuses any binary whose
# --version is not 4.7.2.stable.
#
# LOCAL SAVE WARNING. Several headless tests write and remove files named naija-* in Godot's user data
# directory for this project (for example naija-stage1-save.json, the Stage 1 save). That directory is the
# SAME one your own Godot runs use. Before any Godot test runs, this script:
#   1. finds that directory (asks Godot, or uses GODOT_USER_DIR if you set it);
#   2. copies every naija-* file there into WORK_DIR/save-backup-<time>/ (copy only; nothing is moved or deleted);
#   3. records each file's SHA-256 in manifest.sha256 inside that backup folder.
# After all tests, it checks the SHA-256 of each original again. If one changed, it reports FAIL and names the
# backup to restore from. It never restores on its own, because the newer file may be the one you want.
# If step 1 or 2 fails, no Godot test runs.
#
# Required environment:
#   GODOT_BIN       a Godot 4.7.2-stable executable
# Optional:
#   GODOT_USER_DIR  the user data directory to protect, if you know it (skips asking Godot)
#   GDPARSE         the gdparse command (gdtoolkit 4.x). Default: gdparse on PATH. Skipped if absent.
#   FIXTURE_WORLD   a funded world file (tools/business-fixture/provision.mjs). The server-backed UI phases are
#                   skipped when FIXTURE_WORLD and SESSIONS are both unset, and fail if only one is set.
#   SESSIONS        the sessions file for FIXTURE_WORLD (roles owner, buyer, candidate, stranger)
#   WORK_DIR        where logs, backups and isolated copies go (default /tmp/naija-godot-checks)
#   PORT            the isolated server's port, a number from 1024 to 65535 (default 3200)
#
# Order of work:
#   0. Inputs: GODOT_BIN, PORT, WORK_DIR, and every required script and fixture file. Nothing runs if one is missing.
#   1. Godot version must be 4.7.2.stable.
#   2. gdparse over every game/**/*.gd file on disk (parse only; not lint).
#   3. Save protection (above). Fail closed.
#   4. Headless scripts that need no server. Each runs once. save_restart runs as write, then read.
#   5. Server-backed UI phases. Each optional phase runs on its own fresh copy of FIXTURE_WORLD, so no phase
#      starts from another phase's changes: default (the six business phases in order), career_rate_limit,
#      lifecycle, rate_limit, remaining.
#   6. Save check (above).
#
# Result words:
#   PASS  the script exited 0 and its log has no SCRIPT ERROR, Parse Error or Compile Error. Some scripts print
#         no PASS line, so PASS does not mean every assertion was printed. Read the log for the detail.
#   FAIL  nonzero exit, a script error in the log, or a changed save file.
#   SKIP  a required input was not provided. Nothing ran for that check.
#
# Exit status: 0 only when every check ran and passed. 1 when any check failed. 2 when nothing failed but some
# checks were skipped (the run is incomplete, and it is never reported as success). 3 when the run did not start
# because an input is wrong (nothing was run).
#
# Not run by this script (run by hand, see the Stage 44 record, section 7.5): online_businesses_headless.gd,
# which needs its own running server.

set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-3200}"
WORK_DIR="${WORK_DIR:-/tmp/naija-godot-checks}"
GDPARSE="${GDPARSE:-gdparse}"
GODOT_USER_DIR="${GODOT_USER_DIR:-}"
PASS=0
FAIL=0
SKIP=0
FAILED_NAMES=()
BACKUP_DIR=""
SAVE_DIR=""

note() { printf '%s\n' "$*"; }
result_pass() { PASS=$((PASS + 1)); note "PASS  $1"; }
result_fail() { FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); note "FAIL  $1${2:+ (log: $2)}"; }
result_skip() { SKIP=$((SKIP + 1)); note "SKIP  $1: $2"; }
input_error() { note "$*"; note "Nothing was run."; exit 3; }

# ---- 0. Inputs (no Godot starts yet) ----
if [ -z "${GODOT_BIN:-}" ] || [ ! -x "$GODOT_BIN" ]; then
  input_error "GODOT_BIN is not set to an executable Godot 4.7.2-stable binary. Download the official build from https://github.com/godotengine/godot/releases/tag/4.7.2-stable"
fi
case "$PORT" in
  ''|*[!0-9]*) input_error "PORT must be a number from 1024 to 65535 (got '$PORT')." ;;
esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  input_error "PORT must be from 1024 to 65535 (got $PORT)."
fi
mkdir -p "$WORK_DIR" || input_error "WORK_DIR cannot be created: $WORK_DIR"
chmod 700 "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"

HEADLESS_TESTS=(
  domain_smoke player_movement persistence_notice ui_flow_headless input_bindings_headless
  load_confirmation_headless performance_metrics regional_handoff regional_visual_profiles return_path
  save_guard_headless session_policy business_request_errors_headless
)
REQUIRED_FILES=(
  "game/project.godot"
  "game/tests/user_data_dir_headless.gd"
  "game/tests/save_restart.gd"
  "game/tests/career_rate_limit_ui_headless.gd"
  "tools/business-fixture/run-business-ui.sh"
)
for test in "${HEADLESS_TESTS[@]}"; do REQUIRED_FILES+=("game/tests/$test.gd"); done
MISSING=()
for rel in "${REQUIRED_FILES[@]}"; do
  [ -f "$REPO/$rel" ] || MISSING+=("$rel")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  input_error "Required files are missing from this checkout: ${MISSING[*]}"
fi

# ---- 1. Version ----
VERSION="$("$GODOT_BIN" --version 2>/dev/null | head -n 1)"
case "$VERSION" in
  4.7.2.stable*) note "Godot version: $VERSION" ;;
  *) input_error "GODOT_BIN reports '$VERSION'; this script requires 4.7.2.stable." ;;
esac

# ---- 2. Parse ----
if command -v "$GDPARSE" >/dev/null 2>&1; then
  mapfile -t GD_FILES < <(cd "$REPO" && find game -name '*.gd' -not -path '*/.godot/*' | sort)
  if (cd "$REPO" && "$GDPARSE" "${GD_FILES[@]}") > "$WORK_DIR/gdparse.log" 2>&1; then
    result_pass "gdparse (${#GD_FILES[@]} GDScript files on disk)"
  else
    result_fail "gdparse" "$WORK_DIR/gdparse.log"
  fi
else
  result_skip "gdparse" "'$GDPARSE' is not on PATH (gdtoolkit 4.x)"
fi

# ---- 3. Save protection ----
protect_saves() {
  if [ -n "$GODOT_USER_DIR" ]; then
    SAVE_DIR="$GODOT_USER_DIR"
  else
    (cd "$REPO" && "$GODOT_BIN" --headless --path game --script res://tests/user_data_dir_headless.gd) \
      > "$WORK_DIR/user-data-dir.log" 2>&1
    SAVE_DIR="$(sed -n 's/^USER_DATA_DIR: //p' "$WORK_DIR/user-data-dir.log" | head -n 1)"
  fi
  if [ -z "$SAVE_DIR" ]; then
    note "Could not find Godot's user data directory (see $WORK_DIR/user-data-dir.log). Set GODOT_USER_DIR to it."
    return 1
  fi
  BACKUP_DIR="$WORK_DIR/save-backup-$(date +%Y%m%d-%H%M%S)"
  if [ -e "$BACKUP_DIR" ]; then BACKUP_DIR="$BACKUP_DIR-$$"; fi
  mkdir -p "$BACKUP_DIR" || return 1
  : > "$BACKUP_DIR/manifest.sha256"
  note ""
  note "LOCAL SAVE WARNING"
  note "  Godot's user data directory for this project: $SAVE_DIR"
  note "  The headless tests will write and remove naija-* files in it, including naija-stage1-save.json."
  if [ ! -d "$SAVE_DIR" ]; then
    note "  The directory does not exist yet, so there is nothing to back up."
    return 0
  fi
  local folder
  for folder in "$SAVE_DIR"/naija-*/; do
    [ -d "$folder" ] && note "  NOTE: the folder $(basename "$folder") exists. It may be an unfinished save-test"
    [ -d "$folder" ] && note "  protocol from an earlier run. Do not delete it by hand. See game/tests/support/save_slot_guard.gd."
  done
  local rel_list=()
  mapfile -t rel_list < <(cd "$SAVE_DIR" && find . -type f \( -name 'naija-*' -o -path './naija-*/*' \) \
    -print | sed 's|^\./||' | sort)
  if [ "${#rel_list[@]}" -eq 0 ]; then
    note "  No naija-* files exist yet, so there is nothing to back up."
    return 0
  fi
  local rel
  for rel in "${rel_list[@]}"; do
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")" || return 1
    cp -p "$SAVE_DIR/$rel" "$BACKUP_DIR/$rel" || return 1
  done
  (cd "$SAVE_DIR" && sha256sum -- "${rel_list[@]}") > "$BACKUP_DIR/manifest.sha256" || return 1
  note "  ${#rel_list[@]} file(s) copied to: $BACKUP_DIR"
  note "  Their SHA-256 values are in: $BACKUP_DIR/manifest.sha256"
  note "  The originals are not moved or deleted by this script."
  note "  To restore one by hand: cp -p \"$BACKUP_DIR/<name>\" \"$SAVE_DIR/<name>\""
  note ""
  return 0
}

if protect_saves; then
  result_pass "save protection: backup written before any Godot test"
else
  result_fail "save protection: could not back up the local saves, so no Godot test was run"
  note ""
  note "SUMMARY: $PASS passed, $FAIL failed, $SKIP skipped (logs in $WORK_DIR)"
  exit 1
fi

verify_saves() {
  [ -s "$BACKUP_DIR/manifest.sha256" ] || return 0
  if (cd "$SAVE_DIR" && sha256sum -c --quiet "$BACKUP_DIR/manifest.sha256") > "$WORK_DIR/save-check.log" 2>&1; then
    result_pass "save check: the local naija-* saves are unchanged after the run"
  else
    result_fail "save check: a local naija-* save changed or disappeared during the run. Restore it from $BACKUP_DIR (details in $WORK_DIR/save-check.log)"
  fi
}

# ---- 4. Headless scripts that need no server ----
run_headless() {
  local name="$1"; shift
  local log="$WORK_DIR/$name.log"
  (cd "$REPO" && timeout 900 "$GODOT_BIN" --headless --path game "$@") > "$log" 2>&1
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    result_fail "$name (exit $rc)" "$log"
  elif grep -qE 'SCRIPT ERROR|Parse Error|Compile Error' "$log"; then
    result_fail "$name (exit 0, but its log has a script error)" "$log"
  else
    result_pass "$name"
  fi
}
for test in "${HEADLESS_TESTS[@]}"; do
  run_headless "$test" --script "res://tests/$test.gd"
done
run_headless "save_restart_write" --script "res://tests/save_restart.gd" -- write
run_headless "save_restart_read" --script "res://tests/save_restart.gd" -- read

# ---- 5. Server-backed UI phases (each optional phase on its own fresh copy of the fixture) ----
if [ -z "${FIXTURE_WORLD:-}" ] && [ -z "${SESSIONS:-}" ]; then
  result_skip "server-backed UI phases" "FIXTURE_WORLD and SESSIONS are not set"
elif [ -z "${FIXTURE_WORLD:-}" ] || [ -z "${SESSIONS:-}" ]; then
  result_fail "server-backed UI phases: set both FIXTURE_WORLD and SESSIONS, or neither"
elif [ ! -f "$FIXTURE_WORLD" ] || [ ! -f "$SESSIONS" ]; then
  result_fail "server-backed UI phases: FIXTURE_WORLD or SESSIONS is not a file"
else
  FIXTURE_WORLD="$(readlink -f "$FIXTURE_WORLD")"
  SESSIONS="$(readlink -f "$SESSIONS")"
  ui_run() {
    local name="$1"; shift
    local dir="$WORK_DIR/ui-$name"
    local log="$WORK_DIR/ui-$name.log"
    mkdir -p "$dir"
    if GODOT_BIN="$GODOT_BIN" FIXTURE_WORLD="$FIXTURE_WORLD" SESSIONS="$SESSIONS" PORT="$PORT" \
      WORK_DIR="$dir" bash "$REPO/tools/business-fixture/run-business-ui.sh" "$@" > "$log" 2>&1; then
      result_pass "UI phases: $name"
    else
      result_fail "UI phases: $name" "$log"
    fi
  }
  ui_run default
  ui_run career_rate_limit career_rate_limit
  ui_run lifecycle lifecycle
  ui_run rate_limit rate_limit
  ui_run remaining remaining
fi

# ---- 6. Save check ----
verify_saves

note ""
note "SUMMARY: $PASS passed, $FAIL failed, $SKIP skipped (logs in $WORK_DIR)"
if [ "$FAIL" -gt 0 ]; then
  note "Failed: ${FAILED_NAMES[*]}"
  exit 1
fi
if [ "$SKIP" -gt 0 ]; then
  note "Incomplete: $SKIP check(s) were skipped. This is not a full pass."
  exit 2
fi
exit 0
