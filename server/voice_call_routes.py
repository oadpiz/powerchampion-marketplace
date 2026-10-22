"""Call records for stores (M13-M17) and call quality for operators (A9-A16): phase2-contract.md §6, §7.

Store routes follow voice_merchant.py's order (contract §1.1): switch (404) -> sign-in (401) -> the caller's own
store (404 voice_store_not_found) -> body -> BEGIN IMMEDIATE with the account and store re-read there. A call is
always looked up together with that store id, so another store's call, a malformed id and an unknown id are all
404 call_not_found. M17 (content link) is a POST that reads: it refuses a temporary password but not a suspended
store (a suspended store may still look at its own records).

Operator routes follow admin_voice.py's order: admin first (401/403 whatever the switch says), then the switch
(404), then the body, then BEGIN IMMEDIATE with the admin re-checked before the path's resource (404), the fields
(400) and the state (409).

Content links (M17, A12) are counted per account from audit_events and the audit row is written under the same
lock, so the 60-per-hour limit cannot be passed by concurrent requests. Audit details hold counts, ids and enum
values only: never a note, a summary, a number, a token or a nonce (§1.6). A write that changes nothing is not
audited.
"""
import json
import re
import time
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse

from . import admin_voice as av
from . import voice_calls as vc
from . import voice_merchant as vm
from . import voice_store as vs
from .store import iso
from .support import PREFIX, body_json, fail

BODY_BYTES = 8192
MISSING = object()
STORE_OUTCOME_KEYS = vc.OUTCOMES
QUALITY_FLAG_FILTERS = ("any", "store", "auto", "none", "all")
QUALITY_REVIEWED_FILTERS = ("0", "1", "all")
# A9 `ref` (amended §7.1): the 8 hex characters a store reads out as its call ID (CallItem.ref, the id's first 8).
CALL_REF = re.compile(r"[a-f0-9]{8}")
LISTENING_NOT_FOUND = "This entry no longer exists. Reload the page."
MEDIA_UNAVAILABLE = "Viewing call content is not available yet."
NUMBER_IN_NOTE = "Do not put phone numbers in the note."

QUALITY_SELECT = (
    "SELECT c.*, s.name AS store_name, s.retention_days AS store_retention_days, r.score AS review_score, "
    "r.labels AS review_labels, r.note AS review_note, r.status AS review_status, r.reviewer_id AS review_reviewer_id, "
    "u.email AS review_reviewer_email, r.updated_at AS review_updated_at FROM voice_calls c "
    "LEFT JOIN voice_stores s ON s.id=c.store_id LEFT JOIN voice_call_reviews r ON r.call_row_id=c.id "
    "LEFT JOIN users u ON u.id=r.reviewer_id")
OPEN_REVIEW = "(r.status IS NULL OR r.status='open')"
HAS_STORE_FLAG = "c.store_flag_kind IS NOT NULL"
HAS_AUTO_FLAG = "c.auto_flags <> '[]'"


def _query(request, name, allowed=None):
    value = request.query_params.get(name)
    if value is not None and allowed is not None and value not in allowed:
        fail("invalid_input", "Enter a valid %s." % name)
    return value


def _month(request, *, default):
    value = request.query_params.get("month")
    if value is None:
        return vc.month_bounds(default) if default else None, default
    try:
        return vc.month_bounds(value), value
    except ValueError:
        fail("invalid_input", "Enter month as YYYY-MM.")


def _cursor(request):
    value = request.query_params.get("before")
    if value is None:
        return None
    try:
        return vc.parse_cursor(value)
    except ValueError:
        fail("invalid_input", "Enter a valid before cursor.")


def _page(rows, size):
    rows = list(rows)
    more = len(rows) > size
    rows = rows[:size]
    return rows, (vc.cursor_of(rows[-1]) if more and rows else None)


def _no_number(text, *, code="note_contains_number"):
    if vc.has_phone_number(text):
        fail(code, NUMBER_IN_NOTE)
    return text


