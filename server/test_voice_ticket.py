"""Try-call tickets (server/voice_ticket.py) against the fixed test vector of phase1-contract.md §6.5 / appendix A.

The config below is rebuilt exactly as appendix A's `python3 -c` command builds it; the demo (T11) checks the same
vector, so both sides must produce and accept the very same string."""
import base64
import hashlib
import hmac
import json
import re
import unittest
from datetime import datetime, timezone

from server import voice_compile as vc
from server import voice_ticket as vt

# Test-only value from the contract; it is not a secret anywhere.
SECRET = "test-only-not-a-secret-0000000000"
IAT = 1793491200  # 2026-11-01T00:00:00Z
NONCE = "00112233445566778899aabbccddeeff"
STORE_ID = "0123456789abcdef0123456789abcdef"
CONFIG_SHA256 = "ca72ecf4f178bc632cbbacef22d5da71983b2744d0d7e3579722e201c1b6adfd"
PREFIX_SHA256 = "12e80819acf79430695ced14a490e903b58add246e7caeee875734f0904bed58"
SIGNATURE = "Q6-P7VKnQcMzoXabMn_vR7_fAA3o7p8TZ-TYZo7qAlI"
TICKET_SHA256 = "07dd811bb9eddb7ae7159e3bb0380543ddaf44b8a0fc74d8540ecfbada214956"
TICKET = (
    "eyJjb25maWciOnsiY2xvc3VyZXMiOlt7ImRhdGUiOiIyMDI2LTEyLTI1Iiwibm90ZSI6IumZouWFp-iok-e3tCJ9XSwiaG91cnMiOlt7ImNsb3NlX21pbiI6NzIwLCJvcGVuX21pbiI6NTQwLCJ3ZWVrZGF5IjowfV0sImtiX2NoYXJzIjozMiwib3BlbmluZyI6eyJkaXNjbG9zdXJlX3ZlcnNpb24iOiJkcmFmdC0wIiwiZXN0X3NlY29uZHMiOjkuOCwidGV4dCI6IuaCqOWlve-8jOmAmeijoeaYr-aZtOWFieeJmemGq-iouuaJgO-8iOa4rOippu-8ie-8jOaIkeaYryBBSSDoqp7pn7PliqnnkIbvvIzpgJnpgJrpm7voqbHmnIPpjITpn7PjgILoq4vllY_mnInku4Dpurzlj6_ku6XluavmgqjvvJ8ifSwicHJvbXB0Ijp7Im1vZGVfc2VwYXJhdG9yIjoiXG5cbuOAkOebruWJjeaDheWig-OAkSIsIm1vZGVzIjp7ImFmdGVyX2hvdXJzIjoi5LiL54-t5pmC6ZaTIiwib3BlbiI6IueHn-alreaZgumWk-WFpyJ9LCJwcmVmaXgiOiLkvaDmmK_jgIzmmbTlhYnniZnphqvoqLrmiYDvvIjmuKzoqabvvInjgI3nmoTpm7voqbHlrqLmnI3kurrlk6HjgILvvIjnpLrmhI_mloflrZfvvIzkuI3mmK8gVDIg55qE57eo6K2v57WQ5p6c77yJXG5cbuOAkOW6l-Wutuizh-aWmeOAkVxu6Ki65omA5Zyo5Y-w5YyX5biC5aSn5a6J5Y2A77yI56S65oSP77yJ44CCXG7nh5_mpa3mmYLplpPvvJrpgLHkuIAgMDk6MDAg5YiwIDEyOjAw44CCXG7kvJHoqLrml6XvvJoyMDI2LTEyLTI177yI6Zmi5YWn6KiT57e077yJ44CCXG5cbuOAkOmAmeS6m-WVj-mhjOiri-iqquacg-iri-WwiOS6uuWbnumbu-OAkVxu5Y-v5Lul6ZaL5q2i55eb6Jel5ZeO77yfIiwicHJlZml4X3NoYTI1NiI6IjEyZTgwODE5YWNmNzk0MzA2OTVjZWQxNGE0OTBlOTAzYjU4YWRkMjQ2ZTdjYWVlZTg3NTczNGYwOTA0YmVkNTgifSwicnVsZXMiOnsiYWZ0ZXJfaG91cnNfbW9kZSI6ImFuc3dlcl9hbmRfbWVzc2FnZSIsImFpX2Fuc3dlcl9lbmFibGVkIjpmYWxzZSwiYXNrX2NhbGxiYWNrIjoiYXV0byIsImhhbmRvZmZfbW9kZSI6ImNhbGxiYWNrIiwibWF4X21lc3NhZ2Vfc2Vjb25kcyI6MTIwLCJub19haV9xdWVzdGlvbnMiOlsi5Y-v5Lul6ZaL5q2i55eb6Jel5ZeO77yfIl0sInJlY29yZGluZ19tb2RlIjoibWVzc2FnZV9vbmx5IiwicmV0ZW50aW9uX2RheXMiOjkwfSwic2NoZW1hIjoidm9pY2Uuc3RvcmUtY29uZmlnL3YxIiwic2hvcF9uYW1lIjoi5pm05YWJ54mZ6Yar6Ki65omA77yI5ris6Kmm77yJIiwic3RvcmVfaWQiOiIwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZiIsInZlcnNpb24iOjEsIndhcm5pbmdzIjpbXX0sImNvbmZpZ192ZXJzaW9uIjoxLCJleHAiOjE3OTM0OTIxMDAsImlhdCI6MTc5MzQ5MTIwMCwibm9uY2UiOiIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZiIsInB1cnBvc2UiOiJ0cnkiLCJzdG9yZV9pZCI6IjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmIiwidiI6MX0"
    ".Q6-P7VKnQcMzoXabMn_vR7_fAA3o7p8TZ-TYZo7qAlI"
)


