"""Deleting call content and old call rows (phase2-contract §16).

The portal keeps no call content: recordings, transcripts and summaries are on the Taiwan host (§0). Deleting them
is therefore a request the portal queues and the Taiwan host's records sender carries out:

- a store deletes one call (M18, `delete_for_store`): the store no longer finds the call, the portal clears its own
  content-like columns (`clear_content_columns`) and queues a `store_deleted` request for all kinds;
- the schedule (`sweep`, run by `serve` every hour while the phone agent is on) queues the content that is past its
  date the same way: `recording_expired` (["recording"]) on the recording's date, min(snapshot, the store's days now)
  (§9), and `content_expired` (all kinds) at 90 days, when the portal's content-like columns are cleared too; then it
  deletes call rows older than PC_VOICE_CALL_RETENTION_DAYS (5 years by default, pending the lawyer);
- the records sender pulls pending requests (R3, `pull`) and acknowledges each one once the content is gone (R4, `ack`),
  so it implements one flow for the store's deletions and the expiry.

Every write runs inside BEGIN IMMEDIATE, so "already queued?" and the insert, and "already done?" and the update, are
one step: two concurrent deletions queue one request and two concurrent acknowledgements finish it once. The table's
UNIQUE (call_id, reason) is the last line of defence. Billing and metering columns are never touched by a deletion
(A6 reconciles the same calls); the call row goes only with the metadata purge.
"""
import asyncio
import json
import re
import sys
import time
import uuid

from . import voice_calls as vc
from .store import iso
from .support import fail

REASONS = ("store_deleted", "recording_expired", "content_expired")
STATUSES = ("pending", "done")
ALL_KINDS = tuple(sorted(vc.MEDIA_KINDS))
RECORDING_KINDS = ("recording",)
DELETIONS_SCHEMA = "voice.deletions/v1"
PULL_LIMIT_DEFAULT = 100
PULL_LIMIT_MAX = 500
ACK_BODY_BYTES = 1024
ACK_COUNT_MAX = 10_000_000
ACK_KEYS = ("files_deleted", "rows_deleted")
SWEEP_BATCH = 500
SWEEP_FIRST_DELAY_SECONDS = 60
SWEEP_INTERVAL_SECONDS = 3600
DELETION_NOT_FOUND = "There is no deletion request with this id."

# §9 min(snapshot, the store's retention now) in SQL; a call without a store keeps its snapshot (vc.recording_days).
RECORDING_DAYS_SQL = ("CASE WHEN s.retention_days IS NOT NULL AND s.retention_days < c.retention_days_snapshot "
                      "THEN s.retention_days ELSE c.retention_days_snapshot END")


def _kinds_text(kinds):
    return vc.canonical(sorted(kinds)).decode("utf-8")


