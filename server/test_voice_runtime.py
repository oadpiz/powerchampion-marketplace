"""Runtime routes R1 and R2 (server/voice_runtime.py, server/voice_calls.py; phase2-contract.md §1.1, §3, §14).

Runs on SQLite, or on Postgres when PC_PORTAL_TEST_DATABASE_URL is set (scripts/test_backend_postgres.sh)."""
import asyncio
import hashlib
import json
import tempfile
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest import mock

import httpx

from server import voice_calls as vc
from server import voice_runtime as vr
from server import voice_store as vs
from server.settings import Settings
from server.testsupport import BASE, ORIGIN, PASSWORD, FakeGateway, PortalCase, database_text, fresh_database, rows

TAIPEI = timezone(timedelta(hours=8))
# Test-only values from the contract (§1.7); they are not secrets anywhere.
TOKEN = "test-only-runtime-token-0000000000"
MEDIA_SECRET = "test-only-not-a-secret-0000000000"
MEDIA_URL = "https://media.example.test"
CFG_SHA = "ca72ecf4f178bc632cbbacef22d5da71983b2744d0d7e3579722e201c1b6adfd"
VECTOR_STORE = "0123456789abcdef0123456789abcdef"
NOT_FOUND = {"error": "not_found", "detail": "This portal endpoint is not available for this request."}
CUSTOMER_NUMBER = "+886227001001"
TEST_NUMBER = "+886227001002"
AI = {"answered": True, "speech_ms": 41250, "turns": 6, "handoff": None, "auto_flags": [], "degraded": None,
      "metrics": {"reply_p50_ms": 1480, "reply_p95_ms": 1910, "barge_ins": 1, "fillers": 0, "talk_overs": 0, "no_responses": 0}}
ZERO = dict(vc.ZERO_MESSAGE)


def at(epoch_seconds):
    return datetime.fromtimestamp(epoch_seconds, TAIPEI).isoformat()


def orchestrator(now=None, call_id="1797815702.118", started=None, **changes):
    """A valid orchestrator report (vector V3's call, moved to now): AI answered, 41.25 s of caller speech."""
    now = int(time.time()) if now is None else now
    started = now - 200 if started is None else started
    body = {"schema": "voice.call-report/v1", "source": "orchestrator", "call_id": call_id, "entry": "pstn",
            "dialed": "0227001001", "store_id": None, "started_at": at(started), "answered_at": at(started + 1),
            "ended_at": at(started + 159), "sent_at": at(now), "disposition": "ANSWERED", "caller_tail": "678",
            "caller_kind": "mobile", "config": None, "disclosure_version": "draft-0", "ai": json.loads(json.dumps(AI)),
            "message": dict(ZERO), "message_final": None, "fallback": False, "content_expected": True, "retention_days": 90}
    body.update(changes)
    return body


def records(now=None, final=True, message=None, call_id="1797815702.118", started=None, **changes):
    """A valid records-sender report of the same call: final (A3 done) or pending (message all zero)."""
    now = int(time.time()) if now is None else now
    started = now - 200 if started is None else started
    body = orchestrator(now, call_id=call_id, started=started, source="records", answered_at=at(started), config=None, ai=None,
                        message=dict(ZERO, **(message or {})), message_final=final)
    body.update(changes)
    return body


