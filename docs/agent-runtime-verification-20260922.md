# Persistent Agent tasks — verification, 22 September 2026

Implemented in isolated branch `codex/agent-runtime-20260922`, based on deployed
commit `90a37baa36aeaaf7213aeeaa1cd3491789359ac9`. No production push or deployment.
The public brand homepage is unchanged. Tasks live at `/tasks` behind account
sessions and same-origin API boundaries; the page is noindex and excluded from
public analytics and the sitemap.

## Delivered

- Durable task plans, events, references, usage and downloadable artifacts.
- Background workers independent of browser connections; fenced leases and
  explicit recovery after uncertain interruption.
- Persistent model-step budgets, bounded responses, cooperative pause/cancel,
  queued steering, and approvals bound to each exact external URL.
- Actual reference reading, grouped CSV analysis, safe HTTPS fetching and
  TXT/Markdown/CSV/JSON/DOCX creation.
- Encrypted per-task customer model keys, credential clearing on terminal
  states, account ownership checks, and bounded stored/API payload sizes.
- Responsive English/Traditional Chinese UI, account/agent navigation,
  configuration guidance and data-handling notice.

## Verification

- Frontend: 340 tests across 36 files passed.
- Python: 152 tests passed using temporary databases and injected transports.
- ESLint and TypeScript passed; production build completed.
- Server rendering: 20 tests passed, including the private Tasks shell.
- Final whole-branch integration review approved the implementation with no new blocking findings. Three independent scoped reviews passed after fixes: repository/ownership,
  HTTPS tools, engine and API lifecycle. Regressions cover escaped-key leakage,
  approval preserving pause, IPv6 site-local SSRF, HTTP framing budgets and
  informational responses, late instructions, immutable agent snapshots,
  worst-case Unicode response sizes, and full-length Chinese references.
- Browser: actual registration, task creation, reference input, CSV tool result,
  steering, exact URL approval, leaving the page and returning to a completed
  task, and DOCX download. Downloaded ZIP/XML parsed successfully and contains
  the Traditional Chinese heading and verified CSV total of 420.
- Browser widths 1280 and 390 pixels have no horizontal overflow; Traditional
  Chinese controls and document language update correctly. No API key is saved
  to browser storage.

Browser model responses and the approved web response were explicitly labelled
scripted verification fixtures. Persistence, account authorization, engine/tool
execution, CSV calculations and DOCX creation were the real implementation.
No paid model call or external web request was made. Live gateway tool-calling
compatibility, model quality, throughput and production deployment remain
unverified. This is not a general browser/VM, external write connector platform,
long-term memory service, or a guarantee of Meta Muse feature parity.

## Local operation

Use the normal private portal and website setup in `server/README.md`. Runtime
execution requires `PC_RUNTIME_ENABLED=1` and a separately generated Fernet key
in `PC_RUNTIME_ENCRYPTION_KEY`. In Vinext's local Worker mode, place the private
portal origin in ignored `.dev.vars` as `PC_PORTAL_ORIGIN=http://127.0.0.1:3032`
when running the portal on that alternate port. Keep real keys out of Git.
A user must supply their own model key and explicitly start a task; doing so can
make multiple paid requests within the selected model-step/output limits.
