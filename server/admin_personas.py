"""Admin persona routes, proxied to the gateway's /api/personas with validation and audit.

Persona content (system prompt, examples, try input) never goes into the audit log; only sizes do."""
import math

from fastapi import Request
from fastapi.responses import JSONResponse

from .gateway import PERSONA_ID
from .support import PREFIX, body_json, fail, gateway_path, text_value

PERSONA_NOT_FOUND = ("persona_not_found", "This persona or revision does not exist.")
MAX_SYSTEM = 32000
MAX_EXAMPLES = 50
MAX_EXAMPLE_TEXT = 4000
MAX_NOTE = 200
MAX_INPUT = 4000
MAX_REV = 10 ** 9
REVISION_BODY_LIMIT = 196608


def _invalid(detail):
    fail("invalid_input", detail, 422)


def _no_controls(value, keep="\n\r\t"):
    return not any(ord(c) < 32 and c not in keep for c in value)


def _multiline(value, label, maximum):
    if not isinstance(value, str) or len(value) > maximum or not _no_controls(value):
        _invalid("Enter a valid " + label + " (text of at most " + f"{maximum:,}" + " characters).")
    return value


def _rev(value):
    return not isinstance(value, bool) and isinstance(value, int) and 1 <= value <= MAX_REV


def _examples(value):
    if not isinstance(value, list) or len(value) > MAX_EXAMPLES:
        _invalid("Give at most 50 examples.")
    cleaned = []
    for item in value:
        if not isinstance(item, dict) or set(item) - {"user", "assistant"}:
            _invalid("Each example has only a user and an assistant message.")
        pair = {name: item.get(name, "") for name in ("user", "assistant")}
        for text in pair.values():
            if not isinstance(text, str) or len(text) > MAX_EXAMPLE_TEXT or not _no_controls(text):
                _invalid("Each example message must be text of at most 4,000 characters.")
        if not (pair["user"].strip() or pair["assistant"].strip()):
            _invalid("An example needs a user or an assistant message.")
        cleaned.append(pair)
    return cleaned


def attach_admin_personas(application, ctx):
    base = PREFIX + "/admin/personas"

    @application.get(base)
    async def admin_personas(request: Request):
        ctx.current_user(request, admin=True)
        # 200 rather than 503: the BFF rewrites provider_not_configured, and the page shows "not connected".
        if not ctx.gateway.configured:
            return {"gatewayConfigured": False, "personas": []}
        listing = await ctx.gateway_call(ctx.gateway.list_personas)
        return {"gatewayConfigured": True, "personas": listing["personas"]}

    @application.post(base)
    async def admin_persona_create(request: Request):
        admin = ctx.current_user(request, admin=True)
        name = text_value((await body_json(request)).get("name"), "persona name", 80)
        persona_id = await ctx.gateway_call(ctx.gateway.create_persona, name)
        ctx.audit("admin.persona_created", admin, persona_id, {"name": name})
        return JSONResponse({"persona_id": persona_id}, status_code=201)

    @application.get(base + "/{persona_id}")
    async def admin_persona(persona_id: str, request: Request, rev: int | None = None):
        ctx.current_user(request, admin=True)
        gateway_path(persona_id, PERSONA_ID)
        if rev is not None and not 1 <= rev <= MAX_REV:
            fail("invalid_input", "Choose a valid revision.")
        return await ctx.gateway_call(ctx.gateway.get_persona, persona_id, rev, not_found=PERSONA_NOT_FOUND)

    @application.post(base + "/{persona_id}/revisions")
    async def admin_persona_revision(persona_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_path(persona_id, PERSONA_ID)
        body = await body_json(request, maximum=REVISION_BODY_LIMIT)
        system = _multiline(body.get("system"), "system prompt", MAX_SYSTEM)
        examples = _examples(body.get("examples"))
        note = body.get("note", "")
        if not isinstance(note, str) or len(note.strip()) > MAX_NOTE or not _no_controls(note, keep=""):
            _invalid("The note must be a single line of at most 200 characters.")
        note = note.strip()
        # Required, unlike the gateway's "omitted = activate now": activating changes live traffic.
        activate = body.get("activate")
        if not isinstance(activate, bool):
            _invalid("Choose whether to activate this revision now.")
        rev = await ctx.gateway_call(ctx.gateway.save_persona_revision, persona_id, system=system, examples=examples, note=note,
                                     activate=activate, not_found=PERSONA_NOT_FOUND)
        ctx.audit("admin.persona_revision_saved", admin, persona_id,
                  {"rev": rev, "activate": activate, "systemChars": len(system), "examples": len(examples)})
        return {"rev": rev}

    @application.post(base + "/{persona_id}/activate")
    async def admin_persona_activate(persona_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_path(persona_id, PERSONA_ID)
        rev = (await body_json(request)).get("rev")
        if not _rev(rev):
            _invalid("Choose a valid revision.")
        await ctx.gateway_call(ctx.gateway.activate_persona, persona_id, rev, not_found=PERSONA_NOT_FOUND)
        ctx.audit("admin.persona_activated", admin, persona_id, {"rev": rev})
        return {"ok": True}

    @application.post(base + "/{persona_id}/try")
    async def admin_persona_try(persona_id: str, request: Request):
        admin = ctx.current_user(request, admin=True)
        gateway_path(persona_id, PERSONA_ID)
        body = await body_json(request)
        text = body.get("input")
        if not isinstance(text, str) or len(text) > MAX_INPUT or not text.strip() or not _no_controls(text):
            _invalid("Enter a test message of at most 4,000 characters.")
        revs = body.get("revs", [None])
        if not isinstance(revs, list) or not 1 <= len(revs) <= 2 or not all(r is None or _rev(r) for r in revs):
            _invalid("Choose one or two revisions to compare.")
        max_tokens = body.get("maxTokens", 300)
        if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or not 1 <= max_tokens <= 1024:
            _invalid("Max tokens must be a whole number from 1 to 1,024.")
        temperature = body.get("temperature", 0.8)
        if isinstance(temperature, bool) or not isinstance(temperature, (int, float)) or not math.isfinite(temperature) or not 0 <= temperature <= 2:
            _invalid("Temperature must be a number from 0 to 2.")
        # Spends model tokens, so it is audited like a write (sizes only, never the text).
        result = await ctx.gateway_call(ctx.gateway.try_persona, persona_id, text=text, revs=revs, max_tokens=max_tokens, temperature=temperature)
        ctx.audit("admin.persona_tried", admin, persona_id, {"revs": revs, "inputChars": len(text), "maxTokens": max_tokens})
        return result
