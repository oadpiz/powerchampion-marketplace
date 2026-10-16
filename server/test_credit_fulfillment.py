"""Payment-confirmed credit grants: durable state, retry and ownership boundaries.

The gateway is the external boundary. Its fake models commit-before-response-loss
and durable operation receipts so portal retries exercise the ambiguous outcome.
"""
import copy
import json
import threading
import uuid
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import httpx

from server import test_portal as helpers
from server.gateway import GatewayError
from server.testsupport import FakeGateway


class ReceiptGateway(FakeGateway):
    def __init__(self):
        super().__init__()
        self.receipts = {}
        self.grant_lock = threading.Lock()
        self.lost_response = False
        self.bad_receipt = False

    async def grant_credit(self, operation_id, key_id, amount_nano_usd):
        self._maybe_fail()
        with self.grant_lock:
            if operation_id not in self.receipts:
                self.receipts[operation_id] = {
                    "operation_id": operation_id, "key_id": key_id,
                    "currency": "USD", "credited_nano_usd": amount_nano_usd,
                    "balance_after_nano_usd": amount_nano_usd, "created_at": 1700000000,
                }
            result = copy.deepcopy(self.receipts[operation_id])
            if self.lost_response:
                self.lost_response = False
                raise GatewayError("unavailable")
            if self.bad_receipt:
                result["credited_nano_usd"] += 1
            return result


