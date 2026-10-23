"""Video studio (影片工作室) portal backend: credits ledger, project ownership and op settlement.

Contract: shortvideo-agent docs/studio-spec.md (v3), sections 4-6, 8, 12 and 13.2.

The portal owns money; the agent (server/studio_agent.py) owns projects, assets and op execution.
Every priced step is an op:

  1. quote: the agent prices the op and signs the quote (SHORTVIDEO_QUOTE_SECRET);
  2. the portal verifies that signature locally, then reserves exactly `credits` in ONE database
     transaction (BEGIN IMMEDIATE) that also checks the idempotency key, the per-project and
     per-user active-op limits and the balance. That transaction makes no network call;
  3. only then the portal submits the op to the agent with a grant it signs
     (SHORTVIDEO_GRANT_SECRET) from the session user, the path's project id and the stored op row;
  4. the op is settled from the agent's GET op result, on every GET of the project or op and by
     the sweeper (a lifespan task, every 10 s).

Op states (studio_ops.state):
  reserved --submit 2xx--> submitted --agent succeeded--> settled
  reserved --submit 4xx--> refunded (the agent created no op, section 12.5)
  reserved --submit timeout/5xx--> unknown (never refunded on the spot)
  submitted|unknown --agent failed--> settled_partial (charge produced_credits) | refunded (nothing produced)
  reserved|unknown + agent 404 + older than 120 s --> refunded (grant exp is 60 s, so it can no longer be accepted)
Every terminal transition is a conditional UPDATE from an active state with a rowcount check, and
writes its ledger rows in the same transaction: an op is never both settled and refunded.

Money: studio_accounts.balance is what the user can still spend; a reservation moves credits from
balance to reserved (ledger 'reserve', delta -credits). Settling releases the reservation and gives
back the unproduced part (ledger 'settle' delta 0 with the charge in the note, 'refund' +rest).
So per user: balance == SUM(ledger.delta) and reserved == SUM(credits of active ops)."""
import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from .studio_agent import AgentError, StudioAgent
from .support import PREFIX, PortalError, body_json, fail, text_value

log = logging.getLogger(__name__)

ACTIVE = ("reserved", "submitted", "unknown")
TERMINAL = ("settled", "settled_partial", "refunded")
PLANS = ("creator", "merchant", "agency")
DEFAULT_PLAN = "creator"
GRANT_TTL_S = 60          # grant exp = op created_at + 60 (section 12.3), never re-issued
ORPHAN_S = 120            # >= grant TTL + 30 s slack (section 4)
# A submitted op the agent no longer knows (its data was lost or restored): refunded after this long,
# so it does not hold the user's credits, the project and an active-op slot forever.
LOST_S = 6 * 3600
INT4_MAX = 2 ** 31 - 1    # the Postgres INTEGER columns
MAX_ACTIVE_PER_USER = 2
# bucket -> (limit, window seconds); section 8. Per user only, never per client IP.
LIMITS = {"project": (20, 3600), "upload": (60, 3600), "quote": (120, 60)}
LIST_DEFAULT, LIST_MAX = 20, 50
GRANT_MAX = 1_000_000
REFRESH_WORKERS = 6
THUMB_MARGIN_S = 300
# Soft delete: a deleted project stays in the trash (回收區) and can be restored for 30 days. After that it is
# hidden from every route, including restore. Credits are never refunded by a delete.
# Studio.purge (from the sweeper, at most hourly) then asks the agent to drop the project and its media
# and marks the portal row status='purged'; the row itself stays, because ops and the ledger point at it.
TRASH_S = 30 * 86400
PURGE_EVERY_S = 3600
PURGE_BATCH = 50
PURGED = "purged"
# The free-draft cap counts per Asia/Taipei calendar day (UTC+8, no daylight saving).
TAIPEI_OFFSET_S = 8 * 3600
TITLE_MAX = 120
CONTROL = re.compile(r"[\x00-\x1f\x7f]")

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
IDEMPOTENCY = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
OP_TYPE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
# Targets are an aspect ("9:16"), a shot index ("3") or a template-specific id; never "|".
TARGET = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
TEMPLATE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
ASPECT = re.compile(r"^[0-9]{1,2}:[0-9]{1,2}$")
CONTENT_TYPE = re.compile(r"^[a-z]{1,16}/[a-z0-9.+-]{1,64}$")
CURSOR = re.compile(r"^([0-9]{1,12})_([A-Za-z0-9_-]{1,64})$")
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
SHOT_INDEX = re.compile(r"^[0-9]{1,3}$")
SIG = re.compile(r"^[0-9a-f]{64}$")
ERROR_CODE = re.compile(r"^[a-z0-9_]{1,64}$")
UPLOAD_PURPOSES = ("input_image", "shot_image", "music", "character_ref", "lifestyle_image")
# Uploaded before the project exists and attached at creation (inputs.image_ids, inputs.lifestyle_ids).
PRE_PROJECT_PURPOSES = ("input_image", "lifestyle_image")
# Photos that need the seller's rights declaration with the ticket (rights_confirmed: true, else 400
# studio_rights_required): product photos (「我擁有或已取得這張商品照片的使用權，並同意用於產生影片。」) and lifestyle
# photos (「我擁有或已取得這張情境照的使用權，照片中的人物（若有）已同意使用。」). One checkbox per declaration; the
# purpose recorded in the audit row says which statement it was. Music has its own checkbox (music_rights_confirmed).
RIGHTS_PURPOSES = ("input_image", "shot_image", "lifestyle_image")
# Op types that never synthesise narration (draft writes the script; add_aspect draws stills; export composes).
VOICELESS_OPS = ("draft", "add_aspect", "export")
UPLOAD_MAX_BYTES = 20 * 1024 * 1024  # the agent enforces 10 MB (music 20 MB) exactly

# Agent 4xx codes the browser may see, with the portal's own text (never the agent's message).
PASS_THROUGH = {
    "studio_not_found": (404, "Project not found."),
    "studio_busy": (409, "This project is busy. Wait for the current step to finish."),
    "studio_needs_render": (409, "Generate the changed shots first."),
    "studio_needs_draft": (409, "Generate the storyboard first."),
    "studio_stale_quote": (409, "The price changed. Get a new quote."),
    "studio_storage_full": (409, "Storage is full for now. Please try again later."),
    "studio_conflict": (409, "This project id is already in use."),
    "studio_invalid_input": (400, "Check the details and try again."),
    "studio_daily_cap": (429, "The daily limit for video generation has been reached. Try again tomorrow."),
    "studio_too_large": (413, "The request is too large."),
    "studio_rights_required": (400, "Confirm that you own or have the rights to use this photo (for a lifestyle photo, also that "
                                    "the people in it, if any, agreed to its use)."),
}


def _mark_internal_voices(template, internal):
    """Annotate the template's voice field with the portal's internal-voice list (x-internal-values)."""
    schema = template.get("project_schema")
    voice = schema.get("properties", {}).get("voice") if isinstance(schema, dict) and isinstance(schema.get("properties"), dict) else None
    if isinstance(voice, dict):
        template["project_schema"] = dict(schema, properties=dict(schema["properties"], voice=dict(voice, **{"x-internal-values": list(internal)})))
    return template


def agent_fail(error):
    """Turn an AgentError into the portal's error response."""
    if error.kind == "unconfigured":
        fail("studio_unconfigured", "The video studio is not connected yet.", 503)
    if error.kind == "rejected":
        if error.code in PASS_THROUGH:
            status, detail = PASS_THROUGH[error.code]
            fail(error.code, detail, status)
        if error.status == 404:
            fail("studio_not_found", PASS_THROUGH["studio_not_found"][1], 404)
    # timeout, 5xx, invalid response, or a 4xx that means the portal and agent disagree
    # (studio_unauthorized / studio_forbidden: a wrong token or secret): an operator problem.
    fail("studio_unavailable", "The video service is unavailable. Please try again later.", 503)


def _canon(tag, values):
    parts = [tag]
    for value in values:
        text = "" if value is None else str(value)
        if "|" in text:
            raise ValueError("signed fields must not contain '|'")
        parts.append(text)
    return "|".join(parts)


