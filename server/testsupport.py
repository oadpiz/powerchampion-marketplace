"""Shared helpers so every backend test runs on SQLite by default and on Postgres when
PC_PORTAL_TEST_DATABASE_URL is set (see scripts/test_backend_postgres.sh)."""
import os
from pathlib import Path

from server.db import Database


def fresh_database(tmpdir: str) -> str:
    url = os.environ.get("PC_PORTAL_TEST_DATABASE_URL", "").strip()
    if url:
        Database(url).reset_for_tests()
        return url
    return str(Path(tmpdir) / "portal.sqlite")


def rows(store, table: str) -> list[dict]:
    with store.connect() as con:
        return [dict(r) for r in con.execute('SELECT * FROM "' + table + '"').fetchall()]


def database_text(store) -> str:
    """Every row of every table as one string, for 'this secret was never stored' assertions."""
    return "\n".join(str(rows(store, table)) for table in store.db.table_names())
