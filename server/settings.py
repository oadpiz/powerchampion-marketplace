"""Server-only configuration; gateway credentials must never reach the browser."""
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Tuple
from urllib.parse import urlsplit
from cryptography.fernet import Fernet

VOICE_TRY_SECRET_MIN = 32
# The A6 records contract version (RC) the Taiwan host's billing runs; phone-agent AI answers need RC v4 (phase2-contract
# §15). Only whole numbers count: anything else (a typo, "4.1", "v4") is "not there yet".
VOICE_A6_RC_VERSION = re.compile(r"[0-9]{1,4}")
VOICE_A6_RC_REQUIRED = 4
VOICE_TRY_LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
# PC_VOICE_CALL_RETENTION_DAYS (phase2-contract §16.5): how long the portal keeps a call's billing and metadata row
# (voice_calls: times, lengths, result, meter). 5 years by default, pending the lawyer's answer. Never under 400 days:
# the monthly billing reconciliation compares up to 13 months back (§9), so a shorter value would delete rows it still
# needs; it is also longer than the 90 days a call's content is kept, so a row never goes before its content's
# deletion is queued. At most 3660 days (10 years).
VOICE_CALL_RETENTION_DAYS_DEFAULT = 1825
VOICE_CALL_RETENTION_DAYS_MIN = 400
VOICE_CALL_RETENTION_DAYS_MAX = 3660


def voice_call_retention_days(text):
    """PC_VOICE_CALL_RETENTION_DAYS as an int: unset or empty is the default; anything but a whole number of days in
    range stops the portal from starting (a wrong value would delete billing rows early or keep caller data too long)."""
    text = (text or "").strip()
    if not text:
        return VOICE_CALL_RETENTION_DAYS_DEFAULT
    if not re.fullmatch(r"[0-9]{1,5}", text):
        raise ValueError("PC_VOICE_CALL_RETENTION_DAYS must be a whole number of days from %d to %d"
                         % (VOICE_CALL_RETENTION_DAYS_MIN, VOICE_CALL_RETENTION_DAYS_MAX))
    return int(text)


def voice_try_origin(url):
    """The origin of a valid try URL, or "" (never raises: a bad value must not stop the service)."""
    try:
        parsed = urlsplit(url)
        parsed.port  # ValueError for a malformed or out-of-range port
    except ValueError:
        return ""
    host = parsed.hostname or ""
    if "@" in parsed.netloc or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        return ""
    if not (re.fullmatch(r"[a-z0-9.-]+", host) or host == "::1"):
        return ""
    if parsed.scheme == "https" or (parsed.scheme == "http" and host in VOICE_TRY_LOCAL_HOSTS):
        return parsed.scheme + "://" + parsed.netloc.lower()
    return ""


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
    # AI phone agent (語音電話客服): off by default. A missing or malformed try secret/URL never stops
    # the service from starting; it only makes "try a call" answer 503 (see voice_try_available).
    voice_enabled: bool = False
    voice_try_secret: str = field(default="", repr=False)
    voice_try_url: str = ""
    # Phase 2 (phase2-contract §1.7). The runtime token is what b300-23 and the Taiwan host send to
    # /api/voice-runtime/*; shorter than 32 characters (besides surrounding spaces) or unset makes those routes
    # answer 503 (fail closed). The media URL and secret sign content links to the Taiwan host; unset makes those
    # routes answer 503 and the call page's content.linkAvailable false. None of them stops the service starting.
    voice_runtime_token: str = field(default="", repr=False)
    voice_media_url: str = ""
    voice_media_secret: str = field(default="", repr=False)
    # PC_VOICE_A6_RC_VERSION: the RC version A6 meters with. Until it is at least 4 (A6 counts AI-answered calls by Q5
    # and does not bill a call whose only push is missing), R1 never answers answer_mode "ai" (phase2-contract §15).
    voice_a6_rc_version: str = ""
    # PC_VOICE_CALL_RETENTION_DAYS: see VOICE_CALL_RETENTION_DAYS_DEFAULT (checked in __post_init__).
    voice_call_retention_days: int = VOICE_CALL_RETENTION_DAYS_DEFAULT

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
        if self.database_url and not self.database_url.startswith(("sqlite:///", "postgres://", "postgresql://", "postgresql+psycopg://")):
            raise ValueError("PC_PORTAL_DATABASE_URL must be a sqlite:/// or postgresql:// (or postgres://) URL")
        if (isinstance(self.voice_call_retention_days, bool) or not isinstance(self.voice_call_retention_days, int)
                or not VOICE_CALL_RETENTION_DAYS_MIN <= self.voice_call_retention_days <= VOICE_CALL_RETENTION_DAYS_MAX):
            raise ValueError("PC_VOICE_CALL_RETENTION_DAYS must be a whole number of days from %d to %d"
                             % (VOICE_CALL_RETENTION_DAYS_MIN, VOICE_CALL_RETENTION_DAYS_MAX))
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

    @property
    def voice_try_origin(self):
        """PC_VOICE_TRY_URL as scheme://host[:port]; "" unless it is an HTTPS origin (plain HTTP only for localhost)."""
        return voice_try_origin(self.voice_try_url)

    @property
    def voice_try_available(self):
        """Tickets can be issued: the shared secret has at least 32 characters besides surrounding spaces (it is still
        used exactly as written, like the demo reads it) and the try URL is valid."""
        return len(self.voice_try_secret.strip()) >= VOICE_TRY_SECRET_MIN and bool(self.voice_try_origin)

    @property
    def voice_runtime_configured(self):
        """The runtime token has at least 32 characters besides surrounding spaces (§1.1 step 2)."""
        return len(self.voice_runtime_token.strip()) >= VOICE_TRY_SECRET_MIN

    @property
    def voice_a6_ready(self):
        """A6 meters AI-answered calls (RC v4 or later). Unset, empty or not a whole number is False (fail closed)."""
        text = str(self.voice_a6_rc_version).strip()
        return bool(VOICE_A6_RC_VERSION.fullmatch(text)) and int(text) >= VOICE_A6_RC_REQUIRED

    @property
    def voice_media_origin(self):
        """PC_VOICE_MEDIA_URL as scheme://host[:port], checked like PC_VOICE_TRY_URL; "" when not valid."""
        return voice_try_origin(self.voice_media_url)

    @property
    def voice_media_available(self):
        """Content links can be signed: a media secret of at least 32 characters (used exactly as written, like the
        try secret) and a valid media URL."""
        return len(self.voice_media_secret.strip()) >= VOICE_TRY_SECRET_MIN and bool(self.voice_media_origin)

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
            voice_enabled=os.environ.get("PC_VOICE_ENABLED", "0") == "1",
            voice_try_secret=os.environ.get("PC_VOICE_TRY_SECRET", ""),
            voice_try_url=os.environ.get("PC_VOICE_TRY_URL", "").strip(),
            voice_runtime_token=os.environ.get("PC_VOICE_RUNTIME_TOKEN", ""),
            voice_media_url=os.environ.get("PC_VOICE_MEDIA_URL", "").strip(),
            voice_media_secret=os.environ.get("PC_VOICE_MEDIA_SECRET", ""),
            voice_a6_rc_version=os.environ.get("PC_VOICE_A6_RC_VERSION", "").strip(),
            voice_call_retention_days=voice_call_retention_days(os.environ.get("PC_VOICE_CALL_RETENTION_DAYS")),
        )
