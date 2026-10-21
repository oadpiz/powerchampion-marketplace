# Customer portal service

This is an isolated customer/admin backend for the new website. It does not
import, deploy, reconfigure, or write the existing Python/Go inference gateway.
Accounts, sessions, key ownership, credit verification requests and audit events
persist in Postgres (production) or SQLite (development, tests). There are no default users or passwords.

From the marketplace directory:

```sh
python3 -m pip install -r server/requirements.txt
python3 -m uvicorn server.app:app --host 127.0.0.1 --port 3020
```

The website's `/api/portal/*` BFF forwards requests to this loopback service.
Keep the service private: expose the website BFF, not port 3020, to browsers.

Create an administrator with a hidden password prompt:

```sh
python3 -m server.manage create-admin --email you@example.com
```

For unattended local provisioning, supply `PC_PORTAL_ADMIN_PASSWORD` through a
secret manager or secure environment, never a CLI argument or committed file.
An existing customer is not automatically promoted by this command.

In the Dokploy web terminal Python's `getpass` receives empty input, so the
hidden prompt cannot be used there. Drive the command through the environment
variable instead, entering the password with bash `read -s` so it never appears
in history or the process list. Open the Dokploy terminal with **Bash** (the
`/bin/sh` option is dash and has no `read -s`), or wrap the line as `bash -c '…'`:

```sh
read -s PW; PC_PORTAL_ADMIN_PASSWORD="$PW" python -m server.manage create-admin --email you@example.com; unset PW
```

`reset-password` works the same way with `PC_PORTAL_NEW_PASSWORD`. Once an
administrator exists, prefer the admin UI (below) over the CLI for day-to-day
account management; the CLI remains for the first administrator and emergency
recovery.

## Account and admin routes

All under `/api/portal`; mutations require a matching Origin. Errors use
`{"error": "<code>", "detail": "<message>"}`.

| Route | Who | Purpose |
| --- | --- | --- |
| `POST /password` | signed-in user | `{currentPassword, newPassword}`. Keeps the current session, deletes the user's other sessions. Throttled per user (`password:` scope, 5 attempts per 15 minutes, then 429 `rate_limited`); a wrong current password is 400 `invalid_current_password` |
| `GET /admin/customers` | admin | Accounts including admins, each with `role` and `status` (`active` or `disabled`) |
| `POST /admin/customers/{id}/status` | admin | `{action: "disable" \| "enable"}`. Disabling deletes the account's sessions; disabled accounts cannot sign in (403 `account_disabled`) and their agent tokens stop resolving |
| `POST /admin/customers/{id}/role` | admin | `{role: "customer" \| "admin"}` |
| `POST /admin/customers/{id}/reset-password` | admin | `{newPassword}`. Deletes all of the target's sessions and clears their login throttle |

The three `/admin/customers/{id}/*` writes fail with 409 `self_target` when the
target is the calling admin (use `/password` for your own account), 404
`customer_not_found` for an unknown id, and 400 `invalid_input` for a bad body.
Repeating a status or role change that is already in effect is a no-op and
writes no audit event.

Disabling an account revokes every active gateway key it owns: each key is
disabled at the gateway and audited as `key.revoked` (target = local key record
id). If the gateway is unreachable or unconfigured the account is still disabled,
the key stays `active` locally, and `key.revocation_needs_reconciliation` is
audited with the gateway key id. The response carries `keysRevoked` and
`keysFailed`, and the admin UI shows both counts after a disable. To retry, disable
the key on `/admin/keys`; re-running the account disable also retries, but only
through the API, because the admin UI offers only Enable for a disabled account.
Enabling an account does not restore revoked keys, and while the account is
disabled its keys cannot be re-enabled individually either (409 `account_disabled`,
see below).

### Node allocation routes (機台分配)

