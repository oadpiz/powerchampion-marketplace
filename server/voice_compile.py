"""Compile a voice store's draft into `voice.store-config/v1` (phase1-contract.md §5.1).

`compile_store()` is a pure function: no database, clock, network or randomness, so the same draft and
version always give the same canonical JSON (§5.3). T4 uses it for the preview (M10), publish (M11) and
`hasUnpublishedChanges` (M1); the try ticket carries its output to the demo, which builds the system
prompt as `prefix + mode_separator + modes[mode]` (`system_prompt()`).

The prompt is assembled the way the P1 evaluation did it (sell-panel docs/poc-p1-2026-10-21,
scripts/llm_eval/llm_eval.py `load_prompt`/`kb_text`/`system_prompt`): rules, then the store data, then the
situation on the last line. Every call to one store therefore shares a byte-identical prefix (prefix cache).
Rules that depend on the store's settings (questions the AI must not answer, message-only after hours) are
appended to the rule list, never to the situation line, so the prefix does not depend on the time of day.

Input (snake_case, the shape T1 stores; `variants` is a list of strings, not JSON text):
  store:    {"id", "name", "greeting", "intro_text", "after_hours_mode", "ask_callback", "max_message_seconds",
             "handoff_mode", "recording_mode", "retention_days", "ai_answer_enabled"}
            Keys other than "id" and "name" may be left out; STORE_DEFAULTS (the A2 defaults) fill them.
  faqs:     [{"id", "question", "answer", "variants", "ai_allowed", "position"}]
  hours:    [{"weekday", "open_min", "close_min"}]   weekday 0 = Monday (date.weekday())
  closures: [{"date": "YYYY-MM-DD", "note"}]

Errors raise CompileError with a phase1-contract error code; T4 picks the status (400 on a write, 409 on
publish). Text is stripped before it is counted or used, as the contract requires of stored values.
"""
import functools
import hashlib
import json
import re
from datetime import date
from pathlib import Path

from .support import INVISIBLE_TEXT, UNSAFE_TEXT

SCHEMA = "voice.store-config/v1"
DISCLOSURE_VERSION = "draft-0"
MODE_SEPARATOR = "\n\n【目前情境】"
MODES = {"open": "營業時間內", "after_hours": "下班時間"}

# Opening length. 4.5 characters per second is an estimate〔推估〕, not measured; change it here only.
CHARS_PER_SECOND = 4.5
OPENING_SECONDS_MAX = 15
OPENING_NON_SPACE_MAX = int(OPENING_SECONDS_MAX * CHARS_PER_SECOND)  # 67: more than this is over 15 s
# Characters that do not count towards the opening length (§1.4). Not `\s`: Python and JS differ.
NON_SPACE_IGNORED = re.compile("[ \t\n\r 　]")

STORE_NAME_CHARS = 40
GREETING_CHARS = 40
QUESTION_CHARS = 100
ANSWER_CHARS = 400
VARIANT_CHARS = 50
VARIANTS_MAX = 10
FAQ_CHARS = 400
KB_CHARS_MAX = 6000
FAQ_MAX = 120
HOURS_SEGMENTS_PER_DAY = 4
HOURS_SEGMENTS_MAX = 7 * HOURS_SEGMENTS_PER_DAY
CLOSURES_MAX = 60
CLOSURE_NOTE_CHARS = 40
MAX_MESSAGE_SECONDS_MIN, MAX_MESSAGE_SECONDS_MAX = 60, 180
RETENTION_DAYS_MAX = 90
RETENTION_DAYS_MAX_FULL = 30

AFTER_HOURS_MODES = ("answer_and_message", "message_only")
ASK_CALLBACK_VALUES = ("auto", "always", "never")
HANDOFF_MODES = ("callback",)  # phase 1 has no transfer
RECORDING_MODES = ("off", "message_only", "full")

STORE_DEFAULTS = {"greeting": "", "intro_text": "", "after_hours_mode": "answer_and_message", "ask_callback": "auto",
                  "max_message_seconds": 120, "handoff_mode": "callback", "recording_mode": "message_only",
                  "retention_days": 90, "ai_answer_enabled": False}

# "（請填入）" or "（請填入：洗牙費用）", full-width brackets (§1.4). T3, T4 and T8 use this same pattern.
PLACEHOLDER = re.compile(r"（請填入(?:：[^）\n]{1,20})?）")

ID_PATTERN = re.compile(r"[0-9a-f]{32}")
DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
RULE_NUMBER = re.compile(r"^(\d+)\. ", re.MULTILINE)

