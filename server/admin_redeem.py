"""Admin redeem-code routes: issue, list, disable, CSV export, proxied to the gateway's /api/redeem.

Plaintext codes exist only in the gateway's issue response and in this route's 201 response. They are
never written to the database, the audit log or a log line, and the list and export carry only ids/hashes."""
import csv
import io
import math
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import Request
from fastapi.responses import JSONResponse

from .gateway import CODE_ID, REDEEM_CSV_HEADER, GatewayError
from .support import (PREFIX, body_json, fail, gateway_fail, gateway_path, normalized_label, owner_json, owners_by_gateway_key_id, safe_iso,
                      text_value, usd_from_nano)

REDEEM_CODE_NOT_FOUND = ("redeem_code_not_found", "This code does not exist or is already disabled.")
MAX_CODE_USD = Decimal("1000")
MAX_BATCH = 500
MAX_EXPIRES_DAYS = 3650
LIST_LIMIT = 1000
UNCONFIRMED = ("unavailable", "invalid_response", "response_limit")
UNCONFIRMED_WINDOW = 1800
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _invalid(detail):
    fail("invalid_input", detail, 422)


def _amount(raw):
    try:
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            raise ValueError
        amount = Decimal(str(raw))
        if not amount.is_finite() or amount <= 0 or amount > MAX_CODE_USD or amount != amount.quantize(Decimal("0.01")):
            raise ValueError
    except (InvalidOperation, ValueError):
        _invalid("Enter an amount above 0 and at most 1,000 USD per code, with at most two decimals.")
    return amount


def _number(value):
    return None if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) else value


def _text(value):
    return value if isinstance(value, str) else None


def _status(item, now):
    # Same order as the gateway's redeem(): redeemed, then disabled, then expired.
    if item.get("redeemed_at") is not None:
        return "redeemed"
    if item.get("disabled_at") is not None:
        return "disabled"
    expires = _number(item.get("expires_at"))
    if expires is not None and expires <= now:
        return "expired"
    return "active"


def _cell(value):
    # Spreadsheet formula injection: a leading = + - @ tab or CR makes Excel/Sheets evaluate the cell.
    return "'" + value if value.startswith(FORMULA_PREFIXES) else value


