"""Deleting call content (phase2-contract §16): the store's "delete this call" (M18), the runtime deletion requests the
Taiwan host's records sender pulls and acknowledges (R3, R4), the content-retention schedule that queues expired content
through the same requests, and the metadata purge after PC_VOICE_CALL_RETENTION_DAYS.

Runs on SQLite, or on Postgres when PC_PORTAL_TEST_DATABASE_URL is set (scripts/test_backend_postgres.sh)."""
import asyncio
import hashlib
import json
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from server import voice_calls as vc
from server import voice_retention as vrt
from server import voice_runtime as vr
from server import voice_store as vs
from server.settings import Settings
from server.test_voice_call_routes import OTHER_ID, CallRoutesCase
from server.test_voice_runtime import NOT_FOUND, TOKEN, orchestrator, records
from server.testsupport import BASE, ORIGIN, PASSWORD, rows

DAY = 86400
ALL_KINDS = ["recording", "summary", "transcript"]
# The columns A6 reconciles against and the store's estimate reads: a deletion must leave every one as it was.
BILLING_COLUMNS = ("call_id", "entry", "dialed", "number_id", "store_id", "number_purpose", "started_at", "ended_at", "answered_at",
                   "duration_s", "disposition", "caller_kind", "ai_answered", "ai_speech_ms", "message_outcome", "message_final",
                   "message_speech_ms", "recording_ms", "has_message", "callback_confirmed", "outcome", "meter_units",
                   "meter_reason", "meter_rule", "retention_days_snapshot")
SAVED = {"outcome": "message", "speech_ms": 5000, "recording_ms": 6000, "recording_saved": True}


class DeletionCase(CallRoutesCase):
    """CallRoutesCase plus the deletion helpers; holds no tests."""

    def requests(self):
        return sorted(rows(self.store, "voice_deletion_requests"), key=lambda row: row["seq"])

    def delete_call(self, client, row_id):
        return self.delete(client, "/me/voice/calls/" + row_id)

    def pull(self, token=TOKEN, **params):
        return self.runtime_client.get(BASE + "/voice/runtime/deletions", params=params, headers=self.headers(token))

    def ack(self, request_id, body=None, token=TOKEN, **extra):
        body = {"files_deleted": 3, "rows_deleted": 2} if body is None else body
        return self.runtime_client.post(BASE + "/voice/runtime/deletions/%s/ack" % request_id, json=body,
                                        headers=self.headers(token, **extra))

    def sweep(self, now=None, days=None):
        return vrt.sweep(self.store, int(time.time()) if now is None else now,
                         self.settings.voice_call_retention_days if days is None else days)

    def billing(self, row_id):
        row = self.row(row_id)
        return {key: row[key] for key in BILLING_COLUMNS}

    def place(self, row_id, started):
        """Put a call's start exactly at `started` (its other times move with it)."""
        self.move(row_id, started - self.row(row_id)["started_at"])


# ---------------------------------------------------------------- M18


