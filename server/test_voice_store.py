"""Voice data access (server/voice_store.py) on a real temporary database (SQLite, or Postgres when
PC_PORTAL_TEST_DATABASE_URL is set)."""
import hashlib
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

from server import voice_store as vs
from server.store import Store
from server.testsupport import fresh_database

DAY = 86400
NOV1 = vs.taipei_day_start("2026-11-01")


class VoiceStoreCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(fresh_database(self.directory.name))
        with self.store.connect() as con:
            for user in ("alice", "bob", "carol"):
                con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
                            (user, user + "@example.test", user, "unused", "customer", 1))
            self.a = vs.create_store(con, "alice", "晴光牙醫診所", "clinic", template_id="clinic", now=100)
            self.b = vs.create_store(con, "bob", "明德補習班", "cram", template_id="cram", now=100)

    def tearDown(self):
        self.directory.cleanup()

    def config(self, store_id, version, **extra):
        return dict({"schema": "voice.store-config/v1", "store_id": store_id, "version": version, "shop_name": "店"}, **extra)


class StoreTests(VoiceStoreCase):
    def test_create_store_uses_contract_defaults(self):
        self.assertRegex(self.a["id"], r"^[a-f0-9]{32}$")
        expected = {"owner_user_id": "alice", "name": "晴光牙醫診所", "industry": "clinic", "template_id": "clinic", "status": "draft",
                    "greeting": "", "intro_text": "", "after_hours_mode": "answer_and_message", "ask_callback": "auto",
                    "max_message_seconds": 120, "handoff_mode": "callback", "handoff_number": None, "recording_mode": "message_only",
                    "retention_days": 90, "ai_answer_enabled": False, "terms_version": None, "terms_accepted_at": None,
                    "current_version": None, "created_at": 100, "updated_at": 100}
        self.assertEqual({k: self.a[k] for k in expected}, expected)

    def test_store_lookup_by_owner_and_id(self):
        with self.store.connect() as con:
            self.assertEqual(vs.store_by_owner(con, "alice")["id"], self.a["id"])
            self.assertEqual(vs.store_by_owner(con, "bob")["id"], self.b["id"])
            self.assertIsNone(vs.store_by_owner(con, "carol"))
            self.assertIsNone(vs.store_by_owner(con, None))
            self.assertEqual(vs.get_store(con, self.a["id"])["owner_user_id"], "alice")
            for bad in ("0" * 32, "not-an-id", self.a["id"].upper(), self.a["id"] + "\n", None):
                self.assertIsNone(vs.get_store(con, bad), bad)

    def test_one_store_per_owner_and_owner_must_exist(self):
        for owner, industry in (("alice", "clinic"), ("nobody", "clinic")):
            with self.assertRaises(self.store.IntegrityError, msg=owner):
                with self.store.connect() as con:
                    vs.create_store(con, owner, "Second", industry)
        with self.store.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM voice_stores").fetchone()[0], 2)

    def test_illegal_enum_values_are_rejected(self):
        with self.assertRaises(self.store.IntegrityError):
            with self.store.connect() as con:
                vs.create_store(con, "carol", "Bank", "bank")
        for changes in ({"status": "open"}, {"ask_callback": "sometimes"}, {"after_hours_mode": "closed"},
                        {"recording_mode": "video"}, {"max_message_seconds": 181}, {"retention_days": 91},
                        {"retention_days": 0}, {"recording_mode": "full", "retention_days": 31}):
            with self.subTest(changes=changes):
                with self.assertRaises(self.store.IntegrityError):
                    with self.store.connect() as con:
                        vs.update_store(con, self.a["id"], changes)
        with self.store.connect() as con:
            con.execute("UPDATE voice_stores SET handoff_mode='transfer' WHERE id=?", (self.a["id"],))
        for sql in ("UPDATE voice_stores SET handoff_mode='voicemail'", "UPDATE voice_stores SET industry='bank'"):
            with self.assertRaises(self.store.IntegrityError, msg=sql):
                with self.store.connect() as con:
                    con.execute(sql)

    def test_update_store_reports_actual_changes(self):
        with self.store.connect() as con:
            changed = vs.update_store(con, self.a["id"], {"greeting": "請問有什麼可以幫您？", "ask_callback": "auto",
                                                           "recording_mode": "full", "retention_days": 30, "ai_answer_enabled": True}, now=200)
            self.assertEqual(changed, ["greeting", "recording_mode", "retention_days", "ai_answer_enabled"])
            row = vs.get_store(con, self.a["id"])
            self.assertEqual((row["greeting"], row["recording_mode"], row["retention_days"], row["ai_answer_enabled"], row["updated_at"]),
                             ("請問有什麼可以幫您？", "full", 30, True, 200))
            self.assertEqual(con.execute("SELECT ai_answer_enabled FROM voice_stores WHERE id=?", (self.a["id"],)).fetchone()[0], 1)
            self.assertEqual(vs.update_store(con, self.a["id"], {"greeting": "請問有什麼可以幫您？", "ai_answer_enabled": 1}, now=300), [])
            self.assertEqual(vs.get_store(con, self.a["id"])["updated_at"], 200)
            self.assertIsNone(vs.update_store(con, "0" * 32, {"name": "x"}))
            for column in ("owner_user_id", "industry", "handoff_mode", "current_version", "id"):
                with self.assertRaises(ValueError, msg=column):
                    vs.update_store(con, self.a["id"], {column: "x"})
            # the other store is untouched
            self.assertEqual(vs.get_store(con, self.b["id"])["greeting"], "")


