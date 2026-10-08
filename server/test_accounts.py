import tempfile
import unittest

from fastapi.testclient import TestClient

from server.app import create_app
from server.settings import Settings
from server.test_agents import CONFIGURATION
from server.testsupport import fresh_database, rows

ORIGIN = "http://localhost:3010"
BASE = "/api/portal"
PASSWORD = "customer-test-password-123!"


class FakeGateway:
    configured = False


class _PortalCase(unittest.TestCase):
    """Shared fixture; holds no tests so subclasses do not re-run each other's cases."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,))
        self.app = create_app(self.settings, gateway=FakeGateway())
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
    def admin(self, email="admin@example.test"):
        self.store.create_user(email, "Admin", PASSWORD, role="admin")
        client = self.client()
        self.assertEqual(self.post(client, "/auth/login", {"email": email, "password": PASSWORD}).status_code, 200)
        return client

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


if __name__ == "__main__":
    unittest.main()