class StoreDeletionTests(DeletionCase):
    def test_a_deleted_call_leaves_the_stores_pages_and_keeps_its_billing(self):
        row_id = self.new_call(orchestrator(), records(message=SAVED))
        kept = self.new_call()
        detail, link = "/me/voice/calls/" + row_id, "/me/voice/calls/%s/content-link" % row_id
        # Before: the store sees the call, its content and its estimate.
        listed = self.ok(self.get(self.owner, "/me/voice/calls"))
        self.assertEqual({call["id"] for call in listed["calls"]}, {row_id, kept})
        self.assertEqual((listed["summary"]["total"], listed["summary"]["meterUnits"], listed["summary"]["deleted"]), (2, 2, 0))
        self.ok(self.get(self.owner, detail))
        self.ok(self.post(self.owner, link, {}))
        before = self.billing(row_id)
        self.assertEqual(self.row(row_id)["caller_tail"], "678")
        self.assertEqual(self.requests(), [])

        answer = self.ok(self.delete_call(self.owner, row_id))
        self.assertEqual(set(answer), {"changed", "deletedAt"})
        self.assertTrue(answer["changed"])
        row = self.row(row_id)
        self.assertEqual(answer["deletedAt"], vc.iso(row["store_deleted_at"]))

        # After: list, detail, content link, flag and unflag all answer as for a call that is not the store's.
        listed = self.ok(self.get(self.owner, "/me/voice/calls"))
        self.assertEqual([call["id"] for call in listed["calls"]], [kept])
        self.assertNotIn(row_id, json.dumps(listed))
        # The month still counts the call and its unit: it is still billed (A6 reconciles the same call).
        self.assertEqual((listed["summary"]["total"], listed["summary"]["meterUnits"], listed["summary"]["deleted"]), (2, 2, 1))
        self.error(self.get(self.owner, detail), 404, "call_not_found")
        self.error(self.post(self.owner, link, {}), 404, "call_not_found")
        self.error(self.post(self.owner, "/me/voice/calls/%s/flag" % row_id, {"kind": "wrong_answer"}), 404, "call_not_found")
        self.error(self.delete(self.owner, "/me/voice/calls/%s/flag" % row_id), 404, "call_not_found")
        self.ok(self.get(self.owner, "/me/voice/calls/" + kept))

        # Billing and metering columns are what they were; the caller's last digits are gone from the row and the reports.
        self.assertEqual(self.billing(row_id), before)
        self.assertIsNone(row["caller_tail"])
        for source in vc.SOURCES:
            text = row["report_" + source]
            self.assertIsNone(json.loads(text)["caller_tail"], source)
            self.assertNotIn("678", text)
            self.assertEqual(row["report_%s_sha256" % source], hashlib.sha256(text.encode("utf-8")).hexdigest())
        # One pending request, all kinds, requested by the owner; no store or caller data in it.
        [request] = self.requests()
        self.assertEqual({key: request[key] for key in ("call_id", "reason", "kinds", "requested_by", "status", "done_at",
                                                       "files_deleted", "rows_deleted")},
                         {"call_id": row["call_id"], "reason": "store_deleted", "kinds": json.dumps(ALL_KINDS, separators=(",", ":")),
                          "requested_by": self.owner_id, "status": "pending", "done_at": None, "files_deleted": None,
                          "rows_deleted": None})
        self.assertEqual(request["requested_at"], row["store_deleted_at"])
        # The audit row holds ids only.
        [details] = self.audit_details("voice.call_content_deleted")
        self.assertEqual(details, {"requestId": request["id"], "storeId": self.store_id})
        [event] = self.audit("voice.call_content_deleted")
        self.assertEqual((event["actor_id"], event["target_id"]), (self.owner_id, row_id))

    def test_deleting_again_changes_nothing(self):
        row_id = self.new_call()
        first = self.ok(self.delete_call(self.owner, row_id))
        row = self.row(row_id)
        again = self.ok(self.delete_call(self.owner, row_id))
        self.assertEqual(again, {"changed": False, "deletedAt": first["deletedAt"]})
        self.assertEqual(self.row(row_id), row)
        self.assertEqual(len(self.requests()), 1)
        self.assertEqual(len(self.audit("voice.call_content_deleted")), 1)

    def test_concurrent_deletes_queue_one_request(self):
        row_id = self.new_call()
        start = threading.Barrier(10)

        def send(_):
            start.wait(timeout=15)
            return self.delete_call(self.owner, row_id)

        with ThreadPoolExecutor(max_workers=10) as pool:
            responses = list(pool.map(send, range(10)))
        self.assertEqual(sorted(r.status_code for r in responses), [200] * 10, [r.text for r in responses])
        self.assertEqual(sorted(r.json()["changed"] for r in responses), [False] * 9 + [True])
        self.assertEqual(len({r.json()["deletedAt"] for r in responses}), 1)
        self.assertEqual(len(self.requests()), 1)
        self.assertEqual(len(self.audit("voice.call_content_deleted")), 1)

    def test_only_the_stores_own_reported_call_can_be_deleted(self):
        theirs = self.new_call(dialed="0227001009")
        unreported = self.new_call(orchestrator())  # the records sender has not reported it: no store may see it yet
        mine = self.new_call()
        before = self.calls()
        for row_id in (theirs, unreported, "A" * 32, "x", OTHER_ID):
            with self.subTest(row_id=row_id):
                self.error(self.delete_call(self.owner, row_id), 404, "call_not_found")
        self.assertEqual(self.calls(), before)
        self.assertEqual(self.requests(), [])
        self.assertEqual(self.audit("voice.call_content_deleted"), [])
        # The other store deletes its own call; this one's call is untouched.
        self.ok(self.delete_call(self.other, theirs))
        self.assertIsNone(self.row(mine)["store_deleted_at"])
        self.ok(self.get(self.owner, "/me/voice/calls/" + mine))

    def test_temporary_password_is_refused_and_a_suspended_store_may_delete(self):
        row_id = self.new_call()
        with self.store.connect() as con:
            con.execute("UPDATE users SET password_change_required_at=1 WHERE id=?", (self.owner_id,))
        self.error(self.delete_call(self.owner, row_id), 403, "password_change_required")
        self.assertIsNone(self.row(row_id)["store_deleted_at"])
        self.assertEqual(self.requests(), [])
        with self.store.connect() as con:
            con.execute("UPDATE users SET password_change_required_at=NULL WHERE id=?", (self.owner_id,))
            vs.update_store(con, self.store_id, {"status": "suspended"})
        # A suspended store may still look at its records (M17), so it may also delete them.
        self.assertTrue(self.ok(self.delete_call(self.owner, row_id))["changed"])
        self.assertEqual(len(self.requests()), 1)

    def test_the_stores_note_and_the_operators_note_go_and_the_flag_and_score_stay(self):
        operator = self.admin()
        row_id = self.new_call()
        self.ok(self.post(self.owner, "/me/voice/calls/%s/flag" % row_id, {"kind": "wrong_answer", "note": "問洗牙價格，說成去年的"}))
        self.ok(self.post(operator, "/admin/voice/quality/calls/%s/review" % row_id,
                          {"score": 2, "labels": ["wrong_answer"], "note": "價格題答錯", "status": "open"}))
        self.ok(self.delete_call(self.owner, row_id))
        row = self.row(row_id)
        self.assertEqual((row["store_flag_kind"], row["store_flag_note"]), ("wrong_answer", None))
        [review] = rows(self.store, "voice_call_reviews")
        self.assertEqual((review["score"], review["labels"], review["status"], review["note"]), (2, '["wrong_answer"]', "open", ""))
        self.assertNotIn("洗牙", json.dumps(self.calls(), ensure_ascii=False))
        self.assertNotIn("價格題", json.dumps(rows(self.store, "voice_call_reviews"), ensure_ascii=False))

    def test_operators_see_that_the_store_deleted_the_content(self):
        operator = self.admin()
        row_id = self.new_call(orchestrator(), records(message=SAVED))
        detail = self.ok(self.get(operator, "/admin/voice/quality/calls/" + row_id))
        self.assertIsNone(detail["call"]["storeDeletedAt"])
        self.assertEqual((detail["content"]["state"], detail["deletions"]), ("available", []))
        self.ok(self.post(operator, "/admin/voice/quality/calls/%s/content-link" % row_id, {}))
        self.ok(self.delete_call(self.owner, row_id))
        row, [request] = self.row(row_id), self.requests()
        listed = self.ok(self.get(operator, "/admin/voice/quality/calls", flag="all", reviewed="all"))
        [item] = [call for call in listed["calls"] if call["id"] == row_id]
        self.assertEqual(item["storeDeletedAt"], vc.iso(row["store_deleted_at"]))
        detail = self.ok(self.get(operator, "/admin/voice/quality/calls/" + row_id))
        self.assertEqual(detail["call"]["storeDeletedAt"], vc.iso(row["store_deleted_at"]))
        self.assertIsNone(detail["call"]["contentPurgedAt"])
        self.assertEqual(detail["content"]["state"], "deleted")
        self.assertEqual(detail["deletions"], [{"id": request["id"], "reason": "store_deleted", "kinds": ALL_KINDS, "status": "pending",
                                                "requestedAt": vc.iso(request["requested_at"]), "doneAt": None,
                                                "filesDeleted": None, "rowsDeleted": None}])
        links = len(self.audit("admin.voice_call_content_link"))
        self.error(self.post(operator, "/admin/voice/quality/calls/%s/content-link" % row_id, {}), 410, "call_content_deleted")
        self.assertEqual(len(self.audit("admin.voice_call_content_link")), links)
        # The records sender confirms: the operator sees when and how much.
        self.ok(self.ack(request["id"], {"files_deleted": 4, "rows_deleted": 3}))
        detail = self.ok(self.get(operator, "/admin/voice/quality/calls/" + row_id))
        self.assertEqual(detail["call"]["contentPurgedAt"], vc.iso(self.row(row_id)["content_purged_at"]))
        self.assertEqual((detail["deletions"][0]["status"], detail["deletions"][0]["filesDeleted"], detail["deletions"][0]["rowsDeleted"]),
                         ("done", 4, 3))

    def test_reports_after_a_deletion_still_merge_so_billing_is_unchanged(self):
        now = int(time.time())
        pending = records(now, final=False)
        row_id = self.new_call(orchestrator(now), pending)
        call_id = self.row(row_id)["call_id"]
        self.assertEqual((self.row(row_id)["outcome"], self.row(row_id)["meter_units"]), ("answered", 1))
        self.ok(self.delete_call(self.owner, row_id))
        # The orchestrator resends its report (the response was lost): still the same report.
        self.assertEqual(self.ok(self.report(dict(orchestrator(now), call_id=call_id)))["result"], "duplicate")
        self.assertEqual(self.ok(self.report(dict(pending, call_id=call_id)))["result"], "duplicate")
        # A3 finishes the message: the records sender's final report is merged as before; the last digits stay gone.
        final = dict(records(now, message={"outcome": "message", "speech_ms": 12300, "recording_ms": 15000, "recording_saved": True}),
                     call_id=call_id)
        self.assertEqual(self.ok(self.report(final))["result"], "updated")
        row = self.row(row_id)
        self.assertEqual((row["outcome"], row["message_final"], row["meter_units"], row["caller_tail"]), ("message", 1, 1, None))
        self.assertNotIn("678", row["report_records"] + row["report_orchestrator"])
        self.assertEqual(self.ok(self.report(dict(final, sent_at=vc.iso(now + 1))))["result"], "duplicate")
        self.error(self.get(self.owner, "/me/voice/calls/" + row_id), 404, "call_not_found")

    def test_a_deleted_call_drops_out_of_the_flagged_count_but_not_the_months_totals(self):
        row_id = self.new_call()
        self.ok(self.post(self.owner, "/me/voice/calls/%s/flag" % row_id, {"kind": "wrong_answer"}))
        summary = self.ok(self.get(self.owner, "/me/voice/calls"))["summary"]
        self.assertEqual((summary["total"], summary["flagged"], summary["deleted"]), (1, 1, 0))
        self.ok(self.delete_call(self.owner, row_id))
        listed = self.ok(self.get(self.owner, "/me/voice/calls", flagged="1"))
        self.assertEqual((listed["calls"], listed["summary"]["total"], listed["summary"]["flagged"], listed["summary"]["deleted"]),
                         ([], 1, 0, 1))