Admin-only, under `/api/portal/admin/allocation`: `GET` (state), `POST /engineers`,
`POST /engineers/{id}`, `POST /engineers/{id}/status`, `POST /nodes/{name}` (leaving
`selling` needs `confirm_selling_change: true`, else 409 `selling_change_unconfirmed`;
engineer -> selling is 409 `engineer_to_selling`; a reserved node that left an engineer
becomes selling only after an export mark at or after that revision plus
`confirm_node_synced: true`), `POST /owner`, the read-only `GET /export` (JSON with the
`engineers.yaml` text; `?format=yaml` returns the file directly when calling the service
itself) and `POST /export/mark` (`{revision}`, records the export). Every write accepts
`expected_revision` (409 `revision_conflict` on mismatch). Exported text is restricted
so ansible cannot evaluate templates from it. Implemented in
`server/allocation.py`; schema and seed in migration `0003_node_allocation`, which also
adds the nullable `audit_events.details` (JSON old->new). Audit actions: `alloc.*`.
Operations, export rules and rollback: `docs/portal-operations.md` section "機台分配".

### Gateway admin routes (A2b)

All require an administrator and live under `/api/portal`. They return 503
`provider_not_configured` while `PC_GATEWAY_ADMIN_TOKEN` is empty (the key list and
usage reads instead return an empty payload flagged `gatewayConfigured: false` / `source: "unconfigured"`).

| Route | Purpose |
| --- | --- |
| `GET /admin/keys` | Gateway keys (with the owning portal account where known) and the config-defined `envKeys` |
| `POST /admin/customers/{id}/keys` | `{label, prepaidUsd, dailyTokenLimit?, rpm?, maxInflight?}`. `prepaidUsd` must be above 0, at most 100000, with at most two decimals (else 422 `invalid_input`). 201 with the one-time `secret`; a disabled account is 409; a target whose role is not `customer` is 409 `target_not_customer` |
| `POST /admin/keys/{id}/disable` | `{disabled: true \| false}` on a gateway key; `false` re-enables it (audited as `admin.key_enabled`). Re-enabling a key whose local owner is disabled is 409 `account_disabled` ("Enable the account first.") with no gateway call and no audit; keys without a local owner are not checked. Re-enabling an owned, revoked key takes a slot under the same 20-active-key cap as issuing one: a full account is 409 `key_limit`, a key that another request is re-enabling right now is 409 `key_enable_in_progress`, and a key that is already active again returns 200 |
| `POST /admin/keys/{id}/limits` | Change `dailyTokenLimit`, `rpm`, `maxInflight` (at least one) |
| `POST /admin/keys/{id}/balance` | `{addUsd}` or `{setUsd}` (exactly one) |
| `GET /admin/usage?month=YYYY-MM` | Gateway usage report, month defaults to the current UTC month |
| `GET /admin/gateway` | Models and nodes from `/api/state`; any `api_key`, key, token, secret or password string field is stripped server-side |
| `POST /admin/gateway/models/{id}/toggle` | `{enabled: bool}` (else 422). Sets the requested state: reads `/api/state` first (a missing or null flag counts as enabled) and flips only when the state differs; returns `{id, enabled, changed}` and audits only a real flip, with details `{requested, enabled}`. The gateway has only a flip, so a change between the read and the flip is possible; it is reported as 409 `state_changed` (the flip is still audited). 404 `gateway_rejected` when `/api/state` has no such model |
| `POST /admin/gateway/models/{id}/maintenance` | Set or clear the maintenance message (text, at most 300 characters) |
| `POST /admin/gateway/nodes/{name}/ops/{action}` | `action` is one of `start`, `stop`, `restart`, `check`, `backup`, `fw-status` (else 400 `unknown_action`) |
| `GET /admin/gateway/nodes/{name}/jobs/{job_id}` | Poll a node operation |

The customer-facing `POST /keys` creates a post-paid key with no balance and
only when `PC_CUSTOMER_KEY_ISSUANCE=1`. `GET /overview` and `GET /keys` report this
as `keyIssuance` (true only when the gateway is configured and the flag is on);
the customer keys page hides its create form while it is false. Customer revocation
needs only `gatewayConfigured`.

