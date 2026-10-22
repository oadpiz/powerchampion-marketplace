"""Operator (營運) phone-agent routes: phase1-contract.md §4, A1-A8 (with amendments A1-A9); A7 and A8 refuse
changing or deleting a number that calls refer to (phase2-contract.md §4.4, 409 number_in_use).

Every route, in this order (contract §1.1, steps 1 and 2 swapped for /admin):
1. ctx.current_user(request, admin=True) -> 401 auth_required / 403 admin_required. server/test_routes.py requires
   every /admin route to refuse customers and anonymous callers this way, whatever the switches say;
2. PC_VOICE_ENABLED off -> 404 not_found with FastAPI's own detail, so for an admin "off" looks like a missing route
   (the /admin/voice page shows "feature off" on that 404);
3. body_json(request, BODY_BYTES) for routes with a body (DELETE reads none): the size is checked before parsing;
4. writes take BEGIN IMMEDIATE and first re-check that the caller is still an active admin (support.admin_target's
   rule: current_user() ran before the lock, so another admin may have demoted or disabled this one in between),
   then the resource in the path (404), the fields (400) and the route's state (404/409), so "check, then write"
   happens inside one lock: two openings of one email, or two overlapping periods of one number, cannot both win.

Opening a store (A2) follows allocation.py's engineer accounts (allocation.py:791-827, copied, not imported): a
new customer account with a one-time temporary password (only its hash is stored, password_change_required_at
is set) and the store are created in one transaction. An email that already has an account is 409
account_exists and is never linked: signup does not verify email ownership, so that account may be someone
else's. The temporary password is in this one response only.

Audit details (contract §1.6) hold ids, enum values, dates, the account email and the phone number: never the
store name, the contact name, a note or the temporary password. A write that changes nothing is not audited.
"""
import json
import secrets
import time
import uuid

from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from . import voice_merchant as vm
from . import voice_store as vs
from .security import clean_name, normalize_email, password_hash
from .store import iso
from .support import PREFIX, body_json, fail

BODY_BYTES = 8192  # the largest valid body (A2 or A6) is well under 2 KiB, even with every character escaped
TEMP_PASSWORD_BYTES = 18  # token_urlsafe(18) = 24 characters, within validate_password's 12..128 (allocation.py:488)
VERSIONS_SHOWN = 50
NOTE_CHARS = 80
# Dates an operator may enter for a number period. The epoch columns are 32-bit INTEGER on Postgres, and
# active_to is the day after activeUntil: 2038-01-01 00:00 Taipei is 2145888000 - 28800, still below 2**31.
EARLIEST_DAY = "2000-01-01"
LATEST_DAY = "2037-12-31"
DAY_SECONDS = 86400
# Industries with a template file of the same name (contract §4.2); any other industry has template_id NULL.
TEMPLATE_INDUSTRIES = ("clinic", "cram")

SAME = "same"
ALLOWED = "allowed"
# Contract §4.4, row = current status, column = target. SAME answers 200 {"changed": false} and is not audited;
# a string other than ALLOWED is the 409 error code. In phase 1 every change to live is live_requires_g2a.
TRANSITIONS = {
    "draft": {"draft": SAME, "testing": ALLOWED, "live": "live_requires_g2a", "suspended": ALLOWED},
    "testing": {"draft": ALLOWED, "testing": SAME, "live": "live_requires_g2a", "suspended": ALLOWED},
    "live": {"draft": "invalid_transition", "testing": "invalid_transition", "live": SAME, "suspended": ALLOWED},
    "suspended": {"draft": "invalid_transition", "testing": ALLOWED, "live": "live_requires_g2a", "suspended": SAME},
}
TRANSITION_DETAIL = {
    "live_requires_g2a": "Live is not allowed in phase 1; it needs the G2a launch gate.",
    "invalid_transition": "This status change is not allowed.",
}

ADMIN_REQUIRED = "Administrator access is required."
STORE_NOT_FOUND = "Store not found."
NUMBER_NOT_FOUND = "This number no longer exists. Reload the page."
ACCOUNT_EXISTS = ("This email already has an account. It is not linked: signup does not verify email ownership, "
                  "so that account may belong to someone else. Use another email, or look into that account first.")
MISSING = object()


# ---------------------------------------------------------------- JSON shapes


