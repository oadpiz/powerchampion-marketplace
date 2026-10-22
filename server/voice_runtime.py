"""Runtime routes for the orchestrator (b300-23) and the Taiwan host's records sender: phase2-contract.md §3.

    R1 GET  /api/portal/voice/runtime/config?number=<dialed>[&have=<state_sha256>]
    R2 POST /api/portal/voice/runtime/calls      (one voice.call-report/v1 per request)
    R3 GET  /api/portal/voice/runtime/deletions?after=<cursor>&limit=<1-500>   (the records sender, §16.3)
    R4 POST /api/portal/voice/runtime/deletions/{id}/ack                       (the records sender, §16.3)

Only the website's server-side route /api/voice-runtime/* calls these (the browser BFF does not list them). In this
order (§1.1), steps 1-5 synchronously before the route's first await, so the rate limit is checked and reserved
atomically (asyncio runs one handler at a time between awaits):
1. PC_VOICE_ENABLED off -> 404 not_found (FastAPI's own detail);
2. PC_VOICE_RUNTIME_TOKEN shorter than 32 characters besides surrounding spaces, or unset -> 503
   voice_runtime_unconfigured: without a token nothing gets in (fail closed);
3. Authorization must be "Bearer <token>", the token [\\x21-\\x7e]{32,256}, compared as sha256 digests with
   hmac.compare_digest (no early exit on length) -> 401 runtime_auth. Failures draw from their own bucket; past
   60 a minute they answer 429, and a correct token is not affected;
4. the route's bucket (600 a minute) -> 429 rate_limited;
5. R2: Content-Length missing or above 8192 -> 413 before any byte is read; then body_json (415/413/400). R4 the
   same with 1024 bytes.
The routes read no cookie, never call current_user, set no cookie and write no audit row (the call rows are the
record). No IP address is used for anything: the portal only sees the website container's address (§3.6).

The limits live in this process's memory: the portal runs one uvicorn worker (server/Dockerfile has no --workers).
With N workers each would allow the full limit, so divide the limits by N if that ever changes.
"""
import hashlib
import hmac
import re
import time

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from . import voice_calls as vc
from . import voice_retention as vrt
from .support import PREFIX, body_json, fail
from .voice_merchant import NOT_FOUND_DETAIL

AUTHORIZATION = re.compile(r"Bearer ([\x21-\x7e]{32,256})")
HAVE = re.compile(r"[a-f0-9]{64}")
LIMITS = {"config": 600, "calls": 600, "deletions": 600, "deletion_acks": 600, "auth_failures": 60}  # per 60 seconds (§1.5, §16.3)
WINDOW_SECONDS = 60.0


class WindowLimiter:
    """A fixed 60-second window. take() is synchronous: call it before the route's first await."""

    def __init__(self, limit, window=WINDOW_SECONDS, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self.started, self.count = None, 0

    def take(self):
        now = self.clock()
        if self.started is None or now - self.started >= self.window:
            self.started, self.count = now, 0
        if self.count >= self.limit:
            return False
        self.count += 1
        return True


def attach_voice_runtime(application, ctx):
    store = ctx.store
    base = PREFIX + "/voice/runtime"
    limits = {name: WindowLimiter(limit) for name, limit in LIMITS.items()}
    application.state.voice_runtime_limits = limits  # tests replace these to move the window

    def gate(request, bucket):
        """§1.1 steps 1-4. Synchronous on purpose (see the module docstring)."""
        settings = ctx.settings
        if not settings.voice_enabled:
            fail("not_found", NOT_FOUND_DETAIL, 404)
        if not settings.voice_runtime_configured:
            fail("voice_runtime_unconfigured", "The runtime token is not configured.", 503)
        match = AUTHORIZATION.fullmatch(request.headers.get("authorization", ""))
        received = hashlib.sha256((match.group(1) if match else "").encode("utf-8")).digest()
        expected = hashlib.sha256(settings.voice_runtime_token.strip().encode("utf-8")).digest()
        if not hmac.compare_digest(received, expected) or not match:
            if not limits["auth_failures"].take():
                fail("rate_limited", "Too many failed requests. Try again in a minute.", 429)
            fail("runtime_auth", "The runtime token is missing or wrong.", 401)
        if not limits[bucket].take():
            fail("rate_limited", "Too many requests. Try again in a minute.", 429)

    # R1
    @application.get(base + "/config")
    async def voice_runtime_config(request: Request):
        gate(request, "config")
        number = vc.normalize_number(request.query_params.get("number"))
        if number is None:
            fail("invalid_number", "Send number as 0227001001, +886227001001 (with + encoded as %2B) or ext:6201.")
        have = request.query_params.get("have")
        if have is not None and not HAVE.fullmatch(have):
            fail("invalid_input", "have must be a state_sha256 (64 lowercase hex).")
        now = int(time.time())
        with store.connect() as con:
            state, payload = vc.runtime_config(con, number, now, have=have, a6_ready=ctx.settings.voice_a6_ready)
        etag = '"%s"' % state
        if etag in [part.strip() for part in request.headers.get("if-none-match", "").split(",")]:
            return Response(status_code=304, headers={"ETag": etag})
        return JSONResponse(payload, headers={"ETag": etag})

    # R2
    @application.post(base + "/calls")
    async def voice_runtime_calls(request: Request):
        gate(request, "calls")
        length = request.headers.get("content-length", "")
        if not length.isdigit() or int(length) > vc.RUNTIME_BODY_BYTES:
            fail("invalid_input", "Send Content-Length; a report is at most %d bytes." % vc.RUNTIME_BODY_BYTES, 413)
        body = await body_json(request, vc.RUNTIME_BODY_BYTES)
        now = int(time.time())
        parsed = vc.parse_report(body, now)
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            status, payload = vc.ingest(con, parsed, now, audit=store.audit)
        return JSONResponse(payload, status_code=status)

    # R3
    @application.get(base + "/deletions")
    async def voice_runtime_deletions(request: Request):
        gate(request, "deletions")
        after, limit = vrt.parse_pull(request.query_params.get("after"), request.query_params.get("limit"))
        with store.connect() as con:
            return vrt.pull(con, after, limit)

    # R4
    @application.post(base + "/deletions/{request_id}/ack")
    async def voice_runtime_deletion_ack(request_id: str, request: Request):
        gate(request, "deletion_acks")
        length = request.headers.get("content-length", "")
        if not length.isdigit() or int(length) > vrt.ACK_BODY_BYTES:
            fail("invalid_input", "Send Content-Length; an acknowledgement is at most %d bytes." % vrt.ACK_BODY_BYTES, 413)
        body = await body_json(request, vrt.ACK_BODY_BYTES)
        now = int(time.time())
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            return vrt.ack(con, request_id, body, now)
