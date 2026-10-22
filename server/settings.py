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
    database_url: str = field(default="", repr=False)
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
    customer_key_issuance: bool = False
    runtime_enabled: bool = False
    runtime_encryption_key: str = field(default="", repr=False)
    # Base of the cluster Grafana for the admin Engineers page links; "" hides the links.
    grafana_url: str = "https://grafana.powerchampion.ai"
    # Video studio (server/studio.py): the shortvideo-agent internal API on the Compose network and
    # the three secrets shared with it. Any of the four missing = studio routes answer 503 studio_unconfigured.
    studio_agent_url: str = ""
    studio_service_token: str = field(default="", repr=False)
    studio_grant_secret: str = field(default="", repr=False)
    studio_quote_secret: str = field(default="", repr=False)
    # The settlement sweeper (a lifespan task). Off by default here so tests and ad-hoc apps never
    # start it; from_env turns it on unless PC_STUDIO_SWEEPER=0.
    studio_sweeper: bool = False
    studio_sweep_interval: float = 10.0
    # Voices for internal tests only (spec D-V4): customers may not choose them, nor render a project that uses one.
    studio_internal_voices: tuple = ("tw_ref", "test")
    # Public origin of the shortvideo media host; the UI only loads media and sends uploads there (empty: not checked).
    studio_media_origin: str = ""
    # Drafts are free (owner decision Q3), so each user may start this many per Asia/Taipei day.
    studio_drafts_per_day: int = 30
    # Demo mode (PC_STUDIO_ALLOWED_EMAILS): when non-empty, only these accounts (and admins) may use the
    # customer /studio/* routes; everyone else gets 403 studio_not_open. Empty = open to every signed-in user.
    studio_allowed_emails: Tuple[str, ...] = ()

    def __post_init__(self):
        emails = self.studio_allowed_emails
        if isinstance(emails, str):
            emails = emails.split(",")
        cleaned = tuple(dict.fromkeys(e.strip().lower() for e in emails if isinstance(e, str) and e.strip()))
        object.__setattr__(self, "studio_allowed_emails", cleaned)
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
        if self.database_url and not self.database_url.startswith(("sqlite:///", "postgres://", "postgresql://", "postgresql+psycopg://")):
            raise ValueError("PC_PORTAL_DATABASE_URL must be a sqlite:/// or postgresql:// (or postgres://) URL")
        if self.grafana_url:
            grafana = urlsplit(self.grafana_url)
            if grafana.scheme != "https" or not grafana.hostname or grafana.username or grafana.password or grafana.query or grafana.fragment or grafana.path not in ("", "/"):
                raise ValueError("PC_GRAFANA_URL must be empty or an HTTPS origin without credentials, path or query")
        if self.studio_agent_url:
            agent = urlsplit(self.studio_agent_url)
            if agent.scheme not in ("http", "https") or not agent.hostname or agent.username or agent.password or agent.query or agent.fragment or agent.path not in ("", "/"):
                raise ValueError("PC_STUDIO_AGENT_URL must be empty or an http(s) origin without credentials, path or query")
        if self.studio_media_origin:
            media = urlsplit(self.studio_media_origin)
            if media.scheme not in ("http", "https") or not media.hostname or media.username or media.password or media.query or media.fragment or media.path not in ("", "/"):
                raise ValueError("PC_STUDIO_MEDIA_ORIGIN must be empty or an http(s) origin without credentials, path or query")
        if self.studio_sweep_interval <= 0:
            raise ValueError("The studio sweep interval must be positive")
        if isinstance(self.studio_drafts_per_day, bool) or not isinstance(self.studio_drafts_per_day, int) or not 0 <= self.studio_drafts_per_day <= 10_000:
            raise ValueError("PC_STUDIO_DRAFTS_PER_DAY must be a whole number from 0 to 10000")

    @property
    def resolved_database_url(self):
        if self.database_url:
            return self.database_url
        if self.db_path.startswith(("sqlite:///", "postgres://", "postgresql://", "postgresql+psycopg://")):
            return self.db_path
        return "sqlite:///" + self.db_path

    def studio_allows(self, user):
        """Demo mode: may this signed-in user use the customer studio routes? Admins always may."""
        if not self.studio_allowed_emails or user.get("role") == "admin":
            return True
        return str(user.get("email") or "").strip().lower() in self.studio_allowed_emails

    @property
    def studio_configured(self):
        """All four studio values are set and the service token is not one of the signing secrets
        (the agent refuses that combination too)."""
        values = (self.studio_agent_url, self.studio_service_token, self.studio_grant_secret, self.studio_quote_secret)
        return all(values) and self.studio_service_token not in (self.studio_grant_secret, self.studio_quote_secret)

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
            database_url=os.environ.get("PC_PORTAL_DATABASE_URL", "").strip(),
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
            customer_key_issuance=os.environ.get("PC_CUSTOMER_KEY_ISSUANCE", "0") == "1",
            runtime_enabled=os.environ.get("PC_RUNTIME_ENABLED", "0") == "1",
            runtime_encryption_key=os.environ.get("PC_RUNTIME_ENCRYPTION_KEY", ""),
            grafana_url=os.environ.get("PC_GRAFANA_URL", "https://grafana.powerchampion.ai").strip().rstrip("/"),
            studio_agent_url=os.environ.get("PC_STUDIO_AGENT_URL", "").strip().rstrip("/"),
            studio_service_token=os.environ.get("SHORTVIDEO_SERVICE_TOKEN", ""),
            studio_grant_secret=os.environ.get("SHORTVIDEO_GRANT_SECRET", ""),
            studio_quote_secret=os.environ.get("SHORTVIDEO_QUOTE_SECRET", ""),
            studio_sweeper=os.environ.get("PC_STUDIO_SWEEPER", "1") != "0",
            studio_media_origin=os.environ.get("PC_STUDIO_MEDIA_ORIGIN", "").strip().rstrip("/"),
            studio_internal_voices=tuple(v.strip() for v in os.environ.get("PC_STUDIO_INTERNAL_VOICES", "tw_ref,test").split(",") if v.strip()),
            studio_drafts_per_day=int(os.environ.get("PC_STUDIO_DRAFTS_PER_DAY", "30")),
            studio_allowed_emails=os.environ.get("PC_STUDIO_ALLOWED_EMAILS", ""),
        )
