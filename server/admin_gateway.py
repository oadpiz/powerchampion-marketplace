"""Admin key and gateway routes: key issuance and management, usage, models, nodes."""
import asyncio
import re
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import Request
from fastapi.responses import JSONResponse

from .gateway import JOB_ID, MODEL_ID, NODE_ACTIONS, NODE_NAME, GatewayError
from .store import iso, key_json
from .support import (PREFIX, body_json, fail, gateway_error_code, gateway_fail, gateway_key_id, gateway_key_json, gateway_path,
                      limits_from, owner_json, owners_by_gateway_key_id, text_value, usd_amount, usd_from_nano)


def attach_admin_gateway(application, ctx):
    @application.post(PREFIX + "/admin/customers/{user_id}/keys")
    async def admin_issue_key(user_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        body = await body_json(request)
        label = text_value(body.get("label"), "key label", 80)
        raw = body.get("prepaidUsd")
        try:
            if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
                raise ValueError
            prepaid = Decimal(str(raw))
            if not prepaid.is_finite() or prepaid <= 0 or prepaid > 100000 or prepaid != prepaid.quantize(Decimal("0.01")):
                raise ValueError
        except (InvalidOperation, ValueError):
            fail("invalid_input", "Enter a prepaid amount above 0 USD with at most two decimals.", 422)
        limits = limits_from(body)
        with ctx.store.connect() as con:
            target = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not target:
            fail("customer_not_found", "Account not found.", 404)
        if target["disabled_at"]:
            fail("invalid_input", "This account is disabled.", 409)
        if target["role"] != "customer":
            fail("target_not_customer", "Keys can only be issued to customer accounts.", 409)
        ctx.require_gateway()
        row, created = await ctx.provision_key(user_id, label, prepaid, limits, admin["id"], "admin.key_issued")
        balance = created.get("balance_nano_usd")
        balance_usd = f"{Decimal(balance) / Decimal(10**9):.2f}" if isinstance(balance, int) else f"{prepaid:.2f}"
        return JSONResponse({"key": key_json(row), "secret": created["secret"], "balanceUsd": balance_usd}, status_code=201)

    @application.get(PREFIX + "/admin/keys")
    async def admin_keys(request: Request):
        ctx.current_user(request, admin=True)
        if not ctx.gateway.configured:
            return {"keys": [], "envKeys": [], "gatewayConfigured": False}
        try:
            listing = await ctx.gateway.list_keys()
        except GatewayError as error:
            gateway_fail(error)
        with ctx.store.connect() as con:
            owners = owners_by_gateway_key_id(con)
        return {"keys": [gateway_key_json(item, owners.get(item.get("key_id"))) for item in listing["keys"]],
                "envKeys": [gateway_key_json(item) for item in listing["env_keys"]], "gatewayConfigured": True}

    @application.get(PREFIX + "/admin/usage")
    async def admin_usage(request: Request, month: str = ""):
        ctx.current_user(request, admin=True)
        month = month or datetime.now(timezone.utc).strftime("%Y-%m")
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month) or not 2000 <= int(month[:4]) <= 2100:
            fail("invalid_input", "Choose a valid month (YYYY-MM).")
        if not ctx.gateway.configured:
            return {"month": month, "source": "unconfigured", "totals": {"requests": 0, "costUsd": "0.000000"}, "amountStatus": None,
                    "unpricedModels": [], "keys": [], "byCustomer": [], "updatedAt": iso(int(time.time()))}

        def count(value):
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 9007199254740991:
                raise ValueError()
            return value

        def cost(value):
            amount = Decimal(str(value))
            if not isinstance(value, (str, int, float)) or isinstance(value, bool) or not amount.is_finite() or amount < 0 or amount > Decimal("1000000000"):
                raise ValueError()
            return amount

        try:
            report = await ctx.gateway.usage_report(month)
            if not isinstance(report.get("keys"), list):
                raise ValueError()
            unpriced = report.get("unpriced_models", [])
            if not isinstance(unpriced, list) or not all(isinstance(model, str) for model in unpriced):
                raise ValueError()
            amount_status = report.get("amount_status")
            if amount_status is not None and not isinstance(amount_status, str):
                raise ValueError()
            total_requests = count(report.get("total_requests"))
            cost(report.get("total_cost_usd"))
            total_cost = str(report["total_cost_usd"])
            parsed = []
            for entry in report["keys"]:
                if not isinstance(entry, dict) or not isinstance(entry.get("key_id"), str) or not isinstance(entry.get("by_model"), list):
                    raise ValueError()
                label = entry.get("label")
                if label is not None and not isinstance(label, str):
                    raise ValueError()
                models = []
                for model in entry["by_model"]:
                    if not isinstance(model, dict) or not isinstance(model.get("model"), str) or len(model["model"]) > 200:
                        raise ValueError()
                    models.append({"model": model["model"], "requests": count(model.get("requests")), "inputTokens": count(model.get("prompt_tokens")),
                                   "outputTokens": count(model.get("completion_tokens")), "costUsd": str(model.get("cost_usd"))})
                    cost(model.get("cost_usd"))
                parsed.append(({"gatewayKeyId": entry["key_id"], "label": label, "requests": count(entry.get("requests")),
                                "inputTokens": count(entry.get("prompt_tokens")), "outputTokens": count(entry.get("completion_tokens")),
                                "costUsd": str(entry.get("cost_usd")), "byModel": models}, cost(entry.get("cost_usd"))))
        except GatewayError as error:
            gateway_fail(error)
        except (ValueError, InvalidOperation, TypeError):
            fail("gateway_unavailable", "Usage could not be retrieved. Please try again later.", 503)
        with ctx.store.connect() as con:
            owners = owners_by_gateway_key_id(con)
        keys, customers = [], {}
        for item, amount in sorted(parsed, key=lambda pair: (-pair[1], pair[0]["gatewayKeyId"])):
            owner = owners.get(item["gatewayKeyId"])
            keys.append(dict(item, owner=owner_json(owner)))
            group = customers.setdefault(owner["user_id"] if owner else None, {"owner": owner_json(owner), "requests": 0, "cost": Decimal(0)})
            group["requests"] += item["requests"]
            group["cost"] += amount
        by_customer = sorted(customers.items(), key=lambda pair: (pair[0] is None, -pair[1]["cost"]))
        return {"month": month, "source": "gateway", "totals": {"requests": total_requests, "costUsd": total_cost}, "amountStatus": amount_status,
                "unpricedModels": unpriced, "keys": keys,
                "byCustomer": [{"owner": group["owner"], "requests": group["requests"], "costUsd": f"{group['cost']:.6f}"} for _, group in by_customer],
                "updatedAt": iso(int(time.time()))}

    @application.post(PREFIX + "/admin/keys/{key_id}/disable")
    async def admin_disable_key(key_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_key_id(key_id)
        body = await body_json(request)
        disabled = body.get("disabled")
        if not isinstance(disabled, bool):
            fail("invalid_input", "Choose whether to disable or enable the key.", 422)
        ctx.require_gateway()
        reservation = None
        if not disabled:
            # Keys revoked by disabling their account stay revoked until the account is enabled.
            # Keys without a local owner are admin-managed and are not checked here.
            with ctx.store.connect() as con:
                owner = con.execute("SELECT k.id, k.user_id, k.status, u.disabled_at FROM gateway_keys k JOIN users u ON u.id=k.user_id WHERE k.gateway_key_id=?", (key_id,)).fetchone()
            if owner and owner["disabled_at"] is not None:
                fail("account_disabled", "Enable the account first.", 409)
            if owner and owner["status"] == "revoked":
                # Re-enabling counts against the same per-account cap as issuing a new key.
                # The tag marks the reservation as "re-enabling this key", visible to other workers too.
                tag = "enable:" + key_id
                reservation = ctx.store.reserve_key_slot(owner["user_id"], tag=tag)
                if reservation is None:
                    with ctx.store.connect() as con:
                        # Reservations first, key second: a re-enable that commits between the two reads then shows
                        # up as "active" rather than vanishing from both.
                        live = con.execute("SELECT id FROM key_reservations WHERE user_id=? AND created_at>?",
                                           (owner["user_id"], int(time.time()) - 300)).fetchall()
                        current = con.execute("SELECT status FROM gateway_keys WHERE id=?", (owner["id"],)).fetchone()
                    pending = any(row["id"].startswith(tag + ":") for row in live)
                    if current and current["status"] == "active":
                        # A concurrent re-enable of this same key finished first; the requested state already holds.
                        return {"ok": True}
                    if pending:
                        # Another request is re-enabling this same key right now and holds the last slot.
                        fail("key_enable_in_progress", "This key is being re-enabled by another request. Refresh in a moment.", 409)
                    fail("key_limit", "This account already has the maximum number of active keys. Disable one first.", 409)
        try:
            try:
                await ctx.gateway.set_key_disabled(key_id, disabled)
            except GatewayError as error:
                gateway_fail(error)
            with ctx.store.connect() as con:
                con.execute("BEGIN IMMEDIATE")
                if disabled:
                    con.execute("UPDATE gateway_keys SET status='revoked',revoked_at=? WHERE gateway_key_id=? AND status='active'", (int(time.time()), key_id))
                else:
                    con.execute("UPDATE gateway_keys SET status='active',revoked_at=NULL WHERE gateway_key_id=? AND status='revoked'", (key_id,))
                if reservation is not None:
                    con.execute("DELETE FROM key_reservations WHERE id=?", (reservation,))
                ctx.store.audit(con, "admin.key_disabled" if disabled else "admin.key_enabled", admin["id"], key_id)
        finally:
            if reservation is not None:
                ctx.store.release_key_slot(reservation)
        return {"ok": True}

    @application.post(PREFIX + "/admin/keys/{key_id}/limits")
    async def admin_key_limits(key_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_key_id(key_id)
        limits = limits_from(await body_json(request))
        if not limits:
            fail("invalid_input", "Give at least one limit to change.", 422)
        ctx.require_gateway()
        try:
            await ctx.gateway.update_limits(key_id, limits)
        except GatewayError as error:
            gateway_fail(error)
        with ctx.store.connect() as con:
            ctx.store.audit(con, "admin.key_limits", admin["id"], key_id)
        return {"ok": True}

    @application.post(PREFIX + "/admin/keys/{key_id}/balance")
    async def admin_key_balance(key_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_key_id(key_id)
        body = await body_json(request)
        if (body.get("addUsd") is None) == (body.get("setUsd") is None):
            fail("invalid_input", "Give either addUsd or setUsd.", 422)
        amount = usd_amount(body["addUsd"], False) if body.get("addUsd") is not None else usd_amount(body["setUsd"], True)
        ctx.require_gateway()
        try:
            if body.get("addUsd") is not None:
                nano = await ctx.gateway.adjust_balance(key_id, add_usd=amount)
            else:
                nano = await ctx.gateway.adjust_balance(key_id, set_usd=amount)
        except GatewayError as error:
            gateway_fail(error)
        with ctx.store.connect() as con:
            ctx.store.audit(con, "admin.key_balance", admin["id"], key_id)
        return {"ok": True, "balanceUsd": usd_from_nano(nano)}

    @application.get(PREFIX + "/admin/gateway")
    async def admin_gateway(request: Request):
        ctx.current_user(request, admin=True)
        names = ("state", "nodes", "metrics")
        if not ctx.gateway.configured:
            return {"gatewayConfigured": False, **{name: None for name in names}, "errors": {name: "unconfigured" for name in names}}
        results = await asyncio.gather(ctx.gateway.state(), ctx.gateway.nodes(), ctx.gateway.metrics(), return_exceptions=True)
        body = {"gatewayConfigured": True, "errors": {}}
        for name, result in zip(names, results):
            failed = isinstance(result, BaseException)
            body[name] = None if failed else result
            body["errors"][name] = gateway_error_code(result) if failed else None
        return body

    @application.post(PREFIX + "/admin/gateway/models/{model_id:path}/toggle")
    async def admin_model_toggle(model_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_path(model_id, MODEL_ID)
        enabled = (await body_json(request)).get("enabled")
        if not isinstance(enabled, bool):
            fail("invalid_input", "Choose whether the model should be enabled.", 422)
        # The gateway only offers a flip, so read the current state first and flip only when it differs.
        # A change between this read and the flip is still possible; it is detected below.
        state = await ctx.gateway_call(ctx.gateway.state)
        models = state.get("models") if isinstance(state, dict) else None
        model = next((m for m in models if isinstance(m, dict) and m.get("id") == model_id), None) if isinstance(models, list) else None
        if model is None:
            fail("gateway_rejected", "Model not found.", 404)
        # The gateway treats a missing flag as enabled (/api/state reports None).
        if (model.get("enabled") is not False) == enabled:
            return {"id": model_id, "enabled": enabled, "changed": False}
        result = await ctx.gateway_call(ctx.gateway.toggle_model, model_id)
        ctx.audit("admin.model_toggled", admin, model_id, {"requested": enabled, "enabled": result.get("enabled")})
        if result.get("enabled") is not enabled:
            fail("state_changed", "The model changed while this request was in flight. Refresh and check its state.", 409)
        return dict(result, changed=True)

    @application.post(PREFIX + "/admin/gateway/models/{model_id:path}/maintenance")
    async def admin_model_maintenance(model_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_path(model_id, MODEL_ID)
        message = (await body_json(request)).get("message", "")
        if not isinstance(message, str) or len(message) > 300:
            fail("invalid_input", "The maintenance message must be text of at most 300 characters.", 422)
        result = await ctx.gateway_call(ctx.gateway.set_maintenance, model_id, message)
        with ctx.store.connect() as con:
            ctx.store.audit(con, "admin.model_maintenance", admin["id"], model_id)
        return result

    @application.post(PREFIX + "/admin/gateway/nodes/{name}/ops/{action}")
    async def admin_node_op(name: str, action: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_path(name, NODE_NAME)
        if action not in NODE_ACTIONS:
            fail("unknown_action", "That node action is not supported.")
        result = await ctx.gateway_call(ctx.gateway.node_op, name, action)
        with ctx.store.connect() as con:
            ctx.store.audit(con, "admin.node_op", admin["id"], f"{name}:{action}")
        return result

    @application.get(PREFIX + "/admin/gateway/nodes/{name}/jobs/{job_id}")
    async def admin_node_job(name: str, job_id: str, request: Request):
        ctx.current_user(request, admin=True)
        gateway_path(name, NODE_NAME)
        gateway_path(job_id, JOB_ID)
        return await ctx.gateway_call(ctx.gateway.node_job, name, job_id)
