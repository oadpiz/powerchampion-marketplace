"""Store-owner (商家) phone-agent routes: phase1-contract.md §3, M1-M12, with amendments A1-A8.

Every route, in this order (contract §1.1):
1. PC_VOICE_ENABLED off -> 404 not_found with FastAPI's own detail, so "off" looks like a missing route;
2. ctx.current_user(request) -> 401;
3. the caller's own store, found by owner_user_id -> else 404 voice_store_not_found. A FAQ id is always looked
   up together with that store id, so another store's id, a malformed id and an unknown id are all
   404 faq_not_found: one store can never read or change another store's data;
4. body_json(request, maximum) for routes with a body (DELETE reads none);
5. writes (every POST and DELETE, publish, try and import dry runs included) take BEGIN IMMEDIATE and then check
   password_change_required (403), store_suspended (409), the fields (400), the route's state (409/503/429)
   and the capacity, so "check, then write" happens inside one lock (the try quota is counted and reserved
   there too). GET routes never block on a temporary password or a suspended store.

Audit details (contract §1.6) hold only counts, ids and enum values: never the store name, greeting,
description, questions, answers, CSV text, ticket or nonce. A write that changes nothing is not audited.
"""
import csv
import functools
import io
import json
import re
import time

from fastapi import Request
from fastapi.responses import JSONResponse

from . import voice_compile as vc
from . import voice_store as vs
from . import voice_ticket
from .store import iso
from .support import INVISIBLE_TEXT, PREFIX, UNSAFE_TEXT, body_json, fail

# A1 (2026-10-22): the store name is up to 20 characters, spaces not counted (the disclosure's fixed part is 30
# of the 67 the opening may have). The 40-code-point cap of voice_compile still applies on top.
STORE_NAME_NON_SPACE = 20
TRY_LIMIT = 20
TRY_WINDOW_SECONDS = 24 * 3600  # rolling 24 hours, not a calendar day (contract §1.5, §10 item 12)
CSV_BODY_BYTES = 196608  # the whole import request, 192 KiB (the BFF uses the same number)
CSV_ERRORS_MAX = 50
CSV_DETAIL_ROWS = 10

# GET /me/voice and GET /me/voice/setup return these (contract §1.5); the pages read limits from here.
LIMITS = {
    "storeNameChars": STORE_NAME_NON_SPACE,
    "greetingChars": vc.GREETING_CHARS,
    "openingNonSpaceMax": vc.OPENING_NON_SPACE_MAX,
    "openingSecondsMax": vc.OPENING_SECONDS_MAX,
    "charsPerSecond": vc.CHARS_PER_SECOND,
    "questionChars": vc.QUESTION_CHARS,
    "variantChars": vc.VARIANT_CHARS,
    "variantsMax": vc.VARIANTS_MAX,
    "faqChars": vc.FAQ_CHARS,
    "kbCharsMax": vc.KB_CHARS_MAX,
    "faqMax": vc.FAQ_MAX,
    "csvBodyBytes": CSV_BODY_BYTES,
    "hoursSegmentsPerDay": vc.HOURS_SEGMENTS_PER_DAY,
    "closuresMax": vc.CLOSURES_MAX,
    "closureNoteChars": vc.CLOSURE_NOTE_CHARS,
    "maxMessageSecondsMin": vc.MAX_MESSAGE_SECONDS_MIN,
    "maxMessageSecondsMax": vc.MAX_MESSAGE_SECONDS_MAX,
    "retentionDaysMax": vs.RETENTION_DAYS_MAX,
    "retentionDaysMaxFull": vs.RETENTION_DAYS_MAX_FULL,
    "tryLimit": TRY_LIMIT,
    "tryWindowHours": TRY_WINDOW_SECONDS // 3600,
    "ticketTtlSeconds": voice_ticket.TTL_SECONDS,
}

NOT_FOUND_DETAIL = "This portal endpoint is not available for this request."  # same as app.http_error
STORE_NOT_FOUND = "Phone agent is not set up for this account."
FAQ_NOT_FOUND = "This question no longer exists. Reload the page."
PASSWORD_CHANGE_REQUIRED = "Change the temporary password we gave you under Security before editing or trying a call."
STORE_SUSPENDED = "Phone agent is suspended for this store; it is read-only."

COMPILE_KEYS = ("id", "name", "greeting", "intro_text", "after_hours_mode", "ask_callback", "max_message_seconds",
                "handoff_mode", "recording_mode", "retention_days", "ai_answer_enabled")
# M3 writable fields in validation and response order (contract §3.3); API name -> voice_stores column.
SETUP_COLUMNS = {"name": "name", "greeting": "greeting", "introText": "intro_text", "afterHoursMode": "after_hours_mode",
                 "askCallback": "ask_callback", "maxMessageSeconds": "max_message_seconds",
                 "recordingMode": "recording_mode", "retentionDays": "retention_days"}