def vector_config():
    """Appendix A's config, built the same way (its prefix is illustrative text, not T2's output)."""
    shop = "晴光牙醫診所（測試）"
    intro = "診所在台北市大安區（示意）。"
    question, answer = "可以開止痛藥嗎？", "需要醫師看診後判斷。"
    opening = "您好，這裡是" + shop + "，我是 AI 語音助理，這通電話會錄音。" + "請問有什麼可以幫您？"
    prefix = ("你是「" + shop + "」的電話客服人員。（示意文字，不是 T2 的編譯結果）\n\n【店家資料】\n" + intro
              + "\n營業時間：週一 09:00 到 12:00。\n休診日：2026-12-25（院內訓練）。\n\n【這些問題請說會請專人回電】\n" + question)
    return {"schema": "voice.store-config/v1", "store_id": STORE_ID, "version": 1, "shop_name": shop,
            "opening": {"text": opening, "est_seconds": round(len(re.sub(r"[ \t\n\r 　]", "", opening)) / 4.5, 1),
                        "disclosure_version": "draft-0"},
            "prompt": {"prefix": prefix, "prefix_sha256": hashlib.sha256(prefix.encode("utf-8")).hexdigest(),
                       "mode_separator": "\n\n【目前情境】", "modes": {"open": "營業時間內", "after_hours": "下班時間"}},
            "hours": [{"weekday": 0, "open_min": 540, "close_min": 720}],
            "closures": [{"date": "2026-12-25", "note": "院內訓練"}],
            "rules": {"ask_callback": "auto", "handoff_mode": "callback", "max_message_seconds": 120,
                      "after_hours_mode": "answer_and_message", "no_ai_questions": [question],
                      "recording_mode": "message_only", "retention_days": 90, "ai_answer_enabled": False},
            "kb_chars": len(intro) + len(question) + len(answer), "warnings": []}


def signed(payload_bytes, secret=SECRET):
    """A correctly signed ticket around arbitrary payload bytes (to reach the checks after the signature)."""
    body = vt.b64u(payload_bytes)
    return body + "." + vt.b64u(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())


def good_payload(**changes):
    payload = {"v": 1, "purpose": "try", "store_id": STORE_ID, "config_version": 1, "iat": IAT, "exp": IAT + 900,
               "nonce": NONCE, "config": vector_config()}
    payload.update(changes)
    return payload


