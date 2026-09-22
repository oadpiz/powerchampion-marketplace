"""Durable owner-scoped task state with short, fenced SQLite transactions.

Only the API encrypts keys and only the worker decrypts them. This repository
stores ciphertext separately from the explicit public projections. A caller
must use a fresh worker ID per claim attempt: it is the lease's fencing token.
"""
import base64
import binascii
import json
import re
import time
import uuid

from .agents import SUPPORTED_MODELS, agent_json
from .store import iso


TERMINAL = ("completed", "failed", "cancelled")
EVENT_KINDS = ("queued", "model", "tool", "instruction", "control", "approval", "completed", "error")
MAX_EVENTS = 200
MAX_EVENT_BYTES = 512 * 1024
MAX_MESSAGES_BYTES = 256 * 1024
MAX_ARTIFACT_BYTES = 1024 * 1024
MAX_TOTAL_ARTIFACT_BYTES = 8 * MAX_ARTIFACT_BYTES
ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS runtime_tasks (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
 goal TEXT NOT NULL, model TEXT NOT NULL, agent_id TEXT, agent_version INTEGER,
 agent_snapshot TEXT, encrypted_key TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','running','paused','awaiting_approval','completed','failed','cancelled')),
 created_at REAL NOT NULL, updated_at REAL NOT NULL,
 step_count INTEGER NOT NULL DEFAULT 0, max_steps INTEGER NOT NULL,
 max_output_tokens INTEGER NOT NULL, requested_control TEXT,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 summary TEXT NOT NULL DEFAULT '', error TEXT,
 messages TEXT NOT NULL DEFAULT '[]', plan TEXT NOT NULL DEFAULT '[]',
 worker_id TEXT, lease_expires_at REAL
);
CREATE INDEX IF NOT EXISTS runtime_tasks_owner ON runtime_tasks(owner_id,created_at);
CREATE INDEX IF NOT EXISTS runtime_tasks_queue ON runtime_tasks(status,created_at);
CREATE TABLE IF NOT EXISTS runtime_references (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_events_task ON runtime_events(task_id,sequence);
CREATE TABLE IF NOT EXISTS runtime_instructions (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_instructions_task ON runtime_instructions(task_id,sequence);
CREATE TABLE IF NOT EXISTS runtime_approvals (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 tool TEXT NOT NULL, args TEXT NOT NULL, call_id TEXT NOT NULL,
 reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 created_at REAL NOT NULL, decided_at REAL,
 UNIQUE(task_id,call_id)
);
CREATE INDEX IF NOT EXISTS runtime_approvals_task ON runtime_approvals(task_id,sequence);
CREATE TABLE IF NOT EXISTS runtime_artifacts (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL,
 size INTEGER NOT NULL, content BLOB NOT NULL, created_at REAL NOT NULL,
 UNIQUE(task_id,call_id)
);
CREATE INDEX IF NOT EXISTS runtime_artifacts_task ON runtime_artifacts(task_id,sequence);
"""


class RuntimeErrorDetail(ValueError):
    def __init__(self, code, detail, status=400):
        super().__init__(detail)
        self.code, self.detail, self.status = code, detail, status


def _text(value, field, limit, *, empty=False, strip=True):
    if not isinstance(value, str):
        raise RuntimeErrorDetail("invalid_input", "Enter a valid " + field + ".")
    value = value.strip() if strip else value
    if len(value) > limit or (not empty and not value.strip()) or any(
            (ord(char) < 32 and char not in "\n\r\t") or ord(char) == 127
            or 0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise RuntimeErrorDetail("invalid_input", "Enter a valid " + field + ".")
    return value


def _integer(value, field, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise RuntimeErrorDetail("invalid_input", "Choose a valid " + field + ".")
    return value


def _json(value, limit=MAX_MESSAGES_BYTES):
    try:
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        size = len(serialized.encode("utf-8"))
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise RuntimeErrorDetail("invalid_input", "The task data must be valid JSON.") from None
    if size > limit:
        raise RuntimeErrorDetail("storage_limit", "The task context limit has been reached.", 409)
    return serialized


def _messages(value):
    if not isinstance(value, list) or len(value) > 300 or any(not isinstance(message, dict) for message in value):
        raise RuntimeErrorDetail("invalid_input", "Enter a valid task transcript.")
    return _json(value)


def _plan(value):
    if not isinstance(value, list) or len(value) > 20:
        raise RuntimeErrorDetail("invalid_input", "A plan may contain at most 20 steps.")
    result, seen = [], set()
    for step in value:
        if not isinstance(step, dict) or step.get("status") not in ("pending", "in_progress", "completed"):
            raise RuntimeErrorDetail("invalid_input", "Enter a valid plan step.")
        step_id = _text(step.get("id"), "plan step ID", 80)
        if step_id in seen:
            raise RuntimeErrorDetail("invalid_input", "Plan step IDs must be unique.")
        seen.add(step_id)
        result.append({"id": step_id, "title": _text(step.get("title"), "plan step title", 300),
                       "status": step["status"]})
    return _json(result)


def _redact(value, secret):
    if not secret:
        return value
    if isinstance(value, str):
        return value.replace(secret, "[REDACTED]")
    if isinstance(value, list):
        return [_redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {key: _redact(item, secret) for key, item in value.items()}
    return value


def _approval(row, internal=False):
    if row is None:
        return None
    result = {"id": row["id"], "tool": row["tool"], "args": json.loads(row["args"]),
              "reason": row["reason"], "status": row["status"]}
    if internal:
        result["call_id"] = row["call_id"]
    return result


def _artifact(row):
    return {"id": row["id"], "name": row["name"], "mimeType": row["mime_type"],
            "size": row["size"], "createdAt": iso(row["created_at"])}


class RuntimeStore:
    def __init__(self, store):
        self.store = store
        with store.connect() as con:
            con.executescript(SCHEMA)

    @staticmethod
    def _owned(con, owner_id, task_id):
        row = con.execute("SELECT * FROM runtime_tasks WHERE id=? AND owner_id=?", (task_id, owner_id)).fetchone()
        if row is None:
            raise RuntimeErrorDetail("not_found", "Task not found.", 404)
        return row

    @staticmethod
    def _leased(con, task_id, worker_id):
        return con.execute("SELECT * FROM runtime_tasks WHERE id=? AND status='running' AND worker_id=? AND lease_expires_at>?",
                           (task_id, worker_id, time.time())).fetchone()

    def _require_lease(self, con, task_id, worker_id):
        row = self._leased(con, task_id, worker_id)
        if row is None:
            raise RuntimeErrorDetail("lease_lost", "Task lease is no longer active.", 409)
        return row

    @staticmethod
    def _event(con, task_id, kind, title, content=""):
        if kind not in EVENT_KINDS:
            raise RuntimeErrorDetail("invalid_input", "Enter a valid event kind.")
        title = _text(title, "event title", 200)
        content = _text(content, "event content", 16000, empty=True, strip=False)
        con.execute("INSERT INTO runtime_events(id,task_id,kind,title,content,created_at) VALUES (?,?,?,?,?,?)",
                    (uuid.uuid4().hex, task_id, kind, title, content, time.time()))
        con.execute("DELETE FROM runtime_events WHERE task_id=? AND sequence NOT IN (SELECT sequence FROM runtime_events WHERE task_id=? ORDER BY sequence DESC LIMIT ?)",
                    (task_id, task_id, MAX_EVENTS))
        size = 0
        for event in con.execute("SELECT sequence,title,content FROM runtime_events WHERE task_id=? ORDER BY sequence DESC", (task_id,)).fetchall():
            # Include envelope overhead as well as UTF-8 content, so a history
            # of large Unicode instructions cannot overflow the BFF response.
            size += len(event["title"].encode("utf-8")) + len(event["content"].encode("utf-8")) + 256
            if size > MAX_EVENT_BYTES:
                con.execute("DELETE FROM runtime_events WHERE task_id=? AND sequence<=?", (task_id, event["sequence"]))
                break

    @staticmethod
    def _latest_approval(con, task_id):
        return con.execute("SELECT * FROM runtime_approvals WHERE task_id=? ORDER BY sequence DESC LIMIT 1", (task_id,)).fetchone()

    def _public(self, con, row, detail=True):
        result = {"id": row["id"], "goal": row["goal"], "status": row["status"], "model": row["model"],
                  "agentId": row["agent_id"], "agentVersion": row["agent_version"],
                  "createdAt": iso(row["created_at"]), "updatedAt": iso(row["updated_at"]),
                  "stepCount": row["step_count"], "maxSteps": row["max_steps"],
                  "maxOutputTokens": row["max_output_tokens"], "requestedControl": row["requested_control"],
                  "usage": {"inputTokens": row["input_tokens"], "outputTokens": row["output_tokens"]},
                  "summary": row["summary"] if detail else row["summary"][:2000],
                  "error": row["error"] if detail or row["error"] is None else row["error"][:512]}
        if detail:
            result.update(plan=json.loads(row["plan"]),
                          references=[dict(ref) for ref in con.execute("SELECT id,name,content FROM runtime_references WHERE task_id=? ORDER BY position", (row["id"],))],
                          artifacts=[_artifact(artifact) for artifact in con.execute("SELECT * FROM runtime_artifacts WHERE task_id=? ORDER BY sequence", (row["id"],))],
                          approval=_approval(self._latest_approval(con, row["id"])),
                          events=[{"id": event["id"], "kind": event["kind"], "title": event["title"],
                                   "content": event["content"], "createdAt": iso(event["created_at"])}
                                  for event in con.execute("SELECT * FROM runtime_events WHERE task_id=? ORDER BY sequence", (row["id"],))])
        return result

    def _internal(self, con, row):
        result = self._public(con, row)
        result.update(owner_id=row["owner_id"], encrypted_key=row["encrypted_key"],
                      agent_snapshot=json.loads(row["agent_snapshot"]) if row["agent_snapshot"] else None,
                      messages=json.loads(row["messages"]), worker_id=row["worker_id"],
                      lease_expires_at=row["lease_expires_at"])
        return result

    def create(self, user_id, payload, credential_ciphertext, agent_snapshot=None):
        if not isinstance(payload, dict):
            raise RuntimeErrorDetail("invalid_input", "Enter a valid task.")
        raw_key = payload.get("apiKey")
        if raw_key is not None and (not isinstance(raw_key, str) or not 8 <= len(raw_key) <= 512
                                    or any(not 33 <= ord(char) <= 126 for char in raw_key)):
            raise RuntimeErrorDetail("invalid_input", "Enter a valid API key.")
        # Never serialize the request itself: it may contain a plaintext API key.
        payload = _redact({key: value for key, value in payload.items() if key != "apiKey"}, raw_key)
        goal = _text(payload.get("goal"), "goal", 6000)
        model = _text(payload.get("model"), "model", 120)
        if model not in SUPPORTED_MODELS:
            raise RuntimeErrorDetail("invalid_input", "Choose a supported model.")
        maximum = _integer(payload.get("maxSteps", 12), "step limit", 1, 20)
        output_limit = _integer(payload.get("maxOutputTokens", 1024), "output limit", 128, 4096)
        if not isinstance(credential_ciphertext, str) or not 1 <= len(credential_ciphertext) <= 4096:
            raise RuntimeErrorDetail("invalid_input", "An encrypted task credential is required.")
        references = payload.get("references", [])
        if not isinstance(references, list) or len(references) > 8:
            raise RuntimeErrorDetail("invalid_input", "Attach at most eight references.")
        parsed_references = []
        for reference in references:
            if not isinstance(reference, dict):
                raise RuntimeErrorDetail("invalid_input", "Enter a valid reference.")
            parsed_references.append((_text(reference.get("name"), "reference name", 160),
                                      _text(reference.get("content"), "reference content", 32000, empty=True, strip=False)))
        if sum(len(content) for _, content in parsed_references) > 32000:
            raise RuntimeErrorDetail("invalid_input", "References may contain at most 32000 characters in total.")
        selected_agent = payload.get("agentId")
        if selected_agent is not None and (not isinstance(selected_agent, str) or not ID_PATTERN.fullmatch(selected_agent)):
            raise RuntimeErrorDetail("not_found", "Agent not found.", 404)
        now, task_id = time.time(), uuid.uuid4().hex
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            unfinished = con.execute("SELECT COUNT(*) FROM runtime_tasks WHERE owner_id=? AND status NOT IN ('completed','failed','cancelled')", (user_id,)).fetchone()[0]
            if unfinished >= 2:
                raise RuntimeErrorDetail("active_limit", "Finish or cancel an existing task before starting another.", 409)
            # Recheck ownership inside the transaction. Keep the immutable
            # version the API validated instead of racing a concurrent edit.
            snapshot, version = None, None
            if selected_agent:
                agent = con.execute("SELECT * FROM agents WHERE id=? AND user_id=? AND status='active'", (selected_agent, user_id)).fetchone()
                if agent is None:
                    raise RuntimeErrorDetail("not_found", "Agent not found.", 404)
                version = agent["current_version"]
                if agent_snapshot is not None:
                    if not isinstance(agent_snapshot, dict) or agent_snapshot.get("id") != selected_agent:
                        raise RuntimeErrorDetail("invalid_snapshot", "The selected agent snapshot does not match this task.", 409)
                    version = _integer(agent_snapshot.get("version"), "agent version", 1, 100000000)
                configuration = con.execute("SELECT * FROM agent_versions WHERE agent_id=? AND version=?", (selected_agent, version)).fetchone()
                if configuration is None:
                    raise RuntimeErrorDetail("not_found", "Agent version not found.", 404)
                canonical = agent_json(agent, configuration)
                canonical["version"] = version
                if agent_snapshot is not None:
                    if agent_snapshot.get("configuration") != canonical["configuration"]:
                        raise RuntimeErrorDetail("invalid_snapshot", "The selected agent configuration does not match its saved version.", 409)
                    # Names are mutable; preserve the API-validated name too.
                    canonical["name"] = _text(agent_snapshot.get("name"), "agent name", 80)
                snapshot = _json(_redact({key: canonical[key] for key in ("id", "name", "version", "configuration")}, raw_key))
            elif agent_snapshot is not None:
                raise RuntimeErrorDetail("invalid_input", "Select the agent for this task.")
            retained = con.execute("SELECT COUNT(*) FROM runtime_tasks WHERE owner_id=?", (user_id,)).fetchone()[0]
            if retained >= 50:
                con.execute("DELETE FROM runtime_tasks WHERE id IN (SELECT id FROM runtime_tasks WHERE owner_id=? AND status IN ('completed','failed','cancelled') ORDER BY created_at,id LIMIT ?)",
                            (user_id, retained - 49))
            con.execute("INSERT INTO runtime_tasks(id,owner_id,goal,model,agent_id,agent_version,agent_snapshot,encrypted_key,status,created_at,updated_at,max_steps,max_output_tokens) VALUES (?,?,?,?,?,?,?,?,'queued',?,?,?,?)",
                        (task_id, user_id, goal, model, selected_agent, version, snapshot, credential_ciphertext, now, now, maximum, output_limit))
            for index, (name, content) in enumerate(parsed_references):
                con.execute("INSERT INTO runtime_references VALUES (?,?,?,?,?)", (uuid.uuid4().hex, task_id, index, name, content))
            self._event(con, task_id, "queued", "Task queued")
            return self._public(con, self._owned(con, user_id, task_id))

    def list(self, user_id):
        with self.store.connect() as con:
            return [self._public(con, row, detail=False) for row in con.execute(
                "SELECT * FROM runtime_tasks WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 50", (user_id,))]

    def get(self, user_id, task_id):
        with self.store.connect() as con:
            return self._public(con, self._owned(con, user_id, task_id))

    def encrypted_key_for_owner(self, user_id, task_id):
        """Internal API validation only; never include this value in a response."""
        with self.store.connect() as con:
            return self._owned(con, user_id, task_id)["encrypted_key"]

    def control(self, user_id, task_id, action):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._owned(con, user_id, task_id)
            if action not in ("pause", "resume", "cancel"):
                raise RuntimeErrorDetail("invalid_input", "Choose pause, resume or cancel.")
            if row["status"] in TERMINAL:
                raise RuntimeErrorDetail("terminal_task", "This task has already ended.", 409)
            status, requested = row["status"], row["requested_control"]
            if action == "resume":
                approval = self._latest_approval(con, task_id)
                if status not in ("paused", "awaiting_approval") or (approval and approval["status"] == "pending"):
                    raise RuntimeErrorDetail("invalid_transition", "This task cannot resume until its pending work is resolved.", 409)
                if not row["encrypted_key"]:
                    raise RuntimeErrorDetail("missing_credential", "The task credential is no longer available.", 409)
                status, requested = "queued", None
            elif status == "running":
                # Once cancellation is requested, a later pause cannot undo it.
                requested = "cancel" if requested == "cancel" or action == "cancel" else "pause"
            else:
                status, requested = ("cancelled" if action == "cancel" else "paused"), None
            con.execute("UPDATE runtime_tasks SET status=?,requested_control=?,updated_at=?,error=CASE WHEN ?='resume' THEN NULL ELSE error END,encrypted_key=CASE WHEN ?='cancelled' THEN NULL ELSE encrypted_key END WHERE id=?",
                        (status, requested, time.time(), action, status, task_id))
            self._event(con, task_id, "control", "Control requested", action)
            return self._public(con, self._owned(con, user_id, task_id))

    def instruct(self, user_id, task_id, message):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._owned(con, user_id, task_id)
            if row["status"] in TERMINAL:
                raise RuntimeErrorDetail("terminal_task", "This task has already ended.", 409)
            message = _text(message, "instruction", 4000)
            count = con.execute("SELECT COUNT(*) FROM runtime_instructions WHERE task_id=?", (task_id,)).fetchone()[0]
            if count >= 32:
                raise RuntimeErrorDetail("instruction_limit", "Wait for the worker to read the pending instructions.", 409)
            con.execute("INSERT INTO runtime_instructions(task_id,content) VALUES (?,?)", (task_id, message))
            con.execute("UPDATE runtime_tasks SET updated_at=? WHERE id=?", (time.time(), task_id))
            self._event(con, task_id, "instruction", "User instruction", message)
            return self._public(con, self._owned(con, user_id, task_id))

    def decide(self, user_id, task_id, approval_id, decision):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._owned(con, user_id, task_id)
            if decision not in ("approve", "reject"):
                raise RuntimeErrorDetail("invalid_input", "Choose approve or reject.")
            approval = self._latest_approval(con, task_id)
            if row["status"] not in ("awaiting_approval", "paused") or approval is None or approval["id"] != approval_id or approval["status"] != "pending":
                raise RuntimeErrorDetail("stale_approval", "This approval is no longer pending.", 409)
            con.execute("UPDATE runtime_approvals SET status=?,decided_at=? WHERE id=?", ("approved" if decision == "approve" else "rejected", time.time(), approval_id))
            status = "paused" if row["status"] == "paused" else "queued"
            con.execute("UPDATE runtime_tasks SET status=?,requested_control=NULL,error=NULL,updated_at=? WHERE id=?", (status, time.time(), task_id))
            self._event(con, task_id, "approval", "Tool decision", decision)
            return self._public(con, self._owned(con, user_id, task_id))

    def artifact(self, user_id, task_id, artifact_id):
        with self.store.connect() as con:
            self._owned(con, user_id, task_id)
            row = con.execute("SELECT * FROM runtime_artifacts WHERE id=? AND task_id=?", (artifact_id, task_id)).fetchone()
            if row is None:
                raise RuntimeErrorDetail("not_found", "Artifact not found.", 404)
            return {"id": row["id"], "name": row["name"], "mimeType": row["mime_type"],
                    "size": row["size"], "contentBase64": base64.b64encode(row["content"]).decode("ascii")}

    def claim(self, worker_id, lease_seconds=120):
        worker_id = _text(worker_id, "worker ID", 128)
        lease_seconds = _integer(lease_seconds, "lease duration", 1, 600)
        now = time.time()
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            stale = con.execute("SELECT * FROM runtime_tasks WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)", (now,)).fetchall()
            for row in stale:
                status = "cancelled" if row["requested_control"] == "cancel" else "paused"
                con.execute("UPDATE runtime_tasks SET status=?,requested_control=NULL,worker_id=NULL,lease_expires_at=NULL,updated_at=?,error=?,encrypted_key=CASE WHEN ?='cancelled' THEN NULL ELSE encrypted_key END WHERE id=?",
                            (status, now, "Worker interrupted. Review the task before resuming; the last model call may have incurred usage.", status, row["id"]))
                self._event(con, row["id"], "control", "Interrupted task recovered", "Cancelled." if status == "cancelled" else "Paused for explicit recovery; no model call was repeated.")
            row = con.execute("SELECT * FROM runtime_tasks WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
            if row is None:
                return None
            con.execute("UPDATE runtime_tasks SET status='running',worker_id=?,lease_expires_at=?,updated_at=? WHERE id=?",
                        (worker_id, now + lease_seconds, now, row["id"]))
            return self._internal(con, con.execute("SELECT * FROM runtime_tasks WHERE id=?", (row["id"],)).fetchone())

    def heartbeat(self, task_id, worker_id, lease_seconds=120):
        lease_seconds = _integer(lease_seconds, "lease duration", 1, 600)
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            if self._leased(con, task_id, worker_id) is None:
                return False
            con.execute("UPDATE runtime_tasks SET lease_expires_at=? WHERE id=?", (time.time() + lease_seconds, task_id))
            return True

    def checkpoint(self, task_id, worker_id, messages, *, event=None, plan=None, usage=None):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._leased(con, task_id, worker_id)
            if row is None:
                return False
            serialized = _messages(messages)
            plan_json = row["plan"] if plan is None else _plan(plan)
            if usage is not None and not isinstance(usage, dict):
                raise RuntimeErrorDetail("invalid_input", "Enter valid token usage.")
            usage = usage or {}
            inputs = _integer(usage.get("inputTokens", 0), "input token usage", 0, 100000000)
            outputs = _integer(usage.get("outputTokens", 0), "output token usage", 0, 100000000)
            if event is not None:
                if not isinstance(event, dict):
                    raise RuntimeErrorDetail("invalid_input", "Enter a valid event.")
                self._event(con, task_id, event.get("kind"), event.get("title"), event.get("content", ""))
            con.execute("UPDATE runtime_tasks SET messages=?,plan=?,input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=? WHERE id=?",
                        (serialized, plan_json, inputs, outputs, time.time(), task_id))
            return True

    def reserve_step(self, task_id, worker_id):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._leased(con, task_id, worker_id)
            if row is None or row["requested_control"] or row["step_count"] >= row["max_steps"]:
                return False
            con.execute("UPDATE runtime_tasks SET step_count=step_count+1,updated_at=? WHERE id=?", (time.time(), task_id))
            return True

    def drain_instructions(self, task_id, worker_id):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._require_lease(con, task_id, worker_id)
            instructions = [item["content"] for item in con.execute("SELECT content FROM runtime_instructions WHERE task_id=? ORDER BY sequence", (task_id,))]
            if instructions:
                messages = json.loads(row["messages"])
                completed, index = set(), len(messages) - 1
                while index >= 0 and messages[index].get("role") == "tool":
                    completed.add(messages[index].get("tool_call_id"))
                    index -= 1
                if index >= 0 and messages[index].get("role") == "assistant":
                    pending = messages[index].get("tool_calls") or []
                    if any(call.get("id") not in completed for call in pending):
                        raise RuntimeErrorDetail("incomplete_tools", "Complete the tool response batch before applying instructions.", 409)
                # Appending and draining share a commit. A worker crash cannot
                # lose accepted instructions between delivery and checkpoint.
                messages.extend({"role": "user", "content": instruction} for instruction in instructions)
                con.execute("UPDATE runtime_tasks SET messages=?,updated_at=? WHERE id=?", (_messages(messages), time.time(), task_id))
                con.execute("DELETE FROM runtime_instructions WHERE task_id=?", (task_id,))
            return instructions

    def observe_control(self, task_id, worker_id):
        with self.store.connect() as con:
            return self._require_lease(con, task_id, worker_id)["requested_control"]

    def release(self, task_id, worker_id):
        self.finish(task_id, worker_id, "paused")

    def finish(self, task_id, worker_id, status, *, summary="", error=None):
        if status not in (*TERMINAL, "paused"):
            raise RuntimeErrorDetail("invalid_input", "Enter a valid final task state.")
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._leased(con, task_id, worker_id)
            if row is None:
                return False
            if row["requested_control"] == "cancel":
                status = "cancelled"
            elif row["requested_control"] == "pause":
                status = "paused"
            elif status == "completed" and con.execute("SELECT 1 FROM runtime_instructions WHERE task_id=? LIMIT 1", (task_id,)).fetchone():
                status = "paused"
                error = "A new instruction arrived during completion. Resume to apply it to the saved result."
            summary = _text(summary, "task summary", 16000, empty=True, strip=False)
            error = _text(error, "task error", 4000, empty=True) if error is not None else None
            con.execute("UPDATE runtime_tasks SET status=?,summary=?,error=?,requested_control=NULL,worker_id=NULL,lease_expires_at=NULL,updated_at=?,encrypted_key=CASE WHEN ?='paused' THEN encrypted_key ELSE NULL END WHERE id=?",
                        (status, summary, error, time.time(), status, task_id))
            self._event(con, task_id, "completed" if status == "completed" else "error" if status == "failed" else "control",
                        "Task " + status, error or summary)
            return True

    def request_approval(self, task_id, worker_id, tool, args, call_id, messages):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._require_lease(con, task_id, worker_id)
            if tool != "read_url" or not isinstance(args, dict) or set(args) != {"url"}:
                raise RuntimeErrorDetail("invalid_input", "This tool does not support approval.")
            _text(args["url"], "URL", 2048)
            call_id = _text(call_id, "tool call ID", 128)
            serialized = _messages(messages)
            # Bind the grant to the exact persisted call, not a URL wildcard.
            matching = []
            for message in messages:
                if message.get("role") == "assistant":
                    matching.extend(call for call in message.get("tool_calls", []) if isinstance(call, dict) and call.get("id") == call_id)
            try:
                exact = (len(matching) == 1 and matching[0]["function"]["name"] == tool
                         and json.loads(matching[0]["function"]["arguments"]) == args)
            except (KeyError, TypeError, ValueError):
                exact = False
            if not exact or any(message.get("role") == "tool" and message.get("tool_call_id") == call_id for message in messages):
                raise RuntimeErrorDetail("invalid_approval", "Approval must match the pending tool call exactly.", 409)
            if con.execute("SELECT 1 FROM runtime_approvals WHERE task_id=? AND (call_id=? OR status='pending')", (task_id, call_id)).fetchone():
                raise RuntimeErrorDetail("stale_approval", "This tool call already has an approval decision.", 409)
            if row["requested_control"] == "cancel":
                # Return no actionable grant after cancellation wins the race.
                con.execute("UPDATE runtime_tasks SET status='cancelled',encrypted_key=NULL,requested_control=NULL,worker_id=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?", (time.time(), task_id))
                self._event(con, task_id, "control", "Task cancelled")
                return None
            approval_id = uuid.uuid4().hex
            con.execute("INSERT INTO runtime_approvals(id,task_id,tool,args,call_id,reason,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
                        (approval_id, task_id, tool, _json(args, 8192), call_id, "Allow this task to read the exact external URL shown?", time.time()))
            status = "paused" if row["requested_control"] == "pause" else "awaiting_approval"
            con.execute("UPDATE runtime_tasks SET status=?,messages=?,requested_control=NULL,worker_id=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
                        (status, serialized, time.time(), task_id))
            self._event(con, task_id, "approval", "External URL approval required", args["url"])
            return _approval(self._latest_approval(con, task_id))

    def approval_result(self, task_id):
        with self.store.connect() as con:
            return _approval(self._latest_approval(con, task_id), internal=True)

    def add_artifact(self, task_id, worker_id, artifact, call_id):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            self._require_lease(con, task_id, worker_id)
            call_id = _text(call_id, "tool call ID", 128)
            existing = con.execute("SELECT * FROM runtime_artifacts WHERE task_id=? AND call_id=?", (task_id, call_id)).fetchone()
            if existing:
                return _artifact(existing)
            if not isinstance(artifact, dict):
                raise RuntimeErrorDetail("invalid_input", "Enter a valid artifact.")
            name = _text(artifact.get("name"), "artifact name", 160)
            if name in (".", "..") or any(char in name for char in "/\\\r\n\t"):
                raise RuntimeErrorDetail("invalid_input", "Artifact names must not contain file paths.")
            mime_type = _text(artifact.get("mimeType"), "artifact MIME type", 128)
            if not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(?:; charset=utf-8)?", mime_type, flags=re.IGNORECASE):
                raise RuntimeErrorDetail("invalid_input", "Enter a valid artifact MIME type.")
            encoded = artifact.get("contentBase64")
            if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_ARTIFACT_BYTES + 2) // 3):
                raise RuntimeErrorDetail("invalid_input", "Artifacts may contain at most 1 MiB.")
            try:
                content = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError):
                raise RuntimeErrorDetail("invalid_input", "Enter valid base64 artifact content.") from None
            if len(content) > MAX_ARTIFACT_BYTES:
                raise RuntimeErrorDetail("invalid_input", "Artifacts may contain at most 1 MiB.")
            totals = con.execute("SELECT COUNT(*),COALESCE(SUM(size),0) FROM runtime_artifacts WHERE task_id=?", (task_id,)).fetchone()
            if totals[0] >= 20 or totals[1] + len(content) > MAX_TOTAL_ARTIFACT_BYTES:
                raise RuntimeErrorDetail("artifact_limit", "The task artifact storage limit has been reached.", 409)
            artifact_id = uuid.uuid4().hex
            con.execute("INSERT INTO runtime_artifacts(id,task_id,call_id,name,mime_type,size,content,created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (artifact_id, task_id, call_id, name, mime_type, len(content), content, time.time()))
            con.execute("UPDATE runtime_tasks SET updated_at=? WHERE id=?", (time.time(), task_id))
            return _artifact(con.execute("SELECT * FROM runtime_artifacts WHERE id=?", (artifact_id,)).fetchone())
