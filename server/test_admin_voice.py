"""Operator phone-agent routes A1-A8 (server/admin_voice.py; phase1-contract.md §1, §4 and amendments A1-A9).

Runs on SQLite, or on Postgres when PC_PORTAL_TEST_DATABASE_URL is set (scripts/test_backend_postgres.sh)."""
import json
import os
import re
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from server import admin_voice as av
from server import voice_merchant as vm
from server import voice_store as vs
from server.security import verify_password
from server.settings import Settings
from server.support import PortalContext, PortalError
from server.testsupport import BASE, ORIGIN, PASSWORD, FakeGateway, PortalCase, database_text, fresh_database, rows

TAIPEI = timezone(timedelta(hours=8))
OTHER_ID = "0123456789abcdef0123456789abcdef"
NOT_FOUND = {"error": "not_found", "detail": "This portal endpoint is not available for this request."}
OPEN_BODY = {"email": "owner@clinic.example", "displayName": "林小姐", "storeName": "晴光牙醫診所", "industry": "clinic"}
# Contract §4: the StoreItem and Number objects, key for key.
STORE_ITEM_KEYS = {"id", "name", "industry", "status", "owner", "currentVersion", "faqCount", "kbChars", "lastTryAt",
                   "aiAnswerEnabled", "recordingMode", "createdAt", "updatedAt"}
NUMBER_KEYS = {"id", "number", "storeId", "storeName", "purpose", "channel", "activeFrom", "activeUntil", "note",
               "activeNow", "createdAt", "updatedAt"}
# Contract §4.4, copied from the table (not from admin_voice.TRANSITIONS): row = current, column = target.
EXPECTED_TRANSITIONS = """
            draft               testing             live                suspended
draft       same                ok                  live_requires_g2a   ok
testing     ok                  same                live_requires_g2a   ok
live        invalid_transition  invalid_transition  same                ok
suspended   invalid_transition  ok                  live_requires_g2a   same
"""


def expected_transitions():
    lines = [line.split() for line in EXPECTED_TRANSITIONS.strip().splitlines()]
    targets = lines[0]
    return {(cells[0], target): cell for cells in lines[1:] for target, cell in zip(targets, cells[1:])}


def number_body(**changes):
    return dict({"number": "+886227356688", "storeId": None, "purpose": "test", "channel": "online",
                 "activeFrom": "2026-11-01", "activeUntil": None, "note": ""}, **changes)


def admin_routes(store_id=OTHER_ID, number_id=OTHER_ID):
    """Every operator route as (method, path, body); bodies are valid enough to reach the checks under test."""
    return [("GET", "/admin/voice/stores", None), ("POST", "/admin/voice/stores", OPEN_BODY),
            ("GET", "/admin/voice/stores/" + store_id, None),
            ("POST", "/admin/voice/stores/" + store_id + "/status", {"status": "testing"}),
            ("GET", "/admin/voice/numbers", None), ("POST", "/admin/voice/numbers", number_body()),
            ("POST", "/admin/voice/numbers/" + number_id, number_body()),
            ("DELETE", "/admin/voice/numbers/" + number_id, None)]


def taipei_epoch(day):
    return int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=TAIPEI).timestamp())


