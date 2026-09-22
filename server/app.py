"""Customer/admin API, isolated from the existing production control plane."""
import json
import re
import sqlite3
import time
import uuid
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .agents import AgentError, Agents, parse_name, parse_version
from .gateway import GatewayAdapter, GatewayError
from .chat import TRIAL_COOKIE, TrialChat
from .security import clean_name, digest_token, normalize_email, password_hash, validate_password, verify_password
from .settings import Settings
from .store import Store, credit_json, iso, key_json, user_json
from .runtime_api import attach_runtime

COOKIE_NAME = "pc_portal_session"
PREFIX = "/api/portal"


class PortalError(Exception):
    def __init__(self, code, detail, status=400):
        self.code, self.detail, self.status = code, detail, status


def fail(code, detail, status=400):
    raise PortalError(code, detail, status)


async def body_json(request, maximum=65536):
    if not request.headers.get("content-type", "").lower().startswith("application/json"):
        fail("invalid_input", "Send a JSON request.", 415)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > maximum:
            fail("invalid_input", "Request is too large.", 413)
        body.extend(chunk)
    try:
        value = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        fail("invalid_input", "Enter valid request details.")
    if not isinstance(value, dict):
        fail("invalid_input", "Enter valid request details.")
    return value


def text_value(value, label, maximum, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()) or any(ord(c) < 32 for c in value):
        fail("invalid_input", "Enter a valid " + label + ".")
    return value.strip()


def credit_cents(value):
    try:
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            raise ValueError()
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 10 or amount > 10000 or amount * 100 != (amount * 100).to_integral_value():
            raise ValueError()
        return int(amount * 100)
    except (ValueError, InvalidOperation, OverflowError):
        fail("invalid_input", "Enter a USD amount from 10 to 10,000 with at most two decimal places.")


