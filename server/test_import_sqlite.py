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

    def test_missing_source_exits_2(self):
        missing = Path(self.directory.name) / "nope.sqlite"
        with self.assertRaises(SystemExit) as raised:
            import_database(str(missing), self.target, skip=set())
        self.assertEqual(raised.exception.code, 2)
        self.assertFalse(missing.exists())

    def test_child_tables_blob_and_sequences_round_trip(self):
        src = Store(self.source)
        uid = self.user["id"]
        blob = b"\x00\xff\xfe"
        with src.connect() as con:
            con.execute("INSERT INTO agents (id,user_id,name,status,current_version,token_hash,token_prefix,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                        ("agent-1", uid, "Helper", "active", 1, "hash-1", "pca_abc", 1700000000, 1700000000))
            con.execute("INSERT INTO agent_versions (agent_id,version,model,purpose,instructions,tone,knowledge,sample_prompt,system_prompt,max_output_tokens,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        ("agent-1", 1, "model-x", "purpose", "instructions", "tone", "knowledge", "sample", "system", 512, 1700000000))
            con.execute("INSERT INTO runtime_tasks (id,owner_id,goal,model,status,created_at,updated_at,max_steps,max_output_tokens) VALUES (?,?,?,?,?,?,?,?,?)",
                        ("task-1", uid, "goal", "model-x", "completed", 1700000000.5, 1700000001.5, 5, 256))
            for seq in (40, 41):
                con.execute("INSERT INTO runtime_events (sequence,id,task_id,kind,title,content,created_at) VALUES (?,?,?,?,?,?,?)",
                            (seq, "event-%d" % seq, "task-1", "note", "t", "c", 1700000002.0))
            con.execute("INSERT INTO runtime_artifacts (id,task_id,call_id,name,mime_type,size,content,created_at) VALUES (?,?,?,?,?,?,?,?)",
                        ("artifact-1", "task-1", "call-1", "a.bin", "application/octet-stream", len(blob), blob, 1700000003.0))
        counts = import_database(self.source, self.target, skip={"sessions", "login_attempts"})
        for table, expected in (("agents", 1), ("agent_versions", 1), ("runtime_tasks", 1), ("runtime_events", 2), ("runtime_artifacts", 1)):
            self.assertEqual(counts[table], (expected, expected), table)
        artifacts = rows(self.store, "runtime_artifacts")
        self.assertEqual(bytes(artifacts[0]["content"]), blob)
        self.assertEqual({r["sequence"] for r in rows(self.store, "runtime_events")}, {40, 41})
        if self.store.db.backend != "postgres":
            return
        with self.store.connect() as con:
            con.execute("INSERT INTO runtime_events (id,task_id,kind,title,content,created_at) VALUES (?,?,?,?,?,?)",
                        ("event-new", "task-1", "note", "t", "c", 1700000004.0))
        new = [r for r in rows(self.store, "runtime_events") if r["id"] == "event-new"]
        self.assertEqual(new[0]["sequence"], 42)


if __name__ == "__main__":
    unittest.main()
