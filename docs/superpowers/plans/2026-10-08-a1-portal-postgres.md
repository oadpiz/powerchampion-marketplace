# A1：portal SQLite → Postgres 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** powerchampion.ai 的私有 portal（`server/`，FastAPI）從單檔 SQLite 換成 Dokploy 內網的 Postgres，既有資料完整匯入，測試能在 SQLite 與 Postgres 兩種後端跑，store 函式簽章不變。

**Architecture:** 新增一層薄的 DB adapter `server/db.py`：同一份 SQL 字串同時跑 SQLite 與 Postgres（psycopg 3），adapter 只做三件事：`?`→`%s` 佔位符轉換（跳過字串字面值）、`BEGIN IMMEDIATE` 在 Postgres 對應成交易級 advisory lock、回傳同時支援 `row["col"]` 與 `row[0]` 的列物件。DDL 搬進 Alembic baseline migration（`server/migrations/`），`Store.__init__` 改成跑 `alembic upgrade head`，`RuntimeStore.__init__` 不再建表。`PC_PORTAL_DATABASE_URL` 有值就用 Postgres，否則沿用 `PC_PORTAL_DB` 的 SQLite 路徑（開發與測試預設）。資料匯入用獨立腳本 `server/import_sqlite.py`，在 Dokploy 的 portal 容器終端執行。

**Tech Stack:** Python 3.12（image）／3.13（本機）、FastAPI、`psycopg[binary]` 3、SQLAlchemy 2（只給 Alembic 用）、Alembic 1.13、`unittest`、Docker Compose（測試用 postgres:16-alpine）、GitHub Actions。

## Global Constraints

- 對應 spec：`docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md` §5.2（A1）。spec 寫「SQLAlchemy Core＋Alembic」，本計畫把執行期存取收斂成 DB adapter＋原生 SQL，Alembic 只管 DDL；理由：盤點結果是 5 個檔案 137 條 SQL、約 270 個位置式佔位符，逐條改寫成 SQLAlchemy 的風險與工時都高於一層 adapter。store 函式簽章不變這一點照 spec。
- 基準：`npm run test:backend`（`python3 -m unittest discover -s server -t . -p 'test_*.py' -v`）目前 **152 個測試**；每個 Task 結束時 SQLite 後端必須 0 failed 且 ≥ 152。Task 5 之後 Postgres 後端也必須 0 failed。
- **SQL 字串原則上不改**。只允許本計畫明列的四種改法：(a) `CASE WHEN ?=` 改 `CASE WHEN CAST(? AS TEXT)=`；(b) `a.rowid` 改 `a.id`；(c) `COALESCE(SUM(...),0)` 的結果包 `int()`；(d) `INSERT INTO t VALUES (...)` 不動（欄位順序由 migration 保證與原 SCHEMA 一致）。
- `sqlite3.IntegrityError` 一律改成 `store.IntegrityError`（adapter 提供，依後端對應）。
- 不引入 ORM 模型層、不用 SQLAlchemy 跑查詢。
- 環境變數：新增 `PC_PORTAL_DATABASE_URL`（Postgres DSN，`postgresql://user:pass@host:5432/db`）；`PC_PORTAL_DB` 語意不變（SQLite 路徑）。兩者都有時 `PC_PORTAL_DATABASE_URL` 優先。
- 測試用 Postgres：環境變數 `PC_PORTAL_TEST_DATABASE_URL`；有值時所有測試改跑該 DB（每個測試前 `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`），沒值時維持臨時 SQLite 檔。
- Postgres 連線：每次 `connect()` 開一條新連線（與現行 SQLite 行為一致，單 uvicorn process、流量低）；連線池是後續最佳化，不在本期。
- 依賴（`server/requirements.txt` 新增三行）：`psycopg[binary]>=3.1,<4`、`sqlalchemy>=2.0,<3`、`alembic>=1.13,<2`。
- 本機開發用 venv：`python3 -m venv .venv-portal && .venv-portal/bin/pip install -r server/requirements.txt`，之後所有 Python 指令用 `.venv-portal/bin/python`。`.venv-portal/` 要在 `.gitignore`。
- Git：在 marketplace repo 開 worktree `.worktrees/a1-portal-postgres`，分支 `a1/portal-postgres` 從 `main` 開。**agent 不 push、不 merge、不碰 Dokploy、不動生產**；這些步驟標 `【使用者執行】`。每個 git 指令單獨一行；不用 `git stash`；不用 bare `git checkout <path>`。`tsconfig.tsbuildinfo` 會被 build 弄髒，**永遠不要 add 它**。
- Commit 訊息結尾：`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 回滾資料策略（spec §5.2）：切換前把 `portal.sqlite3` 複製成 `portal.sqlite3.pre-pg-<date>` 唯讀備份保留 90 天；回滾＝拿掉 `PC_PORTAL_DATABASE_URL` 重啟；切換後新寫入的資料回滾時會遺失，已接受。

---

### Task 1: 依賴、venv、`Settings.database_url`

**Files:**
- Modify: `server/requirements.txt`
- Modify: `.gitignore`（加 `/.venv-portal/`）
- Modify: `server/settings.py:13`（加欄位）、`:62-78`（`from_env`）
- Create: `server/test_settings.py`

**Interfaces:**
- Produces: `Settings.database_url` 屬性（`str`）：`database_url` 欄位有值就回它；否則若 `db_path` 以 `sqlite:///` 或 `postgresql://` 開頭就原樣回；否則回 `"sqlite:///" + db_path`。`Settings(database_url=...)` 新欄位，預設空字串。`from_env` 讀 `PC_PORTAL_DATABASE_URL`。
- 後續 Task 的 `Store(target)` 吃的就是 `settings.database_url`。