class HoursTests(VoiceStoreCase):
    def test_replace_hours_sorts_and_reports_changes(self):
        hours = [{"weekday": 1, "open_min": 540, "close_min": 720}, {"weekday": 0, "open_min": 840, "close_min": 1080},
                 {"weekday": 0, "open_min": 720, "close_min": 840}]  # touching segments are allowed
        with self.store.connect() as con:
            self.assertTrue(vs.replace_hours(con, self.a["id"], hours, now=200))
            self.assertEqual(vs.get_hours(con, self.a["id"]), [{"weekday": 0, "open_min": 720, "close_min": 840},
                                                               {"weekday": 0, "open_min": 840, "close_min": 1080},
                                                               {"weekday": 1, "open_min": 540, "close_min": 720}])
            self.assertEqual(vs.get_store(con, self.a["id"])["updated_at"], 200)
            self.assertFalse(vs.replace_hours(con, self.a["id"], list(reversed(hours)), now=300))
            self.assertEqual(vs.get_store(con, self.a["id"])["updated_at"], 200)
            self.assertTrue(vs.replace_hours(con, self.a["id"], [], now=400))
            self.assertEqual(vs.get_hours(con, self.a["id"]), [])

    def test_overlapping_or_out_of_range_hours_are_rejected(self):
        with self.store.connect() as con:
            vs.replace_hours(con, self.a["id"], [{"weekday": 2, "open_min": 0, "close_min": 1440}])
        for hours in ([{"weekday": 0, "open_min": 540, "close_min": 720}, {"weekday": 0, "open_min": 700, "close_min": 800}],
                      [{"weekday": 0, "open_min": 540, "close_min": 720}, {"weekday": 0, "open_min": 540, "close_min": 600}]):
            with self.assertRaises(vs.VoiceStoreError) as caught:
                with self.store.connect() as con:
                    vs.replace_hours(con, self.a["id"], hours)
            self.assertEqual((caught.exception.code, caught.exception.status), ("hours_invalid", 400))
        for segment in ({"weekday": 7, "open_min": 0, "close_min": 60}, {"weekday": 0, "open_min": 600, "close_min": 600},
                        {"weekday": 0, "open_min": 0, "close_min": 1441}, {"weekday": 0, "open_min": -1, "close_min": 60}):
            with self.assertRaises(self.store.IntegrityError, msg=segment):
                with self.store.connect() as con:
                    vs.replace_hours(con, self.a["id"], [segment])
        with self.store.connect() as con:  # a failed replacement leaves the old hours in place
            self.assertEqual(vs.get_hours(con, self.a["id"]), [{"weekday": 2, "open_min": 0, "close_min": 1440}])

    def test_closures(self):
        with self.store.connect() as con:
            self.assertTrue(vs.replace_closures(con, self.a["id"], [{"date": "2026-12-25", "note": "院內訓練"}, {"date": "2026-11-11"}]))
            self.assertEqual(vs.get_closures(con, self.a["id"]), [{"date": "2026-11-11", "note": ""}, {"date": "2026-12-25", "note": "院內訓練"}])
            self.assertFalse(vs.replace_closures(con, self.a["id"], [{"date": "2026-11-11", "note": ""}, {"date": "2026-12-25", "note": "院內訓練"}]))
        for closures in ([{"date": "2026-11-11"}, {"date": "2026-11-11", "note": "x"}], [{"date": "2026-02-30"}],
                         [{"date": "20261111"}], [{"date": "2026-11-11\n"}]):
            with self.assertRaises(vs.VoiceStoreError, msg=closures) as caught:
                with self.store.connect() as con:
                    vs.replace_closures(con, self.a["id"], closures)
            self.assertEqual(caught.exception.code, "closures_invalid")


