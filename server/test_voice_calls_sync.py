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
STORE_LIST = ROOT / "components" / "account-voice-calls.tsx"
STORE_PAGES = (STORE_LIST, ROOT / "components" / "account-voice-calls-detail.tsx",
               ROOT / "components" / "account-voice-calls-content.tsx")
QUALITY_COPY = ROOT / "components" / "admin-voice-quality-labels.tsx"
NUMBER_DIALOGS = ROOT / "components" / "admin-voice-dialogs.tsx"
STORE_MOCK = ROOT / "tests" / "support" / "voice-calls-backend.ts"
SERVER = Path(__file__).resolve().parent

# Codes the browser already has phase 1 copy for (phase1-contract §9, lib/portal-client.ts portalErrorText).
PHASE1_CODES = {"invalid_input", "not_found", "auth_required", "admin_required", "password_change_required",
                "store_suspended", "voice_store_not_found", "invalid_number", "number_not_found", "account_exists"}
# §1.2: the BFF turns 503 voice_media_unavailable into 503 service_unavailable, so no page words this code.
BFF_RENAMED = {"voice_media_unavailable"}
# §12.1: the phase 2 codes a browser sees, and where each page words them.
SHARED_CODES = ("call_not_found", "note_contains_number", "call_content_unavailable", "call_content_expired",
                "voice_content_link_limit")
# Only M17 answers call_content_pending (amended §6.5: the records sender has not reported the call yet).
STORE_ONLY_CODES = ("call_content_pending",)
STORE_CODES = SHARED_CODES + STORE_ONLY_CODES
QUALITY_CODES = SHARED_CODES + ("listening_not_found", "listening_limit")
NUMBER_CODES = ("number_in_use",)


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


def backend_codes(path):
    """Every `fail("code", ...)` and `code="..."` default in a route module."""
    text = path.read_text(encoding="utf-8")
    return set(re.findall(r'fail\("([a-z_]+)"', text)) | set(re.findall(r'\bcode="([a-z_]+)"', text))


def ts_int(path, pattern):
    """The integer captured by `pattern` in a front-end file; a missing match is a failure, not a skip."""
    match = re.search(pattern, path.read_text(encoding="utf-8"), re.MULTILINE)
    if match is None:
        raise AssertionError("%r is not in %s" % (pattern, path))
    return int(match.group(1))


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



class VoiceCallErrorCodeSyncTests(unittest.TestCase):
    """§12.1: every phase 2 error code a browser can get has copy on the page that gets it."""

    def test_backend_codes_are_the_contract_list(self):
        # A code the backend gains fails here until it is sorted into one of the lists above and given copy.
        codes = backend_codes(SERVER / "voice_call_routes.py") | backend_codes(SERVER / "admin_voice.py")
        self.assertEqual(codes - PHASE1_CODES - BFF_RENAMED, set(QUALITY_CODES) | set(STORE_ONLY_CODES) | set(NUMBER_CODES))

    def test_store_pages_word_their_codes(self):
        text = "\n".join(path.read_text(encoding="utf-8") for path in STORE_PAGES)
        for code in STORE_CODES:
            with self.subTest(code=code):
                self.assertTrue('"%s"' % code in text, "no store page words %s" % code)

    def test_quality_tab_words_its_codes(self):
        text = QUALITY_COPY.read_text(encoding="utf-8")
        for code in QUALITY_CODES:
            with self.subTest(code=code):
                self.assertTrue('case "%s":' % code in text, "%s has no case for %s" % (QUALITY_COPY.name, code))

    def test_number_dialogs_word_number_in_use(self):
        # §4.4: A7/A8 answer 409 number_in_use once calls refer to the number; the operator must see why.
        text = NUMBER_DIALOGS.read_text(encoding="utf-8")
        for code in NUMBER_CODES:
            with self.subTest(code=code):
                self.assertTrue('case "%s":' % code in text, "%s has no case for %s" % (NUMBER_DIALOGS.name, code))


class VoiceCallLimitSyncTests(unittest.TestCase):
    """§1.5 limits written into front-end files (and the store page's test backend) must be the backend's."""

    def test_store_page_limits(self):
        self.assertEqual(ts_int(CALLS, r"^export const FLAG_NOTE_CHARS_DEFAULT = (\d+);"), vc.FLAG_NOTE_CHARS)
        self.assertEqual(ts_int(STORE_LIST, r"^const CALL_DETAIL_DAYS = (\d+);"), vc.CALL_DETAIL_DAYS)

    def test_store_test_backend_answers_like_the_backend(self):
        # tests/support/voice-calls-backend.ts stands in for M13-M17; its limits must be the backend's (LESSONS 2026-10-21).
        self.assertEqual(ts_int(STORE_MOCK, r"^\s*pageSize: (\d+),"), vc.STORE_PAGE_SIZE)
        self.assertEqual(ts_int(STORE_MOCK, r"^\s*flagNoteChars: (\d+),"), vc.FLAG_NOTE_CHARS)
        self.assertEqual(ts_int(STORE_MOCK, r"^const TRANSCRIPT_DAYS = (\d+);"), vc.TRANSCRIPT_DAYS)
        self.assertEqual(ts_int(STORE_MOCK, r"linksUsed >= (\d+)\)"), vc.CONTENT_LINKS_PER_HOUR)
        self.assertEqual(ts_int(STORE_MOCK, r"exp: iat \+ (\d+), kinds"), vc.CONTENT_LINK_TTL_SECONDS)


if __name__ == "__main__":
    unittest.main()
