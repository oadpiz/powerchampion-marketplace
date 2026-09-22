"""Agent storage boundaries: ownership, versioning, tokens and resolution.

Temporary SQLite, no gateway call, no customer key. An agent here is a stored
prompt configuration; nothing in these tests contacts a model.
"""

import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import create_app
from server.settings import Settings


ORIGIN = "http://localhost:3010"
PASSWORD = "portal-test-password-123!"
BASE = "/api/portal"
CONFIGURATION = {
    "model": "glm-5.2-fp8",
    "purpose": "Draft support replies from approved answers.",
    "instructions": "You help a support team draft replies. Use only the reference material.",
    "tone": "Direct and warm",
    "knowledge": "Refunds are handled by the billing team.",
    "samplePrompt": "A customer asks about a duplicate charge.",
    "maxOutputTokens": 512,
}


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = str(Path(self.directory.name) / "portal.sqlite")
        self.app = create_app(Settings(db_path=self.database, allowed_origins=(ORIGIN,)))
        self.client = self.new_client()
        self.clients = [self.client]
        self.register()

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.directory.cleanup()

    def new_client(self):
        return TestClient(self.app, base_url=ORIGIN)

    def post(self, path, data=None, client=None):
        return (client or self.client).post(path, json=data or {}, headers={"Origin": ORIGIN})

    def register(self, email="alice@example.test", client=None):
        response = self.post(BASE + "/auth/register", {
            "email": email, "name": "Test Customer", "password": PASSWORD,
        }, client=client)
        self.assertIn(response.status_code, (200, 201), response.text)

    def second_customer(self):
        client = self.new_client()
        self.clients.append(client)
        self.register("bob@example.test", client=client)
        return client

    def create(self, name="Support drafter", client=None, **overrides):
        response = self.post(BASE + "/agents", {"name": name, **CONFIGURATION, **overrides}, client=client)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def db_rows(self, table):
        with sqlite3.connect(self.database) as database:
            database.row_factory = sqlite3.Row
            return [dict(row) for row in database.execute("SELECT * FROM " + table)]

    def test_created_agent_returns_its_token_once_and_stores_only_a_hash(self):
        created = self.create()
        token = created["token"]
        self.assertTrue(token.startswith("pca_"))
        stored = self.db_rows("agents")[0]
        self.assertNotIn(token, str(stored))
        self.assertEqual(stored["token_prefix"], token[:12])
        self.assertEqual(stored["current_version"], 1)
        listed = self.client.get(BASE + "/agents").json()["agents"]
        self.assertEqual([agent["id"] for agent in listed], [created["agent"]["id"]])
        self.assertNotIn(token, str(listed))
        self.assertTrue(all("token" not in agent for agent in listed))
        self.assertEqual(listed[0]["tokenPrefix"], token[:12])
        again = self.client.get(BASE + "/agents/" + created["agent"]["id"]).json()["agent"]
        self.assertEqual(again["configuration"]["instructions"], CONFIGURATION["instructions"])
        self.assertNotIn("token\"", again.get("tokenPrefix", ""))

    def test_saving_again_adds_a_version_and_keeps_the_previous_one(self):
        created = self.create()
        agent_id = created["agent"]["id"]
        updated = self.post(BASE + "/agents/" + agent_id + "/versions", {
            "name": "Support drafter", **CONFIGURATION, "instructions": "Second revision of the instructions.",
        })
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["agent"]["version"], 2)
        versions = [row["version"] for row in self.db_rows("agent_versions")]
        self.assertEqual(sorted(versions), [1, 2])
        current = self.client.get(BASE + "/agents/" + agent_id).json()["agent"]
        self.assertEqual(current["configuration"]["instructions"], "Second revision of the instructions.")

    def test_one_customer_cannot_read_write_or_delete_another_customers_agent(self):
        created = self.create()
        agent_id = created["agent"]["id"]
        other = self.second_customer()
        self.assertEqual(other.get(BASE + "/agents/" + agent_id).status_code, 404)
        self.assertEqual(self.post(BASE + "/agents/" + agent_id + "/versions", {"name": "x", **CONFIGURATION}, client=other).status_code, 404)
        self.assertEqual(self.post(BASE + "/agents/" + agent_id + "/token", client=other).status_code, 404)
        self.assertEqual(other.request("DELETE", BASE + "/agents/" + agent_id, headers={"Origin": ORIGIN}).status_code, 404)
        self.assertEqual(other.get(BASE + "/agents").json()["agents"], [])

    def test_rejects_unsupported_models_oversized_fields_and_missing_instructions(self):
        for invalid in (
            {"model": "gpt-4"},
            {"model": "glm-5.3-flash-uncensored"},
            {"instructions": ""},
            {"instructions": "x" * 16001},
            {"knowledge": "x" * 16001},
            {"maxOutputTokens": 0},
            {"maxOutputTokens": 4097},
            {"maxOutputTokens": True},
            {"purpose": ""},
        ):
            response = self.post(BASE + "/agents", {"name": "Edge case", **CONFIGURATION, **invalid})
            self.assertEqual(response.status_code, 400, str(invalid) + " " + response.text)
        self.assertEqual(self.post(BASE + "/agents", {"name": "", **CONFIGURATION}).status_code, 400)
        self.assertEqual(self.db_rows("agents"), [])

    def test_resolve_turns_a_token_into_one_system_prompt_without_customer_identity(self):
        created = self.create()
        resolved = self.post(BASE + "/agents/resolve", {"token": created["token"]})
        self.assertEqual(resolved.status_code, 200, resolved.text)
        agent = resolved.json()["agent"]
        self.assertEqual(agent["id"], created["agent"]["id"])
        self.assertEqual(agent["version"], 1)
        self.assertEqual(agent["model"], CONFIGURATION["model"])
        self.assertEqual(agent["maxOutputTokens"], CONFIGURATION["maxOutputTokens"])
        self.assertIn(CONFIGURATION["instructions"], agent["system"])
        self.assertIn(CONFIGURATION["tone"], agent["system"])
        self.assertIn(CONFIGURATION["knowledge"], agent["system"])
        self.assertNotIn("alice@example.test", str(agent))
        self.assertNotIn("user_id", str(agent))

    def test_resolve_follows_the_current_version_and_fails_closed_on_bad_tokens(self):
        created = self.create()
        self.post(BASE + "/agents/" + created["agent"]["id"] + "/versions", {
            "name": "Support drafter", **CONFIGURATION, "instructions": "Revised instructions for version two.",
        })
        agent = self.post(BASE + "/agents/resolve", {"token": created["token"]}).json()["agent"]
        self.assertEqual(agent["version"], 2)
        self.assertIn("Revised instructions", agent["system"])
        for invalid in (None, "", "pca_" + "x" * 40, "not-a-token", created["token"][:-1], "pca_" + "x" * 300):
            self.assertEqual(self.post(BASE + "/agents/resolve", {"token": invalid}).status_code, 404, str(invalid))

    def test_the_reviewed_prompt_is_served_verbatim(self):
        reviewed = "Agent: Support drafter\n\nInstructions:\nOnly the reviewed text runs."
        created = self.create(systemPrompt=reviewed)
        agent = self.post(BASE + "/agents/resolve", {"token": created["token"]}).json()["agent"]
        self.assertEqual(agent["system"], reviewed)
        stored = self.client.get(BASE + "/agents/" + created["agent"]["id"]).json()["agent"]
        self.assertEqual(stored["configuration"]["systemPrompt"], reviewed)
        self.assertEqual(stored["configuration"]["instructions"], CONFIGURATION["instructions"])
        self.assertEqual(self.post(BASE + "/agents", {"name": "Too long", **CONFIGURATION, "systemPrompt": "x" * 40001}).status_code, 400)

    def test_omitted_or_blank_reviewed_prompt_uses_the_configuration(self):
        for override in ({}, {"systemPrompt": ""}, {"systemPrompt": " \n\t "}):
            with self.subTest(override=override):
                created = self.create(**override)
                resolved = self.post(BASE + "/agents/resolve", {"token": created["token"]})
                self.assertEqual(resolved.status_code, 200, resolved.text)
                system = resolved.json()["agent"]["system"]
                self.assertIn("Purpose:\n" + CONFIGURATION["purpose"], system)
                self.assertIn("Instructions:\n" + CONFIGURATION["instructions"], system)
                self.assertIn("Response style:\n" + CONFIGURATION["tone"], system)
                self.assertIn("<reference>\n" + CONFIGURATION["knowledge"], system)
                self.assertIn("Do not claim to browse", system)

    def test_invalid_reviewed_prompt_does_not_fall_back_to_the_configuration(self):
        for invalid in (None, False, 123, [], {}, "invalid\x00instructions", "x" * 40001):
            with self.subTest(value_type=type(invalid).__name__):
                response = self.post(BASE + "/agents", {
                    "name": "Invalid prompt", **CONFIGURATION, "systemPrompt": invalid,
                })
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(response.json()["error"], "invalid_input")
        self.assertEqual(self.db_rows("agents"), [])

    def test_rotating_a_token_invalidates_the_previous_one(self):
        created = self.create()
        rotated = self.post(BASE + "/agents/" + created["agent"]["id"] + "/token")
        self.assertEqual(rotated.status_code, 200, rotated.text)
        token = rotated.json()["token"]
        self.assertNotEqual(token, created["token"])
        self.assertEqual(self.post(BASE + "/agents/resolve", {"token": created["token"]}).status_code, 404)
        self.assertEqual(self.post(BASE + "/agents/resolve", {"token": token}).status_code, 200)

    def test_deleting_an_agent_stops_its_endpoint_and_keeps_the_audit_trail(self):
        created = self.create()
        agent_id = created["agent"]["id"]
        deleted = self.client.request("DELETE", BASE + "/agents/" + agent_id, headers={"Origin": ORIGIN})
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(self.post(BASE + "/agents/resolve", {"token": created["token"]}).status_code, 404)
        self.assertEqual(self.client.get(BASE + "/agents").json()["agents"], [])
        self.assertEqual(self.client.get(BASE + "/agents/" + agent_id).status_code, 404)
        self.assertEqual(self.db_rows("agents")[0]["status"], "archived")
        self.assertIsNone(self.db_rows("agents")[0]["token_hash"])
        actions = [row["action"] for row in self.db_rows("audit_events")]
        self.assertIn("agent.created", actions)
        self.assertIn("agent.archived", actions)

    def test_agent_count_is_capped_and_signed_out_callers_are_refused(self):
        for index in range(20):
            self.create(name="Agent %d" % index)
        capped = self.post(BASE + "/agents", {"name": "One too many", **CONFIGURATION})
        self.assertEqual(capped.status_code, 400, capped.text)
        anonymous = self.new_client()
        self.clients.append(anonymous)
        self.assertEqual(anonymous.get(BASE + "/agents").status_code, 401)
        self.assertEqual(self.post(BASE + "/agents", {"name": "No session", **CONFIGURATION}, client=anonymous).status_code, 401)

    def test_mutations_require_the_site_origin(self):
        created = self.create()
        foreign = self.client.post(BASE + "/agents", json={"name": "Cross site", **CONFIGURATION},
                                   headers={"Origin": "https://evil.example"})
        self.assertEqual(foreign.status_code, 403)
        resolve = self.client.post(BASE + "/agents/resolve", json={"token": created["token"]},
                                   headers={"Origin": "https://evil.example"})
        self.assertEqual(resolve.status_code, 403)


if __name__ == "__main__":
    unittest.main()
