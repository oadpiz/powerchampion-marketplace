"""Tests for server/voice_compile.py (phase1-tasks T2, phase1-contract §1.4, §1.5, §5.1-§5.3).

Golden fixtures (server/fixtures/) and how they were made, 2026-10-22:
- voice_p1_clinic_kb.md: P1 kb/clinic_kb.md (sha256 b88a252d...a894e8) without its first line, the fiction
  disclaimer, exactly as P1's kb_text() returns it, plus one trailing newline. The disclaimer is P1 test text,
  not store data.
- voice_p1_clinic_expected.txt: P1's own functions, imported from
  sell-panel/docs/poc-p1-2026-10-21/scripts/llm_eval/llm_eval.py (sha256 f59b0baa...0a4a), run as
      system_prompt({"behavior": "<this repo>/server/voice_templates/behavior_v1.md",
                     "kb": {"clinic": "<P1>/llm_eval/kb/clinic_kb.md"}}, "clinic", "open")
  which is steps 1-4 of the assembly notes in P1 behavior_v1.md: the text between the PROMPT START/END
  markers with leading and trailing newlines removed, {{SHOP_NAME}} -> 晴光牙醫診所, {{KB}} -> clinic_kb.md
  without its first line, {{MODE}} -> 營業時間內. Written as UTF-8 with no trailing newline.
  The behavior file is this repo's portal version (P1 behavior_v1.md with rules 1, 4, 5, 6, 9 and 10
  changed, see its header); P1's wording and assembly are otherwise unchanged. Regenerate this fixture with
  the call above whenever behavior_v1.md changes.
"""
import copy
import hashlib
import json
import random
import unittest
from pathlib import Path

from server import voice_compile as vc
from server.voice_compile import CompileError, compile_store

FIXTURES = Path(__file__).resolve().parent / "fixtures"
TEMPLATES = Path(__file__).resolve().parent / "voice_templates"
STORE_ID = "0123456789abcdef0123456789abcdef"
P1_BEHAVIOR_SHA256 = "f6337d3cae50d8e0383889743ee2ac597a94d7a95d8b5f9551e751bfc3eeac4c"


def fid(number):
    return "%032x" % number


def faq(number, question="洗牙多少錢？", answer="健保洗牙每半年一次免費。", variants=(), ai_allowed=True, position=None):
    return {"id": fid(number), "question": question, "answer": answer, "variants": list(variants),
            "ai_allowed": ai_allowed, "position": number if position is None else position}


def store(**fields):
    return {"id": STORE_ID, "name": "晴光牙醫診所", "intro_text": "診所在台北市大安區。", **fields}


def build(store_fields=None, faqs=(), hours=(), closures=(), version=1):
    return compile_store(store(**(store_fields or {})), list(faqs), list(hours), list(closures), version=version)


def code_of(test, store_fields=None, faqs=(), hours=(), closures=(), version=1):
    with test.assertRaises(CompileError) as caught:
        build(store_fields, faqs, hours, closures, version)
    return caught.exception.code