SETUP_ORDER = ("name", "greeting", "introText", "hours", "closures", "afterHoursMode", "askCallback",
               "maxMessageSeconds", "recordingMode", "retentionDays")
IMPORT_MODES = ("append", "replace")
# Every `problem` an M8 CSV check can report, in contract §5.5 order. lib/voice-faq.ts CSV_PROBLEMS must be the same
# list (server/test_voice_sync.py, tests/account-voice-faq.test.tsx).
CSV_PROBLEMS = ("header_invalid", "question_required", "answer_required", "question_too_long", "variant_too_long",
                "too_many_variants", "faq_too_long", "unsafe_text", "csv_unparseable")

TEMPLATE_ID = re.compile(r"[a-z][a-z0-9_-]{0,31}")
TEMPLATE_SCHEMA = "voice.template/v1"
# Variants in one CSV cell are separated like text-agent's ingest (contract §5.5).
VARIANT_SPLIT = re.compile(r"[|｜;；\n]")


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


# ---------------------------------------------------------------- text rules


def _single_line(value, label, maximum, *, required, too_long="invalid_input"):
    """support.text_value's rule: no control, bidi or invisible character anywhere; stripped, then counted."""
    if not isinstance(value, str) or UNSAFE_TEXT.search(value) or INVISIBLE_TEXT.search(value):
        fail("invalid_input", "Enter a valid " + label + ".")
    text = value.strip()
    if required and not text:
        fail("invalid_input", "Enter a " + label + ".")
    if len(text) > maximum:
        fail(too_long, "The " + label + " can be up to " + str(maximum) + " characters.")
    return text


def _multi_line(value, label):
    """Multi-line text keeps newlines and tabs; every other UNSAFE_TEXT character is refused."""
    if not isinstance(value, str) or any(char not in "\n\r\t" for char in UNSAFE_TEXT.findall(value)):
        fail("invalid_input", "Enter a valid " + label + ".")
    return value.strip()


def _store_name(value):
    name = _single_line(value, "store name", vc.STORE_NAME_CHARS, required=True)
    if vc.non_space(name) > STORE_NAME_NON_SPACE:
        fail("invalid_input", "The store name can be up to %d characters (spaces not counted)." % STORE_NAME_NON_SPACE)
    return name


def _compile_rule(check, value):
    """Run one of voice_compile's validators (the ones publish uses), answering its error as a 400."""
    try:
        return check(value)
    except vc.CompileError as error:
        fail(error.code, error.detail)


# ---------------------------------------------------------------- templates (contract §5.4)


@functools.lru_cache(maxsize=None)
def load_template(template_id):
    """server/voice_templates/<template_id>.json as a dict, or None (unknown id, no file, wrong schema)."""
    if not isinstance(template_id, str) or not TEMPLATE_ID.fullmatch(template_id):
        return None
    path = vc.TEMPLATE_DIR / (template_id + ".json")
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schema") != TEMPLATE_SCHEMA or data.get("template_id") != template_id:
        return None
    return data


def _template(row):
    """The store's template. A store whose template_id is not set uses its industry's template (clinic, cram)."""
    template_id = row["template_id"] or row["industry"]
    return template_id, load_template(template_id)


def _template_faqs(template):
    return [{"question": item["question"].strip(), "answer": item["answer"].strip(),
             "variants": [variant.strip() for variant in item.get("variants", []) if variant.strip()],
             "ai_allowed": bool(item.get("ai_allowed", True))} for item in template["faqs"]]


# ---------------------------------------------------------------- JSON shapes


def _faq_size(faq):
    return vc.faq_chars(faq["question"], faq["answer"], faq["variants"])


def _needs_input(faq):
    return any(vc.has_placeholder(text) for text in [faq["question"], faq["answer"], *faq["variants"]])


def faq_json(faq):
    return {"id": faq["id"], "question": faq["question"], "answer": faq["answer"], "variants": list(faq["variants"]),
            "aiAllowed": bool(faq["ai_allowed"]), "position": faq["position"], "chars": _faq_size(faq),
            "needsInput": _needs_input(faq), "updatedAt": iso(faq["updated_at"])}


def _kb_chars(intro, faqs):
    """Contract §5.2: description plus every FAQ, whether or not the AI may answer it."""
    return len(intro) + sum(_faq_size(faq) for faq in faqs)


def capacity_json(intro, faqs):
    return {"kbChars": _kb_chars(intro, faqs), "kbCharsMax": vc.KB_CHARS_MAX, "faqCount": len(faqs),
            "faqMax": vc.FAQ_MAX, "introChars": len(intro)}


def _hours_json(hours):
    return [{"weekday": h["weekday"], "openMin": h["open_min"], "closeMin": h["close_min"]} for h in hours]


