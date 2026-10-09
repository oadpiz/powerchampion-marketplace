import tempfile
import unittest

from fastapi.testclient import TestClient

from server.app import create_app
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
        self.assertIn("admin.key_issued", [e["action"] for e in rows(self.store, "audit_events")])
        for bad in ({"label": "x"}, {"label": "x", "prepaidUsd": 0}, {"label": "x", "prepaidUsd": -1}, {"label": "x", "prepaidUsd": "ten"}):
            self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", bad).status_code, 422, bad)

    def test_customer_self_service_stays_closed_unless_enabled(self):
        client = self.client()
        self.register(client, "a@example.test")
        r = self.post(client, "/keys", {"label": "mine"})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "provider_not_configured")
        self.assertEqual(self.gateway.issued, [])

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

    def test_disable_still_succeeds_when_gateway_is_down(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).status_code, 201)
        self.gateway.fail = True
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["keysFailed"], 1)
        self.assertEqual(r.json()["customer"]["status"], "disabled")
        self.assertIn("key.revocation_needs_reconciliation", [e["action"] for e in rows(self.store, "audit_events")])

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


if __name__ == "__main__":
    unittest.main()
