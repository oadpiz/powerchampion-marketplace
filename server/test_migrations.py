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
