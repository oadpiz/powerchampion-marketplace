"""Store call records M13-M17 and operator quality A9-A16, plus phase 1 A7/A8 once calls refer to a number
(server/voice_call_routes.py, server/admin_voice.py; phase2-contract.md §1, §4.4, §6-§9, §14).

Runs on SQLite, or on Postgres when PC_PORTAL_TEST_DATABASE_URL is set (scripts/test_backend_postgres.sh)."""
import base64
import hashlib
import hmac
import json
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from server import voice_calls as vc
from server import voice_store as vs
from server.test_voice_runtime import (AI, CUSTOMER_NUMBER, MEDIA_SECRET, MEDIA_URL, NOT_FOUND, VoiceCallsCase, at, orchestrator,
                                       records)
from server.testsupport import BASE, ORIGIN, PASSWORD, database_text, rows

OTHER_ID = "0123456789abcdef0123456789abcdef"
OTHER_NUMBER = "+886227001009"
CALL_ITEM_KEYS = {"id", "ref", "startedAt", "durationSeconds", "entry", "caller", "outcome", "hasMessage", "handoff", "urgent",
                  "degraded", "flagged", "meterUnits", "meterReason"}
DETAIL_EXTRA_KEYS = {"answeredAt", "endedAt", "configVersion", "handoffReason", "callbackConfirmed", "messageSeconds", "recordingSeconds"}
CONTENT_KEYS = {"expected", "hasRecording", "transcriptUntil", "recordingUntil", "state", "linkAvailable"}
QUALITY_ITEM_KEYS = {"id", "callId", "store", "startedAt", "durationSeconds", "entry", "dialed", "numberPurpose", "outcome", "degraded",
                     "degradeReason", "handoff", "handoffReason", "urgent", "autoFlags", "storeFlag", "review", "meterUnits", "meterReason"}
QUALITY_DETAIL_EXTRA = {"answeredAt", "endedAt", "configVersion", "configSha256", "disclosureVersion", "turns", "aiAnswered",
                        "aiSpeechSeconds", "callSpeechSeconds", "metrics", "message", "mismatch", "retention", "meterRule"}
LISTENING_BODY = {"title": "G0 聲音盲聽", "kind": "tts_voice", "heldOn": "2026-10-22", "sampleCount": 20, "raterCount": 3,
                  "passed": True, "summary": "三位評分人都選 B。", "reportRef": "docs/g0-listening.md"}


