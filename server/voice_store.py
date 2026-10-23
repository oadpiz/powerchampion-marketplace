"""Voice (AI 電話客服) data access: stores, opening hours, closures, FAQs, published versions, numbers.

Rules the voice routes rely on:
- every function takes an open connection (`con` from `Store.connect()`) and does no locking of its
  own. A caller that checks and then writes (number overlap, FAQ positions, the next version, any
  capacity limit) must first run `con.execute("BEGIN IMMEDIATE")` so two requests cannot interleave;
- everything a store owns is read and written through its store id: a FAQ id, hours or a version of
  another store is "not found" (None / False), never returned or changed;
- user-input validation (lengths, text rules, limits; phase1-contract §3-§4) belongs to the routes.
  This layer keeps the invariants the schema cannot express (overlapping hours, overlapping
  number periods, renumbered FAQ positions) and leaves illegal enum values and ranges to the
  database CHECK constraints (`store.IntegrityError`);
- times are epoch seconds; dates are Taipei (fixed UTC+8, no zoneinfo) `YYYY-MM-DD`.
"""
import hashlib
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

from .support import PortalError

TAIPEI = timezone(timedelta(hours=8))
ID = re.compile(r"[a-f0-9]{32}")
NUMBER = re.compile(r"\+[1-9][0-9]{6,14}|ext-[0-9]{4}")
DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")

# Mirrors of the CHECK constraints in migration 0007_voice_core.
INDUSTRIES = ("clinic", "cram", "other")
STATUSES = ("draft", "testing", "live", "suspended")
ASK_CALLBACK = ("auto", "always", "never")
AFTER_HOURS_MODES = ("answer_and_message", "message_only")
HANDOFF_MODES = ("callback", "transfer")
RECORDING_MODES = ("off", "message_only", "full")
PURPOSES = ("customer", "demo", "test", "internal")
CHANNELS = ("online", "test_line", "pstn")
RETENTION_DAYS_MAX = 90
RETENTION_DAYS_MAX_FULL = 30

# Values a new store starts with (phase1-contract §3.3).
STORE_DEFAULTS = {"greeting": "", "intro_text": "", "after_hours_mode": "answer_and_message", "ask_callback": "auto",
                  "max_message_seconds": 120, "handoff_mode": "callback", "recording_mode": "message_only",
                  "retention_days": 90, "ai_answer_enabled": 0}
# Columns update_store() may change. Who may change which one is the route's decision
# (a store cannot change status or ai_answer_enabled; phase1-contract §1.3).
STORE_UPDATABLE = ("name", "greeting", "intro_text", "after_hours_mode", "ask_callback", "max_message_seconds",
                   "recording_mode", "retention_days", "status", "ai_answer_enabled")
FAQ_UPDATABLE = ("question", "answer", "variants", "ai_allowed", "position")


class VoiceStoreError(PortalError):
    """An invariant this layer enforces was violated; the app's PortalError handler answers it."""


def _now(now):
    return int(time.time()) if now is None else int(now)


def _valid_id(value):
    return isinstance(value, str) and ID.fullmatch(value) is not None


