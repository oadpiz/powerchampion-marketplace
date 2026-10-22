"""Store-owner phone-agent routes M1-M12 (server/voice_merchant.py; phase1-contract.md §1, §3, §5, §6 and A1-A8).

Runs on SQLite, or on Postgres when PC_PORTAL_TEST_DATABASE_URL is set (scripts/test_backend_postgres.sh)."""
import dataclasses
import hashlib
import json
import os
import re
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

from server import voice_compile as vc
from server import voice_merchant as vm
from server import voice_store as vs
from server import voice_ticket as vt
from server.settings import Settings
from server.store import iso
from server.testsupport import BASE, ORIGIN, PASSWORD, FakeGateway, PortalCase, database_text, fresh_database, rows

# Test-only value from the contract (§6.1); it is not a secret anywhere.
SECRET = "test-only-not-a-secret-0000000000"
TRY_URL = "http://localhost:8097"
OTHER_ID = "0123456789abcdef0123456789abcdef"
NOT_FOUND = {"error": "not_found", "detail": "This portal endpoint is not available for this request."}
DISCLOSURE = "您好，這裡是{{SHOP_NAME}}，由 AI 語音助理接聽，通話可能錄音，以便回覆您。"
TEMPLATE_DIR = Path(__file__).resolve().parent / "voice_templates"


def routes(faq_id=OTHER_ID):
    """Every store-owner route as (method, path, body); bodies are valid enough to reach the checks under test."""
    return [("GET", "/me/voice", None), ("GET", "/me/voice/setup", None), ("POST", "/me/voice/setup", {"greeting": "您好"}),
            ("GET", "/me/voice/faqs", None), ("POST", "/me/voice/faqs", {"question": "問", "answer": "答"}),
            ("POST", "/me/voice/faqs/" + faq_id, {"answer": "改"}), ("DELETE", "/me/voice/faqs/" + faq_id, None),
            ("POST", "/me/voice/faqs/import", {"csv": "問題,答案\n問,答\n", "mode": "append"}),
            ("POST", "/me/voice/faqs/from-template", {"mode": "append"}), ("GET", "/me/voice/preview", None),
            ("POST", "/me/voice/publish", {}), ("POST", "/me/voice/try", {})]


WRITES = [route for route in routes() if route[0] != "GET"]