def _faqs_by_store(con, store_id=None):
    """{store id: [{question, answer, variants}]}: what vm._kb_chars counts (contract §5.2)."""
    sql = "SELECT store_id, question, answer, variants FROM voice_faqs"
    rows = con.execute(sql + " WHERE store_id=?", (store_id,)).fetchall() if store_id else con.execute(sql).fetchall()
    result = {}
    for row in rows:
        result.setdefault(row["store_id"], []).append(
            {"question": row["question"], "answer": row["answer"], "variants": json.loads(row["variants"])})
    return result


def _last_tries(con, store_id=None):
    """{store id: latest voice.try_issued time}, not limited to 24 hours (contract §1.6 "最後試打時間")."""
    sql = "SELECT target_id, MAX(created_at) AS last_at FROM audit_events WHERE action='voice.try_issued'"
    if store_id:
        rows = con.execute(sql + " AND target_id=? GROUP BY target_id", (store_id,)).fetchall()
    else:
        rows = con.execute(sql + " GROUP BY target_id").fetchall()
    return {row["target_id"]: row["last_at"] for row in rows}


def _store_rows(con, store_id=None):
    sql = ("SELECT s.*, u.email AS owner_email, u.name AS owner_name FROM voice_stores s "
           "JOIN users u ON u.id=s.owner_user_id")
    if store_id:
        return con.execute(sql + " WHERE s.id=?", (store_id,)).fetchall()
    # Sorted here, not in SQL, so SQLite and Postgres (collations) answer the same order.
    return sorted(con.execute(sql).fetchall(), key=lambda row: (-row["created_at"], row["id"]))


def _item(row, faqs, last_try):
    """StoreItem (contract §4): the C2 list columns plus what the detail and the dialogs need."""
    return {"id": row["id"], "name": row["name"], "industry": row["industry"], "status": row["status"],
            "owner": {"id": row["owner_user_id"], "email": row["owner_email"], "name": row["owner_name"]},
            "currentVersion": row["current_version"], "faqCount": len(faqs), "kbChars": vm._kb_chars(row["intro_text"], faqs),
            "lastTryAt": iso(last_try), "aiAnswerEnabled": bool(row["ai_answer_enabled"]),
            "recordingMode": row["recording_mode"], "createdAt": iso(row["created_at"]), "updatedAt": iso(row["updated_at"])}


def store_items(con):
    faqs, tries = _faqs_by_store(con), _last_tries(con)
    return [_item(row, faqs.get(row["id"], []), tries.get(row["id"])) for row in _store_rows(con)]


def store_item(con, store_id):
    rows = _store_rows(con, store_id)
    if not rows:
        return None
    return _item(rows[0], _faqs_by_store(con, store_id).get(store_id, []), _last_tries(con, store_id).get(store_id))


def _taipei_today():
    return vs.taipei_date(int(time.time()))


def _until(row):
    # active_to is exclusive (00:00 after the last day), so the last active day is one second earlier.
    return None if row["active_to"] is None else vs.taipei_date(row["active_to"] - 1)


def number_json(row, today):
    """Number (contract §4): dates are Taipei days; activeNow compares them with Taipei's today."""
    start, until = vs.taipei_date(row["active_from"]), _until(row)
    return {"id": row["id"], "number": row["number"], "storeId": row["store_id"], "storeName": row["store_name"],
            "purpose": row["purpose"], "channel": row["channel"], "activeFrom": start, "activeUntil": until,
            "note": row["note"], "activeNow": start <= today and (until is None or today <= until),
            "createdAt": iso(row["created_at"]), "updatedAt": iso(row["updated_at"])}


def _number_rows(con, *, store_id=None, number_id=None):
    sql = "SELECT n.*, s.name AS store_name FROM voice_numbers n LEFT JOIN voice_stores s ON s.id=n.store_id"
    if number_id:
        rows = con.execute(sql + " WHERE n.id=?", (number_id,)).fetchall()
    elif store_id:
        rows = con.execute(sql + " WHERE n.store_id=?", (store_id,)).fetchall()
    else:
        rows = con.execute(sql).fetchall()
    # Contract §4.5 order (number, then start), sorted here so both databases agree on "+" against "ext-".
    return sorted(rows, key=lambda row: (row["number"], row["active_from"], row["id"]))