class CreditFulfillmentTests(unittest.TestCase):
    setUp = helpers.PortalTests.setUp
    tearDown = helpers.PortalTests.tearDown
    new_client = helpers.PortalTests.new_client
    post = helpers.PortalTests.post
    db_rows = helpers.PortalTests.db_rows
    register = helpers.PortalTests.register
    second_customer = helpers.PortalTests.second_customer
    admin_client = helpers.PortalTests.admin_client
    issue_key = helpers.PortalTests.issue_key

    def setup_credit(self, amount=50):
        self.gateway = ReceiptGateway()
        # create_app closes over its injected gateway; replace before any route work.
        from server.app import create_app
        self.app = create_app(self.settings, gateway=self.gateway)
        self.client.close()
        self.client = self.new_client()
        self.clients = [self.client]
        self.register()
        key = self.issue_key()["key"]
        response = self.post(helpers.BASE + "/credits", {
            "amountUsd": amount, "reference": "Independently verified bank payment",
            "targetKeyId": key["id"],
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["request"], key

    def approve(self, credit, admin, **extra):
        return self.post(helpers.BASE + "/admin/credits/" + credit["id"] + "/review", {
            "decision": "approve", "note": "Operator verified receipt", **extra,
        }, client=admin)

    def test_new_request_without_saved_target_does_not_accept_payment_request(self):
        self.register()
        response = self.post(helpers.BASE + "/credits", {"amountUsd": 50, "reference": "ref"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db_rows("credit_requests"), [])

    def test_request_cannot_target_another_customers_key_or_revoked_key(self):
        self.register()
        other = self.second_customer()
        foreign = self.issue_key(client=other)["key"]
        for key_id in (foreign["id"], "missing-key"):
            response = self.post(helpers.BASE + "/credits", {"amountUsd": 50, "reference": "ref", "targetKeyId": key_id})
            self.assertEqual(response.status_code, 404, response.text)
        own = self.issue_key()["key"]
        self.client.delete(helpers.BASE + "/keys/" + own["id"], headers={"Origin": helpers.ORIGIN})
        response = self.post(helpers.BASE + "/credits", {"amountUsd": 50, "reference": "ref", "targetKeyId": own["id"]})
        self.assertEqual(response.status_code, 409)

    def test_approved_request_credits_exact_amount_and_replay_never_credits_twice(self):
        credit, key = self.setup_credit(10.01)
        admin = self.admin_client()
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["request"]
        self.assertEqual((result["status"], result["fulfillmentStatus"]), ("approved", "fulfilled"))
        self.assertEqual(result["targetKeyId"], key["id"])
        self.assertIsNotNone(result["paymentConfirmedAt"])
        receipt = list(self.gateway.receipts.values())[0]
        self.assertEqual(receipt["credited_nano_usd"], 10010000000)
        self.assertEqual(receipt["operation_id"], "portal-credit:" + str(uuid.UUID(credit["id"])))
        self.assertEqual(receipt["key_id"], key["gatewayKeyId"])
        self.assertEqual(self.approve(credit, admin).json()["request"], result)
        self.assertEqual(len(self.gateway.receipts), 1)

    def test_committed_grant_lost_response_remains_pending_and_retries_same_operation(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        self.gateway.lost_response = True
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 202, response.text)
        result = response.json()["request"]
        self.assertEqual((result["status"], result["fulfillmentStatus"]), ("pending", "pending"))
        self.assertIsNotNone(result["paymentConfirmedAt"])
        self.assertEqual(len(self.gateway.receipts), 1)
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["request"]["fulfillmentStatus"], "fulfilled")
        self.assertEqual(len(self.gateway.receipts), 1)

    def test_missing_gateway_grant_route_never_falsely_approves(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        self.gateway.reject = GatewayError("rejected", 404, "old gateway route missing")
        result = self.approve(credit, admin)
        self.assertEqual(result.status_code, 202, result.text)
        self.assertEqual(result.json()["request"]["status"], "pending")
        self.assertEqual(result.json()["request"]["fulfillmentStatus"], "pending")
        self.assertEqual(self.gateway.receipts, {})

    def test_mismatched_receipt_does_not_mark_fulfilled(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        self.gateway.bad_receipt = True
        result = self.approve(credit, admin)
        self.assertEqual(result.status_code, 202, result.text)
        self.assertEqual(result.json()["request"]["fulfillmentStatus"], "pending")

    def test_confirmed_payment_cannot_be_rejected_or_retargeted_during_retry(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        self.gateway.fail = True
        self.assertEqual(self.approve(credit, admin).status_code, 202)
        response = self.post(helpers.BASE + "/admin/credits/" + credit["id"] + "/review", {"decision": "reject", "note": "change mind"}, client=admin)
        self.assertEqual(response.status_code, 409, response.text)
        response = self.approve(credit, admin, targetKeyId="another-target")
        self.assertEqual(response.status_code, 409, response.text)
        response = self.approve(credit, admin, amountUsd=999)
        self.assertEqual(response.status_code, 400, response.text)

    def test_concurrent_approvals_and_rejection_cannot_double_credit(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        barrier = threading.Barrier(4)
        def review(index):
            barrier.wait(timeout=10)
            if index == 0:
                return self.post(helpers.BASE + "/admin/credits/" + credit["id"] + "/review", {"decision": "reject", "note": "not confirmed"}, client=admin)
            return self.approve(credit, admin)
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(review, range(4)))
        self.assertTrue(all(r.status_code in (200, 409) for r in responses), [r.text for r in responses])
        stored = self.db_rows("credit_requests")[0]
        if stored["status"] == "rejected":
            self.assertEqual(self.gateway.receipts, {})
        else:
            self.assertEqual(stored["status"], "approved")
            self.assertEqual(len(self.gateway.receipts), 1)

    def test_reject_never_calls_gateway_and_is_repeatable(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        for _ in range(2):
            response = self.post(helpers.BASE + "/admin/credits/" + credit["id"] + "/review", {"decision": "reject", "note": "payment absent"}, client=admin)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["request"]["status"], "rejected")
        self.assertEqual(self.gateway.receipts, {})

    def test_legacy_approved_without_target_is_not_automatically_funded(self):
        credit, key = self.setup_credit()
        with self.app.state.store.connect() as con:
            con.execute("UPDATE credit_requests SET status='approved', target_key_id=NULL WHERE id=?", (credit["id"],))
        admin = self.admin_client()
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.gateway.receipts, {})
        response = self.approve(credit, admin, targetKeyId=key["id"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["request"]["fulfillmentStatus"], "fulfilled")

    def test_finalize_failure_retries_committed_grant_without_new_payment(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        with patch.object(self.app.state.store, "complete_credit_fulfillment", side_effect=RuntimeError("db unavailable")):
            response = self.approve(credit, admin)
        self.assertIn(response.status_code, (202, 500), response.text)
        self.assertEqual(len(self.gateway.receipts), 1)
        self.assertEqual(self.db_rows("credit_requests")[0]["status"], "pending")
        result = self.approve(credit, admin)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["request"]["fulfillmentStatus"], "fulfilled")
        self.assertEqual(len(self.gateway.receipts), 1)

    def test_confirmed_pending_target_cannot_be_revoked_but_fulfilled_target_can(self):
        credit, key = self.setup_credit()
        admin = self.admin_client()
        self.gateway.lost_response = True
        self.assertEqual(self.approve(credit, admin).status_code, 202)
        response = self.client.delete(helpers.BASE + "/keys/" + key["id"], headers={"Origin": helpers.ORIGIN})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.db_rows("gateway_keys")[0]["status"], "active")
        self.assertEqual(self.approve(credit, admin).status_code, 200)
        response = self.client.delete(helpers.BASE + "/keys/" + key["id"], headers={"Origin": helpers.ORIGIN})
        self.assertEqual(response.status_code, 200, response.text)

    def test_revoked_unconfirmed_target_cannot_confirm_payment(self):
        credit, key = self.setup_credit()
        admin = self.admin_client()
        self.assertEqual(self.client.delete(helpers.BASE + "/keys/" + key["id"], headers={"Origin": helpers.ORIGIN}).status_code, 200)
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIsNone(self.db_rows("credit_requests")[0]["payment_confirmed_at"])
        self.assertEqual(self.gateway.receipts, {})

    def test_committed_receipt_can_be_recovered_after_owner_disabled(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        self.gateway.lost_response = True
        self.assertEqual(self.approve(credit, admin).status_code, 202)
        user_id = self.db_rows("credit_requests")[0]["user_id"]
        with self.app.state.store.connect() as con:
            con.execute("UPDATE users SET disabled_at=1700000000 WHERE id=?", (user_id,))
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["request"]["fulfillmentStatus"], "fulfilled")
        self.assertEqual(len(self.gateway.receipts), 1)

    def test_customer_cannot_confirm_own_payment(self):
        credit, _ = self.setup_credit()
        response = self.approve(credit, self.client)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.gateway.receipts, {})

    def test_receipt_never_exposes_historical_balance_as_live_balance(self):
        credit, _ = self.setup_credit()
        response = self.approve(credit, self.admin_client())
        self.assertEqual(response.status_code, 200)
        result = response.json()["request"]
        self.assertNotIn("balanceUsd", result)
        self.assertNotIn("balance_after_nano_usd", result)

    def test_grant_to_overdraft_key_finishes_without_claiming_current_spendable_balance(self):
        credit, _ = self.setup_credit()
        original = self.gateway.grant_credit
        async def overdraft_receipt(*args):
            receipt = await original(*args)
            receipt["balance_after_nano_usd"] = -4000
            return receipt
        self.gateway.grant_credit = overdraft_receipt
        response = self.approve(credit, self.admin_client())
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["request"]
        self.assertEqual(result["fulfillmentStatus"], "fulfilled")
        self.assertNotIn("remainingUsd", result)
        self.assertNotIn("balanceUsd", result)

    def test_revocation_reservation_serializes_against_payment_confirmation(self):
        credit, key = self.setup_credit()
        admin = self.admin_client()
        entered, release = threading.Event(), threading.Event()
        original = self.gateway.revoke_key
        async def revoke_slowly(key_id):
            entered.set()
            if not release.wait(timeout=10):
                raise RuntimeError("test release timed out")
            await original(key_id)
        self.gateway.revoke_key = revoke_slowly
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.client.delete, helpers.BASE + "/keys/" + key["id"], headers={"Origin": helpers.ORIGIN})
            try:
                self.assertTrue(entered.wait(timeout=10))
                result = self.approve(credit, admin)
                self.assertEqual(result.status_code, 409, result.text)
                self.assertIsNone(self.db_rows("credit_requests")[0]["payment_confirmed_at"])
            finally:
                release.set()
            self.assertEqual(future.result(timeout=10).status_code, 200)
        self.assertEqual(self.gateway.receipts, {})

    def test_client_amount_validation_never_rounds_invalid_money_into_credit(self):
        credit, key = self.setup_credit()
        for amount in (True, 0, -1, 9.99, 10000.01, 10.001, "NaN", "Infinity", "-Infinity"):
            with self.subTest(amount=amount):
                response = self.post(helpers.BASE + "/credits", {"amountUsd": amount, "reference": "ref", "targetKeyId": key["id"]})
                self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(len(self.db_rows("credit_requests")), 1)

    def test_legacy_binding_cannot_take_another_customers_key(self):
        credit, _ = self.setup_credit()
        other = self.second_customer()
        foreign = self.issue_key(client=other)["key"]
        with self.app.state.store.connect() as con:
            con.execute("UPDATE credit_requests SET target_key_id=NULL WHERE id=?", (credit["id"],))
        response = self.approve(credit, self.admin_client(), targetKeyId=foreign["id"])
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.gateway.receipts, {})

    def test_duplicate_revocation_cannot_release_another_inflight_reservation(self):
        credit, key = self.setup_credit()
        admin = self.admin_client()
        entered, release = threading.Event(), threading.Event()
        call_count = 0
        async def revoke_inflight(key_id):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise GatewayError("unavailable")
            entered.set()
            if not release.wait(timeout=10):
                raise RuntimeError("release timed out")
        self.gateway.revoke_key = revoke_inflight
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.client.delete, helpers.BASE + "/keys/" + key["id"], headers={"Origin": helpers.ORIGIN})
            try:
                self.assertTrue(entered.wait(timeout=10))
                duplicate = self.client.delete(helpers.BASE + "/keys/" + key["id"], headers={"Origin": helpers.ORIGIN})
                denied = self.approve(credit, admin)
                self.assertEqual(duplicate.status_code, 409, duplicate.text)
                self.assertEqual(denied.status_code, 409, denied.text)
                self.assertEqual(self.gateway.receipts, {})
            finally:
                release.set()
            self.assertEqual(first.result(timeout=10).status_code, 200)

    def test_grant_operation_is_canonical_and_durably_frozen_before_http(self):
        credit, _ = self.setup_credit()
        original = self.gateway.grant_credit
        async def check_contract(operation_id, key_id, amount):
            suffix = operation_id.removeprefix("portal-credit:")
            self.assertEqual(suffix, str(uuid.UUID(suffix)))
            row = self.db_rows("credit_requests")[0]
            self.assertEqual(row["fulfillment_operation_id"], operation_id)
            return await original(operation_id, key_id, amount)
        self.gateway.grant_credit = check_contract
        self.assertEqual(self.approve(credit, self.admin_client()).status_code, 200)

    def test_pending_grant_reopens_portal_and_reuses_persisted_operation(self):
        from fastapi.testclient import TestClient
        from server.app import create_app
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        self.gateway.lost_response = True
        self.assertEqual(self.approve(credit, admin).status_code, 202)
        operation = self.db_rows("credit_requests")[0]["fulfillment_operation_id"]
        restarted = create_app(self.settings, gateway=self.gateway)
        with TestClient(restarted, base_url=helpers.ORIGIN) as client:
            login = self.post(helpers.BASE + "/auth/login", {"email": "admin@example.test", "password": helpers.PASSWORD}, client=client)
            self.assertEqual(login.status_code, 200)
            response = self.approve(credit, client)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["request"]["fulfillmentStatus"], "fulfilled")
        self.assertEqual(set(self.gateway.receipts), {operation})
        self.assertEqual(self.db_rows("credit_requests")[0]["fulfillment_operation_id"], operation)

    def test_missing_frozen_operation_never_generates_replacement_grant(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        self.gateway.lost_response = True
        self.assertEqual(self.approve(credit, admin).status_code, 202)
        operation = self.db_rows("credit_requests")[0]["fulfillment_operation_id"]
        with self.app.state.store.connect() as con:
            con.execute("UPDATE credit_requests SET fulfillment_operation_id=NULL WHERE id=?", (credit["id"],))
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["error"], "credit_operation_missing")
        self.assertEqual(set(self.gateway.receipts), {operation})

    def test_finalize_commit_then_lost_ack_is_successful_on_retry(self):
        credit, _ = self.setup_credit()
        admin = self.admin_client()
        complete = self.app.state.store.complete_credit_fulfillment
        def commit_then_raise(*args):
            complete(*args)
            raise RuntimeError("commit acknowledgement lost")
        with patch.object(self.app.state.store, "complete_credit_fulfillment", side_effect=commit_then_raise):
            self.assertEqual(self.approve(credit, admin).status_code, 500)
        self.assertEqual(self.db_rows("credit_requests")[0]["fulfillment_status"], "fulfilled")
        response = self.approve(credit, admin)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.gateway.receipts), 1)


