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

### Gateway admin routes (A2b)

All require an administrator and live under `/api/portal`. They return 503
`provider_not_configured` while `PC_GATEWAY_ADMIN_TOKEN` is empty (the key list and
usage reads instead return an empty payload flagged `gatewayConfigured: false` / `source: "unconfigured"`).

| Route | Purpose |
| --- | --- |
| `GET /admin/keys` | Gateway keys (with the owning portal account where known) and the config-defined `envKeys` |
| `POST /admin/customers/{id}/keys` | `{label, prepaidUsd, dailyTokenLimit?, rpm?, maxInflight?}`. `prepaidUsd` must be above 0, at most 100000, with at most two decimals (else 422 `invalid_input`). 201 with the one-time `secret`; a disabled account is 409 |
| `POST /admin/keys/{id}/disable` | `{disabled: true \| false}` on a gateway key; `false` re-enables it (audited as `admin.key_enabled`). Re-enabling a key whose local owner is disabled is 409 `account_disabled` ("Enable the account first.") with no gateway call and no audit; keys without a local owner are not checked |
| `POST /admin/keys/{id}/limits` | Change `dailyTokenLimit`, `rpm`, `maxInflight` (at least one) |
| `POST /admin/keys/{id}/balance` | `{addUsd}` or `{setUsd}` (exactly one) |
| `GET /admin/usage?month=YYYY-MM` | Gateway usage report, month defaults to the current UTC month |
| `GET /admin/gateway` | Models and nodes from `/api/state`; any `api_key`, key, token, secret or password string field is stripped server-side |
| `POST /admin/gateway/models/{id}/toggle` | Enable or disable a model |
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
`key_not_found`, 404 `customer_not_found`, 400 `unknown_action`, and 422/400
`invalid_input` for bad bodies.

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
