"""Authenticated task API. Credentials cross this boundary once, encrypted at rest."""
import re

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Request
from fastapi.responses import JSONResponse

from .agents import SUPPORTED_MODELS
from .runtime_engine import RuntimeEngine
from .runtime_store import RuntimeStore, RuntimeErrorDetail

PREFIX = "/api/portal/runtime"
IDENTIFIER = re.compile(r"^[a-f0-9]{32}$")
TOOLS = ["read_reference", "analyze_csv", "write_artifact", "read_url", "update_plan"]


def contains_secret(value, secret):
    """Inspect decoded strings: JSON serialization escapes quotes/backslashes."""
    if isinstance(value, str):
        return secret in value
    if isinstance(value, list):
        return any(contains_secret(item, secret) for item in value)
    if isinstance(value, dict):
        return any(contains_secret(key, secret) or contains_secret(item, secret) for key, item in value.items())
    return False


def attach_runtime(app, store, settings, agents, current_user, body_json, model=None, tools=None):
    repository = RuntimeStore(store)
    app.state.runtime_store = repository
    app.state.runtime_engine = RuntimeEngine(repository, settings, model=model, tools=tools)

    @app.exception_handler(RuntimeErrorDetail)
    async def runtime_error(_request, error):
        return JSONResponse({"error": error.code, "detail": error.detail}, status_code=error.status)

    def identifier(value):
        if not IDENTIFIER.fullmatch(value):
            raise RuntimeErrorDetail("not_found", "This task or result does not exist.", 404)
        return value

    def require_available():
        if not settings.runtime_available:
            raise RuntimeErrorDetail("runtime_unavailable", "Background tasks are not enabled on this installation.", 503)

    @app.get(PREFIX + "/config")
    async def config(request: Request):
        current_user(request)
        return {
            "enabled": settings.runtime_enabled, "available": settings.runtime_available,
            "models": list(SUPPORTED_MODELS), "tools": TOOLS,
            "limits": {"maxSteps": 20, "maxOutputTokens": 4096, "maxReferences": 8, "referenceCharacters": 32000},
            **({"reason": "Background tasks are not enabled on this installation."} if not settings.runtime_available else {}),
        }

    @app.get(PREFIX + "/tasks")
    async def listing(request: Request):
        user = current_user(request)
        return {"tasks": repository.list(user["id"])}

    @app.post(PREFIX + "/tasks")
    async def create(request: Request):
        user = current_user(request)
        require_available()
        body = await body_json(request, maximum=196608)
        key = body.get("apiKey")
        if not isinstance(key, str) or not re.fullmatch(r"[\x21-\x7e]{8,512}", key):
            raise RuntimeErrorDetail("invalid_input", "Enter your model API key.")
        # An explicit allowlist prevents an accidental credential copy into the
        # persisted payload when new browser fields are introduced.
        payload = {field: body[field] for field in ("goal", "agentId", "model", "maxSteps", "maxOutputTokens", "references") if field in body}
        if contains_secret(payload, key):
            raise RuntimeErrorDetail("invalid_input", "Keep your API key out of task instructions and reference material.")
        snapshot = None
        if payload.get("agentId") is not None:
            agent_id = payload["agentId"]
            if not isinstance(agent_id, str):
                raise RuntimeErrorDetail("invalid_input", "Choose an agent from your account.")
            identifier(agent_id)
            try:
                saved = agents.get(user["id"], agent_id)
            except LookupError:
                raise RuntimeErrorDetail("not_found", "This agent does not exist.", 404)
            snapshot = {field: saved[field] for field in ("id", "name", "version", "configuration")}
            if contains_secret(snapshot, key):
                raise RuntimeErrorDetail("invalid_input", "Remove the API key from the saved agent's instructions before running it.")
        encrypted = Fernet(settings.runtime_encryption_key.encode("ascii")).encrypt(key.encode("ascii")).decode("ascii")
        task = repository.create(user["id"], payload, encrypted, agent_snapshot=snapshot)
        return JSONResponse({"task": task}, status_code=201)

    @app.get(PREFIX + "/tasks/{task_id}")
    async def get(request: Request, task_id: str):
        user = current_user(request)
        return {"task": repository.get(user["id"], identifier(task_id))}

    @app.post(PREFIX + "/tasks/{task_id}/control")
    async def control(request: Request, task_id: str):
        user = current_user(request)
        body = await body_json(request)
        if body.get("action") == "resume":
            require_available()
        return {"task": repository.control(user["id"], identifier(task_id), body.get("action"))}

    @app.post(PREFIX + "/tasks/{task_id}/instructions")
    async def instructions(request: Request, task_id: str):
        user = current_user(request)
        body = await body_json(request)
        identifier(task_id)
        message = body.get("message")
        ciphertext = repository.encrypted_key_for_owner(user["id"], task_id)
        if ciphertext:
            try:
                secret = Fernet(settings.runtime_encryption_key.encode("ascii")).decrypt(ciphertext.encode("ascii")).decode("ascii")
            except (ValueError, UnicodeError, InvalidToken):
                raise RuntimeErrorDetail("runtime_unavailable", "This task's credential is unavailable. Cancel it and start a new task.", 503) from None
            if isinstance(message, str) and secret in message:
                raise RuntimeErrorDetail("invalid_input", "Keep your API key out of task instructions.")
        return {"task": repository.instruct(user["id"], task_id, message)}

    @app.post(PREFIX + "/tasks/{task_id}/approval")
    async def approval(request: Request, task_id: str):
        user = current_user(request)
        require_available()
        body = await body_json(request)
        approval_id = body.get("approvalId")
        if not isinstance(approval_id, str):
            raise RuntimeErrorDetail("invalid_input", "Choose a pending approval.")
        return {"task": repository.decide(user["id"], identifier(task_id), identifier(approval_id), body.get("decision"))}

    @app.get(PREFIX + "/tasks/{task_id}/artifacts/{artifact_id}")
    async def artifact(request: Request, task_id: str, artifact_id: str):
        user = current_user(request)
        return {"artifact": repository.artifact(user["id"], identifier(task_id), identifier(artifact_id))}
