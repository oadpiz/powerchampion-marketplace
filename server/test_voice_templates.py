"""Checks for the industry templates in server/voice_templates/<template_id>.json (phase1 T3).

Format: phase1-contract.md section 5.4 ("voice.template/v1"); limits: sections 1.4, 1.5 and 5.2.

Two layers:
- TemplateFileTests always run. They check the JSON, the contract's keys and types, and the limits in
  both states the template can be in: as shipped (store-specific facts are "（請填入…）" markers) and
  with example_values applied (the fictional P1 demo shop, for internal try calls only).
- CompileTests need T2's compiler (server/voice_compile.py) and skip only while that file is missing; they
  are the T2 + T3 joint acceptance from phase1-tasks.md T3. After T2 is merged they must run with 0 skips.

Run: python3 -m unittest server.test_voice_templates -v
"""

import copy
import json
import re
import unittest
from pathlib import Path

from server.support import INVISIBLE_TEXT, unsafe_text

TEMPLATE_DIR = Path(__file__).resolve().parent / "voice_templates"
TEMPLATE_IDS = ("clinic", "cram")
# P1 demo shop names (P1 llm_eval/kb/behavior_v1.md, assembly step 2); example_values describe these shops.
EXAMPLE_SHOP_NAMES = {"clinic": "晴光牙醫診所", "cram": "啟明文理補習班"}
TITLES = {"clinic": {"zh": "診所", "en": "Clinic"}, "cram": {"zh": "補習班", "en": "Cram school"}}

TOP_KEYS = {"schema", "template_id", "industry", "title", "intro_text", "greeting_example", "hours_example", "faqs", "example_values"}
FAQ_KEYS = {"question", "answer", "variants", "ai_allowed"}
EXAMPLE_KEYS = {"intro_text", "greeting", "faqs"}
EXAMPLE_FAQ_FIELDS = {"question", "answer", "variants"}

# Contract 1.4: the one placeholder regex shared by T2 warnings, T4 needsInput and T8.
PLACEHOLDER = re.compile(r"（請填入(?:：[^）\n]{1,20})?）")
# Contract 1.4: whitespace that does not count toward the opening's length.
NON_SPACE_STRIP = re.compile(r"[ \t\n\r 　]")
# Contract 5.4: business hours belong in hours_example, never in intro_text.
HOURS_WORDS = ("營業時間", "看診時間", "門診時間", "櫃台服務時間", "上班時間")

TEMPLATE_FAQ_MAX = 40  # phase1-tasks T3
FAQ_MAX = 120
QUESTION_CHARS = 100
ANSWER_CHARS = 400
VARIANT_CHARS = 50
VARIANTS_MAX = 10
FAQ_CHARS = 400
KB_CHARS_MAX = 6000
GREETING_CHARS = 40
OPENING_NON_SPACE_MAX = 67
HOURS_SEGMENTS_PER_DAY = 4
HOURS_SEGMENTS_MAX = 28


def load(template_id):
    with open(TEMPLATE_DIR / (template_id + ".json"), encoding="utf-8") as handle:
        return json.load(handle)


def apply_example_values(template):
    """Contract 5.4: intro_text and greeting replace the whole field; faqs[index] fields replace theirs."""
    filled = copy.deepcopy(template)
    values = template["example_values"]
    if "intro_text" in values:
        filled["intro_text"] = values["intro_text"]
    if "greeting" in values:
        filled["greeting_example"] = values["greeting"]
    for entry in values.get("faqs", []):
        for field in EXAMPLE_FAQ_FIELDS & entry.keys():
            filled["faqs"][entry["index"]][field] = copy.deepcopy(entry[field])
    return filled


def faq_chars(faq):
    """Contract 5.2: question + answer + every variant, all stripped."""
    return len(faq["question"].strip()) + len(faq["answer"].strip()) + sum(len(v.strip()) for v in faq["variants"])


def kb_chars(template):
    return len(template["intro_text"].strip()) + sum(faq_chars(faq) for faq in template["faqs"])


def texts(template):
    """(label, text) for every field the store or the AI will see."""
    yield "intro_text", template["intro_text"]
    yield "greeting_example", template["greeting_example"]
    for i, faq in enumerate(template["faqs"]):
        yield "faqs[%d].question" % i, faq["question"]
        yield "faqs[%d].answer" % i, faq["answer"]
        for j, variant in enumerate(faq["variants"]):
            yield "faqs[%d].variants[%d]" % (i, j), variant