class FaqTests(VoiceStoreCase):
    def add(self, con, store_id, question, **kwargs):
        return vs.add_faq(con, store_id, question, "答案：" + question, **kwargs)

    def questions(self, con, store_id):
        faqs = vs.list_faqs(con, store_id)
        self.assertEqual([f["position"] for f in faqs], list(range(len(faqs))))
        return [f["question"] for f in faqs]

    def test_add_update_move_delete_keep_positions_consecutive(self):
        with self.store.connect() as con:
            first = self.add(con, self.a["id"], "洗牙多少錢？", variants=["洗牙費用", "洗牙要錢嗎"], now=200)
            self.assertEqual((first["position"], first["variants"], first["ai_allowed"], first["updated_at"]), (0, ["洗牙費用", "洗牙要錢嗎"], True, 200))
            self.add(con, self.a["id"], "幾點開門？")
            self.add(con, self.a["id"], "可以停車嗎？", position=0)
            self.add(con, self.a["id"], "要預約嗎？", position=99)
            self.add(con, self.a["id"], "健保嗎？", position=-5, ai_allowed=False)
            self.assertEqual(self.questions(con, self.a["id"]), ["健保嗎？", "可以停車嗎？", "洗牙多少錢？", "幾點開門？", "要預約嗎？"])
            self.assertEqual([f["ai_allowed"] for f in vs.list_faqs(con, self.a["id"])], [False, True, True, True, True])

            moved = vs.update_faq(con, self.a["id"], first["id"], {"position": 4, "answer": "健保洗牙每半年一次免費。"}, now=300)
            self.assertEqual((moved["position"], moved["answer"], moved["updated_at"]), (4, "健保洗牙每半年一次免費。", 300))
            self.assertEqual(self.questions(con, self.a["id"]), ["健保嗎？", "可以停車嗎？", "幾點開門？", "要預約嗎？", "洗牙多少錢？"])
            same = vs.update_faq(con, self.a["id"], first["id"], {"position": 4, "answer": "健保洗牙每半年一次免費。"}, now=400)
            self.assertEqual(same["updated_at"], 300)  # nothing changed, nothing written
            changed = vs.update_faq(con, self.a["id"], first["id"], {"variants": [], "ai_allowed": False, "question": "洗牙費用？"}, now=500)
            self.assertEqual((changed["variants"], changed["ai_allowed"], changed["question"]), ([], False, "洗牙費用？"))

            self.assertTrue(vs.delete_faq(con, self.a["id"], vs.list_faqs(con, self.a["id"])[1]["id"]))
            self.assertEqual(self.questions(con, self.a["id"]), ["健保嗎？", "幾點開門？", "要預約嗎？", "洗牙費用？"])
            self.assertFalse(vs.delete_faq(con, self.a["id"], "0" * 32))
            with self.assertRaises(ValueError):
                vs.update_faq(con, self.a["id"], first["id"], {"store_id": self.b["id"]})
            self.assertEqual(json.loads(con.execute("SELECT variants FROM voice_faqs WHERE question='健保嗎？'").fetchone()[0]), [])

    def test_variants_are_stored_as_readable_json(self):
        with self.store.connect() as con:
            faq = self.add(con, self.a["id"], "Q", variants=["洗牙費用"])
            raw = con.execute("SELECT variants FROM voice_faqs WHERE id=?", (faq["id"],)).fetchone()[0]
        self.assertEqual(raw, '["洗牙費用"]')


