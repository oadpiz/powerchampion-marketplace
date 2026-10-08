import tempfile
import unittest

from fastapi.testclient import TestClient

from server.app import create_app
from server.settings import Settings
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


if __name__ == "__main__":
    unittest.main()
