# Persistent Agent Tasks Implementation Plan

> **For agentic workers:** Use subagent-driven implementation with bounded file ownership and independent review. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver persistent multi-step Agent tasks with tools, approvals, steering and downloadable artifacts.

**Architecture:** Extend the existing private portal with a durable SQLite task repository, leased background engine and bounded tool registry. Use an authenticated task console through the existing same-origin BFF. Integrate encrypted per-task customer keys and explicit runtime enablement.

**Tech Stack:** Python FastAPI/SQLite/httpx/cryptography; React TypeScript/Vinext; standard-library DOCX packaging and HTTPS transport.

**Spec:** `docs/superpowers/specs/2026-09-22-agent-runtime.md`

## Global Constraints

- Preserve deployed checkout90a37ba and public brand homepage; no deployment or paid model requests.
- English/Traditional Chinese task interface; protected tasks are noindex and absent from public sitemap.
- Secrets are encrypted with explicit server key, never logged/returned, and cleared at terminal status.
- Independent agents own separate files and coordinate interface changes through this spec.

## Review Focus

- Cross-account task/approval/artifact access must return404 without disclosing another owner's data.
- Cancellation, pause, steering and stale worker completion must not lose instructions or revive terminal work.
- Browser refresh and process interruption must preserve checkpoints and never automatically repeat an uncertain charge.
- Malicious tool arguments/URL redirects/HTML/prompt text must not reach internal services or execute code.
- Empty/invalid provider replies, missing credentials, context limits and budget exhaustion must show honest actionable status.

### Task1: Durable repository
Files: `server/runtime_store.py`, `server/test_runtime_store.py`.
Consumes existing Store.connect(); produces exact repository contract in spec.
- [x] Test ownership, transitions, lease fencing, budget reservation, restart recovery, artifact idempotency and approval exactness.
- [x] Implement schema and short atomic transactions; never perform network requests under SQLite locks.
- [x] Run `python3 -m unittest server.test_runtime_store`; inspect schema/API output for secret leakage.

### Task2: Tools and artifacts
Files: `server/runtime_tools.py`, `server/test_runtime_tools.py`.
Consumes context references; produces bounded JSON tool results and optional artifact/plan.
- [x] Test malformed schemas, CSV grouping/numeric values, valid Unicode DOCX, filenames and content limits.
- [x] Test URL literal/redirect/DNS rebinding protections with injected network seams, no external requests.
- [x] Implement definitions and tool registry; unknown tools fail closed.
- [x] Run `python3 -m unittest server.test_runtime_tools`.

### Task3: Background engine
Files: `server/runtime_engine.py`, `server/test_runtime_engine.py`.
Consumes repository and tools contracts; produces tick()/serve() and injected OpenAI tool loop.
- [x] Test multi-tool flow, plan→reference→analysis→artifact, approval pause/reject/resume, user steering, model failures and cancellation.
- [x] Implement bounded provider transport, lease renewal, fenced checkpoints and secret scrubbing.
- [x] Run engine tests using scripted model transport, not paid inference.

### Task4: Task console
Files: `app/tasks/page.tsx`, `components/task-console.tsx`, `app/tasks.css`, `lib/runtime-client.ts`, `tests/task-console.test.tsx`.
Consumes HTTP schemas in spec; produces authenticated task creation/detail/history/control/download interface.
- [x] Cover loading/auth/unconfigured states, creation clearing API key, polling without duplicate submissions, approval decisions and owner-safe artifact downloads.
- [x] Build responsive graphite/champagne page with run list, visible progress, plan and event timeline, references and deliverables, concise English/Traditional Chinese labels.
- [x] Run focused unit tests, lint and type checking.

### Task5: Integration and verification (root)
Files: `server/runtime_api.py`, `server/settings.py`, `server/app.py`, BFF portal route, layout/metadata/navigation, runtime API tests and ops docs.
- [x] Integrate exact-origin authenticated routes, encrypted credential lifecycle and opt-in startup worker.
- [x] Extend BFF allowlist only for documented runtime routes, preserve limits and no-store behavior.
- [x] Add task entrypoints and protected metadata without changing homepage into an AI workspace.
- [x] Verify baseline and new suites, TypeScript, lint, production build/SSR; independently review authorization/SSRF/lease/credential boundaries.
- [x] Exercise full multi-step flow and mobile UI against a temporary account with injected model transport; document exactly what was and was not verified.