def _hmac(secret, message):
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def sign_grant(secret, op_id, owner, project_id, op_type, target, quote_id, credits, storyboard_rev, plan, exp):
    """grant.v1|op_id|owner|project_id|type|target|quote_id|credits|storyboard_rev|plan|exp (section 13.2)."""
    return _hmac(secret, _canon("grant.v1", (op_id, owner, project_id, op_type, target, quote_id, credits, storyboard_rev, plan, exp)))


def sign_quote(secret, quote_id, owner, project_id, op_type, target, credits, storyboard_rev, exp):
    """quote.v1|quote_id|owner|project_id|type|target|credits|storyboard_rev|exp (section 13.2)."""
    return _hmac(secret, _canon("quote.v1", (quote_id, owner, project_id, op_type, target, credits, storyboard_rev, exp)))


def _int(value, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError
    return value


def _target(value):
    """None, or a non-empty string matching TARGET (an int shot index becomes its decimal string)."""
    if value is None or value == "":
        return None
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str) or not TARGET.fullmatch(value):
        fail("studio_invalid_input", "Check the step and its target.")
    return value


def _invalid(detail="Check the details and try again."):
    fail("studio_invalid_input", detail)


def _title(value):
    """A project title: trimmed, 1 to TITLE_MAX characters, no control characters."""
    title = value.strip() if isinstance(value, str) else ""
    if not 1 <= len(title) <= TITLE_MAX or CONTROL.search(title):
        _invalid("Enter a title of 1 to 120 characters.")
    return title


def taipei_day_start(now):
    """The UTC epoch second at which the Asia/Taipei day containing `now` began."""
    return (now + TAIPEI_OFFSET_S) // 86400 * 86400 - TAIPEI_OFFSET_S


def _month_bounds(month):
    start = datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return int(start.timestamp()), int(end.timestamp())


def _url_exp(url):
    try:
        return int(parse_qs(urlsplit(url).query).get("exp", [""])[0])
    except (TypeError, ValueError):
        return None


