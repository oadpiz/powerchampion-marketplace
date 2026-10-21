"""Admin Engineers overview: roster from the allocation tables joined with the gateway's engineer activity."""
import dataclasses
import json
import unittest

from fastapi.testclient import TestClient

from server.admin_engineers import _grafana_url, compose
from server.gateway import GatewayError
from server.test_allocation import ed_key
from server.testsupport import BASE, ORIGIN, PASSWORD, PortalCase, rows

GIB = 2 ** 30
ENGINEER_KEYS = {"id", "clusterId", "username", "displayName", "active", "keyStatus", "keyFingerprint", "keyType", "grafanaUrl",
                 "lastLoginAt", "loggedIn", "gpusInUse", "memoryBytes", "nodes", "alerts", "deploys"}
NODE_KEYS = {"name", "up", "gpuCount", "collector", "labelEngineer", "labelMatches", "gpusInUse", "processes", "memoryBytes",
             "lastLoginAt", "sessions"}
ACTIVITY_KEYS = {"status", "stale", "generatedAt", "ageSeconds", "errors", "error", "truncated"}
FORBIDDEN_KEY_PARTS = ("cmd", "command", "args", "host", "ip", "token", "ssh", "email", "account")


def node(name, engineer, **extra):
    return {"node": name, "role": "engineer", "engineer": engineer, "up": True, "gpu_count": 8, "collector_ok": True,
            "collector_age_s": 12.0, **extra}


def activity(**extra):
    value = {"generated_at": 1792607481.9, "age_s": 3.1, "stale": False, "status": "ok", "errors": {}, "truncated": False,
             "nodes": [node("b300-11", "justin"), node("b300-26", "nati")],
             "gpu_usage": [], "logins": [], "alerts": [], "deploys": []}
    value.update(extra)
    return value


def alert(alertname, **labels):
    base = {"alertname": alertname, "severity": "warning", "node": None, "username": None, "gpu": None, "mountpoint": None,
            "since": 1792600000.0}
    base.update(labels)
    return base


def deploy(n, owner, at=1792600000.0, **extra):
    base = {"id": n, "at": at, "node": "b300-11", "owner": owner, "user": "justin", "verified": True, "model": "qwen3-8b",
            "port": 8000, "text": "deployed qwen3 8B"}
    base.update(extra)
    return base


