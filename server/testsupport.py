"""Shared helpers so every backend test runs on SQLite by default and on Postgres when
PC_PORTAL_TEST_DATABASE_URL is set (see scripts/test_backend_postgres.sh)."""
import asyncio
import os
import threading
from pathlib import Path

from server.db import Database
from server.gateway import GatewayError


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
        self.state_value = {"models": [], "nodes": [], "gateway": {"public_base_url": "https://gateway.example"}}
        self.nodes_value = {"nodes": [], "actions": ["start", "stop", "restart", "check"]}
        self.metrics_value = {"ts": 0, "gpu_source_up": False, "vllm_source_up": False, "gpus": [], "serving": {}}
        self.ops, self.toggled, self.maintenance = [], [], []
        self.months = []
        self.fail = False
        self.reject = None
        self.create_delay = 0
        self.issue_lock = threading.Lock()

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
        self._maybe_fail(); self.toggled.append(model_id); return {"id": model_id, "enabled": True}

    async def set_maintenance(self, model_id, message):
        self._maybe_fail(); self.maintenance.append((model_id, message)); return {"id": model_id, "maintenance_message": message or None}
