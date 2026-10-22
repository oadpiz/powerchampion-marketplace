"""voice calls (AI 電話客服 phase 2): call details, operator reviews, listening logs

- voice_calls: one row per call (call_id UNIQUE: the Asterisk linkedid, or try-<32 hex> for a try call),
  merged from up to two runtime reports (the orchestrator and the Taiwan host's records sender). Only
  times, lengths, result categories, flags, the config and disclosure versions, the meter and the caller's
  last 3 digits are kept: no transcript, summary, recording, callback number or full caller number
  (phase2-contract §0, §4.1). report_* hold each source's report without sent_at (its schema has no field
  for any of those); report_*_at is when that source's report was last stored (A10 sources.receivedAt).
- voice_call_reviews: one operator review per call (score, labels, note, status).
- voice_listening_logs: blind-listening results (no caller data).
- audit_events_action_actor_time: the content-link count per account (§1.6) reads audit_events by
  (action, actor_id, created_at); 0008's index serves (action, target_id, created_at) only.

Downgrade drops the index and the three tables: every call detail, review and listening log is lost
(the stores, numbers and audit events stay).

Revision ID: 0009_voice_calls
Revises: 0008_audit_action_index
Create Date: 2026-10-22
"""
import sqlalchemy as sa
from alembic import op

revision = "0009_voice_calls"
down_revision = "0008_audit_action_index"
branch_labels = None
depends_on = None

# Frozen copies (a migration must not change when application code changes later); phase2-contract §3.4, §3.5, §4.
ENTRIES = ("pstn", "webrtc", "softphone", "try")
DISPOSITIONS = ("ANSWERED", "NO ANSWER", "BUSY", "FAILED", "CONGESTION")
CALLER_KINDS = ("mobile", "landline", "hidden", "web", "unknown")
PURPOSES = ("customer", "demo", "test", "internal")
HANDOFF_REASONS = ("requested", "no_answer", "no_ai_question", "urgent", "complaint")
MESSAGE_OUTCOMES = ("none", "message", "callback_only", "no_speech", "notice_hangup", "error")
CALLBACK_VIA = ("dtmf", "speech")
DEGRADE_REASONS = ("llm", "tts", "asr", "orchestrator", "link", "config", "edge_fallback")
OUTCOMES = ("answered", "message", "handoff", "degraded", "not_answered", "hangup_early", "no_speech", "error", "unknown")
RECORDING_MODES = ("off", "message_only", "full")
FLAG_KINDS = ("wrong_answer",)
REVIEW_STATUSES = ("open", "done")
LISTENING_KINDS = ("tts_voice", "call_sample", "prompt_audio", "other")
CALL_MAX_SECONDS = 14400
BOOLEANS = ("ai_answered", "handoff", "urgent", "message_final", "has_message", "callback_confirmed",
            "recording_saved", "recording_declined", "degraded", "content_expected")


def _in(column, values):
    return "%s IN (%s)" % (column, ",".join("'%s'" % value for value in values))


def _nullable_in(column, values):
    return "%s IS NULL OR %s" % (column, _in(column, values))


