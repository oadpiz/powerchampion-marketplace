"""baseline: the portal schema as it existed in SQLite on 2026-10-08

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-08
"""
import re

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

# Verbatim copy of server/store.py SCHEMA (2026-10-08) followed by server/runtime_store.py SCHEMA.
# Do not edit these strings; add a new migration instead.
STORE_SCHEMA = """
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

RUNTIME_SCHEMA = """
CREATE TABLE IF NOT EXISTS runtime_tasks (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
 goal TEXT NOT NULL, model TEXT NOT NULL, agent_id TEXT, agent_version INTEGER,
 agent_snapshot TEXT, encrypted_key TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','running','paused','awaiting_approval','completed','failed','cancelled')),
 created_at REAL NOT NULL, updated_at REAL NOT NULL,
 step_count INTEGER NOT NULL DEFAULT 0, max_steps INTEGER NOT NULL,
 max_output_tokens INTEGER NOT NULL, requested_control TEXT,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 summary TEXT NOT NULL DEFAULT '', error TEXT,
 messages TEXT NOT NULL DEFAULT '[]', plan TEXT NOT NULL DEFAULT '[]',
 worker_id TEXT, lease_expires_at REAL
);
CREATE INDEX IF NOT EXISTS runtime_tasks_owner ON runtime_tasks(owner_id,created_at);
CREATE INDEX IF NOT EXISTS runtime_tasks_queue ON runtime_tasks(status,created_at);
CREATE TABLE IF NOT EXISTS runtime_references (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_events_task ON runtime_events(task_id,sequence);
CREATE TABLE IF NOT EXISTS runtime_instructions (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_instructions_task ON runtime_instructions(task_id,sequence);
CREATE TABLE IF NOT EXISTS runtime_approvals (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 tool TEXT NOT NULL, args TEXT NOT NULL, call_id TEXT NOT NULL,
 reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 created_at REAL NOT NULL, decided_at REAL,
 UNIQUE(task_id,call_id)
);
CREATE INDEX IF NOT EXISTS runtime_approvals_task ON runtime_approvals(task_id,sequence);
CREATE TABLE IF NOT EXISTS runtime_artifacts (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 task_id TEXT NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL,
 size INTEGER NOT NULL, content BLOB NOT NULL, created_at REAL NOT NULL,
 UNIQUE(task_id,call_id)
);
CREATE INDEX IF NOT EXISTS runtime_artifacts_task ON runtime_artifacts(task_id,sequence);
"""


def _portable(statement: str, dialect: str) -> str:
    if dialect != "postgresql":
        return statement
    statement = re.sub(r"INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY", statement)
    statement = re.sub(r"\bREAL\b", "DOUBLE PRECISION", statement)
    statement = re.sub(r"\bBLOB\b", "BYTEA", statement)
    return statement


def _statements(schema: str):
    for raw in schema.split(";"):
        statement = raw.strip()
        if statement:
            yield statement


def upgrade():
    dialect = op.get_bind().dialect.name
    for schema in (STORE_SCHEMA, RUNTIME_SCHEMA):
        for statement in _statements(schema):
            op.execute(_portable(statement, dialect))


def downgrade():
    raise RuntimeError("baseline cannot be downgraded; restore from backup instead")
