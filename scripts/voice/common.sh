# Shared by run-local.sh and stop-local.sh (sourced, not run). Sets W, S, ports and the .dev.vars marker.
#
# W  the repository root (two levels above this file)
# S  the run directory for the database, PIDs, logs, cookie jars and the smoke report:
#    $VOICE_SMOKE_DIR, else $TMPDIR/pc-voice-smoke (else /tmp/pc-voice-smoke). It must be outside the repository.
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
T="${TMPDIR:-/tmp}"
S="${VOICE_SMOKE_DIR:-${T%/}/pc-voice-smoke}"
S="${S%/}"
BACKEND_PORT="${VOICE_SMOKE_BACKEND_PORT:-3910}"
FRONTEND_PORT="${VOICE_SMOKE_FRONTEND_PORT:-3911}"
MARKER="# written by scripts/voice/run-local.sh"

voice_smoke_inside() {
  case "$S/" in
    "$W/"*) echo "VOICE_SMOKE_DIR ($S) is inside the repository; use a directory outside it" >&2; exit 2 ;;
  esac
}
voice_smoke_dir() {  # refuse a directory inside the repository (checked before and after creating it), then create it
  case "$S" in /*) ;; *) S="$PWD/$S" ;; esac
  voice_smoke_inside
  mkdir -p "$S"
  S="$(cd "$S" && pwd -P)"
  voice_smoke_inside
}
