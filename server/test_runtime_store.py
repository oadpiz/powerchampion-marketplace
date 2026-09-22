"""Runtime persistence boundaries using real, temporary SQLite databases."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from server.runtime_store import RuntimeErrorDetail, RuntimeStore
from server.store import Store


class RuntimeStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.directory.name) / "portal.sqlite")
        # Password hashing is irrelevant to repository authorization tests.
        with self.store.connect() as con:
            for owner in ("alice", "bob"):
                con.execute("INSERT INTO users VALUES (?,?,?,?,?,?)",
                            (owner, owner + "@example.test", owner, "unused", "customer", 1))
        self.repo = RuntimeStore(self.store)

    def tearDown(self):
        self.directory.cleanup()

    def create(self, owner="alice", **updates):
        payload = {"goal": "Summarize the sales data", "model": "glm-5.2-fp8",
                   "apiKey": "customer-test-secret", "maxSteps": 3,
                   "maxOutputTokens": 512, "references": [{"name": "sales.csv", "content": "x,y\n1,2"}]}
        payload.update(updates)
        return self.repo.create(owner, payload, "encrypted-test-credential")

    def claim(self, worker="worker-a"):
        task = self.create()
        claimed = self.repo.claim(worker)
        self.assertEqual(claimed["id"], task["id"])
        return claimed

    def assert_error(self, status, operation):
        with self.assertRaises(RuntimeErrorDetail) as caught:
            operation()
        self.assertEqual(caught.exception.status, status)

    def test_owner_reads_are_durable_and_never_expose_internal_data(self):
        task = self.create()
        self.assertRegex(task["id"], r"^[a-f0-9]{32}$")
        reopened = RuntimeStore(Store(self.store.path))
        self.assertEqual(reopened.get("alice", task["id"])["references"][0]["content"], "x,y\n1,2")
        public = json.dumps(reopened.get("alice", task["id"])) + json.dumps(reopened.list("alice"))
        for private in ("encrypted-test-credential", "customer-test-secret", "encrypted_key", "messages", "owner_id"):
            self.assertNotIn(private, public)
        self.assertEqual(reopened.encrypted_key_for_owner("alice", task["id"]), "encrypted-test-credential")
        self.assert_error(404, lambda: reopened.encrypted_key_for_owner("bob", task["id"]))
        self.assertEqual(reopened.list("bob"), [])
        for operation in (
            lambda: reopened.get("bob", task["id"]),
            lambda: reopened.control("bob", task["id"], "cancel"),
            lambda: reopened.instruct("bob", task["id"], "ignore"),
            lambda: reopened.decide("bob", task["id"], "a" * 32, "approve"),
            lambda: reopened.artifact("bob", task["id"], "a" * 32),
        ):
            self.assert_error(404, operation)

    def test_input_bounds_reject_malformed_payloads(self):
        for change in ({"goal": " "}, {"goal": "x" * 6001}, {"maxSteps": True},
                       {"model": "unlisted-model"},
                       {"maxSteps": 21}, {"maxOutputTokens": 127}, {"maxOutputTokens": 4097},
                       {"references": [{"name": "x", "content": "x" * 32001}]},
                       {"references": [{"name": "x", "content": ""}] * 9}):
            with self.subTest(change=list(change)):
                self.assert_error(400, lambda: self.create(**change))

    def test_active_limit_is_atomic_and_includes_paused_tasks(self):
        first = self.create()
        self.repo.control("alice", first["id"], "pause")
        def create_one(_):
            try:
                return self.create()["id"]
            except RuntimeErrorDetail as error:
                return error.code
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(create_one, range(4)))
        self.assertEqual(len(self.repo.list("alice")), 2)
        self.assertEqual(sum(len(value) == 32 for value in results), 1)

    def test_agent_snapshot_is_owner_scoped_and_pinned(self):
        agent_id = "a" * 32
        with self.store.connect() as con:
            con.execute("INSERT INTO agents VALUES (?,?,?,'active',1,NULL,'',1,1)",
                        (agent_id, "alice", "Analyst"))
            con.execute("INSERT INTO agent_versions VALUES (?,1,?,?,?,?,?,?,?,?,1)",
                        (agent_id, "glm-5.2-fp8", "Analysis", "Use data", "", "", "", "System text", 512))
        self.assert_error(404, lambda: self.create("bob", agentId=agent_id))
        task = self.create(agentId=agent_id)
        self.assertEqual(task["agentVersion"], 1)
        internal = self.repo.claim("worker-a")
        self.assertEqual(internal["agent_snapshot"]["configuration"]["systemPrompt"], "System text")
        self.assertNotIn("agent_snapshot", task)

    def test_agent_snapshot_pins_the_version_validated_by_the_api(self):
        from server.agents import Agents, parse_version
        agents = Agents(self.store)
        config = {"model": "glm-5.2-fp8", "purpose": "Analyze", "instructions": "Original instructions",
                  "tone": "", "knowledge": "", "samplePrompt": "", "systemPrompt": "Original system", "maxOutputTokens": 512}
        first, _token = agents.create("alice", "Analyst", parse_version(config))
        validated = {field: first[field] for field in ("id", "name", "version", "configuration")}
        agents.add_version("alice", first["id"], "Changed name", parse_version({**config, "systemPrompt": "Changed system"}))
        task = self.repo.create("alice", {"goal": "Run the approved version", "model": "glm-5.2-fp8", "agentId": first["id"]},
                                "encrypted-test-credential", agent_snapshot=validated)
        self.assertEqual(task["agentVersion"], 1)
        claimed = self.repo.claim("worker-a")
        self.assertEqual(claimed["agent_snapshot"], validated)
        altered = {**validated, "configuration": {**validated["configuration"], "systemPrompt": "Injected"}}
        self.assert_error(409, lambda: self.repo.create("alice", {"goal": "Try forged version", "model": "glm-5.2-fp8", "agentId": first["id"]},
                                                       "encrypted-test-credential", agent_snapshot=altered))

    def test_atomic_claim_and_lease_fencing(self):
        self.create()
        with ThreadPoolExecutor(max_workers=4) as pool:
            claims = list(pool.map(lambda i: self.repo.claim("worker-" + str(i)), range(4)))
        self.assertEqual(sum(task is not None for task in claims), 1)
        task = next(task for task in claims if task)
        self.assertFalse(self.repo.reserve_step(task["id"], "intruder"))
        self.assertFalse(self.repo.checkpoint(task["id"], "intruder", []))
        self.assertFalse(self.repo.finish(task["id"], "intruder", "completed"))
        self.assertFalse(self.repo.heartbeat(task["id"], "intruder"))
        self.assertEqual(self.repo.get("alice", task["id"])["status"], "running")

    def test_stale_restart_pauses_and_never_automatically_replays(self):
        with patch("server.runtime_store.time.time", return_value=1000):
            task = self.claim()
            self.assertTrue(self.repo.reserve_step(task["id"], "worker-a"))
        with patch("server.runtime_store.time.time", return_value=1121):
            reopened = RuntimeStore(Store(self.store.path))
            self.assertIsNone(reopened.claim("worker-b"))
            paused = reopened.get("alice", task["id"])
            self.assertEqual(paused["status"], "paused")
            self.assertEqual(paused["stepCount"], 1)
            self.assertFalse(reopened.finish(task["id"], "worker-a", "completed"))
            reopened.control("alice", task["id"], "resume")
            resumed = reopened.claim("worker-b")
            self.assertEqual(resumed["encrypted_key"], "encrypted-test-credential")
            self.assertEqual(resumed["stepCount"], 1)

    def test_heartbeat_extends_only_a_live_lease(self):
        with patch("server.runtime_store.time.time", return_value=1000):
            task = self.claim()
        with patch("server.runtime_store.time.time", return_value=1119):
            self.assertTrue(self.repo.heartbeat(task["id"], "worker-a"))
        with patch("server.runtime_store.time.time", return_value=1121):
            self.assertIsNone(self.repo.claim("worker-b"))
            self.assertEqual(self.repo.get("alice", task["id"])["status"], "running")
        with patch("server.runtime_store.time.time", return_value=1240):
            self.assertFalse(self.repo.heartbeat(task["id"], "worker-a"))

    def test_steps_are_reserved_before_calls_and_never_reset(self):
        task = self.claim()
        for _ in range(3):
            self.assertTrue(self.repo.reserve_step(task["id"], "worker-a"))
        self.assertFalse(self.repo.reserve_step(task["id"], "worker-a"))
        self.repo.finish(task["id"], "worker-a", "paused")
        # A final response or tool batch may still need completion after pause.
        self.repo.control("alice", task["id"], "resume")
        self.repo.claim("worker-b")
        self.assertFalse(self.repo.reserve_step(task["id"], "worker-b"))
        self.assertEqual(self.repo.get("alice", task["id"])["stepCount"], 3)

    def test_checkpoints_persist_plan_messages_events_and_cumulative_usage(self):
        task = self.claim()
        messages = [{"role": "user", "content": "Analyze"}]
        plan = [{"id": "a", "title": "Read sales", "status": "in_progress"}]
        self.assertTrue(self.repo.checkpoint(task["id"], "worker-a", messages,
                        event={"kind": "tool", "title": "Read reference", "content": "Loaded sales.csv"},
                        plan=plan, usage={"inputTokens": 5, "outputTokens": 2}))
        self.assertTrue(self.repo.checkpoint(task["id"], "worker-a", messages,
                        usage={"inputTokens": 3, "outputTokens": 1}))
        public = self.repo.get("alice", task["id"])
        self.assertEqual(public["usage"], {"inputTokens": 8, "outputTokens": 3})
        self.assertEqual(public["plan"], plan)
        self.assertEqual(public["events"][-1]["content"], "Loaded sales.csv")
        self.assertNotIn("messages", public)

    def test_instructions_survive_consumption_crash_and_preserve_order(self):
        task = self.claim()
        original = [{"role": "user", "content": "Analyze"}, {"role": "assistant", "content": "Ready"}]
        self.repo.checkpoint(task["id"], "worker-a", original)
        self.repo.instruct("alice", task["id"], "Use EUR")
        self.repo.instruct("alice", task["id"], "Then compare years")
        self.assertEqual(self.repo.drain_instructions(task["id"], "worker-a"), ["Use EUR", "Then compare years"])
        self.assertEqual(self.repo.drain_instructions(task["id"], "worker-a"), [])
        self.repo.finish(task["id"], "worker-a", "paused")
        self.repo.control("alice", task["id"], "resume")
        resumed = self.repo.claim("worker-b")
        self.assertEqual(resumed["messages"][-2:], [{"role": "user", "content": "Use EUR"},
                                                    {"role": "user", "content": "Then compare years"}])

    def test_control_is_cooperative_and_cancel_wins_completion_race(self):
        task = self.claim()
        requested = self.repo.control("alice", task["id"], "pause")
        self.assertEqual((requested["status"], requested["requestedControl"]), ("running", "pause"))
        self.assertEqual(self.repo.observe_control(task["id"], "worker-a"), "pause")
        self.repo.control("alice", task["id"], "cancel")
        self.assertTrue(self.repo.finish(task["id"], "worker-a", "completed", summary="Late completion"))
        self.assertEqual(self.repo.get("alice", task["id"])["status"], "cancelled")
        for action in ("resume", "pause", "cancel"):
            self.assert_error(409, lambda: self.repo.control("alice", task["id"], action))

    def test_release_pauses_and_does_not_requeue_an_uncertain_call(self):
        task = self.claim()
        self.repo.release(task["id"], "worker-a")
        self.assertEqual(self.repo.get("alice", task["id"])["status"], "paused")
        self.assertIsNone(self.repo.claim("worker-b"))

    def test_late_instruction_pauses_completion_instead_of_losing_steering(self):
        task = self.claim()
        self.repo.checkpoint(task["id"], "worker-a", [{"role": "assistant", "content": "First answer"}])
        self.assertEqual(self.repo.drain_instructions(task["id"], "worker-a"), [])
        self.repo.instruct("alice", task["id"], "Compare the previous year too")
        self.repo.finish(task["id"], "worker-a", "completed", summary="First answer")
        self.assertEqual(self.repo.get("alice", task["id"])["status"], "paused")
        self.assertEqual(self.repo.encrypted_key_for_owner("alice", task["id"]), "encrypted-test-credential")
        self.repo.control("alice", task["id"], "resume")
        self.repo.claim("worker-b")
        self.assertEqual(self.repo.drain_instructions(task["id"], "worker-b"), ["Compare the previous year too"])

    def test_instruction_delivery_waits_for_all_pending_tool_results(self):
        task = self.claim()
        pending = [{"role": "assistant", "content": None, "tool_calls": [
            {"id": "call-1", "type": "function", "function": {"name": "read_reference", "arguments": "{}"}}]}]
        self.repo.checkpoint(task["id"], "worker-a", pending)
        self.repo.instruct("alice", task["id"], "Compare years")
        self.assert_error(409, lambda: self.repo.drain_instructions(task["id"], "worker-a"))
        pending.append({"role": "tool", "tool_call_id": "call-1", "content": "sales data"})
        self.repo.checkpoint(task["id"], "worker-a", pending)
        self.assertEqual(self.repo.drain_instructions(task["id"], "worker-a"), ["Compare years"])

    def test_public_input_rejects_unpaired_unicode_surrogates(self):
        self.assert_error(400, lambda: self.create(goal="Task\ud800"))

    def test_approval_cannot_change_arguments_or_bypass_cancel(self):
        task = self.claim()
        messages = [{"role": "assistant", "content": None, "tool_calls": [
            {"id": "call-1", "type": "function", "function": {"name": "read_url", "arguments": '{"url":"https://example.com/a"}'}}]}]
        self.assert_error(409, lambda: self.repo.request_approval(task["id"], "worker-a", "read_url",
                          {"url": "https://example.com/b"}, "call-1", messages))
        self.assertEqual(self.repo.get("alice", task["id"])["status"], "running")
        self.repo.control("alice", task["id"], "cancel")
        self.assertIsNone(self.repo.request_approval(task["id"], "worker-a", "read_url",
                          {"url": "https://example.com/a"}, "call-1", messages))
        public = self.repo.get("alice", task["id"])
        self.assertEqual(public["status"], "cancelled")
        self.assertIsNone(public["approval"])
        self.assertIsNone(self.repo.encrypted_key_for_owner("alice", task["id"]))

    def test_deciding_approval_preserves_an_explicit_pause(self):
        for decision in ("approve", "reject"):
            with self.subTest(decision=decision):
                task = self.claim()
                messages = [{"role": "assistant", "content": None, "tool_calls": [
                    {"id": "call-1", "type": "function", "function": {"name": "read_url", "arguments": '{"url":"https://example.com/a"}'}}]}]
                approval = self.repo.request_approval(task["id"], "worker-a", "read_url",
                             {"url": "https://example.com/a"}, "call-1", messages)
                self.repo.control("alice", task["id"], "pause")
                decided = self.repo.decide("alice", task["id"], approval["id"], decision)
                self.assertEqual(decided["status"], "paused")
                self.assertIsNone(self.repo.claim("worker-b"))
                self.repo.control("alice", task["id"], "resume")
                self.assertEqual(self.repo.claim("worker-b")["id"], task["id"])
                self.repo.finish(task["id"], "worker-b", "completed")

    def test_oversized_checkpoint_rolls_back_event_and_usage(self):
        task = self.claim()
        self.assert_error(409, lambda: self.repo.checkpoint(task["id"], "worker-a",
                         [{"role": "user", "content": "x" * (256 * 1024)}],
                         event={"kind": "model", "title": "Not committed"},
                         usage={"inputTokens": 100, "outputTokens": 100}))
        public = self.repo.get("alice", task["id"])
        self.assertEqual(public["usage"], {"inputTokens": 0, "outputTokens": 0})
        self.assertEqual(len(public["events"]), 1)

    def test_instruction_queue_and_event_history_are_bounded(self):
        task = self.claim()
        for _ in range(32):
            self.repo.instruct("alice", task["id"], "An instruction")
        self.assert_error(409, lambda: self.repo.instruct("alice", task["id"], "Overflow"))
        self.assertEqual(len(self.repo.drain_instructions(task["id"], "worker-a")), 32)
        for _ in range(220):
            self.repo.checkpoint(task["id"], "worker-a", [], event={"kind": "model", "title": "Progress"})
        self.assertLessEqual(len(self.repo.get("alice", task["id"])["events"]), 200)

    def test_large_unicode_events_keep_details_under_response_budget(self):
        task = self.claim()
        for _ in range(65):
            self.repo.checkpoint(task["id"], "worker-a", [], event={"kind": "model", "title": "Progress", "content": "漢" * 4000})
        body = json.dumps(self.repo.get("alice", task["id"]), ensure_ascii=False).encode("utf-8")
        self.assertLess(len(body), 700000)

    def test_terminal_credentials_erased_and_terminal_mutations_rejected(self):
        for status in ("completed", "failed", "cancelled"):
            with self.subTest(status=status):
                task = self.claim()
                self.assertTrue(self.repo.finish(task["id"], "worker-a", status, error="Safe error"))
                with self.store.connect() as con:
                    row = con.execute("SELECT encrypted_key FROM runtime_tasks WHERE id=?", (task["id"],)).fetchone()
                self.assertIsNone(row["encrypted_key"])
                self.assertFalse(self.repo.checkpoint(task["id"], "worker-a", []))
                self.assert_error(409, lambda: self.repo.instruct("alice", task["id"], "Again"))

    def test_approval_binds_exact_call_and_only_decision_requeues(self):
        task = self.claim()
        messages = [{"role": "assistant", "content": None, "tool_calls": [
            {"id": "call-1", "type": "function", "function": {"name": "read_url", "arguments": '{"url":"https://example.com/a"}'}}]}]
        approval = self.repo.request_approval(task["id"], "worker-a", "read_url",
                    {"url": "https://example.com/a"}, "call-1", messages)
        self.assertEqual(approval["status"], "pending")
        self.assertIsNone(self.repo.claim("worker-b"))
        self.assertFalse(self.repo.finish(task["id"], "worker-a", "completed"))
        self.assert_error(409, lambda: self.repo.control("alice", task["id"], "resume"))
        self.assert_error(409, lambda: self.repo.decide("alice", task["id"], "b" * 32, "approve"))
        self.repo.decide("alice", task["id"], approval["id"], "reject")
        self.assert_error(409, lambda: self.repo.decide("alice", task["id"], approval["id"], "approve"))
        resumed = self.repo.claim("worker-b")
        self.assertEqual(resumed["messages"], messages)
        result = self.repo.approval_result(task["id"])
        self.assertEqual((result["tool"], result["args"], result["call_id"], result["status"]),
                         ("read_url", {"url": "https://example.com/a"}, "call-1", "rejected"))

    def test_artifact_idempotency_owner_scope_and_stale_fencing(self):
        task = self.claim()
        artifact = {"name": "result.txt", "mimeType": "text/plain; charset=utf-8", "contentBase64": base64.b64encode(b"hello").decode()}
        first = self.repo.add_artifact(task["id"], "worker-a", artifact, "call-1")
        self.assertEqual(self.repo.add_artifact(task["id"], "worker-a", artifact, "call-1"), first)
        self.assertEqual(len(self.repo.get("alice", task["id"])["artifacts"]), 1)
        self.assertEqual(self.repo.artifact("alice", task["id"], first["id"])["contentBase64"], "aGVsbG8=")
        self.assert_error(404, lambda: self.repo.artifact("bob", task["id"], first["id"]))
        self.assert_error(409, lambda: self.repo.add_artifact(task["id"], "intruder", artifact, "call-2"))
        self.assert_error(400, lambda: self.repo.add_artifact(task["id"], "worker-a", {**artifact, "name": "../result.txt"}, "call-2"))
        self.assert_error(400, lambda: self.repo.add_artifact(task["id"], "worker-a", {**artifact, "contentBase64": "!"}, "call-2"))
        too_large = base64.b64encode(b"x" * (1024 * 1024 + 1)).decode()
        self.assert_error(400, lambda: self.repo.add_artifact(task["id"], "worker-a", {**artifact, "contentBase64": too_large}, "call-2"))

    def test_retention_deletes_oldest_terminal_tasks_and_cascades(self):
        oldest = None
        for _ in range(52):
            task = self.create()
            oldest = oldest or task["id"]
            self.repo.control("alice", task["id"], "cancel")
        self.assertEqual(len(self.repo.list("alice")), 50)
        self.assert_error(404, lambda: self.repo.get("alice", oldest))
        with self.store.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM runtime_events WHERE task_id=?", (oldest,)).fetchone()[0], 0)

    def test_fifty_unicode_task_summaries_fit_bff_response_limit(self):
        first = None
        for _ in range(50):
            task = self.create(goal="🙂" * 6000)
            first = first or task["id"]
            self.repo.claim("worker-a")
            self.repo.finish(task["id"], "worker-a", "failed", summary="🙂" * 16000, error="🙂" * 4000)
        summaries = self.repo.list("alice")
        self.assertEqual(len(summaries), 50)
        self.assertEqual(summaries[0]["goal"], "🙂" * 6000)
        self.assertLessEqual(len(summaries[0]["summary"]), 2000)
        body = json.dumps({"tasks": summaries}, ensure_ascii=False).encode("utf-8")
        self.assertLess(len(body), 2 * 1024 * 1024)
        self.assertEqual(self.repo.get("alice", first)["summary"], "🙂" * 16000)
        self.assertEqual(self.repo.get("alice", first)["error"], "🙂" * 4000)


if __name__ == "__main__":
    unittest.main()
