"""Optional anonymous trial chat, with a durable operator-controlled budget.

No model output, history, prompt or API key is stored. A request reservation is
counted before contacting the fixed gateway, including failed/cancelled calls.
"""
import asyncio
import json
import re
from contextlib import suppress

import httpx
from fastapi.responses import JSONResponse


TRIAL_COOKIE = "pc_trial_session"
TRIAL_LIFETIME = 604800
MODELS = frozenset(("glm-5.2-fp8", "qwen3-vl-30b"))
UPSTREAM = "https://b300.powerchampion.ai/v1/chat/completions"
MAX_MESSAGES = 24
MAX_HISTORY_CHARACTERS = 8000
MAX_SYSTEM_CHARACTERS = 16000
MAX_OUTPUT_TOKENS = 512
MAX_BODY_BYTES = 196608
MAX_RESPONSE_BYTES = 524288
TIMEOUT_SECONDS = 45


class ChatError(Exception):
    def __init__(self, code, status, detail="Chat could not be completed. Please try again."):
        self.code, self.status, self.detail = code, status, detail


async def read_request(request):
    if not request.headers.get("content-type", "").lower().startswith("application/json"):
        raise ChatError("input", 415, "Send a JSON request.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body)+len(chunk) > MAX_BODY_BYTES:
            raise ChatError("input", 413, "This conversation is too large.")
        body.extend(chunk)
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise ChatError("input", 400, "Enter valid chat details.") from None
    return validate_chat(data)


def validate_chat(data):
    if not isinstance(data, dict) or not isinstance(data.get("model"), str) or data["model"] not in MODELS:
        raise ChatError("input", 400, "Choose a supported chat model.")
    system, messages, tokens = data.get("system"), data.get("messages"), data.get("maxTokens")
    if not isinstance(system, str) or len(system) > MAX_SYSTEM_CHARACTERS:
        raise ChatError("input", 400, "Agent instructions must be at most 16,000 characters.")
    if not isinstance(tokens, int) or isinstance(tokens, bool) or not 1 <= tokens <= MAX_OUTPUT_TOKENS:
        raise ChatError("input", 400, "Trial responses are limited to 512 output tokens.")
    if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_MESSAGES:
        raise ChatError("input", 400, "Send 1 to 24 conversation messages.")
    total = 0
    clean = []
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant") or not isinstance(message.get("content"), str) or not message["content"].strip():
            raise ChatError("input", 400, "Each conversation message needs a user or assistant role and text.")
        total += len(message["content"])
        if total > MAX_HISTORY_CHARACTERS:
            raise ChatError("input", 400, "Trial conversation history is limited to 8,000 characters. Start a new conversation.")
        clean.append({"role": message["role"], "content": message["content"]})
    if clean[-1]["role"] != "user":
        raise ChatError("input", 400, "End the conversation with a user message.")
    return {"model": data["model"], "messages": clean, "system": system, "maxTokens": tokens}


def safe_count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991 else None


def parse_result(data, key):
    if not isinstance(data, dict) or not isinstance(data.get("choices"), list) or not data["choices"] or not isinstance(data["choices"][0], dict):
        raise ChatError("response", 502)
    choice = data["choices"][0]
    message = choice.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str) or not message["content"]:
        raise ChatError("response", 502)
    usage = data.get("usage")
    return {
        "content": message["content"].replace(key, "[redacted]"),
        "usage": {"input": safe_count(usage.get("prompt_tokens")), "output": safe_count(usage.get("completion_tokens")), "total": safe_count(usage.get("total_tokens"))} if isinstance(usage, dict) else None,
        "finishReason": choice.get("finish_reason") if choice.get("finish_reason") in ("stop", "length", "content_filter") else None,
        "mode": "trial",
    }