class IsolationTests(VoiceStoreCase):
    """A store must never read or change another store's data through its own store id."""

    def test_store_a_cannot_read_or_change_store_b(self):
        with self.store.connect() as con:
            faq_a = vs.add_faq(con, self.a["id"], "A 的問題", "A 的答案")
            faq_b = vs.add_faq(con, self.b["id"], "B 的問題", "B 的答案")
            vs.replace_hours(con, self.b["id"], [{"weekday": 0, "open_min": 540, "close_min": 720}])
            vs.replace_closures(con, self.b["id"], [{"date": "2026-12-25", "note": "B"}])
            vs.add_config_version(con, self.b["id"], self.config(self.b["id"], 1), "bob")

            mine = vs.store_by_owner(con, "alice")
            self.assertEqual(mine["id"], self.a["id"])
            self.assertEqual([f["id"] for f in vs.list_faqs(con, mine["id"])], [faq_a["id"]])
            self.assertIsNone(vs.get_faq(con, mine["id"], faq_b["id"]))
            self.assertIsNone(vs.update_faq(con, mine["id"], faq_b["id"], {"answer": "改掉", "position": 0}))
            self.assertFalse(vs.delete_faq(con, mine["id"], faq_b["id"]))
            self.assertEqual(vs.get_hours(con, mine["id"]), [])
            self.assertEqual(vs.get_closures(con, mine["id"]), [])
            self.assertIsNone(vs.latest_config_version(con, mine["id"]))
            self.assertIsNone(vs.get_config_version(con, mine["id"], 1))
            self.assertEqual(vs.next_config_version(con, mine["id"]), 1)

            # store B is exactly as it was
            b_faq = vs.get_faq(con, self.b["id"], faq_b["id"])
            self.assertEqual((b_faq["answer"], b_faq["position"]), ("B 的答案", 0))
            self.assertEqual(len(vs.get_hours(con, self.b["id"])), 1)
            self.assertEqual(vs.latest_config_version(con, self.b["id"])["version"], 1)
            # and B's changes to its own data never touch A
            vs.replace_hours(con, self.b["id"], [])
            vs.delete_faq(con, self.b["id"], faq_b["id"])
            self.assertEqual([f["id"] for f in vs.list_faqs(con, self.a["id"])], [faq_a["id"]])