def walk_keys(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from walk_keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_keys(item)


class EngineersRouteTests(PortalCase):
    def setUp(self):
        super().setUp()
        self.admin_client = self.admin()

    def get(self, client=None):
        response = (client or self.admin_client).get(BASE + "/admin/engineers")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def engineer(self, body, username):
        return next(e for e in body["engineers"] if e["username"] == username)

    def allocation(self):
        return self.admin_client.get(BASE + "/admin/allocation").json()

    def engineer_id(self, username):
        return next(e["id"] for e in self.allocation()["engineers"] if e["username"] == username)

    def set_key(self, username, key):
        r = self.post(self.admin_client, "/admin/allocation/engineers/" + self.engineer_id(username), {"sshPubkey": key})
        self.assertEqual(r.status_code, 200, r.text)

    def mark_export(self):
        revision = rows(self.store, "alloc_meta")[0]["revision"]
        r = self.post(self.admin_client, "/admin/allocation/export/mark", {"revision": revision})
        self.assertEqual(r.status_code, 200, r.text)

    def test_requires_admin(self):
        customer = self.client()
        self.register(customer, "customer@example.test")
        r = customer.get(BASE + "/admin/engineers")
        self.assertEqual((r.status_code, r.json()["error"]), (403, "admin_required"))
        r = self.client().get(BASE + "/admin/engineers")
        self.assertEqual((r.status_code, r.json()["error"]), (401, "auth_required"))
        self.assertEqual(self.gateway.activity_calls, 0)

    def test_route_is_a_single_get(self):
        methods = [sorted(route.methods) for route in self.app.routes if getattr(route, "path", "") == BASE + "/admin/engineers"]
        self.assertEqual(methods, [["GET"]])
        r = self.post(self.admin_client, "/admin/engineers", {})
        self.assertEqual(r.status_code, 405)

    def test_unconfigured_still_lists_roster(self):
        self.gateway.configured = False
        self.gateway.fail = True  # any call would raise: proves none is made
        body = self.get()
        self.assertFalse(body["gatewayConfigured"])
        self.assertEqual(body["activity"]["status"], "gateway_unconfigured")
        self.assertEqual([e["username"] for e in body["engineers"]], ["justin", "mwind", "zhuling", "nati", "ll"])
        self.assertEqual(self.gateway.activity_calls, 0)
        justin = self.engineer(body, "justin")
        self.assertEqual([n["name"] for n in justin["nodes"]], ["b300-11", "b300-12", "b300-13"])
        self.assertIsNone(justin["gpusInUse"])
        self.assertIsNone(justin["nodes"][0]["up"])
        self.assertEqual(body["unmatched"], {"gpuUsage": [], "logins": [], "alerts": [], "deploys": []})

    def test_joins_activity(self):
        self.gateway.activity_value = activity(
            gpu_usage=[{"node": "b300-11", "username": "justin", "gpus": 2, "processes": 3, "memory_bytes": 80 * GIB},
                       {"node": "b300-12", "username": "justin", "gpus": 1, "processes": 1, "memory_bytes": 4 * GIB},
                       {"node": "b300-11", "username": "tku", "gpus": 1, "processes": 1, "memory_bytes": GIB}],
            logins=[{"node": "b300-11", "username": "justin", "last_login": 1792600000, "sessions": 1},
                    {"node": "b300-12", "username": "justin", "last_login": 1792500000, "sessions": 0},
                    {"node": "b300-11", "username": "root", "last_login": 1792000000, "sessions": 0}],
            alerts=[alert("GpuHeldIdle", node="b300-11", username="justin", gpu="3"),
                    alert("DiskAlmostFull", node="b300-26", mountpoint="/data"),
                    alert("EngineerNodeDown", node="b300-99", severity="critical")],
            deploys=[deploy(12, "eng1"), deploy(13, "eng9", user="someone", verified=False)])
        body = self.get()
        self.assertEqual(body["activity"]["status"], "ok")
        self.assertEqual(self.gateway.activity_calls, 1)
        justin = self.engineer(body, "justin")
        self.assertEqual((justin["gpusInUse"], justin["memoryBytes"]), (3, 84 * GIB))
        self.assertTrue(justin["loggedIn"])
        self.assertEqual(justin["lastLoginAt"], "2026-10-21T16:26:40Z")
        b11 = justin["nodes"][0]
        self.assertEqual((b11["name"], b11["gpusInUse"], b11["processes"], b11["memoryBytes"], b11["sessions"], b11["collector"]),
                         ("b300-11", 2, 3, 80 * GIB, 1, "ok"))
        self.assertEqual((b11["up"], b11["gpuCount"], b11["labelEngineer"], b11["labelMatches"]), (True, 8, "justin", True))
        self.assertEqual([(a["alertname"], a["reason"]) for a in justin["alerts"]], [("GpuHeldIdle", "user")])
        self.assertEqual(justin["alerts"][0]["since"], "2026-10-21T16:26:40Z")
        self.assertEqual([d["id"] for d in justin["deploys"]], [12])
        self.assertNotIn("owner", justin["deploys"][0])
        nati = self.engineer(body, "nati")
        self.assertEqual([(a["alertname"], a["reason"], a["mountpoint"]) for a in nati["alerts"]], [("DiskAlmostFull", "node", "/data")])
        self.assertEqual((nati["gpusInUse"], nati["memoryBytes"], nati["loggedIn"], nati["lastLoginAt"]), (0, 0, False, None))
        self.assertEqual([u["username"] for u in body["unmatched"]["gpuUsage"]], ["tku"])
        self.assertEqual([u["username"] for u in body["unmatched"]["logins"]], ["root"])
        self.assertEqual([a["node"] for a in body["unmatched"]["alerts"]], ["b300-99"])
        self.assertEqual([(d["id"], d["owner"], d["verified"]) for d in body["unmatched"]["deploys"]], [(13, "eng9", False)])
        # An engineer node the gateway has no series for has no live values, but no false mismatch either.
        b13 = justin["nodes"][2]
        self.assertEqual((b13["up"], b13["collector"], b13["labelMatches"], b13["gpusInUse"]), (None, None, None, 0))

    def test_alert_matching_user_and_node_is_listed_once_as_user(self):
        self.gateway.activity_value = activity(alerts=[alert("GpuHeldIdle", node="b300-11", username="justin", gpu="1"),
                                                       alert("GpuHeldIdle", node="b300-26", username="justin", gpu="2")])
        body = self.get()
        justin, nati = self.engineer(body, "justin"), self.engineer(body, "nati")
        self.assertEqual([(a["node"], a["reason"]) for a in justin["alerts"]], [("b300-11", "user"), ("b300-26", "user")])
        self.assertEqual([(a["node"], a["reason"]) for a in nati["alerts"]], [("b300-26", "node")])
        self.assertEqual(body["unmatched"]["alerts"], [])

    def test_deploys_are_attributed_by_owner_not_user_newest_ten(self):
        deploys = [deploy(n, "eng1", at=1792600000.0 + n) for n in range(1, 13)]
        deploys.append(deploy(50, "eng4", user="justin"))  # justin's $USER, but owner says nati's node
        deploys.append(deploy(51, None))
        self.gateway.activity_value = activity(deploys=deploys)
        body = self.get()
        self.assertEqual([d["id"] for d in self.engineer(body, "justin")["deploys"]], list(range(12, 2, -1)))
        self.assertEqual([d["id"] for d in self.engineer(body, "nati")["deploys"]], [50])
        self.assertEqual([d["id"] for d in body["unmatched"]["deploys"]], [51])

    def test_engineer_without_nodes(self):
        for name in ("b300-29", "b300-30"):
            r = self.post(self.admin_client, "/admin/allocation/nodes/" + name, {"role": "reserved"})
            self.assertEqual(r.status_code, 200, r.text)
        self.gateway.activity_value = activity(
            gpu_usage=[{"node": "b300-29", "username": "ll", "gpus": 1, "processes": 1, "memory_bytes": GIB}],
            alerts=[alert("GpuHeldIdle", node="b300-29", username="ll", gpu="0"), alert("EngineerNodeDown", node="b300-30")],
            deploys=[deploy(7, "eng5", node="b300-29")])
        body = self.get()
        ll = self.engineer(body, "ll")
        self.assertEqual((ll["nodes"], ll["gpusInUse"], ll["memoryBytes"], ll["lastLoginAt"]), ([], 0, 0, None))
        self.assertEqual([(a["alertname"], a["reason"]) for a in ll["alerts"]], [("GpuHeldIdle", "user")])
        self.assertEqual([d["id"] for d in ll["deploys"]], [7])
        self.assertEqual([a["node"] for a in body["unmatched"]["alerts"]], ["b300-30"])
        self.assertEqual([u["node"] for u in body["unmatched"]["gpuUsage"]], ["b300-29"])

    def test_disabled_engineers_are_listed_last(self):
        for name in ("b300-29", "b300-30"):
            self.assertEqual(self.post(self.admin_client, "/admin/allocation/nodes/" + name, {"role": "reserved"}).status_code, 200)
        r = self.post(self.admin_client, "/admin/allocation/engineers/" + self.engineer_id("ll") + "/status", {"active": False})
        self.assertEqual(r.status_code, 200, r.text)
        body = self.get()
        self.assertEqual([(e["username"], e["active"]) for e in body["engineers"]],
                         [("justin", True), ("mwind", True), ("zhuling", True), ("nati", True), ("ll", False)])

    def test_key_status_three_states(self):
        self.assertEqual(self.engineer(self.get(), "justin")["keyStatus"], "missing")
        self.set_key("justin", ed_key())
        justin = self.engineer(self.get(), "justin")
        self.assertEqual(justin["keyStatus"], "pending")
        self.assertEqual(justin["keyType"], "ssh-ed25519")
        self.assertTrue(justin["keyFingerprint"].startswith("SHA256:"))
        self.mark_export()
        body = self.get()
        self.assertEqual(self.engineer(body, "justin")["keyStatus"], "synced")
        self.assertEqual(body["lastExport"]["revision"], rows(self.store, "alloc_meta")[0]["revision"])
        self.assertEqual(self.engineer(body, "mwind")["keyStatus"], "missing")

    def test_label_mismatch_flag(self):
        self.gateway.activity_value = activity(nodes=[node("b300-11", "mwind"), node("b300-12", "justin")])
        justin = self.engineer(self.get(), "justin")
        self.assertEqual([(n["name"], n["labelEngineer"], n["labelMatches"]) for n in justin["nodes"][:2]],
                         [("b300-11", "mwind", False), ("b300-12", "justin", True)])

    def test_collector_states(self):
        self.gateway.activity_value = activity(nodes=[node("b300-11", "justin", collector_age_s=400.0), node("b300-12", "justin", collector_ok=False),
                                                      node("b300-13", "justin", collector_ok=None, collector_age_s=None)])
        justin = self.engineer(self.get(), "justin")
        self.assertEqual([n["collector"] for n in justin["nodes"]], ["stale", "failed", None])

    def test_gateway_failures_degrade(self):
        cases = (("fail", True, "gateway_error", "unavailable"), ("reject", 401, "gateway_error", "gateway_auth_failed"),
                 ("reject", 403, "gateway_error", "gateway_auth_failed"), ("reject", 404, "gateway_outdated", None),
                 ("reject", GatewayError("invalid_response"), "gateway_error", "invalid_response"),
                 ("reject", GatewayError("response_limit"), "gateway_error", "response_limit"))
        for attribute, value, status, error in cases:
            with self.subTest(attribute=attribute, value=value):
                self.gateway.fail, self.gateway.reject = False, None
                setattr(self.gateway, attribute, value)
                response = self.admin_client.get(BASE + "/admin/engineers")
                self.assertEqual(response.status_code, 200, response.text)
                body = response.json()
                self.assertTrue(body["gatewayConfigured"])
                self.assertEqual((body["activity"]["status"], body["activity"]["error"]), (status, error))
                self.assertEqual(len(body["engineers"]), 5)
                self.assertNotIn("private upstream token", response.text)
                self.assertIsNone(self.engineer(body, "justin")["gpusInUse"])

    def test_unexpected_gateway_status_is_invalid_response(self):
        self.gateway.activity_value = activity(status="weird")
        body = self.get()
        self.assertEqual((body["activity"]["status"], body["activity"]["error"]), ("gateway_error", "invalid_response"))
        self.assertEqual(len(body["engineers"]), 5)

    def test_passes_through_gateway_status(self):
        for status in ("ok", "partial", "unconfigured", "auth_failed", "unavailable"):
            with self.subTest(status=status):
                self.gateway.activity_value = activity(status=status, stale=status == "auth_failed",
                                                       errors={"prometheus": "http_401"} if status == "auth_failed" else {})
                body = self.get()
                self.assertEqual(set(body["activity"]), ACTIVITY_KEYS)
                self.assertEqual(body["activity"]["status"], status)
                self.assertEqual(body["activity"]["stale"], status == "auth_failed")
                self.assertEqual(len(body["engineers"]), 5)

    def test_stale_data_is_shown_as_stale(self):
        self.gateway.activity_value = activity(age_s=60.0, stale=True, errors={"prometheus": "timeout", "annotations": "timeout"},
                                               gpu_usage=[{"node": "b300-11", "username": "justin", "gpus": 2, "processes": 2, "memory_bytes": GIB}])
        body = self.get()
        self.assertEqual((body["activity"]["stale"], body["activity"]["ageSeconds"]), (True, 60.0))
        self.assertEqual(body["activity"]["errors"], {"prometheus": "timeout", "annotations": "timeout"})
        self.assertEqual(self.engineer(body, "justin")["gpusInUse"], 2, "stale data is still shown")
        self.gateway.activity_value = activity(age_s=301.0, stale=False)
        self.assertTrue(self.get()["activity"]["stale"], "older than 300 s is stale whatever the flag says")
        self.gateway.activity_value = activity(age_s=299.0, stale=False)
        self.assertFalse(self.get()["activity"]["stale"])

    def test_partial_prometheus_failure_blanks_live_columns_only(self):
        self.gateway.activity_value = activity(status="partial", errors={"prometheus": "http_5xx"}, nodes=[],
                                               deploys=[deploy(1, "eng1")])
        body = self.get()
        justin = self.engineer(body, "justin")
        self.assertEqual(body["activity"]["errors"], {"prometheus": "http_5xx"})
        self.assertEqual((justin["gpusInUse"], justin["memoryBytes"], justin["loggedIn"]), (None, None, None))
        self.assertEqual(justin["nodes"][0]["gpusInUse"], None)
        self.assertEqual([d["id"] for d in justin["deploys"]], [1])

    def test_invalid_items_are_dropped_and_marked_truncated(self):
        self.gateway.activity_value = activity(
            gpu_usage=[{"node": "evil", "username": "justin", "gpus": 1, "processes": 1, "memory_bytes": 1},
                       {"node": "b300-11", "username": "a b", "gpus": 1, "processes": 1, "memory_bytes": 1},
                       {"node": "b300-11", "username": "justin", "gpus": True, "processes": 1, "memory_bytes": 1},
                       "not-a-dict"],
            alerts=[alert("Bad", node="b300-11", mountpoint="/data\nx")])
        body = self.get()
        self.assertTrue(body["activity"]["truncated"])
        self.assertEqual(body["unmatched"]["gpuUsage"], [])
        self.assertEqual(self.engineer(body, "justin")["alerts"], [])
        self.assertEqual(self.engineer(body, "justin")["gpusInUse"], 0)

    def test_unmatched_lists_are_capped(self):
        self.gateway.activity_value = activity(
            gpu_usage=[{"node": "b300-11", "username": "uid_%d" % n, "gpus": 1, "processes": 1, "memory_bytes": 1} for n in range(80)])
        body = self.get()
        self.assertEqual(len(body["unmatched"]["gpuUsage"]), 50)
        self.assertTrue(body["activity"]["truncated"])

    def test_no_secrets_or_keys(self):
        key = ed_key("justin-laptop")
        self.set_key("justin", key)
        leaky = activity(
            nodes=[node("b300-11", "justin", instance="172.16.10.11:9100", host="b300-11.internal", cmd="python serve.py")],
            gpu_usage=[{"node": "b300-11", "username": "justin", "gpus": 1, "processes": 1, "memory_bytes": GIB,
                        "command": "python -m vllm --api-key sk-secret", "args": ["--token", "glsa_x"], "pid": 4242}],
            logins=[{"node": "b300-11", "username": "justin", "last_login": 1792600000, "sessions": 1, "host": "203.0.113.7", "ip": "203.0.113.7"}],
            alerts=[alert("GpuHeldIdle", node="b300-11", username="justin", gpu="0", instance="172.16.10.11:9100", job="gpu-users")],
            deploys=[deploy(1, "eng1", login="justin", email="justin@oadpiz.com", avatarUrl="https://x", data={"cmd": "rm -rf /"},
                            token="glsa_secret")])
        self.gateway.activity_value = leaky
        response = self.admin_client.get(BASE + "/admin/engineers")
        body, text = response.json(), response.text
        for needle in (key.split(" ")[1], "justin-laptop", "@oadpiz.com", "sshPubkey", "172.16.10", "203.0.113.7", "serve.py", "vllm",
                       "sk-secret", "glsa_", "rm -rf", "b300-11.internal"):
            self.assertNotIn(needle, text)
        for name in walk_keys(body):
            self.assertFalse(any(part in name.lower() for part in FORBIDDEN_KEY_PARTS), name)
            self.assertNotIn(name, ("pid", "instance", "job", "login", "avatarUrl", "data"))
        self.assertEqual(set(body), {"gatewayConfigured", "activity", "lastExport", "engineers", "unmatched"})
        for engineer in body["engineers"]:
            self.assertEqual(set(engineer), ENGINEER_KEYS)
            for item in engineer["nodes"]:
                self.assertEqual(set(item), NODE_KEYS)
        justin = self.engineer(body, "justin")
        self.assertEqual(set(justin["alerts"][0]), {"alertname", "severity", "node", "gpu", "mountpoint", "username", "since", "reason"})
        self.assertEqual(set(justin["deploys"][0]), {"id", "at", "node", "user", "verified", "model", "port", "text"})

    def test_deploy_text_is_one_plain_line(self):
        self.gateway.activity_value = activity(deploys=[deploy(1, "eng1", text="first line\x1b[31m‮\nrelay detail: 172.16.10.11")])
        text = self.engineer(self.get(), "justin")["deploys"][0]["text"]
        self.assertEqual(text, "first line[31m")

    def test_grafana_url(self):
        justin = self.engineer(self.get(), "justin")
        self.assertEqual(justin["grafanaUrl"], "https://grafana.powerchampion.ai/d/b300-engineers?var-engineer=justin&from=now-24h&to=now")
        from server.app import create_app

        app = create_app(dataclasses.replace(self.settings, grafana_url=""), gateway=self.gateway)
        client = TestClient(app, base_url=ORIGIN)
        self.clients.append(client)
        self.assertEqual(self.post(client, "/auth/login", {"email": "admin@example.test", "password": PASSWORD}).status_code, 200)
        body = client.get(BASE + "/admin/engineers").json()
        self.assertTrue(all(e["grafanaUrl"] is None for e in body["engineers"]))
        self.assertEqual(_grafana_url("https://g.example.test/", "a b&c"), "https://g.example.test/d/b300-engineers?var-engineer=a%20b%26c&from=now-24h&to=now")


class ComposeTests(unittest.TestCase):
    """compose() is pure: the same rules without a database."""

    STATE = {"lastExport": None,
             "nodes": [{"name": "b300-11", "role": "engineer", "engineerId": "e1"}, {"name": "b300-14", "role": "selling", "engineerId": None},
                       {"name": "b300-12", "role": "reserved", "engineerId": None}],
             "engineers": [{"id": "e2", "clusterId": "eng10", "username": "bob", "displayName": "Bob", "active": True, "sshPubkey": None,
                            "keyPendingSync": False, "keyFingerprint": None, "keyType": None, "email": "bob@example.test"},
                           {"id": "e1", "clusterId": "eng2", "username": "amy", "displayName": "Amy", "active": True, "sshPubkey": "ssh-ed25519 AAAA",
                            "keyPendingSync": False, "keyFingerprint": "SHA256:x", "keyType": "ssh-ed25519", "email": "amy@example.test"}]}

    def test_roster_is_sorted_by_active_then_numeric_cluster_id(self):
        body = compose(self.STATE, None, None, False, "")
        self.assertEqual([e["clusterId"] for e in body["engineers"]], ["eng2", "eng10"])
        self.assertEqual(body["engineers"][0]["keyStatus"], "synced")
        self.assertNotIn("bob@example.test", json.dumps(body))

    def test_alert_on_a_reserved_node_is_unmatched(self):
        body = compose(self.STATE, activity(nodes=[], alerts=[alert("EngineerNodeDown", node="b300-12")]), None, True, "")
        self.assertEqual([a["node"] for a in body["unmatched"]["alerts"]], ["b300-12"])
        self.assertEqual(body["engineers"][0]["alerts"], [])


if __name__ == "__main__":
    unittest.main()