def decode_token(token):
    first, signature = token.split(".")
    expected = base64.urlsafe_b64encode(hmac.new(MEDIA_SECRET.encode(), first.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    assert hmac.compare_digest(expected, signature)
    return json.loads(base64.urlsafe_b64decode(first + "=" * (-len(first) % 4)))


class CallRoutesCase(VoiceCallsCase):
    """Two stores (A has the customer number, B another one) and helpers; holds no tests."""

    def setUp(self):
        super().setUp()
        self.owner, self.store_id = self.seed()
        self.owner_id = self.user_id("owner@clinic.example")
        self.other, self.other_store = self.seed_store("b@example.test")
        self.seed_number(OTHER_NUMBER, store_id=self.other_store)
        self.serial = 0

    def new_call(self, *bodies, **changes):
        """Report one call (default: the vector's orchestrator report) and return its voice_calls id."""
        self.serial += 1
        call_id = "1797816000.%d" % self.serial
        for body in bodies or (orchestrator(**changes),):
            self.assertIn(self.report(dict(body, call_id=call_id)).status_code, (200, 201))
        return self.call(call_id)["id"]

    def move(self, row_id, seconds):
        """Shift a call in time (reports older than 30 days are refused, so tests move stored rows)."""
        with self.store.connect() as con:
            con.execute("UPDATE voice_calls SET started_at=started_at+?, ended_at=ended_at+?, answered_at=answered_at+? WHERE id=?",
                        (seconds, seconds, seconds, row_id))

    def get(self, client, path, **params):
        return client.get(BASE + path, params=params)

    def delete(self, client, path):
        return client.delete(BASE + path, headers={"Origin": ORIGIN})

    def row(self, row_id):
        return next(r for r in self.calls() if r["id"] == row_id)

    def audit_details(self, action):
        return [json.loads(e["details"]) for e in self.audit(action)]


# ---------------------------------------------------------------- §1.1 switch and access


class SwitchTests(CallRoutesCase):
    def routes(self, row_id, log_id):
        store = [("GET", "/me/voice/calls", None), ("GET", "/me/voice/calls/" + row_id, None),
                 ("POST", "/me/voice/calls/%s/flag" % row_id, {"kind": "wrong_answer"}), ("DELETE", "/me/voice/calls/%s/flag" % row_id, None),
                 ("POST", "/me/voice/calls/%s/content-link" % row_id, {})]
        admin = [("GET", "/admin/voice/quality/calls", None), ("GET", "/admin/voice/quality/calls/" + row_id, None),
                 ("POST", "/admin/voice/quality/calls/%s/review" % row_id, {"score": 3, "status": "open"}),
                 ("POST", "/admin/voice/quality/calls/%s/content-link" % row_id, {}), ("GET", "/admin/voice/quality/listening", None),
                 ("POST", "/admin/voice/quality/listening", LISTENING_BODY), ("POST", "/admin/voice/quality/listening/" + log_id, LISTENING_BODY),
                 ("DELETE", "/admin/voice/quality/listening/" + log_id, None)]
        return store, admin

    def send(self, client, method, path, body):
        if method == "GET":
            return client.get(BASE + path)
        if method == "DELETE":
            return self.delete(client, path)
        return self.post(client, path, body)

    def test_switch_off_is_a_plain_404_and_on_it_is_not(self):
        row_id = self.new_call()
        operator = self.admin()
        log_id = self.ok(self.post(operator, "/admin/voice/quality/listening", LISTENING_BODY), 201)["log"]["id"]
        self.use_settings(voice_enabled=False)
        owner = self.client()
        self.post(owner, "/auth/login", {"email": "owner@clinic.example", "password": PASSWORD})
        operator = self.client()
        self.post(operator, "/auth/login", {"email": "admin@example.test", "password": PASSWORD})
        customer = self.client()
        self.register(customer, "customer@example.test")
        anonymous = self.client()
        store_routes, admin_routes = self.routes(row_id, log_id)
        for method, path, body in store_routes:
            with self.subTest(method=method, path=path):
                self.assertEqual((self.send(owner, method, path, body).status_code, self.send(owner, method, path, body).json()), (404, NOT_FOUND))
        for method, path, body in admin_routes:
            with self.subTest(method=method, path=path):
                response = self.send(operator, method, path, body)
                self.assertEqual((response.status_code, response.json()), (404, NOT_FOUND))
                self.error(self.send(customer, method, path, body), 403, "admin_required")
                self.error(self.send(anonymous, method, path, body), 401, "auth_required")
        self.use_settings(voice_enabled=True)
        owner = self.client()
        self.post(owner, "/auth/login", {"email": "owner@clinic.example", "password": PASSWORD})
        operator = self.client()
        self.post(operator, "/auth/login", {"email": "admin@example.test", "password": PASSWORD})
        for client, routes in ((owner, store_routes), (operator, admin_routes)):
            for method, path, body in routes:
                with self.subTest(on=path, method=method):
                    self.assertIn(self.send(client, method, path, body).status_code, (200, 201))

    def test_customers_without_a_store_get_voice_store_not_found(self):
        row_id = self.new_call()
        customer = self.client()
        self.register(customer, "nostore@example.test")
        for method, path, body in self.routes(row_id, OTHER_ID)[0]:
            with self.subTest(method=method, path=path):
                self.error(self.send(customer, method, path, body), 404, "voice_store_not_found")


# ---------------------------------------------------------------- M13, M14


class StoreListTests(CallRoutesCase):
    def test_list_summary_and_filters(self):
        now = int(time.time())
        answered = self.new_call()
        message = self.new_call(records(now, message={"outcome": "message", "speech_ms": 12300}))
        missed = self.new_call(records(now, disposition="NO ANSWER", answered_at=None))
        try_id = "try-" + uuid.uuid4().hex
        self.ok(self.report(orchestrator(now, call_id=try_id, entry="try", dialed=None, store_id=self.store_id)), 201)
        self.new_call(orchestrator(now, dialed="0227001009"))  # store B
        self.ok(self.post(self.owner, "/me/voice/calls/%s/flag" % answered, {"kind": "wrong_answer"}))
        body = self.ok(self.get(self.owner, "/me/voice/calls"))
        self.assertEqual(set(body), {"calls", "next", "summary", "limits"})
        self.assertEqual(body["limits"], {"callsPageSize": 50, "flagNoteChars": 100})
        self.assertIsNone(body["next"])
        self.assertEqual(len(body["calls"]), 4)
        self.assertEqual({c["id"] for c in body["calls"]}, {answered, message, missed, self.call(try_id)["id"]})
        for item in body["calls"]:
            self.assertEqual(set(item), CALL_ITEM_KEYS)
            self.assertEqual(item["ref"], item["id"][:8])
        summary = body["summary"]
        self.assertEqual(summary["month"], vc.taipei_month(now))
        self.assertEqual((summary["total"], summary["meterUnits"], summary["flagged"]), (4, 2, 1))
        self.assertEqual(summary["byOutcome"], {"answered": 2, "message": 1, "handoff": 0, "degraded": 0, "not_answered": 1,
                                                "hangup_early": 0, "no_speech": 0, "error": 0, "unknown": 0})
        self.assertEqual([c["id"] for c in self.ok(self.get(self.owner, "/me/voice/calls", outcome="message"))["calls"]], [message])
        flagged = self.ok(self.get(self.owner, "/me/voice/calls", flagged="1"))
        self.assertEqual([c["id"] for c in flagged["calls"]], [answered])
        self.assertEqual(flagged["summary"]["total"], 4)  # the summary ignores the filters
        item = next(c for c in body["calls"] if c["id"] == answered)
        self.assertEqual((item["entry"], item["caller"], item["durationSeconds"], item["flagged"], item["meterReason"]),
                         ("pstn", {"tail": "678", "kind": "mobile"}, 159, True, "ai_speech"))
        for params in ({"month": "2026-13"}, {"month": "26-10"}, {"outcome": "done"}, {"flagged": "0"}, {"before": "x"},
                       {"before": "1797815702-ABC"}):
            with self.subTest(params=params):
                self.error(self.get(self.owner, "/me/voice/calls", **params), 400, "invalid_input")
        self.assertEqual(self.ok(self.get(self.other, "/me/voice/calls"))["summary"]["total"], 1)

    def test_pages_follow_the_cursor_newest_first(self):
        ids = [self.new_call() for _ in range(5)]
        for index, row_id in enumerate(ids):
            self.move(row_id, index)  # distinct times; the last one is the newest
        with mock.patch.object(vc, "STORE_PAGE_SIZE", 2):
            seen, cursor = [], None
            for _ in range(3):
                body = self.ok(self.get(self.owner, "/me/voice/calls", **({"before": cursor} if cursor else {})))
                seen += [c["id"] for c in body["calls"]]
                cursor = body["next"]
            self.assertIsNone(cursor)
        self.assertEqual(seen, list(reversed(ids)))

    def test_months_are_taipei_months(self):
        current = self.new_call()
        older = self.new_call()
        self.move(older, -40 * 86400)
        row = self.row(older)
        body = self.ok(self.get(self.owner, "/me/voice/calls"))
        self.assertEqual([c["id"] for c in body["calls"]], [current])
        earlier = self.ok(self.get(self.owner, "/me/voice/calls", month=vc.taipei_month(row["started_at"])))
        self.assertIn(older, [c["id"] for c in earlier["calls"]])
        self.assertEqual(earlier["summary"]["month"], vc.taipei_month(row["started_at"]))

    def test_detail_is_only_for_the_own_store(self):
        mine = self.new_call(orchestrator(content_expected=True))
        theirs = self.new_call(orchestrator(dialed="0227001009"))
        body = self.ok(self.get(self.owner, "/me/voice/calls/" + mine))
        self.assertEqual(set(body), {"call", "content", "flag"})
        self.assertEqual(set(body["call"]), CALL_ITEM_KEYS | DETAIL_EXTRA_KEYS)
        self.assertEqual(set(body["content"]), CONTENT_KEYS)
        self.assertEqual((body["content"]["state"], body["content"]["linkAvailable"], body["content"]["hasRecording"]), ("available", True, False))
        self.assertIsNone(body["content"]["recordingUntil"])
        self.assertIsNone(body["flag"])
        self.assertNotIn("callId", json.dumps(body))
        self.assertNotIn("1797816000", json.dumps(body))  # the A6 key is for operators only
        for row_id in (theirs, "A" * 32, "x", OTHER_ID):
            with self.subTest(row_id=row_id):
                self.error(self.get(self.owner, "/me/voice/calls/" + row_id), 404, "call_not_found")
        self.ok(self.get(self.other, "/me/voice/calls/" + theirs))

    def test_content_state_and_recording_dates(self):
        none = self.new_call(orchestrator(content_expected=False))
        self.assertEqual(self.ok(self.get(self.owner, "/me/voice/calls/" + none))["content"]["state"], "none")
        now = int(time.time())
        saved = self.new_call(records(now, message={"outcome": "message", "speech_ms": 5000, "recording_ms": 6000, "recording_saved": True}))
        row = self.row(saved)
        content = self.ok(self.get(self.owner, "/me/voice/calls/" + saved))["content"]
        self.assertEqual(content["recordingUntil"], vc.iso(row["started_at"] + 90 * 86400))
        with self.store.connect() as con:
            vs.update_store(con, self.store_id, {"retention_days": 14})
        content = self.ok(self.get(self.owner, "/me/voice/calls/" + saved))["content"]
        self.assertEqual(content["recordingUntil"], vc.iso(row["started_at"] + 14 * 86400))
        self.move(saved, -91 * 86400)
        self.assertEqual(self.ok(self.get(self.owner, "/me/voice/calls/" + saved))["content"]["state"], "expired")
        self.use_settings(voice_media_secret="")
        owner = self.client()
        self.post(owner, "/auth/login", {"email": "owner@clinic.example", "password": PASSWORD})
        self.assertFalse(self.ok(self.get(owner, "/me/voice/calls/" + none))["content"]["linkAvailable"])


# ---------------------------------------------------------------- M15, M16


class StoreFlagTests(CallRoutesCase):
    def test_flag_change_and_unflag(self):
        row_id = self.new_call()
        path = "/me/voice/calls/%s/flag" % row_id
        before = self.ok(self.get(self.owner, "/me/voice/calls/" + row_id))
        self.assertIsNone(before["flag"])
        body = self.ok(self.post(self.owner, path, {"kind": "wrong_answer", "note": "問洗牙價格，AI 說的是去年的價錢"}))
        self.assertTrue(body["changed"])
        self.assertEqual({k: body["flag"][k] for k in ("kind", "note", "reviewed")},
                         {"kind": "wrong_answer", "note": "問洗牙價格，AI 說的是去年的價錢", "reviewed": False})
        self.assertEqual(self.audit_details("voice.call_flagged"), [{"kind": "wrong_answer", "noteChars": 17}])
        self.assertFalse(self.ok(self.post(self.owner, path, {"kind": "wrong_answer", "note": " 問洗牙價格，AI 說的是去年的價錢 "}))["changed"])
        self.assertEqual(len(self.audit("voice.call_flagged")), 1)
        self.assertTrue(self.ok(self.post(self.owner, path, {"kind": "wrong_answer"}))["changed"])
        self.assertEqual(self.row(row_id)["store_flag_note"], "")
        self.assertEqual(self.row(row_id)["store_flagged_by"], self.owner_id)
        for audit in self.audit("voice.call_flagged"):
            self.assertNotIn("洗牙", audit["details"])
        self.assertEqual(self.ok(self.delete(self.owner, path)), {"changed": True})
        self.assertEqual(self.ok(self.delete(self.owner, path)), {"changed": False})
        row = self.row(row_id)
        self.assertEqual((row["store_flag_kind"], row["store_flag_note"], row["store_flagged_at"], row["store_flagged_by"]), (None,) * 4)
        self.assertEqual(self.audit_details("voice.call_unflagged"), [{"kind": "wrong_answer"}])

    def test_invalid_flags_change_nothing(self):
        row_id = self.new_call()
        path = "/me/voice/calls/%s/flag" % row_id
        for body, code in (({"kind": "rude"}, "invalid_input"), ({}, "invalid_input"), ({"kind": "wrong_answer", "note": "x" * 101}, "invalid_input"),
                           ({"kind": "wrong_answer", "note": "a\nb"}, "invalid_input"),
                           ({"kind": "wrong_answer", "note": "回電 0912 345 678"}, "note_contains_number"),
                           ({"kind": "wrong_answer", "note": "０９１２３４５６７８"}, "note_contains_number")):
            with self.subTest(body=body):
                self.error(self.post(self.owner, path, body), 400, code)
        self.assertIsNone(self.row(row_id)["store_flag_kind"])
        self.assertEqual(self.audit("voice.call_flagged"), [])
        theirs = self.new_call(orchestrator(dialed="0227001009"))
        self.error(self.post(self.owner, "/me/voice/calls/%s/flag" % theirs, {"kind": "wrong_answer"}), 404, "call_not_found")
        self.error(self.delete(self.owner, "/me/voice/calls/%s/flag" % theirs), 404, "call_not_found")
        self.ok(self.post(self.owner, path, {"kind": "wrong_answer", "note": "x" * 100}))

    def test_temporary_password_and_suspended_store(self):
        row_id = self.new_call()
        flag = "/me/voice/calls/%s/flag" % row_id
        link = "/me/voice/calls/%s/content-link" % row_id
        self.ok(self.post(self.owner, flag, {"kind": "wrong_answer"}))
        with self.store.connect() as con:
            con.execute("UPDATE users SET password_change_required_at=1 WHERE id=?", (self.owner_id,))
        self.error(self.post(self.owner, flag, {"kind": "wrong_answer", "note": "x"}), 403, "password_change_required")
        self.error(self.delete(self.owner, flag), 403, "password_change_required")
        self.error(self.post(self.owner, link, {}), 403, "password_change_required")
        self.ok(self.get(self.owner, "/me/voice/calls/" + row_id))
        with self.store.connect() as con:
            con.execute("UPDATE users SET password_change_required_at=NULL WHERE id=?", (self.owner_id,))
            vs.update_store(con, self.store_id, {"status": "suspended"})
        self.error(self.delete(self.owner, flag), 409, "store_suspended")
        self.error(self.post(self.owner, flag, {"kind": "wrong_answer", "note": "y"}), 409, "store_suspended")
        self.assertEqual((self.row(row_id)["store_flag_kind"], self.row(row_id)["store_flag_note"]), ("wrong_answer", ""))
        # Looking is still allowed while suspended.
        self.ok(self.get(self.owner, "/me/voice/calls"))
        self.assertIn("media", self.ok(self.post(self.owner, link, {})))


# ---------------------------------------------------------------- M17, A12


class ContentLinkTests(CallRoutesCase):
    def test_store_link_is_signed_and_audited_without_the_token(self):
        row_id = self.new_call(records(message={"outcome": "message", "speech_ms": 5000, "recording_ms": 6000, "recording_saved": True}))
        row = self.row(row_id)
        before = int(time.time())
        media = self.ok(self.post(self.owner, "/me/voice/calls/%s/content-link" % row_id, {}))["media"]
        payload = decode_token(media["token"])
        self.assertEqual({k: payload[k] for k in ("v", "purpose", "aud", "call_id", "store_id", "kinds", "sub", "role")},
                         {"v": 1, "purpose": "media", "aud": "voice-media", "call_id": row["call_id"], "store_id": self.store_id,
                          "kinds": ["recording", "summary", "transcript"], "sub": self.owner_id, "role": "store"})
        self.assertEqual(payload["exp"] - payload["iat"], 300)
        self.assertLessEqual(before, payload["iat"])
        self.assertEqual(media["kinds"], ["recording", "summary", "transcript"])
        self.assertEqual(media["expiresAt"], vc.iso(payload["exp"]))
        self.assertEqual(media["urls"], {kind: "%s/v1/calls/%s/%s" % (MEDIA_URL, row["call_id"], kind) for kind in media["kinds"]})
        self.assertEqual(self.audit_details("voice.call_content_link"), [{"kinds": ["recording", "summary", "transcript"], "storeId": self.store_id}])
        self.assertNotIn(media["token"], database_text(self.store))
        self.assertNotIn(payload["nonce"], database_text(self.store))

    def test_errors_in_contract_order(self):
        none = self.new_call(orchestrator(content_expected=False))
        old = self.new_call()
        self.move(old, -91 * 86400)
        path = "/me/voice/calls/%s/content-link"
        self.error(self.post(self.owner, path % none, {}), 404, "call_content_unavailable")
        self.error(self.post(self.owner, path % old, {}), 410, "call_content_expired")
        self.error(self.post(self.owner, path % OTHER_ID, {}), 404, "call_not_found")
        self.assertEqual(self.audit("voice.call_content_link"), [])
        self.use_settings(voice_media_url="")
        owner = self.client()
        self.post(owner, "/auth/login", {"email": "owner@clinic.example", "password": PASSWORD})
        self.error(self.post(owner, path % none, {}), 503, "voice_media_unavailable")

    def test_60_links_an_hour_per_account_even_when_concurrent(self):
        row_id = self.new_call()
        now = int(time.time())
        with self.store.connect() as con:
            for index in range(55):
                action = "voice.call_content_link" if index % 2 else "admin.voice_call_content_link"
                con.execute("INSERT INTO audit_events (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
                            (uuid.uuid4().hex, self.owner_id, action, row_id, now - 60))
            # An hour-old link and another account's links do not count.
            con.execute("INSERT INTO audit_events (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
                        (uuid.uuid4().hex, self.owner_id, "voice.call_content_link", row_id, now - 3601))
            con.execute("INSERT INTO audit_events (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
                        (uuid.uuid4().hex, self.user_id("b@example.test"), "voice.call_content_link", row_id, now))
        start = threading.Barrier(10)

        def attempt(_):
            start.wait(timeout=15)
            return self.post(self.owner, "/me/voice/calls/%s/content-link" % row_id, {})

        with ThreadPoolExecutor(max_workers=10) as pool:
            statuses = sorted(r.status_code for r in pool.map(attempt, range(10)))
        self.assertEqual((statuses.count(200), statuses.count(429)), (5, 5), statuses)
        self.error(self.post(self.owner, "/me/voice/calls/%s/content-link" % row_id, {}), 429, "voice_content_link_limit")
        recent = [e for e in rows(self.store, "audit_events") if e["actor_id"] == self.owner_id and e["created_at"] > now - 3600
                  and e["action"] in vc.CONTENT_LINK_ACTIONS]
        self.assertEqual(len(recent), 60)

    def test_admin_link_for_a_call_without_a_store(self):
        row_id = self.new_call(orchestrator(dialed="0227009999"))
        operator = self.admin()
        admin_id = self.user_id("admin@example.test")
        media = self.ok(self.post(operator, "/admin/voice/quality/calls/%s/content-link" % row_id, {}))["media"]
        payload = decode_token(media["token"])
        self.assertEqual((payload["store_id"], payload["role"], payload["sub"], payload["kinds"]), (None, "admin", admin_id, ["summary", "transcript"]))
        self.assertEqual(self.audit_details("admin.voice_call_content_link"), [{"kinds": ["summary", "transcript"], "storeId": None}])
        with self.store.connect() as con:
            for _ in range(59):
                con.execute("INSERT INTO audit_events (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
                            (uuid.uuid4().hex, admin_id, "voice.call_content_link", row_id, int(time.time())))
        self.error(self.post(operator, "/admin/voice/quality/calls/%s/content-link" % row_id, {}), 429, "voice_content_link_limit")
        self.error(self.post(operator, "/admin/voice/quality/calls/%s/content-link" % OTHER_ID, {}), 404, "call_not_found")


# ---------------------------------------------------------------- A9-A11


class QualityTests(CallRoutesCase):
    def setUp(self):
        super().setUp()
        self.operator = self.admin()
        self.flagged = self.new_call()
        self.ok(self.post(self.owner, "/me/voice/calls/%s/flag" % self.flagged, {"kind": "wrong_answer", "note": "價格錯"}))
        self.auto = self.new_call(orchestrator(dialed="0227009999"))  # unknown_number
        self.clean = self.new_call()

    def ids(self, **params):
        return [c["id"] for c in self.ok(self.get(self.operator, "/admin/voice/quality/calls", **params))["calls"]]

    def test_default_filters_counts_and_shapes(self):
        body = self.ok(self.get(self.operator, "/admin/voice/quality/calls"))
        self.assertEqual(set(body), {"calls", "next", "counts", "limits"})
        self.assertEqual(body["limits"], {"callsPageSize": 100, "reviewNoteChars": 500, "reviewLabelsMax": 6, "listeningMax": 500})
        self.assertEqual(sorted(c["id"] for c in body["calls"]), sorted([self.flagged, self.auto]))
        self.assertEqual(body["counts"], {"storeFlaggedOpen": 1, "autoFlaggedOpen": 1})
        for item in body["calls"]:
            self.assertEqual(set(item), QUALITY_ITEM_KEYS)
        flagged = next(c for c in body["calls"] if c["id"] == self.flagged)
        self.assertEqual(flagged["store"], {"id": self.store_id, "name": "晴光牙醫診所"})
        self.assertEqual((flagged["storeFlag"]["kind"], flagged["storeFlag"]["note"], flagged["dialed"], flagged["numberPurpose"]),
                         ("wrong_answer", "價格錯", CUSTOMER_NUMBER, "customer"))
        auto = next(c for c in body["calls"] if c["id"] == self.auto)
        self.assertEqual((auto["store"], auto["autoFlags"], auto["meterReason"]), (None, ["unknown_number"], "unknown_line"))
        self.assertEqual(sorted(self.ids(flag="all")), sorted([self.flagged, self.auto, self.clean]))
        self.assertEqual(self.ids(flag="store"), [self.flagged])
        self.assertEqual(self.ids(flag="auto"), [self.auto])
        self.assertEqual(self.ids(flag="none"), [self.clean])
        self.assertEqual(self.ids(flag="all", store=self.store_id, entry="pstn", outcome="answered", month=vc.taipei_month(int(time.time()))),
                         sorted([self.flagged, self.clean], key=lambda i: (self.row(i)["started_at"], i), reverse=True))
        self.assertEqual(self.ids(flag="all", month="2026-01"), [])
        self.assertEqual(self.ids(flag="all", entry="try"), [])
        for params in ({"store": "x"}, {"flag": "maybe"}, {"reviewed": "2"}, {"month": "2026-13"}, {"outcome": "x"}, {"entry": "sip"},
                       {"before": "1-2"}):
            with self.subTest(params=params):
                self.error(self.get(self.operator, "/admin/voice/quality/calls", **params), 400, "invalid_input")

    def test_reviews_move_calls_out_of_the_open_lists(self):
        path = "/admin/voice/quality/calls/%s/review" % self.flagged
        body = self.ok(self.post(self.operator, path, {"score": 2, "labels": ["slow", "wrong_answer"], "note": "價格題答錯；回應 p95 偏高",
                                                       "status": "done"}))
        self.assertTrue(body["changed"])
        self.assertEqual({k: body["review"][k] for k in ("score", "labels", "status", "note")},
                         {"score": 2, "labels": ["wrong_answer", "slow"], "status": "done", "note": "價格題答錯；回應 p95 偏高"})
        self.assertEqual(body["review"]["reviewer"]["email"], "admin@example.test")
        self.assertEqual(self.audit_details("admin.voice_call_reviewed"),
                         [{"score": 2, "labels": ["wrong_answer", "slow"], "status": "done", "noteChars": 15,
                           "changed": ["score", "labels", "note", "status"]}])
        self.assertNotIn("價格題", json.dumps([e["details"] for e in self.audit("admin.voice_call_reviewed")]))
        same = self.ok(self.post(self.operator, path, {"score": 2, "labels": ["wrong_answer", "slow"], "note": "價格題答錯；回應 p95 偏高",
                                                       "status": "done"}))
        self.assertFalse(same["changed"])
        self.assertEqual(len(self.audit("admin.voice_call_reviewed")), 1)
        self.assertEqual(self.ids(), [self.auto])
        self.assertEqual(self.ids(reviewed="1"), [self.flagged])
        self.assertEqual(self.ok(self.get(self.operator, "/admin/voice/quality/calls"))["counts"], {"storeFlaggedOpen": 0, "autoFlaggedOpen": 1})
        # The store sees "reviewed", not the score or the note.
        flag = self.ok(self.get(self.owner, "/me/voice/calls/" + self.flagged))["flag"]
        self.assertTrue(flag["reviewed"])
        self.assertNotIn("價格題", json.dumps(self.ok(self.get(self.owner, "/me/voice/calls/" + self.flagged))))
        reopened = self.ok(self.post(self.operator, path, {"score": 2, "labels": ["slow", "wrong_answer"], "note": "價格題答錯；回應 p95 偏高",
                                                           "status": "open"}))
        self.assertTrue(reopened["changed"])
        self.assertEqual(self.audit_details("admin.voice_call_reviewed")[-1]["changed"], ["status"])
        self.assertEqual(len(rows(self.store, "voice_call_reviews")), 1)

    def test_invalid_reviews_change_nothing(self):
        path = "/admin/voice/quality/calls/%s/review" % self.flagged
        valid = {"score": 3, "status": "open"}
        for changes, code in (({"score": 6}, "invalid_input"), ({"score": 0}, "invalid_input"), ({"score": True}, "invalid_input"),
                              ({"score": "3"}, "invalid_input"), ({"score": None}, "invalid_input"), ({"status": "closed"}, "invalid_input"),
                              ({"status": None}, "invalid_input"), ({"labels": ["slow", "slow"]}, "invalid_input"),
                              ({"labels": ["rude"]}, "invalid_input"), ({"labels": list(vc.REVIEW_LABELS[:7])}, "invalid_input"),
                              ({"labels": "slow"}, "invalid_input"), ({"note": "x" * 501}, "invalid_input"),
                              ({"note": "客人電話 02-2700-1001"}, "note_contains_number")):
            with self.subTest(changes=changes):
                self.error(self.post(self.operator, path, dict(valid, **changes)), 400, code)
        self.error(self.post(self.operator, "/admin/voice/quality/calls/%s/review" % OTHER_ID, valid), 404, "call_not_found")
        self.assertEqual(rows(self.store, "voice_call_reviews"), [])
        self.ok(self.post(self.operator, path, dict(valid, labels=list(vc.REVIEW_LABELS[:6]), note="多行\n備註" + "x" * 493)))

    def test_detail_has_facts_sources_and_retention_but_no_report_text(self):
        now = int(time.time())
        row_id = self.new_call(orchestrator(now), records(now, message={"outcome": "message", "speech_ms": 12300, "recording_ms": 15000,
                                                                        "recording_saved": True}))
        body = self.ok(self.get(self.operator, "/admin/voice/quality/calls/" + row_id))
        self.assertEqual(set(body), {"call", "content", "sources"})
        call = body["call"]
        self.assertEqual(set(call), QUALITY_ITEM_KEYS | QUALITY_DETAIL_EXTRA)
        self.assertEqual((call["aiAnswered"], call["aiSpeechSeconds"], call["callSpeechSeconds"], call["turns"], call["meterRule"]),
                         (True, round(41.25, 1), round(53.55, 1), 6, "q5-draft-1"))
        self.assertEqual(call["message"], {"outcome": "message", "final": True, "speechSeconds": 12.3, "recordingSeconds": 15.0,
                                           "callbackConfirmed": False, "callbackVia": None, "recordingSaved": True, "recordingDeclined": False})
        self.assertEqual(call["metrics"], AI["metrics"])
        self.assertEqual(set(call["retention"]), {"snapshotDays", "reportedDays", "transcriptUntil", "recordingUntil", "detailUntil"})
        row = self.row(row_id)
        self.assertEqual(body["sources"], {"orchestrator": {"receivedAt": vc.iso(row["report_orchestrator_at"]), "sha256": row["report_orchestrator_sha256"]},
                                           "records": {"receivedAt": vc.iso(row["report_records_at"]), "sha256": row["report_records_sha256"]}})
        self.assertNotIn("report_", json.dumps(body))
        self.error(self.get(self.operator, "/admin/voice/quality/calls/" + OTHER_ID), 404, "call_not_found")
        self.error(self.get(self.operator, "/admin/voice/quality/calls/xyz"), 404, "call_not_found")

    def test_retention_snapshot_store_change_and_mismatch(self):
        with self.store.connect() as con:
            vs.update_store(con, self.store_id, {"retention_days": 30})
        now = int(time.time())
        row_id = self.new_call(orchestrator(now, retention_days=30))
        retention = self.ok(self.get(self.operator, "/admin/voice/quality/calls/" + row_id))["call"]["retention"]
        self.assertEqual((retention["snapshotDays"], retention["reportedDays"]), (30, 30))
        before = vc.parse_time(retention["recordingUntil"].replace("Z", "+00:00")).timestamp()
        with self.store.connect() as con:
            vs.update_store(con, self.store_id, {"retention_days": 14})
        retention = self.ok(self.get(self.operator, "/admin/voice/quality/calls/" + row_id))["call"]["retention"]
        after = vc.parse_time(retention["recordingUntil"].replace("Z", "+00:00")).timestamp()
        self.assertEqual(before - after, 16 * 86400)
        self.assertNotIn("retention_mismatch", json.loads(self.row(row_id)["auto_flags"]))
        # The records sender still applied 30 days: merged now, the row is flagged.
        self.assertEqual(self.ok(self.report(records(now, call_id=self.row(row_id)["call_id"], retention_days=30)))["result"], "merged")
        self.assertIn("retention_mismatch", json.loads(self.row(row_id)["auto_flags"]))


# ---------------------------------------------------------------- A13-A16


class ListeningTests(CallRoutesCase):
    def setUp(self):
        super().setUp()
        self.operator = self.admin()
        self.base = "/admin/voice/quality/listening"

    def test_create_list_update_delete(self):
        created = self.ok(self.post(self.operator, self.base, LISTENING_BODY), 201)["log"]
        self.assertEqual(set(created), {"id", "title", "kind", "heldOn", "sampleCount", "raterCount", "passed", "summary", "reportRef",
                                        "createdBy", "createdAt", "updatedAt"})
        self.assertEqual(created["createdBy"]["email"], "admin@example.test")
        second = self.ok(self.post(self.operator, self.base, dict(LISTENING_BODY, title="A3 抽樣", kind="call_sample", heldOn="2026-11-01",
                                                                  passed=None, summary="", reportRef="")), 201)["log"]
        self.assertEqual([log["id"] for log in self.ok(self.get(self.operator, self.base))["logs"]], [second["id"], created["id"]])
        path = self.base + "/" + created["id"]
        self.assertFalse(self.ok(self.post(self.operator, path, LISTENING_BODY))["changed"])
        updated = self.ok(self.post(self.operator, path, dict(LISTENING_BODY, passed=False)))
        self.assertEqual((updated["changed"], updated["log"]["passed"]), (True, False))
        self.assertEqual(self.ok(self.delete(self.operator, path)), {"ok": True})
        self.error(self.delete(self.operator, path), 404, "listening_not_found")
        self.error(self.post(self.operator, path, LISTENING_BODY), 404, "listening_not_found")
        self.assertEqual([a["action"] for a in rows(self.store, "audit_events") if a["action"].startswith("admin.voice_listening")],
                         ["admin.voice_listening_created", "admin.voice_listening_created", "admin.voice_listening_updated",
                          "admin.voice_listening_deleted"])
        self.assertEqual(self.audit_details("admin.voice_listening_updated"), [{"kind": "tts_voice", "sampleCount": 20, "raterCount": 3, "passed": False}])
        self.assertNotIn("三位評分人", json.dumps([a["details"] for a in rows(self.store, "audit_events")]))

    def test_invalid_entries(self):
        cases = [({"title": ""}, "invalid_input"), ({"title": "x" * 61}, "invalid_input"), ({"kind": "music"}, "invalid_input"),
                 ({"heldOn": "2026-02-30"}, "invalid_input"), ({"heldOn": "1999-12-31"}, "invalid_input"),
                 ({"sampleCount": 0}, "invalid_input"), ({"sampleCount": 10001}, "invalid_input"), ({"raterCount": 51}, "invalid_input"),
                 ({"raterCount": True}, "invalid_input"), ({"passed": "yes"}, "invalid_input"), ({"summary": "x" * 1001}, "invalid_input"),
                 ({"reportRef": "x" * 201}, "invalid_input"), ({"summary": "請回電 0912345678"}, "note_contains_number")]
        for changes, code in cases:
            with self.subTest(changes=changes):
                self.error(self.post(self.operator, self.base, dict(LISTENING_BODY, **changes)), 400, code)
        for key in LISTENING_BODY:
            with self.subTest(missing=key):
                self.error(self.post(self.operator, self.base, {k: v for k, v in LISTENING_BODY.items() if k != key}), 400, "invalid_input")
        self.assertEqual(rows(self.store, "voice_listening_logs"), [])

    def test_500_entries_at_most(self):
        admin_id = self.user_id("admin@example.test")
        with self.store.connect() as con:
            for index in range(500):
                con.execute("INSERT INTO voice_listening_logs (id,title,kind,held_on,sample_count,rater_count,created_by,created_at,updated_at) "
                            "VALUES (?,?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, "t%d" % index, "other", "2026-10-22", 1, 1, admin_id, 1, 1))
        self.error(self.post(self.operator, self.base, LISTENING_BODY), 409, "listening_limit")
        self.assertEqual(len(rows(self.store, "voice_listening_logs")), 500)
        self.assertEqual(len(self.ok(self.get(self.operator, self.base))["logs"]), 500)


# ---------------------------------------------------------------- phase 1 A7, A8 (§4.4)


class NumberInUseTests(CallRoutesCase):
    def number(self, operator, number):
        return next(n for n in self.ok(self.get(operator, "/admin/voice/numbers"))["numbers"] if n["number"] == number)

    def test_a_number_with_calls_keeps_its_attribution(self):
        operator = self.admin()
        self.new_call()
        used = self.number(operator, CUSTOMER_NUMBER)
        path = "/admin/voice/numbers/" + used["id"]
        self.error(self.delete(operator, path), 409, "number_in_use")
        self.assertEqual(self.number(operator, CUSTOMER_NUMBER)["id"], used["id"])
        body = {key: used[key] for key in ("number", "storeId", "purpose", "channel", "activeFrom", "activeUntil", "note")}
        for changes in ({"storeId": self.other_store}, {"purpose": "test"}, {"channel": "online"}, {"number": "+886227001055"},
                        {"activeFrom": "2026-01-01"}):
            with self.subTest(changes=changes):
                self.error(self.post(operator, path, dict(body, **changes)), 409, "number_in_use")
        self.assertEqual(self.number(operator, CUSTOMER_NUMBER), used)
        until = vs.taipei_date(int(time.time()) + 30 * 86400)
        changed = self.ok(self.post(operator, path, dict(body, activeUntil=until, note="換店前")))["number"]
        self.assertEqual((changed["activeUntil"], changed["note"]), (until, "換店前"))
        # A number no call refers to is still deleted for real.
        unused = self.number(operator, OTHER_NUMBER)
        self.assertEqual(self.ok(self.delete(operator, "/admin/voice/numbers/" + unused["id"])), {"ok": True})


if __name__ == "__main__":
    unittest.main()
