"""Shared helpers so every backend test runs on SQLite by default and on Postgres when
PC_PORTAL_TEST_DATABASE_URL is set (see scripts/test_backend_postgres.sh)."""
import asyncio
import copy
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

    def _maybe_fail(self):
        if self.reject is not None:
            if isinstance(self.reject, BaseException):
                raise self.reject
            raise GatewayError("rejected", status=self.reject, detail="private upstream token must never escape")
        if self.fail:
            raise GatewayError("unavailable", detail="private upstream token must never escape")

    async def create_key(self, label, prepaid_usd, limits=None):
        if self.create_delay:
            await asyncio.sleep(self.create_delay)
        self._maybe_fail()
        with self.issue_lock:
            number = len(self.issued) + 1
            result = {"key_id": "gateway-key-%d" % number, "prefix": "sk-test-%d" % number,
                      "secret": "sk-test-secret-unique-%d" % number, "balance_nano_usd": int(round(float(prepaid_usd) * 1e9))}
            self.issued.append({"label": label, "prepaid_usd": prepaid_usd, "limits": limits or {}, **result})
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