def _multi_line(value, label, maximum):
    text = vm._multi_line(value, label)
    if len(text) > maximum:
        fail("invalid_input", "The %s can be up to %d characters." % (label, maximum))
    return text


def _review_fields(body):
    """A11 body (§7.3): score 1-5 and status are required; labels and note may be left out."""
    score = body.get("score", MISSING)
    if not vc._int_in(score, 1, 5):
        fail("invalid_input", "Choose a score from 1 to 5.")
    labels = body.get("labels", [])
    if (not isinstance(labels, list) or len(labels) > vc.REVIEW_LABELS_MAX or len(set(map(json.dumps, labels))) != len(labels)
            or not all(isinstance(label, str) and label in vc.REVIEW_LABELS for label in labels)):
        fail("invalid_input", "Choose up to %d different labels." % vc.REVIEW_LABELS_MAX)
    note = _no_number(_multi_line(body.get("note", ""), "note", vc.REVIEW_NOTE_CHARS))
    status = body.get("status", MISSING)
    if not isinstance(status, str) or status not in vc.REVIEW_STATUSES:
        fail("invalid_input", "Choose the status: open or done.")
    # Stored in the enum's order, so the same labels in another order are not a change.
    return {"score": score, "labels": [label for label in vc.REVIEW_LABELS if label in labels], "note": note, "status": status}


def _listening_fields(body):
    """A14/A15 body (§7.5, §4.3): every writable field must be sent."""
    title = vm._single_line(body.get("title", MISSING), "title", vc.LISTENING_TITLE_CHARS, required=True)
    kind = body.get("kind", MISSING)
    if not isinstance(kind, str) or kind not in vc.LISTENING_KINDS:
        fail("invalid_input", "Choose the kind: " + ", ".join(vc.LISTENING_KINDS) + ".")
    held_on = body.get("heldOn", MISSING)
    try:
        vs.taipei_day_start(held_on)
    except (TypeError, ValueError):
        fail("invalid_input", "Enter heldOn as a date (YYYY-MM-DD).")
    if not av.EARLIEST_DAY <= held_on <= av.LATEST_DAY:
        fail("invalid_input", "Enter heldOn between %s and %s." % (av.EARLIEST_DAY, av.LATEST_DAY))
    samples, raters = body.get("sampleCount", MISSING), body.get("raterCount", MISSING)
    if not vc._int_in(samples, 1, vc.LISTENING_SAMPLES_MAX):
        fail("invalid_input", "Enter sampleCount from 1 to %d." % vc.LISTENING_SAMPLES_MAX)
    if not vc._int_in(raters, 1, vc.LISTENING_RATERS_MAX):
        fail("invalid_input", "Enter raterCount from 1 to %d." % vc.LISTENING_RATERS_MAX)
    passed = body.get("passed", MISSING)
    if passed is not None and not isinstance(passed, bool):
        fail("invalid_input", "Send passed as true, false or null.")
    summary = _no_number(_multi_line(body.get("summary", MISSING), "summary", vc.LISTENING_SUMMARY_CHARS))
    report_ref = vm._single_line(body.get("reportRef", MISSING), "report reference", vc.LISTENING_REF_CHARS, required=False)
    return {"title": title, "kind": kind, "held_on": held_on, "sample_count": samples, "rater_count": raters,
            "passed": None if passed is None else (1 if passed else 0), "summary": summary, "report_ref": report_ref}


def _listening_audit(fields):
    return {"kind": fields["kind"], "sampleCount": fields["sample_count"], "raterCount": fields["rater_count"],
            "passed": None if fields["passed"] is None else bool(fields["passed"])}


def _listening_row(con, log_id):
    if not isinstance(log_id, str) or not vc.HEX32.fullmatch(log_id):
        return None
    return con.execute("SELECT l.*, u.email AS created_by_email FROM voice_listening_logs l "
                       "LEFT JOIN users u ON u.id=l.created_by WHERE l.id=?", (log_id,)).fetchone()