- [ ] **Step 1: worktree 與 venv**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace
git status --short | grep -v '^??' | head
git worktree add -b a1/portal-postgres .worktrees/a1-portal-postgres main
cd .worktrees/a1-portal-postgres
python3 -m venv .venv-portal
.venv-portal/bin/pip install -q -r server/requirements.txt
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
```
Expected: `Ran 152 tests`、`OK`（基準）。

- [ ] **Step 2: 失敗的測試**

`server/test_settings.py`：

```python
import os
import unittest
from unittest.mock import patch

from server.settings import Settings


class DatabaseUrlTests(unittest.TestCase):
    def test_default_is_sqlite_from_db_path(self):
        s = Settings(db_path="/tmp/x/portal.sqlite3")
        self.assertEqual(s.resolved_database_url, "sqlite:////tmp/x/portal.sqlite3")

    def test_explicit_database_url_wins(self):
        s = Settings(db_path="/tmp/x/portal.sqlite3", database_url="postgresql://u:p@db:5432/portal")
        self.assertEqual(s.resolved_database_url, "postgresql://u:p@db:5432/portal")

    def test_db_path_may_already_be_a_url(self):
        s = Settings(db_path="postgresql://u:p@db:5432/portal")
        self.assertEqual(s.resolved_database_url, "postgresql://u:p@db:5432/portal")

    def test_from_env_reads_database_url(self):
        env = {"PC_PORTAL_DATABASE_URL": "postgresql://u:p@db:5432/portal", "PC_PORTAL_DB": "/data/portal.sqlite3"}
        with patch.dict(os.environ, env, clear=False):
            s = Settings.from_env()
        self.assertEqual(s.resolved_database_url, "postgresql://u:p@db:5432/portal")
        self.assertEqual(s.db_path, "/data/portal.sqlite3")

    def test_rejects_unknown_scheme(self):
        with self.assertRaises(ValueError):
            Settings(database_url="mysql://u:p@db/x")


if __name__ == "__main__":
    unittest.main()
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_settings 2>&1 | tail -4
```
Expected: FAIL／ERROR（`database_url` 不存在）。

- [ ] **Step 3: 實作**

`server/settings.py`：在 `db_path` 欄位下一行加 `database_url: str = ""`。在 `__post_init__` 最後加：

```python
        if self.database_url and not self.database_url.startswith(("sqlite:///", "postgresql://", "postgresql+psycopg://")):
            raise ValueError("PC_PORTAL_DATABASE_URL must be a sqlite:/// or postgresql:// URL")
```

在 `trial_available` 屬性前加：

```python
    @property
    def resolved_database_url(self):
        if self.database_url:
            return self.database_url
        if self.db_path.startswith(("sqlite:///", "postgresql://", "postgresql+psycopg://")):
            return self.db_path
        return "sqlite:///" + self.db_path
