"""Try-call tickets (試打票, phase1-contract.md §6): the portal signs one (M12), the demo verifies it (T11).

    ticket = B64U(canonical(payload)) + "." + B64U(HMAC_SHA256(key = secret UTF-8, msg = first part ASCII))

B64U is RFC 4648 §5 base64url without "=" padding; canonical is phase1-contract §5.3. The signature covers the
first part as sent (like a JWT), so a verifier never re-serializes JSON. `verify()` follows §6.4 step by step
(length and shape, signature before any JSON is parsed, payload, expiry, replay) and raises TicketError with the
result code the demo logs and the WebSocket close code it uses.

A ticket, its payload and its nonce are secrets for 15 minutes: never put them in a log, an audit record, an
error message or a query string.
"""
import base64
import binascii
import hashlib
import hmac
import json
import re
import secrets
import threading
import time

from .settings import VOICE_TRY_SECRET_MIN as SECRET_MIN_CHARS  # shorter counts as not configured (§6.1)
from .voice_compile import SCHEMA, canonical_json

VERSION = 1
PURPOSE = "try"
TTL_SECONDS = 900  # 15 minutes (§1.5 ticketTtlSeconds)
MAX_CHARS = 131072  # 128 KiB; a full store is about 85 KB (§6.1)
CLOCK_SKEW_SECONDS = 60  # iat may be this far in the verifier's future
CLOSE_INVALID = 4401
CLOSE_POLICY = 1008

SEGMENT = re.compile(r"[A-Za-z0-9_-]+")
HEX32 = re.compile(r"[a-f0-9]{32}")


class TicketError(ValueError):
    """`code` is ticket_invalid, ticket_expired or ticket_replayed; `close_code` is the WebSocket close code (§6.4)."""

    def __init__(self, code, close_code=CLOSE_INVALID):
        super().__init__(code)
        self.code, self.close_code = code, close_code


def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64u(text):
    """Strict base64url decoding of an unpadded string; ValueError for anything else."""
    if not isinstance(text, str) or not SEGMENT.fullmatch(text) or len(text) % 4 == 1:
        raise ValueError("not base64url")
    try:
        return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)
    except binascii.Error as error:
        raise ValueError("not base64url") from error


def _check_secret(secret):
    if not isinstance(secret, str) or len(secret) < SECRET_MIN_CHARS:
        raise ValueError("The try secret must have at least %d characters." % SECRET_MIN_CHARS)
    return secret.encode("utf-8")


def _signature(key, body):
    return b64u(hmac.new(key, body.encode("ascii"), hashlib.sha256).digest())


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def sign(secret, config, *, now=None, nonce=None):
    """Sign a try ticket for `config` (a voice.store-config/v1 dict, e.g. json.loads(config_json) of the
    published version). `now` (epoch seconds) and `nonce` (32 lowercase hex) are injectable for the
    test vector (§6.5); by default they are the current time and secrets.token_hex(16).
    Returns (ticket, payload). ValueError for a short secret, a config without store id and version,
    or a ticket over MAX_CHARS."""
    key = _check_secret(secret)
    if not isinstance(config, dict) or config.get("schema") != SCHEMA:
        raise ValueError("Expected a voice.store-config/v1 config.")
    store_id, version = config.get("store_id"), config.get("version")
    if not isinstance(store_id, str) or not HEX32.fullmatch(store_id) or not _is_int(version) or version < 1:
        raise ValueError("The config needs a 32-hex store_id and a version of 1 or more.")
    iat = int(time.time()) if now is None else int(now)
    nonce = secrets.token_hex(16) if nonce is None else nonce
    if not isinstance(nonce, str) or not HEX32.fullmatch(nonce):
        raise ValueError("The nonce must be 32 lowercase hex characters.")
    payload = {"v": VERSION, "purpose": PURPOSE, "store_id": store_id, "config_version": version,
               "iat": iat, "exp": iat + TTL_SECONDS, "nonce": nonce, "config": config}
    body = b64u(canonical_json(payload))
    ticket = body + "." + _signature(key, body)
    if len(ticket) > MAX_CHARS:
        raise ValueError("The ticket would be longer than %d characters." % MAX_CHARS)
    return ticket, payload


class NonceLedger:
    """Nonces seen by this process, each kept until its ticket expires (§6.4 step 6). Thread-safe."""

    def __init__(self):
        self._lock = threading.Lock()
        self._expiry = {}

    def __len__(self):
        with self._lock:
            return len(self._expiry)

    def use(self, nonce, exp, now):
        """Record the nonce; False when it was already used by a ticket that has not expired."""
        with self._lock:
            for old in [n for n, until in self._expiry.items() if until <= now]:
                del self._expiry[old]
            if nonce in self._expiry:
                return False
            self._expiry[nonce] = exp
            return True


def verify(ticket, secret, *, now=None, ledger=None):
    """Check a ticket in the order of phase1-contract §6.4 steps 2-6 and return its payload.

    Step 1 (only the connection's first config message may carry a ticket) belongs to the WebSocket handler.
    `ledger` (a NonceLedger) enables the replay check; without one the nonce is not recorded.
    Raises TicketError(ticket_invalid | ticket_expired | ticket_replayed), close code 4401."""
    key = _check_secret(secret)
    now = int(time.time()) if now is None else int(now)
    # Step 2: size and shape, before any decoding.
    if not isinstance(ticket, str) or len(ticket) > MAX_CHARS or ticket.count(".") != 1:
        raise TicketError("ticket_invalid")
    body, signature = ticket.split(".")
    if not SEGMENT.fullmatch(body) or not SEGMENT.fullmatch(signature):
        raise TicketError("ticket_invalid")
    # Step 3: the signature, before the payload is parsed.
    if not hmac.compare_digest(_signature(key, body), signature):
        raise TicketError("ticket_invalid")
    # Step 4: the payload.
    try:
        payload = json.loads(unb64u(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise TicketError("ticket_invalid") from None
    if not isinstance(payload, dict):
        raise TicketError("ticket_invalid")
    config = payload.get("config")
    iat, exp, nonce = payload.get("iat"), payload.get("exp"), payload.get("nonce")
    store_id, version = payload.get("store_id"), payload.get("config_version")
    if not (_is_int(payload.get("v")) and payload["v"] == VERSION and payload.get("purpose") == PURPOSE
            and isinstance(config, dict) and config.get("schema") == SCHEMA
            and isinstance(store_id, str) and HEX32.fullmatch(store_id) and config.get("store_id") == store_id
            and _is_int(version) and version >= 1 and _is_int(config.get("version")) and config["version"] == version
            and isinstance(nonce, str) and HEX32.fullmatch(nonce)
            and _is_int(iat) and _is_int(exp) and exp - iat <= TTL_SECONDS and iat <= now + CLOCK_SKEW_SECONDS):
        raise TicketError("ticket_invalid")
    # Step 5: expiry.
    if now >= exp:
        raise TicketError("ticket_expired")
    # Step 6: one use per nonce.
    if ledger is not None and not ledger.use(nonce, exp, now):
        raise TicketError("ticket_replayed")
    return payload