TEMPLATE_DIR = Path(__file__).resolve().parent / "voice_templates"
PROMPT_START, PROMPT_END = "<!-- PROMPT START -->", "<!-- PROMPT END -->"
KB_ANCHOR = "\n\n【店家資料】\n{{KB}}"
MODE_TAIL = MODE_SEPARATOR + "{{MODE}}"

WEEKDAYS = ("週一", "週二", "週三", "週四", "週五", "週六", "週日")


class CompileError(ValueError):
    """`code` is a phase1-contract error code (invalid_input, greeting_too_long, opening_too_long, faq_too_long,
    faq_limit, kb_too_large, kb_empty, hours_invalid, closures_invalid, retention_exceeds_limit)."""

    def __init__(self, code, detail):
        super().__init__(code + ": " + detail)
        self.code, self.detail = code, detail


# ---------------------------------------------------------------- templates


@functools.lru_cache(maxsize=None)
def behavior_template():
    """The rule part of behavior_v1.md: everything before "\\n\\n【店家資料】\\n{{KB}}", with {{SHOP_NAME}} still in it.

    Extraction is P1's load_prompt: the text between the marker lines with leading and trailing newlines removed."""
    text = (TEMPLATE_DIR / "behavior_v1.md").read_text(encoding="utf-8")
    start = text.index(PROMPT_START) + len(PROMPT_START)
    prompt = text[start:text.index(PROMPT_END)].strip("\n")
    head = prompt[:-len(MODE_TAIL)] if prompt.endswith(MODE_TAIL) else ""
    rules = head[:-len(KB_ANCHOR)] if head.endswith(KB_ANCHOR) else ""
    if (not rules or "{{SHOP_NAME}}" not in rules or "{{KB}}" in rules or "{{MODE}}" in rules
            or not RULE_NUMBER.search(rules)):
        raise RuntimeError("behavior_v1.md must end with 【店家資料】{{KB}} and 【目前情境】{{MODE}} and have numbered rules")
    return rules


@functools.lru_cache(maxsize=None)
def disclosure_template():
    """The disclosure sentence with {{SHOP_NAME}} in it; the first line of the file is the draft marker."""
    lines = (TEMPLATE_DIR / "disclosure_draft0.txt").read_text(encoding="utf-8").split("\n")
    sentence = "\n".join(lines[1:]).strip()
    if not lines[0].startswith("草稿") or "\n" in sentence or sentence.count("{{SHOP_NAME}}") != 1:
        raise RuntimeError("disclosure_draft0.txt must be the draft marker line and one sentence with {{SHOP_NAME}}")
    return sentence


# ---------------------------------------------------------------- helpers shared with T4


def non_space(text):
    return len(NON_SPACE_IGNORED.sub("", text))


def estimate_seconds(text):
    return round(non_space(text) / CHARS_PER_SECOND, 1)


def opening_text(shop_name, greeting):
    """Disclosure with the store name, then the greeting, joined with nothing in between (§1.4)."""
    return disclosure_template().replace("{{SHOP_NAME}}", shop_name) + greeting


def has_placeholder(text):
    return PLACEHOLDER.search(text) is not None


def faq_chars(question, answer, variants):
    return len(question) + len(answer) + sum(len(variant) for variant in variants)


