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
        # create_user already writes an "account.registered" audit row, plus the explicit "test.event".
        self.assertEqual(counts["audit_events"], (2, 2))
        self.assertEqual({r["action"] for r in rows(self.store, "audit_events")}, {"account.registered", "test.event"})
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