def single_line_problem(value, maximum, required=True):
    """Mirror of support.text_value without raising: None when the value is a valid single-line field."""
    if not isinstance(value, str):
        return "not a string"
    if value != value.strip():
        return "leading or trailing whitespace"
    if required and not value:
        return "empty"
    if len(value) > maximum:
        return "%d chars > %d" % (len(value), maximum)
    if unsafe_text(value) or INVISIBLE_TEXT.search(value):
        return "control, bidi or invisible character"
    return None


def multi_line_problem(value, maximum, required=True):
    if not isinstance(value, str):
        return "not a string"
    if value != value.strip():
        return "leading or trailing whitespace"
    if required and not value:
        return "empty"
    if len(value) > maximum:
        return "%d chars > %d" % (len(value), maximum)
    if unsafe_text(value, allow="\n\r\t") or INVISIBLE_TEXT.search(value):
        return "control, bidi or invisible character"
    return None


class TemplateFileTests(unittest.TestCase):
    def setUp(self):
        self.templates = {template_id: load(template_id) for template_id in TEMPLATE_IDS}

    def states(self):
        """(name, template) for the shipped state and the example-filled state."""
        for template_id, template in self.templates.items():
            yield template_id + " (template)", template
            yield template_id + " (example_values)", apply_example_values(template)

    def test_header_matches_the_contract(self):
        for template_id, template in self.templates.items():
            with self.subTest(template=template_id):
                self.assertEqual(set(template), TOP_KEYS)
                self.assertEqual(template["schema"], "voice.template/v1")
                self.assertEqual(template["template_id"], template_id)
                self.assertEqual(template["industry"], template_id)
                self.assertEqual(template["title"], TITLES[template_id])

    def test_faq_entries_have_the_contract_fields(self):
        for template_id, template in self.templates.items():
            self.assertIsInstance(template["faqs"], list)
            for i, faq in enumerate(template["faqs"]):
                with self.subTest(template=template_id, faq=i):
                    self.assertEqual(set(faq), FAQ_KEYS)
                    self.assertIsInstance(faq["ai_allowed"], bool)
                    self.assertIsInstance(faq["variants"], list)

    def test_faq_count_within_limits(self):
        for template_id, template in self.templates.items():
            with self.subTest(template=template_id):
                self.assertGreater(len(template["faqs"]), 0)
                self.assertLessEqual(len(template["faqs"]), min(TEMPLATE_FAQ_MAX, FAQ_MAX))

    def test_field_limits_in_both_states(self):
        for name, template in self.states():
            problems = []
            for label, problem in (
                ("intro_text", multi_line_problem(template["intro_text"], KB_CHARS_MAX, required=False)),
                ("greeting_example", single_line_problem(template["greeting_example"], GREETING_CHARS, required=False)),
            ):
                if problem:
                    problems.append(label + ": " + problem)
            for i, faq in enumerate(template["faqs"]):
                for label, problem in (
                    ("question", single_line_problem(faq["question"], QUESTION_CHARS)),
                    ("answer", multi_line_problem(faq["answer"], ANSWER_CHARS)),
                ):
                    if problem:
                        problems.append("faqs[%d].%s: %s" % (i, label, problem))
                if len(faq["variants"]) > VARIANTS_MAX:
                    problems.append("faqs[%d]: %d variants > %d" % (i, len(faq["variants"]), VARIANTS_MAX))
                for j, variant in enumerate(faq["variants"]):
                    problem = single_line_problem(variant, VARIANT_CHARS)
                    if problem:
                        problems.append("faqs[%d].variants[%d]: %s" % (i, j, problem))
                if faq_chars(faq) > FAQ_CHARS:
                    problems.append("faqs[%d]: %d chars > %d" % (i, faq_chars(faq), FAQ_CHARS))
            with self.subTest(state=name):
                self.assertEqual(problems, [])
                self.assertLessEqual(kb_chars(template), KB_CHARS_MAX)

    def test_no_duplicate_questions_or_variants(self):
        for template_id, template in self.templates.items():
            questions = [faq["question"] for faq in template["faqs"]]
            with self.subTest(template=template_id):
                self.assertEqual(len(questions), len(set(questions)))
            for i, faq in enumerate(template["faqs"]):
                with self.subTest(template=template_id, faq=i):
                    self.assertEqual(len(faq["variants"]), len(set(faq["variants"])))
                    self.assertNotIn(faq["question"], faq["variants"])

    def test_every_marker_matches_the_contract_regex(self):
        # A marker the regex misses (e.g. a hint longer than 20 characters) would never be flagged by T2/T4.
        for template_id, template in self.templates.items():
            for label, text in texts(template):
                with self.subTest(template=template_id, field=label):
                    self.assertEqual(text.count("請填入"), len(PLACEHOLDER.findall(text)))

    def test_store_specific_facts_are_markers(self):
        for template_id, template in self.templates.items():
            with self.subTest(template=template_id):
                self.assertRegex(template["intro_text"], PLACEHOLDER)
                self.assertGreaterEqual(sum(bool(PLACEHOLDER.search(faq["answer"])) for faq in template["faqs"]), 20)

    def test_example_values_are_well_formed(self):
        for template_id, template in self.templates.items():
            values = template["example_values"]
            with self.subTest(template=template_id):
                self.assertLessEqual(set(values), EXAMPLE_KEYS)
                indexes = [entry["index"] for entry in values.get("faqs", [])]
                self.assertEqual(len(indexes), len(set(indexes)))
            for entry in values.get("faqs", []):
                with self.subTest(template=template_id, index=entry.get("index")):
                    self.assertIsInstance(entry["index"], int)
                    self.assertNotIsInstance(entry["index"], bool)
                    self.assertTrue(0 <= entry["index"] < len(template["faqs"]))
                    self.assertLessEqual(set(entry), {"index"} | EXAMPLE_FAQ_FIELDS)
                    self.assertTrue(EXAMPLE_FAQ_FIELDS & entry.keys())

    def test_example_values_leave_no_markers(self):
        for template_id, template in self.templates.items():
            filled = apply_example_values(template)
            for label, text in texts(filled):
                with self.subTest(template=template_id, field=label):
                    self.assertNotIn("請填入", text)

    def test_intro_text_has_no_business_hours(self):
        for name, template in self.states():
            for word in HOURS_WORDS:
                with self.subTest(state=name, word=word):
                    self.assertNotIn(word, template["intro_text"])

    def test_hours_example_is_valid(self):
        # Contract 3.3 rule 4 (snake_case keys in the template file) and 3.2 ordering.
        for template_id, template in self.templates.items():
            hours = template["hours_example"]
            with self.subTest(template=template_id):
                self.assertTrue(0 < len(hours) <= HOURS_SEGMENTS_MAX)
                self.assertEqual(hours, sorted(hours, key=lambda s: (s["weekday"], s["open_min"])))
            by_day = {}
            for segment in hours:
                with self.subTest(template=template_id, segment=segment):
                    self.assertEqual(set(segment), {"weekday", "open_min", "close_min"})
                    for key in segment:
                        self.assertIs(type(segment[key]), int)
                    self.assertTrue(0 <= segment["weekday"] <= 6)
                    self.assertTrue(0 <= segment["open_min"] < segment["close_min"] <= 1440)
                by_day.setdefault(segment["weekday"], []).append(segment)
            for weekday, segments in by_day.items():
                with self.subTest(template=template_id, weekday=weekday):
                    self.assertLessEqual(len(segments), HOURS_SEGMENTS_PER_DAY)
                    for a, b in zip(segments, segments[1:]):
                        self.assertLessEqual(a["close_min"], b["open_min"])

    def test_some_question_is_not_answered_by_ai(self):
        # Shows the store the "這題不要 AI 回答" switch; the AI then promises a callback instead.
        for template_id, template in self.templates.items():
            with self.subTest(template=template_id):
                self.assertIn(False, [faq["ai_allowed"] for faq in template["faqs"]])

    def test_answers_follow_the_behavior_rules(self):
        # T2 behavior_v1.md rule 6 (no "好的" style opener) and rule 9 (one thing at a time when booking,
        # rescheduling, cancelling or taking leave): the AI copies FAQ answers, so they must not contradict them.
        for name, template in self.states():
            for i, faq in enumerate(template["faqs"]):
                answer = faq["answer"]
                asked = re.findall(r"[^。？?]*[？?]", answer)
                with self.subTest(state=name, faq=i):
                    self.assertFalse(answer.startswith(("好的", "了解", "沒問題")))
                    self.assertLessEqual(len(asked), 1)
                    for sentence in asked:  # one short question, not a list such as "哪一天、哪個時段、幾位"
                        self.assertNotIn("、", sentence)
                        self.assertLessEqual(len(sentence.split("，")[-1]), 20)

    def test_emergency_question_points_to_119(self):
        for template_id, template in self.templates.items():
            emergency = [faq for faq in template["faqs"] if "呼吸困難" in faq["variants"]]
            with self.subTest(template=template_id):
                self.assertEqual(len(emergency), 1)
                self.assertIn("119", emergency[0]["answer"])
                self.assertTrue(emergency[0]["ai_allowed"])
                self.assertIsNone(PLACEHOLDER.search(emergency[0]["answer"]))

    def test_opening_fits_with_the_draft_disclosure(self):
        # Contract 1.4: disclosure (shop name filled in) + greeting, without whitespace, at most 67 chars.
        path = TEMPLATE_DIR / "disclosure_draft0.txt"
        if not path.exists():
            self.skipTest("T2 disclosure_draft0.txt is not merged yet")
        disclosure = path.read_text(encoding="utf-8").split("\n", 1)[1].strip()
        for template_id, template in self.templates.items():
            for name, filled in (("template", template), ("example_values", apply_example_values(template))):
                opening = disclosure.replace("{{SHOP_NAME}}", EXAMPLE_SHOP_NAMES[template_id]) + filled["greeting_example"]
                with self.subTest(template=template_id, state=name):
                    self.assertLessEqual(len(NON_SPACE_STRIP.sub("", opening)), OPENING_NON_SPACE_MAX)


