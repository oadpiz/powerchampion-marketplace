# Power Champion marketplace

A bilingual, launch-only Power Champion marketplace for reviewing an
illustrative open-model catalog, indicative rates, public evidence, and future
access paths. It is a local demonstration, not a production service.

## Routes

- `/` — marketplace story and featured models
- `/models` — searchable local model catalog
- `/pricing` — illustrative rates and local planning calculator
- `/infrastructure` — qualified capacity context and release gates
- `/docs` — local quick-start examples
- `/trust` — public trust boundaries and review links
- `/status` — separate website and service-readiness states
- `/company` — cited company and infrastructure context
- `/contact` — local, non-binding deployment review
- `/console` — static demonstration console
- `/faq` — launch-boundary questions and answers
- `/terms` — informational, non-transactional site terms
- `/privacy` — current local-interaction privacy boundary

## Commands

```bash
npm install
npm run dev
npm run test:unit
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
npm test
```

`npm test` runs the unit suite, production build, and rendered-HTML route tests.

All prices, usage, API keys, estimator results, and launch-access interactions
are illustrative. Payment, a live API, accounts, persistence, and production
readiness are not implemented. Current enquiry and planning interactions remain
local to the browser and transmit nothing.

This standalone site is not the existing production homepage and is not deployed
by this project. Any deployment, DNS, or Dokploy change requires a separate
deployment checkpoint after local verification.

## Phone agent local smoke

`scripts/voice/` starts the portal on loopback and runs an end-to-end smoke of the
phone agent (voice phase 1) through the frontend BFF, with the feature switch on
and then off on the same database.

```bash
export VOICE_PYTHON=/path/to/python
export VOICE_SMOKE_DIR=/tmp/pc-voice-smoke
scripts/voice/run-local.sh on --fresh
"$VOICE_PYTHON" scripts/voice/smoke.py on
scripts/voice/stop-local.sh
scripts/voice/run-local.sh off
"$VOICE_PYTHON" scripts/voice/smoke.py off
scripts/voice/stop-local.sh
```

- `VOICE_PYTHON` is a Python with `server/requirements.txt` installed (default
  `python3`); the frontend uses this checkout's `node_modules`.
- `VOICE_SMOKE_DIR` (default `$TMPDIR/pc-voice-smoke`) holds the SQLite database,
  PID files, logs, cookie jars and `smoke-report.md`. It must be outside the
  repository; both scripts refuse a directory inside it.
- The backend listens on 127.0.0.1:3910 and the frontend on 127.0.0.1:3911
  (`VOICE_SMOKE_BACKEND_PORT`, `VOICE_SMOKE_FRONTEND_PORT`). `run-local.sh` writes
  `.dev.vars` (gitignored) only when it is absent or its own, and `stop-local.sh`
  removes it and stops only the PIDs `run-local.sh` recorded.
- Nothing reaches production: the gateway origin is `https://gateway.invalid`,
  Grafana is off, and the try-ticket secret is a test-only value. Account
  passwords are generated per run, kept in `db/smoke-secrets.json` (mode 0600)
  inside the run directory, and redacted from the report together with tickets.
- `smoke.py` exits 0 only when every check passes, and prints the failed ones.

## Dependency audit status

As of 2026-08-11, the full `npm audit` reports 17 findings (2 low, 2 moderate,
13 high), all confined to the development-tooling dependency graph. The
production dependency audit (`npm audit --omit=dev`) is clean. The outstanding
Vinext and transitive image-parser (`image-size`) advisories must be resolved
before this prototype receives any network exposure. Do not use a destructive
automated audit fix to prepare this local showcase.