def numbers_json(con, store_id=None):
    today = _taipei_today()
    return [number_json(row, today) for row in _number_rows(con, store_id=store_id)]


def _one_number(con, number_id):
    return number_json(_number_rows(con, number_id=number_id)[0], _taipei_today())


def _number_audit(row):
    """Contract §1.6: what changed hands, never the note."""
    return {"number": row["number"], "storeId": row["store_id"], "purpose": row["purpose"], "channel": row["channel"],
            "activeFrom": vs.taipei_date(row["active_from"]), "activeUntil": _until(row)}


def store_detail(con, store_id):
    """A3: StoreItem plus settings counts, the version history, the store's numbers and its try usage."""
    item = store_item(con, store_id)
    row = vs.get_store(con, store_id)
    versions = con.execute(
        "SELECT v.version, v.config_sha256, v.created_at, v.created_by, u.email AS created_by_email "
        "FROM voice_config_versions v LEFT JOIN users u ON u.id=v.created_by WHERE v.store_id=? "
        "ORDER BY v.version DESC LIMIT %d" % VERSIONS_SHOWN, (store_id,)).fetchall()
    used, last = vm._try_usage(con, store_id, int(time.time()))
    detail = dict(item, greeting=row["greeting"], afterHoursMode=row["after_hours_mode"], askCallback=row["ask_callback"],
                  maxMessageSeconds=row["max_message_seconds"], retentionDays=row["retention_days"],
                  hoursSegments=len(vs.get_hours(con, store_id)), closures=len(vs.get_closures(con, store_id)))
    return {"store": detail,
            "versions": [{"version": v["version"], "configSha256": v["config_sha256"], "createdAt": iso(v["created_at"]),
                          "createdBy": {"id": v["created_by"], "email": v["created_by_email"]} if v["created_by_email"] else None}
                         for v in versions],
            "numbers": numbers_json(con, store_id),
            "try": {"used24h": used, "lastIssuedAt": iso(last)}}


# ---------------------------------------------------------------- fields


def _store_fields(body):
    """A2 body in contract §4.2 order; every error is 400 invalid_input."""
    try:
        email = normalize_email(body.get("email"))
        display_name = clean_name(body.get("displayName"))
    except ValueError as error:
        fail("invalid_input", str(error))
    name = vm._store_name(body.get("storeName"))  # A1: one store-name rule, the one the owner's setup page uses
    industry = body.get("industry")
    if not isinstance(industry, str) or industry not in vs.INDUSTRIES:
        fail("invalid_input", "Choose the industry: " + ", ".join(vs.INDUSTRIES) + ".")
    return email, display_name, name, industry


def _day(body, key, *, nullable):
    """(YYYY-MM-DD, epoch of 00:00 Taipei) for a Taipei date, or (None, None) when null is allowed."""
    value = body.get(key, MISSING)
    if value is None and nullable:
        return None, None
    try:
        start = vs.taipei_day_start(value)
    except (TypeError, ValueError):
        fail("invalid_input", "Enter %s as a date (YYYY-MM-DD)." % key)
    if not EARLIEST_DAY <= value <= LATEST_DAY:
        fail("invalid_input", "Enter %s between %s and %s." % (key, EARLIEST_DAY, LATEST_DAY))
    return value, start


# A6 may leave these out (contract §4.6: storeId and activeUntil may be null, note may be empty); A7 replaces the
# whole row, so it must send them (§4.7). Verifier finding 2026-10-22: A6 refused a body without them.
NUMBER_OPTIONAL = {"storeId": None, "activeUntil": None, "note": ""}