class GrantAdapterTests(unittest.IsolatedAsyncioTestCase):
    setUp = helpers.GatewayAdapterTests.setUp
    transport = helpers.GatewayAdapterTests.transport

    def receipt(self):
        return {"operation_id": "portal-credit:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "key_id": "abcdef012345",
                "currency": "USD", "credited_nano_usd": 10010000000,
                "balance_after_nano_usd": 12345000000, "created_at": 1700000000}

    async def test_grant_posts_exact_integer_contract_to_fixed_gateway(self):
        receipt = self.receipt()
        with self.transport(lambda _: httpx.Response(200, json=receipt)):
            result = await self.gateway.grant_credit("portal-credit:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "abcdef012345", 10010000000)
        self.assertEqual(result, receipt)
        request = self.requests[0]
        self.assertEqual(request.url.path, "/api/credits/grants")
        self.assertEqual(request.headers["X-Admin-Token"], "adapter-test-admin-token")
        self.assertEqual(json.loads(request.content), {"operation_id": "portal-credit:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "key_id": "abcdef012345", "currency": "USD", "amount_nano_usd": 10010000000})

    async def test_success_with_wrong_receipt_fails_closed(self):
        for field, bad in (("key_id", "other"), ("operation_id", "another"), ("currency", "EUR"),
                           ("credited_nano_usd", True), ("credited_nano_usd", 10010000001),
                           ("balance_after_nano_usd", -(2**63)-1), ("balance_after_nano_usd", True),
                           ("created_at", False), ("created_at", 10**1000), ("created_at", "yesterday")):
            with self.subTest(field=field, bad=bad):
                receipt = self.receipt()
                receipt[field] = bad
                with self.transport(lambda _, value=receipt: httpx.Response(200, json=value)):
                    with self.assertRaises(GatewayError):
                        await self.gateway.grant_credit("portal-credit:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "abcdef012345", 10010000000)