class TrialChat:
    def __init__(self, settings, store, transport=None):
        self.settings, self.store, self.transport = settings, store, transport

    def config(self, token):
        response = {"trialAvailable": self.settings.trial_available, "maxOutputTokens": MAX_OUTPUT_TOKENS, "maxHistoryCharacters": MAX_HISTORY_CHARACTERS, "maxSystemCharacters": MAX_SYSTEM_CHARACTERS, "maxMessages": MAX_MESSAGES}
        if not self.settings.trial_available:
            return response, None
        session_hash, new_token = self.store.trial_session(token)
        response["remaining"] = self.store.trial_remaining(session_hash, self.settings.trial_daily_request_limit, self.settings.trial_session_daily_limit)
        return response, new_token

    def response(self, payload, new_token=None, status=200):
        response = JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", "Vary": "Cookie"})
        if new_token:
            response.set_cookie(TRIAL_COOKIE, new_token, max_age=TRIAL_LIFETIME, httponly=True, secure=self.settings.secure_cookies, samesite="lax", path="/")
        return response

    async def upstream(self, body):
        # A fixed URL is deliberate: neither browser input nor an arbitrary
        # portal/gateway origin can send the operator's trial key elsewhere.
        key = self.settings.trial_api_key
        if not re.fullmatch(r"[\x21-\x7e]{8,512}", key):
            raise ChatError("trial_unavailable", 503, "Public trial is not configured.")
        payload = {"model": body["model"], "stream": False, "max_tokens": body["maxTokens"], "messages": ([{"role": "system", "content": body["system"]}] if body["system"].strip() else []) + body["messages"]}
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False, trust_env=False, transport=self.transport) as client:
                async with client.stream("POST", UPSTREAM, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, json=payload) as response:
                    if not response.is_success:
                        mapping = {401: ("authentication", 401), 403: ("authentication", 401), 402: ("credits", 402), 429: ("rate_limit", 429)}
                        code, status = mapping.get(response.status_code, ("gateway", 502))
                        raise ChatError(code, status)
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(content)+len(chunk) > MAX_RESPONSE_BYTES:
                            raise ChatError("response", 502)
                        content.extend(chunk)
                    try:
                        return parse_result(json.loads(content), key)
                    except (ValueError, UnicodeDecodeError):
                        raise ChatError("response", 502) from None
        except httpx.TimeoutException:
            raise ChatError("timeout", 504, "The model took too long to respond.") from None
        except httpx.HTTPError:
            raise ChatError("gateway", 502) from None

    async def complete(self, request):
        if not self.settings.trial_available:
            return self.response({"error": "trial_unavailable", "detail": "Public trial is not enabled. Connect your API key to chat."}, status=503)
        new_token = None
        reservation = None
        state = "failed"
        upstream = disconnected = None
        stop_watching = False
        try:
            body = await read_request(request)
            session_hash, new_token = self.store.trial_session(request.cookies.get(TRIAL_COOKIE))
            reservation = self.store.reserve_trial_request(session_hash, self.settings.trial_daily_request_limit, self.settings.trial_session_daily_limit)
            if not reservation:
                raise ChatError("trial_limit", 429, "The daily trial allowance has been used. Connect your API key or try again tomorrow.")

            async def watch_disconnect():
                while not stop_watching:
                    if await request.is_disconnected():
                        return
                    await asyncio.sleep(0.1)

            upstream = asyncio.create_task(self.upstream(body))
            disconnected = asyncio.create_task(watch_disconnect())
            done, _ = await asyncio.wait((upstream, disconnected), timeout=TIMEOUT_SECONDS, return_when=asyncio.FIRST_COMPLETED)
            if disconnected in done:
                state = "cancelled"
                raise ChatError("cancelled", 499)
            if upstream not in done:
                raise ChatError("timeout", 504, "The model took too long to respond.")
            result = await upstream
            state = "succeeded"
            return self.response(result, new_token)
        except ChatError as error:
            return self.response({"error": error.code, "detail": error.detail}, new_token, error.status)
        except asyncio.CancelledError:
            state = "cancelled"
            raise
        except Exception:
            return self.response({"error": "gateway", "detail": "Chat is unavailable. Please try again later."}, new_token, 502)
        finally:
            # Starlette's disconnect probe intentionally shields a cancelled
            # receive. Also stop the loop explicitly so cancelling the probe
            # task cannot leave request completion waiting on that shield.
            stop_watching = True
            for task in (upstream, disconnected):
                if task:
                    task.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        await task
            if reservation:
                self.store.finish_trial_request(reservation, state)