def _number_fields(con, body, *, replace):
    """A6/A7 body in contract §4.6 order; `replace` is A7. storeId and activeUntil may be null. Returns
    voice_store.add_number's keyword arguments."""
    if replace:
        for key, empty in NUMBER_OPTIONAL.items():
            if key not in body:
                fail("invalid_input", "Send %s as well (%s for none): a change replaces the whole number." % (key, json.dumps(empty)))
    else:
        body = {**NUMBER_OPTIONAL, **body}
    number = body.get("number", MISSING)
    if not isinstance(number, str) or not vs.NUMBER.fullmatch(number):
        fail("invalid_number", "Use international format (e.g. +886227356688) or an extension such as ext-0001.")
    store_id = body.get("storeId", MISSING)
    if store_id is not None and not (isinstance(store_id, str) and vs.ID.fullmatch(store_id)):
        fail("invalid_input", "Choose a store, or none.")
    if store_id is not None and vs.get_store(con, store_id) is None:
        fail("voice_store_not_found", STORE_NOT_FOUND, 404)
    purpose = body.get("purpose", MISSING)
    if not isinstance(purpose, str) or purpose not in vs.PURPOSES:
        fail("invalid_input", "Choose the purpose: " + ", ".join(vs.PURPOSES) + ".")
    channel = body.get("channel", MISSING)
    if not isinstance(channel, str) or channel not in vs.CHANNELS:
        fail("invalid_input", "Choose the channel: " + ", ".join(vs.CHANNELS) + ".")
    first, active_from = _day(body, "activeFrom", nullable=False)
    last, last_start = _day(body, "activeUntil", nullable=True)
    if last is not None and last < first:
        fail("invalid_input", "activeUntil must be on or after activeFrom.")
    note = body.get("note", MISSING)
    note = vm._single_line(note, "note", NOTE_CHARS, required=False)
    # The last day counts in full: active_to is 00:00 of the next day (fixed UTC+8, every day is 86400 s).
    return {"number": number, "store_id": store_id, "purpose": purpose, "channel": channel, "active_from": active_from,
            "active_to": None if last is None else last_start + DAY_SECONDS, "note": note}


# Phase 2: columns a number row keeps once a call refers to it (only active_to and note may still change).
FIXED_ONCE_USED = ("number", "store_id", "purpose", "channel", "active_from")
NUMBER_IN_USE = ("This number already has %d call(s); only the end date and note can change. To move it to another "
                 "store, set an end date and add a new entry.")


def _calls_using(con, number_id):
    return int(con.execute("SELECT COUNT(*) FROM voice_calls WHERE number_id=?", (number_id,)).fetchone()[0])


# ---------------------------------------------------------------- routes


