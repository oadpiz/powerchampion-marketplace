#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PY:-.venv-portal/bin/python}"
docker compose -p "pcportal-test-$$" -f server/docker-compose.test.yml up -d --wait
trap 'docker compose -p "pcportal-test-$$" -f server/docker-compose.test.yml down -v >/dev/null 2>&1 || true' EXIT
export PC_PORTAL_TEST_DATABASE_URL="postgresql://portal:portal-test@127.0.0.1:54329/portal_test"
"$PY" -m unittest discover -s server -t . -p 'test_*.py' "$@"