class TestVectorTests(unittest.TestCase):
    def test_signing_the_vector_gives_the_contract_string(self):
        config = vector_config()
        self.assertEqual(int(datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp()), IAT)
        self.assertEqual(hashlib.sha256(vc.canonical_json(config)).hexdigest(), CONFIG_SHA256)
        self.assertEqual(config["prompt"]["prefix_sha256"], PREFIX_SHA256)
        ticket, payload = vt.sign(SECRET, config, now=IAT, nonce=NONCE)
        self.assertEqual(ticket, TICKET)
        self.assertEqual(ticket.split(".")[1], SIGNATURE)
        self.assertEqual((len(ticket), len(vc.canonical_json(payload))), (1979, 1451))
        self.assertEqual(hashlib.sha256(ticket.encode("ascii")).hexdigest(), TICKET_SHA256)
        self.assertEqual((payload["iat"], payload["exp"], payload["nonce"]), (IAT, IAT + 900, NONCE))

    def test_vector_results_from_the_contract_table(self):
        ledger = vt.NonceLedger()
        payload = vt.verify(TICKET, SECRET, now=IAT + 60, ledger=ledger)
        self.assertEqual(payload["config"], vector_config())
        self.assertEqual((payload["store_id"], payload["config_version"]), (STORE_ID, 1))
        cases = [
            ("same ticket again", lambda: vt.verify(TICKET, SECRET, now=IAT + 61, ledger=ledger), "ticket_replayed"),
            ("11th character changed", lambda: vt.verify(TICKET[:10] + ("B" if TICKET[10] != "B" else "C") + TICKET[11:], SECRET, now=IAT + 60), "ticket_invalid"),
            ("other secret", lambda: vt.verify(TICKET, SECRET[:-1] + "1", now=IAT + 60), "ticket_invalid"),
            ("now = exp", lambda: vt.verify(TICKET, SECRET, now=IAT + 900), "ticket_expired"),
        ]
        for label, call, code in cases:
            with self.subTest(label), self.assertRaises(vt.TicketError) as caught:
                call()
            self.assertEqual((caught.exception.code, caught.exception.close_code), (code, 4401), label)

    def test_any_single_changed_character_is_refused(self):
        dot = TICKET.index(".")
        for index in (0, 1, 500, dot - 1, dot + 1, len(TICKET) - 1):
            with self.subTest(index=index):
                swapped = TICKET[:index] + ("A" if TICKET[index] != "A" else "B") + TICKET[index + 1:]
                with self.assertRaises(vt.TicketError) as caught:
                    vt.verify(swapped, SECRET, now=IAT + 60)
                self.assertEqual(caught.exception.code, "ticket_invalid")

    def test_a_fresh_nonce_is_random_and_the_ticket_still_verifies(self):
        first, payload = vt.sign(SECRET, vector_config(), now=IAT)
        second, other = vt.sign(SECRET, vector_config(), now=IAT)
        self.assertNotEqual(payload["nonce"], other["nonce"])
        self.assertRegex(payload["nonce"], r"^[a-f0-9]{32}$")
        ledger = vt.NonceLedger()
        vt.verify(first, SECRET, now=IAT + 1, ledger=ledger)
        vt.verify(second, SECRET, now=IAT + 1, ledger=ledger)
        self.assertEqual(len(ledger), 2)


