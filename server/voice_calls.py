"""Phone-agent call details (phase2-contract.md §3-§9): the rules shared by the runtime, store and operator routes.

- `normalize_number`: §3.2 (E.164, ext-NNNN, Taiwan domestic numbers);
- `parse_report`: the strict voice.call-report/v1 schema, in the validation order of §3.4. Every key must be
  present and no other key is allowed, so a transcript, a summary or a phone number has no field to travel in;
- `ingest`: §3.4 steps 1-9 (attribution, idempotency, the records sender's one pending -> final update, conflicts).
  Call it inside BEGIN IMMEDIATE; `voice_calls.call_id` UNIQUE is the last line of defence;
- `merged_columns`: §3.5, the merge of the two sources, the outcome and the meter. The portal computes them from
  the reported facts and never takes a result or a unit count from a reporter;
- retention (§9), the media token (§8) and the JSON shapes of M13-M17 and A9-A16 (§6, §7).

Times are epoch seconds (fractions dropped); dates and months are Taipei time (fixed UTC+8).
"""
import hashlib
import hmac
import json
import re
import secrets
import unicodedata
import uuid
from datetime import datetime

from . import voice_store as vs
from .store import iso
from .support import fail
from .voice_ticket import b64u

# ---------------------------------------------------------------- enums (mirrored by lib/voice-calls.ts and 0009)

REPORT_SCHEMA = "voice.call-report/v1"
CONFIG_SCHEMA = "voice.runtime-config/v1"
SOURCES = ("orchestrator", "records")
ENTRIES = ("pstn", "webrtc", "softphone", "try")
DISPOSITIONS = ("ANSWERED", "NO ANSWER", "BUSY", "FAILED", "CONGESTION")
CALLER_KINDS = ("mobile", "landline", "hidden", "web", "unknown")
HANDOFF_REASONS = ("requested", "no_answer", "no_ai_question", "urgent", "complaint")
REPORTED_FLAGS = ("no_answer", "low_confidence", "impatient", "talk_over", "no_response")
PORTAL_FLAGS = ("degraded", "unknown_number", "config_mismatch", "source_mismatch", "retention_mismatch")
AUTO_FLAGS = REPORTED_FLAGS + PORTAL_FLAGS
REPORTED_DEGRADE_REASONS = ("llm", "tts", "asr", "orchestrator", "link", "config")
DEGRADE_REASONS = REPORTED_DEGRADE_REASONS + ("edge_fallback",)
MESSAGE_OUTCOMES = ("none", "message", "callback_only", "no_speech", "notice_hangup", "error")
CALLBACK_VIA = ("dtmf", "speech")
METRIC_KEYS = ("reply_p50_ms", "reply_p95_ms", "barge_ins", "fillers", "talk_overs", "no_responses")
OUTCOMES = ("answered", "message", "handoff", "degraded", "not_answered", "hangup_early", "no_speech", "error", "unknown")
METER_REASONS = ("ai_speech", "message", "callback", "try", "unknown_line", "non_customer_line", "channel_not_billable",
                 "not_answered", "no_message_record", "processing_error", "notice_hangup", "no_speech", "short_speech",
                 "callback_unconfirmed")
FLAG_KINDS = ("wrong_answer",)
REVIEW_LABELS = ("wrong_answer", "made_up", "missed_handoff", "over_refusal", "number_readback", "talk_over", "slow",
                 "unnatural_voice", "disclosure_missing", "other")
REVIEW_STATUSES = ("open", "done")
LISTENING_KINDS = ("tts_voice", "call_sample", "prompt_audio", "other")
CONTENT_STATES = ("none", "expired", "available")
MEDIA_KINDS = ("recording", "summary", "transcript")
MISMATCH_FIELDS = ("started_at", "entry", "dialed", "caller_tail", "caller_kind", "ended_at", "ai_answered", "ai_speech_ms")

# ---------------------------------------------------------------- limits (§1.5)

RUNTIME_BODY_BYTES = 8192
CLOCK_SKEW_SECONDS = 300
REPORT_MAX_AGE_SECONDS = 30 * 86400
CALL_MAX_SECONDS = 14400
SPEECH_MAX_MS = CALL_MAX_SECONDS * 1000
TURNS_MAX = 500
METRIC_MAX = 600000
AUTO_FLAGS_MAX = 8
SOURCE_TOLERANCE_SECONDS = 10
INT32_MAX = 2**31 - 1  # INTEGER columns on Postgres; a larger config version would fail the insert
VOICE_MIN_SPEECH_MS = 3000  # D10 draft; changing it means a new METER_RULE (old rows are not recomputed)
VOICE_BILLABLE_ENTRIES = ("pstn",)  # A6 billable_channels default
METER_RULE = "q5-draft-1"
RETENTION_DAYS_UNASSIGNED = vs.RETENTION_DAYS_MAX  # §4.1: a row without a store keeps the platform maximum
TRANSCRIPT_DAYS = 90
CALL_DETAIL_DAYS = 400
DAY_SECONDS = 86400
CONTENT_LINK_TTL_SECONDS = 300
CONTENT_LINKS_PER_HOUR = 60
CONTENT_LINK_ACTIONS = ("voice.call_content_link", "admin.voice_call_content_link")
STORE_PAGE_SIZE = 50
QUALITY_PAGE_SIZE = 100
FLAG_NOTE_CHARS = 100
REVIEW_NOTE_CHARS = 500
REVIEW_LABELS_MAX = 6
LISTENING_MAX = 500
LISTENING_TITLE_CHARS = 60
LISTENING_SUMMARY_CHARS = 1000
LISTENING_REF_CHARS = 200
LISTENING_SAMPLES_MAX = 10000
LISTENING_RATERS_MAX = 50