Gateway error codes: 503 `provider_not_configured` (no admin token),
503 `gateway_unavailable` (unreachable or bad response), 503 `gateway_auth_failed`
(the gateway answered 401/403 to the portal's token; the detail is always "The
portal's gateway token was rejected. Check PC_GATEWAY_ADMIN_TOKEN." and no upstream
text is passed on), `gateway_rejected`
(the gateway answered 400, 404 or 409; its detail is passed through), 404
`key_not_found`, 404 `customer_not_found`, 400 `unknown_action`, 409 `key_limit`,
409 `key_enable_in_progress`, 409 `target_not_customer`, 409 `state_changed`, and 422/400
`invalid_input` for bad bodies. Text fields refuse control characters (C0, DEL, C1), bidi
embedding/override/isolate characters and lone surrogates; single-line fields (labels, names, notes)
also refuse the invisible characters U+200B–U+200F, U+2060 and U+061C, while multi-line persona text
(system prompt, examples, try input) allows tab, newline and carriage return. Lengths count code
points, as the admin UI does.

Audit actions written by these routes (actor = caller, target = affected
account; never any password material): `account.password_changed`,
`admin.account_disabled`, `admin.account_enabled`, `admin.role_changed`,
`admin.password_reset`. The CLI writes `account.password_reset_by_operator`.

Audit actions for keys and the gateway (A2b): `admin.key_issued`,
`admin.key_disabled`, `admin.key_enabled`, `admin.key_limits`,
`admin.key_balance`, `admin.model_toggled`, `admin.model_maintenance`,
`admin.node_op` (target `name:action`), `key.created` (customer self-issue),
`key.revoked`, `key.revocation_needs_reconciliation` and
`key.provisioning_needs_reconciliation` (a key was created at the gateway but
could not be recorded or rolled back locally). No event stores a key secret.

### Personas, fleet and redeem routes (A2c)

All require an administrator (customers 403 `admin_required`, anonymous 401 `auth_required`) and live
under `/api/portal`. Gateway errors map as above; the route-specific 404 codes are listed per route.