# ---------------------------------------------------------------- R3, R4


class RuntimeDeletionTests(DeletionCase):
    def deleted(self, count=1):
        ids = []
        for _ in range(count):
            row_id = self.new_call()
            self.ok(self.delete_call(self.owner, row_id))
            ids.append(row_id)
        return ids

    def test_gate_switch_token_and_rate_limit(self):
        self.deleted()
        [request] = self.requests()
        self.use_settings(voice_enabled=False)
        for response in (self.pull(), self.ack(request["id"])):
            self.assertEqual((response.status_code, response.json()), (404, NOT_FOUND))
        self.use_settings(voice_enabled=True, voice_runtime_token="")
        self.error(self.pull(), 503, "voice_runtime_unconfigured")
        self.error(self.ack(request["id"]), 503, "voice_runtime_unconfigured")
        self.use_settings(voice_runtime_token=TOKEN)
        with mock.patch.object(vrt, "pull", side_effect=AssertionError("read")), mock.patch.object(vrt, "ack", side_effect=AssertionError("read")):
            self.error(self.pull(token=TOKEN[:-1] + "1"), 401, "runtime_auth")
            self.error(self.ack(request["id"], token=None), 401, "runtime_auth")
        self.assertEqual(self.requests()[0]["status"], "pending")
        limits = self.app.state.voice_runtime_limits
        limits["deletions"].limit = 2
        limits["deletion_acks"].limit = 1
        self.assertEqual([self.pull().status_code for _ in range(3)], [200, 200, 429])
        self.assertEqual([self.ack(request["id"]).status_code for _ in range(2)], [200, 429])
        self.assertEqual(self.config().status_code, 200)  # the other buckets are separate

    def test_pull_lists_pending_requests_with_ids_only(self):
        self.assertEqual(self.ok(self.pull()), {"schema": "voice.deletions/v1", "deletions": [], "cursor": "0", "more": False})
        row_id = self.deleted()[0]
        [request] = self.requests()
        body = self.ok(self.pull())
        self.assertEqual(body, {"schema": "voice.deletions/v1", "cursor": str(request["seq"]), "more": False,
                                "deletions": [{"id": request["id"], "call_id": self.row(row_id)["call_id"], "kinds": ALL_KINDS}]})
        text = json.dumps(body)
        for private in (self.store_id, self.owner_id, row_id, "678", "owner@clinic.example"):
            self.assertNotIn(private, text)
        # Acknowledged requests are no longer listed.
        self.ok(self.ack(request["id"]))
        self.assertEqual(self.ok(self.pull())["deletions"], [])

    def test_pull_pages_with_the_cursor_and_checks_its_parameters(self):
        self.deleted(5)
        seqs = [request["seq"] for request in self.requests()]
        self.assertEqual(seqs, sorted(seqs))
        first = self.ok(self.pull(limit="2"))
        self.assertEqual(([d["id"] for d in first["deletions"]], first["more"]), ([r["id"] for r in self.requests()[:2]], True))
        second = self.ok(self.pull(limit="2", after=first["cursor"]))
        self.assertEqual(([d["id"] for d in second["deletions"]], second["more"]), ([r["id"] for r in self.requests()[2:4]], True))
        third = self.ok(self.pull(limit="2", after=second["cursor"]))
        self.assertEqual(([d["id"] for d in third["deletions"]], third["more"]), ([self.requests()[4]["id"]], False))
        self.assertEqual(self.ok(self.pull(after=third["cursor"])), {"schema": "voice.deletions/v1", "deletions": [],
                                                                       "cursor": third["cursor"], "more": False})
        # A request that is not acknowledged is listed again from the start: polling without `after` retries it.
        self.assertEqual(len(self.ok(self.pull())["deletions"]), 5)
        for params in ({"after": "-1"}, {"after": "x"}, {"after": "1" * 19}, {"after": ""}, {"limit": "0"}, {"limit": "501"},
                       {"limit": "x"}, {"limit": ""}, {"limit": "1.5"}, {"limit": "050"}, {"after": "１"}):
            with self.subTest(params=params):
                self.error(self.pull(**params), 400, "invalid_input")
        self.assertEqual(len(self.ok(self.pull(limit="500"))["deletions"]), 5)

    def test_ack_marks_the_request_done_once(self):
        row_id = self.deleted()[0]
        [request] = self.requests()
        self.assertIsNone(self.row(row_id)["content_purged_at"])
        answer = self.ok(self.ack(request["id"], {"files_deleted": 3, "rows_deleted": 2}))
        done = self.requests()[0]
        self.assertEqual(answer, {"id": request["id"], "result": "acked", "status": "done", "done_at": vc.iso(done["done_at"])})
        self.assertEqual((done["status"], done["files_deleted"], done["rows_deleted"]), ("done", 3, 2))
        self.assertEqual(self.row(row_id)["content_purged_at"], done["done_at"])
        # Idempotent: a retry (its first answer was lost) is a duplicate and keeps the first counts.
        again = self.ok(self.ack(request["id"], {"files_deleted": 0, "rows_deleted": 0}))
        self.assertEqual(again, dict(answer, result="duplicate"))
        self.assertEqual(self.requests(), [done])
        self.assertEqual(self.row(row_id)["content_purged_at"], done["done_at"])

    def test_ack_of_an_unknown_id_is_404_and_bodies_are_checked(self):
        row_id = self.deleted()[0]
        [request] = self.requests()
        for unknown in (OTHER_ID, row_id, self.store_id, "A" * 32, "x"):
            with self.subTest(unknown=unknown):
                self.error(self.ack(unknown), 404, "deletion_not_found")
        for body in ({}, {"files_deleted": 1}, {"files_deleted": 1, "rows_deleted": 1, "call_id": "x"}, {"files_deleted": -1, "rows_deleted": 0},
                     {"files_deleted": True, "rows_deleted": 0}, {"files_deleted": 1.0, "rows_deleted": 0}, {"files_deleted": "1", "rows_deleted": 0},
                     {"files_deleted": 0, "rows_deleted": 10_000_001}, [], "x"):
            with self.subTest(body=body):
                self.error(self.ack(request["id"], body), 400, "invalid_input")
        self.assertEqual(self.requests()[0]["status"], "pending")
        big = '{"files_deleted":0,"rows_deleted":0,"pad":"%s"}' % ("x" * 1100)
        response = self.runtime_client.post(BASE + "/voice/runtime/deletions/%s/ack" % request["id"], content=big,
                                            headers=self.headers(**{"Content-Type": "application/json"}))
        self.error(response, 413, "invalid_input")
        response = self.runtime_client.post(BASE + "/voice/runtime/deletions/%s/ack" % request["id"], json={"files_deleted": 0, "rows_deleted": 0},
                                            headers={"Authorization": "Bearer " + TOKEN, "Origin": "https://foreign.example"})
        self.assertEqual((response.status_code, response.json()["error"]), (403, "origin_not_allowed"))
        self.assertEqual(self.requests()[0]["status"], "pending")

    def test_concurrent_acks_finish_the_request_once(self):
        self.deleted()
        [request] = self.requests()
        start = threading.Barrier(10)

        def send(index):
            start.wait(timeout=15)
            return self.ack(request["id"], {"files_deleted": index, "rows_deleted": index})

        with ThreadPoolExecutor(max_workers=10) as pool:
            responses = list(pool.map(send, range(10)))
        self.assertEqual(sorted(r.status_code for r in responses), [200] * 10, [r.text for r in responses])
        results = sorted(r.json()["result"] for r in responses)
        self.assertEqual(results, ["acked"] + ["duplicate"] * 9)
        winner = next(r for r in responses if r.json()["result"] == "acked")
        done = self.requests()[0]
        self.assertEqual(done["files_deleted"], done["rows_deleted"])
        self.assertEqual(done["done_at"], vc.parse_time(winner.json()["done_at"]).timestamp())


