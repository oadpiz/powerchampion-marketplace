"""Adapter to the verified Python gateway routes; admin scope is server-only.

Error model: 2xx -> dict; gateway 4xx -> GatewayError("rejected", status, detail);
anything else (5xx, network, bad JSON) -> GatewayError("unavailable"). The admin
token never appears in exceptions or return values.
"""
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


class GatewayError(Exception):
    def __init__(self, code, status=None, detail=""):
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = (detail or "")[:300]


def _strip_secrets(value):
    if isinstance(value, dict):
        return {k: _strip_secrets(v) for k, v in value.items()
                if not (isinstance(v, str) and any(h in k.lower() for h in SECRET_KEY_HINTS))}
    if isinstance(value, list):
        return [_strip_secrets(v) for v in value]
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

    async def _request(self, method, path, payload=None):
        if not self.configured:
            raise GatewayError("unconfigured")
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
                async with client.stream(method, self.settings.gateway_origin.rstrip("/") + path, json=payload,
                                         headers={"X-Admin-Token": self.settings.gateway_admin_token, "Accept": "application/json"}) as response:
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(data) + len(chunk) > 4 * 1024 * 1024:
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
                    value = json.loads(data)
                    if not isinstance(value, dict):
                        raise GatewayError("invalid_response")
                    return value
        except GatewayError:
            raise
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
        if not isinstance(name, str) or not NODE_NAME.fullmatch(name) or action not in NODE_ACTIONS:
            raise GatewayError("invalid_identifier")
        return await self._request("POST", "/api/nodes/" + name + "/ops/" + action)

    async def node_job(self, name, job_id):
        if not isinstance(name, str) or not NODE_NAME.fullmatch(name) or not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
            raise GatewayError("invalid_identifier")
        return await self._request("GET", "/api/nodes/" + name + "/jobs/" + job_id)

    async def metrics(self):
        return await self._request("GET", "/api/metrics")

    async def toggle_model(self, model_id):
        if not isinstance(model_id, str) or not MODEL_ID.fullmatch(model_id):
            raise GatewayError("invalid_identifier")
        return await self._request("POST", "/api/models/" + model_id + "/toggle")

    async def set_maintenance(self, model_id, message):
        if not isinstance(model_id, str) or not MODEL_ID.fullmatch(model_id):
            raise GatewayError("invalid_identifier")
        if not isinstance(message, str) or len(message) > 300:
            raise ValueError("message too long")
        return await self._request("POST", "/api/models/" + model_id + "/maintenance", {"message": message})
