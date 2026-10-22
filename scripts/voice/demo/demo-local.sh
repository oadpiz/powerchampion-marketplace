#!/usr/bin/env bash
# One-command local demo of the phone agent portal (merchant pages + operator pages), loopback only.
#
#   scripts/voice/demo/demo-local.sh start    start backend + frontend + the try-page stand-in, seed the demo data, print URLs
#   scripts/voice/demo/demo-local.sh stop     stop only the processes this demo started (recorded PIDs), free the ports
#   scripts/voice/demo/demo-local.sh reset    stop, delete the demo database and credentials, start and seed again
#   scripts/voice/demo/demo-local.sh status   show whether the demo is running
#
# Ports: backend 3920, frontend 3921, try-page stand-in 3922 (VOICE_DEMO_BACKEND_PORT / _FRONTEND_PORT / _TRY_PORT);
# the smoke (scripts/voice/run-local.sh) uses 3910/3911/8097, so both can run side by side.
# Run directory (database, PIDs, logs): $VOICE_DEMO_DIR, else $TMPDIR/pc-voice-demo. It must be outside the repository.
# The sign-in accounts and their passwords are written only to $VOICE_DEMO_CREDENTIALS (default
# $VOICE_DEMO_DIR/demo-credentials.txt, mode 600); this script never prints a password.
# Python: $VOICE_PYTHON, else the shared venv next to the worktrees (.worktrees/.venv-voice-p1), else python3.
# Node: node_modules in the repository (vinext).
#
# Services start the way scripts/voice/run-local.sh starts them (same environment, test-only secrets, PID files and
# .dev.vars marker, so scripts/voice/stop-local.sh understands them), with one difference: PC_VOICE_TRY_URL points
# at try_stub.py on 3922, so the "試打一通" button opens a page that explains there is no voice host here, not a dead
# one. If run-local.sh changes its environment, change start_services below to match.
#
# Nothing here talks to production: the gateway origin is https://gateway.invalid, Grafana is off, and the secrets
# are test-only values. The data is fake. AI answering stays off for both stores (Q12).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
W="$(cd "$HERE/../../.." && pwd -P)"
STOP_LOCAL="$W/scripts/voice/stop-local.sh"

# Hand common.sh (run-local.sh's shared settings) our run directory and ports; it validates the directory.
T="${TMPDIR:-/tmp}"
export VOICE_SMOKE_DIR="${VOICE_DEMO_DIR:-${T%/}/pc-voice-demo}"
export VOICE_SMOKE_BACKEND_PORT="${VOICE_DEMO_BACKEND_PORT:-3920}"
export VOICE_SMOKE_FRONTEND_PORT="${VOICE_DEMO_FRONTEND_PORT:-3921}"
. "$W/scripts/voice/common.sh"
voice_smoke_dir
TRY_PORT="${VOICE_DEMO_TRY_PORT:-3922}"
CREDENTIALS="${VOICE_DEMO_CREDENTIALS:-$S/demo-credentials.txt}"

if [ -n "${VOICE_PYTHON:-}" ]; then
  PY="$VOICE_PYTHON"
elif [ -x "$W/../.venv-voice-p1/bin/python" ]; then
  PY="$(cd "$W/.." && pwd -P)/.venv-voice-p1/bin/python"
else
  PY=python3
fi

export VOICE_PYTHON="$PY"
export VOICE_DEMO_DIR="$S"
export VOICE_DEMO_CREDENTIALS="$CREDENTIALS"
export VOICE_DEMO_FRONTEND_PORT="$FRONTEND_PORT"
export VOICE_DEMO_BACKEND_PORT="$BACKEND_PORT"

usage() { echo "usage: scripts/voice/demo/demo-local.sh start|stop|reset|status" >&2; exit 2; }

wait_for() {  # wait_for <name> <url> <seconds>
  local name=$1 url=$2 limit=$3 i code
  for ((i = 0; i < limit; i++)); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)
    if [ "$code" != "000" ]; then echo "$name ready: $url -> $code"; return 0; fi
    if ! kill -0 "$(cat "$S/pids/local-$name.pid")" 2>/dev/null; then
      echo "$name exited; last log lines:" >&2; tail -20 "$S/logs/$name.log" >&2; return 1
    fi
    sleep 1
  done
  echo "$name did not answer in ${limit}s; last log lines:" >&2; tail -20 "$S/logs/$name.log" >&2
  return 1
}

