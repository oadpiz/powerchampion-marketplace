"""Video studio portal backend (docs/studio-spec.md section 9, "Portal backend").

Runs on SQLite, and on Postgres when PC_PORTAL_TEST_DATABASE_URL is set. Every test ends with
the ledger invariants (section 6) checked in tearDown."""
import importlib.util
import json
import threading
import time
import unittest
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from server.settings import Settings
from server.studio import ACTIVE, LIMITS, sign_grant, sign_quote
from server.studio_agent import AgentError, StudioAgent
from server.testsupport import (BASE, ORIGIN, STUDIO_GRANT_SECRET, STUDIO_QUOTE_SECRET, STUDIO_TOKEN, FakeGateway, FakeStudioAgent,
                                PortalCase, fresh_database, rows, studio_settings)

T0 = 1_800_000_000  # 2027-01-15 08:00 UTC
_SIGNING = Path("shortvideo-agent", "shortvideo", "studio", "signing.py")
# The S1 agent checkout, when it sits next to this repository (or a parent of its worktree); CI skips.
AGENT_SIGNING = next((p / _SIGNING for p in Path(__file__).resolve().parents if (p / _SIGNING).exists()), Path("/nonexistent"))


class StudioCase(PortalCase):
    sweeper = False
    allowed_emails = ""  # PC_STUDIO_ALLOWED_EMAILS; empty = the studio is open to every signed-in user

    def setUp(self):
        import tempfile
        from server.app import create_app

        self.directory = tempfile.TemporaryDirectory()
        self.now = T0
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,),
                                 studio_sweeper=self.sweeper, studio_sweep_interval=0.05, studio_allowed_emails=self.allowed_emails,
                                 **studio_settings())
        self.agent = FakeStudioAgent(clock=lambda: self.now)
        # Drafts are free in production (StudioOwnerDecisionTests); the money tests keep a paid draft so
        # every create also exercises reserve, settle and refund.
        self.agent.prices["draft"] = 2
        self.app = create_app(self.settings, gateway=FakeGateway(), studio_agent=self.agent)
        self.store = self.app.state.store
        self.studio = self.app.state.studio
        self.studio.clock = lambda: self.now
        self.clients = []
        self._admin = None
        self._keys = 0

    def tearDown(self):
        try:
            self.check_invariants()
            self.assertEqual(self.agent.in_loop, [], "agent calls must run in the threadpool, never on the event loop")
        finally:
            super().tearDown()

    # -- helpers ---------------------------------------------------------------------------------

    def check_invariants(self):
        accounts, ops, ledger = rows(self.store, "studio_accounts"), rows(self.store, "studio_ops"), rows(self.store, "studio_ledger")
        for a in accounts:
            self.assertGreaterEqual(a["balance"], 0)
            self.assertGreaterEqual(a["reserved"], 0)
            self.assertEqual(a["reserved"], sum(o["credits"] for o in ops if o["user_id"] == a["user_id"] and o["state"] in ACTIVE), a)
            self.assertEqual(a["balance"], sum(r["delta"] for r in ledger if r["user_id"] == a["user_id"]), a)
        for o in ops:
            mine = [r for r in ledger if r["op_id"] == o["op_id"]]
            reserves = [r for r in mine if r["kind"] == "reserve"]
            settles = [r for r in mine if r["kind"] == "settle"]
            refunded = sum(r["delta"] for r in mine if r["kind"] == "refund")
            self.assertEqual([r["delta"] for r in reserves], [-o["credits"]], o)
            if o["state"] in ACTIVE:
                self.assertIsNone(o["credits_charged"], o)
                self.assertEqual((settles, refunded), ([], 0), o)
            else:
                self.assertEqual(o["credits_charged"] + refunded, o["credits"], o)
                self.assertEqual(len(settles), 0 if o["state"] == "refunded" else 1, o)
                self.assertTrue(all(r["delta"] == 0 for r in settles))
                if o["state"] == "refunded":
                    self.assertEqual(o["credits_charged"], 0)
                elif o["state"] == "settled":
                    self.assertEqual(o["credits_charged"], o["credits"])
                else:
                    self.assertTrue(0 < o["credits_charged"] < o["credits"], o)
        for r in ledger:
            if r["kind"] in ("grant", "expire"):
                self.assertIsNone(r["op_id"])
        active = [o["project_id"] for o in ops if o["state"] in ACTIVE]
        self.assertEqual(len(active), len(set(active)))

    def admin_client(self):
        if self._admin is None:
            self._admin = self.admin()
        return self._admin

    def customer(self, email="maker@example.test"):
        client = self.client()
        user = self.register(client, email)
        return client, user["id"]

    def grant(self, user_id, credits, **extra):
        response = self.post(self.admin_client(), "/admin/studio/credits/grant", {"user_id": user_id, "credits": credits, **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["account"]

    def key(self):
        self._keys += 1
        return "key-%08d" % self._keys

    def create(self, client, key=None, topic="tea"):
        return self.post(client, "/studio/projects", {"template_id": "ecommerce", "aspect": "9:16", "inputs": {"topic": topic},
                                                      "idempotency_key": key or self.key()})

    def drafted(self, client, credits=100):
        """A project whose draft op has settled. Returns its id."""
        user_id = self.user_of(client)
        if credits:
            self.grant(user_id, credits)
        response = self.create(client)
        self.assertEqual(response.status_code, 201, response.text)
        self.agent.finish(response.json()["op_id"])
        project = client.get(BASE + "/studio/projects/" + response.json()["id"])
        self.assertEqual(project.status_code, 200, project.text)
        return response.json()["id"]

    def user_of(self, client):
        return client.get(BASE + "/session").json()["user"]["id"]

    def quote(self, client, pid, op_type="render", target=None):
        body = {"type": op_type}
        if target is not None:
            body["target"] = target
        response = self.post(client, "/studio/projects/" + pid + "/quote", body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def submit(self, client, pid, quote, key=None, **changes):
        body = {k: quote[k] for k in ("quote_id", "credits", "storyboard_rev", "exp", "sig", "type", "target")}
        body.update(changes, idempotency_key=key or self.key())
        return self.post(client, "/studio/projects/" + pid + "/ops", body)

    def account(self, user_id):
        return next((a for a in rows(self.store, "studio_accounts") if a["user_id"] == user_id), None)

    def ops(self):
        return {o["op_id"]: o for o in rows(self.store, "studio_ops")}

    def add_project(self, user_id, pid):
        self.studio.claim_project(user_id, pid, "ecommerce")

    def raw_quote(self, user_id, pid, credits, op_type="render", quote_id=None):
        quote_id = quote_id or "q_" + pid
        exp = self.now + 600
        return {"quote_id": quote_id, "type": op_type, "target": None, "credits": credits, "storyboard_rev": 0, "exp": exp,
                "sig": sign_quote(STUDIO_QUOTE_SECRET, quote_id, user_id, pid, op_type, None, credits, 0, exp)}


class StudioConfigTests(PortalCase):
    def test_unconfigured_studio_answers_503_after_auth(self):
        customer = self.client()
        self.register(customer, "c@example.test")
        anonymous = self.client()
        gets = ["/studio/templates", "/studio/projects", "/studio/projects?deleted=1", "/studio/credits", "/studio/projects/p1", "/studio/projects/p1/ops/o1"]
        posts = ["/studio/projects", "/studio/uploads", "/studio/projects/p1/settings", "/studio/projects/p1/shots/1/edit",
                 "/studio/projects/p1/quote", "/studio/projects/p1/ops", "/studio/projects/p1/delete", "/studio/projects/p1/restore"]
        for path in gets:
            self.assertEqual(anonymous.get(BASE + path).status_code, 401, path)
            response = customer.get(BASE + path)
            self.assertEqual((response.status_code, response.json()["error"]), (503, "studio_unconfigured"), path)
        for path in posts:
            self.assertEqual(self.post(anonymous, path, {}).status_code, 401, path)
            response = self.post(customer, path, {})
            self.assertEqual((response.status_code, response.json()["error"]), (503, "studio_unconfigured"), path)
        self.assertFalse(self.app.state.studio.sweeper_enabled)

    def test_settings_need_all_four_values_and_distinct_secrets(self):
        self.assertTrue(Settings(**studio_settings()).studio_configured)
        for field in studio_settings():
            self.assertFalse(Settings(**dict(studio_settings(), **{field: ""})).studio_configured, field)
        self.assertFalse(Settings(**dict(studio_settings(), studio_service_token=STUDIO_GRANT_SECRET)).studio_configured)
        for bad in ("ftp://agent", "http://user:pw@agent:8081", "http://agent:8081/internal", "http://agent?x=1"):
            with self.assertRaises(ValueError, msg=bad):
                Settings(**dict(studio_settings(), studio_agent_url=bad))

    def test_from_env_reads_studio_values_and_sweeper_flag(self):
        import os
        from unittest import mock
        env = {"PC_STUDIO_AGENT_URL": "http://shortvideo-api:8081/", "SHORTVIDEO_SERVICE_TOKEN": "t" * 20,
               "SHORTVIDEO_GRANT_SECRET": "g" * 20, "SHORTVIDEO_QUOTE_SECRET": "q" * 20}
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("PC_STUDIO_SWEEPER", None)
            settings = Settings.from_env()
            self.assertEqual(settings.studio_agent_url, "http://shortvideo-api:8081")
            self.assertTrue(settings.studio_configured and settings.studio_sweeper)
            self.assertNotIn("g" * 20, repr(settings))
            os.environ["PC_STUDIO_SWEEPER"] = "0"
            self.assertFalse(Settings.from_env().studio_sweeper)


class StudioAllowlistTests(StudioCase):
    """Demo mode: PC_STUDIO_ALLOWED_EMAILS limits the customer /studio/* routes to listed accounts and admins."""
    allowed_emails = " Maker@Example.TEST , ,demo@example.test,"
    gets = ["/studio/templates", "/studio/projects", "/studio/projects?deleted=1", "/studio/credits", "/studio/projects/p1", "/studio/projects/p1/ops/o1"]
    posts = ["/studio/projects", "/studio/uploads", "/studio/projects/p1/settings", "/studio/projects/p1/shots/1/edit", "/studio/projects/p1/shots/x/edit",
             "/studio/projects/p1/quote", "/studio/projects/p1/ops", "/studio/projects/p1/delete", "/studio/projects/p1/restore"]

    def test_the_list_is_trimmed_lowercased_and_drops_empty_entries(self):
        self.assertEqual(self.settings.studio_allowed_emails, ("maker@example.test", "demo@example.test"))
        self.assertEqual(Settings(studio_allowed_emails="").studio_allowed_emails, ())
        self.assertEqual(Settings(studio_allowed_emails=" , ").studio_allowed_emails, ())
        self.assertEqual(Settings().studio_allowed_emails, ())

    def test_a_listed_user_can_use_the_studio(self):
        client = self.client()
        self.register(client, "MAKER@example.test")  # stored lowercased; the list entry was mixed case
        self.assertEqual(client.get(BASE + "/studio/credits").status_code, 200)
        pid = self.drafted(client)
        self.assertEqual(client.get(BASE + "/studio/projects/" + pid).status_code, 200)
        self.assertIs(client.get(BASE + "/session").json()["studio_access"], True)

    def test_an_unlisted_customer_gets_studio_not_open_on_every_route(self):
        customer, user_id = self.customer("someone@example.test")
        anonymous = self.client()
        for path in self.gets:
            self.assertEqual(anonymous.get(BASE + path).status_code, 401, path)
            response = customer.get(BASE + path)
            self.assertEqual((response.status_code, response.json()["error"]), (403, "studio_not_open"), path)
        for path in self.posts:
            self.assertEqual(self.post(anonymous, path, {}).status_code, 401, path)
            response = self.post(customer, path, {"idempotency_key": "abcdefgh"})
            self.assertEqual((response.status_code, response.json()["error"]), (403, "studio_not_open"), path)
        self.assertIs(customer.get(BASE + "/session").json()["studio_access"], False)
        self.assertEqual([c for c in self.agent.calls if c[1] == user_id], [])  # nothing reached the agent
        # The admin can still grant credits to an unlisted account (e.g. ahead of opening it).
        self.assertEqual(self.grant(user_id, 10)["balance"], 10)

    def test_an_admin_can_always_use_the_studio(self):
        admin = self.admin_client()  # admin@example.test is not on the list
        self.assertEqual(admin.get(BASE + "/studio/credits").status_code, 200)
        self.assertEqual(admin.get(BASE + "/studio/templates").status_code, 200)
        self.assertIs(admin.get(BASE + "/session").json()["studio_access"], True)

    def test_an_empty_list_leaves_the_studio_open(self):
        import os
        from unittest import mock
        for value in ("", "  ", " , "):
            with mock.patch.dict(os.environ, {"PC_STUDIO_ALLOWED_EMAILS": value}):
                self.assertEqual(Settings.from_env().studio_allowed_emails, (), repr(value))
        with mock.patch.dict(os.environ, {"PC_STUDIO_ALLOWED_EMAILS": " A@x.test,b@X.test "}):
            self.assertEqual(Settings.from_env().studio_allowed_emails, ("a@x.test", "b@x.test"))
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PC_STUDIO_ALLOWED_EMAILS", None)
            self.assertEqual(Settings.from_env().studio_allowed_emails, ())


class StudioOpenByDefaultTests(StudioCase):
    def test_without_a_list_every_signed_in_user_can_use_the_studio(self):
        client, _ = self.customer("anyone@example.test")
        self.assertEqual(client.get(BASE + "/studio/credits").status_code, 200)
        self.assertIs(client.get(BASE + "/session").json()["studio_access"], True)


class StudioFlowTests(StudioCase):
    def test_templates_and_credits(self):
        client, user_id = self.customer()
        templates = client.get(BASE + "/studio/templates").json()["items"]
        self.assertEqual(templates[0]["id"], "ecommerce")
        self.assertNotIn("rules", templates[0])
        self.assertEqual(templates[0]["prices"]["draft"], 2)
        self.assertEqual(client.get(BASE + "/studio/credits").json(), {"balance": 0, "reserved": 0, "plan": None, "period_end": None, "recent": [],
                                                                  "drafts": {"limit": 30, "used": 0, "remaining": 30, "resets_at": T0 + 8 * 3600}})
        self.grant(user_id, 50, note="welcome", plan="merchant")
        credits = client.get(BASE + "/studio/credits").json()
        self.assertEqual((credits["balance"], credits["reserved"], credits["plan"]), (50, 0, "merchant"))
        self.assertEqual([(r["kind"], r["delta"], r["note"]) for r in credits["recent"]], [("grant", 50, "welcome")])

    def test_create_project_reserves_the_draft_and_settles_it(self):
        client, user_id = self.customer()
        self.grant(user_id, 10)
        response = self.create(client)
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual((body["status"], body["state"]), ("drafting", "submitted"))
        self.assertEqual((self.account(user_id)["balance"], self.account(user_id)["reserved"]), (8, 2))
        op = self.agent.ops[body["op_id"]]
        self.assertEqual((op["owner"], op["type"], op["credits"], op["plan"]), (user_id, "draft", 2, "creator"))
        project = client.get(BASE + "/studio/projects/" + body["id"]).json()
        self.assertEqual(project["active_op"]["op_id"], body["op_id"])
        self.agent.finish(body["op_id"])
        project = client.get(BASE + "/studio/projects/" + body["id"]).json()  # lazy reconcile
        self.assertIsNone(project["active_op"])
        self.assertEqual(self.ops()[body["op_id"]]["state"], "settled")
        self.assertEqual((self.account(user_id)["balance"], self.account(user_id)["reserved"]), (8, 0))
        op = client.get(BASE + "/studio/projects/" + body["id"] + "/ops/" + body["op_id"]).json()
        self.assertEqual((op["state"], op["credits_charged"], op["credits_refunded"], op["error"]), ("settled", 2, 0, None))

    def test_create_project_is_idempotent_and_a_402_retry_reuses_the_project(self):
        client, user_id = self.customer()
        first = self.create(client, key="create-once")
        self.assertEqual((first.status_code, first.json()["error"]), (402, "studio_insufficient_credits"))
        # No portal row is left behind (no op, no ledger row); the agent keeps its project, which the same key reuses.
        self.assertEqual((rows(self.store, "studio_projects"), rows(self.store, "studio_ops"), rows(self.store, "studio_ledger")), ([], [], []))
        self.assertEqual(len(self.agent.projects), 1)
        agent_project = next(iter(self.agent.projects))
        self.grant(user_id, 5)
        second = self.create(client, key="create-once")
        self.assertEqual(second.status_code, 201, second.text)
        self.assertEqual(second.json()["id"], agent_project)
        replay = self.create(client, key="create-once")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual((replay.json()["id"], replay.json()["op_id"]), (second.json()["id"], second.json()["op_id"]))
        self.assertEqual(len(self.agent.projects), 1)
        self.assertEqual(len(self.agent.ops), 1)
        self.assertEqual([c[0] for c in self.agent.calls].count("submit_op"), 1)
        self.assertEqual(self.account(user_id)["balance"], 3)

    def test_agent_rejecting_the_inputs_leaves_no_project(self):
        client, user_id = self.customer()
        self.grant(user_id, 10)
        response = self.create(client, topic="BLOCKED")
        self.assertEqual((response.status_code, response.json()["error"]), (400, "studio_invalid_input"))
        self.assertEqual(rows(self.store, "studio_projects"), [])
        self.assertEqual(self.account(user_id)["balance"], 10)

    def test_render_partial_failure_charges_only_produced_credits(self):
        client, user_id = self.customer()
        pid = self.drafted(client, credits=20)
        quote = self.quote(client, pid)
        self.assertEqual(quote["credits"], 10)
        response = self.submit(client, pid, quote)
        self.assertEqual(response.status_code, 202, response.text)
        op_id = response.json()["op_id"]
        self.assertEqual(response.json()["state"], "submitted")
        self.assertEqual((self.account(user_id)["balance"], self.account(user_id)["reserved"]), (8, 10))
        self.agent.finish(op_id, "failed", produced_credits=6, error={"code": "gateway_error", "message": "upstream said: secret detail"})
        op = client.get(BASE + "/studio/projects/" + pid + "/ops/" + op_id).json()
        self.assertEqual((op["state"], op["credits_charged"], op["credits_refunded"], op["error"]), ("settled_partial", 6, 4, {"code": "gateway_error"}))
        self.assertEqual((self.account(user_id)["balance"], self.account(user_id)["reserved"]), (12, 0))
        self.assertNotIn("secret detail", json.dumps(rows(self.store, "studio_ops")))

    def test_failed_op_that_produced_nothing_is_refunded(self):
        client, user_id = self.customer()
        pid = self.drafted(client, credits=20)
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        self.agent.finish(op_id, "failed", error={"code": "interrupted", "message": "x"})
        self.assertEqual(client.get(BASE + "/studio/projects/" + pid + "/ops/" + op_id).json()["state"], "refunded")
        self.assertEqual(self.account(user_id)["balance"], 18)

    def test_quote_tampering_is_400_and_reserves_nothing(self):
        client, user_id = self.customer()
        pid = self.drafted(client, credits=20)
        other, _ = self.customer("other@example.test")
        other_pid = self.drafted(other, credits=20)
        quote = self.quote(client, pid)
        before = (self.account(user_id), len(rows(self.store, "studio_ops")))
        submits = [c[0] for c in self.agent.calls].count("submit_op")
        tampered = [{"credits": 1}, {"credits": 0}, {"storyboard_rev": quote["storyboard_rev"] + 1}, {"exp": quote["exp"] + 3600},
                    {"type": "export"}, {"target": "16:9"}, {"sig": "0" * 64}, {"sig": "not-hex"}, {"quote_id": "q_other"},
                    {"credits": "10"}, {"credits": True}, {"target": "a|b"}]
        for change in tampered:
            response = self.submit(client, pid, quote, **change)
            self.assertEqual((response.status_code, response.json()["error"]), (400, "studio_invalid_input"), change)
        # A genuine quote for another project, or another user's quote, does not transfer either.
        stolen = self.quote(other, other_pid)
        response = self.submit(client, pid, stolen)
        self.assertEqual(response.status_code, 400)
        response = self.submit(client, other_pid, quote)
        self.assertEqual(response.status_code, 404)
        self.assertEqual((self.account(user_id), len(rows(self.store, "studio_ops"))), before)
        self.assertEqual([c[0] for c in self.agent.calls].count("submit_op"), submits)

    def test_expired_quote_is_409(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        quote = self.quote(client, pid)
        self.now += 601
        response = self.submit(client, pid, quote)
        self.assertEqual((response.status_code, response.json()["error"]), (409, "studio_stale_quote"))

    def test_op_submission_is_idempotent(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        quote = self.quote(client, pid)
        first = self.submit(client, pid, quote, key="render-key-1")
        again = self.submit(client, pid, quote, key="render-key-1")
        self.assertEqual((first.status_code, again.status_code), (202, 200))
        self.assertEqual(first.json()["op_id"], again.json()["op_id"])
        # The same quote under a new key is refused locally: no second reservation, no agent call.
        calls = len(self.agent.calls)
        third = self.submit(client, pid, quote, key="render-key-2")
        self.assertEqual((third.status_code, third.json()["error"]), (409, "studio_stale_quote"))
        self.assertEqual(len(self.agent.calls), calls)
        self.assertEqual([c[0] for c in self.agent.calls].count("submit_op"), 2)  # draft + render
        self.assertEqual(self.account(user_id)["reserved"], 10)

    def test_stale_quote_from_the_agent_refunds_immediately(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        quote = self.quote(client, pid)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/settings", {"voice": "v2"}).status_code, 200)
        response = self.submit(client, pid, quote)
        self.assertEqual((response.status_code, response.json()["error"]), (409, "studio_stale_quote"))
        op = [o for o in rows(self.store, "studio_ops") if o["type"] == "render"][0]
        self.assertEqual((op["state"], op["error"]), ("refunded", "studio_stale_quote"))
        self.assertEqual(self.account(user_id)["balance"], 98)

    def test_any_4xx_from_submit_refunds(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        for error, status, code in ((AgentError("rejected", 429, "studio_daily_cap"), 429, "studio_daily_cap"),
                                    (AgentError("rejected", 409, "studio_storage_full"), 409, "studio_storage_full"),
                                    (AgentError("rejected", 403, "studio_forbidden"), 503, "studio_unavailable")):
            self.agent.submit_error, self.agent.submit_accepts = error, False
            response = self.submit(client, pid, self.quote(client, pid))
            self.assertEqual((response.status_code, response.json()["error"]), (status, code))
        self.assertEqual({o["state"] for o in rows(self.store, "studio_ops") if o["type"] == "render"}, {"refunded"})
        self.assertEqual(self.account(user_id)["balance"], 98)

    def test_timeout_goes_unknown_and_the_sweeper_settles_it(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.agent.submit_error, self.agent.submit_accepts = AgentError("timeout"), True
        response = self.submit(client, pid, self.quote(client, pid))
        self.assertEqual((response.status_code, response.json()["state"]), (202, "unknown"))
        op_id = response.json()["op_id"]
        self.assertEqual(self.account(user_id)["reserved"], 10)  # never refunded on a timeout
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "submitted")
        self.agent.finish(op_id)
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "settled")
        self.assertEqual((self.account(user_id)["balance"], self.account(user_id)["reserved"]), (88, 0))

    def test_5xx_the_agent_never_saw_is_refunded_after_120_s(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.agent.submit_error, self.agent.submit_accepts = AgentError("unavailable", 502), False
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        self.assertEqual(self.ops()[op_id]["state"], "unknown")
        self.now += 119
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "unknown")
        self.now += 1
        self.studio.sweep()
        self.assertEqual((self.ops()[op_id]["state"], self.ops()[op_id]["error"]), ("refunded", "not_submitted"))

    def test_only_the_agents_own_not_found_refunds(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.agent.submit_error, self.agent.submit_accepts = AgentError("timeout"), True
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        self.now += 500
        self.agent.fail = AgentError("rejected", 404, None)  # e.g. a misrouted URL while the agent runs the op
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "unknown")
        self.agent.fail = None
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "submitted")
        # The agent later loses the op (its data restored): refunded only after LOST_S, never before.
        del self.agent.ops[op_id]
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "submitted")
        self.now += 6 * 3600
        self.studio.sweep()
        self.assertEqual((self.ops()[op_id]["state"], self.ops()[op_id]["error"]), ("refunded", "lost_by_agent"))

    def test_sweep_stops_between_ops_when_asked(self):
        _, user_id = self.customer()
        self.grant(user_id, 10)
        self.add_project(user_id, "p-stop")
        self.studio.reserve(user_id, "p-stop", self.raw_quote(user_id, "p-stop", 1), "stop-key-1")
        stop = threading.Event()
        stop.set()
        calls = len(self.agent.calls)
        self.assertEqual(self.studio.sweep(stop=stop), 1)
        self.assertEqual(len(self.agent.calls), calls)
        self.now += 121
        self.studio.sweep()

    def test_crash_after_reserve_is_refunded_after_120_s(self):
        _, user_id = self.customer()
        self.grant(user_id, 10)
        self.add_project(user_id, "p-crash")
        op, created = self.studio.reserve(user_id, "p-crash", self.raw_quote(user_id, "p-crash", 10), "crash-key-1")
        self.assertTrue(created)
        self.now += 119
        self.studio.sweep()
        self.assertEqual(self.ops()[op["op_id"]]["state"], "reserved")
        self.now += 1
        self.studio.sweep()
        self.assertEqual(self.ops()[op["op_id"]]["state"], "refunded")
        self.assertEqual(self.account(user_id)["balance"], 10)

    def test_crash_after_the_agent_accepted_is_settled(self):
        _, user_id = self.customer()
        self.grant(user_id, 10)
        self.add_project(user_id, "p-acc")
        self.agent.create_project(user_id, {"project_id": "p-acc", "template_id": "ecommerce", "aspect": "9:16", "inputs": {}})
        quote = self.agent.quote(user_id, "p-acc", {"type": "render"})
        op, _ = self.studio.reserve(user_id, "p-acc", self.studio.verify_quote(user_id, "p-acc", quote), "acc-key-1")
        # The portal died after the agent accepted: the agent knows the op, the portal still has it reserved.
        self.agent.submit_op(user_id, "p-acc", {"op_id": op["op_id"], "type": "render", "target": None,
                                                "quote": {k: quote[k] for k in ("quote_id", "credits", "storyboard_rev", "exp", "sig")},
                                                "grant": self.studio.grant(op)})
        self.now += 500  # older than 120 s, but found: never refunded
        self.studio.sweep()
        self.assertEqual(self.ops()[op["op_id"]]["state"], "submitted")
        self.agent.finish(op["op_id"])
        self.studio.sweep()
        self.assertEqual(self.ops()[op["op_id"]]["state"], "settled")

    def test_settle_and_refund_race_has_exactly_one_winner(self):
        _, user_id = self.customer()
        self.grant(user_id, 100)
        for round_ in range(6):
            pid = "p-race-%d" % round_
            self.add_project(user_id, pid)
            op, _ = self.studio.reserve(user_id, pid, self.raw_quote(user_id, pid, 10), "race-key-%d" % round_)
            self.studio.move(op["op_id"], "submitted", ("reserved",))
            barrier, results = threading.Barrier(3), []

            def settle():
                barrier.wait()
                results.append(("settle", self.studio.finish(op["op_id"], 10, succeeded=True)))

            def refund():
                barrier.wait()
                results.append(("refund", self.studio.finish(op["op_id"], 0, error="x")))

            def partial():
                barrier.wait()
                results.append(("partial", self.studio.finish(op["op_id"], 4)))
            threads = [threading.Thread(target=f) for f in (settle, refund, partial)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(sorted(won for _, won in results), [False, False, True], results)
            self.check_invariants()

    def test_reserve_under_30_threads_with_credits_for_3(self):
        _, user_id = self.customer()
        self.grant(user_id, 30)
        self.studio.max_active_per_user = None  # busy caps off: only the balance decides
        self.studio.limits["project"] = (1000, 3600)
        pids = ["p-thread-%02d" % i for i in range(30)]
        for pid in pids:
            self.add_project(user_id, pid)
        barrier, results, lock = threading.Barrier(30), [], threading.Lock()

        def worker(pid):
            barrier.wait()
            try:
                _, created = self.studio.reserve(user_id, pid, self.raw_quote(user_id, pid, 10), "k-" + pid)
                outcome = "created" if created else "replay"
            except Exception as error:  # noqa: BLE001
                outcome = getattr(error, "code", repr(error))
            with lock:
                results.append(outcome)
        threads = [threading.Thread(target=worker, args=(pid,)) for pid in pids]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(results), sorted(["created"] * 3 + ["studio_insufficient_credits"] * 27), results)
        self.assertEqual((self.account(user_id)["balance"], self.account(user_id)["reserved"]), (0, 30))

    def test_one_active_op_per_project_and_two_per_user(self):
        _, user_id = self.customer()
        self.grant(user_id, 100)
        for pid in ("p-a", "p-b", "p-c"):
            self.add_project(user_id, pid)
        self.studio.reserve(user_id, "p-a", self.raw_quote(user_id, "p-a", 10), "busy-key-1")
        with self.assertRaises(Exception) as caught:
            self.studio.reserve(user_id, "p-a", self.raw_quote(user_id, "p-a", 10, quote_id="q_a2"), "busy-key-2")
        self.assertEqual(caught.exception.code, "studio_busy")
        self.studio.reserve(user_id, "p-b", self.raw_quote(user_id, "p-b", 10), "busy-key-3")
        with self.assertRaises(Exception) as caught:
            self.studio.reserve(user_id, "p-c", self.raw_quote(user_id, "p-c", 10), "busy-key-4")
        self.assertEqual((caught.exception.code, caught.exception.status), ("studio_busy", 409))
        # The partial unique index itself, without the application check.
        with self.assertRaises(self.store.IntegrityError):
            with self.store.connect() as con:
                con.execute("INSERT INTO studio_ops (op_id,user_id,project_id,type,credits,state,idempotency_key,created_at,updated_at) "
                            "VALUES ('o-dup',?,'p-a','render',0,'unknown','dup-key-1',0,0)", (user_id,))
        with self.store.connect() as con:  # a terminal op on the same project is fine
            con.execute("INSERT INTO studio_ops (op_id,user_id,project_id,type,credits,state,credits_charged,idempotency_key,created_at,updated_at) "
                        "VALUES ('o-old',?,'p-a','render',0,'refunded',0,'dup-key-2',0,0)", (user_id,))
            con.execute("INSERT INTO studio_ledger (user_id,op_id,kind,delta,created_at) VALUES (?,'o-old','reserve',0,0)", (user_id,))

    def test_edits_are_409_while_an_op_is_active(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.agent.submit_error, self.agent.submit_accepts = AgentError("timeout"), False
        self.submit(client, pid, self.quote(client, pid))
        calls = len(self.agent.calls)
        for path, body in (("/settings", {"voice": "v2"}), ("/shots/1/edit", {"narration": "x"})):
            response = self.post(client, "/studio/projects/" + pid + path, body)
            self.assertEqual((response.status_code, response.json()["error"]), (409, "studio_busy"), path)
        self.assertEqual(len(self.agent.calls), calls)
        project = client.get(BASE + "/studio/projects/" + pid).json()
        self.assertEqual(project["active_op"]["state"], "unknown")  # the UI keeps polling
        self.now += 121
        self.studio.sweep()

    def test_disabled_accounts_start_nothing_but_in_flight_ops_settle(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        self.add_project(user_id, "p-later")
        with self.store.connect() as con:
            con.execute("UPDATE users SET disabled_at=? WHERE id=?", (int(time.time()), user_id))
        self.assertEqual(client.get(BASE + "/studio/credits").status_code, 401)
        with self.assertRaises(Exception) as caught:
            self.studio.reserve(user_id, "p-later", self.raw_quote(user_id, "p-later", 0), "late-key-1")
        self.assertEqual((caught.exception.code, caught.exception.status), ("account_disabled", 403))
        self.agent.finish(op_id)
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "settled")

    def test_owner_isolation(self):
        client, _ = self.customer()
        pid = self.drafted(client)
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        other, _ = self.customer("intruder@example.test")
        self.grant(self.user_of(other), 100)
        for response in (other.get(BASE + "/studio/projects/" + pid), other.get(BASE + "/studio/projects/" + pid + "/ops/" + op_id),
                         self.post(other, "/studio/projects/" + pid + "/quote", {"type": "render"}),
                         self.post(other, "/studio/projects/" + pid + "/settings", {"voice": "v2"}),
                         self.post(other, "/studio/uploads", {"purpose": "shot_image", "content_type": "image/png", "bytes": 10, "project_id": pid})):
            self.assertEqual((response.status_code, response.json()["error"]), (404, "studio_not_found"))
        self.assertEqual(other.get(BASE + "/studio/projects").json()["items"], [])

    def test_uploads(self):
        client, user_id = self.customer()
        response = self.post(client, "/studio/uploads", {"purpose": "input_image", "content_type": "image/png", "bytes": 1000})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(set(response.json()), {"upload_id", "put_url", "expires_at"})
        for body in ({"purpose": "input_image", "content_type": "image/png", "bytes": 1000, "project_id": "p1"},
                     {"purpose": "music", "content_type": "audio/mpeg", "bytes": 1000},
                     {"purpose": "other", "content_type": "image/png", "bytes": 1000},
                     {"purpose": "input_image", "content_type": "text/html; x", "bytes": 1000},
                     {"purpose": "input_image", "content_type": "image/png", "bytes": 0}):
            self.assertEqual(self.post(client, "/studio/uploads", body).status_code, 400, body)
        response = self.post(client, "/studio/uploads", {"purpose": "input_image", "content_type": "image/png", "bytes": 21 * 1024 * 1024})
        self.assertEqual((response.status_code, response.json()["error"]), (413, "studio_too_large"))

    def test_rate_limits_are_per_user_and_reserved_before_the_agent_call(self):
        self.assertEqual(LIMITS, {"project": (20, 3600), "upload": (60, 3600), "quote": (120, 60)})
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.studio.limits["quote"] = (3, 60)
        for _ in range(3):
            self.quote(client, pid)
        response = self.post(client, "/studio/projects/" + pid + "/quote", {"type": "render"})
        self.assertEqual((response.status_code, response.json()["error"]), (429, "studio_rate_limited"))
        other, _ = self.customer("second@example.test")  # another user is not affected
        self.assertEqual(self.post(other, "/studio/projects/" + self.drafted(other) + "/quote", {"type": "render"}).status_code, 200)
        self.now += 60
        self.quote(client, pid)
        self.studio.limits["upload"] = (1, 3600)
        upload = {"purpose": "input_image", "content_type": "image/png", "bytes": 10}
        self.assertEqual(self.post(client, "/studio/uploads", upload).status_code, 201)
        self.assertEqual(self.post(client, "/studio/uploads", upload).status_code, 429)
        self.studio.limits["project"] = (2, 3600)  # one already used by drafted()
        self.assertEqual(self.create(client, key="limit-key-1").status_code, 201)
        self.assertEqual(self.create(client, key="limit-key-1").status_code, 200)  # a replay is not counted
        self.assertEqual(self.create(client, key="limit-key-2").status_code, 429)
        self.assertTrue(rows(self.store, "studio_rate"))
        self.now += 2 * 86400
        self.studio.sweep()  # old windows are dropped
        self.assertEqual(rows(self.store, "studio_rate"), [])

    def test_body_size_is_checked_before_parsing(self):
        client, _ = self.customer()
        calls = len(self.agent.calls)
        big = b'{"idempotency_key":"abcdefgh","inputs":{"topic":"' + b"x" * 70000 + b'"}}'
        response = client.post(BASE + "/studio/projects", content=big, headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(len(self.agent.calls), calls)

    def test_agent_errors_map_to_portal_errors(self):
        client, _ = self.customer()
        pid = self.drafted(client)
        for error, status, code in ((AgentError("unavailable", 502), 503, "studio_unavailable"), (AgentError("timeout"), 503, "studio_unavailable"),
                                    (AgentError("invalid_response"), 503, "studio_unavailable"),
                                    (AgentError("rejected", 401, "studio_unauthorized"), 503, "studio_unavailable"),
                                    (AgentError("rejected", 404, None), 404, "studio_not_found"),
                                    (AgentError("rejected", 409, "studio_needs_render"), 409, "studio_needs_render")):
            self.agent.fail = error
            response = client.get(BASE + "/studio/projects/" + pid)
            self.assertEqual((response.status_code, response.json()["error"]), (status, code), error)
            self.assertNotIn("studio_", response.json()["detail"])
        self.agent.fail = None

    def test_project_list_pages_and_caches(self):
        client, user_id = self.customer()
        self.grant(user_id, 100)
        ids = []
        for i in range(3):
            self.now += 1
            response = self.create(client)
            ids.append(response.json()["id"])
            self.agent.finish(response.json()["op_id"])
            self.studio.sweep()
        first = client.get(BASE + "/studio/projects?limit=2").json()
        self.assertEqual([p["id"] for p in first["items"]], ids[::-1][:2])
        self.assertEqual(first["items"][0]["status"], "draft_ready")
        self.assertTrue(first["items"][0]["thumb_url"].startswith("https://media.test/"))
        second = client.get(BASE + "/studio/projects?limit=2&cursor=" + first["next"]).json()
        self.assertEqual(([p["id"] for p in second["items"]], second["next"]), ([ids[0]], None))
        fetches = [c[0] for c in self.agent.calls].count("get_project")
        client.get(BASE + "/studio/projects")
        self.assertEqual([c[0] for c in self.agent.calls].count("get_project"), fetches)  # cached, still fresh
        self.now += 7200  # the cached signed thumbnails are about to expire: refetched
        client.get(BASE + "/studio/projects")
        self.assertEqual([c[0] for c in self.agent.calls].count("get_project"), fetches + 3)
        for query in ("limit=0", "limit=51", "limit=x", "cursor=bad", "cursor=1_a%7Cb"):
            self.assertEqual(client.get(BASE + "/studio/projects?" + query).status_code, 400, query)

    def test_export_costs_nothing_and_still_goes_through_an_op(self):
        client, user_id = self.customer()
        pid = self.drafted(client, credits=2)
        self.assertEqual(self.account(user_id)["balance"], 0)
        quote = self.quote(client, pid, "export")
        self.assertEqual((quote["credits"], quote["target"]), (0, "9:16"))
        response = self.submit(client, pid, quote)
        self.assertEqual(response.status_code, 202, response.text)
        self.agent.finish(response.json()["op_id"])
        self.studio.sweep()
        self.assertEqual(self.ops()[response.json()["op_id"]]["state"], "settled")

    def test_shot_index_and_ids_are_validated(self):
        client, _ = self.customer()
        pid = self.drafted(client)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/shots/1x/edit", {}).status_code, 404)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/shots/9/edit", {"narration": "x"}).status_code, 404)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/shots/1/edit", {"narration": "x"}).status_code, 200)
        self.assertEqual(client.get(BASE + "/studio/projects/" + pid + "/ops/nope.x").status_code, 404)
        for body in ({"type": "Render"}, {"type": "render", "target": "a|b"}, {"type": "render", "target": True}):
            self.assertEqual(self.post(client, "/studio/projects/" + pid + "/quote", body).status_code, 400, body)


class StudioReviewFixTests(StudioCase):
    """S3 review follow-ups: failed creates leave nothing in the list, internal voices, grant idempotency."""

    def test_a_failed_create_leaves_no_portal_project_and_the_list_hides_projects_without_an_op(self):
        client, user_id = self.customer()
        for status, setup in ((402, lambda: None), (409, lambda: setattr(self.studio, "max_active_per_user", 0))):
            setup()
            response = self.create(client)
            self.assertEqual(response.status_code, status, response.text)
            self.assertEqual(rows(self.store, "studio_projects"), [], status)
        self.studio.max_active_per_user = 2
        # A quote the agent refuses after it created the project: no portal row either.
        self.agent.prices = dict(self.agent.prices)
        del self.agent.prices["draft"]
        self.grant(user_id, 10)
        self.assertEqual(self.create(client).status_code, 400)
        self.assertEqual(rows(self.store, "studio_projects"), [])
        self.agent.prices["draft"] = 2
        # A crash between claim and reserve leaves a row with no op: the list does not show it.
        self.add_project(user_id, "orphan01")
        ok = self.create(client)
        self.assertEqual(ok.status_code, 201, ok.text)
        listed = [p["id"] for p in client.get(BASE + "/studio/projects").json()["items"]]
        self.assertEqual(listed, [ok.json()["id"]])

    def test_customers_cannot_choose_an_internal_voice_and_cannot_render_with_one(self):
        self.assertEqual(Settings().studio_internal_voices, ("tw_ref", "test"))
        client, user_id = self.customer()
        pid = self.drafted(client)
        voice = self.post(client, "/studio/projects/" + pid + "/settings", {"voice": "tw_ref"})
        self.assertEqual((voice.status_code, voice.json()["error"]), (403, "studio_voice_not_allowed"))
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/settings", {"voice": "studio_female"}).status_code, 200)
        # A project still on an internal voice (the agent's default today) cannot be rendered by a customer.
        self.agent.projects[pid]["settings"]["voice"] = "tw_ref"
        refused = self.post(client, "/studio/projects/" + pid + "/quote", {"type": "render"})
        self.assertEqual((refused.status_code, refused.json()["error"]), (409, "studio_no_licensed_voice"))
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/quote", {"type": "regenerate", "target": "1"}).status_code, 409)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/quote", {"type": "add_aspect", "target": "16:9"}).status_code, 200)
        # Administrators may use internal voices (internal tests).
        admin = self.admin_client()
        apid = self.drafted(admin)
        self.assertEqual(self.post(admin, "/studio/projects/" + apid + "/settings", {"voice": "tw_ref"}).status_code, 200)
        self.assertEqual(self.post(admin, "/studio/projects/" + apid + "/quote", {"type": "render"}).status_code, 200)
        # The templates say which voices are internal, from the same setting.
        voice_schema = client.get(BASE + "/studio/templates").json()["items"][0]["project_schema"]["properties"]["voice"]
        self.assertEqual(voice_schema["x-internal-values"], ["tw_ref", "test"])
        self.assertEqual(self.agent.templates(user_id)["items"][0]["project_schema"]["properties"]["voice"].get("x-internal-values"), None)

    def test_internal_voices_and_media_origin_come_from_the_environment(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {"PC_STUDIO_INTERNAL_VOICES": " a , b,,", "PC_STUDIO_MEDIA_ORIGIN": "https://media.example/"}):
            settings = Settings.from_env()
        self.assertEqual((settings.studio_internal_voices, settings.studio_media_origin), (("a", "b"), "https://media.example"))
        for bad in ("ftp://m.example", "https://m.example/path", "https://u:p@m.example", "https://m.example?x=1"):
            with self.assertRaises(ValueError, msg=bad):
                Settings(studio_media_origin=bad)
        client, _ = self.customer()
        self.assertIsNone(client.get(BASE + "/studio/templates").json()["media_origin"])

    def test_grant_with_an_idempotency_key_is_applied_once(self):
        _, user_id = self.customer()
        admin = self.admin_client()
        body = {"user_id": user_id, "credits": 100, "idempotency_key": "grant-0001"}
        first = self.post(admin, "/admin/studio/credits/grant", body)
        replay = self.post(admin, "/admin/studio/credits/grant", body)
        self.assertEqual((first.status_code, replay.status_code), (200, 200), replay.text)
        self.assertEqual(replay.json()["account"]["balance"], 100)
        self.assertTrue(replay.json()["replayed"])
        self.assertFalse(first.json()["replayed"])
        self.assertEqual(len(self.audit("admin.studio_credits_grant")), 1)
        self.assertEqual(self.post(admin, "/admin/studio/credits/grant", dict(body, idempotency_key="grant-0002")).json()["account"]["balance"], 200)
        self.assertEqual(self.post(admin, "/admin/studio/credits/grant", dict(body, idempotency_key="bad key")).status_code, 400)
        # Concurrent duplicates: still exactly one ledger row.
        results = []
        dup = dict(body, idempotency_key="grant-race1")
        threads = [threading.Thread(target=lambda: results.append(self.post(admin, "/admin/studio/credits/grant", dup).status_code)) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(results, [200] * 8)
        self.assertEqual(self.account(user_id)["balance"], 300)


DAY = 86400


class StudioProjectLifecycleTests(StudioCase):
    """Rename, soft delete, the 30-day trash and restore (S4)."""

    def money(self):
        return rows(self.store, "studio_ledger"), rows(self.store, "studio_accounts"), rows(self.store, "studio_ops")

    def project_row(self, pid):
        return next(p for p in rows(self.store, "studio_projects") if p["id"] == pid)

    def listed(self, client, query=""):
        response = client.get(BASE + "/studio/projects" + query)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["items"]

    def settled_render(self, client, pid):
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        self.agent.finish(op_id)
        self.studio.sweep()
        self.assertEqual(self.ops()[op_id]["state"], "settled")

    def test_rename_stores_the_title_in_the_portal_and_the_agent(self):
        client, _ = self.customer()
        pid = self.drafted(client)
        response = self.post(client, "/studio/projects/" + pid + "/settings", {"title": "  夏日新品開箱  "})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["title"], "夏日新品開箱")
        self.assertEqual(self.project_row(pid)["title"], "夏日新品開箱")
        self.assertEqual(self.agent.projects[pid]["title"], "夏日新品開箱")
        self.assertEqual(self.listed(client)[0]["title"], "夏日新品開箱")
        long_ok = self.post(client, "/studio/projects/" + pid + "/settings", {"title": "長" * 120})
        self.assertEqual(long_ok.status_code, 200, long_ok.text)
        calls = len(self.agent.calls)
        for bad in ("", "   ", "長" * 121, 7, None, "a\nb", "tab\there"):
            response = self.post(client, "/studio/projects/" + pid + "/settings", {"title": bad})
            self.assertEqual((response.status_code, response.json()["error"]), (400, "studio_invalid_input"), repr(bad))
        self.assertEqual(len(self.agent.calls), calls, "an invalid title never reaches the agent")
        # The agent's own refusal (a blocked name) keeps the old title in the portal.
        refused = self.post(client, "/studio/projects/" + pid + "/settings", {"title": "BLOCKED"})
        self.assertEqual((refused.status_code, refused.json()["error"]), (400, "studio_invalid_input"))
        self.assertEqual(self.project_row(pid)["title"], "長" * 120)
        # A later fetch of the project keeps the renamed title.
        client.get(BASE + "/studio/projects/" + pid)
        self.assertEqual(self.project_row(pid)["title"], "長" * 120)

    def test_rename_is_owner_only_and_409_while_an_op_is_active(self):
        client, _ = self.customer()
        pid = self.drafted(client)
        other, _ = self.customer("intruder@example.test")
        response = self.post(other, "/studio/projects/" + pid + "/settings", {"title": "mine now"})
        self.assertEqual((response.status_code, response.json()["error"]), (404, "studio_not_found"))
        self.agent.submit_error, self.agent.submit_accepts = AgentError("timeout"), False
        self.submit(client, pid, self.quote(client, pid))
        response = self.post(client, "/studio/projects/" + pid + "/settings", {"title": "while busy"})
        self.assertEqual((response.status_code, response.json()["error"]), (409, "studio_busy"))
        self.assertEqual(self.project_row(pid)["title"], "tea")
        self.now += 121
        self.studio.sweep()

    def test_delete_hides_the_project_and_restore_brings_it_back_without_touching_credits(self):
        client, user_id = self.customer()
        pid = self.drafted(client, credits=100)
        self.settled_render(client, pid)
        before = self.money()
        deleted = self.post(client, "/studio/projects/" + pid + "/delete", {})
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json(), {"id": pid, "deleted_at": self.now, "restore_until": self.now + 30 * DAY})
        self.assertEqual(self.money(), before, "deleting refunds nothing and charges nothing")
        self.assertEqual(self.listed(client), [])
        trash = self.listed(client, "?deleted=1")
        self.assertEqual([(p["id"], p["title"], p["deleted_at"], p["restore_until"]) for p in trash],
                         [(pid, "tea", self.now, self.now + 30 * DAY)])
        # A deleted project cannot be opened, edited, quoted, submitted to or uploaded to (404, like someone else's).
        calls = len(self.agent.calls)
        quote = self.raw_quote(user_id, pid, 0)
        for response in (client.get(BASE + "/studio/projects/" + pid),
                         self.post(client, "/studio/projects/" + pid + "/settings", {"title": "x"}),
                         self.post(client, "/studio/projects/" + pid + "/shots/1/edit", {"narration": "x"}),
                         self.post(client, "/studio/projects/" + pid + "/quote", {"type": "render"}),
                         self.submit(client, pid, quote),
                         self.post(client, "/studio/uploads", {"purpose": "shot_image", "content_type": "image/png", "bytes": 10, "project_id": pid})):
            self.assertEqual((response.status_code, response.json()["error"]), (404, "studio_not_found"), response.request.url)
        with self.assertRaises(Exception) as caught:
            self.studio.reserve(user_id, pid, self.raw_quote(user_id, pid, 0, quote_id="q_direct"), "direct-key-1")
        self.assertEqual((caught.exception.code, caught.exception.status), ("studio_not_found", 404))
        self.assertEqual(len(self.agent.calls), calls, "a deleted project never reaches the agent")
        # Deleting twice is a no-op that keeps the first deletion time.
        self.now += 60
        again = self.post(client, "/studio/projects/" + pid + "/delete", {})
        self.assertEqual((again.status_code, again.json()["deleted_at"]), (200, self.now - 60))
        # Restored on day 29: back in the list and usable again; still no ledger change.
        self.now += 29 * DAY
        restored = self.post(client, "/studio/projects/" + pid + "/restore", {})
        self.assertEqual((restored.status_code, restored.json()), (200, {"id": pid, "deleted_at": None, "restore_until": None}))
        self.assertEqual(self.money(), before)
        self.assertEqual([p["id"] for p in self.listed(client)], [pid])
        self.assertEqual(self.listed(client, "?deleted=1"), [])
        self.assertEqual(client.get(BASE + "/studio/projects/" + pid).status_code, 200)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/restore", {}).status_code, 200)  # idempotent

    def test_after_30_days_a_deleted_project_is_gone(self):
        client, user_id = self.customer()
        pid = self.drafted(client, credits=100)
        keep = self.drafted(client, credits=0)
        before = self.money()
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/delete", {}).status_code, 200)
        self.assertEqual(self.post(client, "/studio/projects/" + keep + "/delete", {}).status_code, 200)
        self.now += 30 * DAY - 1
        self.assertEqual(self.post(client, "/studio/projects/" + keep + "/restore", {}).status_code, 200)
        self.now += 1
        self.assertEqual(self.listed(client, "?deleted=1"), [])
        for response in (self.post(client, "/studio/projects/" + pid + "/restore", {}),
                         self.post(client, "/studio/projects/" + pid + "/delete", {}),
                         client.get(BASE + "/studio/projects/" + pid)):
            self.assertEqual((response.status_code, response.json()["error"]), (404, "studio_not_found"))
        self.assertEqual([p["id"] for p in self.listed(client)], [keep])
        self.assertEqual(self.money(), before)

    def test_delete_and_restore_are_owner_only(self):
        client, _ = self.customer()
        pid = self.drafted(client)
        other, _ = self.customer("intruder@example.test")
        for action in ("delete", "restore"):
            response = self.post(other, "/studio/projects/" + pid + "/" + action, {})
            self.assertEqual((response.status_code, response.json()["error"]), (404, "studio_not_found"), action)
        self.assertIsNone(self.project_row(pid)["deleted_at"])
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/delete", {}).status_code, 200)
        self.assertEqual(self.listed(other, "?deleted=1"), [])
        response = self.post(other, "/studio/projects/" + pid + "/restore", {})
        self.assertEqual((response.status_code, response.json()["error"]), (404, "studio_not_found"))
        self.assertIsNotNone(self.project_row(pid)["deleted_at"])
        anonymous = self.client()
        self.assertEqual(self.post(anonymous, "/studio/projects/" + pid + "/restore", {}).status_code, 401)
        self.assertEqual(anonymous.get(BASE + "/studio/projects?deleted=1").status_code, 401)

    def test_delete_is_409_while_an_op_is_active(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.agent.submit_error, self.agent.submit_accepts = AgentError("timeout"), False
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        self.assertEqual(self.ops()[op_id]["state"], "unknown")
        before = self.money()
        response = self.post(client, "/studio/projects/" + pid + "/delete", {})
        self.assertEqual((response.status_code, response.json()["error"]), (409, "studio_busy"))
        self.assertIsNone(self.project_row(pid)["deleted_at"])
        self.assertEqual(self.money(), before)
        self.now += 121
        self.studio.sweep()  # the agent never saw it: refunded
        self.assertEqual(self.ops()[op_id]["state"], "refunded")
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/delete", {}).status_code, 200)

    def test_trash_query_is_validated_and_pages(self):
        client, user_id = self.customer()
        self.grant(user_id, 100)
        ids = []
        for _ in range(3):
            self.now += 1
            created = self.create(client)
            self.agent.finish(created.json()["op_id"])
            self.studio.sweep()
            ids.append(created.json()["id"])
            self.assertEqual(self.post(client, "/studio/projects/" + ids[-1] + "/delete", {}).status_code, 200)
        first = client.get(BASE + "/studio/projects?deleted=1&limit=2").json()
        self.assertEqual([p["id"] for p in first["items"]], ids[::-1][:2])
        second = client.get(BASE + "/studio/projects?deleted=1&limit=2&cursor=" + first["next"]).json()
        self.assertEqual(([p["id"] for p in second["items"]], second["next"]), ([ids[0]], None))
        calls = len(self.agent.calls)
        self.now += 7200  # cached thumbnails expired: the trash shows none, and never asks the agent
        self.assertTrue(all(p["thumb_url"] is None for p in self.listed(client, "?deleted=1")))
        self.assertEqual(len(self.agent.calls), calls)
        for query in ("deleted=0", "deleted=true", "deleted=", "deleted=11"):
            self.assertEqual(client.get(BASE + "/studio/projects?" + query).status_code, 400, query)


TAIPEI_MIDNIGHT = T0 + 8 * 3600  # T0 is 16:00 in Taipei (UTC+8, no daylight saving)


class StudioOwnerDecisionTests(StudioCase):
    """Free drafts with a daily cap (Q3), the trash purge, and the no-narration voice (D-V4 b)."""

    def setUp(self):
        super().setUp()
        self.studio.limits["project"] = (1000, 3600)  # this class tests the draft cap, not the hourly project limit
        self.agent.prices["draft"] = 0
        self.studio.max_active_per_user = None

    def test_drafts_are_free_and_the_daily_cap_defaults_to_30(self):
        self.assertEqual(Settings().studio_drafts_per_day, 30)
        client, user_id = self.customer()
        response = self.create(client)
        self.assertEqual(response.status_code, 201, response.text)  # no credits at all: a draft costs nothing
        self.assertEqual(self.ops()[response.json()["op_id"]]["credits"], 0)
        drafts = client.get(BASE + "/studio/credits").json()["drafts"]
        self.assertEqual(drafts, {"limit": 30, "used": 1, "remaining": 29, "resets_at": TAIPEI_MIDNIGHT})

    def test_a_30_thread_race_gets_exactly_30_drafts_and_the_cap_resets_at_taipei_midnight(self):
        client, user_id = self.customer()
        results, lock = [], threading.Lock()

        def one(i):
            key = "race-key-%04d" % i
            response = self.create(client, key=key)
            with lock:
                results.append((key, response.status_code, response.json().get("error")))
        threads = [threading.Thread(target=one, args=(i,)) for i in range(31)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(((status, error) for _, status, error in results), key=str), [(201, None)] * 30 + [(429, "studio_draft_limit")], results)
        # Which of the 31 keys loses depends on thread scheduling; take the keys from the results, never assume one.
        won = sorted(key for key, status, _ in results if status == 201)
        (lost,) = [key for key, status, _ in results if status == 429]
        self.assertEqual(len(rows(self.store, "studio_ops")), 30)
        self.assertEqual(sorted(o["idempotency_key"] for o in rows(self.store, "studio_ops")), won)
        self.assertEqual(client.get(BASE + "/studio/credits").json()["drafts"]["remaining"], 0)
        calls = len(self.agent.calls)
        late = self.create(client)
        self.assertEqual((late.status_code, late.json()["error"]), (429, "studio_draft_limit"))
        # The refused key left nothing behind: retrying it is a new create, refused again, not a replay.
        retried = self.create(client, key=lost)
        self.assertEqual((retried.status_code, retried.json()["error"]), (429, "studio_draft_limit"))
        self.assertEqual(len(self.agent.calls), calls, "the cap is checked before any agent call")
        # A replay of an accepted create is not a new draft.
        self.assertEqual(self.create(client, key=won[0]).status_code, 200)
        # A storyboard redo through the ops route counts too.
        pid = next(o["project_id"] for o in rows(self.store, "studio_ops"))
        self.agent.finish(next(o["op_id"] for o in rows(self.store, "studio_ops") if o["project_id"] == pid))
        self.studio.sweep()
        redo = self.submit(client, pid, self.quote(client, pid, "draft"))
        self.assertEqual((redo.status_code, redo.json()["error"]), (429, "studio_draft_limit"))
        self.now = TAIPEI_MIDNIGHT - 1
        self.assertEqual(self.create(client).status_code, 429)
        self.now = TAIPEI_MIDNIGHT
        self.assertEqual(self.create(client).status_code, 201)
        drafts = client.get(BASE + "/studio/credits").json()["drafts"]
        self.assertEqual((drafts["used"], drafts["remaining"], drafts["resets_at"]), (1, 29, TAIPEI_MIDNIGHT + 86400))
        other, _ = self.customer("second@example.test")  # per user
        self.assertEqual(self.create(other).status_code, 201)
        for o in rows(self.store, "studio_ops"):
            if o["state"] in ACTIVE:
                self.agent.finish(o["op_id"])
        self.studio.sweep()

    def test_the_cap_comes_from_the_environment(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {"PC_STUDIO_DRAFTS_PER_DAY": "5"}, clear=False):
            self.assertEqual(Settings.from_env().studio_drafts_per_day, 5)
        with mock.patch.dict(os.environ, {"PC_STUDIO_DRAFTS_PER_DAY": "lots"}, clear=False):
            with self.assertRaises(ValueError):
                Settings.from_env()
        client, _ = self.customer()
        self.studio.drafts_per_day = 1
        self.assertEqual(self.create(client).status_code, 201)
        self.assertEqual(self.create(client).status_code, 429)

    def test_purge_asks_the_agent_after_30_days_then_hides_the_project_for_good(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        kept = self.drafted(client, credits=0)
        before = self.money()
        for project in (pid, kept):
            self.assertEqual(self.post(client, "/studio/projects/" + project + "/delete", {}).status_code, 200)
        self.assertEqual(self.post(client, "/studio/projects/" + kept + "/restore", {}).status_code, 200)
        self.now += 30 * DAY - 1
        self.assertEqual(self.studio.purge(), 0)
        self.assertNotIn("purge_project", [c[0] for c in self.agent.calls])
        self.now += 1
        self.assertEqual(self.studio.purge(), 1)
        self.assertEqual([c for c in self.agent.calls if c[0] == "purge_project"], [("purge_project", user_id)])
        self.assertNotIn(pid, self.agent.projects)
        self.assertEqual(self.project_row(pid)["status"], "purged")
        self.assertEqual(self.studio.purge(), 0)  # done once
        self.assertIn(kept, self.agent.projects)  # a restored project is never purged
        self.assertEqual(self.money(), before)
        for response in (client.get(BASE + "/studio/projects/" + pid), self.post(client, "/studio/projects/" + pid + "/restore", {})):
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.listed(client, "?deleted=1"), [])

    def test_purge_treats_the_agents_not_found_as_done_and_retries_other_failures(self):
        client, _ = self.customer()
        gone, flaky = self.drafted(client), self.drafted(client, credits=0)
        for project in (gone, flaky):
            self.post(client, "/studio/projects/" + project + "/delete", {})
        del self.agent.projects[gone]  # already purged on the agent side (idempotent: 404)
        self.now += 30 * DAY
        self.agent.purge_errors = {flaky: AgentError("timeout")}
        self.assertEqual(self.studio.purge(), 1)
        self.assertEqual((self.project_row(gone)["status"], self.project_row(flaky)["status"] == "purged"), ("purged", False))
        self.agent.purge_errors = {}
        self.assertEqual(self.studio.purge(), 1)
        self.assertEqual(self.project_row(flaky)["status"], "purged")

    def test_the_sweeper_purges_at_most_hourly(self):
        client, _ = self.customer()
        pid = self.drafted(client)
        self.post(client, "/studio/projects/" + pid + "/delete", {})
        self.now += 30 * DAY
        self.studio.sweep()
        self.assertEqual(self.project_row(pid)["status"], "purged")
        second = self.drafted(client, credits=0)
        self.post(client, "/studio/projects/" + second + "/delete", {})
        self.now += 30 * DAY
        self.studio.last_purge = self.now - 10
        self.studio.sweep()
        self.assertNotEqual(self.project_row(second)["status"], "purged")  # the last pass was 10 s ago
        self.now += 3600
        self.studio.sweep()
        self.assertEqual(self.project_row(second)["status"], "purged")

    def test_no_narration_voice_is_the_default_and_renders_for_customers(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.assertEqual(client.get(BASE + "/studio/projects/" + pid).json()["settings"]["voice"], "none")
        voice = client.get(BASE + "/studio/templates").json()["items"][0]["project_schema"]["properties"]["voice"]
        self.assertEqual((voice["enum"][0], voice["default"]), ("none", "none"))
        self.assertNotIn("none", voice["x-internal-values"])
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/quote", {"type": "render"}).status_code, 200)
        # Back to none after an internal voice: allowed again.
        self.agent.projects[pid]["settings"]["voice"] = "tw_ref"
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/quote", {"type": "render"}).status_code, 409)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/settings", {"voice": "none"}).status_code, 200)
        self.assertEqual(self.post(client, "/studio/projects/" + pid + "/quote", {"type": "render"}).status_code, 200)

    def test_purge_is_retried_while_the_owner_has_any_active_op(self):
        client, user_id = self.customer()
        gone = self.drafted(client)
        self.post(client, "/studio/projects/" + gone + "/delete", {})
        self.now += 30 * DAY
        other = self.create(client)  # an active op on ANOTHER project of the same owner
        self.assertEqual(other.status_code, 201, other.text)
        self.assertEqual(self.studio.purge(), 0)
        self.assertEqual(self.agent.calls[-1][0], "purge_project")
        self.assertNotEqual(self.project_row(gone)["status"], "purged")
        self.assertIn(gone, self.agent.projects)
        self.agent.finish(other.json()["op_id"])
        self.studio.last_purge = self.now  # settle the op only; the next purge pass is the explicit one below
        self.studio.sweep()
        self.assertEqual(self.studio.purge(), 1)
        self.assertEqual(self.project_row(gone)["status"], "purged")

    def test_the_fake_agent_matches_the_real_voice_labels_and_free_draft(self):
        client, user_id = self.customer()
        voice = client.get(BASE + "/studio/templates").json()["items"][0]["project_schema"]["properties"]["voice"]
        self.assertEqual(voice["x-enum-labels"]["none"], {"zh": "無配音（只有字幕）", "en": "No voiceover (subtitles only)"})
        response = self.create(client)
        self.assertNotIn("voice", self.agent.created[-1])  # the portal never sends a voice; the agent defaults it
        self.assertEqual(self.ops()[response.json()["op_id"]]["credits"], 0)

    def test_an_expired_project_is_flagged_in_the_list(self):
        client, user_id = self.customer()
        pid = self.drafted(client)
        self.assertFalse(self.listed(client)[0]["expired"])
        self.agent.projects[pid]["expired"] = True  # retention deleted its media after 30 idle days
        self.assertTrue(client.get(BASE + "/studio/projects/" + pid).json()["expired"])
        self.assertEqual(self.project_row(pid)["expired"], 1)
        self.assertTrue(self.listed(client)[0]["expired"])
        self.agent.projects[pid]["expired"] = False  # re-rendered: whole again
        client.get(BASE + "/studio/projects/" + pid)
        self.assertFalse(self.listed(client)[0]["expired"])

    # helpers shared with the lifecycle tests
    money = StudioProjectLifecycleTests.money
    project_row = StudioProjectLifecycleTests.project_row
    listed = StudioProjectLifecycleTests.listed


class StudioAdminTests(StudioCase):
    def test_grant_is_admin_only_and_audited(self):
        customer, user_id = self.customer()
        anonymous = self.client()
        body = {"user_id": user_id, "credits": 100}
        self.assertEqual((self.post(customer, "/admin/studio/credits/grant", body).status_code), 403)
        self.assertEqual((self.post(anonymous, "/admin/studio/credits/grant", body).status_code), 401)
        self.assertEqual(customer.get(BASE + "/admin/studio/usage").status_code, 403)
        self.assertEqual(anonymous.get(BASE + "/admin/studio/usage").status_code, 401)
        account = self.grant(user_id, 100, note="top-up", plan="agency", period_end=T0 + 86400)
        self.assertEqual((account["balance"], account["plan"], account["period_end"]), (100, "agency", T0 + 86400))
        audit = self.audit("admin.studio_credits_grant")
        self.assertEqual(len(audit), 1)
        self.assertEqual(json.loads(audit[0]["details"])["balance"], [0, 100])
        self.assertEqual(audit[0]["target_id"], user_id)
        account = self.grant(user_id, -40, note="month end")
        self.assertEqual((account["balance"], account["plan"]), (60, "agency"))
        self.assertEqual(len(self.audit("admin.studio_credits_expire")), 1)
        too_much = self.post(self.admin_client(), "/admin/studio/credits/grant", {"user_id": user_id, "credits": -61})
        self.assertEqual((too_much.status_code, too_much.json()["error"]), (409, "studio_insufficient_credits"))
        for bad in ({"user_id": user_id, "credits": 0}, {"user_id": user_id, "credits": 1.5}, {"user_id": user_id, "credits": True},
                    {"user_id": user_id, "credits": 2_000_000}, {"user_id": user_id, "credits": 5, "plan": "gold"},
                    {"user_id": user_id, "credits": 5, "period_end": 2 ** 31},
                    {"user_id": "a|b", "credits": 5}, {"user_id": user_id, "credits": 5, "note": "x" * 201}):
            self.assertEqual(self.post(self.admin_client(), "/admin/studio/credits/grant", bad).status_code, 400, bad)
        missing = self.post(self.admin_client(), "/admin/studio/credits/grant", {"user_id": "f" * 32, "credits": 5})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(len(self.audit("admin.studio_credits_grant")), 1)
        self.assertEqual(sum(r["delta"] for r in rows(self.store, "studio_ledger")), 60)

    def test_grant_works_before_the_agent_is_connected(self):
        self.agent.configured = False
        _, user_id = self.customer()
        self.assertEqual(self.grant(user_id, 10)["balance"], 10)

    def test_usage_joins_portal_ledger_and_agent_costs(self):
        client, user_id = self.customer()
        pid = self.drafted(client, credits=30)
        op_id = self.submit(client, pid, self.quote(client, pid)).json()["op_id"]
        self.agent.finish(op_id, "failed", produced_credits=4)
        self.studio.sweep()
        admin = self.admin_client()
        usage = admin.get(BASE + "/admin/studio/usage?month=2027-01").json()
        self.assertEqual((usage["month"], usage["agent_status"], usage["gpu_usd_per_hour"]), ("2027-01", "ok", 2.08))
        row = next(u for u in usage["users"] if u["user_id"] == user_id)
        self.assertEqual((row["email"], row["ops"], row["credits_granted"], row["credits_charged"], row["credits_refunded"]),
                         ("maker@example.test", 2, 30, 6, 6))
        self.assertEqual((row["agent_ops"], row["credits_quoted"], row["credits_produced"]), (2, 12, 6))
        self.assertEqual(admin.get(BASE + "/admin/studio/usage?month=2027-02").json()["users"][0]["ops"], 0)
        self.assertEqual(admin.get(BASE + "/admin/studio/usage?month=2027-13").status_code, 400)
        self.agent.fail = AgentError("unavailable")
        degraded = admin.get(BASE + "/admin/studio/usage?month=2027-01").json()
        self.assertEqual(degraded["agent_status"], "unavailable")
        self.assertEqual(next(u for u in degraded["users"] if u["user_id"] == user_id)["credits_charged"], 6)
        self.agent.fail = None


class StudioSweeperLifespanTests(StudioCase):
    sweeper = True

    def test_lifespan_sweeper_settles_ops(self):
        self.studio.clock = time.time
        self.agent.clock = time.time
        with TestClient(self.app, base_url=ORIGIN) as client:
            self.register(client, "sweep@example.test")
            user_id = self.user_of(client)
            self.grant(user_id, 10)
            op_id = self.create(client).json()["op_id"]
            self.agent.finish(op_id)
            deadline = time.time() + 5
            while time.time() < deadline and self.ops()[op_id]["state"] != "settled":
                time.sleep(0.05)
            self.assertEqual(self.ops()[op_id]["state"], "settled")


class StudioSigningTests(unittest.TestCase):
    def test_frozen_vectors_from_the_agent_signing_module(self):
        # Computed on 2026-10-22 with shortvideo-agent shortvideo/studio/signing.py, so CI checks agent
        # compatibility without the agent checkout.
        self.assertEqual(sign_grant("grant-secret", "o1", "u1", "p1", "regenerate", "3", "q_1", 10, 4, "merchant", 1800000060),
                         "4584d6dc2cca18a41c1bcacd143af9bf128b7fce4c3ec2f26c8e8f11de5da6ad")
        self.assertEqual(sign_quote("quote-secret", "q_1", "u1", "p1", "draft", None, 2, 0, 1800000600),
                         "4fde3bde5f85f5c04b3d11e9d6372a5be916812cc37d677418f6deeb8c770a08")
        self.assertEqual(sign_quote("quote-secret", "q_2", "u1", "p1", "export", "9:16", 0, 7, 1800000600),
                         "5ed42485cb9f59a7eeb79fa6d2f8c84c45fce0e996e757f88a185b9127b2d2db")

    def test_messages_match_the_documented_format(self):
        grant = sign_grant("s", "o1", "u1", "p1", "regenerate", "3", "q1", 10, 4, "creator", 99)
        self.assertEqual(grant, __import__("hmac").new(b"s", b"grant.v1|o1|u1|p1|regenerate|3|q1|10|4|creator|99", "sha256").hexdigest())
        quote = sign_quote("s", "q1", "u1", "p1", "draft", None, 2, 0, 99)
        self.assertEqual(quote, __import__("hmac").new(b"s", b"quote.v1|q1|u1|p1|draft||2|0|99", "sha256").hexdigest())
        with self.assertRaises(ValueError):
            sign_quote("s", "q|1", "u1", "p1", "draft", None, 2, 0, 99)

    @unittest.skipUnless(AGENT_SIGNING.exists(), "shortvideo-agent checkout not next to the marketplace repo")
    def test_signatures_match_the_agent_implementation(self):
        spec = importlib.util.spec_from_file_location("agent_signing", AGENT_SIGNING)
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        values = dict(op_id="o1", owner="u1", project_id="p1", type="add_aspect", target="16:9", quote_id="q_1", credits=7,
                      storyboard_rev=3, plan="merchant", exp=1800000060)
        self.assertEqual(sign_grant("g", *values.values()), agent.sign_grant("g", **values))
        quote = {k: values[k] for k in ("quote_id", "owner", "project_id", "type", "target", "credits", "storyboard_rev", "exp")}
        self.assertEqual(sign_quote("q", *quote.values()), agent.sign_quote("q", **quote))
        self.assertEqual(sign_quote("q", "q_1", "u1", "p1", "draft", None, 2, 0, 5), agent.sign_quote("q", quote_id="q_1", owner="u1", project_id="p1",
                                                                                                      type="draft", target=None, credits=2, storyboard_rev=0, exp=5))


class StudioAgentClientTests(unittest.TestCase):
    def agent(self, handler, **overrides):
        return StudioAgent(Settings(**dict(studio_settings(), **overrides)), transport=httpx.MockTransport(handler))

    def test_headers_paths_and_bodies(self):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(202, json={"op_id": "o1", "state": "queued"})
        result = self.agent(handler).submit_op("user1", "p1", {"op_id": "o1"})
        self.assertEqual(result["state"], "queued")
        request = seen[0]
        self.assertEqual(str(request.url), "http://shortvideo-api:8081/internal/v1/projects/p1/ops")
        self.assertEqual(request.headers["authorization"], "Bearer " + STUDIO_TOKEN)
        self.assertEqual(request.headers["x-studio-owner"], "user1")
        self.assertEqual(json.loads(request.content), {"op_id": "o1"})
        self.agent(handler).usage("2027-01")
        self.assertNotIn("x-studio-owner", seen[1].headers)
        self.assertEqual(str(seen[1].url), "http://shortvideo-api:8081/internal/v1/usage?month=2027-01")
        self.agent(handler).purge_project("user1", "p1")
        self.assertEqual((seen[2].method, str(seen[2].url)), ("POST", "http://shortvideo-api:8081/internal/v1/projects/p1/purge"))
        self.assertEqual(seen[2].headers["x-studio-owner"], "user1")

    def test_error_mapping(self):
        cases = ((lambda r: httpx.Response(409, json={"error": {"code": "studio_stale_quote", "message": "m"}}), ("rejected", 409, "studio_stale_quote")),
                 (lambda r: httpx.Response(404, text="nope"), ("rejected", 404, None)),
                 (lambda r: httpx.Response(400, json={"error": {"code": "Bad Code!", "message": "m"}}), ("rejected", 400, None)),
                 (lambda r: httpx.Response(500, json={"error": {"code": "x"}}), ("unavailable", 500, None)),
                 (lambda r: httpx.Response(302, headers={"Location": "http://elsewhere"}), ("unavailable", 302, None)),
                 (lambda r: httpx.Response(200, text="<html>"), ("invalid_response", 200, None)),
                 (lambda r: httpx.Response(200, json=[1, 2]), ("invalid_response", 200, None)),
                 (lambda r: httpx.Response(200, content=b"{" + b" " * (4 * 1024 * 1024 + 1) + b"}"), ("invalid_response", 200, None)))
        for handler, expected in cases:
            with self.assertRaises(AgentError) as caught:
                self.agent(handler).get_project("user1", "p1")
            self.assertEqual((caught.exception.kind, caught.exception.status, caught.exception.code), expected)

        def timeout(request):
            raise httpx.ReadTimeout("slow", request=request)

        def refused(request):
            raise httpx.ConnectError("refused", request=request)
        for handler, kind in ((timeout, "timeout"), (refused, "unavailable")):
            with self.assertRaises(AgentError) as caught:
                self.agent(handler).get_op("user1", "p1", "o1")
            self.assertEqual(caught.exception.kind, kind)

    def test_ids_are_checked_before_any_request(self):
        seen = []
        agent = self.agent(lambda r: seen.append(r) or httpx.Response(200, json={}))
        for call in (lambda: agent.get_project("user1", "../x"), lambda: agent.get_op("user1", "p1", "a/b"),
                     lambda: agent.edit_shot("user1", "p1", -1, {}), lambda: agent.get_project("bad owner", "p1")):
            with self.assertRaises(AgentError):
                call()
        self.assertEqual(seen, [])

    def test_unconfigured(self):
        agent = self.agent(lambda r: httpx.Response(200, json={}), studio_quote_secret="")
        self.assertFalse(agent.configured)
        with self.assertRaises(AgentError) as caught:
            agent.templates("user1")
        self.assertEqual(caught.exception.kind, "unconfigured")


if __name__ == "__main__":
    unittest.main()