class AdminVoiceCase(PortalCase):
    voice_enabled = True

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,),
                                 voice_enabled=self.voice_enabled)
        self.gateway = FakeGateway()
        from server.app import create_app

        self.app = create_app(self.settings, gateway=self.gateway)
        self.store = self.app.state.store
        self.clients = []

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

    def login(self, email, password=PASSWORD):
        client = self.client()
        response = self.post(client, "/auth/login", {"email": email, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return client

    def customer(self, email="customer@example.test"):
        self.store.create_user(email, "Customer", PASSWORD)
        return self.login(email)

    def open_store(self, operator, **changes):
        return self.ok(self.post(operator, "/admin/voice/stores", dict(OPEN_BODY, **changes)), 201)

    def add_number(self, operator, status=201, **changes):
        response = self.post(operator, "/admin/voice/numbers", number_body(**changes))
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def count(self, table):
        return len(rows(self.store, table))

    def written(self):
        """Row counts and store statuses: what a refused request must leave exactly as it was."""
        return {"users": self.count("users"), "voice_stores": sorted((r["id"], r["status"]) for r in rows(self.store, "voice_stores")),
                "voice_numbers": sorted((r["id"], r["number"], r["active_from"], r["active_to"], r["note"]) for r in rows(self.store, "voice_numbers")),
                "audit": self.count("audit_events")}

    def details(self, action):
        return [json.loads(e["details"]) if e["details"] else None for e in self.audit(action)]


# ---------------------------------------------------------------- §1.1 switch, §1.3 who may call


class SwitchTests(AdminVoiceCase):
    voice_enabled = False

    def test_every_route_is_a_plain_404_for_an_admin_while_the_switch_is_off(self):
        operator = self.admin()
        customer = self.customer()
        anonymous = self.client()
        before = self.written()
        for method, path, body in admin_routes():
            with self.subTest(method=method, path=path):
                response = self.call(operator, method, path, body)
                self.assertEqual((response.status_code, response.json()), (404, NOT_FOUND))
                # Sign-in is checked first on /admin (server/test_routes.py), so the switch tells them nothing new.
                self.error(self.call(customer, method, path, body), 403, "admin_required")
                self.error(self.call(anonymous, method, path, body), 401, "auth_required")
        self.assertEqual(self.written(), before)


class AccessTests(AdminVoiceCase):
    def test_anonymous_is_401_and_customer_is_403_on_every_route(self):
        operator = self.admin()
        opened = self.open_store(operator)
        number = self.add_number(operator)["number"]
        customer = self.customer()
        # A store owner is a customer too: owning a store gives no operator access.
        owner = self.client()
        self.post(owner, "/auth/login", {"email": OPEN_BODY["email"], "password": opened["temporaryPassword"]})
        anonymous = self.client()
        before = self.written()
        for method, path, body in admin_routes(opened["store"]["id"], number["id"]) + admin_routes():
            with self.subTest(method=method, path=path):
                self.error(self.call(anonymous, method, path, body), 401, "auth_required")
                self.error(self.call(customer, method, path, body), 403, "admin_required")
                self.error(self.call(owner, method, path, body), 403, "admin_required")
        self.assertEqual(self.written(), before)

    def test_writes_recheck_the_admin_inside_the_lock(self):
        """current_user() ran before BEGIN IMMEDIATE; an admin demoted or disabled in between must be refused there."""
        admin_row = self.store.create_user("ops@example.test", "Ops", PASSWORD, role="admin")
        owner = self.store.create_user("seed-owner@example.test", "Owner", PASSWORD)
        with self.store.connect() as con:
            store_id = vs.create_store(con, owner["id"], "既有診所", "clinic", template_id="clinic")["id"]
            number_id = vs.add_number(con, "+886200000001", None, "test", "online", taipei_epoch("2026-11-01"))["id"]

        app = FastAPI()

        @app.exception_handler(PortalError)
        async def portal_error(_request, error):
            return JSONResponse({"error": error.code, "detail": error.detail}, status_code=error.status)

        # The session check passes with the admin as it was; only the in-lock re-check sees the change.
        av.attach_admin_voice(app, PortalContext(self.store, self.gateway, self.settings, lambda request, admin=False: admin_row))
        stale = TestClient(app, base_url=ORIGIN)
        self.clients.append(stale)
        writes = [route for route in admin_routes(store_id, number_id) if route[0] != "GET"]
        for change in ("UPDATE users SET role='customer' WHERE id=?", "UPDATE users SET disabled_at=1 WHERE id=?"):
            with self.store.connect() as con:
                con.execute(change, (admin_row["id"],))
            before = self.written()
            for method, path, body in writes:
                with self.subTest(change=change, method=method, path=path):
                    self.error(self.call(stale, method, path, body), 403, "admin_required")
            self.assertEqual(self.written(), before)
            with self.store.connect() as con:
                con.execute("UPDATE users SET role='admin', disabled_at=NULL WHERE id=?", (admin_row["id"],))
        # Control: the same app writes once the caller is an admin again, so the 403 above came from the re-check.
        self.ok(self.call(stale, "POST", "/admin/voice/stores/" + store_id + "/status", {"status": "testing"}))


# ---------------------------------------------------------------- A2 open a store


class OpenStoreTests(AdminVoiceCase):
    def test_open_creates_a_customer_account_with_a_temporary_password_and_a_draft_store(self):
        operator = self.admin()
        result = self.open_store(operator, email=" Owner@Clinic.Example ")
        self.assertEqual(set(result), {"store", "account", "temporaryPassword"})
        password = result["temporaryPassword"]
        self.assertEqual(len(password), 24)
        self.assertEqual(result["account"]["email"], "owner@clinic.example")
        store = result["store"]
        self.assertEqual(set(store), STORE_ITEM_KEYS)
        self.assertEqual({k: store[k] for k in ("name", "industry", "status", "currentVersion", "faqCount", "kbChars", "lastTryAt",
                                                "aiAnswerEnabled", "recordingMode")},
                         {"name": "晴光牙醫診所", "industry": "clinic", "status": "draft", "currentVersion": None, "faqCount": 0,
                          "kbChars": 0, "lastTryAt": None, "aiAnswerEnabled": False, "recordingMode": "message_only"})
        self.assertEqual(store["owner"], {"id": result["account"]["userId"], "email": "owner@clinic.example", "name": "林小姐"})
        account = next(u for u in rows(self.store, "users") if u["id"] == result["account"]["userId"])
        self.assertEqual((account["email"], account["name"], account["role"]), ("owner@clinic.example", "林小姐", "customer"))
        self.assertIsNotNone(account["password_change_required_at"])
        self.assertTrue(verify_password(password, account["password_hash"]))
        row = next(s for s in rows(self.store, "voice_stores") if s["id"] == store["id"])
        # Contract §3.3 defaults and §4.2 template_id.
        self.assertEqual({k: row[k] for k in ("owner_user_id", "template_id", "greeting", "intro_text", "after_hours_mode",
                                              "ask_callback", "max_message_seconds", "handoff_mode", "recording_mode",
                                              "retention_days", "ai_answer_enabled", "current_version")},
                         {"owner_user_id": account["id"], "template_id": "clinic", "greeting": "", "intro_text": "",
                          "after_hours_mode": "answer_and_message", "ask_callback": "auto", "max_message_seconds": 120,
                          "handoff_mode": "callback", "recording_mode": "message_only", "retention_days": 90,
                          "ai_answer_enabled": 0, "current_version": None})
        self.assertEqual(self.details("admin.voice_store_created"),
                         [{"userId": account["id"], "email": "owner@clinic.example", "industry": "clinic"}])
        self.assertEqual(self.audit("admin.voice_store_created")[0]["target_id"], store["id"])

    def test_template_id_follows_the_industry(self):
        operator = self.admin()
        for index, (industry, template_id) in enumerate((("clinic", "clinic"), ("cram", "cram"), ("other", None))):
            with self.subTest(industry=industry):
                store_id = self.open_store(operator, email="t%d@example.test" % index, industry=industry)["store"]["id"]
                row = next(s for s in rows(self.store, "voice_stores") if s["id"] == store_id)
                self.assertEqual((row["industry"], row["template_id"]), (industry, template_id))

    def test_the_temporary_password_is_stored_only_as_a_hash(self):
        operator = self.admin()
        password = self.open_store(operator)["temporaryPassword"]
        self.assertNotIn(password, database_text(self.store))

    def test_owner_signs_in_with_it_but_must_change_it_before_any_write(self):
        """T4 together with T5: the opened account works at once, and M3 is 403 until the password is replaced."""
        operator = self.admin()
        opened = self.open_store(operator)
        owner = self.login(OPEN_BODY["email"], opened["temporaryPassword"])
        summary = self.ok(owner.get(BASE + "/me/voice"))
        self.assertEqual((summary["store"]["id"], summary["account"]), (opened["store"]["id"], {"passwordChangeRequired": True}))
        self.error(self.post(owner, "/me/voice/setup", {"greeting": "請問有什麼可以幫您？"}), 403, "password_change_required")
        self.ok(self.post(owner, "/password", {"currentPassword": opened["temporaryPassword"], "newPassword": "owner-chosen-password-1"}))
        self.assertEqual(self.ok(owner.get(BASE + "/me/voice"))["account"], {"passwordChangeRequired": False})
        saved = self.ok(self.post(owner, "/me/voice/setup", {"greeting": "請問有什麼可以幫您？"}))
        self.assertEqual(saved["changed"], ["greeting"])

    def test_an_email_with_an_account_is_409_and_never_linked(self):
        operator = self.admin()
        taken = self.store.create_user("taken@example.test", "Someone", PASSWORD)
        before_user = next(u for u in rows(self.store, "users") if u["id"] == taken["id"])
        before = self.written()
        self.error(self.post(operator, "/admin/voice/stores", dict(OPEN_BODY, email="  TAKEN@example.test")), 409, "account_exists")
        self.assertEqual(self.written(), before)
        self.assertEqual(next(u for u in rows(self.store, "users") if u["id"] == taken["id"]), before_user)
        # The second opening of the same email is refused the same way.
        self.open_store(operator, email="fresh@example.test")
        before = self.written()
        self.error(self.post(operator, "/admin/voice/stores", dict(OPEN_BODY, email="fresh@example.test", storeName="另一家")),
                   409, "account_exists")
        self.assertEqual(self.written(), before)

    def test_an_admin_email_is_not_linked_either(self):
        operator = self.admin()
        before = self.written()
        self.error(self.post(operator, "/admin/voice/stores", dict(OPEN_BODY, email="admin@example.test")), 409, "account_exists")
        self.assertEqual(self.written(), before)

    def test_concurrent_openings_of_one_email_create_exactly_one_account_and_store(self):
        operator = self.admin()
        start = threading.Barrier(8)

        def attempt(index):
            start.wait(timeout=15)
            return self.post(operator, "/admin/voice/stores", dict(OPEN_BODY, storeName="分店%d" % index))

        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(attempt, range(8)))
        statuses = sorted(r.status_code for r in responses)
        self.assertEqual((statuses.count(201), statuses.count(409)), (1, 7), statuses)
        self.assertEqual(len([u for u in rows(self.store, "users") if u["email"] == OPEN_BODY["email"]]), 1)
        self.assertEqual(self.count("voice_stores"), 1)
        self.assertEqual(len(self.audit("admin.voice_store_created")), 1)

    def test_account_and_store_are_one_transaction(self):
        """A failure after the account insert (here: the store insert) leaves neither behind."""
        operator = self.admin()
        before = self.written()
        with mock.patch.object(av.vs, "create_store", side_effect=self.store.IntegrityError("raced")):
            self.error(self.post(operator, "/admin/voice/stores", OPEN_BODY), 409, "account_exists")
        self.assertEqual(self.written(), before)
        with mock.patch.object(av.vs, "create_store", side_effect=RuntimeError("boom")):
            response = self.post(operator, "/admin/voice/stores", OPEN_BODY)
        self.assertEqual((response.status_code, response.json()["error"]), (500, "internal_error"))
        self.assertEqual(self.written(), before)
        self.assertNotIn(OPEN_BODY["email"], [u["email"] for u in rows(self.store, "users")])

    def test_invalid_fields_are_400_and_write_nothing(self):
        operator = self.admin()
        cases = {
            "email missing": {"email": None}, "email malformed": {"email": "owner-at-clinic"}, "email too long": {"email": "a" * 250 + "@x.tw"},
            "contact name empty": {"displayName": "  "}, "contact name too long": {"displayName": "林" * 101},
            "contact name control": {"displayName": "林\x07小姐"}, "contact name not text": {"displayName": 7},
            "store name empty": {"storeName": " "}, "store name 21 characters": {"storeName": "晴" * 21},
            "store name over 40 with spaces": {"storeName": "晴 " * 20 + "晴"}, "store name newline": {"storeName": "晴光\n診所"},
            "store name invisible": {"storeName": "晴光​診所"}, "store name bidi": {"storeName": "晴光‮診所"},
            "store name missing": {"storeName": None}, "industry unknown": {"industry": "dental"},
            "industry missing": {"industry": None}, "industry not text": {"industry": ["clinic"]},
        }
        before = self.written()
        for label, change in cases.items():
            with self.subTest(label):
                body = {k: v for k, v in dict(OPEN_BODY, **change).items() if v is not None}
                self.error(self.post(operator, "/admin/voice/stores", body), 400, "invalid_input")
        self.assertEqual(self.written(), before)

    def test_store_name_counts_20_characters_without_spaces(self):
        """A1: 20 characters, spaces not counted (and still one line of at most 40)."""
        operator = self.admin()
        name = "晴光 牙醫 診所 " + "晴" * 14  # 20 non-space characters, 23 in all
        self.assertEqual(self.open_store(operator, storeName=name)["store"]["name"], name)

    def test_body_size_is_checked_before_parsing(self):
        operator = self.admin()
        before = self.written()
        response = self.post(operator, "/admin/voice/stores", dict(OPEN_BODY, padding="x" * av.BODY_BYTES))
        self.error(response, 413, "invalid_input")
        self.assertEqual(self.written(), before)
        response = self.post(operator, "/admin/voice/numbers", number_body(padding="x" * av.BODY_BYTES))
        self.error(response, 413, "invalid_input")
        self.assertEqual(self.written(), before)


# ---------------------------------------------------------------- A1 list, A3 detail


class StoreReadTests(AdminVoiceCase):
    def test_list_is_newest_first_with_counts_from_the_store_data(self):
        operator = self.admin()
        first = self.open_store(operator, email="first@example.test", storeName="第一家")["store"]["id"]
        opened = self.open_store(operator, email="second@example.test", storeName="第二家", industry="cram")
        second = opened["store"]["id"]
        with self.store.connect() as con:
            con.execute("UPDATE voice_stores SET created_at=? WHERE id=?", (1_700_000_000, first))
            con.execute("UPDATE voice_stores SET created_at=?, intro_text=? WHERE id=?", (1_700_000_100, "我們在大安區。", second))
            vs.add_faq(con, second, "洗牙多少錢？", "健保半年一次免費。", ["洗牙費用", "要錢嗎"])
            vs.add_faq(con, second, "幾點開門？", "早上九點。", [], ai_allowed=False)
            # "Last test call" is the latest ever, not only within the 24-hour quota window (contract §1.6).
            for created_at in (1_700_000_000, 1_700_000_500, 1_700_000_200):
                con.execute("INSERT INTO audit_events (id,actor_id,action,target_id,created_at,details) VALUES (?,?,?,?,?,?)",
                            (os.urandom(16).hex(), opened["account"]["userId"], "voice.try_issued", second, created_at, None))
            # Another action on the same store is not a test call.
            self.store.audit(con, "voice.setup_saved", opened["account"]["userId"], second, {"changed": []})
        stores = self.ok(operator.get(BASE + "/admin/voice/stores"))["stores"]
        self.assertEqual([s["id"] for s in stores], [second, first])
        self.assertEqual(set(stores[0]), STORE_ITEM_KEYS)
        # §5.2: intro 7 + (6 + 9 + 4 + 3) + (5 + 5), whether or not the AI may answer it.
        self.assertEqual((stores[0]["faqCount"], stores[0]["kbChars"]), (2, 39))
        self.assertEqual(stores[0]["lastTryAt"], "2023-11-14T22:21:40Z")  # 1_700_000_500
        self.assertEqual((stores[1]["faqCount"], stores[1]["kbChars"], stores[1]["lastTryAt"]), (0, 0, None))
        self.assertEqual(stores[1]["owner"]["email"], "first@example.test")

    def test_detail_has_settings_versions_numbers_and_try_usage(self):
        operator = self.admin()
        store_id = self.open_store(operator)["store"]["id"]
        other_id = self.open_store(operator, email="other@example.test", storeName="別家")["store"]["id"]
        admin_id = self.user_id("admin@example.test")
        now = int(datetime.now(timezone.utc).timestamp())
        with self.store.connect() as con:
            for version in range(1, 53):
                vs.add_config_version(con, store_id, {"store_id": store_id, "version": version}, admin_id if version % 2 else None)
            vs.replace_hours(con, store_id, [{"weekday": 0, "open_min": 540, "close_min": 720}, {"weekday": 1, "open_min": 540, "close_min": 720}])
            vs.replace_closures(con, store_id, [{"date": "2026-12-25", "note": "院內訓練"}])
            for created_at in (now - 90_000, now - 100, now - 50):
                con.execute("INSERT INTO audit_events (id,actor_id,action,target_id,created_at,details) VALUES (?,?,?,?,?,?)",
                            (os.urandom(16).hex(), admin_id, "voice.try_issued", store_id, created_at, None))
        own = self.add_number(operator, storeId=store_id)["number"]
        self.add_number(operator, number="+886227356699", storeId=other_id)
        detail = self.ok(operator.get(BASE + "/admin/voice/stores/" + store_id))
        self.assertEqual(set(detail), {"store", "versions", "numbers", "try"})
        self.assertEqual(set(detail["store"]), STORE_ITEM_KEYS | {"greeting", "afterHoursMode", "askCallback", "maxMessageSeconds",
                                                                 "retentionDays", "hoursSegments", "closures"})
        self.assertEqual({k: detail["store"][k] for k in ("currentVersion", "hoursSegments", "closures", "retentionDays", "afterHoursMode")},
                         {"currentVersion": 52, "hoursSegments": 2, "closures": 1, "retentionDays": 90, "afterHoursMode": "answer_and_message"})
        versions = detail["versions"]
        self.assertEqual([v["version"] for v in versions], list(range(52, 2, -1)))
        self.assertEqual(set(versions[0]), {"version", "configSha256", "createdAt", "createdBy"})
        self.assertEqual((versions[0]["createdBy"], versions[1]["createdBy"]), (None, {"id": admin_id, "email": "admin@example.test"}))
        self.assertEqual([n["id"] for n in detail["numbers"]], [own["id"]])
        self.assertEqual(detail["try"]["used24h"], 2)
        self.assertEqual(detail["try"]["lastIssuedAt"], datetime.fromtimestamp(now - 50, timezone.utc).isoformat().replace("+00:00", "Z"))

    def test_unknown_or_malformed_store_is_404(self):
        operator = self.admin()
        self.open_store(operator)
        for store_id in (OTHER_ID, "not-an-id", OTHER_ID.upper()):
            with self.subTest(store_id=store_id):
                self.error(operator.get(BASE + "/admin/voice/stores/" + store_id), 404, "voice_store_not_found")
                self.error(self.post(operator, "/admin/voice/stores/" + store_id + "/status", {"status": "testing"}),
                           404, "voice_store_not_found")


# ---------------------------------------------------------------- A4 status


class StatusTests(AdminVoiceCase):
    def test_every_cell_of_the_transition_table(self):
        operator = self.admin()
        store_id = self.open_store(operator)["store"]["id"]
        for (current, target), expected in expected_transitions().items():
            with self.subTest(current=current, target=target):
                with self.store.connect() as con:
                    con.execute("UPDATE voice_stores SET status=? WHERE id=?", (current, store_id))
                audits = len(self.audit("admin.voice_store_status"))
                response = self.post(operator, "/admin/voice/stores/" + store_id + "/status", {"status": target})
                status = next(s["status"] for s in rows(self.store, "voice_stores") if s["id"] == store_id)
                if expected == "same":
                    self.assertEqual(self.ok(response)["changed"], False)
                    self.assertEqual((status, len(self.audit("admin.voice_store_status"))), (current, audits))
                elif expected == "ok":
                    body = self.ok(response)
                    self.assertEqual((body["changed"], body["store"]["status"], status), (True, target, target))
                    self.assertEqual(set(body["store"]), STORE_ITEM_KEYS)
                    self.assertEqual(self.details("admin.voice_store_status")[-1], {"from": current, "to": target})
                    self.assertEqual(len(self.audit("admin.voice_store_status")), audits + 1)
                else:
                    self.error(response, 409, expected)
                    self.assertEqual((status, len(self.audit("admin.voice_store_status"))), (current, audits))

    def test_unknown_status_values_are_400(self):
        operator = self.admin()
        store_id = self.open_store(operator)["store"]["id"]
        for value in ("LIVE", "Testing", "", None, 1, ["testing"], {"status": "testing"}):
            with self.subTest(value=value):
                self.error(self.post(operator, "/admin/voice/stores/" + store_id + "/status", {"status": value}), 400, "invalid_input")
        self.error(self.post(operator, "/admin/voice/stores/" + store_id + "/status", {}), 400, "invalid_input")
        self.assertEqual(self.audit("admin.voice_store_status"), [])

    def test_suspended_store_is_read_only_for_its_owner_until_testing_again(self):
        """T4 together with T5: 409 store_suspended on writes, reads still work."""
        operator = self.admin()
        opened = self.open_store(operator)
        owner = self.login(OPEN_BODY["email"], opened["temporaryPassword"])
        self.ok(self.post(owner, "/password", {"currentPassword": opened["temporaryPassword"], "newPassword": "owner-chosen-password-1"}))
        status_path = "/admin/voice/stores/" + opened["store"]["id"] + "/status"
        self.ok(self.post(operator, status_path, {"status": "suspended"}))
        self.error(self.post(owner, "/me/voice/setup", {"greeting": "您好"}), 409, "store_suspended")
        self.assertEqual(self.ok(owner.get(BASE + "/me/voice"))["store"]["status"], "suspended")
        self.ok(self.post(operator, status_path, {"status": "testing"}))
        self.assertEqual(self.ok(self.post(owner, "/me/voice/setup", {"greeting": "您好"}))["changed"], ["greeting"])


# ---------------------------------------------------------------- A5-A8 numbers


class NumberTests(AdminVoiceCase):
    def test_add_list_update_delete(self):
        operator = self.admin()
        store_id = self.open_store(operator)["store"]["id"]
        created = self.add_number(operator, storeId=store_id, activeFrom="2026-11-01", activeUntil="2026-11-30", note=" 試打線 ")["number"]
        self.assertEqual(set(created), NUMBER_KEYS)
        self.assertEqual({k: created[k] for k in NUMBER_KEYS - {"id", "createdAt", "updatedAt", "activeNow"}},
                         {"number": "+886227356688", "storeId": store_id, "storeName": "晴光牙醫診所", "purpose": "test",
                          "channel": "online", "activeFrom": "2026-11-01", "activeUntil": "2026-11-30", "note": "試打線"})
        stored = rows(self.store, "voice_numbers")[0]
        # Contract §4.6: from = 00:00 Taipei on activeFrom; to = 00:00 Taipei the day after activeUntil.
        self.assertEqual((stored["active_from"], stored["active_to"]), (taipei_epoch("2026-11-01"), taipei_epoch("2026-12-01")))
        self.assertEqual(self.ok(operator.get(BASE + "/admin/voice/numbers"))["numbers"], [created])
        updated = self.ok(self.post(operator, "/admin/voice/numbers/" + created["id"],
                                    number_body(storeId=None, purpose="demo", channel="test_line", activeFrom="2026-11-02", note="")))["number"]
        self.assertEqual({k: updated[k] for k in ("id", "storeId", "storeName", "purpose", "channel", "activeFrom", "activeUntil")},
                         {"id": created["id"], "storeId": None, "storeName": None, "purpose": "demo", "channel": "test_line",
                          "activeFrom": "2026-11-02", "activeUntil": None})
        self.assertIsNone(rows(self.store, "voice_numbers")[0]["active_to"])
        self.assertEqual(self.ok(self.call(operator, "DELETE", "/admin/voice/numbers/" + created["id"])), {"ok": True})
        self.assertEqual(self.ok(operator.get(BASE + "/admin/voice/numbers"))["numbers"], [])

    def test_number_format(self):
        operator = self.admin()
        for index, number in enumerate(("+886227356688", "+1234567", "+123456789012345", "ext-0001")):
            with self.subTest(number=number):
                self.add_number(operator, number=number)
        before = self.written()
        for number in ("886227356688", "+0123456", "+123456", "+1234567890123456", "ext-001", "ext-00001", "EXT-0001",
                       " +886227356688", "+886227356688\n", "+８８６２２７３５６６８８", "+886-2-2735-6688", "", None, 886227356688):
            with self.subTest(number=number):
                self.error(self.post(operator, "/admin/voice/numbers", number_body(number=number)), 400, "invalid_number")
        self.assertEqual(self.written(), before)

    def test_other_fields(self):
        operator = self.admin()
        self.open_store(operator)
        cases = {
            "store id malformed": ({"storeId": "abc"}, 400, "invalid_input"),
            "store id not text": ({"storeId": 5}, 400, "invalid_input"),
            "store id unknown": ({"storeId": OTHER_ID}, 404, "voice_store_not_found"),
            "purpose unknown": ({"purpose": "sales"}, 400, "invalid_input"),
            "channel unknown": ({"channel": "sip"}, 400, "invalid_input"),
            "from not a date": ({"activeFrom": "2026-02-30"}, 400, "invalid_input"),
            "from not padded": ({"activeFrom": "2026-1-5"}, 400, "invalid_input"),
            "from null": ({"activeFrom": None}, 400, "invalid_input"),
            "from too early": ({"activeFrom": "1999-12-31"}, 400, "invalid_input"),
            "until too late": ({"activeUntil": "2038-01-01"}, 400, "invalid_input"),
            "until before from": ({"activeUntil": "2026-10-31"}, 400, "invalid_input"),
            "note too long": ({"note": "備" * 81}, 400, "invalid_input"),
            "note two lines": ({"note": "備註\n第二行"}, 400, "invalid_input"),
            "note not text": ({"note": None}, 400, "invalid_input"),
        }
        before = self.written()
        for label, (change, status, code) in cases.items():
            with self.subTest(label):
                self.error(self.post(operator, "/admin/voice/numbers", number_body(**change)), status, code)
        for key in ("storeId", "purpose", "channel", "activeFrom", "activeUntil", "note"):
            with self.subTest(missing=key):
                body = number_body()
                del body[key]
                self.error(self.post(operator, "/admin/voice/numbers", body), 400, "invalid_input")
        self.assertEqual(self.written(), before)
        # The edges are allowed: the last day of 2037 (active_to still fits a 32-bit column) and an 80-character note.
        self.add_number(operator, activeFrom="2000-01-01", activeUntil="2037-12-31", note="備" * 80)

    def test_overlapping_periods_of_one_number_are_409(self):
        operator = self.admin()
        self.add_number(operator, activeFrom="2026-11-01", activeUntil="2026-11-30")
        cases = [("2026-11-30", "2026-12-10", 409), ("2026-12-01", None, 201), ("2026-10-01", "2026-10-31", 201),
                 ("2026-10-15", "2026-11-01", 409), ("2026-11-10", "2026-11-12", 409), ("2026-10-01", None, 409),
                 ("2026-01-01", "2026-12-31", 409)]
        for start, until, status in cases:
            with self.subTest(start=start, until=until):
                before = self.written()
                response = self.post(operator, "/admin/voice/numbers", number_body(activeFrom=start, activeUntil=until))
                if status == 409:
                    self.error(response, 409, "number_overlap")
                    self.assertEqual(response.json()["detail"], "+886227356688 is already active from 2026-11-01 to 2026-11-30.")
                    self.assertEqual(self.written(), before)
                else:
                    added = self.ok(response, 201)["number"]
                    self.ok(self.call(operator, "DELETE", "/admin/voice/numbers/" + added["id"]))
        # Another number may use the same period; an open-ended period is named as such.
        self.add_number(operator, number="+886227356699", activeFrom="2026-11-01")
        response = self.post(operator, "/admin/voice/numbers", number_body(number="+886227356699", activeFrom="2027-05-01"))
        self.error(response, 409, "number_overlap")
        self.assertEqual(response.json()["detail"], "+886227356699 is already active from 2026-11-01 (no end date).")

    def test_update_ignores_its_own_period_but_not_the_others(self):
        operator = self.admin()
        first = self.add_number(operator, activeFrom="2026-11-01", activeUntil="2026-11-30")["number"]
        self.add_number(operator, activeFrom="2026-12-01", activeUntil="2026-12-31")
        path = "/admin/voice/numbers/" + first["id"]
        self.ok(self.post(operator, path, number_body(activeFrom="2026-10-01", activeUntil="2026-11-30")))
        before = self.written()
        self.error(self.post(operator, path, number_body(activeFrom="2026-10-01", activeUntil="2026-12-01")), 409, "number_overlap")
        self.assertEqual(self.written(), before)
        body = number_body(activeFrom="2026-10-01", activeUntil="2026-11-30")
        del body["note"]
        self.error(self.post(operator, path, body), 400, "invalid_input")  # A7 replaces the whole row: every field is sent

    def test_unknown_or_malformed_number_is_404(self):
        operator = self.admin()
        self.add_number(operator)
        before = self.written()
        for number_id in (OTHER_ID, "nope", OTHER_ID.upper()):
            with self.subTest(number_id=number_id):
                self.error(self.post(operator, "/admin/voice/numbers/" + number_id, number_body(number="+886200000003")), 404, "number_not_found")
                self.error(self.call(operator, "DELETE", "/admin/voice/numbers/" + number_id), 404, "number_not_found")
        self.assertEqual(self.written(), before)

    def test_list_order_and_active_now_use_taipei_dates(self):
        operator = self.admin()
        today = datetime.now(TAIPEI).date()
        day = lambda offset: (today + timedelta(days=offset)).isoformat()  # noqa: E731
        self.add_number(operator, number="ext-0002", activeFrom=day(0))
        self.add_number(operator, number="+886200000005", activeFrom=day(1))
        self.add_number(operator, number="+886200000005", activeFrom=day(-10), activeUntil=day(-1))
        self.add_number(operator, number="+886200000004", activeFrom=day(-10), activeUntil=day(0))
        numbers = self.ok(operator.get(BASE + "/admin/voice/numbers"))["numbers"]
        self.assertEqual([(n["number"], n["activeFrom"], n["activeNow"]) for n in numbers],
                         [("+886200000004", day(-10), True), ("+886200000005", day(-10), False),
                          ("+886200000005", day(1), False), ("ext-0002", day(0), True)])

    def test_concurrent_adds_of_one_period_store_exactly_one(self):
        operator = self.admin()
        start = threading.Barrier(8)

        def attempt(index):
            start.wait(timeout=15)
            return self.post(operator, "/admin/voice/numbers", number_body(activeFrom="2026-11-%02d" % (index + 1)))

        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(attempt, range(8)))
        statuses = sorted(r.status_code for r in responses)
        self.assertEqual((statuses.count(201), statuses.count(409)), (1, 7), statuses)
        self.assertEqual(self.count("voice_numbers"), 1)

    def test_audit_details_and_unchanged_update(self):
        operator = self.admin()
        store_id = self.open_store(operator)["store"]["id"]
        added = self.add_number(operator, storeId=store_id, activeUntil="2026-11-30", note="內部備註文字")["number"]
        path = "/admin/voice/numbers/" + added["id"]
        # The same values again: nothing changes, nothing is audited, updatedAt stays.
        same = self.ok(self.post(operator, path, number_body(storeId=store_id, activeUntil="2026-11-30", note=" 內部備註文字 ")))["number"]
        self.assertEqual(same, added)
        self.assertEqual(self.audit("admin.voice_number_updated"), [])
        self.ok(self.post(operator, path, number_body(storeId=store_id, activeUntil="2026-12-31", note="內部備註文字")))
        self.ok(self.call(operator, "DELETE", path))
        expected = {"number": "+886227356688", "storeId": store_id, "purpose": "test", "channel": "online", "activeFrom": "2026-11-01"}
        self.assertEqual(self.details("admin.voice_number_created"), [dict(expected, activeUntil="2026-11-30")])
        self.assertEqual(self.details("admin.voice_number_updated"), [dict(expected, activeUntil="2026-12-31")])
        self.assertEqual(self.details("admin.voice_number_deleted"), [dict(expected, activeUntil="2026-12-31")])
        self.assertEqual({e["target_id"] for e in self.audit("admin.voice_number_created") + self.audit("admin.voice_number_deleted")},
                         {added["id"]})


