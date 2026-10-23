"""audit_events: index on (action, target_id, created_at)

audit_events had no index besides its primary key, but phase 1 of the phone agent reads it
as a ledger, every time with action = ? and usually target_id = ?:
- GET /me/voice (every merchant page load): tries in the last 24 hours, and the latest try;
- POST /me/voice/try and POST /me/voice/publish: the same counts, inside the writer lock, so a
  full scan there delays every other write;
- the operator store list (latest try per store) and the redeem-code issue check.
Each was a full table scan. Measured on SQLite with 100,000 rows: about 3.6 ms per query
before, 0.004 ms after (a covering-index search); with 1,000,000 rows about 40 ms before.
Building the index on 1,000,000 rows took under a second; each new audit row writes one more
index entry. On Postgres CREATE INDEX blocks writes to audit_events while it builds.

Downgrade drops the index only; no data changes either way.

Revision ID: 0008_audit_action_index
Revises: 0007_voice_core
Create Date: 2026-10-22
"""
from alembic import op

revision = "0008_audit_action_index"
down_revision = "0007_voice_core"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("audit_events_action_target_time", "audit_events", ["action", "target_id", "created_at"])


def downgrade():
    op.drop_index("audit_events_action_target_time", table_name="audit_events")
