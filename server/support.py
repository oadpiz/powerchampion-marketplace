"""Primitives and gateway helpers shared by the portal's route modules.

`PortalContext` carries what the route modules need from `create_app` (store, gateway,
settings, current_user). Its methods read `self.gateway` / `self.settings` at call time:
tests swap gateway attributes after the app is built."""
import json
import math
import re
import time
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from .gateway import GatewayError
from .store import iso

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


# C0 and C1 controls, DEL, bidi embedding/override/isolate characters and lone surrogates (which cannot
# be encoded as UTF-8 and would fail later, in the database or the gateway request).
UNSAFE_TEXT = re.compile("[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ud800-\udfff]")


def unsafe_text(value, allow=""):
    """True when value contains a character from UNSAFE_TEXT other than those in allow (e.g. "\n\r\t")."""
    return any(char not in allow for char in UNSAFE_TEXT.findall(value))


def text_value(value, label, maximum, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()) or unsafe_text(value):
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


def audit_details(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except ValueError:
        return None


def gateway_fail(error):
    if error.code == "rejected" and error.status in (401, 403):
        # The gateway refused the portal's own credential: an operator fix, not a network problem.
        fail("gateway_auth_failed", "The portal's gateway token was rejected. Check PC_GATEWAY_ADMIN_TOKEN.", 503)
    if error.code == "rejected" and (error.status is None or error.status < 500):
        status = error.status if error.status in (400, 404, 409) else 400
        fail("gateway_rejected", error.detail or "The gateway rejected the request.", status)
    if error.code == "unconfigured":
        fail("provider_not_configured", "The gateway is not connected.", 503)
    fail("gateway_unavailable", "The API gateway is unavailable.", 503)


def gateway_error_code(error):
    """The per-call error code shown in the gateway overview; a rejected portal token is reported as such."""
    if isinstance(error, GatewayError):
        if error.code == "rejected" and error.status in (401, 403):
            return "gateway_auth_failed"
        return error.code
    return "unavailable"


def safe_iso(value):
    """iso() for a gateway-supplied epoch: only finite numbers in range, anything else is null."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    try:
        return iso(value)
    except (OverflowError, OSError, ValueError):
        return None


def usd_from_nano(value):
    return None if not isinstance(value, int) or isinstance(value, bool) else f"{Decimal(value) / Decimal(10**9):.2f}"


def gateway_key_json(item, owner_row=None):
    return {"gatewayKeyId": item.get("key_id"), "prefix": item.get("prefix"), "label": item.get("label"),
            "dailyTokenLimit": item.get("daily_token_limit"), "rpm": item.get("rpm"), "maxInflight": item.get("max_inflight"),
            "balanceUsd": usd_from_nano(item.get("prepaid_nano_usd")), "createdAt": iso(item.get("created_at")),
            "expiresAt": iso(item.get("expires_at")), "disabledAt": iso(item.get("disabled_at")), "lastUsedAt": iso(item.get("last_used_at")),
            "modelIds": [m for m in item.get("model_ids", []) if isinstance(m, str)],
            "owner": owner_json(owner_row),
            "portalKeyId": owner_row["id"] if owner_row else None, "portalStatus": owner_row["status"] if owner_row else None}


def owners_by_gateway_key_id(con):
    return {r["gateway_key_id"]: r for r in con.execute("SELECT k.id, k.user_id, k.gateway_key_id, k.status, u.email, u.name FROM gateway_keys k JOIN users u ON u.id=k.user_id").fetchall()}


def owner_json(owner_row):
    return {"id": owner_row["user_id"], "email": owner_row["email"], "name": owner_row["name"]} if owner_row else None


def limits_from(body):
    limits = {}
    for field, name in (("dailyTokenLimit", "daily_token_limit"), ("rpm", "rpm"), ("maxInflight", "max_inflight")):
        if body.get(field) is not None:
            value = body[field]
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 2 ** 53 - 1:
                fail("invalid_input", "Limits must be non-negative integers.", 422)
            limits[name] = value
    return limits


def usd_amount(raw, allow_zero):
    try:
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            raise ValueError
        amount = Decimal(str(raw))
        if not amount.is_finite() or amount < 0 or amount > 100000 or amount != amount.quantize(Decimal("0.01")) or (amount == 0 and not allow_zero):
            raise ValueError
    except (InvalidOperation, ValueError):
        fail("invalid_input", "Enter an amount " + ("from 0" if allow_zero else "above 0") + " to 100,000 USD with at most two decimals.", 422)
    return amount


def gateway_key_id(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        fail("key_not_found", "Key not found.", 404)
    return value


def gateway_path(value, pattern):
    # The adapter rejects dot-segments too; checking here keeps them from ever reaching it.
    if not pattern.fullmatch(value) or any(part in ("", ".", "..") for part in value.split("/")):
        fail("invalid_input", "Check the model, node or job name.")


def admin_target(con, user_id, admin):
    # Re-check the caller inside the write lock: current_user() ran before BEGIN IMMEDIATE,
    # so another admin may have demoted or disabled this one in between.
    me = con.execute("SELECT role, disabled_at FROM users WHERE id=?", (admin["id"],)).fetchone()
    if not me or me["role"] != "admin" or me["disabled_at"] is not None:
        fail("admin_required", "Administrator access is required.", 403)
    if user_id == admin["id"]:
        fail("self_target", "Use your own account page for your own account.", 409)
    row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        fail("customer_not_found", "Account not found.", 404)
    return row


@dataclass
class PortalContext:
    store: Any
    gateway: Any
    settings: Any
    current_user: Callable

    def require_gateway(self, customer=False):
        # Customer self-service is a separate switch: a configured gateway alone does not let customers mint keys.
        if not self.gateway.configured or (customer and not self.settings.customer_key_issuance):
            fail("provider_not_configured", "API key provisioning is not connected yet. Contact support for access.", 503)

    def audit(self, action, actor, target=None, details=None):
        with self.store.connect() as con:
            self.store.audit(con, action, actor["id"], target, details)

    def key_issuance(self):
        # Mirrors require_gateway(customer=True): whether POST /keys can succeed for a customer.
        return bool(self.gateway.configured and self.settings.customer_key_issuance)

    async def gateway_call(self, call, *args, not_found=None, **kwargs):
        """not_found=(code, detail) turns a gateway 404 into that route-specific error."""
        self.require_gateway()
        try:
            return await call(*args, **kwargs)
        except GatewayError as error:
            if error.code == "invalid_identifier":
                fail("invalid_input", "Check the model, node or job name.")
            if not_found and error.code == "rejected" and error.status == 404:
                fail(not_found[0], not_found[1], 404)
            gateway_fail(error)
        except ValueError:
            fail("invalid_input", "Check the request details.", 422)

    async def provision_key(self, owner_id, label, prepaid_usd, limits, actor_id, audit_action):
        """Create a gateway key and record its owner. Returns (local row, gateway result).

        The gateway key is created first and revoked again if the local write fails, so a
        secret is never handed out for a key that no account owns."""
        store = self.store
        reservation = store.reserve_key_slot(owner_id)
        if not reservation:
            fail("key_limit", "Revoke an unused key before creating another.", 409)
        try:
            try:
                created = await self.gateway.create_key("portal:" + owner_id[:12] + ":" + label, prepaid_usd=prepaid_usd, limits=limits or None)
            except GatewayError as error:
                if error.code == "rejected" and error.status in (401, 403):
                    fail("gateway_auth_failed", "The portal's gateway token was rejected. Check PC_GATEWAY_ADMIN_TOKEN.", 503)
                fail("gateway_unavailable", "The API gateway is unavailable. No key was added to the account.", 503)
            key_id = uuid.uuid4().hex
            try:
                with store.connect() as con:
                    con.execute("BEGIN IMMEDIATE")
                    # Ownership is persisted before the one-time secret is sent.
                    # Consume the slot in the same transaction, so a concurrent
                    # request cannot race the in-flight provisioning operation.
                    slot = con.execute("SELECT id FROM key_reservations WHERE id=? AND user_id=?", (reservation, owner_id)).fetchone()
                    if not slot:
                        raise RuntimeError("reservation expired")
                    con.execute("INSERT INTO gateway_keys VALUES (?,?,?,?,?,?,?,NULL)", (key_id, owner_id, created["key_id"], label, created["prefix"], "active", int(time.time())))
                    con.execute("DELETE FROM key_reservations WHERE id=?", (reservation,))
                    store.audit(con, audit_action, actor_id, key_id)
                    row = con.execute("SELECT * FROM gateway_keys WHERE id=?", (key_id,)).fetchone()
            except Exception:
                # Compensate if the gateway succeeded but local ownership persistence failed.
                try:
                    await self.gateway.revoke_key(created["key_id"])
                except GatewayError:
                    with store.connect() as con:
                        store.audit(con, "key.provisioning_needs_reconciliation", actor_id, created["key_id"])
                fail("key_create_failed", "The key could not be saved. Contact support before retrying.", 503)
        finally:
            store.release_key_slot(reservation)
        return row, created
