"""Adapter to the verified Python gateway routes; admin scope is server-only.

Error model: 2xx -> dict (or a list / CSV text where a method expects one); gateway 4xx -> GatewayError("rejected", status, detail);
anything else (5xx, network, bad JSON) -> GatewayError("unavailable"). The admin
token never appears in exceptions or return values.
"""
import csv
import io
import json
import re
from decimal import Decimal

import httpx

KEY_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
NODE_NAME = re.compile(r"[A-Za-z0-9._-]{1,64}")
JOB_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")
MODEL_ID = re.compile(r"[A-Za-z0-9._:/-]{1,128}")
NODE_ACTIONS = frozenset({"start", "stop", "restart", "check", "backup", "fw-status"})
LIMIT_FIELDS = ("daily_token_limit", "rpm", "max_inflight")
MAX_SAFE = 2 ** 53 - 1
SECRET_KEY_HINTS = ("key", "token", "secret", "password")
PERSONA_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
FLEET_MODEL_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
CODE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
REDEEM_CODE = re.compile(r"[A-Za-z0-9_-]{16,128}")
FLEET_ACTIONS = frozenset({"freeze", "resume", "candidate", "drain", "approve", "rollback"})
CONTROL_JOB_FIELDS = ("id", "kind", "model_id", "state", "phase", "reason", "created_at", "updated_at")
REDEEM_CSV_HEADER = ["code_id", "code_hash", "nano_usd", "label", "created_at", "created_by",
                     "redeemed_at", "redeemed_by_key_id", "disabled_at", "expires_at"]
PERSONA_TRY_TIMEOUT = 90
DEFAULT_MAX_BYTES = 4 * 1024 * 1024
# The gateway lists every redeem code in one response (no pagination yet): about 230 bytes per code in
# JSON, so 32 MiB covers roughly 140k codes. Gateway-side pagination is the follow-up.
REDEEM_MAX_BYTES = 32 * 1024 * 1024
ACTIVITY_STATUSES = frozenset({"ok", "partial", "unconfigured", "auth_failed", "unavailable"})
ACTIVITY_LISTS = ("nodes", "gpu_usage", "logins", "alerts", "deploys")


class GatewayError(Exception):
    def __init__(self, code, status=None, detail="", timed_out=False):
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = (detail or "")[:300]
        # Still code "unavailable" (callers that only care about "did it work" are unchanged);
        # set when no answer arrived in time, so a caller that spent model tokens can say so.
        self.timed_out = timed_out


def _strip_secrets(value):
    if isinstance(value, dict):
        return {k: _strip_secrets(v) for k, v in value.items()
                if not (isinstance(v, str) and any(h in k.lower() for h in SECRET_KEY_HINTS))}
    if isinstance(value, list):
        return [_strip_secrets(v) for v in value]
    return value


def _identifier(value, pattern):
    """Regex-match, then reject empty/dot segments that HTTP clients would normalize away."""
    if not isinstance(value, str) or not pattern.fullmatch(value) or any(part in ("", ".", "..") for part in value.split("/")):
        raise GatewayError("invalid_identifier")
    return value


def _positive_int(value, maximum, name):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(name + " out of range")
    return value


def _limit_payload(limits):
    payload = {}
    for name, value in (limits or {}).items():
        if name not in LIMIT_FIELDS or not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_SAFE:
            raise ValueError("invalid limit " + str(name))
        payload[name] = value
    return payload


