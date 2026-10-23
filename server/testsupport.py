"""Shared helpers so every backend test runs on SQLite by default and on Postgres when
PC_PORTAL_TEST_DATABASE_URL is set (see scripts/test_backend_postgres.sh)."""
import asyncio
import copy
import hashlib
import hmac
import secrets
import time
import os
import tempfile
import threading
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from server.db import Database
from server.gateway import GatewayError
from server.settings import Settings


def fresh_database(tmpdir: str) -> str:
    url = os.environ.get("PC_PORTAL_TEST_DATABASE_URL", "").strip()
    if url:
        Database(url).reset_for_tests()
        return url
    return str(Path(tmpdir) / "portal.sqlite")


def rows(store, table: str) -> list[dict]:
    with store.connect() as con:
        return [dict(r) for r in con.execute('SELECT * FROM "' + table + '"').fetchall()]


def database_text(store) -> str:
    """Raw stored values of every table as one string, for 'this secret was never stored' assertions.
    Values are not repr()-ed, so a backslash or quote in a secret is compared as-is."""
    parts = []
    for table in store.db.table_names():
        for row in rows(store, table):
            for value in row.values():
                if isinstance(value, (bytes, bytearray, memoryview)):
                    value = bytes(value).decode("utf-8", "replace")
                parts.append(str(value))
    return "\n".join(parts)