def _draft(con, row):
    return {"faqs": vs.list_faqs(con, row["id"]), "hours": vs.get_hours(con, row["id"]),
            "closures": vs.get_closures(con, row["id"])}


def compile_draft(row, draft, version):
    """compile_store() on the stored draft (A4: inputs in voice_compile's docstring format)."""
    return vc.compile_store({key: row[key] for key in COMPILE_KEYS}, draft["faqs"], draft["hours"], draft["closures"],
                            version=version)


def _unpublished(con, row, draft):
    """Contract §3.1: nothing published, a draft that no longer compiles, or a draft whose config (compiled as the
    current version) hashes differently from the stored one. No separate "dirty" flag is kept."""
    if row["current_version"] is None:
        return True
    current = vs.get_config_version(con, row["id"], row["current_version"])
    try:
        config = compile_draft(row, draft, row["current_version"])
    except vc.CompileError:
        return True
    return current is None or vc.config_sha256(config) != current["config_sha256"]


def _try_usage(con, store_id, now):
    """(tries in the last 24 hours, the latest try ever) from the voice.try_issued audit events (contract §1.6)."""
    used = con.execute("SELECT COUNT(*) FROM audit_events WHERE action='voice.try_issued' AND target_id=? AND created_at>?",
                       (store_id, now - TRY_WINDOW_SECONDS)).fetchone()[0]
    last = con.execute("SELECT MAX(created_at) FROM audit_events WHERE action='voice.try_issued' AND target_id=?",
                       (store_id,)).fetchone()[0]
    return int(used), last


def _opening_json(name, greeting):
    text = vc.opening_text(name, greeting)
    count = vc.non_space(text)
    return {"text": text, "nonSpace": count, "estSeconds": vc.estimate_seconds(text), "ok": count <= vc.OPENING_NON_SPACE_MAX}


def summary_json(con, row, settings):
    """M1 GET /me/voice."""
    draft = _draft(con, row)
    published = vs.get_config_version(con, row["id"], row["current_version"]) if row["current_version"] else None
    account = con.execute("SELECT password_change_required_at FROM users WHERE id=?", (row["owner_user_id"],)).fetchone()
    used, last = _try_usage(con, row["id"], int(time.time()))
    return {
        "store": {"id": row["id"], "name": row["name"], "industry": row["industry"], "templateId": row["template_id"],
                  "status": row["status"], "currentVersion": row["current_version"],
                  "publishedAt": iso(published["created_at"]) if published else None,
                  "hasUnpublishedChanges": _unpublished(con, row, draft), "faqCount": len(draft["faqs"]),
                  "kbChars": _kb_chars(row["intro_text"], draft["faqs"]), "aiAnswerEnabled": bool(row["ai_answer_enabled"]),
                  "updatedAt": iso(row["updated_at"])},
        "account": {"passwordChangeRequired": bool(account and account["password_change_required_at"] is not None)},
        "try": {"available": settings.voice_try_available, "limit": TRY_LIMIT, "windowHours": TRY_WINDOW_SECONDS // 3600,
                "used": used, "remaining": max(0, TRY_LIMIT - used), "lastIssuedAt": iso(last)},
        "limits": dict(LIMITS),
    }


def setup_json(con, row):
    """M2 GET /me/voice/setup (M3 answers the same shape plus "changed")."""
    template_id, template = _template(row)
    if template is None:
        template_json = {"available": False}
    else:
        template_json = {"available": True, "templateId": template_id, "title": template["title"],
                         "greetingExample": template.get("greeting_example", ""),
                         "hoursExample": _hours_json(template.get("hours_example", []))}
    return {
        "setup": {"name": row["name"], "industry": row["industry"], "templateId": row["template_id"], "status": row["status"],
                  "greeting": row["greeting"], "introText": row["intro_text"],
                  "hours": _hours_json(vs.get_hours(con, row["id"])),
                  "closures": [{"date": c["date"], "note": c["note"]} for c in vs.get_closures(con, row["id"])],
                  "afterHoursMode": row["after_hours_mode"], "askCallback": row["ask_callback"],
                  "maxMessageSeconds": row["max_message_seconds"], "handoffMode": row["handoff_mode"],
                  "recordingMode": row["recording_mode"], "retentionDays": row["retention_days"],
                  "aiAnswerEnabled": bool(row["ai_answer_enabled"]), "updatedAt": iso(row["updated_at"])},
        "opening": _opening_json(row["name"], row["greeting"]),
        "disclosure": {"template": vc.disclosure_template(), "version": vc.DISCLOSURE_VERSION},
        "template": template_json,
        "limits": dict(LIMITS),
    }