def canonical_json(value) -> bytes:
    """phase1-contract §5.3: the bytes stored as config_json and hashed into config_sha256."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def taipei_date(epoch) -> str:
    return datetime.fromtimestamp(epoch, TAIPEI).date().isoformat()


def taipei_day_start(day) -> int:
    """Epoch of 00:00 Taipei time on `day` (YYYY-MM-DD); ValueError for anything else."""
    if not isinstance(day, str) or not DATE.fullmatch(day):
        raise ValueError("Expected a YYYY-MM-DD date")
    return int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=TAIPEI).timestamp())


def _touch(con, store_id, now):
    con.execute("UPDATE voice_stores SET updated_at=? WHERE id=?", (now, store_id))


# ---------------------------------------------------------------- stores

def _store(row):
    if row is None:
        return None
    result = dict(row)
    result["ai_answer_enabled"] = bool(result["ai_answer_enabled"])
    return result


def get_store(con, store_id):
    if not _valid_id(store_id):
        return None
    return _store(con.execute("SELECT * FROM voice_stores WHERE id=?", (store_id,)).fetchone())


def store_by_owner(con, owner_user_id):
    """The one store this account owns, or None."""
    if not isinstance(owner_user_id, str):
        return None
    return _store(con.execute("SELECT * FROM voice_stores WHERE owner_user_id=?", (owner_user_id,)).fetchone())


def create_store(con, owner_user_id, name, industry, template_id=None, now=None):
    """Insert a draft store with the default settings. A second store for the same owner, an unknown
    owner or an unknown industry raises IntegrityError."""
    now = _now(now)
    store_id = uuid.uuid4().hex
    values = dict(STORE_DEFAULTS, id=store_id, owner_user_id=owner_user_id, name=name, industry=industry,
                  template_id=template_id, status="draft", created_at=now, updated_at=now)
    columns = sorted(values)
    con.execute("INSERT INTO voice_stores (" + ",".join(columns) + ") VALUES (" + ",".join("?" * len(columns)) + ")",
                tuple(values[column] for column in columns))
    return get_store(con, store_id)


def _column_value(column, value):
    return (1 if value else 0) if column == "ai_answer_enabled" else value


def update_store(con, store_id, changes, now=None):
    """Apply `changes` ({column: value}, columns from STORE_UPDATABLE) in one UPDATE, so CHECKs that
    span columns (retention_days vs recording_mode) see the final row. Returns the columns whose value
    actually changed (STORE_UPDATABLE order; [] = nothing written), or None when the store does not exist."""
    unknown = set(changes) - set(STORE_UPDATABLE)
    if unknown:
        raise ValueError("Not updatable: " + ", ".join(sorted(unknown)))
    current = con.execute("SELECT * FROM voice_stores WHERE id=?", (store_id,)).fetchone() if _valid_id(store_id) else None
    if current is None:
        return None
    changed = [column for column in STORE_UPDATABLE
               if column in changes and _column_value(column, changes[column]) != current[column]]
    if changed:
        con.execute("UPDATE voice_stores SET " + ",".join(column + "=?" for column in changed) + ",updated_at=? WHERE id=?",
                    tuple(_column_value(column, changes[column]) for column in changed) + (_now(now), store_id))
    return changed


# ---------------------------------------------------------------- hours and closures

def get_hours(con, store_id):
    return [dict(row) for row in con.execute(
        "SELECT weekday, open_min, close_min FROM voice_store_hours WHERE store_id=? ORDER BY weekday, open_min", (store_id,)).fetchall()]


def replace_hours(con, store_id, hours, now=None):
    """Replace all opening segments ([{weekday, open_min, close_min}]) at once. Segments of the same
    weekday may touch (close == next open) but not overlap. Returns True when anything changed."""
    segments = sorted((int(h["weekday"]), int(h["open_min"]), int(h["close_min"])) for h in hours)
    for (day_a, open_a, close_a), (day_b, open_b, _) in zip(segments, segments[1:]):
        if day_a == day_b and open_b < close_a:
            raise VoiceStoreError("hours_invalid", "Opening hours on the same day must not overlap.", 400)
    current = [(h["weekday"], h["open_min"], h["close_min"]) for h in get_hours(con, store_id)]
    if current == segments:
        return False
    con.execute("DELETE FROM voice_store_hours WHERE store_id=?", (store_id,))
    for weekday, open_min, close_min in segments:
        con.execute("INSERT INTO voice_store_hours (store_id,weekday,open_min,close_min) VALUES (?,?,?,?)",
                    (store_id, weekday, open_min, close_min))
    _touch(con, store_id, _now(now))
    return True


def get_closures(con, store_id):
    return [dict(row) for row in con.execute(
        "SELECT date, note FROM voice_store_closures WHERE store_id=? ORDER BY date", (store_id,)).fetchall()]


def replace_closures(con, store_id, closures, now=None):
    """Replace all special closed dates ([{date: YYYY-MM-DD, note}]) at once. Returns True when anything changed."""
    items = sorted(((c["date"], c.get("note", "")) for c in closures), key=lambda item: item[0])
    for day, _ in items:
        try:
            taipei_day_start(day)
        except ValueError:
            raise VoiceStoreError("closures_invalid", "Enter each closed day as a valid YYYY-MM-DD date.", 400) from None
    if len({day for day, _ in items}) != len(items):
        raise VoiceStoreError("closures_invalid", "Each closed day may be listed only once.", 400)
    current = [(c["date"], c["note"]) for c in get_closures(con, store_id)]
    if current == items:
        return False
    con.execute("DELETE FROM voice_store_closures WHERE store_id=?", (store_id,))
    for day, note in items:
        con.execute("INSERT INTO voice_store_closures (store_id,date,note) VALUES (?,?,?)", (store_id, day, note))
    _touch(con, store_id, _now(now))
    return True


# ---------------------------------------------------------------- FAQs

def _faq(row):
    if row is None:
        return None
    result = dict(row)
    result["variants"] = json.loads(result["variants"])
    result["ai_allowed"] = bool(result["ai_allowed"])
    return result


def list_faqs(con, store_id):
    return [_faq(row) for row in con.execute("SELECT * FROM voice_faqs WHERE store_id=? ORDER BY position, id", (store_id,)).fetchall()]


def get_faq(con, store_id, faq_id):
    """The FAQ with this id in this store; None for another store's FAQ, a malformed or unknown id."""
    if not _valid_id(faq_id):
        return None
    return _faq(con.execute("SELECT * FROM voice_faqs WHERE id=? AND store_id=?", (faq_id, store_id)).fetchone())


