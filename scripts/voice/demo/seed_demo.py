#!/usr/bin/env python3
"""Seed the local phone-agent portal demo with fake data, through the real API only.

Run it through scripts/voice/demo/demo-local.sh (start / reset); it expects the backend and the frontend (BFF) that
scripts/voice/run-local.sh would start, with the test-only runtime token that script uses.

What it builds (all fake; every store number is 02-0000-xxxx and a caller is only ever 3 digits):
  - one operator account (admin)
  - two stores, opened by the operator: 晴光牙醫診所 (clinic template) and 啟明文理補習班 (cram template). Each owner
    signs in with the temporary password, changes it, saves the opening and the hours, imports the template and
    fills it from the example values, rewrites a few answers, adds one question, and publishes version 1.
    The operator moves both stores to testing ("試營運"; live needs the G2a gate in phase 1) and adds one
    demo number each. AI answering stays off for both (Q12: off by default; no API turns it on yet).
  - 37 calls over the last 10 days, today included, reported the way the Taiwan host reports them: the orchestrator's
    part and the records sender's part (a store only sees a call once the records sender reported it, phase2-contract
    §3.5). Today the clinic has the calls the voice demo shows: a booking, a cancellation the caller confirmed, an
    emergency where the AI said 119 first, a price question the AI did not quote, a message taken, and one message
    left for the presenter to delete live. Older calls cover the other kinds (handoffs, short, degraded, missed,
    silent, test calls); a few are flagged "wrong answer" by the store; the operator reviews several (the review notes
    say what happened on the call, since the call content lives on the Taiwan host, not here) and records one blind
    listening entry.
  - one clinic call is already deleted by the store (M18) and the deletion is acknowledged the way the Taiwan host's
    records sender does it (R3 pull, R4 ack), so the operator's quality page shows a finished deletion.

Calls with a conversation or a message say content_expected true, as production would. The demo runs without a media
host (PC_VOICE_MEDIA_URL empty, production's default), so call pages say how long the content is kept and that viewing
it is not open yet, with no button that could open a dead page.

Only two steps go around the portal API, and both are labelled: `python -m server.manage create-admin` (the documented
bootstrap for the first administrator) and the HTTP calls to /api/voice-runtime (the runtime's own door, with the
test-only token, as the smoke does). No SQL is written.

Passwords are generated per run and written only to the credentials file ($VOICE_DEMO_CREDENTIALS, mode 600). They
are never printed. The calls the walkthrough uses are listed in demo-plan.txt next to it (no passwords). Run again on
a seeded database and it seeds nothing; it only says whether the call to delete live is still there.
`demo-local.sh reset` rebuilds from scratch.
"""
import datetime
import http.client
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.parse

W = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))))
S = os.path.realpath(os.environ.get("VOICE_DEMO_DIR") or os.path.join(os.environ.get("TMPDIR") or "/tmp", "pc-voice-demo2"))
CREDENTIALS = os.environ.get("VOICE_DEMO_CREDENTIALS") or os.path.join(S, "demo-credentials.txt")
PLAN_TEXT = os.path.join(S, "demo-plan.txt")
PLAN_JSON = os.path.join(S, "demo-plan.json")
HOST = "127.0.0.1"
PORT = int(os.environ.get("VOICE_DEMO_FRONTEND_PORT") or os.environ.get("VOICE_SMOKE_FRONTEND_PORT") or "3921")
FRONT = "http://%s:%d" % (HOST, PORT)
RUNTIME_TOKEN = "test-only-runtime-token-0000000000"  # PC_VOICE_RUNTIME_TOKEN in demo-local.sh (test-only, loopback only)
TAIPEI = datetime.timezone(datetime.timedelta(hours=8))

ADMIN_EMAIL = "admin@portal-demo.test"
PHONE_REPLACE = {"clinic": ("02-2735-6688", "02-0000-0011"), "cram": ("02-2968-3355", "02-0000-0022")}

METRICS = {"reply_p50_ms": 900, "reply_p95_ms": 1600, "barge_ins": 0, "fillers": 1, "talk_overs": 0, "no_responses": 0}
ZERO_MESSAGE = {"outcome": "none", "speech_ms": 0, "recording_ms": 0, "callback_confirmed": False, "callback_via": None,
                "recording_saved": False, "recording_declined": False, "ai_answered": None, "ai_speech_ms": None}
# What the Taiwan host keeps a transcript and summary of (and, for a message, the recording): any call with a
# conversation or a message. Missed and silent calls keep nothing; test calls keep nothing either ("試打不留錄音").
CONTENT_KINDS = ("ai", "ai_msg", "handoff", "message", "short", "degraded")
# The Taiwan host's answer to a deletion request (R4): an AI call under recording_mode message_only has a transcript
# and a summary file and one row of its own.
DELETED_FILES, DELETED_ROWS = 2, 1