def queue(con, *, call_id, reason, kinds, requested_by, now):
    """The (call_id, reason) request, created if there is none: (row, created). Call inside BEGIN IMMEDIATE: `seq` is
    the next number in commit order, which is what makes `after=<seq>` a safe cursor."""
    row = con.execute("SELECT * FROM voice_deletion_requests WHERE call_id=? AND reason=?", (call_id, reason)).fetchone()
    if row is not None:
        return row, False
    seq = int(con.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM voice_deletion_requests").fetchone()[0])
    request_id = uuid.uuid4().hex
    con.execute("INSERT INTO voice_deletion_requests (id,seq,call_id,reason,kinds,requested_by,status,requested_at) "
                "VALUES (?,?,?,?,?,?,?,?)", (request_id, seq, call_id, reason, _kinds_text(kinds), requested_by, "pending", now))
    return con.execute("SELECT * FROM voice_deletion_requests WHERE id=?", (request_id,)).fetchone(), True


def clear_content_columns(con, row):
    """Clear the portal's content-like columns of one call (§9, §16.2): the caller's last 3 digits, in the row and in
    both stored reports (whose digests are recomputed, so they say nothing the text does not), the store's flag note
    and the operator's review note. The flag's kind and the review's score stay; billing columns are not touched."""
    updates = {"caller_tail": None, "store_flag_note": None}
    for source in vc.SOURCES:
        text = row["report_" + source]
        if text:
            report = vc.redact_report(json.loads(text))
            updates["report_" + source] = vc.canonical(report).decode("utf-8")
            updates["report_%s_sha256" % source] = vc.part_sha256(report)
    names = sorted(updates)
    con.execute("UPDATE voice_calls SET " + ",".join(name + "=?" for name in names) + " WHERE id=?",
                tuple(updates[name] for name in names) + (row["id"],))
    con.execute("UPDATE voice_call_reviews SET note='' WHERE call_row_id=? AND note<>''", (row["id"],))


def delete_for_store(con, row, user_id, now):
    """M18 for a call the store may see (vc.store_visible). Call inside BEGIN IMMEDIATE. Returns the request row."""
    con.execute("UPDATE voice_calls SET store_deleted_at=?, recording_expiry_queued_at=COALESCE(recording_expiry_queued_at, ?) "
                "WHERE id=?", (now, now, row["id"]))
    clear_content_columns(con, row)
    request, _ = queue(con, call_id=row["call_id"], reason="store_deleted", kinds=ALL_KINDS, requested_by=user_id, now=now)
    return request


def request_json(row):
    """A10's view of one request (operators only)."""
    return {"id": row["id"], "reason": row["reason"], "kinds": json.loads(row["kinds"]), "status": row["status"],
            "requestedAt": iso(row["requested_at"]), "doneAt": iso(row["done_at"]), "filesDeleted": row["files_deleted"],
            "rowsDeleted": row["rows_deleted"]}


def deletions_json(con, call_id):
    return [request_json(row) for row in
            con.execute("SELECT * FROM voice_deletion_requests WHERE call_id=? ORDER BY seq", (call_id,)).fetchall()]


# ---------------------------------------------------------------- R3, R4


def parse_pull(after, limit):
    """R3's query (§16.3): `after` a seq (0 or more, at most 18 digits, default 0), `limit` 1-500 without a leading 0
    (default 100). The website's route (app/api/voice-runtime) checks both the same way before it calls the portal."""
    after = "0" if after is None else after
    limit = str(PULL_LIMIT_DEFAULT) if limit is None else limit
    if not re.fullmatch(r"[0-9]{1,18}", after):
        fail("invalid_input", "after must be the cursor of an earlier answer (digits).")
    if not (re.fullmatch(r"[1-9][0-9]{0,2}", limit) and int(limit) <= PULL_LIMIT_MAX):
        fail("invalid_input", "limit must be a whole number from 1 to %d." % PULL_LIMIT_MAX)
    return int(after), int(limit)


def pull(con, after, limit):
    """R3: pending requests after the cursor, oldest first. Only ids and kinds: no store, number or caller data."""
    rows = con.execute("SELECT id, seq, call_id, kinds FROM voice_deletion_requests WHERE status='pending' AND seq>? "
                       "ORDER BY seq LIMIT %d" % (limit + 1), (after,)).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    return {"schema": DELETIONS_SCHEMA,
            "deletions": [{"id": row["id"], "call_id": row["call_id"], "kinds": json.loads(row["kinds"])} for row in rows],
            "cursor": str(rows[-1]["seq"] if rows else after), "more": more}


def parse_ack(body):
    """R4's body: exactly files_deleted and rows_deleted, whole numbers 0-10,000,000 (true and 1.0 are not)."""
    for key in sorted(set(body) - set(ACK_KEYS)):
        fail("invalid_input", "Unknown field: %s." % key)
    for key in ACK_KEYS:
        if not vc._int_in(body.get(key), 0, ACK_COUNT_MAX):
            fail("invalid_input", "Send %s as a whole number from 0 to %d." % (key, ACK_COUNT_MAX))
    return body["files_deleted"], body["rows_deleted"]


def ack(con, request_id, body, now):
    """R4 inside BEGIN IMMEDIATE: 404 for anything that is not a request id, then the body, then done (once).
    Returns the answer. A request that is done already is a duplicate and keeps its first counts (a retry after a
    lost answer may find nothing left to delete)."""
    row = None
    if isinstance(request_id, str) and vc.HEX32.fullmatch(request_id):
        row = con.execute("SELECT * FROM voice_deletion_requests WHERE id=?", (request_id,)).fetchone()
    if row is None:
        fail("deletion_not_found", DELETION_NOT_FOUND, 404)
    files, deleted_rows = parse_ack(body)
    result = "duplicate"
    if row["status"] == "pending":
        con.execute("UPDATE voice_deletion_requests SET status='done', done_at=?, files_deleted=?, rows_deleted=? "
                    "WHERE id=? AND status='pending'", (now, files, deleted_rows, row["id"]))
        if row["reason"] in ("store_deleted", "content_expired"):
            con.execute("UPDATE voice_calls SET content_purged_at=? WHERE call_id=? AND content_purged_at IS NULL",
                        (now, row["call_id"]))
        row = con.execute("SELECT * FROM voice_deletion_requests WHERE id=?", (row["id"],)).fetchone()
        result = "acked"
    return {"id": row["id"], "result": result, "status": row["status"], "done_at": iso(row["done_at"])}


# ---------------------------------------------------------------- the schedule (§16.4) and the metadata purge (§16.5)


def _batches(store, select, args, handle, batch):
    """Run `handle(con, rows)` on `select` (which must stop matching a row once it is handled) in transactions of
    `batch` rows, so no single lock is held for long."""
    total = 0
    while True:
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            rows = con.execute(select + " LIMIT %d" % batch, args).fetchall()
            total += handle(con, rows)
        if len(rows) < batch:
            return total


def queue_expired_content(store, now, batch=SWEEP_BATCH):
    """§16.4 step 1: calls 90 days old get a content_expired request (unless the store deleted them, which queued every
    kind already) and lose the portal's content-like columns. Returns the number of requests created."""

    def handle(con, rows):
        created = 0
        for row in rows:
            if row["store_deleted_at"] is None:
                created += queue(con, call_id=row["call_id"], reason="content_expired", kinds=ALL_KINDS, requested_by=None, now=now)[1]
            clear_content_columns(con, row)
            con.execute("UPDATE voice_calls SET content_expiry_queued_at=?, recording_expiry_queued_at=COALESCE(recording_expiry_queued_at, ?) "
                        "WHERE id=?", (now, now, row["id"]))
        return created

    return _batches(store, "SELECT * FROM voice_calls WHERE content_expiry_queued_at IS NULL AND started_at<=? ORDER BY started_at, id",
                    (now - vc.TRANSCRIPT_DAYS * vc.DAY_SECONDS,), handle, batch)


def queue_expired_recordings(store, now, batch=SWEEP_BATCH):
    """§16.4 step 2: a kept recording past min(snapshot, the store's days now) gets a recording_expired request."""

    def handle(con, rows):
        created = 0
        for row in rows:
            created += queue(con, call_id=row["call_id"], reason="recording_expired", kinds=RECORDING_KINDS, requested_by=None, now=now)[1]
            con.execute("UPDATE voice_calls SET recording_expiry_queued_at=? WHERE id=?", (now, row["id"]))
        return created

    return _batches(
        store, "SELECT c.id, c.call_id FROM voice_calls c LEFT JOIN voice_stores s ON s.id=c.store_id "
               "WHERE c.recording_expiry_queued_at IS NULL AND c.started_at<=? AND c.recording_saved=1 "
               "AND c.store_deleted_at IS NULL AND c.content_expiry_queued_at IS NULL "
               "AND c.started_at + (" + RECORDING_DAYS_SQL + ") * " + str(vc.DAY_SECONDS) + " <= ? ORDER BY c.started_at, c.id",
        (now - vc.DAY_SECONDS, now), handle, batch)


def purge_old_calls(store, now, call_retention_days, batch=SWEEP_BATCH):
    """§16.5: call rows past the retention days go with their reviews and done requests; pending requests stay. A row
    goes only once its content's deletion is queued (content_expiry_queued_at), never before, even if step 1 has not
    reached it. Returns (calls deleted, requests deleted)."""
    purged = {"requests": 0}

    def handle(con, rows):
        for row in rows:
            purged["requests"] += con.execute("DELETE FROM voice_deletion_requests WHERE call_id=? AND status='done'",
                                              (row["call_id"],)).rowcount
            con.execute("DELETE FROM voice_call_reviews WHERE call_row_id=?", (row["id"],))
            con.execute("DELETE FROM voice_calls WHERE id=?", (row["id"],))
        return len(rows)

    cutoff = now - call_retention_days * vc.DAY_SECONDS
    calls = _batches(store, "SELECT id, call_id FROM voice_calls WHERE started_at<=? AND content_expiry_queued_at IS NOT NULL "
                            "ORDER BY started_at, id", (cutoff,), handle, batch)
    with store.connect() as con:
        con.execute("BEGIN IMMEDIATE")
        # Done requests of calls purged earlier (a request that was still pending when its call went).
        purged["requests"] += con.execute("DELETE FROM voice_deletion_requests WHERE status='done' AND requested_at<=?",
                                          (cutoff,)).rowcount
    return calls, purged["requests"]


def sweep(store, now, call_retention_days, batch=SWEEP_BATCH):
    """One run of the schedule (§16.4 steps 1-4). Returns the counts (also audited when any is not 0)."""
    counts = {"contentExpired": queue_expired_content(store, now, batch),
              "recordingExpired": queue_expired_recordings(store, now, batch)}
    counts["callsPurged"], counts["requestsPurged"] = purge_old_calls(store, now, call_retention_days, batch)
    if any(counts.values()):
        with store.connect() as con:
            store.audit(con, "voice.retention_swept", None, None, dict(counts, callRetentionDays=call_retention_days))
    return counts


async def serve(store, settings, stop, *, first_delay=SWEEP_FIRST_DELAY_SECONDS, interval=SWEEP_INTERVAL_SECONDS, clock=time.time):
    """Run `sweep` `first_delay` seconds after start and then every `interval` seconds until `stop` is set. A failed
    run is reported on stderr (its type only: never a call's data) and the next run tries again."""
    delay = first_delay
    while True:
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
            return
        except asyncio.TimeoutError:
            pass
        try:
            await asyncio.to_thread(sweep, store, int(clock()), settings.voice_call_retention_days)
        except Exception as error:  # the loop must outlive one failed run (a locked database, a restart of Postgres)
            print("voice retention sweep failed: %s" % type(error).__name__, file=sys.stderr)
        delay = interval