def upgrade():
    integer, text = sa.Integer(), sa.Text()
    op.create_table(
        "voice_calls",
        sa.Column("id", text, primary_key=True),
        sa.Column("call_id", text, nullable=False),
        sa.Column("entry", text, nullable=False),
        sa.Column("dialed", text, nullable=True),
        sa.Column("number_id", text, sa.ForeignKey("voice_numbers.id"), nullable=True),
        sa.Column("store_id", text, sa.ForeignKey("voice_stores.id"), nullable=True),
        sa.Column("number_purpose", text, nullable=True),
        sa.Column("started_at", integer, nullable=False),
        sa.Column("ended_at", integer, nullable=True),
        sa.Column("answered_at", integer, nullable=True),
        sa.Column("duration_s", integer, nullable=True),
        sa.Column("disposition", text, nullable=False),
        sa.Column("caller_tail", text, nullable=True),
        sa.Column("caller_kind", text, nullable=False),
        sa.Column("config_version", integer, nullable=True),
        sa.Column("config_sha256", text, nullable=True),
        sa.Column("disclosure_version", text, nullable=True),
        sa.Column("ai_answered", integer, nullable=False, server_default="0"),
        sa.Column("ai_speech_ms", integer, nullable=False, server_default="0"),
        sa.Column("turns", integer, nullable=False, server_default="0"),
        sa.Column("handoff", integer, nullable=False, server_default="0"),
        sa.Column("handoff_reason", text, nullable=True),
        sa.Column("urgent", integer, nullable=False, server_default="0"),
        sa.Column("message_outcome", text, nullable=False, server_default="none"),
        sa.Column("message_final", integer, nullable=False, server_default="0"),
        sa.Column("message_speech_ms", integer, nullable=False, server_default="0"),
        sa.Column("recording_ms", integer, nullable=False, server_default="0"),
        sa.Column("has_message", integer, nullable=False, server_default="0"),
        sa.Column("callback_confirmed", integer, nullable=False, server_default="0"),
        sa.Column("callback_via", text, nullable=True),
        sa.Column("recording_saved", integer, nullable=False, server_default="0"),
        sa.Column("recording_declined", integer, nullable=False, server_default="0"),
        sa.Column("degraded", integer, nullable=False, server_default="0"),
        sa.Column("degrade_reason", text, nullable=True),
        sa.Column("outcome", text, nullable=False),
        sa.Column("auto_flags", text, nullable=False, server_default="[]"),  # canonical JSON list
        sa.Column("mismatch", text, nullable=False, server_default="[]"),  # canonical JSON list of field names
        sa.Column("metrics", text, nullable=False, server_default="{}"),  # canonical JSON object, 6 keys
        sa.Column("content_expected", integer, nullable=False, server_default="0"),
        sa.Column("retention_days_snapshot", integer, nullable=False),
        sa.Column("retention_days_reported", integer, nullable=True),
        sa.Column("recording_mode", text, nullable=True),
        sa.Column("meter_units", integer, nullable=False),
        sa.Column("meter_reason", text, nullable=False),
        sa.Column("meter_rule", text, nullable=False),
        sa.Column("store_flag_kind", text, nullable=True),
        sa.Column("store_flag_note", text, nullable=True),
        sa.Column("store_flagged_at", integer, nullable=True),
        sa.Column("store_flagged_by", text, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("report_orchestrator", text, nullable=True),
        sa.Column("report_orchestrator_sha256", text, nullable=True),
        sa.Column("report_orchestrator_at", integer, nullable=True),
        sa.Column("report_records", text, nullable=True),
        sa.Column("report_records_sha256", text, nullable=True),
        sa.Column("report_records_at", integer, nullable=True),
        sa.Column("received_at", integer, nullable=False),
        sa.Column("updated_at", integer, nullable=False),
        sa.Column("content_purged_at", integer, nullable=True),
        sa.UniqueConstraint("call_id", name="voice_calls_call_id_unique"),
        sa.CheckConstraint(_in("entry", ENTRIES), name="voice_calls_entry"),
        sa.CheckConstraint(_nullable_in("number_purpose", PURPOSES), name="voice_calls_number_purpose"),
        sa.CheckConstraint("duration_s IS NULL OR (duration_s >= 0 AND duration_s <= %d)" % CALL_MAX_SECONDS, name="voice_calls_duration"),
        sa.CheckConstraint(_in("disposition", DISPOSITIONS), name="voice_calls_disposition"),
        sa.CheckConstraint("caller_tail IS NULL OR length(caller_tail) = 3", name="voice_calls_caller_tail"),
        sa.CheckConstraint(_in("caller_kind", CALLER_KINDS), name="voice_calls_caller_kind"),
        sa.CheckConstraint("config_version IS NULL OR config_version >= 1", name="voice_calls_config_version"),
        sa.CheckConstraint(_nullable_in("handoff_reason", HANDOFF_REASONS), name="voice_calls_handoff_reason"),
        sa.CheckConstraint(_in("message_outcome", MESSAGE_OUTCOMES), name="voice_calls_message_outcome"),
        sa.CheckConstraint(_nullable_in("callback_via", CALLBACK_VIA), name="voice_calls_callback_via"),
        sa.CheckConstraint(_nullable_in("degrade_reason", DEGRADE_REASONS), name="voice_calls_degrade_reason"),
        sa.CheckConstraint(_in("outcome", OUTCOMES), name="voice_calls_outcome"),
        sa.CheckConstraint(" AND ".join("%s IN (0,1)" % column for column in BOOLEANS), name="voice_calls_booleans"),
        sa.CheckConstraint("ai_speech_ms >= 0 AND message_speech_ms >= 0 AND recording_ms >= 0 AND turns >= 0", name="voice_calls_counts"),
        sa.CheckConstraint("retention_days_snapshot >= 1 AND retention_days_snapshot <= 90", name="voice_calls_retention_snapshot"),
        sa.CheckConstraint("retention_days_reported IS NULL OR (retention_days_reported >= 1 AND retention_days_reported <= 90)",
                           name="voice_calls_retention_reported"),
        sa.CheckConstraint(_nullable_in("recording_mode", RECORDING_MODES), name="voice_calls_recording_mode"),
        sa.CheckConstraint("meter_units IN (0,1)", name="voice_calls_meter_units"),
        sa.CheckConstraint(_nullable_in("store_flag_kind", FLAG_KINDS), name="voice_calls_store_flag_kind"),
    )
    op.create_index("voice_calls_store_time", "voice_calls", ["store_id", "started_at"])
    op.create_index("voice_calls_time", "voice_calls", ["started_at"])
    op.create_index("voice_calls_number", "voice_calls", ["number_id"])
    op.create_table(
        "voice_call_reviews",
        sa.Column("call_row_id", text, sa.ForeignKey("voice_calls.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("score", integer, nullable=False),
        sa.Column("labels", text, nullable=False, server_default="[]"),
        sa.Column("note", text, nullable=False, server_default=""),
        sa.Column("status", text, nullable=False),
        sa.Column("reviewer_id", text, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", integer, nullable=False),
        sa.Column("updated_at", integer, nullable=False),
        sa.CheckConstraint("score >= 1 AND score <= 5", name="voice_call_reviews_score"),
        sa.CheckConstraint(_in("status", REVIEW_STATUSES), name="voice_call_reviews_status"),
    )
    op.create_table(
        "voice_listening_logs",
        sa.Column("id", text, primary_key=True),
        sa.Column("title", text, nullable=False),
        sa.Column("kind", text, nullable=False),
        sa.Column("held_on", text, nullable=False),  # Taipei date, YYYY-MM-DD
        sa.Column("sample_count", integer, nullable=False),
        sa.Column("rater_count", integer, nullable=False),
        sa.Column("passed", integer, nullable=True),  # 1 passed, 0 failed, NULL only recorded
        sa.Column("summary", text, nullable=False, server_default=""),
        sa.Column("report_ref", text, nullable=False, server_default=""),
        sa.Column("created_by", text, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", integer, nullable=False),
        sa.Column("updated_at", integer, nullable=False),
        sa.CheckConstraint(_in("kind", LISTENING_KINDS), name="voice_listening_logs_kind"),
        sa.CheckConstraint("length(held_on) = 10", name="voice_listening_logs_held_on"),
        sa.CheckConstraint("sample_count >= 1 AND sample_count <= 10000", name="voice_listening_logs_sample_count"),
        sa.CheckConstraint("rater_count >= 1 AND rater_count <= 50", name="voice_listening_logs_rater_count"),
        sa.CheckConstraint("passed IS NULL OR passed IN (0,1)", name="voice_listening_logs_passed"),
    )
    op.create_index("audit_events_action_actor_time", "audit_events", ["action", "actor_id", "created_at"])


def downgrade():
    op.drop_index("audit_events_action_actor_time", table_name="audit_events")
    op.drop_table("voice_listening_logs")
    op.drop_table("voice_call_reviews")
    op.drop_index("voice_calls_number", table_name="voice_calls")
    op.drop_index("voice_calls_time", table_name="voice_calls")
    op.drop_index("voice_calls_store_time", table_name="voice_calls")
    op.drop_table("voice_calls")
