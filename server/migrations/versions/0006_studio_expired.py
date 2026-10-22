"""studio_projects.expired: 1 when the agent's retention (30 idle days) deleted the project's media.

Cached from the agent's project document (`expired: true`) so the list can badge it without an agent call;
NULL/0 = whole. Re-rendering makes the project whole again and the next fetch clears it.

Revision ID: 0006_studio_expired
Revises: 0005_studio
Create Date: 2026-10-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0006_studio_expired"
down_revision = "0005_studio"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("studio_projects", sa.Column("expired", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("studio_projects") as batch:
        batch.drop_column("expired")
