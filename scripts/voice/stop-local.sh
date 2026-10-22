#!/usr/bin/env bash
# Stop what scripts/voice/run-local.sh started: only the PIDs (and their own process groups) in $S/pids/local-*.pid.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -d "$S" ] && S="$(cd "$S" && pwd -P)"

stop_one() {  # stop_one <name> <expected command substring>
  local name=$1 expect=$2 file="$S/pids/local-$1.pid" pid pgid command i
  [ -f "$file" ] || { echo "$name: no pid file"; return 0; }
  pid=$(cat "$file")
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name: pid $pid is not running"; rm -f "$file"; return 0
  fi
  command=$(ps -o command= -p "$pid")
  case "$command" in
    *"$expect"*) ;;
    *) echo "$name: pid $pid is now '$command', not ours; leaving it" >&2; rm -f "$file"; return 1 ;;
  esac
  pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
  if [ "$pgid" = "$pid" ]; then
    kill -TERM -- "-$pid" 2>/dev/null   # the group run-local.sh created for this process (set -m)
  else
    kill -TERM "$pid" 2>/dev/null
  fi
  for ((i = 0; i < 15; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "$name: still running after 15s, sending KILL"
    if [ "$pgid" = "$pid" ]; then kill -KILL -- "-$pid" 2>/dev/null; else kill -KILL "$pid" 2>/dev/null; fi
  fi
  echo "$name: stopped pid $pid"
  rm -f "$file"
}

stop_one frontend "vinext"
stop_one backend "uvicorn server.app:app"
rm -f "$S/pids/local-mode"

if [ -f "$W/.dev.vars" ] && grep -qF "$MARKER" "$W/.dev.vars"; then
  rm -f "$W/.dev.vars"
  echo "removed $W/.dev.vars (ours)"
fi

for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is still listening:"; lsof -nP -iTCP:"$port" -sTCP:LISTEN
  else
    echo "port $port: nothing listening"
  fi
done
