import json
import unittest

from server.testsupport import BASE, PortalCase, rows

AUDIT = {"freeze": "admin.fleet_frozen", "resume": "admin.fleet_resumed", "candidate": "admin.fleet_candidate_requested",
         "drain": "admin.fleet_drain_requested", "approve": "admin.fleet_approved", "rollback": "admin.fleet_rollback_requested"}


class AdminFleetTests(PortalCase):
    def test_reads(self):
        admin = self.admin()
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/glm-5.2-fp8/status").json()["model_id"], "glm-5.2-fp8")
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/glm-5.2-fp8/timeline").json()["events"], [])
        r = admin.get(BASE + "/admin/gateway/fleet/bge-m3/status")
        self.assertEqual((r.status_code, r.json()["error"]), (404, "fleet_not_managed"))
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/events").json(), {"events": []})
        admin.get(BASE + "/admin/gateway/fleet/events?modelId=glm-5.2-fp8&limit=20")
        self.assertEqual(self.gateway.fleet_calls, [("events", None, 100), ("events", "glm-5.2-fp8", 20)])
        for query in ("limit=0", "limit=501", "limit=abc", "modelId=bad%20id"):
            self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/events?" + query).status_code, 400, query)
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/events?modelId=bge-m3").json()["error"], "fleet_not_managed")
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.fleet")], [])

    def test_every_action_is_audited_with_its_own_name(self):
        admin = self.admin()
        for action, name in AUDIT.items():
            r = self.post(admin, f"/admin/gateway/fleet/glm-5.2-fp8/{action}", {})
            self.assertEqual(r.status_code, 200, (action, r.text))
            event = self.audit(name)
            self.assertEqual([e["target_id"] for e in event], ["glm-5.2-fp8"], action)
            details = json.loads(event[0]["details"])
            if action in ("freeze", "resume"):
                self.assertEqual(set(details), {"mode"})
            else:
                self.assertEqual(details["jobId"], r.json()["job_id"])
        self.assertEqual([c[1] for c in self.gateway.fleet_calls], list(AUDIT))

    def test_bad_input_and_conflicts_never_audit(self):
        admin = self.admin()
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/delete", {}).json()["error"], "unknown_action")
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/bad%20id/freeze", {}).json()["error"], "invalid_input")
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/bge-m3/freeze", {}).json()["error"], "fleet_not_managed")
        from server.gateway import GatewayError
        self.gateway.reject = GatewayError("rejected", 409, "workflow already active")
        r = self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/candidate", {})
        self.assertEqual((r.status_code, r.json()), (409, {"error": "gateway_rejected", "detail": "workflow already active"}))
        self.gateway.reject = 401
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/drain", {}).json()["error"], "gateway_auth_failed")
        self.assertEqual(self.gateway.fleet_calls, [])
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.fleet")], [])

    def test_control_job_poll(self):
        admin = self.admin()
        body = admin.get(BASE + "/admin/gateway/control/jobs/0123456789abcdef").json()
        self.assertEqual((body["id"], body["state"]), ("0123456789abcdef", "awaiting_approval"))
        r = admin.get(BASE + "/admin/gateway/control/jobs/missing")
        self.assertEqual((r.status_code, r.json()["error"]), (404, "job_not_found"))
        self.assertEqual(admin.get(BASE + "/admin/gateway/control/jobs/bad%20job").status_code, 400)

    def test_forbidden_and_unconfigured(self):
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(self.post(client, "/admin/gateway/fleet/glm-5.2-fp8/rollback", {}).status_code, 403)
        admin = self.admin()
        self.gateway.configured = False
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/freeze", {}).json()["error"], "provider_not_configured")
        self.assertEqual(self.gateway.fleet_calls, [])


if __name__ == "__main__":
    unittest.main()