def _order(con, store_id):
    return [row["id"] for row in con.execute("SELECT id FROM voice_faqs WHERE store_id=? ORDER BY position, id", (store_id,)).fetchall()]


def _write_order(con, store_id, ordered_ids):
    """Renumber this store's FAQs to 0..n-1 in the given order (only rows whose position changes are written)."""
    current = {row["id"]: row["position"] for row in con.execute("SELECT id, position FROM voice_faqs WHERE store_id=?", (store_id,)).fetchall()}
    for position, faq_id in enumerate(ordered_ids):
        if current.get(faq_id) != position:
            con.execute("UPDATE voice_faqs SET position=? WHERE id=? AND store_id=?", (position, faq_id, store_id))


def _clamp(position, count):
    return count if position is None else max(0, min(int(position), count))


def _variants_json(variants):
    return json.dumps([str(variant) for variant in variants], ensure_ascii=False)


def add_faq(con, store_id, question, answer, variants=(), ai_allowed=True, position=None, now=None):
    """Insert a FAQ at `position` (default and anything past the end: last) and renumber the rest."""
    now = _now(now)
    order = _order(con, store_id)
    faq_id = uuid.uuid4().hex
    position = _clamp(position, len(order))
    con.execute("INSERT INTO voice_faqs (id,store_id,question,answer,variants,ai_allowed,position,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (faq_id, store_id, question, answer, _variants_json(variants), 1 if ai_allowed else 0, position, now))
    _write_order(con, store_id, order[:position] + [faq_id] + order[position:])
    _touch(con, store_id, now)
    return get_faq(con, store_id, faq_id)


def update_faq(con, store_id, faq_id, changes, now=None):
    """Partial update ({field: value}, fields from FAQ_UPDATABLE); `position` moves the FAQ and renumbers
    the rest. Returns the FAQ, or None when this store has no FAQ with this id."""
    unknown = set(changes) - set(FAQ_UPDATABLE)
    if unknown:
        raise ValueError("Not updatable: " + ", ".join(sorted(unknown)))
    current = get_faq(con, store_id, faq_id)
    if current is None:
        return None
    now = _now(now)
    fields = {}
    if "question" in changes and changes["question"] != current["question"]:
        fields["question"] = changes["question"]
    if "answer" in changes and changes["answer"] != current["answer"]:
        fields["answer"] = changes["answer"]
    if "variants" in changes and [str(v) for v in changes["variants"]] != current["variants"]:
        fields["variants"] = _variants_json(changes["variants"])
    if "ai_allowed" in changes and bool(changes["ai_allowed"]) != current["ai_allowed"]:
        fields["ai_allowed"] = 1 if changes["ai_allowed"] else 0
    moved = False
    if "position" in changes:
        order = [other for other in _order(con, store_id) if other != faq_id]
        target = _clamp(changes["position"], len(order))
        new_order = order[:target] + [faq_id] + order[target:]
        moved = new_order != _order(con, store_id)
    if fields or moved:
        fields["updated_at"] = now
        columns = sorted(fields)
        con.execute("UPDATE voice_faqs SET " + ",".join(column + "=?" for column in columns) + " WHERE id=? AND store_id=?",
                    tuple(fields[column] for column in columns) + (faq_id, store_id))
        if moved:
            _write_order(con, store_id, new_order)
        _touch(con, store_id, now)
    return get_faq(con, store_id, faq_id)


def delete_faq(con, store_id, faq_id, now=None):
    """Delete this store's FAQ and renumber the rest. False when this store has no FAQ with this id."""
    if get_faq(con, store_id, faq_id) is None:
        return False
    con.execute("DELETE FROM voice_faqs WHERE id=? AND store_id=?", (faq_id, store_id))
    _write_order(con, store_id, _order(con, store_id))
    _touch(con, store_id, _now(now))
    return True


# ---------------------------------------------------------------- published versions

def _version(row):
    return None if row is None else dict(row)


def next_config_version(con, store_id):
    """MAX(version) + 1 for this store (1 for the first). Read it inside the write lock: the compiled
    config embeds its own version number."""
    row = con.execute("SELECT MAX(version) FROM voice_config_versions WHERE store_id=?", (store_id,)).fetchone()
    return (row[0] or 0) + 1


def add_config_version(con, store_id, config, created_by, now=None):
    """Store `config` (voice.store-config/v1, already compiled with version = next_config_version()) as
    the next immutable version: canonical JSON text plus its sha256. Points the store's current_version
    at it. Returns {store_id, version, config_sha256, created_by, created_at}."""
    version = next_config_version(con, store_id)
    if not isinstance(config, dict) or config.get("version") != version or config.get("store_id") != store_id:
        raise ValueError("The config must carry this store's id and version %d" % version)
    encoded = canonical_json(config)
    digest = hashlib.sha256(encoded).hexdigest()
    now = _now(now)
    con.execute("INSERT INTO voice_config_versions (store_id,version,config_json,config_sha256,created_by,created_at) VALUES (?,?,?,?,?,?)",
                (store_id, version, encoded.decode("utf-8"), digest, created_by, now))
    con.execute("UPDATE voice_stores SET current_version=? WHERE id=?", (version, store_id))
    return {"store_id": store_id, "version": version, "config_sha256": digest, "created_by": created_by, "created_at": now}


def get_config_version(con, store_id, version):
    return _version(con.execute("SELECT * FROM voice_config_versions WHERE store_id=? AND version=?", (store_id, version)).fetchone())


def latest_config_version(con, store_id):
    """The highest version of this store (config_json, config_sha256, created_by, created_at), or None."""
    return _version(con.execute("SELECT * FROM voice_config_versions WHERE store_id=? ORDER BY version DESC LIMIT 1", (store_id,)).fetchone())


# ---------------------------------------------------------------- numbers

def _period(row):
    start = taipei_date(row["active_from"])
    if row["active_to"] is None:
        return "from %s (no end date)" % start
    # active_to is exclusive (00:00 after the last day), so the last active day is one second earlier.
    return "from %s to %s" % (start, taipei_date(row["active_to"] - 1))


def _overlaps(from_a, to_a, from_b, to_b):
    return (to_b is None or from_a < to_b) and (to_a is None or from_b < to_a)


def _check_number(con, number, active_from, active_to, exclude_id=None):
    if not isinstance(number, str) or not NUMBER.fullmatch(number):
        raise VoiceStoreError("invalid_number", "Enter an E.164 number such as +886227356688 or a test extension such as ext-0001.", 400)
    for row in con.execute("SELECT * FROM voice_numbers WHERE number=? ORDER BY active_from, id", (number,)).fetchall():
        if row["id"] != exclude_id and _overlaps(active_from, active_to, row["active_from"], row["active_to"]):
            raise VoiceStoreError("number_overlap", "%s is already active %s." % (number, _period(row)), 409)


def get_number(con, number_id):
    if not _valid_id(number_id):
        return None
    row = con.execute("SELECT * FROM voice_numbers WHERE id=?", (number_id,)).fetchone()
    return None if row is None else dict(row)


def list_numbers(con, store_id=None):
    """All numbers (or one store's), ordered by number then start."""
    if store_id is None:
        rows = con.execute("SELECT * FROM voice_numbers ORDER BY number, active_from, id").fetchall()
    else:
        rows = con.execute("SELECT * FROM voice_numbers WHERE store_id=? ORDER BY number, active_from, id", (store_id,)).fetchall()
    return [dict(row) for row in rows]


def find_active_number(con, number, at=None):
    """The row of `number` whose period contains `at` (epoch; default now), or None."""
    at = _now(at)
    row = con.execute("SELECT * FROM voice_numbers WHERE number=? AND active_from<=? AND (active_to IS NULL OR active_to>?) ORDER BY active_from DESC, id LIMIT 1",
                      (number, at, at)).fetchone()
    return None if row is None else dict(row)


def add_number(con, number, store_id, purpose, channel, active_from, active_to=None, note="", now=None):
    """Insert a number period (active_to exclusive, None = no end). Raises VoiceStoreError invalid_number /
    number_overlap (another period of the same number intersects this one); an unknown store, purpose or
    channel, or active_to <= active_from raises IntegrityError. Call inside BEGIN IMMEDIATE."""
    _check_number(con, number, active_from, active_to)
    now = _now(now)
    number_id = uuid.uuid4().hex
    con.execute("INSERT INTO voice_numbers (id,number,store_id,purpose,channel,active_from,active_to,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (number_id, number, store_id, purpose, channel, int(active_from), None if active_to is None else int(active_to), note, now, now))
    return get_number(con, number_id)


def update_number(con, number_id, number, store_id, purpose, channel, active_from, active_to=None, note="", now=None):
    """Replace every field of a number row; the overlap check ignores the row itself. None when not found."""
    if get_number(con, number_id) is None:
        return None
    _check_number(con, number, active_from, active_to, exclude_id=number_id)
    con.execute("UPDATE voice_numbers SET number=?,store_id=?,purpose=?,channel=?,active_from=?,active_to=?,note=?,updated_at=? WHERE id=?",
                (number, store_id, purpose, channel, int(active_from), None if active_to is None else int(active_to), note, _now(now), number_id))
    return get_number(con, number_id)


def delete_number(con, number_id):
    if get_number(con, number_id) is None:
        return False
    con.execute("DELETE FROM voice_numbers WHERE id=?", (number_id,))
    return True
