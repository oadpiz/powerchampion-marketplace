"""voice deletions: a store deletes one call's content; expired content is deleted through the same requests

The portal keeps no call content (recordings, transcripts and summaries are on the Taiwan host, phase2-contract §0), so
"delete" means: the portal hides the call from the store at once, clears its own content-like columns, and queues a
deletion request that the Taiwan host's records sender pulls (GET /api/voice-runtime/deletions) and acknowledges once
the content is gone (POST /api/voice-runtime/deletions/{id}/ack). Expired content goes through the same requests, so
the records sender implements one flow (phase2-contract §16).

- voice_calls.store_deleted_at: the store asked to delete this call's content (M18); the store no longer finds the call,
  its billing columns stay as they were.
- voice_calls.recording_expiry_queued_at, content_expiry_queued_at: when the portal's schedule queued the request for an
  expired recording, and for all of the call's content (90 days, after which the portal's own content-like columns are
  cleared too). Both are markers so each schedule run only reads calls not handled yet (indexes below).
- voice_calls.content_purged_at (0009) now means: the records sender acknowledged that all of the call's content is
  deleted (a store deletion or the 90-day expiry).
- voice_deletion_requests: one row per (call_id, reason), never a store's caller data. `seq` is the pull cursor: it is
  assigned inside the writer lock (BEGIN IMMEDIATE), so it grows in commit order. There is no foreign key to voice_calls:
  a pending request must outlive the call row if the call row is purged first.

Downgrade drops the table, its indexes and the three columns: pending deletion requests are lost (the Taiwan host would
keep that content until the next upgrade's schedule run queues the expiry again; store deletions are not queued again).

Revision ID: 0011_voice_deletions
Revises: 0010_voice_call_digests
Create Date: 2026-10-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0011_voice_deletions"
down_revision = "0010_voice_call_digests"
branch_labels = None
depends_on = None

# Frozen copies (phase2-contract §16).
REASONS = ("store_deleted", "recording_expired", "content_expired")
STATUSES = ("pending", "done")
COLUMNS = ("store_deleted_at", "recording_expiry_queued_at", "content_expiry_queued_at")


def _in(column, values):
    return "%s IN (%s)" % (column, ",".join("'%s'" % value for value in values))


def upgrade():
    for column in COLUMNS:
        op.add_column("voice_calls", sa.Column(column, sa.Integer(), nullable=True))
    op.create_index("voice_calls_content_expiry", "voice_calls", ["content_expiry_queued_at", "started_at"])
    op.create_index("voice_calls_recording_expiry", "voice_calls", ["recording_expiry_queued_at", "started_at"])
    integer, text = sa.Integer(), sa.Text()
    op.create_table(
        "voice_deletion_requests",
        sa.Column("id", text, primary_key=True),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("call_id", text, nullable=False),
        sa.Column("reason", text, nullable=False),
        sa.Column("kinds", text, nullable=False),  # canonical JSON list, sorted: recording, summary, transcript
        sa.Column("requested_by", text, nullable=True),  # users.id of the store owner; NULL for the portal's schedule
        sa.Column("status", text, nullable=False),
        sa.Column("requested_at", integer, nullable=False),
        sa.Column("done_at", integer, nullable=True),
        sa.Column("files_deleted", integer, nullable=True),
        sa.Column("rows_deleted", integer, nullable=True),
        sa.UniqueConstraint("seq", name="voice_deletion_requests_seq_unique"),
        sa.UniqueConstraint("call_id", "reason", name="voice_deletion_requests_call_reason_unique"),
        sa.CheckConstraint("seq >= 1", name="voice_deletion_requests_seq"),
        sa.CheckConstraint(_in("reason", REASONS), name="voice_deletion_requests_reason"),
        sa.CheckConstraint(_in("status", STATUSES), name="voice_deletion_requests_status"),
        sa.CheckConstraint("(status = 'pending' AND done_at IS NULL AND files_deleted IS NULL AND rows_deleted IS NULL) OR "
                           "(status = 'done' AND done_at IS NOT NULL AND files_deleted >= 0 AND rows_deleted >= 0)",
                           name="voice_deletion_requests_done"),
    )
    op.create_index("voice_deletion_requests_status_seq", "voice_deletion_requests", ["status", "seq"])


def downgrade():
    op.drop_index("voice_deletion_requests_status_seq", table_name="voice_deletion_requests")
    op.drop_table("voice_deletion_requests")
    op.drop_index("voice_calls_recording_expiry", table_name="voice_calls")
    op.drop_index("voice_calls_content_expiry", table_name="voice_calls")
    for column in reversed(COLUMNS):
        op.drop_column("voice_calls", column)