class VoiceCase(PortalCase):
    """PortalCase with the phone agent switched on and a try secret and URL configured."""
    voice = {"voice_enabled": True, "voice_try_secret": SECRET, "voice_try_url": TRY_URL}

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,), **self.voice)
        self.gateway = FakeGateway()
        from server.app import create_app

        self.app = create_app(self.settings, gateway=self.gateway)
        self.store = self.app.state.store
        self.clients = []

    def other_app(self, **changes):
        """A second app on the same database with other settings (e.g. the try secret unset)."""
        from server.app import create_app

        return create_app(dataclasses.replace(self.settings, **changes), gateway=self.gateway)

    def login(self, email, app=None):
        client = TestClient(app or self.app, base_url=ORIGIN)
        self.clients.append(client)
        response = self.post(client, "/auth/login", {"email": email, "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.text)
        return client

    def user(self, email, temporary=False):
        user = self.store.create_user(email, "Owner", PASSWORD)
        if temporary:
            with self.store.connect() as con:
                con.execute("UPDATE users SET password_change_required_at=? WHERE id=?", (1, user["id"]))
        return user["id"]

    def merchant(self, email="a@example.test", name="晴光牙醫診所", industry="clinic", template_id="clinic", temporary=False):
        """(logged-in client, store id) for a new account that owns a store."""
        user_id = self.user(email, temporary)
        with self.store.connect() as con:
            store_id = vs.create_store(con, user_id, name, industry, template_id=template_id)["id"]
        return self.login(email), store_id

    def call(self, client, method, path, body=None):
        if method == "GET":
            return client.get(BASE + path)
        if method == "DELETE":
            return client.delete(BASE + path, headers={"Origin": ORIGIN})
        return self.post(client, path, body)

    def ok(self, response, status=200):
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def error(self, response, status, code):
        self.assertEqual((response.status_code, response.json().get("error")), (status, code), response.text)
        self.assertEqual(set(response.json()), {"error", "detail"})

    def add_faq(self, client, question="洗牙多少錢？", answer="健保洗牙半年一次免費。", **extra):
        return self.ok(self.post(client, "/me/voice/faqs", dict({"question": question, "answer": answer}, **extra)), 201)["faq"]

    def store_row(self, store_id):
        with self.store.connect() as con:
            return vs.get_store(con, store_id)

    def set_store(self, store_id, **columns):
        with self.store.connect() as con:
            con.execute("UPDATE voice_stores SET " + ",".join(c + "=?" for c in columns) + " WHERE id=?",
                        tuple(columns.values()) + (store_id,))

    def details(self, action):
        return [json.loads(e["details"]) if e["details"] else None for e in self.audit(action)]

    def audit_text(self):
        return "\n".join(str(value) for event in rows(self.store, "audit_events") for value in event.values())

    def published(self, store_id):
        with self.store.connect() as con:
            return [dict(r) for r in con.execute("SELECT * FROM voice_config_versions WHERE store_id=? ORDER BY version", (store_id,)).fetchall()]


# ---------------------------------------------------------------- §1.1 switch, sign-in, owner


class SwitchTests(VoiceCase):
    voice = {"voice_enabled": False, "voice_try_secret": SECRET, "voice_try_url": TRY_URL}

    def test_every_route_is_a_plain_404_while_the_switch_is_off(self):
        client, _ = self.merchant()
        anonymous = self.client()
        missing = client.get(BASE + "/me/no-such-route")
        self.assertEqual((missing.status_code, missing.json()), (404, NOT_FOUND))
        for method, path, body in routes():
            for who, session in (("owner", client), ("anonymous", anonymous)):
                with self.subTest(method=method, path=path, who=who):
                    response = self.call(session, method, path, body)
                    self.assertEqual((response.status_code, response.json()), (404, NOT_FOUND))
        # Same database, switch on: the owner reaches the routes, so the 404s above came from the switch.
        on = self.login("a@example.test", self.other_app(voice_enabled=True))
        self.assertEqual(on.get(BASE + "/me/voice").status_code, 200)
        self.assertEqual(self.ok(self.post(on, "/me/voice/setup", {"greeting": "您好"}))["changed"], ["greeting"])


class AccessTests(VoiceCase):
    def test_signed_out_is_401(self):
        anonymous = self.client()
        for method, path, body in routes():
            with self.subTest(method=method, path=path):
                self.error(self.call(anonymous, method, path, body), 401, "auth_required")

    def test_account_without_a_store_gets_404_on_every_route(self):
        self.user("nostore@example.test")
        client = self.login("nostore@example.test")
        admin = self.admin()
        for session in (client, admin):
            for method, path, body in routes():
                with self.subTest(method=method, path=path):
                    self.error(self.call(session, method, path, body), 404, "voice_store_not_found")

    def test_store_b_gets_404_for_every_resource_of_store_a(self):
        a, a_id = self.merchant("a@example.test", name="甲店晴光")
        faq = self.add_faq(a, question="甲店獨有的問題？", answer="甲店獨有的答案。")
        self.ok(self.post(a, "/me/voice/setup", {"introText": "甲店獨有的介紹"}))
        self.ok(self.post(a, "/me/voice/publish", {}))
        before = (self.store_row(a_id), self.ok(a.get(BASE + "/me/voice/faqs")))
        markers = ("甲店", a_id, faq["id"])
        # B without a store: every route, including A's FAQ id, is 404.
        self.user("b@example.test")
        b = self.login("b@example.test")
        for method, path, body in routes(faq["id"]):
            with self.subTest("no store", method=method, path=path):
                self.error(self.call(b, method, path, body), 404, "voice_store_not_found")
        # B with its own store: A's FAQ id is "not found", like a malformed or unknown id.
        with self.store.connect() as con:
            b_id = vs.create_store(con, self.user_id("b@example.test"), "乙店", "cram", template_id="cram")["id"]
        for faq_id in (faq["id"], faq["id"].upper(), "x" * 32, "../" + faq["id"], OTHER_ID):
            for method, body in (("POST", {"answer": "被改掉了"}), ("DELETE", None)):
                with self.subTest("other store id", faq_id=faq_id, method=method):
                    response = self.call(b, method, "/me/voice/faqs/" + faq_id, body)
                    self.assertEqual(response.status_code, 404, response.text)
                    self.assertIn(response.json()["error"], ("faq_not_found", "not_found"))
        # B's own preview, publish and try only ever show B's store.
        self.add_faq(b, question="乙店的問題？", answer="乙店的答案。")
        responses = [b.get(BASE + path) for path in ("/me/voice", "/me/voice/setup", "/me/voice/faqs", "/me/voice/preview")]
        responses += [self.post(b, "/me/voice/publish", {}), self.post(b, "/me/voice/try", {})]
        for response in responses:
            self.assertEqual(response.status_code, 200, response.text)
            for marker in markers:
                self.assertNotIn(marker, response.text)
        payload = vt.verify(responses[-1].json()["ticket"], SECRET, ledger=vt.NonceLedger())
        self.assertEqual(payload["store_id"], b_id)
        self.assertEqual(before, (self.store_row(a_id), self.ok(a.get(BASE + "/me/voice/faqs"))))


# ---------------------------------------------------------------- write guards


class WriteGuardTests(VoiceCase):
    def test_temporary_password_blocks_every_write_but_no_read(self):
        client, store_id = self.merchant(temporary=True)
        with self.store.connect() as con:
            faq_id = vs.add_faq(con, store_id, "問", "答")["id"]
        for method, path, body in routes(faq_id):
            with self.subTest(method=method, path=path):
                response = self.call(client, method, path, body)
                if method == "GET":
                    self.assertEqual(response.status_code, 200, response.text)
                else:
                    self.error(response, 403, "password_change_required")
        self.assertTrue(self.ok(client.get(BASE + "/me/voice"))["account"]["passwordChangeRequired"])
        self.assertEqual(rows(self.store, "voice_config_versions"), [])
        self.assertEqual(self.store_row(store_id)["greeting"], "")
        # After the owner picks a password, the same write goes through.
        self.ok(self.post(client, "/password", {"currentPassword": PASSWORD, "newPassword": "owner-chosen-password-456!"}))
        self.assertEqual(self.ok(self.post(client, "/me/voice/setup", {"greeting": "您好"}))["changed"], ["greeting"])
        self.assertFalse(self.ok(client.get(BASE + "/me/voice"))["account"]["passwordChangeRequired"])

    def test_suspended_store_is_read_only(self):
        client, store_id = self.merchant()
        faq_id = self.add_faq(client)["id"]
        self.ok(self.post(client, "/me/voice/publish", {}))
        self.set_store(store_id, status="suspended")
        for method, path, body in routes(faq_id):
            with self.subTest(method=method, path=path):
                response = self.call(client, method, path, body)
                if method == "GET":
                    self.assertEqual(response.status_code, 200, response.text)
                else:
                    self.error(response, 409, "store_suspended")
        self.assertEqual(self.audit("voice.try_issued"), [])

    def test_temporary_password_is_checked_before_suspension_and_fields(self):
        client, store_id = self.merchant(temporary=True)
        self.set_store(store_id, status="suspended")
        self.error(self.post(client, "/me/voice/setup", {"greeting": "字" * 99}), 403, "password_change_required")

    def test_publish_and_try_need_a_json_body(self):
        client, _ = self.merchant()
        for path in ("/me/voice/publish", "/me/voice/try"):
            response = client.post(BASE + path, headers={"Origin": ORIGIN})
            self.error(response, 415, "invalid_input")


# ---------------------------------------------------------------- M1, M2, M3


class SetupTests(VoiceCase):
    def test_summary_shape(self):
        client, store_id = self.merchant()
        body = self.ok(client.get(BASE + "/me/voice"))
        self.assertEqual(set(body), {"store", "account", "try", "limits"})
        self.assertEqual(body["store"]["id"], store_id)
        self.assertEqual((body["store"]["currentVersion"], body["store"]["publishedAt"], body["store"]["hasUnpublishedChanges"]),
                         (None, None, True))
        self.assertEqual(body["try"], {"available": True, "limit": 20, "windowHours": 24, "used": 0, "remaining": 20, "lastIssuedAt": None})
        self.assertEqual(body["limits"], vm.LIMITS)
        self.assertEqual(body["limits"]["storeNameChars"], 20)  # A1
        self.assertFalse(body["store"]["aiAnswerEnabled"])

    def test_limits_follow_the_contract_table(self):
        self.assertEqual(vm.LIMITS, {
            "storeNameChars": 20, "greetingChars": 40, "openingNonSpaceMax": 67, "openingSecondsMax": 15, "charsPerSecond": 4.5,
            "questionChars": 100, "variantChars": 50, "variantsMax": 10, "faqChars": 400, "kbCharsMax": 6000, "faqMax": 120,
            "csvBodyBytes": 196608, "hoursSegmentsPerDay": 4, "closuresMax": 60, "closureNoteChars": 40,
            "maxMessageSecondsMin": 60, "maxMessageSecondsMax": 180, "retentionDaysMax": 90, "retentionDaysMaxFull": 30,
            "tryLimit": 20, "tryWindowHours": 24, "ticketTtlSeconds": 900})

    def test_get_setup_defaults_opening_and_template(self):
        client, _ = self.merchant()
        body = self.ok(client.get(BASE + "/me/voice/setup"))
        setup = body["setup"]
        self.assertEqual({k: setup[k] for k in ("greeting", "introText", "hours", "closures", "afterHoursMode", "askCallback",
                                                 "maxMessageSeconds", "handoffMode", "recordingMode", "retentionDays", "aiAnswerEnabled")},
                         {"greeting": "", "introText": "", "hours": [], "closures": [], "afterHoursMode": "answer_and_message",
                          "askCallback": "auto", "maxMessageSeconds": 120, "handoffMode": "callback", "recordingMode": "message_only",
                          "retentionDays": 90, "aiAnswerEnabled": False})
        self.assertEqual(body["disclosure"], {"template": DISCLOSURE, "version": "draft-0"})
        text = DISCLOSURE.replace("{{SHOP_NAME}}", "晴光牙醫診所")
        self.assertEqual(body["opening"], {"text": text, "nonSpace": 36, "estSeconds": 8.0, "ok": True})
        template = json.loads((TEMPLATE_DIR / "clinic.json").read_text(encoding="utf-8"))
        self.assertEqual(body["template"]["templateId"], "clinic")
        self.assertEqual(body["template"]["greetingExample"], template["greeting_example"])
        self.assertEqual(body["template"]["hoursExample"][0], {"weekday": template["hours_example"][0]["weekday"],
                                                               "openMin": template["hours_example"][0]["open_min"],
                                                               "closeMin": template["hours_example"][0]["close_min"]})
        other, _ = self.merchant("o@example.test", industry="other", template_id=None)
        self.assertEqual(self.ok(other.get(BASE + "/me/voice/setup"))["template"], {"available": False})

    def test_partial_update_reports_changes_and_audits_only_sizes(self):
        client, store_id = self.merchant()
        update = {"greeting": "請問有什麼可以幫您？", "introText": "  診所在台北市。\n有停車場。  ",
                  "hours": [{"weekday": 0, "openMin": 840, "closeMin": 1080}, {"weekday": 0, "openMin": 540, "closeMin": 720}],
                  "closures": [{"date": "2026-12-25", "note": "院內訓練"}],
                  "aiAnswerEnabled": True, "industry": "cram", "status": "testing", "templateId": "cram", "handoffMode": "transfer"}
        body = self.ok(self.post(client, "/me/voice/setup", update))
        self.assertEqual(body["changed"], ["greeting", "introText", "hours", "closures"])
        self.assertEqual(body["setup"]["introText"], "診所在台北市。\n有停車場。")
        self.assertEqual(body["setup"]["hours"], [{"weekday": 0, "openMin": 540, "closeMin": 720}, {"weekday": 0, "openMin": 840, "closeMin": 1080}])
        row = self.store_row(store_id)
        self.assertEqual((row["ai_answer_enabled"], row["industry"], row["status"], row["template_id"], row["handoff_mode"]),
                         (False, "clinic", "draft", "clinic", "callback"))
        self.assertEqual(self.details("voice.setup_saved"),
                         [{"changed": ["greeting", "introText", "hours", "closures"], "kbChars": 13, "hoursSegments": 2, "closures": 1}])
        # The same values again change nothing and are not audited.
        self.assertEqual(self.ok(self.post(client, "/me/voice/setup", update))["changed"], [])
        self.assertEqual(self.ok(self.post(client, "/me/voice/setup", {}))["changed"], [])
        self.assertEqual(len(self.audit("voice.setup_saved")), 1)
        body = self.ok(self.post(client, "/me/voice/setup", {"askCallback": "never", "maxMessageSeconds": 60, "recordingMode": "off",
                                                              "retentionDays": 30, "afterHoursMode": "message_only", "name": "晴光 牙醫"}))
        self.assertEqual(body["changed"], ["name", "afterHoursMode", "askCallback", "maxMessageSeconds", "recordingMode", "retentionDays"])

    def test_validation_codes_in_contract_order(self):
        client, store_id = self.merchant()
        twenty = "一二三四五六七八九十" * 2
        cases = [
            ({"name": ""}, 400, "invalid_input"),
            ({"name": twenty + "一"}, 400, "invalid_input"),  # A1: 21 characters
            ({"name": "a​b"}, 400, "invalid_input"),
            ({"name": "字 " * 21}, 400, "invalid_input"),  # 21 characters even though spaces do not count
            ({"greeting": "字" * 41}, 400, "greeting_too_long"),
            ({"greeting": "a\nb"}, 400, "invalid_input"),
            ({"introText": "a\x00b"}, 400, "invalid_input"),
            ({"hours": [{"weekday": 0, "openMin": 540, "closeMin": 720}, {"weekday": 0, "openMin": 700, "closeMin": 800}]}, 400, "hours_invalid"),
            ({"hours": [{"weekday": 1, "openMin": n * 100, "closeMin": n * 100 + 50} for n in range(5)]}, 400, "hours_invalid"),
            ({"hours": [{"weekday": 7, "openMin": 0, "closeMin": 60}]}, 400, "hours_invalid"),
            ({"hours": [{"weekday": 0, "openMin": 600, "closeMin": 600}]}, 400, "hours_invalid"),
            ({"hours": [{"weekday": True, "openMin": 0, "closeMin": 60}]}, 400, "hours_invalid"),
            ({"hours": "09:00-18:00"}, 400, "hours_invalid"),
            ({"closures": [{"date": "2026-02-30"}]}, 400, "closures_invalid"),
            ({"closures": [{"date": "2026-12-25"}, {"date": "2026-12-25", "note": "x"}]}, 400, "closures_invalid"),
            ({"closures": [{"date": "2026-12-25", "note": "字" * 41}]}, 400, "closures_invalid"),
            ({"closures": [{"date": "2027-01-%02d" % (d % 28 + 1), "note": ""} for d in range(61)]}, 400, "closures_invalid"),
            ({"afterHoursMode": "closed"}, 400, "invalid_input"),
            ({"askCallback": "sometimes"}, 400, "invalid_input"),
            ({"maxMessageSeconds": 59}, 400, "invalid_input"),
            ({"maxMessageSeconds": 181}, 400, "invalid_input"),
            ({"maxMessageSeconds": True}, 400, "invalid_input"),
            ({"recordingMode": "full"}, 403, "recording_mode_forbidden"),
            ({"recordingMode": "always"}, 400, "invalid_input"),
            ({"retentionDays": 91}, 400, "retention_exceeds_limit"),
            ({"retentionDays": 0}, 400, "invalid_input"),
            ({"retentionDays": "30"}, 400, "invalid_input"),
            ({"name": twenty, "greeting": "請" * 18}, 400, "opening_too_long"),  # 30 + 20 + 18 = 68 > 67
            ({"introText": "介" * 6001}, 400, "kb_too_large"),
            # First error wins, in §3.3 order.
            ({"greeting": "字" * 41, "name": ""}, 400, "invalid_input"),
            ({"retentionDays": 91, "recordingMode": "full"}, 403, "recording_mode_forbidden"),
            ({"hours": "x", "closures": "y"}, 400, "hours_invalid"),
        ]
        before = (self.store_row(store_id), self.ok(client.get(BASE + "/me/voice/setup")))
        for update, status, code in cases:
            with self.subTest(update=str(update)[:80]):
                self.error(self.post(client, "/me/voice/setup", update), status, code)
        self.assertEqual(before, (self.store_row(store_id), self.ok(client.get(BASE + "/me/voice/setup"))))
        self.assertEqual(self.audit("voice.setup_saved"), [])
        # The limits themselves are allowed.
        body = self.ok(self.post(client, "/me/voice/setup", {"name": twenty, "greeting": "請" * 17, "introText": "介" * 6000}))
        self.assertEqual((body["opening"]["nonSpace"], body["opening"]["estSeconds"], body["opening"]["ok"]), (67, 14.9, True))
        self.assertEqual(self.ok(self.post(client, "/me/voice/setup", {"name": "晴 光 牙 醫 診 所 晴 光 牙 醫 診 所 晴 光 牙 醫 診 所 晴 光"}))["changed"], ["name"])

    def test_full_recording_can_only_be_kept_and_limits_retention_to_30_days(self):
        client, store_id = self.merchant()
        self.set_store(store_id, recording_mode="full", retention_days=30)
        self.assertEqual(self.ok(self.post(client, "/me/voice/setup", {"recordingMode": "full"}))["changed"], [])
        self.error(self.post(client, "/me/voice/setup", {"retentionDays": 31}), 400, "retention_exceeds_limit")
        self.error(self.post(client, "/me/voice/setup", {"recordingMode": "full", "retentionDays": 31}), 400, "retention_exceeds_limit")
        body = self.ok(self.post(client, "/me/voice/setup", {"recordingMode": "message_only", "retentionDays": 90}))
        self.assertEqual(body["changed"], ["recordingMode", "retentionDays"])
        self.error(self.post(client, "/me/voice/setup", {"recordingMode": "full"}), 403, "recording_mode_forbidden")


# ---------------------------------------------------------------- M4-M7


class FaqTests(VoiceCase):
    def test_create_update_move_delete(self):
        client, store_id = self.merchant()
        first = self.add_faq(client, "營業時間？", "週一到週五。", variants=[" 幾點開 ", "", "幾點關"])
        self.assertEqual({k: first[k] for k in ("question", "answer", "variants", "aiAllowed", "position", "chars", "needsInput")},
                         {"question": "營業時間？", "answer": "週一到週五。", "variants": ["幾點開", "幾點關"], "aiAllowed": True,
                          "position": 0, "chars": 5 + 6 + 3 + 3, "needsInput": False})
        second = self.add_faq(client, "洗牙費用？", "（請填入：價格）元。", aiAllowed=False)
        third = self.add_faq(client, "停車？", "有。", position=0)
        listing = self.ok(client.get(BASE + "/me/voice/faqs"))
        self.assertEqual([f["question"] for f in listing["faqs"]], ["停車？", "營業時間？", "洗牙費用？"])
        self.assertEqual([f["position"] for f in listing["faqs"]], [0, 1, 2])
        self.assertEqual(listing["faqs"][2]["needsInput"], True)
        self.assertFalse(listing["faqs"][2]["aiAllowed"])
        self.assertEqual(listing["capacity"], {"kbChars": 17 + 15 + 5, "kbCharsMax": 6000, "faqCount": 3, "faqMax": 120, "introChars": 0})
        body = self.ok(self.post(client, "/me/voice/faqs/" + second["id"], {"answer": "300 元。", "position": 0}))
        self.assertEqual((body["faq"]["answer"], body["faq"]["position"], body["faq"]["needsInput"]), ("300 元。", 0, False))
        self.assertEqual(body["capacity"]["kbChars"], 17 + 11 + 5)
        self.assertEqual(self.ok(self.post(client, "/me/voice/faqs/" + second["id"], {"position": 99}))["faq"]["position"], 2)
        body = self.ok(self.call(client, "DELETE", "/me/voice/faqs/" + third["id"]))
        self.assertEqual((body["ok"], body["capacity"]["faqCount"]), (True, 2))
        self.assertEqual([f["position"] for f in self.ok(client.get(BASE + "/me/voice/faqs"))["faqs"]], [0, 1])
        self.error(self.call(client, "DELETE", "/me/voice/faqs/" + third["id"]), 404, "faq_not_found")
        # An update that changes nothing is not audited.
        self.ok(self.post(client, "/me/voice/faqs/" + first["id"], {"question": "營業時間？"}))
        self.assertEqual(len(self.audit("voice.faq_created")), 3)
        self.assertEqual(len(self.audit("voice.faq_updated")), 2)
        self.assertEqual(self.details("voice.faq_deleted"), [{"faqId": third["id"], "faqCount": 2, "kbChars": 17 + 11}])
        self.assertEqual({e["target_id"] for e in rows(self.store, "audit_events") if e["action"].startswith("voice.")}, {store_id})

    def test_faq_validation(self):
        client, _ = self.merchant()
        cases = [
            ({"question": "", "answer": "答"}, "invalid_input"),
            ({"answer": "答"}, "invalid_input"),
            ({"question": "問" * 101, "answer": "答"}, "invalid_input"),
            ({"question": "問\n題", "answer": "答"}, "invalid_input"),
            ({"question": "問", "answer": " "}, "invalid_input"),
            ({"question": "問", "answer": "答" * 401}, "invalid_input"),
            ({"question": "問", "answer": "a\x07b"}, "invalid_input"),
            ({"question": "問", "answer": "答", "variants": "似"}, "invalid_input"),
            ({"question": "問", "answer": "答", "variants": ["似" * 51]}, "invalid_input"),
            ({"question": "問", "answer": "答", "variants": ["似%d" % n for n in range(11)]}, "invalid_input"),
            ({"question": "問", "answer": "答", "aiAllowed": "no"}, "invalid_input"),
            ({"question": "問", "answer": "答", "position": -1}, "invalid_input"),
            ({"question": "問", "answer": "答", "position": 1.5}, "invalid_input"),
            ({"question": "問" * 100, "answer": "答" * 301}, "faq_too_long"),
            ({"question": "問" * 50, "answer": "答" * 300, "variants": ["似" * 50, "似"]}, "faq_too_long"),
        ]
        for body, code in cases:
            with self.subTest(body=str(body)[:60]):
                self.error(self.post(client, "/me/voice/faqs", body), 400, code)
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/faqs"))["faqs"], [])
        # Limits are inclusive; empty variants are dropped before counting.
        faq = self.add_faq(client, "問" * 100, "答" * 290, variants=["似" * 10] + [" "] * 20)
        self.assertEqual((faq["chars"], faq["variants"]), (400, ["似" * 10]))
        self.error(self.post(client, "/me/voice/faqs/" + faq["id"], {"answer": "答" * 291}), 400, "faq_too_long")

    def test_capacity_is_checked_inside_the_write(self):
        client, store_id = self.merchant()
        with self.store.connect() as con:
            for n in range(119):
                vs.add_faq(con, store_id, "問%d" % n, "答")
        self.add_faq(client, "第一百二十題", "答")
        self.error(self.post(client, "/me/voice/faqs", {"question": "多一題", "answer": "答"}), 400, "faq_limit")
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/faqs"))["capacity"]["faqCount"], 120)
        other, other_id = self.merchant("kb@example.test")
        kept = self.add_faq(other, "問", "答" * 9)  # 10 characters
        self.ok(self.post(other, "/me/voice/setup", {"introText": "介" * 5980}))
        self.add_faq(other, "問", "答" * 9)  # 6,000 exactly
        self.error(self.post(other, "/me/voice/faqs", {"question": "問", "answer": "答"}), 400, "kb_too_large")
        self.error(self.post(other, "/me/voice/faqs/" + kept["id"], {"answer": "答" * 10}), 400, "kb_too_large")
        self.error(self.post(other, "/me/voice/setup", {"introText": "介" * 5981}), 400, "kb_too_large")
        self.assertEqual(self.ok(other.get(BASE + "/me/voice/faqs"))["capacity"]["kbChars"], 6000)
        # Shrinking is always possible.
        self.ok(self.post(other, "/me/voice/faqs/" + kept["id"], {"answer": "答"}))


# ---------------------------------------------------------------- M8 CSV import


BAD_ROWS_CSV = (
    "問題,答案,相似問法\n"              # row 1
    "營業時間？,週一到週五,幾點開門｜幾點關門\n"  # row 2
    "洗牙多少錢？,,\n"                 # row 3: answer_required
    ",,\n"                             # row 4: blank, skipped
    "\"可以刷卡嗎？\",\"可以，\n接受信用卡。\",\n"  # row 5: one row over two lines
    + "問" * 101 + ",答,\n"             # row 6: question_too_long
    "有停車場嗎？,有,停車;車位\n"        # row 7
    "有​兒科嗎？,有,\n"            # row 8: unsafe_text
)


class ImportTests(VoiceCase):
    def run_import(self, client, csv_text, mode="append", dry_run=True):
        return self.post(client, "/me/voice/faqs/import", {"csv": csv_text, "mode": mode, "dryRun": dry_run})

    def test_three_bad_rows_are_reported_by_spreadsheet_row(self):
        client, _ = self.merchant()
        self.add_faq(client)
        body = self.ok(self.run_import(client, BAD_ROWS_CSV))
        self.assertEqual(body["errors"], [{"row": 3, "problem": "answer_required"}, {"row": 6, "problem": "question_too_long"},
                                          {"row": 8, "problem": "unsafe_text"}])
        self.assertEqual((body["dryRun"], body["ok"], body["rows"], body["errorsTruncated"], body["capacityProblem"]),
                         (True, False, 6, False, None))
        self.assertEqual(body["result"]["faqCount"], 1 + 3)
        response = self.run_import(client, BAD_ROWS_CSV, dry_run=False)
        self.error(response, 400, "csv_invalid")
        self.assertIn("Rows 3, 6, 8 have problems; nothing was imported.", response.json()["detail"])
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/faqs"))["capacity"]["faqCount"], 1)
        self.assertEqual(self.audit("voice.faqs_imported"), [])

    def test_check_then_import_append_and_replace(self):
        client, _ = self.merchant()
        self.ok(self.post(client, "/me/voice/setup", {"introText": "介紹"}))
        self.add_faq(client, "原本的題目？", "原本的答案。", aiAllowed=False)
        csv_text = "﻿Question , ANSWER,Variants,備註\r\n營業時間？,週一到週五,幾點開門｜幾點關門;營業;\r\n\r\n停車？,\"有，\n在後面\",\r\n"
        check = self.ok(self.run_import(client, csv_text))
        self.assertEqual((check["ok"], check["rows"], check["errors"], check["result"]),
                         (True, 2, [], {"faqCount": 3, "kbChars": 2 + 12 + (5 + 5 + 4 + 4 + 2) + (3 + 6)}))
        self.assertEqual(self.audit("voice.faqs_imported"), [])
        body = self.ok(self.run_import(client, csv_text, dry_run=False))
        self.assertEqual((body["imported"], body["mode"], body["capacity"]["faqCount"]), (2, "append", 3))
        self.assertEqual([f["question"] for f in body["faqs"]], ["原本的題目？", "營業時間？", "停車？"])
        self.assertEqual(body["faqs"][1]["variants"], ["幾點開門", "幾點關門", "營業"])
        self.assertEqual(body["faqs"][2]["answer"], "有，\n在後面")
        self.assertTrue(all(f["aiAllowed"] for f in body["faqs"][1:]))
        body = self.ok(self.run_import(client, "問題,答案\n只剩這題？,對。\n", mode="replace", dry_run=False))
        self.assertEqual(([f["question"] for f in body["faqs"]], [f["position"] for f in body["faqs"]]), (["只剩這題？"], [0]))
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/setup"))["setup"]["introText"], "介紹")
        self.assertEqual(self.details("voice.faqs_imported"),
                         [{"mode": "append", "rows": 2, "faqCount": 3, "kbChars": 2 + 12 + 20 + 9},
                          {"mode": "replace", "rows": 1, "faqCount": 1, "kbChars": 2 + 7}])

    def test_each_row_problem(self):
        client, _ = self.merchant()
        cases = {
            ",答": "question_required",
            "問,": "answer_required",
            "問" * 101 + ",答": "question_too_long",
            "問,答," + "似" * 51: "variant_too_long",
            "問,答,a|b|c|d|e|f|g|h|i|j|k": "too_many_variants",
            "問" * 100 + "," + "答" * 301: "faq_too_long",
            "問\x07,答": "unsafe_text",
            "問,答\x00案": "unsafe_text",
            "問,答,似​": "unsafe_text",
            ",": None,  # blank row
        }
        for line, problem in cases.items():
            with self.subTest(problem=problem, line=line[:20]):
                body = self.ok(self.run_import(client, "問題,答案,相似問法\n" + line + "\n"))
                self.assertEqual(body["errors"], [{"row": 2, "problem": problem}] if problem else [])
                self.assertEqual(body["rows"], 1 if problem else 0)
        self.error(self.run_import(client, "問題,答案\n,\n", dry_run=False), 400, "csv_invalid")

    def test_header_empty_and_unparseable_files(self):
        client, _ = self.merchant()
        for text in ("name,reply\n問,答\n", "", "\n問題,答案\n", "答案,相似問法\n答,似\n"):
            with self.subTest(text=text):
                body = self.ok(self.run_import(client, text))
                self.assertEqual((body["errors"], body["rows"], body["ok"]), ([{"row": 1, "problem": "header_invalid"}], 0, False))
        huge = "問題,答案\n\"" + "x" * 131073 + "\",答\n問,答\n"
        body = self.ok(self.run_import(client, huge))
        self.assertEqual(body["errors"], [{"row": 2, "problem": "csv_unparseable"}])

    def test_capacity_problem_and_error_truncation(self):
        client, store_id = self.merchant()
        with self.store.connect() as con:
            for n in range(119):
                vs.add_faq(con, store_id, "問%d" % n, "答")
        two = "問題,答案\n甲,乙\n丙,丁\n"
        body = self.ok(self.run_import(client, two))
        self.assertEqual((body["ok"], body["capacityProblem"], body["result"]["faqCount"]), (False, "faq_limit", 121))
        self.error(self.run_import(client, two, dry_run=False), 400, "faq_limit")
        self.assertEqual(self.ok(self.run_import(client, two, mode="replace"))["capacityProblem"], None)
        bad = "問題,答案\n" + "問,\n" * 60
        body = self.ok(self.run_import(client, bad))
        self.assertEqual((len(body["errors"]), body["errorsTruncated"], body["errors"][-1]["row"]), (50, True, 51))
        response = self.run_import(client, bad, dry_run=False)
        self.assertIn("Rows 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 and more have problems", response.json()["detail"])

    def test_body_limit_is_192_kib(self):
        client, _ = self.merchant()
        # 120 KB of CSV: over the 64 KB default of other routes, under the import limit.
        rows_text = "問題,答案\n" + "".join("問%d,%s\n" % (n, "答" * 99) for n in range(400))
        payload = json.dumps({"csv": rows_text, "mode": "append", "dryRun": True}, ensure_ascii=False).encode("utf-8")
        self.assertTrue(65536 < len(payload) <= vm.CSV_BODY_BYTES, len(payload))
        response = client.post(BASE + "/me/voice/faqs/import", content=payload, headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.assertEqual((response.status_code, response.json()["rows"]), (200, 400))
        too_big = json.dumps({"csv": "x" * (vm.CSV_BODY_BYTES + 1), "mode": "append"})
        response = client.post(BASE + "/me/voice/faqs/import", content=too_big.encode("ascii"),
                               headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.error(response, 413, "invalid_input")

    def test_field_validation(self):
        client, _ = self.merchant()
        for body in ({"mode": "append"}, {"csv": 3, "mode": "append"}, {"csv": "", "mode": "merge"}, {"csv": "", "mode": "append", "dryRun": "yes"}):
            with self.subTest(body=body):
                self.error(self.post(client, "/me/voice/faqs/import", body), 400, "invalid_input")


# ---------------------------------------------------------------- M9 templates


class TemplateTests(VoiceCase):
    def template(self, name):
        return json.loads((TEMPLATE_DIR / (name + ".json")).read_text(encoding="utf-8"))

    def test_from_template_append_replace_and_intro(self):
        client, _ = self.merchant()
        template = self.template("clinic")
        expected_needs = sum(1 for f in template["faqs"] if any(vc.has_placeholder(t) for t in [f["question"], f["answer"], *f.get("variants", [])]))
        self.assertGreater(expected_needs, 0)
        self.add_faq(client, "自己的題目？", "自己的答案。")
        body = self.ok(self.post(client, "/me/voice/faqs/from-template", {"mode": "append"}))
        self.assertEqual((body["added"], body["needsInput"], body["introReplaced"]), (len(template["faqs"]), expected_needs, False))
        self.assertEqual(body["capacity"]["faqCount"], 1 + len(template["faqs"]))
        self.assertEqual(body["faqs"][1]["question"], template["faqs"][0]["question"].strip())
        self.assertEqual(sum(f["needsInput"] for f in body["faqs"]), expected_needs)
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/faqs"))["template"],
                         {"available": True, "templateId": "clinic", "title": template["title"], "faqCount": len(template["faqs"])})
        body = self.ok(self.post(client, "/me/voice/faqs/from-template", {"mode": "replace", "includeIntro": True}))
        self.assertEqual((body["capacity"]["faqCount"], body["introReplaced"]), (len(template["faqs"]), True))
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/setup"))["setup"]["introText"], template["intro_text"].strip())
        self.assertNotIn("example_values", json.dumps(body, ensure_ascii=False))
        self.assertEqual([d["mode"] for d in self.details("voice.faqs_from_template")], ["append", "replace"])
        self.assertEqual(self.details("voice.faqs_from_template")[1],
                         {"templateId": "clinic", "mode": "replace", "added": len(template["faqs"]), "introReplaced": True,
                          "faqCount": len(template["faqs"]), "kbChars": body["capacity"]["kbChars"]})

    def test_store_without_template_id_uses_its_industry_and_other_has_none(self):
        cram, _ = self.merchant("c@example.test", industry="cram", template_id=None)
        self.assertEqual(self.ok(self.post(cram, "/me/voice/faqs/from-template", {"mode": "append"}))["added"],
                         len(self.template("cram")["faqs"]))
        other, _ = self.merchant("o@example.test", industry="other", template_id=None)
        self.error(self.post(other, "/me/voice/faqs/from-template", {"mode": "append"}), 404, "template_not_found")
        self.assertEqual(self.ok(other.get(BASE + "/me/voice/faqs"))["template"], {"available": False})
        self.error(self.post(other, "/me/voice/faqs/from-template", {"mode": "both"}), 400, "invalid_input")
        self.error(self.post(other, "/me/voice/faqs/from-template", {"mode": "append", "includeIntro": 1}), 400, "invalid_input")

    def test_template_capacity_is_checked_for_the_whole_batch(self):
        client, store_id = self.merchant()
        with self.store.connect() as con:
            for n in range(100):
                vs.add_faq(con, store_id, "問%d" % n, "答")
        self.error(self.post(client, "/me/voice/faqs/from-template", {"mode": "append"}), 400, "faq_limit")
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/faqs"))["capacity"]["faqCount"], 100)
        self.ok(self.post(client, "/me/voice/setup", {"introText": "介" * 5000}))
        self.error(self.post(client, "/me/voice/faqs/from-template", {"mode": "replace"}), 400, "kb_too_large")
        self.assertEqual(self.ok(client.get(BASE + "/me/voice/faqs"))["capacity"]["faqCount"], 100)
        self.assertEqual(self.audit("voice.faqs_from_template"), [])


# ---------------------------------------------------------------- M10, M11


class PublishTests(VoiceCase):
    def recompiled(self, store_id, version):
        """An independent recompilation of the stored draft with voice_compile (not through the routes)."""
        with self.store.connect() as con:
            row = vs.get_store(con, store_id)
            config = vc.compile_store({k: row[k] for k in vm.COMPILE_KEYS}, vs.list_faqs(con, store_id),
                                      vs.get_hours(con, store_id), vs.get_closures(con, store_id), version=version)
        return config, hashlib.sha256(json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def test_publish_versions_hashes_and_no_op(self):
        client, store_id = self.merchant()
        self.error(self.post(client, "/me/voice/publish", {}), 409, "kb_empty")
        self.add_faq(client, "營業時間？", "（請填入）")
        body = self.ok(self.post(client, "/me/voice/publish", {}))
        config, digest = self.recompiled(store_id, 1)
        self.assertEqual((body["changed"], body["version"], body["configSha256"]), (True, 1, digest))
        self.assertEqual([w["code"] for w in body["warnings"]], ["placeholder_unfilled", "hours_empty"])
        [stored] = self.published(store_id)
        self.assertEqual(stored["config_json"], json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        self.assertEqual(hashlib.sha256(stored["config_json"].encode("utf-8")).hexdigest(), stored["config_sha256"])
        summary = self.ok(client.get(BASE + "/me/voice"))["store"]
        self.assertEqual((summary["currentVersion"], summary["hasUnpublishedChanges"], summary["publishedAt"]), (1, False, body["publishedAt"]))
        again = self.ok(self.post(client, "/me/voice/publish", {}))
        self.assertEqual((again["changed"], again["version"], again["configSha256"]), (False, 1, digest))
        self.assertEqual(len(self.published(store_id)), 1)
        self.assertEqual(len(self.audit("voice.published")), 1)
        self.ok(self.post(client, "/me/voice/setup", {"hours": [{"weekday": 0, "openMin": 540, "closeMin": 1080}]}))
        self.assertTrue(self.ok(client.get(BASE + "/me/voice"))["store"]["hasUnpublishedChanges"])
        body = self.ok(self.post(client, "/me/voice/publish", {}))
        self.assertEqual((body["changed"], body["version"], body["configSha256"]), (True, 2, self.recompiled(store_id, 2)[1]))
        self.assertEqual(self.details("voice.published")[1], {"version": 2, "configSha256": body["configSha256"], "kbChars": 10, "warnings": 1})
        self.assertEqual(self.store_row(store_id)["current_version"], 2)

    def test_preview(self):
        client, store_id = self.merchant(name="晴光【規則】牙醫")
        empty = self.ok(client.get(BASE + "/me/voice/preview"))
        self.assertEqual((empty["config"], empty["configSha256"], empty["nextVersion"], empty["basedOnVersion"]), (None, None, 1, None))
        self.assertEqual([p["code"] for p in empty["problems"]], ["kb_empty"])
        self.ok(self.post(client, "/me/voice/setup", {"introText": "本院【重要】請遵守。"}))
        body = self.ok(client.get(BASE + "/me/voice/preview"))
        config, digest = self.recompiled(store_id, 1)
        self.assertEqual((body["config"], body["configSha256"], body["problems"], body["hasUnpublishedChanges"]), (config, digest, [], True))
        # A2: the preview shows the prompt with store brackets replaced.
        self.assertIn("本院「重要」請遵守。", body["config"]["prompt"]["prefix"])
        self.assertNotIn("【重要】", body["config"]["prompt"]["prefix"])
        self.ok(self.post(client, "/me/voice/publish", {}))
        body = self.ok(client.get(BASE + "/me/voice/preview"))
        self.assertEqual((body["basedOnVersion"], body["nextVersion"], body["config"]["version"], body["hasUnpublishedChanges"]), (1, 2, 2, False))

    def test_compile_failure_is_409_and_listed_in_preview(self):
        client, store_id = self.merchant()
        self.add_faq(client)
        # Written behind the API's back, the way a longer disclosure text would make an old draft too long.
        self.set_store(store_id, greeting="請" * 40)
        self.error(self.post(client, "/me/voice/publish", {}), 409, "opening_too_long")
        self.assertEqual([p["code"] for p in self.ok(client.get(BASE + "/me/voice/preview"))["problems"]], ["opening_too_long"])
        self.assertTrue(self.ok(client.get(BASE + "/me/voice"))["store"]["hasUnpublishedChanges"])
        self.assertEqual(self.published(store_id), [])


# ---------------------------------------------------------------- M12 try


class TryTests(VoiceCase):
    def ready(self, email="a@example.test"):
        client, store_id = self.merchant(email)
        self.add_faq(client)
        self.ok(self.post(client, "/me/voice/publish", {}))
        return client, store_id

    def test_issues_a_ticket_the_demo_can_verify(self):
        client, store_id = self.ready()
        body = self.ok(self.post(client, "/me/voice/try", {}))
        self.assertEqual(set(body), {"ticket", "url", "expiresAt", "version", "remaining"})
        self.assertEqual((body["url"], body["version"], body["remaining"]), (TRY_URL + "/", 1, 19))
        self.assertNotIn("?", body["url"])
        self.assertNotIn("#", body["url"])
        payload = vt.verify(body["ticket"], SECRET, ledger=vt.NonceLedger())
        [stored] = self.published(store_id)
        self.assertEqual(hashlib.sha256(vc.canonical_json(payload["config"])).hexdigest(), stored["config_sha256"])
        self.assertEqual((payload["store_id"], payload["config_version"], payload["exp"] - payload["iat"]), (store_id, 1, 900))
        self.assertEqual(body["expiresAt"], iso(payload["exp"]))
        self.assertEqual(self.details("voice.try_issued"), [{"version": 1, "ticketChars": len(body["ticket"])}])
        stored_text = database_text(self.store)
        for secret in (body["ticket"], body["ticket"].split(".")[1], payload["nonce"]):
            self.assertNotIn(secret, stored_text)
        with self.assertRaises(vt.TicketError):
            vt.verify(body["ticket"], "another-test-only-value-1111111111", ledger=vt.NonceLedger())
        summary = self.ok(client.get(BASE + "/me/voice"))["try"]
        self.assertEqual((summary["used"], summary["remaining"]), (1, 19))
        self.assertIsNotNone(summary["lastIssuedAt"])

    def test_not_published_comes_before_unavailable(self):
        client, _ = self.merchant()
        self.add_faq(client)
        self.error(self.post(client, "/me/voice/try", {}), 409, "not_published")

    def test_missing_or_bad_try_settings_answer_503(self):
        self.ready()
        for changes in ({"voice_try_secret": ""}, {"voice_try_secret": "x" * 31}, {"voice_try_url": ""},
                        {"voice_try_url": "http://try.example.test"}, {"voice_try_url": "https://try.example.test/?t=1"}):
            with self.subTest(changes=changes):
                client = self.login("a@example.test", self.other_app(**changes))
                self.error(self.post(client, "/me/voice/try", {}), 503, "voice_try_unavailable")
                self.assertFalse(self.ok(client.get(BASE + "/me/voice"))["try"]["available"])
        self.assertEqual(self.audit("voice.try_issued"), [])
        client = self.login("a@example.test", self.other_app(voice_try_url="https://try.example.test/"))
        self.assertEqual(self.ok(self.post(client, "/me/voice/try", {}))["url"], "https://try.example.test/")

    def test_the_21st_try_in_24_hours_is_429(self):
        client, store_id = self.ready()
        for n in range(20):
            self.assertEqual(self.ok(self.post(client, "/me/voice/try", {}))["remaining"], 19 - n)
        self.error(self.post(client, "/me/voice/try", {}), 429, "voice_try_limit")
        self.assertEqual(self.ok(client.get(BASE + "/me/voice"))["try"]["remaining"], 0)
        self.assertEqual(len(self.audit("voice.try_issued")), 20)
        # Another store has its own 20.
        other, _ = self.ready("b@example.test")
        self.ok(self.post(other, "/me/voice/try", {}))
        # A rolling window: once the oldest tries are more than 24 hours old, tries are available again.
        with self.store.connect() as con:
            con.execute("UPDATE audit_events SET created_at=created_at-86401 WHERE action='voice.try_issued' AND target_id=?", (store_id,))
        self.assertEqual(self.ok(self.post(client, "/me/voice/try", {}))["remaining"], 19)

    def test_concurrent_tries_issue_exactly_20(self):
        client, store_id = self.ready()
        start = threading.Barrier(25)

        def attempt(_):
            start.wait(timeout=15)
            return self.post(client, "/me/voice/try", {})

        with ThreadPoolExecutor(max_workers=25) as pool:
            responses = list(pool.map(attempt, range(25)))
        statuses = sorted(r.status_code for r in responses)
        self.assertEqual((statuses.count(200), statuses.count(429)), (20, 5), statuses)
        self.assertEqual(len([e for e in self.audit("voice.try_issued") if e["target_id"] == store_id]), 20)
        nonces = {vt.verify(r.json()["ticket"], SECRET, ledger=vt.NonceLedger())["nonce"] for r in responses if r.status_code == 200}
        self.assertEqual(len(nonces), 20)


# ---------------------------------------------------------------- audit privacy


class AuditPrivacyTests(VoiceCase):
    def test_audit_never_holds_store_content(self):
        client, _ = self.merchant(name="隱私測試店")
        secrets_ = ["隱私開場白", "隱私介紹內容", "隱私問題甲", "隱私答案甲", "隱私相似問法", "隱私匯入問題", "隱私匯入答案", "隱私休假備註"]
        self.ok(self.post(client, "/me/voice/setup", {"greeting": secrets_[0], "introText": secrets_[1],
                                                      "closures": [{"date": "2026-12-25", "note": secrets_[7]}]}))
        faq = self.add_faq(client, secrets_[2], secrets_[3], variants=[secrets_[4]])
        self.ok(self.post(client, "/me/voice/faqs/" + faq["id"], {"answer": secrets_[3] + "改"}))
        self.ok(self.post(client, "/me/voice/faqs/import", {"csv": "問題,答案\n%s,%s\n" % (secrets_[5], secrets_[6]), "mode": "append"}))
        self.ok(self.post(client, "/me/voice/faqs/from-template", {"mode": "append"}))
        self.ok(self.post(client, "/me/voice/publish", {}))
        ticket = self.ok(self.post(client, "/me/voice/try", {}))["ticket"]
        self.ok(self.call(client, "DELETE", "/me/voice/faqs/" + faq["id"]))
        actions = {e["action"] for e in rows(self.store, "audit_events")}
        self.assertTrue({"voice.setup_saved", "voice.faq_created", "voice.faq_updated", "voice.faqs_imported", "voice.faqs_from_template",
                         "voice.published", "voice.try_issued", "voice.faq_deleted"} <= actions, actions)
        audit = self.audit_text()
        template = json.loads((TEMPLATE_DIR / "clinic.json").read_text(encoding="utf-8"))
        for text in secrets_ + ["隱私測試店", template["faqs"][0]["question"], ticket.split(".")[0][:40]]:
            self.assertNotIn(text, audit)
        self.assertNotIn(ticket, database_text(self.store))


# ---------------------------------------------------------------- front-end contract sync


FRONTEND_ROOT = Path(os.environ.get("PC_VOICE_FRONTEND_ROOT") or Path(__file__).resolve().parents[1])
FRONTEND_SHELL = FRONTEND_ROOT / "components" / "account-voice.tsx"


@unittest.skipUnless(FRONTEND_SHELL.is_file(), "components/account-voice.tsx is on the frontend branch; runs once both are merged")
class FrontendSyncTests(unittest.TestCase):
    """The limit keys and store statuses the account pages know must be exactly the backend's."""

    def source(self):
        return FRONTEND_SHELL.read_text(encoding="utf-8")

    def block(self, start):
        text = self.source()
        begin = text.index(start)
        return text[begin:text.index("};", begin)]

    def test_limit_keys_match(self):
        keys = re.findall(r"^\s*(\w+): number;", self.block("export type VoiceLimits = {"), re.MULTILINE)
        self.assertEqual(sorted(keys), sorted(vm.LIMITS))

    def test_status_values_match(self):
        keys = re.findall(r"^\s*(\w+): \[", self.block("const STATUS: Record<string, [string, string]> = {"), re.MULTILINE)
        self.assertEqual(sorted(keys), sorted(vs.STATUSES))


if __name__ == "__main__":
    unittest.main()