# What demo-plan.txt says about the calls the walkthrough points at (owner-facing, Traditional Chinese).
SCENES = {
    "booking": "預約：客人約洗牙，AI 覆誦日期和時段，客人確認後才記下",
    "cancel": "取消預約：AI 覆誦要取消的日期和時段，客人說對才取消",
    "emergency": "緊急：AI 第一句就請客人撥 119，接著轉給值班人員",
    "price": "問價：知識庫沒有這一項，AI 沒有報價，改請櫃台回電",
    "message_taken": "留言：AI 請客人留言，客人按 1 確認回電號碼",
    "to_delete": "現場刪除用：客人留言（有錄音）",
    "deleted": "已刪除：店家刪了這通的錄音與文字，紀錄端已確認刪除",
}
OUTCOME_ZH = {"answered": "已回答", "message": "留言", "handoff": "轉真人", "degraded": "降級", "not_answered": "未接通",
              "hangup_early": "開頭就掛斷", "no_speech": "沒有說話", "error": "處理失敗", "unknown": "待補紀錄"}


class SeedError(Exception):
    pass


# ---------------------------------------------------------------- HTTP (the BFF with a cookie jar; the runtime with a token)


class Client:
    """One actor: cookies kept in memory, every call through the frontend BFF at /api/portal."""

    def __init__(self, name):
        self.name = name
        self.cookies = {}

    def call(self, method, path, body=None, expect=None, prefix="/api/portal", token=None):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(data))
        if method != "GET":
            headers["Origin"] = FRONT
        if self.cookies:
            headers["Cookie"] = "; ".join("%s=%s" % pair for pair in self.cookies.items())
        if token:
            headers["Authorization"] = "Bearer " + token
        con = http.client.HTTPConnection(HOST, PORT, timeout=120)
        try:
            con.request(method, prefix + path, body=data, headers=headers)
            response = con.getresponse()
            raw = response.read()
            status = response.status
            for line in response.msg.get_all("Set-Cookie") or []:
                name, _, value = line.split(";")[0].partition("=")
                if value == "" or "max-age=0" in line.lower():
                    self.cookies.pop(name.strip(), None)
                else:
                    self.cookies[name.strip()] = value
        finally:
            con.close()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            payload = raw.decode("utf-8", "replace")
        if expect is not None:
            ok = status in (expect if isinstance(expect, (tuple, list)) else (expect,))
            if not ok:
                reason = payload.get("error") if isinstance(payload, dict) else str(payload)[:120]
                raise SeedError("%s: %s %s%s -> %d (wanted %s) %s" % (self.name, method, prefix, path, status, expect, reason))
        return status, payload


def runtime(method, path, body=None, expect=None):
    """The runtime's own door: Next's /api/voice-runtime/* with the test-only bearer token (never the BFF)."""
    return Client("runtime").call(method, path, body, expect=expect, prefix="/api/voice-runtime", token=RUNTIME_TOKEN)


# ---------------------------------------------------------------- small helpers


def say(text):
    print(text, flush=True)