# ---------------------------------------------------------------- audit privacy (contract §1.6)


class AuditPrivacyTests(AdminVoiceCase):
    def test_audit_never_holds_names_notes_or_the_temporary_password(self):
        operator = self.admin()
        opened = self.open_store(operator, storeName="隱私測試診所", displayName="王大明")
        store_id = opened["store"]["id"]
        self.ok(self.post(operator, "/admin/voice/stores/" + store_id + "/status", {"status": "testing"}))
        number = self.add_number(operator, storeId=store_id, note="不要記這段備註")["number"]
        self.ok(self.post(operator, "/admin/voice/numbers/" + number["id"], number_body(storeId=store_id, note="另一段備註")))
        self.ok(self.call(operator, "DELETE", "/admin/voice/numbers/" + number["id"]))
        events = [e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.voice_")]
        self.assertEqual(sorted(e["action"] for e in events),
                         ["admin.voice_number_created", "admin.voice_number_deleted", "admin.voice_number_updated",
                          "admin.voice_store_created", "admin.voice_store_status"])
        text = "\n".join(str(value) for event in rows(self.store, "audit_events") for value in event.values())
        for secret in ("隱私測試診所", "王大明", "不要記這段備註", "另一段備註", opened["temporaryPassword"]):
            self.assertNotIn(secret, text)


# ---------------------------------------------------------------- the /admin/voice page's constants


FRONTEND_ROOT = Path(os.environ.get("PC_VOICE_FRONTEND_ROOT") or Path(__file__).resolve().parents[1])
FRONTEND_DIALOGS = FRONTEND_ROOT / "components" / "admin-voice-dialogs.tsx"


@unittest.skipUnless(FRONTEND_DIALOGS.is_file(), "components/admin-voice-dialogs.tsx is on the frontend branch; runs once both are merged")
class FrontendSyncTests(AdminVoiceCase):
    """The values and shapes /admin/voice (T10) knows must be exactly the backend's."""

    def source(self):
        return FRONTEND_DIALOGS.read_text(encoding="utf-8")

    def constant(self, name):
        match = re.search(r"^export const " + name + r" = \[([^\]]*)\] as const;", self.source(), re.MULTILINE)
        self.assertIsNotNone(match, name)
        return re.findall(r'"([^"]+)"', match.group(1))

    def block(self, start):
        text = self.source()
        begin = text.index(start)
        return text[begin:text.index("\n};", begin)]

    def type_keys(self, name):
        return set(re.findall(r"^  (\w+):", self.block("export type " + name + " = {"), re.MULTILINE))

    def test_enums_match(self):
        self.assertEqual(self.constant("VOICE_INDUSTRIES"), list(vs.INDUSTRIES))
        self.assertEqual(self.constant("VOICE_STATUSES"), list(vs.STATUSES))
        self.assertEqual(self.constant("VOICE_PURPOSES"), list(vs.PURPOSES))
        self.assertEqual(self.constant("VOICE_CHANNELS"), list(vs.CHANNELS))

    def test_status_targets_are_the_allowed_cells(self):
        targets = {status: re.findall(r'"([^"]+)"', values)
                   for status, values in re.findall(r"^  (\w+): \[([^\]]*)\],", self.block("export const STATUS_TARGETS"), re.MULTILINE)}
        allowed = {status: [target for target, rule in row.items() if rule == av.ALLOWED] for status, row in av.TRANSITIONS.items()}
        self.assertEqual(targets, allowed)

    def test_number_pattern_and_store_name_limits_match(self):
        match = re.search(r"^export const VOICE_NUMBER_PATTERN = /(.+)/;$", self.source(), re.MULTILINE)
        self.assertIsNotNone(match)
        # JS "$" (no m flag) is the end of the string; Python's "$" also matches before a final "\n", so use \Z.
        frontend = re.compile(re.sub(r"\$$", r"\\Z", match.group(1)))
        for sample in ("+886227356688", "+1234567", "+123456789012345", "ext-0001", "+123456", "+0123456", "+1234567890123456",
                       "ext-001", "ext-00001", "EXT-0001", "886227356688", " +886227356688", "+886227356688\n"):
            with self.subTest(sample=sample):
                self.assertEqual(frontend.search(sample) is not None, vs.NUMBER.fullmatch(sample) is not None)
        self.assertEqual(int(re.search(r"^export const STORE_NAME_MAX = (\d+);", self.source(), re.MULTILINE).group(1)),
                         vm.STORE_NAME_NON_SPACE)
        self.assertEqual(int(re.search(r"^const STORE_NAME_RAW_MAX = (\d+);", self.source(), re.MULTILINE).group(1)),
                         vm.vc.STORE_NAME_CHARS)

    def test_store_item_and_number_shapes_match(self):
        operator = self.admin()
        opened = self.open_store(operator)
        number = self.add_number(operator, storeId=opened["store"]["id"])["number"]
        self.assertEqual(self.type_keys("StoreItem"), set(opened["store"]))
        self.assertEqual(self.type_keys("VoiceNumber"), set(number))
        # OpenedStore is one line: { store: StoreItem; account: { userId: string; email: string }; temporaryPassword: string }
        match = re.search(r"^export type OpenedStore = \{(.*)\};$", self.source(), re.MULTILINE)
        self.assertIsNotNone(match)
        self.assertEqual(set(re.findall(r"(\w+):", re.sub(r"\{[^{}]*\}", "", match.group(1)))), set(opened))
        account = re.search(r"account: \{([^{}]*)\}", match.group(1)).group(1)
        self.assertEqual(set(re.findall(r"(\w+):", account)), set(opened["account"]))


if __name__ == "__main__":
    unittest.main()
