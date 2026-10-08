import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from server.db import Database
from server.migrate import downgrade_to, upgrade_to_head

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

    def test_store_on_pre_alembic_sqlite_keeps_data(self):
        if self.db.backend != "sqlite":
            self.skipTest("pre-Alembic files only exist on SQLite")
        import importlib
        from server.store import Store
        baseline = importlib.import_module("server.migrations.versions.0001_baseline")
        path = str(Path(self.directory.name) / "legacy.sqlite")
        # The baseline strings are a verbatim copy of the pre-Alembic schema.
        legacy = sqlite3.connect(path)
        legacy.executescript(baseline.STORE_SCHEMA)
        legacy.executescript(baseline.RUNTIME_SCHEMA)
        legacy.execute("INSERT INTO users VALUES (?,?,?,?,?,?)",
                       ("u1", "u1@example.test", "u1", "unused", "customer", 1))
        legacy.commit()
        legacy.close()
        for _ in range(2):  # the second open must be a no-op
            store = Store(path)
            with store.connect() as con:
                self.assertEqual(con.execute("SELECT email FROM users WHERE id='u1'").fetchone()[0], "u1@example.test")
                self.assertEqual([r[0] for r in con.execute("SELECT version_num FROM alembic_version").fetchall()], ["0002_users_disabled_at"])

    def _columns(self, store, table):
        with store.connect() as con:
            if self.db.backend == "sqlite":
                return {r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}
            return {r[0] for r in con.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=?", (table,)).fetchall()}

    def _versions(self, store):
        with store.connect() as con:
            return [r[0] for r in con.execute("SELECT version_num FROM alembic_version").fetchall()]

    def test_downgrade_to_baseline_round_trips(self):
        from server.store import Store
        store = Store(self.db.url)
        self.assertEqual(self._versions(store), ["0002_users_disabled_at"])
        self.assertIn("disabled_at", self._columns(store, "users"))
        with store.connect() as con:
            con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at,disabled_at) VALUES (?,?,?,?,?,?,?)",
                        ("u1", "u1@example.test", "u1", "unused", "customer", 1, 1700000000))
        downgrade_to(self.db.url, "0001_baseline")
        self.assertEqual(self._versions(store), ["0001_baseline"])
        self.assertNotIn("disabled_at", self._columns(store, "users"))
        with store.connect() as con:
            self.assertEqual(con.execute("SELECT email FROM users WHERE id='u1'").fetchone()[0], "u1@example.test")
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), ["0002_users_disabled_at"])
        self.assertIn("disabled_at", self._columns(store, "users"))
        with store.connect() as con:
            self.assertIsNone(con.execute("SELECT disabled_at FROM users WHERE id='u1'").fetchone()[0])

    def test_percent_in_url_does_not_break_config(self):
        if self.db.backend != "sqlite":
            self.skipTest("path-based check")
        from server.store import Store
        from pathlib import Path
        target = str(Path(self.directory.name) / "pct%20dir" / "p.sqlite")
        Store(target)  # must not raise
        self.assertTrue(Path(target).exists())


if __name__ == "__main__":
    unittest.main()
