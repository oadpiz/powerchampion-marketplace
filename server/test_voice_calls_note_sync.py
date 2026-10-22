"""The store's flag note check must refuse the same text in the browser and in portal (phase2-contract §6.3, LESSONS 2026-10-21).

tests/support/phone-like-vectors.json is read here (server/voice_calls.has_phone_number) and by
tests/account-voice-calls.test.tsx (lib/voice-calls.ts hasPhoneNumber), so a change to either pattern that the other
does not follow fails one of the two. Like test_voice_calls_sync.py this never skips: a missing file is a failure.
"""

import json
import os
import unittest
from pathlib import Path

from server import voice_calls as vc

ROOT = Path(os.environ.get("PC_VOICE_FRONTEND_ROOT") or Path(__file__).resolve().parents[1])
VECTORS = ROOT / "tests" / "support" / "phone-like-vectors.json"


class FlagNoteNumberSyncTests(unittest.TestCase):
    def test_vectors_file_is_in_the_tree(self):
        self.assertTrue(VECTORS.is_file(), "%s is missing; the merged branch must carry it" % VECTORS)

    def test_backend_agrees_with_every_vector(self):
        vectors = json.loads(VECTORS.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(vectors["number"]), 10)
        self.assertGreaterEqual(len(vectors["not_number"]), 5)
        for text in vectors["number"]:
            with self.subTest(number=text):
                self.assertTrue(vc.has_phone_number(text))
        for text in vectors["not_number"]:
            with self.subTest(not_number=text):
                self.assertFalse(vc.has_phone_number(text))

    def test_numerals_are_the_shared_table(self):
        # lib/voice-calls.ts PHONE_NUMERALS is compared with the same table by tests/voice-p2-sync.test.ts.
        vectors = json.loads(VECTORS.read_text(encoding="utf-8"))
        self.assertEqual(vectors["numerals"], vc.PHONE_NUMERALS)
        for digit, chars in vectors["numerals"].items():
            for char in chars:
                with self.subTest(char=char):
                    self.assertEqual(vc.phone_text(char * 8), digit * 8)
                    self.assertTrue(vc.has_phone_number(char * 8))


if __name__ == "__main__":
    unittest.main()