class FakeGateway:
    """In-memory stand-in for GatewayAdapter shared by the backend tests.

    `fail` simulates an unreachable gateway; `reject` (a GatewayError or an HTTP status) simulates
    the gateway refusing the request. Both make every call raise, with a detail that must never
    reach an API response."""
    configured = True

    def __init__(self):
        self.issued, self.disabled, self.enabled, self.limits, self.balances = [], [], [], [], []
        self.report = {"keys": [], "total_cost_usd": "0.000000", "total_requests": 0, "unpriced_models": [], "amount_status": "confirmed"}
        self.listing = {"keys": [], "env_keys": []}
        self.state_value = {"models": [{"id": "glm-5.3", "enabled": False}, {"id": "zai-org/GLM-5.3", "enabled": False}],
                            "nodes": [], "gateway": {"public_base_url": "https://gateway.example"}}
        self.nodes_value = {"nodes": [], "actions": ["start", "stop", "restart", "check"]}
        self.metrics_value = {"ts": 0, "gpu_source_up": False, "vllm_source_up": False, "gpus": [], "serving": {}}
        self.ops, self.toggled, self.maintenance = [], [], []
        self.months = []
        self.fail = False
        self.reject = None
        self.create_delay = 0
        self.disable_delay = 0
        self.issue_lock = threading.Lock()
        self.personas = {"p1": {"persona_id": "p1", "name": "Support", "created_at": 1.0, "active_rev": 1,
                                "revisions": [{"rev": 1, "system": "Be kind.", "examples": [], "note": "first", "author": "admin", "created_at": 1.0}]}}
        self.persona_calls = []
        self.try_delay = 0
        self.fleet_managed = {"glm-5.2-fp8"}
        self.fleet_calls = []
        self.job_value = {"id": "wf-1", "kind": "candidate", "model_id": "glm-5.2-fp8", "state": "awaiting_approval",
                          "phase": "ready", "reason": "", "created_at": 1.0, "updated_at": 2.0}
        self.redeem_codes, self.issued_codes, self.disabled_codes = [], [], []
        self.activity_value = {"status": "ok", "stale": False, "generated_at": 1792607481.9, "age_s": 1.0, "errors": {}, "truncated": False,
                               "nodes": [], "gpu_usage": [], "logins": [], "alerts": [], "deploys": []}
        self.activity_calls = 0
        # cost_only (D-V8): calls made, a GatewayError raised by set_cost_only only, and whether create_key confirms the flag.
        self.cost_only_calls = []
        self.cost_only_error = None
        self.confirm_cost_only = True

    def _maybe_fail(self):
        if self.reject is not None:
            if isinstance(self.reject, BaseException):
                raise self.reject
            raise GatewayError("rejected", status=self.reject, detail="private upstream token must never escape")
        if self.fail:
            raise GatewayError("unavailable", detail="private upstream token must never escape")

    async def create_key(self, label, prepaid_usd, limits=None, cost_only=False):
        if self.create_delay:
            await asyncio.sleep(self.create_delay)
        self._maybe_fail()
        with self.issue_lock:
            number = len(self.issued) + 1
            result = {"key_id": "gateway-key-%d" % number, "prefix": "sk-test-%d" % number,
                      "secret": "sk-test-secret-unique-%d" % number, "balance_nano_usd": int(round(float(prepaid_usd) * 1e9)),
                      "cost_only": cost_only is True and self.confirm_cost_only}
            self.issued.append({"label": label, "prepaid_usd": prepaid_usd, "limits": limits or {}, **result, "cost_only": cost_only})
        return result

    async def set_key_disabled(self, key_id, disabled):
        if self.disable_delay:
            await asyncio.sleep(self.disable_delay)
        self._maybe_fail()
        (self.disabled if disabled else self.enabled).append(key_id)

    async def revoke_key(self, key_id):
        await self.set_key_disabled(key_id, True)

    async def update_limits(self, key_id, limits):
        self._maybe_fail()
        self.limits.append((key_id, dict(limits)))

    async def set_cost_only(self, key_id, cost_only):
        self._maybe_fail()
        if self.cost_only_error is not None:
            raise self.cost_only_error
        item = next((k for k in self.listing["keys"] if k.get("key_id") == key_id), None)
        if item is None:
            raise GatewayError("rejected", 404, "No such key.")
        item["cost_only"] = cost_only
        self.cost_only_calls.append((key_id, cost_only))

    async def adjust_balance(self, key_id, *, add_usd=None, set_usd=None):
        self._maybe_fail()
        self.balances.append((key_id, add_usd, set_usd))
        return int(round(float(set_usd if set_usd is not None else add_usd) * 1e9))

    async def list_keys(self):
        self._maybe_fail()
        return self.listing

    async def usage_report(self, month):
        self._maybe_fail()
        self.months.append(month)
        return self.report

    async def state(self):
        self._maybe_fail(); return self.state_value

    async def nodes(self):
        self._maybe_fail(); return self.nodes_value

    async def node_op(self, name, action):
        self._maybe_fail(); self.ops.append((name, action)); return {"job_id": "job-%d" % len(self.ops)}

    async def node_job(self, name, job_id):
        self._maybe_fail(); return {"job_id": job_id, "state": "done"}

    async def metrics(self):
        self._maybe_fail(); return self.metrics_value

    async def toggle_model(self, model_id):
        self._maybe_fail()
        model = next((m for m in self.state_value["models"] if m["id"] == model_id), None)
        if model is None:
            raise GatewayError("rejected", 404, "Model not found.")
        model["enabled"] = model.get("enabled") is False  # missing/None reads as enabled, as on the gateway
        self.toggled.append(model_id)
        return {"id": model_id, "enabled": model["enabled"]}

    async def set_maintenance(self, model_id, message):
        self._maybe_fail(); self.maintenance.append((model_id, message)); return {"id": model_id, "maintenance_message": message or None}

    # personas: same shapes as the gateway's PersonaStore routes
    async def list_personas(self):
        self._maybe_fail()
        return {"personas": [{"persona_id": p["persona_id"], "name": p["name"], "created_at": p["created_at"], "active_rev": p["active_rev"],
                              "latest_rev": max((r["rev"] for r in p["revisions"]), default=None)} for p in self.personas.values()]}

    async def get_persona(self, persona_id, rev=None):
        self._maybe_fail()
        self.persona_calls.append(("get", persona_id, rev))
        persona = self.personas.get(persona_id)
        if persona is None:
            raise GatewayError("rejected", 404, "No such persona.")
        head = {"persona_id": persona_id, "name": persona["name"], "created_at": persona["created_at"], "active_rev": persona["active_rev"]}
        revisions = persona["revisions"]
        chosen = next((r for r in revisions if r["rev"] == rev), None) if rev is not None else None
        if chosen is None and revisions:
            # The gateway falls back to the latest revision for an unknown or missing rev.
            chosen = max(revisions, key=lambda r: r["rev"])
        if chosen is not None:
            head.update(rev=chosen["rev"], system=chosen["system"], note=chosen["note"], author=chosen["author"],
                        rev_created_at=chosen["created_at"], examples=list(chosen["examples"]))
        return {"persona": head, "revisions": [{"rev": r["rev"], "note": r["note"], "author": r["author"], "created_at": r["created_at"],
                                                "system_len": len(r["system"]), "example_count": len(r["examples"])} for r in revisions]}

    async def create_persona(self, name):
        self._maybe_fail()
        persona_id = "p%d" % (len(self.personas) + 1)
        self.personas[persona_id] = {"persona_id": persona_id, "name": name, "created_at": 2.0, "active_rev": None, "revisions": []}
        return persona_id

    async def save_persona_revision(self, persona_id, *, system, examples, note, activate):
        self._maybe_fail()
        persona = self.personas.get(persona_id)
        if persona is None:
            raise GatewayError("rejected", 404, "No such persona.")
        rev = max((r["rev"] for r in persona["revisions"]), default=0) + 1
        persona["revisions"].append({"rev": rev, "system": system, "examples": list(examples), "note": note, "author": "admin", "created_at": 3.0})
        if activate:
            persona["active_rev"] = rev
        self.persona_calls.append(("revision", persona_id, rev, activate))
        return rev

    async def activate_persona(self, persona_id, rev):
        self._maybe_fail()
        persona = self.personas.get(persona_id)
        if persona is None or not any(r["rev"] == rev for r in persona["revisions"]):
            raise GatewayError("rejected", 404, "No such revision.")
        persona["active_rev"] = rev
        self.persona_calls.append(("activate", persona_id, rev))

    async def try_persona(self, persona_id, *, text, revs, max_tokens, temperature):
        self._maybe_fail()
        if self.try_delay:
            await asyncio.sleep(self.try_delay)
        self.persona_calls.append(("try", persona_id, tuple(revs), max_tokens, temperature))
        return {"input": text, "results": [{"rev": r, "reply": "ok", "usage": {"prompt_tokens": 5, "completion_tokens": 3}} for r in revs]}

    # fleet: unmanaged models are 404 exactly like the gateway
    def _managed(self, model_id):
        if model_id not in self.fleet_managed:
            raise GatewayError("rejected", 404, "Managed model not found.")

    async def fleet_status(self, model_id):
        self._maybe_fail()
        self._managed(model_id)
        return {"model_id": model_id, "enabled": True, "draining": False, "frozen": False, "capacity": None, "workflow": None}

    async def fleet_timeline(self, model_id):
        self._maybe_fail()
        self._managed(model_id)
        return {"model_id": model_id, "events": []}

    async def fleet_events(self, model_id=None, limit=100):
        self._maybe_fail()
        if model_id is not None:
            self._managed(model_id)
        self.fleet_calls.append(("events", model_id, limit))
        return {"events": []}

    async def fleet_action(self, model_id, action):
        self._maybe_fail()
        self._managed(model_id)
        self.fleet_calls.append((model_id, action))
        if action in ("freeze", "resume"):
            return {"model_id": model_id, "mode": "frozen" if action == "freeze" else "observe", "sellable_cap": 8, "physical_cap": 8,
                    "reason": "operator", "policy_version": "v1", "observed_at": 1.0, "event_id": 1}
        return {"job_id": "wf-%d" % len(self.fleet_calls), "state": "queued", "phase": "queued"}

    async def control_job(self, job_id):
        self._maybe_fail()
        if job_id == "missing":
            raise GatewayError("rejected", 404, "Switch job not found.")
        return dict(self.job_value, id=job_id)

    # redeem codes: the gateway keeps only rows without plaintext; plaintext lives in issued_codes for assertions
    async def issue_redeem_codes(self, *, amount_usd, count, label, expires_days=None):
        self._maybe_fail()
        nano = int(round(float(amount_usd) * 1_000_000_000))
        result = []
        for _ in range(count):
            n = len(self.issued_codes) + 1
            code, code_id = "PlainRedeemCode-%04d-abcdefghijkl" % n, "code-%d" % n
            self.issued_codes.append(code)
            self.redeem_codes.append({"code_id": code_id, "nano_usd": nano, "label": label, "created_at": float(n), "created_by": "admin",
                                      "redeemed_at": None, "redeemed_by_key_id": None, "disabled_at": None,
                                      "expires_at": None if expires_days is None else float(n) + expires_days * 86400})
            result.append({"code": code, "code_id": code_id, "nano_usd": nano})
        return result

    async def list_redeem_codes(self):
        self._maybe_fail()
        return [dict(row) for row in sorted(self.redeem_codes, key=lambda row: row["created_at"], reverse=True)]

    async def disable_redeem_code(self, code_id):
        self._maybe_fail()
        row = next((r for r in self.redeem_codes if r["code_id"] == code_id), None)
        if row is None or row["disabled_at"] is not None:
            raise GatewayError("rejected", 404, "Code not found or already disabled.")
        row["disabled_at"] = 9.0
        self.disabled_codes.append(code_id)

    async def redeem_code_rows(self):
        self._maybe_fail()
        return [[r["code_id"], "hash-" + r["code_id"], str(r["nano_usd"]), r["label"], str(r["created_at"]), r["created_by"], "", "", "", ""]
                for r in self.redeem_codes]

    # engineers: the gateway's GET /api/engineers/activity payload
    async def engineer_activity(self):
        self._maybe_fail()
        self.activity_calls += 1
        return copy.deepcopy(self.activity_value)