def create_app(settings=None, gateway=None, chat_transport=None, runtime_model=None, runtime_tools=None):
    settings = settings or Settings.from_env()
    store = Store(settings.db_path)
    gateway = gateway if gateway is not None else GatewayAdapter(settings)
    @asynccontextmanager
    async def lifespan(application):
        stop = asyncio.Event()
        workers = []
        if settings.runtime_available:
            # Worker leases fence each claim; two loops also let an unrelated
            # customer's task progress during a slow model response.
            workers = [asyncio.create_task(application.state.runtime_engine.serve(stop)) for _ in range(2)]
        try:
            yield
        finally:
            stop.set()
            for worker in workers:
                worker.cancel()
            if workers:
                await asyncio.gather(*workers, return_exceptions=True)

    application = FastAPI(title="Power Champion Customer Portal", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    application.state.store = store
    application.state.gateway = gateway
    application.state.settings = settings
    trial_chat = TrialChat(settings, store, transport=chat_transport)
    agents = Agents(store)
    # Equal password-work cost for unknown accounts without storing a real user.
    dummy_password = password_hash(uuid.uuid4().hex)

    @application.middleware("http")
    async def boundaries(request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin", "")
            if origin not in settings.allowed_origins or request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"error": "origin_not_allowed", "detail": "Reload the portal and try again."}, status_code=403, headers={"Cache-Control": "no-store"})
        try:
            response = await call_next(request)
        except Exception:
            # No traceback, raw gateway payload, credential or SQL details in API output.
            response = JSONResponse({"error": "internal_error", "detail": "The request could not be completed. Please try again."}, status_code=500)
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        response.headers["Vary"] = "Cookie"
        return response

    @application.exception_handler(PortalError)
    async def portal_error(_request, error):
        return JSONResponse({"error": error.code, "detail": error.detail}, status_code=error.status)

    @application.exception_handler(StarletteHTTPException)
    async def http_error(_request, error):
        code = "not_found" if error.status_code == 404 else "method_not_allowed" if error.status_code == 405 else "invalid_request"
        return JSONResponse({"error": code, "detail": "This portal endpoint is not available for this request."}, status_code=error.status_code)

    @application.exception_handler(RequestValidationError)
    async def validation_error(_request, _error):
        return JSONResponse({"error": "invalid_input", "detail": "Enter valid request details."}, status_code=400)

    def current_user(request, admin=False):
        user = store.session_user(request.cookies.get(COOKIE_NAME, ""))
        if not user:
            fail("auth_required", "Sign in to continue.", 401)
        if admin and user["role"] != "admin":
            fail("admin_required", "Administrator access is required.", 403)
        return user

    def set_session(user, request, status=200):
        prior = request.cookies.get(COOKIE_NAME)
        if prior:
            store.logout(prior)
        token = store.new_session(user["id"], settings.session_ttl_seconds)
        response = JSONResponse({"user": user}, status_code=status)
        response.set_cookie(COOKIE_NAME, token, max_age=settings.session_ttl_seconds, httponly=True, secure=settings.secure_cookies, samesite="lax", path="/")
        return response

    def require_gateway():
        if not gateway.configured:
            fail("provider_not_configured", "API key provisioning is not connected yet. Contact support for access.", 503)

    @application.get(PREFIX + "/health")
    async def health():
        return {"ok": True}

    @application.get(PREFIX + "/trial/config")
    async def trial_config(request: Request):
        payload, token = trial_chat.config(request.cookies.get(TRIAL_COOKIE))
        return trial_chat.response(payload, token)

    @application.post(PREFIX + "/trial/chat")
    async def trial_complete(request: Request):
        return await trial_chat.complete(request)

    @application.post(PREFIX + "/auth/register")
    async def register(request: Request):
        body = await body_json(request)
        try:
            email = normalize_email(body.get("email"))
            name = clean_name(body.get("name"))
            password = validate_password(body.get("password"))
            # The BFF shares a loopback address across every customer. Scope
            # local throttles by account, never by that shared proxy address.
            scope = "register:" + digest_token(email)
            if not store.consume_attempt(scope, limit=10, window=3600):
                fail("rate_limited", "Too many attempts. Please try again later.", 429)
            user = await run_in_threadpool(store.create_user, email, name, password)
        except ValueError as error:
            fail("invalid_input", str(error))
        except sqlite3.IntegrityError:
            fail("duplicate_email", "An account already exists for this email. Sign in instead.", 409)
        return set_session(user, request, 201)

    @application.post(PREFIX + "/auth/login")
    async def login(request: Request):
        body = await body_json(request)
        try:
            email = normalize_email(body.get("email"))
        except ValueError:
            fail("invalid_credentials", "Email or password is incorrect.", 401)
        password = body.get("password")
        if not isinstance(password, str) or not 1 <= len(password) <= 128:
            fail("invalid_credentials", "Email or password is incorrect.", 401)
        scope = "login:" + digest_token(email)
        if not store.consume_attempt(scope):
            fail("rate_limited", "Too many attempts. Please try again in 15 minutes.", 429)
        row = store.find_user(email)
        valid = await run_in_threadpool(verify_password, password, row["password_hash"] if row else dummy_password)
        if not row or not valid:
            fail("invalid_credentials", "Email or password is incorrect.", 401)
        store.clear_attempts(scope)
        with store.connect() as con:
            store.audit(con, "account.signed_in", row["id"], row["id"])
        return set_session(user_json(row), request)

    @application.get(PREFIX + "/session")
    async def session(request: Request):
        return {"user": current_user(request)}

    @application.post(PREFIX + "/auth/logout")
    async def logout(request: Request):
        token = request.cookies.get(COOKIE_NAME, "")
        user = store.session_user(token)
        store.logout(token)
        if user:
            with store.connect() as con:
                store.audit(con, "account.signed_out", user["id"], user["id"])
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE_NAME, path="/", secure=settings.secure_cookies, httponly=True, samesite="lax")
        return response

    @application.get(PREFIX + "/overview")
    async def overview(request: Request):
        user = current_user(request)
        with store.connect() as con:
            keys = con.execute("SELECT COUNT(*) FROM gateway_keys WHERE user_id=? AND status='active'", (user["id"],)).fetchone()[0]
            pending = con.execute("SELECT COUNT(*) FROM credit_requests WHERE user_id=? AND status='pending'", (user["id"],)).fetchone()[0]
            approved = con.execute("SELECT COALESCE(SUM(amount_cents),0) FROM credit_requests WHERE user_id=? AND status='approved'", (user["id"],)).fetchone()[0]
        return {"user": user, "keyCount": keys, "pendingCreditCount": pending, "approvedCreditUsd": approved / 100, "gatewayConfigured": bool(gateway.configured)}

    @application.get(PREFIX + "/keys")
    async def keys(request: Request):
        user = current_user(request)
        return {"keys": [key_json(row) for row in store.owned_keys(user["id"])], "gatewayConfigured": bool(gateway.configured)}

    @application.post(PREFIX + "/keys")
    async def create_key(request: Request):
        user = current_user(request)
        body = await body_json(request)
        label = text_value(body.get("label"), "key label", 80)
        require_gateway()
        reservation = store.reserve_key_slot(user["id"])
        if not reservation:
            fail("key_limit", "Revoke an unused key before creating another.", 409)
        try:
            try:
                created = await gateway.create_key("portal:" + user["id"][:12] + ":" + label)
            except GatewayError:
                fail("gateway_unavailable", "The API gateway is unavailable. No key was added to your account.", 503)
            key_id = uuid.uuid4().hex
            try:
                with store.connect() as con:
                    con.execute("BEGIN IMMEDIATE")
                    # Ownership is persisted before the one-time secret is sent.
                    # Consume the slot in the same transaction, so a concurrent
                    # request cannot race the in-flight provisioning operation.
                    slot = con.execute("SELECT id FROM key_reservations WHERE id=? AND user_id=?", (reservation, user["id"])).fetchone()
                    if not slot:
                        raise RuntimeError("reservation expired")
                    con.execute("INSERT INTO gateway_keys VALUES (?,?,?,?,?,?,?,NULL)", (key_id, user["id"], created["key_id"], label, created["prefix"], "active", int(time.time())))
                    con.execute("DELETE FROM key_reservations WHERE id=?", (reservation,))
                    store.audit(con, "key.created", user["id"], key_id)
                    row = con.execute("SELECT * FROM gateway_keys WHERE id=?", (key_id,)).fetchone()
            except Exception:
                # Compensate if the gateway succeeded but local ownership persistence failed.
                try:
                    await gateway.revoke_key(created["key_id"])
                except GatewayError:
                    with store.connect() as con:
                        store.audit(con, "key.provisioning_needs_reconciliation", user["id"], created["key_id"])
                fail("key_create_failed", "The key could not be saved. Contact support before retrying.", 503)
        finally:
            store.release_key_slot(reservation)
        return JSONResponse({"key": key_json(row), "secret": created["secret"]}, status_code=201)

    @application.delete(PREFIX + "/keys/{key_id}")
    async def revoke_key(key_id: str, request: Request):
        user = current_user(request)
        with store.connect() as con:
            row = con.execute("SELECT * FROM gateway_keys WHERE id=? AND user_id=?", (key_id, user["id"])).fetchone()
        if not row:
            fail("key_not_found", "Key not found.", 404)
        if row["status"] == "revoked":
            return {"key": key_json(row)}
        require_gateway()
        try:
            await gateway.revoke_key(row["gateway_key_id"])
        except GatewayError:
            fail("gateway_unavailable", "The gateway could not confirm revocation. Please try again.", 503)
        with store.connect() as con:
            changed = con.execute("UPDATE gateway_keys SET status='revoked',revoked_at=? WHERE id=? AND user_id=? AND status='active'", (int(time.time()), key_id, user["id"])).rowcount
            if changed:
                store.audit(con, "key.revoked", user["id"], key_id)
            row = con.execute("SELECT * FROM gateway_keys WHERE id=? AND user_id=?", (key_id, user["id"])).fetchone()
        return {"key": key_json(row)}

    @application.get(PREFIX + "/usage")
    async def usage(request: Request, month: str = ""):
        user = current_user(request)
        month = month or datetime.now(timezone.utc).strftime("%Y-%m")
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month) or not 2000 <= int(month[:4]) <= 2100:
            fail("invalid_input", "Choose a valid month (YYYY-MM).")
        if not gateway.configured:
            return {"month": month, "rows": [], "source": "unconfigured", "updatedAt": None}
        owned_ids = {row["gateway_key_id"] for row in store.owned_keys(user["id"])}
        totals = {}
        if owned_ids:
            try:
                report = await gateway.usage_report(month)
                if not isinstance(report.get("keys"), list):
                    raise ValueError()
                unpriced = report.get("unpriced_models", [])
                if not isinstance(unpriced, list) or not all(isinstance(model, str) for model in unpriced):
                    raise ValueError()
                for entry in report["keys"]:
                    if not isinstance(entry, dict) or entry.get("key_id") not in owned_ids:
                        continue
                    if not isinstance(entry.get("by_model"), list):
                        raise ValueError()
                    for model in entry["by_model"]:
                        if not isinstance(model, dict) or not isinstance(model.get("model"), str) or len(model["model"]) > 200:
                            raise ValueError()
                        if model["model"] in unpriced:
                            fail("usage_pricing_incomplete", "Pricing is incomplete for some of your usage. Contact support for reconciliation.", 503)
                        counts = [model.get(field) for field in ("requests", "prompt_tokens", "completion_tokens")]
                        if any(isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 9007199254740991 for value in counts):
                            raise ValueError()
                        cost = Decimal(str(model.get("cost_usd")))
                        if not cost.is_finite() or cost < 0 or cost > Decimal("1000000000"):
                            raise ValueError()
                        bucket = totals.setdefault(model["model"], {"model": model["model"], "requests": 0, "inputTokens": 0, "outputTokens": 0, "costUsd": Decimal(0)})
                        for field, value in zip(("requests", "inputTokens", "outputTokens"), counts):
                            bucket[field] += value
                        bucket["costUsd"] += cost
            except (GatewayError, ValueError, InvalidOperation, TypeError):
                fail("gateway_unavailable", "Usage could not be retrieved. Please try again later.", 503)
        rows = [dict(row, costUsd=float(row["costUsd"])) for row in totals.values()]
        return {"month": month, "rows": sorted(rows, key=lambda row: row["model"]), "source": "gateway", "updatedAt": iso(int(time.time()))}

    @application.get(PREFIX + "/credits")
    async def credits(request: Request):
        user = current_user(request)
        with store.connect() as con:
            rows = con.execute("SELECT * FROM credit_requests WHERE user_id=? ORDER BY created_at DESC,id", (user["id"],)).fetchall()
        return {"requests": [credit_json(row) for row in rows]}

    @application.post(PREFIX + "/credits")
    async def request_credit(request: Request):
        user = current_user(request)
        body = await body_json(request)
        amount = credit_cents(body.get("amountUsd"))
        reference = text_value(body.get("reference"), "payment reference", 160)
        credit_id = uuid.uuid4().hex
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            if con.execute("SELECT COUNT(*) FROM credit_requests WHERE user_id=? AND status='pending'", (user["id"],)).fetchone()[0] >= 20:
                fail("request_limit", "Wait for your pending requests to be reviewed.", 409)
            con.execute("INSERT INTO credit_requests (id,user_id,amount_cents,status,reference,created_at) VALUES (?,?,?,'pending',?,?)", (credit_id, user["id"], amount, reference, int(time.time())))
            store.audit(con, "credit.requested", user["id"], credit_id)
            row = con.execute("SELECT * FROM credit_requests WHERE id=?", (credit_id,)).fetchone()
        return JSONResponse({"request": credit_json(row)}, status_code=201)

    @application.get(PREFIX + "/agents")
    async def list_agents(request: Request):
        user = current_user(request)
        return {"agents": agents.list(user["id"])}

    @application.post(PREFIX + "/agents")
    async def create_agent(request: Request):
        user = current_user(request)
        body = await body_json(request)
        try:
            agent, token = agents.create(user["id"], parse_name(body.get("name")), parse_version(body))
        except AgentError as error:
            fail("invalid_input", str(error))
        # The token is shown once; only its hash is stored.
        return JSONResponse({"agent": agent, "token": token}, status_code=201)

    @application.get(PREFIX + "/agents/{agent_id}")
    async def read_agent(request: Request, agent_id: str):
        user = current_user(request)
        try:
            return {"agent": agents.get(user["id"], agent_id)}
        except LookupError:
            fail("not_found", "This agent does not exist.", 404)

    @application.post(PREFIX + "/agents/{agent_id}/versions")
    async def update_agent(request: Request, agent_id: str):
        user = current_user(request)
        body = await body_json(request)
        try:
            return {"agent": agents.add_version(user["id"], agent_id, parse_name(body.get("name")), parse_version(body))}
        except AgentError as error:
            fail("invalid_input", str(error))
        except LookupError:
            fail("not_found", "This agent does not exist.", 404)

    @application.post(PREFIX + "/agents/{agent_id}/token")
    async def rotate_agent_token(request: Request, agent_id: str):
        user = current_user(request)
        try:
            return {"token": agents.rotate_token(user["id"], agent_id)}
        except LookupError:
            fail("not_found", "This agent does not exist.", 404)

    @application.delete(PREFIX + "/agents/{agent_id}")
    async def delete_agent(request: Request, agent_id: str):
        user = current_user(request)
        try:
            agents.archive(user["id"], agent_id)
        except LookupError:
            fail("not_found", "This agent does not exist.", 404)
        return {"ok": True}

    @application.post(PREFIX + "/agents/resolve")
    async def resolve_agent(request: Request):
        """Website server only: an agent token becomes a runnable configuration.

        No customer identity, gateway key or conversation passes through here.
        """
        body = await body_json(request)
        resolved = agents.resolve(body.get("token"))
        if not resolved:
            fail("not_found", "This agent endpoint is not available.", 404)
        return {"agent": resolved}

    @application.get(PREFIX + "/admin/overview")
    async def admin_overview(request: Request):
        current_user(request, admin=True)
        with store.connect() as con:
            customers = con.execute("SELECT COUNT(*) FROM users WHERE role='customer'").fetchone()[0]
            count = con.execute("SELECT COUNT(*) FROM gateway_keys WHERE status='active'").fetchone()[0]
            pending = con.execute("SELECT COUNT(*) FROM credit_requests WHERE status='pending'").fetchone()[0]
        return {"customerCount": customers, "keyCount": count, "pendingCreditCount": pending, "gatewayConfigured": bool(gateway.configured)}

    @application.get(PREFIX + "/admin/customers")
    async def admin_customers(request: Request):
        current_user(request, admin=True)
        with store.connect() as con:
            rows = con.execute("SELECT u.*, (SELECT COUNT(*) FROM gateway_keys k WHERE k.user_id=u.id AND status='active') AS key_count FROM users u WHERE role='customer' ORDER BY created_at DESC,id LIMIT 1000").fetchall()
        return {"customers": [dict(user_json(row), keyCount=row["key_count"]) for row in rows]}

    @application.get(PREFIX + "/admin/credits")
    async def admin_credits(request: Request):
        current_user(request, admin=True)
        with store.connect() as con:
            rows = con.execute("SELECT c.*,u.email,u.name FROM credit_requests c JOIN users u ON u.id=c.user_id ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,c.created_at DESC,c.id LIMIT 1000").fetchall()
        return {"requests": [credit_json(row) for row in rows]}

    @application.post(PREFIX + "/admin/credits/{credit_id}/review")
    async def review_credit(credit_id: str, request: Request):
        user = current_user(request, admin=True)
        body = await body_json(request)
        decision = body.get("decision")
        if decision not in ("approve", "reject"):
            fail("invalid_input", "Choose approve or reject.")
        note = text_value(body.get("note", ""), "review note", 500, required=False)
        desired = "approved" if decision == "approve" else "rejected"
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT * FROM credit_requests WHERE id=?", (credit_id,)).fetchone()
            if not row:
                fail("credit_not_found", "Credit request not found.", 404)
            if row["status"] == desired:
                return {"request": credit_json(row)}
            if row["status"] != "pending":
                fail("already_reviewed", "This request has already been reviewed.", 409)
            con.execute("UPDATE credit_requests SET status=?,reviewed_at=?,reviewer_id=?,review_note=? WHERE id=? AND status='pending'", (desired, int(time.time()), user["id"], note, credit_id))
            store.audit(con, "credit." + desired, user["id"], credit_id)
            row = con.execute("SELECT * FROM credit_requests WHERE id=?", (credit_id,)).fetchone()
        return {"request": credit_json(row)}

    @application.get(PREFIX + "/admin/audit")
    async def audit(request: Request):
        current_user(request, admin=True)
        with store.connect() as con:
            rows = con.execute("SELECT a.*,u.email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 200").fetchall()
        return {"events": [{"id": row["id"], "action": row["action"], "actorEmail": row["email"], "targetId": row["target_id"], "createdAt": iso(row["created_at"])} for row in rows]}

    attach_runtime(application, store, settings, agents, current_user, body_json, runtime_model, runtime_tools)
    return application


app = create_app()
