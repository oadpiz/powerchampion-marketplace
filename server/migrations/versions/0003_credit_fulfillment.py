"""Bind verified payments to durable, retryable gateway credit grants."""
from alembic import op
import sqlalchemy as sa

revision = "0003_credit_fulfillment"
down_revision = "0002_users_disabled_at"
branch_labels = None
depends_on = None


def upgrade():
    # Old rows deliberately remain unbound and unfulfilled; migration never funds them.
    with op.batch_alter_table("credit_requests") as table:
        table.add_column(sa.Column("target_key_id", sa.Text(), nullable=True))
        table.add_column(sa.Column("payment_confirmed_at", sa.BigInteger(), nullable=True))
        table.add_column(sa.Column("fulfillment_status", sa.Text(), nullable=False, server_default="not_started"))
        table.add_column(sa.Column("fulfillment_error", sa.Text(), nullable=True))
        table.add_column(sa.Column("fulfillment_receipt", sa.Text(), nullable=True))
        table.add_column(sa.Column("fulfillment_operation_id", sa.Text(), nullable=True))
        table.add_column(sa.Column("fulfilled_at", sa.BigInteger(), nullable=True))
    op.add_column("gateway_keys", sa.Column("revocation_started_at", sa.BigInteger(), nullable=True))


def downgrade():
    with op.batch_alter_table("credit_requests") as table:
        for name in ("fulfilled_at", "fulfillment_operation_id", "fulfillment_receipt", "fulfillment_error", "fulfillment_status", "payment_confirmed_at", "target_key_id"):
            table.drop_column(name)
    op.drop_column("gateway_keys", "revocation_started_at")
