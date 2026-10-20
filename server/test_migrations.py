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
    "runtime_approvals", "runtime_artifacts", "alloc_engineers", "alloc_nodes", "alloc_meta",
}
HEAD = "0003_node_allocation"


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
        # 13 legacy indexes + alloc_nodes_engineer (0003)
        self.assertEqual(len(names), 14, names)

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
                self.assertEqual([r[0] for r in con.execute("SELECT version_num FROM alembic_version").fetchall()], [HEAD])

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
        self.assertEqual(self._versions(store), [HEAD])
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
        self.assertEqual(self._versions(store), [HEAD])
        self.assertIn("disabled_at", self._columns(store, "users"))
        with store.connect() as con:
            self.assertIsNone(con.execute("SELECT disabled_at FROM users WHERE id='u1'").fetchone()[0])

    def test_node_allocation_seed_and_downgrade(self):
        from server.store import Store
        store = Store(self.db.url)
        with store.connect() as con:
            nodes = {r["name"]: r for r in con.execute("SELECT * FROM alloc_nodes").fetchall()}
            engineers = {r["id"]: r["username"] for r in con.execute("SELECT * FROM alloc_engineers").fetchall()}
            self.assertEqual(con.execute("SELECT revision FROM alloc_meta WHERE id=1").fetchone()[0], 1)
        self.assertEqual(len(nodes), 16)
        self.assertEqual(sorted(n for n, r in nodes.items() if r["role"] == "selling"), ["b300-14", "b300-31"])
        self.assertEqual([n for n, r in nodes.items() if r["role"] == "reserved"], [])
        self.assertEqual(sorted(engineers.values()), ["justin", "ll", "mwind", "nati", "zhuling"])
        self.assertEqual(sorted(n for n, r in nodes.items() if engineers.get(r["engineer_id"]) == "ll"), ["b300-29", "b300-30"])
        self.assertIn("details", self._columns(store, "audit_events"))
        downgrade_to(self.db.url, "0002_users_disabled_at")
        self.assertEqual(self._versions(store), ["0002_users_disabled_at"])
        self.assertFalse({"alloc_engineers", "alloc_nodes", "alloc_meta"} & set(self.db.table_names()))
        self.assertNotIn("details", self._columns(store, "audit_events"))
        upgrade_to_head(self.db.url)
        with store.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM alloc_nodes").fetchone()[0], 16)

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
