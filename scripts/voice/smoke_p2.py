"""Phase 2 sections of the phone agent smoke (scripts/voice/smoke.py imports this; it does not run on its own).

A fake orchestrator stands in for b300-23 (phase2-contract §3.3-§3.4): it pulls a store's settings by the dialed
number and reports calls through Next's /api/voice-runtime/* route with the test-only runtime token, the way the
real one will. A fake records sender stands in for the Taiwan host once (the message part of one call). Then store A
reads its calls, store B tries A's, A flags one as a wrong answer, the operator reviews it on the Quality routes, and
the runtime is refused with a wrong or missing token, with the token unset (mode `notoken`) and with the switch off.

Every function takes `m`, the smoke module, for its report (m.R), its BFF helper (m.call/m.expect) and its paths.
Store and operator routes go through the BFF with cookies like the rest of the smoke; the runtime goes to Next with
http.client so the token is a header in this process and never in argv. Media tokens are reported by length only.
"""
import base64
import datetime
import hashlib
import hmac
import http.client
import json
import secrets
import sqlite3
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

RUNTIME_TOKEN = "test-only-runtime-token-0000000000"  # run-local.sh starts the backend with this test-only value
WRONG_TOKEN = "test-only-wrong-runtime-token-000000000000"
MEDIA_SECRET = b"test-only-not-a-secret-0000000000"  # PC_VOICE_MEDIA_SECRET in run-local.sh (test-only)
MEDIA_ORIGIN = "http://127.0.0.1:8098"  # PC_VOICE_MEDIA_URL; nothing listens there, links are only signed
A_LINE, A_DOMESTIC = "+886227001001", "0227001001"
B_LINE, B_DOMESTIC = "+886227002002", "0227002002"
TAIPEI = datetime.timezone(datetime.timedelta(hours=8))
OUTCOMES = ("answered", "message", "handoff", "degraded", "not_answered", "hangup_early", "no_speech", "error", "unknown")
ZERO_MESSAGE = {"outcome": "none", "speech_ms": 0, "recording_ms": 0, "callback_confirmed": False, "callback_via": None,
                "recording_saved": False, "recording_declined": False, "ai_answered": None, "ai_speech_ms": None}
METRICS = {"reply_p50_ms": 900, "reply_p95_ms": 1600, "barge_ins": 0, "fillers": 1, "talk_overs": 0, "no_responses": 0}
FLAG_NOTE = "問洗牙價格，AI 說的是去年的價錢"


def taipei_date(epoch):
    return datetime.datetime.fromtimestamp(epoch, TAIPEI).strftime("%Y-%m-%d")


def taipei_month(epoch):
    return datetime.datetime.fromtimestamp(epoch, TAIPEI).strftime("%Y-%m")


def month_start(epoch):
    local = datetime.datetime.fromtimestamp(epoch, TAIPEI)
    return int(local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())


def runtime(m, method, path, body=None, token=RUNTIME_TOKEN, headers=None):
    """One request to Next's /api/voice-runtime/<path> (never the BFF). Returns (status, payload, headers)."""
    host, port = m.FRONT.split("://", 1)[1].split(":")
    send = {"Accept": "application/json"}
    if token is not None:
        send["Authorization"] = "Bearer " + token
    send.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        send["Content-Type"] = "application/json"
        send["Content-Length"] = str(len(data))
    con = http.client.HTTPConnection(host, int(port), timeout=120)
    try:
        con.request(method, "/api/voice-runtime" + path, body=data, headers=send)
        response = con.getresponse()
        raw = response.read()
        status, got = response.status, {key.lower(): value for key, value in response.getheaders()}
    finally:
        con.close()
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else None
    except ValueError:
        payload = raw.decode("utf-8", "replace")
    return status, payload, got


def error_of(payload):
    return payload.get("error") if isinstance(payload, dict) else m_short(payload)


def m_short(payload):
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return text if len(text) <= 120 else text[:120] + "…"


