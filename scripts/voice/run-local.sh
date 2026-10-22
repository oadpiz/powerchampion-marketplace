#!/usr/bin/env bash
# Start the portal locally for the phone agent smoke: FastAPI backend + Vinext frontend (BFF), loopback only.
#
#   scripts/voice/run-local.sh [on|off] [--fresh]
#     on       PC_VOICE_ENABLED=1 (default)
#     off      PC_VOICE_ENABLED=0
#     --fresh  delete the smoke database first
#
# Backend  http://127.0.0.1:3910  (uvicorn; PC_PORTAL_DB=$S/db/portal.sqlite3)
# Frontend http://127.0.0.1:3911  (vinext dev; the BFF reaches the backend through .dev.vars PC_PORTAL_ORIGIN)
# $S is $VOICE_SMOKE_DIR or $TMPDIR/pc-voice-smoke, outside the repository (see common.sh). PIDs go to
# $S/pids/local-*.pid; stop with scripts/voice/stop-local.sh, which kills only those PIDs.
# Python: $VOICE_PYTHON (default python3) with server/requirements.txt installed. Node: node_modules in the repository.
# Nothing here talks to production: the gateway origin is https://gateway.invalid, Grafana is off, and the try
# secret, the runtime token and the media secret are test-only values.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
PY="${VOICE_PYTHON:-python3}"

MODE=on
FRESH=0
for arg in "$@"; do
  case "$arg" in
    on) MODE=on ;;
    off) MODE=off ;;
    --fresh) FRESH=1 ;;
    *) echo "usage: scripts/voice/run-local.sh [on|off] [--fresh]" >&2; exit 2 ;;
  esac
done

voice_smoke_dir
mkdir -p "$S/pids" "$S/logs" "$S/db"
for name in backend frontend; do
  if [ -f "$S/pids/local-$name.pid" ] && kill -0 "$(cat "$S/pids/local-$name.pid")" 2>/dev/null; then
    echo "local-$name is already running (pid $(cat "$S/pids/local-$name.pid")); run scripts/voice/stop-local.sh first" >&2
    exit 1
  fi
done
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is already in use:" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
    exit 1
  fi
done
if [ ! -x "$W/node_modules/.bin/vinext" ]; then
  echo "$W/node_modules/.bin/vinext is missing; install the Node dependencies first" >&2
  exit 1
fi

avail_kb=$(df -k "$S" | awk 'NR==2 {print $4}')
if [ "$avail_kb" -lt 1572864 ]; then
  echo "less than 1.5 GB free where $S is; not starting" >&2
  exit 1
fi

if [ "$FRESH" = 1 ]; then
  rm -f "$S/db/portal.sqlite3" "$S/db/portal.sqlite3-wal" "$S/db/portal.sqlite3-shm" "$S/db/smoke-secrets.json"
fi

# The Vinext worker reads PC_PORTAL_ORIGIN from .dev.vars (gitignored). Only write it when it is absent or ours.
if [ -f "$W/.dev.vars" ] && ! grep -qF "$MARKER" "$W/.dev.vars"; then
  echo "$W/.dev.vars exists and was not written by this script; not touching it" >&2
  exit 1
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
export PC_VOICE_TRY_URL=http://127.0.0.1:8097/
# Phase 2: the runtime routes (/api/voice-runtime/*) and content links, with test-only values. Nothing listens on
# 8098; a content link is only signed, never fetched, by the smoke.
export PC_VOICE_RUNTIME_TOKEN=test-only-runtime-token-0000000000
export PC_VOICE_MEDIA_URL=http://127.0.0.1:8098
export PC_VOICE_MEDIA_SECRET=test-only-not-a-secret-0000000000
if [ "$MODE" = on ]; then export PC_VOICE_ENABLED=1; else export PC_VOICE_ENABLED=0; fi

cd "$W"
# Own process groups (set -m) so stop-local.sh can stop vinext's workerd children with the recorded PID.
set -m
"$PY" -m uvicorn server.app:app --host 127.0.0.1 --port "$BACKEND_PORT" >> "$S/logs/backend.log" 2>&1 < /dev/null &
echo $! > "$S/pids/local-backend.pid"
WRANGLER_LOG_PATH=.wrangler/wrangler.log "$W/node_modules/.bin/vinext" dev -H 127.0.0.1 -p "$FRONTEND_PORT" >> "$S/logs/frontend.log" 2>&1 < /dev/null &
echo $! > "$S/pids/local-frontend.pid"
set +m
echo "$MODE" > "$S/pids/local-mode"

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
wait_for backend "http://127.0.0.1:$BACKEND_PORT/api/portal/health" 60
wait_for frontend "http://127.0.0.1:$FRONTEND_PORT/api/portal/session" 180

echo "voice: PC_VOICE_ENABLED=$PC_VOICE_ENABLED; run directory $S"
echo "pids: backend $(cat "$S/pids/local-backend.pid"), frontend $(cat "$S/pids/local-frontend.pid")"
lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN
lsof -nP -iTCP:"$FRONTEND_PORT" -sTCP:LISTEN
