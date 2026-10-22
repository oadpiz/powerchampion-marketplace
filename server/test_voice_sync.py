"""Front-end and back-end voice enums must be the same lists (LESSONS 2026-10-21).

The per-page sync tests in test_voice_merchant.py, test_admin_voice.py and tests/*.test.tsx skip themselves when the
other half is not in the tree, because the branches were built apart. This file is for the merged branch: it never
skips. A missing file or constant is a failure, so a rename cannot turn the check into a silent skip.
"""

import os
import re
import unittest
from pathlib import Path

from server import admin_voice as av
from server import voice_compile as vc
from server import voice_merchant as vm
from server import voice_store as vs

# PC_VOICE_FRONTEND_ROOT points the front-end half at another checkout (used to prove the checks can fail).
ROOT = Path(os.environ.get("PC_VOICE_FRONTEND_ROOT") or Path(__file__).resolve().parents[1])
SETUP = ROOT / "lib" / "voice-setup.ts"
FAQ = ROOT / "lib" / "voice-faq.ts"
SHELL = ROOT / "components" / "account-voice.tsx"
DIALOGS = ROOT / "components" / "admin-voice-dialogs.tsx"
TEMPLATES = Path(__file__).resolve().parent / "voice_templates"


def ts_const(path, name):
    """`export const NAME = ["a", "b"] as const;` (one or more lines) -> ["a", "b"]."""
    match = re.search(r"^export const " + name + r" = \[([^\]]*)\] as const;", path.read_text(encoding="utf-8"),
                      re.MULTILINE)
    if match is None:
        raise AssertionError("%s is not defined as `export const %s = [...] as const;` in %s" % (name, name, path))
    return re.findall(r'"([^"]*)"', match.group(1))


def ts_record_keys(path, start):
    """Keys of a `{ key: [...], ... };` object literal that begins with `start`."""
    text = path.read_text(encoding="utf-8")
    begin = text.index(start)
    return re.findall(r"^\s*(\w+): \[", text[begin:text.index("};", begin)], re.MULTILINE)


class VoiceEnumSyncTests(unittest.TestCase):
    def test_front_end_files_are_in_the_tree(self):
        for path in (SETUP, FAQ, SHELL, DIALOGS):
            with self.subTest(path=str(path)):
                self.assertTrue(path.is_file(), "%s is missing; the merged branch must carry both halves" % path)

    def test_store_setting_enums(self):
        # The setup page (T7) offers these; voice_store checks the columns and voice_compile checks the draft.
        self.assertEqual(ts_const(SETUP, "INDUSTRIES"), list(vs.INDUSTRIES))
        self.assertEqual(ts_const(SETUP, "AFTER_HOURS_MODES"), list(vs.AFTER_HOURS_MODES))
        self.assertEqual(ts_const(SETUP, "ASK_CALLBACK"), list(vs.ASK_CALLBACK))
        self.assertEqual(ts_const(SETUP, "RECORDING_MODES"), list(vs.RECORDING_MODES))
        self.assertEqual(list(vc.AFTER_HOURS_MODES), list(vs.AFTER_HOURS_MODES))
        self.assertEqual(list(vc.ASK_CALLBACK_VALUES), list(vs.ASK_CALLBACK))
        self.assertEqual(list(vc.RECORDING_MODES), list(vs.RECORDING_MODES))
        # Phase 1 compiles callback only; the table also allows transfer for later phases.
        self.assertTrue(set(vc.HANDOFF_MODES) <= set(vs.HANDOFF_MODES))

    def test_operator_enums(self):
        # /admin/voice (T10) and the account shell (T6) show these.
        self.assertEqual(ts_const(DIALOGS, "VOICE_INDUSTRIES"), list(vs.INDUSTRIES))
        self.assertEqual(ts_const(DIALOGS, "VOICE_STATUSES"), list(vs.STATUSES))
        self.assertEqual(ts_const(DIALOGS, "VOICE_PURPOSES"), list(vs.PURPOSES))
        self.assertEqual(ts_const(DIALOGS, "VOICE_CHANNELS"), list(vs.CHANNELS))
        self.assertEqual(ts_record_keys(SHELL, "const STATUS: Record<string, [string, string]> = {"), list(vs.STATUSES))
        self.assertEqual(sorted(av.TRANSITIONS), sorted(vs.STATUSES))

    def test_template_industries_have_template_files(self):
        self.assertTrue(set(av.TEMPLATE_INDUSTRIES) <= set(vs.INDUSTRIES))
        for industry in av.TEMPLATE_INDUSTRIES:
            with self.subTest(industry=industry):
                self.assertTrue((TEMPLATES / (industry + ".json")).is_file())

    def test_faq_import_enums(self):
        # The FAQ page (T8) sends these modes and explains these CSV problems.
        self.assertEqual(ts_const(FAQ, "IMPORT_MODES"), list(vm.IMPORT_MODES))
        self.assertEqual(ts_const(FAQ, "CSV_PROBLEMS"), list(vm.CSV_PROBLEMS))

    def test_csv_parser_reports_exactly_the_listed_problems(self):
        # Ties CSV_PROBLEMS to the parser: every listed code is one the parser really reports, and these samples
        # report nothing else. Same samples as test_voice_merchant.test_each_row_problem and the header tests.
        header = "問題,答案,相似問法\n"
        samples = {
            "name,reply\n問,答\n": "header_invalid",
            "": "header_invalid",
            header + ",答\n": "question_required",
            header + "問,\n": "answer_required",
            header + "問" * (vc.QUESTION_CHARS + 1) + ",答\n": "question_too_long",
            header + "問,答," + "似" * (vc.VARIANT_CHARS + 1) + "\n": "variant_too_long",
            header + "問,答," + "|".join("abcdefghijk"[: vc.VARIANTS_MAX + 1]) + "\n": "too_many_variants",
            header + "問" * vc.QUESTION_CHARS + "," + "答" * (vc.FAQ_CHARS - vc.QUESTION_CHARS + 1) + "\n": "faq_too_long",
            header + "問\x07,答\n": "unsafe_text",
            header + '"' + "x" * 131073 + '",答\n': "csv_unparseable",
        }
        reported = set()
        for text, problem in samples.items():
            with self.subTest(problem=problem):
                _rows, _faqs, errors = vm.parse_faq_csv(text)
                self.assertEqual([error["problem"] for error in errors], [problem])
                reported.add(problem)
        self.assertEqual(reported, set(vm.CSV_PROBLEMS))
        self.assertEqual(len(vm.CSV_PROBLEMS), len(set(vm.CSV_PROBLEMS)))


if __name__ == "__main__":
    unittest.main()