class CompileTests(unittest.TestCase):
    """T2 + T3 joint acceptance. Skips only while server/voice_compile.py does not exist; once it exists, any
    import error or signature mismatch fails instead of skipping."""

    def compile(self, template_id, filled):
        if not (Path(__file__).resolve().parent / "voice_compile.py").exists():
            self.skipTest("T2 server/voice_compile.py is not merged yet")
        from server import voice_compile

        template = load(template_id)
        if filled:
            template = apply_example_values(template)
        # T2's input shape (voice_compile.py docstring): the store row as T1 stores it, then faqs, hours and
        # closures as separate arguments, and the version as a keyword.
        store = {
            "id": "0123456789abcdef0123456789abcdef",
            "name": EXAMPLE_SHOP_NAMES[template_id],
            "greeting": template["greeting_example"],
            "intro_text": template["intro_text"],
            "after_hours_mode": "answer_and_message",
            "ask_callback": "auto",
            "max_message_seconds": 120,
            "handoff_mode": "callback",
            "recording_mode": "message_only",
            "retention_days": 90,
            "ai_answer_enabled": False,
        }
        faqs = [
            {"id": "%032x" % (i + 1), "position": i, "question": faq["question"], "answer": faq["answer"],
             "variants": faq["variants"], "ai_allowed": faq["ai_allowed"]}
            for i, faq in enumerate(template["faqs"])
        ]
        config = voice_compile.compile_store(store, faqs, template["hours_example"], [], version=1)
        return config, faqs

    def test_filled_templates_compile_without_warnings(self):
        for template_id in TEMPLATE_IDS:
            config, _ = self.compile(template_id, filled=True)
            with self.subTest(template=template_id):
                self.assertEqual(config["warnings"], [])
                self.assertLessEqual(config["kb_chars"], KB_CHARS_MAX)
                self.assertEqual(config["shop_name"], EXAMPLE_SHOP_NAMES[template_id])
                self.assertEqual(config["hours"], load(template_id)["hours_example"])
                # Hours come from hours_example (contract 5.4), so the compiled store data has them.
                self.assertIn("## 每週營業時間", config["prompt"]["prefix"])

    def test_unfilled_templates_list_every_marker(self):
        for template_id in TEMPLATE_IDS:
            config, faqs = self.compile(template_id, filled=False)
            expected = [{"code": "placeholder_unfilled", "field": "intro", "faq_id": None}] + [
                {"code": "placeholder_unfilled", "field": "faq", "faq_id": faq["id"]}
                for faq in faqs
                if any(PLACEHOLDER.search(text) for text in [faq["question"], faq["answer"], *faq["variants"]])
            ]
            with self.subTest(template=template_id):
                self.assertEqual(config["warnings"], expected)
                self.assertLessEqual(config["kb_chars"], KB_CHARS_MAX)


if __name__ == "__main__":
    unittest.main()