def faqs_json(con, row):
    """M4 GET /me/voice/faqs."""
    faqs = vs.list_faqs(con, row["id"])
    template_id, template = _template(row)
    return {"introText": row["intro_text"], "faqs": [faq_json(faq) for faq in faqs],
            "capacity": capacity_json(row["intro_text"], faqs),
            "template": ({"available": True, "templateId": template_id, "title": template["title"],
                          "faqCount": len(template["faqs"])} if template else {"available": False})}


# ---------------------------------------------------------------- M3 setup validation


def _setup_changes(body, row):
    """Validate the writable fields that are present, in contract §3.3 order (first error wins). Returns
    ({column: value}, hours or None, closures or None); every other key in the body is ignored."""
    columns, hours, closures = {}, None, None
    if "name" in body:
        columns["name"] = _store_name(body["name"])
    if "greeting" in body:
        columns["greeting"] = _single_line(body["greeting"], "greeting", vc.GREETING_CHARS, required=False,
                                           too_long="greeting_too_long")
    if "introText" in body:
        columns["intro_text"] = _multi_line(body["introText"], "store description")  # too long: kb_too_large below
    if "hours" in body:
        value = body["hours"]
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            fail("hours_invalid", "Opening hours must be a list of segments.")
        hours = _compile_rule(vc._hours, [{"weekday": item.get("weekday"), "open_min": item.get("openMin"),
                                           "close_min": item.get("closeMin")} for item in value])
    if "closures" in body:
        value = body["closures"]
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            fail("closures_invalid", "Closures must be a list of days.")
        closures = _compile_rule(vc._closures, [{"date": item.get("date"), "note": item.get("note", "")} for item in value])
    for field, allowed in (("afterHoursMode", vs.AFTER_HOURS_MODES), ("askCallback", vs.ASK_CALLBACK)):
        if field in body:
            if body[field] not in allowed:
                fail("invalid_input", field + " must be one of " + ", ".join(allowed) + ".")
            columns[SETUP_COLUMNS[field]] = body[field]
    if "maxMessageSeconds" in body:
        value = body["maxMessageSeconds"]
        if not _is_int(value) or not vc.MAX_MESSAGE_SECONDS_MIN <= value <= vc.MAX_MESSAGE_SECONDS_MAX:
            fail("invalid_input", "maxMessageSeconds must be a whole number from 60 to 180.")
        columns["max_message_seconds"] = value
    if "recordingMode" in body:
        value = body["recordingMode"]
        if value == "full":
            # Phase 1 has no route that turns whole-call recording on; a store may only keep it.
            if row["recording_mode"] != "full":
                fail("recording_mode_forbidden", "Whole-call recording must be enabled by us.", 403)
        elif value not in ("off", "message_only"):
            fail("invalid_input", "recordingMode must be off or message_only.")
        columns["recording_mode"] = value
    if "retentionDays" in body:
        value = body["retentionDays"]
        if not _is_int(value) or value < 1:
            fail("invalid_input", "retentionDays must be a whole number of 1 or more.")
        mode = columns.get("recording_mode", row["recording_mode"])
        maximum = vs.RETENTION_DAYS_MAX_FULL if mode == "full" else vs.RETENTION_DAYS_MAX
        if value > maximum:
            fail("retention_exceeds_limit", "Recordings can be kept for up to %d days with this recording mode." % maximum)
        columns["retention_days"] = value
    return columns, hours, closures


# ---------------------------------------------------------------- M5/M6 FAQ validation


def _faq_changes(body, partial):
    """M5 (partial=False: question and answer required) and M6 (only the fields present). Order: question, answer,
    variants, aiAllowed, position; all 400 invalid_input. Returns {field: value} in voice_store's names."""
    changes = {}
    if not partial or "question" in body:
        changes["question"] = _single_line(body.get("question"), "question", vc.QUESTION_CHARS, required=True)
    if not partial or "answer" in body:
        answer = _multi_line(body.get("answer"), "answer")
        if not answer or len(answer) > vc.ANSWER_CHARS:
            fail("invalid_input", "Enter an answer of 1 to %d characters." % vc.ANSWER_CHARS)
        changes["answer"] = answer
    if "variants" in body:
        if not isinstance(body["variants"], list):
            fail("invalid_input", "Similar questions must be a list.")
        variants = [_single_line(item, "similar question", vc.VARIANT_CHARS, required=False) for item in body["variants"]]
        variants = [variant for variant in variants if variant]
        if len(variants) > vc.VARIANTS_MAX:
            fail("invalid_input", "A question can have up to %d similar questions." % vc.VARIANTS_MAX)
        changes["variants"] = variants
    elif not partial:
        changes["variants"] = []
    if "aiAllowed" in body:
        if not isinstance(body["aiAllowed"], bool):
            fail("invalid_input", "aiAllowed must be true or false.")
        changes["ai_allowed"] = body["aiAllowed"]
    elif not partial:
        changes["ai_allowed"] = True
    if body.get("position") is not None:
        if not _is_int(body["position"]) or body["position"] < 0:
            fail("invalid_input", "position must be a whole number of 0 or more.")
        changes["position"] = body["position"]
    return changes