def canonical_json(value):
    """The bytes that are stored and hashed (§5.3). ensure_ascii=False keeps Chinese as UTF-8, not \\uXXXX."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def config_sha256(config):
    return hashlib.sha256(canonical_json(config)).hexdigest()


def system_prompt(config, mode):
    """What the demo sends as the system message: prefix + mode_separator + modes[mode]."""
    prompt = config["prompt"]
    return prompt["prefix"] + prompt["mode_separator"] + prompt["modes"][mode]


# ---------------------------------------------------------------- validation


def _fail(code, detail):
    raise CompileError(code, detail)


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _flag(value, label):
    if isinstance(value, bool) or (_is_int(value) and value in (0, 1)):
        return bool(value)
    _fail("invalid_input", label + " must be true or false.")


def _single_line(value, label, maximum, *, required, code="invalid_input", too_long="invalid_input"):
    """Same rule as support.text_value: no control, bidi or invisible characters anywhere in the raw value."""
    if not isinstance(value, str) or UNSAFE_TEXT.search(value) or INVISIBLE_TEXT.search(value):
        _fail(code, "Enter a valid " + label + ".")
    text = value.strip()
    if required and not text:
        _fail(code, "Enter a " + label + ".")
    if len(text) > maximum:
        _fail(too_long, label[:1].upper() + label[1:] + " can be up to " + str(maximum) + " characters.")
    return text


def _multi_line(value, label):
    """Multi-line text may contain newlines and tabs; other UNSAFE_TEXT characters are refused."""
    if not isinstance(value, str) or any(char not in "\n\r\t" for char in UNSAFE_TEXT.findall(value)):
        _fail("invalid_input", "Enter a valid " + label + ".")
    return value.strip()


def _choice(value, allowed, label):
    if value not in allowed:
        _fail("invalid_input", label + " must be one of " + ", ".join(allowed) + ".")
    return value


def _hours(value):
    if not isinstance(value, (list, tuple)) or len(value) > HOURS_SEGMENTS_MAX:
        _fail("hours_invalid", "Opening hours must be a list of up to " + str(HOURS_SEGMENTS_MAX) + " segments.")
    segments = []
    for item in value:
        if not isinstance(item, dict):
            _fail("hours_invalid", "Each opening-hours segment must be an object.")
        weekday, open_min, close_min = item.get("weekday"), item.get("open_min"), item.get("close_min")
        if not (_is_int(weekday) and _is_int(open_min) and _is_int(close_min) and 0 <= weekday <= 6
                and 0 <= open_min < close_min <= 1440):
            _fail("hours_invalid", "Each segment needs weekday 0-6 and 0 <= open_min < close_min <= 1440.")
        segments.append({"weekday": weekday, "open_min": open_min, "close_min": close_min})
    segments.sort(key=lambda segment: (segment["weekday"], segment["open_min"]))
    for weekday in range(7):
        day = [segment for segment in segments if segment["weekday"] == weekday]
        if len(day) > HOURS_SEGMENTS_PER_DAY:
            _fail("hours_invalid", "A day can have up to " + str(HOURS_SEGMENTS_PER_DAY) + " segments.")
        # Sorted by open_min, so two segments overlap exactly when one starts before the previous one ends.
        if any(later["open_min"] < earlier["close_min"] for earlier, later in zip(day, day[1:])):
            _fail("hours_invalid", "Segments on the same day must not overlap.")
    return segments


def _closures(value):
    if not isinstance(value, (list, tuple)) or len(value) > CLOSURES_MAX:
        _fail("closures_invalid", "Closures must be a list of up to " + str(CLOSURES_MAX) + " days.")
    closures = []
    for item in value:
        if not isinstance(item, dict):
            _fail("closures_invalid", "Each closure must be an object.")
        day = item.get("date")
        try:
            if not isinstance(day, str) or not DATE_PATTERN.fullmatch(day):
                raise ValueError()
            date.fromisoformat(day)
        except ValueError:
            _fail("closures_invalid", "Each closure needs a valid YYYY-MM-DD date.")
        note = _single_line(item.get("note", ""), "closure note", CLOSURE_NOTE_CHARS, required=False,
                            code="closures_invalid", too_long="closures_invalid")
        closures.append({"date": day, "note": note})
    closures.sort(key=lambda closure: closure["date"])
    if any(earlier["date"] == later["date"] for earlier, later in zip(closures, closures[1:])):
        _fail("closures_invalid", "Each closure date can appear only once.")
    return closures


def _faqs(value):
    if not isinstance(value, (list, tuple)) or not all(isinstance(item, dict) for item in value):
        _fail("invalid_input", "FAQs must be a list of objects.")
    for item in value:
        if not _is_int(item.get("position")) or item["position"] < 0:
            _fail("invalid_input", "Each FAQ needs a position of 0 or more.")
        if not isinstance(item.get("id"), str) or not ID_PATTERN.fullmatch(item["id"]):
            _fail("invalid_input", "Each FAQ needs a 32-character lowercase hex id.")
    if len({item["id"] for item in value}) != len(value):
        _fail("invalid_input", "FAQ ids must be unique.")
    faqs = []
    for item in sorted(value, key=lambda faq: (faq["position"], faq["id"])):
        question = _single_line(item.get("question"), "question", QUESTION_CHARS, required=True)
        answer = _multi_line(item.get("answer"), "answer")
        if not answer or len(answer) > ANSWER_CHARS:
            _fail("invalid_input", "Each answer needs 1 to " + str(ANSWER_CHARS) + " characters.")
        raw_variants = item.get("variants", [])
        if not isinstance(raw_variants, (list, tuple)):
            _fail("invalid_input", "Variants must be a list of text.")
        variants = [_single_line(variant, "variant", VARIANT_CHARS, required=False) for variant in raw_variants]
        variants = [variant for variant in variants if variant]
        if len(variants) > VARIANTS_MAX:
            _fail("invalid_input", "A question can have up to " + str(VARIANTS_MAX) + " variants.")
        ai_allowed = _flag(item.get("ai_allowed", True), "ai_allowed")
        if faq_chars(question, answer, variants) > FAQ_CHARS:
            _fail("faq_too_long", "One question, its answer and variants can be up to " + str(FAQ_CHARS) + " characters.")
        faqs.append({"id": item["id"], "question": question, "answer": answer, "variants": variants,
                     "ai_allowed": ai_allowed})
    if len(faqs) > FAQ_MAX:
        _fail("faq_limit", "A store can have up to " + str(FAQ_MAX) + " questions.")
    return faqs


# ---------------------------------------------------------------- prompt text


def _spoken_time(minute):
    """(period, clock): 540 -> (上午, 9 點), 870 -> (下午, 2 點半), 1290 -> (晚上, 9 點半). Words a phone agent says,
    in the P1 knowledge base's style ("下午 2 點到 6 點", "晚上 7 點到 9 點半"), not 09:00."""
    hour, rest = divmod(minute, 60)
    if hour in (0, 24):
        period, clock = "半夜", 12
    elif hour < 5:
        period, clock = "凌晨", hour
    elif hour < 12:
        period, clock = "上午", hour
    elif hour == 12:
        period, clock = "中午", 12
    elif hour < 19:
        period, clock = "下午", hour - 12
    else:
        period, clock = "晚上", hour - 12
    return period, str(clock) + " 點" + ("半" if rest == 30 else " " + str(rest) + " 分" if rest else "")