class GoldenTests(unittest.TestCase):
    def setUp(self):
        self.kb = (FIXTURES / "voice_p1_clinic_kb.md").read_text(encoding="utf-8")
        self.expected = (FIXTURES / "voice_p1_clinic_expected.txt").read_bytes().decode("utf-8")
        self.config = compile_store({"id": STORE_ID, "name": "晴光牙醫診所", "intro_text": self.kb}, [], [], [], version=1)

    def test_prefix_plus_open_mode_matches_p1_assembly_byte_for_byte(self):
        prompt = self.config["prompt"]
        self.assertEqual(prompt["prefix"] + "\n\n【目前情境】" + "營業時間內", self.expected)
        self.assertEqual(vc.system_prompt(self.config, "open"), self.expected)
        self.assertEqual(prompt["mode_separator"], "\n\n【目前情境】")
        self.assertEqual(prompt["modes"], {"open": "營業時間內", "after_hours": "下班時間"})

    def test_after_hours_differs_only_in_the_last_line(self):
        self.assertTrue(self.expected.endswith("營業時間內"))
        self.assertEqual(vc.system_prompt(self.config, "after_hours"), self.expected[:-len("營業時間內")] + "下班時間")

    def test_store_data_is_the_kb_unchanged(self):
        prefix = self.config["prompt"]["prefix"]
        self.assertTrue(prefix.endswith("\n\n【店家資料】\n" + self.kb.strip()))
        self.assertEqual(self.config["kb_chars"], len(self.kb.strip()))
        self.assertEqual(self.config["warnings"], [{"code": "hours_empty", "field": None, "faq_id": None}])
        self.assertEqual(self.config["prompt"]["prefix_sha256"], hashlib.sha256(prefix.encode("utf-8")).hexdigest())

    def test_same_input_twice_gives_the_same_sha256(self):
        faqs = [faq(n, question="問題%d？" % n, answer="答案%d。" % n, variants=["問法%d" % n], ai_allowed=n % 3 != 0) for n in range(8)]
        hours = [{"weekday": 0, "open_min": 840, "close_min": 1080}, {"weekday": 0, "open_min": 540, "close_min": 720},
                 {"weekday": 5, "open_min": 540, "close_min": 780}]
        closures = [{"date": "2026-12-25", "note": "院內訓練"}, {"date": "2026-11-01", "note": ""}]
        fields = {"intro_text": self.kb, "after_hours_mode": "message_only", "greeting": "請問有什麼可以幫您？"}
        first = build(fields, faqs, hours, closures, version=3)
        shuffled = copy.deepcopy(faqs)
        random.Random(7).shuffle(shuffled)
        second = build(dict(fields), shuffled, list(reversed(hours)), list(reversed(closures)), version=3)
        self.assertEqual(vc.canonical_json(first), vc.canonical_json(second))
        self.assertEqual(vc.config_sha256(first), vc.config_sha256(second))
        self.assertNotEqual(vc.config_sha256(first), vc.config_sha256(build(fields, faqs, hours, closures, version=4)))

    def test_prefix_is_the_same_for_open_and_after_hours(self):
        config = build({"after_hours_mode": "message_only"}, [faq(1), faq(2, question="植牙多少錢？", ai_allowed=False)],
                       [{"weekday": 0, "open_min": 540, "close_min": 720}])
        open_prompt, closed_prompt = vc.system_prompt(config, "open"), vc.system_prompt(config, "after_hours")
        head = config["prompt"]["prefix"] + config["prompt"]["mode_separator"]
        self.assertEqual(open_prompt, head + "營業時間內")
        self.assertEqual(closed_prompt, head + "下班時間")
        self.assertNotIn("【目前情境】", config["prompt"]["prefix"])


