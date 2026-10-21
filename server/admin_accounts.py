"""Admin account routes: overview, customers, credit reviews, account status/role/password, audit log."""
import time

from fastapi import Request
from fastapi.concurrency import run_in_threadpool

from .gateway import GatewayError
from .security import digest_token, password_hash, validate_password
from .store import credit_json, iso, user_json
from .support import PREFIX, admin_target, audit_details, body_json, fail, text_value


def attach_admin_accounts(application, ctx):
    @application.get(PREFIX + "/admin/overview")
    async def admin_overview(request: Request):
        ctx.current_user(request, admin=True)
        with ctx.store.connect() as con:
            customers = con.execute("SELECT COUNT(*) FROM users WHERE role='customer'").fetchone()[0]
            count = con.execute("SELECT COUNT(*) FROM gateway_keys WHERE status='active'").fetchone()[0]
            pending = con.execute("SELECT COUNT(*) FROM credit_requests WHERE status='pending'").fetchone()[0]
        return {"customerCount": customers, "keyCount": count, "pendingCreditCount": pending, "gatewayConfigured": bool(ctx.gateway.configured)}

    @application.get(PREFIX + "/admin/customers")
    async def admin_customers(request: Request):
        ctx.current_user(request, admin=True)
        with ctx.store.connect() as con:
            rows = con.execute("SELECT u.*, (SELECT COUNT(*) FROM gateway_keys k WHERE k.user_id=u.id AND status='active') AS key_count FROM users u ORDER BY created_at DESC,id LIMIT 1000").fetchall()
        return {"customers": [dict(user_json(row), keyCount=row["key_count"]) for row in rows]}

    @application.get(PREFIX + "/admin/credits")
    async def admin_credits(request: Request):
        ctx.current_user(request, admin=True)
        with ctx.store.connect() as con:
            rows = con.execute("SELECT c.*,u.email,u.name FROM credit_requests c JOIN users u ON u.id=c.user_id ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,c.created_at DESC,c.id LIMIT 1000").fetchall()
        return {"requests": [credit_json(row) for row in rows]}

    @application.post(PREFIX + "/admin/credits/{credit_id}/review")
    async def review_credit(credit_id: str, request: Request):
        user = ctx.current_user(request, admin=True)
        body = await body_json(request)
        decision = body.get("decision")
        if decision not in ("approve", "reject"):
            fail("invalid_input", "Choose approve or reject.")
        note = text_value(body.get("note", ""), "review note", 500, required=False)
        desired = "approved" if decision == "approve" else "rejected"
        with ctx.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT * FROM credit_requests WHERE id=?", (credit_id,)).fetchone()
            if not row:
                fail("credit_not_found", "Credit request not found.", 404)
            if row["status"] == desired:
                return {"request": credit_json(row)}
            if row["status"] != "pending":
                fail("already_reviewed", "This request has already been reviewed.", 409)
            con.execute("UPDATE credit_requests SET status=?,reviewed_at=?,reviewer_id=?,review_note=? WHERE id=? AND status='pending'", (desired, int(time.time()), user["id"], note, credit_id))
            ctx.store.audit(con, "credit." + desired, user["id"], credit_id)
            row = con.execute("SELECT * FROM credit_requests WHERE id=?", (credit_id,)).fetchone()
        return {"request": credit_json(row)}

    @application.post(PREFIX + "/admin/customers/{user_id}/status")
    async def admin_set_status(user_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        body = await body_json(request)
        action = body.get("action")
        if action not in ("disable", "enable"):
            fail("invalid_input", "Choose disable or enable.")
        revoked, failed = 0, 0
        if action == "disable":
            # Check caller and target without changing anything, then revoke over the network
            # outside any write lock; the account is disabled in the final transaction below.
            with ctx.store.connect() as con:
                admin_target(con, user_id, admin)
                active = con.execute("SELECT id, gateway_key_id FROM gateway_keys WHERE user_id=? AND status='active'", (user_id,)).fetchall()
            for key in active:
                try:
                    if not ctx.gateway.configured:
                        raise GatewayError("unconfigured")
                    await ctx.gateway.set_key_disabled(key["gateway_key_id"], True)
                except GatewayError:
                    failed += 1
                    with ctx.store.connect() as con:
                        ctx.store.audit(con, "key.revocation_needs_reconciliation", admin["id"], key["gateway_key_id"])
                    continue
                with ctx.store.connect() as con:
                    con.execute("UPDATE gateway_keys SET status='revoked',revoked_at=? WHERE id=? AND status='active'", (int(time.time()), key["id"]))
                    ctx.store.audit(con, "key.revoked", admin["id"], key["id"])
                revoked += 1
        with ctx.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = admin_target(con, user_id, admin)
            if action == "disable" and row["disabled_at"] is None:
                con.execute("UPDATE users SET disabled_at=? WHERE id=?", (int(time.time()), user_id))
                con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                ctx.store.audit(con, "admin.account_disabled", admin["id"], user_id)
            elif action == "enable" and row["disabled_at"] is not None:
                con.execute("UPDATE users SET disabled_at=NULL WHERE id=?", (user_id,))
                ctx.store.audit(con, "admin.account_enabled", admin["id"], user_id)
            row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return {"customer": user_json(row), "keysRevoked": revoked, "keysFailed": failed}

    @application.post(PREFIX + "/admin/customers/{user_id}/role")
    async def admin_set_role(user_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        body = await body_json(request)
        role = body.get("role")
        if role not in ("customer", "admin"):
            fail("invalid_input", "Choose customer or admin.")
        with ctx.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = admin_target(con, user_id, admin)
            if row["role"] != role:
                con.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
                ctx.store.audit(con, "admin.role_changed", admin["id"], user_id)
            row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return {"customer": user_json(row)}

    @application.post(PREFIX + "/admin/customers/{user_id}/reset-password")
    async def admin_reset_password(user_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        body = await body_json(request)
        try:
            password = validate_password(body.get("newPassword"))
        except ValueError as error:
            fail("invalid_input", str(error))
        encoded = await run_in_threadpool(password_hash, password)
        with ctx.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = admin_target(con, user_id, admin)
            # An administrator now knows this password: the user must replace it before an SSH key change.
            con.execute("UPDATE users SET password_hash=?,password_change_required_at=? WHERE id=?", (encoded, int(time.time()), user_id))
            con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            con.execute("DELETE FROM login_attempts WHERE scope=?", ("login:" + digest_token(row["email"]),))
            ctx.store.audit(con, "admin.password_reset", admin["id"], user_id)
        return {"ok": True}

    @application.get(PREFIX + "/admin/audit")
    async def audit(request: Request):
        ctx.current_user(request, admin=True)
        with ctx.store.connect() as con:
            rows = con.execute("SELECT a.*,u.email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 200").fetchall()
        return {"events": [{"id": row["id"], "action": row["action"], "actorEmail": row["email"], "targetId": row["target_id"], "createdAt": iso(row["created_at"]), "details": audit_details(row["details"])} for row in rows]}