# ---------------------------------------------------------------- the schedule (§16.4) and the metadata purge (§16.5)


class RetentionScheduleTests(DeletionCase):
    def test_content_is_queued_at_90_days_and_the_portals_content_columns_are_cleared(self):
        operator = self.admin()
        row_id = self.new_call()
        self.ok(self.post(self.owner, "/me/voice/calls/%s/flag" % row_id, {"kind": "wrong_answer", "note": "答錯價格"}))
        self.ok(self.post(operator, "/admin/voice/quality/calls/%s/review" % row_id, {"score": 2, "note": "價格", "status": "done"}))
        started = self.row(row_id)["started_at"]
        billing = self.billing(row_id)
        counts = self.sweep(started + 90 * DAY - 1)
        self.assertEqual(counts["contentExpired"], 0)
        self.assertEqual(self.requests(), [])
        self.assertEqual(self.row(row_id)["caller_tail"], "678")
        counts = self.sweep(started + 90 * DAY)
        self.assertEqual(counts["contentExpired"], 1)
        [request] = self.requests()
        row = self.row(row_id)
        self.assertEqual((request["reason"], request["kinds"], request["requested_by"], request["status"]),
                         ("content_expired", json.dumps(ALL_KINDS, separators=(",", ":")), None, "pending"))
        self.assertEqual((row["caller_tail"], row["store_flag_note"], row["store_flag_kind"]), (None, None, "wrong_answer"))
        self.assertEqual(rows(self.store, "voice_call_reviews")[0]["note"], "")
        self.assertEqual(row["content_expiry_queued_at"], started + 90 * DAY)
        self.assertIsNone(row["store_deleted_at"])
        self.assertEqual(self.billing(row_id), billing)
        # §9's spot check: nothing past 90 days still holds the last digits or a note.
        with self.store.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM voice_calls WHERE started_at <= ? AND (caller_tail IS NOT NULL OR "
                                         "store_flag_note IS NOT NULL)", (started + 90 * DAY - 90 * DAY,)).fetchone()[0], 0)
        # Running again queues nothing more.
        self.assertEqual(self.sweep(started + 91 * DAY)["contentExpired"], 0)
        self.assertEqual(len(self.requests()), 1)
        # The store still sees the call's facts (its content is past its date anyway); acking marks it purged.
        self.ok(self.ack(request["id"], {"files_deleted": 2, "rows_deleted": 1}))
        self.assertEqual(self.row(row_id)["content_purged_at"], self.requests()[0]["done_at"])

    def test_recordings_are_queued_on_the_stores_date_including_a_shortened_one(self):
        with self.store.connect() as con:
            vs.update_store(con, self.store_id, {"retention_days": 30})
        saved = self.new_call(records(message=SAVED))
        later = self.new_call(records(message=SAVED))
        plain = self.new_call()  # no recording: nothing to queue before 90 days
        started = self.row(saved)["started_at"]
        self.place(later, started + 10 * DAY)
        self.place(plain, started)
        self.assertEqual(self.sweep(started + 30 * DAY - 1)["recordingExpired"], 0)
        self.assertEqual(self.sweep(started + 30 * DAY)["recordingExpired"], 1)
        [request] = self.requests()
        self.assertEqual((request["reason"], request["kinds"], request["call_id"]),
                         ("recording_expired", '["recording"]', self.row(saved)["call_id"]))
        self.assertEqual(self.row(saved)["recording_expiry_queued_at"], started + 30 * DAY)
        self.assertEqual(self.row(saved)["caller_tail"], "678")  # only the recording expired
        # The store shortens its retention to 14 days: `later` (20 days old at that point) is due at once (§9 min()).
        with self.store.connect() as con:
            vs.update_store(con, self.store_id, {"retention_days": 14})
        self.assertEqual(self.sweep(started + 30 * DAY + 1)["recordingExpired"], 1)
        self.assertEqual([r["call_id"] for r in self.requests()], [self.row(saved)["call_id"], self.row(later)["call_id"]])
        self.assertIsNone(self.row(plain)["recording_expiry_queued_at"])
        # The recording-only acknowledgement is not "all content purged".
        self.ok(self.ack(request["id"]))
        self.assertIsNone(self.row(saved)["content_purged_at"])
        # At 90 days the rest is queued once per call, recordings included.
        self.sweep(started + 100 * DAY - 1)
        self.assertEqual(len([r for r in self.requests() if r["reason"] == "content_expired"]), 2)  # `later` is 1 s short of 90 days
        self.sweep(started + 100 * DAY)
        self.assertEqual(sorted((r["call_id"], r["reason"]) for r in self.requests() if r["reason"] == "content_expired"),
                         sorted((self.row(row_id)["call_id"], "content_expired") for row_id in (saved, later, plain)))

    def test_a_recording_kept_90_days_is_queued_once_with_everything_else(self):
        row_id = self.new_call(records(message=SAVED))
        started = self.row(row_id)["started_at"]
        counts = self.sweep(started + 90 * DAY)
        self.assertEqual((counts["contentExpired"], counts["recordingExpired"]), (1, 0))
        self.assertEqual([r["reason"] for r in self.requests()], ["content_expired"])
        self.assertEqual(self.sweep(started + 95 * DAY)["recordingExpired"], 0)

    def test_a_call_the_store_deleted_is_not_queued_again(self):
        row_id = self.new_call(records(message=SAVED))
        started = self.row(row_id)["started_at"]
        self.ok(self.delete_call(self.owner, row_id))
        counts = self.sweep(started + 95 * DAY)
        self.assertEqual((counts["contentExpired"], counts["recordingExpired"]), (0, 0))
        self.assertEqual([r["reason"] for r in self.requests()], ["store_deleted"])
        self.assertIsNotNone(self.row(row_id)["content_expiry_queued_at"])

    def test_concurrent_runs_queue_each_request_once(self):
        ids = [self.new_call(records(message=SAVED)) for _ in range(6)]
        started = max(self.row(row_id)["started_at"] for row_id in ids)
        start = threading.Barrier(4)

        def run(_):
            start.wait(timeout=15)
            return self.sweep(started + 90 * DAY)

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(run, range(4)))
        self.assertEqual(sum(result["contentExpired"] for result in results), 6)
        self.assertEqual(len(self.requests()), 6)
        self.assertEqual(sorted(r["seq"] for r in self.requests()), list(range(1, 7)))

    def test_metadata_rows_are_deleted_after_the_retention_days(self):
        operator = self.admin()
        old, young = self.new_call(), self.new_call()
        self.ok(self.post(operator, "/admin/voice/quality/calls/%s/review" % old, {"score": 3, "status": "done"}))
        self.ok(self.delete_call(self.owner, old))
        started = self.row(old)["started_at"]
        self.place(young, started + DAY)
        young_call = self.row(young)["call_id"]
        [request] = self.requests()
        self.ok(self.ack(request["id"]))
        self.assertEqual(len(rows(self.store, "voice_call_reviews")), 1)
        counts = self.sweep(started + 400 * DAY - 1, days=400)
        self.assertEqual(counts["callsPurged"], 0)
        self.assertEqual({r["id"] for r in self.calls()}, {old, young})
        counts = self.sweep(started + 400 * DAY, days=400)
        self.assertEqual((counts["callsPurged"], counts["requestsPurged"]), (1, 1))
        self.assertEqual({r["id"] for r in self.calls()}, {young})
        self.assertEqual(rows(self.store, "voice_call_reviews"), [])
        # The old call's done request went with it; the young call's content (399 days old) is queued and pending.
        self.assertEqual([(r["call_id"], r["reason"], r["status"]) for r in self.requests()], [(young_call, "content_expired", "pending")])
        # Each run that did something leaves one audit row with its counts (the first queued the young call's content).
        events = self.audit("voice.retention_swept")
        details = sorted((json.loads(event["details"]) for event in events), key=lambda counts: counts["callsPurged"])
        self.assertEqual(details, [{"contentExpired": 1, "recordingExpired": 0, "callsPurged": 0, "requestsPurged": 0, "callRetentionDays": 400},
                                   {"contentExpired": 0, "recordingExpired": 0, "callsPurged": 1, "requestsPurged": 1, "callRetentionDays": 400}])
        self.assertEqual({event["actor_id"] for event in events}, {None})
        # The young call goes a day later; the default is 5 years.
        self.assertEqual(self.sweep(started + 401 * DAY, days=400)["callsPurged"], 1)
        self.assertEqual(self.calls(), [])
        # A pending request is not purged with its call: the Taiwan host still has to delete the content.
        self.assertEqual([(r["call_id"], r["status"]) for r in self.requests()], [(young_call, "pending")])
        self.assertEqual(Settings().voice_call_retention_days, 1825)

    def test_a_pending_request_outlives_the_purged_call(self):
        row_id = self.new_call()
        started = self.row(row_id)["started_at"]
        self.ok(self.delete_call(self.owner, row_id))
        self.sweep(started + 90 * DAY, days=90)
        self.assertEqual(self.calls(), [])
        [request] = self.requests()
        self.assertEqual(request["status"], "pending")
        self.assertEqual([d["id"] for d in self.ok(self.pull())["deletions"]], [request["id"]])
        self.assertEqual(self.ok(self.ack(request["id"]))["result"], "acked")

    def test_a_call_is_never_purged_before_its_content_is_queued(self):
        row_id = self.new_call()
        started = self.row(row_id)["started_at"]
        # One run at 90 days with 90-day metadata retention: queue first, then purge (the request stays).
        counts = self.sweep(started + 90 * DAY, days=90)
        self.assertEqual((counts["contentExpired"], counts["callsPurged"]), (1, 1))
        self.assertEqual([r["reason"] for r in self.requests()], ["content_expired"])

    def test_the_purge_step_alone_never_deletes_a_call_whose_content_is_not_queued(self):
        # Defence in depth (§16.5): if step 1 has not reached a call (an error, a run cut short), step 3 still keeps it.
        row_id = self.new_call()
        started = self.row(row_id)["started_at"]
        self.assertEqual(vrt.purge_old_calls(self.store, started + 400 * DAY, 90), (0, 0))
        self.assertEqual([r["id"] for r in self.calls()], [row_id])
        self.assertEqual(vrt.queue_expired_content(self.store, started + 400 * DAY), 1)
        self.assertEqual(vrt.purge_old_calls(self.store, started + 400 * DAY, 90), (1, 0))
        self.assertEqual(self.calls(), [])
        self.assertEqual([r["reason"] for r in self.requests()], ["content_expired"])

    def test_the_detail_dates_follow_the_setting(self):
        operator = self.admin()
        row_id = self.new_call()
        started = self.row(row_id)["started_at"]
        detail = self.ok(self.get(operator, "/admin/voice/quality/calls/" + row_id))
        self.assertEqual(detail["call"]["retention"]["detailUntil"], vc.iso(started + 1825 * DAY))
        self.assertEqual(self.ok(self.get(self.owner, "/me/voice/calls"))["limits"]["callDetailDays"], 1825)
        self.use_settings(voice_call_retention_days=400)
        operator = self.client()
        self.post(operator, "/auth/login", {"email": "admin@example.test", "password": PASSWORD})
        owner = self.client()
        self.post(owner, "/auth/login", {"email": "owner@clinic.example", "password": PASSWORD})
        detail = self.ok(self.get(operator, "/admin/voice/quality/calls/" + row_id))
        self.assertEqual(detail["call"]["retention"]["detailUntil"], vc.iso(started + 400 * DAY))
        self.assertEqual(self.ok(self.get(owner, "/me/voice/calls"))["limits"]["callDetailDays"], 400)