class ContentTests(unittest.TestCase):
    def test_default_settings_add_no_rules_and_numbering_continues_when_they_do(self):
        plain = build()["prompt"]["prefix"]
        self.assertNotIn("\n13. ", plain)
        both = build({"after_hours_mode": "message_only"}, [faq(1, ai_allowed=False)])["prompt"]["prefix"]
        rules, store_data = both.split("\n\n【店家資料】\n")
        self.assertIn("\n12. 不提供老師或員工的私人電話、LINE 或住址。\n13. 下面這些問題不要自己回答", rules)
        self.assertIn("\n14. 下班時間只幫客人留言", rules)
        self.assertEqual(store_data, "診所在台北市大安區。")

    def test_questions_the_ai_must_not_answer_are_listed_without_answers(self):
        config = build(faqs=[faq(1, question="洗牙多少錢？", answer="健保洗牙免費。"),
                             faq(2, question="植牙多少錢？", answer="植牙每顆八萬。", ai_allowed=False),
                             faq(0, question="可以開止痛藥嗎？", answer="要醫師判斷。", ai_allowed=0)])
        prefix = config["prompt"]["prefix"]
        self.assertNotIn("植牙每顆八萬", prefix)
        self.assertNotIn("要醫師判斷", prefix)
        self.assertIn("請說「這個問題會請專人回電跟您說明」，再請客人留下姓名和電話：\n- 可以開止痛藥嗎？\n- 植牙多少錢？\n\n【店家資料】", prefix)
        self.assertEqual(config["rules"]["no_ai_questions"], ["可以開止痛藥嗎？", "植牙多少錢？"])
        self.assertIn("## 常見問答\n問：洗牙多少錢？\n答：健保洗牙免費。", prefix)
        self.assertEqual(config["kb_chars"], len("診所在台北市大安區。") + len("洗牙多少錢？健保洗牙免費。植牙多少錢？植牙每顆八萬。可以開止痛藥嗎？要醫師判斷。"))

    def test_faqs_follow_position_and_list_variants(self):
        config = build(faqs=[faq(5, question="第二題？", answer="二。", position=1),
                             faq(9, question="第一題？", answer="一。", variants=["  ", "問法甲", " 問法乙 "], position=0)])
        self.assertIn("問：第一題？\n也可能問：問法甲；問法乙\n答：一。\n\n問：第二題？\n答：二。", config["prompt"]["prefix"])

    def test_hours_and_closures_become_store_data_after_the_description(self):
        hours = [{"weekday": 0, "open_min": 840, "close_min": 1080}, {"weekday": 0, "open_min": 540, "close_min": 720},
                 {"weekday": 2, "open_min": 1140, "close_min": 1290}, {"weekday": 4, "open_min": 1200, "close_min": 1440},
                 {"weekday": 5, "open_min": 0, "close_min": 1440},
                 {"weekday": 6, "open_min": 270, "close_min": 735}]
        config = build(faqs=[faq(1)], hours=hours, closures=[{"date": "2026-12-25", "note": "院內訓練"}, {"date": "2026-11-01", "note": ""}])
        store_data = config["prompt"]["prefix"].split("\n\n【店家資料】\n")[1]
        self.assertEqual(store_data, "\n".join([
            "診所在台北市大安區。", "", "## 每週營業時間",
            "- 週一：上午 9 點到中午 12 點、下午 2 點到 6 點", "- 週二：休息", "- 週三：晚上 7 點到 9 點半",
            "- 週四：休息", "- 週五：晚上 8 點到半夜 12 點", "- 週六：24 小時營業", "- 週日：凌晨 4 點半到中午 12 點 15 分",
            "", "## 特別休息日", "- 2026 年 11 月 1 日 週日 休息", "- 2026 年 12 月 25 日 週五 休息：院內訓練",
            "", "## 常見問答", "問：洗牙多少錢？", "答：健保洗牙每半年一次免費。"]))
        self.assertEqual([(h["weekday"], h["open_min"]) for h in config["hours"]], [(0, 540), (0, 840), (2, 1140), (4, 1200), (5, 0), (6, 270)])
        self.assertEqual([c["date"] for c in config["closures"]], ["2026-11-01", "2026-12-25"])
        self.assertEqual(config["warnings"], [])

    def test_closures_alone_do_not_invent_weekly_hours(self):
        config = build(closures=[{"date": "2026-12-25", "note": ""}])
        self.assertNotIn("每週營業時間", config["prompt"]["prefix"])
        self.assertIn("## 特別休息日", config["prompt"]["prefix"])
        self.assertEqual(config["warnings"], [{"code": "hours_empty", "field": None, "faq_id": None}])

    def test_unfilled_placeholders_are_warned_in_contract_order(self):
        config = build({"intro_text": "地址：（請填入：地址）。"},
                       faqs=[faq(2, answer="自費（請填入）元。", position=1), faq(1, position=0),
                             faq(3, variants=["（請填入：別的說法）"], position=2, ai_allowed=False),
                             faq(4, answer="（請填入：這是超過二十個字的說明文字不算標記喔喔喔喔）", position=3)])
        self.assertEqual(config["warnings"], [
            {"code": "placeholder_unfilled", "field": "intro", "faq_id": None},
            {"code": "placeholder_unfilled", "field": "faq", "faq_id": fid(2)},
            {"code": "placeholder_unfilled", "field": "faq", "faq_id": fid(3)},
            {"code": "hours_empty", "field": None, "faq_id": None}])

    def test_opening_and_rules_follow_the_contract(self):
        config = build({"greeting": "請問有什麼可以幫您？", "ask_callback": "always", "max_message_seconds": 90,
                        "recording_mode": "full", "retention_days": 30, "ai_answer_enabled": 1}, version=7)
        disclosure = vc.disclosure_template().replace("{{SHOP_NAME}}", "晴光牙醫診所")
        self.assertEqual(config["opening"]["text"], disclosure + "請問有什麼可以幫您？")
        self.assertEqual(config["opening"]["est_seconds"], round(vc.non_space(config["opening"]["text"]) / 4.5, 1))
        self.assertEqual(config["opening"]["disclosure_version"], "draft-0")
        self.assertEqual(config["rules"], {"ask_callback": "always", "handoff_mode": "callback", "max_message_seconds": 90,
                                           "after_hours_mode": "answer_and_message", "no_ai_questions": [],
                                           "recording_mode": "full", "retention_days": 30, "ai_answer_enabled": True})
        self.assertEqual((config["schema"], config["store_id"], config["version"], config["shop_name"]),
                         ("voice.store-config/v1", STORE_ID, 7, "晴光牙醫診所"))
        self.assertEqual(set(config), {"schema", "store_id", "version", "shop_name", "opening", "prompt", "hours",
                                       "closures", "rules", "kb_chars", "warnings"})

    def test_defaults_are_the_a2_defaults(self):
        rules = build()["rules"]
        self.assertEqual((rules["after_hours_mode"], rules["ask_callback"], rules["max_message_seconds"], rules["handoff_mode"],
                          rules["recording_mode"], rules["retention_days"], rules["ai_answer_enabled"]),
                         ("answer_and_message", "auto", 120, "callback", "message_only", 90, False))

    def test_store_text_is_never_expanded_as_a_placeholder(self):
        config = build({"name": "{{KB}}牙醫", "intro_text": "介紹{{SHOP_NAME}}{{MODE}}"}, [faq(1, answer="答{{KB}}")])
        prefix = config["prompt"]["prefix"]
        self.assertIn("你是「{{KB}}牙醫」的電話客服人員", prefix)
        self.assertIn("\n\n【店家資料】\n介紹{{SHOP_NAME}}{{MODE}}", prefix)
        self.assertIn("答：答{{KB}}", prefix)

    def test_text_is_stripped_and_inputs_are_not_changed(self):
        faqs = [faq(1, question="  洗牙多少錢？ ", answer="\n免費。\n")]
        before = copy.deepcopy(faqs)
        config = build({"name": " 晴光 ", "greeting": " 您好 ", "intro_text": "\n介紹。\n\n"}, faqs)
        self.assertEqual(faqs, before)
        self.assertEqual(config["shop_name"], "晴光")
        self.assertTrue(config["opening"]["text"].endswith("您好"))
        self.assertIn("\n\n【店家資料】\n介紹。\n\n## 常見問答\n問：洗牙多少錢？\n答：免費。", config["prompt"]["prefix"])

    def test_canonical_json_keeps_chinese_as_utf8(self):
        self.assertEqual(vc.canonical_json({"b": "晴光", "a": [1, None]}), '{"a":[1,null],"b":"晴光"}'.encode("utf-8"))
        config = build()
        self.assertEqual(json.loads(vc.canonical_json(config)), config)


