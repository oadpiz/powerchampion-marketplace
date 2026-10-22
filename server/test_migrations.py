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
    "studio_accounts", "studio_projects", "studio_ops", "studio_ledger", "studio_rate",
}
VOICE_TABLES = {"voice_stores", "voice_store_hours", "voice_store_closures", "voice_faqs", "voice_config_versions", "voice_numbers"}
# 0009's three tables and 0011's deletion requests
CALL_TABLES = {"voice_calls", "voice_call_reviews", "voice_listening_logs", "voice_deletion_requests"}
EXPECTED_TABLES = EXPECTED_TABLES | VOICE_TABLES | CALL_TABLES
HEAD = "0011_voice_deletions"
AUDIT_INDEXES = ["audit_events_action_actor_time", "audit_events_action_target_time"]


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
        # 13 legacy indexes + alloc_nodes_engineer (0003) + 5 studio indexes (0005)
        # + voice_faqs_store, voice_numbers_number (0007)
        # + audit_events_action_target_time (0008) + voice_calls_store_time, voice_calls_time, voice_calls_number,
        # audit_events_action_actor_time (0009) + voice_calls_content_expiry, voice_calls_recording_expiry,
        # voice_deletion_requests_status_seq (0011)
        self.assertEqual(len(names), 29, names)
        self.assertLessEqual({"ux_studio_ops_active", "ix_studio_ops_state", "ix_studio_ops_user_state",
                              "ix_studio_projects_user_created", "ix_studio_ledger_user_created"}, names)

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

    def test_engineer_account_link_upgrade_and_downgrade(self):
        from server.store import Store
        store = Store(self.db.url)
        added = {"user_id", "key_updated_revision", "key_updated_by", "key_previous_fingerprint"}
        self.assertLessEqual(added, self._columns(store, "alloc_engineers"))
        self.assertIn("password_change_required_at", self._columns(store, "users"))
        with store.connect() as con:
            con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
                        ("u1", "justin@oadpiz.com", "justin", "unused", "customer", 1))
            con.execute("UPDATE alloc_engineers SET user_id='u1',key_updated_revision=1,key_updated_by='engineer' WHERE username='justin'")
        # one account stands for at most one engineer; the link must point at a real user
        for sql in ("UPDATE alloc_engineers SET user_id='u1' WHERE username='mwind'",
                    "UPDATE alloc_engineers SET user_id='nobody' WHERE username='mwind'",
                    "UPDATE alloc_engineers SET key_updated_by='someone' WHERE username='mwind'"):
            with self.assertRaises(store.IntegrityError, msg=sql):
                with store.connect() as con:
                    con.execute(sql)
        downgrade_to(self.db.url, "0003_node_allocation")
        self.assertEqual(self._versions(store), ["0003_node_allocation"])
        self.assertFalse(added & self._columns(store, "alloc_engineers"))
        self.assertNotIn("password_change_required_at", self._columns(store, "users"))
        with store.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM alloc_engineers").fetchone()[0], 5)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM alloc_nodes WHERE engineer_id IS NOT NULL").fetchone()[0], 14)
            self.assertEqual(con.execute("SELECT email FROM users WHERE id='u1'").fetchone()[0], "justin@oadpiz.com")
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        with store.connect() as con:
            row = con.execute("SELECT user_id, key_updated_revision, key_updated_by FROM alloc_engineers WHERE username='justin'").fetchone()
            self.assertEqual(tuple(row), (None, None, None))

    def _index_sql(self, store, name):
        with store.connect() as con:
            if self.db.backend == "sqlite":
                return con.execute("SELECT sql FROM sqlite_master WHERE type='index' AND name=?", (name,)).fetchone()[0]
            return con.execute("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=?", (name,)).fetchone()[0]

    def test_studio_tables_partial_index_and_downgrade(self):
        from server.store import Store
        store = Store(self.db.url)
        definition = self._index_sql(store, "ux_studio_ops_active")
        self.assertIn("UNIQUE", definition.upper())
        self.assertIn("WHERE", definition.upper())
        self.assertIn("reserved", definition)
        with store.connect() as con:
            con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES ('u1','u1@example.test','u1','x','customer',1)")
            con.execute("INSERT INTO studio_projects (id,user_id,created_at) VALUES ('p1','u1',1)")
            con.execute("INSERT INTO studio_accounts (user_id,balance) VALUES ('u1',5)")
            con.execute("INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,credits_charged,idempotency_key) VALUES ('o0','u1','p1',2,'settled',2,'k0')")
            con.execute("INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,idempotency_key) VALUES ('o1','u1','p1',2,'reserved','k1')")
            con.execute("INSERT INTO studio_ledger (user_id,op_id,kind,delta) VALUES ('u1','o1','reserve',-2)")
            con.execute("INSERT INTO studio_rate (user_id,bucket,window_start,hits) VALUES ('u1','quote',0,1)")
        rejected = (
            # a second active op on the project (partial unique index), for each active state
            "INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,idempotency_key) VALUES ('o2','u1','p1',2,'submitted','k2')",
            "INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,idempotency_key) VALUES ('o2','u1','p1',2,'unknown','k2')",
            "INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,idempotency_key) VALUES ('o2','u1','p1',2,'done','k2')",
            "INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,credits_charged,idempotency_key) VALUES ('o2','u1','p1',2,'settled',3,'k2')",
            "INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,credits_charged,idempotency_key) VALUES ('o2','u1','p1',2,'settled',2,'k1')",
            "INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,idempotency_key) VALUES ('o2','u1','nope',2,'reserved','k2')",
            "UPDATE studio_accounts SET balance=-1 WHERE user_id='u1'",
            "UPDATE studio_accounts SET reserved=-1 WHERE user_id='u1'",
            "INSERT INTO studio_ledger (user_id,kind,delta) VALUES ('u1','gift',1)",
            "INSERT INTO studio_accounts (user_id,balance) VALUES ('nobody',1)",
        )
        for sql in rejected:
            with self.assertRaises(store.IntegrityError, msg=sql):
                with store.connect() as con:
                    con.execute(sql)
        with store.connect() as con:  # another terminal op on the same project is fine
            con.execute("INSERT INTO studio_ops (op_id,user_id,project_id,credits,state,credits_charged,idempotency_key) VALUES ('o3','u1','p1',2,'refunded',0,'k3')")
        downgrade_to(self.db.url, "0004_engineer_accounts")
        self.assertEqual(self._versions(store), ["0004_engineer_accounts"])
        self.assertFalse({"studio_accounts", "studio_projects", "studio_ops", "studio_ledger", "studio_rate"} & set(self.db.table_names()))
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        with store.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM studio_ops").fetchone()[0], 0)

    def _snapshot(self, store, tables):
        snapshot = {}
        with store.connect() as con:
            for table in sorted(tables):
                snapshot[table] = sorted((tuple(sorted(dict(r).items())) for r in con.execute('SELECT * FROM "' + table + '"').fetchall()), key=repr)
        return snapshot

    def test_voice_core_upgrade_and_downgrade(self):
        from server.store import Store
        store = Store(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        self.assertLessEqual(VOICE_TABLES, set(self.db.table_names()))
        downgrade_to(self.db.url, "0008_audit_action_index")  # 0009 refers to these tables; it has its own test
        with store.connect() as con:
            con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
                        ("u1", "owner@clinic.example", "owner", "unused", "customer", 1))
            store.audit(con, "admin.voice_store_created", "u1", "s" * 32, {"userId": "u1"})
            con.execute("INSERT INTO voice_stores (id,owner_user_id,name,industry,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                        ("s" * 32, "u1", "Clinic", "clinic", 1, 1))
            row = con.execute("SELECT status, recording_mode, retention_days, ai_answer_enabled, max_message_seconds, handoff_mode, greeting FROM voice_stores").fetchone()
            self.assertEqual(tuple(row), ("draft", "message_only", 90, 0, 120, "callback", ""))
            con.execute("INSERT INTO voice_store_hours (store_id,weekday,open_min,close_min) VALUES (?,?,?,?)", ("s" * 32, 0, 540, 720))
            con.execute("INSERT INTO voice_store_closures (store_id,date,note) VALUES (?,?,?)", ("s" * 32, "2026-12-25", ""))
            con.execute("INSERT INTO voice_faqs (id,store_id,question,answer,position,updated_at) VALUES (?,?,?,?,?,?)",
                        ("f" * 32, "s" * 32, "Q", "A", 0, 1))
            con.execute("INSERT INTO voice_config_versions (store_id,version,config_json,config_sha256,created_by,created_at) VALUES (?,?,?,?,?,?)",
                        ("s" * 32, 1, "{}", "0" * 64, "u1", 1))
            con.execute("INSERT INTO voice_numbers (id,number,store_id,purpose,channel,active_from,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                        ("n" * 32, "ext-0001", "s" * 32, "test", "online", 1, 1, 1))
        # every CHECK this migration adds rejects an illegal value
        for sql in ("UPDATE voice_stores SET status='open'", "UPDATE voice_stores SET industry='bank'",
                    "UPDATE voice_stores SET handoff_mode='voicemail'", "UPDATE voice_stores SET recording_mode='video'",
                    "UPDATE voice_stores SET ask_callback='sometimes'", "UPDATE voice_stores SET after_hours_mode='closed'",
                    "UPDATE voice_stores SET retention_days=91", "UPDATE voice_stores SET retention_days=0",
                    "UPDATE voice_stores SET recording_mode='full', retention_days=31", "UPDATE voice_stores SET max_message_seconds=59",
                    "UPDATE voice_stores SET ai_answer_enabled=2", "UPDATE voice_numbers SET purpose='sales'",
                    "UPDATE voice_numbers SET channel='sip'", "UPDATE voice_numbers SET active_to=1",
                    "UPDATE voice_store_hours SET close_min=1441", "UPDATE voice_store_hours SET weekday=7",
                    "UPDATE voice_faqs SET ai_allowed=2"):
            with self.assertRaises(store.IntegrityError, msg=sql):
                with store.connect() as con:
                    con.execute(sql)
        with store.connect() as con:
            con.execute("UPDATE voice_stores SET recording_mode='full', retention_days=30")
        others = set(self.db.table_names()) - VOICE_TABLES - {"alembic_version"}
        before = self._snapshot(store, others)
        downgrade_to(self.db.url, "0006_studio_expired")
        self.assertEqual(self._versions(store), ["0006_studio_expired"])
        self.assertEqual([t for t in self.db.table_names() if t.startswith("voice_")], [])
        self.assertEqual(set(self.db.table_names()) - {"alembic_version"}, others)
        self.assertEqual(self._snapshot(store, others), before)
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        with store.connect() as con:
            for table in sorted(VOICE_TABLES | CALL_TABLES):
                self.assertEqual(con.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0], 0, table)
        self.assertEqual(self._snapshot(store, others - CALL_TABLES), before)

    def _audit_indexes(self, store):
        with store.connect() as con:
            if self.db.backend == "sqlite":
                rows = con.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_events' "
                                   "AND name NOT LIKE 'sqlite_%'").fetchall()
            else:
                rows = con.execute("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='audit_events' "
                                   "AND indexname NOT LIKE '%_pkey'").fetchall()
            return sorted(r[0] for r in rows)

    def test_audit_action_index_upgrade_and_downgrade(self):
        from server.store import Store
        store = Store(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        self.assertEqual(self._audit_indexes(store), AUDIT_INDEXES)
        with store.connect() as con:
            for i in range(3):
                store.audit(con, "voice.published", None, "s" * 32, {"version": i + 1})
            if self.db.backend == "sqlite":
                plan = " ".join(str(r[-1]) for r in con.execute(
                    "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM audit_events WHERE action=? AND target_id=? AND created_at>?",
                    ("voice.published", "s" * 32, 0)).fetchall())
                self.assertIn("audit_events_action_target_time", plan)
        before = self._snapshot(store, {"audit_events"})
        downgrade_to(self.db.url, "0007_voice_core")
        self.assertEqual(self._versions(store), ["0007_voice_core"])
        self.assertEqual(self._audit_indexes(store), [])
        self.assertEqual(self._snapshot(store, {"audit_events"}), before)
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        self.assertEqual(self._audit_indexes(store), AUDIT_INDEXES)
        self.assertEqual(self._snapshot(store, {"audit_events"}), before)

    def test_voice_calls_upgrade_and_downgrade(self):
        from server.store import Store
        store = Store(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        self.assertLessEqual(CALL_TABLES, set(self.db.table_names()))
        call = {"id": "c" * 32, "call_id": "1797815702.118", "entry": "pstn", "dialed": "+886227001001", "number_id": "n" * 32,
                "store_id": "s" * 32, "number_purpose": "customer", "started_at": 100, "ended_at": 259, "duration_s": 159,
                "disposition": "ANSWERED", "caller_tail": "678", "caller_kind": "mobile", "outcome": "answered",
                "retention_days_snapshot": 90, "meter_units": 1, "meter_reason": "ai_speech", "meter_rule": "q5-draft-1",
                "received_at": 300, "updated_at": 300}
        with store.connect() as con:
            con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
                        ("u1", "owner@clinic.example", "owner", "unused", "admin", 1))
            con.execute("INSERT INTO voice_stores (id,owner_user_id,name,industry,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                        ("s" * 32, "u1", "Clinic", "clinic", 1, 1))
            con.execute("INSERT INTO voice_numbers (id,number,store_id,purpose,channel,active_from,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                        ("n" * 32, "+886227001001", "s" * 32, "customer", "pstn", 1, 1, 1))
            names = sorted(call)
            con.execute("INSERT INTO voice_calls (" + ",".join(names) + ") VALUES (" + ",".join("?" * len(names)) + ")",
                        tuple(call[n] for n in names))
            row = con.execute("SELECT ai_answered, message_outcome, auto_flags, mismatch, metrics, message_final, content_expected "
                              "FROM voice_calls").fetchone()
            self.assertEqual(tuple(row), (0, "none", "[]", "[]", "{}", 0, 0))
            con.execute("INSERT INTO voice_call_reviews (call_row_id,score,status,reviewer_id,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                        ("c" * 32, 3, "open", "u1", 1, 1))
            con.execute("INSERT INTO voice_listening_logs (id,title,kind,held_on,sample_count,rater_count,created_by,created_at,updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?)", ("l" * 32, "G0", "tts_voice", "2026-10-22", 20, 3, "u1", 1, 1))
        # a second row with the same call_id is refused (the last line of defence of §3.4)
        with self.assertRaises(store.IntegrityError):
            with store.connect() as con:
                con.execute("INSERT INTO voice_calls (" + ",".join(names) + ") VALUES (" + ",".join("?" * len(names)) + ")",
                            tuple(("d" * 32 if n == "id" else call[n]) for n in names))
        for sql in ("UPDATE voice_calls SET entry='sip'", "UPDATE voice_calls SET disposition='ANSWER'",
                    "UPDATE voice_calls SET caller_kind='pager'", "UPDATE voice_calls SET caller_tail='0912'",
                    "UPDATE voice_calls SET duration_s=14401", "UPDATE voice_calls SET duration_s=-1",
                    "UPDATE voice_calls SET outcome='done'", "UPDATE voice_calls SET message_outcome='ai_answered'",
                    "UPDATE voice_calls SET handoff_reason='bored'", "UPDATE voice_calls SET degrade_reason='gpu'",
                    "UPDATE voice_calls SET callback_via='sms'", "UPDATE voice_calls SET meter_units=2",
                    "UPDATE voice_calls SET ai_answered=2", "UPDATE voice_calls SET content_expected=-1",
                    "UPDATE voice_calls SET retention_days_snapshot=91", "UPDATE voice_calls SET retention_days_reported=0",
                    "UPDATE voice_calls SET store_flag_kind='rude'", "UPDATE voice_calls SET number_purpose='sales'",
                    "UPDATE voice_calls SET recording_mode='video'", "UPDATE voice_calls SET ai_speech_ms=-1",
                    "UPDATE voice_call_reviews SET score=6", "UPDATE voice_call_reviews SET score=0",
                    "UPDATE voice_call_reviews SET status='closed'", "UPDATE voice_listening_logs SET kind='music'",
                    "UPDATE voice_listening_logs SET sample_count=0", "UPDATE voice_listening_logs SET rater_count=51",
                    "UPDATE voice_listening_logs SET passed=2", "UPDATE voice_listening_logs SET held_on='2026-1-1'"):
            with self.assertRaises(store.IntegrityError, msg=sql):
                with store.connect() as con:
                    con.execute(sql)
        others = set(self.db.table_names()) - CALL_TABLES - {"alembic_version"}
        before = self._snapshot(store, others)
        downgrade_to(self.db.url, "0008_audit_action_index")
        self.assertEqual(self._versions(store), ["0008_audit_action_index"])
        self.assertEqual(set(self.db.table_names()) - {"alembic_version"}, others)
        self.assertEqual(self._audit_indexes(store), ["audit_events_action_target_time"])
        self.assertEqual(self._snapshot(store, others), before)
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        self.assertEqual(self._audit_indexes(store), AUDIT_INDEXES)
        with store.connect() as con:
            for table in sorted(CALL_TABLES):
                self.assertEqual(con.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0], 0, table)
            if self.db.backend == "sqlite":
                plan = " ".join(str(r[-1]) for r in con.execute(
                    "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM audit_events WHERE action IN (?,?) AND actor_id=? AND created_at>?",
                    ("voice.call_content_link", "admin.voice_call_content_link", "u1", 0)).fetchall())
                self.assertIn("audit_events_action_actor_time", plan)
        self.assertEqual(self._snapshot(store, others), before)

    def test_voice_call_digests_are_rewritten_from_the_stored_reports_and_downgrade_keeps_them(self):
        # 0010 (fix round): report_*_sha256 was the hash of the sent body, which held the masked digits.
        import hashlib

        from server.store import Store
        store = Store(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        downgrade_to(self.db.url, "0009_voice_calls")
        self.assertEqual(self._versions(store), ["0009_voice_calls"])
        base = {"entry": "pstn", "dialed": "******5678", "started_at": 100, "disposition": "ANSWERED", "caller_kind": "mobile",
                "outcome": "unknown", "retention_days_snapshot": 90, "meter_units": 0, "meter_reason": "unknown_line",
                "meter_rule": "q5-draft-1", "received_at": 300, "updated_at": 300}
        old = "f" * 64  # what 0009 code stored: the hash of the body as sent
        total = 1100  # more than two pages of the backfill
        texts = {}
        with store.connect() as con:
            for index in range(total):
                row_id = "%032x" % index
                orchestrator = '{"call_id":"1.%d","dialed":"******5678","source":"orchestrator"}' % index
                records = None if index % 3 else '{"call_id":"1.%d","dialed":"******5678","source":"records","message_final":false}' % index
                texts[row_id] = (orchestrator, records)
                values = dict(base, id=row_id, call_id="1.%d" % index, report_orchestrator=orchestrator,
                              report_orchestrator_sha256=old, report_orchestrator_at=300)
                if records:
                    values.update(report_records=records, report_records_sha256=old, report_records_at=300)
                names = sorted(values)
                con.execute("INSERT INTO voice_calls (" + ",".join(names) + ") VALUES (" + ",".join("?" * len(names)) + ")",
                            tuple(values[name] for name in names))
            # A row with neither report (a hand-made row) has nothing to hash and stays as it is.
            bare = dict(base, id="e" * 32, call_id="1.bare")
            names = sorted(bare)
            con.execute("INSERT INTO voice_calls (" + ",".join(names) + ") VALUES (" + ",".join("?" * len(names)) + ")",
                        tuple(bare[name] for name in names))

        later = ("store_deleted_at", "recording_expiry_queued_at", "content_expiry_queued_at")  # 0011's columns, all NULL here

        def snapshot(skip=()):
            with store.connect() as con:
                return [{k: v for k, v in dict(r).items() if k not in skip + later}
                        for r in con.execute("SELECT * FROM voice_calls ORDER BY id").fetchall()]

        digests = ("report_orchestrator_sha256", "report_records_sha256")
        others_before, tables_before = snapshot(digests), self._snapshot(store, set(self.db.table_names()) - {"alembic_version", "voice_calls", "voice_deletion_requests"})
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        with store.connect() as con:
            rows = {r["id"]: r for r in con.execute("SELECT * FROM voice_calls").fetchall()}
        self.assertEqual(len(rows), total + 1)
        for row_id, (orchestrator, records) in texts.items():
            self.assertEqual(rows[row_id]["report_orchestrator_sha256"], hashlib.sha256(orchestrator.encode("utf-8")).hexdigest())
            self.assertEqual(rows[row_id]["report_records_sha256"],
                             None if records is None else hashlib.sha256(records.encode("utf-8")).hexdigest())
        self.assertEqual((rows["e" * 32]["report_orchestrator_sha256"], rows["e" * 32]["report_records_sha256"]), (None, None))
        self.assertNotIn(old, {r["report_orchestrator_sha256"] for r in rows.values()})
        self.assertEqual(snapshot(digests), others_before)  # only the two digest columns changed
        self.assertEqual(self._snapshot(store, set(self.db.table_names()) - {"alembic_version", "voice_calls", "voice_deletion_requests"}), tables_before)
        after = snapshot()
        # Downgrade changes nothing (the old digests cannot be rebuilt); upgrading again rewrites the same values.
        downgrade_to(self.db.url, "0009_voice_calls")
        self.assertEqual(self._versions(store), ["0009_voice_calls"])
        self.assertEqual(snapshot(), after)
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        self.assertEqual(snapshot(), after)

    def test_voice_deletions_upgrade_and_downgrade(self):
        # 0011 (phase2-contract §16): three nullable columns on voice_calls and the deletion request table. Downgrade must
        # keep every call row and review (SQLite drops the columns in place; a table rebuild would cascade to reviews).
        from server.store import Store
        store = Store(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        added = {"store_deleted_at", "recording_expiry_queued_at", "content_expiry_queued_at"}
        self.assertLessEqual(added, self._columns(store, "voice_calls"))
        call = {"id": "c" * 32, "call_id": "1797815702.118", "entry": "pstn", "started_at": 100, "disposition": "ANSWERED",
                "caller_kind": "mobile", "outcome": "answered", "retention_days_snapshot": 90, "meter_units": 1,
                "meter_reason": "ai_speech", "meter_rule": "q5-draft-1", "received_at": 300, "updated_at": 300,
                "store_deleted_at": 400, "content_purged_at": 500}
        request = {"id": "r" * 32, "seq": 1, "call_id": "1797815702.118", "reason": "store_deleted",
                   "kinds": '["recording","summary","transcript"]', "requested_by": "u1", "status": "pending", "requested_at": 400}

        def insert(con, table, values):
            names = sorted(values)
            con.execute("INSERT INTO " + table + " (" + ",".join(names) + ") VALUES (" + ",".join("?" * len(names)) + ")",
                        tuple(values[n] for n in names))

        with store.connect() as con:
            con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
                        ("u1", "ops@example.test", "ops", "unused", "admin", 1))
            insert(con, "voice_calls", call)
            con.execute("INSERT INTO voice_call_reviews (call_row_id,score,status,reviewer_id,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                        ("c" * 32, 3, "open", "u1", 1, 1))
            insert(con, "voice_deletion_requests", request)
        for values in (dict(request, id="a" * 32, seq=2),  # one request per (call_id, reason)
                       dict(request, id="a" * 32, reason="content_expired"),  # seq is unique
                       dict(request, id="a" * 32, seq=0, reason="content_expired"),
                       dict(request, id="a" * 32, seq=2, reason="expired"),
                       dict(request, id="a" * 32, seq=2, reason="content_expired", status="failed"),
                       dict(request, id="a" * 32, seq=2, reason="content_expired", status="done"),  # done needs done_at and counts
                       dict(request, id="a" * 32, seq=2, reason="content_expired", status="done", done_at=1, files_deleted=-1, rows_deleted=0),
                       dict(request, id="a" * 32, seq=2, reason="content_expired", files_deleted=0)):  # pending has no counts
            with self.assertRaises(store.IntegrityError, msg=values):
                with store.connect() as con:
                    insert(con, "voice_deletion_requests", values)
        with store.connect() as con:
            insert(con, "voice_deletion_requests", dict(request, id="a" * 32, seq=2, reason="content_expired", status="done", done_at=1,
                                                        files_deleted=0, rows_deleted=0))
        others = set(self.db.table_names()) - {"alembic_version", "voice_deletion_requests", "voice_calls"}
        before = self._snapshot(store, others)
        with store.connect() as con:
            calls_before = [{k: v for k, v in dict(r).items() if k not in added} for r in con.execute("SELECT * FROM voice_calls").fetchall()]
        downgrade_to(self.db.url, "0010_voice_call_digests")
        self.assertEqual(self._versions(store), ["0010_voice_call_digests"])
        self.assertNotIn("voice_deletion_requests", self.db.table_names())
        self.assertFalse(added & self._columns(store, "voice_calls"))
        self.assertEqual(self._snapshot(store, others), before)  # the review is still there
        with store.connect() as con:
            self.assertEqual([dict(r) for r in con.execute("SELECT * FROM voice_calls").fetchall()], calls_before)
        upgrade_to_head(self.db.url)
        self.assertEqual(self._versions(store), [HEAD])
        with store.connect() as con:
            row = con.execute("SELECT store_deleted_at, recording_expiry_queued_at, content_expiry_queued_at, content_purged_at "
                              "FROM voice_calls").fetchone()
            self.assertEqual(tuple(row), (None, None, None, 500))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM voice_deletion_requests").fetchone()[0], 0)
            if self.db.backend == "sqlite":
                plan = " ".join(str(r[-1]) for r in con.execute(
                    "EXPLAIN QUERY PLAN SELECT * FROM voice_calls WHERE content_expiry_queued_at IS NULL AND started_at<=?", (1,)).fetchall())
                self.assertIn("voice_calls_content_expiry", plan)
        self.assertEqual(self._snapshot(store, others), before)

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
