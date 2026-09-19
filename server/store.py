"""Durable portal data. The gateway remains the authority for inference usage."""
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .security import clean_name, digest_token, normalize_email, password_hash, validate_password


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','admin')),
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS gateway_keys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 gateway_key_id TEXT NOT NULL UNIQUE, label TEXT NOT NULL, prefix TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','revoked')), created_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS keys_owner ON gateway_keys(user_id);
CREATE TABLE IF NOT EXISTS key_reservations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS key_reservations_owner ON key_reservations(user_id);
CREATE TABLE IF NOT EXISTS credit_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1000 AND 1000000),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 reference TEXT NOT NULL, created_at INTEGER NOT NULL, reviewed_at INTEGER,
 reviewer_id TEXT REFERENCES users(id), review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS credits_owner ON credit_requests(user_id);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
 target_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
 scope TEXT PRIMARY KEY, attempts INTEGER NOT NULL, first_attempt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trial_sessions (
 token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trial_requests (
 id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, day TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','succeeded','failed','cancelled')),
 created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS agents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','archived')),
 current_version INTEGER NOT NULL, token_hash TEXT UNIQUE, token_prefix TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_owner ON agents(user_id);
CREATE TABLE IF NOT EXISTS agent_versions (
 agent_id TEXT NOT NULL REFERENCES agents(id), version INTEGER NOT NULL,
 model TEXT NOT NULL, purpose TEXT NOT NULL, instructions TEXT NOT NULL,
 tone TEXT NOT NULL, knowledge TEXT NOT NULL, sample_prompt TEXT NOT NULL,
 system_prompt TEXT NOT NULL, max_output_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(agent_id, version)
);
CREATE INDEX IF NOT EXISTS trial_requests_day ON trial_requests(day);
CREATE INDEX IF NOT EXISTS trial_requests_session_day ON trial_requests(session_hash,day);
"""


def iso(value):
    if value is None:
        return None
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


def user_json(row):
    return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"], "createdAt": iso(row["created_at"])}


def key_json(row):
    return {"id": row["id"], "label": row["label"], "prefix": row["prefix"], "status": row["status"], "createdAt": iso(row["created_at"])}


def credit_json(row):
    result = {"id": row["id"], "amountUsd": row["amount_cents"] / 100, "status": row["status"], "reference": row["reference"], "createdAt": iso(row["created_at"]), "reviewedAt": iso(row["reviewed_at"])}
    if "email" in row.keys():
        result.update(email=row["email"], name=row["name"])
    return result


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as con:
            con.executescript(SCHEMA)
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        con = sqlite3.connect(self.path, timeout=15)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("PRAGMA busy_timeout = 15000")
        try:
            with con:
                yield con
        finally:
            con.close()

    @staticmethod
    def audit(con, action, actor_id, target_id=None):
        con.execute("INSERT INTO audit_events VALUES (?,?,?,?,?)", (uuid.uuid4().hex, actor_id, action, target_id, int(time.time())))

    def create_user(self, email, name, password, role="customer"):
        email, name = normalize_email(email), clean_name(name)
        password = validate_password(password)
        if role not in ("customer", "admin"):
            raise ValueError("Invalid role")
        user_id = uuid.uuid4().hex
        encoded = password_hash(password)
        with self.connect() as con:
            con.execute("INSERT INTO users VALUES (?,?,?,?,?,?)", (user_id, email, name, encoded, role, int(time.time())))
            self.audit(con, "admin.created" if role == "admin" else "account.registered", user_id, user_id)
            return user_json(con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())

    def find_user(self, email):
        with self.connect() as con:
            row = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            return dict(row) if row else None

    def new_session(self, user_id, lifetime):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.connect() as con:
            con.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
            con.execute("INSERT INTO sessions VALUES (?,?,?,?)", (digest_token(token), user_id, now, now + lifetime))
        return token

    def session_user(self, token):
        if not token or len(token) > 100:
            return None
        with self.connect() as con:
            row = con.execute("SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?", (digest_token(token), int(time.time()))).fetchone()
            return user_json(row) if row else None

    def logout(self, token):
        with self.connect() as con:
            con.execute("DELETE FROM sessions WHERE token_hash=?", (digest_token(token),))

    def consume_attempt(self, scope, limit=5, window=900):
        """Reserve before password work, atomically across processes/requests."""
        now = int(time.time())
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT * FROM login_attempts WHERE scope=?", (scope,)).fetchone()
            if row and row["first_attempt"] > now-window and row["attempts"] >= limit:
                return False
            if row and row["first_attempt"] > now-window:
                con.execute("UPDATE login_attempts SET attempts=attempts+1 WHERE scope=?", (scope,))
            else:
                con.execute("INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET attempts=excluded.attempts,first_attempt=excluded.first_attempt", (scope, 1, now))
            con.execute("DELETE FROM login_attempts WHERE first_attempt<?", (now-86400,))
            return True

    def reserve_key_slot(self, user_id, limit=20):
        reservation = uuid.uuid4().hex
        now = int(time.time())
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            # Gateway calls time out in 15 seconds. Abandoned reservations after
            # a process crash eventually release; active keys never expire here.
            con.execute("DELETE FROM key_reservations WHERE created_at<=?", (now-300,))
            count = con.execute("SELECT (SELECT COUNT(*) FROM gateway_keys WHERE user_id=? AND status='active')+(SELECT COUNT(*) FROM key_reservations WHERE user_id=?)", (user_id, user_id)).fetchone()[0]
            if count >= limit:
                return None
            con.execute("INSERT INTO key_reservations VALUES (?,?,?)", (reservation, user_id, now))
            return reservation

    def release_key_slot(self, reservation):
        with self.connect() as con:
            con.execute("DELETE FROM key_reservations WHERE id=?", (reservation,))

    def clear_attempts(self, scope):
        with self.connect() as con:
            con.execute("DELETE FROM login_attempts WHERE scope=?", (scope,))

    def owned_keys(self, user_id):
        with self.connect() as con:
            return [dict(row) for row in con.execute("SELECT * FROM gateway_keys WHERE user_id=? ORDER BY created_at DESC, id", (user_id,))]

    def trial_session(self, token, lifetime=604800):
        """Reuse a server-issued opaque session; never trust an invented cookie."""
        now = int(time.time())
        with self.connect() as con:
            if isinstance(token, str) and 20 <= len(token) <= 100:
                hashed = digest_token(token)
                if con.execute("SELECT 1 FROM trial_sessions WHERE token_hash=? AND expires_at>?", (hashed, now)).fetchone():
                    return hashed, None
            token = secrets.token_urlsafe(32)
            hashed = digest_token(token)
            con.execute("INSERT INTO trial_sessions VALUES (?,?,?)", (hashed, now, now+lifetime))
            con.execute("DELETE FROM trial_sessions WHERE expires_at<=?", (now,))
            return hashed, token

    def trial_remaining(self, session_hash, global_limit, session_limit):
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with self.connect() as con:
            row = con.execute("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN session_hash=? THEN 1 ELSE 0 END),0) AS owned FROM trial_requests WHERE day=?", (session_hash, day)).fetchone()
            return max(0, min(global_limit-row["total"], session_limit-row["owned"]))

    def reserve_trial_request(self, session_hash, global_limit, session_limit):
        """Charge a request slot before any upstream work, never refund failures.

        Both budgets share the same SQLite transaction, so concurrent requests,
        restarted services and regenerated browser cookies cannot bypass the
        operator's global daily request cap.
        """
        now = int(time.time())
        day = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
        request_id = uuid.uuid4().hex
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN session_hash=? THEN 1 ELSE 0 END),0) AS owned FROM trial_requests WHERE day=?", (session_hash, day)).fetchone()
            if row["total"] >= global_limit or row["owned"] >= session_limit:
                return None
            con.execute("INSERT INTO trial_requests VALUES (?,?,?,'reserved',?,NULL)", (request_id, session_hash, day, now))
            return request_id

    def finish_trial_request(self, request_id, status):
        if status not in ("succeeded", "failed", "cancelled"):
            raise ValueError("Invalid trial outcome")
        with self.connect() as con:
            con.execute("UPDATE trial_requests SET status=?,completed_at=? WHERE id=? AND status='reserved'", (status, int(time.time()), request_id))
