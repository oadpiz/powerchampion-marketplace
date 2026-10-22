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
EXPECTED_TABLES = EXPECTED_TABLES | VOICE_TABLES
HEAD = "0008_audit_action_index"


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
        # + audit_events_action_target_time (0008)
        self.assertEqual(len(names), 22, names)
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
            for table in sorted(VOICE_TABLES):
                self.assertEqual(con.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0], 0, table)
        self.assertEqual(self._snapshot(store, others), before)

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
        self.assertEqual(self._audit_indexes(store), ["audit_events_action_target_time"])
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
        self.assertEqual(self._audit_indexes(store), ["audit_events_action_target_time"])
        self.assertEqual(self._snapshot(store, {"audit_events"}), before)

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