STUDIO_TOKEN = "studio-service-token-test-0001"
STUDIO_GRANT_SECRET = "studio-grant-secret-test-0001"
STUDIO_QUOTE_SECRET = "studio-quote-secret-test-0001"


def studio_settings():
    """Settings keyword arguments that make the video studio configured (no real agent is contacted)."""
    return {"studio_agent_url": "http://shortvideo-api:8081", "studio_service_token": STUDIO_TOKEN,
            "studio_grant_secret": STUDIO_GRANT_SECRET, "studio_quote_secret": STUDIO_QUOTE_SECRET}


def _studio_sig(secret, tag, values):
    # Written independently of server/studio.py (and identical to shortvideo/studio/signing.py), so a
    # portal-side change to the signed message breaks these tests instead of passing them by symmetry.
    text = [tag] + ["" if v is None else str(v) for v in values]
    if any("|" in t for t in text):
        raise ValueError("'|' in a signed field")
    return hmac.new(secret.encode(), "|".join(text).encode(), hashlib.sha256).hexdigest()


class FakeStudioAgent:
    """In-memory stand-in for server.studio_agent.StudioAgent with the shapes of spec section 13.2.

    Like the real agent it signs quotes with the quote secret, checks grants (signature, expiry, owner)
    and quotes (signature, single use, current storyboard_rev) on op submission, and replays a known
    op_id. Knobs: `fail` (an AgentError raised by every call), `submit_error` (raised by submit_op;
    with `submit_accepts` True the op is recorded first, i.e. the response was lost), `finish()` to end
    an op. `in_loop` lists calls made on the event-loop thread: it must stay empty."""
    configured = True

    def __init__(self, clock=time.time):
        from server.studio_agent import AgentError
        self.AgentError = AgentError
        self.clock = clock
        self.projects, self.ops, self.quotes_used, self.uploads = {}, {}, set(), {}
        self.calls, self.in_loop = [], []
        self.fail = None
        self.submit_error = None
        self.submit_accepts = True
        # Drafts are free (owner decision Q3); the portal caps them per day instead.
        self.prices = {"draft": 0, "render": 10, "regenerate": 10, "export": 0, "add_aspect": 4}
        self.purge_errors = {}
        self.created = []
        self.usage_value = None
        # sha256 per upload id, as the media host records it after the browser's PUT. upload_lookup False
        # = the agent has no GET /internal/v1/uploads/{id} yet (a plain 404, no error code).
        self.upload_hashes = {}
        self.upload_lookup = True

    def _enter(self, name, owner=None):
        try:
            asyncio.get_running_loop()
            self.in_loop.append(name)
        except RuntimeError:
            pass
        self.calls.append((name, owner))
        if self.fail is not None:
            raise self.fail

    def _missing(self):
        return self.AgentError("rejected", 404, "studio_not_found")

    def _project(self, owner, pid):
        project = self.projects.get(pid)
        if project is None or project["owner"] != owner:
            raise self._missing()
        return project

    def _active(self, pid):
        return next((o for o in self.ops.values() if o["project_id"] == pid and o["state"] in ("queued", "running")), None)

    def doc(self, pid):
        p = self.projects[pid]
        active = self._active(pid)
        exp = int(self.clock() // 3600) * 3600 + 7200
        shots = [{"index": i, "kind": "image", "seconds": 5, "narration": "n", "stale": not p["rendered"], "status": "ready",
                  "thumb_url": "https://media.test/media/" + pid + "-" + str(i) + "?exp=" + str(exp) + "&sig=" + "0" * 64}
                 for i in range(1, p["shots"] + 1)]
        return {"id": pid, "template_id": p["template_id"], "title": p["title"], "expired": bool(p.get("expired")), "status": "drafting" if active and active["type"] == "draft" else "rendering" if active else p["status"],
                "aspect": p["aspect"], "aspects": [p["aspect"]], "storyboard_rev": p["rev"], "queue": None,
                "active_op": {"op_id": active["op_id"], "type": active["type"], "state": active["state"]} if active else None,
                "shots": shots, "characters": [], "settings": dict(p["settings"]), "exports": {p["aspect"]: None},
                "created_at": p["created_at"], "updated_at": p["updated_at"]}

    def templates(self, owner):
        self._enter("templates", owner)
        return {"items": [{"id": "ecommerce", "version": 1, "title": {"zh": "電商商品影片", "en": "Product video"},
                           "input_schema": {"type": "object"}, "shot_schema": {"type": "object"},
                           # Like the agent (D-V4 b): "none" first and the default, never internal; labels in x-enum-labels.
                           "project_schema": {"type": "object", "properties": {"voice": {
                               "type": "string", "enum": ["none", "tw_ref", "studio_female", "v1"], "default": "none",
                               "x-enum-labels": {"none": {"zh": "無配音（只有字幕）", "en": "No voiceover (subtitles only)"}}}}},
                           "aspects": ["9:16", "16:9"], "ops": [], "prices": {"draft": 2, "image": 1, "speech": 1, "clip": 8},
                           "rules": {"shots": [6, 10]}}]}

    def create_upload(self, owner, body):
        self._enter("create_upload", owner)
        if body.get("project_id") is not None:
            self._project(owner, body["project_id"])
        if body.get("purpose") == "lifestyle_image" and body.get("rights_confirmed") is not True:
            raise self.AgentError("rejected", 400, "studio_rights_required")  # like the agent (v10)
        upload_id = "u_" + secrets.token_hex(6)
        self.uploads[upload_id] = dict(body, owner=owner)
        return {"upload_id": upload_id, "put_url": "https://media.test/media/upload/" + secrets.token_hex(8), "expires_at": int(self.clock()) + 900}

    def _owned_upload(self, owner, upload_id):
        """Like the agent's owner-scoped upload check: someone else's (or an unknown) upload is a 404."""
        upload = self.uploads.get(upload_id) if isinstance(upload_id, str) else None
        if upload is None or upload["owner"] != owner:
            raise self._missing()
        return upload

    def get_upload(self, owner, upload_id):
        self._enter("get_upload", owner)
        if not self.upload_lookup:
            raise self.AgentError("rejected", 404, None)
        upload = self._owned_upload(owner, upload_id)
        return {"upload_id": upload_id, "purpose": upload["purpose"], "project_id": upload.get("project_id"), "content_type": upload["content_type"],
                "bytes": upload["bytes"], "sha256": self.upload_hashes.get(upload_id), "status": "ready" if upload_id in self.upload_hashes else "pending"}

    def create_project(self, owner, body):
        self._enter("create_project", owner)
        self.created.append(dict(body))
        inputs = body.get("inputs") or {}
        for upload_id in (inputs.get("image_ids") or []) + (inputs.get("lifestyle_ids") or []):
            self._owned_upload(owner, upload_id)
        pid = body["project_id"]
        if pid in self.projects:
            if self.projects[pid]["owner"] != owner:
                raise self.AgentError("rejected", 409, "studio_conflict")
            return self.doc(pid)
        if body.get("inputs", {}).get("topic") == "BLOCKED":
            raise self.AgentError("rejected", 400, "studio_invalid_input")
        now = self.clock()
        self.projects[pid] = {"owner": owner, "template_id": body["template_id"], "aspect": body["aspect"], "inputs": body["inputs"],
                              "title": body["inputs"].get("topic"), "status": "empty", "rev": 0, "shots": 0, "rendered": False,
                              "settings": {"voice": "none", "subtitles": True}, "created_at": now, "updated_at": now}
        return self.doc(pid)

    def get_project(self, owner, pid):
        self._enter("get_project", owner)
        self._project(owner, pid)
        return self.doc(pid)

    def _edit(self, owner, pid):
        p = self._project(owner, pid)
        if self._active(pid):
            raise self.AgentError("rejected", 409, "studio_busy")
        p["rev"] += 1
        p["rendered"] = False
        p["updated_at"] = self.clock()
        return p

    def edit_settings(self, owner, pid, body):
        self._enter("edit_settings", owner)
        body = dict(body)
        if "title" in body:
            # Like the agent: the title is a project field, not a setting, and renaming does not stale the storyboard.
            p = self._project(owner, pid)
            if self._active(pid):
                raise self.AgentError("rejected", 409, "studio_busy")
            if body["title"] == "BLOCKED":
                raise self.AgentError("rejected", 400, "studio_invalid_input")
            p["title"] = body.pop("title")
        if body:
            self._edit(owner, pid)["settings"].update(body)
        return self.doc(pid)

    def purge_project(self, owner, pid):
        """POST /internal/v1/projects/{id}/purge: owner-checked, 200 or 404, idempotent."""
        self._enter("purge_project", owner)
        if pid in self.purge_errors:
            raise self.purge_errors[pid]
        self._project(owner, pid)
        if any(o["owner"] == owner and o["state"] in ("queued", "running") for o in self.ops.values()):
            # Like the agent (2e7c38e): no purge while the owner has ANY active op, on any project.
            raise self.AgentError("rejected", 409, "studio_busy")
        del self.projects[pid]
        return {"id": pid, "purged": True}

    def edit_shot(self, owner, pid, index, body):
        self._enter("edit_shot", owner)
        p = self._project(owner, pid)
        if body.get("image_upload_id") is not None:
            self._owned_upload(owner, body["image_upload_id"])
        if not 1 <= index <= p["shots"]:
            raise self._missing()
        self._edit(owner, pid)
        return self.doc(pid)

    def quote(self, owner, pid, body):
        self._enter("quote", owner)
        p = self._project(owner, pid)
        op_type, target = body.get("type"), body.get("target")
        if op_type not in self.prices:
            raise self.AgentError("rejected", 400, "studio_invalid_input")
        if op_type == "export":
            target = target or p["aspect"]
        quote_id = "q_" + secrets.token_hex(12)
        exp = int(self.clock()) + 600
        credits = self.prices[op_type]
        sig = _studio_sig(STUDIO_QUOTE_SECRET, "quote.v1", (quote_id, owner, pid, op_type, target, credits, p["rev"], exp))
        return {"quote_id": quote_id, "type": op_type, "target": target, "credits": credits,
                "breakdown": [{"part": op_type, "count": 1, "credits": credits}], "storyboard_rev": p["rev"], "exp": exp, "sig": sig}

    def op_doc(self, op):
        produced = op.get("produced_credits")
        return {"op_id": op["op_id"], "project_id": op["project_id"], "type": op["type"], "target": op["target"], "state": op["state"],
                "queue_position": 1 if op["state"] == "queued" else None, "credits": op["credits"],
                "produced": None if produced is None else [{"key": "k", "kind": "image", "label": "x", "credits": produced, "shot": 1, "aspect": "9:16"}],
                "produced_credits": produced, "list_cost_usd": op.get("list_cost_usd"), "gpu_seconds": op.get("gpu_seconds"),
                "error": op.get("error"), "created_at": op["created_at"], "started_at": None, "finished_at": None}

    def submit_op(self, owner, pid, body):
        self._enter("submit_op", owner)
        if self.submit_error is not None and not self.submit_accepts:
            raise self.submit_error
        op_id = body.get("op_id")
        existing = self.ops.get(op_id)
        if existing is not None:
            if existing["owner"] != owner or existing["project_id"] != pid:
                raise self._missing()
            return self.op_doc(existing)
        p = self._project(owner, pid)
        quote, grant = body.get("quote") or {}, body.get("grant")
        if grant is None:
            raise self.AgentError("rejected", 403, "studio_forbidden")
        now = self.clock()
        expected = _studio_sig(STUDIO_GRANT_SECRET, "grant.v1", (op_id, owner, pid, body.get("type"), body.get("target"), quote.get("quote_id"),
                                                                 quote.get("credits"), quote.get("storyboard_rev"), grant.get("plan"), grant.get("exp")))
        if not hmac.compare_digest(expected, str(grant.get("sig"))) or grant["exp"] < now or grant["exp"] > now + 65:
            raise self.AgentError("rejected", 403, "studio_forbidden")
        q_expected = _studio_sig(STUDIO_QUOTE_SECRET, "quote.v1", (quote.get("quote_id"), owner, pid, body.get("type"), body.get("target"),
                                                                   quote.get("credits"), quote.get("storyboard_rev"), quote.get("exp")))
        if not hmac.compare_digest(q_expected, str(quote.get("sig"))):
            raise self.AgentError("rejected", 400, "studio_invalid_input")
        if quote["quote_id"] in self.quotes_used or quote["storyboard_rev"] != p["rev"]:
            raise self.AgentError("rejected", 409, "studio_stale_quote")
        if self._active(pid):
            raise self.AgentError("rejected", 409, "studio_busy")
        self.quotes_used.add(quote["quote_id"])
        op = {"op_id": op_id, "owner": owner, "project_id": pid, "type": body["type"], "target": body.get("target"), "credits": quote["credits"],
              "state": "queued", "created_at": now, "plan": grant["plan"]}
        self.ops[op_id] = op
        if self.submit_error is not None:
            raise self.submit_error
        return self.op_doc(op)

    def get_op(self, owner, pid, op_id):
        self._enter("get_op", owner)
        op = self.ops.get(op_id)
        if op is None or op["owner"] != owner or op["project_id"] != pid:
            raise self._missing()
        return self.op_doc(op)

    def usage(self, month, owner=None):
        self._enter("usage")
        if self.usage_value is not None:
            return copy.deepcopy(self.usage_value)
        owners = {}
        for op in self.ops.values():
            row = owners.setdefault(op["owner"], {"owner": op["owner"], "ops": 0, "credits_quoted": 0, "credits_produced": 0,
                                                  "list_cost_usd": 0.0, "gpu_seconds": 0.0, "est_gpu_usd": 0.0})
            row["ops"] += 1
            row["credits_quoted"] += op["credits"]
            row["credits_produced"] += op.get("produced_credits") or 0
        return {"month": month, "gpu_usd_per_hour": 2.08, "owners": list(owners.values())}

    # -- test helpers -------------------------------------------------------------------------------

    def finish(self, op_id, state="succeeded", produced_credits=None, error=None):
        op = self.ops[op_id]
        op["state"] = state
        op["produced_credits"] = op["credits"] if state == "succeeded" and produced_credits is None else (produced_credits or 0)
        op["error"] = error
        p = self.projects[op["project_id"]]
        if state == "succeeded" and op["type"] == "draft":
            p["shots"], p["status"], p["rev"] = 3, "draft_ready", p["rev"] + 1
        elif state == "succeeded":
            p["rendered"], p["status"] = True, "ready"


ORIGIN = "http://localhost:3010"
BASE = "/api/portal"
PASSWORD = "customer-test-password-123!"


class PortalCase(unittest.TestCase):
    """Shared fixture; holds no tests so subclasses do not re-run each other's cases."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,))
        self.gateway = FakeGateway()
        # Imported here: server.app builds a module-level app on import, which plain helpers do not need.
        from server.app import create_app

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

    def post_raw(self, client, path, text):
        """POST a JSON document given as text, e.g. one with a lone-surrogate escape that json= cannot encode."""
        return client.post(BASE + path, content=text.encode("ascii"), headers={"Origin": ORIGIN, "Content-Type": "application/json"})

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