class LimitTests(unittest.TestCase):
    def test_opening_over_15_seconds_is_refused_at_68_non_space_characters(self):
        fixed = vc.non_space(vc.disclosure_template().replace("{{SHOP_NAME}}", "晴光牙醫診所"))
        self.assertEqual(vc.OPENING_NON_SPACE_MAX, 67)
        ok = build({"greeting": "好" * (67 - fixed)})
        self.assertEqual(vc.non_space(ok["opening"]["text"]), 67)
        self.assertLessEqual(ok["opening"]["est_seconds"], 15)
        self.assertEqual(code_of(self, {"greeting": "好" * (68 - fixed)}), "opening_too_long")
        # Spaces, tabs, NBSP and U+3000 do not count; other spaces do (one regex for back end and front end).
        self.assertEqual(vc.non_space("a b\tc d　e f"), 7)

    def test_text_limits(self):
        self.assertEqual(code_of(self, {"name": "店" * 41}), "invalid_input")
        self.assertEqual(code_of(self, {"name": "   "}), "invalid_input")
        self.assertEqual(code_of(self, {"greeting": "您" * 41}), "greeting_too_long")
        self.assertEqual(code_of(self, faqs=[faq(1, question="問" * 101)]), "invalid_input")
        self.assertEqual(code_of(self, faqs=[faq(1, answer="")]), "invalid_input")
        self.assertEqual(code_of(self, faqs=[faq(1, variants=["法" * 51])]), "invalid_input")
        self.assertEqual(code_of(self, faqs=[faq(1, variants=["法%d" % n for n in range(11)])]), "invalid_input")

    def test_one_faq_over_400_characters_is_refused(self):
        build(faqs=[faq(1, question="問" * 100, answer="答" * 250, variants=["法" * 50])])
        self.assertEqual(code_of(self, faqs=[faq(1, question="問" * 100, answer="答" * 251, variants=["法" * 50])]), "faq_too_long")

    def test_more_than_120_faqs_is_refused(self):
        build({"intro_text": ""}, [faq(n, question="問%d？" % n, answer="答。") for n in range(120)])
        self.assertEqual(code_of(self, {"intro_text": ""}, [faq(n, question="問%d？" % n, answer="答。") for n in range(121)]), "faq_limit")

    def test_store_data_over_6000_characters_is_refused(self):
        filler = [faq(n, question="問" * 50, answer="答" * 340) for n in range(15)]  # 15 x 390 = 5850
        ok = build({"intro_text": "介" * 150}, filler)
        self.assertEqual(ok["kb_chars"], 6000)
        self.assertEqual(code_of(self, {"intro_text": "介" * 151}, filler), "kb_too_large")
        # Questions the AI must not answer still count (§5.2).
        hidden = [dict(item, ai_allowed=False) for item in filler]
        self.assertEqual(code_of(self, {"intro_text": "介" * 151}, hidden), "kb_too_large")

    def test_empty_store_data_is_refused(self):
        self.assertEqual(code_of(self, {"intro_text": "  \n "}), "kb_empty")
        build({"intro_text": ""}, [faq(1)])

    def test_control_bidi_and_invisible_characters_are_refused(self):
        cases = [({"intro_text": "介紹\x00"}, ()), ({"intro_text": "介紹\x1b[31m"}, ()), ({"intro_text": "\x7f"}, ()),
                 ({"name": "晴光‮"}, ()), ({"name": "晴​光"}, ()), ({"name": "晴光\n牙醫"}, ()),
                 ({"greeting": "您好\x85"}, ()), ({"greeting": "您好⁦"}, ()),
                 ({}, [faq(1, question="洗牙‍？")]), ({}, [faq(1, answer="免費\x08")]),
                 ({}, [faq(1, variants=["洗\ud800牙"])]), ({}, [faq(1, question="洗牙\t？")])]
        for fields, faqs in cases:
            with self.subTest(fields=fields, faqs=faqs):
                self.assertEqual(code_of(self, fields, faqs), "invalid_input")
        build({"intro_text": "第一行\n第二行\r\n\t縮排"}, [faq(1, answer="第一行\n第二行")])

    def test_hours_must_be_valid_segments(self):
        bad = [[{"weekday": 7, "open_min": 0, "close_min": 60}], [{"weekday": 0, "open_min": 600, "close_min": 600}],
               [{"weekday": 0, "open_min": 0, "close_min": 1441}], [{"weekday": True, "open_min": 0, "close_min": 60}],
               [{"weekday": 0, "open_min": "540", "close_min": 720}],
               [{"weekday": 0, "open_min": 540, "close_min": 720}, {"weekday": 0, "open_min": 700, "close_min": 800}],
               [{"weekday": 1, "open_min": 60 * n, "close_min": 60 * n + 30} for n in range(5)], ["09:00-12:00"]]
        for hours in bad:
            with self.subTest(hours=hours):
                self.assertEqual(code_of(self, hours=hours), "hours_invalid")
        build(hours=[{"weekday": 0, "open_min": 540, "close_min": 720}, {"weekday": 0, "open_min": 720, "close_min": 780}])

    def test_closures_must_be_valid_unique_dates(self):
        bad = [[{"date": "2026-02-30", "note": ""}], [{"date": "20261225", "note": ""}], [{"date": "2026-12-25", "note": "休" * 41}],
               [{"date": "2026-12-25", "note": "a"}, {"date": "2026-12-25", "note": "b"}], [{"date": "2026-12-25", "note": "休\n息"}],
               [{"date": "2026-01-%02d" % (n % 28 + 1), "note": ""} for n in range(61)]]
        for closures in bad:
            with self.subTest(closures=closures):
                self.assertEqual(code_of(self, closures=closures), "closures_invalid")

    def test_settings_must_be_known_values(self):
        for fields in [{"after_hours_mode": "silent"}, {"ask_callback": "sometimes"}, {"max_message_seconds": 59},
                       {"max_message_seconds": 181}, {"max_message_seconds": True}, {"handoff_mode": "transfer"},
                       {"recording_mode": "always"}, {"retention_days": 0}, {"ai_answer_enabled": "yes"},
                       {"ai_answer_enabled": 2}, {"greeting": None}]:
            with self.subTest(fields=fields):
                self.assertEqual(code_of(self, fields), "invalid_input")
        self.assertEqual(code_of(self, {"recording_mode": "full", "retention_days": 31}), "retention_exceeds_limit")
        self.assertEqual(code_of(self, {"retention_days": 91}), "retention_exceeds_limit")
        build({"recording_mode": "off", "retention_days": 90})

    def test_ids_and_version_are_checked(self):
        self.assertEqual(code_of(self, version=0), "invalid_input")
        self.assertEqual(code_of(self, version=True), "invalid_input")
        self.assertEqual(code_of(self, {"id": STORE_ID.upper()}), "invalid_input")
        self.assertEqual(code_of(self, faqs=[faq(1), faq(1, position=2)]), "invalid_input")
        self.assertEqual(code_of(self, faqs=[dict(faq(1), id="1")]), "invalid_input")
        self.assertEqual(code_of(self, faqs=[faq(1, position=-1)]), "invalid_input")


