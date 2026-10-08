"""One SQL dialect-thin adapter so the portal's hand-written SQL runs on SQLite (dev, tests)
and Postgres (production) without an ORM.

Rules the rest of the code relies on:
- placeholders are written as `?`; this module rewrites them to `%s` for psycopg;
- `BEGIN IMMEDIATE` means "serialize writers": SQLite takes the reserved lock, Postgres
  takes a transaction-scoped advisory lock (one global key; the portal has one process);
- rows support row["col"], row[0], dict(row) and row.keys() on both backends;
- `Database.IntegrityError` is the backend's unique/constraint violation class.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote
from typing import Any, Sequence

ADVISORY_LOCK_KEY = 7300001


def translate_placeholders(sql: str) -> str:
    out, in_literal = [], False
    i = 0
    while i < len(sql):
        ch = sql[i]
        if ch == "'":
            in_literal = not in_literal
            out.append(ch)
        elif ch == "%":
            out.append("%%")
        elif ch == "?" and not in_literal:
            out.append("%s")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


class Row(dict):
    """dict with positional access and value iteration, matching what sqlite3.Row offered."""

    def __init__(self, pairs):
        pairs = list(pairs)
        super().__init__(pairs)
        self._values = tuple(value for _, value in pairs)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

    def __iter__(self):
        return iter(self._values)


def _pg_row_factory(cursor):
    names = [d.name for d in cursor.description] if cursor.description else []

    def make(values):
        return Row(zip(names, values))

    return make


class _Cursor:
    def __init__(self, cursor, backend):
        self._cursor = cursor
        self._backend = backend

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None or self._backend == "postgres":
            return row
        return Row(zip(row.keys(), tuple(row)))

    def fetchall(self):
        rows = self._cursor.fetchall()
        if self._backend == "postgres":
            return rows
        return [Row(zip(r.keys(), tuple(r))) for r in rows]

    def __iter__(self):
        return iter(self.fetchall())

    @property
    def rowcount(self):
        return self._cursor.rowcount


class Connection:
    def __init__(self, raw, backend):
        self._raw = raw
        self._backend = backend

    def execute(self, sql: str, params: Sequence[Any] = ()) -> _Cursor:
        if sql.strip().upper() == "BEGIN IMMEDIATE":
            if self._backend == "postgres":
                self._raw.execute("SELECT pg_advisory_xact_lock(%s)", (ADVISORY_LOCK_KEY,))
                return _Cursor(self._raw.cursor(), self._backend)
            return _Cursor(self._raw.execute(sql), self._backend)
        if self._backend == "postgres":
            cur = self._raw.cursor()
            cur.execute(translate_placeholders(sql), tuple(params))
            return _Cursor(cur, self._backend)
        return _Cursor(self._raw.execute(sql, tuple(params)), self._backend)


class Database:
    def __init__(self, target: str):
        target = str(target)
        if target.startswith("postgres://"):
            target = "postgresql://" + target[len("postgres://"):]
        if "://" in target and not target.startswith(("sqlite:///", "postgresql://", "postgresql+psycopg://")):
            raise ValueError("unsupported database URL scheme: " + target.split("://", 1)[0])
        if target.startswith(("postgresql://", "postgresql+psycopg://")):
            import psycopg  # noqa: F401  (import error surfaces here, not at first request)
            from psycopg import errors as pg_errors

            self.backend = "postgres"
            self.path = None
            self._dsn = target.replace("postgresql+psycopg://", "postgresql://", 1)
            self.url = target.replace("postgresql://", "postgresql+psycopg://", 1)
            self.IntegrityError = pg_errors.IntegrityError
        else:
            path = target[len("sqlite:///"):] if target.startswith("sqlite:///") else target
            self.backend = "sqlite"
            self.path = path
            self._dsn = path
            self.url = "sqlite:///" + quote(path, safe="/")
            self.IntegrityError = sqlite3.IntegrityError
            Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)

    @contextmanager
    def connect(self):
        if self.backend == "postgres":
            import psycopg

            con = psycopg.connect(self._dsn, row_factory=_pg_row_factory, connect_timeout=5, options="-c lock_timeout=15000")
            try:
                yield Connection(con, self.backend)
                con.commit()
            except BaseException:
                try:
                    con.rollback()
                except Exception:
                    pass
                raise
            finally:
                con.close()
            return
        con = sqlite3.connect(self._dsn, timeout=15)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("PRAGMA busy_timeout = 15000")
        try:
            with con:
                yield Connection(con, self.backend)
        finally:
            con.close()

    def table_names(self) -> list[str]:
        with self.connect() as con:
            if self.backend == "postgres":
                rows = con.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()
                return [r[0] for r in rows]
            rows = con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
            return [r[0] for r in rows]

    def reset_for_tests(self):
        """Drop everything. Tests only. On SQLite the file is simply removed."""
        if self.backend == "postgres":
            with self.connect() as con:
                con.execute("DROP SCHEMA public CASCADE")
                con.execute("CREATE SCHEMA public")
            return
        Path(self.path).unlink(missing_ok=True)
