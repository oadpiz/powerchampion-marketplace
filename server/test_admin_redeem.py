import csv
import io
import json
import logging
import unittest

from server.testsupport import BASE, PortalCase, database_text, rows


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.messages = []

    def emit(self, record):
        self.messages.append(record.getMessage())


class AdminRedeemTests(PortalCase):
    def issue(self, client, **body):
        return self.post(client, "/admin/redeem/codes", {"amountUsd": 5, "count": 3, "label": "Promo", **body})

    def test_plaintext_is_returned_once_and_stored_nowhere(self):
        admin = self.admin()
        capture, root = _Capture(), logging.getLogger()
        previous = root.level
        root.addHandler(capture)
        root.setLevel(logging.DEBUG)
        try:
            r = self.issue(admin, expiresDays=30)
        finally:
            root.removeHandler(capture)
            root.setLevel(previous)
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual([c["code"] for c in body["codes"]], self.gateway.issued_codes)
        self.assertEqual({c["amountUsd"] for c in body["codes"]}, {"5.00"})
        listing = admin.get(BASE + "/admin/redeem/codes").text
        audit = json.loads(self.audit("admin.redeem_codes_issued")[0]["details"])
        self.assertEqual((audit["count"], audit["amountUsd"], audit["expiresDays"]), (3, "5.00", 30))
        self.assertEqual(audit["codeIds"], [c["codeId"] for c in body["codes"]])
        self.assertEqual(self.audit("admin.redeem_codes_issued")[0]["target_id"], "Promo")
        for code in self.gateway.issued_codes:
            self.assertNotIn(code, database_text(self.store))
            self.assertNotIn(code, listing)
            self.assertFalse([m for m in capture.messages if code in m])

    def test_issue_validation(self):
        admin = self.admin()
        for body in ({"amountUsd": 0}, {"amountUsd": -1}, {"amountUsd": 1000.01}, {"amountUsd": 1.234}, {"amountUsd": "abc"},
                     {"amountUsd": True}, {"count": 0}, {"count": 501}, {"count": 1.5}, {"count": "3"}, {"count": True},
                     {"expiresDays": 0}, {"expiresDays": 3651}, {"expiresDays": "7"}):
            self.assertEqual(self.issue(admin, **body).status_code, 422, body)
        for label in ("", "x" * 81):
            self.assertEqual(self.issue(admin, label=label).status_code, 400, label)
        self.assertEqual(self.gateway.issued_codes, [])
        self.assertEqual(self.audit("admin.redeem_codes_issued"), [])

    def test_unconfirmed_issue_is_audited_without_codes(self):
        admin = self.admin()
        self.gateway.fail = True
        r = self.issue(admin)
        self.assertEqual((r.status_code, r.json()["error"]), (503, "gateway_unavailable"))
        self.assertEqual(json.loads(self.audit("admin.redeem_codes_issue_unconfirmed")[0]["details"]), {"count": 3, "amountUsd": "5.00"})
        self.gateway.fail = False
        self.gateway.reject = 401
        self.assertEqual(self.issue(admin, acknowledgeUnconfirmed=True).json()["error"], "gateway_auth_failed")
        self.assertEqual(len(self.audit("admin.redeem_codes_issue_unconfirmed")), 1)

    def test_a_retry_after_an_unconfirmed_issue_needs_an_acknowledgement(self):
        admin = self.admin()
        self.gateway.fail = True
        self.assertEqual(self.issue(admin).status_code, 503)
        self.gateway.fail = False
        r = self.issue(admin)
        self.assertEqual((r.status_code, r.json()["error"]), (409, "redeem_issue_unconfirmed_recent"))
        self.assertEqual(self.issue(admin, acknowledgeUnconfirmed="yes").status_code, 422)
        self.assertEqual(self.gateway.issued_codes, [])
        self.assertEqual(self.issue(admin, label="Other").status_code, 201)
        self.assertEqual(self.issue(admin, acknowledgeUnconfirmed=True).status_code, 201)
        self.assertEqual(len(self.gateway.issued_codes), 6)
        with self.store.connect() as con:
            con.execute("UPDATE audit_events SET created_at=created_at-1801 WHERE action='admin.redeem_codes_issue_unconfirmed'")
        self.assertEqual(self.issue(admin).status_code, 201)

    def test_unsafe_label_characters_are_refused(self):
        admin = self.admin()
        for label in ("\\ud800", "a\\u202eb", "a\\u007fb", "a\\u0085b", "a\\u2066b"):
            r = self.post_raw(admin, "/admin/redeem/codes", '{"amountUsd": 5, "count": 1, "label": "%s"}' % label)
            self.assertEqual((r.status_code, r.json()["error"]), (400, "invalid_input"), label)
        self.assertEqual(self.gateway.issued_codes, [])

    def test_list_projection_status_owner_and_cap(self):
        admin = self.admin()
        owner = self.register(self.client(), "buyer@example.test")
        with self.store.connect() as con:
            con.execute("INSERT INTO gateway_keys VALUES (?,?,?,?,?,?,?,NULL)", ("lk", owner["id"], "gk-owner", "k", "sk-o", "active", 1))
        base = {"nano_usd": 1_000_000_000, "label": "L", "created_by": "admin", "redeemed_at": None, "redeemed_by_key_id": None, "disabled_at": None, "expires_at": None}
        self.gateway.redeem_codes = [
            dict(base, code_id="a", created_at=4.0, code="LEAKED-PLAINTEXT-SHOULD-NOT-PASS"),
            dict(base, code_id="r", created_at=3.0, redeemed_at=5.0, redeemed_by_key_id="gk-owner"),
            dict(base, code_id="d", created_at=2.0, disabled_at=6.0),
            dict(base, code_id="e", created_at=1.0, expires_at=1.0),
        ]
        body = admin.get(BASE + "/admin/redeem/codes").json()
        self.assertNotIn("LEAKED-PLAINTEXT", json.dumps(body))
        status = {c["codeId"]: c["status"] for c in body["codes"]}
        self.assertEqual(status, {"a": "active", "r": "redeemed", "d": "disabled", "e": "expired"})
        self.assertEqual(next(c for c in body["codes"] if c["codeId"] == "r")["redeemedBy"]["email"], "buyer@example.test")
        self.assertEqual(body["counts"], {"active": 1, "redeemed": 1, "disabled": 1, "expired": 1})
        self.gateway.redeem_codes = [dict(base, code_id="c%d" % n, created_at=float(n)) for n in range(1005)]
        body = admin.get(BASE + "/admin/redeem/codes").json()
        self.assertEqual((len(body["codes"]), body["total"], body["truncated"], body["codes"][0]["codeId"]), (1000, 1005, True, "c1004"))

    def test_disable_and_not_found(self):
        admin = self.admin()
        code_id = self.issue(admin).json()["codes"][0]["codeId"]
        self.assertEqual(self.post(admin, f"/admin/redeem/codes/{code_id}/disable", {}).json(), {"ok": True, "codeId": code_id})
        r = self.post(admin, f"/admin/redeem/codes/{code_id}/disable", {})
        self.assertEqual((r.status_code, r.json()["error"]), (404, "redeem_code_not_found"))
        self.assertEqual([e["target_id"] for e in self.audit("admin.redeem_code_disabled")], [code_id])

    def test_export_has_hashes_only_and_neutralises_formulas(self):
        admin = self.admin()
        self.issue(admin, label="=HYPERLINK(\"x\")", count=2)
        body = admin.get(BASE + "/admin/redeem/codes/export").json()
        table = list(csv.reader(io.StringIO(body["csv"])))
        self.assertEqual(table[0][:2], ["code_id", "code_hash"])
        self.assertEqual({row[3] for row in table[1:]}, {"'=HYPERLINK(\"x\")"})
        self.assertEqual(body["rows"], 2)
        self.assertRegex(body["filename"], r"^redeem_codes-\d{8}\.csv$")
        for code in self.gateway.issued_codes:
            self.assertNotIn(code, body["csv"])
        self.assertEqual(json.loads(self.audit("admin.redeem_codes_exported")[0]["details"]), {"rows": 2})

    def test_unconfigured_and_forbidden(self):
        admin = self.admin()
        self.gateway.configured = False
        self.assertEqual(admin.get(BASE + "/admin/redeem/codes").json()["gatewayConfigured"], False)
        self.assertEqual(self.issue(admin).json()["error"], "provider_not_configured")
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(self.issue(client).status_code, 403)
        self.assertEqual(client.get(BASE + "/admin/redeem/codes/export").status_code, 403)


if __name__ == "__main__":
    unittest.main()