def attach_admin_voice(application, ctx):
    store = ctx.store
    base = PREFIX + "/admin/voice"

    def caller(request):
        admin = ctx.current_user(request, admin=True)
        # Read at call time: tests (and a restart with new settings) switch the feature without new routes.
        if not ctx.settings.voice_enabled:
            fail("not_found", vm.NOT_FOUND_DETAIL, 404)
        return admin

    def admin_lock(con, admin):
        """BEGIN IMMEDIATE, then the caller as they are now (contract §1.1 step 5.1; support.admin_target)."""
        con.execute("BEGIN IMMEDIATE")
        me = con.execute("SELECT role, disabled_at FROM users WHERE id=?", (admin["id"],)).fetchone()
        if not me or me["role"] != "admin" or me["disabled_at"] is not None:
            fail("admin_required", ADMIN_REQUIRED, 403)

    def store_or_404(con, store_id):
        row = vs.get_store(con, store_id)  # None for a malformed id too
        if row is None:
            fail("voice_store_not_found", STORE_NOT_FOUND, 404)
        return row

    def number_or_404(con, number_id):
        row = vs.get_number(con, number_id)
        if row is None:
            fail("number_not_found", NUMBER_NOT_FOUND, 404)
        return row

    # A1
    @application.get(base + "/stores")
    async def admin_voice_stores(request: Request):
        caller(request)
        with store.connect() as con:
            return {"stores": store_items(con)}

    # A2
    @application.post(base + "/stores")
    async def admin_voice_store_open(request: Request):
        admin = caller(request)
        body = await body_json(request, BODY_BYTES)
        # Hashed before the lock (scrypt is slow); only admins reach this line.
        password = secrets.token_urlsafe(TEMP_PASSWORD_BYTES)
        encoded = await run_in_threadpool(password_hash, password)
        user_id = uuid.uuid4().hex
        try:
            with store.connect() as con:
                admin_lock(con, admin)
                email, display_name, name, industry = _store_fields(body)
                if con.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                    fail("account_exists", ACCOUNT_EXISTS, 409)
                now = int(time.time())
                # The administrator sees this password, so the owner must replace it before any write (T4 M3-M12).
                con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at,password_change_required_at) "
                            "VALUES (?,?,?,?,?,?,?)", (user_id, email, display_name, encoded, "customer", now, now))
                template_id = industry if industry in TEMPLATE_INDUSTRIES else None
                row = vs.create_store(con, user_id, name, industry, template_id=template_id, now=now)
                store.audit(con, "admin.voice_store_created", admin["id"], row["id"],
                            {"userId": user_id, "email": email, "industry": industry})
                payload = {"store": store_item(con, row["id"]), "account": {"userId": user_id, "email": email},
                           "temporaryPassword": password}
        except store.IntegrityError:
            # A signup with this email raced the check above (signup does not take the writer lock). The whole
            # transaction is rolled back: no account and no store are left behind.
            fail("account_exists", ACCOUNT_EXISTS, 409)
        return JSONResponse(payload, status_code=201)

    # A3
    @application.get(base + "/stores/{store_id}")
    async def admin_voice_store(store_id: str, request: Request):
        caller(request)
        with store.connect() as con:
            store_or_404(con, store_id)
            return store_detail(con, store_id)

    # A4
    @application.post(base + "/stores/{store_id}/status")
    async def admin_voice_store_status(store_id: str, request: Request):
        admin = caller(request)
        body = await body_json(request, BODY_BYTES)
        with store.connect() as con:
            admin_lock(con, admin)
            row = store_or_404(con, store_id)
            target = body.get("status")
            if not isinstance(target, str) or target not in vs.STATUSES:
                fail("invalid_input", "Choose the status: " + ", ".join(vs.STATUSES) + ".")
            rule = TRANSITIONS[row["status"]][target]
            if rule == SAME:
                return {"changed": False, "store": store_item(con, store_id)}
            if rule != ALLOWED:
                fail(rule, TRANSITION_DETAIL[rule], 409)
            vs.update_store(con, store_id, {"status": target})
            store.audit(con, "admin.voice_store_status", admin["id"], store_id, {"from": row["status"], "to": target})
            return {"changed": True, "store": store_item(con, store_id)}

    # A5
    @application.get(base + "/numbers")
    async def admin_voice_numbers(request: Request):
        caller(request)
        with store.connect() as con:
            return {"numbers": numbers_json(con)}

    # A6
    @application.post(base + "/numbers")
    async def admin_voice_number_create(request: Request):
        admin = caller(request)
        body = await body_json(request, BODY_BYTES)
        with store.connect() as con:
            admin_lock(con, admin)
            fields = _number_fields(con, body, replace=False)
            row = vs.add_number(con, **fields)  # 409 number_overlap, checked under this lock
            store.audit(con, "admin.voice_number_created", admin["id"], row["id"], _number_audit(row))
            return JSONResponse({"number": _one_number(con, row["id"])}, status_code=201)

    # A7
    @application.post(base + "/numbers/{number_id}")
    async def admin_voice_number_update(number_id: str, request: Request):
        admin = caller(request)
        body = await body_json(request, BODY_BYTES)
        with store.connect() as con:
            admin_lock(con, admin)
            current = number_or_404(con, number_id)
            fields = _number_fields(con, body, replace=True)
            if all(current[column] == value for column, value in fields.items()):
                return {"number": _one_number(con, number_id)}
            # Phase 2 (phase2-contract §4.4): once calls point at this row, only the end date and the note may change;
            # moving it to another store or number would leave the old calls attributed to a row that no longer says so.
            calls = _calls_using(con, number_id)
            if calls and any(current[column] != fields[column] for column in FIXED_ONCE_USED):
                fail("number_in_use", NUMBER_IN_USE % calls, 409)
            row = vs.update_number(con, number_id, **fields)  # the overlap check ignores this row itself
            store.audit(con, "admin.voice_number_updated", admin["id"], number_id, _number_audit(row))
            return {"number": _one_number(con, number_id)}

    # A8
    @application.delete(base + "/numbers/{number_id}")
    async def admin_voice_number_delete(number_id: str, request: Request):
        admin = caller(request)
        with store.connect() as con:
            admin_lock(con, admin)
            row = number_or_404(con, number_id)
            calls = _calls_using(con, number_id)
            if calls:
                fail("number_in_use", NUMBER_IN_USE % calls, 409)
            vs.delete_number(con, number_id)
            store.audit(con, "admin.voice_number_deleted", admin["id"], number_id, _number_audit(row))
        return {"ok": True}
