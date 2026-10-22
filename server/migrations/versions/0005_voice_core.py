"""voice core (AI 電話客服 phase 1): stores, hours, closures, FAQs, config versions, numbers

- voice_stores: one store per portal account (owner_user_id UNIQUE). The draft settings the
  store edits (greeting, intro, after-hours rules, recording) live here; current_version
  points at the published row in voice_config_versions (NULL = never published).
- voice_store_hours / voice_store_closures: weekly opening segments (weekday 0 = Monday,
  minutes [open_min, close_min) within one day) and special closed dates (Taipei YYYY-MM-DD).
- voice_faqs: the store's questions and answers, ordered by position (0..n-1).
- voice_config_versions: immutable compiled snapshots (canonical voice.store-config/v1 JSON
  and its sha256), one per (store_id, version).
- voice_numbers: which phone number or test extension points at which store and when.
  The "one active row per number at a time" rule is enforced by server/voice_store.py
  inside the write lock (neither SQLite nor a plain Postgres CHECK can express it).

Downgrade drops every voice_* table: all stores' settings, FAQs, published versions and the
number table are lost (the users created for store owners and their audit events stay).

Revision ID: 0005_voice_core
Revises: 0004_engineer_accounts
Create Date: 2026-10-22
"""
import sqlalchemy as sa
from alembic import op

revision = "0005_voice_core"
down_revision = "0004_engineer_accounts"
branch_labels = None
depends_on = None

# Frozen copies (a migration must not change when application code changes later).
# Retention limits: 90 days for off/message_only, 30 days for full recording (phase1-contract §1.5).
RETENTION_DAYS_MAX = 90
RETENTION_DAYS_MAX_FULL = 30


def _in(column, values):
    return "%s IN (%s)" % (column, ",".join("'%s'" % value for value in values))


def upgrade():
    op.create_table(
        "voice_stores",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("owner_user_id", sa.Text(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("industry", sa.Text(), nullable=False),
        sa.Column("template_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("greeting", sa.Text(), nullable=False, server_default=""),
        sa.Column("intro_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("ask_callback", sa.Text(), nullable=False, server_default="auto"),
        sa.Column("max_message_seconds", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("after_hours_mode", sa.Text(), nullable=False, server_default="answer_and_message"),
        sa.Column("handoff_mode", sa.Text(), nullable=False, server_default="callback"),
        sa.Column("handoff_number", sa.Text(), nullable=True),
        sa.Column("retention_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("recording_mode", sa.Text(), nullable=False, server_default="message_only"),
        sa.Column("ai_answer_enabled", sa.Integer(), nullable=False, server_default="0"),
        # Phase 3 (terms acceptance); created now so phase 3 needs no table rebuild.
        sa.Column("terms_version", sa.Text(), nullable=True),
        sa.Column("terms_accepted_at", sa.Integer(), nullable=True),
        sa.Column("current_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.UniqueConstraint("owner_user_id", name="voice_stores_owner_unique"),
        sa.CheckConstraint(_in("industry", ("clinic", "cram", "other")), name="voice_stores_industry"),
        sa.CheckConstraint(_in("status", ("draft", "testing", "live", "suspended")), name="voice_stores_status"),
        sa.CheckConstraint(_in("ask_callback", ("auto", "always", "never")), name="voice_stores_ask_callback"),
        sa.CheckConstraint("max_message_seconds >= 60 AND max_message_seconds <= 180", name="voice_stores_max_message_seconds"),
        sa.CheckConstraint(_in("after_hours_mode", ("answer_and_message", "message_only")), name="voice_stores_after_hours_mode"),
        sa.CheckConstraint(_in("handoff_mode", ("callback", "transfer")), name="voice_stores_handoff_mode"),
        sa.CheckConstraint(_in("recording_mode", ("off", "message_only", "full")), name="voice_stores_recording_mode"),
        sa.CheckConstraint("retention_days >= 1 AND retention_days <= %d AND (recording_mode <> 'full' OR retention_days <= %d)"
                           % (RETENTION_DAYS_MAX, RETENTION_DAYS_MAX_FULL), name="voice_stores_retention_days"),
        sa.CheckConstraint("ai_answer_enabled IN (0,1)", name="voice_stores_ai_answer_enabled"),
        sa.CheckConstraint("current_version IS NULL OR current_version >= 1", name="voice_stores_current_version"),
    )
    op.create_table(
        "voice_store_hours",
        sa.Column("store_id", sa.Text(), sa.ForeignKey("voice_stores.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("weekday", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("open_min", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("close_min", sa.Integer(), nullable=False),
        sa.CheckConstraint("weekday >= 0 AND weekday <= 6", name="voice_store_hours_weekday"),
        sa.CheckConstraint("open_min >= 0 AND open_min < close_min AND close_min <= 1440", name="voice_store_hours_range"),
    )
    op.create_table(
        "voice_store_closures",
        sa.Column("store_id", sa.Text(), sa.ForeignKey("voice_stores.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("date", sa.Text(), primary_key=True),  # Taipei date, YYYY-MM-DD
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.CheckConstraint("length(date) = 10", name="voice_store_closures_date"),
    )
    op.create_table(
        "voice_faqs",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("store_id", sa.Text(), sa.ForeignKey("voice_stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("variants", sa.Text(), nullable=False, server_default="[]"),  # JSON list of strings
        sa.Column("ai_allowed", sa.Integer(), nullable=False, server_default="1"),  # 0 = do not let the AI answer it
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("ai_allowed IN (0,1)", name="voice_faqs_ai_allowed"),
        sa.CheckConstraint("position >= 0", name="voice_faqs_position"),
    )
    op.create_index("voice_faqs_store", "voice_faqs", ["store_id", "position"])
    op.create_table(
        "voice_config_versions",
        sa.Column("store_id", sa.Text(), sa.ForeignKey("voice_stores.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("config_json", sa.Text(), nullable=False),  # canonical JSON; never updated
        sa.Column("config_sha256", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.CheckConstraint("version >= 1", name="voice_config_versions_version"),
        sa.CheckConstraint("length(config_sha256) = 64", name="voice_config_versions_sha256"),
    )
    op.create_table(
        "voice_numbers",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("number", sa.Text(), nullable=False),  # E.164 (+886...) or ext-NNNN
        sa.Column("store_id", sa.Text(), sa.ForeignKey("voice_stores.id"), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("active_from", sa.Integer(), nullable=False),
        sa.Column("active_to", sa.Integer(), nullable=True),  # exclusive; NULL = no end
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(_in("purpose", ("customer", "demo", "test", "internal")), name="voice_numbers_purpose"),
        sa.CheckConstraint(_in("channel", ("online", "test_line", "pstn")), name="voice_numbers_channel"),
        sa.CheckConstraint("active_to IS NULL OR active_to > active_from", name="voice_numbers_period"),
    )
    op.create_index("voice_numbers_number", "voice_numbers", ["number", "active_from"])


def downgrade():
    op.drop_index("voice_numbers_number", table_name="voice_numbers")
    op.drop_table("voice_numbers")
    op.drop_table("voice_config_versions")
    op.drop_index("voice_faqs_store", table_name="voice_faqs")
    op.drop_table("voice_faqs")
    op.drop_table("voice_store_closures")
    op.drop_table("voice_store_hours")
    op.drop_table("voice_stores")