class VerifyStepTests(unittest.TestCase):
    def assertInvalid(self, ticket, code="ticket_invalid", now=IAT + 60):
        with self.assertRaises(vt.TicketError) as caught:
            vt.verify(ticket, SECRET, now=now)
        self.assertEqual(caught.exception.code, code)

    def test_shape_is_checked_before_anything_else(self):
        body, signature = TICKET.split(".")
        for ticket in ("", ".", body, body + "." + signature + ".x", body + ".." + signature, body + "+." + signature,
                       body + "." + signature + "=", "a" * (vt.MAX_CHARS + 1), None, 12):
            with self.subTest(ticket=str(ticket)[:40]):
                self.assertInvalid(ticket)

    def test_payload_checks_after_a_valid_signature(self):
        canonical = vc.canonical_json
        bad = {
            "not json": b"not json",
            "not utf-8": b"\xff\xfe",
            "array": b"[1]",
            "v is true": canonical(good_payload(v=True)),
            "v is 2": canonical(good_payload(v=2)),
            "other purpose": canonical(good_payload(purpose="call")),
            "config schema": canonical(good_payload(config=dict(vector_config(), schema="voice.store-config/v2"))),
            "store mismatch": canonical(good_payload(store_id="f" * 32)),
            "version mismatch": canonical(good_payload(config_version=2)),
            "uppercase nonce": canonical(good_payload(nonce=NONCE.upper())),
            "short nonce": canonical(good_payload(nonce="00")),
            "lifetime over 15 minutes": canonical(good_payload(exp=IAT + 901)),
            "issued in the future": canonical(good_payload(iat=IAT + 200, exp=IAT + 1000)),
            "exp as text": canonical(good_payload(exp=str(IAT + 900))),
        }
        for label, payload in bad.items():
            with self.subTest(label):
                self.assertInvalid(signed(payload))
        # The same construction with nothing wrong passes, so the cases above fail for the reason named.
        self.assertEqual(vt.verify(signed(canonical(good_payload())), SECRET, now=IAT + 60)["nonce"], NONCE)
        self.assertEqual(vt.verify(signed(canonical(good_payload(iat=IAT + 120, exp=IAT + 1020))), SECRET, now=IAT + 60)["iat"], IAT + 120)

    def test_expiry_boundary(self):
        self.assertEqual(vt.verify(TICKET, SECRET, now=IAT + 899)["exp"], IAT + 900)
        self.assertInvalid(TICKET, "ticket_expired", now=IAT + 900)
        self.assertInvalid(TICKET, "ticket_expired", now=IAT + 10 ** 6)

    def test_ledger_forgets_nonces_only_after_they_expire(self):
        ledger = vt.NonceLedger()
        self.assertTrue(ledger.use("a" * 32, IAT + 900, IAT))
        self.assertFalse(ledger.use("a" * 32, IAT + 900, IAT + 899))
        self.assertTrue(ledger.use("b" * 32, IAT + 2000, IAT + 900))  # pruning "a" happens here
        self.assertEqual(len(ledger), 1)

    def test_secrets_shorter_than_32_characters_are_refused(self):
        for call in (lambda: vt.sign("x" * 31, vector_config(), now=IAT), lambda: vt.verify(TICKET, "x" * 31, now=IAT)):
            with self.assertRaises(ValueError) as caught:
                call()
            self.assertNotIsInstance(caught.exception, vt.TicketError)

    def test_sign_refuses_a_config_it_cannot_describe(self):
        for config in (None, dict(vector_config(), schema="other"), dict(vector_config(), store_id="ABC"),
                       dict(vector_config(), version=0), dict(vector_config(), version=True)):
            with self.subTest(config=str(config)[:60]), self.assertRaises(ValueError):
                vt.sign(SECRET, config, now=IAT)
        with self.assertRaises(ValueError):
            vt.sign(SECRET, vector_config(), now=IAT, nonce="XYZ")

    def test_unb64u_is_strict(self):
        self.assertEqual(vt.unb64u(vt.b64u(b"\xfb\xff")), b"\xfb\xff")
        for text in ("a", "ab=", "a+b/", "a b"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                vt.unb64u(text)
        self.assertEqual(base64.urlsafe_b64decode(TICKET.split(".")[1] + "="), vt.unb64u(SIGNATURE))


def full_store():
    """The largest store the limits allow: 20-character name, 6,000 characters of questions in 120 FAQs,
    28 opening segments and 60 closures with 40-character notes."""
    name = "晴" * 20
    greeting = "請" * 17  # 30 + 20 + 17 = 67 non-space characters: the opening limit
    store = {"id": STORE_ID, "name": name, "greeting": greeting, "intro_text": ""}
    hours = [{"weekday": day, "open_min": slot * 300, "close_min": slot * 300 + 240} for day in range(7) for slot in range(4)]
    closures = [{"date": "2027-%02d-%02d" % (1 + index // 28, 1 + index % 28), "note": "休" * 40} for index in range(60)]
    return store, hours, closures


class FullStoreTests(unittest.TestCase):
    def test_a_full_store_ticket_fits_in_128_kib(self):
        store, hours, closures = full_store()
        # 120 x 50 = 6,000 characters. ai_allowed False writes each question twice (the rule list in the prefix
        # and rules.no_ai_questions), which makes the largest ticket; True puts the answers in the prefix instead.
        layouts = {
            "ai answers": [{"question": "問" * 20, "answer": "答" * 20, "variants": ["似" * 10], "ai_allowed": True}],
            "no ai": [{"question": "問" * 49, "answer": "答", "variants": [], "ai_allowed": False}],
        }
        for label, [faq] in layouts.items():
            with self.subTest(label):
                faqs = [dict(faq, id="%032x" % index, position=index) for index in range(120)]
                config = vc.compile_store(store, faqs, hours, closures, version=1)
                self.assertEqual(config["kb_chars"], 6000)
                ticket, _ = vt.sign(SECRET, config, now=IAT, nonce=NONCE)
                self.assertLessEqual(len(ticket), vt.MAX_CHARS, label)
                self.assertGreater(len(ticket), 30000, "the full store really is large")
                self.assertEqual(vt.verify(ticket, SECRET, now=IAT + 1)["config"], json.loads(vc.canonical_json(config)))


if __name__ == "__main__":
    unittest.main()