def _segment_text(segment):
    if (segment["open_min"], segment["close_min"]) == (0, 1440):
        return "24 小時營業"
    (open_period, open_clock), (close_period, close_clock) = _spoken_time(segment["open_min"]), _spoken_time(segment["close_min"])
    close = (" " if close_period == open_period else close_period + " ") + close_clock
    return open_period + " " + open_clock + "到" + close


def _hours_text(hours):
    lines = ["## 每週營業時間"]
    for weekday, name in enumerate(WEEKDAYS):
        day = [_segment_text(segment) for segment in hours if segment["weekday"] == weekday]
        lines.append("- " + name + "：" + ("、".join(day) if day else "休息"))
    return "\n".join(lines)


def _closures_text(closures):
    lines = ["## 特別休息日"]
    for closure in closures:
        day = date.fromisoformat(closure["date"])
        line = "- " + str(day.year) + " 年 " + str(day.month) + " 月 " + str(day.day) + " 日 " + WEEKDAYS[day.weekday()] + " 休息"
        lines.append(line + ("：" + closure["note"] if closure["note"] else ""))
    return "\n".join(lines)


def _faq_text(faqs):
    blocks = []
    for faq in faqs:
        block = "問：" + faq["question"]
        if faq["variants"]:
            block += "\n也可能問：" + "；".join(faq["variants"])
        blocks.append(block + "\n答：" + faq["answer"])
    return "## 常見問答\n" + "\n\n".join(blocks)


def _extra_rules(rules_text, no_ai_questions, after_hours_mode):
    """Rules the store's settings add, numbered after the template's last rule. Empty for the default settings."""
    number = max(int(found) for found in RULE_NUMBER.findall(rules_text)) + 1
    added = []
    if no_ai_questions:
        added.append(str(number) + ". 下面這些問題不要自己回答，就算店家資料有寫也一樣，"
                     "請說「這個問題會請專人回電跟您說明」，再請客人留下姓名和電話："
                     + "".join("\n- " + question for question in no_ai_questions))
        number += 1
    if after_hours_mode == "message_only":
        added.append(str(number) + ". 下班時間只幫客人留言，不回答店家資料裡的問題："
                     "請客人留下姓名、電話和想問的事，說會在下一個營業時間由專人回電。")
    return "".join("\n" + rule for rule in added)


def _prefix(shop_name, intro, hours, closures, faqs, after_hours_mode):
    no_ai_questions = [faq["question"] for faq in faqs if not faq["ai_allowed"]]
    rules_text = behavior_template()
    # Fill {{SHOP_NAME}} in the trusted template only, then append store text: store text is never scanned
    # for placeholders, so a store name or answer containing "{{KB}}" stays literal.
    rules = rules_text.replace("{{SHOP_NAME}}", shop_name)
    sections = [intro] if intro else []
    if hours:
        sections.append(_hours_text(hours))
    if closures:
        sections.append(_closures_text(closures))
    answered = [faq for faq in faqs if faq["ai_allowed"]]
    if answered:
        sections.append(_faq_text(answered))
    store_data = "\n\n".join(sections)
    return (rules + _extra_rules(rules_text, no_ai_questions, after_hours_mode)
            + KB_ANCHOR.replace("{{KB}}", "") + store_data), no_ai_questions