start_services() {
  mkdir -p "$S/pids" "$S/logs" "$S/db"
  local name
  for name in backend frontend trystub; do
    if [ -f "$S/pids/local-$name.pid" ] && kill -0 "$(cat "$S/pids/local-$name.pid")" 2>/dev/null; then
      echo "local-$name is already running (pid $(cat "$S/pids/local-$name.pid")); run demo-local.sh stop first" >&2
      return 1
    fi
  done
  local port
  for port in "$BACKEND_PORT" "$FRONTEND_PORT" "$TRY_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port $port is already in use:" >&2
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
      return 1
    fi
  done
  if [ ! -x "$W/node_modules/.bin/vinext" ]; then
    echo "$W/node_modules/.bin/vinext is missing; install the Node dependencies first" >&2
    return 1
  fi
  local avail_kb
  avail_kb=$(df -k "$S" | awk 'NR==2 {print $4}')
  if [ "$avail_kb" -lt 3145728 ]; then
    echo "less than 3 GB free where $S is; not starting" >&2
    return 1
  fi
  if [ -f "$W/.dev.vars" ] && ! grep -qF "$MARKER" "$W/.dev.vars"; then
    echo "$W/.dev.vars exists and was not written by the voice scripts; not touching it" >&2
    return 1
  fi
  printf '%s\nPC_PORTAL_ORIGIN=http://127.0.0.1:%s\n' "$MARKER" "$BACKEND_PORT" > "$W/.dev.vars"

  export PC_PORTAL_DB="$S/db/portal.sqlite3"
  export PC_PORTAL_ALLOWED_ORIGINS="http://127.0.0.1:$FRONTEND_PORT,http://localhost:$FRONTEND_PORT"
  export PC_PORTAL_SECURE_COOKIES=0
  export PC_GATEWAY_ORIGIN=https://gateway.invalid
  export PC_GATEWAY_ADMIN_TOKEN=
  export PC_GRAFANA_URL=
  export PC_RUNTIME_ENABLED=0
  export PC_TRIAL_ENABLED=0
  export PC_VOICE_TRY_SECRET=test-only-not-a-secret-0000000000
  export PC_VOICE_TRY_URL="http://127.0.0.1:$TRY_PORT/"
  export PC_VOICE_RUNTIME_TOKEN=test-only-runtime-token-0000000000
  export PC_VOICE_MEDIA_URL=http://127.0.0.1:8098
  export PC_VOICE_MEDIA_SECRET=test-only-not-a-secret-0000000000
  export PC_VOICE_ENABLED=1

  cd "$W"
  # Own process groups (set -m) so stop can stop vinext's workerd children with the recorded PID.
  set -m
  "$PY" "$HERE/try_stub.py" "$TRY_PORT" >> "$S/logs/trystub.log" 2>&1 < /dev/null &
  echo $! > "$S/pids/local-trystub.pid"
  "$PY" -m uvicorn server.app:app --host 127.0.0.1 --port "$BACKEND_PORT" >> "$S/logs/backend.log" 2>&1 < /dev/null &
  echo $! > "$S/pids/local-backend.pid"
  WRANGLER_LOG_PATH=.wrangler/wrangler.log "$W/node_modules/.bin/vinext" dev -H 127.0.0.1 -p "$FRONTEND_PORT" >> "$S/logs/frontend.log" 2>&1 < /dev/null &
  echo $! > "$S/pids/local-frontend.pid"
  set +m
  echo on > "$S/pids/local-mode"

  wait_for backend "http://127.0.0.1:$BACKEND_PORT/api/portal/health" 60
  wait_for frontend "http://127.0.0.1:$FRONTEND_PORT/api/portal/session" 180
  echo "pids: backend $(cat "$S/pids/local-backend.pid"), frontend $(cat "$S/pids/local-frontend.pid"), try stand-in $(cat "$S/pids/local-trystub.pid")"
}

stop_stub() {  # same care as stop-local.sh: only the recorded PID, only if it still is our script
  local file="$S/pids/local-trystub.pid" pid command
  [ -f "$file" ] || { echo "trystub: no pid file"; return 0; }
  pid=$(cat "$file")
  if ! kill -0 "$pid" 2>/dev/null; then echo "trystub: pid $pid is not running"; rm -f "$file"; return 0; fi
  command=$(ps -o command= -p "$pid")
  case "$command" in
    *try_stub.py*) ;;
    *) echo "trystub: pid $pid is now '$command', not ours; leaving it" >&2; rm -f "$file"; return 1 ;;
  esac
  kill -TERM "$pid" 2>/dev/null || true
  local i
  for ((i = 0; i < 10; i++)); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  echo "trystub: stopped pid $pid"
  rm -f "$file"
}

do_start() {
  local began=$SECONDS
  chmod 700 "$S"
  start_services
  "$PY" "$HERE/seed_demo.py"
  echo
  echo "Demo ready in $((SECONDS - began)) s."
  echo "  Open     http://127.0.0.1:$FRONTEND_PORT/login"
  echo "  Accounts $CREDENTIALS  (mode 600; the three sign-ins are in it)"
  echo "  Script   portal-demo-walkthrough.md (3-minute screen-share script)"
  echo "  Stop     scripts/voice/demo/demo-local.sh stop"
}

do_stop() {
  "$STOP_LOCAL" || true
  stop_stub || true
  local port
  for port in "$TRY_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port $port is still listening:"; lsof -nP -iTCP:"$port" -sTCP:LISTEN
    else
      echo "port $port: nothing listening"
    fi
  done
}

do_reset() {
  do_stop
  rm -f "$S/db/portal.sqlite3" "$S/db/portal.sqlite3-wal" "$S/db/portal.sqlite3-shm" "$S/db/smoke-secrets.json" "$CREDENTIALS"
  echo "demo database and credentials deleted"
  do_start
}

do_status() {
  local name pid
  for name in backend frontend trystub; do
    pid=""
    [ -f "$S/pids/local-$name.pid" ] && pid="$(cat "$S/pids/local-$name.pid")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$name: running (pid $pid)"; else echo "$name: not running"; fi
  done
  lsof -nP -iTCP:"$BACKEND_PORT" -iTCP:"$FRONTEND_PORT" -iTCP:"$TRY_PORT" -sTCP:LISTEN 2>/dev/null || true
}

[ $# -eq 1 ] || usage
case "$1" in
  start) do_start ;;
  stop) do_stop ;;
  reset) do_reset ;;
  status) do_status ;;
  *) usage ;;
esac
