"""Phase 2 call records: front-end and back-end enums must be the same lists (phase2-contract §10.4, LESSONS 2026-10-21).

lib/voice-calls.ts (store page, P2-2) and lib/voice-quality.ts (Quality tab, P2-6) define the enums the pages label
and send; the BFF (app/api/portal/[...path]/route.ts) checks the M13 and A9 filters with its own copies. Like
test_voice_sync.py this never skips: a missing file or constant is a failure, so a rename cannot turn the check into
a silent skip.
"""

import os
import re
import unittest
from pathlib import Path

from server import voice_call_routes as vcr
from server import voice_calls as vc

# PC_VOICE_FRONTEND_ROOT points the front-end half at another checkout (used to prove the checks can fail).
ROOT = Path(os.environ.get("PC_VOICE_FRONTEND_ROOT") or Path(__file__).resolve().parents[1])
CALLS = ROOT / "lib" / "voice-calls.ts"
QUALITY = ROOT / "lib" / "voice-quality.ts"
BFF = ROOT / "app" / "api" / "portal" / "[...path]" / "route.ts"


def ts_const(path, name):
    """`export const NAME = ["a", "b"] as const;` (one or more lines) -> ["a", "b"]."""
    match = re.search(r"^export const " + name + r" = \[([^\]]*)\] as const;", path.read_text(encoding="utf-8"),
                      re.MULTILINE)
    if match is None:
        raise AssertionError("%s is not defined as `export const %s = [...] as const;` in %s" % (name, name, path))
    return re.findall(r'"([^"]*)"', match.group(1))


def bff_filter(name):
    """`["name", /^(a|b|c)$/]` in the BFF's call filters -> ["a", "b", "c"]."""
    match = re.search(r'\["' + name + r'", /\^\(([^)]*)\)\$/\]', BFF.read_text(encoding="utf-8"))
    if match is None:
        raise AssertionError("the BFF has no `[\"%s\", /^(…)$/]` call filter in %s" % (name, BFF))
    return match.group(1).split("|")


class VoiceCallEnumSyncTests(unittest.TestCase):
    def test_front_end_files_are_in_the_tree(self):
        for path in (CALLS, QUALITY, BFF):
            with self.subTest(path=str(path)):
                self.assertTrue(path.is_file(), "%s is missing; the merged branch must carry both halves" % path)

    def test_call_enums(self):
        # §10.4 counts: outcome 9, entry 4, meterReason 14, handoffReason 5, callerKind 5, flag kind 1, content.state 3.
        for name, backend, size in (("OUTCOMES", vc.OUTCOMES, 9), ("ENTRIES", vc.ENTRIES, 4), ("METER_REASONS", vc.METER_REASONS, 14),
                                    ("HANDOFF_REASONS", vc.HANDOFF_REASONS, 5), ("CALLER_KINDS", vc.CALLER_KINDS, 5),
                                    ("FLAG_KINDS", vc.FLAG_KINDS, 1), ("CONTENT_STATES", vc.CONTENT_STATES, 3),
                                    ("MEDIA_KINDS", vc.MEDIA_KINDS, 3)):
            with self.subTest(name=name):
                self.assertEqual(ts_const(CALLS, name), list(backend))
                self.assertEqual(len(backend), size)

    def test_quality_enums(self):
        # §10.4 counts: autoFlags 10, reviewLabels 10, listeningKinds 4, degradeReason 7.
        for name, backend, size in (("AUTO_FLAGS", vc.AUTO_FLAGS, 10), ("DEGRADE_REASONS", vc.DEGRADE_REASONS, 7),
                                    ("REVIEW_LABELS", vc.REVIEW_LABELS, 10), ("REVIEW_STATUSES", vc.REVIEW_STATUSES, 2),
                                    ("LISTENING_KINDS", vc.LISTENING_KINDS, 4),
                                    ("QUALITY_FLAG_FILTERS", vcr.QUALITY_FLAG_FILTERS, 5),
                                    ("QUALITY_REVIEWED_FILTERS", vcr.QUALITY_REVIEWED_FILTERS, 3),
                                    ("MISMATCH_FIELDS", vc.MISMATCH_FIELDS, 8), ("METRIC_KEYS", vc.METRIC_KEYS, 6),
                                    ("MESSAGE_OUTCOMES", vc.MESSAGE_OUTCOMES, 6), ("CALLBACK_VIA", vc.CALLBACK_VIA, 2)):
            with self.subTest(name=name):
                self.assertEqual(ts_const(QUALITY, name), list(backend))
                self.assertEqual(len(backend), size)

    def test_bff_filters_accept_exactly_the_backend_values(self):
        # The BFF answers 400 for anything else, so a value the backend gains would never reach it.
        self.assertEqual(bff_filter("outcome"), list(vc.OUTCOMES))
        self.assertEqual(bff_filter("entry"), list(vc.ENTRIES))
        self.assertEqual(bff_filter("flag"), list(vcr.QUALITY_FLAG_FILTERS))
        self.assertEqual(bff_filter("reviewed"), list(vcr.QUALITY_REVIEWED_FILTERS))


if __name__ == "__main__":
    unittest.main()
