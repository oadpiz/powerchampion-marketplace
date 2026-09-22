"""Real portal boundary tests; model transport is always injected, never billed."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from server.app import create_app
from server.settings import Settings

ORIGIN = "http://localhost:3010"
BASE = "/api/portal/runtime"
TEST_KEY = "test-model-key-never-billed"


class RuntimeApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.encryption_key = Fernet.generate_key().decode()
        self.calls = []

        async def model(messages, tools, model, api_key, max_tokens):
            self.calls.append({"messages": messages, "key": api_key})
            return {"choices": [{"message": {"role": "assistant", "content": "Finished the requested analysis."}}],
                    "usage": {"prompt_tokens": 30, "completion_tokens": 10}}

        self.app = create_app(Settings(db_path=str(Path(self.directory.name) / "portal.sqlite"),
                                       allowed_origins=(ORIGIN,), runtime_enabled=True,
                                       runtime_encryption_key=self.encryption_key), runtime_model=model)
        self.client = TestClient(self.app, base_url=ORIGIN)
        self.other = TestClient(self.app, base_url=ORIGIN)
        for client, name in ((self.client, "alice"), (self.other, "bob")):
            response = client.post("/api/portal/auth/register", headers={"Origin": ORIGIN}, json={
                "email": name + "@example.test", "name": name, "password": "Test-password-for-runtime!"})
            self.assertEqual(response.status_code, 201)
        self.user = self.client.get("/api/portal/session").json()["user"]

    def tearDown(self):
        self.client.close()
        self.other.close()
        self.directory.cleanup()

    def post(self, path, body, client=None):
        return (client or self.client).post(BASE + path, json=body, headers={"Origin": ORIGIN})

    def create(self, **overrides):
        return self.post("/tasks", {"goal": "Analyze these sources and prepare a report.", "model": "glm-5.2-fp8",
                                    "apiKey": TEST_KEY, "references": [{"name": "source.txt", "content": "Verified input."}], **overrides})

    def test_configuration_requires_account_and_never_discloses_secrets(self):
        response = self.client.get(BASE + "/config")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["available"])
        self.assertIn("read_url", response.json()["tools"])
        self.assertNotIn(self.encryption_key, response.text)
        self.assertIn("no-store", response.headers["cache-control"])
        self.assertIn("noindex", response.headers["x-robots-tag"])
        with TestClient(self.app, base_url=ORIGIN) as anonymous:
            self.assertEqual(anonymous.get(BASE + "/config").status_code, 401)

    def test_task_is_encrypted_owner_scoped_and_does_not_execute_in_request(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.text)
        task = response.json()["task"]
        self.assertEqual(task["status"], "queued")
        self.assertEqual(self.calls, [])
        self.assertNotIn(TEST_KEY, response.text)
        self.assertNotIn(self.encryption_key, response.text)
        self.assertNotIn("encrypted_key", response.text)
        stored = Path(self.app.state.settings.db_path).read_bytes()
        self.assertNotIn(TEST_KEY.encode(), stored)
        for suffix in ("", "/artifacts/" + "a" * 32):
            self.assertEqual(self.other.get(BASE + "/tasks/" + task["id"] + suffix).status_code, 404)
        self.assertEqual(self.post("/tasks/" + task["id"] + "/control", {"action": "cancel"}, self.other).status_code, 404)
        self.assertEqual(self.post("/tasks/" + task["id"] + "/instructions", {"message": "Steal task"}, self.other).status_code, 404)
        self.assertEqual(self.post("/tasks/" + task["id"] + "/approval", {"approvalId": "a" * 32, "decision": "approve"}, self.other).status_code, 404)

    def test_background_tick_completes_without_any_browser_connection(self):
        task = self.create().json()["task"]
        asyncio.run(self.app.state.runtime_engine.tick())
        result = self.client.get(BASE + "/tasks/" + task["id"]).json()["task"]
        self.assertEqual(result["status"], "completed", result)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0]["key"], TEST_KEY)
        self.assertEqual(result["stepCount"], 1)
        self.assertNotIn(TEST_KEY, json.dumps(result))

    def test_origin_and_validation_fail_before_execution(self):
        response = self.client.post(BASE + "/tasks", json={}, headers={"Origin": "https://other.example"})
        self.assertEqual(response.status_code, 403)
        for changes in ({"apiKey": ""}, {"goal": TEST_KEY}, {"model": "unknown"}, {"maxSteps": 0},
                        {"maxSteps": True}, {"maxOutputTokens": 9999}, {"references": [{"name": "a", "content": TEST_KEY}]}):
            self.assertEqual(self.create(**changes).status_code, 400, changes)
        self.assertEqual(self.calls, [])
        task_id = self.create().json()["task"]["id"]
        response = self.post("/tasks/" + task_id + "/instructions", {"message": "Please use " + TEST_KEY})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(TEST_KEY, self.client.get(BASE + "/tasks/" + task_id).text)

    def test_saved_agent_must_belong_to_owner_and_snapshot_is_fixed(self):
        response = self.client.post("/api/portal/agents", headers={"Origin": ORIGIN}, json={
            "name": "Analyst", "model": "glm-5.2-fp8", "purpose": "Analyze sources", "instructions": "Cite evidence.",
            "tone": "Clear", "knowledge": "Approved source material", "samplePrompt": "", "maxOutputTokens": 512})
        self.assertEqual(response.status_code, 201, response.text)
        agent = response.json()["agent"]
        task = self.create(agentId=agent["id"]).json()["task"]
        self.assertEqual(task["agentId"], agent["id"])
        self.assertEqual(task["agentVersion"], 1)
        unauthorized = self.post("/tasks", {"goal": "Read someone else's agent", "model": "glm-5.2-fp8", "apiKey": TEST_KEY,
                                             "agentId": agent["id"]}, self.other)
        self.assertEqual(unauthorized.status_code, 404)

    def test_json_escaped_credentials_cannot_enter_persisted_fields(self):
        for key in ('test-secret"withquote', 'test-secret\\backslash'):
            for field in ({"goal": "Use " + key}, {"references": [{"name": "source", "content": key}]},
                          {"references": [{"name": key, "content": "source"}]}):
                response = self.create(apiKey=key, **field)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertNotIn(key, response.text)
                self.assertNotIn(key.encode(), Path(self.app.state.settings.db_path).read_bytes())

    def test_reference_character_limit_accepts_full_multibyte_text(self):
        response = self.client.post(BASE + "/tasks", content=json.dumps({"goal": "分析資料", "model": "glm-5.2-fp8",
            "apiKey": TEST_KEY, "references": [{"name": "中文資料", "content": "中" * 32000}]}, ensure_ascii=False).encode(),
            headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(len(response.json()["task"]["references"][0]["content"]), 32000)

    def test_disabled_runtime_accepts_no_billable_work(self):
        for configured_key in ("", "invalid"):
            settings = Settings(db_path=str(Path(self.directory.name) / ("off-" + str(len(configured_key)) + ".sqlite")),
                                allowed_origins=(ORIGIN,), runtime_enabled=True, runtime_encryption_key=configured_key)
            app = create_app(settings)
            with TestClient(app, base_url=ORIGIN) as client:
                client.post("/api/portal/auth/register", headers={"Origin": ORIGIN}, json={"email": "off@example.test", "name": "Test", "password": "Test-password-for-runtime!"})
                self.assertFalse(client.get(BASE + "/config").json()["available"])
                self.assertEqual(client.post(BASE + "/tasks", json={}, headers={"Origin": ORIGIN}).status_code, 503)


if __name__ == "__main__":
    unittest.main()