def attach_admin_redeem(application, ctx):
    base = PREFIX + "/admin/redeem/codes"

    @application.get(base)
    async def admin_redeem_codes(request: Request):
        ctx.current_user(request, admin=True)
        counts = {"active": 0, "redeemed": 0, "disabled": 0, "expired": 0}
        if not ctx.gateway.configured:
            return {"gatewayConfigured": False, "codes": [], "total": 0, "counts": counts, "truncated": False}
        items = await ctx.gateway_call(ctx.gateway.list_redeem_codes)
        with ctx.store.connect() as con:
            owners = owners_by_gateway_key_id(con)
        now = time.time()
        codes = []
        for item in items:
            status = _status(item, now)
            counts[status] += 1
            redeemer = _text(item.get("redeemed_by_key_id"))
            # An explicit whitelist: nothing else the gateway sends (a plaintext code, say) is passed on.
            codes.append({"codeId": _text(item.get("code_id")), "amountUsd": usd_from_nano(item.get("nano_usd")), "label": _text(item.get("label")),
                          "createdAt": safe_iso(item.get("created_at")), "createdBy": _text(item.get("created_by")),
                          "redeemedAt": safe_iso(item.get("redeemed_at")), "redeemedByKeyId": redeemer,
                          "redeemedBy": owner_json(owners.get(redeemer)) if redeemer else None,
                          "disabledAt": safe_iso(item.get("disabled_at")), "expiresAt": safe_iso(item.get("expires_at")), "status": status,
                          "_sort": _number(item.get("created_at")) or 0})
        codes.sort(key=lambda code: code.pop("_sort"), reverse=True)
        return {"gatewayConfigured": True, "codes": codes[:LIST_LIMIT], "total": len(codes), "counts": counts, "truncated": len(codes) > LIST_LIMIT}

    @application.post(base)
    async def admin_redeem_issue(request: Request):
        admin = ctx.current_user(request, admin=True)
        body = await body_json(request)
        amount = _amount(body.get("amountUsd"))
        count = body.get("count")
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_BATCH:
            _invalid("Issue from 1 to 500 codes per batch.")
        # Required: the label is how a batch is reconciled later.
        label = text_value(body.get("label"), "batch label", 80)
        acknowledged = body.get("acknowledgeUnconfirmed", False)
        if not isinstance(acknowledged, bool):
            _invalid("acknowledgeUnconfirmed must be true or false.")
        expires_days = body.get("expiresDays")
        if expires_days is not None and (isinstance(expires_days, bool) or not isinstance(expires_days, int) or not 1 <= expires_days <= MAX_EXPIRES_DAYS):
            _invalid("Expiry must be from 1 to 3,650 days, or none.")
        ctx.require_gateway()
        if not acknowledged:
            # After an unconfirmed issue, codes with this label may exist that nobody has seen. Retrying blindly
            # would leave a second, live batch; the admin must check the list (and disable those) first.
            # Labels are compared on a normalised key, so "Promo", " promo " and an NFD spelling all match.
            with ctx.store.connect() as con:
                recent = con.execute("SELECT target_id FROM audit_events WHERE action='admin.redeem_codes_issue_unconfirmed' AND created_at>?",
                                     (int(time.time()) - UNCONFIRMED_WINDOW,)).fetchall()
            key = normalized_label(label)
            if any(row["target_id"] and normalized_label(row["target_id"]) == key for row in recent):
                fail("redeem_issue_unconfirmed_recent", "A recent issue with this label was not confirmed by the gateway. Check the list for codes with "
                     "this label and disable them, then retry with acknowledgeUnconfirmed.", 409)
        amount_text = f"{amount:.2f}"
        try:
            codes = await ctx.gateway.issue_redeem_codes(amount_usd=amount, count=count, label=label, expires_days=expires_days)
        except GatewayError as error:
            if error.code in UNCONFIRMED:
                # The gateway may have created codes that nobody saw: leave a trace for reconciliation.
                ctx.audit("admin.redeem_codes_issue_unconfirmed", admin, label, {"count": count, "amountUsd": amount_text})
            gateway_fail(error)
        except ValueError:
            _invalid("Check the request details.")
        details = {"count": count, "amountUsd": amount_text, "expiresDays": expires_days, "codeIds": [code["code_id"] for code in codes]}
        if acknowledged:
            details["acknowledgedUnconfirmed"] = True
        ctx.audit("admin.redeem_codes_issued", admin, label, details)
        return JSONResponse({"codes": [{"code": code["code"], "codeId": code["code_id"], "amountUsd": usd_from_nano(code["nano_usd"])} for code in codes],
                             "count": count, "amountUsd": amount_text, "label": label, "expiresDays": expires_days}, status_code=201)

    @application.post(base + "/{code_id}/disable")
    async def admin_redeem_disable(code_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_path(code_id, CODE_ID)
        await ctx.gateway_call(ctx.gateway.disable_redeem_code, code_id, not_found=REDEEM_CODE_NOT_FOUND)
        ctx.audit("admin.redeem_code_disabled", admin, code_id)
        return {"ok": True, "codeId": code_id}

    @application.get(base + "/export")
    async def admin_redeem_export(request: Request):
        admin = ctx.current_user(request, admin=True)
        rows = await ctx.gateway_call(ctx.gateway.redeem_code_rows)
        out = io.StringIO()
        writer = csv.writer(out, lineterminator="\r\n")
        writer.writerow(REDEEM_CSV_HEADER)
        for row in rows:
            writer.writerow([_cell(value) for value in row])
        ctx.audit("admin.redeem_codes_exported", admin, None, {"rows": len(rows)})
        return {"filename": "redeem_codes-" + datetime.now(timezone.utc).strftime("%Y%m%d") + ".csv", "csv": out.getvalue(), "rows": len(rows)}