class GatewayAdapter:
    def __init__(self, settings):
        self.settings = settings
        self.configured = bool(settings.gateway_admin_token)

    async def _request(self, method, path, payload=None, *, timeout=15, expect="object", max_bytes=DEFAULT_MAX_BYTES):
        if not self.configured:
            raise GatewayError("unconfigured")
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
                async with client.stream(method, self.settings.gateway_origin.rstrip("/") + path, json=payload,
                                         headers={"X-Admin-Token": self.settings.gateway_admin_token, "Accept": "application/json"}) as response:
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(data) + len(chunk) > max_bytes:
                            raise GatewayError("response_limit")
                        data.extend(chunk)
                    if 400 <= response.status_code < 500:
                        detail = ""
                        try:
                            body = json.loads(data)
                            if isinstance(body, dict):
                                detail = str(body.get("detail") or body.get("error") or "")
                        except ValueError:
                            pass
                        raise GatewayError("rejected", response.status_code, detail)
                    if not response.is_success:
                        raise GatewayError("unavailable")
                    if expect == "csv":
                        if not response.headers.get("content-type", "").lower().startswith("text/csv"):
                            raise GatewayError("invalid_response")
                        return bytes(data).decode("utf-8")
                    value = json.loads(data)
                    if not isinstance(value, list if expect == "array" else dict):
                        raise GatewayError("invalid_response")
                    return value
        except GatewayError:
            raise
        except httpx.TimeoutException:
            raise GatewayError("unavailable", timed_out=True) from None
        except (httpx.HTTPError, ValueError, TypeError):
            raise GatewayError("unavailable") from None

    @staticmethod
    def _key_id(key_id):
        if not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id):
            raise GatewayError("invalid_identifier")
        return key_id

    async def create_key(self, label, prepaid_usd, limits=None):
        amount = Decimal(str(prepaid_usd))
        if amount < 0:
            raise ValueError("prepaid_usd must be >= 0")
        payload = {"label": label, "prepaid_usd": float(amount),
                   "daily_token_limit": self.settings.gateway_daily_token_limit,
                   "rpm": self.settings.gateway_rpm, "max_inflight": self.settings.gateway_max_inflight}
        payload.update(_limit_payload(limits))
        value = await self._request("POST", "/api/keys", payload)
        secret, key_id = value.get("key"), value.get("key_id")
        if not isinstance(secret, str) or not re.fullmatch(r"[\x21-\x7e]{8,512}", secret) or not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id):
            raise GatewayError("invalid_response")
        balance = value.get("balance_nano_usd")
        return {"key_id": key_id, "prefix": secret[:16], "secret": secret,
                "balance_nano_usd": balance if isinstance(balance, int) and not isinstance(balance, bool) else None}

    async def set_key_disabled(self, key_id, disabled):
        value = await self._request("POST", "/api/keys/" + self._key_id(key_id) + "/disable", {"disabled": bool(disabled)})
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def revoke_key(self, key_id):
        await self.set_key_disabled(key_id, True)

    async def update_limits(self, key_id, limits):
        payload = _limit_payload(limits)
        if not payload:
            raise ValueError("no limits given")
        value = await self._request("POST", "/api/keys/" + self._key_id(key_id) + "/limits", payload)
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def adjust_balance(self, key_id, *, add_usd=None, set_usd=None):
        if (add_usd is None) == (set_usd is None):
            raise ValueError("give exactly one of add_usd or set_usd")
        amount = Decimal(str(add_usd if add_usd is not None else set_usd))
        if amount < 0:
            raise ValueError("amount must be >= 0")
        payload = {"add_usd": float(amount)} if add_usd is not None else {"set_usd": float(amount)}
        value = await self._request("POST", "/api/keys/" + self._key_id(key_id) + "/balance", payload)
        balance = value.get("balance_nano_usd")
        if value.get("ok") is not True or not isinstance(balance, int) or isinstance(balance, bool):
            raise GatewayError("invalid_response")
        return balance

    async def list_keys(self):
        value = await self._request("GET", "/api/keys")
        keys, env_keys = value.get("keys"), value.get("env_keys", [])
        if not isinstance(keys, list) or not isinstance(env_keys, list):
            raise GatewayError("invalid_response")
        return {"keys": [k for k in keys if isinstance(k, dict)], "env_keys": [k for k in env_keys if isinstance(k, dict)]}

    async def usage_report(self, month):
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise GatewayError("invalid_month")
        return await self._request("GET", "/api/usage/report?month=" + month)

    async def state(self):
        return _strip_secrets(await self._request("GET", "/api/state"))

    async def nodes(self):
        return await self._request("GET", "/api/nodes")

    async def node_op(self, name, action):
        name = _identifier(name, NODE_NAME)
        if action not in NODE_ACTIONS:
            raise GatewayError("invalid_identifier")
        return await self._request("POST", "/api/nodes/" + name + "/ops/" + action)

    async def node_job(self, name, job_id):
        name, job_id = _identifier(name, NODE_NAME), _identifier(job_id, JOB_ID)
        return await self._request("GET", "/api/nodes/" + name + "/jobs/" + job_id)

    async def metrics(self):
        return await self._request("GET", "/api/metrics")

    async def toggle_model(self, model_id):
        model_id = _identifier(model_id, MODEL_ID)
        return await self._request("POST", "/api/models/" + model_id + "/toggle")

    async def set_maintenance(self, model_id, message):
        model_id = _identifier(model_id, MODEL_ID)
        if not isinstance(message, str) or len(message) > 300:
            raise ValueError("message too long")
        return await self._request("POST", "/api/models/" + model_id + "/maintenance", {"message": message})

    # personas
    async def list_personas(self):
        value = await self._request("GET", "/api/personas")
        if not isinstance(value.get("personas"), list):
            raise GatewayError("invalid_response")
        return {"personas": [p for p in value["personas"] if isinstance(p, dict)]}

    async def get_persona(self, persona_id, rev=None):
        path = "/api/personas/" + _identifier(persona_id, PERSONA_ID)
        if rev is not None:
            path += "?rev=" + str(_positive_int(rev, 10 ** 9, "rev"))
        value = await self._request("GET", path)
        if not isinstance(value.get("persona"), dict) or not isinstance(value.get("revisions"), list):
            raise GatewayError("invalid_response")
        return value

    async def create_persona(self, name):
        value = await self._request("POST", "/api/personas", {"name": name})
        persona_id = value.get("persona_id")
        if not isinstance(persona_id, str) or not PERSONA_ID.fullmatch(persona_id):
            raise GatewayError("invalid_response")
        return persona_id

    async def save_persona_revision(self, persona_id, *, system, examples, note, activate):
        value = await self._request("POST", "/api/personas/" + _identifier(persona_id, PERSONA_ID) + "/revisions",
                                    {"system": system, "examples": examples, "note": note, "activate": bool(activate)})
        rev = value.get("rev")
        if isinstance(rev, bool) or not isinstance(rev, int) or rev < 1:
            raise GatewayError("invalid_response")
        return rev

    async def activate_persona(self, persona_id, rev):
        value = await self._request("POST", "/api/personas/" + _identifier(persona_id, PERSONA_ID) + "/activate",
                                    {"rev": _positive_int(rev, 10 ** 9, "rev")})
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def try_persona(self, persona_id, *, text, revs, max_tokens, temperature):
        value = await self._request("POST", "/api/personas/" + _identifier(persona_id, PERSONA_ID) + "/try",
                                    {"input": text, "revs": revs, "max_tokens": max_tokens, "temperature": temperature},
                                    timeout=PERSONA_TRY_TIMEOUT)
        if not isinstance(value.get("results"), list):
            raise GatewayError("invalid_response")
        return value

    # fleet
    async def fleet_status(self, model_id):
        value = await self._request("GET", "/api/fleet/" + _identifier(model_id, FLEET_MODEL_ID) + "/status")
        workflow = value.get("workflow")
        if isinstance(workflow, dict):
            # routing/capacity snapshots are internal; the panel needs ids and state only
            value["workflow"] = {k: v for k, v in workflow.items() if k not in ("route_before", "capacity_before")}
        return value

    async def fleet_timeline(self, model_id):
        value = await self._request("GET", "/api/fleet/" + _identifier(model_id, FLEET_MODEL_ID) + "/timeline")
        if not isinstance(value.get("events"), list):
            raise GatewayError("invalid_response")
        return value

    async def fleet_events(self, model_id=None, limit=100):
        query = "?limit=" + str(_positive_int(limit, 500, "limit"))
        if model_id is not None:
            query += "&model_id=" + _identifier(model_id, FLEET_MODEL_ID)
        value = await self._request("GET", "/api/fleet/events" + query)
        if not isinstance(value.get("events"), list):
            raise GatewayError("invalid_response")
        return value

    async def fleet_action(self, model_id, action):
        model_id = _identifier(model_id, FLEET_MODEL_ID)
        if action not in FLEET_ACTIONS:
            raise GatewayError("invalid_identifier")
        return await self._request("POST", "/api/fleet/" + model_id + "/" + action)

    async def control_job(self, job_id):
        value = await self._request("GET", "/api/control/jobs/" + _identifier(job_id, JOB_ID))
        return {name: value.get(name) for name in CONTROL_JOB_FIELDS}

    # redeem codes — plaintext codes only ever travel in the return value
    async def issue_redeem_codes(self, *, amount_usd, count, label, expires_days=None):
        amount = Decimal(str(amount_usd))
        if not amount.is_finite() or amount <= 0:
            raise ValueError("amount_usd must be positive")
        payload = {"amount_usd": float(amount), "count": _positive_int(count, 10000, "count"), "label": label}
        if expires_days is not None:
            payload["expires_days"] = _positive_int(expires_days, 3650, "expires_days")
        value = await self._request("POST", "/api/redeem/codes", payload, expect="array")
        nano = int(round(float(amount) * 1_000_000_000))
        codes = []
        for item in value:
            if (not isinstance(item, dict) or not isinstance(item.get("code"), str) or not REDEEM_CODE.fullmatch(item["code"])
                    or not isinstance(item.get("code_id"), str) or not CODE_ID.fullmatch(item["code_id"])
                    or isinstance(item.get("nano_usd"), bool) or item.get("nano_usd") != nano):
                raise GatewayError("invalid_response")
            codes.append({"code": item["code"], "code_id": item["code_id"], "nano_usd": nano})
        if len(codes) != count:
            raise GatewayError("invalid_response")
        return codes

    async def list_redeem_codes(self):
        return [item for item in await self._request("GET", "/api/redeem/codes", expect="array", max_bytes=REDEEM_MAX_BYTES) if isinstance(item, dict)]

    async def disable_redeem_code(self, code_id):
        value = await self._request("POST", "/api/redeem/codes/" + _identifier(code_id, CODE_ID) + "/disable")
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def redeem_code_rows(self):
        text = await self._request("GET", "/api/redeem/codes.csv", expect="csv", max_bytes=REDEEM_MAX_BYTES)
        try:
            rows = list(csv.reader(io.StringIO(text)))
        except csv.Error:
            raise GatewayError("invalid_response") from None
        if not rows or rows[0] != REDEEM_CSV_HEADER or any(len(row) != len(REDEEM_CSV_HEADER) for row in rows[1:]):
            raise GatewayError("invalid_response")
        return rows[1:]

    # engineers: read-only cluster activity (GPU usage, logins, alerts, deploy marks). Not passed through
    # _strip_secrets: the portal builds its response from an explicit field allowlist instead.
    async def engineer_activity(self):
        value = await self._request("GET", "/api/engineers/activity")
        status = value.get("status")
        if any(not isinstance(value.get(name), list) for name in ACTIVITY_LISTS) or not isinstance(status, str) or status not in ACTIVITY_STATUSES:
            raise GatewayError("invalid_response")
        return value