def iso(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def taipei_text(epoch):
    return datetime.datetime.fromtimestamp(epoch, TAIPEI).strftime("%m/%d %H:%M")


def month_start(epoch):
    local = datetime.datetime.fromtimestamp(epoch, TAIPEI)
    return int(local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())


def taipei_epoch(days_ago, hhmm, now):
    local = datetime.datetime.fromtimestamp(now, TAIPEI) - datetime.timedelta(days=days_ago)
    hour, minute = (int(part) for part in hhmm.split(":"))
    return int(local.replace(hour=hour, minute=minute, second=0, microsecond=0).timestamp())


def new_password():
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"  # no look-alike characters: it gets typed during a screen share
    return "demo-" + "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))


def write_private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.chmod(path, 0o600)


def write_credentials(entries, front):
    lines = ["# Local phone-agent portal demo. Fake data, loopback only. Generated by seed_demo.py; not for the repository.",
             "# Sign in at %s/login" % front, ""]
    for label, email, password in entries:
        lines.append("%s    %s    %s" % (label, email, password))
    write_private(CREDENTIALS, "\n".join(lines) + "\n")


def read_credentials():
    found = {}
    with open(CREDENTIALS, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("#") or not line.strip():
                continue
            parts = re.split(r"\s{2,}", line.strip())
            if len(parts) == 3:
                found[parts[0]] = (parts[1], parts[2])
    return found


# ---------------------------------------------------------------- the two demo stores

STORES = [
    {
        "key": "clinic", "label": "店家 晴光牙醫診所", "email": "owner-clinic@portal-demo.test", "owner": "林小姐（示範）",
        "name": "晴光牙醫診所", "industry": "clinic", "number": "+886200000011", "domestic": "0200000011",
        "ask_callback": "always", "closure_note": "示範：院內訓練休診",
        "rewrites": {
            "自費項目多少錢？": "洗牙一次 800 元，冷光美白一次 6,000 元；根管治療和植牙要先看診評估，才能報價。以上是示範價格。",
            "掛號費多少？": "掛號費 150 元，另外依健保規定收部分負擔。以上是示範內容。",
            "國定假日或過年有看診嗎？": "國定假日休診；過年期間的看診時間，會提前在 LINE 官方帳號公告。",
        },
        "new_faq": {"question": "有提供牙齒美白嗎？", "answer": "有，冷光美白一次 6,000 元，要先洗牙，療程約 1 小時，請先預約。",
                    "variants": ["美白價格", "牙齒美白"]},
    },
    {
        "key": "cram", "label": "店家 啟明文理補習班", "email": "owner-cram@portal-demo.test", "owner": "蔡主任（示範）",
        "name": "啟明文理補習班", "industry": "cram", "number": "+886200000022", "domestic": "0200000022",
        "ask_callback": "auto", "closure_note": "示範：段考週停課",
        "rewrites": {
            "學費一個月多少？": "國小班每科每月 1,600 元，國中班每科每月 2,000 元，高中班每科每月 2,400 元。以上是示範價格。",
            "可以試聽嗎？": "可以，每個班的第一堂可以免費試聽一次，請先預約。",
            "怎麼報名？": "可以到補習班櫃台報名，或用 LINE 官方帳號預約；報名要填表，並繳第一個月的學費。",
        },
        "new_faq": {"question": "有提供作文批改嗎？", "answer": "有，國小作文班每週批改一篇，國中國文班每月批改兩篇。",
                    "variants": ["作文批改", "批改作文"]},
    },
]

# ---------------------------------------------------------------- the calls
#
# day = days before today (Taipei), at = the time of day; the list is in time order. kind:
#   ai        the AI answered; the customer spoke `speech` ms
#   ai_msg    the AI answered, then the caller left a message (`callback`: confirmed the callback number)
#   handoff   the AI handed the call to a person (`handoff` = reason, `urgent`)
#   message   no AI part: a message left on the answering machine (records sender only)
#   short     the AI answered but the customer spoke under 3 s (not counted for billing)
#   degraded  the AI failed part-way (llm) and the call fell back to a message
#   missed    nobody answered (NO ANSWER)
#   silent    answered, the caller said nothing
#   try       a test call from the store's try page
# tail = the caller's last 3 digits (else made up from the position); flag = the store marks it "wrong answer" with
# this note; review = the operator's (score, labels, note, status); scene = a call the walkthrough points at (SCENES):
# "deleted" is deleted by the store during seeding, "to_delete" is left for the presenter to delete live.

CALLS = {
    "clinic": [
        dict(day=9, at="09:12", kind="ai", seconds=96, speech=8400, turns=4),
        dict(day=8, at="10:35", kind="ai", seconds=71, speech=5100, turns=3),
        dict(day=8, at="14:20", kind="message", seconds=48, speech=7000, callback=True),
        dict(day=7, at="09:48", kind="ai", seconds=120, speech=9800, turns=5, auto=["low_confidence"],
             flag="問洗牙價格，AI 說的是去年的價錢",
             review=(2, ["wrong_answer"], "價格題答錯，知識庫的洗牙價格要更新。", "done")),
        dict(day=7, at="19:05", kind="handoff", seconds=64, speech=4300, turns=3, handoff="requested", urgent=False),
        dict(day=6, at="11:30", kind="short", seconds=19, speech=1800, turns=1),
        dict(day=6, at="21:40", kind="message", seconds=61, speech=11000, callback=False),
        dict(day=5, at="10:02", kind="ai", seconds=88, speech=6200, turns=4),
        dict(day=5, at="15:16", kind="handoff", seconds=52, speech=3900, turns=2, handoff="urgent", urgent=True,
             review=(5, [], "緊急來電有轉給人員，處理得很好。", "done")),
        dict(day=4, at="09:30", kind="ai_msg", seconds=104, speech=4800, turns=3, msg_speech=5200),
        dict(day=4, at="13:05", kind="ai", seconds=77, speech=5600, turns=3, auto=["impatient"],
             flag="AI 說週六下午有門診，其實沒有",
             review=(1, ["wrong_answer", "made_up"], "營業時間講錯，要檢查週六的設定。", "open")),
        dict(day=3, at="10:44", kind="try", seconds=58, speech=7600, turns=3),
        dict(day=3, at="17:22", kind="degraded", seconds=47, speech=3100, turns=2, degrade="llm", msg_speech=4200,
             review=(3, ["slow"], "模型逾時，改成留言，客人沒有被晾著。", "done")),
        dict(day=2, at="09:15", kind="short", seconds=14, speech=2400, turns=1),
        dict(day=2, at="11:40", kind="ai", seconds=118, speech=9600, turns=5, auto=["impatient"], tail="264", scene="deleted"),
        dict(day=2, at="12:50", kind="message", seconds=39, speech=6000, callback=True),
        dict(day=2, at="20:10", kind="handoff", seconds=83, speech=6900, turns=4, handoff="complaint", urgent=False),
        dict(day=1, at="10:20", kind="missed", seconds=28),
        dict(day=1, at="14:42", kind="ai", seconds=92, speech=7300, turns=4,
             flag="問兒童牙科，AI 說沒有，其實有兒童門診"),
        dict(day=0, at="09:05", kind="silent", seconds=21),
        dict(day=0, at="09:20", kind="ai", seconds=104, speech=8800, turns=6, tail="315", scene="booking",
             review=(5, [], "預約：客人想約下週三早上洗牙，AI 先說有哪些時段，再覆誦日期和時段，客人確認後才記下。", "done")),
        dict(day=0, at="09:50", kind="try", seconds=44, speech=5300, turns=2),
        dict(day=0, at="10:15", kind="ai", seconds=86, speech=6900, turns=5, tail="528", scene="cancel",
             review=(5, [], "取消：客人要取消明天下午的回診，AI 覆誦要取消的日期和時段，客人說對，才確認取消。", "done")),
        dict(day=0, at="10:48", kind="handoff", seconds=58, speech=4600, turns=2, handoff="urgent", urgent=True, tail="806",
             scene="emergency",
             review=(5, [], "緊急：客人說家人臉頰腫得很厲害、呼吸不太順，AI 第一句就請客人立刻撥 119，接著轉給值班人員。", "done")),
        dict(day=0, at="11:30", kind="ai", seconds=74, speech=5800, turns=4, auto=["no_answer"], tail="947", scene="price",
             review=(4, [], "問價：客人問全口重建大概多少錢，知識庫沒有這一項，AI 沒有報價，說會請櫃台回電說明。要不要補進問答，待確認。",
                     "open")),
        dict(day=0, at="13:10", kind="ai_msg", seconds=112, speech=5200, turns=3, msg_speech=6400, tail="172",
             scene="message_taken",
             review=(5, [], "留言：客人想改約，想約的時段沒有門診，AI 請客人留言；客人留下方便回電的時段，按 1 確認回電號碼。", "done")),
        dict(day=0, at="14:25", kind="message", seconds=66, speech=9400, callback=True, tail="730", scene="to_delete"),
    ],
    "cram": [
        dict(day=8, at="15:30", kind="ai", seconds=84, speech=6700, turns=4),
        dict(day=7, at="19:40", kind="message", seconds=57, speech=9000, callback=True),
        dict(day=6, at="16:05", kind="ai", seconds=102, speech=8800, turns=5, auto=["no_answer"],
             flag="問國中理化的上課時間，AI 說錯星期",
             review=(2, ["wrong_answer"], "八年級理化的時間答錯，要更新課表。", "done")),
        dict(day=5, at="20:15", kind="handoff", seconds=66, speech=4700, turns=3, handoff="requested", urgent=False),
        dict(day=4, at="14:10", kind="short", seconds=16, speech=2100, turns=1),
        dict(day=3, at="21:05", kind="message", seconds=44, speech=6500, callback=False),
        dict(day=2, at="17:30", kind="ai_msg", seconds=95, speech=4200, turns=3, msg_speech=4800),
        dict(day=1, at="13:20", kind="try", seconds=52, speech=6100, turns=3),
        dict(day=1, at="18:45", kind="ai", seconds=73, speech=5400, turns=3,
             review=(4, [], "回答完整，語氣自然。", "done")),
        dict(day=0, at="14:00", kind="silent", seconds=18),
    ],
}


def caller_tail(spec):
    return spec.get("tail") or "%03d" % (spec["_n"] * 37 % 1000)


def content_expected(spec):
    return spec["kind"] in CONTENT_KINDS


def orchestrator_report(call_id, spec, number, settings, started, *, try_store=None):
    config = settings["config"]
    version = settings["config_version"]
    entry = "try" if spec["kind"] == "try" else "pstn"
    seconds = spec["seconds"]
    handoff = None
    if spec["kind"] == "handoff":
        handoff = {"reason": spec["handoff"], "urgent": spec["urgent"]}
    degraded = {"reason": spec["degrade"], "at_ms": spec["speech"]} if spec["kind"] == "degraded" else None
    return {
        "schema": "voice.call-report/v1", "source": "orchestrator", "call_id": call_id, "entry": entry,
        "dialed": None if entry == "try" else number, "store_id": try_store if entry == "try" else None,
        "started_at": iso(started), "answered_at": iso(started + 2), "ended_at": iso(started + seconds),
        "sent_at": iso(int(time.time())), "disposition": "ANSWERED",
        "caller_tail": None if entry == "try" else caller_tail(spec),
        "caller_kind": "web" if entry == "try" else "mobile",
        "config": {"version": version, "sha256": settings["config_sha256"]},
        "disclosure_version": config.get("opening", {}).get("disclosure_version"),
        "ai": {"answered": True, "speech_ms": spec.get("speech", 0), "turns": spec.get("turns", 0), "handoff": handoff,
               "auto_flags": list(spec.get("auto", [])), "degraded": degraded, "metrics": dict(METRICS)},
        "message": dict(ZERO_MESSAGE), "message_final": None, "fallback": False,
        "content_expected": entry != "try" and content_expected(spec), "retention_days": settings["store"]["retention_days"]}


def records_report(call_id, spec, number, settings, started, *, message, disposition="ANSWERED", fallback=False):
    """The Taiwan host's records sender: the whole call (its message part final)."""
    seconds = spec["seconds"]
    config = settings["config"]
    return {
        "schema": "voice.call-report/v1", "source": "records", "call_id": call_id, "entry": "pstn", "dialed": number,
        "store_id": None, "started_at": iso(started), "answered_at": None if disposition != "ANSWERED" else iso(started + 1),
        "ended_at": iso(started + seconds), "sent_at": iso(int(time.time())), "disposition": disposition,
        "caller_tail": caller_tail(spec), "caller_kind": "mobile", "config": None,
        "disclosure_version": config.get("opening", {}).get("disclosure_version") or "draft-0", "ai": None,
        "message": message, "message_final": True, "fallback": fallback,
        "content_expected": content_expected(spec), "retention_days": settings["store"]["retention_days"]}


def ai_seen(spec):
    """What the records sender knows of the AI part: that it answered and how long the caller spoke to it."""
    return {"ai_answered": True, "ai_speech_ms": spec["speech"]}


def message_part(speech_ms, callback, ai=None):
    return dict({"outcome": "message", "speech_ms": speech_ms, "recording_ms": speech_ms + 2000,
                 "callback_confirmed": callback, "callback_via": "dtmf" if callback else None,
                 "recording_saved": True, "recording_declined": False, "ai_answered": None, "ai_speech_ms": None}, **(ai or {}))


def send_call(reports, expect=(200, 201)):
    """Send one or two reports of the same call; return the portal's answer for the last one."""
    answer = None
    for body in reports:
        body = dict(body, sent_at=iso(int(time.time())))
        status, answer = runtime("POST", "/calls", body, expect=expect)
    return answer


def report_calls(store, settings, started_list, tag):
    """Report this store's calls; returns the portal rows in order: [(spec, row id, answer, call id, started)]."""
    rows = []
    for spec, started in started_list:
        n = spec["_n"]
        call_id = "demo%s.%d.%03d" % (tag, started, n) if spec["kind"] != "try" else "try-" + secrets.token_hex(16)
        kind = spec["kind"]
        number = store["domestic"]

        def records(message, **extra):
            return records_report(call_id, spec, number, settings, started, message=message, **extra)

        if kind == "try":
            reports = [orchestrator_report(call_id, spec, number, settings, started, try_store=store["id"])]
        elif kind in ("ai", "short", "handoff"):
            reports = [orchestrator_report(call_id, spec, number, settings, started), records(dict(ZERO_MESSAGE, **ai_seen(spec)))]
        elif kind == "ai_msg":
            reports = [orchestrator_report(call_id, spec, number, settings, started),
                       records(message_part(spec["msg_speech"], spec.get("callback", True), ai_seen(spec)))]
        elif kind == "degraded":
            reports = [orchestrator_report(call_id, spec, number, settings, started),
                       records(message_part(spec["msg_speech"], False, ai_seen(spec)), fallback=True)]
        elif kind == "message":
            reports = [records(message_part(spec["speech"], spec["callback"]))]
        elif kind == "missed":
            reports = [records(dict(ZERO_MESSAGE), disposition="NO ANSWER")]
        elif kind == "silent":
            reports = [records(dict(ZERO_MESSAGE, outcome="no_speech"))]
        else:
            raise SeedError("unknown call kind " + kind)
        answer = send_call(reports)
        rows.append((spec, answer["id"], answer, call_id, started))
    return rows


def spread_times(specs, now):
    """(spec, started epoch) for each call: its day and time of day, kept inside this month and before now."""
    floor = month_start(now) + 3600
    out = []
    for n, spec in enumerate(specs):
        spec["_n"] = n + 1
        started = taipei_epoch(spec["day"], spec["at"], now)
        started = min(started, now - 900 - 60 * (len(specs) - n))
        started = max(started, floor + 600 * n)
        out.append((spec, started))
    return out


def month_view(owner):
    """The store's call list for this month (M13): (summary, listed row ids)."""
    _, month = owner.call("GET", "/me/voice/calls", expect=200)
    return month["summary"], [call["id"] for call in month.get("calls", [])]


# ---------------------------------------------------------------- seeding


def login(client, email, password):
    client.cookies.clear()
    client.call("POST", "/auth/login", {"email": email, "password": password}, expect=200)


def create_admin(password):
    env = dict(os.environ, PC_PORTAL_DB=os.path.join(S, "db", "portal.sqlite3"), PC_PORTAL_DATABASE_URL="",
               PC_PORTAL_ADMIN_PASSWORD=password, PC_GATEWAY_ORIGIN="https://gateway.invalid", PC_GRAFANA_URL="")
    done = subprocess.run([sys.executable, "-m", "server.manage", "create-admin", "--email", ADMIN_EMAIL, "--name", "示範營運"],
                          cwd=W, env=env, capture_output=True, text=True)
    if done.returncode != 0:
        text = (done.stdout + done.stderr).strip()
        if "already exists" in text:
            raise SeedError("the demo database already has an administrator but %s is missing; run demo-local.sh reset" % CREDENTIALS)
        raise SeedError("create-admin failed: " + text[-300:])


def already_seeded():
    """True when the credentials file exists, the operator can sign in and both demo stores are listed."""
    if not os.path.exists(CREDENTIALS):
        return False
    creds = read_credentials()
    if "營運" not in creds:
        raise SeedError("%s is incomplete; run demo-local.sh reset" % CREDENTIALS)
    admin = Client("operator")
    try:
        login(admin, *creds["營運"])
    except SeedError:
        raise SeedError("the credentials file does not match the database; run demo-local.sh reset")
    _, listing = admin.call("GET", "/admin/voice/stores", expect=200)
    names = {item["name"] for item in listing.get("stores", [])}
    if all(store["name"] in names for store in STORES):
        return True
    if names:
        raise SeedError("the database holds other stores; run demo-local.sh reset")
    return False


def open_store(admin, spec, passwords):
    """Operator opens the store; the owner signs in with the temporary password and changes it. Returns the owner client."""
    _, created = admin.call("POST", "/admin/voice/stores", {"email": spec["email"], "displayName": spec["owner"],
                                                           "storeName": spec["name"], "industry": spec["industry"]}, expect=201)
    spec["id"] = created["store"]["id"]
    temp = created["temporaryPassword"]
    owner = Client("owner " + spec["key"])
    login(owner, spec["email"], temp)
    owner.call("POST", "/password", {"currentPassword": temp, "newPassword": passwords[spec["key"]]}, expect=200)
    return owner


def fill_store(owner, spec, now):
    template = json.load(open(os.path.join(W, "server", "voice_templates", spec["industry"] + ".json"), encoding="utf-8"))
    old, new = PHONE_REPLACE[spec["industry"]]
    hours = [{"weekday": h["weekday"], "openMin": h["open_min"], "closeMin": h["close_min"]} for h in template["hours_example"]]
    closure_day = (datetime.datetime.fromtimestamp(now, TAIPEI) + datetime.timedelta(days=45)).strftime("%Y-%m-%d")
    owner.call("POST", "/me/voice/setup", {"greeting": template["greeting_example"], "hours": hours,
                                          "closures": [{"date": closure_day, "note": spec["closure_note"]}],
                                          "askCallback": spec["ask_callback"]}, expect=200)
    _, imported = owner.call("POST", "/me/voice/faqs/from-template", {"mode": "replace", "includeIntro": True}, expect=200)
    faqs = imported["faqs"]
    owner.call("POST", "/me/voice/setup", {"introText": template["example_values"]["intro_text"].replace(old, new)}, expect=200)
    for entry in template["example_values"]["faqs"]:
        update = {key: entry[key] for key in ("question", "answer", "variants") if key in entry}
        if "answer" in update:
            update["answer"] = update["answer"].replace(old, new)
        owner.call("POST", "/me/voice/faqs/" + faqs[entry["index"]]["id"], update, expect=200)
    _, listing = owner.call("GET", "/me/voice/faqs", expect=200)
    by_question = {faq["question"]: faq["id"] for faq in listing["faqs"]}
    rewritten = 0
    for question, answer in spec["rewrites"].items():
        if question in by_question:
            owner.call("POST", "/me/voice/faqs/" + by_question[question], {"answer": answer}, expect=200)
            rewritten += 1
        else:
            say("  note: template question not found, not rewritten: " + question)
    owner.call("POST", "/me/voice/faqs", spec["new_faq"], expect=201)
    _, listing = owner.call("GET", "/me/voice/faqs", expect=200)
    left = [faq["question"] for faq in listing["faqs"] if faq.get("needsInput")]
    if left:
        raise SeedError("%s: %d questions still need input after filling (%s…)" % (spec["name"], len(left), left[0]))
    _, preview = owner.call("GET", "/me/voice/preview", expect=200)
    if preview.get("problems"):
        raise SeedError("%s: the draft does not compile: %s" % (spec["name"], json.dumps(preview["problems"], ensure_ascii=False)[:200]))
    _, published = owner.call("POST", "/me/voice/publish", {}, expect=200)
    owner.call("POST", "/me/voice/try", {}, expect=200)  # issues a try ticket (never used): the operator's "最後試打" shows a time
    return {"questions": len(listing["faqs"]), "rewritten": rewritten + 1, "version": published.get("version")}


def delete_and_confirm(owner, rows):
    """The scene "deleted" call: the store deletes it (M18), then the Taiwan host's records sender pulls the request
    (R3) and acknowledges it (R4), as production does a few minutes later. Billing must not move."""
    before, listed = month_view(owner)
    done = []
    for spec, row_id, _, call_id, started in rows:
        if spec.get("scene") != "deleted":
            continue
        _, answer = owner.call("DELETE", "/me/voice/calls/" + row_id, expect=200)
        if answer.get("changed") is not True:
            raise SeedError("M18 did not delete %s: %s" % (row_id, answer))
        _, pulled = runtime("GET", "/deletions?limit=100", expect=200)
        ids = [item["id"] for item in pulled.get("deletions", []) if item.get("call_id") == call_id]
        if len(ids) != 1:
            raise SeedError("R3 lists %d requests for the deleted call, wanted 1" % len(ids))
        _, acked = runtime("POST", "/deletions/%s/ack" % ids[0], {"files_deleted": DELETED_FILES, "rows_deleted": DELETED_ROWS},
                           expect=200)
        if acked.get("result") != "acked":
            raise SeedError("R4 did not acknowledge the deletion: %s" % acked)
        done.append(row_id)
    after, listed_after = month_view(owner)
    if (after["total"], after["meterUnits"]) != (before["total"], before["meterUnits"]) or after["deleted"] != before["deleted"] + len(done):
        raise SeedError("billing moved on deletion: before %s, after %s" % (before, after))
    if any(row_id in listed_after for row_id in done) or len(listed_after) != len(listed) - len(done):
        raise SeedError("the deleted call is still on the store's list")
    return before, after, len(done)


def write_plan(rows_by_store):
    """demo-plan.txt (for the presenter) and demo-plan.json (for a later run of this script): the calls the walkthrough
    points at. Times are Taipei time; the call ID is what the store's call page shows after 通話編號."""
    clinic = STORES[0]
    rows = rows_by_store[clinic["key"]]
    scenes = {spec["scene"]: (spec, row_id, answer, started) for spec, row_id, answer, _, started in rows if spec.get("scene")}

    def line(scene, *, tail=True):
        spec, row_id, answer, started = scenes[scene]
        outcome = OUTCOME_ZH.get(answer.get("outcome"), answer.get("outcome"))
        if spec.get("urgent"):
            outcome += "（緊急）"
        caller = "尾碼 %s" % caller_tail(spec) if tail else "尾碼已清除"
        return "%s  %s  %s  %d 秒  通話編號 %s  %s" % (taipei_text(started), caller, outcome, spec["seconds"], row_id[:8], SCENES[scene])

    text = ["# 本機示範要用到的幾通（假資料；尾碼是來電號碼的最後三碼）。seed_demo.py 產生，reset 會重排時間與編號。",
            "# 時間是台北時間；通話編號是店家通話細節頁「通話編號」後面的 8 碼，營運在「品質」分頁可以用它查。",
            "",
            "現場刪除（%s）：" % clinic["name"],
            "  " + line("to_delete"),
            "已經刪除（營運的品質頁看得到刪除狀態；店家清單上已經沒有）：",
            "  " + line("deleted", tail=False),
            "今天 AI 接聽的幾通（店家清單上看得到結果；逐字稿與摘要在台灣主機，本機看不到，營運的審查備註寫了這通發生什麼事）："]
    text += ["  " + line(scene) for scene in ("booking", "cancel", "emergency", "price", "message_taken")]
    write_private(PLAN_TEXT, "\n".join(text) + "\n")
    plan = {scene: {"rowId": row_id, "ref": row_id[:8], "startedAt": iso(started)} for scene, (_, row_id, _, started) in scenes.items()}
    write_private(PLAN_JSON, json.dumps({"store": clinic["name"], "calls": plan}, ensure_ascii=False, indent=1) + "\n")


def seed():
    now = int(time.time())
    os.makedirs(os.path.join(S, "db"), exist_ok=True)
    admin_password = new_password()
    passwords = {spec["key"]: new_password() for spec in STORES}

    say("1/7 operator account (python -m server.manage create-admin, the documented bootstrap)")
    create_admin(admin_password)
    write_credentials([("營運", ADMIN_EMAIL, admin_password)]
                      + [(spec["label"], spec["email"], passwords[spec["key"]]) for spec in STORES], FRONT)
    admin = Client("operator")
    login(admin, ADMIN_EMAIL, admin_password)

    say("2/7 stores: opened by the operator, set up and published by their owners")
    owners = {}
    for spec in STORES:
        owners[spec["key"]] = open_store(admin, spec, passwords)
        summary = fill_store(owners[spec["key"]], spec, now)
        say("  %s: %d questions (%d rewritten or added), published version %s" % (spec["name"], summary["questions"], summary["rewritten"], summary["version"]))

    say("3/7 number table and status")
    for spec in STORES:
        admin.call("POST", "/admin/voice/numbers", {"number": spec["number"], "storeId": spec["id"], "purpose": "customer",
                                                   "channel": "pstn", "activeFrom": (datetime.datetime.fromtimestamp(now, TAIPEI) - datetime.timedelta(days=30)).strftime("%Y-%m-%d"),
                                                   "activeUntil": None, "note": "示範用假號碼"}, expect=201)
        admin.call("POST", "/admin/voice/stores/%s/status" % spec["id"], {"status": "testing"}, expect=200)
        say("  %s: number %s, status testing" % (spec["name"], spec["domestic"]))

    say("4/7 calls (runtime API, test-only token: the orchestrator's part and the records sender's part)")
    all_rows = {}
    for spec in STORES:
        status, payload = runtime("GET", "/config?number=" + urllib.parse.quote(spec["domestic"], safe=":"), expect=200)
        if payload.get("store", {}).get("id") != spec["id"]:
            raise SeedError("the runtime resolved %s to another store" % spec["domestic"])
        if payload.get("answer_mode") != "message_only":
            raise SeedError("%s answers %s; the demo keeps AI answering off" % (spec["name"], payload.get("answer_mode")))
        timed = spread_times(CALLS[spec["key"]], now)
        all_rows[spec["key"]] = report_calls(spec, payload, timed, spec["key"][:2])
        summary, listed = month_view(owners[spec["key"]])
        if summary["total"] != len(timed) or len(listed) != len(timed):
            raise SeedError("%s: %d calls reported, the store sees %d (summary %d)" % (spec["name"], len(timed), len(listed), summary["total"]))
        say("  %s: %d calls, estimated billable %s, by outcome %s" % (
            spec["name"], summary["total"], summary["meterUnits"],
            {k: v for k, v in summary["byOutcome"].items() if v}))

    say("5/7 store flags (答錯了) and operator reviews")
    flagged = reviewed = 0
    for spec in STORES:
        for call, row_id, _, _, _ in all_rows[spec["key"]]:
            if "flag" in call:
                owners[spec["key"]].call("POST", "/me/voice/calls/%s/flag" % row_id, {"kind": "wrong_answer", "note": call["flag"]}, expect=200)
                flagged += 1
            if "review" in call:
                score, labels, note, status = call["review"]
                admin.call("POST", "/admin/voice/quality/calls/%s/review" % row_id,
                           {"score": score, "labels": labels, "note": note, "status": status}, expect=200)
                reviewed += 1
    say("  %d calls flagged by stores, %d reviewed by the operator" % (flagged, reviewed))

    say("6/7 one call deleted by the store (M18) and confirmed by the records sender (R3, R4)")
    before, after, deleted = delete_and_confirm(owners["clinic"], all_rows["clinic"])
    say("  %s: %d deleted; the month still counts %d calls and %d billable (before %d and %d), %d deleted" % (
        STORES[0]["name"], deleted, after["total"], after["meterUnits"], before["total"], before["meterUnits"], after["deleted"]))

    say("7/7 blind listening record")
    today = datetime.datetime.fromtimestamp(now, TAIPEI).strftime("%Y-%m-%d")
    admin.call("POST", "/admin/voice/quality/listening",
               {"title": "示範盲聽：電話客服語音樣本", "kind": "call_sample", "heldOn": today, "sampleCount": 20, "raterCount": 3,
                "passed": None, "summary": "示範資料：三位聽者盲聽二十段示範通話，語音自然度尚未定案。", "reportRef": ""}, expect=201)
    say("  one entry added")
    write_plan(all_rows)
    say("seeded: 2 stores, %d calls; the calls the walkthrough uses are in %s" % (sum(len(rows) for rows in all_rows.values()), PLAN_TEXT))


def check_plan():
    """On a database seeded earlier: is the call to delete live still on the store's list?"""
    if not os.path.exists(PLAN_JSON):
        say("note: %s is missing; run demo-local.sh reset for a clean start" % PLAN_JSON)
        return
    plan = json.load(open(PLAN_JSON, encoding="utf-8"))["calls"]
    creds = read_credentials()
    owner = Client("owner clinic")
    login(owner, *creds[STORES[0]["label"]])
    status, _ = owner.call("GET", "/me/voice/calls/" + plan["to_delete"]["rowId"])
    if status == 200:
        say("the call to delete live (通話編號 %s) is still on the clinic's list" % plan["to_delete"]["ref"])
    elif status == 404:
        say("the call to delete live (通話編號 %s) was deleted already; run demo-local.sh reset to show the deletion again"
            % plan["to_delete"]["ref"])
    else:
        raise SeedError("the clinic's call page answered %s" % status)


def warm():
    """Request each page once with the right sign-in so the dev server compiles it now, not in front of an audience."""
    began = time.time()
    creds = read_credentials()
    plan = [("營運", ["/admin", "/admin/voice"])]
    for spec in STORES:
        plan.append((spec["label"], ["/account", "/account/voice", "/account/voice/setup", "/account/voice/faq",
                                     "/account/voice/try", "/account/voice/calls"]))
    pages = 0
    for label, paths in plan:
        client = Client("warm " + label)
        login(client, *creds[label])
        extra = []
        if label != "營運":
            _, month = client.call("GET", "/me/voice/calls", expect=200)
            if month.get("calls"):
                extra = ["/account/voice/calls/" + month["calls"][-1]["id"]]
        for path in paths + extra:
            status, _ = client.call("GET", path, prefix="")
            if status != 200:
                say("  note: warm-up of %s answered %s" % (path, status))
            pages += 1
    say("warmed %d pages in %.0f s" % (pages, time.time() - began))


def main():
    if not os.path.isdir(S):
        raise SeedError("run directory %s does not exist; start through scripts/voice/demo/demo-local.sh" % S)
    status, _ = Client("check").call("GET", "/session")
    if status not in (200, 401):
        raise SeedError("the frontend at %s does not answer the BFF (status %s); start through demo-local.sh" % (FRONT, status))
    if already_seeded():
        say("already seeded (stores and credentials exist); nothing to seed. Use demo-local.sh reset for a clean start.")
        check_plan()
    else:
        seed()
    warm()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SeedError as error:
        print("seed failed: %s" % error, file=sys.stderr)
        sys.exit(1)
