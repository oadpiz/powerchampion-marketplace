"""Server-only configuration; gateway credentials must never reach the browser."""
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Tuple
from urllib.parse import urlsplit
from cryptography.fernet import Fernet


@dataclass(frozen=True)
class Settings:
    db_path: str = ".local/portal.sqlite3"
    allowed_origins: Tuple[str, ...] = ("http://localhost:3010", "https://powerchampion.ai")
    session_ttl_seconds: int = 43200
    gateway_origin: str = "https://b300.powerchampion.ai"
    gateway_admin_token: str = ""
    secure_cookies: bool = False
    gateway_daily_token_limit: int = 1000000
    gateway_rpm: int = 60
    gateway_max_inflight: int = 2
    trial_enabled: bool = False
    trial_api_key: str = field(default="", repr=False)
    trial_daily_request_limit: int = 0
    trial_session_daily_limit: int = 5
    runtime_enabled: bool = False
    runtime_encryption_key: str = field(default="", repr=False)

    def __post_init__(self):
        parsed = urlsplit(self.gateway_origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("PC_GATEWAY_ORIGIN must be an HTTPS origin without credentials, path or query")
        if self.session_ttl_seconds < 1:
            raise ValueError("Session lifetime must be positive")
        if not self.allowed_origins or any(urlsplit(origin).scheme not in ("http", "https") or urlsplit(origin).netloc == "" for origin in self.allowed_origins):
            raise ValueError("At least one valid allowed origin is required")
        if min(self.gateway_daily_token_limit, self.gateway_rpm, self.gateway_max_inflight) < 1:
            raise ValueError("Gateway key limits must be positive")
        if self.trial_daily_request_limit < 0 or self.trial_session_daily_limit < 1:
            raise ValueError("Trial request limits must be nonnegative globally and positive per session")

    @property
    def trial_available(self):
        return self.trial_enabled and bool(re.fullmatch(r"[\x21-\x7e]{8,512}", self.trial_api_key)) and self.trial_daily_request_limit > 0

    @property
    def runtime_available(self):
        if not self.runtime_enabled or not self.runtime_encryption_key:
            return False
        try:
            Fernet(self.runtime_encryption_key.encode("ascii"))
            return True
        except (ValueError, UnicodeError):
            return False

    @classmethod
    def from_env(cls):
        origins = tuple(origin.strip().rstrip("/") for origin in os.environ.get("PC_PORTAL_ALLOWED_ORIGINS", "http://localhost:3010,https://powerchampion.ai").split(",") if origin.strip())
        secure = os.environ.get("PC_PORTAL_SECURE_COOKIES", "0") == "1"
        if os.environ.get("PC_PORTAL_ENV") == "production" and not secure:
            raise ValueError("Production requires PC_PORTAL_SECURE_COOKIES=1")
        return cls(
            db_path=str(Path(os.environ.get("PC_PORTAL_DB", ".local/portal.sqlite3")).expanduser()),
            allowed_origins=origins,
            session_ttl_seconds=int(os.environ.get("PC_PORTAL_SESSION_TTL", "43200")),
            gateway_origin=os.environ.get("PC_GATEWAY_ORIGIN", "https://b300.powerchampion.ai").rstrip("/"),
            gateway_admin_token=os.environ.get("PC_GATEWAY_ADMIN_TOKEN", ""),
            secure_cookies=secure,
            gateway_daily_token_limit=int(os.environ.get("PC_GATEWAY_DAILY_TOKEN_LIMIT", "1000000")),
            gateway_rpm=int(os.environ.get("PC_GATEWAY_RPM", "60")),
            gateway_max_inflight=int(os.environ.get("PC_GATEWAY_MAX_INFLIGHT", "2")),
            trial_enabled=os.environ.get("PC_TRIAL_ENABLED", "0") == "1",
            trial_api_key=os.environ.get("PC_TRIAL_API_KEY", ""),
            trial_daily_request_limit=int(os.environ.get("PC_TRIAL_DAILY_REQUEST_LIMIT", "0")),
            trial_session_daily_limit=int(os.environ.get("PC_TRIAL_SESSION_REQUEST_LIMIT", "5")),
            runtime_enabled=os.environ.get("PC_RUNTIME_ENABLED", "0") == "1",
            runtime_encryption_key=os.environ.get("PC_RUNTIME_ENCRYPTION_KEY", ""),
        )
