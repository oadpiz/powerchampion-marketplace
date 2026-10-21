"""alloc_engineers: portal account link and who/when the SSH key last changed

- user_id: the portal account (users.id) an administrator created and linked for this
  engineer. Only that account may set the engineer's SSH key itself. NULL = not linked.
  UNIQUE: one account can stand for at most one engineer.
- key_updated_revision: alloc_meta.revision at which ssh_pubkey last changed. The key is
  "pending sync" while this is greater than alloc_meta.last_export_revision.
- key_updated_by: 'admin' or 'engineer' (who made that change).
- key_previous_fingerprint: SHA256 fingerprint of the key the machines had before the
  pending change (kept across several changes between two exports; NULL = no key before).
- users.password_change_required_at: set when an administrator issues a password (a new
  engineer account or a reset); cleared when the user changes it. While set, the account
  cannot submit an SSH key.

Keys saved before this migration have no recorded revision (NULL) and are treated as synced.
Downgrade drops these columns (the account links are lost; the users stay).

Revision ID: 0004_engineer_accounts
Revises: 0003_node_allocation
Create Date: 2026-10-21
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_engineer_accounts"
down_revision = "0003_node_allocation"
branch_labels = None
depends_on = None


def upgrade():
    # Batch mode: SQLite cannot add a UNIQUE/FOREIGN KEY constraint with ALTER TABLE, so
    # Alembic rebuilds the table there; Postgres gets plain ALTER TABLE statements.
    with op.batch_alter_table("alloc_engineers") as batch:
        batch.add_column(sa.Column("user_id", sa.Text(), nullable=True))
        batch.add_column(sa.Column("key_updated_revision", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("key_updated_by", sa.Text(), nullable=True))
        batch.add_column(sa.Column("key_previous_fingerprint", sa.Text(), nullable=True))
        batch.create_foreign_key("alloc_engineers_user", "users", ["user_id"], ["id"])
        batch.create_unique_constraint("alloc_engineers_user_unique", ["user_id"])
        batch.create_check_constraint("alloc_engineers_key_updated_by", "key_updated_by IN ('admin','engineer')")
    op.add_column("users", sa.Column("password_change_required_at", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("users", "password_change_required_at")
    with op.batch_alter_table("alloc_engineers") as batch:
        batch.drop_constraint("alloc_engineers_key_updated_by", type_="check")
        batch.drop_constraint("alloc_engineers_user_unique", type_="unique")
        batch.drop_constraint("alloc_engineers_user", type_="foreignkey")
        batch.drop_column("key_previous_fingerprint")
        batch.drop_column("key_updated_by")
        batch.drop_column("key_updated_revision")
        batch.drop_column("user_id")