class ManageCommandTests(DeletionCase):
    def test_voice_retention_runs_the_schedule_once_and_prints_counts_only(self):
        import io
        import os
        from contextlib import redirect_stdout

        from server import manage

        row_id = self.new_call()
        self.place(row_id, int(time.time()) - 91 * DAY)
        out = io.StringIO()
        # The database URL, not PC_PORTAL_DB: from_env reads PC_PORTAL_DB as a file path (a Postgres URL would become one).
        database = {"PC_PORTAL_DATABASE_URL": self.settings.resolved_database_url}
        with mock.patch.dict(os.environ, dict(database, PC_VOICE_CALL_RETENTION_DAYS="400")), redirect_stdout(out):
            self.assertEqual(manage.main(["voice-retention"]), 0)
        self.assertEqual(json.loads(out.getvalue()), {"contentExpired": 1, "recordingExpired": 0, "callsPurged": 0, "requestsPurged": 0})
        self.assertEqual([r["reason"] for r in self.requests()], ["content_expired"])
        with mock.patch.dict(os.environ, dict(database, PC_VOICE_CALL_RETENTION_DAYS="30")), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(manage.main(["voice-retention"]), 1)
        self.assertIn("PC_VOICE_CALL_RETENTION_DAYS", err.getvalue())


class ScheduleLoopTests(unittest.TestCase):
    def test_the_loop_runs_after_its_first_delay_and_stops(self):
        calls = []
        settings = Settings(voice_enabled=True, voice_call_retention_days=400)

        def fake_sweep(store, now, days):
            calls.append((store, days))
            return {}

        async def run():
            stop = asyncio.Event()
            with mock.patch.object(vrt, "sweep", side_effect=fake_sweep):
                task = asyncio.create_task(vrt.serve("store", settings, stop, first_delay=0.01, interval=0.02))
                await asyncio.sleep(0.07)
                stop.set()
                await asyncio.wait_for(task, 1)

        asyncio.run(run())
        self.assertGreaterEqual(len(calls), 2)
        self.assertEqual(calls[0], ("store", 400))

    def test_a_failed_run_does_not_stop_the_loop(self):
        calls = []

        def failing(store, now, days):
            calls.append(now)
            raise RuntimeError("database is locked")

        async def run():
            stop = asyncio.Event()
            with mock.patch.object(vrt, "sweep", side_effect=failing), mock.patch("sys.stderr"):
                task = asyncio.create_task(vrt.serve("store", Settings(), stop, first_delay=0.01, interval=0.01))
                await asyncio.sleep(0.06)
                stop.set()
                await asyncio.wait_for(task, 1)

        asyncio.run(run())
        self.assertGreaterEqual(len(calls), 2)

    def test_no_run_before_the_first_delay(self):
        calls = []

        async def run():
            stop = asyncio.Event()
            with mock.patch.object(vrt, "sweep", side_effect=lambda *args: calls.append(args)):
                task = asyncio.create_task(vrt.serve("store", Settings(), stop))
                await asyncio.sleep(0.05)
                stop.set()
                await asyncio.wait_for(task, 1)

        asyncio.run(run())
        self.assertEqual(calls, [])
        self.assertEqual((vrt.SWEEP_FIRST_DELAY_SECONDS, vrt.SWEEP_INTERVAL_SECONDS), (60, 3600))


if __name__ == "__main__":
    unittest.main()
