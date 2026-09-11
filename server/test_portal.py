"""Customer portal boundaries, using isolated SQLite and an in-memory gateway.

These tests never contact a deployed service, issue a production key, or charge
a customer. The fake returns the real management gateway's cross-customer usage
shape so ownership filtering is exercised through HTTP rather than bypassed.
"""

import asyncio
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from server.app import create_app
from server.gateway import GatewayAdapter, GatewayError
from server.manage import reset_password
from server.settings import Settings


ORIGIN = "http://localhost:3010"
PASSWORD = "portal-test-password-123!"
BASE = "/api/portal"


class FakeGateway:
    configured = True

    def __init__(self):
        self.issued = []
        self.revoked = []
        self.report = {"keys": [], "total_cost_usd": "99999.000000"}
        self.months = []
        self.fail = False
        self.create_delay = 0
        self.issue_lock = threading.Lock()

    async def create_key(self, label):
        if self.create_delay:
            await asyncio.sleep(self.create_delay)
        if self.fail:
            raise GatewayError("private upstream token must never escape")
        with self.issue_lock:
            number = len(self.issued) + 1
            result = {
                "key_id": "gateway-key-%d" % number,
                "prefix": "sk-test-%d" % number,
                "secret": "sk-test-secret-unique-%d" % number,
            }
            self.issued.append({"label": label, **result})
        return result

    async def revoke_key(self, key_id):
        if self.fail:
            raise GatewayError("private upstream token must never escape")
        self.revoked.append(key_id)

    async def usage_report(self, month):
        if self.fail:
            raise GatewayError("private upstream token must never escape")
        self.months.append(month)
        return self.report


class PortalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = str(Path(self.directory.name) / "portal.sqlite")
        self.settings = Settings(
            db_path=self.database,
            allowed_origins=(ORIGIN,),
            gateway_admin_token="local-test-adapter-only",
        )
        self.gateway = FakeGateway()
        self.app = create_app(self.settings, gateway=self.gateway)
        self.client = self.new_client()
        self.clients = [self.client]

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.directory.cleanup()

    def new_client(self):
        return TestClient(self.app, base_url=ORIGIN)

    def post(self, path, data=None, client=None, **kwargs):
        return (client or self.client).post(
            path, json=data or {}, headers={"Origin": ORIGIN}, **kwargs
        )

    def db_rows(self, table):
        with sqlite3.connect(self.database) as database:
            database.row_factory = sqlite3.Row
            return [dict(row) for row in database.execute("SELECT * FROM " + table)]

    def register(self, email="alice@example.test", client=None):
        response = self.post(BASE + "/auth/register", {
            "email": email, "name": "Test Customer", "password": PASSWORD,
        }, client=client)
        self.assertIn(response.status_code, (200, 201), response.text)
        return response.json()["user"]

    def second_customer(self):
        client = self.new_client()
        self.clients.append(client)
        self.register("bob@example.test", client=client)
        return client

    def admin_client(self):
        self.app.state.store.create_user(
            "admin@example.test", "Portal Admin", PASSWORD, role="admin"
        )
        client = self.new_client()
        self.clients.append(client)
        response = self.post(BASE + "/auth/login", {
            "email": "admin@example.test", "password": PASSWORD,
        }, client=client)
        self.assertEqual(response.status_code, 200, response.text)
        return client

    def issue_key(self, client=None, label="My application"):
        response = self.post(BASE + "/keys", {"label": label}, client=client)
        self.assertIn(response.status_code, (200, 201), response.text)
        return response.json()

    def request_credit(self, amount=50, client=None):
        response = self.post(BASE + "/credits", {
            "amountUsd": amount, "reference": "Purchase request PC-001",
        }, client=client)
        self.assertIn(response.status_code, (200, 201), response.text)
        return response.json()["request"]

    def test_registration_creates_customer_session_without_exposing_hashes(self):
        user = self.register(" ALICE@EXAMPLE.TEST ")
        self.assertEqual(user["email"], "alice@example.test")
        self.assertEqual(user["role"], "customer")
        response = self.client.get(BASE + "/session")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["id"], user["id"])
        self.assertNotIn("password", response.text.lower())
        self.assertNotIn("token_hash", response.text)
        stored_users = json.dumps(self.db_rows("users"))
        self.assertNotIn(PASSWORD, stored_users)
        token = self.client.cookies.get("pc_portal_session")
        self.assertTrue(token)
        self.assertNotIn(token, json.dumps(self.db_rows("sessions")))

    def test_registration_session_cookie_has_browser_protections(self):
        response = self.post(BASE + "/auth/register", {
            "email": "alice@example.test", "name": "Alice", "password": PASSWORD,
        })
        cookie = response.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=lax", cookie)
        self.assertIn("path=/", cookie)

    def test_registration_rejects_duplicate_and_short_password(self):
        self.register()
        duplicate = self.post(BASE + "/auth/register", {
            "email": "ALICE@example.test", "name": "Duplicate", "password": PASSWORD,
        })
        self.assertEqual(duplicate.status_code, 409)
        invalid = self.post(BASE + "/auth/register", {
            "email": "different@example.test", "name": "Other", "password": "short",
        })
        self.assertIn(invalid.status_code, (400, 422))
        self.assertEqual(len(self.db_rows("users")), 1)

    def test_registration_cannot_select_admin_role(self):
        response = self.post(BASE + "/auth/register", {
            "email": "alice@example.test", "name": "Alice", "password": PASSWORD,
            "role": "admin",
        })
        if response.status_code in (200, 201):
            self.assertEqual(response.json()["user"]["role"], "customer")
            self.assertEqual(self.client.get(BASE + "/admin/customers").status_code, 403)
        else:
            self.assertIn(response.status_code, (400, 422))

    def test_logout_invalidates_copied_session_cookie(self):
        self.register()
        token = self.client.cookies.get("pc_portal_session")
        response = self.post(BASE + "/auth/logout")
        self.assertIn(response.status_code, (200, 204))
        self.client.cookies.set("pc_portal_session", token)
        self.assertEqual(self.client.get(BASE + "/session").status_code, 401)

    def test_expired_session_cannot_access_customer_or_admin_data(self):
        self.register()
        with self.app.state.store.connect() as connection:
            connection.execute("UPDATE sessions SET expires_at = 0")
        for path in ("/session", "/keys", "/overview", "/credits", "/admin/customers"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(BASE + path).status_code, 401)

    def test_login_uses_generic_error_and_throttles_repeated_failure(self):
        self.register()
        self.post(BASE + "/auth/logout")
        payload = {"email": "alice@example.test", "password": "incorrect-password"}
        for _ in range(5):
            response = self.post(BASE + "/auth/login", payload)
            self.assertEqual(response.status_code, 401)
            self.assertNotIn(PASSWORD, response.text)
        limited = self.post(BASE + "/auth/login", payload)
        self.assertEqual(limited.status_code, 429)

    def test_login_does_not_disclose_whether_account_exists(self):
        self.register()
        self.post(BASE + "/auth/logout")
        existing = self.post(BASE + "/auth/login", {
            "email": "alice@example.test", "password": "wrong-password-1234",
        })
        unknown = self.post(BASE + "/auth/login", {
            "email": "unknown@example.test", "password": "wrong-password-1234",
        })
        self.assertEqual(existing.status_code, 401)
        self.assertEqual(existing.json(), unknown.json())

    def test_concurrent_wrong_passwords_cannot_bypass_login_limit(self):
        self.register()
        start = threading.Barrier(20)

        def wrong_password(_):
            start.wait(timeout=15)
            return self.post(BASE + "/auth/login", {
                "email": "alice@example.test", "password": "incorrect-password-123",
            })

        with ThreadPoolExecutor(max_workers=20) as executor:
            responses = list(executor.map(wrong_password, range(20)))
        statuses = [response.status_code for response in responses]
        self.assertEqual(statuses.count(401), 5, statuses)
        self.assertEqual(statuses.count(429), 15, statuses)

    def test_malformed_registrations_do_not_lock_out_different_user_on_shared_proxy(self):
        for _ in range(15):
            response = self.post(BASE + "/auth/register", {
                "email": "malformed@example.test", "name": "", "password": PASSWORD,
            })
            self.assertIn(response.status_code, (400, 422, 429))
        self.assertEqual(self.db_rows("users"), [])
        user = self.register("valid-customer@example.test")
        self.assertEqual(user["email"], "valid-customer@example.test")

    def test_operator_password_reset_revokes_every_owned_session_without_affecting_other_user(self):
        user = self.register()
        another_session = self.new_client()
        self.clients.append(another_session)
        login = self.post(BASE + "/auth/login", {
            "email": user["email"], "password": PASSWORD,
        }, client=another_session)
        self.assertEqual(login.status_code, 200)
        other_user = self.second_customer()
        new_password = "replacement-test-password-456!"

        reset_password(self.app.state.store, user["email"], new_password)

        for client in (self.client, another_session):
            self.assertEqual(client.get(BASE + "/session").status_code, 401)
        self.assertEqual(other_user.get(BASE + "/session").status_code, 200)
        old_login = self.post(BASE + "/auth/login", {
            "email": user["email"], "password": PASSWORD,
        })
        self.assertEqual(old_login.status_code, 401)
        new_login = self.post(BASE + "/auth/login", {
            "email": user["email"], "password": new_password,
        })
        self.assertEqual(new_login.status_code, 200)
        self.assertEqual(new_login.json()["user"]["id"], user["id"])
        bob_login = self.post(BASE + "/auth/login", {
            "email": "bob@example.test", "password": PASSWORD,
        }, client=other_user)
        self.assertEqual(bob_login.status_code, 200)
        self.assertNotIn(new_password, json.dumps(self.db_rows("users")))

    def test_customer_cannot_access_any_admin_route(self):
        self.register()
        for path in ("/overview", "/customers", "/credits", "/audit"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(BASE + "/admin" + path).status_code, 403)
        review = self.post(BASE + "/admin/credits/not-owned/review", {
            "decision": "approve", "note": "Unauthorized",
        })
        self.assertEqual(review.status_code, 403)

    def test_mutations_reject_missing_or_foreign_origin(self):
        payload = {"email": "alice@example.test", "name": "Alice", "password": PASSWORD}
        missing = self.client.post(BASE + "/auth/register", json=payload)
        foreign = self.client.post(BASE + "/auth/register", json=payload,
                                   headers={"Origin": "https://attacker.example"})
        self.assertEqual(missing.status_code, 403)
        self.assertEqual(foreign.status_code, 403)
        self.assertEqual(self.db_rows("users"), [])
        self.register()
        response = self.client.post(BASE + "/credits", json={"amountUsd": 50},
                                    headers={"Origin": "null"})
        self.assertEqual(response.status_code, 403)

    def test_malformed_and_oversized_requests_do_not_create_accounts(self):
        malformed = self.client.post(BASE + "/auth/register", content="{broken",
                                     headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.assertEqual(malformed.status_code, 400)
        oversized = self.client.post(BASE + "/auth/register", content=json.dumps({
            "email": "alice@example.test", "name": "A" * 70000, "password": PASSWORD,
        }), headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(self.db_rows("users"), [])

    def test_authenticated_data_is_noncacheable_and_excluded_from_indexing(self):
        self.register()
        for path in ("/session", "/overview", "/keys", "/credits"):
            response = self.client.get(BASE + path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("no-store", response.headers["cache-control"])
            self.assertIn("noindex", response.headers["x-robots-tag"])

    def test_created_key_secret_is_returned_once_and_never_persisted(self):
        self.register()
        created = self.issue_key()
        self.assertEqual(created["secret"], self.gateway.issued[0]["secret"])
        response = self.client.get(BASE + "/keys")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["keys"]), 1)
        self.assertNotIn(created["secret"], response.text)
        self.assertNotIn("secret", response.json()["keys"][0])
        with sqlite3.connect(self.database) as database:
            dump = "\n".join(database.iterdump())
        self.assertNotIn(created["secret"], dump)

    def test_customer_key_ownership_prevents_listing_and_revoking_other_users(self):
        self.register()
        own_key = self.issue_key()
        other = self.second_customer()
        other_key = self.issue_key(client=other, label="Bob only")
        rows = self.client.get(BASE + "/keys").json()["keys"]
        self.assertEqual([row["id"] for row in rows], [own_key["key"]["id"]])
        denied = self.client.delete(BASE + "/keys/" + other_key["key"]["id"],
                                    headers={"Origin": ORIGIN})
        self.assertIn(denied.status_code, (403, 404))
        self.assertEqual(self.gateway.revoked, [])
        revoked = self.client.delete(BASE + "/keys/" + own_key["key"]["id"],
                                     headers={"Origin": ORIGIN})
        self.assertIn(revoked.status_code, (200, 204))
        self.assertEqual(self.gateway.revoked, [self.gateway.issued[0]["key_id"]])
        self.assertEqual(self.client.get(BASE + "/keys").json()["keys"][0]["status"], "revoked")

    def test_concurrent_key_provisioning_cannot_exceed_twenty_active_keys(self):
        self.register()
        self.gateway.create_delay = 0.03
        start = threading.Barrier(25)

        def create(number):
            start.wait(timeout=15)
            return self.post(BASE + "/keys", {"label": "Application %d" % number})

        with ThreadPoolExecutor(max_workers=25) as executor:
            responses = list(executor.map(create, range(25)))
        statuses = [response.status_code for response in responses]
        self.assertEqual(statuses.count(201), 20, statuses)
        self.assertEqual(statuses.count(409), 5, statuses)
        self.assertEqual(len(self.gateway.issued), 20)
        self.assertEqual(len({key["key_id"] for key in self.gateway.issued}), 20)
        keys = self.client.get(BASE + "/keys").json()["keys"]
        self.assertEqual(len(keys), 20)
        self.assertTrue(all(key["status"] == "active" for key in keys))
        self.assertEqual(self.db_rows("key_reservations"), [])

    def test_usage_aggregates_owned_keys_without_leaking_other_customers_or_global_totals(self):
        self.register()
        self.issue_key(label="Production")
        self.issue_key(label="Development")
        other = self.second_customer()
        self.issue_key(client=other)

        def usage(key_id, model, requests, tokens, cost):
            return {"key_id": key_id, "by_model": [{
                "model": model, "requests": requests, "prompt_tokens": tokens,
                "completion_tokens": tokens // 2, "cost_usd": cost,
            }]}

        self.gateway.report["keys"] = [
            usage("gateway-key-1", "glm-5.2-fp8", 2, 200, "0.100000"),
            usage("gateway-key-2", "glm-5.2-fp8", 3, 300, "0.200000"),
            usage("gateway-key-3", "competitor-private-model", 999, 90000, "9876.000000"),
            usage("UNATTRIBUTED", "unattributed-secret-model", 999, 90000, "9999.000000"),
        ]
        response = self.client.get(BASE + "/usage?month=2026-09")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["source"], "gateway")
        self.assertEqual(data["month"], "2026-09")
        self.assertEqual(len(data["rows"]), 1)
        row = data["rows"][0]
        self.assertEqual(row["model"], "glm-5.2-fp8")
        self.assertEqual(row["requests"], 5)
        self.assertEqual(row["inputTokens"], 500)
        self.assertEqual(row["outputTokens"], 250)
        self.assertAlmostEqual(float(row["costUsd"]), 0.3)
        for private in ("competitor-private-model", "unattributed-secret-model", "99999", "gateway-key-3"):
            self.assertNotIn(private, response.text)
        self.assertEqual(self.gateway.months, ["2026-09"])

    def test_usage_month_validation_happens_before_gateway_call(self):
        self.register()
        for month in ("2026-13", "September", "2026-9", "2026-00"):
            with self.subTest(month=month):
                self.assertIn(self.client.get(BASE + "/usage", params={"month": month}).status_code,
                              (400, 422))
        self.assertEqual(self.gateway.months, [])

    def test_unpriced_owned_usage_fails_instead_of_claiming_zero_cost(self):
        self.register()
        self.issue_key()
        self.gateway.report = {
            "keys": [{"key_id": "gateway-key-1", "by_model": [{
                "model": "missing-price-model", "requests": 1,
                "prompt_tokens": 100, "completion_tokens": 50, "cost_usd": "0.000000",
            }]}],
            "unpriced_models": ["missing-price-model"],
        }
        response = self.client.get(BASE + "/usage?month=2026-09")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "usage_pricing_incomplete")
        self.assertNotIn("rows", response.json())

    def test_another_customers_unpriced_usage_does_not_change_owned_cost(self):
        self.register()
        self.issue_key()
        other = self.second_customer()
        self.issue_key(client=other)
        self.gateway.report = {
            "keys": [
                {"key_id": "gateway-key-1", "by_model": [{
                    "model": "glm-5.2-fp8", "requests": 2,
                    "prompt_tokens": 100, "completion_tokens": 50, "cost_usd": "1.230000",
                }]},
                {"key_id": "gateway-key-2", "by_model": [{
                    "model": "other-private-model", "requests": 999,
                    "prompt_tokens": 10000, "completion_tokens": 5000, "cost_usd": "0.000000",
                }]},
            ],
            "unpriced_models": ["other-private-model"],
        }
        response = self.client.get(BASE + "/usage?month=2026-09")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["rows"]), 1)
        self.assertEqual(response.json()["rows"][0]["model"], "glm-5.2-fp8")
        self.assertAlmostEqual(float(response.json()["rows"][0]["costUsd"]), 1.23)
        self.assertNotIn("other-private-model", response.text)

    def test_gateway_failure_is_generic_and_does_not_create_phantom_key(self):
        self.register()
        self.gateway.fail = True
        response = self.post(BASE + "/keys", {"label": "Application"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "gateway_unavailable")
        self.assertNotIn("private upstream", response.text)
        self.assertEqual(self.client.get(BASE + "/keys").json()["keys"], [])

    def test_failed_gateway_revocation_keeps_key_active_for_retry(self):
        self.register()
        created = self.issue_key()
        self.gateway.fail = True
        response = self.client.delete(BASE + "/keys/" + created["key"]["id"],
                                      headers={"Origin": ORIGIN})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private upstream", response.text)
        self.assertEqual(self.client.get(BASE + "/keys").json()["keys"][0]["status"], "active")
        self.assertEqual(self.gateway.revoked, [])

    def test_gateway_usage_failure_is_not_presented_as_zero_usage(self):
        self.register()
        self.issue_key()
        self.gateway.fail = True
        response = self.client.get(BASE + "/usage?month=2026-09")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "gateway_unavailable")
        self.assertNotIn("private upstream", response.text)

    def test_unconfigured_gateway_is_explicit_and_does_not_return_fake_usage(self):
        self.register()
        self.gateway.configured = False
        response = self.client.get(BASE + "/usage?month=2026-09")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], "unconfigured")
        self.assertEqual(response.json()["rows"], [])
        self.assertEqual(self.gateway.months, [])
        self.assertFalse(self.client.get(BASE + "/overview").json()["gatewayConfigured"])
        create = self.post(BASE + "/keys", {"label": "Unavailable"})
        self.assertIn(create.status_code, (409, 503))
        self.assertEqual(self.gateway.issued, [])

    def test_credit_request_validates_amount_and_is_scoped_to_customer(self):
        self.register()
        for amount in (0, -50, 9.99, 10000.01, 12.345, True, "not-money"):
            with self.subTest(amount=amount):
                response = self.post(BASE + "/credits", {"amountUsd": amount, "reference": "Test"})
                self.assertIn(response.status_code, (400, 422), response.text)
        request = self.request_credit(50)
        self.assertEqual(request["status"], "pending")
        other = self.second_customer()
        self.request_credit(80, client=other)
        rows = self.client.get(BASE + "/credits").json()["requests"]
        self.assertEqual([row["id"] for row in rows], [request["id"]])
        overview = self.client.get(BASE + "/overview").json()
        self.assertEqual(overview["pendingCreditCount"], 1)
        self.assertEqual(float(overview["approvedCreditUsd"]), 0)

    def test_credit_approval_is_idempotent_and_cannot_be_reversed_by_second_review(self):
        self.register()
        request = self.request_credit(50)
        admin = self.admin_client()
        path = BASE + "/admin/credits/" + request["id"] + "/review"
        body = {"decision": "approve", "note": "Manual payment confirmed"}
        first = self.post(path, body, client=admin)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["request"]["status"], "approved")
        audit_before = admin.get(BASE + "/admin/audit").json()["events"]
        second = self.post(path, body, client=admin)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()["request"]["id"], request["id"])
        self.assertEqual(second.json()["request"]["reviewedAt"], first.json()["request"]["reviewedAt"])
        self.assertEqual(admin.get(BASE + "/admin/audit").json()["events"], audit_before)
        conflicting = self.post(path, {"decision": "reject", "note": "Change decision"}, client=admin)
        self.assertEqual(conflicting.status_code, 409)
        overview = self.client.get(BASE + "/overview").json()
        self.assertEqual(float(overview["approvedCreditUsd"]), 50)
        self.assertEqual(overview["pendingCreditCount"], 0)
        # Recorded credit is not a claim about gateway spend or realtime balance.
        self.assertNotIn("balanceUsd", overview)
        self.assertNotIn("availableCreditUsd", overview)

    def test_credit_rejection_does_not_record_credit(self):
        self.register()
        request = self.request_credit(100)
        admin = self.admin_client()
        response = self.post(BASE + "/admin/credits/" + request["id"] + "/review", {
            "decision": "reject", "note": "Payment not received",
        }, client=admin)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["request"]["status"], "rejected")
        self.assertEqual(float(self.client.get(BASE + "/overview").json()["approvedCreditUsd"]), 0)

    def test_concurrent_credit_approvals_record_amount_once(self):
        self.register()
        request = self.request_credit(125)
        admin = self.admin_client()
        path = BASE + "/admin/credits/" + request["id"] + "/review"
        def approve(_):
            return self.post(path, {"decision": "approve", "note": "Verified receipt"}, client=admin)
        with ThreadPoolExecutor(max_workers=4) as executor:
            responses = list(executor.map(approve, range(4)))
        self.assertEqual([response.status_code for response in responses], [200] * 4)
        self.assertEqual(float(self.client.get(BASE + "/overview").json()["approvedCreditUsd"]), 125)

    def test_admin_overview_does_not_count_admins_as_customers(self):
        self.register()
        self.second_customer()
        self.issue_key()
        self.request_credit(50)
        admin = self.admin_client()
        response = admin.get(BASE + "/admin/overview")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["customerCount"], 2)
        self.assertEqual(response.json()["keyCount"], 1)
        self.assertEqual(response.json()["pendingCreditCount"], 1)

    def test_admin_customer_list_and_audit_omit_credentials(self):
        user = self.register()
        key = self.issue_key()
        admin = self.admin_client()
        customers = admin.get(BASE + "/admin/customers")
        self.assertEqual(customers.status_code, 200)
        rows = customers.json()["customers"]
        self.assertEqual([row["id"] for row in rows], [user["id"]])
        self.assertEqual(rows[0]["keyCount"], 1)
        audit = admin.get(BASE + "/admin/audit")
        self.assertEqual(audit.status_code, 200)
        self.assertTrue(audit.json()["events"])
        for response in (customers, audit):
            self.assertNotIn(PASSWORD, response.text)
            self.assertNotIn(key["secret"], response.text)
            self.assertNotIn("password_hash", response.text)

    def test_persistent_users_keys_and_credits_survive_app_recreation(self):
        user = self.register()
        key = self.issue_key()
        credit = self.request_credit()
        recreated = create_app(self.settings, gateway=self.gateway)
        with TestClient(recreated, base_url=ORIGIN) as client:
            login = client.post(BASE + "/auth/login", json={
                "email": "alice@example.test", "password": PASSWORD,
            }, headers={"Origin": ORIGIN})
            self.assertEqual(login.status_code, 200, login.text)
            self.assertEqual(login.json()["user"]["id"], user["id"])
            self.assertEqual(client.get(BASE + "/keys").json()["keys"][0]["id"], key["key"]["id"])
            self.assertEqual(client.get(BASE + "/credits").json()["requests"][0]["id"], credit["id"])