class FakeOrchestrator:
    """Stands in for b300-23's orchestrator: R1 by the dialed number, R2 when a call's AI part ends.

    A report has exactly the 21 keys of voice.call-report/v1 (§3.4), so a transcript, a summary or a full phone number
    has no field to travel in (Q2: those stay on the Taiwan host). AI answered means it played the opening; the
    customer speech is its VAD total in whole milliseconds."""

    def __init__(self, m, token=RUNTIME_TOKEN):
        self.m = m
        self.token = token
        self.settings = {}  # dialed number -> the last 200 answer with a config (the orchestrator's cache, §3.3)

    def pull(self, number, if_none_match=None, have=None):
        query = "?number=" + urllib.parse.quote(number, safe=":")  # "+" goes as %2B (§3.1 step 4)
        if have:
            query += "&have=" + have
        headers = {"If-None-Match": if_none_match} if if_none_match else None
        status, payload, got = runtime(self.m, "GET", "/config" + query, token=self.token, headers=headers)
        if status == 200 and isinstance(payload, dict) and "config" in payload:
            self.settings[number] = payload
        return status, payload, got

    def call_report(self, call_id, number, *, started, seconds, speech_ms, entry="pstn", store_id=None, handoff=None,
                    auto_flags=(), caller_tail="678", caller_kind="mobile", content_expected=True):
        settings = self.settings[number]
        version = settings.get("config_version")
        config = settings.get("config") or {}
        try_call = entry == "try"
        return {
            "schema": "voice.call-report/v1", "source": "orchestrator", "call_id": call_id, "entry": entry,
            "dialed": None if try_call else number, "store_id": store_id if try_call else None,
            "started_at": self.m.iso(started), "answered_at": self.m.iso(started + 2), "ended_at": self.m.iso(started + seconds),
            "sent_at": self.m.iso(int(time.time())), "disposition": "ANSWERED",
            "caller_tail": None if try_call else caller_tail, "caller_kind": "web" if try_call else caller_kind,
            "config": {"version": version, "sha256": settings["config_sha256"]} if version else None,
            "disclosure_version": config.get("opening", {}).get("disclosure_version"),
            "ai": {"answered": True, "speech_ms": speech_ms, "turns": 3, "handoff": handoff, "auto_flags": list(auto_flags),
                   "degraded": None, "metrics": dict(METRICS)},
            "message": dict(ZERO_MESSAGE), "message_final": None, "fallback": False,
            "content_expected": content_expected, "retention_days": settings["store"]["retention_days"]}

    def send(self, body, token=None):
        """POST one report; sent_at is stamped again on every send, like a retry (§3.4)."""
        body = dict(body, sent_at=self.m.iso(int(time.time())))
        status, payload, _ = runtime(self.m, "POST", "/calls", body, token=self.token if token is None else token)
        return status, payload


def records_report(m, call_id, number, *, started, seconds, final, message):
    """What the Taiwan host's records sender posts for a call (§3.4, §15 item 1): the whole call, message part."""
    return {
        "schema": "voice.call-report/v1", "source": "records", "call_id": call_id, "entry": "pstn", "dialed": number,
        "store_id": None, "started_at": m.iso(started), "answered_at": m.iso(started + 1), "ended_at": m.iso(started + seconds),
        "sent_at": m.iso(int(time.time())), "disposition": "ANSWERED", "caller_tail": "678", "caller_kind": "mobile",
        "config": None, "disclosure_version": "draft-0", "ai": None, "message": message if final else dict(ZERO_MESSAGE),
        "message_final": final, "fallback": False, "content_expected": True, "retention_days": 90}


def verify_media_token(token, now):
    """§8.1: B64U(canonical payload) "." B64U(HMAC-SHA256(secret, first part)). Returns (signature ok, payload)."""
    parts = token.split(".")
    if len(parts) != 2:
        return False, {}
    expected = base64.urlsafe_b64encode(hmac.new(MEDIA_SECRET, parts[0].encode("ascii"), hashlib.sha256).digest()).rstrip(b"=").decode()
    if not hmac.compare_digest(expected, parts[1]):
        return False, {}
    payload = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)).decode("utf-8"))
    return payload.get("iat", 0) <= now + 60 < payload.get("exp", 0) + 60, payload


# ---------------------------------------------------------------- on


