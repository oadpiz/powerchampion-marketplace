# Customer portal service

This is an isolated customer/admin backend for the new website. It does not
import, deploy, reconfigure, or write the existing Python/Go inference gateway.
Accounts, sessions, key ownership, credit verification requests and audit events
persist in SQLite. There are no default users or passwords.

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
| `PC_PORTAL_DB` | `.local/portal.sqlite3`; mount a durable volume and back it up |
| `PC_PORTAL_ALLOWED_ORIGINS` | `http://localhost:3010,https://powerchampion.ai`; exact origins for mutations |
| `PC_PORTAL_SESSION_TTL` | `43200` seconds |
| `PC_PORTAL_SECURE_COOKIES` | `0` locally; **set `1` for HTTPS deployment** |
| `PC_PORTAL_ENV` | Set `production` to enforce secure cookies at startup |
| `PC_GATEWAY_ORIGIN` | `https://b300.powerchampion.ai`; fixed HTTPS origin, server-only |
| `PC_GATEWAY_ADMIN_TOKEN` | Empty means key provisioning and usage integration are disconnected |
| `PC_GATEWAY_DAILY_TOKEN_LIMIT` | `1000000`, positive daily token quota on newly issued gateway keys |
| `PC_GATEWAY_RPM` | `60`, positive request limit on new keys |
| `PC_GATEWAY_MAX_INFLIGHT` | `2`, positive concurrency limit on new keys |
| `PC_RUNTIME_ENABLED` | `0`; opt-in background Agent tasks when set to `1` |
| `PC_RUNTIME_ENCRYPTION_KEY` | Separate Fernet key for per-task model credentials; missing/invalid key leaves tasks unavailable |

There is no direct CORS access. Mutations require a matching Origin. The BFF must
forward only the validated request origin and the `pc_portal_session` cookie;
session cookies are HttpOnly and SameSite=Lax. Passwords use scrypt; opaque
sessions store SHA-256 hashes and enforce expiry server-side. Sessions are
rotated at login. Database files are owner-readable/writable only.

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
in SQLite, or returned by any portal endpoint. Upstream redirects are disabled;
responses are size-limited and validated. Legacy keys must be explicitly mapped
before their usage could appear in a customer's account; the portal does not
guess ownership from email or labels.

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
python3 -m unittest discover -s server -p 'test_*.py' -v
```

Tests use temporary databases, fake gateway collaborators and mocked HTTP
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

Before contacting the model, one SQLite transaction reserves both a global and
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

Two background execution loops use transactional SQLite leases. Closing the
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
