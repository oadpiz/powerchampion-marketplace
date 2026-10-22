"""Server-to-server client for the shortvideo-agent internal API (docs/studio-spec.md section 13.2).

The agent listens on the Compose `default` network only (never routed by Traefik). Every call
carries `Authorization: Bearer <SHORTVIDEO_SERVICE_TOKEN>` and, except /usage, the portal user id
in `X-Studio-Owner`. The client is synchronous: the portal calls it through run_in_threadpool, so
a slow agent never blocks the event loop.

Errors are `AgentError(kind, status, code)`:
- unconfigured: one of PC_STUDIO_AGENT_URL / SHORTVIDEO_* is missing;
- rejected: the agent answered 4xx; `code` is its `error.code` (e.g. studio_stale_quote);
- timeout: no answer in time (the request may still have been processed);
- unavailable: connection failure or 5xx;
- invalid_response: not a JSON object, or larger than the response limit.
The agent's error message is never kept (it may echo internal detail)."""
import json
import re

import httpx

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
OWNER = re.compile(r"^[A-Za-z0-9_.:@-]{1,128}$")
CODE = re.compile(r"^[a-z0-9_]{1,64}$")
MAX_BYTES = 4 * 1024 * 1024
# The BFF gives a request 20 s; project creation makes three agent calls (create, quote, submit).
TIMEOUT_S = 4.0
SUBMIT_TIMEOUT_S = 6.0


class AgentError(Exception):
    def __init__(self, kind, status=None, code=None):
        super().__init__(kind if code is None else kind + ":" + code)
        self.kind, self.status, self.code = kind, status, code


def _id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise AgentError("rejected", 404, "studio_not_found")
    return value


class StudioAgent:
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.configured = settings.studio_configured
        self._transport = transport  # tests: httpx.MockTransport

    def _request(self, method, path, owner=None, payload=None, params=None, timeout=TIMEOUT_S):
        if not self.configured:
            raise AgentError("unconfigured")
        headers = {"Authorization": "Bearer " + self.settings.studio_service_token, "Accept": "application/json"}
        if owner is not None:
            if not isinstance(owner, str) or not OWNER.fullmatch(owner):
                raise AgentError("rejected", 404, "studio_not_found")
            headers["X-Studio-Owner"] = owner
        url = self.settings.studio_agent_url.rstrip("/") + path
        try:
            with httpx.Client(timeout=timeout, follow_redirects=False, trust_env=False, transport=self._transport) as client:
                with client.stream(method, url, json=payload, params=params, headers=headers) as response:
                    data = bytearray()
                    for chunk in response.iter_bytes():
                        if len(data) + len(chunk) > MAX_BYTES:
                            raise AgentError("invalid_response", response.status_code)
                        data.extend(chunk)
                    status = response.status_code
        except AgentError:
            raise
        except httpx.TimeoutException:
            raise AgentError("timeout") from None
        except (httpx.HTTPError, OSError):
            raise AgentError("unavailable") from None
        if status >= 500 or (300 <= status < 400):
            raise AgentError("unavailable", status)
        try:
            body = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            body = None
        if 400 <= status < 500:
            code = None
            if isinstance(body, dict) and isinstance(body.get("error"), dict):
                candidate = body["error"].get("code")
                code = candidate if isinstance(candidate, str) and CODE.fullmatch(candidate) else None
            raise AgentError("rejected", status, code)
        if not isinstance(body, dict):
            raise AgentError("invalid_response", status)
        return body

    # -- routes (section 13.2) -------------------------------------------------------------------

    def templates(self, owner):
        return self._request("GET", "/internal/v1/templates", owner)

    def create_upload(self, owner, body):
        return self._request("POST", "/internal/v1/uploads", owner, body)

    def create_project(self, owner, body):
        return self._request("POST", "/internal/v1/projects", owner, body)

    def get_project(self, owner, project_id):
        return self._request("GET", "/internal/v1/projects/" + _id(project_id), owner)

    def edit_settings(self, owner, project_id, body):
        return self._request("POST", "/internal/v1/projects/" + _id(project_id) + "/settings", owner, body)

    def purge_project(self, owner, project_id):
        """Drop a project deleted more than 30 days ago, with its media. Owner-checked; 200, or 404 when it is
        already gone (idempotent)."""
        return self._request("POST", "/internal/v1/projects/" + _id(project_id) + "/purge", owner, {})

    def edit_shot(self, owner, project_id, index, body):
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index <= 999:
            raise AgentError("rejected", 404, "studio_not_found")
        return self._request("POST", "/internal/v1/projects/" + _id(project_id) + "/shots/" + str(index) + "/edit", owner, body)

    def quote(self, owner, project_id, body):
        return self._request("POST", "/internal/v1/projects/" + _id(project_id) + "/quote", owner, body)

    def submit_op(self, owner, project_id, body):
        return self._request("POST", "/internal/v1/projects/" + _id(project_id) + "/ops", owner, body, timeout=SUBMIT_TIMEOUT_S)

    def get_op(self, owner, project_id, op_id):
        return self._request("GET", "/internal/v1/projects/" + _id(project_id) + "/ops/" + _id(op_id), owner)

    def usage(self, month, owner=None):
        params = {"month": month}
        if owner is not None:
            params["owner"] = owner
        return self._request("GET", "/internal/v1/usage", None, params=params)
