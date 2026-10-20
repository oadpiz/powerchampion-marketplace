"""node allocation (機台分配): alloc_engineers, alloc_nodes, alloc_meta; audit_events.details

Seeds the 2026-10-20 assignment of the 16 b300 GPU nodes (2 selling, 14 across
5 engineers, 0 reserved) so the portal starts from
the same state as the cluster's access/engineers.yaml, including its engineer ids (eng1..eng5,
the Prometheus `owner` label) and owner email. Engineers start without an SSH
public key; an administrator pastes one in /admin/allocation.

Downgrade drops the three alloc_* tables (their data is lost; export
engineers.yaml first if you need it) and audit_events.details.

Revision ID: 0003_node_allocation
Revises: 0002_users_disabled_at
Create Date: 2026-10-20
"""
import json
import time
import uuid

import sqlalchemy as sa
from alembic import op

revision = "0003_node_allocation"
down_revision = "0002_users_disabled_at"
branch_labels = None
depends_on = None

# Frozen copy of the seed (do not import server.allocation: a migration must not change
# when application code changes later).
NODE_NUMBERS = (11, 12, 13, 14, 15, 16, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31)
SELLING = ("b300-14", "b300-31")
OWNER_EMAIL = "zhuling@oadpiz.com"  # owner.email in engineers.yaml (2026-10-20)
ENGINEERS = (  # in eng1..eng5 order; the cluster id is "eng<position>"
    ("justin", "justin@oadpiz.com", ("b300-11", "b300-12", "b300-13")),
    ("mwind", "mwind@oadpiz.com", ("b300-15", "b300-16", "b300-22")),
    ("zhuling", "zhuling@oadpiz.com", ("b300-23", "b300-24", "b300-25")),
    ("nati", "nati@oadpiz.com", ("b300-26", "b300-27", "b300-28")),
    ("ll", "ll@oadpiz.com", ("b300-29", "b300-30")),
)


def upgrade():
    op.add_column("audit_events", sa.Column("details", sa.Text(), nullable=True))
    engineers = op.create_table(
        "alloc_engineers",
        sa.Column("id", sa.Text(), primary_key=True),
        # The id written to engineers.yaml (render.py uses it as the Prometheus owner label).
        sa.Column("cluster_id", sa.Text(), nullable=False, unique=True),
        sa.Column("username", sa.Text(), nullable=False, unique=True),
        sa.Column("email", sa.Text(), nullable=False, unique=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("ssh_pubkey", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        # JSON list of every node this engineer has been assigned; an inactive engineer is
        # exported as state: absent on these nodes so the playbook removes the account.
        sa.Column("node_history", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
    )
    nodes = op.create_table(
        "alloc_nodes",
        sa.Column("name", sa.Text(), primary_key=True),
        sa.Column("ip", sa.Text(), nullable=False, unique=True),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("engineer_id", sa.Text(), sa.ForeignKey("alloc_engineers.id"), nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.Text(), sa.ForeignKey("users.id"), nullable=True),
        sa.CheckConstraint("role IN ('selling','engineer','reserved')", name="alloc_nodes_role"),
        sa.CheckConstraint("(role = 'engineer') = (engineer_id IS NOT NULL)", name="alloc_nodes_engineer"),
    )
    op.create_index("alloc_nodes_engineer", "alloc_nodes", ["engineer_id"])
    meta = op.create_table(
        "alloc_meta",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("owner_email", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.Text(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("last_export_revision", sa.Integer(), nullable=True),
        sa.Column("last_export_at", sa.Integer(), nullable=True),
        sa.CheckConstraint("id = 1", name="alloc_meta_single_row"),
    )

    now = int(time.time())
    engineer_rows, owner = [], {}
    for index, (username, email, owned) in enumerate(ENGINEERS):
        engineer_id = uuid.uuid4().hex
        engineer_rows.append({"id": engineer_id, "cluster_id": "eng%d" % (index + 1), "username": username, "email": email, "display_name": username,
                              "ssh_pubkey": None, "active": True, "node_history": json.dumps(list(owned)),
                              # distinct created_at keeps the seed order (= the old eng1..eng5 order)
                              "created_at": now + index, "updated_at": now + index})
        for node in owned:
            owner[node] = engineer_id
    op.bulk_insert(engineers, engineer_rows)
    node_rows = []
    for number in NODE_NUMBERS:
        name = "b300-%d" % number
        role = "selling" if name in SELLING else "engineer" if name in owner else "reserved"
        node_rows.append({"name": name, "ip": "172.16.10.%d" % number, "role": role, "engineer_id": owner.get(name),
                          "note": "", "updated_at": now, "updated_by": None})
    op.bulk_insert(nodes, node_rows)
    op.bulk_insert(meta, [{"id": 1, "revision": 1, "owner_email": OWNER_EMAIL, "updated_at": now, "updated_by": None,
                           "last_export_revision": None, "last_export_at": None}])


def downgrade():
    op.drop_table("alloc_meta")
    op.drop_index("alloc_nodes_engineer", table_name="alloc_nodes")
    op.drop_table("alloc_nodes")
    op.drop_table("alloc_engineers")
    op.drop_column("audit_events", "details")
