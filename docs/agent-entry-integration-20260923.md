# Agent creation to task execution — 23 September 2026

Implemented in `codex/agent-runtime-20260922`, on top of `ce57dd9`. This update
connects the existing task runtime to the Agent builder and product navigation.
It does not deploy or enable production execution.

## User flow

- Saved agents have a direct **Run task** link. Saving/opening an agent also
  shows its saved version and a handoff into the task console. Only the agent ID
  is included in the link, never a token, model key or instructions.
- `/tasks?agent=<id>` opens a new task with that account-owned agent selected,
  retaining task history. A missing agent requires an explicit replacement;
  it is never silently replaced with the general agent.
- Sign-in and registration preserve the Agent/task destination. Return routes
  are narrowly allowlisted, including known builder templates and valid IDs.
- Three task starters cover CSV analysis, proposal comparison and project
  handover. They fill editable instructions and reveal the reference editor;
  they do not fabricate source data, change budgets or submit a task.
- The platform overview and Agent gallery expose the builder and task console.
  Chat endpoints and background tasks are described according to their actual
  capabilities. Deployment availability is checked by the task console.
- English and Traditional Chinese are supported throughout the added flow.
  Motion hover/tap feedback respects reduced motion and document visibility.

Existing execution features remain: persistent plans/activity, source references,
bounded model steps, pause/resume/cancel, steering, per-URL read approval and
TXT/Markdown/CSV/JSON/DOCX deliverables. Runtime and transport code are unchanged.

## Fresh verification

- ESLint, TypeScript (`--incremental false`) and `git diff --check`: passed.
- Frontend: **378 tests / 41 files**, production build and **20 SSR tests** passed.
- Backend: **152 tests** passed, including the **84 runtime tests** independently
  checked by the backend audit. These use injected transports and local data.
- Browser against the real local portal: registered a temporary verification
  account, saved an agent through the builder, followed its task link and
  confirmed the correct agent was selected. Runtime configuration reports
  enabled/available locally.
- Clicking a starter left the actual account task count at zero; the API-key
  field stayed empty and browser storage contained only the language setting.
- Browser widths **320 / 390 / 768 / 1440**: English and Traditional Chinese
  have no horizontal overflow with references expanded. Agent selection remains
  intact across the language changes.
- Motion hover changed the card transform in the browser; switching the OS
  reduced-motion preference reset it to `none`.
- Independent integration review found a copy mismatch implying a tool picker.
  This was corrected to goal/execution limits and built-in tools. No other
  blocking finding was reported.

Local screenshots and machine-readable observations are ignored artifacts in
`outputs/agent-integration/`. The public brand homepage remains a brand page.

## Remaining production boundary

No paid inference or real external tool read was performed in this update.
Live gateway tool-calling compatibility still needs a real-key test with a small
explicit budget. Production also needs `PC_RUNTIME_ENABLED=1` and a persistent
valid `PC_RUNTIME_ENCRYPTION_KEY`; the defaults keep execution disabled.
Users need an existing gateway model key. Self-service key issuance remains
disabled. A successful build or Git commit is not a production deployment.