class VoiceCallsCase(PortalCase):
    """PortalCase with the phone agent on, a runtime token and a media URL and secret; holds no tests."""
    voice = {"voice_enabled": True, "voice_runtime_token": TOKEN, "voice_media_url": MEDIA_URL, "voice_media_secret": MEDIA_SECRET,
             "voice_a6_rc_version": "4"}

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,), **self.voice)
        self.gateway = FakeGateway()
        from server.app import create_app

        self.app = create_app(self.settings, gateway=self.gateway)
        self.store = self.app.state.store
        self.clients = []
        self.runtime_client = self.client()

    def use_settings(self, **changes):
        """Continue on a new app over the same database with other settings (what a restart with new env does)."""
        import dataclasses

        from server.app import create_app

        self.settings = dataclasses.replace(self.settings, **changes)
        self.app = create_app(self.settings, gateway=self.gateway)
        self.store = self.app.state.store
        self.runtime_client = self.client()

    # ---------------------------------------------------------------- seeding

    def seed_store(self, email="owner@clinic.example", *, status="testing", ai=False, retention=90, publish=True, store_id=None):
        """A store owner (signed in with PASSWORD) and their store; returns (client, store id)."""
        user = self.store.create_user(email, "Owner", PASSWORD)
        with self.store.connect() as con:
            if store_id is None:
                store_id = vs.create_store(con, user["id"], "晴光牙醫診所", "clinic")["id"]
            else:
                now = int(time.time())
                con.execute("INSERT INTO voice_stores (id,owner_user_id,name,industry,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                            (store_id, user["id"], "晴光牙醫診所", "clinic", now, now))
            vs.update_store(con, store_id, {"status": status, "ai_answer_enabled": ai, "retention_days": retention})
            if publish:
                vs.add_config_version(con, store_id, {"schema": "voice.store-config/v1", "store_id": store_id, "version": 1}, user["id"])
        client = self.client()
        self.assertEqual(self.post(client, "/auth/login", {"email": email, "password": PASSWORD}).status_code, 200)
        return client, store_id

    def seed(self):
        """A testing store with a published version and the customer number pointing at it."""
        client, store_id = self.seed_store()
        self.seed_number(store_id=store_id)
        return client, store_id

    def seed_number(self, number=CUSTOMER_NUMBER, store_id=None, purpose="customer", channel="pstn", days_ago=10, until=None):
        # Periods start at 00:00 Taipei, as A6 writes them.
        start = vs.taipei_day_start(vs.taipei_date(int(time.time()) - days_ago * 86400))
        with self.store.connect() as con:
            return vs.add_number(con, number, store_id, purpose, channel, start, until)["id"]

    # ---------------------------------------------------------------- calls

    def headers(self, token=TOKEN, **extra):
        headers = {"Origin": ORIGIN}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        headers.update(extra)
        return headers

    def config(self, number="0227001001", token=TOKEN, **extra):
        params = {} if number is None else {"number": number}
        params.update(extra.pop("params", {}))
        return self.runtime_client.get(BASE + "/voice/runtime/config", params=params, headers=self.headers(token, **extra))

    def report(self, body, token=TOKEN, **extra):
        return self.runtime_client.post(BASE + "/voice/runtime/calls", json=body, headers=self.headers(token, **extra))

    def ok(self, response, status=200):
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def error(self, response, status, code):
        self.assertEqual((response.status_code, response.json().get("error")), (status, code), response.text)
        self.assertEqual(set(response.json()), {"error", "detail"})
        return response.json()["detail"]

    def calls(self):
        return rows(self.store, "voice_calls")

    def call(self, call_id="1797815702.118"):
        found = [row for row in self.calls() if row["call_id"] == call_id]
        self.assertEqual(len(found), 1, call_id)
        return found[0]


class GateTests(VoiceCallsCase):
    def test_switch_off_is_a_plain_404_even_with_the_right_token(self):
        self.use_settings(voice_enabled=False)
        for response in (self.config(), self.report(orchestrator())):
            self.assertEqual((response.status_code, response.json()), (404, NOT_FOUND))
        self.assertEqual(self.calls(), [])
        # Control: switched on, the same requests are no longer 404.
        self.use_settings(voice_enabled=True)
        self.seed()
        self.assertEqual(self.config().status_code, 200)
        self.assertEqual(self.report(orchestrator()).status_code, 201)

    def test_no_token_configured_is_503_for_every_request(self):
        for configured in ("", TOKEN[:31], " " * 40, " " + TOKEN[:31] + " "):
            self.use_settings(voice_runtime_token=configured)
            for token in (TOKEN, configured.strip() or None):
                with self.subTest(configured=repr(configured), token=token):
                    self.error(self.config(token=token), 503, "voice_runtime_unconfigured")
                    self.error(self.report(orchestrator(), token=token), 503, "voice_runtime_unconfigured")
        self.assertEqual(self.calls(), [])

    def test_wrong_token_is_401_and_never_reaches_the_database(self):
        # V1: a token compared as sha256 digests; spaces around the configured value do not count.
        with mock.patch.object(vc, "runtime_config", side_effect=AssertionError("read")), \
                mock.patch.object(vc, "parse_report", side_effect=AssertionError("read")):
            for header in ("Bearer " + TOKEN[:-1] + "1", TOKEN, "Bearer " + TOKEN[:31], "bearer " + TOKEN, "Bearer  " + TOKEN,
                           "Bearer " + TOKEN + " ", "Basic " + TOKEN, "Bearer " + "x" * 257, ""):
                with self.subTest(header=header):
                    for response in (self.runtime_client.get(BASE + "/voice/runtime/config?number=0227001001", headers={"Authorization": header}),
                                     self.runtime_client.post(BASE + "/voice/runtime/calls", json=orchestrator(),
                                                              headers={"Origin": ORIGIN, "Authorization": header})):
                        self.error(response, 401, "runtime_auth")
        self.use_settings(voice_runtime_token=TOKEN + "\n")
        self.seed()
        self.assertEqual(self.config().status_code, 200)

    def test_runtime_routes_ignore_cookies_and_set_none(self):
        self.seed()
        signed_in = self.client()
        self.store.create_user("ops@example.test", "Ops", PASSWORD, role="admin")
        self.post(signed_in, "/auth/login", {"email": "ops@example.test", "password": PASSWORD})
        # An admin session does not replace the token.
        self.error(signed_in.get(BASE + "/voice/runtime/config?number=0227001001"), 401, "runtime_auth")
        response = signed_in.get(BASE + "/voice/runtime/config?number=0227001001", headers={"Authorization": "Bearer " + TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("set-cookie", response.headers)
        before = len(rows(self.store, "audit_events"))
        self.ok(self.report(orchestrator()), 201)
        self.assertEqual(len(rows(self.store, "audit_events")), before)  # runtime reports are not audited

    def test_forwarded_addresses_change_nothing(self):
        self.seed()
        for extra in ({"X-Forwarded-For": "203.0.113.9"}, {"CF-Connecting-IP": "198.51.100.7"}, {}):
            with self.subTest(extra=extra):
                self.assertEqual(self.config(**extra).status_code, 200)
                self.error(self.config(token=TOKEN[:-1] + "1", **extra), 401, "runtime_auth")

    def test_deeply_nested_json_is_a_400_not_a_500(self):
        # support.body_json: 30,000 levels fit in a 64 KiB body and exhaust the JSON parser's stack (RecursionError).
        deep = '{"a":' + "[" * 30000 + "]" * 30000 + "}"
        response = self.runtime_client.post(BASE + "/auth/register", content=deep,
                                            headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.error(response, 400, "invalid_input")

    def test_window_resets_after_60_seconds(self):
        clock = [1000.0]
        limits = self.app.state.voice_runtime_limits
        for limiter in limits.values():
            limiter.clock = lambda: clock[0]
        limits["config"].limit = 2
        self.seed()
        self.assertEqual([self.config().status_code for _ in range(3)], [200, 200, 429])
        self.error(self.config(), 429, "rate_limited")
        clock[0] += 60
        self.assertEqual(self.config().status_code, 200)


class ConcurrencyLimitTests(VoiceCallsCase):
    """§3.6: checked and reserved before the first await, so concurrent requests cannot all pass."""

    def burst(self, count, token):
        async def run():
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport, base_url=ORIGIN) as client:
                return await asyncio.gather(*[client.get(BASE + "/voice/runtime/config", params={"number": "0227001001"},
                                                         headers={"Authorization": "Bearer " + token,
                                                                  "X-Forwarded-For": "203.0.113.%d" % (i % 250)})
                                              for i in range(count)])
        return sorted(response.status_code for response in asyncio.run(run()))

    def test_1200_concurrent_config_requests_get_exactly_600(self):
        self.seed()
        statuses = self.burst(1200, TOKEN)
        self.assertEqual((statuses.count(200), statuses.count(429)), (600, 600))

    def test_120_concurrent_wrong_tokens_get_60_401_and_the_right_token_still_works(self):
        self.seed()
        statuses = self.burst(120, TOKEN[:-1] + "1")
        self.assertEqual((statuses.count(401), statuses.count(429)), (60, 60))
        self.assertEqual(self.config().status_code, 200)


class ConfigTests(VoiceCallsCase):
    def vector_store(self):
        """Vector V5's store: 0123...cdef, testing, message_only, 90 days, version 1 with the phase 1 config sha."""
        self.seed_store(store_id=VECTOR_STORE, publish=False)
        with self.store.connect() as con:
            con.execute("INSERT INTO voice_config_versions (store_id,version,config_json,config_sha256,created_at) VALUES (?,?,?,?,?)",
                        (VECTOR_STORE, 1, '{"schema":"voice.store-config/v1","version":1}', CFG_SHA, 1))
            con.execute("UPDATE voice_stores SET current_version=1 WHERE id=?", (VECTOR_STORE,))
        self.seed_number(store_id=VECTOR_STORE)

    def test_vector_v5_state_etag_304_and_have(self):
        self.vector_store()
        response = self.config()
        body = self.ok(response)
        state = "09320efdc7e7ce045273ffa3470cf7596ce48bdd36adf655b860687c276e4cd5"
        self.assertEqual(body["state_sha256"], state)
        self.assertEqual(response.headers["etag"], '"%s"' % state)
        self.assertEqual(response.headers["cache-control"], "no-store, max-age=0")
        self.assertEqual(set(body), {"schema", "number", "store", "answer_mode", "config_version", "config_sha256", "config",
                                     "state_sha256", "served_at", "max_age_seconds"})
        self.assertEqual((body["schema"], body["answer_mode"], body["config_version"], body["config_sha256"], body["max_age_seconds"]),
                         ("voice.runtime-config/v1", "message_only", 1, CFG_SHA, 60))
        self.assertEqual(body["number"], {"number": CUSTOMER_NUMBER, "purpose": "customer", "channel": "pstn", "store_id": VECTOR_STORE})
        self.assertEqual(body["store"], {"id": VECTOR_STORE, "status": "testing", "ai_answer_enabled": False,
                                         "recording_mode": "message_only", "retention_days": 90})
        self.assertEqual(body["config"], {"schema": "voice.store-config/v1", "version": 1})
        # Unchanged: 304 without a body, or 200 without the config.
        cached = self.config(**{"If-None-Match": '"%s"' % state})
        self.assertEqual((cached.status_code, cached.content, cached.headers["etag"]), (304, b"", '"%s"' % state))
        light = self.ok(self.config(params={"have": state}))
        self.assertNotIn("config", light)
        self.assertEqual((light["unchanged"], light["state_sha256"]), (True, state))
        # An operator turns AI answering on (no route yet, §13 item 9): the old ETag is no longer current.
        with self.store.connect() as con:
            con.execute("UPDATE voice_stores SET ai_answer_enabled=1 WHERE id=?", (VECTOR_STORE,))
        after = self.config(**{"If-None-Match": '"%s"' % state})
        body = self.ok(after)
        self.assertEqual((body["answer_mode"], body["state_sha256"]),
                         ("ai", "28fafb0e8bd6e5da2cdc999567efafc84d805b982f7825993b9a8927e19f4ada"))
        self.assertIn("config", self.ok(self.config(params={"have": state})))

    def test_ai_answers_need_the_a6_rc_version(self):
        # Fix round (phase2-contract §15): until A6 meters AI-answered calls (PC_VOICE_A6_RC_VERSION >= 4), R1 never
        # says "ai", whatever the store's own switch is; the store's fields still tell the truth.
        self.vector_store()
        with self.store.connect() as con:
            con.execute("UPDATE voice_stores SET ai_answer_enabled=1 WHERE id=?", (VECTOR_STORE,))
        ai = self.ok(self.config())
        self.assertEqual((ai["answer_mode"], ai["state_sha256"]), ("ai", "28fafb0e8bd6e5da2cdc999567efafc84d805b982f7825993b9a8927e19f4ada"))
        for version in ("", "3", "0", "v4", "4.1", "four", "40000"):
            with self.subTest(version=version):
                self.use_settings(voice_a6_rc_version=version)
                response = self.config(**{"If-None-Match": '"%s"' % ai["state_sha256"]})
                body = self.ok(response)  # 200, not 304: the AI answer the orchestrator cached is no longer current
                self.assertEqual((body["answer_mode"], body["store"]["ai_answer_enabled"], body["store"]["status"], body["config_version"]),
                                 ("message_only", True, "testing", 1))
                # V5's state with ai_answer_enabled true and answer_mode message_only: a third state, not the AI one.
                self.assertEqual(body["state_sha256"], "f43dfa7059d2228e6c7bee65bed75776fba2a4cb4d68c6f99f57ba83338271dc")
                self.assertNotEqual(body["state_sha256"], ai["state_sha256"])
                self.assertIn("config", body)
                self.assertEqual(self.ok(self.config(params={"have": body["state_sha256"]}))["unchanged"], True)
        for version in ("4", "5", " 4 "):
            with self.subTest(version=version):
                self.use_settings(voice_a6_rc_version=version)
                body = self.ok(self.config())
                self.assertEqual((body["answer_mode"], body["state_sha256"]), (ai["answer_mode"], ai["state_sha256"]))
        # A store that does not want AI stays message_only whatever the version.
        with self.store.connect() as con:
            con.execute("UPDATE voice_stores SET ai_answer_enabled=0 WHERE id=?", (VECTOR_STORE,))
        self.assertEqual(self.ok(self.config())["answer_mode"], "message_only")

    def test_number_forms_v2(self):
        _, store_id = self.seed_store()
        self.seed_number(store_id=store_id)
        self.seed_number("ext-6201", store_id=store_id, purpose="test", channel="online")
        for number in ("0227001001", CUSTOMER_NUMBER, "ext:6201", "ext-6201"):
            with self.subTest(number=number):
                self.assertEqual(self.ok(self.config(number))["store"]["id"], store_id)
        for number in ("886227001001", "02-2700-1001", "ext-62011", "02 2700 1001", "", None):
            with self.subTest(number=number):
                self.error(self.config(number), 400, "invalid_number")
        # An unencoded "+" in a query string is a space.
        self.error(self.runtime_client.get(BASE + "/voice/runtime/config?number=+886227001001", headers=self.headers()), 400, "invalid_number")
        for have in ("x" * 64, "A" * 64, "a" * 63, ""):
            with self.subTest(have=have):
                self.error(self.config(params={"have": have}), 400, "invalid_input")

    def test_missing_unassigned_and_ended_numbers(self):
        _, store_id = self.seed_store()
        self.error(self.config(), 404, "number_not_found")
        self.seed_number(store_id=None)
        self.error(self.config(), 404, "number_unassigned")
        self.seed_number("+886227001003", store_id=store_id, days_ago=10, until=int(time.time()) - 86400)
        self.error(self.config("0227001003"), 404, "number_not_found")
        self.seed_number("+886227001004", store_id=store_id, days_ago=-1)  # starts tomorrow
        self.error(self.config("0227001004"), 404, "number_not_found")

    def test_answer_mode(self):
        cases = [("draft", True, True, "message_only"), ("suspended", True, True, "message_only"),
                 ("testing", True, False, "message_only"), ("testing", False, True, "message_only"),
                 ("testing", True, True, "ai"), ("live", True, True, "ai")]
        for index, (status, ai, publish, mode) in enumerate(cases):
            with self.subTest(status=status, ai=ai, publish=publish):
                _, store_id = self.seed_store("owner%d@example.test" % index, status=status, ai=ai, publish=publish)
                self.seed_number("+88622700200%d" % index, store_id=store_id)
                body = self.ok(self.config("+88622700200%d" % index))
                self.assertEqual(body["answer_mode"], mode)
                if not publish:
                    self.assertEqual((body["config_version"], body["config_sha256"], body["config"]), (None, None, None))


class ReportTests(VoiceCallsCase):
    def setUp(self):
        super().setUp()
        self.owner, self.store_id = self.seed_store()
        self.number_id = self.seed_number(store_id=self.store_id)

    def summary(self):
        return self.ok(self.owner.get(BASE + "/me/voice/calls"))["summary"]

    def test_vector_call_is_created_once_and_metered_once(self):
        self.assertEqual((self.summary()["total"], self.summary()["meterUnits"]), (0, 0))
        body = orchestrator()
        created = self.ok(self.report(body), 201)
        row = self.call()
        self.assertEqual(created, {"result": "created", "id": row["id"], "call_id": "1797815702.118", "outcome": "answered",
                                   "meter_units": 1, "meter_reason": "ai_speech", "store_id": self.store_id, "flags": []})
        # The store's page holds the call once the records sender has reported it (fix round), not before.
        self.assertEqual((self.summary()["total"], self.summary()["meterUnits"]), (0, 0))
        self.assertEqual((row["dialed"], row["number_id"], row["number_purpose"], row["duration_s"], row["caller_tail"]),
                         (CUSTOMER_NUMBER, self.number_id, "customer", 159, "678"))
        self.assertEqual(row["report_orchestrator_sha256"], vc.part_sha256(body))
        self.assertNotIn("sent_at", json.loads(row["report_orchestrator"]))
        # A resend with a new sent_at is a duplicate: asserted first, so "still 1" is not what an ignored request shows.
        again = self.ok(self.report(dict(body, sent_at=at(int(time.time())))))
        self.assertEqual(again["result"], "duplicate")
        self.assertEqual(self.call(), row)
        self.assertEqual(self.ok(self.report(records()))["result"], "merged")
        self.assertEqual((self.summary()["total"], self.summary()["meterUnits"]), (1, 1))
        self.assertEqual(self.ok(self.report(dict(body, sent_at=at(int(time.time())))))["result"], "duplicate")
        self.assertEqual((self.summary()["total"], self.summary()["meterUnits"]), (1, 1))

    def test_other_content_with_the_same_call_id_is_409_and_changes_nothing(self):
        body = orchestrator()
        self.ok(self.report(body), 201)
        row = self.call()
        changed = json.loads(json.dumps(body))
        changed["ai"]["speech_ms"] += 1
        detail = self.error(self.report(changed), 409, "call_conflict")
        self.assertIn(vc.part_sha256(body)[:8], detail)
        self.assertIn(vc.part_sha256(changed)[:8], detail)
        self.assertEqual(self.calls(), [row])

    def comparable(self, row):
        return {key: value for key, value in row.items()
                if key not in ("id", "received_at", "updated_at", "report_orchestrator_at", "report_records_at")}

    def test_two_sources_merge_to_the_same_row_in_either_order(self):
        now = int(time.time())
        orch = orchestrator(now)
        rec = records(now, message={"outcome": "message", "speech_ms": 12300, "recording_ms": 15000, "recording_saved": True})
        self.ok(self.report(orch), 201)
        first = self.call()
        self.assertEqual((first["outcome"], first["message_outcome"], first["message_final"]), ("answered", "none", 0))
        merged = self.ok(self.report(rec))
        self.assertEqual(merged["result"], "merged")
        one = self.call()
        self.assertEqual((one["outcome"], one["message_outcome"], one["message_final"], one["has_message"]), ("message", "message", 1, 1))
        self.assertEqual((one["meter_units"], one["meter_reason"], one["mismatch"]), (1, "ai_speech", "[]"))
        # The other order, on another call id: every column the same.
        self.ok(self.report(dict(rec, call_id="1797815702.119")), 201)
        self.assertEqual(self.ok(self.report(dict(orch, call_id="1797815702.119")))["result"], "merged")
        other = self.comparable(self.call("1797815702.119"))
        expected = self.comparable(one)
        for key in ("call_id", "report_orchestrator", "report_records", "report_orchestrator_sha256", "report_records_sha256"):
            other.pop(key), expected.pop(key)
        self.assertEqual(other, expected)
        self.assertEqual(json.loads(self.call("1797815702.119")["report_records"])["call_id"], "1797815702.119")

    def test_records_pending_then_final_then_stale_then_conflict(self):
        now = int(time.time())
        pending = records(now, final=False)
        self.ok(self.report(pending), 201)
        row = self.call()
        self.assertEqual((row["outcome"], row["meter_units"], row["meter_reason"], row["message_final"]), ("unknown", 0, "no_message_record", 0))
        final = records(now, message={"outcome": "message", "speech_ms": 12300, "recording_ms": 15000, "recording_saved": True})
        updated = self.ok(self.report(final))
        self.assertEqual((updated["result"], updated["outcome"], updated["meter_units"]), ("updated", "message", 1))
        row = self.call()
        self.assertEqual((row["outcome"], row["meter_units"], row["meter_reason"], row["message_final"]), ("message", 1, "message", 1))
        self.assertEqual(self.ok(self.report(dict(pending, sent_at=at(now + 1))))["result"], "stale")
        self.assertEqual(self.call(), row)
        self.assertEqual(self.ok(self.report(dict(final, sent_at=at(now + 2))))["result"], "duplicate")
        other = records(now, message={"outcome": "message", "speech_ms": 12301, "recording_ms": 15000, "recording_saved": True})
        self.error(self.report(other), 409, "call_conflict")
        self.error(self.report(dict(final, ended_at=at(now - 42))), 409, "call_conflict")  # a fact changed
        self.assertEqual(self.call(), row)

    def test_pending_cannot_be_replaced_by_another_pending(self):
        pending = records(final=False)
        self.ok(self.report(pending), 201)
        self.error(self.report(dict(pending, caller_tail="679")), 409, "call_conflict")
        self.error(self.report(dict(pending, content_expected=False)), 409, "call_conflict")

    def test_a_number_that_cannot_be_normalized_is_kept(self):
        self.assertEqual(self.calls(), [])
        response = self.ok(self.report(orchestrator(dialed="886227001001")), 201)
        self.assertEqual((response["meter_units"], response["meter_reason"], response["store_id"]), (0, "unknown_line", None))
        self.assertIn("unknown_number", response["flags"])
        row = self.call()
        self.assertEqual((row["dialed"], row["number_id"], row["store_id"], row["number_purpose"], row["retention_days_snapshot"]),
                         ("886227001001", None, None, None, 90))
        # A number not in the table is the same.
        self.assertEqual(self.ok(self.report(orchestrator(call_id="1797815702.120", dialed="0227009999")), 201)["meter_reason"], "unknown_line")

    def test_a_customer_number_without_a_store_is_an_unknown_line(self):
        # One-phase A6 numbers may have no store (R1 answers number_unassigned); A6 refuses such a customer line, so
        # the portal must not count it either (fix round: was 1 unit, store null, no flag).
        self.seed_number("+886227001007", store_id=None)
        self.seed_number("+886227001008", store_id=None, purpose="demo")
        message = {"outcome": "message", "speech_ms": 6000, "recording_ms": 7000, "recording_saved": True}
        created = self.ok(self.report(records(call_id="1797815702.130", dialed="0227001007", message=message)), 201)
        self.assertEqual((created["store_id"], created["meter_units"], created["meter_reason"], created["flags"]),
                         (None, 0, "unknown_line", ["unknown_number"]))
        row = self.call("1797815702.130")
        self.assertEqual((row["number_purpose"], row["outcome"]), ("customer", "message"))
        # A demo line without a store stays what A6 calls it, and is not an unknown number.
        demo = self.ok(self.report(records(call_id="1797815702.131", dialed="0227001008", message=message)), 201)
        self.assertEqual((demo["meter_units"], demo["meter_reason"], demo["flags"]), (0, "non_customer_line", []))
        # Control: the store's own customer number still counts.
        own = self.ok(self.report(records(call_id="1797815702.132", message=message)), 201)
        self.assertEqual((own["store_id"], own["meter_units"], own["meter_reason"]), (self.store_id, 1, "message"))

    def test_an_unknown_mobile_dialed_number_keeps_only_its_last_4_digits(self):
        # A reporter that swapped caller and callee sends the caller's mobile number as dialed (fix round: was stored whole).
        now = int(time.time())
        orch = orchestrator(now, call_id="1797815702.140", dialed="0912345678")
        created = self.ok(self.report(orch), 201)
        self.assertEqual((created["store_id"], created["meter_reason"], created["flags"]), (None, "unknown_line", ["unknown_number"]))
        row = self.call("1797815702.140")
        self.assertEqual(row["dialed"], "******5678")
        self.assertEqual(json.loads(row["report_orchestrator"])["dialed"], "******5678")
        # Fix round: the digest is the hash of the report as KEPT (masked), so it adds nothing to the stored text.
        self.assertEqual(row["report_orchestrator_sha256"], hashlib.sha256(row["report_orchestrator"].encode("utf-8")).hexdigest())
        self.assertNotEqual(row["report_orchestrator_sha256"], vc.part_sha256(orch))
        self.assertEqual(self.ok(self.report(dict(orch, sent_at=at(now + 1))))["result"], "duplicate")
        # The records sender's pending then final report of the same call: still an update, not a conflict.
        pending = records(now, final=False, call_id="1797815702.140", dialed="+886912345678")
        self.assertEqual(self.ok(self.report(pending))["result"], "merged")
        final = records(now, call_id="1797815702.140", dialed="+886912345678", message={"outcome": "message", "speech_ms": 5000})
        self.assertEqual(self.ok(self.report(final))["result"], "updated")
        row = self.call("1797815702.140")
        self.assertEqual((row["dialed"], json.loads(row["report_records"])["dialed"], row["mismatch"]), ("******5678", "******5678", "[]"))
        for form in ("0912345678", "+886912345678", "912345678", "12345678"):
            with self.subTest(form=form):
                self.assertNotIn(form, database_text(self.store))
        # Not a mobile number, or a mobile number that is the store's line: kept as sent.
        self.assertEqual(self.ok(self.report(orchestrator(now, call_id="1797815702.141", dialed="0227009999")), 201)["meter_reason"], "unknown_line")
        self.assertEqual(self.call("1797815702.141")["dialed"], "+886227009999")
        self.seed_number("+886987654321", store_id=self.store_id)
        line = self.ok(self.report(orchestrator(now, call_id="1797815702.142", dialed="0987654321")), 201)
        self.assertEqual((line["store_id"], line["meter_reason"]), (self.store_id, "ai_speech"))
        self.assertEqual(self.call("1797815702.142")["dialed"], "+886987654321")

    def test_the_stored_digest_of_a_masked_number_does_not_give_the_number_back(self):
        # Fix round: report_*_sha256 used to be the hash of the body as SENT, so anyone with the database could try every
        # number that ends in the visible 4 digits against the stored report: 2,469 hashes, 0.03 s, and 0912345678 was back.
        now = int(time.time())
        forms = ("09%04d5678", "8869%04d5678", "+8869%04d5678")  # every way a Taiwan mobile number ending in 5678 is written
        for call_id, sent in (("1797815702.150", orchestrator(now, call_id="1797815702.150", dialed="0912345678")),
                              ("1797815702.151", records(now, call_id="1797815702.151", dialed="+886912345678"))):
            with self.subTest(source=sent["source"]):
                self.ok(self.report(sent), 201)
                row = self.call(call_id)
                stored = json.loads(row["report_" + sent["source"]])
                digest = row["report_%s_sha256" % sent["source"]]
                self.assertEqual(stored["dialed"], "******5678")
                # What a holder of the database does: put each candidate number into the stored report and hash it.
                hashes = {form % n: vc.sha256_hex(dict(stored, dialed=form % n)) for form in forms for n in range(10000)}
                self.assertEqual(len(hashes), 30000)
                self.assertEqual([c for c, h in hashes.items() if h == digest], [], "the stored digest gave the number back")
                self.assertEqual(digest, hashlib.sha256(row["report_" + sent["source"]].encode("utf-8")).hexdigest())
                # The control: the digest 0009 stored (the hash of the sent body) is found by the same search.
                self.assertEqual([c for c, h in hashes.items() if h == vc.part_sha256(sent)], [sent["dialed"]])
        self.assertNotIn(vc.part_sha256(orchestrator(now, call_id="1797815702.150", dialed="0912345678")), database_text(self.store))

    def test_a_resend_is_a_duplicate_whether_or_not_the_number_table_changed_in_between(self):
        now = int(time.time())
        mobile = "0912345678"
        # Kept masked, then the number joins the table (a period that began before the call): the resend is kept whole.
        first = orchestrator(now, call_id="1797815702.160", dialed=mobile)
        self.ok(self.report(first), 201)
        self.assertEqual(self.call("1797815702.160")["dialed"], "******5678")
        self.seed_number("+886912345678", store_id=self.store_id)
        self.assertEqual(self.ok(self.report(dict(first, sent_at=at(now + 1))))["result"], "duplicate")
        self.assertEqual(self.call("1797815702.160")["dialed"], "******5678")
        # Kept whole, then the period ends before the call: the resend is masked and is still the same report.
        second = orchestrator(now, call_id="1797815702.161", dialed=mobile)
        self.ok(self.report(second), 201)
        self.assertEqual(self.call("1797815702.161")["dialed"], "+886912345678")
        with self.store.connect() as con:
            con.execute("UPDATE voice_numbers SET active_to=active_from+1 WHERE number=?", ("+886912345678",))
        self.assertEqual(self.ok(self.report(dict(second, sent_at=at(now + 2))))["result"], "duplicate")
        # Another fact is still a conflict, and the message names digests of kept reports only.
        self.error(self.report(dict(second, caller_tail="679")), 409, "call_conflict")

    def test_reports_that_differ_only_in_the_hidden_digits_are_the_same_stored_report(self):
        # The hidden digits are not kept, so two reports that differ only there cannot be told apart afterwards.
        now = int(time.time())
        one = orchestrator(now, call_id="1797815702.170", dialed="0912345678")
        self.ok(self.report(one), 201)
        stored = self.call("1797815702.170")["report_orchestrator"]
        self.assertEqual(self.ok(self.report(dict(one, dialed="0922225678")))["result"], "duplicate")
        self.assertEqual(self.call("1797815702.170")["report_orchestrator"], stored)
        self.error(self.report(dict(one, dialed="0912345679")), 409, "call_conflict")

    def test_ended_at_is_compared_one_way_with_10_seconds_of_tolerance(self):
        now = int(time.time())
        rec = records(now)
        # Handed back to the edge host for a message: the AI part ended 71 s before the hang-up.
        self.ok(self.report(orchestrator(now, ended_at=at(now - 200 + 159 - 71))), 201)
        self.ok(self.report(rec))
        self.assertEqual(self.call()["mismatch"], "[]")
        self.ok(self.report(orchestrator(now, call_id="1797815702.121", ended_at=at(now - 200 + 159 + 11))), 201)
        self.ok(self.report(records(now, call_id="1797815702.121")))
        row = self.call("1797815702.121")
        self.assertEqual(json.loads(row["mismatch"]), ["ended_at"])
        self.assertIn("source_mismatch", json.loads(row["auto_flags"]))

    def test_started_at_and_ai_values_are_compared(self):
        now = int(time.time())
        self.ok(self.report(orchestrator(now, started=now - 189, ended_at=at(now - 189 + 140))), 201)  # 11 s late
        self.ok(self.report(records(now, message={"ai_answered": True, "ai_speech_ms": 41000})))
        row = self.call()
        self.assertEqual(json.loads(row["mismatch"]), ["started_at", "ai_speech_ms"])
        self.assertEqual(row["started_at"], now - 200)  # the records sender's time wins
        self.assertEqual(row["ai_speech_ms"], 41250)  # the orchestrator's value wins

    def test_unknown_and_missing_fields_are_refused(self):
        body = orchestrator()
        for changed, detail in ((dict(body, transcript="客人說…"), "unknown field: transcript"),
                                (dict(body, caller="0912345678"), "unknown field: caller"),
                                ({k: v for k, v in body.items() if k != "ai"}, "missing field: ai"),
                                (dict(body, ai=dict(AI, summary="…")), "unknown field: ai.summary"),
                                (dict(body, message=dict(ZERO, text="…")), "unknown field: message.text"),
                                (dict(body, message={k: v for k, v in ZERO.items() if k != "outcome"}), "missing field: message.outcome")):
            with self.subTest(detail=detail):
                self.assertEqual(self.error(self.report(changed), 400, "call_invalid"), detail)
        self.assertEqual(self.calls(), [])

    def frozen_clock(self, now):
        """The runtime route reads the portal's clock as `now`: hold it still. With the real clock a test that builds its
        times from a `now` read earlier is only right while the machine is quick (the +-301 s cases of
        test_validation_codes needed the request inside the same second: 3 failures under load, fix round)."""
        return mock.patch.object(vr, "time", types.SimpleNamespace(time=lambda: now, monotonic=time.monotonic))

    def test_clock_skew_is_judged_at_the_portals_clock_to_the_second(self):
        now = 1797815900
        with self.frozen_clock(now):
            for index, (changes, code) in enumerate((
                    ({"sent_at": at(now - 300)}, None), ({"sent_at": at(now + 300)}, None), ({"sent_at": at(now - 301)}, "clock_skew"),
                    ({"sent_at": at(now + 301)}, "clock_skew"),
                    ({"started_at": at(now + 300), "answered_at": None, "ended_at": at(now + 500)}, None),
                    ({"started_at": at(now + 301), "answered_at": None, "ended_at": at(now + 500)}, "clock_skew"),
                    ({"started_at": at(now - 30 * 86400), "answered_at": None, "ended_at": at(now - 30 * 86400 + 200)}, None),
                    ({"started_at": at(now - 30 * 86400 - 1), "answered_at": None, "ended_at": at(now - 30 * 86400 + 200)}, "call_too_old"))):
                with self.subTest(changes=changes):
                    response = self.report(orchestrator(now, call_id="1797815800.%d" % index, **changes))
                    if code is None:
                        self.ok(response, 201)
                    else:
                        self.error(response, 400, code)
            # Real time passes between requests; the portal's clock (here frozen) is what counts.
            time.sleep(1.1)
            self.error(self.report(orchestrator(now, call_id="1797815800.9", sent_at=at(now + 301))), 400, "clock_skew")
            self.ok(self.report(orchestrator(now, call_id="1797815800.10", sent_at=at(now + 300))), 201)

    def test_validation_codes(self):
        now = int(time.time())
        old = now - 31 * 86400
        late = now + 301
        cases = [
            ({"schema": "voice.call-report/v2"}, "call_invalid"), ({"source": "edge"}, "call_invalid"),
            ({"entry": "sip"}, "call_invalid"), ({"call_id": "try-" + "a" * 32}, "call_invalid"),
            ({"call_id": ".bad"}, "call_invalid"), ({"call_id": "x" * 65}, "call_invalid"),
            ({"entry": "try", "dialed": None, "store_id": self.store_id}, "call_invalid"),
            ({"dialed": "02 2700 1001"}, "call_invalid"), ({"dialed": None}, "call_invalid"),
            ({"store_id": self.store_id}, "call_invalid"),
            ({"started_at": "2026-10-22T09:15:02"}, "call_time_invalid"), ({"started_at": 1797815702}, "call_time_invalid"),
            ({"sent_at": "yesterday"}, "call_time_invalid"), ({"ended_at": None}, "call_time_invalid"),
            ({"ended_at": at(now - 201)}, "call_time_invalid"), ({"answered_at": at(now - 201)}, "call_time_invalid"),
            ({"answered_at": at(now - 40)}, "call_time_invalid"),
            ({"started_at": at(now - 14402), "answered_at": None, "ended_at": at(now - 1)}, "call_time_invalid"),
            ({"sent_at": at(now - 301)}, "clock_skew"), ({"sent_at": at(now + 301)}, "clock_skew"),
            ({"started_at": at(late), "answered_at": None, "ended_at": at(late + 10)}, "clock_skew"),
            ({"started_at": at(old), "answered_at": None, "ended_at": at(old + 10)}, "call_too_old"),
            ({"disposition": "NO ANSWER"}, "call_invalid"), ({"disposition": "answered"}, "call_invalid"),
            ({"caller_tail": "0912345678"}, "call_invalid"), ({"caller_tail": 678}, "call_invalid"),
            ({"caller_kind": "pager"}, "call_invalid"), ({"config": {"version": 0, "sha256": CFG_SHA}}, "call_invalid"),
            ({"config": {"version": 2**31, "sha256": CFG_SHA}}, "call_invalid"), ({"config": {"version": 10**30, "sha256": CFG_SHA}}, "call_invalid"),
            ({"config": {"version": 1, "sha256": CFG_SHA, "x": 1}}, "call_invalid"),
            ({"disclosure_version": "Draft 0"}, "call_invalid"), ({"ai": None}, "call_invalid"),
            ({"ai": dict(AI, speech_ms=True)}, "call_invalid"), ({"ai": dict(AI, turns=1.0)}, "call_invalid"),
            ({"ai": dict(AI, turns="6")}, "call_invalid"), ({"ai": dict(AI, auto_flags=["no_answer", "no_answer"])}, "call_invalid"),
            ({"ai": dict(AI, auto_flags=["degraded"])}, "call_invalid"),
            ({"ai": dict(AI, handoff={"reason": "bored", "urgent": False})}, "call_invalid"),
            ({"ai": dict(AI, degraded={"reason": "gpu", "at_ms": 1})}, "call_invalid"),
            ({"ai": dict(AI, metrics={"reply_p50_ms": 1})}, "call_invalid"),
            ({"ai": dict(AI, speech_ms=160001)}, "call_invalid"),
            ({"message": dict(ZERO, callback_confirmed=True)}, "call_invalid"),
            ({"message": dict(ZERO, callback_via="dtmf")}, "call_invalid"),
            ({"message": dict(ZERO, ai_answered=True, ai_speech_ms=1)}, "call_invalid"),
            ({"message": dict(ZERO, speech_ms=-1)}, "call_invalid"), ({"message": dict(ZERO, outcome="ai_answered")}, "call_invalid"),
            ({"message_final": True}, "call_invalid"), ({"fallback": True}, "call_invalid"), ({"fallback": 0}, "call_invalid"),
            ({"content_expected": None}, "call_invalid"), ({"retention_days": 91}, "call_invalid"),
            ({"retention_days": 0}, "call_invalid"),
        ]
        with self.frozen_clock(now):
            for changes, code in cases:
                with self.subTest(changes=changes):
                    self.error(self.report(orchestrator(now, **changes)), 400, code)
            for changes in ({"entry": "try", "call_id": "try-" + "a" * 32, "dialed": None}, {"ai": AI}, {"config": {"version": 1, "sha256": CFG_SHA}},
                            {"message_final": None}, {"message_final": False, "message": dict(ZERO, speech_ms=1000)},
                            {"message": dict(ZERO, ai_answered=False, ai_speech_ms=10)}):
                with self.subTest(records=changes):
                    self.error(self.report(records(now, **changes)), 400, "call_invalid")
        self.assertEqual(self.calls(), [])

    def test_try_call(self):
        call_id = "try-" + "b" * 32
        body = orchestrator(entry="try", call_id=call_id, dialed=None, store_id=self.store_id)
        response = self.ok(self.report(body), 201)
        self.assertEqual((response["meter_units"], response["meter_reason"], response["store_id"], response["flags"]), (0, "try", self.store_id, []))
        row = self.call(call_id)
        self.assertEqual((row["entry"], row["dialed"], row["number_id"], row["message_final"]), ("try", None, None, 1))
        self.assertEqual(self.error(self.report(dict(body, call_id="try-" + "c" * 32, store_id="f" * 32)), 400, "call_invalid"),
                         "unknown store_id")

    def test_config_version_is_checked(self):
        with self.store.connect() as con:
            sha = vs.get_config_version(con, self.store_id, 1)["config_sha256"]
        self.ok(self.report(orchestrator(config={"version": 1, "sha256": sha})), 201)
        self.assertNotIn("config_mismatch", json.loads(self.call()["auto_flags"]))
        for call_id, config in (("1797815702.122", {"version": 1, "sha256": CFG_SHA}), ("1797815702.123", {"version": 2, "sha256": sha})):
            with self.subTest(config=config):
                self.ok(self.report(orchestrator(call_id=call_id, config=config)), 201)
                self.assertIn("config_mismatch", json.loads(self.call(call_id)["auto_flags"]))

    def test_body_size_and_type_are_checked_before_parsing(self):
        body = orchestrator()
        text = json.dumps(body)
        url = BASE + "/voice/runtime/calls"
        big = text[:-1] + ',"pad":"' + "x" * (8193 - len(text) - 9) + '"}'
        self.assertEqual(len(big.encode()), 8193)
        self.error(self.runtime_client.post(url, content=big, headers=self.headers(**{"Content-Type": "application/json"})), 413, "invalid_input")

        def chunks():
            yield text.encode()

        self.error(self.runtime_client.post(url, content=chunks(), headers=self.headers(**{"Content-Type": "application/json"})), 413, "invalid_input")
        self.error(self.runtime_client.post(url, content=text, headers=self.headers(**{"Content-Type": "text/plain"})), 415, "invalid_input")
        self.error(self.runtime_client.post(url, content="{", headers=self.headers(**{"Content-Type": "application/json"})), 400, "invalid_input")
        self.error(self.runtime_client.post(url, content="[]", headers=self.headers(**{"Content-Type": "application/json"})), 400, "invalid_input")
        self.assertEqual(self.calls(), [])
        # A report of exactly 8192 bytes is read (and refused only for its unknown field).
        exact = text[:-1] + ',"pad":"' + "x" * (8192 - len(text) - 9) + '"}'
        self.assertEqual(self.error(self.runtime_client.post(url, content=exact, headers=self.headers(**{"Content-Type": "application/json"})),
                                    400, "call_invalid"), "unknown field: pad")
        # The vector body is about 1 KiB.
        self.assertLess(len(text.encode()), 1200)

    def test_post_needs_the_websites_origin(self):
        response = self.runtime_client.post(BASE + "/voice/runtime/calls", json=orchestrator(),
                                            headers={"Authorization": "Bearer " + TOKEN, "Origin": "https://foreign.example"})
        self.assertEqual((response.status_code, response.json()["error"]), (403, "origin_not_allowed"))
        self.assertEqual(self.calls(), [])


class ConcurrentReportTests(VoiceCallsCase):
    def setUp(self):
        super().setUp()
        self.owner, self.store_id = self.seed_store()
        self.seed_number(store_id=self.store_id)

    def send_all(self, bodies):
        start = threading.Barrier(len(bodies))

        def send(body):
            start.wait(timeout=15)
            return self.report(body)

        with ThreadPoolExecutor(max_workers=len(bodies)) as pool:
            return list(pool.map(send, bodies))

    def test_20_identical_reports_store_one_row_and_one_unit(self):
        body = orchestrator()
        responses = self.send_all([body] * 20)
        statuses = sorted(r.status_code for r in responses)
        self.assertEqual((statuses.count(201), statuses.count(200)), (1, 19), [r.text for r in responses if r.status_code not in (200, 201)])
        self.assertEqual(sorted(r.json()["result"] for r in responses), ["created"] + ["duplicate"] * 19)
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(sum(row["meter_units"] for row in self.calls()), 1)

    def test_10_pending_and_10_final_records_end_final(self):
        now = int(time.time())
        pending = records(now, final=False)
        final = records(now, message={"outcome": "message", "speech_ms": 12300, "recording_ms": 15000, "recording_saved": True})
        responses = self.send_all([pending, final] * 10)
        self.assertTrue(all(r.status_code in (200, 201) for r in responses), [r.text for r in responses])
        results = [r.json()["result"] for r in responses]
        self.assertEqual(results.count("created"), 1)
        self.assertLessEqual(results.count("updated"), 1)
        self.assertLessEqual(set(results), {"created", "duplicate", "updated", "stale"})
        rows_now = self.calls()
        self.assertEqual(len(rows_now), 1)
        self.assertEqual((rows_now[0]["message_final"], rows_now[0]["outcome"], rows_now[0]["meter_units"]), (1, "message", 1))


class OutcomeAndMeterTests(VoiceCallsCase):
    """Vector V4 (q5-draft-1), end to end through R2: 15 cases."""

    def setUp(self):
        super().setUp()
        self.owner, self.store_id = self.seed_store()
        self.seed_number(store_id=self.store_id)
        self.seed_number(TEST_NUMBER, store_id=self.store_id, purpose="test")
        self.serial = 0

    def run_case(self, *bodies):
        self.serial += 1
        call_id = "1797815800.%d" % self.serial
        for body in bodies:
            if body.get("entry") == "try":
                call_id = "try-%032x" % self.serial
            self.assertIn(self.report(dict(body, call_id=call_id)).status_code, (200, 201))
        row = self.call(call_id)
        return row["outcome"], row["meter_units"], row["meter_reason"]

    def test_vector_v4(self):
        now = int(time.time())
        message_12 = {"outcome": "message", "speech_ms": 12300, "recording_ms": 15000, "recording_saved": True}
        cases = {
            "a vector: AI, caller 41.25 s": ([orchestrator(now)], ("answered", 1, "ai_speech")),
            "b same, entry webrtc": ([orchestrator(now, entry="webrtc")], ("answered", 0, "channel_not_billable")),
            "c AI 2.4 s, no message": ([orchestrator(now, ai=dict(AI, speech_ms=2400))], ("answered", 0, "short_speech")),
            "d records: message 12.3 s": ([records(now, message=message_12)], ("message", 1, "message")),
            "e callback only, confirmed": ([records(now, message={"outcome": "callback_only", "callback_confirmed": True, "callback_via": "dtmf"})],
                                           ("message", 1, "callback")),
            "f try call": ([orchestrator(now, entry="try", dialed=None, store_id=self.store_id)], ("answered", 0, "try")),
            "g test number": ([orchestrator(now, dialed="0227001002")], ("answered", 0, "non_customer_line")),
            "h number not in table": ([orchestrator(now, dialed="0227009999")], ("answered", 0, "unknown_line")),
            "i NO ANSWER": ([records(now, disposition="NO ANSWER", answered_at=None)], ("not_answered", 0, "not_answered")),
            "j notice hangup": ([records(now, message={"outcome": "notice_hangup"})], ("hangup_early", 0, "notice_hangup")),
            "k AI handoff + message 8 s": ([orchestrator(now, ai=dict(AI, handoff={"reason": "requested", "urgent": False})),
                                            records(now, message={"outcome": "message", "speech_ms": 8000})], ("handoff", 1, "ai_speech")),
            "l AI 1.5 s degraded(tts) + msg 2 s": ([orchestrator(now, ai=dict(AI, speech_ms=1500, degraded={"reason": "tts", "at_ms": 21000})),
                                                    records(now, message={"outcome": "message", "speech_ms": 2000})], ("message", 1, "ai_speech")),
            "m edge fallback, no speech": ([records(now, fallback=True, message={"outcome": "no_speech"})], ("degraded", 0, "no_speech")),
            "n records pending, no orchestrator": ([records(now, final=False)], ("unknown", 0, "no_message_record")),
            "o records only: RC v4 AI 2 s + msg 1.5": ([records(now, message={"outcome": "message", "speech_ms": 1500, "ai_answered": True,
                                                                              "ai_speech_ms": 2000})], ("message", 1, "ai_speech")),
        }
        for name, (bodies, expected) in cases.items():
            with self.subTest(name):
                self.assertEqual(self.run_case(*bodies), expected)

    def test_v9_boundary_ai_part_plus_message_part(self):
        now = int(time.time())
        below = records(now, message={"outcome": "message", "speech_ms": 1999, "ai_answered": True, "ai_speech_ms": 1000})
        exact = records(now, message={"outcome": "message", "speech_ms": 2000, "ai_answered": True, "ai_speech_ms": 1000})
        self.assertEqual(self.run_case(below), ("message", 0, "short_speech"))
        self.assertEqual(self.run_case(exact), ("message", 1, "ai_speech"))

    def test_handoff_degraded_and_flags_columns(self):
        now = int(time.time())
        self.run_case(orchestrator(now, ai=dict(AI, handoff={"reason": "urgent", "urgent": True}, auto_flags=["talk_over", "no_answer"],
                                              degraded={"reason": "llm", "at_ms": 5000})))
        row = self.call("1797815800.1")
        self.assertEqual((row["handoff"], row["handoff_reason"], row["urgent"], row["degraded"], row["degrade_reason"]),
                         (1, "urgent", 1, 1, "llm"))
        self.assertEqual(json.loads(row["auto_flags"]), ["no_answer", "talk_over", "degraded"])
        self.run_case(records(now, fallback=True))
        row = self.call("1797815800.2")
        self.assertEqual((row["degraded"], row["degrade_reason"]), (1, "edge_fallback"))


class PureRuleTests(unittest.TestCase):
    """Vectors that need no database: V2 (numbers), V3 (hashes), V6 (media token), V8 (cursor)."""

    def test_v2_numbers(self):
        expected = {"0227001001": "+886227001001", "0912345678": "+886912345678", "ext:6201": "ext-6201", "ext-6201": "ext-6201",
                    "+886227356688": "+886227356688", "886227001001": None, "02-2700-1001": None, "ext-62011": None, "02 2700 1001": None}
        for value, normalized in expected.items():
            with self.subTest(value=value):
                self.assertEqual(vc.normalize_number(value), normalized)
        self.assertEqual([vc.to_a6_number(n) for n in ("+886227001001", "ext-6201", "+886227356688")], ["0227001001", "ext:6201", "0227356688"])

    def test_v3_hashes(self):
        report = orchestrator(call_id="1797815702.118")
        report.update({"started_at": "2026-12-21T09:15:02+08:00", "answered_at": "2026-12-21T09:15:03+08:00",
                       "ended_at": "2026-12-21T09:17:41+08:00", "sent_at": "2026-12-21T09:17:42+08:00",
                       "config": {"version": 1, "sha256": CFG_SHA}})
        self.assertEqual(vc.part_sha256(report), "eae9e60988d7af0dce8b90f11686e32bababe90862398e2404e458ceac716797")
        self.assertEqual(vc.part_sha256(dict(report, sent_at="2026-12-21T09:20:00+08:00")), vc.part_sha256(report))
        for key in report:
            if key == "sent_at":
                continue
            with self.subTest(key=key):
                changed = dict(report, **{key: "x" if report[key] != "x" else "y"})
                self.assertNotEqual(vc.part_sha256(changed), vc.part_sha256(report))
        pending = dict(report, source="records", answered_at="2026-12-21T09:15:02+08:00", config=None, ai=None,
                       message=dict(ZERO), message_final=False, sent_at="2026-12-21T09:17:45+08:00")
        final = dict(pending, message=dict(ZERO, ai_answered=True, ai_speech_ms=41250), message_final=True)
        self.assertEqual(vc.part_sha256(pending), "1e2f21fb8036fc37dd7ba3d86703ce8d264242c56dafdcf29eafdde014654f03")
        self.assertEqual(vc.part_sha256(final), "a6352890c6d6e1a1dd3b585197559af8923a94410f070709734324de7d494d3f")
        self.assertEqual(vc.facts_sha256(pending), "faec5790c4f660ae68661966c5f066c01866804664e8df99e9d58c8401f64390")
        self.assertEqual(vc.facts_sha256(final), vc.facts_sha256(pending))
        now = vc.epoch("2026-12-21T09:17:44+08:00")
        self.assertEqual(vc.parse_report(report, now)["started"], 1797815702)
        self.assertEqual(vc.parse_report(dict(report, sent_at="2026-12-21T09:12:42+08:00"), vc.epoch("2026-12-21T09:17:42+08:00"))["sent"],
                         vc.epoch("2026-12-21T09:12:42+08:00"))

    def test_v3_merge_comparisons(self):
        report = orchestrator(call_id="1797815702.118")
        report.update({"started_at": "2026-12-21T09:15:02+08:00", "answered_at": "2026-12-21T09:15:03+08:00",
                       "ended_at": "2026-12-21T09:17:41+08:00"})
        final = dict(report, source="records", answered_at="2026-12-21T09:15:02+08:00", config=None, ai=None,
                     message=dict(ZERO, ai_answered=True, ai_speech_ms=41250), message_final=True)
        cases = [({}, {}, []), ({"started_at": "2026-12-21T09:15:11+08:00"}, {}, []),
                 ({"started_at": "2026-12-21T09:15:13+08:00"}, {}, ["started_at"]),
                 ({"ended_at": "2026-12-21T09:16:30+08:00"}, {}, []), ({"ended_at": "2026-12-21T09:17:52+08:00"}, {}, ["ended_at"]),
                 ({}, {"ended_at": None}, []), ({"dialed": "+886227001001"}, {}, []),
                 ({}, {"caller_tail": None, "caller_kind": "unknown"}, []),
                 ({}, {"message": dict(ZERO, ai_answered=True, ai_speech_ms=41000)}, ["ai_speech_ms"])]
        for orch_changes, rec_changes, expected in cases:
            with self.subTest(orch=orch_changes, rec=rec_changes):
                self.assertEqual(vc.mismatch_fields(dict(report, **orch_changes), dict(final, **rec_changes)), expected)

    def test_two_lines_of_one_store_are_not_a_dialed_mismatch(self):
        report = orchestrator(call_id="1797815702.118")
        report.update({"started_at": "2026-12-21T09:15:02+08:00", "answered_at": "2026-12-21T09:15:03+08:00",
                       "ended_at": "2026-12-21T09:17:41+08:00"})
        final = dict(report, source="records", answered_at="2026-12-21T09:15:02+08:00", config=None, ai=None,
                     message=dict(ZERO, ai_answered=True, ai_speech_ms=41250), message_final=True, dialed="0227001005")
        self.assertEqual(vc.mismatch_fields(report, final), ["dialed"])
        self.assertEqual(vc.mismatch_fields(report, final, same_store=False), ["dialed"])
        self.assertEqual(vc.mismatch_fields(report, final, same_store=True), [])
        # Only the dialed number is excused; every other disagreement is still one.
        self.assertEqual(vc.mismatch_fields(dict(report, entry="webrtc", caller_tail="999"), final, same_store=True), ["entry", "caller_tail"])

    def test_v6_media_token(self):
        token, payload = vc.sign_media_token(MEDIA_SECRET, call_id="1797815702.118", store_id=VECTOR_STORE,
                                             kinds=["transcript", "summary", "recording"], sub="fedcba9876543210fedcba9876543210",
                                             role="store", now=1797818400, nonce="00112233445566778899aabbccddeeff")
        self.assertEqual(token, "eyJhdWQiOiJ2b2ljZS1tZWRpYSIsImNhbGxfaWQiOiIxNzk3ODE1NzAyLjExOCIsImV4cCI6MTc5NzgxODcwMCwiaWF0IjoxNzk3ODE4NDAw"
                                "LCJraW5kcyI6WyJyZWNvcmRpbmciLCJzdW1tYXJ5IiwidHJhbnNjcmlwdCJdLCJub25jZSI6IjAwMTEyMjMzNDQ1NTY2Nzc4ODk5"
                                "YWFiYmNjZGRlZWZmIiwicHVycG9zZSI6Im1lZGlhIiwicm9sZSI6InN0b3JlIiwic3RvcmVfaWQiOiIwMTIzNDU2Nzg5YWJjZGVm"
                                "MDEyMzQ1Njc4OWFiY2RlZiIsInN1YiI6ImZlZGNiYTk4NzY1NDMyMTBmZWRjYmE5ODc2NTQzMjEwIiwidiI6MX0"
                                ".vEj9IdAOoD-aik-FwzeA-wx6IeI-uZ5rlmb9m-IBc_k")
        self.assertEqual((len(token), payload["exp"], payload["kinds"]), (439, 1797818700, ["recording", "summary", "transcript"]))
        admin_token, _ = vc.sign_media_token(MEDIA_SECRET, call_id="1797815702.118", store_id=None, kinds=["recording", "summary", "transcript"],
                                             sub="fedcba9876543210fedcba9876543210", role="admin", now=1797818400,
                                             nonce="00112233445566778899aabbccddeeff")
        self.assertEqual(len(admin_token), 399)
        for bad in ({"kinds": []}, {"kinds": ["audio"]}, {"role": "owner"}):
            with self.subTest(bad=bad):
                arguments = dict(call_id="c", store_id=None, kinds=["summary"], sub="u", role="store", now=1)
                arguments.update(bad)
                with self.assertRaises(ValueError):
                    vc.sign_media_token(MEDIA_SECRET, **arguments)
        with self.assertRaises(ValueError):
            vc.sign_media_token(" " * 40, call_id="c", store_id=None, kinds=["summary"], sub="u", role="store", now=1)
        self.assertEqual(vc.media_url("https://tw.example", "1797815702.118", "summary"), "https://tw.example/v1/calls/1797815702.118/summary")

    def test_v7_and_v8(self):
        started = 1797815702
        row = {"started_at": started, "retention_days_snapshot": 30, "retention_days_reported": None, "recording_saved": 1,
               "content_expected": 1, "store_deleted_at": None}
        self.assertEqual(vc.retention_json(row, 14)["recordingUntil"], "2027-01-04T01:15:02Z")
        self.assertEqual(vc.retention_json(row, 60)["recordingUntil"], "2027-01-20T01:15:02Z")
        self.assertEqual(vc.retention_json(dict(row, retention_days_snapshot=90), None)["recordingUntil"], "2027-03-21T01:15:02Z")
        self.assertEqual(vc.retention_json(row, 14)["transcriptUntil"], "2027-03-21T01:15:02Z")
        # The vector's 400 days (phase2-contract appendix A V7); the row is kept PC_VOICE_CALL_RETENTION_DAYS, 1825 by default.
        self.assertEqual(vc.retention_json(row, 14, 400)["detailUntil"], "2028-01-25T01:15:02Z")
        self.assertEqual(vc.retention_json(row, 14)["detailUntil"], "2031-12-20T01:15:02Z")
        self.assertEqual(vc.content_kinds(row, 14, started + 14 * 86400 - 1), ["recording", "summary", "transcript"])
        self.assertEqual(vc.content_kinds(row, 14, started + 14 * 86400), ["summary", "transcript"])
        self.assertEqual(vc.content_kinds(row, 14, started + 90 * 86400), [])
        # A store deletion (M18) ends every kind at once, whatever the dates say.
        self.assertEqual(vc.content_kinds(dict(row, store_deleted_at=started + 60), 14, started + 61), [])
        self.assertEqual(vc.cursor_of({"started_at": started, "id": "a1b2c3d4e5f60718293a4b5c6d7e8f90"}),
                         "1797815702-a1b2c3d4e5f60718293a4b5c6d7e8f90")
        self.assertEqual(vc.parse_cursor("1797815702-a1b2c3d4e5f60718293a4b5c6d7e8f90"), (1797815702, "a1b2c3d4e5f60718293a4b5c6d7e8f90"))
        self.assertEqual(vc.month_bounds("2026-12"), (vc.epoch("2026-12-01T00:00:00+08:00"), vc.epoch("2027-01-01T00:00:00+08:00")))
        for bad in ("2026-13", "2026-1", "1999-12", "2038-01", "2026-12-01"):
            with self.subTest(month=bad):
                with self.assertRaises(ValueError):
                    vc.month_bounds(bad)

    def test_phone_number_rule(self):
        for text in ("0912 345 678", "0912-345-678", "０９１２３４５６７８", "02 2700 1001", "12345678",
                     # fix round: dots, slashes, brackets, Chinese numerals and invisible characters no longer slip through
                     "0912.345.678", "0912/345/678", "(02)2700.1001", "（02）2700‧1001", "0912・345・678", "零九一二三四五六七八",
                     "〇九壹貳參肆伍陸柒捌", "0912\u200b345678", "0912\ufeff345678", "09１2 三四五 678"):
            with self.subTest(text=text):
                self.assertTrue(vc.has_phone_number(text))
        for text in ("問洗牙價格，AI 說的是去年的價錢", "1234567", "3 號診間", "p95 1910 ms", "一二三四五六七", "3.5 秒", "10/22 14:30"):
            with self.subTest(text=text):
                self.assertFalse(vc.has_phone_number(text))

    def test_numeral_table_has_one_digit_per_character(self):
        seen = {}
        for digit, chars in vc.PHONE_NUMERALS.items():
            for char in chars:
                self.assertNotIn(char, seen, char)
                seen[char] = digit
        self.assertEqual(sorted(vc.PHONE_NUMERALS), list("0123456789"))
        self.assertEqual(vc.phone_text("零一二三四五六七八九"), "0123456789")

    def test_seconds_are_rounded_down(self):
        # §1.4: one decimal, never up, so 2999 ms is not shown as 3.0 next to "less than 3 seconds" (fix round).
        self.assertEqual([vc._seconds(ms) for ms in (0, 99, 2960, 2999, 3000, 41250, 53550, 14400000)],
                         [0.0, 0.0, 2.9, 2.9, 3.0, 41.2, 53.5, 14400.0])

    def test_masked_dialed(self):
        for value in ("0912345678", "+886912345678", "886912345678", "0912-345-678", "912345678"):
            with self.subTest(value=value):
                self.assertEqual(vc.masked_dialed(value), "******5678")
        for value in ("0227001001", "+886227001001", "ext:6201", "0912345", "09123456789", None):
            with self.subTest(value=value):
                self.assertIsNone(vc.masked_dialed(value))
        self.assertIsNone(vc.normalize_number("******5678"))


if __name__ == "__main__":
    unittest.main()
