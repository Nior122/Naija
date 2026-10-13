#!/bin/bash
# Stage 44: runs the business lifecycle UI phases in Godot (headless, simulated input) against an
# ISOLATED copy of a world file.
#
# The world file is copied to WORK_DIR, and a server is started on PORT with DATA_FILE pointing at the
# copy, so FIXTURE_WORLD is never written. The session tokens in SESSIONS are written to 0600 configs
# under WORK_DIR and are never printed. The server is stopped at the end.
#
# Required environment:
#   GODOT_BIN       a Godot 4.7 binary (for example, a build of the 4.7.2-stable source)
#   FIXTURE_WORLD   a funded world file (see tools/business-fixture/provision.mjs)
#   SESSIONS        the sessions file for that world (roles owner, buyer, candidate, stranger)
# Optional:
#   PORT            the isolated server's port (default 3200)
#   WORK_DIR        where the copy, configs, state, and logs go (default /tmp/naija-business-ui)
#
# Usage: run-business-ui.sh [phase ...]     (default: every phase, in order)
# Phases: owner_ops buyer_ops staff_view stranger_view owner_finish new_owner_view
# Optional, run on their own (each expects the funded owner at the start of the world):
#   lifecycle   business_lifecycle_ui_headless (create, goods listing, restock, refused close)
#   rate_limit  business_rate_limit_ui_headless (a create refused by the command limit)
#   remaining   business_remaining_ui_headless (price, listing on/off, branch limit, transfer refusals,
#               close refused while holding money, withdraw, close, late branch on a closed business)
#
# Each phase is one Godot process under the session of the role it plays. A failing phase does not
# stop the later ones, but the exit code is non-zero if any phase fails.
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-3200}"
WORK_DIR="${WORK_DIR:-/tmp/naija-business-ui}"

if [ -z "${GODOT_BIN:-}" ] || [ ! -x "$GODOT_BIN" ]; then echo "GODOT_BIN is not an executable"; exit 3; fi
if [ -z "${FIXTURE_WORLD:-}" ] || [ ! -f "$FIXTURE_WORLD" ]; then echo "FIXTURE_WORLD is not a file"; exit 3; fi
if [ -z "${SESSIONS:-}" ] || [ ! -f "$SESSIONS" ]; then echo "SESSIONS is not a file"; exit 3; fi

mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"

# Stops any server this script started on PORT (matched by its environment, never by name alone).
stop_server() {
  for pid in $(pgrep -f "services/world-api/dist/index.js" 2>/dev/null); do
    if tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -qx "PORT=$PORT"; then
      kill -TERM "$pid" 2>/dev/null
    fi
  done
  for _ in $(seq 1 20); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "port $PORT is already in use; set PORT to a free port"
  exit 4
fi

if [ ! -f "$REPO/services/world-api/dist/index.js" ]; then
  (cd "$REPO/services/world-api" && npm run build > "$WORK_DIR/build.log" 2>&1) || { echo "BUILD FAILED"; exit 4; }
fi

cp "$FIXTURE_WORLD" "$WORK_DIR/world.json"
STATE="$WORK_DIR/ops_state.json"
rm -f "$STATE"

(cd "$REPO" && NAIJA_ENV=development PERSISTENCE_BACKEND=file DATA_FILE="$WORK_DIR/world.json" \
  PORT="$PORT" setsid node services/world-api/dist/index.js > "$WORK_DIR/server.log" 2>&1 < /dev/null &)
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then break; fi
  sleep 0.5
done
if ! (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then echo "the server did not start (see $WORK_DIR/server.log)"; exit 4; fi
trap 'stop_server' EXIT

# Role configs: the tokens go into 0600 files, and are not printed.
SESSIONS="$SESSIONS" WORK_DIR="$WORK_DIR" node -e '
const fs = require("fs");
const roles = JSON.parse(fs.readFileSync(process.env.SESSIONS, "utf8"));
for (const role of ["owner", "buyer", "candidate", "stranger"]) {
  if (!roles[role]) { console.error("missing role " + role); process.exit(1); }
  const cfg = "[multiplayer]\n\nsession_token=\"" + roles[role].sessionToken + "\"\ncreation_key=\"\"\nidentity_issued=true\n";
  fs.writeFileSync(process.env.WORK_DIR + "/" + role + ".cfg", cfg, { mode: 0o600 });
}
console.log("role session configs written (tokens not shown)");
' || exit 4

export NAIJA_WS_URL="ws://127.0.0.1:$PORT/ws"
export NAIJA_UI_STATE_PATH="$STATE"
export NAIJA_UI_CANDIDATE_ID="$(node -e 'console.log(require(process.argv[1]).candidate.characterId)' "$SESSIONS")"
export NAIJA_UI_OWNER_ID="$(node -e 'console.log(require(process.argv[1]).owner.characterId)' "$SESSIONS")"
export NAIJA_UI_STRANGER_ID="$(node -e 'console.log(require(process.argv[1]).stranger.characterId)' "$SESSIONS")"

PHASES=("$@")
if [ ${#PHASES[@]} -eq 0 ]; then
  PHASES=(owner_ops buyer_ops staff_view stranger_view owner_finish new_owner_view)
fi

OVERALL=0
for phase in "${PHASES[@]}"; do
  KIND=""
  case "$phase" in
    owner_ops)      ROLE=owner;     TEST=business_owner_ops_ui_headless ;;
    buyer_ops)      ROLE=buyer;     TEST=business_buyer_ui_headless ;;
    staff_view)     ROLE=candidate; TEST=business_view_ui_headless; KIND=staff ;;
    stranger_view)  ROLE=stranger;  TEST=business_view_ui_headless; KIND=stranger ;;
    owner_finish)   ROLE=owner;     TEST=business_owner_finish_ui_headless ;;
    new_owner_view) ROLE=stranger;  TEST=business_view_ui_headless; KIND=new_owner ;;
    lifecycle)      ROLE=owner;     TEST=business_lifecycle_ui_headless ;;
    rate_limit)     ROLE=owner;     TEST=business_rate_limit_ui_headless ;;
    remaining)      ROLE=owner;     TEST=business_remaining_ui_headless ;;
    *) echo "unknown phase $phase"; OVERALL=2; continue ;;
  esac
  NAIJA_UI_VIEW_KIND="$KIND" NAIJA_MULTIPLAYER_SESSION_PATH="$WORK_DIR/$ROLE.cfg" \
    timeout 600 "$GODOT_BIN" --headless --path "$REPO/game" \
    --script "res://tests/$TEST.gd" > "$WORK_DIR/phase_$phase.log" 2>&1
  RC=$?
  echo "phase $phase ($ROLE, $TEST${KIND:+, $KIND}): exit=$RC"
  grep -E "^PASS:|^FAIL:|CHECK FAILED|SCRIPT ERROR" "$WORK_DIR/phase_$phase.log" | head -20
  [ $RC -ne 0 ] && OVERALL=1
done

echo "OVERALL=$OVERALL (logs in $WORK_DIR)"
exit $OVERALL
