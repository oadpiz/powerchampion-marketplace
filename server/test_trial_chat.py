"""No-paid-call tests for anonymous trial isolation, bounds and budget control."""
import asyncio
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from starlette.requests import Request

from server.app import create_app
from server.chat import TrialChat, validate_chat, ChatError
from server.settings import Settings
from server.store import Store


ORIGIN = "http://localhost:3010"
CONFIG = "/api/portal/trial/config"
CHAT = "/api/portal/trial/chat"
TEST_KEY = "sk-trial-fixture-not-a-real-key"


def payload(**overrides):
    return {"model": "glm-5.2-fp8", "messages": [{"role": "user", "content": "Explain solar energy."}], "system": "Be clear.", "maxTokens": 512, **overrides}


class TrialChatTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=str(Path(self.directory.name) / "trial.sqlite"), allowed_origins=(ORIGIN,), trial_enabled=True, trial_api_key=TEST_KEY, trial_daily_request_limit=100)
        self.requests = []
        self.lock = threading.Lock()
        self.status = 200
        self.reply = {"choices": [{"message": {"content": "Solar energy comes from sunlight."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18}}
        self.transport = httpx.MockTransport(self.upstream)
        self.app = create_app(self.settings, chat_transport=self.transport)
        self.client = TestClient(self.app, base_url=ORIGIN)
        self.clients = [self.client]

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.directory.cleanup()

    def upstream(self, request):
        with self.lock:
            self.requests.append(request)
        return httpx.Response(self.status, json=self.reply)

    def chat(self, client=None, body=None):
        return (client or self.client).post(CHAT, json=payload() if body is None else body, headers={"Origin": ORIGIN})

    def rows(self, table):
        with self.app.state.store.connect() as con:
            return [dict(row) for row in con.execute("SELECT * FROM " + table)]

    def new_app_client(self, settings=None):
        app = create_app(settings or self.settings, chat_transport=self.transport)
        client = TestClient(app, base_url=ORIGIN)
        self.clients.append(client)
        return client

    def test_default_and_incomplete_configuration_are_off(self):
        for settings in (replace(self.settings, trial_enabled=False), replace(self.settings, trial_api_key=""), replace(self.settings, trial_daily_request_limit=0), replace(self.settings, trial_api_key="bad\nkey")):
            client = self.new_app_client(settings)
            config = client.get(CONFIG)
            self.assertFalse(config.json()["trialAvailable"])
            self.assertNotIn("set-cookie", config.headers)
            response = self.chat(client)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["error"], "trial_unavailable")
        self.assertEqual(self.requests, [])
        self.assertEqual(self.rows("trial_requests"), [])

    def test_config_issues_only_hashed_trial_session_and_no_api_key(self):
        response = self.client.get(CONFIG)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"trialAvailable": True, "maxOutputTokens": 512, "remaining": 5, "maxHistoryCharacters": 8000, "maxSystemCharacters": 16000, "maxMessages": 24})
        self.assertNotIn(TEST_KEY, response.text)
        cookie = self.client.cookies.get("pc_trial_session")
        self.assertTrue(cookie)
        self.assertNotIn(cookie, json.dumps(self.rows("trial_sessions")))
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        self.assertIn("samesite=lax", response.headers["set-cookie"].lower())
        self.assertNotIn("pc_portal_session", response.headers["set-cookie"])

    def test_multiturn_forwarding_uses_fixed_gateway_and_preserves_history(self):
        messages = [{"role": "user", "content": "First question"}, {"role": "assistant", "content": "Previous answer"}, {"role": "user", "content": "Explain it further"}]
        response = self.chat(body=payload(messages=messages))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["mode"], "trial")
        self.assertEqual(response.json()["usage"], {"input": 10, "output": 8, "total": 18})
        request = self.requests[0]
        self.assertEqual(str(request.url), "https://b300.powerchampion.ai/v1/chat/completions")
        self.assertEqual(request.headers["authorization"], "Bearer " + TEST_KEY)
        self.assertEqual(json.loads(request.content)["messages"], [{"role": "system", "content": "Be clear."}] + messages)
        self.assertFalse(json.loads(request.content)["stream"])
        self.assertEqual(self.rows("trial_requests")[0]["status"], "succeeded")

    def test_key_echo_is_redacted_and_conversations_are_not_persisted(self):
        self.reply["choices"][0]["message"]["content"] = "Never repeat " + TEST_KEY
        response = self.chat()
        self.assertEqual(response.json()["content"], "Never repeat [redacted]")
        with self.app.state.store.connect() as con:
            dump = "\n".join(con.iterdump())
        self.assertNotIn(TEST_KEY, dump)
        self.assertNotIn("Explain solar energy.", dump)
        self.assertNotIn("Solar energy comes from sunlight.", dump)

    def test_session_allowance_includes_failed_calls(self):
        self.status = 503
        for _ in range(5):
            self.assertEqual(self.chat().status_code, 502)
        limited = self.chat()
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json()["error"], "trial_limit")
        self.assertEqual(len(self.requests), 5)
        self.assertEqual(self.client.get(CONFIG).json()["remaining"], 0)
        self.assertTrue(all(row["status"] == "failed" for row in self.rows("trial_requests")))

    def test_cookie_reset_cannot_bypass_global_daily_cap_or_restart(self):
        client = self.new_app_client(replace(self.settings, trial_daily_request_limit=2))
        for _ in range(2):
            client.cookies.clear()
            self.assertEqual(self.chat(client).status_code, 200)
        client.cookies.clear()
        self.assertEqual(self.chat(client).status_code, 429)
        restarted = self.new_app_client(replace(self.settings, trial_daily_request_limit=2))
        self.assertEqual(self.chat(restarted).status_code, 429)
        self.assertEqual(len(self.requests), 2)

    def test_concurrent_anonymous_calls_reserve_global_budget_atomically(self):
        settings = replace(self.settings, trial_daily_request_limit=3)
        clients = [self.new_app_client(settings) for _ in range(12)]
        with ThreadPoolExecutor(max_workers=12) as executor:
            codes = list(executor.map(lambda client: self.chat(client).status_code, clients))
        self.assertEqual(codes.count(200), 3, codes)
        self.assertEqual(codes.count(429), 9, codes)
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(len(self.rows("trial_requests")), 3)

    def test_validation_rejects_oversized_or_nonchat_input_before_reservation(self):
        bad = [payload(messages=[]), payload(messages=[{"role": "system", "content": "bad"}]), payload(messages=[{"role": "assistant", "content": "bad"}]), payload(messages=[{"role": "user", "content": "A" * 8001}]), payload(messages=[{"role": "user", "content": "x"}] * 25), payload(system="A" * 16001), payload(maxTokens=513), payload(maxTokens=True), payload(model=[]), payload(model="other-model")]
        for body in bad:
            with self.subTest(body=str(body)[:90]):
                response = self.chat(body=body)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(response.json()["error"], "input")
        self.assertEqual(self.requests, [])
        self.assertEqual(self.rows("trial_requests"), [])

    def test_trial_accepts_16000_character_agent_knowledge(self):
        response = self.chat(body=payload(system="x" * 16000))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(json.loads(self.requests[0].content)["messages"][0]["content"]), 16000)

    def test_origin_and_large_body_are_rejected(self):
        self.assertEqual(self.client.post(CHAT, json=payload()).status_code, 403)
        self.assertEqual(self.client.post(CHAT, json=payload(), headers={"Origin": "https://other.example"}).status_code, 403)
        response = self.client.post(CHAT, content="x" * 196609, headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.requests, [])

    def test_upstream_redirects_and_raw_errors_do_not_escape(self):
        def redirect(request):
            self.requests.append(request)
            return httpx.Response(307, headers={"Location": "https://attacker.example/"}, text=TEST_KEY)
        client = TestClient(create_app(self.settings, chat_transport=httpx.MockTransport(redirect)), base_url=ORIGIN)
        self.clients.append(client)
        response = self.chat(client)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(TEST_KEY, response.text)
        self.assertEqual(len(self.requests), 1)

    def test_malformed_and_oversized_model_responses_fail_closed(self):
        for content in (b"broken", json.dumps({"choices": []}).encode(), b"x" * 524289):
            client = TestClient(create_app(self.settings, chat_transport=httpx.MockTransport(lambda request: httpx.Response(200, content=content))), base_url=ORIGIN)
            self.clients.append(client)
            response = self.chat(client)
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["error"], "response")

    def test_upstream_timeout_consumes_reservation(self):
        def timeout(request):
            raise httpx.ReadTimeout("private upstream error", request=request)
        client = TestClient(create_app(self.settings, chat_transport=httpx.MockTransport(timeout)), base_url=ORIGIN)
        self.clients.append(client)
        response = self.chat(client)
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()["error"], "timeout")
        self.assertNotIn("private upstream", response.text)
        self.assertEqual(len(self.rows("trial_requests")), 1)

    def test_absolute_timeout_cancels_a_stalled_response_body(self):
        cancelled = []
        class StalledStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'{"choices":'
                try:
                    await asyncio.sleep(10)
                except asyncio.CancelledError:
                    cancelled.append(True)
                    raise
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=StalledStream()))
        client = TestClient(create_app(self.settings, chat_transport=transport), base_url=ORIGIN)
        self.clients.append(client)
        with patch("server.chat.TIMEOUT_SECONDS", 0.02):
            response = self.chat(client)
        self.assertEqual(response.status_code, 504, response.text)
        self.assertEqual(cancelled, [True])
        self.assertEqual(self.rows("trial_requests")[0]["status"], "failed")

    def test_failed_first_call_still_sets_the_trial_cookie(self):
        self.status = 503
        response = self.chat()
        self.assertEqual(response.status_code, 502)
        self.assertIn("pc_trial_session=", response.headers["set-cookie"])
        self.assertEqual(self.client.get(CONFIG).json()["remaining"], 4)

    def test_disconnect_cancels_upstream_and_keeps_reservation(self):
        sent = False
        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": json.dumps(payload()).encode(), "more_body": False}
            return {"type": "http.disconnect"}
        request = Request({"type": "http", "method": "POST", "path": CHAT, "headers": [(b"content-type", b"application/json")]}, receive)
        service = TrialChat(self.settings, self.app.state.store, transport=self.transport)
        cancelled = []
        async def slow(_body):
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise
        service.upstream = slow
        response = asyncio.run(service.complete(request))
        self.assertEqual(response.status_code, 499)
        self.assertEqual(cancelled, [True])
        self.assertEqual(self.rows("trial_requests")[0]["status"], "cancelled")

    def test_new_utc_day_gets_a_new_daily_budget(self):
        client = self.new_app_client(replace(self.settings, trial_daily_request_limit=1))
        self.assertEqual(self.chat(client).status_code, 200)
        self.assertEqual(self.chat(client).status_code, 429)
        with self.app.state.store.connect() as con:
            con.execute("UPDATE trial_requests SET day='2000-01-01'")
        self.assertEqual(self.chat(client).status_code, 200)


if __name__ == "__main__":
    unittest.main()
