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

    def test_dates_addresses_and_versions_are_not_phone_numbers(self):
        # Fix round: "2026/10/22", "2026.10.22", "G0 盲聽 2026/10/22" and "IP 172.16.10.23" were refused as phone numbers in
        # the shop's note (M15), the review note (A11) and the listening summary (A14); "2026-10-22" already was.
        for text in ("2026/10/22", "2026.10.22", "2026-10-22", "G0 盲聽 2026/10/22", "IP 172.16.10.23", "2026/1/5", "22/10/2026",
                     "10-22-2026", "２０２６／１０／２２", "2026/10/22 14:30", "2026/10/22-2026/10/25", "10.0.0.0/8", "192.168.0.1:8080",
                     "版本 20.11.0.123456", "ver. 2026.10.22.1", "build 2026.10.22.1", "v1.2.3.4.5.6.7.8", "2026.10.22.1"):
            with self.subTest(text=text):
                self.assertFalse(vc.has_phone_number(text))
        # Amounts grouped by commas are not numbers either; lists of single digits are not.
        for text in ("10,000,000", "報價 1,234,567,890 元", "共 20,000,000 與 30,000,000", "35,000, 42,000", "1,2,3,4,5,6,7,8"):
            with self.subTest(text=text):
                self.assertFalse(vc.has_phone_number(text))

    def test_comma_separated_numbers_are_phone_numbers(self):
        # Fix round: a comma between two groups of digits split "0912,345,678" into groups of 4 and 3, and it passed.
        for text in ("0912,345,678", "0912，345，678", "0912、345、678", "０９１２，３４５，６７８", "電話 0912,345,678 請回電",
                     "0912,345 678", "0912-345,678", "09,12,34,56,78", "912,345,678"):
            with self.subTest(text=text):
                self.assertTrue(vc.has_phone_number(text))

    def test_what_is_set_aside_hides_no_number_next_to_it(self):
        for text in ("2026/10/22 0912 345 678", "1234 2026/10/22 5678 9012", "IP 172.16.10.23 回電 0912345678", "10,000,000 0912345678",
                     "20261022", "172.016.010.023", "1.2.3.4.5.6.7.8", "ver 3 0912345678", "v0912.345.678", "version 0912.345.678"):
            with self.subTest(text=text):
                self.assertTrue(vc.has_phone_number(text))
        self.assertEqual(vc.phone_mask("IP 172.16.10.23 on 2026/10/22 v1.2.3 / 10,000,000"), "IP | on | | / |")
        # A masked span is neither a digit nor a separator, so it never joins the digits on its two sides.
        self.assertEqual(vc.phone_mask("0912 2026/10/22 345 678"), "0912 | 345 678")
        self.assertFalse(vc.has_phone_number("0912 2026/10/22 345"))

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