def run_on(m, state, admin_jar, a_jar, b_jar):
    R = m.R
    a_id, b_id = state["a_id"], state["b_id"]
    now = int(time.time())

    R.section("12. Phase 2: customer lines on pstn for store A and store B (A6)")
    lines = {}
    for label, number, store_id in (("A", A_LINE, a_id), ("B", B_LINE, b_id)):
        body = {"number": number, "storeId": store_id, "purpose": "customer", "channel": "pstn",
                "activeFrom": taipei_date(now - 86400), "activeUntil": None, "note": "smoke " + label}
        got, created = m.call("POST", "/admin/voice/numbers", admin_jar, body)
        entry = created.get("number", {}) if isinstance(created, dict) else {}
        R.check("A6 adds %s as store %s's customer line on pstn -> 201" % (number, label), got == 201 and entry.get("storeId") == store_id,
                "got %d %s" % (got, m.short(created, 120)))
        lines[label] = dict(body, id=entry.get("id", "0" * 32))
    state["a_line"] = lines["A"]

    R.section("13. Fake orchestrator pulls settings by the dialed number (R1, Next /api/voice-runtime/config)")
    orch = FakeOrchestrator(m)
    got, r1, headers = orch.pull(A_DOMESTIC)
    r1 = r1 if isinstance(r1, dict) else {}
    s0 = r1.get("state_sha256")
    R.check("R1 0227001001 -> 200 voice.runtime-config/v1 for store A, version 1, the published sha256",
            got == 200 and r1.get("schema") == "voice.runtime-config/v1" and r1.get("number", {}).get("number") == A_LINE
            and r1.get("store", {}).get("id") == a_id and r1.get("config_version") == 1 and r1.get("config_sha256") == state["a_sha"],
            "got %d schema %s number %s store %s version %s" % (got, r1.get("schema"), r1.get("number"), r1.get("store", {}).get("id"),
                                                               r1.get("config_version")))
    R.check("store A is a draft with AI answer off, so answer_mode is message_only", r1.get("answer_mode") == "message_only"
            and r1.get("store", {}).get("status") == "draft" and r1.get("store", {}).get("ai_answer_enabled") is False,
            "answer_mode %s store %s" % (r1.get("answer_mode"), {k: r1.get("store", {}).get(k) for k in ("status", "ai_answer_enabled")}))
    R.check("R1 answers with ETag \"<state_sha256>\", Cache-Control no-store and no cookie",
            headers.get("etag") == '"%s"' % s0 and "no-store" in headers.get("cache-control", "") and "set-cookie" not in headers,
            "etag %s… cache-control %s" % (headers.get("etag", "")[:14], headers.get("cache-control")))
    got, payload = m.call("POST", "/admin/voice/stores/%s/status" % a_id, admin_jar, {"status": "testing"})
    R.check("admin moves store A to testing (A4)", got == 200 and payload.get("store", {}).get("status") == "testing", "got %d" % got)
    # Phase 1 and 2 have no route that turns AI answer on (phase1-contract §1.3 keeps it with the operator); like
    # create-admin, this one step writes the smoke database directly and is labelled as such.
    con = sqlite3.connect(m.S + "/db/portal.sqlite3")
    try:
        with con:
            changed = con.execute("UPDATE voice_stores SET ai_answer_enabled=1 WHERE id=?", (a_id,)).rowcount
    finally:
        con.close()
    R.check("AI answer on for store A (direct SQLite update, no API for it yet)", changed == 1, "%d row" % changed)
    got, r1b, headers = orch.pull(A_DOMESTIC, if_none_match='"%s"' % s0)
    r1b = r1b if isinstance(r1b, dict) else {}
    s1 = r1b.get("state_sha256")
    R.check("R1 with the old ETag -> 200, not 304: answer_mode is now ai and state_sha256 changed (config unchanged)",
            got == 200 and r1b.get("answer_mode") == "ai" and s1 and s1 != s0 and r1b.get("config_sha256") == state["a_sha"],
            "got %d answer_mode %s state %s… -> %s…" % (got, r1b.get("answer_mode"), (s0 or "")[:8], (s1 or "")[:8]))
    got, body, headers = orch.pull(A_DOMESTIC, if_none_match='"%s"' % s1)
    R.check("R1 with the current ETag -> 304, same ETag, no body", got == 304 and headers.get("etag") == '"%s"' % s1 and body is None,
            "got %d etag %s… body %s" % (got, headers.get("etag", "")[:14], m.short(body, 40) if body else None))
    got, r1c, _ = orch.pull(A_DOMESTIC, have=s1)
    r1c = r1c if isinstance(r1c, dict) else {}
    R.check("R1 with have=<state_sha256> -> 200 unchanged: true and no config key", got == 200 and r1c.get("unchanged") is True
            and "config" not in r1c, "got %d keys %s" % (got, sorted(r1c)))
    got, payload, _ = runtime(m, "GET", "/config?number=+886227001001")
    R.check("R1 with an unencoded + (read as a space) -> 400 invalid_number", got == 400 and error_of(payload) == "invalid_number",
            "got %d %s" % (got, error_of(payload)))
    got, payload, _ = orch.pull(A_LINE)
    R.check("R1 with %2B886227001001 -> 200, the same state", got == 200 and payload.get("state_sha256") == s1, "got %d" % got)
    got, r1_b, _ = orch.pull(B_DOMESTIC)
    R.check("R1 0227002002 -> store B's settings, not A's", got == 200 and r1_b.get("store", {}).get("id") == b_id
            and a_id not in json.dumps(r1_b), "got %d store %s" % (got, r1_b.get("store", {}).get("id") if isinstance(r1_b, dict) else "?"))
    got, payload, _ = orch.pull("0227009999")
    R.check("R1 for a number not in the table -> 404 number_not_found", got == 404 and error_of(payload) == "number_not_found",
            "got %d %s" % (got, error_of(payload)))
    m.expect("the browser BFF does not forward the runtime", "GET", "/voice/runtime/config?number=0227001001", a_jar, None, 404, "not_found")

    R.section("14. Fake orchestrator reports 5 calls of store A and 1 of store B (R2, Next /api/voice-runtime/calls)")
    base = max(now - 900, month_start(now))
    month = taipei_month(base)
    run = str(now)
    cid = {name: "%s.%d" % (run, 101 + n) for n, name in enumerate(("c1", "c3", "c4", "c5", "b1"))}
    cid["c2"] = "try-" + secrets.token_hex(16)
    rows = {}

    def report(label, body, status, result):
        got, payload = orch.send(body)
        payload = payload if isinstance(payload, dict) else {}
        R.check("%s -> %d %s" % (label, status, result), got == status and payload.get("result") == result,
                "got %d %s; outcome %s, meter %s %s, store %s" % (got, payload.get("result") or payload.get("error"), payload.get("outcome"),
                                                               payload.get("meter_units"), payload.get("meter_reason"), payload.get("store_id")))
        return payload

    c1 = orch.call_report(cid["c1"], A_DOMESTIC, started=base, seconds=95, speech_ms=5200)
    first = report("c1: AI answered, customer spoke 5.2 s", c1, 201, "created")
    rows["c1"] = first.get("id")
    R.check("c1 is store A's, answered, 1 billable (ai_speech)", (first.get("store_id"), first.get("outcome"), first.get("meter_units"),
            first.get("meter_reason")) == (a_id, "answered", 1, "ai_speech"))
    again = report("c1 sent again (retry, new sent_at, same content)", c1, 200, "duplicate")
    R.check("the retry is the same row and adds nothing", again.get("id") == rows["c1"] and again.get("meter_units") == 1)
    c2 = orch.call_report(cid["c2"], A_DOMESTIC, started=base + 60, seconds=60, speech_ms=8000, entry="try", store_id=a_id)
    rows["c2"] = report("c2: a test call (entry try), customer spoke 8 s", c2, 201, "created").get("id")
    c3 = orch.call_report(cid["c3"], A_DOMESTIC, started=base + 120, seconds=40, speech_ms=2400)
    rows["c3"] = report("c3: AI answered, customer spoke 2.4 s (under 3 s)", c3, 201, "created").get("id")
    c4 = orch.call_report(cid["c4"], A_DOMESTIC, started=base + 180, seconds=30, speech_ms=1800)
    before = report("c4: AI answered, 1.8 s, then handed back to the edge for a message", c4, 201, "created")
    rows["c4"] = before.get("id")
    R.check("c4 before the message part arrives: 0 (short_speech), answered",
            (before.get("meter_units"), before.get("meter_reason"), before.get("outcome")) == (0, "short_speech", "answered"))
    message = {"outcome": "message", "speech_ms": 1500, "recording_ms": 4000, "callback_confirmed": False, "callback_via": None,
               "recording_saved": True, "recording_declined": False, "ai_answered": True, "ai_speech_ms": 1800}
    pending = records_report(m, cid["c4"], A_DOMESTIC, started=base + 180, seconds=55, final=False, message=message)
    got = report("c4 records sender, message result still pending (message_final false)", pending, 200, "merged")
    R.check("c4 stays 0 while the message result is pending", got.get("meter_units") == 0)
    final = records_report(m, cid["c4"], A_DOMESTIC, started=base + 180, seconds=55, final=True, message=message)
    after = report("c4 records sender, final: a 1.5 s message", final, 200, "updated")
    R.check("c4 after the final message: AI 1.8 s + message 1.5 s >= 3 s -> 1 (ai_speech), outcome message",
            (after.get("meter_units"), after.get("meter_reason"), after.get("outcome")) == (1, "ai_speech", "message"),
            "meter %s %s outcome %s" % (after.get("meter_units"), after.get("meter_reason"), after.get("outcome")))
    report("c4 records sender sends the final again", final, 200, "duplicate")
    c5 = orch.call_report(cid["c5"], A_DOMESTIC, started=base + 240, seconds=70, speech_ms=4100,
                          handoff={"reason": "requested", "urgent": False}, auto_flags=["impatient"])
    c5 = dict(c5, sent_at=m.iso(int(time.time())))
    with ThreadPoolExecutor(max_workers=10) as pool:
        sent = list(pool.map(lambda _: runtime(m, "POST", "/calls", c5), range(10)))
    results = sorted(payload.get("result") for status, payload, _ in sent if isinstance(payload, dict))
    ids = {payload.get("id") for _, payload, _ in sent if isinstance(payload, dict)}
    R.check("c5 (handoff, impatient) sent 10 times at once -> 1 x 201 created, 9 x 200 duplicate, one row",
            sorted(status for status, _, _ in sent) == [200] * 9 + [201] and results == ["created"] + ["duplicate"] * 9 and len(ids) == 1,
            "statuses %s results %s" % (sorted(status for status, _, _ in sent), results))
    rows["c5"] = ids.pop() if len(ids) == 1 else None
    leak = dict(c1, call_id=run + ".199", transcript="客人：洗牙多少錢？")
    got, payload = orch.send(leak)
    R.check("a report with a transcript field -> 400 call_invalid (unknown field: transcript); no row",
            got == 400 and error_of(payload) == "call_invalid" and "transcript" in payload.get("detail", ""),
            "got %d %s %s" % (got, error_of(payload), payload.get("detail") if isinstance(payload, dict) else ""))
    got, payload = orch.send(dict(c1, call_id=run + ".198", caller_tail="0912345678"))
    R.check("a report with the caller's full number in caller_tail -> 400 call_invalid; no row",
            got == 400 and error_of(payload) == "call_invalid", "got %d %s" % (got, error_of(payload)))
    # Store B answers message_only (R1 above), so its call has no orchestrator part: the records sender reports it alone.
    b_message = dict(ZERO_MESSAGE, outcome="message", speech_ms=6000, recording_ms=9000, recording_saved=True)
    b1 = records_report(m, cid["b1"], B_DOMESTIC, started=base + 300, seconds=50, final=True, message=b_message)
    b_row = report("b1: store B's line, message only, a 6 s message (records sender only)", b1, 201, "created")
    R.check("b1 is store B's, 1 billable (message)", (b_row.get("store_id"), b_row.get("outcome"), b_row.get("meter_units"),
            b_row.get("meter_reason")) == (b_id, "message", 1, "message"))
    state.update(month=month, a_rows=rows, b_row=b_row.get("id"), call_ids=cid)

    R.section("15. Store A sees its own 5 calls and the Q5 counts (M13, M14, M17)")
    expected = {"c1": ("answered", 1, "ai_speech"), "c2": ("answered", 0, "try"), "c3": ("answered", 0, "short_speech"),
                "c4": ("message", 1, "ai_speech"), "c5": ("handoff", 1, "ai_speech")}
    got, m13 = m.call("GET", "/me/voice/calls?month=" + month, a_jar)
    calls = {item["id"]: item for item in m13.get("calls", [])} if isinstance(m13, dict) else {}
    R.check("M13 lists exactly A's 5 calls (the test call included)", got == 200 and sorted(calls) == sorted(rows.values()),
            "got %d, %d calls" % (got, len(calls)))
    shown = {name: (calls.get(row, {}).get("outcome"), calls.get(row, {}).get("meterUnits"), calls.get(row, {}).get("meterReason"))
             for name, row in rows.items()}
    R.check("each call's outcome and estimated billing: c1 1 ai_speech, c2 0 try, c3 0 short_speech, c4 1 ai_speech, c5 1 ai_speech",
            shown == expected, "shown %s" % shown)
    summary = m13.get("summary", {}) if isinstance(m13, dict) else {}
    by = summary.get("byOutcome", {})
    R.check("summary: 5 calls, estimated billable 3 (Q5: AI answered and the customer spoke >= 3 s; test calls 0)",
            summary.get("month") == month and summary.get("total") == 5 and summary.get("meterUnits") == 3,
            "summary %s" % m.short({k: summary.get(k) for k in ("month", "total", "meterUnits", "flagged")}, 160))
    R.check("summary by outcome: answered 3, message 1, handoff 1, the rest 0",
            by == dict({key: 0 for key in OUTCOMES}, answered=3, message=1, handoff=1), "byOutcome %s" % by)
    text = json.dumps(m13, ensure_ascii=False)
    hidden = [value for value in list(cid.values()) + [A_LINE, A_DOMESTIC, "impatient", "transcript"] if value in text]
    R.check("M13 shows no call_id, no full number, no auto flag, no transcript", not hidden, "found %s" % hidden)
    got, m14 = m.call("GET", "/me/voice/calls/" + rows["c4"], a_jar)
    call4 = m14.get("call", {}) if isinstance(m14, dict) else {}
    R.check("M14 c4: message, 1.5 s message, 1 billable, content kept", got == 200 and call4.get("outcome") == "message"
            and call4.get("messageSeconds") == 1.5 and call4.get("meterUnits") == 1 and m14.get("content", {}).get("state") == "available"
            and m14.get("flag") is None, "got %d %s" % (got, m.short({k: call4.get(k) for k in ("outcome", "messageSeconds", "meterUnits", "configVersion")}, 140)))
    # Fix round (amended §6.5): until the records sender reports a call, its store comes from the orchestrator's number only.
    m.expect("A, M17 c1 while only the orchestrator has reported it", "POST", "/me/voice/calls/%s/content-link" % rows["c1"], a_jar, {},
             409, "call_content_pending")
    got, m17 = m.call("POST", "/me/voice/calls/%s/content-link" % rows["c4"], a_jar, {})
    media = m17.get("media", {}) if isinstance(m17, dict) else {}
    token = media.get("token", "")
    R.redactions.append(token)
    ok, payload = verify_media_token(token, int(time.time()))
    quoted = urllib.parse.quote(cid["c4"], safe="")
    R.check("M17 c4 (both sources) -> 200, a media link for the recording, summary and transcript",
            got == 200 and media.get("kinds") == ["recording", "summary", "transcript"]
            and sorted(media.get("urls", {})) == ["recording", "summary", "transcript"]
            and all(url == "%s/v1/calls/%s/%s" % (MEDIA_ORIGIN, quoted, kind) for kind, url in media.get("urls", {}).items()),
            "got %d kinds %s; token %d chars (redacted)" % (got, media.get("kinds"), len(token)))
    R.check("the media token verifies with the media secret: call c4, store A, role store, 300 s, no token in the URLs",
            ok and payload.get("call_id") == cid["c4"] and payload.get("store_id") == a_id and payload.get("role") == "store"
            and payload.get("exp", 0) - payload.get("iat", 0) == 300 and token not in json.dumps(media.get("urls")),
            "purpose %s aud %s kinds %s" % (payload.get("purpose"), payload.get("aud"), payload.get("kinds")))

    R.section("16. Store B cannot see any of A's calls")
    got, m13b = m.call("GET", "/me/voice/calls?month=" + month, b_jar)
    b_calls = [item["id"] for item in m13b.get("calls", [])] if isinstance(m13b, dict) else []
    R.check("B's M13 lists only b1", got == 200 and b_calls == [b_row.get("id")] and m13b.get("summary", {}).get("total") == 1,
            "got %d calls %s" % (got, b_calls))
    bodies = [json.dumps(m13b, ensure_ascii=False)]
    for name, row in sorted(rows.items()):
        for method, path, body in (("GET", "/me/voice/calls/" + row, None), ("POST", "/me/voice/calls/%s/flag" % row, {"kind": "wrong_answer"}),
                                   ("DELETE", "/me/voice/calls/%s/flag" % row, None), ("POST", "/me/voice/calls/%s/content-link" % row, {})):
            got, payload = m.expect("B on A's " + name, method, path, b_jar, body, 404, "call_not_found")
            bodies.append(json.dumps(payload, ensure_ascii=False))
    text = "\n".join(bodies)
    leaks = [value for value in list(rows.values()) + [row[:8] for row in rows.values()] + [m.A_NAME, a_id] if value in text]
    R.check("none of B's 21 answers contains A's call ids, refs, store id or name", not leaks, "leaks %s" % leaks[:3])
    got, payload = m.call("GET", "/me/voice/calls/" + rows["c3"], a_jar)
    R.check("A's c3 is still not flagged after B's attempts", got == 200 and payload.get("flag") is None)

    R.section("17. Store A flags c3 as a wrong answer (M15)")
    m.expect("A, a note with a phone number", "POST", "/me/voice/calls/%s/flag" % rows["c3"], a_jar,
             {"kind": "wrong_answer", "note": "請回電 0912 345 678"}, 400, "note_contains_number")
    got, payload = m.call("POST", "/me/voice/calls/%s/flag" % rows["c3"], a_jar, {"kind": "wrong_answer", "note": FLAG_NOTE})
    R.check("M15 flags c3 -> 200 changed, not reviewed yet", got == 200 and payload.get("changed") is True
            and payload.get("flag", {}).get("note") == FLAG_NOTE and payload["flag"].get("reviewed") is False, "got %d" % got)
    got, flagged = m.call("GET", "/me/voice/calls?flagged=1&month=" + month, a_jar)
    R.check("M13 flagged=1 lists only c3; summary.flagged 1", got == 200 and [c["id"] for c in flagged.get("calls", [])] == [rows["c3"]]
            and flagged.get("summary", {}).get("flagged") == 1, "got %d" % got)

    R.section("18. The operator sees the flag on the Quality routes and scores it (A9-A12, A14)")
    got, a9 = m.call("GET", "/admin/voice/quality/calls?flag=store", admin_jar)
    items = {item["id"]: item for item in a9.get("calls", [])} if isinstance(a9, dict) else {}
    item = items.get(rows["c3"], {})
    R.check("A9 flag=store lists c3 with A's note; counts: 1 store flag and 1 auto flag open",
            got == 200 and list(items) == [rows["c3"]] and item.get("storeFlag", {}).get("note") == FLAG_NOTE
            and item.get("store", {}).get("name") == m.A_NAME and a9.get("counts") == {"storeFlaggedOpen": 1, "autoFlaggedOpen": 1},
            "got %d items %d counts %s" % (got, len(items), a9.get("counts") if isinstance(a9, dict) else None))
    got, a10 = m.call("GET", "/admin/voice/quality/calls/" + rows["c3"], admin_jar)
    detail = a10.get("call", {}) if isinstance(a10, dict) else {}
    R.check("A10 c3: call_id, 2.4 s of speech, short_speech under rule q5-draft-1, only the orchestrator's report",
            got == 200 and detail.get("callId") == cid["c3"] and detail.get("callSpeechSeconds") == 2.4
            and detail.get("meterReason") == "short_speech" and detail.get("meterRule") == "q5-draft-1"
            and a10.get("sources", {}).get("orchestrator") and a10["sources"].get("records") is None,
            "got %d %s" % (got, m.short({k: detail.get(k) for k in ("callSpeechSeconds", "meterReason", "meterRule", "configVersion")}, 140)))
    got, a10 = m.call("GET", "/admin/voice/quality/calls/" + rows["c4"], admin_jar)
    detail = a10.get("call", {}) if isinstance(a10, dict) else {}
    R.check("A10 c4: both sources, 3.3 s for Q5 (AI 1.8 s + message 1.5 s), final message, no mismatch",
            got == 200 and detail.get("callSpeechSeconds") == 3.3 and detail.get("aiSpeechSeconds") == 1.8
            and detail.get("message", {}).get("final") is True and detail.get("mismatch") == []
            and a10.get("sources", {}).get("orchestrator") and a10["sources"].get("records"),
            "got %d %s" % (got, m.short({k: detail.get(k) for k in ("callSpeechSeconds", "aiSpeechSeconds", "mismatch")}, 140)))
    m.expect("operator, a review note with a phone number", "POST", "/admin/voice/quality/calls/%s/review" % rows["c3"], admin_jar,
             {"score": 2, "labels": ["wrong_answer"], "note": "客人 0912-345-678", "status": "done"}, 400, "note_contains_number")
    review = {"score": 2, "labels": ["wrong_answer"], "note": "價格題答錯，知識庫要更新", "status": "done"}
    got, payload = m.call("POST", "/admin/voice/quality/calls/%s/review" % rows["c3"], admin_jar, review)
    R.check("A11 scores c3 2/5 with wrong_answer, done -> 200 changed", got == 200 and payload.get("changed") is True
            and payload.get("review", {}).get("score") == 2, "got %d %s" % (got, m.short(payload, 120)))
    got, payload = m.call("POST", "/admin/voice/quality/calls/%s/review" % rows["c3"], admin_jar, review)
    R.check("the same review again -> changed false", got == 200 and payload.get("changed") is False, "got %d" % got)
    got, a9 = m.call("GET", "/admin/voice/quality/calls", admin_jar)
    open_ids = [item["id"] for item in a9.get("calls", [])] if isinstance(a9, dict) else []
    R.check("A9 default (flagged, not reviewed): c3 has left, c5 (impatient) is still there; storeFlaggedOpen 0",
            got == 200 and rows["c3"] not in open_ids and rows["c5"] in open_ids and a9.get("counts", {}).get("storeFlaggedOpen") == 0,
            "got %d, %d open, counts %s" % (got, len(open_ids), a9.get("counts") if isinstance(a9, dict) else None))
    got, a9 = m.call("GET", "/admin/voice/quality/calls?reviewed=1&flag=all", admin_jar)
    done = {item["id"]: item for item in a9.get("calls", [])} if isinstance(a9, dict) else {}
    R.check("A9 reviewed=1 lists c3 with score 2, done", got == 200 and list(done) == [rows["c3"]]
            and (done[rows["c3"]].get("review") or {}).get("status") == "done", "got %d %d" % (got, len(done)))
    got, payload = m.call("GET", "/me/voice/calls/" + rows["c3"], a_jar)
    R.check("store A now sees its flag as reviewed (not the score or note)", got == 200 and (payload.get("flag") or {}).get("reviewed") is True
            and "價格題答錯" not in json.dumps(payload, ensure_ascii=False), "flag %s" % (payload.get("flag") if isinstance(payload, dict) else None))
    got, a12 = m.call("POST", "/admin/voice/quality/calls/%s/content-link" % rows["c4"], admin_jar, {})
    media = a12.get("media", {}) if isinstance(a12, dict) else {}
    R.redactions.append(media.get("token", ""))
    ok, payload = verify_media_token(media.get("token", ""), int(time.time()))
    R.check("A12 c4 -> 200 with the recording too (the records sender saved one), role admin",
            got == 200 and media.get("kinds") == ["recording", "summary", "transcript"] and ok and payload.get("role") == "admin",
            "got %d kinds %s; token %d chars (redacted)" % (got, media.get("kinds"), len(media.get("token", ""))))
    listening = {"title": "冒煙盲聽", "kind": "call_sample", "heldOn": taipei_date(now), "sampleCount": 20, "raterCount": 3,
                 "passed": None, "summary": "", "reportRef": ""}
    m.expect("operator, a listening summary with a phone number", "POST", "/admin/voice/quality/listening", admin_jar,
             dict(listening, summary="受測者 0912345678"), 400, "note_contains_number")
    got, payload = m.call("POST", "/admin/voice/quality/listening", admin_jar, listening)
    R.check("A14 adds a blind listening entry -> 201", got == 201 and payload.get("log", {}).get("title") == listening["title"], "got %d" % got)
    state["listening_id"] = payload.get("log", {}).get("id", "0" * 32) if isinstance(payload, dict) else "0" * 32
    got, audit = m.call("GET", "/admin/audit", admin_jar)
    text = json.dumps(audit, ensure_ascii=False)
    actions = ("voice.call_flagged", "admin.voice_call_reviewed", "voice.call_content_link", "admin.voice_call_content_link")
    R.check("the audit log has the flag, the review and both content links, but no media token, note or call content",
            got == 200 and all(action in text for action in actions) and not any(t and t in text for t in R.redactions)
            and FLAG_NOTE not in text and "價格題答錯" not in text, "got %d, %d chars" % (got, len(text)))

    R.section("19. A number calls refer to keeps its owner (A7, A8: 409 number_in_use)")
    line = state["a_line"]
    body = {key: line[key] for key in ("number", "storeId", "purpose", "channel", "activeFrom", "activeUntil", "note")}
    m.expect("admin deletes A's line", "DELETE", "/admin/voice/numbers/" + line["id"], admin_jar, None, 409, "number_in_use")
    m.expect("admin moves A's line to store B", "POST", "/admin/voice/numbers/" + line["id"], admin_jar, dict(body, storeId=b_id), 409,
             "number_in_use")
    got, payload = m.call("POST", "/admin/voice/numbers/" + line["id"], admin_jar, dict(body, note="smoke A (calls)"))
    R.check("changing only the note is still allowed -> 200", got == 200 and payload.get("number", {}).get("note") == "smoke A (calls)",
            "got %d" % got)

    R.section("20. The runtime refuses a wrong or missing token")
    for label, token in (("a well-formed wrong token (portal checks it)", WRONG_TOKEN), ("no Authorization (Next refuses it)", None),
                         ("a token too short for the format (Next refuses it)", "short")):
        got, payload, _ = runtime(m, "GET", "/config?number=" + A_DOMESTIC, token=token)
        R.check("R1 with %s -> 401 runtime_auth" % label, got == 401 and error_of(payload) == "runtime_auth", "got %d %s" % (got, error_of(payload)))
    wrong = dict(c1, call_id=run + ".197")
    got, payload = orch.send(wrong, token=WRONG_TOKEN)
    R.check("R2 with a wrong token -> 401 runtime_auth", got == 401 and error_of(payload) == "runtime_auth", "got %d %s" % (got, error_of(payload)))
    got, m13 = m.call("GET", "/me/voice/calls?month=" + month, a_jar)
    R.check("A still has exactly 5 calls (the refused reports wrote nothing)", got == 200 and m13.get("summary", {}).get("total") == 5
            and m13["summary"].get("meterUnits") == 3, "summary %s" % (m.short(m13.get("summary"), 120) if isinstance(m13, dict) else got))
    state["c1_body"] = c1


