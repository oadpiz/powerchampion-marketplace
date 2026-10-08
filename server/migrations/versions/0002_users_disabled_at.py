"""users.disabled_at: epoch seconds when an administrator disabled the account; NULL = active

Revision ID: 0002_users_disabled_at
Revises: 0001_baseline
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_users_disabled_at"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("disabled_at", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("users", "disabled_at")
