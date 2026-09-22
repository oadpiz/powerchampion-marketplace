"""Real SQLite/tool lifecycle tests; every model response is local and scripted."""
import asyncio
import base64
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from cryptography.fernet import Fernet

from server.agents import Agents, parse_version
from server.runtime_engine import RuntimeEngine
from server.runtime_store import RuntimeStore
from server.runtime_tools import RuntimeTools
from server.store import Store


KEY = "test-customer-secret-12345"


def answer(content=None, calls=None):
    message = {"role": "assistant", "content": content}
    if calls:
        message["tool_calls"] = [
            {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
            for call_id, name, args in calls
        ]
    return {"choices": [{"message": message, "finish_reason": "tool_calls" if calls else "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


class ScriptedModel:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def __call__(self, messages, tools, model, api_key, max_tokens):
        self.calls.append(json.loads(json.dumps(messages)))
        if api_key != KEY:
            raise AssertionError("The gateway did not receive the decrypted credential")
        if not self.replies:
            raise AssertionError("Unexpected additional paid model call")
        reply = self.replies.pop(0)
        if callable(reply):
            reply = reply(messages)
        if isinstance(reply, Exception):
            raise reply
        return reply


class RuntimeEngineTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.directory.name) / "runtime.sqlite")
        self.user = self.store.create_user("engine@example.test", "Engine", "runtime-test-password!")["id"]
        self.repository = RuntimeStore(self.store)
        self.encryption = Fernet.generate_key()
        self.settings = SimpleNamespace(runtime_enabled=True, runtime_encryption_key=self.encryption.decode(),
                                        gateway_origin="https://gateway.example.test")

    def tearDown(self):
        self.directory.cleanup()

    def create(self, **overrides):
        payload = {"goal": "Analyze sales and produce a report", "model": "glm-5.2-fp8", "maxSteps": 12,
                   "maxOutputTokens": 512, "references": [], **overrides}
        ciphertext = Fernet(self.encryption).encrypt(KEY.encode()).decode()
        return self.repository.create(self.user, payload, ciphertext)

    def get(self, task):
        return self.repository.get(self.user, task["id"])

    def assert_secret_absent(self, task):
        self.assertNotIn(KEY, json.dumps(self.get(task)))
        with self.store.connect() as connection:
            for table in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
                if table["name"].startswith("runtime_"):
                    rows = [dict(row) for row in connection.execute('SELECT * FROM "' + table["name"] + '"').fetchall()]
                    self.assertNotIn(KEY, str(rows))

    async def test_reference_csv_plan_docx_flow_persists_real_deliverable(self):
        task = self.create(references=[{"name": "sales.csv", "content": "team,amount\nA,10\nA,20\nB,5\n"}])
        reference = self.get(task)["references"][0]["id"]
        model = ScriptedModel([
            answer(calls=[("plan1", "update_plan", {"steps": [{"id": "report", "title": "Analyze sales", "status": "in_progress"}]}),
                          ("read1", "read_reference", {"id": reference})]),
            answer(calls=[("csv1", "analyze_csv", {"referenceId": reference, "numericColumns": ["amount"], "groupBy": "team"})]),
            answer(calls=[("doc1", "write_artifact", {"name": "report.docx", "format": "docx", "content": "業績分析\nA: 30; B: 5; total: 35"}),
                          ("plan2", "update_plan", {"steps": [{"id": "report", "title": "Analyze sales", "status": "completed"}]})]),
            answer("The report is ready; total sales are 35."),
        ])
        await RuntimeEngine(self.repository, self.settings, model=model).tick()
        result = self.get(task)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["stepCount"], 4)
        self.assertEqual(result["usage"], {"inputTokens": 40, "outputTokens": 20})
        self.assertEqual(result["plan"][0]["status"], "completed")
        artifact = self.repository.artifact(self.user, task["id"], result["artifacts"][0]["id"])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(artifact["contentBase64"]))) as document:
            self.assertIn("業績分析", document.read("word/document.xml").decode())
        self.assertEqual([message["tool_call_id"] for message in model.calls[1] if message["role"] == "tool"], ["plan1", "read1"])
        self.assertIn("35", json.dumps(model.calls[2]))
        self.assert_secret_absent(task)

    async def test_runtime_is_opt_in(self):
        task = self.create()
        model = ScriptedModel([answer("done")])
        self.settings.runtime_enabled = False
        await RuntimeEngine(self.repository, self.settings, model=model).tick()
        self.assertEqual(self.get(task)["status"], "queued")
        self.assertEqual(model.calls, [])

    async def test_budget_is_reserved_before_call_and_cannot_be_reset(self):
        task = self.create(maxSteps=1)
        def reply(_messages):
            self.assertEqual(self.get(task)["stepCount"], 1)
            return answer(calls=[("p1", "update_plan", {"steps": [{"id": "x", "title": "Work", "status": "pending"}]})])
        model = ScriptedModel([reply])
        await RuntimeEngine(self.repository, self.settings, model=model).tick()
        self.assertEqual(self.get(task)["status"], "failed")
        self.assertEqual(len(model.calls), 1)
        self.assertIn("limit", self.get(task)["error"].lower())

    async def test_final_step_pause_resumes_saved_answer_without_new_paid_call(self):
        task = self.create(maxSteps=1)
        def reply(_messages):
            self.repository.control(self.user, task["id"], "pause")
            return answer("Final answer already received")
        model = ScriptedModel([reply])
        engine = RuntimeEngine(self.repository, self.settings, model=model)
        await engine.tick()
        self.assertEqual(self.get(task)["status"], "paused")
        self.repository.control(self.user, task["id"], "resume")
        await engine.tick()
        self.assertEqual(self.get(task)["status"], "completed")
        self.assertEqual(self.get(task)["summary"], "Final answer already received")
        self.assertEqual(len(model.calls), 1)

    async def test_pause_racing_budget_reservation_does_not_report_budget_error(self):
        task = self.create()
        reserve = self.repository.reserve_step
        def pause_before_reservation(task_id, worker_id):
            self.repository.control(self.user, task_id, "pause")
            return reserve(task_id, worker_id)
        model = ScriptedModel([])
        with patch.object(self.repository, "reserve_step", side_effect=pause_before_reservation):
            await RuntimeEngine(self.repository, self.settings, model=model).tick()
        result = self.get(task)
        self.assertEqual(result["status"], "paused")
        self.assertIsNone(result["error"])
        self.assertEqual(result["stepCount"], 0)

    async def test_interrupted_artifact_checkpoint_resumes_idempotently(self):
        task = self.create()
        model = ScriptedModel([answer(calls=[("a1", "write_artifact", {"name": "report.txt", "format": "txt", "content": "Report"})]), answer("Artifact saved")])
        engine = RuntimeEngine(self.repository, self.settings, model=model)
        real_checkpoint = self.repository.checkpoint
        def interrupt_checkpoint(task_id, worker_id, messages, **kwargs):
            if messages[-1]["role"] == "tool":
                raise asyncio.CancelledError()
            return real_checkpoint(task_id, worker_id, messages, **kwargs)
        with patch.object(self.repository, "checkpoint", side_effect=interrupt_checkpoint):
            with self.assertRaises(asyncio.CancelledError):
                await engine.tick()
        interrupted = self.get(task)
        self.assertEqual(interrupted["status"], "paused")
        artifact_id = interrupted["artifacts"][0]["id"]
        self.repository.control(self.user, task["id"], "resume")
        await engine.tick()
        result = self.get(task)
        self.assertEqual(result["status"], "completed")
        self.assertEqual([artifact["id"] for artifact in result["artifacts"]], [artifact_id])
        self.assertEqual(len(model.calls), 2)

    async def test_transcript_limit_stops_tools_without_another_paid_call(self):
        task = self.create(references=[{"name": "large.txt", "content": "x" * 32000}])
        reference = self.get(task)["references"][0]["id"]
        model = ScriptedModel([answer(calls=[("read" + str(batch * 4 + index), "read_reference", {"id": reference}) for index in range(4)]) for batch in range(3)])
        await RuntimeEngine(self.repository, self.settings, model=model).tick()
        result = self.get(task)
        self.assertEqual(result["status"], "failed")
        self.assertIn("transcript limit", result["error"].lower())
        self.assertLessEqual(len(model.calls), 3)

    async def test_total_execution_timeout_cancels_work_and_does_not_retry(self):
        task = self.create()
        cancelled = asyncio.Event()
        async def blocked_model(*_args):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        with patch("server.runtime_engine.RUN_TIMEOUT", 0.01):
            await RuntimeEngine(self.repository, self.settings, model=blocked_model).tick()
        self.assertTrue(cancelled.is_set())
        self.assertEqual(self.get(task)["status"], "failed")
        self.assertIn("time limit", self.get(task)["error"].lower())
        self.assertEqual(self.get(task)["stepCount"], 1)

    async def test_pause_and_steering_preserve_complete_tool_batch_ordering(self):
        task = self.create()
        actual_tools = RuntimeTools()
        repository, user = self.repository, self.user
        class Tools:
            def definitions(self):
                return actual_tools.definitions()
            async def execute(self, name, args, context):
                if name == "update_plan":
                    repository.instruct(user, task["id"], "Include a conclusion")
                    repository.control(user, task["id"], "pause")
                return await actual_tools.execute(name, args, context)
        model = ScriptedModel([answer(calls=[("p1", "update_plan", {"steps": [{"id": "x", "title": "Report", "status": "pending"}]}),
                                            ("a1", "write_artifact", {"name": "draft.txt", "format": "txt", "content": "Draft"})]),
                               answer("Conclusion included.")])
        engine = RuntimeEngine(self.repository, self.settings, model=model, tools=Tools())
        await engine.tick()
        self.assertEqual(self.get(task)["status"], "paused")
        self.assertEqual(len(self.get(task)["artifacts"]), 1)
        self.repository.control(self.user, task["id"], "resume")
        await engine.tick()
        messages = model.calls[1]
        calls_index = next(index for index, message in enumerate(messages) if message.get("tool_calls"))
        self.assertEqual([message["role"] for message in messages[calls_index:calls_index + 4]], ["assistant", "tool", "tool", "user"])
        self.assertEqual(messages[-1]["content"], "Include a conclusion")
        self.assertEqual(self.get(task)["status"], "completed")

    async def test_cancel_at_tool_boundary_makes_no_next_model_call(self):
        task = self.create()
        def reply(_messages):
            self.repository.control(self.user, task["id"], "cancel")
            return answer(calls=[("a1", "write_artifact", {"name": "draft.txt", "format": "txt", "content": "Draft"})])
        model = ScriptedModel([reply])
        await RuntimeEngine(self.repository, self.settings, model=model).tick()
        self.assertEqual(self.get(task)["status"], "cancelled")
        self.assertEqual(len(model.calls), 1)

    async def test_exact_url_approval_resumes_without_repeating_paid_model(self):
        task = self.create()
        actual_tools = RuntimeTools()
        urls = []
        class Tools:
            def definitions(self):
                return actual_tools.definitions()
            async def execute(self, name, args, context):
                if name == "read_url":
                    urls.append(args["url"])
                    return {"content": "Local fixture page"}
                return await actual_tools.execute(name, args, context)
        model = ScriptedModel([answer(calls=[("web1", "read_url", {"url": "https://example.com/one"}),
                                            ("web2", "read_url", {"url": "https://example.com/two"})]), answer("Read approved page only.")])
        engine = RuntimeEngine(self.repository, self.settings, model=model, tools=Tools())
        await engine.tick()
        result = self.get(task)
        self.assertEqual(result["status"], "awaiting_approval")
        self.assertEqual(urls, [])
        self.assertEqual(result["approval"]["args"], {"url": "https://example.com/one"})
        self.repository.decide(self.user, task["id"], result["approval"]["id"], "approve")
        await engine.tick()
        self.assertEqual(urls, ["https://example.com/one"])
        self.assertEqual(len(model.calls), 1)
        result = self.get(task)
        self.assertEqual(result["approval"]["args"], {"url": "https://example.com/two"})
        self.repository.decide(self.user, task["id"], result["approval"]["id"], "reject")
        await engine.tick()
        self.assertEqual(self.get(task)["status"], "completed")
        self.assertEqual(urls, ["https://example.com/one"])
        self.assertEqual([message["tool_call_id"] for message in model.calls[1] if message["role"] == "tool"], ["web1", "web2"])
        self.assertIn("reject", model.calls[1][-1]["content"].lower())

    async def test_secret_is_removed_before_docx_generation_and_events(self):
        task = self.create()
        model = ScriptedModel([answer(KEY, [("doc1", "write_artifact", {"name": "report.docx", "format": "docx", "content": "Credential " + KEY})]), answer(KEY)])
        await RuntimeEngine(self.repository, self.settings, model=model).tick()
        result = self.get(task)
        self.assert_secret_absent(task)
        artifact = self.repository.artifact(self.user, task["id"], result["artifacts"][0]["id"])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(artifact["contentBase64"]))) as document:
            self.assertNotIn(KEY, document.read("word/document.xml").decode())
        self.assertNotIn(KEY, json.dumps(model.calls))

    async def test_malformed_and_failed_model_replies_are_terminal_without_retry(self):
        malformed_calls = answer("Must not accept this malformed tool list")
        malformed_calls["choices"][0]["message"]["tool_calls"] = {}
        fixtures = [{}, answer(""), malformed_calls, answer(calls=[("bad", "not_a_tool", {})]),
                    answer(calls=[(str(index), "read_url", {"url": "https://example.com"}) for index in range(5)]),
                    RuntimeError("Transport echoed " + KEY)]
        for index, fixture in enumerate(fixtures):
            with self.subTest(index=index):
                task = self.create()
                model = ScriptedModel([fixture])
                await RuntimeEngine(self.repository, self.settings, model=model).tick()
                self.assertEqual(self.get(task)["status"], "failed")
                self.assertEqual(self.get(task)["stepCount"], 1)
                self.assertEqual(len(model.calls), 1)
                self.assert_secret_absent(task)

    async def test_stale_reserved_call_is_paused_and_never_automatically_repeated(self):
        task = self.create()
        claimed = self.repository.claim("dead-worker", lease_seconds=1)
        self.assertEqual(claimed["id"], task["id"])
        self.assertTrue(self.repository.reserve_step(task["id"], "dead-worker"))
        with patch("server.runtime_store.time.time", return_value=100000000000):
            model = ScriptedModel([answer("must not run")])
            await RuntimeEngine(self.repository, self.settings, model=model).tick()
        self.assertEqual(self.get(task)["status"], "paused")
        self.assertEqual(self.get(task)["stepCount"], 1)
        self.assertEqual(model.calls, [])

    async def test_serve_stops_cleanly_without_external_requests(self):
        task = self.create()
        model = ScriptedModel([answer("done")])
        engine = RuntimeEngine(self.repository, self.settings, model=model)
        stop = asyncio.Event()
        serving = asyncio.create_task(engine.serve(stop))
        for _ in range(200):
            if self.get(task)["status"] == "completed":
                break
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(serving, 2)
        self.assertEqual(self.get(task)["status"], "completed")

    async def test_shutdown_pauses_uncertain_model_call_without_automatic_replay(self):
        task = self.create()
        started = asyncio.Event()
        async def blocked_model(*_args):
            started.set()
            await asyncio.Event().wait()
        engine = RuntimeEngine(self.repository, self.settings, model=blocked_model)
        running = asyncio.create_task(engine.tick())
        await asyncio.wait_for(started.wait(), 2)
        running.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await running
        self.assertEqual(self.get(task)["status"], "paused")
        self.assertEqual(self.get(task)["stepCount"], 1)
        no_retry = ScriptedModel([])
        await RuntimeEngine(self.repository, self.settings, model=no_retry).tick()
        self.assertEqual(no_retry.calls, [])

    async def test_long_model_work_renews_lease(self):
        task = self.create()
        async def slow_model(*_args):
            await asyncio.sleep(0.06)
            return answer("Completed after heartbeat")
        with patch("server.runtime_engine.HEARTBEAT_SECONDS", 0.01), patch.object(self.repository, "heartbeat", wraps=self.repository.heartbeat) as renew:
            await RuntimeEngine(self.repository, self.settings, model=slow_model).tick()
        self.assertGreaterEqual(renew.call_count, 1)
        self.assertEqual(self.get(task)["status"], "completed")

    async def test_lost_lease_cancels_model_work_and_cannot_finish_task(self):
        task = self.create()
        cancelled = asyncio.Event()
        async def blocked_model(*_args):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        with patch("server.runtime_engine.HEARTBEAT_SECONDS", 0.01), patch.object(self.repository, "heartbeat", return_value=False):
            await RuntimeEngine(self.repository, self.settings, model=blocked_model).tick()
        self.assertTrue(cancelled.is_set())
        self.assertNotEqual(self.get(task)["status"], "completed")
        self.assertEqual(self.get(task)["stepCount"], 1)

    async def test_agent_structured_instructions_enable_runtime_tools(self):
        configuration = parse_version({"model": "glm-5.2-fp8", "purpose": "Prepare sales reports", "instructions": "Always include totals", "tone": "Direct", "knowledge": "Amounts are USD", "samplePrompt": "", "systemPrompt": "Old static mode: cannot use tools"})
        agent, _token = Agents(self.store).create(self.user, "Reporter", configuration)
        task = self.create(agentId=agent["id"])
        model = ScriptedModel([answer("done")])
        await RuntimeEngine(self.repository, self.settings, model=model).tick()
        system = "\n".join(message["content"] for message in model.calls[0] if message["role"] == "system")
        self.assertIn("Always include totals", system)
        self.assertIn("Amounts are USD", system)
        self.assertNotIn("Old static mode", system)
        self.assertEqual(self.get(task)["status"], "completed")

    async def test_gateway_uses_fixed_origin_auth_and_bounded_json_response(self):
        task = self.create()
        requests = []
        async def handler(request):
            requests.append(request)
            return httpx.Response(200, json=answer("Gateway fixture complete"))
        client_type = httpx.AsyncClient
        def client(**kwargs):
            return client_type(transport=httpx.MockTransport(handler), **kwargs)
        with patch("server.runtime_engine.httpx.AsyncClient", side_effect=client):
            await RuntimeEngine(self.repository, self.settings).tick()
        self.assertEqual(self.get(task)["status"], "completed")
        self.assertEqual(str(requests[0].url), "https://gateway.example.test/v1/chat/completions")
        self.assertEqual(requests[0].headers["Authorization"], "Bearer " + KEY)
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["max_tokens"], 512)
        self.assertFalse(payload["stream"])
        self.assertNotIn(KEY, json.dumps(payload))

    async def test_gateway_refuses_redirects_large_bodies_and_invalid_json_without_retry(self):
        fixtures = [httpx.Response(302, headers={"Location": "https://untrusted.example/steal"}),
                    httpx.Response(200, content=b"x" * (256 * 1024 + 1)),
                    httpx.Response(200, content=b"not JSON"),
                    httpx.Response(401, content=KEY.encode())]
        client_type = httpx.AsyncClient
        for fixture in fixtures:
            with self.subTest(status=fixture.status_code, size=len(fixture.content)):
                task = self.create()
                requests = []
                async def handler(request):
                    requests.append(request)
                    return fixture
                def client(**kwargs):
                    return client_type(transport=httpx.MockTransport(handler), **kwargs)
                with patch("server.runtime_engine.httpx.AsyncClient", side_effect=client):
                    await RuntimeEngine(self.repository, self.settings).tick()
                self.assertEqual(self.get(task)["status"], "failed")
                self.assertEqual(len(requests), 1)
                self.assert_secret_absent(task)


if __name__ == "__main__":
    unittest.main()