STORE_LIMITS = {"callsPageSize": STORE_PAGE_SIZE, "flagNoteChars": FLAG_NOTE_CHARS}
QUALITY_LIMITS = {"callsPageSize": QUALITY_PAGE_SIZE, "reviewNoteChars": REVIEW_NOTE_CHARS,
                  "reviewLabelsMax": REVIEW_LABELS_MAX, "listeningMax": LISTENING_MAX}

# ---------------------------------------------------------------- patterns

E164 = re.compile(r"\+[1-9][0-9]{6,14}")
EXTENSION = re.compile(r"ext[-:]([0-9]{4})")
DOMESTIC = re.compile(r"0([2-9][0-9]{7,8})")
DIALED = re.compile(r"[0-9A-Za-z+*#:._-]{1,32}")
CALL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
TRY_CALL_ID = re.compile(r"try-[a-f0-9]{32}")
HEX32 = re.compile(r"[a-f0-9]{32}")
HEX64 = re.compile(r"[a-f0-9]{64}")
CALLER_TAIL = re.compile(r"[0-9]{3}")
DISCLOSURE = re.compile(r"[a-z0-9._-]{1,32}")
TIME = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})")
# Years 2000-2037: epoch columns are 32-bit INTEGER on Postgres (the end of 2037-12 is still below 2**31).
MONTH = re.compile(r"(20[0-2][0-9]|203[0-7])-(0[1-9]|1[0-2])")
CURSOR = re.compile(r"([0-9]{10})-([a-f0-9]{32})")
# §6.3 (as amended by the phase 2 fix round): a note is first put in a comparable form (phone_text: NFKC, so full-width
# digits and brackets become ASCII; invisible characters dropped; Chinese numerals read as digits), then eight or more
# digits that only separators split (whitespace, - . / ( ) and the dots and dashes below) are a phone number. Digits are
# counted, not characters, so "10/22 14:30" (6 digits) is not one. lib/voice-calls.ts phoneText/PHONE_LIKE is the same
# rule; tests/support/phone-like-vectors.json holds the shared vectors and the numeral table
# (server/test_voice_calls_note_sync.py, tests/voice-p2-sync.test.ts). Digits and separators never overlap, so the
# pattern cannot backtrack badly.
PHONE_LIKE = re.compile(r"[0-9](?:[\s\-./()\u30fb\u2027\u00b7\u2010\u2011\u2013\u2014]*[0-9]){7,}")
PHONE_INVISIBLE = re.compile("[\u200b-\u200f\u2060\u061c\ufeff\u00ad]")
# Written grouped by digit (LESSONS 2026-10-22: never two zipped strings).
PHONE_NUMERALS = {"0": "零〇○洞", "1": "一壹么幺", "2": "二貳兩", "3": "三參叁", "4": "四肆", "5": "五伍", "6": "六陸", "7": "七柒",
                  "8": "八捌", "9": "九玖"}
PHONE_NUMERAL_TABLE = str.maketrans({char: digit for digit, chars in PHONE_NUMERALS.items() for char in chars})

REPORT_KEYS = ("schema", "source", "call_id", "entry", "dialed", "store_id", "started_at", "answered_at", "ended_at",
               "sent_at", "disposition", "caller_tail", "caller_kind", "config", "disclosure_version", "ai", "message",
               "message_final", "fallback", "content_expected", "retention_days")
AI_KEYS = ("answered", "speech_ms", "turns", "handoff", "auto_flags", "degraded", "metrics")
MESSAGE_KEYS = ("outcome", "speech_ms", "recording_ms", "callback_confirmed", "callback_via", "recording_saved",
                "recording_declined", "ai_answered", "ai_speech_ms")
# §3.4 step 2: what facts_sha256 leaves out besides sent_at (the records sender may complete these once).
LATER_KEYS = ("message", "message_final", "content_expected", "retention_days")
ZERO_MESSAGE = {"outcome": "none", "speech_ms": 0, "recording_ms": 0, "callback_confirmed": False, "callback_via": None,
                "recording_saved": False, "recording_declined": False, "ai_answered": None, "ai_speech_ms": None}

CALL_NOT_FOUND = "This call does not exist or does not belong to your store."


def canonical(value) -> bytes:
    return vs.canonical_json(value)


