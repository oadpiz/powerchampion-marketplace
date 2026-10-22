"""video studio (影片工作室): credit accounts, projects, ops, ledger and rate-limit counters

Contract: shortvideo-agent docs/studio-spec.md sections 4, 6 and 8 (v3 + section 12/13).

- studio_accounts: one row per user. balance = credits the user can still spend (reserved
  credits are already taken out of it); reserved = credits held by active ops.
- studio_projects: the portal's record of who owns which agent project. status/title/
  thumb_url/thumb_exp/updated_at are a cache of the agent's document for the project list.
- studio_ops: the source of truth for money. Terminal states are reached only through
  conditional UPDATEs from an active state (reserved|submitted|unknown). The partial unique
  index ux_studio_ops_active allows one active op per project.
- studio_ledger: every credit movement. Sum of delta per user == studio_accounts.balance.
- studio_rate: fixed-window counters for the per-user rate limits (section 8).

Downgrade drops the five tables (their data is lost).

Revision ID: 0005_studio
Revises: 0004_engineer_accounts
Create Date: 2026-10-22
"""
import sqlalchemy as sa
from alembic import op

revision = "0005_studio"
down_revision = "0004_engineer_accounts"
branch_labels = None
depends_on = None

# Frozen copy (a migration must not change when application code changes later).
ACTIVE = "state IN ('reserved','submitted','unknown')"


def upgrade():
    op.create_table(
        "studio_accounts",
        sa.Column("user_id", sa.Text(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("balance", sa.Integer(), nullable=False),
        sa.Column("reserved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("plan", sa.Text(), nullable=True),
        sa.Column("period_end", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.CheckConstraint("balance >= 0", name="studio_accounts_balance"),
        sa.CheckConstraint("reserved >= 0", name="studio_accounts_reserved"),
    )
    op.create_table(
        "studio_projects",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.Text(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("template_id", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("thumb_url", sa.Text(), nullable=True),
        sa.Column("thumb_exp", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.Column("deleted_at", sa.Integer(), nullable=True),
    )
    op.create_index("ix_studio_projects_user_created", "studio_projects", ["user_id", "created_at"])
    op.create_table(
        "studio_ops",
        sa.Column("op_id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.Text(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("project_id", sa.Text(), sa.ForeignKey("studio_projects.id"), nullable=False),
        sa.Column("type", sa.Text(), nullable=True),
        sa.Column("target", sa.Text(), nullable=True),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("credits_charged", sa.Integer(), nullable=True),
        sa.Column("quote_id", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        # Signed into the grant; kept so the grant is never re-issued (spec section 12.3).
        sa.Column("storyboard_rev", sa.Integer(), nullable=True),
        sa.Column("plan", sa.Text(), nullable=True),
        sa.Column("grant_exp", sa.Integer(), nullable=True),
        # The agent's op error code (never its message).
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.CheckConstraint("state IN ('reserved','submitted','unknown','settled','settled_partial','refunded')", name="studio_ops_state"),
        sa.CheckConstraint("credits >= 0", name="studio_ops_credits"),
        sa.CheckConstraint("credits_charged IS NULL OR (credits_charged >= 0 AND credits_charged <= credits)", name="studio_ops_charged"),
        sa.UniqueConstraint("user_id", "idempotency_key", name="studio_ops_idempotency"),
        # A quote is single-use on the agent too; refusing a second op locally avoids a second reservation.
        sa.UniqueConstraint("quote_id", name="studio_ops_quote"),
    )
    op.create_index("ux_studio_ops_active", "studio_ops", ["project_id"], unique=True,
                    sqlite_where=sa.text(ACTIVE), postgresql_where=sa.text(ACTIVE))
    op.create_index("ix_studio_ops_state", "studio_ops", ["state", "updated_at"])
    op.create_index("ix_studio_ops_user_state", "studio_ops", ["user_id", "state"])
    op.create_table(
        "studio_ledger",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Text(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("op_id", sa.Text(), sa.ForeignKey("studio_ops.op_id"), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=True),
        # An administrator's grant idempotency key: a retried grant is applied once (NULL for op rows).
        sa.Column("request_key", sa.Text(), nullable=True),
        sa.CheckConstraint("kind IN ('grant','reserve','settle','refund','expire')", name="studio_ledger_kind"),
        sa.UniqueConstraint("user_id", "request_key", name="studio_ledger_request"),
    )
    op.create_index("ix_studio_ledger_user_created", "studio_ledger", ["user_id", "created_at"])
    op.create_table(
        "studio_rate",
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.Column("window_start", sa.Integer(), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "bucket", "window_start", name="studio_rate_pk"),
    )


def downgrade():
    op.drop_table("studio_rate")
    op.drop_index("ix_studio_ledger_user_created", table_name="studio_ledger")
    op.drop_table("studio_ledger")
    op.drop_index("ix_studio_ops_user_state", table_name="studio_ops")
    op.drop_index("ix_studio_ops_state", table_name="studio_ops")
    op.drop_index("ux_studio_ops_active", table_name="studio_ops")
    op.drop_table("studio_ops")
    op.drop_index("ix_studio_projects_user_created", table_name="studio_projects")
    op.drop_table("studio_projects")
    op.drop_table("studio_accounts")
