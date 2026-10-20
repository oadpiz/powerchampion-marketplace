"""機台分配 (node allocation) admin API and engineers.yaml export."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, rsa

from server.allocation import AllocationError, parse_public_key, validate_username
from server.test_accounts import BASE, _PortalCase
from server.testsupport import rows

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "engineers.cluster-20261020.yaml"
RENDER = Path(os.environ.get("B300_CLUSTER_RENDER", str(Path.home() / "github/b300-cluster/access/render.py")))
SEED = {
    "justin": ["b300-11", "b300-12", "b300-13"],
    "mwind": ["b300-15", "b300-16", "b300-22"],
    "zhuling": ["b300-23", "b300-24", "b300-25"],
    "nati": ["b300-26", "b300-27", "b300-28"],
    "ll": ["b300-29", "b300-30"],
}


def openssh(key, comment="laptop"):
    line = key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()
    return line + (" " + comment if comment else "")


def ed_key(comment="laptop"):
    return openssh(ed25519.Ed25519PrivateKey.generate(), comment)


def shape(value):
    """Structure of a parsed YAML document: dict keys, list element shape, scalar types."""
    if isinstance(value, dict):
        return {k: shape(v) for k, v in value.items()}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return type(value).__name__


class _AllocationCase(_PortalCase):
    def setUp(self):
        super().setUp()
        self.admin_client = self.admin()

    def state(self):
        r = self.admin_client.get(BASE + "/admin/allocation")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def engineer(self, username):
        return next(e for e in self.state()["engineers"] if e["username"] == username)

    def node(self, name):
        return next(n for n in self.state()["nodes"] if n["name"] == name)

    def assign(self, name, data):
        return self.post(self.admin_client, "/admin/allocation/nodes/" + name, data)

    def set_key(self, username, key):
        r = self.post(self.admin_client, "/admin/allocation/engineers/" + self.engineer(username)["id"], {"sshPubkey": key})
        self.assertEqual(r.status_code, 200, r.text)
        return r

    def revision(self):
        return rows(self.store, "alloc_meta")[0]["revision"]

    def export(self):
        r = self.admin_client.get(BASE + "/admin/allocation/export")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()


class SeedAndStateTests(_AllocationCase):
    def test_seed_matches_the_2026_10_20_assignment(self):
        state = self.state()
        self.assertEqual(len(state["nodes"]), 16)
        self.assertEqual([n["name"] for n in state["nodes"]],
                         ["b300-%d" % n for n in (11, 12, 13, 14, 15, 16, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31)])
        for node in state["nodes"]:
            self.assertEqual(node["ip"], "172.16.10." + node["name"].split("-")[1])
        self.assertEqual([n["name"] for n in state["nodes"] if n["role"] == "selling"], ["b300-14", "b300-31"])
        self.assertEqual([n["name"] for n in state["nodes"] if n["role"] == "reserved"], [])
        owned = {e["username"]: e["nodes"] for e in state["engineers"]}
        self.assertEqual(owned, SEED)
        self.assertEqual({e["username"]: e["email"] for e in state["engineers"]},
                         {u: u + "@oadpiz.com" for u in SEED})
        self.assertTrue(all(e["sshPubkey"] is None and e["active"] for e in state["engineers"]))
        self.assertEqual((state["summary"]["selling"], state["summary"]["engineer"], state["summary"]["reserved"]), (2, 14, 0))
        self.assertEqual({p["username"]: p["nodes"] for p in state["summary"]["perEngineer"]}, {u: len(n) for u, n in SEED.items()})
        self.assertEqual(state["revision"], 1)
        self.assertEqual([e["clusterId"] for e in state["engineers"]], ["eng1", "eng2", "eng3", "eng4", "eng5"])
        self.assertEqual([e["username"] for e in state["engineers"]], list(SEED))
        self.assertEqual(state["ownerEmail"], "zhuling@oadpiz.com")

    def test_non_admin_and_anonymous_are_refused(self):
        customer = self.client()
        self.register(customer, "c@example.test")
        engineer_id = self.engineer("justin")["id"]
        for client, status in ((customer, 403), (self.client(), 401)):
            self.assertEqual(client.get(BASE + "/admin/allocation").status_code, status)
            self.assertEqual(client.get(BASE + "/admin/allocation/export").status_code, status)
            for path, body in (("/admin/allocation/nodes/b300-11", {"role": "reserved"}),
                               ("/admin/allocation/engineers", {"username": "x1", "email": "x1@oadpiz.com"}),
                               ("/admin/allocation/engineers/" + engineer_id, {"displayName": "J"}),
                               ("/admin/allocation/engineers/" + engineer_id + "/status", {"active": False}),
                               ("/admin/allocation/owner", {"ownerEmail": "o@oadpiz.com"})):
                r = self.post(client, path, body)
                self.assertEqual(r.status_code, status, path)
        self.assertEqual(self.revision(), 1)
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("alloc.")], [])


class ValidationTests(_AllocationCase):
    def create(self, **data):
        body = {"username": "eve", "email": "eve@oadpiz.com", **data}
        return self.post(self.admin_client, "/admin/allocation/engineers", body)

    def test_username_rules_mirror_render_py(self):
        for bad in ("Eve", "1eve", "e" * 33, "eve.x", "", "root", "tku", "bastion99", "ubuntu", "admin", "b300eng", "www-data", None, 7):
            r = self.create(username=bad)
            self.assertEqual(r.status_code, 400, bad)
            self.assertEqual(r.json()["error"], "invalid_input")
        self.assertEqual(validate_username("ll"), "ll", "the seeded 2-character username")
        for good in ("zz", "_x", "eve-2", "a" * 32):
            self.assertEqual(self.create(username=good, email=f"{good}@oadpiz.com").status_code, 201, good)

    def test_email_is_lowercased_unique_and_not_a_placeholder(self):
        r = self.create(email="Eve@OADPIZ.com")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.engineer("eve")["email"], "eve@oadpiz.com")
        self.assertEqual(self.create(username="eve2", email="EVE@oadpiz.com").status_code, 409)
        self.assertEqual(self.create(username="eve").status_code, 409, "duplicate username")
        self.assertEqual(self.create(username="eve3", email="CHANGE_ME@your-mail-domain").status_code, 400)
        self.assertEqual(self.create(username="eve4", email="not-an-email").status_code, 400)

    def test_public_key_rules(self):
        accepted = [ed_key(), ed_key(None), openssh(ec.generate_private_key(ec.SECP256R1())),
                    openssh(ec.generate_private_key(ec.SECP384R1())), openssh(ec.generate_private_key(ec.SECP521R1())),
                    openssh(rsa.generate_private_key(public_exponent=65537, key_size=3072))]
        for line in accepted:
            parsed = parse_public_key(line + "\n")
            self.assertTrue(parsed["fingerprint"].startswith("SHA256:"))
            self.assertEqual(len(parsed["fingerprint"]), len("SHA256:") + 43)
        good = ed_key()
        rsa2048 = openssh(rsa.generate_private_key(public_exponent=65537, key_size=2048))
        mismatched = "ecdsa-sha2-nistp256 " + good.split(" ")[1]
        rejected = [
            "", "ssh-ed25519", "ssh-ed25519 AAAA... CHANGE_ME", rsa2048, mismatched,
            'from="10.0.0.1" ' + good, "command=\"x\" " + good, good + "\n" + ed_key(),
            "ssh-dss AAAAB3NzaC1kc3MAAACBAP", "ssh-ed25519 " + good.split(" ")[1][:-4] + "@@@@",
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA==", "-----BEGIN OPENSSH PRIVATE KEY-----",
        ]
        for line in rejected:
            with self.assertRaises(AllocationError, msg=line):
                parse_public_key(line)
        with self.assertRaisesRegex(AllocationError, "3072"):
            parse_public_key(rsa2048)
        with self.assertRaisesRegex(AllocationError, "options"):
            parse_public_key('no-pty ' + good)
        r = self.create(sshPubkey=rsa2048)
        self.assertEqual(r.status_code, 400)
        self.assertIn("3072", r.json()["detail"])

    def test_key_is_saved_with_fingerprint_and_cannot_be_reused_or_cleared(self):
        key = ed_key("justin@laptop")
        self.set_key("justin", "  " + key + "\n")
        justin = self.engineer("justin")
        self.assertEqual(justin["sshPubkey"], key)
        self.assertEqual(justin["keyFingerprint"], parse_public_key(key)["fingerprint"])
        self.assertEqual(justin["keyType"], "ssh-ed25519")
        other = self.engineer("mwind")["id"]
        r = self.post(self.admin_client, "/admin/allocation/engineers/" + other, {"sshPubkey": key.split(" comment")[0].rsplit(" ", 1)[0] + " other"})
        self.assertEqual(r.status_code, 409, "same key material under another comment")
        r = self.post(self.admin_client, "/admin/allocation/engineers/" + justin["id"], {"sshPubkey": ""})
        self.assertEqual(r.status_code, 400)
        r = self.post(self.admin_client, "/admin/allocation/engineers/" + justin["id"], {"username": "justin2"})
        self.assertEqual(r.status_code, 400, "usernames are immutable")

    def test_engineer_node_needs_an_active_engineer(self):
        r = self.assign("b300-29", {"role": "engineer"})
        self.assertEqual(r.status_code, 400)
        r = self.assign("b300-29", {"role": "engineer", "engineerId": "f" * 32})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"], "engineer_not_found")
        r = self.assign("b300-29", {"role": "reserved", "engineerId": self.engineer("justin")["id"]})
        self.assertEqual(r.status_code, 400, "a reserved node has no engineer")
        r = self.assign("b300-29", {"role": "spare"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.assign("b300-99", {"role": "reserved"}).status_code, 404)
        self.assertEqual(self.assign("b300-29", {"role": "reserved", "note": "x" * 201}).status_code, 400)
        # deactivate eve (no nodes) then try to give her a node
        eve = self.create().json()["engineerId"]
        self.assertEqual(self.post(self.admin_client, f"/admin/allocation/engineers/{eve}/status", {"active": False}).status_code, 200)
        r = self.assign("b300-29", {"role": "engineer", "engineerId": eve})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"], "engineer_inactive")
        self.assertEqual(self.node("b300-29")["engineer"]["username"], "ll")

    def test_cannot_deactivate_an_engineer_with_nodes(self):
        ll = self.engineer("ll")["id"]
        r = self.post(self.admin_client, f"/admin/allocation/engineers/{ll}/status", {"active": False})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"], "engineer_has_nodes")
        self.assertIn("b300-29, b300-30", r.json()["detail"])
        for node in ("b300-29", "b300-30"):
            self.assertEqual(self.assign(node, {"role": "reserved"}).status_code, 200)
        r = self.post(self.admin_client, f"/admin/allocation/engineers/{ll}/status", {"active": False})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(self.engineer("ll")["active"])
        self.assertEqual(self.post(self.admin_client, f"/admin/allocation/engineers/{ll}/status", {"active": "no"}).status_code, 400)


class SellingGuardTests(_AllocationCase):
    def test_leaving_selling_needs_explicit_confirmation(self):
        before = self.revision()
        for body in ({"role": "reserved"}, {"role": "reserved", "confirm_selling_change": False},
                     {"role": "engineer", "engineerId": self.engineer("justin")["id"]}):
            r = self.assign("b300-14", body)
            self.assertEqual(r.status_code, 409, body)
            self.assertEqual(r.json()["error"], "selling_change_unconfirmed")
            self.assertIn("confirm_selling_change", r.json()["detail"])
        self.assertEqual(self.assign("b300-14", {"role": "reserved", "confirm_selling_change": "yes"}).status_code, 400)
        self.assertEqual(self.node("b300-14")["role"], "selling")
        self.assertEqual(self.revision(), before)
        self.assertEqual(self.audit("alloc.node_assign"), [])
        r = self.assign("b300-14", {"role": "reserved", "confirm_selling_change": True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.node("b300-14")["role"], "reserved")

    def test_note_edit_on_a_selling_node_needs_no_confirmation(self):
        r = self.assign("b300-31", {"role": "selling", "note": "glm-5.2 + qwen3-vl"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.node("b300-31")["note"], "glm-5.2 + qwen3-vl")

    def test_engineer_to_selling_warns_about_the_leftover_account(self):
        r = self.assign("b300-30", {"role": "selling"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(len(r.json()["warnings"]), 1)
        self.assertIn("4.7", r.json()["warnings"][0])


class AuditAndRevisionTests(_AllocationCase):
    def test_every_write_audits_old_to_new_and_bumps_the_revision(self):
        justin = self.engineer("justin")["id"]
        steps = [
            ("alloc.node_assign", lambda: self.assign("b300-13", {"role": "engineer", "engineerId": self.engineer("mwind")["id"], "note": "moved"})),
            ("alloc.engineer_create", lambda: self.post(self.admin_client, "/admin/allocation/engineers", {"username": "eve", "email": "eve@oadpiz.com", "displayName": "Eve"})),
            ("alloc.engineer_update", lambda: self.post(self.admin_client, "/admin/allocation/engineers/" + justin, {"displayName": "Justin", "sshPubkey": ed_key()})),
            ("alloc.owner_update", lambda: self.post(self.admin_client, "/admin/allocation/owner", {"ownerEmail": "Owner@oadpiz.com"})),
            ("alloc.engineer_deactivate", lambda: self.post(self.admin_client, "/admin/allocation/engineers/" + self.engineer("eve")["id"] + "/status", {"active": False})),
            ("alloc.engineer_reactivate", lambda: self.post(self.admin_client, "/admin/allocation/engineers/" + self.engineer("eve")["id"] + "/status", {"active": True})),
        ]
        revision = self.revision()
        admin_id = self.user_id("admin@example.test")
        for action, call in steps:
            r = call()
            self.assertIn(r.status_code, (200, 201), r.text)
            revision += 1
            self.assertEqual(self.revision(), revision, action)
            self.assertEqual(r.json()["revision"], revision, action)
            events = self.audit(action)
            self.assertEqual(len(events), 1, action)
            self.assertEqual(events[0]["actor_id"], admin_id)
            self.assertEqual(json.loads(events[0]["details"])["revision"], revision)
        assign = json.loads(self.audit("alloc.node_assign")[0]["details"])
        self.assertEqual(self.audit("alloc.node_assign")[0]["target_id"], "b300-13")
        self.assertEqual(assign["from"], {"role": "engineer", "engineer": "justin", "note": ""})
        self.assertEqual(assign["to"], {"role": "engineer", "engineer": "mwind", "note": "moved"})
        update = json.loads(self.audit("alloc.engineer_update")[0]["details"])
        self.assertEqual(update["displayName"], {"from": "justin", "to": "Justin"})
        self.assertIsNone(update["keyFingerprint"]["from"])
        self.assertTrue(update["keyFingerprint"]["to"].startswith("SHA256:"))
        owner = json.loads(self.audit("alloc.owner_update")[0]["details"])
        self.assertEqual(owner["ownerEmail"], {"from": "zhuling@oadpiz.com", "to": "owner@oadpiz.com"})
        node = self.node("b300-13")
        self.assertEqual(node["updatedBy"], "admin@example.test")
        listing = self.admin_client.get(BASE + "/admin/audit").json()["events"]
        self.assertEqual(next(e for e in listing if e["action"] == "alloc.node_assign")["details"]["to"]["engineer"], "mwind")

    def test_no_op_writes_change_nothing(self):
        justin = self.engineer("justin")
        revision = self.revision()
        self.assertEqual(self.assign("b300-11", {"role": "engineer", "engineerId": justin["id"]}).json()["changed"], False)
        self.assertEqual(self.post(self.admin_client, "/admin/allocation/engineers/" + justin["id"], {"email": "JUSTIN@oadpiz.com"}).json()["changed"], False)
        self.assertEqual(self.post(self.admin_client, f"/admin/allocation/engineers/{justin['id']}/status", {"active": True}).json()["changed"], False)
        self.assertEqual(self.revision(), revision)
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("alloc.")], [])

    def test_export_is_audited_without_bumping_the_revision(self):
        revision = self.revision()
        self.export()
        self.assertEqual(self.revision(), revision)
        self.assertEqual([e["target_id"] for e in self.audit("alloc.export")], ["revision:%d" % revision])
        self.assertEqual(self.state()["lastExport"]["revision"], revision)


class ExportTests(_AllocationCase):
    def ready(self):
        keys = {}
        for username in SEED:
            keys[username] = ed_key(username + "@laptop")
            self.set_key(username, keys[username])
        return keys

    def test_seed_export_equals_the_cluster_file(self):
        result = self.export()
        self.assertEqual(result["filename"], "engineers.yaml")
        parsed = yaml.safe_load(result["yaml"])
        fixture = yaml.safe_load(FIXTURE.read_text())
        self.assertEqual(shape(parsed), shape(fixture))
        self.assertEqual(list(parsed), list(fixture), "top-level key order")
        self.assertEqual(list(parsed["engineers"][0]), list(fixture["engineers"][0]), "engineer field order")
        self.assertEqual(parsed, fixture, "the seeded state exports exactly the 2026-10-20 engineers.yaml")
        self.assertEqual([e["id"] for e in parsed["engineers"]], ["eng1", "eng2", "eng3", "eng4", "eng5"])
        self.assertIn("# revision: %d" % result["revision"], result["yaml"])
        self.assertIn("# generated_at: " + result["generatedAt"], result["yaml"])
        raw = self.admin_client.get(BASE + "/admin/allocation/export?format=yaml")
        self.assertEqual(raw.headers["content-disposition"], 'attachment; filename="engineers.yaml"')
        self.assertEqual(yaml.safe_load(raw.text), parsed)

    def test_engineers_without_a_key_carry_the_placeholder_and_a_warning(self):
        self.set_key("nati", ed_key())
        result = self.export()
        parsed = yaml.safe_load(result["yaml"])
        keys = {e["username"]: e["ssh_pubkey"] for e in parsed["engineers"]}
        self.assertEqual(set(keys), set(SEED))
        self.assertTrue(keys["nati"].startswith("ssh-ed25519 "))
        self.assertEqual({u for u, k in keys.items() if k == "ssh-ed25519 AAAA... CHANGE_ME"}, {"justin", "mwind", "zhuling", "ll"})
        self.assertEqual(result["excluded"], [])
        self.assertEqual(result["missingKeys"], ["justin", "mwind", "zhuling", "ll"])
        self.assertTrue(any("justin" in w and "CHANGE_ME" in w for w in result["warnings"]))
        self.assertFalse(result["renderReady"])
        self.assertTrue(result["monitoringReady"])

    def test_with_every_key_the_export_is_complete(self):
        keys = self.ready()
        result = self.export()
        self.assertTrue(result["renderReady"])
        self.assertEqual(result["warnings"], [])
        parsed = yaml.safe_load(result["yaml"])
        self.assertEqual(parsed["engineers"], [
            {"id": "eng%d" % (i + 1), "username": u, "name": u, "email": u + "@oadpiz.com", "ssh_pubkey": keys[u], "nodes": n, "state": "present"}
            for i, (u, n) in enumerate(SEED.items())])

    def test_new_engineers_get_the_next_cluster_id(self):
        r = self.post(self.admin_client, "/admin/allocation/engineers", {"username": "kim", "email": "kim@oadpiz.com"})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.engineer("kim")["clusterId"], "eng6")
        self.assign("b300-30", {"role": "engineer", "engineerId": self.engineer("kim")["id"]})
        entry = next(e for e in yaml.safe_load(self.export()["yaml"])["engineers"] if e["username"] == "kim")
        self.assertEqual((entry["id"], entry["nodes"]), ("eng6", ["b300-30"]))

    def test_engineer_without_nodes_and_missing_owner_are_flagged(self):
        for username, nodes in SEED.items():
            if username != "ll":
                continue
            for node in nodes:
                self.assign(node, {"role": "reserved"})
        with self.store.connect() as con:
            con.execute("UPDATE alloc_meta SET owner_email=NULL WHERE id=1")
        result = self.export()
        parsed = yaml.safe_load(result["yaml"])
        self.assertNotIn("ll", [e["username"] for e in parsed["engineers"]])
        self.assertEqual(result["excluded"], [{"username": "ll", "reason": "no_nodes"}])
        self.assertIn("#   ll: no_nodes", result["yaml"])
        self.assertEqual(parsed["owner"]["email"], "CHANGE_ME@your-mail-domain")
        self.assertFalse(result["renderReady"])
        self.assertFalse(result["monitoringReady"])
        self.assertTrue(any("Owner email" in w for w in result["warnings"]))

    def test_inactive_engineer_is_exported_absent_on_every_node_they_held(self):
        self.ready()
        ll = self.engineer("ll")["id"]
        self.assign("b300-29", {"role": "engineer", "engineerId": self.engineer("nati")["id"]})
        self.assign("b300-30", {"role": "reserved"})
        self.assertEqual(self.post(self.admin_client, f"/admin/allocation/engineers/{ll}/status", {"active": False}).status_code, 200)
        parsed = yaml.safe_load(self.export()["yaml"])
        entry = next(e for e in parsed["engineers"] if e["username"] == "ll")
        self.assertEqual((entry["id"], entry["state"]), ("eng5", "absent"))
        self.assertEqual(entry["nodes"], ["b300-29", "b300-30"])
        nati = next(e for e in parsed["engineers"] if e["username"] == "nati")
        self.assertEqual(nati["nodes"], ["b300-26", "b300-27", "b300-28", "b300-29"])

    def test_absent_engineer_never_lists_a_selling_node(self):
        self.ready()
        ll = self.engineer("ll")["id"]
        self.assign("b300-29", {"role": "selling"})
        self.assign("b300-30", {"role": "reserved"})
        self.post(self.admin_client, f"/admin/allocation/engineers/{ll}/status", {"active": False})
        result = self.export()
        entry = next(e for e in yaml.safe_load(result["yaml"])["engineers"] if e["username"] == "ll")
        self.assertEqual(entry["nodes"], ["b300-30"])
        self.assertTrue(any("b300-29" in w and "selling" in w for w in result["warnings"]))
        self.assertEqual(yaml.safe_load(result["yaml"])["selling"]["nodes"], ["b300-14", "b300-29", "b300-31"])

    def render(self, path, *args):
        return subprocess.run([sys.executable, str(RENDER), *args, "--data", str(path)], capture_output=True, text=True, timeout=60)

    def test_render_py_accepts_the_export(self):
        if not RENDER.is_file():
            self.skipTest("cluster render.py not available at " + str(RENDER))
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "seed.yaml"
            seed.write_text(self.export()["yaml"])
            monitoring = self.render(seed, "check", "--allow-missing-keys")
            self.assertEqual(monitoring.returncode, 0, monitoring.stdout + monitoring.stderr)
            strict = self.render(seed, "check")
            self.assertEqual(strict.returncode, 1, "account creation must refuse while keys are missing")
            self.assertIn("ssh_pubkey is a placeholder", strict.stderr)
            self.ready()
            full = Path(tmp) / "full.yaml"
            full.write_text(self.export()["yaml"])
            check = self.render(full, "check")
            self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
            self.assertIn("is valid", check.stdout)
            summary = self.render(full, "summary")
            self.assertEqual(summary.returncode, 0, summary.stderr)
            self.assertRegex(summary.stdout, r"b300-29\s+172\.16\.10\.29\s+engineer\s+eng5")
            self.assertRegex(summary.stdout, r"b300-14\s+172\.16\.10\.14\s+selling")


if __name__ == "__main__":
    unittest.main()