def sha256_hex(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _int_in(value, low, high):
    return is_int(value) and low <= value <= high


# ---------------------------------------------------------------- §3.2 numbers


def normalize_number(value):
    """+886... / ext-NNNN for the forms of §3.2, or None when the value cannot be normalized."""
    if not isinstance(value, str):
        return None
    if E164.fullmatch(value):
        return value
    match = EXTENSION.fullmatch(value)
    if match:
        return "ext-" + match.group(1)
    match = DOMESTIC.fullmatch(value)
    if match:
        return "+886" + match.group(1)
    return None


def to_a6_number(number):
    """The reverse direction for the A6 number table (P2-7): +886XXXXXXXXX -> 0XXXXXXXXX, ext-NNNN -> ext:NNNN."""
    if number.startswith("ext-"):
        return "ext:" + number[4:]
    if number.startswith("+886"):
        return "0" + number[4:]
    return number


# ---------------------------------------------------------------- §3.4 the report


def _invalid(detail):
    fail("call_invalid", detail)


def _time_invalid(detail):
    fail("call_time_invalid", detail)


def parse_time(value):
    """An aware datetime for an ISO 8601 time with a zone (Z or +hh:mm), or None."""
    if not isinstance(value, str) or not TIME.fullmatch(value):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def epoch(value):
    """Epoch seconds of a report time (already validated), fractions dropped."""
    return int(parse_time(value).timestamp())


def _check_ai(ai):
    if not isinstance(ai, dict):
        _invalid("invalid field: ai")
    for key in sorted(set(ai) - set(AI_KEYS)):
        _invalid("unknown field: ai." + key)
    for key in AI_KEYS:
        if key not in ai:
            _invalid("missing field: ai." + key)
    if not isinstance(ai["answered"], bool):
        _invalid("invalid field: ai.answered")
    if not _int_in(ai["speech_ms"], 0, SPEECH_MAX_MS):
        _invalid("invalid field: ai.speech_ms")
    if not _int_in(ai["turns"], 0, TURNS_MAX):
        _invalid("invalid field: ai.turns")
    handoff = ai["handoff"]
    if handoff is not None and not (isinstance(handoff, dict) and set(handoff) == {"reason", "urgent"}
                                    and handoff["reason"] in HANDOFF_REASONS and isinstance(handoff["urgent"], bool)):
        _invalid("invalid field: ai.handoff")
    flags = ai["auto_flags"]
    if not (isinstance(flags, list) and len(flags) <= AUTO_FLAGS_MAX and all(isinstance(f, str) and f in REPORTED_FLAGS for f in flags)
            and len(set(flags)) == len(flags)):
        _invalid("invalid field: ai.auto_flags")
    degraded = ai["degraded"]
    if degraded is not None and not (isinstance(degraded, dict) and set(degraded) == {"reason", "at_ms"}
                                     and degraded["reason"] in REPORTED_DEGRADE_REASONS and _int_in(degraded["at_ms"], 0, SPEECH_MAX_MS)):
        _invalid("invalid field: ai.degraded")
    metrics = ai["metrics"]
    if not (isinstance(metrics, dict) and set(metrics) == set(METRIC_KEYS)
            and all(value is None or _int_in(value, 0, METRIC_MAX) for value in metrics.values())):
        _invalid("invalid field: ai.metrics")


def _check_message(message, source):
    if not isinstance(message, dict):
        _invalid("invalid field: message")
    for key in sorted(set(message) - set(MESSAGE_KEYS)):
        _invalid("unknown field: message." + key)
    for key in MESSAGE_KEYS:
        if key not in message:
            _invalid("missing field: message." + key)
    if message["outcome"] not in MESSAGE_OUTCOMES or not isinstance(message["outcome"], str):
        _invalid("invalid field: message.outcome")
    for key in ("speech_ms", "recording_ms"):
        if not _int_in(message[key], 0, SPEECH_MAX_MS):
            _invalid("invalid field: message." + key)
    for key in ("callback_confirmed", "recording_saved", "recording_declined"):
        if not isinstance(message[key], bool):
            _invalid("invalid field: message." + key)
    via = message["callback_via"]
    if message["callback_confirmed"] and not (isinstance(via, str) and via in CALLBACK_VIA):
        _invalid("invalid field: message.callback_via")
    if not message["callback_confirmed"] and via is not None:
        _invalid("invalid field: message.callback_via")
    answered, speech = message["ai_answered"], message["ai_speech_ms"]
    if answered is not None and not isinstance(answered, bool):
        _invalid("invalid field: message.ai_answered")
    if source == "orchestrator" and answered is not None:
        _invalid("invalid field: message.ai_answered")
    if speech is not None and not (answered is True and _int_in(speech, 0, SPEECH_MAX_MS)):
        _invalid("invalid field: message.ai_speech_ms")


def parse_report(body, now):
    """Validate a voice.call-report/v1 body (§3.4 order; the first error is answered) and return it with epochs:
    {"body", "started", "answered", "ended", "sent"}. Raises PortalError 400 call_invalid / call_time_invalid /
    clock_skew / call_too_old."""
    for key in sorted(set(body) - set(REPORT_KEYS)):
        _invalid("unknown field: " + key)
    for key in REPORT_KEYS:
        if key not in body:
            _invalid("missing field: " + key)
    if body["schema"] != REPORT_SCHEMA:
        _invalid("invalid field: schema")
    source = body["source"]
    if not isinstance(source, str) or source not in SOURCES:
        _invalid("invalid field: source")
    entry = body["entry"]
    if not isinstance(entry, str) or entry not in ENTRIES or (source == "records" and entry == "try"):
        _invalid("invalid field: entry")
    call_id = body["call_id"]
    if not isinstance(call_id, str) or not CALL_ID.fullmatch(call_id):
        _invalid("invalid field: call_id")
    if (entry == "try") != bool(TRY_CALL_ID.fullmatch(call_id)) or (entry != "try" and call_id.startswith("try-")):
        _invalid("invalid field: call_id")
    dialed = body["dialed"]
    if entry == "try":
        if dialed is not None:
            _invalid("invalid field: dialed")
    elif not isinstance(dialed, str) or not DIALED.fullmatch(dialed):
        _invalid("invalid field: dialed")
    store_id = body["store_id"]
    if entry == "try":
        if not isinstance(store_id, str) or not HEX32.fullmatch(store_id):
            _invalid("invalid field: store_id")
    elif store_id is not None:
        _invalid("invalid field: store_id")

    times = {}
    for key, nullable in (("started_at", False), ("answered_at", True), ("ended_at", True), ("sent_at", False)):
        value = body[key]
        if value is None and nullable:
            times[key] = None
            continue
        parsed = parse_time(value)
        if parsed is None:
            _time_invalid("Send %s as an ISO 8601 time with a time zone." % key)
        times[key] = parsed
    started, answered, ended, sent = times["started_at"], times["answered_at"], times["ended_at"], times["sent_at"]
    if source == "orchestrator" and ended is None:
        _time_invalid("The orchestrator must send ended_at.")
    if ended is not None and ended < started:
        _time_invalid("ended_at is before started_at.")
    if answered is not None and (answered < started or (ended is not None and answered > ended)):
        _time_invalid("answered_at is outside started_at..ended_at.")
    if ended is not None and (ended - started).total_seconds() > CALL_MAX_SECONDS:
        _time_invalid("A call can be up to %d seconds." % CALL_MAX_SECONDS)
    started_epoch, sent_epoch = int(started.timestamp()), int(sent.timestamp())
    if abs(now - sent_epoch) > CLOCK_SKEW_SECONDS or started_epoch > now + CLOCK_SKEW_SECONDS:
        fail("clock_skew", "sent_at or started_at is more than %d seconds away from the portal's clock." % CLOCK_SKEW_SECONDS)
    if started_epoch < now - REPORT_MAX_AGE_SECONDS:
        fail("call_too_old", "started_at is more than 30 days ago.")

    disposition = body["disposition"]
    if not isinstance(disposition, str) or disposition not in DISPOSITIONS or (source == "orchestrator" and disposition != "ANSWERED"):
        _invalid("invalid field: disposition")
    tail = body["caller_tail"]
    if tail is not None and not (isinstance(tail, str) and CALLER_TAIL.fullmatch(tail)):
        _invalid("invalid field: caller_tail")
    if not isinstance(body["caller_kind"], str) or body["caller_kind"] not in CALLER_KINDS:
        _invalid("invalid field: caller_kind")
    config = body["config"]
    if config is not None and not (source == "orchestrator" and isinstance(config, dict) and set(config) == {"version", "sha256"}
                                   and _int_in(config["version"], 1, INT32_MAX)
                                   and isinstance(config["sha256"], str) and HEX64.fullmatch(config["sha256"])):
        _invalid("invalid field: config")
    disclosure = body["disclosure_version"]
    if disclosure is not None and not (isinstance(disclosure, str) and DISCLOSURE.fullmatch(disclosure)):
        _invalid("invalid field: disclosure_version")
    ai = body["ai"]
    if source == "orchestrator":
        _check_ai(ai)
    elif ai is not None:
        _invalid("invalid field: ai")
    message = body["message"]
    _check_message(message, source)
    final = body["message_final"]
    if source == "orchestrator" and final is not None:
        _invalid("invalid field: message_final")
    if source == "records":
        if not isinstance(final, bool):
            _invalid("invalid field: message_final")
        if final is False and message != ZERO_MESSAGE:
            _invalid("invalid field: message (a pending records report sends the all-zero message)")
    if not isinstance(body["fallback"], bool) or (source == "orchestrator" and body["fallback"]):
        _invalid("invalid field: fallback")
    if not isinstance(body["content_expected"], bool):
        _invalid("invalid field: content_expected")
    retention = body["retention_days"]
    if retention is not None and not _int_in(retention, 1, vs.RETENTION_DAYS_MAX):
        _invalid("invalid field: retention_days")

    cap = SPEECH_MAX_MS if ended is None else int((ended - started).total_seconds() * 1000) + 1000
    for name, value in (("ai.speech_ms", ai["speech_ms"] if ai else None), ("message.speech_ms", message["speech_ms"]),
                        ("message.ai_speech_ms", message["ai_speech_ms"])):
        if value is not None and value > cap:
            _invalid("invalid field: %s (longer than the call)" % name)
    return {"body": body, "started": started_epoch, "sent": sent_epoch}


def stored_report(body):
    """The report as stored and hashed: everything but sent_at (§3.4 step 2)."""
    return {key: value for key, value in body.items() if key != "sent_at"}


def part_sha256(body):
    return sha256_hex(stored_report(body))


def facts_sha256(body):
    return sha256_hex({key: value for key, value in body.items() if key != "sent_at" and key not in LATER_KEYS})


# ---------------------------------------------------------------- §3.5 merge, outcome, meter


def _ai_view(orch, rec):
    """(AI answered, AI-part speech ms) after the merge: the orchestrator's values, else the records sender's."""
    if orch is not None:
        on = orch["ai"]["answered"]
        return on, orch["ai"]["speech_ms"] if on else 0
    message = rec["message"]
    on = message["ai_answered"] is True
    return on, (message["ai_speech_ms"] or 0) if on else 0


def mismatch_fields(orch, rec):
    """§3.5: fields where the two sources disagree (MISMATCH_FIELDS order); [] unless both are present."""
    if orch is None or rec is None:
        return []
    out = []
    if abs(epoch(orch["started_at"]) - epoch(rec["started_at"])) > SOURCE_TOLERANCE_SECONDS:
        out.append("started_at")
    if orch["entry"] != rec["entry"]:
        out.append("entry")
    if (normalize_number(orch["dialed"]) or orch["dialed"]) != (normalize_number(rec["dialed"]) or rec["dialed"]):
        out.append("dialed")
    if orch["caller_tail"] is not None and rec["caller_tail"] is not None and orch["caller_tail"] != rec["caller_tail"]:
        out.append("caller_tail")
    if "unknown" not in (orch["caller_kind"], rec["caller_kind"]) and orch["caller_kind"] != rec["caller_kind"]:
        out.append("caller_kind")
    if rec["ended_at"] is not None and epoch(orch["ended_at"]) - epoch(rec["ended_at"]) > SOURCE_TOLERANCE_SECONDS:
        out.append("ended_at")
    message = rec["message"]
    if message["ai_answered"] is not None and message["ai_answered"] != orch["ai"]["answered"]:
        out.append("ai_answered")
    if message["ai_speech_ms"] is not None and message["ai_speech_ms"] != orch["ai"]["speech_ms"]:
        out.append("ai_speech_ms")
    return out


def outcome_of(facts):
    """§3.5 outcome table, first row that holds. `facts` keys: disposition, ai_on, handoff, message_outcome,
    callback_confirmed, degraded."""
    message = facts["message_outcome"]
    if facts["disposition"] != "ANSWERED" and not facts["ai_on"] and message == "none":
        return "not_answered"
    if facts["handoff"]:
        return "handoff"
    if message in ("message", "callback_only") or facts["callback_confirmed"]:
        return "message"
    if facts["degraded"]:
        return "degraded"
    if facts["ai_on"]:
        return "answered"
    return {"notice_hangup": "hangup_early", "no_speech": "no_speech", "error": "error"}.get(message, "unknown")


def meter_of(facts):
    """§3.5 meter table (rule q5-draft-1): (units, reason). Extra `facts` keys: entry, number_id, purpose, ai_ms,
    message_ms."""
    message, on = facts["message_outcome"], facts["ai_on"]
    if facts["entry"] == "try":
        return 0, "try"
    if facts["number_id"] is None:
        return 0, "unknown_line"
    if facts["purpose"] != "customer":
        return 0, "non_customer_line"
    if facts["entry"] not in VOICE_BILLABLE_ENTRIES:
        return 0, "channel_not_billable"
    if facts["disposition"] != "ANSWERED" and not on and message == "none":
        return 0, "not_answered"
    speech = facts["ai_ms"] + facts["message_ms"]
    if on and speech >= VOICE_MIN_SPEECH_MS:
        return 1, "ai_speech"
    if message == "error":
        return 0, "processing_error"
    if message in ("notice_hangup", "no_speech"):
        return 0, message
    if message == "message" and facts["message_ms"] >= VOICE_MIN_SPEECH_MS:
        return 1, "message"
    if facts["callback_confirmed"]:
        return 1, "callback"
    if message == "callback_only":
        return 0, "callback_unconfirmed"
    if message == "none" and not on:
        return 0, "no_message_record"
    return 0, "no_speech" if speech == 0 else "short_speech"


def _attribution(con, orch, rec, existing):
    """number_id, store_id, number_purpose, dialed and the store snapshots (§3.4 step 1, §4.1). A row keeps the
    attribution of its first report while the merged dialed number stays the same, so later edits of the number
    table never move an existing call."""
    first = rec if rec is not None else orch
    if first["entry"] == "try":
        if existing is not None:
            return {key: existing[key] for key in ("dialed", "number_id", "store_id", "number_purpose", "retention_days_snapshot", "recording_mode")}
        store = vs.get_store(con, first["store_id"])
        return {"dialed": None, "number_id": None, "store_id": first["store_id"], "number_purpose": None,
                "retention_days_snapshot": store["retention_days"], "recording_mode": store["recording_mode"]}
    normalized = normalize_number(first["dialed"])
    dialed = normalized or first["dialed"]
    if existing is not None and existing["dialed"] == dialed:
        return {key: existing[key] for key in ("dialed", "number_id", "store_id", "number_purpose", "retention_days_snapshot", "recording_mode")}
    number = vs.find_active_number(con, normalized, epoch(first["started_at"])) if normalized else None
    store = vs.get_store(con, number["store_id"]) if number and number["store_id"] else None
    return {"dialed": dialed, "number_id": number["id"] if number else None, "store_id": store["id"] if store else None,
            "number_purpose": number["purpose"] if number else None,
            "retention_days_snapshot": store["retention_days"] if store else RETENTION_DAYS_UNASSIGNED,
            "recording_mode": store["recording_mode"] if store else None}


def merged_columns(con, orch, rec, existing):
    """Every derived voice_calls column from the stored reports (either may be None, not both); §3.5."""
    first = rec if rec is not None else orch
    owner = _attribution(con, orch, rec, existing)

    def prefer_records(key):
        if rec is not None and rec[key] is not None:
            return rec[key]
        return orch[key] if orch is not None else None

    if rec is not None and (rec["caller_kind"] != "unknown" or orch is None):
        caller_kind = rec["caller_kind"]
    else:
        caller_kind = orch["caller_kind"]
    started = epoch(first["started_at"])
    ended_text, answered_text = prefer_records("ended_at"), prefer_records("answered_at")
    ended = epoch(ended_text) if ended_text is not None else None
    answered = epoch(answered_text) if answered_text is not None else None
    duration = ended - started if ended is not None and 0 <= ended - started <= CALL_MAX_SECONDS else None
    disposition = first["disposition"]
    ai_on, ai_ms = _ai_view(orch, rec)
    ai = orch["ai"] if orch is not None else None
    message = first["message"]
    fallback = bool(rec["fallback"]) if rec is not None else False
    handoff = ai["handoff"] if ai is not None else None
    degraded_by_ai = ai["degraded"] if ai is not None else None
    degraded = degraded_by_ai is not None or fallback
    degrade_reason = degraded_by_ai["reason"] if degraded_by_ai is not None else ("edge_fallback" if fallback else None)
    config = orch["config"] if orch is not None else None
    disclosure = orch["disclosure_version"] if orch is not None and orch["disclosure_version"] is not None else (
        rec["disclosure_version"] if rec is not None else None)
    reported_retention = prefer_records("retention_days")
    mismatch = mismatch_fields(orch, rec)

    flags = set(ai["auto_flags"]) if ai is not None else set()
    if degraded:
        flags.add("degraded")
    if first["entry"] != "try" and owner["number_id"] is None:
        flags.add("unknown_number")
    store = vs.get_store(con, owner["store_id"]) if owner["store_id"] else None
    if config is not None:
        version = vs.get_config_version(con, store["id"], config["version"]) if store else None
        if version is None or version["config_sha256"] != config["sha256"]:
            flags.add("config_mismatch")
    if mismatch:
        flags.add("source_mismatch")
    if store is not None and reported_retention is not None and reported_retention > store["retention_days"]:
        flags.add("retention_mismatch")

    facts = {"entry": first["entry"], "number_id": owner["number_id"], "purpose": owner["number_purpose"],
             "disposition": disposition, "ai_on": ai_on, "ai_ms": ai_ms, "message_ms": message["speech_ms"],
             "handoff": handoff is not None, "message_outcome": message["outcome"],
             "callback_confirmed": message["callback_confirmed"], "degraded": degraded}
    units, reason = meter_of(facts)
    if first["entry"] == "try":
        message_final = 1
    else:
        message_final = 1 if rec is not None and rec["message_final"] else 0
    return dict(owner, **{
        "entry": first["entry"], "started_at": started, "ended_at": ended, "answered_at": answered, "duration_s": duration,
        "disposition": disposition, "caller_tail": prefer_records("caller_tail"), "caller_kind": caller_kind,
        "config_version": config["version"] if config else None, "config_sha256": config["sha256"] if config else None,
        "disclosure_version": disclosure, "ai_answered": 1 if ai_on else 0, "ai_speech_ms": ai_ms,
        "turns": ai["turns"] if ai is not None else 0, "handoff": 1 if handoff is not None else 0,
        "handoff_reason": handoff["reason"] if handoff is not None else None,
        "urgent": 1 if handoff is not None and handoff["urgent"] else 0,
        "message_outcome": message["outcome"], "message_final": message_final, "message_speech_ms": message["speech_ms"],
        "recording_ms": message["recording_ms"],
        "has_message": 1 if message["outcome"] == "message" or message["callback_confirmed"] else 0,
        "callback_confirmed": 1 if message["callback_confirmed"] else 0, "callback_via": message["callback_via"],
        "recording_saved": 1 if message["recording_saved"] else 0, "recording_declined": 1 if message["recording_declined"] else 0,
        "degraded": 1 if degraded else 0, "degrade_reason": degrade_reason, "outcome": outcome_of(facts),
        "auto_flags": canonical([flag for flag in AUTO_FLAGS if flag in flags]).decode("utf-8"),
        "mismatch": canonical(mismatch).decode("utf-8"),
        "metrics": canonical(ai["metrics"] if ai is not None else {}).decode("utf-8"),
        "content_expected": 1 if (orch is not None and orch["content_expected"]) or (rec is not None and rec["content_expected"]) else 0,
        "retention_days_reported": reported_retention,
        "meter_units": units, "meter_reason": reason, "meter_rule": METER_RULE,
    })


def _write(con, row_id, columns, *, insert):
    names = sorted(columns)
    if insert:
        con.execute("INSERT INTO voice_calls (id," + ",".join(names) + ") VALUES (?" + ",?" * len(names) + ")",
                    (row_id,) + tuple(columns[name] for name in names))
    else:
        con.execute("UPDATE voice_calls SET " + ",".join(name + "=?" for name in names) + " WHERE id=?",
                    tuple(columns[name] for name in names) + (row_id,))


def _source_columns(source, body, now):
    text = canonical(stored_report(body)).decode("utf-8")
    return {"report_" + source: text, "report_%s_sha256" % source: part_sha256(body), "report_%s_at" % source: now}


def _reports(row, source=None, body=None):
    reports = {name: json.loads(row["report_" + name]) if row["report_" + name] else None for name in SOURCES}
    if source is not None:
        reports[source] = stored_report(body)
    return reports


def _answer(result, row):
    return {"result": result, "id": row["id"], "call_id": row["call_id"], "outcome": row["outcome"],
            "meter_units": row["meter_units"], "meter_reason": row["meter_reason"], "store_id": row["store_id"],
            "flags": json.loads(row["auto_flags"])}


def get_call(con, row_id):
    if not isinstance(row_id, str) or not HEX32.fullmatch(row_id):
        return None
    return con.execute("SELECT * FROM voice_calls WHERE id=?", (row_id,)).fetchone()


def ingest(con, parsed, now):
    """§3.4 steps 1-9 for a parsed report. Call inside BEGIN IMMEDIATE. Returns (HTTP status, response body)."""
    body = parsed["body"]
    source = body["source"]
    row = con.execute("SELECT * FROM voice_calls WHERE call_id=?", (body["call_id"],)).fetchone()
    if row is None:
        if body["entry"] == "try" and vs.get_store(con, body["store_id"]) is None:
            _invalid("unknown store_id")
        reports = {name: None for name in SOURCES}
        reports[source] = stored_report(body)
        columns = merged_columns(con, reports["orchestrator"], reports["records"], None)
        columns.update(_source_columns(source, body, now), call_id=body["call_id"], received_at=now, updated_at=now)
        row_id = uuid.uuid4().hex
        _write(con, row_id, columns, insert=True)
        return 201, _answer("created", get_call(con, row_id))
    if (row["entry"] == "try") != (body["entry"] == "try"):
        _invalid("invalid field: entry (a try call and an edge call cannot share a call_id)")
    stored_sha = row["report_%s_sha256" % source]
    received_sha = part_sha256(body)
    result = None
    if stored_sha is None:
        result = "merged"
    elif stored_sha == received_sha:
        return 200, _answer("duplicate", row)
    elif source == "records":
        stored = json.loads(row["report_records"])
        if facts_sha256(stored) == facts_sha256(body):
            if stored["message_final"] is False and body["message_final"] is True:
                result = "updated"
            elif stored["message_final"] is True and body["message_final"] is False:
                return 200, _answer("stale", row)
    if result is None:
        fail("call_conflict", "This call_id was already reported with other content (stored %s, received %s)."
             % (stored_sha[:8], received_sha[:8]), 409)
    reports = _reports(row, source, body)
    columns = merged_columns(con, reports["orchestrator"], reports["records"], row)
    columns.update(_source_columns(source, body, now), updated_at=now)
    _write(con, row["id"], columns, insert=False)
    return 200, _answer(result, get_call(con, row["id"]))


def remerge(con, row_id, now):
    """Recompute a row from its stored reports (e.g. after a store changed its retention); returns the new row."""
    row = get_call(con, row_id)
    reports = _reports(row)
    columns = merged_columns(con, reports["orchestrator"], reports["records"], row)
    columns["updated_at"] = now
    _write(con, row_id, columns, insert=False)
    return get_call(con, row_id)


# ---------------------------------------------------------------- R1 (§3.3)


def runtime_config(con, number, now, *, have=None):
    """(state_sha256, response body) for a normalized number. Raises 404 number_not_found / number_unassigned."""
    row = vs.find_active_number(con, number, now)
    if row is None:
        fail("number_not_found", "This number has no active entry in the number table.", 404)
    if row["store_id"] is None:
        fail("number_unassigned", "This number is active but has no store.", 404)
    store = vs.get_store(con, row["store_id"])
    version = vs.get_config_version(con, store["id"], store["current_version"]) if store["current_version"] else None
    answer_mode = "ai" if store["ai_answer_enabled"] and store["status"] in ("testing", "live") and version else "message_only"
    state = {"answer_mode": answer_mode,
             "config_sha256": version["config_sha256"] if version else None,
             "config_version": version["version"] if version else None,
             "number": {"number": row["number"], "purpose": row["purpose"], "channel": row["channel"], "store_id": store["id"]},
             "store": {"id": store["id"], "status": store["status"], "ai_answer_enabled": store["ai_answer_enabled"],
                       "recording_mode": store["recording_mode"], "retention_days": store["retention_days"]}}
    state_sha = sha256_hex(state)
    payload = {"schema": CONFIG_SCHEMA, **state, "state_sha256": state_sha, "served_at": iso(now), "max_age_seconds": 60}
    if have == state_sha:
        payload["unchanged"] = True
    else:
        payload["config"] = json.loads(version["config_json"]) if version else None
    return state_sha, payload


# ---------------------------------------------------------------- §9 retention, §8 media token


def recording_days(row, store_retention_days):
    """§9: min(snapshot, the store's retention now); a row without a store keeps its snapshot."""
    snapshot = row["retention_days_snapshot"]
    return snapshot if store_retention_days is None else min(snapshot, store_retention_days)


def retention_json(row, store_retention_days):
    started = row["started_at"]
    return {"snapshotDays": row["retention_days_snapshot"], "reportedDays": row["retention_days_reported"],
            "transcriptUntil": iso(started + TRANSCRIPT_DAYS * DAY_SECONDS),
            "recordingUntil": iso(started + recording_days(row, store_retention_days) * DAY_SECONDS),
            "detailUntil": iso(started + CALL_DETAIL_DAYS * DAY_SECONDS)}


def content_kinds(row, store_retention_days, now):
    """The kinds still viewable now (sorted, §8.1); [] when nothing is (or nothing was kept)."""
    if not row["content_expected"]:
        return []
    kinds = []
    if row["recording_saved"] and now < row["started_at"] + recording_days(row, store_retention_days) * DAY_SECONDS:
        kinds.append("recording")
    if now < row["started_at"] + TRANSCRIPT_DAYS * DAY_SECONDS:
        kinds += ["summary", "transcript"]
    return sorted(kinds)


def content_json(row, store_retention_days, now, link_available):
    expected = bool(row["content_expected"])
    kinds = content_kinds(row, store_retention_days, now)
    state = "none" if not expected else ("available" if kinds else "expired")
    recording_until = None
    if row["recording_saved"]:
        recording_until = iso(row["started_at"] + recording_days(row, store_retention_days) * DAY_SECONDS)
    return {"expected": expected, "hasRecording": bool(row["recording_saved"]),
            "transcriptUntil": iso(row["started_at"] + TRANSCRIPT_DAYS * DAY_SECONDS) if expected else None,
            "recordingUntil": recording_until, "state": state, "linkAvailable": bool(link_available)}


def sign_media_token(secret, *, call_id, store_id, kinds, sub, role, now, nonce=None):
    """§8.1: B64U(canonical(payload)) "." B64U(HMAC-SHA256(secret UTF-8, first part ASCII)). `now` and `nonce` are
    injectable for vector V6. Returns (token, payload). The token is a secret for 5 minutes: never log it."""
    if not isinstance(secret, str) or len(secret.strip()) < 32:
        raise ValueError("The media secret must have at least 32 characters.")
    kinds = sorted(set(kinds))
    if not kinds or any(kind not in MEDIA_KINDS for kind in kinds) or role not in ("store", "admin"):
        raise ValueError("Unknown kind or role.")
    nonce = secrets.token_hex(16) if nonce is None else nonce
    if not HEX32.fullmatch(nonce):
        raise ValueError("The nonce must be 32 lowercase hex characters.")
    payload = {"v": 1, "purpose": "media", "aud": "voice-media", "call_id": call_id, "store_id": store_id,
               "kinds": kinds, "sub": sub, "role": role, "iat": int(now), "exp": int(now) + CONTENT_LINK_TTL_SECONDS,
               "nonce": nonce}
    first = b64u(canonical(payload))
    signature = b64u(hmac.new(secret.encode("utf-8"), first.encode("ascii"), hashlib.sha256).digest())
    return first + "." + signature, payload


def media_url(origin, call_id, kind):
    """The Taiwan host's endpoint for one kind (§8.3); call_id encoded like encodeURIComponent."""
    from urllib.parse import quote

    return "%s/v1/calls/%s/%s" % (origin, quote(call_id, safe="-_.!~*'()"), kind)


def content_links_used(con, actor_id, now):
    """Content links this account got in the last hour (both actions; §1.6). Read inside the writer lock."""
    return int(con.execute("SELECT COUNT(*) FROM audit_events WHERE action IN (?,?) AND actor_id=? AND created_at>?",
                           CONTENT_LINK_ACTIONS + (actor_id, now - 3600)).fetchone()[0])


# ---------------------------------------------------------------- months and cursors (M13, A9)


def month_bounds(month):
    """[start, end) epochs of a Taipei month YYYY-MM; ValueError for anything else."""
    match = MONTH.fullmatch(month) if isinstance(month, str) else None
    if not match:
        raise ValueError("month")
    year, number = int(match.group(1)), int(match.group(2))
    start = vs.taipei_day_start("%04d-%02d-01" % (year, number))
    end = vs.taipei_day_start("%04d-%02d-01" % (year + (number == 12), 1 if number == 12 else number + 1))
    return start, end


def taipei_month(epoch_seconds):
    return vs.taipei_date(epoch_seconds)[:7]


def cursor_of(row):
    return "%010d-%s" % (row["started_at"], row["id"])


def parse_cursor(value):
    match = CURSOR.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise ValueError("before")
    return int(match.group(1)), match.group(2)


def phone_text(text):
    """The comparable form of a note for the §6.3 check (only for matching; the note is stored as sent)."""
    return PHONE_INVISIBLE.sub("", unicodedata.normalize("NFKC", text)).translate(PHONE_NUMERAL_TABLE)


def has_phone_number(text):
    return bool(PHONE_LIKE.search(phone_text(text)))


# ---------------------------------------------------------------- JSON shapes (§6, §7)


def _seconds(milliseconds):
    return round(milliseconds / 1000, 1)


def call_item(row):
    """CallItem (§6)."""
    return {"id": row["id"], "ref": row["id"][:8], "startedAt": iso(row["started_at"]), "durationSeconds": row["duration_s"],
            "entry": row["entry"], "caller": {"tail": row["caller_tail"], "kind": row["caller_kind"]},
            "outcome": row["outcome"], "hasMessage": bool(row["has_message"]), "handoff": bool(row["handoff"]),
            "urgent": bool(row["urgent"]), "degraded": bool(row["degraded"]), "flagged": row["store_flag_kind"] is not None,
            "meterUnits": row["meter_units"], "meterReason": row["meter_reason"]}


def store_flag_json(row, review_status):
    if row["store_flag_kind"] is None:
        return None
    return {"kind": row["store_flag_kind"], "note": row["store_flag_note"] or "", "flaggedAt": iso(row["store_flagged_at"]),
            "reviewed": review_status == "done"}


def call_detail(row, store_retention_days, now, link_available, review_status):
    """M14 (§6.2)."""
    call = dict(call_item(row), answeredAt=iso(row["answered_at"]), endedAt=iso(row["ended_at"]),
                configVersion=row["config_version"], handoffReason=row["handoff_reason"],
                callbackConfirmed=bool(row["callback_confirmed"]), messageSeconds=_seconds(row["message_speech_ms"]),
                recordingSeconds=_seconds(row["recording_ms"]))
    return {"call": call, "content": content_json(row, store_retention_days, now, link_available),
            "flag": store_flag_json(row, review_status)}


def review_json(review):
    if review is None:
        return None
    return {"score": review["score"], "labels": json.loads(review["labels"]), "status": review["status"],
            "note": review["note"], "reviewer": {"id": review["reviewer_id"], "email": review["reviewer_email"]},
            "updatedAt": iso(review["updated_at"])}


def quality_item(row):
    """QualityItem (§7.1); `row` joins the store name and the review (review_* columns)."""
    review = None
    if row["review_status"] is not None:
        review = {"score": row["review_score"], "labels": json.loads(row["review_labels"]), "status": row["review_status"],
                  "note": row["review_note"], "reviewer": {"id": row["review_reviewer_id"], "email": row["review_reviewer_email"]},
                  "updatedAt": iso(row["review_updated_at"])}
    flag = None
    if row["store_flag_kind"] is not None:
        flag = {"kind": row["store_flag_kind"], "note": row["store_flag_note"] or "", "flaggedAt": iso(row["store_flagged_at"])}
    return {"id": row["id"], "callId": row["call_id"],
            "store": {"id": row["store_id"], "name": row["store_name"]} if row["store_id"] else None,
            "startedAt": iso(row["started_at"]), "durationSeconds": row["duration_s"], "entry": row["entry"],
            "dialed": row["dialed"], "numberPurpose": row["number_purpose"], "outcome": row["outcome"],
            "degraded": bool(row["degraded"]), "degradeReason": row["degrade_reason"], "handoff": bool(row["handoff"]),
            "handoffReason": row["handoff_reason"], "urgent": bool(row["urgent"]), "autoFlags": json.loads(row["auto_flags"]),
            "storeFlag": flag, "review": review, "meterUnits": row["meter_units"], "meterReason": row["meter_reason"]}


def quality_detail(row, store_retention_days, now, link_available):
    """A10 (§7.2): QualityItem plus the call's facts, content, retention and the two sources (never their text)."""
    call = dict(quality_item(row), answeredAt=iso(row["answered_at"]), endedAt=iso(row["ended_at"]),
                configVersion=row["config_version"], configSha256=row["config_sha256"],
                disclosureVersion=row["disclosure_version"], turns=row["turns"], aiAnswered=bool(row["ai_answered"]),
                aiSpeechSeconds=_seconds(row["ai_speech_ms"]),
                callSpeechSeconds=_seconds(row["ai_speech_ms"] + row["message_speech_ms"]),
                metrics=json.loads(row["metrics"]),
                message={"outcome": row["message_outcome"], "final": bool(row["message_final"]),
                         "speechSeconds": _seconds(row["message_speech_ms"]), "recordingSeconds": _seconds(row["recording_ms"]),
                         "callbackConfirmed": bool(row["callback_confirmed"]), "callbackVia": row["callback_via"],
                         "recordingSaved": bool(row["recording_saved"]), "recordingDeclined": bool(row["recording_declined"])},
                mismatch=json.loads(row["mismatch"]), retention=retention_json(row, store_retention_days),
                meterRule=row["meter_rule"])
    sources = {name: ({"receivedAt": iso(row["report_%s_at" % name]), "sha256": row["report_%s_sha256" % name]}
                      if row["report_%s_sha256" % name] else None) for name in SOURCES}
    return {"call": call, "content": content_json(row, store_retention_days, now, link_available), "sources": sources}


def listening_json(row):
    """ListeningLog (§7.5)."""
    return {"id": row["id"], "title": row["title"], "kind": row["kind"], "heldOn": row["held_on"],
            "sampleCount": row["sample_count"], "raterCount": row["rater_count"],
            "passed": None if row["passed"] is None else bool(row["passed"]), "summary": row["summary"],
            "reportRef": row["report_ref"], "createdBy": {"id": row["created_by"], "email": row["created_by_email"]},
            "createdAt": iso(row["created_at"]), "updatedAt": iso(row["updated_at"])}