class TemplateFileTests(unittest.TestCase):
    def test_behavior_template_records_its_p1_source(self):
        text = (TEMPLATES / "behavior_v1.md").read_text(encoding="utf-8")
        self.assertIn("poc-p1-2026-10-21/llm_eval/kb/behavior_v1.md", text)
        self.assertIn(P1_BEHAVIOR_SHA256, text)
        self.assertEqual(text.count("<!-- PROMPT START -->"), 1)
        self.assertEqual(text.count("<!-- PROMPT END -->"), 1)
        prompt = text[text.index("<!-- PROMPT START -->") + len("<!-- PROMPT START -->"):text.index("<!-- PROMPT END -->")]
        for placeholder in ("{{SHOP_NAME}}", "{{KB}}", "{{MODE}}"):
            self.assertEqual(prompt.count(placeholder), 1, placeholder)

    def test_behavior_template_keeps_the_p1_item3_lessons(self):
        rules = vc.behavior_template()
        for phrase in ["店家資料有寫的，就照資料直接回答，不要說不確定",  # do not refuse what the store data answers
                       "會請專人回電跟您說明",  # cannot answer -> the store calls back
                       "不能說「已經預約成功」",  # never claim a booking
                       "客人留電話時，不要把號碼念回去",  # the program, not the model, confirms numbers
                       "每次只回答 1 到 2 句，總共 40 個字以內。用平常講電話的口語和短句"]:
            self.assertIn(phrase, rules)
        self.assertNotIn("一定要整串覆誦", rules)
        self.assertNotIn("請專人接聽", rules)

    def test_disclosure_draft_is_marked_and_short(self):
        lines = (TEMPLATES / "disclosure_draft0.txt").read_text(encoding="utf-8").split("\n")
        self.assertTrue(lines[0].startswith("草稿"))
        self.assertIn("不可對外", lines[0])
        sentence = vc.disclosure_template()
        self.assertEqual(sentence, lines[1])
        self.assertNotIn("草稿", sentence)
        for words in ("AI", "錄音"):
            self.assertIn(words, sentence)
        # A 10-character store name and a 20-character greeting must fit in 15 seconds.
        self.assertLessEqual(vc.non_space(sentence.replace("{{SHOP_NAME}}", "")) + 10 + 20, vc.OPENING_NON_SPACE_MAX)


if __name__ == "__main__":
    unittest.main()