def _check_faq_size(faq):
    if _faq_size(faq) > vc.FAQ_CHARS:
        fail("faq_too_long", "One question, its answer and similar questions can be up to %d characters." % vc.FAQ_CHARS)


def _check_capacity(faq_count, kb_chars):
    if faq_count > vc.FAQ_MAX:
        fail("faq_limit", "A store can have up to %d questions." % vc.FAQ_MAX)
    if kb_chars > vc.KB_CHARS_MAX:
        fail("kb_too_large", "The store description and all questions together can be up to %d characters." % vc.KB_CHARS_MAX)


# ---------------------------------------------------------------- M8 CSV (contract §5.5)


def _unsafe_single(text):
    return bool(UNSAFE_TEXT.search(text) or INVISIBLE_TEXT.search(text))


def _unsafe_multi(text):
    return any(char not in "\n\r\t" for char in UNSAFE_TEXT.findall(text))


def _csv_header(cells):
    names = [cell.strip().lower() for cell in cells]

    def column(*accepted):
        return next((index for index, name in enumerate(names) if name in accepted), None)

    question, answer, variants = column("問題", "question"), column("答案", "answer"), column("相似問法", "variants")
    return None if question is None or answer is None else (question, answer, variants)


def _csv_row(cells, header):
    """(faq, None) or (None, problem); one problem per row, in the contract's order."""
    def cell(index):
        return cells[index] if index is not None and index < len(cells) else ""

    question, answer = cell(header[0]).strip(), cell(header[1]).strip()
    variants = [part.strip() for part in VARIANT_SPLIT.split(cell(header[2]))]
    variants = [variant for variant in variants if variant]
    if not question:
        return None, "question_required"
    if not answer:
        return None, "answer_required"
    if len(question) > vc.QUESTION_CHARS:
        return None, "question_too_long"
    if any(len(variant) > vc.VARIANT_CHARS for variant in variants):
        return None, "variant_too_long"
    if len(variants) > vc.VARIANTS_MAX:
        return None, "too_many_variants"
    if vc.faq_chars(question, answer, variants) > vc.FAQ_CHARS:
        return None, "faq_too_long"
    if _unsafe_single(question) or _unsafe_multi(answer) or any(_unsafe_single(variant) for variant in variants):
        return None, "unsafe_text"
    return {"question": question, "answer": answer, "variants": variants, "ai_allowed": True}, None


def parse_faq_csv(text):
    """Parse an FAQ CSV (contract §5.5). Returns (rows, faqs, errors): data rows (no header, no blank rows), the
    rows without problems, and [{"row", "problem"}] where row is the spreadsheet row number (header = 1; a cell
    with line breaks stays one row; a blank row keeps its number but is not counted)."""
    if text.startswith("﻿"):
        text = text[1:]
    # newline="" as csv recommends for files: \r, \n and \r\n all end a row, and quoted cells keep their breaks.
    reader = csv.reader(io.StringIO(text, newline=""))
    rows, faqs, errors, header, record = 0, [], [], None, 0
    try:
        for cells in reader:
            record += 1
            if header is None:
                header = _csv_header(cells)
                if header is None:
                    errors.append({"row": 1, "problem": "header_invalid"})
                    break
                continue
            if not any(cell.strip() for cell in cells):
                continue
            rows += 1
            faq, problem = _csv_row(cells, header)
            if problem:
                errors.append({"row": record, "problem": problem})
            else:
                faqs.append(faq)
    except csv.Error:
        errors.append({"row": record + 1, "problem": "csv_unparseable"})
    if record == 0:
        errors.append({"row": 1, "problem": "header_invalid"})
    return rows, faqs, errors


# ---------------------------------------------------------------- routes


