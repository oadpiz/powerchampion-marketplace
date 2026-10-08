"""Copy a SQLite portal database into another portal database (normally Postgres).

Run inside the portal container after the target schema exists:
  python -m server.import_sqlite --source /data/portal.sqlite3 --target "$PC_PORTAL_DATABASE_URL"
"""
from __future__ import annotations

import argparse
import sqlite3
import sys

from server.db import Database
from server.store import Store

# Parents before children (foreign keys); alembic_version is never copied.
ORDER = [
    "users", "sessions", "gateway_keys", "key_reservations", "credit_requests", "audit_events",
    "login_attempts", "trial_sessions", "trial_requests", "agents", "agent_versions",
    "runtime_tasks", "runtime_references", "runtime_events", "runtime_instructions",
    "runtime_approvals", "runtime_artifacts",
]
SEQUENCE_COLUMNS = {"runtime_events": "sequence", "runtime_instructions": "sequence",
                    "runtime_approvals": "sequence", "runtime_artifacts": "sequence"}


def import_database(source_path: str, target: str, skip: set[str]) -> dict[str, tuple[int, int]]:
    Store(target)  # creates / upgrades the schema
    db = Database(target)
    src = sqlite3.connect(source_path)
    src.row_factory = sqlite3.Row
    tables = [t for t in ORDER if t not in skip]
    with db.connect() as con:
        for table in tables:
            if con.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]:
                print("target table is not empty: " + table, file=sys.stderr)
                raise SystemExit(2)
    counts: dict[str, tuple[int, int]] = {}
    with db.connect() as con:
        for table in tables:
            columns = [r["name"] for r in src.execute("PRAGMA table_info(" + table + ")")]
            placeholders = ",".join("?" for _ in columns)
            sql = "INSERT INTO " + table + " (" + ",".join(columns) + ") VALUES (" + placeholders + ")"
            n = 0
            for row in src.execute("SELECT * FROM " + table):
                con.execute(sql, tuple(row))
                n += 1
            got = con.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
            counts[table] = (n, got)
        if db.backend == "postgres":
            for table, column in SEQUENCE_COLUMNS.items():
                if table in tables:
                    con.execute("SELECT setval(pg_get_serial_sequence(?, ?), COALESCE((SELECT MAX(" + column + ") FROM " + table + "), 1))",
                                (table, column))
    src.close()
    return counts


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--skip", default="sessions,login_attempts")
    args = ap.parse_args(argv)
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    counts = import_database(args.source, args.target, skip)
    bad = 0
    for table, (n, got) in counts.items():
        flag = "" if n == got else "  <-- MISMATCH"
        bad += n != got
        print(f"{table:22s} source={n:6d} target={got:6d}{flag}")
    print("skipped:", ", ".join(sorted(skip)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