def _warnings(intro, faqs, hours):
    warnings = []
    if has_placeholder(intro):
        warnings.append({"code": "placeholder_unfilled", "field": "intro", "faq_id": None})
    for faq in faqs:
        if any(has_placeholder(text) for text in [faq["question"], faq["answer"], *faq["variants"]]):
            warnings.append({"code": "placeholder_unfilled", "field": "faq", "faq_id": faq["id"]})
    if not hours:
        warnings.append({"code": "hours_empty", "field": None, "faq_id": None})
    return warnings


# ---------------------------------------------------------------- compile


def compile_store(store, faqs, hours, closures, *, version):
    """Return the `voice.store-config/v1` dict for this draft as `version`, or raise CompileError."""
    if not isinstance(store, dict):
        _fail("invalid_input", "Store must be an object.")
    store = {**STORE_DEFAULTS, **store}
    if not _is_int(version) or version < 1:
        _fail("invalid_input", "Version must be a whole number of 1 or more.")
    if not isinstance(store.get("id"), str) or not ID_PATTERN.fullmatch(store["id"]):
        _fail("invalid_input", "Store id must be 32 lowercase hex characters.")
    name = _single_line(store.get("name"), "store name", STORE_NAME_CHARS, required=True)
    greeting = _single_line(store["greeting"], "greeting", GREETING_CHARS, required=False, too_long="greeting_too_long")
    intro = _multi_line(store["intro_text"], "store description")
    hours = _hours(hours)
    closures = _closures(closures)
    after_hours_mode = _choice(store["after_hours_mode"], AFTER_HOURS_MODES, "after_hours_mode")
    ask_callback = _choice(store["ask_callback"], ASK_CALLBACK_VALUES, "ask_callback")
    max_message_seconds = store["max_message_seconds"]
    if not _is_int(max_message_seconds) or not MAX_MESSAGE_SECONDS_MIN <= max_message_seconds <= MAX_MESSAGE_SECONDS_MAX:
        _fail("invalid_input", "max_message_seconds must be a whole number from 60 to 180.")
    handoff_mode = _choice(store["handoff_mode"], HANDOFF_MODES, "handoff_mode")
    recording_mode = _choice(store["recording_mode"], RECORDING_MODES, "recording_mode")
    retention_days = store["retention_days"]
    if not _is_int(retention_days) or retention_days < 1:
        _fail("invalid_input", "retention_days must be a whole number of 1 or more.")
    if retention_days > (RETENTION_DAYS_MAX_FULL if recording_mode == "full" else RETENTION_DAYS_MAX):
        _fail("retention_exceeds_limit", "retention_days is over the limit for this recording mode.")
    ai_answer_enabled = _flag(store["ai_answer_enabled"], "ai_answer_enabled")
    faqs = _faqs(faqs)

    if not intro and not faqs:
        _fail("kb_empty", "Add a store description or at least one question before publishing.")
    opening = opening_text(name, greeting)
    if non_space(opening) > OPENING_NON_SPACE_MAX:
        _fail("opening_too_long", "The opening is longer than " + str(OPENING_SECONDS_MAX) + " seconds.")
    kb_chars = len(intro) + sum(faq_chars(faq["question"], faq["answer"], faq["variants"]) for faq in faqs)
    if kb_chars > KB_CHARS_MAX:
        _fail("kb_too_large", "The store description and all questions can be up to " + str(KB_CHARS_MAX) + " characters.")

    prefix, no_ai_questions = _prefix(name, intro, hours, closures, faqs, after_hours_mode)
    return {
        "schema": SCHEMA,
        "store_id": store["id"],
        "version": version,
        "shop_name": name,
        "opening": {"text": opening, "est_seconds": estimate_seconds(opening), "disclosure_version": DISCLOSURE_VERSION},
        "prompt": {"prefix": prefix, "prefix_sha256": hashlib.sha256(prefix.encode("utf-8")).hexdigest(),
                   "mode_separator": MODE_SEPARATOR, "modes": dict(MODES)},
        "hours": hours,
        "closures": closures,
        "rules": {"ask_callback": ask_callback, "handoff_mode": handoff_mode, "max_message_seconds": max_message_seconds,
                  "after_hours_mode": after_hours_mode, "no_ai_questions": no_ai_questions,
                  "recording_mode": recording_mode, "retention_days": retention_days,
                  "ai_answer_enabled": ai_answer_enabled},
        "kb_chars": kb_chars,
        "warnings": _warnings(intro, faqs, hours),
    }