class ConfigVersionTests(VoiceStoreCase):
    def test_versions_are_sequential_canonical_and_hashed(self):
        with self.store.connect() as con:
            self.assertEqual(vs.next_config_version(con, self.a["id"]), 1)
            with self.assertRaises(ValueError):
                vs.add_config_version(con, self.a["id"], self.config(self.a["id"], 2), "alice")
            with self.assertRaises(ValueError):
                vs.add_config_version(con, self.a["id"], self.config(self.b["id"], 1), "alice")
            config = self.config(self.a["id"], 1, opening={"text": "您好，這裡是晴光牙醫診所", "est_seconds": 2.4})
            first = vs.add_config_version(con, self.a["id"], config, "alice", now=200)
            canonical = json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            self.assertEqual(first, {"store_id": self.a["id"], "version": 1, "config_sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
                                     "created_by": "alice", "created_at": 200})
            stored = vs.latest_config_version(con, self.a["id"])
            self.assertEqual(stored["config_json"], canonical)
            self.assertIn("晴光牙醫診所", stored["config_json"])  # ensure_ascii=False
            self.assertEqual(stored["config_sha256"], first["config_sha256"])
            self.assertEqual(vs.get_store(con, self.a["id"])["current_version"], 1)

            second = vs.add_config_version(con, self.a["id"], self.config(self.a["id"], 2), "alice", now=300)
            self.assertEqual(second["version"], 2)
            self.assertEqual(vs.latest_config_version(con, self.a["id"])["version"], 2)
            self.assertEqual(vs.get_config_version(con, self.a["id"], 1)["config_json"], canonical)
            self.assertEqual(vs.get_store(con, self.a["id"])["current_version"], 2)
        with self.assertRaises(self.store.IntegrityError):  # (store_id, version) is unique
            with self.store.connect() as con:
                con.execute("INSERT INTO voice_config_versions (store_id,version,config_json,config_sha256,created_by,created_at) VALUES (?,?,?,?,?,?)",
                            (self.a["id"], 2, "{}", "0" * 64, "alice", 1))