class Studio:
    def __init__(self, ctx, agent):
        self.store = ctx.store
        self.settings = ctx.settings
        self.current_user = ctx.current_user
        self.agent = agent
        # Tests adjust these; production uses the spec's values.
        self.clock = time.time
        self.max_active_per_user = MAX_ACTIVE_PER_USER
        self.limits = dict(LIMITS)
        self.orphan_s = ORPHAN_S
        self.drafts_per_day = ctx.settings.studio_drafts_per_day
        self.last_purge = 0

    @property
    def internal_voices(self):
        return tuple(self.settings.studio_internal_voices)

    @property
    def sweeper_enabled(self):
        return bool(self.settings.studio_sweeper and self.agent.configured)

    def now(self):
        return int(self.clock())

    def require(self, user):
        """The guard on every customer /studio/* route, after sign-in: the agent is connected, and in demo
        mode (PC_STUDIO_ALLOWED_EMAILS) the user is listed or an admin. The UI shows both as 「尚未開放」."""
        if not self.agent.configured:
            fail("studio_unconfigured", "The video studio is not connected yet.", 503)
        if not self.settings.studio_allows(user):
            fail("studio_not_open", "The video studio is not open for this account yet.", 403)

    async def call(self, name, *args):
        """An agent call in the threadpool (the client is synchronous); errors become portal errors."""
        try:
            return await run_in_threadpool(getattr(self.agent, name), *args)
        except AgentError as error:
            agent_fail(error)

    # -- rate limits (section 8): checked and reserved in one transaction, before any await ----

    def _consume(self, con, user_id, bucket):
        limit, window = self.limits[bucket]
        now = self.now()
        self._hit(con, user_id, bucket, now - now % window, limit, "studio_rate_limited", "Too many requests. Please wait a moment and try again.")

    def _consume_draft(self, con, user_id):
        """One free draft from today's (Asia/Taipei) allowance; 429 studio_draft_limit when it is used up."""
        self._hit(con, user_id, "draft", taipei_day_start(self.now()), self.drafts_per_day, "studio_draft_limit",
                  "Today's storyboard limit has been reached. Try again tomorrow.")

    def consume_draft(self, user_id):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            self._consume_draft(con, user_id)

    def drafts_json(self, user_id):
        start = taipei_day_start(self.now())
        with self.store.connect() as con:
            row = con.execute("SELECT hits FROM studio_rate WHERE user_id=? AND bucket='draft' AND window_start=?", (user_id, start)).fetchone()
        used = row["hits"] if row else 0
        return {"limit": self.drafts_per_day, "used": used, "remaining": max(0, self.drafts_per_day - used), "resets_at": start + 86400}

    @staticmethod
    def _hit(con, user_id, bucket, start, limit, code, detail):
        con.execute("DELETE FROM studio_rate WHERE user_id=? AND bucket=? AND window_start<?", (user_id, bucket, start))
        row = con.execute("SELECT hits FROM studio_rate WHERE user_id=? AND bucket=? AND window_start=?", (user_id, bucket, start)).fetchone()
        if (row["hits"] if row else 0) >= limit:
            fail(code, detail, 429)
        if row:
            con.execute("UPDATE studio_rate SET hits=hits+1 WHERE user_id=? AND bucket=? AND window_start=?", (user_id, bucket, start))
        else:
            con.execute("INSERT INTO studio_rate (user_id,bucket,window_start,hits) VALUES (?,?,?,1)", (user_id, bucket, start))

    def consume(self, user_id, bucket):
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            self._consume(con, user_id, bucket)

    # -- ownership -----------------------------------------------------------------------------

    @staticmethod
    def _project(con, user_id, project_id):
        if not isinstance(project_id, str) or not ID.fullmatch(project_id):
            fail("studio_not_found", PASS_THROUGH["studio_not_found"][1], 404)
        row = con.execute("SELECT * FROM studio_projects WHERE id=? AND user_id=? AND deleted_at IS NULL", (project_id, user_id)).fetchone()
        if not row:
            fail("studio_not_found", PASS_THROUGH["studio_not_found"][1], 404)
        return row

    def owned_project(self, user_id, project_id):
        with self.store.connect() as con:
            return dict(self._project(con, user_id, project_id))

    def active_op(self, project_id):
        with self.store.connect() as con:
            row = con.execute("SELECT * FROM studio_ops WHERE project_id=? AND state IN (?,?,?)", (project_id, *ACTIVE)).fetchone()
            return dict(row) if row else None

    def op(self, op_id):
        with self.store.connect() as con:
            row = con.execute("SELECT * FROM studio_ops WHERE op_id=?", (op_id,)).fetchone()
            return dict(row) if row else None

    def find_op(self, user_id, idempotency_key):
        with self.store.connect() as con:
            row = con.execute("SELECT * FROM studio_ops WHERE user_id=? AND idempotency_key=?", (user_id, idempotency_key)).fetchone()
            return dict(row) if row else None

    def claim_project(self, user_id, project_id, template_id):
        """Record the portal-side project (rate-limited) before the agent creates it. Idempotent."""
        now = self.now()
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT user_id, deleted_at FROM studio_projects WHERE id=?", (project_id,)).fetchone()
            if row:
                if row["user_id"] != user_id or row["deleted_at"] is not None:
                    fail("studio_conflict", PASS_THROUGH["studio_conflict"][1], 409)
                return
            self._consume(con, user_id, "project")
            self._consume_draft(con, user_id)  # every new project starts with its (free) draft
            con.execute("INSERT INTO studio_projects (id,user_id,template_id,title,status,thumb_url,thumb_exp,created_at,updated_at,deleted_at) VALUES (?,?,?,NULL,NULL,NULL,NULL,?,?,NULL)",
                        (project_id, user_id, template_id, now, now))

    def _trashable(self, con, user_id, project_id):
        """The user's project, live or deleted less than TRASH_S ago; 404 otherwise."""
        if not isinstance(project_id, str) or not ID.fullmatch(project_id):
            fail("studio_not_found", PASS_THROUGH["studio_not_found"][1], 404)
        row = con.execute("SELECT * FROM studio_projects WHERE id=? AND user_id=? AND (deleted_at IS NULL OR deleted_at>?)",
                          (project_id, user_id, self.now() - TRASH_S)).fetchone()
        if not row:
            fail("studio_not_found", PASS_THROUGH["studio_not_found"][1], 404)
        return row

    def delete_project(self, user_id, project_id):
        """Soft delete; idempotent. 409 studio_busy while an op is active (checked under the write lock,
        so it cannot interleave with reserve). No ledger row: credits already used are not refunded."""
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._trashable(con, user_id, project_id)
            deleted_at = row["deleted_at"]
            if deleted_at is None:
                if con.execute("SELECT 1 FROM studio_ops WHERE project_id=? AND state IN (?,?,?)", (project_id, *ACTIVE)).fetchone():
                    fail("studio_busy", "This project is busy. Wait for the current step to finish before deleting it.", 409)
                deleted_at = self.now()
                con.execute("UPDATE studio_projects SET deleted_at=? WHERE id=? AND deleted_at IS NULL", (deleted_at, project_id))
        return {"id": project_id, "deleted_at": deleted_at, "restore_until": deleted_at + TRASH_S}

    def restore_project(self, user_id, project_id):
        """Undo a delete within TRASH_S; idempotent for a live project."""
        with self.store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._trashable(con, user_id, project_id)
            if row["deleted_at"] is not None:
                con.execute("UPDATE studio_projects SET deleted_at=NULL WHERE id=?", (project_id,))
        return {"id": project_id, "deleted_at": None, "restore_until": None}

    def set_title(self, project_id, title):
        with self.store.connect() as con:
            con.execute("UPDATE studio_projects SET title=? WHERE id=?", (title, project_id))

    def drop_unused_project(self, user_id, project_id):
        with self.store.connect() as con:
            con.execute("DELETE FROM studio_projects WHERE id=? AND user_id=? AND NOT EXISTS (SELECT 1 FROM studio_ops WHERE project_id=?)", (project_id, user_id, project_id))

    def cache_project(self, project_id, doc):
        """Keep the list view's fields from the agent's project document."""
        thumb = None
        for shot in doc.get("shots") or []:
            if isinstance(shot, dict) and isinstance(shot.get("thumb_url"), str):
                thumb = shot["thumb_url"]
                break
        title = doc.get("title") if isinstance(doc.get("title"), str) else None
        status = doc.get("status") if isinstance(doc.get("status"), str) else None
        updated = doc.get("updated_at")
        updated = int(updated) if isinstance(updated, (int, float)) and not isinstance(updated, bool) else self.now()
        expired = 1 if doc.get("expired") is True else 0  # retention deleted its media (re-rendering is charged)
        with self.store.connect() as con:
            con.execute("UPDATE studio_projects SET title=?, status=?, thumb_url=?, thumb_exp=?, updated_at=?, expired=? WHERE id=?",
                        (title[:200] if title else None, status, thumb, _url_exp(thumb) if thumb else None, updated, expired, project_id))

    # -- quotes and the reserve primitive --------------------------------------------------------

    def verify_quote(self, user_id, project_id, body):
        """Check a quote the client sends back, against the session user and the path's project.
        Raises 400 studio_invalid_input when anything was changed, 409 studio_stale_quote when expired."""
        try:
            quote_id = body.get("quote_id")
            if not isinstance(quote_id, str) or not ID.fullmatch(quote_id):
                raise ValueError
            op_type = body.get("type")
            if not isinstance(op_type, str) or not OP_TYPE.fullmatch(op_type):
                raise ValueError
            credits = _int(body.get("credits"), 0, GRANT_MAX)
            storyboard_rev = _int(body.get("storyboard_rev"), 0, INT4_MAX)
            exp = _int(body.get("exp"), 0, INT4_MAX)
            sig = body.get("sig")
            if not isinstance(sig, str) or not SIG.fullmatch(sig):
                raise ValueError
        except ValueError:
            fail("studio_invalid_input", "The quote does not match. Get a new quote.")
        target = _target(body.get("target"))
        expected = sign_quote(self.settings.studio_quote_secret, quote_id, user_id, project_id, op_type, target, credits, storyboard_rev, exp)
        if not hmac.compare_digest(expected, sig):
            fail("studio_invalid_input", "The quote does not match. Get a new quote.")
        if exp < self.now():
            fail("studio_stale_quote", PASS_THROUGH["studio_stale_quote"][1], 409)
        return {"quote_id": quote_id, "type": op_type, "target": target, "credits": credits,
                "storyboard_rev": storyboard_rev, "exp": exp, "sig": sig}

    def reserve(self, user_id, project_id, quote, idempotency_key):
        """Reserve the quote's credits for a new op. Returns (op row, created).

        One transaction, no network call: idempotency replay, disabled account, project ownership,
        one active op per project (also the partial unique index), the per-user active-op limit, and
        a conditional balance UPDATE (402 when short)."""
        now = self.now()
        op_id = uuid.uuid4().hex
        credits = quote["credits"]
        try:
            with self.store.connect() as con:
                con.execute("BEGIN IMMEDIATE")
                existing = con.execute("SELECT * FROM studio_ops WHERE user_id=? AND idempotency_key=?", (user_id, idempotency_key)).fetchone()
                if existing:
                    return dict(existing), False
                me = con.execute("SELECT disabled_at FROM users WHERE id=?", (user_id,)).fetchone()
                if not me or me["disabled_at"] is not None:
                    fail("account_disabled", "This account is disabled.", 403)
                self._project(con, user_id, project_id)
                if con.execute("SELECT 1 FROM studio_ops WHERE quote_id=?", (quote["quote_id"],)).fetchone():
                    fail("studio_stale_quote", PASS_THROUGH["studio_stale_quote"][1], 409)
                if con.execute("SELECT 1 FROM studio_ops WHERE project_id=? AND state IN (?,?,?)", (project_id, *ACTIVE)).fetchone():
                    fail("studio_busy", PASS_THROUGH["studio_busy"][1], 409)
                if self.max_active_per_user is not None:
                    count = con.execute("SELECT COUNT(*) FROM studio_ops WHERE user_id=? AND state IN (?,?,?)", (user_id, *ACTIVE)).fetchone()[0]
                    if count >= self.max_active_per_user:
                        fail("studio_busy", "Two steps are already running. Wait for one to finish.", 409)
                con.execute("INSERT INTO studio_accounts (user_id,balance,reserved,plan,period_end,updated_at) VALUES (?,0,0,NULL,NULL,?) ON CONFLICT(user_id) DO NOTHING", (user_id, now))
                taken = con.execute("UPDATE studio_accounts SET balance=balance-?, reserved=reserved+?, updated_at=? WHERE user_id=? AND balance>=?",
                                    (credits, credits, now, user_id, credits))
                if taken.rowcount != 1:
                    fail("studio_insufficient_credits", "Not enough credits for this step.", 402)
                plan = con.execute("SELECT plan FROM studio_accounts WHERE user_id=?", (user_id,)).fetchone()["plan"]
                con.execute("INSERT INTO studio_ops (op_id,user_id,project_id,type,target,credits,state,credits_charged,quote_id,idempotency_key,storyboard_rev,plan,grant_exp,error,created_at,updated_at) "
                            "VALUES (?,?,?,?,?,?,'reserved',NULL,?,?,?,?,?,NULL,?,?)",
                            (op_id, user_id, project_id, quote["type"], quote["target"], credits, quote["quote_id"], idempotency_key,
                             quote["storyboard_rev"], plan if plan in PLANS else DEFAULT_PLAN, now + GRANT_TTL_S, now, now))
                con.execute("INSERT INTO studio_ledger (user_id,op_id,kind,delta,note,created_at) VALUES (?,?,'reserve',?,?,?)",
                            (user_id, op_id, -credits, quote["type"], now))
                return dict(con.execute("SELECT * FROM studio_ops WHERE op_id=?", (op_id,)).fetchone()), True
        except self.store.IntegrityError:
            # A concurrent request won: same idempotency key, same quote, or the project's active-op index.
            existing = self.find_op(user_id, idempotency_key)
            if existing:
                return existing, False
            with self.store.connect() as con:
                used = con.execute("SELECT 1 FROM studio_ops WHERE quote_id=?", (quote["quote_id"],)).fetchone()
            if used:
                fail("studio_stale_quote", PASS_THROUGH["studio_stale_quote"][1], 409)
            fail("studio_busy", PASS_THROUGH["studio_busy"][1], 409)

    def grant(self, op):
        """The grant for a stored op row (owner and project come from the row, i.e. the session and the path)."""
        sig = sign_grant(self.settings.studio_grant_secret, op["op_id"], op["user_id"], op["project_id"], op["type"], op["target"],
                         op["quote_id"], op["credits"], op["storyboard_rev"], op["plan"], op["grant_exp"])
        return {"plan": op["plan"], "exp": op["grant_exp"], "sig": sig}

    # -- the op state machine ----------------------------------------------------------------------

    def move(self, op_id, to_state, from_states):
        """reserved -> submitted | unknown. Conditional; True when this call made the change."""
        marks = ",".join("?" * len(from_states))
        with self.store.connect() as con:
            cur = con.execute("UPDATE studio_ops SET state=?, updated_at=? WHERE op_id=? AND state IN (" + marks + ")",
                              (to_state, self.now(), op_id, *from_states))
            return cur.rowcount == 1

    def finish(self, op_id, charged, succeeded=False, error=None, from_states=ACTIVE):
        """Settle or refund an op from an active state, with its ledger rows, in one transaction.
        Returns True when this call made the transition (rowcount == 1), False when another did."""
        now = self.now()
        marks = ",".join("?" * len(from_states))
        with self.store.connect() as con:
            row = con.execute("SELECT * FROM studio_ops WHERE op_id=?", (op_id,)).fetchone()
            if not row:
                return False
            credits = row["credits"]
            charged = max(0, min(int(charged), credits))
            if succeeded:
                charged, state = credits, "settled"
            else:
                state = "refunded" if charged == 0 else "settled" if charged == credits else "settled_partial"
            cur = con.execute("UPDATE studio_ops SET state=?, credits_charged=?, error=?, updated_at=? WHERE op_id=? AND state IN (" + marks + ")",
                              (state, charged, error, now, op_id, *from_states))
            if cur.rowcount != 1:
                return False
            refund = credits - charged
            con.execute("UPDATE studio_accounts SET reserved=reserved-?, balance=balance+?, updated_at=? WHERE user_id=?",
                        (credits, refund, now, row["user_id"]))
            if state != "refunded":
                con.execute("INSERT INTO studio_ledger (user_id,op_id,kind,delta,note,created_at) VALUES (?,?,'settle',0,?,?)",
                            (row["user_id"], op_id, "charged " + str(charged), now))
            if refund:
                con.execute("INSERT INTO studio_ledger (user_id,op_id,kind,delta,note,created_at) VALUES (?,?,'refund',?,?,?)",
                            (row["user_id"], op_id, refund, error, now))
            # The list view refetches this project's status from the agent.
            con.execute("UPDATE studio_projects SET status=NULL WHERE id=?", (row["project_id"],))
            return True

    def apply(self, op, doc):
        """Apply the agent's op result (GET or POST ops) to the portal op."""
        state = doc.get("state") if isinstance(doc, dict) else None
        if state in ("queued", "running"):
            self.move(op["op_id"], "submitted", ("reserved", "unknown"))
        elif state == "succeeded":
            self.finish(op["op_id"], op["credits"], succeeded=True)
        elif state == "failed":
            produced = doc.get("produced_credits")
            produced = produced if isinstance(produced, int) and not isinstance(produced, bool) else 0
            error = doc.get("error")
            code = error.get("code") if isinstance(error, dict) else None
            self.finish(op["op_id"], produced, error=code if isinstance(code, str) and ERROR_CODE.fullmatch(code) else "op_failed")

    def reconcile(self, op):
        """Resolve one active op through the agent's GET op. Never raises; returns the agent doc or None."""
        age = self.now() - (op["created_at"] or 0)  # measured before the call, so a slow GET cannot age it
        try:
            doc = self.agent.get_op(op["user_id"], op["project_id"], op["op_id"])
        except AgentError as error:
            # Only the agent's own "not found" counts; a bare 404 (a misrouted URL, a moved route) proves nothing.
            if error.kind == "rejected" and error.status == 404 and error.code == "studio_not_found":
                if op["state"] in ("reserved", "unknown") and age >= self.orphan_s:
                    # The grant expired 60 s after creation, so the agent can no longer accept this op.
                    self.finish(op["op_id"], 0, error="not_submitted", from_states=("reserved", "unknown"))
                elif op["state"] == "submitted" and age >= LOST_S:
                    log.error("studio op %s: submitted but unknown to the agent for %s s; refunded", op["op_id"], age)
                    self.finish(op["op_id"], 0, error="lost_by_agent", from_states=("submitted",))
                elif op["state"] == "submitted":
                    log.warning("studio op %s is submitted but unknown to the agent", op["op_id"])
            elif error.kind == "rejected":
                log.warning("studio op %s: unexpected agent answer %s %s", op["op_id"], error.status, error.code)
            return None
        except Exception:  # noqa: BLE001 - the sweeper and lazy reconcile must keep going
            log.exception("studio op %s: reconcile failed", op["op_id"])
            return None
        try:
            self.apply(op, doc)
        except Exception:  # noqa: BLE001
            log.exception("studio op %s: applying the agent result failed", op["op_id"])
        return doc

    def submit(self, op, quote):
        """Submit a freshly reserved op (sync; called in the threadpool). Returns {op_id, state}."""
        body = {"op_id": op["op_id"], "type": op["type"], "target": op["target"],
                "quote": {"quote_id": quote["quote_id"], "credits": quote["credits"], "storyboard_rev": quote["storyboard_rev"],
                          "exp": quote["exp"], "sig": quote["sig"]},
                "grant": self.grant(op)}
        try:
            doc = self.agent.submit_op(op["user_id"], op["project_id"], body)
        except AgentError as error:
            if error.kind in ("rejected", "unconfigured"):
                # Section 12.5: any 4xx means the agent created no op; refund now.
                self.finish(op["op_id"], 0, error=error.code if error.code and ERROR_CODE.fullmatch(error.code) else "rejected", from_states=("reserved",))
                raise
            # Timeout, 5xx or garbage: the agent may have accepted it. The sweeper resolves it by GET.
            self.move(op["op_id"], "unknown", ("reserved",))
            return {"op_id": op["op_id"], "state": self.op(op["op_id"])["state"]}
        self.apply(op, doc)
        return {"op_id": op["op_id"], "state": self.op(op["op_id"])["state"]}

    async def submit_async(self, op, quote):
        try:
            return await run_in_threadpool(self.submit, op, quote)
        except AgentError as error:
            agent_fail(error)

    # -- sweeper -----------------------------------------------------------------------------------

    def sweep(self, limit=200, stop=None):
        """Resolve every active op through the agent (reserved too: the portal may have crashed
        after the agent accepted). Returns the number of ops looked at. `stop` (an asyncio.Event,
        only read here) ends the pass early so shutdown does not wait for every agent call."""
        with self.store.connect() as con:
            ops = [dict(r) for r in con.execute("SELECT * FROM studio_ops WHERE state IN (?,?,?) ORDER BY updated_at LIMIT ?", (*ACTIVE, limit)).fetchall()]
            con.execute("DELETE FROM studio_rate WHERE window_start<?", (self.now() - 86400,))
        for op in ops:
            if stop is not None and stop.is_set():
                break
            self.reconcile(op)
        if self.now() - self.last_purge >= PURGE_EVERY_S and not (stop is not None and stop.is_set()):
            self.last_purge = self.now()
            try:
                self.purge()
            except Exception:  # noqa: BLE001 - the settlement sweep must keep going
                log.exception("studio purge failed")
        return len(ops)

    def purge(self, limit=PURGE_BATCH):
        """Ask the agent to drop projects deleted TRASH_S ago or more, then mark them purged (hidden for good;
        they already are, by the 30-day rule). The agent's own 404 means already gone. Returns the number marked."""
        if not self.agent.configured:
            return 0
        cutoff = self.now() - TRASH_S
        with self.store.connect() as con:
            due = [dict(r) for r in con.execute(
                "SELECT id, user_id FROM studio_projects WHERE deleted_at IS NOT NULL AND deleted_at<=? AND (status IS NULL OR status<>?) "
                "ORDER BY deleted_at LIMIT ?", (cutoff, PURGED, limit)).fetchall()]
        done = 0
        for row in due:
            try:
                self.agent.purge_project(row["user_id"], row["id"])
            except AgentError as error:
                # 409 studio_busy: the owner has an active op somewhere; like any other failure, retried on a later pass.
                if not (error.kind == "rejected" and error.status == 404 and error.code == "studio_not_found"):
                    log.warning("studio purge of %s failed (%s %s %s); retried later", row["id"], error.kind, error.status, error.code)
                    continue
            except Exception:  # noqa: BLE001
                log.exception("studio purge of %s failed", row["id"])
                continue
            with self.store.connect() as con:
                done += con.execute("UPDATE studio_projects SET status=?, thumb_url=NULL, thumb_exp=NULL WHERE id=? AND deleted_at IS NOT NULL AND deleted_at<=?",
                                    (PURGED, row["id"], cutoff)).rowcount
        return done

    async def serve(self, stop):
        interval = self.settings.studio_sweep_interval
        while not stop.is_set():
            try:
                await run_in_threadpool(self.sweep, 200, stop)
            except Exception:  # noqa: BLE001 - a database hiccup must not end the loop
                log.exception("studio sweep failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass

    # -- upload rights (product and lifestyle photos) ---------------------------------------------

    def declare_upload(self, user_id, upload_id, purpose, content_type, size, project_id):
        """The rights checkbox, as sent with the ticket: kept as an audit row until the upload is first used."""
        if not isinstance(upload_id, str) or not upload_id:
            return
        with self.store.connect() as con:
            self.store.audit(con, "studio.upload_declared", user_id, upload_id,
                             {"purpose": purpose, "content_type": content_type, "bytes": size, "project_id": project_id,
                              "rights_confirmed": True, "at": self.now()})

    def _upload_sha256(self, user_id, upload_id):
        try:
            doc = self.agent.get_upload(user_id, upload_id)
        except AgentError as error:
            # An agent without GET /internal/v1/uploads/{id} (before v10): the record is written without the hash.
            log.info("studio: no sha256 for upload %s (%s %s %s)", upload_id, error.kind, error.status, error.code)
            return None
        value = doc.get("sha256") if isinstance(doc, dict) else None
        return value if isinstance(value, str) and SIG.fullmatch(value) else None

    def confirm_rights(self, user_id, upload_ids, project_id, via):
        """On an upload's first reference (project create with image_ids or lifestyle_ids, a shot edit with
        image_upload_id), after the agent accepted it: write studio.upload_rights_confirmed once per upload, with the
        declared ticket and the file's sha256."""
        for upload_id in dict.fromkeys(u for u in upload_ids if isinstance(u, str) and u):
            with self.store.connect() as con:
                if con.execute("SELECT 1 FROM audit_events WHERE action='studio.upload_rights_confirmed' AND target_id=?", (upload_id,)).fetchone():
                    continue
                declared = con.execute("SELECT details FROM audit_events WHERE action='studio.upload_declared' AND actor_id=? AND target_id=? "
                                       "ORDER BY created_at DESC LIMIT 1", (user_id, upload_id)).fetchone()
            if not declared:
                log.warning("studio: upload %s was used without a rights declaration (ticketed before the checkbox?)", upload_id)
                continue
            ticket = json.loads(declared["details"])
            sha256 = self._upload_sha256(user_id, upload_id)
            with self.store.connect() as con:
                con.execute("BEGIN IMMEDIATE")
                if con.execute("SELECT 1 FROM audit_events WHERE action='studio.upload_rights_confirmed' AND target_id=?", (upload_id,)).fetchone():
                    continue
                self.store.audit(con, "studio.upload_rights_confirmed", user_id, upload_id,
                                 {"upload_id": upload_id, "purpose": ticket.get("purpose"), "content_type": ticket.get("content_type"),
                                  "bytes": ticket.get("bytes"), "sha256": sha256, "declared_at": ticket.get("at"),
                                  "confirmed_at": self.now(), "project_id": project_id, "via": via})

    # -- JSON shapes ------------------------------------------------------------------------------

    @staticmethod
    def op_json(op, doc=None):
        terminal = op["state"] in TERMINAL
        result = {"op_id": op["op_id"], "project_id": op["project_id"], "type": op["type"], "target": op["target"],
                  "state": op["state"], "credits": op["credits"],
                  "credits_charged": op["credits_charged"] if terminal else None,
                  "credits_refunded": op["credits"] - (op["credits_charged"] or 0) if terminal else None,
                  "error": {"code": op["error"]} if op["error"] else None,
                  "queue_position": None, "created_at": op["created_at"], "updated_at": op["updated_at"]}
        if doc and not terminal and isinstance(doc.get("queue_position"), int) and not isinstance(doc.get("queue_position"), bool):
            result["queue_position"] = doc["queue_position"]
        return result

    def credits_json(self, user_id):
        with self.store.connect() as con:
            account = con.execute("SELECT * FROM studio_accounts WHERE user_id=?", (user_id,)).fetchone()
            recent = con.execute("SELECT id, op_id, kind, delta, note, created_at FROM studio_ledger WHERE user_id=? ORDER BY id DESC LIMIT 50", (user_id,)).fetchall()
        return {"balance": account["balance"] if account else 0, "reserved": account["reserved"] if account else 0,
                "plan": account["plan"] if account else None, "period_end": account["period_end"] if account else None,
                "recent": [dict(r) for r in recent], "drafts": self.drafts_json(user_id)}

    def refresh_projects(self, user_id, project_ids):
        """Refetch documents for the list view, a few at a time; failures keep the cached values."""
        def one(project_id):
            try:
                self.cache_project(project_id, self.agent.get_project(user_id, project_id))
            except AgentError:
                pass
            except Exception:  # noqa: BLE001
                log.exception("studio project %s: refresh failed", project_id)
        with ThreadPoolExecutor(max_workers=REFRESH_WORKERS) as pool:
            list(pool.map(one, project_ids))


def _idempotency(body):
    key = body.get("idempotency_key")
    if not isinstance(key, str) or not IDEMPOTENCY.fullmatch(key):
        _invalid("Send an idempotency_key of 8 to 64 letters, digits, - or _.")
    return key


def attach_studio(application, ctx, agent=None):
    studio = Studio(ctx, agent if agent is not None else StudioAgent(ctx.settings))
    application.state.studio = studio
    current_user = ctx.current_user
    store = ctx.store
    S = PREFIX + "/studio"

    @application.get(S + "/templates")
    async def studio_templates(request: Request):
        user = current_user(request)
        studio.require(user)
        data = await studio.call("templates", user["id"])
        items = data.get("items")
        if not isinstance(items, list):
            agent_fail(AgentError("invalid_response"))
        keys = ("id", "version", "title", "input_schema", "shot_schema", "project_schema", "aspects", "ops", "prices")
        return {"items": [_mark_internal_voices({k: t.get(k) for k in keys}, studio.internal_voices) for t in items if isinstance(t, dict)],
                "media_origin": studio.settings.studio_media_origin or None}

    @application.get(S + "/projects")
    async def studio_projects(request: Request):
        user = current_user(request)
        studio.require(user)
        raw_limit = request.query_params.get("limit")
        if raw_limit is None:
            limit = LIST_DEFAULT
        elif re.fullmatch(r"[1-9][0-9]?", raw_limit) and int(raw_limit) <= LIST_MAX:
            limit = int(raw_limit)
        else:
            _invalid("Choose a limit from 1 to 50.")
        deleted = request.query_params.get("deleted")
        if deleted is not None and deleted != "1":
            _invalid("Use deleted=1 for the trash.")
        trash = deleted == "1"
        now = studio.now()
        # A project with no op at all is a create that failed (or crashed) before reserving its draft:
        # nothing was charged and nothing was drafted, so it is not listed. Draft failures have an op and stay.
        sql = ("SELECT * FROM studio_projects WHERE user_id=? AND " + ("deleted_at IS NOT NULL AND deleted_at>?" if trash else "deleted_at IS NULL") +
               " AND EXISTS (SELECT 1 FROM studio_ops o WHERE o.project_id=studio_projects.id)")
        params = [user["id"], now - TRASH_S] if trash else [user["id"]]
        cursor = request.query_params.get("cursor")
        if cursor is not None:
            match = CURSOR.fullmatch(cursor)
            if not match:
                _invalid("Reload the project list.")
            sql += " AND (created_at<? OR (created_at=? AND id<?))"
            params += [int(match.group(1)), int(match.group(1)), match.group(2)]
        with store.connect() as con:
            rows = [dict(r) for r in con.execute(sql + " ORDER BY created_at DESC, id DESC LIMIT ?", (*params, limit + 1)).fetchall()]
        following = None
        if len(rows) > limit:
            rows = rows[:limit]
            following = str(rows[-1]["created_at"]) + "_" + rows[-1]["id"]
        # The trash shows the cached values only: no agent call for a project the user threw away.
        stale = [] if trash else [r["id"] for r in rows if r["status"] is None or r["status"] in ("drafting", "rendering")
                 or (r["thumb_url"] and (r["thumb_exp"] or 0) < now + THUMB_MARGIN_S)]
        if stale:
            await run_in_threadpool(studio.refresh_projects, user["id"], stale)
            with store.connect() as con:
                fresh = {r["id"]: dict(r) for r in con.execute(
                    "SELECT * FROM studio_projects WHERE id IN (" + ",".join("?" * len(stale)) + ")", tuple(stale)).fetchall()}
            rows = [fresh.get(r["id"], r) for r in rows]
        active = {}
        if rows:
            with store.connect() as con:
                active = {r["project_id"]: r["type"] for r in con.execute(
                    "SELECT project_id, type FROM studio_ops WHERE state IN (?,?,?) AND project_id IN (" + ",".join("?" * len(rows)) + ")",
                    (*ACTIVE, *[r["id"] for r in rows])).fetchall()}
        items = []
        for r in rows:
            status = r["status"]
            if r["id"] in active:
                status = "drafting" if active[r["id"]] == "draft" else "rendering"
            item = {"id": r["id"], "title": r["title"], "template_id": r["template_id"], "status": status or "empty",
                    "thumb_url": r["thumb_url"] if r["thumb_url"] and (r["thumb_exp"] or 0) > now else None,
                    "updated_at": r["updated_at"], "expired": bool(r["expired"])}
            if trash:
                item.update(deleted_at=r["deleted_at"], restore_until=r["deleted_at"] + TRASH_S)
            items.append(item)
        return {"items": items, "next": following}

    @application.post(S + "/projects")
    async def studio_create_project(request: Request):
        user = current_user(request)
        studio.require(user)
        body = await body_json(request)
        key = _idempotency(body)
        template_id, aspect, inputs = body.get("template_id"), body.get("aspect"), body.get("inputs")
        if not isinstance(template_id, str) or not TEMPLATE.fullmatch(template_id) or not isinstance(aspect, str) or not ASPECT.fullmatch(aspect) or not isinstance(inputs, dict):
            _invalid("Choose a template and an aspect, and fill in the form.")
        existing = studio.find_op(user["id"], key)
        if existing:
            return JSONResponse({"id": existing["project_id"], "op_id": existing["op_id"], "status": "drafting" if existing["state"] in ACTIVE else None,
                                 "state": existing["state"]}, status_code=200)
        # Derived from the key, so a retry after a failure (402, timeout) reuses the same agent project
        # and its attached input images instead of orphaning them.
        project_id = "p" + hashlib.sha256((user["id"] + "\n" + key).encode("utf-8")).hexdigest()[:31]
        studio.claim_project(user["id"], project_id, template_id)  # rate limit: checked and reserved before any await
        try:
            await run_in_threadpool(studio.agent.create_project, user["id"],
                                    {"project_id": project_id, "template_id": template_id, "inputs": inputs, "aspect": aspect})
        except AgentError as error:
            if error.kind == "rejected":
                studio.drop_unused_project(user["id"], project_id)
            agent_fail(error)
        rights_ids = [u for key in ("image_ids", "lifestyle_ids") if isinstance(inputs.get(key), list) for u in inputs[key]]
        if rights_ids:
            await run_in_threadpool(studio.confirm_rights, user["id"], rights_ids, project_id, "project_create")
        try:
            raw = await studio.call("quote", user["id"], project_id, {"type": "draft"})
            try:
                quote = studio.verify_quote(user["id"], project_id, raw)
            except Exception:  # noqa: BLE001 - the agent's own quote failing our check = mismatched secrets
                log.error("studio: the agent's draft quote failed verification (check SHORTVIDEO_QUOTE_SECRET)")
                agent_fail(AgentError("invalid_response"))
            op, created = studio.reserve(user["id"], project_id, quote, key)
        except PortalError:
            # Nothing was reserved (402, busy, disabled, a refused quote): leave no portal project behind.
            # The agent keeps its project and attached images; retrying with the same key reuses them.
            studio.drop_unused_project(user["id"], project_id)
            raise
        result = await studio.submit_async(op, quote) if created else {"op_id": op["op_id"], "state": op["state"]}
        return JSONResponse({"id": project_id, "op_id": result["op_id"], "status": "drafting", "state": result["state"]}, status_code=201)

    @application.post(S + "/uploads")
    async def studio_upload(request: Request):
        user = current_user(request)
        studio.require(user)
        body = await body_json(request)
        purpose, content_type, size, project_id = body.get("purpose"), body.get("content_type"), body.get("bytes"), body.get("project_id")
        if purpose not in UPLOAD_PURPOSES or not isinstance(content_type, str) or not CONTENT_TYPE.fullmatch(content_type):
            _invalid("Choose a file to upload.")
        if isinstance(size, bool) or not isinstance(size, int) or size < 1:
            _invalid("Choose a file to upload.")
        if size > UPLOAD_MAX_BYTES:
            fail("studio_too_large", "The file is too large.", 413)
        if (purpose in PRE_PROJECT_PURPOSES) != (project_id is None):
            _invalid("Product images are uploaded before the project exists; other files need a project.")
        if purpose in RIGHTS_PURPOSES and body.get("rights_confirmed") is not True:
            fail("studio_rights_required", PASS_THROUGH["studio_rights_required"][1], 400)
        payload = {"purpose": purpose, "content_type": content_type, "bytes": size}
        if purpose in RIGHTS_PURPOSES:
            payload["rights_confirmed"] = True
        if project_id is not None:
            studio.owned_project(user["id"], project_id)
            payload["project_id"] = project_id
        studio.consume(user["id"], "upload")
        data = await studio.call("create_upload", user["id"], payload)
        if purpose in RIGHTS_PURPOSES:
            await run_in_threadpool(studio.declare_upload, user["id"], data.get("upload_id"), purpose, content_type, size, project_id)
        return JSONResponse({"upload_id": data.get("upload_id"), "put_url": data.get("put_url"), "expires_at": data.get("expires_at")}, status_code=201)

    @application.get(S + "/projects/{project_id}")
    async def studio_project(project_id: str, request: Request):
        user = current_user(request)
        studio.require(user)
        studio.owned_project(user["id"], project_id)
        active = studio.active_op(project_id)
        if active:
            await run_in_threadpool(studio.reconcile, active)
        doc = await studio.call("get_project", user["id"], project_id)
        await run_in_threadpool(studio.cache_project, project_id, doc)
        active = studio.active_op(project_id)
        if active and not doc.get("active_op"):
            # Reserved or unknown on the portal side: the UI keeps polling until it resolves.
            doc["active_op"] = {"op_id": active["op_id"], "type": active["type"], "state": active["state"]}
        return doc

    async def _edit(request, project_id, call, *args, body=None):
        user = current_user(request)
        studio.require(user)
        if body is None:
            body = await body_json(request)
        studio.owned_project(user["id"], project_id)
        if studio.active_op(project_id):
            fail("studio_busy", PASS_THROUGH["studio_busy"][1], 409)
        doc = await studio.call(call, user["id"], project_id, *args, body)
        await run_in_threadpool(studio.cache_project, project_id, doc)
        return doc

    @application.post(S + "/projects/{project_id}/settings")
    async def studio_settings(project_id: str, request: Request):
        user = current_user(request)
        studio.require(user)
        body = await body_json(request)
        if user["role"] != "admin" and body.get("voice") in studio.internal_voices:
            fail("studio_voice_not_allowed", "That voice is for internal tests only.", 403)
        title = None
        if "title" in body:
            # Rename: the portal keeps the title (the list reads it) and the agent gets it too (exports use it).
            title = _title(body["title"])
            body = dict(body, title=title)
        doc = await _edit(request, project_id, "edit_settings", body=body)
        if title is not None:
            await run_in_threadpool(studio.set_title, project_id, title)
            doc["title"] = title
        return doc

    @application.post(S + "/projects/{project_id}/shots/{index}/edit")
    async def studio_edit_shot(project_id: str, index: str, request: Request):
        if not SHOT_INDEX.fullmatch(index):
            studio.require(current_user(request))
            fail("studio_not_found", PASS_THROUGH["studio_not_found"][1], 404)
        body = await body_json(request)
        doc = await _edit(request, project_id, "edit_shot", int(index), body=body)
        if isinstance(body.get("image_upload_id"), str):
            user = current_user(request)
            await run_in_threadpool(studio.confirm_rights, user["id"], [body["image_upload_id"]], project_id, "shot_edit")
        return doc

    @application.post(S + "/projects/{project_id}/quote")
    async def studio_quote(project_id: str, request: Request):
        user = current_user(request)
        studio.require(user)
        body = await body_json(request)
        op_type = body.get("type")
        if not isinstance(op_type, str) or not OP_TYPE.fullmatch(op_type):
            _invalid("Choose a step.")
        target = _target(body.get("target"))
        studio.owned_project(user["id"], project_id)
        studio.consume(user["id"], "quote")
        if user["role"] != "admin" and op_type not in VOICELESS_OPS:
            # D-V4: no customer hears an internal voice. Today it is the agent's default, so a customer project
            # keeps it until a licensed voice exists; steps that may synthesise narration are refused.
            doc = await studio.call("get_project", user["id"], project_id)
            settings = doc.get("settings") if isinstance(doc, dict) else None
            if not isinstance(settings, dict) or settings.get("voice") in studio.internal_voices:
                fail("studio_no_licensed_voice", "No licensed voice is available yet, so narration cannot be generated.", 409)
        data = await studio.call("quote", user["id"], project_id, {"type": op_type, "target": target})
        return {k: data.get(k) for k in ("quote_id", "type", "target", "credits", "breakdown", "storyboard_rev", "exp", "sig")}

    @application.post(S + "/projects/{project_id}/ops")
    async def studio_submit(project_id: str, request: Request):
        user = current_user(request)
        studio.require(user)
        body = await body_json(request)
        key = _idempotency(body)
        existing = studio.find_op(user["id"], key)
        if existing:
            return {"op_id": existing["op_id"], "state": existing["state"]}
        studio.owned_project(user["id"], project_id)
        quote = studio.verify_quote(user["id"], project_id, body)
        if quote["type"] == "draft":
            studio.consume_draft(user["id"])  # a storyboard redo uses the same free daily allowance
        op, created = studio.reserve(user["id"], project_id, quote, key)
        if not created:
            return {"op_id": op["op_id"], "state": op["state"]}
        return JSONResponse(await studio.submit_async(op, quote), status_code=202)

    @application.get(S + "/projects/{project_id}/ops/{op_id}")
    async def studio_op(project_id: str, op_id: str, request: Request):
        user = current_user(request)
        studio.require(user)
        studio.owned_project(user["id"], project_id)
        op = studio.op(op_id) if ID.fullmatch(op_id) else None
        if not op or op["user_id"] != user["id"] or op["project_id"] != project_id:
            fail("studio_not_found", "Step not found.", 404)
        doc = None
        if op["state"] in ACTIVE:
            doc = await run_in_threadpool(studio.reconcile, op)
            op = studio.op(op_id)
        return studio.op_json(op, doc)

    @application.post(S + "/projects/{project_id}/delete")
    async def studio_delete(project_id: str, request: Request):
        user = current_user(request)
        studio.require(user)
        return await run_in_threadpool(studio.delete_project, user["id"], project_id)

    @application.post(S + "/projects/{project_id}/restore")
    async def studio_restore(project_id: str, request: Request):
        user = current_user(request)
        studio.require(user)
        return await run_in_threadpool(studio.restore_project, user["id"], project_id)

    @application.get(S + "/credits")
    async def studio_credits(request: Request):
        user = current_user(request)
        studio.require(user)
        return studio.credits_json(user["id"])

    # -- admin ---------------------------------------------------------------------------------------

    @application.post(PREFIX + "/admin/studio/credits/grant")
    async def studio_grant(request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        user_id, credits, plan, period_end = body.get("user_id"), body.get("credits"), body.get("plan"), body.get("period_end")
        try:
            if not isinstance(user_id, str) or not ID.fullmatch(user_id):
                raise ValueError
            _int(credits, -GRANT_MAX, GRANT_MAX)
            if credits == 0 or (plan is not None and plan not in PLANS):
                raise ValueError
            if period_end is not None:
                _int(period_end, 0, INT4_MAX)
        except ValueError:
            fail("invalid_input", "Enter an account, a non-zero whole number of credits up to 1,000,000 and a valid plan.")
        note = text_value(body.get("note") or "", "note", 200, required=False) or None
        request_key = body.get("idempotency_key")
        if request_key is not None and (not isinstance(request_key, str) or not IDEMPOTENCY.fullmatch(request_key)):
            fail("invalid_input", "Send an idempotency_key of 8 to 64 letters, digits, - or _.")
        now = studio.now()
        kind = "grant" if credits > 0 else "expire"

        def account():
            return {"account": {"user_id": user_id, **{k: v for k, v in studio.credits_json(user_id).items() if k != "recent"}}}

        try:
            return await run_in_threadpool(_grant, admin, user_id, credits, plan, period_end, note, request_key, now, kind, account)
        except store.IntegrityError:
            # A concurrent request with the same key won the race: this one is its replay.
            return dict(account(), replayed=True)

    def _grant(admin, user_id, credits, plan, period_end, note, request_key, now, kind, account):
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            replay = bool(request_key) and con.execute(
                "SELECT 1 FROM studio_ledger WHERE user_id=? AND request_key=?", (user_id, request_key)).fetchone() is not None
            if not replay:
                _apply_grant(con, admin, user_id, credits, plan, period_end, note, request_key, now, kind)
        # Read back after the write transaction ended (account() opens its own connection).
        return dict(account(), replayed=replay)

    def _apply_grant(con, admin, user_id, credits, plan, period_end, note, request_key, now, kind):
        # current_user() ran before the write lock: re-check the caller inside it.
        me = con.execute("SELECT role, disabled_at FROM users WHERE id=?", (admin["id"],)).fetchone()
        if not me or me["role"] != "admin" or me["disabled_at"] is not None:
            fail("admin_required", "Administrator access is required.", 403)
        if not con.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
            fail("customer_not_found", "Account not found.", 404)
        con.execute("INSERT INTO studio_accounts (user_id,balance,reserved,plan,period_end,updated_at) VALUES (?,0,0,NULL,NULL,?) ON CONFLICT(user_id) DO NOTHING", (user_id, now))
        before = con.execute("SELECT * FROM studio_accounts WHERE user_id=?", (user_id,)).fetchone()
        if before["balance"] + credits < 0:
            fail("studio_insufficient_credits", "The account does not have that many unreserved credits.", 409)
        new_plan = plan or before["plan"] or DEFAULT_PLAN
        new_end = period_end if period_end is not None else before["period_end"]
        con.execute("UPDATE studio_accounts SET balance=balance+?, plan=?, period_end=?, updated_at=? WHERE user_id=?",
                    (credits, new_plan, new_end, now, user_id))
        con.execute("INSERT INTO studio_ledger (user_id,op_id,kind,delta,note,created_at,request_key) VALUES (?,NULL,?,?,?,?,?)",
                    (user_id, kind, credits, note, now, request_key))
        store.audit(con, "admin.studio_credits_" + kind, admin["id"], user_id,
                    {"credits": credits, "note": note, "balance": [before["balance"], before["balance"] + credits],
                     "plan": [before["plan"], new_plan], "period_end": [before["period_end"], new_end]})

    @application.get(PREFIX + "/admin/studio/usage")
    async def studio_usage(request: Request):
        current_user(request, admin=True)
        month = request.query_params.get("month") or datetime.fromtimestamp(studio.now(), timezone.utc).strftime("%Y-%m")
        if not MONTH.fullmatch(month):
            fail("invalid_input", "Choose a valid reporting month.")
        start, end = _month_bounds(month)
        with store.connect() as con:
            portal = {r["user_id"]: dict(r) for r in con.execute(
                "SELECT o.user_id AS user_id, COUNT(*) AS ops, SUM(o.credits) AS credits_reserved, "
                "SUM(COALESCE(o.credits_charged,0)) AS credits_charged, "
                "SUM(CASE WHEN o.state IN ('settled','settled_partial','refunded') THEN o.credits-COALESCE(o.credits_charged,0) ELSE 0 END) AS credits_refunded, "
                "SUM(CASE WHEN o.state IN ('reserved','submitted','unknown') THEN 1 ELSE 0 END) AS active_ops "
                "FROM studio_ops o WHERE o.created_at>=? AND o.created_at<? GROUP BY o.user_id",
                (start, end)).fetchall()}
            granted = {r["user_id"]: r["total"] for r in con.execute(
                "SELECT user_id, SUM(delta) AS total FROM studio_ledger WHERE kind IN ('grant','expire') AND created_at>=? AND created_at<? GROUP BY user_id",
                (start, end)).fetchall()}
        agent_status, agent_rows, gpu_rate = "ok", {}, None
        try:
            data = await run_in_threadpool(studio.agent.usage, month)
            gpu_rate = data.get("gpu_usd_per_hour")
            agent_rows = {o.get("owner"): o for o in data.get("owners") or [] if isinstance(o, dict)}
        except AgentError as error:
            agent_status = error.kind
        user_ids = sorted(set(portal) | set(granted) | {k for k in agent_rows if isinstance(k, str)})
        names = {}
        if user_ids:
            with store.connect() as con:
                names = {r["id"]: dict(r) for r in con.execute(
                    "SELECT id, email, name FROM users WHERE id IN (" + ",".join("?" * len(user_ids)) + ")", tuple(user_ids)).fetchall()}
        users = []
        for user_id in user_ids:
            p, a, known = portal.get(user_id, {}), agent_rows.get(user_id, {}), names.get(user_id, {})
            users.append({"user_id": user_id, "email": known.get("email"), "name": known.get("name"),
                          "ops": int(p.get("ops") or 0), "active_ops": int(p.get("active_ops") or 0),
                          "credits_granted": int(granted.get(user_id) or 0),
                          "credits_charged": int(p.get("credits_charged") or 0), "credits_refunded": int(p.get("credits_refunded") or 0),
                          "agent_ops": a.get("ops"), "credits_quoted": a.get("credits_quoted"), "credits_produced": a.get("credits_produced"),
                          "list_cost_usd": a.get("list_cost_usd"), "gpu_seconds": a.get("gpu_seconds"), "est_gpu_usd": a.get("est_gpu_usd")})
        return {"month": month, "agent_status": agent_status, "gpu_usd_per_hour": gpu_rate, "users": users,
                "note": "est_gpu_usd is gpu_seconds times gpu_usd_per_hour: an estimate until the gateway bills at GPU cost (D-V8)."}

    @application.get(PREFIX + "/admin/studio/report")
    async def studio_report(request: Request):
        """The monthly credits report the owner invoices from (no payment gateway: invoices are manual).

        Computed from studio_ledger only. Month = Asia/Taipei calendar month. A balance here is the credits
        an account still holds (studio_accounts.balance + reserved). An op's consumption (its reserve minus
        its refund) belongs to the month of its settle/refund row, so an op reserved on the 31st and settled
        on the 1st counts in the new month; until then it is held, shown as reserved_at_close. Per account:
        opening + granted - consumed - expired == closing."""
        current_user(request, admin=True)
        month = request.query_params.get("month") or datetime.fromtimestamp(studio.now() + TAIPEI_OFFSET_S, timezone.utc).strftime("%Y-%m")
        if not MONTH.fullmatch(month):
            fail("invalid_input", "Choose a valid reporting month.")
        return await run_in_threadpool(_report, month)

    def _report(month):
        utc_start, utc_end = _month_bounds(month)
        start, end = utc_start - TAIPEI_OFFSET_S, utc_end - TAIPEI_OFFSET_S
        rows = {}

        def row(user_id):
            if user_id not in rows:
                rows[user_id] = {"user_id": user_id, "email": None, "name": None, "plan": None, "opening_balance": 0,
                                 "credits_granted": 0, "grants": [], "credits_consumed": 0, "credits_expired": 0,
                                 "closing_balance": 0, "reserved_at_close": 0, "videos_exported": 0, "ops": 0}
            return rows[user_id]

        with store.connect() as con:
            for r in con.execute("SELECT user_id, SUM(delta) AS total FROM studio_ledger WHERE kind IN ('grant','expire') AND created_at<? GROUP BY user_id",
                                 (start,)).fetchall():
                row(r["user_id"])["opening_balance"] += int(r["total"] or 0)
            for r in con.execute("SELECT user_id, kind, delta, note, created_at FROM studio_ledger WHERE kind IN ('grant','expire') "
                                 "AND created_at>=? AND created_at<? ORDER BY created_at, id", (start, end)).fetchall():
                item = row(r["user_id"])
                if r["kind"] == "grant":
                    item["credits_granted"] += int(r["delta"])
                    item["grants"].append({"credits": int(r["delta"]), "note": r["note"], "created_at": int(r["created_at"])})
                else:
                    item["credits_expired"] -= int(r["delta"])
            # One row per op from its ledger rows: when it ended (settle or refund row) and what it consumed.
            # A free op (0 credits) that failed writes no settle or refund row; its terminal op row dates it.
            ops = con.execute(
                "SELECT l.user_id AS user_id, o.type AS type, o.state AS state, o.updated_at AS updated_at, "
                "MIN(CASE WHEN l.kind IN ('settle','refund') THEN l.created_at END) AS ended_at, "
                "SUM(CASE WHEN l.kind='settle' THEN 1 ELSE 0 END) AS settles, "
                "-SUM(CASE WHEN l.kind='reserve' THEN l.delta ELSE 0 END) AS reserved, "
                "-SUM(CASE WHEN l.kind IN ('reserve','refund') THEN l.delta ELSE 0 END) AS consumed "
                "FROM studio_ledger l JOIN studio_ops o ON o.op_id=l.op_id "
                "WHERE l.op_id IS NOT NULL AND l.created_at<? GROUP BY l.user_id, l.op_id, o.type, o.state, o.updated_at", (end,)).fetchall()
            for r in ops:
                ended_at, reserved, consumed = r["ended_at"], int(r["reserved"] or 0), int(r["consumed"] or 0)
                if ended_at is None and not reserved and r["state"] in TERMINAL and r["updated_at"] < end:
                    ended_at = r["updated_at"]
                if ended_at is None:
                    if reserved:
                        row(r["user_id"])["reserved_at_close"] += reserved
                elif ended_at < start:
                    row(r["user_id"])["opening_balance"] -= consumed
                else:
                    item = row(r["user_id"])
                    item["credits_consumed"] += consumed
                    item["ops"] += 1
                    if r["type"] == "export" and int(r["settles"] or 0):
                        item["videos_exported"] += 1
            for item in rows.values():
                item["closing_balance"] = item["opening_balance"] + item["credits_granted"] - item["credits_consumed"] - item["credits_expired"]
            users = [item for item in rows.values()
                     if any(item[k] for k in ("opening_balance", "closing_balance", "credits_granted", "credits_consumed", "credits_expired", "ops"))]
            ids = [item["user_id"] for item in users]
            if ids:
                marks = ",".join("?" * len(ids))
                known = {r["id"]: r for r in con.execute("SELECT id, email, name FROM users WHERE id IN (" + marks + ")", tuple(ids)).fetchall()}
                plans = {r["user_id"]: r["plan"] for r in con.execute("SELECT user_id, plan FROM studio_accounts WHERE user_id IN (" + marks + ")", tuple(ids)).fetchall()}
                for item in users:
                    if item["user_id"] in known:
                        item["email"], item["name"] = known[item["user_id"]]["email"], known[item["user_id"]]["name"]
                    item["plan"] = plans.get(item["user_id"])
        users.sort(key=lambda item: ((item["email"] or "").lower(), item["user_id"]))
        totals = {k: sum(item[k] for item in users) for k in ("opening_balance", "credits_granted", "credits_consumed", "credits_expired",
                                                               "closing_balance", "reserved_at_close", "videos_exported", "ops")}
        return {"month": month, "timezone": "Asia/Taipei", "period": {"start": start, "end": end}, "users": users, "totals": totals,
                "note": "From the credit ledger. Consumption (settled charges net of refunds) counts in the Asia/Taipei month an op "
                        "settled or was refunded, not the month it was reserved. Balances include reserved credits. Plan is the current plan."}

    return studio
