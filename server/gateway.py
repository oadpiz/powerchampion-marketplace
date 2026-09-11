"""Adapter to the verified Python gateway routes; admin scope is server-only."""
import json
import re
import httpx


class GatewayError(Exception):
    pass


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
                    if not response.is_success:
                        raise GatewayError("unavailable")
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(data) + len(chunk) > 4 * 1024 * 1024:
                            raise GatewayError("response_limit")
                        data.extend(chunk)
                    value = json.loads(data)
                    if not isinstance(value, dict):
                        raise GatewayError("invalid_response")
                    return value
        except (httpx.HTTPError, ValueError, TypeError):
            raise GatewayError("unavailable") from None

    async def create_key(self, label):
        value = await self._request("POST", "/api/keys", {
            "label": label,
            "daily_token_limit": self.settings.gateway_daily_token_limit,
            "rpm": self.settings.gateway_rpm,
            "max_inflight": self.settings.gateway_max_inflight,
        })
        secret, key_id = value.get("key"), value.get("key_id")
        if not isinstance(secret, str) or not re.fullmatch(r"[\x21-\x7e]{8,512}", secret) or not isinstance(key_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", key_id):
            raise GatewayError("invalid_response")
        return {"key_id": key_id, "prefix": secret[:16], "secret": secret}

    async def revoke_key(self, key_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", key_id):
            raise GatewayError("invalid_identifier")
        value = await self._request("POST", "/api/keys/" + key_id + "/disable", {"disabled": True})
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def usage_report(self, month):
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise GatewayError("invalid_month")
        return await self._request("GET", "/api/usage/report?month=" + month)