def attach_voice_merchant(application, ctx):
    store = ctx.store
    base = PREFIX + "/me/voice"

    def caller(request):
        # Read at call time: tests (and a restart with new settings) switch the feature without new routes.
        if not ctx.settings.voice_enabled:
            fail("not_found", NOT_FOUND_DETAIL, 404)
        return ctx.current_user(request)

    def own_store(con, user):
        row = vs.store_by_owner(con, user["id"])
        if row is None:
            fail("voice_store_not_found", STORE_NOT_FOUND, 404)
        return row

    def own_faq(con, row, faq_id):
        faq = vs.get_faq(con, row["id"], faq_id)
        if faq is None:
            fail("faq_not_found", FAQ_NOT_FOUND, 404)
        return faq

    def write_lock(con, user):
        """BEGIN IMMEDIATE, then the account and the store as they are now (contract §1.1 step 5.1-5.2)."""
        con.execute("BEGIN IMMEDIATE")
        account = con.execute("SELECT disabled_at, password_change_required_at FROM users WHERE id=?", (user["id"],)).fetchone()
        if account is None or account["disabled_at"] is not None:
            fail("auth_required", "Sign in to continue.", 401)
        if account["password_change_required_at"] is not None:
            fail("password_change_required", PASSWORD_CHANGE_REQUIRED, 403)
        row = own_store(con, user)
        if row["status"] == "suspended":
            fail("store_suspended", STORE_SUSPENDED, 409)
        return row

    def precheck(user):
        """Steps 1-3 before the body is read: a caller without a store gets 404 whatever it sends."""
        with store.connect() as con:
            return own_store(con, user)

    # M1
    @application.get(base)
    async def voice_summary(request: Request):
        user = caller(request)
        with store.connect() as con:
            return summary_json(con, own_store(con, user), ctx.settings)

    # M2
    @application.get(base + "/setup")
    async def voice_setup(request: Request):
        user = caller(request)
        with store.connect() as con:
            return setup_json(con, own_store(con, user))

    # M3
    @application.post(base + "/setup")
    async def voice_setup_save(request: Request):
        user = caller(request)
        precheck(user)
        body = await body_json(request)
        with store.connect() as con:
            row = write_lock(con, user)
            columns, hours, closures = _setup_changes(body, row)
            name = columns.get("name", row["name"])
            greeting = columns.get("greeting", row["greeting"])
            if vc.non_space(vc.opening_text(name, greeting)) > vc.OPENING_NON_SPACE_MAX:
                fail("opening_too_long", "The opening is longer than %d seconds. Shorten the greeting or the store name."
                     % vc.OPENING_SECONDS_MAX)
            faqs = vs.list_faqs(con, row["id"])
            _check_capacity(len(faqs), _kb_chars(columns.get("intro_text", row["intro_text"]), faqs))
            changed_columns = set(vs.update_store(con, row["id"], columns) or [])
            changed = {api for api, column in SETUP_COLUMNS.items() if column in changed_columns}
            if hours is not None and vs.replace_hours(con, row["id"], hours):
                changed.add("hours")
            if closures is not None and vs.replace_closures(con, row["id"], closures):
                changed.add("closures")
            changed = [field for field in SETUP_ORDER if field in changed]
            row = own_store(con, user)
            if changed:
                store.audit(con, "voice.setup_saved", user["id"], row["id"],
                            {"changed": changed, "kbChars": _kb_chars(row["intro_text"], faqs),
                             "hoursSegments": len(vs.get_hours(con, row["id"])), "closures": len(vs.get_closures(con, row["id"]))})
            return dict(setup_json(con, row), changed=changed)

    # M4
    @application.get(base + "/faqs")
    async def voice_faqs(request: Request):
        user = caller(request)
        with store.connect() as con:
            return faqs_json(con, own_store(con, user))

    # M5
    @application.post(base + "/faqs")
    async def voice_faq_create(request: Request):
        user = caller(request)
        precheck(user)
        body = await body_json(request)
        with store.connect() as con:
            row = write_lock(con, user)
            new = _faq_changes(body, partial=False)
            _check_faq_size(new)
            faqs = vs.list_faqs(con, row["id"])
            _check_capacity(len(faqs) + 1, _kb_chars(row["intro_text"], faqs) + _faq_size(new))
            faq = vs.add_faq(con, row["id"], new["question"], new["answer"], new["variants"], new["ai_allowed"], new.get("position"))
            faqs = vs.list_faqs(con, row["id"])
            capacity = capacity_json(row["intro_text"], faqs)
            store.audit(con, "voice.faq_created", user["id"], row["id"],
                        {"faqId": faq["id"], "faqCount": capacity["faqCount"], "kbChars": capacity["kbChars"]})
            return JSONResponse({"faq": faq_json(faq), "capacity": capacity}, status_code=201)

    # M8 (registered before /faqs/{faq_id}, or "import" would be taken for an id)
    @application.post(base + "/faqs/import")
    async def voice_faq_import(request: Request):
        user = caller(request)
        precheck(user)
        body = await body_json(request, maximum=CSV_BODY_BYTES)
        with store.connect() as con:
            row = write_lock(con, user)
            text, mode, dry_run = body.get("csv"), body.get("mode"), body.get("dryRun", False)
            if not isinstance(text, str):
                fail("invalid_input", "Send the CSV file as text.")
            if mode not in IMPORT_MODES:
                fail("invalid_input", "mode must be append or replace.")
            if not isinstance(dry_run, bool):
                fail("invalid_input", "dryRun must be true or false.")
            rows, new, errors = parse_faq_csv(text)
            kept = vs.list_faqs(con, row["id"]) if mode == "append" else []
            faq_count = len(kept) + len(new)
            kb_chars = _kb_chars(row["intro_text"], kept + new)
            problem = "faq_limit" if faq_count > vc.FAQ_MAX else "kb_too_large" if kb_chars > vc.KB_CHARS_MAX else None
            if dry_run:
                return {"dryRun": True, "ok": not errors and rows > 0 and problem is None, "rows": rows,
                        "errors": errors[:CSV_ERRORS_MAX], "errorsTruncated": len(errors) > CSV_ERRORS_MAX,
                        "result": {"faqCount": faq_count, "kbChars": kb_chars}, "capacityProblem": problem}
            if errors:
                listed = ", ".join(str(error["row"]) for error in errors[:CSV_DETAIL_ROWS])
                fail("csv_invalid", ("Row " if len(errors) == 1 else "Rows ") + listed
                     + (" and more" if len(errors) > CSV_DETAIL_ROWS else "")
                     + (" has" if len(errors) == 1 else " have") + " problems; nothing was imported.")
            if rows == 0:
                fail("csv_invalid", "The CSV has no question rows; nothing was imported.")
            if problem:
                _check_capacity(faq_count, kb_chars)
            if mode == "replace":
                for faq in vs.list_faqs(con, row["id"]):
                    vs.delete_faq(con, row["id"], faq["id"])
            for faq in new:
                vs.add_faq(con, row["id"], faq["question"], faq["answer"], faq["variants"], True)
            faqs = vs.list_faqs(con, row["id"])
            capacity = capacity_json(row["intro_text"], faqs)
            store.audit(con, "voice.faqs_imported", user["id"], row["id"],
                        {"mode": mode, "rows": rows, "faqCount": capacity["faqCount"], "kbChars": capacity["kbChars"]})
            return {"imported": len(new), "mode": mode, "faqs": [faq_json(faq) for faq in faqs], "capacity": capacity}

    # M9
    @application.post(base + "/faqs/from-template")
    async def voice_faq_from_template(request: Request):
        user = caller(request)
        precheck(user)
        body = await body_json(request)
        with store.connect() as con:
            row = write_lock(con, user)
            mode, include_intro = body.get("mode"), body.get("includeIntro", False)
            if mode not in IMPORT_MODES:
                fail("invalid_input", "mode must be append or replace.")
            if not isinstance(include_intro, bool):
                fail("invalid_input", "includeIntro must be true or false.")
            template_id, template = _template(row)
            if template is None:
                fail("template_not_found", "There is no template for this industry yet.", 404)
            new = _template_faqs(template)
            kept = vs.list_faqs(con, row["id"]) if mode == "append" else []
            intro = template["intro_text"].strip() if include_intro else row["intro_text"]
            _check_capacity(len(kept) + len(new), _kb_chars(intro, kept + new))
            if include_intro:
                vs.update_store(con, row["id"], {"intro_text": intro})
            if mode == "replace":
                for faq in vs.list_faqs(con, row["id"]):
                    vs.delete_faq(con, row["id"], faq["id"])
            for faq in new:
                vs.add_faq(con, row["id"], faq["question"], faq["answer"], faq["variants"], faq["ai_allowed"])
            faqs = vs.list_faqs(con, row["id"])
            capacity = capacity_json(intro, faqs)
            store.audit(con, "voice.faqs_from_template", user["id"], row["id"],
                        {"templateId": template_id, "mode": mode, "added": len(new), "introReplaced": include_intro,
                         "faqCount": capacity["faqCount"], "kbChars": capacity["kbChars"]})
            return {"added": len(new), "needsInput": sum(1 for faq in new if _needs_input(faq)),
                    "introReplaced": include_intro, "faqs": [faq_json(faq) for faq in faqs], "capacity": capacity}

    # M6
    @application.post(base + "/faqs/{faq_id}")
    async def voice_faq_update(faq_id: str, request: Request):
        user = caller(request)
        with store.connect() as con:
            own_faq(con, own_store(con, user), faq_id)
        body = await body_json(request)
        with store.connect() as con:
            row = write_lock(con, user)
            current = own_faq(con, row, faq_id)
            changes = _faq_changes(body, partial=True)
            merged = dict(current, **changes)
            _check_faq_size(merged)
            faqs = vs.list_faqs(con, row["id"])
            kb_chars = _kb_chars(row["intro_text"], faqs) - _faq_size(current) + _faq_size(merged)
            _check_capacity(len(faqs), kb_chars)
            faq = vs.update_faq(con, row["id"], faq_id, changes)
            faqs = vs.list_faqs(con, row["id"])
            capacity = capacity_json(row["intro_text"], faqs)
            fields = ("question", "answer", "variants", "ai_allowed", "position")
            if any(faq[field] != current[field] for field in fields):
                store.audit(con, "voice.faq_updated", user["id"], row["id"],
                            {"faqId": faq_id, "faqCount": capacity["faqCount"], "kbChars": capacity["kbChars"]})
            return {"faq": faq_json(faq), "capacity": capacity}

    # M7
    @application.delete(base + "/faqs/{faq_id}")
    async def voice_faq_delete(faq_id: str, request: Request):
        user = caller(request)
        with store.connect() as con:
            own_faq(con, own_store(con, user), faq_id)
        with store.connect() as con:
            row = write_lock(con, user)
            own_faq(con, row, faq_id)
            vs.delete_faq(con, row["id"], faq_id)
            faqs = vs.list_faqs(con, row["id"])
            capacity = capacity_json(row["intro_text"], faqs)
            store.audit(con, "voice.faq_deleted", user["id"], row["id"],
                        {"faqId": faq_id, "faqCount": capacity["faqCount"], "kbChars": capacity["kbChars"]})
            return {"ok": True, "capacity": capacity}

    # M10
    @application.get(base + "/preview")
    async def voice_preview(request: Request):
        user = caller(request)
        with store.connect() as con:
            row = own_store(con, user)
            draft = _draft(con, row)
            next_version = vs.next_config_version(con, row["id"])
            try:
                config = compile_draft(row, draft, next_version)
                digest, problems = vc.config_sha256(config), []
            except vc.CompileError as error:
                config, digest, problems = None, None, [{"code": error.code, "detail": error.detail}]
            return {"basedOnVersion": row["current_version"], "nextVersion": next_version, "config": config,
                    "configSha256": digest, "hasUnpublishedChanges": _unpublished(con, row, draft), "problems": problems}

    # M11
    @application.post(base + "/publish")
    async def voice_publish(request: Request):
        user = caller(request)
        precheck(user)
        await body_json(request)  # {}: no fields, but the JSON content type is required like every POST
        with store.connect() as con:
            row = write_lock(con, user)
            draft = _draft(con, row)
            if not row["intro_text"] and not draft["faqs"]:
                fail("kb_empty", "There is nothing to apply yet. Add a store description or a question first.", 409)
            next_version = vs.next_config_version(con, row["id"])
            try:
                config = compile_draft(row, draft, next_version)
            except vc.CompileError as error:
                fail(error.code, error.detail, 409)
            if row["current_version"] is not None:
                current = vs.get_config_version(con, row["id"], row["current_version"])
                same = compile_draft(row, draft, row["current_version"])
                if current is not None and vc.config_sha256(same) == current["config_sha256"]:
                    return {"changed": False, "version": current["version"], "configSha256": current["config_sha256"],
                            "publishedAt": iso(current["created_at"]), "warnings": same["warnings"]}
            version = vs.add_config_version(con, row["id"], config, user["id"])
            store.audit(con, "voice.published", user["id"], row["id"],
                        {"version": version["version"], "configSha256": version["config_sha256"],
                         "kbChars": config["kb_chars"], "warnings": len(config["warnings"])})
            return {"changed": True, "version": version["version"], "configSha256": version["config_sha256"],
                    "publishedAt": iso(version["created_at"]), "warnings": config["warnings"]}

    # M12
    @application.post(base + "/try")
    async def voice_try(request: Request):
        user = caller(request)
        precheck(user)
        await body_json(request)
        settings = ctx.settings
        with store.connect() as con:
            row = write_lock(con, user)
            if row["current_version"] is None:
                fail("not_published", "Nothing is applied yet. Use \"Save and apply\" on Setup first.", 409)
            if not settings.voice_try_available:
                fail("voice_try_unavailable", "Test calls are unavailable right now. Try again later or contact us.", 503)
            # Counted and reserved under the same writer lock: the audit row written below is the reservation,
            # so concurrent requests cannot all see 19 and all succeed.
            now = int(time.time())
            used, _ = _try_usage(con, row["id"], now)
            if used >= TRY_LIMIT:
                fail("voice_try_limit", "You have used all test calls for now (%d per 24 hours)." % TRY_LIMIT, 429)
            published = vs.get_config_version(con, row["id"], row["current_version"])
            ticket, payload = voice_ticket.sign(settings.voice_try_secret, json.loads(published["config_json"]), now=now)
            store.audit(con, "voice.try_issued", user["id"], row["id"],
                        {"version": published["version"], "ticketChars": len(ticket)})
        # The page opens url + "#t=" + ticket: the ticket travels only in the fragment, never in a query string.
        return {"ticket": ticket, "url": settings.voice_try_origin + "/", "expiresAt": iso(payload["exp"]),
                "version": payload["config_version"], "remaining": TRY_LIMIT - used - 1}
