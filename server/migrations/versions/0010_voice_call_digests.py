"""voice_calls: report_*_sha256 is the sha256 of the stored report, not of the body that was sent

0009 stored, for each source, the sha256 of the report as it was SENT (phase2-contract §3.4 step 2). A dialed number
that is not in the number table and reads as a Taiwan mobile number is kept as ******NNNN (the last 4 digits), but the
hash of the sent body still had the whole number inside it: anyone with the database could try every number ending in
those 4 digits against the stored report and find the other digits (2,469 hashes, 0.03 seconds, found 0912345678).

From this revision on, ingest hashes the report as it is KEPT (voice_calls.part_sha256), and a resend is recognised
by the digest of either form (voice_calls.sent_digests). This migration rewrites the digests of rows written before:
for each row, report_orchestrator_sha256 and report_records_sha256 become the sha256 (hex) of the UTF-8 bytes of
the report_orchestrator and report_records text of the same row, which is the canonical JSON that ingest hashes. The
value depends on nothing that is not already in the row. No column, index or constraint changes.

Downgrade changes nothing: the old digests cannot be rebuilt (they need the unmasked numbers, which were never kept).
Code of the 0009 revision then finds the same digest for every report that was kept as sent; only a resend of a report
whose dialed number was masked would be answered 409 call_conflict instead of 200 duplicate.

Revision ID: 0010_voice_call_digests
Revises: 0009_voice_calls
Create Date: 2026-10-23
"""
import hashlib

import sqlalchemy as sa
from alembic import op

revision = "0010_voice_call_digests"
down_revision = "0009_voice_calls"
branch_labels = None
depends_on = None

SOURCES = ("orchestrator", "records")
PAGE = 500


def upgrade():
    bind = op.get_bind()
    for source in SOURCES:
        text_column, digest_column = "report_" + source, "report_%s_sha256" % source
        select = sa.text("SELECT id, %s AS report FROM voice_calls WHERE %s IS NOT NULL AND id > :last ORDER BY id LIMIT :page"
                         % (text_column, text_column))
        update = sa.text("UPDATE voice_calls SET %s = :digest WHERE id = :id" % digest_column)
        last = ""
        while True:
            rows = bind.execute(select, {"last": last, "page": PAGE}).fetchall()
            if not rows:
                break
            for row in rows:
                bind.execute(update, {"digest": hashlib.sha256(row.report.encode("utf-8")).hexdigest(), "id": row.id})
            last = rows[-1].id


def downgrade():
    # Nothing to restore: see the module docstring.
    pass