# ---------------------------------------------------------------- notoken (PC_VOICE_RUNTIME_TOKEN unset)


def run_notoken(m, state):
    R = m.R
    R.section("21. PC_VOICE_RUNTIME_TOKEN unset: the runtime fails closed, the store pages still work")
    got, payload, _ = runtime(m, "GET", "/config?number=" + A_DOMESTIC)
    R.check("R1 with the old token -> 503 voice_runtime_unconfigured", got == 503 and error_of(payload) == "voice_runtime_unconfigured",
            "got %d %s" % (got, error_of(payload)))
    body = dict(state["c1_body"], call_id=str(int(time.time())) + ".301", sent_at=m.iso(int(time.time())))
    got, payload, _ = runtime(m, "POST", "/calls", body)
    R.check("R2 with the old token -> 503 voice_runtime_unconfigured", got == 503 and error_of(payload) == "voice_runtime_unconfigured",
            "got %d %s" % (got, error_of(payload)))
    got, payload, _ = runtime(m, "GET", "/config?number=" + A_DOMESTIC, token=None)
    R.check("R1 without Authorization -> 401 runtime_auth (Next refuses it before the portal)", got == 401
            and error_of(payload) == "runtime_auth", "got %d %s" % (got, error_of(payload)))
    got, m13 = m.call("GET", "/me/voice/calls?month=" + state["month"], state["a_jar"])
    R.check("A's M13 still lists its 5 calls (the store pages do not need the runtime token)",
            got == 200 and m13.get("summary", {}).get("total") == 5, "got %d" % got)


