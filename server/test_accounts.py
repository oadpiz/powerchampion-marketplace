import json
import tempfile
import unittest

from fastapi.testclient import TestClient

from server.app import create_app
from server.gateway import GatewayError
from server.settings import Settings
from server.test_agents import CONFIGURATION
from server.testsupport import FakeGateway, fresh_database, rows

ORIGIN = "http://localhost:3010"
BASE = "/api/portal"
PASSWORD = "customer-test-password-123!"


class _PortalCase(unittest.TestCase):
    """Shared fixture; holds no tests so subclasses do not re-run each other's cases."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,))
        self.gateway = FakeGateway()
        self.app = create_app(self.settings, gateway=self.gateway)
        self.store = self.app.state.store
        self.clients = []

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.directory.cleanup()

    def client(self):
        client = TestClient(self.app, base_url=ORIGIN)
        self.clients.append(client)
        return client

    def post(self, client, path, data):
        return client.post(BASE + path, json=data, headers={"Origin": ORIGIN})

    def register(self, client, email):
        response = self.post(client, "/auth/register", {"email": email, "name": "Test", "password": PASSWORD})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["user"]

    def admin(self, email="admin@example.test"):
        self.store.create_user(email, "Admin", PASSWORD, role="admin")
        client = self.client()
        self.assertEqual(self.post(client, "/auth/login", {"email": email, "password": PASSWORD}).status_code, 200)
        return client

    def audit(self, action):
        return [e for e in rows(self.store, "audit_events") if e["action"] == action]

    def user_id(self, email):
        return next(u["id"] for u in rows(self.store, "users") if u["email"] == email)


class AccountStatusTests(_PortalCase):
    def test_new_users_are_active(self):
        user = self.register(self.client(), "a@example.test")
        self.assertEqual(user["status"], "active")
        self.assertIsNone(user["disabledAt"])
        self.assertIsNone(rows(self.store, "users")[0]["disabled_at"])

    def test_disabled_user_cannot_log_in_or_keep_a_session(self):
        client = self.client()
        user = self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/session").status_code, 200)
        with self.store.connect() as con:
            con.execute("UPDATE users SET disabled_at=? WHERE id=?", (1700000000, user["id"]))
        self.assertEqual(client.get(BASE + "/session").status_code, 401)
        login = self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": PASSWORD})
        self.assertEqual(login.status_code, 403)
        self.assertEqual(login.json()["error"], "account_disabled")
        wrong = self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": "definitely-wrong-password"})
        self.assertEqual(wrong.status_code, 401, "a wrong password must not reveal the disabled state")


class AdminAccountTests(_PortalCase):
    def test_customer_list_includes_admins_with_role_and_status(self):
        admin = self.admin()
        self.register(self.client(), "a@example.test")
        listing = admin.get(BASE + "/admin/customers").json()["customers"]
        self.assertEqual({(u["email"], u["role"], u["status"]) for u in listing},
                         {("admin@example.test", "admin", "active"), ("a@example.test", "customer", "active")})

    def test_disable_kicks_sessions_and_enable_restores(self):
        admin = self.admin()
        victim = self.client()
        user = self.register(victim, "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["customer"]["status"], "disabled")
        self.assertEqual(victim.get(BASE + "/session").status_code, 401)
        again = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(again.status_code, 200, "idempotent")
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "enable"})
        self.assertEqual(r.json()["customer"]["status"], "active")
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": PASSWORD}).status_code, 200)
        actions = [e["action"] for e in rows(self.store, "audit_events")]
        self.assertIn("admin.account_disabled", actions)
        self.assertIn("admin.account_enabled", actions)

    def test_admin_demoted_between_auth_and_write_is_refused(self):
        admin = self.admin()
        victim = self.register(self.client(), "a@example.test")
        stale = self.store.session_user(admin.cookies.get("pc_portal_session"))
        self.assertEqual(stale["role"], "admin")
        with self.store.connect() as con:
            con.execute("UPDATE users SET disabled_at=? WHERE id=?", (1700000000, stale["id"]))
        original = self.store.session_user
        self.store.session_user = lambda token: stale  # simulates losing the race after current_user() passed
        try:
            response = self.post(admin, f"/admin/customers/{victim['id']}/status", {"action": "disable"})
        finally:
            self.store.session_user = original
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["error"], "admin_required")
        with self.store.connect() as con:
            self.assertIsNone(con.execute("SELECT disabled_at FROM users WHERE id=?", (victim["id"],)).fetchone()[0])

    def test_admin_cannot_target_self(self):
        admin = self.admin()
        me = admin.get(BASE + "/session").json()["user"]
        for path, body in ((f"/admin/customers/{me['id']}/status", {"action": "disable"}),
                           (f"/admin/customers/{me['id']}/role", {"role": "customer"}),
                           (f"/admin/customers/{me['id']}/reset-password", {"newPassword": "x" * 12})):
            response = self.post(admin, path, body)
            self.assertEqual(response.status_code, 409, path)
            self.assertEqual(response.json()["error"], "self_target")
        self.assertEqual(admin.get(BASE + "/session").status_code, 200, "the admin is untouched")

    def test_role_change_and_unknown_user(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/role", {"role": "admin"})
        self.assertEqual(r.json()["customer"]["role"], "admin")
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/role", {"role": "owner"}).status_code, 400)
        self.assertEqual(self.post(admin, "/admin/customers/" + "0" * 32 + "/role", {"role": "admin"}).status_code, 404)
        self.assertIn("admin.role_changed", [e["action"] for e in rows(self.store, "audit_events")])

    def test_admin_password_reset_revokes_sessions(self):
        admin = self.admin()
        victim = self.client()
        user = self.register(victim, "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/reset-password", {"newPassword": "brand-new-password-987!"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(victim.get(BASE + "/session").status_code, 401)
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": PASSWORD}).status_code, 401)
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": "brand-new-password-987!"}).status_code, 200)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/reset-password", {"newPassword": "short"}).status_code, 400)
        self.assertIn("admin.password_reset", [e["action"] for e in rows(self.store, "audit_events")])

    def test_customer_is_forbidden(self):
        client = self.client()
        user = self.register(client, "a@example.test")
        for path, body in ((f"/admin/customers/{user['id']}/status", {"action": "disable"}),
                           (f"/admin/customers/{user['id']}/role", {"role": "admin"}),
                           (f"/admin/customers/{user['id']}/reset-password", {"newPassword": "x" * 12})):
            self.assertEqual(self.post(client, path, body).status_code, 403, path)

    def test_disabled_users_agent_token_stops_resolving(self):
        admin = self.admin()
        client = self.client()
        user = self.register(client, "a@example.test")
        created = self.post(client, "/agents", {"name": "Drafter", **CONFIGURATION})
        self.assertEqual(created.status_code, 201, created.text)
        token = created.json()["token"]
        self.assertEqual(self.post(self.client(), "/agents/resolve", {"token": token}).status_code, 200)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"}).status_code, 200)
        self.assertEqual(self.post(self.client(), "/agents/resolve", {"token": token}).status_code, 404)
        self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "enable"})
        self.assertEqual(self.post(self.client(), "/agents/resolve", {"token": token}).status_code, 200)

    def test_admin_issues_prepaid_key_for_customer(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "Prod", "prepaidUsd": 25})
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual(body["key"]["label"], "Prod")
        self.assertTrue(body["secret"].startswith("sk-test-secret"))
        self.assertEqual(body["balanceUsd"], "25.00")
        self.assertEqual(self.gateway.issued[-1]["prepaid_usd"], 25)
        self.assertEqual(rows(self.store, "gateway_keys")[0]["user_id"], user["id"])
        issued = self.audit("admin.key_issued")
        self.assertEqual([(e["actor_id"], e["target_id"]) for e in issued], [(self.user_id("admin@example.test"), body["key"]["id"])])
        for bad in ({"label": "x"}, {"label": "x", "prepaidUsd": 0}, {"label": "x", "prepaidUsd": -1}, {"label": "x", "prepaidUsd": "ten"}):
            self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", bad).status_code, 422, bad)

    def test_customer_self_service_stays_closed_unless_enabled(self):
        client = self.client()
        self.register(client, "a@example.test")
        r = self.post(client, "/keys", {"label": "mine"})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "provider_not_configured")
        self.assertEqual(self.gateway.issued, [])

    def test_customer_self_service_issues_unfunded_key_when_enabled(self):
        self.settings = Settings(db_path=self.settings.db_path, allowed_origins=(ORIGIN,), customer_key_issuance=True)
        self.app = create_app(self.settings, gateway=self.gateway)
        self.store = self.app.state.store
        client = self.client()
        self.register(client, "a@example.test")
        r = self.post(client, "/keys", {"label": "mine"})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.gateway.issued[-1]["prepaid_usd"], 0)
        self.assertEqual(r.json()["secret"], self.gateway.issued[-1]["secret"])
        self.assertEqual(self.audit("key.created")[0]["actor_id"], self.user_id("a@example.test"))

    def test_key_issuance_flag_is_reported_to_customers(self):
        client = self.client()
        self.register(client, "a@example.test")
        for path in ("/keys", "/overview"):
            body = client.get(BASE + path).json()
            self.assertTrue(body["gatewayConfigured"], path)
            self.assertIs(body["keyIssuance"], False, path)
        self.settings = Settings(db_path=self.settings.db_path, allowed_origins=(ORIGIN,), customer_key_issuance=True)
        self.app = create_app(self.settings, gateway=self.gateway)
        self.store = self.app.state.store
        client = self.client()
        self.register(client, "b@example.test")
        for path in ("/keys", "/overview"):
            self.assertIs(client.get(BASE + path).json()["keyIssuance"], True, path)
        self.gateway.configured = False
        for path in ("/keys", "/overview"):
            self.assertIs(client.get(BASE + path).json()["keyIssuance"], False, path)

    def test_disabling_customer_revokes_their_keys(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).status_code, 201)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "B", "prepaidUsd": 5}).status_code, 201)
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["keysRevoked"], 2)
        self.assertEqual(sorted(self.gateway.disabled), sorted(k["key_id"] for k in self.gateway.issued))
        self.assertEqual({k["status"] for k in rows(self.store, "gateway_keys")}, {"revoked"})
        revoked = self.audit("key.revoked")
        self.assertEqual({e["actor_id"] for e in revoked}, {self.user_id("admin@example.test")})
        self.assertEqual(sorted(e["target_id"] for e in revoked), sorted(k["id"] for k in rows(self.store, "gateway_keys")))

    def test_disable_still_succeeds_when_gateway_is_down(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).status_code, 201)
        self.gateway.fail = True
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["keysFailed"], 1)
        self.assertEqual(r.json()["customer"]["status"], "disabled")
        self.assertEqual(r.json()["keysRevoked"], 0)
        self.assertEqual([k["status"] for k in rows(self.store, "gateway_keys")], ["active"], "a failed revoke must not mark the key revoked")
        pending = self.audit("key.revocation_needs_reconciliation")
        self.assertEqual([(e["actor_id"], e["target_id"]) for e in pending], [(self.user_id("admin@example.test"), self.gateway.issued[0]["key_id"])])
        self.assertEqual(self.audit("key.revoked"), [])
        self.assertNotIn("private upstream", r.text)

    def test_disable_with_mixed_revocation_results(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        for label in ("A", "B"):
            self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": label, "prepaidUsd": 5}).status_code, 201)
        stuck = self.gateway.issued[1]["key_id"]
        original = self.gateway.set_key_disabled

        async def flaky(key_id, disabled):
            if key_id == stuck:
                raise GatewayError("unavailable")
            return await original(key_id, disabled)

        self.gateway.set_key_disabled = flaky
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["keysRevoked"], r.json()["keysFailed"]), (1, 1))
        self.assertEqual(r.json()["customer"]["status"], "disabled")
        state = {k["gateway_key_id"]: k["status"] for k in rows(self.store, "gateway_keys")}
        self.assertEqual(state, {self.gateway.issued[0]["key_id"]: "revoked", stuck: "active"})
        self.assertEqual(self.gateway.disabled, [self.gateway.issued[0]["key_id"]])
        self.assertEqual([e["target_id"] for e in self.audit("key.revocation_needs_reconciliation")], [stuck])

    def test_disable_with_unconfigured_gateway_counts_every_active_key_as_failed(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        for label in ("A", "B"):
            self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": label, "prepaidUsd": 5}).status_code, 201)
        self.gateway.configured = False
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["keysRevoked"], r.json()["keysFailed"]), (0, 2))
        self.assertEqual(r.json()["customer"]["status"], "disabled")
        self.assertEqual({k["status"] for k in rows(self.store, "gateway_keys")}, {"active"})
        self.assertEqual(self.gateway.disabled, [])
        self.assertEqual(len(self.audit("key.revocation_needs_reconciliation")), 2)

    def test_admin_issue_passes_limits_and_refuses_disabled_accounts(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "Lim", "prepaidUsd": "1.50", "rpm": 30, "maxInflight": 2})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["balanceUsd"], "1.50")
        self.assertEqual(self.gateway.issued[-1]["limits"], {"rpm": 30, "max_inflight": 2})
        for bad in ({"rpm": -1}, {"rpm": True}, {"dailyTokenLimit": 1.5}):
            self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "x", "prepaidUsd": 1, **bad}).status_code, 422, bad)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "x", "prepaidUsd": 1.005}).status_code, 422)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "x", "prepaidUsd": 100001}).status_code, 422)
        self.assertEqual(self.post(admin, "/admin/customers/nobody/keys", {"label": "x", "prepaidUsd": 1}).status_code, 404)
        self.assertEqual(self.post(self.client(), f"/admin/customers/{user['id']}/keys", {"label": "x", "prepaidUsd": 1}).status_code, 401)
        self.assertEqual(len(self.gateway.issued), 1)
        self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "x", "prepaidUsd": 1}).status_code, 409)
        self.assertEqual(len(self.gateway.issued), 1)

    def test_enable_reports_no_key_changes(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "enable"})
        self.assertEqual((r.json()["keysRevoked"], r.json()["keysFailed"]), (0, 0))


class SelfServicePasswordTests(_PortalCase):
    def test_change_password_keeps_current_session_and_drops_others(self):
        me = self.client()
        self.register(me, "a@example.test")
        other = self.client()
        self.assertEqual(self.post(other, "/auth/login", {"email": "a@example.test", "password": PASSWORD}).status_code, 200)
        bad = self.post(me, "/password", {"currentPassword": "not-the-password-1", "newPassword": "brand-new-password-987!"})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["error"], "invalid_current_password")
        weak = self.post(me, "/password", {"currentPassword": PASSWORD, "newPassword": "short"})
        self.assertEqual(weak.json()["error"], "invalid_input")
        ok = self.post(me, "/password", {"currentPassword": PASSWORD, "newPassword": "brand-new-password-987!"})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(me.get(BASE + "/session").status_code, 200, "current session survives")
        self.assertEqual(other.get(BASE + "/session").status_code, 401, "other sessions are revoked")
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": "brand-new-password-987!"}).status_code, 200)
        self.assertIn("account.password_changed", [e["action"] for e in rows(self.store, "audit_events")])

    def test_change_password_requires_session(self):
        self.assertEqual(self.post(self.client(), "/password", {"currentPassword": PASSWORD, "newPassword": "x" * 12}).status_code, 401)

    def test_wrong_current_password_is_throttled(self):
        me = self.client()
        self.register(me, "a@example.test")
        for _ in range(5):
            r = self.post(me, "/password", {"currentPassword": "not-the-password-1", "newPassword": "brand-new-password-987!"})
            self.assertEqual(r.status_code, 400)
        sixth = self.post(me, "/password", {"currentPassword": PASSWORD, "newPassword": "brand-new-password-987!"})
        self.assertEqual(sixth.status_code, 429, "even the right password is refused while throttled")
        self.assertEqual(sixth.json()["error"], "rate_limited")


class AdminKeysTests(_PortalCase):
    def issue(self, admin, email="a@example.test", prepaid=5):
        user = self.register(self.client(), email)
        issued = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": prepaid}).json()
        return user, issued["key"]["gatewayKeyId"]

    def test_list_merges_ownership(self):
        admin = self.admin()
        user, gid = self.issue(admin)
        self.gateway.listing = {"keys": [
            {"key_id": gid, "prefix": "sk-test-1", "label": "portal:x:A", "daily_token_limit": 1000000, "rpm": 60, "max_inflight": 2, "prepaid_nano_usd": 5000000000, "created_at": 1700000000, "expires_at": None, "disabled_at": None, "last_used_at": None, "model_ids": []},
            {"key_id": "manual-key", "prefix": "sk-man", "label": "ops", "daily_token_limit": 0, "rpm": 0, "max_inflight": 0, "prepaid_nano_usd": None, "created_at": 1700000000.5, "expires_at": None, "disabled_at": None, "last_used_at": None, "model_ids": []},
        ], "env_keys": [{"key_id": "env-1", "prefix": "sk-env", "label": "environment", "unmanaged": True}]}
        body = admin.get(BASE + "/admin/keys").json()
        self.assertTrue(body["gatewayConfigured"])
        by_id = {k["gatewayKeyId"]: k for k in body["keys"]}
        owned = by_id[gid]
        self.assertEqual(owned["owner"], {"id": user["id"], "email": "a@example.test", "name": "Test"})
        self.assertEqual(owned["balanceUsd"], "5.00")
        self.assertEqual(owned["portalStatus"], "active")
        self.assertEqual(owned["portalKeyId"], rows(self.store, "gateway_keys")[0]["id"])
        self.assertEqual(owned["dailyTokenLimit"], 1000000)
        self.assertEqual(owned["rpm"], 60)
        self.assertEqual(owned["maxInflight"], 2)
        self.assertTrue(owned["createdAt"])
        self.assertIsNone(by_id["manual-key"]["owner"])
        self.assertIsNone(by_id["manual-key"]["portalKeyId"])
        self.assertIsNone(by_id["manual-key"]["portalStatus"])
        self.assertIsNone(by_id["manual-key"]["balanceUsd"])
        self.assertEqual(body["envKeys"][0]["gatewayKeyId"], "env-1")
        self.assertIsNone(body["envKeys"][0]["owner"])
        self.assertNotIn("sk-test-secret", json.dumps(body))

    def test_list_without_gateway_is_empty(self):
        admin = self.admin()
        self.gateway.configured = False
        r = admin.get(BASE + "/admin/keys")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"keys": [], "envKeys": [], "gatewayConfigured": False})

    def test_list_gateway_down_is_503(self):
        admin = self.admin()
        self.gateway.fail = True
        r = admin.get(BASE + "/admin/keys")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "gateway_unavailable")
        self.assertNotIn("private upstream token", r.text)

    def test_disable_enable_limits_balance(self):
        admin = self.admin()
        _user, gid = self.issue(admin)
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": True}).json(), {"ok": True})
        self.assertEqual(self.gateway.disabled[-1], gid)
        self.assertEqual(rows(self.store, "gateway_keys")[0]["status"], "revoked")
        self.assertIsNotNone(rows(self.store, "gateway_keys")[0]["revoked_at"])
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": False}).status_code, 200)
        self.assertEqual(self.gateway.enabled[-1], gid)
        row = rows(self.store, "gateway_keys")[0]
        self.assertEqual(row["status"], "active")
        self.assertIsNone(row["revoked_at"])
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/limits", {"rpm": 10}).status_code, 200)
        self.assertEqual(self.gateway.limits[-1], (gid, {"rpm": 10}))
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/limits", {"rpm": -1}).status_code, 422)
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/limits", {}).status_code, 422)
        self.assertEqual(len(self.gateway.limits), 1)
        r = self.post(admin, f"/admin/keys/{gid}/balance", {"addUsd": 2.5})
        self.assertEqual(r.json(), {"ok": True, "balanceUsd": "2.50"})
        self.assertEqual(self.gateway.balances[-1][0], gid)
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/balance", {"addUsd": 1, "setUsd": 2}).status_code, 422)
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/balance", {}).status_code, 422)
        self.assertEqual(len(self.gateway.balances), 1)
        actions = [e["action"] for e in rows(self.store, "audit_events")]
        for name in ("admin.key_disabled", "admin.key_enabled", "admin.key_limits", "admin.key_balance"):
            self.assertIn(name, actions)
        self.assertEqual(self.audit("admin.key_balance")[0]["target_id"], gid)

    def test_balance_amount_validation(self):
        admin = self.admin()
        _user, gid = self.issue(admin)
        for bad in (0, -1, 1.234, 100000.01, True, "abc", "NaN", None, [1]):
            self.assertEqual(self.post(admin, f"/admin/keys/{gid}/balance", {"addUsd": bad}).status_code, 422, bad)
        for bad in (-1, 0.001, 100001, "Infinity"):
            self.assertEqual(self.post(admin, f"/admin/keys/{gid}/balance", {"setUsd": bad}).status_code, 422, bad)
        self.assertEqual(self.gateway.balances, [])
        r = self.post(admin, f"/admin/keys/{gid}/balance", {"setUsd": 0})
        self.assertEqual(r.json()["balanceUsd"], "0.00")
        self.assertEqual(self.gateway.balances[-1], (gid, None, 0))

    def test_disable_requires_boolean(self):
        admin = self.admin()
        _user, gid = self.issue(admin)
        for bad in ("true", 1, None):
            self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": bad}).status_code, 422)
        self.assertEqual(self.gateway.disabled, [])

    def test_unmanaged_key_has_no_local_row_to_sync(self):
        admin = self.admin()
        self.assertEqual(self.post(admin, "/admin/keys/manual-key/disable", {"disabled": True}).status_code, 200)
        self.assertEqual(self.gateway.disabled, ["manual-key"])
        self.assertEqual(self.audit("admin.key_disabled")[0]["target_id"], "manual-key")

    def test_gateway_rejections_surface_status(self):
        admin = self.admin()
        self.gateway.reject = GatewayError("rejected", 404, "Key not found")
        r = self.post(admin, "/admin/keys/nope/disable", {"disabled": True})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"], "gateway_rejected")
        self.assertEqual(r.json()["detail"], "Key not found")
        self.assertEqual(self.post(admin, "/admin/keys/bad id/disable", {"disabled": True}).status_code, 404)
        self.assertEqual(self.post(admin, "/admin/keys/bad id/disable", {"disabled": True}).json()["error"], "key_not_found")
        self.assertEqual(self.audit("admin.key_disabled"), [])

    def test_gateway_failure_keeps_local_state(self):
        admin = self.admin()
        _user, gid = self.issue(admin)
        self.gateway.reject = 500
        r = self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": True})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "gateway_unavailable")
        self.assertNotIn("private upstream token", r.text)
        self.gateway.reject = 422
        r = self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": True})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"], "gateway_rejected")
        self.assertEqual(rows(self.store, "gateway_keys")[0]["status"], "active")
        self.assertEqual(self.audit("admin.key_disabled"), [])

    def test_enable_refuses_keys_of_a_disabled_account(self):
        admin = self.admin()
        user, gid = self.issue(admin)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"}).json()["keysRevoked"], 1)
        r = self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": False})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json(), {"error": "account_disabled", "detail": "Enable the account first."})
        self.assertEqual(self.gateway.enabled, [])
        self.assertEqual(rows(self.store, "gateway_keys")[0]["status"], "revoked")
        self.assertEqual(self.audit("admin.key_enabled"), [])
        # Disabling stays possible, and once the account is enabled again its keys can be too.
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": True}).status_code, 200)
        self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "enable"})
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": False}).status_code, 200)
        self.assertEqual(self.gateway.enabled, [gid])
        self.assertEqual(rows(self.store, "gateway_keys")[0]["status"], "active")

    def test_enable_of_an_active_accounts_key_and_of_unowned_keys_still_works(self):
        admin = self.admin()
        _user, gid = self.issue(admin)
        self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": True})
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": False}).status_code, 200)
        self.assertEqual(self.post(admin, "/admin/keys/manual-key/disable", {"disabled": False}).status_code, 200)
        self.assertEqual(self.gateway.enabled, [gid, "manual-key"])

    def test_rejected_gateway_token_is_reported_as_auth_failure(self):
        admin = self.admin()
        _user, gid = self.issue(admin)
        for status in (401, 403):
            self.gateway.reject = status
            for response in (admin.get(BASE + "/admin/keys"), self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": True}),
                             self.post(admin, "/admin/gateway/models/glm-5.3/toggle", {})):
                self.assertEqual(response.status_code, 503, response.text)
                self.assertEqual(response.json(), {"error": "gateway_auth_failed",
                                                   "detail": "The portal's gateway token was rejected. Check PC_GATEWAY_ADMIN_TOKEN."})
        self.assertEqual(rows(self.store, "gateway_keys")[0]["status"], "active")
        self.assertEqual(self.audit("admin.key_disabled"), [])
        self.assertEqual(self.audit("admin.model_toggled"), [])

    def test_unconfigured_gateway_blocks_writes(self):
        admin = self.admin()
        self.gateway.configured = False
        r = self.post(admin, "/admin/keys/x/disable", {"disabled": True})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "provider_not_configured")

    def test_customer_forbidden(self):
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/admin/keys").status_code, 403)
        self.assertEqual(self.post(client, "/admin/keys/x/balance", {"addUsd": 1}).status_code, 403)
        self.assertEqual(self.post(client, "/admin/keys/x/disable", {"disabled": True}).status_code, 403)
        self.assertEqual(self.post(client, "/admin/keys/x/limits", {"rpm": 1}).status_code, 403)
        self.assertEqual((self.gateway.disabled, self.gateway.limits, self.gateway.balances), ([], [], []))
        self.assertEqual(self.client().get(BASE + "/admin/keys").status_code, 401)


class AdminUsageTests(_PortalCase):
    def test_month_report_with_ownership_and_totals(self):
        self.store.create_user("admin@example.test", "Admin", PASSWORD, role="admin")
        admin = self.client()
        self.assertEqual(self.post(admin, "/auth/login", {"email": "admin@example.test", "password": PASSWORD}).status_code, 200)
        user = self.register(self.client(), "a@example.test")
        issued = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).json()
        gid = issued["key"]["gatewayKeyId"]
        self.gateway.report = {"month": "2026-10", "keys": [
            {"key_id": gid, "label": "portal:x:A", "requests": 3, "prompt_tokens": 10, "completion_tokens": 20, "cost_usd": "0.123456", "by_model": [{"model": "m", "requests": 3, "prompt_tokens": 10, "completion_tokens": 20, "cost_usd": "0.123456"}], "by_day": []},
            {"key_id": "manual-key", "label": "ops", "requests": 1, "prompt_tokens": 1, "completion_tokens": 1, "cost_usd": "0.000001", "by_model": [], "by_day": []},
        ], "total_cost_usd": "0.123457", "total_requests": 4, "unpriced_models": [], "amount_status": "confirmed", "since": 0, "until": 0}
        body = admin.get(BASE + "/admin/usage?month=2026-10").json()
        self.assertEqual(body["totals"], {"requests": 4, "costUsd": "0.123457"})
        owned = next(k for k in body["keys"] if k["gatewayKeyId"] == gid)
        self.assertEqual(owned["owner"]["email"], "a@example.test")
        self.assertEqual(owned["costUsd"], "0.123456")
        self.assertEqual([c for c in body["byCustomer"] if c["owner"] and c["owner"]["email"] == "a@example.test"][0]["requests"], 3)
        self.assertEqual(self.gateway.months[-1], "2026-10")
        self.assertEqual(admin.get(BASE + "/admin/usage?month=2026-13").status_code, 400)
        self.gateway.fail = True
        self.assertEqual(admin.get(BASE + "/admin/usage?month=2026-10").status_code, 503)

    def test_full_shape_ordering_and_passthrough(self):
        admin = self.admin()
        u1 = self.register(self.client(), "a@example.test")
        u2 = self.register(self.client(), "b@example.test")
        g1 = self.post(admin, f"/admin/customers/{u1['id']}/keys", {"label": "A", "prepaidUsd": 5}).json()["key"]["gatewayKeyId"]
        g2 = self.post(admin, f"/admin/customers/{u1['id']}/keys", {"label": "A2", "prepaidUsd": 5}).json()["key"]["gatewayKeyId"]
        g3 = self.post(admin, f"/admin/customers/{u2['id']}/keys", {"label": "B", "prepaidUsd": 5}).json()["key"]["gatewayKeyId"]

        def entry(key_id, requests, cost, models=()):
            return {"key_id": key_id, "label": "L-" + key_id, "requests": requests, "prompt_tokens": 7, "completion_tokens": 9, "cost_usd": cost,
                    "by_model": [{"model": m, "requests": requests, "prompt_tokens": 7, "completion_tokens": 9, "cost_usd": cost} for m in models], "by_day": []}
        self.gateway.report = {"month": "2026-10", "keys": [
            entry(g1, 2, "0.100000", ["m1"]), entry(g2, 3, "0.250000"), entry(g3, 1, "0.300000"), entry("manual-key", 5, "0.000500"),
        ], "total_cost_usd": "0.650500", "total_requests": 11, "unpriced_models": ["mystery"], "amount_status": "estimated"}
        body = admin.get(BASE + "/admin/usage?month=2026-10").json()
        self.assertEqual(set(body), {"month", "source", "totals", "amountStatus", "unpricedModels", "keys", "byCustomer", "updatedAt"})
        self.assertEqual(body["source"], "gateway")
        self.assertEqual(body["amountStatus"], "estimated")
        self.assertEqual(body["unpricedModels"], ["mystery"])
        self.assertTrue(body["updatedAt"])
        self.assertEqual([k["gatewayKeyId"] for k in body["keys"]], [g3, g2, g1, "manual-key"])
        first = next(k for k in body["keys"] if k["gatewayKeyId"] == g1)
        self.assertEqual(set(first), {"gatewayKeyId", "label", "owner", "requests", "inputTokens", "outputTokens", "costUsd", "byModel"})
        self.assertEqual((first["label"], first["requests"], first["inputTokens"], first["outputTokens"]), ("L-" + g1, 2, 7, 9))
        self.assertEqual(first["byModel"], [{"model": "m1", "requests": 2, "inputTokens": 7, "outputTokens": 9, "costUsd": "0.100000"}])
        self.assertIsNone(next(k for k in body["keys"] if k["gatewayKeyId"] == "manual-key")["owner"])
        self.assertEqual([(c["owner"] and c["owner"]["email"], c["requests"], c["costUsd"]) for c in body["byCustomer"]],
                         [("a@example.test", 5, "0.350000"), ("b@example.test", 1, "0.300000"), (None, 5, "0.000500")])
        self.assertEqual(set(body["byCustomer"][0]["owner"]), {"id", "email", "name"})

    def test_unconfigured_gateway_is_empty_200(self):
        admin = self.admin()
        self.gateway.configured = False
        r = admin.get(BASE + "/admin/usage?month=2026-10")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["source"], "unconfigured")
        self.assertEqual((body["keys"], body["byCustomer"], body["unpricedModels"]), ([], [], []))
        self.assertEqual(body["totals"], {"requests": 0, "costUsd": "0.000000"})
        self.assertIsNone(body["amountStatus"])
        self.assertEqual(body["month"], "2026-10")

    def test_malformed_report_is_503_never_zeros(self):
        admin = self.admin()
        good = {"key_id": "k", "label": "l", "requests": 1, "prompt_tokens": 1, "completion_tokens": 1, "cost_usd": "0.1", "by_model": []}
        base = {"month": "2026-10", "keys": [good], "total_cost_usd": "0.1", "total_requests": 1, "unpriced_models": [], "amount_status": "confirmed"}
        cases = [
            dict(base, keys=[dict(good, cost_usd="abc")]),
            dict(base, keys=[dict(good, requests=-1)]),
            dict(base, keys=[dict(good, requests=True)]),
            dict(base, keys=[dict(good, by_model=[{"model": "m", "requests": 1, "prompt_tokens": 1, "completion_tokens": 1, "cost_usd": "nan"}])]),
            dict(base, keys="nope"),
            dict(base, total_cost_usd="x"),
            {k: v for k, v in base.items() if k != "total_requests"},
            dict(base, total_requests=1.5),
            dict(base, unpriced_models=[1]),
        ]
        for report in cases:
            self.gateway.report = report
            self.assertEqual(admin.get(BASE + "/admin/usage?month=2026-10").status_code, 503, report)

    def test_customers_and_anonymous_are_rejected(self):
        self.register(self.client(), "a@example.test")
        customer = self.client()
        self.post(customer, "/auth/login", {"email": "a@example.test", "password": PASSWORD})
        self.assertEqual(customer.get(BASE + "/admin/usage?month=2026-10").status_code, 403)
        self.assertEqual(self.client().get(BASE + "/admin/usage?month=2026-10").status_code, 401)


class AdminGatewayTests(_PortalCase):
    def test_overview_isolates_failures(self):
        admin = self.admin()
        body = admin.get(BASE + "/admin/gateway").json()
        self.assertTrue(body["gatewayConfigured"])
        self.assertEqual(body["state"]["gateway"]["public_base_url"], "https://gateway.example")
        self.assertEqual(body["errors"], {"state": None, "nodes": None, "metrics": None})
        self.gateway.fail = True
        body = admin.get(BASE + "/admin/gateway").json()
        self.assertIsNone(body["state"])
        self.assertEqual(body["errors"]["state"], "unavailable")

    def test_overview_failure_of_one_call_does_not_hide_the_others(self):
        admin = self.admin()

        async def broken():
            raise GatewayError("invalid_response")

        async def crash():
            raise RuntimeError("private upstream token must never escape")

        self.gateway.nodes = broken
        self.gateway.metrics = crash
        response = admin.get(BASE + "/admin/gateway")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["state"], self.gateway.state_value)
        self.assertIsNone(body["nodes"])
        self.assertIsNone(body["metrics"])
        self.assertEqual(body["errors"], {"state": None, "nodes": "invalid_response", "metrics": "unavailable"})
        self.assertNotIn("private upstream token", response.text)

    def test_overview_unconfigured_does_not_call_the_gateway(self):
        admin = self.admin()
        self.gateway.configured = False
        self.gateway.fail = True
        body = admin.get(BASE + "/admin/gateway").json()
        self.assertEqual(body, {"gatewayConfigured": False, "state": None, "nodes": None, "metrics": None,
                                "errors": {"state": "unconfigured", "nodes": "unconfigured", "metrics": "unconfigured"}})

    def test_model_and_node_actions_are_audited(self):
        admin = self.admin()
        self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/toggle", {}).json()["enabled"], True)
        self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/maintenance", {"message": "down for 10 min"}).status_code, 200)
        self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/maintenance", {"message": "x" * 301}).status_code, 422)
        r = self.post(admin, "/admin/gateway/nodes/b300-14/ops/check", {})
        self.assertEqual(r.json()["job_id"], "job-1")
        self.assertEqual(self.post(admin, "/admin/gateway/nodes/b300-14/ops/format", {}).status_code, 400)
        self.assertEqual(admin.get(BASE + "/admin/gateway/nodes/b300-14/jobs/job-1").json()["state"], "done")
        actions = [e["action"] for e in rows(self.store, "audit_events")]
        for name in ("admin.model_toggled", "admin.model_maintenance", "admin.node_op"):
            self.assertIn(name, actions)
        self.assertEqual(self.gateway.ops, [("b300-14", "check")])
        self.assertEqual(self.gateway.toggled, ["glm-5.3"])
        self.assertEqual(self.gateway.maintenance, [("glm-5.3", "down for 10 min")])
        self.assertEqual([e["target_id"] for e in self.audit("admin.model_toggled")], ["glm-5.3"])
        self.assertEqual([e["target_id"] for e in self.audit("admin.model_maintenance")], ["glm-5.3"])
        self.assertEqual([e["target_id"] for e in self.audit("admin.node_op")], ["b300-14:check"])
        self.assertEqual(self.audit("admin.model_toggled")[0]["actor_id"], self.user_id("admin@example.test"))

    def test_model_id_with_slash_and_empty_maintenance_message(self):
        admin = self.admin()
        self.assertEqual(self.post(admin, "/admin/gateway/models/zai-org/GLM-5.3/toggle", {}).json()["id"], "zai-org/GLM-5.3")
        self.assertEqual(self.post(admin, "/admin/gateway/models/zai-org/GLM-5.3/maintenance", {}).status_code, 200)
        self.assertEqual(self.post(admin, "/admin/gateway/models/zai-org/GLM-5.3/maintenance", {"message": ""}).status_code, 200)
        self.assertEqual(self.gateway.maintenance, [("zai-org/GLM-5.3", ""), ("zai-org/GLM-5.3", "")])
        for bad in (None, 5, ["x"]):
            self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/maintenance", {"message": bad}).status_code, 422, bad)
        self.assertEqual(len(self.gateway.maintenance), 2)

    def test_gateway_rejection_and_outage_are_mapped_and_not_audited(self):
        admin = self.admin()
        self.gateway.reject = GatewayError("rejected", 404, "unknown model")
        r = self.post(admin, "/admin/gateway/models/glm-9/toggle", {})
        self.assertEqual((r.status_code, r.json()["error"]), (404, "gateway_rejected"))
        self.gateway.reject = None
        self.gateway.fail = True
        r = self.post(admin, "/admin/gateway/nodes/b300-14/ops/check", {})
        self.assertEqual((r.status_code, r.json()["error"]), (503, "gateway_unavailable"))
        self.assertNotIn("private upstream token", r.text)
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.model") or e["action"] == "admin.node_op"], [])

    def test_unconfigured_gateway_refuses_writes(self):
        admin = self.admin()
        self.gateway.configured = False
        r = self.post(admin, "/admin/gateway/models/glm-5.3/toggle", {})
        self.assertEqual((r.status_code, r.json()["error"]), (503, "provider_not_configured"))
        self.assertEqual(self.gateway.toggled, [])

    def test_bad_path_parameters_never_reach_the_gateway(self):
        admin = self.admin()
        r = self.post(admin, "/admin/gateway/nodes/bad name/ops/check", {})
        self.assertEqual((r.status_code, r.json()["error"]), (400, "invalid_input"))
        r = admin.get(BASE + "/admin/gateway/nodes/b300-14/jobs/bad%20job")
        self.assertEqual((r.status_code, r.json()["error"]), (400, "invalid_input"))
        r = self.post(admin, "/admin/gateway/models/bad model/toggle", {})
        self.assertEqual((r.status_code, r.json()["error"]), (400, "invalid_input"))
        r = self.post(admin, "/admin/gateway/nodes/b300-14/ops/format", {})
        self.assertEqual((r.status_code, r.json()["error"]), (400, "unknown_action"))
        self.assertEqual((self.gateway.ops, self.gateway.toggled, self.gateway.maintenance), ([], [], []))

    def test_dot_segment_model_ids_never_reach_the_gateway(self):
        admin = self.admin()
        for path in ("/admin/gateway/models/a%2F..%2Fb/toggle", "/admin/gateway/models/../toggle",
                     "/admin/gateway/models//toggle", "/admin/gateway/models/a%2F.%2Fb/toggle", "/admin/gateway/models/a%2F..%2Fb/maintenance"):
            r = admin.post(BASE + path, json={"message": "x"}, headers={"Origin": ORIGIN})
            self.assertIn(r.status_code, (400, 404), path)
        self.assertEqual((self.gateway.toggled, self.gateway.maintenance), ([], []))
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.model")], [])

    def test_customer_forbidden(self):
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/admin/gateway").status_code, 403)
        self.assertEqual(self.post(client, "/admin/gateway/nodes/b300-14/ops/stop", {}).status_code, 403)
        self.assertEqual(self.post(client, "/admin/gateway/models/glm-5.3/toggle", {}).status_code, 403)
        self.assertEqual(client.get(BASE + "/admin/gateway/nodes/b300-14/jobs/job-1").status_code, 403)
        self.assertEqual(self.client().get(BASE + "/admin/gateway").status_code, 401)
        self.assertEqual((self.gateway.ops, self.gateway.toggled), ([], []))


if __name__ == "__main__":
    unittest.main()