def _review_status(con, row_id):
    row = con.execute("SELECT status FROM voice_call_reviews WHERE call_row_id=?", (row_id,)).fetchone()
    return row["status"] if row else None


def _sign_link(settings, row, *, user_id, role, store_retention_days, now):
    """M17/A12 after the checks: (media JSON, kinds). Called inside the writer lock, before the audit row."""
    kinds = vc.content_kinds(row, store_retention_days, now)
    token, payload = vc.sign_media_token(settings.voice_media_secret, call_id=row["call_id"], store_id=row["store_id"],
                                         kinds=kinds, sub=user_id, role=role, now=now)
    origin = settings.voice_media_origin
    return {"token": token, "expiresAt": iso(payload["exp"]), "kinds": payload["kinds"],
            "urls": {kind: vc.media_url(origin, row["call_id"], kind) for kind in payload["kinds"]}}, payload["kinds"]


def _check_content(settings, row, store_retention_days, con, user_id, now, *, store_view=False):
    """§6.5 order after call_not_found: 503 -> 404 unavailable -> 410 expired -> 429 limit.

    For a store (M17, `store_view`) two more refusals keep another store's caller out of reach (amended §6.5): the
    two sources disagree on the dialed number -> 404 call_content_unavailable (the content kept under this call_id
    may be another call's), and an edge call the records sender has not reported yet -> 409 call_content_pending
    (until then the store comes from the orchestrator's number only). An operator (A12) sees every store's calls."""
    if not settings.voice_media_available:
        fail("voice_media_unavailable", MEDIA_UNAVAILABLE, 503)
    if not row["content_expected"] or (store_view and "dialed" in json.loads(row["mismatch"])):
        fail("call_content_unavailable", "No content was kept for this call.", 404)
    if not vc.content_kinds(row, store_retention_days, now):
        fail("call_content_expired", "The content is past its retention period and can no longer be viewed.", 410)
    if store_view and row["entry"] != "try" and row["report_records_sha256"] is None:
        fail("call_content_pending", "The content is still being processed. Try again in a few minutes.", 409)
    if vc.content_links_used(con, user_id, now) >= vc.CONTENT_LINKS_PER_HOUR:
        fail("voice_content_link_limit", "Too many views. Try again in an hour.", 429)