```

（`dataclass` 欄位叫 `database_url`，屬性不能同名，所以屬性叫 `resolved_database_url`；Step 2 的測試已經用這個名字。）

`from_env` 的 `cls(` 第一個參數後加一行：

```python
            database_url=os.environ.get("PC_PORTAL_DATABASE_URL", "").strip(),
```

`server/requirements.txt` 末尾加：

```
psycopg[binary]>=3.1,<4
sqlalchemy>=2.0,<3
alembic>=1.13,<2
```

`.gitignore` 加一行 `/.venv-portal/`。然後 `.venv-portal/bin/pip install -q -r server/requirements.txt`。

- [ ] **Step 4: 測試通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_settings -v 2>&1 | tail -8
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
.venv-portal/bin/python -c "import psycopg, sqlalchemy, alembic; print(psycopg.__version__, sqlalchemy.__version__)"
```
Expected: 5 ok；全量 `Ran 157 tests`、`OK`；版本字串印出。

- [ ] **Step 5: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
git add server/requirements.txt .gitignore server/settings.py server/test_settings.py
git commit -m "portal: add PC_PORTAL_DATABASE_URL and the Postgres/Alembic dependencies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: DB adapter `server/db.py`

**Files:**
- Create: `server/db.py`
- Create: `server/test_db.py`

**Interfaces:**
- Produces:
  - `class Database(target: str)`：屬性 `backend`（`"sqlite"`｜`"postgres"`）、`url`（Alembic 用的 SQLAlchemy URL：sqlite 為 `sqlite:///<path>`，postgres 為 `postgresql+psycopg://...`）、`path`（sqlite 才有，否則 `None`）、`IntegrityError`（例外類別）。
  - `Database.connect()`：contextmanager，yield `Connection`；正常離開 commit，例外 rollback，最後關閉。
  - `Connection.execute(sql: str, params: Sequence = ()) -> Cursor`；`Cursor.fetchone()`、`.fetchall()`、`.rowcount`。列物件支援 `row["col"]`、`row[0]`、`dict(row)`、`row.keys()`。
  - `Connection.execute("BEGIN IMMEDIATE")`：sqlite 原樣；postgres 改執行 `SELECT pg_advisory_xact_lock(7300001)`。
  - `Database.table_names() -> list[str]`（給測試與匯入工具）。
  - 模組函式 `translate_placeholders(sql: str) -> str`：`?`→`%s`，跳過單引號字串字面值內的 `?`。

- [ ] **Step 1: 失敗的測試**

`server/test_db.py`：

```python
import os
import tempfile
import unittest
from pathlib import Path

from server.db import Database, translate_placeholders


class PlaceholderTests(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(translate_placeholders("SELECT * FROM t WHERE a=? AND b=?"), "SELECT * FROM t WHERE a=%s AND b=%s")

    def test_skips_string_literals(self):
        self.assertEqual(translate_placeholders("SELECT 'what?' AS q FROM t WHERE a=?"), "SELECT 'what?' AS q FROM t WHERE a=%s")

    def test_escaped_quote_inside_literal(self):
        self.assertEqual(translate_placeholders("SELECT 'it''s ?' FROM t WHERE a=?"), "SELECT 'it''s ?' FROM t WHERE a=%s")


def _target(tmp):
    url = os.environ.get("PC_PORTAL_TEST_DATABASE_URL")
    return url if url else str(Path(tmp) / "db.sqlite")


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = Database(_target(self.directory.name))
        self.db.reset_for_tests()
        with self.db.connect() as con:
            con.execute("CREATE TABLE items (id TEXT PRIMARY KEY, n INTEGER NOT NULL, note TEXT)")

    def tearDown(self):
        self.directory.cleanup()

    def test_backend_and_url(self):
        if self.db.backend == "sqlite":
            self.assertTrue(self.db.url.startswith("sqlite:///"))
            self.assertTrue(self.db.path.endswith("db.sqlite"))
        else:
            self.assertTrue(self.db.url.startswith("postgresql+psycopg://"))
            self.assertIsNone(self.db.path)

    def test_rows_support_name_and_index(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, "x?"))
            row = con.execute("SELECT id, n, note FROM items WHERE id=?", ("a",)).fetchone()
        self.assertEqual(row["n"], 1)
        self.assertEqual(row[0], "a")
        self.assertEqual(dict(row), {"id": "a", "n": 1, "note": "x?"})
        self.assertEqual(list(row.keys()), ["id", "n", "note"])

    def test_count_fetchone_index_zero(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM items").fetchone()[0], 1)

    def test_rowcount_on_update(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
            self.assertEqual(con.execute("UPDATE items SET n=2 WHERE id=?", ("a",)).rowcount, 1)
            self.assertEqual(con.execute("UPDATE items SET n=2 WHERE id=?", ("zz",)).rowcount, 0)

    def test_rollback_on_exception(self):
        with self.assertRaises(RuntimeError):
            with self.db.connect() as con:
                con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
                raise RuntimeError("boom")
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM items").fetchone()[0], 0)

    def test_integrity_error_is_unified(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
        with self.assertRaises(self.db.IntegrityError):
            with self.db.connect() as con:
                con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 2, None))

    def test_begin_immediate_is_accepted(self):
        with self.db.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM items").fetchone()[0], 1)

    def test_case_with_cast_parameter(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, "keep"))
            con.execute("UPDATE items SET note=CASE WHEN CAST(? AS TEXT)='clear' THEN NULL ELSE note END WHERE id=?", ("clear", "a"))
            self.assertIsNone(con.execute("SELECT note FROM items WHERE id=?", ("a",)).fetchone()["note"])

    def test_table_names(self):
        self.assertIn("items", self.db.table_names())


if __name__ == "__main__":
    unittest.main()
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_db 2>&1 | tail -3
```
Expected: `ModuleNotFoundError: No module named 'server.db'`。

- [ ] **Step 2: 實作 `server/db.py`**

```python
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
        elif ch == "?" and not in_literal:
            out.append("%s")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


class Row(dict):
    """dict with positional access, matching what sqlite3.Row offered."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


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
            self.url = "sqlite:///" + path
            self.IntegrityError = sqlite3.IntegrityError
            Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)

    @contextmanager
    def connect(self):
        if self.backend == "postgres":
            import psycopg

            con = psycopg.connect(self._dsn, row_factory=_pg_row_factory)
            try:
                yield Connection(con, self.backend)
                con.commit()
            except BaseException:
                con.rollback()
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
            rows = con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
            return [r[0] for r in rows]

    def reset_for_tests(self):
        """Drop everything. Tests only. On SQLite the file is simply removed."""
        if self.backend == "postgres":
            with self.connect() as con:
                con.execute("DROP SCHEMA public CASCADE")
                con.execute("CREATE SCHEMA public")
            return
        Path(self.path).unlink(missing_ok=True)
```

- [ ] **Step 3: 測試通過（SQLite）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_db -v 2>&1 | tail -14
```
Expected: 12 個 `ok`（3 placeholder ＋ 9 database）。Postgres 版本的同一組測試在 Task 5 跑。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
git add server/db.py server/test_db.py
git commit -m "portal: add the SQLite/Postgres database adapter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Alembic baseline，`Store`／`RuntimeStore` 改走 migration

**Files:**
- Create: `server/migrations/alembic.ini`、`server/migrations/env.py`、`server/migrations/script.py.mako`、`server/migrations/versions/0001_baseline.py`
- Create: `server/migrate.py`
- Modify: `server/store.py:15-75`（刪 `SCHEMA`）、`:99-118`（`__init__`、`connect`）
- Modify: `server/runtime_store.py:27-76`（刪 `SCHEMA`）、`:163-166`（`__init__`）
- Create: `server/test_migrations.py`

**Interfaces:**
- Consumes: `server.db.Database`（Task 2）。
- Produces:
  - `server.migrate.upgrade_to_head(url: str) -> None`：對任一後端跑 Alembic 到 head。
  - `Store(target)`：`target` 是 sqlite 路徑、`sqlite:///` URL 或 `postgresql://` DSN。新屬性 `store.db`（`Database`）、`store.IntegrityError`、`store.path`（sqlite 才有，相容舊測試用 `Store(self.store.path)` 的寫法）。`store.connect()` 直接委派 `db.connect()`。
  - `RuntimeStore(store)` 不再建表。

- [ ] **Step 1: 失敗的測試**

`server/test_migrations.py`：

```python
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from server.db import Database
from server.migrate import upgrade_to_head

EXPECTED_TABLES = {
    "users", "sessions", "gateway_keys", "key_reservations", "credit_requests", "audit_events",
    "login_attempts", "trial_sessions", "trial_requests", "agents", "agent_versions",
    "runtime_tasks", "runtime_references", "runtime_events", "runtime_instructions",
    "runtime_approvals", "runtime_artifacts",
}


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        url = os.environ.get("PC_PORTAL_TEST_DATABASE_URL")
        self.db = Database(url if url else str(Path(self.directory.name) / "m.sqlite"))
        self.db.reset_for_tests()

    def tearDown(self):
        self.directory.cleanup()

    def test_head_creates_every_table(self):
        upgrade_to_head(self.db.url)
        self.assertEqual(set(self.db.table_names()) - {"alembic_version"}, EXPECTED_TABLES)

    def test_upgrade_is_idempotent(self):
        upgrade_to_head(self.db.url)
        upgrade_to_head(self.db.url)
        self.assertEqual(set(self.db.table_names()) - {"alembic_version"}, EXPECTED_TABLES)

    def test_sqlite_indexes_match_legacy_schema(self):
        if self.db.backend != "sqlite":
            self.skipTest("legacy comparison is SQLite-only")
        upgrade_to_head(self.db.url)
        with sqlite3.connect(self.db.path) as con:
            names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")}
        self.assertEqual(len(names), 13, names)


if __name__ == "__main__":
    unittest.main()
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_migrations 2>&1 | tail -3
```
Expected: `ModuleNotFoundError: No module named 'server.migrate'`。

- [ ] **Step 2: Alembic 骨架**

`server/migrations/alembic.ini`：

```ini
[alembic]
script_location = %(here)s
prepend_sys_path = ..
```

`server/migrations/script.py.mako`（Alembic 標準樣板）：

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade():
    ${upgrades if upgrades else "pass"}


def downgrade():
    ${downgrades if downgrades else "pass"}
```

`server/migrations/env.py`：

```python
from alembic import context
from sqlalchemy import create_engine, pool

config = context.config


def run_migrations_online():
    url = config.get_main_option("sqlalchemy.url")
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
```

`server/migrate.py`：

```python
"""Programmatic Alembic entrypoint: Store() calls this at startup on both backends."""
from pathlib import Path

from alembic import command
from alembic.config import Config

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def _config(url: str) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def upgrade_to_head(url: str) -> None:
    command.upgrade(_config(url), "head")
```

- [ ] **Step 3: baseline migration `server/migrations/versions/0001_baseline.py`**

內容規則：把 `server/store.py:15-75` 的 `SCHEMA` 字串與 `server/runtime_store.py:27-76` 的 `SCHEMA` 字串**原文**搬進來（先 store 的、再 runtime 的，順序不能變，因為 runtime 的表有 `REFERENCES users/agents`），用分號切成語句後逐條 `op.execute()`。對 Postgres 做三個字面替換：

```python
"""baseline: the portal schema as it existed in SQLite on 2026-10-08

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-08
"""
import re

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

# Verbatim copy of server/store.py SCHEMA (2026-10-08) followed by server/runtime_store.py SCHEMA.
# Do not edit these strings; add a new migration instead.
STORE_SCHEMA = """<貼 store.py 的 SCHEMA 原文>"""

RUNTIME_SCHEMA = """<貼 runtime_store.py 的 SCHEMA 原文>"""


def _portable(statement: str, dialect: str) -> str:
    if dialect != "postgresql":
        return statement
    statement = re.sub(r"INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY", statement)
    statement = re.sub(r"\bREAL\b", "DOUBLE PRECISION", statement)
    statement = re.sub(r"\bBLOB\b", "BYTEA", statement)
    return statement


def _statements(schema: str):
    for raw in schema.split(";"):
        statement = raw.strip()
        if statement:
            yield statement


def upgrade():
    dialect = op.get_bind().dialect.name
    for schema in (STORE_SCHEMA, RUNTIME_SCHEMA):
        for statement in _statements(schema):
            op.execute(_portable(statement, dialect))


def downgrade():
    raise RuntimeError("baseline cannot be downgraded; restore from backup instead")
```

兩個 `<貼 … 原文>` 用實際字串取代（這是本計畫唯一允許「參照既有程式碼內容」的地方，因為原文就在 repo 裡）。貼完後確認：`grep -c 'CREATE TABLE' server/migrations/versions/0001_baseline.py` 為 17、`grep -c 'CREATE INDEX' ...` 為 13。

- [ ] **Step 4: `Store` 與 `RuntimeStore` 改寫**

`server/store.py`：
- 刪掉 `SCHEMA = """..."""`（L15-75）。
- `import sqlite3` 保留與否看其他用途；若只剩 connect 用到就刪。
- `class Store` 的 `__init__` 與 `connect` 改成：

```python
class Store:
    def __init__(self, target):
        self.db = Database(target)
        self.path = self.db.path
        self.IntegrityError = self.db.IntegrityError
        upgrade_to_head(self.db.url)
        if self.db.backend == "sqlite" and self.path:
            os.chmod(self.path, 0o600)

    def connect(self):
        return self.db.connect()
```

頂部加 `from .db import Database` 與 `from .migrate import upgrade_to_head`（照該檔既有的相對／絕對 import 風格；`server/` 下其他檔怎麼 import 就怎麼寫）。

`server/runtime_store.py`：刪 `SCHEMA`（L27-76）；`__init__` 改成只做 `self.store = store`。

- [ ] **Step 5: 測試通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_migrations -v 2>&1 | tail -6
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
```
Expected: 3 ok；全量 `Ran 172 tests`（157＋12＋3）、`OK`。若 `test_runtime_store.py` 之類因為 `RuntimeStore` 不再建表而失敗，那表示有測試只建 `Store` 卻沒期待 runtime 表——Store 現在一次建全部，應該反而更穩；真的失敗就回報。

- [ ] **Step 6: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
git add server/migrations server/migrate.py server/store.py server/runtime_store.py server/test_migrations.py
git commit -m "portal: move the schema into an Alembic baseline and run it from Store()

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 把 raw SQL 呼叫點搬到 adapter（app.py、agents.py、manage.py、runtime_store.py）

**Files:**
- Modify: `server/app.py:4`（`import sqlite3` 刪）、`:183`（IntegrityError）、`:231`（SUM）、`:480`（rowid）
- Modify: `server/manage.py:9`（`import sqlite3` 刪）、`:59`（IntegrityError）
- Modify: `server/runtime_store.py:344`、`:397`、`:492`（`CASE WHEN ?=` 加 CAST）
- Modify: `server/agents.py`（只確認沒有 `sqlite3` 引用；SQL 不動）
- Test: 既有 152 個測試

**Interfaces:**
- Consumes: `store.IntegrityError`（Task 3）。
- Produces: 整個 `server/` 不再 `import sqlite3`（測試檔除外，Task 5 處理）。

- [ ] **Step 1: 列出要改的點（確認與盤點一致）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
grep -n 'sqlite3' server/*.py | grep -v '^server/test_\|^server/db.py'
grep -n 'rowid\|CASE WHEN ?=' server/*.py | grep -v '^server/test_'
grep -n 'COALESCE(SUM' server/app.py
```
Expected: `app.py:4`、`app.py:183`、`manage.py:9`、`manage.py:59`；`app.py:480` 的 rowid；`runtime_store.py` 三處 CASE；`app.py:231`。

- [ ] **Step 2: 改**

- `server/app.py:76` `Store(settings.db_path)` → `Store(settings.resolved_database_url)`；`server/manage.py:51` 同樣改成 `Store(Settings.from_env().resolved_database_url)`。
- `server/app.py:4` 刪 `import sqlite3`；`:183` `except sqlite3.IntegrityError:` → `except store.IntegrityError:`。
- `server/app.py:231`：`approved = int(con.execute(...).fetchone()[0] or 0)`（Postgres 的 SUM 回 Decimal）。
- `server/app.py:480`：`ORDER BY a.created_at DESC,a.rowid DESC` → `ORDER BY a.created_at DESC,a.id DESC`。
- `server/manage.py:9` 刪 `import sqlite3`；`:59` → `except store.IntegrityError:`。注意 `store` 在 `try` 內才建立；把 `store = Store(...)` 搬到 `try` 之前（`Store()` 本身不會丟 IntegrityError），`except` 才拿得到它。
- `server/runtime_store.py:344`、`:397`、`:492`：每個 `CASE WHEN ?=` 改成 `CASE WHEN CAST(? AS TEXT)=`（參數順序不變）。

- [ ] **Step 3: 全量測試（SQLite）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
grep -rn 'import sqlite3' server/*.py | grep -v '^server/test_\|^server/db.py'
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
```
Expected: grep 無輸出；`Ran 172 tests`、`OK`。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
git add server/app.py server/manage.py server/runtime_store.py
git commit -m "portal: route every raw SQL call through the adapter; drop sqlite3-specific code paths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 測試支援層、Postgres 測試環境、第一次在 Postgres 上跑全量

**Files:**
- Create: `server/testsupport.py`
- Modify: `server/test_portal.py:72-101`、`server/test_agents.py:33-41,70-72`、`server/test_runtime_api.py:20-41,134`、`server/test_trial_chat.py:34-46`、`server/test_runtime_store.py:15-25,49,136`、`server/test_runtime_engine.py:57-66,80-83`
- Create: `server/docker-compose.test.yml`
- Create: `scripts/test_backend_postgres.sh`
- Create: `.github/workflows/portal-backend.yml`

**Interfaces:**
- Produces: `server.testsupport.fresh_database(tmpdir: str) -> str`：回 `Store()` 可吃的 target；有 `PC_PORTAL_TEST_DATABASE_URL` 就先 `reset_for_tests()` 再回該 URL，否則回 `<tmpdir>/portal.sqlite`。`server.testsupport.rows(store, table) -> list[dict]`。

- [ ] **Step 1: `server/testsupport.py`**

```python
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
        return [dict(r) for r in con.execute("SELECT * FROM " + table).fetchall()]
```

- [ ] **Step 2: 測試檔改用 helper（每檔改法相同）**

每個測試類的 `setUp` 裡，建 DB 路徑的那一行改成 `self.database = fresh_database(self.directory.name)`（`test_runtime_store.py`、`test_runtime_engine.py` 是 `Store(fresh_database(self.directory.name))`）。
- `test_portal.py:99-101` 與 `test_agents.py:70-72` 的 `db_rows` 改成 `return rows(self.app.state.store, table)`（`test_agents` 若沒有 `app`，用它自己的 `store`）。
- `test_runtime_store.py:49,136` 的 `Store(self.store.path)` 改成 `Store(self.database)`（先在 `setUp` 存 `self.database`）。
- `test_runtime_engine.py:80-83`：`sqlite_master` 那段改成

```python
        for table in self.store.db.table_names():
            if table.startswith("runtime_"):
                with self.store.connect() as connection:
                    rows_ = [dict(row) for row in connection.execute('SELECT * FROM "' + table + '"').fetchall()]
                self.assertNotIn(KEY, str(rows_))
```

- `test_portal.py:596` 重建 app 的地方沿用同一個 `self.settings`（不變）。
- 刪掉測試檔裡不再用的 `import sqlite3`。

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
grep -rn 'sqlite3\|sqlite_master' server/test_*.py
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
```
Expected: grep 只剩 `test_migrations.py`（刻意的 SQLite 比對）；`Ran 172 tests`、`OK`。

- [ ] **Step 3: Postgres 測試環境**

`server/docker-compose.test.yml`：

```yaml
services:
  portal-test-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: portal
      POSTGRES_PASSWORD: portal-test
      POSTGRES_DB: portal_test
    ports:
      - "54329:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U portal -d portal_test"]
      interval: 2s
      timeout: 2s
      retries: 30
```

`scripts/test_backend_postgres.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PY:-.venv-portal/bin/python}"
docker compose -f server/docker-compose.test.yml up -d --wait
trap 'docker compose -f server/docker-compose.test.yml down -v >/dev/null 2>&1 || true' EXIT
export PC_PORTAL_TEST_DATABASE_URL="postgresql://portal:portal-test@127.0.0.1:54329/portal_test"
"$PY" -m unittest discover -s server -t . -p 'test_*.py' "$@"
```

`chmod +x scripts/test_backend_postgres.sh`。

`.github/workflows/portal-backend.yml`：

```yaml
name: portal-backend
on:
  push:
    paths: ["server/**", "scripts/test_backend_postgres.sh", ".github/workflows/portal-backend.yml"]
  pull_request:
    paths: ["server/**", "scripts/test_backend_postgres.sh", ".github/workflows/portal-backend.yml"]
jobs:
  sqlite:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r server/requirements.txt
      - run: python -m unittest discover -s server -t . -p 'test_*.py'
  postgres:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgres:16-alpine
        env: { POSTGRES_USER: portal, POSTGRES_PASSWORD: portal-test, POSTGRES_DB: portal_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U portal -d portal_test" --health-interval 2s --health-timeout 2s --health-retries 30
    env:
      PC_PORTAL_TEST_DATABASE_URL: postgresql://portal:portal-test@127.0.0.1:5432/portal_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r server/requirements.txt
      - run: python -m unittest discover -s server -t . -p 'test_*.py'
```

- [ ] **Step 4: 【使用者執行一次】開 Docker Desktop**，然後 agent 跑：

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
docker info >/dev/null 2>&1 && echo docker-up || echo docker-down
scripts/test_backend_postgres.sh 2>&1 | tail -30
```
Expected: `Ran 172 tests`、`OK`。**第一次幾乎一定會紅**：預期要修的方言問題（依盤點）：
- 把 `float` 寫進 `INTEGER` 欄位（Postgres 不接受 `double precision` 指派給 `integer` 時會錯）：在寫入點用 `int(...)`，不改 SQL。
- `INSERT INTO t VALUES (...)` 欄位數對不上：代表 migration 貼的 SCHEMA 與原文不一致，回頭對 `0001_baseline.py`。
- `DROP SCHEMA public CASCADE` 權限：測試 DB 的 owner 就是 `portal`，不該出錯；出錯就回報。
每修一處，先跑該測試檔，再跑整個腳本；SQLite 全量也要重跑確認仍綠。修了什麼逐條記進報告。

- [ ] **Step 5: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
git add server/testsupport.py server/test_*.py server/docker-compose.test.yml scripts/test_backend_postgres.sh .github/workflows/portal-backend.yml
git add server/*.py
git commit -m "portal: run the backend suite on Postgres too (docker compose harness + CI)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
（第二個 `git add server/*.py` 是為了 Step 4 的方言修正；commit 前 `git diff --cached --stat` 看一眼沒有夾帶 `tsconfig.tsbuildinfo`。）

---

### Task 6: SQLite → Postgres 匯入工具

**Files:**
- Create: `server/import_sqlite.py`
- Create: `server/test_import_sqlite.py`

**Interfaces:**
- Produces: CLI `python -m server.import_sqlite --source /data/portal.sqlite3 --target <DSN or path> [--skip sessions,login_attempts]`；模組函式 `import_database(source_path: str, target: str, skip: set[str]) -> dict[str, tuple[int, int]]`（每表 `(來源列數, 目標列數)`）。目標必須已由 `Store(target)` 建好 schema 且所有要匯入的表為空，否則 `SystemExit(2)`。Postgres 目標在匯入後重設 `runtime_*` 的 `sequence` 序列。

- [ ] **Step 1: 失敗的測試**

`server/test_import_sqlite.py`：

```python
import tempfile
import unittest
from pathlib import Path

from server.import_sqlite import import_database
from server.store import Store
from server.testsupport import fresh_database, rows


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.source = str(Path(self.directory.name) / "source.sqlite")
        src = Store(self.source)
        self.user = src.create_user("imp@example.test", "Imp", "import-test-password!")
        with src.connect() as con:
            src.audit(con, "test.event", self.user["id"], None)
        src.consume_attempt("login:import-test", limit=5, window=60)  # writes one login_attempts row
        self.assertEqual(len(rows(src, "login_attempts")), 1)
        self.target = fresh_database(self.directory.name)
        self.store = Store(self.target)

    def tearDown(self):
        self.directory.cleanup()

    def test_copies_users_and_audit(self):
        counts = import_database(self.source, self.target, skip={"sessions", "login_attempts"})
        self.assertEqual(counts["users"], (1, 1))
        self.assertEqual(counts["audit_events"], (1, 1))
        self.assertEqual(rows(self.store, "users")[0]["email"], "imp@example.test")

    def test_refuses_non_empty_target(self):
        import_database(self.source, self.target, skip={"sessions", "login_attempts"})
        with self.assertRaises(SystemExit):
            import_database(self.source, self.target, skip={"sessions", "login_attempts"})

    def test_skipped_tables_stay_empty(self):
        counts = import_database(self.source, self.target, skip={"sessions", "login_attempts"})
        self.assertNotIn("login_attempts", counts)
        self.assertEqual(rows(self.store, "login_attempts"), [])


if __name__ == "__main__":
    unittest.main()
```

（`consume_attempt` 的簽章以 `server/store.py:159` 為準；若參數名不同，照實際簽章呼叫，語意是「對這個 scope 記一次嘗試」。）

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_import_sqlite 2>&1 | tail -3
```
Expected: `ModuleNotFoundError: No module named 'server.import_sqlite'`。

- [ ] **Step 2: 實作 `server/import_sqlite.py`**

```python
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
```

注意 `setval` 那條 SQL 用 `?` 當參數（adapter 會轉 `%s`）；`pg_get_serial_sequence` 的第一個參數是表名字串。BYTEA 欄位（`runtime_tasks.encrypted_key`）從 sqlite 讀出來是 `bytes`，psycopg 直接接受。

- [ ] **Step 3: 測試通過（SQLite 與 Postgres 兩種目標）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
.venv-portal/bin/python -m unittest server.test_import_sqlite -v 2>&1 | tail -6
scripts/test_backend_postgres.sh server.test_import_sqlite 2>&1 | tail -6
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
```
Expected: 3 ok（兩種後端）；全量 `Ran 175 tests`、`OK`。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
git add server/import_sqlite.py server/test_import_sqlite.py
git commit -m "portal: add the SQLite -> Postgres import tool with count verification

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 部署設定、文件、切換 runbook

**Files:**
- Modify: `docker-compose.dokploy.yml`（portal 服務 env、`depends_on`；新增 `powerchampion-db` 服務；新增 volume `portal-pg-data`）
- Modify: `docs/portal-operations.md:22,83,136`、`server/README.md:6,43,60,105-109,163,184-187`
- Create: `docs/deploy/a1-postgres-cutover.md`
- Test: `tests/deploy-config.test.ts`（既有，可能斷言 compose 結構；跑它）

- [ ] **Step 1: compose**

在 `powerchampion-portal` 的 `environment` 區塊加兩行（`PC_PORTAL_DB` 保留，作為回滾用）：

```yaml
      # A1: Postgres is the account database. Leave PC_PORTAL_DATABASE_URL empty to fall
      # back to the SQLite file in /data (rollback path); see docs/deploy/a1-postgres-cutover.md.
      PC_PORTAL_DATABASE_URL: ${PC_PORTAL_DATABASE_URL:-}
```

在 `powerchampion-portal` 加：

```yaml
    depends_on:
      powerchampion-db:
        condition: service_healthy
```

在 `powerchampion-portal` 之後加服務：

```yaml
  powerchampion-db:
    image: postgres:16-alpine
    container_name: powerchampion-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: portal
      POSTGRES_DB: portal
      POSTGRES_PASSWORD: ${PC_PORTAL_DB_PASSWORD:?set PC_PORTAL_DB_PASSWORD in Dokploy}
    volumes:
      - portal-pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U portal -d portal"]
      interval: 10s
      timeout: 5s
      retries: 12
    # Internal only: no ports, no Traefik labels, default network only.
    networks:
      - default
```

`volumes:` 加 `portal-pg-data:`。

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
PC_PORTAL_DB_PASSWORD=x docker compose -f docker-compose.dokploy.yml config >/dev/null && echo COMPOSE_OK
npx vitest run tests/deploy-config.test.ts 2>&1 | tail -5
```
Expected: `COMPOSE_OK`；deploy-config 測試綠（若它斷言服務數或 env 清單，更新該測試的期望值並在報告說明）。

- [ ] **Step 2: 文件**

- `docs/portal-operations.md`：L22 改成「帳號資料存在 Postgres（Dokploy 內網服務 `powerchampion-db`，volume `portal-pg-data`）；本機開發預設仍用 `.local/portal.sqlite3`，設 `PC_PORTAL_DATABASE_URL` 可切換」；L83 補 Postgres volume 的 Dokploy Volume Backup；L136 補「`scripts/test_backend_postgres.sh` 可在 Postgres 上跑同一套測試」。
- `server/README.md`：環境變數表加 `PC_PORTAL_DATABASE_URL`、`PC_PORTAL_TEST_DATABASE_URL`；L6、L43、L60、L163 的 SQLite 描述改成「Postgres（生產）／SQLite（開發、測試）」；L105-109 的驗證指令改成 `npm run test:backend` 與 `scripts/test_backend_postgres.sh`；L184-187 備份段落加「Postgres 備份見 docs/deploy/a1-postgres-cutover.md 的 pg_dump 指令」。
- 新檔 `docs/deploy/a1-postgres-cutover.md`：

```markdown
# A1 cutover: portal SQLite -> Postgres (Dokploy)

All commands run in the Dokploy UI: compose "Power Champion Marketplace" -> **Open Terminal** on the
named container. Nothing here needs SSH.

## 0. Preconditions
- `a1/portal-postgres` merged to `main`, CI (portal-backend: sqlite + postgres) green.
- Dokploy env for the compose has `PC_PORTAL_DB_PASSWORD=<strong random>` and **no** `PC_PORTAL_DATABASE_URL` yet.

## 1. Deploy the compose (adds `powerchampion-db`, portal still on SQLite)
Deploy. Verify: `powerchampion-db` container healthy; portal `/api/portal/health` still 200; a customer can log in.

## 2. Freeze and back up SQLite (portal container terminal)
    cp /data/portal.sqlite3 /data/portal.sqlite3.pre-pg-$(date +%Y%m%d)
    chmod 400 /data/portal.sqlite3.pre-pg-*
Keep the backup for 90 days. From here until step 5 no customer writes should happen: announce a short maintenance window.

## 3. Import (portal container terminal)
    python -m server.import_sqlite --source /data/portal.sqlite3 --target "postgresql://portal:${PC_PORTAL_DB_PASSWORD}@powerchampion-db:5432/portal"
Every table line must read `source=N target=N` with no MISMATCH; `sessions` and `login_attempts` are skipped on purpose (everyone re-logs in).
If it exits 2 ("target table is not empty"), the import already ran: do not run it twice.

## 4. Switch
Dokploy env: add `PC_PORTAL_DATABASE_URL=postgresql://portal:<same password>@powerchampion-db:5432/portal`. Deploy.

## 5. Verify
- `/api/portal/health` 200.
- Log in with an existing customer account (old password). Keys, credits, agents listed as before.
- Admin: customers count equals the `users` line from step 3.
- In the db container terminal: `psql -U portal -d portal -c "select count(*) from users;"` equals the same number.

## 6. Rollback (any time)
Remove `PC_PORTAL_DATABASE_URL` from Dokploy env, deploy. The portal reads `/data/portal.sqlite3` again.
Writes made while on Postgres are lost; that is the accepted trade-off (spec §5.2).

## 7. Backups going forward
Dokploy -> compose -> Volume Backups: add `portal-pg-data` (daily). Manual dump from the db container:
    pg_dump -U portal -d portal -Fc -f /var/lib/postgresql/data/portal-$(date +%Y%m%d).dump
```

- [ ] **Step 3: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres
git add docker-compose.dokploy.yml docs/portal-operations.md server/README.md docs/deploy/a1-postgres-cutover.md tests/deploy-config.test.ts
git commit -m "deploy: add the portal Postgres service and the SQLite cutover runbook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 【使用者執行】push、PR、merge、Dokploy 切換；agent 驗證

**Files:** 無新檔；驗證紀錄寫到 `docs/deploy/a1-postgres-cutover-verification.md`（agent 在切換後補）。

- [ ] **Step 1: 【使用者執行】push 與 PR**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres && git push -u origin a1/portal-postgres
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a1-portal-postgres && gh pr create --base main --head a1/portal-postgres --title "A1: portal on Postgres (adapter, Alembic baseline, import tool)" --body-file docs/deploy/a1-postgres-cutover.md
```

agent 等 `portal-backend` workflow 兩個 job 綠（`gh pr checks <n> --watch`），再請使用者 `gh pr merge <n> --merge --delete-branch=false`。**注意：行銷站 compose 的 Autodeploy 是開的（PR #2 合併後自動部署過），merge 即部署步驟 1。** merge 前使用者先在 Dokploy env 設好 `PC_PORTAL_DB_PASSWORD`。

- [ ] **Step 2: 【使用者執行】runbook 步驟 1–5**，每步把輸出貼給 agent。agent 逐步核對：步驟 3 的計數表全部相等；步驟 5 的 users 數與步驟 3 一致。

- [ ] **Step 3: agent 外部驗證**

```bash
curl -s -o /dev/null -w 'health %{http_code}\n' -m 10 https://powerchampion.ai/api/portal/health
curl -s -o /dev/null -w 'login page %{http_code}\n' -m 10 https://powerchampion.ai/login
```
Expected: 兩個 200。登入後的頁面需要帳號，由使用者確認。

- [ ] **Step 4: 驗證紀錄**

`docs/deploy/a1-postgres-cutover-verification.md`：日期、PR 號、部署 commit、步驟 3 的計數表原文、步驟 5 的 users 數、是否回滾。commit 到 `main`（docs-only，由使用者 push）。

- [ ] **Step 5: 收尾**

- 更新 spec §5.2 狀態為「已完成（日期）」；記憶檔 `unified-admin-2026-10.md` 補 A1 完成與 `PC_PORTAL_DATABASE_URL` 的事實；移除 worktree `.worktrees/a1-portal-postgres`（分支保留）。

---

## 自我檢查（對照 spec §5.2 與驗收）

- Postgres 服務內網不開 port → Task 7 compose（無 ports、無 Traefik、default 網路）。
- `PC_PORTAL_DATABASE_URL` → Task 1。
- 手寫 SQL 走 SQLAlchemy Core＋Alembic、簽章不變 → 機制改為 adapter（Global Constraints 說明理由）；Alembic 管 DDL → Task 3；簽章不變 → Task 3/4 沒有改任何 `def`。
- 遷移匯入全部表、`sessions`／`login_attempts` 可不匯入 → Task 6 `ORDER` 17 張表、預設 skip 那兩張。
- 切換步驟：停 → 備份 → 匯入 → 起 → 回滾策略 → Task 7 runbook §2–6。
- 驗收：乾淨 Postgres 從零升到 head → Task 3 測試（PG 模式）；既有 SQLite 匯入 → Task 6；兩種情境測試全綠 → Task 5 腳本與 CI；每表列數相等 → 匯入工具輸出；舊密碼能登入 → runbook §5。
- 未覆蓋而刻意不做：連線池（Global Constraints 說明）、SQLAlchemy 查詢改寫（同上）。