# ---------------------------------------------------------------- off


def run_off(m, state):
    R = m.R
    a_jar, admin_jar = state["a_jar"], state["admin_jar"]
    rows, listening = state["a_rows"], state["listening_id"]
    R.section("22. Feature switch off: the runtime and the call records are 404")
    got, payload, _ = runtime(m, "GET", "/config?number=" + A_DOMESTIC)
    R.check("R1 with the right token -> 404 not_found", got == 404 and error_of(payload) == "not_found", "got %d %s" % (got, error_of(payload)))
    body = dict(state["c1_body"], call_id=str(int(time.time())) + ".302", sent_at=m.iso(int(time.time())))
    got, payload, _ = runtime(m, "POST", "/calls", body)
    R.check("R2 with the right token -> 404 not_found", got == 404 and error_of(payload) == "not_found", "got %d %s" % (got, error_of(payload)))
    got, payload, _ = runtime(m, "GET", "/config?number=" + A_DOMESTIC, token=None)
    R.check("R1 without Authorization -> 401 runtime_auth (Next cannot know the switch; phase2-contract §13 item 16)",
            got == 401 and error_of(payload) == "runtime_auth", "got %d %s" % (got, error_of(payload)))
    review = {"score": 3, "labels": [], "note": "", "status": "open"}
    listening_body = {"title": "x", "kind": "other", "heldOn": "2026-10-01", "sampleCount": 1, "raterCount": 1, "passed": None,
                      "summary": "", "reportRef": ""}
    for method, path, jar, body in [
        ("GET", "/me/voice/calls", a_jar, None),
        ("GET", "/me/voice/calls/" + rows["c1"], a_jar, None),
        ("POST", "/me/voice/calls/%s/flag" % rows["c1"], a_jar, {"kind": "wrong_answer"}),
        ("DELETE", "/me/voice/calls/%s/flag" % rows["c3"], a_jar, None),
        ("POST", "/me/voice/calls/%s/content-link" % rows["c1"], a_jar, {}),
        ("GET", "/admin/voice/quality/calls", admin_jar, None),
        ("GET", "/admin/voice/quality/calls/" + rows["c3"], admin_jar, None),
        ("POST", "/admin/voice/quality/calls/%s/review" % rows["c3"], admin_jar, review),
        ("POST", "/admin/voice/quality/calls/%s/content-link" % rows["c4"], admin_jar, {}),
        ("GET", "/admin/voice/quality/listening", admin_jar, None),
        ("POST", "/admin/voice/quality/listening", admin_jar, listening_body),
        ("POST", "/admin/voice/quality/listening/" + listening, admin_jar, listening_body),
        ("DELETE", "/admin/voice/quality/listening/" + listening, admin_jar, None),
    ]:
        m.expect("off", method, path, jar, body, 404, "not_found")
    R.note("- That is all 5 store call routes (M13-M17) and all 8 Quality routes (A9-A16), each 404 not_found.")
