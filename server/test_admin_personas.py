import json
import unittest

from server.gateway import GatewayError
from server.testsupport import BASE, PortalCase, rows


class AdminPersonaTests(PortalCase):
    def details(self, action):
        return [json.loads(e["details"]) if e["details"] else None for e in self.audit(action)]

    def test_list_and_view_pass_through(self):
        admin = self.admin()
        self.assertEqual([p["persona_id"] for p in admin.get(BASE + "/admin/personas").json()["personas"]], ["p1"])
        body = admin.get(BASE + "/admin/personas/p1?rev=1").json()
        self.assertEqual((body["persona"]["rev"], len(body["revisions"])), (1, 1))
        self.assertIn(("get", "p1", 1), self.gateway.persona_calls)
        r = admin.get(BASE + "/admin/personas/nope")
        self.assertEqual((r.status_code, r.json()["error"]), (404, "persona_not_found"))
        self.assertEqual(admin.get(BASE + "/admin/personas/p1?rev=0").status_code, 400)
        self.assertEqual(admin.get(BASE + "/admin/personas/bad%20id").status_code, 400)

    def test_create_revise_activate_try_are_audited_without_content(self):
        admin = self.admin()
        r = self.post(admin, "/admin/personas", {"name": "Sales"})
        self.assertEqual(r.status_code, 201, r.text)
        pid = r.json()["persona_id"]
        r = self.post(admin, f"/admin/personas/{pid}/revisions", {"system": "Line one\nLine two", "examples": [{"user": "hi", "assistant": "hello"}], "note": "v1", "activate": False})
        self.assertEqual(r.json(), {"rev": 1})
        self.assertEqual(self.post(admin, f"/admin/personas/{pid}/activate", {"rev": 1}).json(), {"ok": True})
        r = self.post(admin, f"/admin/personas/{pid}/try", {"input": "price?", "revs": [1, None], "maxTokens": 200})
        self.assertEqual(len(r.json()["results"]), 2)
        self.assertIn(("try", pid, (1, None), 200, 0.8), self.gateway.persona_calls)
        admin_id = self.user_id("admin@example.test")
        for action in ("admin.persona_created", "admin.persona_revision_saved", "admin.persona_activated", "admin.persona_tried"):
            events = self.audit(action)
            self.assertEqual([(e["actor_id"], e["target_id"]) for e in events], [(admin_id, pid)], action)
        self.assertEqual(self.details("admin.persona_revision_saved"), [{"rev": 1, "activate": False, "systemChars": 17, "examples": 1}])
        self.assertEqual(self.details("admin.persona_tried"), [{"revs": [1, None], "inputChars": 6, "maxTokens": 200}])
        stored = json.dumps([e["details"] for e in rows(self.store, "audit_events")])
        for secret_ish in ("Line one", "hello", "price?"):
            self.assertNotIn(secret_ish, stored)

    def test_revision_validation_never_reaches_the_gateway(self):
        admin = self.admin()
        good = {"system": "s", "examples": [], "note": "", "activate": True}
        bad = [dict(good, activate=None), dict(good, system="x" * 32001), dict(good, system="a\x00b"),
               dict(good, examples=[{"user": "u"}] * 51), dict(good, examples=[{"user": "u", "extra": "x"}]),
               dict(good, examples=[{"user": " ", "assistant": ""}]), dict(good, examples=["text"]),
               dict(good, note="n" * 201), dict(good, note="a\nb")]
        for body in bad:
            self.assertEqual(self.post(admin, "/admin/personas/p1/revisions", body).status_code, 422, body)
        r = self.post(admin, "/admin/personas/p1/revisions", dict(good, system="字" * 30000, examples=[{"user": "字" * 4000, "assistant": "字" * 4000}] * 10))
        self.assertEqual(r.status_code, 413)
        self.assertFalse([c for c in self.gateway.persona_calls if c[0] == "revision"])
        self.assertEqual(self.post(admin, "/admin/personas/nope/revisions", good).json()["error"], "persona_not_found")

    def test_try_and_activate_validation(self):
        admin = self.admin()
        for body in ({"input": ""}, {"input": "x" * 4001}, {"input": "x", "revs": []}, {"input": "x", "revs": [1, 2, 3]},
                     {"input": "x", "revs": [0]}, {"input": "x", "revs": ["1"]}, {"input": "x", "revs": [True]},
                     {"input": "x", "maxTokens": 0}, {"input": "x", "maxTokens": 1025}, {"input": "x", "maxTokens": "5"},
                     {"input": "x", "temperature": -0.1}, {"input": "x", "temperature": 2.1}, {"input": "x", "temperature": True}):
            self.assertEqual(self.post(admin, "/admin/personas/p1/try", body).status_code, 422, body)
        for body in ({}, {"rev": 0}, {"rev": "1"}, {"rev": True}):
            self.assertEqual(self.post(admin, "/admin/personas/p1/activate", body).status_code, 422, body)
        r = self.post(admin, "/admin/personas/p1/activate", {"rev": 9})
        self.assertEqual((r.status_code, r.json()["error"]), (404, "persona_not_found"))
        self.assertFalse([c for c in self.gateway.persona_calls if c[0] in ("try", "activate")])
        self.assertEqual((self.audit("admin.persona_activated"), self.audit("admin.persona_try_started")), ([], []))

    def test_gateway_failures_map_and_are_not_audited(self):
        admin = self.admin()
        self.gateway.reject = GatewayError("rejected", 409, "busy")
        r = self.post(admin, "/admin/personas", {"name": "X"})
        self.assertEqual((r.status_code, r.json()), (409, {"error": "gateway_rejected", "detail": "busy"}))
        self.gateway.reject = 401
        r = self.post(admin, "/admin/personas", {"name": "X"})
        self.assertEqual((r.status_code, r.json()["error"]), (503, "gateway_auth_failed"))
        self.assertNotIn("private upstream token", r.text)
        self.gateway.reject = None
        self.gateway.fail = True
        self.assertEqual(self.post(admin, "/admin/personas/p1/try", {"input": "x"}).json()["error"], "gateway_unavailable")
        # The attempt is recorded before the call (a timed-out try may still have used tokens); success is not.
        self.assertEqual([e["action"] for e in rows(self.store, "audit_events") if e["action"].startswith("admin.persona")], ["admin.persona_try_started"])
        self.assertEqual(self.details("admin.persona_try_started"), [{"revs": [None], "inputChars": 1, "maxTokens": 300}])

    def test_unsafe_characters_are_refused_before_the_gateway(self):
        admin = self.admin()
        self.assertEqual(self.post_raw(admin, "/admin/personas", '{"name": "a\\ud800"}').status_code, 400)
        self.assertEqual(self.post_raw(admin, "/admin/personas", '{"name": "a\\u202eb"}').status_code, 400)
        good = '"examples": [], "note": "", "activate": false'
        for system in ("a\\ud800", "a\\u007fb", "a\\u0085b", "a\\u2069b"):
            r = self.post_raw(admin, "/admin/personas/p1/revisions", '{"system": "%s", %s}' % (system, good))
            self.assertEqual(r.status_code, 422, system)
        self.assertEqual(self.post_raw(admin, "/admin/personas/p1/revisions", '{"system": "line\\nnext\\ttab", %s}' % good).status_code, 200)
        self.assertEqual(self.post_raw(admin, "/admin/personas/p1/try", '{"input": "\\udfff"}').status_code, 422)
        self.assertFalse([c for c in self.gateway.persona_calls if c[0] in ("try", "create")])
        self.assertEqual(self.audit("admin.persona_try_started"), [])

    def test_unconfigured_and_forbidden(self):
        admin = self.admin()
        self.gateway.configured = False
        self.assertEqual(admin.get(BASE + "/admin/personas").json(), {"gatewayConfigured": False, "personas": []})
        self.assertEqual(self.post(admin, "/admin/personas", {"name": "X"}).json()["error"], "provider_not_configured")
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/admin/personas").status_code, 403)
        self.assertEqual(self.post(client, "/admin/personas/p1/try", {"input": "x"}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