class NumberTests(VoiceStoreCase):
    def add(self, con, number="+886227356688", start="2026-11-01", end=None, store_id=None, purpose="test", channel="online", note=""):
        active_to = None if end is None else vs.taipei_day_start(end) + DAY  # the end date is still active
        return vs.add_number(con, number, store_id, purpose, channel, vs.taipei_day_start(start), active_to, note, now=200)

    def assertOverlap(self, detail_part, **kwargs):
        with self.assertRaises(vs.VoiceStoreError) as caught:
            with self.store.connect() as con:
                self.add(con, **kwargs)
        self.assertEqual((caught.exception.code, caught.exception.status), ("number_overlap", 409))
        self.assertIn(detail_part, caught.exception.detail)

    def test_taipei_dates(self):
        self.assertEqual(NOV1, 1793462400)  # 2026-10-31T16:00:00Z
        self.assertEqual(vs.taipei_date(NOV1), "2026-11-01")
        self.assertEqual(vs.taipei_date(NOV1 - 1), "2026-10-31")
        for bad in ("2026-11-31", "2026/11/01", "20261101", "2026-11-01\n", None):
            with self.assertRaises(ValueError, msg=bad):
                vs.taipei_day_start(bad)

    def test_add_list_find_update_delete(self):
        with self.store.connect() as con:
            number = self.add(con, store_id=self.a["id"], end="2026-11-30", note="試點")
            self.assertEqual((number["number"], number["store_id"], number["active_from"], number["active_to"], number["note"]),
                             ("+886227356688", self.a["id"], NOV1, vs.taipei_day_start("2026-12-01"), "試點"))
            later = self.add(con, start="2026-12-01")  # starts the day after the first one ends: no overlap
            ext = self.add(con, number="ext-0001", purpose="demo", start="2026-10-01")
            self.assertEqual([n["id"] for n in vs.list_numbers(con)], [number["id"], later["id"], ext["id"]])
            self.assertEqual([n["id"] for n in vs.list_numbers(con, self.a["id"])], [number["id"]])
            self.assertEqual(vs.find_active_number(con, "+886227356688", NOV1)["id"], number["id"])
            self.assertEqual(vs.find_active_number(con, "+886227356688", vs.taipei_day_start("2026-12-01") - 1)["id"], number["id"])
            self.assertEqual(vs.find_active_number(con, "+886227356688", vs.taipei_day_start("2026-12-01"))["id"], later["id"])
            self.assertIsNone(vs.find_active_number(con, "+886227356688", NOV1 - 1))

            moved = vs.update_number(con, later["id"], "+886227356688", self.b["id"], "customer", "pstn",
                                     vs.taipei_day_start("2026-12-05"), None, "", now=300)
            self.assertEqual((moved["store_id"], moved["purpose"], moved["channel"], moved["updated_at"], moved["created_at"]),
                             (self.b["id"], "customer", "pstn", 300, 200))
            # updating a row may keep its own period (the check ignores the row itself)
            self.assertIsNotNone(vs.update_number(con, number["id"], "+886227356688", self.a["id"], "test", "online", NOV1,
                                                  vs.taipei_day_start("2026-12-01"), "改備註"))
            self.assertIsNone(vs.update_number(con, "0" * 32, "+886227356688", None, "test", "online", NOV1, None, ""))
            self.assertTrue(vs.delete_number(con, ext["id"]))
            self.assertFalse(vs.delete_number(con, ext["id"]))
            self.assertIsNone(vs.get_number(con, ext["id"]))

    def test_overlapping_periods_of_one_number_are_rejected(self):
        with self.store.connect() as con:
            self.add(con, start="2026-11-01", end="2026-11-30")
            self.add(con, start="2027-01-01")
            self.add(con, number="+886227356689", start="2026-11-01")  # another number may share the dates
        self.assertOverlap("+886227356688 is already active from 2026-11-01 to 2026-11-30.", start="2026-11-30", end="2026-12-10")
        self.assertOverlap("from 2026-11-01 to 2026-11-30", start="2026-10-01", end="2026-11-01")
        self.assertOverlap("from 2026-11-01 to 2026-11-30", start="2026-11-10", end="2026-11-12")
        self.assertOverlap("from 2026-11-01 to 2026-11-30", start="2026-10-01")  # open-ended covers everything after
        self.assertOverlap("+886227356688 is already active from 2027-01-01 (no end date).", start="2027-06-01", end="2027-06-01")
        with self.store.connect() as con:
            gap = self.add(con, start="2026-12-01", end="2026-12-31")  # fits exactly between the two
            with self.assertRaises(vs.VoiceStoreError) as caught:  # updating into another row's period
                vs.update_number(con, gap["id"], "+886227356688", None, "test", "online", NOV1, None, "")
            self.assertEqual(caught.exception.code, "number_overlap")
            self.assertEqual(len(vs.list_numbers(con)), 4)

    def test_invalid_numbers_and_values_are_rejected(self):
        for number in ("0227356688", "+0227356688", "+88622", "+8862273566881234", "ext-001", "ext-00001", "EXT-0001",
                       "ext-0001\n", "+886２２７３５６６８８", "", None):
            with self.assertRaises(vs.VoiceStoreError, msg=number) as caught:
                with self.store.connect() as con:
                    self.add(con, number=number)
            self.assertEqual((caught.exception.code, caught.exception.status), ("invalid_number", 400))
        for kwargs in ({"purpose": "sales"}, {"channel": "sip"}, {"store_id": "0" * 32}):
            with self.assertRaises(self.store.IntegrityError, msg=kwargs):
                with self.store.connect() as con:
                    self.add(con, **kwargs)
        with self.assertRaises(self.store.IntegrityError):  # the end must be after the start
            with self.store.connect() as con:
                vs.add_number(con, "+886227356688", None, "test", "online", NOV1, NOV1, "")
        with self.store.connect() as con:
            self.assertEqual(vs.list_numbers(con), [])

    def test_concurrent_adds_of_one_number_inside_the_write_lock_admit_one(self):
        barrier = threading.Barrier(6)

        def attempt(_):
            barrier.wait()
            try:
                with self.store.connect() as con:
                    con.execute("BEGIN IMMEDIATE")
                    self.add(con)
                return "ok"
            except vs.VoiceStoreError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = sorted(pool.map(attempt, range(6)))
        self.assertEqual(results, ["number_overlap"] * 5 + ["ok"])
        with self.store.connect() as con:
            self.assertEqual(len(vs.list_numbers(con)), 1)


if __name__ == "__main__":
    unittest.main()