def attach_voice_calls(application, ctx):
    store = ctx.store
    mine = PREFIX + "/me/voice/calls"
    quality = PREFIX + "/admin/voice/quality"

    # ------------------------------------------------------------ store owner

    def owner(request):
        if not ctx.settings.voice_enabled:
            fail("not_found", vm.NOT_FOUND_DETAIL, 404)
        return ctx.current_user(request)

    def own_store(con, user):
        row = vs.store_by_owner(con, user["id"])
        if row is None:
            fail("voice_store_not_found", vm.STORE_NOT_FOUND, 404)
        return row

    def own_call(con, store_row, row_id):
        row = vc.get_call(con, row_id)
        if row is None or row["store_id"] != store_row["id"]:
            fail("call_not_found", vc.CALL_NOT_FOUND, 404)
        return row

    def owner_lock(con, user, *, refuse_suspended=True):
        """BEGIN IMMEDIATE, then the account and the store as they are now (voice_merchant.write_lock)."""
        con.execute("BEGIN IMMEDIATE")
        account = con.execute("SELECT disabled_at, password_change_required_at FROM users WHERE id=?", (user["id"],)).fetchone()
        if account is None or account["disabled_at"] is not None:
            fail("auth_required", "Sign in to continue.", 401)
        if account["password_change_required_at"] is not None:
            fail("password_change_required", vm.PASSWORD_CHANGE_REQUIRED, 403)
        row = own_store(con, user)
        if refuse_suspended and row["status"] == "suspended":
            fail("store_suspended", vm.STORE_SUSPENDED, 409)
        return row

    def precheck(user):
        with store.connect() as con:
            own_store(con, user)

    # M13
    @application.get(mine)
    async def voice_calls_list(request: Request):
        user = owner(request)
        with store.connect() as con:
            store_row = own_store(con, user)
            (start, end), month = _month(request, default=vc.taipei_month(int(time.time())))
            outcome = _query(request, "outcome", vc.OUTCOMES)
            flagged = _query(request, "flagged", ("1",))
            cursor = _cursor(request)
            where, args = ["store_id=?", "started_at>=?", "started_at<?"], [store_row["id"], start, end]
            if outcome:
                where.append("outcome=?")
                args.append(outcome)
            if flagged:
                where.append("store_flag_kind IS NOT NULL")
            if cursor:
                where.append("(started_at<? OR (started_at=? AND id<?))")
                args += [cursor[0], cursor[0], cursor[1]]
            rows = con.execute("SELECT * FROM voice_calls WHERE " + " AND ".join(where) + " ORDER BY started_at DESC, id DESC "
                               "LIMIT %d" % (vc.STORE_PAGE_SIZE + 1), tuple(args)).fetchall()
            totals = con.execute("SELECT outcome, COUNT(*) AS calls, SUM(meter_units) AS units, "
                                 "SUM(CASE WHEN store_flag_kind IS NOT NULL THEN 1 ELSE 0 END) AS flagged FROM voice_calls "
                                 "WHERE store_id=? AND started_at>=? AND started_at<? GROUP BY outcome",
                                 (store_row["id"], start, end)).fetchall()
        page, next_cursor = _page(rows, vc.STORE_PAGE_SIZE)
        by_outcome = {key: 0 for key in STORE_OUTCOME_KEYS}
        for total in totals:
            by_outcome[total["outcome"]] = int(total["calls"])
        summary = {"month": month, "total": sum(by_outcome.values()), "byOutcome": by_outcome,
                   "meterUnits": sum(int(total["units"] or 0) for total in totals),
                   "flagged": sum(int(total["flagged"] or 0) for total in totals)}
        return {"calls": [vc.call_item(row) for row in page], "next": next_cursor, "summary": summary,
                "limits": dict(vc.STORE_LIMITS)}

    # M14
    @application.get(mine + "/{row_id}")
    async def voice_call_detail(row_id: str, request: Request):
        user = owner(request)
        with store.connect() as con:
            store_row = own_store(con, user)
            row = own_call(con, store_row, row_id)
            return vc.call_detail(row, store_row["retention_days"], int(time.time()), ctx.settings.voice_media_available,
                                  _review_status(con, row["id"]))

    # M15
    @application.post(mine + "/{row_id}/flag")
    async def voice_call_flag(row_id: str, request: Request):
        user = owner(request)
        precheck(user)
        body = await body_json(request, BODY_BYTES)
        with store.connect() as con:
            store_row = owner_lock(con, user)
            row = own_call(con, store_row, row_id)
            kind = body.get("kind", MISSING)
            if not isinstance(kind, str) or kind not in vc.FLAG_KINDS:
                fail("invalid_input", "Choose the kind: wrong_answer.")
            note = _no_number(vm._single_line(body.get("note", ""), "note", vc.FLAG_NOTE_CHARS, required=False))
            status = _review_status(con, row["id"])
            if row["store_flag_kind"] == kind and (row["store_flag_note"] or "") == note:
                return {"changed": False, "flag": vc.store_flag_json(row, status)}
            now = int(time.time())
            con.execute("UPDATE voice_calls SET store_flag_kind=?, store_flag_note=?, store_flagged_at=?, store_flagged_by=? "
                        "WHERE id=?", (kind, note, now, user["id"], row["id"]))
            store.audit(con, "voice.call_flagged", user["id"], row["id"], {"kind": kind, "noteChars": len(note)})
            return {"changed": True, "flag": vc.store_flag_json(vc.get_call(con, row["id"]), status)}

    # M16
    @application.delete(mine + "/{row_id}/flag")
    async def voice_call_unflag(row_id: str, request: Request):
        user = owner(request)
        with store.connect() as con:
            store_row = owner_lock(con, user)
            row = own_call(con, store_row, row_id)
            if row["store_flag_kind"] is None:
                return {"changed": False}
            con.execute("UPDATE voice_calls SET store_flag_kind=NULL, store_flag_note=NULL, store_flagged_at=NULL, "
                        "store_flagged_by=NULL WHERE id=?", (row["id"],))
            store.audit(con, "voice.call_unflagged", user["id"], row["id"], {"kind": row["store_flag_kind"]})
            return {"changed": True}

    # M17
    @application.post(mine + "/{row_id}/content-link")
    async def voice_call_content_link(row_id: str, request: Request):
        user = owner(request)
        precheck(user)
        await body_json(request, BODY_BYTES)
        settings = ctx.settings
        with store.connect() as con:
            store_row = owner_lock(con, user, refuse_suspended=False)
            row = own_call(con, store_row, row_id)
            now = int(time.time())
            _check_content(settings, row, store_row["retention_days"], con, user["id"], now, store_view=True)
            media, kinds = _sign_link(settings, row, user_id=user["id"], role="store",
                                      store_retention_days=store_row["retention_days"], now=now)
            store.audit(con, "voice.call_content_link", user["id"], row["id"], {"kinds": kinds, "storeId": row["store_id"]})
        return {"media": media}

    # ------------------------------------------------------------ operators

    def admin(request):
        user = ctx.current_user(request, admin=True)
        if not ctx.settings.voice_enabled:
            fail("not_found", vm.NOT_FOUND_DETAIL, 404)
        return user

    def admin_lock(con, user):
        con.execute("BEGIN IMMEDIATE")
        me = con.execute("SELECT role, disabled_at FROM users WHERE id=?", (user["id"],)).fetchone()
        if not me or me["role"] != "admin" or me["disabled_at"] is not None:
            fail("admin_required", av.ADMIN_REQUIRED, 403)

    def quality_row(con, row_id):
        row = None
        if isinstance(row_id, str) and vc.HEX32.fullmatch(row_id):
            row = con.execute(QUALITY_SELECT + " WHERE c.id=?", (row_id,)).fetchone()
        if row is None:
            fail("call_not_found", "This call does not exist.", 404)
        return row

    def listening_or_404(con, log_id):
        row = _listening_row(con, log_id)
        if row is None:
            fail("listening_not_found", LISTENING_NOT_FOUND, 404)
        return row

    # A9
    @application.get(quality + "/calls")
    async def quality_calls(request: Request):
        admin(request)
        store_id = _query(request, "store")
        if store_id is not None and not vc.HEX32.fullmatch(store_id):
            fail("invalid_input", "Enter a valid store.")
        ref = _query(request, "ref")
        if ref is not None and not CALL_REF.fullmatch(ref):
            fail("invalid_input", "Enter a call ID: 8 characters, 0-9 and a-f.")
        # Looking up the call a store quotes: the default "flagged, to review" would hide most calls.
        flag = _query(request, "flag", QUALITY_FLAG_FILTERS) or ("all" if ref else "any")
        reviewed = _query(request, "reviewed", QUALITY_REVIEWED_FILTERS) or ("all" if ref else "0")
        bounds, _ = _month(request, default=None)
        outcome = _query(request, "outcome", vc.OUTCOMES)
        entry = _query(request, "entry", vc.ENTRIES)
        cursor = _cursor(request)
        where, args = [], []
        if ref:
            where.append("c.id LIKE ?")
            args.append(ref + "%")
        if store_id:
            where.append("c.store_id=?")
            args.append(store_id)
        where += {"any": ["(%s OR %s)" % (HAS_STORE_FLAG, HAS_AUTO_FLAG)], "store": [HAS_STORE_FLAG], "auto": [HAS_AUTO_FLAG],
                  "none": ["c.store_flag_kind IS NULL", "c.auto_flags = '[]'"], "all": []}[flag]
        where += {"0": [OPEN_REVIEW], "1": ["r.status='done'"], "all": []}[reviewed]
        if bounds:
            where += ["c.started_at>=?", "c.started_at<?"]
            args += list(bounds)
        if outcome:
            where.append("c.outcome=?")
            args.append(outcome)
        if entry:
            where.append("c.entry=?")
            args.append(entry)
        if cursor:
            where.append("(c.started_at<? OR (c.started_at=? AND c.id<?))")
            args += [cursor[0], cursor[0], cursor[1]]
        sql = QUALITY_SELECT + (" WHERE " + " AND ".join(where) if where else "")
        with store.connect() as con:
            rows = con.execute(sql + " ORDER BY c.started_at DESC, c.id DESC LIMIT %d" % (vc.QUALITY_PAGE_SIZE + 1), tuple(args)).fetchall()
            counts = con.execute(
                "SELECT SUM(CASE WHEN %s THEN 1 ELSE 0 END) AS store_open, SUM(CASE WHEN %s THEN 1 ELSE 0 END) AS auto_open "
                "FROM voice_calls c LEFT JOIN voice_call_reviews r ON r.call_row_id=c.id WHERE %s"
                % (HAS_STORE_FLAG, HAS_AUTO_FLAG, OPEN_REVIEW)).fetchone()
        page, next_cursor = _page(rows, vc.QUALITY_PAGE_SIZE)
        return {"calls": [vc.quality_item(row) for row in page], "next": next_cursor,
                "counts": {"storeFlaggedOpen": int(counts["store_open"] or 0), "autoFlaggedOpen": int(counts["auto_open"] or 0)},
                "limits": dict(vc.QUALITY_LIMITS)}

    # A10
    @application.get(quality + "/calls/{row_id}")
    async def quality_call(row_id: str, request: Request):
        admin(request)
        with store.connect() as con:
            row = quality_row(con, row_id)
            return vc.quality_detail(row, row["store_retention_days"], int(time.time()), ctx.settings.voice_media_available)

    # A11
    @application.post(quality + "/calls/{row_id}/review")
    async def quality_review(row_id: str, request: Request):
        user = admin(request)
        body = await body_json(request, BODY_BYTES)
        with store.connect() as con:
            admin_lock(con, user)
            row = quality_row(con, row_id)
            fields = _review_fields(body)
            current = con.execute("SELECT * FROM voice_call_reviews WHERE call_row_id=?", (row["id"],)).fetchone()
            labels = vc.canonical(fields["labels"]).decode("utf-8")
            stored = {"score": fields["score"], "labels": labels, "note": fields["note"], "status": fields["status"]}
            changed = [key for key in ("score", "labels", "note", "status") if current is None or current[key] != stored[key]]
            now = int(time.time())
            if changed:
                if current is None:
                    con.execute("INSERT INTO voice_call_reviews (call_row_id,score,labels,note,status,reviewer_id,created_at,updated_at) "
                                "VALUES (?,?,?,?,?,?,?,?)", (row["id"], fields["score"], labels, fields["note"], fields["status"],
                                                            user["id"], now, now))
                else:
                    con.execute("UPDATE voice_call_reviews SET score=?, labels=?, note=?, status=?, reviewer_id=?, updated_at=? "
                                "WHERE call_row_id=?", (fields["score"], labels, fields["note"], fields["status"], user["id"], now, row["id"]))
                store.audit(con, "admin.voice_call_reviewed", user["id"], row["id"],
                            {"score": fields["score"], "labels": fields["labels"], "status": fields["status"],
                             "noteChars": len(fields["note"]), "changed": changed})
            review = vc.quality_item(quality_row(con, row["id"]))["review"]
        return {"changed": bool(changed), "review": review}

    # A12
    @application.post(quality + "/calls/{row_id}/content-link")
    async def quality_content_link(row_id: str, request: Request):
        user = admin(request)
        await body_json(request, BODY_BYTES)
        settings = ctx.settings
        with store.connect() as con:
            admin_lock(con, user)
            row = quality_row(con, row_id)
            now = int(time.time())
            _check_content(settings, row, row["store_retention_days"], con, user["id"], now)
            media, kinds = _sign_link(settings, row, user_id=user["id"], role="admin",
                                      store_retention_days=row["store_retention_days"], now=now)
            store.audit(con, "admin.voice_call_content_link", user["id"], row["id"], {"kinds": kinds, "storeId": row["store_id"]})
        return {"media": media}

    # A13
    @application.get(quality + "/listening")
    async def listening_logs(request: Request):
        admin(request)
        with store.connect() as con:
            rows = con.execute("SELECT l.*, u.email AS created_by_email FROM voice_listening_logs l "
                               "LEFT JOIN users u ON u.id=l.created_by").fetchall()
        # Sorted here so both databases agree (newest held_on first, then newest created).
        rows = sorted(rows, key=lambda row: (row["held_on"], row["created_at"], row["id"]), reverse=True)
        return {"logs": [vc.listening_json(row) for row in rows]}

    # A14
    @application.post(quality + "/listening")
    async def listening_create(request: Request):
        user = admin(request)
        body = await body_json(request, BODY_BYTES)
        with store.connect() as con:
            admin_lock(con, user)
            fields = _listening_fields(body)
            if con.execute("SELECT COUNT(*) FROM voice_listening_logs").fetchone()[0] >= vc.LISTENING_MAX:
                fail("listening_limit", "Up to %d entries. Delete old ones first." % vc.LISTENING_MAX, 409)
            now, log_id = int(time.time()), uuid.uuid4().hex
            values = dict(fields, id=log_id, created_by=user["id"], created_at=now, updated_at=now)
            names = sorted(values)
            con.execute("INSERT INTO voice_listening_logs (" + ",".join(names) + ") VALUES (" + ",".join("?" * len(names)) + ")",
                        tuple(values[name] for name in names))
            store.audit(con, "admin.voice_listening_created", user["id"], log_id, _listening_audit(fields))
            payload = {"log": vc.listening_json(_listening_row(con, log_id))}
        return JSONResponse(payload, status_code=201)

    # A15
    @application.post(quality + "/listening/{log_id}")
    async def listening_update(log_id: str, request: Request):
        user = admin(request)
        body = await body_json(request, BODY_BYTES)
        with store.connect() as con:
            admin_lock(con, user)
            current = listening_or_404(con, log_id)
            fields = _listening_fields(body)
            if all(current[key] == value for key, value in fields.items()):
                return {"changed": False, "log": vc.listening_json(current)}
            names = sorted(fields)
            con.execute("UPDATE voice_listening_logs SET " + ",".join(name + "=?" for name in names) + ",updated_at=? WHERE id=?",
                        tuple(fields[name] for name in names) + (int(time.time()), current["id"]))
            store.audit(con, "admin.voice_listening_updated", user["id"], current["id"], _listening_audit(fields))
            return {"changed": True, "log": vc.listening_json(_listening_row(con, current["id"]))}

    # A16
    @application.delete(quality + "/listening/{log_id}")
    async def listening_delete(log_id: str, request: Request):
        user = admin(request)
        with store.connect() as con:
            admin_lock(con, user)
            current = listening_or_404(con, log_id)
            con.execute("DELETE FROM voice_listening_logs WHERE id=?", (current["id"],))
            store.audit(con, "admin.voice_listening_deleted", user["id"], current["id"],
                        _listening_audit({"kind": current["kind"], "sample_count": current["sample_count"],
                                          "rater_count": current["rater_count"], "passed": current["passed"]}))
        return {"ok": True}