| Route | Purpose |
| --- | --- |
| `GET /admin/personas` | Persona list (`{gatewayConfigured, personas}`); unconfigured is 200 with `gatewayConfigured: false` |
| `GET /admin/personas/{id}?rev=N` | One persona with its revisions; `rev` 1..10^9. 404 `persona_not_found` |
| `POST /admin/personas` | `{name}` (1–80 characters). 201 `{persona_id}` |
| `POST /admin/personas/{id}/revisions` | `{system, examples, note, activate}`: `system` ≤ 32000 characters, `examples` ≤ 50 `{user, assistant}` pairs of ≤ 4000 each, `note` one line ≤ 200, `activate` **required** bool (the gateway's "omitted = activate now" is not used). Body ≤ 196608 bytes (else 413). Returns `{rev}`. 404 `persona_not_found` |
| `POST /admin/personas/{id}/activate` | `{rev}`. 404 `persona_not_found` |
| `POST /admin/personas/{id}/try` | `{input (≤ 4000), revs (1–2 of null or a rev), maxTokens (1–1024, default 300), temperature (0–2, default 0.8)}`. Calls the model (spends tokens); 90 s adapter timeout, 95 s at the BFF. A try the gateway does not answer in time is 504 `gateway_timeout` (the model may still have run) |
| `GET /admin/gateway/fleet/{model}/status`, `/timeline` | Fleet state and the workflow timeline. 404 `fleet_not_managed` when the model is not `control_managed` |
| `GET /admin/gateway/fleet/events?modelId=&limit=` | Fleet capacity events; `limit` 1..500 (default 100) |
| `POST /admin/gateway/fleet/{model}/{action}` | `action` ∈ `freeze`, `resume`, `candidate`, `drain`, `approve`, `rollback` (else 400 `unknown_action`); no body. freeze/resume return the capacity state; the others return `{job_id, state, phase}`. Conflicts are 409 `gateway_rejected` with the gateway's reason |
| `GET /admin/gateway/control/jobs/{job}` | Poll a fleet workflow job (the only `/api/control` route the portal proxies). 404 `job_not_found` |
| `GET /admin/redeem/codes` | Newest 1000 codes (whitelisted fields only), with `total`, `counts` per status and `truncated` |
| `POST /admin/redeem/codes` | `{amountUsd (> 0, ≤ 1000, two decimals), count (1–500), label (required, ≤ 80), expiresDays? (1–3650), acknowledgeUnconfirmed?}`. 201 with the plaintext codes, once. 409 `redeem_issue_unconfirmed_recent` when the same label (compared after NFKC, case folding and whitespace collapsing) had an unconfirmed issue in the last 30 minutes and `acknowledgeUnconfirmed` is not `true`; an acknowledged issue records `acknowledgedUnconfirmed: true` in its audit details |
| `POST /admin/redeem/codes/{id}/disable` | 404 `redeem_code_not_found` when missing or already disabled |
| `GET /admin/redeem/codes/export` | `{filename, csv, rows}`: the gateway CSV (code hashes, no plaintext), with cells starting `= + - @`, tab or CR prefixed by `'` |

Error codes added in A2c: `persona_not_found`, `fleet_not_managed`, `job_not_found`,
`redeem_code_not_found`, `redeem_issue_unconfirmed_recent`, 504 `gateway_timeout` (persona try only),
plus `state_changed`, `key_limit` and `key_enable_in_progress` above.

Audit actions (A2c; details never contain persona text, try input, a redeem code or a token):
`admin.persona_created` (`{name}`), `admin.persona_revision_saved` (`{rev, activate, systemChars, examples}`),
`admin.persona_activated` (`{rev}`), `admin.persona_try_started` (written **before** the gateway call, so a try
that times out but still spends tokens is recorded) and `admin.persona_tried` (after a success), both
`{revs, inputChars, maxTokens}`; `admin.fleet_frozen`, `admin.fleet_resumed`, `admin.fleet_candidate_requested`,
`admin.fleet_drain_requested`, `admin.fleet_approved`, `admin.fleet_rollback_requested` (target = model;
`{jobId, state, phase}` or `{mode}`); `admin.redeem_codes_issued` (target = label;
`{count, amountUsd, expiresDays, codeIds}`), `admin.redeem_codes_issue_unconfirmed` (target = label;
`{count, amountUsd}`; the gateway did not confirm, so codes may exist that nobody saw),
`admin.redeem_code_disabled` (target = code id), `admin.redeem_codes_exported` (`{rows}`).

Redeem plaintext policy: a code exists in plaintext only in the gateway's issue response, this
service's 201 response and the browser's one-time dialog. It is never written to the database,
the audit log or a log line, and the list and CSV export carry only ids and hashes (tests assert all four).

Size limits: the gateway lists every redeem code in one response, so the portal reads up to 32 MiB
for the redeem list and CSV (about 140k codes; other gateway calls keep 4 MiB), and the BFF passes
an export of up to 6 MiB (roughly 40k codes). Gateway-side pagination is the follow-up.

### Engineers overview (read-only)

`GET /api/portal/admin/engineers` (admin; customers 403, anonymous 401; no write route, reads are not
audited). One row per 機台分配 engineer, joined by username with the gateway's
`GET /api/engineers/activity` (Grafana Viewer token on the gateway side):

- Roster (always present, also when the gateway is down): `id`, `clusterId`, `username`, `displayName`,
  `active`, `keyStatus` (`missing` / `pending` / `synced`), `keyFingerprint`, `keyType`, `grafanaUrl`.
  "synced" only means an export was marked after the last key change; the nodes are not checked.
- Activity: per assigned engineer node `up`, `gpuCount`, `collector` (`ok` ≤ 120 s / `stale` / `failed`),
  `labelEngineer`/`labelMatches` (Prometheus `engineer` label vs. the allocation), the engineer's own
  `gpusInUse`/`processes`/`memoryBytes`, last **interactive** (pty) login and `sessions`; firing alerts
  by username (`reason: "user"`) or by assigned node (`"node"`); the last 10 deploy marks by the
  relay-derived `owner` (`engN` = `clusterId`; the self-declared `user` is shown, never used to match).
- `unmatched`: GPU usage and logins of users/nodes not on the roster (tku, root, `uid_N`), alerts on
  unassigned nodes, deploys whose owner matches no engineer; 50 rows each.
- `activity.status`: the gateway's `ok`, `partial`, `unconfigured` (no Grafana token), `auth_failed`,
  `unavailable`, plus `gateway_unconfigured` (no `PC_GATEWAY_ADMIN_TOKEN`; the gateway is not called),
  `gateway_outdated` (gateway answers 404: not deployed yet) and `gateway_error` (`activity.error` is
  `gateway_auth_failed`, `unavailable`, `invalid_response`, `response_limit`, …). `stale` is true when the
  gateway serves an older snapshot after a failed refresh, or when the data is more than 300 s old.
- Never in the response: command lines, process names, IPs/hosts, SSH key text, email, account, tokens.
  Command history stays on the nodes (`sudo b300-activity`). Every field is copied through an allowlist.

Operator-assisted recovery, after independently verifying the account owner:

```sh
python3 -m server.manage reset-password --email you@example.com
```

This prompts for a new password, or reads `PC_PORTAL_NEW_PASSWORD`, revokes every
existing session for the user, and writes a scrubbed audit event. Self-service
email verification/recovery still requires a mail provider; no email is sent by
this service. Registration establishes a portal account, not verified identity.

## Configuration

| Environment variable | Default / purpose |
| --- | --- |
| `PC_PORTAL_DATABASE_URL` | Postgres DSN, e.g. `postgresql://portal:<password>@powerchampion-db:5432/portal`; takes precedence over `PC_PORTAL_DB`. Schema is managed by Alembic (`server/migrations/`) and applied automatically at startup. Postgres connections use `connect_timeout=5` and `lock_timeout=15s` |
| `PC_PORTAL_DB` | SQLite fallback when `PC_PORTAL_DATABASE_URL` is unset: `.local/portal.sqlite3`; mount a durable volume and back it up |
| `PC_PORTAL_TEST_DATABASE_URL` | Tests only: run the suite against this Postgres instead of temporary SQLite files (see `scripts/test_backend_postgres.sh`) |
| `PC_PORTAL_ALLOWED_ORIGINS` | `http://localhost:3010,https://powerchampion.ai`; exact origins for mutations |
| `PC_PORTAL_SESSION_TTL` | `43200` seconds |
| `PC_PORTAL_SECURE_COOKIES` | `0` locally; **set `1` for HTTPS deployment** |
| `PC_PORTAL_ENV` | Set `production` to enforce secure cookies at startup |
| `PC_GATEWAY_ORIGIN` | `https://b300.powerchampion.ai`; fixed HTTPS origin, server-only |
| `PC_GATEWAY_ADMIN_TOKEN` | The gateway's `SELL_PANEL_ADMIN_TOKEN`, sent as `X-Admin-Token`. Empty means key provisioning, usage and the gateway pages are disconnected |
| `PC_CUSTOMER_KEY_ISSUANCE` | `0`; set `1` to let customers self-issue post-paid keys (balance 0) from `/account/keys`. While `0`, `POST /keys` returns 503 `provider_not_configured` and `/overview`/`/keys` report `keyIssuance: false`. Administrator issuance (always prepaid) is unaffected |
| `PC_GATEWAY_DAILY_TOKEN_LIMIT` | `1000000`, positive daily token quota on newly issued gateway keys |
| `PC_GATEWAY_RPM` | `60`, positive request limit on new keys |
| `PC_GATEWAY_MAX_INFLIGHT` | `2`, positive concurrency limit on new keys |
| `PC_GRAFANA_URL` | `https://grafana.powerchampion.ai`; HTTPS origin of the cluster Grafana for the Engineers page links (`/d/b300-engineers?var-engineer=<username>`). Empty hides the links |
| `PC_RUNTIME_ENABLED` | `0`; opt-in background Agent tasks when set to `1` |
| `PC_RUNTIME_ENCRYPTION_KEY` | Separate Fernet key for per-task model credentials; missing/invalid key leaves tasks unavailable |

There is no direct CORS access. Mutations require a matching Origin. The BFF must
forward only the validated request origin and the `pc_portal_session` cookie;
session cookies are HttpOnly and SameSite=Lax. Passwords use scrypt; opaque
sessions store SHA-256 hashes and enforce expiry server-side. Sessions are
rotated at login. SQLite database files are owner-readable/writable only; the Postgres database is reachable only on the private Compose network.

Login throttles are persisted per normalized account (5 failed attempts per
15 minutes). Registration is throttled per account. The service never trusts
browser-supplied forwarding headers or applies a global quota to the shared
loopback BFF address. A public deployment also needs an edge-level request rate
limit using that edge's trusted client identity to cover distributed signup
abuse; account throttles alone cannot enforce a per-person limit.

## Gateway integration and accounting

The adapter implements the **Python** gateway's actual routes:

- `POST /api/keys`: creates a key with server-controlled quotas; one-time secret
  returned to the customer, only key ID/display prefix persisted locally.
- `POST /api/keys/{id}/disable`: revokes the owned gateway key.
- `GET /api/usage/report?month=YYYY-MM`: obtains a report server-side and returns
  only the current customer's persisted owned key IDs, including revoked keys.

The upstream admin credential is never accepted from a browser, logged, stored
in the database, or returned by any portal endpoint. Upstream redirects are disabled;
responses are size-limited and validated. Legacy keys must be explicitly mapped
before their usage could appear in a customer's account; the portal does not
guess ownership from email or labels.

Administrator pages also use the gateway's `/api/state`, model toggle and
maintenance routes, node ops and jobs, key list/limits/balance routes. The
`/api/state` payload is proxied with `gateway.api_key` and any key, token,
secret or password string fields stripped before it reaches the browser.
Connection steps and the key policy are in `docs/portal-operations.md`
(section "連接閘道（A2b）").

Do not connect this adapter to production without validating the current
gateway implementation and authorization. With no admin token, account
management and credit review work locally; key creation returns an explicit
unconfigured error and usage is labeled unconfigured rather than zero usage.

Credit requests are **manual verification records**. Approving one records the
operator's decision exactly once. `approvedCreditUsd` is the sum of approved
records, not a gateway balance, payment confirmation, or spend limit. The service
does not charge a card, contact a payment processor, redeem a code, apply gateway
credit, or enforce prepaid inference. Approval and rejection are final; repeated
identical reviews are idempotent and conflicting reviews fail.

Admin customer/credit lists return at most 1,000 records; audit returns the most
recent 200. Request reference/note text is never copied into audit fields.
Gateway usage is aggregated per model and contains no prompts or raw responses.

## Validation

```sh
npm run test:backend
scripts/test_backend_postgres.sh
```

`npm run test:backend` runs the suite on temporary SQLite files.
`scripts/test_backend_postgres.sh` runs the same suite on a throwaway
`postgres:16-alpine` started from `server/docker-compose.test.yml`. Tests use temporary databases, fake gateway collaborators and mocked HTTP
transports. They never contact production or create actual customer keys.

## Anonymous chat trial

`/api/portal/trial/config` and `/api/portal/trial/chat` support the website's
separate `/api/chat/config` and `/api/chat` endpoints. Trial chat is disabled by
default. All three operator settings are required to enable it:

| Variable | Meaning |
| --- | --- |
| `PC_TRIAL_ENABLED=1` | Explicit enable switch |
| `PC_TRIAL_API_KEY` | Operator-funded inference key, private to this service |
| `PC_TRIAL_DAILY_REQUEST_LIMIT` | Explicit positive global daily request cap; default `0` keeps trial disabled |
| `PC_TRIAL_SESSION_REQUEST_LIMIT` | Per-session daily cap; default `5` |

No sample or fabricated model answer is returned when trial is unavailable.
Customers may instead connect their own key to `/api/chat`; that path forwards
the key to the fixed gateway for the current request without persistence.

Trial requests use only `glm-5.2-fp8` or `qwen3-vl-30b` at the fixed endpoint
`https://b300.powerchampion.ai/v1/chat/completions`. The trial cap is 512 output
tokens, 24 messages with 8,000 combined history characters, and 16,000 system
instruction characters. BYO-key chat permits 32,000 history characters and
4,096 output tokens. Oversized histories are rejected, not silently truncated.
Both paths reject redirects and use a 45-second deadline including response
reading; client cancellation aborts upstream work where the connection permits.

Before contacting the model, one database transaction reserves both a global and
session daily request slot. Failed, timed-out and cancelled calls still consume
the slot. The UTC daily cap persists across process restarts. Resetting the
`pc_trial_session` browser cookie may reset a session allowance, but cannot reset
the global limit. Anonymous trial sessions expire after seven days; only their
hashes and request outcome metadata are stored. Chat prompts, answers and keys
are never written to the database.

This is a request budget with bounded input/output, not a USD-denominated billing
cap. Configure an appropriate limited trial key at the inference gateway too.
Protect the public chat/config routes with the deployment edge's own rate limits
to prevent anonymous session churn and denial of service. The service remains
private behind the BFF and never trusts a browser-supplied client IP header.

## Persistent Agent tasks

The authenticated `/tasks` page uses `/api/portal/runtime/*` through the existing
BFF. Each task has an explicit customer model key, a fixed supported model,
references, a step budget and an output-token limit. Starting a task authorizes
multiple model calls within those limits. Token counts are usage information,
not a currency spending cap. Keys provisioned elsewhere are not selected or
charged implicitly.

Enable this service only after testing tool calling with the chosen model at
the configured gateway. Generate a dedicated encryption key with
`Fernet.generate_key()` from Python's `cryptography.fernet`, store it in the
deployment secret manager as `PC_RUNTIME_ENCRYPTION_KEY`, and set
`PC_RUNTIME_ENABLED=1`. The Compose configuration forwards these only to the
private portal container. Persist the database and encryption key across
restarts. Changing or losing that key makes existing unfinished tasks unable
to resume; cancel those tasks before rotation. Never commit the key.

Two background execution loops use transactional database leases (Postgres in production, SQLite in development). Closing the
browser does not stop a task. Pausing and cancellation are cooperative: an
already-started provider call can finish and consume tokens before the control
is applied. An expired lease pauses the task for explicit recovery, avoiding an
automatic repeat of an uncertain paid call. Failed, completed and cancelled
tasks are terminal; their encrypted credentials are cleared. Paused tasks retain
their encrypted credential to resume within the original budget.

The implemented tools read supplied text, calculate CSV statistics, update a
visible plan, read approved public HTTPS pages, and create TXT/Markdown/CSV/JSON/
DOCX downloads. Every web read needs an approval bound to its exact arguments.
DNS answers and redirects are checked, and connections pin the verified public
address while checking TLS for the original hostname. These tools do not execute
model-generated code or use a general browser/VM. There are no email, CRM or
other external write connectors in this release.

Task goals, references, assistant/tool messages, progress and generated files
are stored in the account database. They are sent to the selected model as
needed. Model credentials are encrypted separately and are never returned by
the task APIs. Database backups must therefore be access controlled; deleting
a credential from the current database does not erase historical backups.
Postgres backups: see the `pg_dump` command in `docs/deploy/a1-postgres-cutover.md`.
Task retention is bounded to 50 per account, with up to two unfinished tasks.
Files are capped at 1 MiB each and 8 MiB per task. Task creation accepts up to
192 KiB of UTF-8 JSON so multilingual references fit the character limit;
other requests retain the existing 64 KiB limit. Each continuous execution
segment has a five-minute deadline; approvals and pauses end that segment,
while the model-step and output budgets persist across resumes.
No untrusted generated HTML is rendered.

Run `python3 -m unittest discover -s server -t . -p 'test_runtime*.py' -v`
for the runtime regression suite. Tests use temporary databases, scripted model
responses and injected web transports; passing tests does not establish the
live model's tool-calling quality or production throughput.