class GatewayAdapterTests(unittest.IsolatedAsyncioTestCase):
    """Verify the real adapter's HTTP contract without opening network sockets."""

    def setUp(self):
        self.settings = Settings(gateway_admin_token="adapter-test-admin-token")
        self.gateway = GatewayAdapter(self.settings)
        self.requests = []
        self.real_client = httpx.AsyncClient

    def transport(self, responder):
        def handle(request):
            self.requests.append(request)
            return responder(request)
        return patch("server.gateway.httpx.AsyncClient", side_effect=lambda **kwargs:
                     self.real_client(transport=httpx.MockTransport(handle), **kwargs))

    async def test_create_key_translates_gateway_response_and_sets_explicit_limits(self):
        with self.transport(lambda _: httpx.Response(200, json={
            "key": "sk-local-test-customer-secret", "key_id": "key-123", "label": "Application",
        })):
            result = await self.gateway.create_key("Application")
        self.assertEqual(result["secret"], "sk-local-test-customer-secret")
        self.assertEqual(result["key_id"], "key-123")
        request = self.requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/api/keys")
        self.assertEqual(request.headers["X-Admin-Token"], "adapter-test-admin-token")
        payload = json.loads(request.content)
        self.assertEqual(payload["label"], "Application")
        for name in ("daily_token_limit", "rpm", "max_inflight"):
            self.assertGreater(payload[name], 0)
        self.assertNotIn("adapter-test-admin-token", json.dumps(result))

    async def test_revoke_uses_verified_gateway_disable_contract(self):
        with self.transport(lambda _: httpx.Response(200, json={"ok": True})):
            await self.gateway.revoke_key("key-123")
        request = self.requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.path, "/api/keys/key-123/disable")
        self.assertEqual(json.loads(request.content), {"disabled": True})

    async def test_redirect_cannot_forward_admin_credentials_to_another_origin(self):
        with self.transport(lambda _: httpx.Response(302, headers={
            "Location": "https://different.example/receive",
        })):
            with self.assertRaises(GatewayError):
                await self.gateway.usage_report("2026-09")
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0].url.host, "b300.powerchampion.ai")

    async def test_invalid_or_oversized_gateway_response_fails_closed(self):
        for response in (
            httpx.Response(200, json=["not-an-object"]),
            httpx.Response(200, content=b"not json"),
            httpx.Response(503, json={"error": "unavailable"}),
            httpx.Response(200, content=b"x" * (4 * 1024 * 1024 + 1)),
        ):
            with self.subTest(status=response.status_code, size=len(response.content)):
                with self.transport(lambda _, response=response: response):
                    with self.assertRaises(GatewayError):
                        await self.gateway.usage_report("2026-09")

    async def test_invalid_key_identifier_is_rejected_before_network_request(self):
        with self.transport(lambda _: httpx.Response(200, json={"ok": True})):
            with self.assertRaises(GatewayError):
                await self.gateway.revoke_key("../another-resource?admin=true")
        self.assertEqual(self.requests, [])


if __name__ == "__main__":
    unittest.main()
