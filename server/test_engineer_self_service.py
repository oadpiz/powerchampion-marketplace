"""Engineer SSH key self-service: admin-created linked accounts, GET/POST /me/engineer."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import yaml
from cryptography.hazmat.primitives.asymmetric import rsa

from server.allocation import AllocationError, parse_public_key
from server.test_accounts import BASE, PASSWORD
from server.test_allocation import SEED, _AllocationCase, ed_key, openssh
from server.testsupport import database_text, rows

SELF_FIELDS = {"username", "displayName", "active", "nodes", "key", "keyPendingSync", "keyUpdatedBy", "passwordChangeRequired"}
CHOSEN = "engineer-chosen-password-456!"


class _LinkedCase(_AllocationCase):
    def create_account(self, username, client=None):
        return self.post(client or self.admin_client, f"/admin/allocation/engineers/{self.engineer(username)['id']}/account", {})

    def link(self, username, change_password=True):
        """Create and link the engineer's account and sign in with the temporary password. By
        default the engineer then replaces it (required before any key change); `portal_password`
        is whatever password the account has now."""
        r = self.create_account(username)
        self.assertEqual(r.status_code, 201, r.text)
        client = self.client()
        temporary = r.json()["temporaryPassword"]
        login = self.post(client, "/auth/login", {"email": username + "@oadpiz.com", "password": temporary})
        self.assertEqual(login.status_code, 200, login.text)
        client.temporary_password = client.portal_password = temporary
        if change_password:
            changed = self.post(client, "/password", {"currentPassword": temporary, "newPassword": CHOSEN + username})
            self.assertEqual(changed.status_code, 200, changed.text)
            client.portal_password = CHOSEN + username
        return client

    def me(self, client):
        return client.get(BASE + "/me/engineer")

    def submit(self, client, key, password=None):
        return self.post(client, "/me/engineer/ssh-key", {"sshPubkey": key, "currentPassword": password or client.portal_password})

    def alloc_audit(self):
        return [e for e in rows(self.store, "audit_events") if e["action"].startswith("alloc.")]


class AdminAccountTests(_LinkedCase):
    def test_create_account_links_a_customer_and_returns_the_password_once(self):
        revision = self.revision()
        engineer_id = self.engineer("justin")["id"]
        r = self.create_account("justin")
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        password = body["temporaryPassword"]
        self.assertGreaterEqual(len(password), 20)
        user = next(u for u in rows(self.store, "users") if u["email"] == "justin@oadpiz.com")
        self.assertEqual((user["role"], user["name"], user["disabled_at"]), ("customer", "justin", None))
        self.assertEqual(body["account"], {"userId": user["id"], "email": "justin@oadpiz.com"})
        justin = next(e for e in body["engineers"] if e["id"] == engineer_id)
        self.assertEqual(justin["account"], {"userId": user["id"], "email": "justin@oadpiz.com", "disabled": False})
        self.assertEqual(self.engineer("justin")["account"]["userId"], user["id"])
        self.assertEqual(self.revision(), revision, "linking does not change the export")
        # stored only as a hash, never in the audit, never returned again
        self.assertNotIn(password, database_text(self.store))
        self.assertNotIn(password, self.admin_client.get(BASE + "/admin/allocation").text)
        audit = self.audit("alloc.engineer_account_create")
        self.assertEqual(len(audit), 1)
        self.assertEqual(json.loads(audit[0]["details"]), {"username": "justin", "userId": user["id"], "email": "justin@oadpiz.com"})
        login = self.post(self.client(), "/auth/login", {"email": "justin@oadpiz.com", "password": password})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["user"]["role"], "customer")

    def test_existing_account_with_the_email_is_never_linked(self):
        squatter = self.client()
        self.register(squatter, "justin@oadpiz.com")
        r = self.create_account("justin")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"], "account_exists")
        self.assertIn("不會自動連結", r.json()["detail"])
        self.assertIn("not linked automatically", r.json()["detail"])
        self.assertIsNone(self.engineer("justin")["account"])
        self.assertEqual(self.me(squatter).status_code, 404)
        self.assertEqual(self.audit("alloc.engineer_account_create"), [])

    def test_non_admin_and_anonymous_are_refused(self):
        customer = self.client()
        self.register(customer, "c@example.test")
        engineer_id = self.engineer("justin")["id"]
        for client, status in ((customer, 403), (self.client(), 401)):
            for path in ("/account", "/account/unlink"):
                r = self.post(client, f"/admin/allocation/engineers/{engineer_id}{path}", {})
                self.assertEqual(r.status_code, status, path)
        self.assertIsNone(self.engineer("justin")["account"])
        self.assertEqual([u["email"] for u in rows(self.store, "users") if u["email"].endswith("@oadpiz.com")], [])

    def test_inactive_engineer_cannot_get_an_account(self):
        r = self.post(self.admin_client, "/admin/allocation/engineers", {"username": "kim", "email": "kim@oadpiz.com"})
        self.assertEqual(r.status_code, 201)
        kim = self.engineer("kim")["id"]
        self.assertEqual(self.post(self.admin_client, f"/admin/allocation/engineers/{kim}/status", {"active": False}).status_code, 200)
        r = self.create_account("kim")
        self.assertEqual((r.status_code, r.json()["error"]), (409, "engineer_inactive"))
        self.assertNotIn("kim@oadpiz.com", [u["email"] for u in rows(self.store, "users")])

    def test_second_account_and_stale_revision_are_refused(self):
        self.link("justin")
        r = self.create_account("justin")
        self.assertEqual((r.status_code, r.json()["error"]), (409, "account_linked"))
        r = self.post(self.admin_client, f"/admin/allocation/engineers/{self.engineer('mwind')['id']}/account",
                      {"expected_revision": self.revision() + 1})
        self.assertEqual((r.status_code, r.json()["error"]), (409, "revision_conflict"))
        self.assertIsNone(self.engineer("mwind")["account"])
        self.assertEqual(self.post(self.admin_client, "/admin/allocation/engineers/" + "f" * 32 + "/account", {}).status_code, 404)

    def test_unlink_keeps_the_user_but_removes_self_service(self):
        client = self.link("justin")
        user_id = self.engineer("justin")["account"]["userId"]
        engineer_id = self.engineer("justin")["id"]
        r = self.post(self.admin_client, f"/admin/allocation/engineers/{engineer_id}/account/unlink", {})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["changed"])
        self.assertIsNone(self.engineer("justin")["account"])
        user = next(u for u in rows(self.store, "users") if u["id"] == user_id)
        self.assertIsNone(user["disabled_at"])
        self.assertEqual(json.loads(self.audit("alloc.engineer_account_unlink")[0]["details"]), {"username": "justin", "userId": user_id})
        self.assertEqual(self.me(client).status_code, 404)
        self.assertEqual(self.submit(client, ed_key()).status_code, 404)
        again = self.post(self.admin_client, f"/admin/allocation/engineers/{engineer_id}/account/unlink", {})
        self.assertFalse(again.json()["changed"])
        # an unlinked email already has an account, so it is never relinked automatically
        self.assertEqual(self.create_account("justin").json()["error"], "account_exists")

    def test_disabled_account_shows_in_the_admin_state(self):
        self.link("justin")
        user_id = self.engineer("justin")["account"]["userId"]
        r = self.post(self.admin_client, f"/admin/customers/{user_id}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(self.engineer("justin")["account"]["disabled"])


class EngineerSelfServiceTests(_LinkedCase):
    def test_unlinked_accounts_get_404_and_anonymous_401(self):
        customer = self.client()
        self.register(customer, "c@example.test")
        r = self.me(customer)
        self.assertEqual((r.status_code, r.json()["error"]), (404, "not_engineer"))
        r = self.post(customer, "/me/engineer/ssh-key", {"sshPubkey": ed_key(), "currentPassword": PASSWORD})
        self.assertEqual((r.status_code, r.json()["error"]), (404, "not_engineer"))
        anonymous = self.client()
        self.assertEqual(self.me(anonymous).status_code, 401)
        self.assertEqual(self.post(anonymous, "/me/engineer/ssh-key", {"sshPubkey": ed_key(), "currentPassword": "x"}).status_code, 401)
        # the admin is not an engineer either
        self.assertEqual(self.me(self.admin_client).status_code, 404)

    def test_get_returns_only_the_engineers_own_summary(self):
        other_key = ed_key("mwind@laptop")
        self.set_key("mwind", other_key)
        client = self.link("justin")
        r = self.me(client)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(set(data), SELF_FIELDS)
        self.assertEqual(data, {"username": "justin", "displayName": "justin", "active": True, "nodes": SEED["justin"],
                                "key": None, "keyPendingSync": False, "keyUpdatedBy": None, "passwordChangeRequired": False})
        for other in ('"mwind"', '"zhuling"', '"nati"', '"ll"', "b300-15", "b300-29", "@oadpiz.com", other_key.split(" ")[1]):
            self.assertNotIn(other, r.text)
        own = ed_key("justin@laptop")
        self.assertEqual(self.submit(client, own).status_code, 200)
        r = self.me(client)
        self.assertNotIn(own.split(" ")[1], r.text, "the raw key is never returned")
        self.assertEqual(r.json()["key"]["type"], "ssh-ed25519")
        self.assertEqual(r.json()["key"]["bits"], 256)
        self.assertTrue(r.json()["key"]["fingerprint"].startswith("SHA256:"))

    def test_key_update_is_pending_until_the_next_export(self):
        client = self.link("justin")
        revision = self.revision()
        key = ed_key("justin@laptop")
        r = self.submit(client, key)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["changed"])
        self.assertIn("after the administrator's next export and sync", body["detail"])
        self.assertTrue(body["engineer"]["keyPendingSync"])
        self.assertEqual(body["engineer"]["keyUpdatedBy"], "engineer")
        self.assertEqual(self.revision(), revision + 1)
        justin = self.engineer("justin")
        self.assertEqual(justin["sshPubkey"], key)
        self.assertEqual((justin["keyPendingSync"], justin["keyUpdatedBy"], justin["keyUpdatedRevision"]), (True, "engineer", revision + 1))
        audit = self.audit("alloc.engineer_key_self_update")
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0]["actor_id"], justin["account"]["userId"])
        self.assertEqual(audit[0]["target_id"], justin["id"])
        details = json.loads(audit[0]["details"])
        self.assertEqual(details, {"username": "justin", "revision": revision + 1,
                                   "keyFingerprint": {"from": None, "to": justin["keyFingerprint"]}})
        self.assertNotIn(key.split(" ")[1], audit[0]["details"])
        self.assertNotIn(client.temporary_password, database_text(self.store))
        # the export carries the new key and lists the change
        exported = self.export()
        entry = next(e for e in yaml.safe_load(exported["yaml"])["engineers"] if e["username"] == "justin")
        self.assertEqual(entry["ssh_pubkey"], key)
        self.assertEqual(exported["keyChanges"], [{"username": "justin", "fingerprint": justin["keyFingerprint"],
                                                   "previousFingerprint": None, "updatedBy": "engineer", "revision": revision + 1}])
        self.assertTrue(any("SSH key changed since the last export for justin (engineer" in w for w in exported["warnings"]))
        refused = self.post(self.admin_client, "/admin/allocation/export/mark", {"revision": exported["revision"]})
        self.assertEqual((refused.status_code, refused.json()["error"]), (409, "fingerprint_confirmation_required"))
        self.assertTrue(self.engineer("justin")["keyPendingSync"])
        confirmed = self.post(self.admin_client, "/admin/allocation/export/mark",
                              {"revision": exported["revision"], "fingerprintsConfirmed": True})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertFalse(self.engineer("justin")["keyPendingSync"])
        self.assertFalse(self.me(client).json()["keyPendingSync"])
        self.assertEqual(self.export()["keyChanges"], [])
        self.assertEqual(json.loads(self.audit("alloc.export")[0]["details"])["keyChanges"], ["justin"])
        # rotation records the fingerprint change from -> to
        rotated = ed_key("justin@new")
        self.assertEqual(self.submit(client, rotated).status_code, 200)
        details = json.loads(self.audit("alloc.engineer_key_self_update")[-1]["details"])
        self.assertEqual(details["keyFingerprint"]["from"], justin["keyFingerprint"])
        self.assertEqual(details["keyFingerprint"]["to"], self.engineer("justin")["keyFingerprint"])
        self.assertTrue(self.engineer("justin")["keyPendingSync"])
        # submitting the same key again changes nothing
        before = self.revision()
        same = self.submit(client, rotated)
        self.assertEqual((same.status_code, same.json()["changed"]), (200, False))
        self.assertEqual(self.revision(), before)

    def test_admin_key_changes_are_tracked_too(self):
        self.set_key("nati", ed_key())
        nati = self.engineer("nati")
        self.assertEqual((nati["keyPendingSync"], nati["keyUpdatedBy"]), (True, "admin"))
        self.mark()
        self.assertFalse(self.engineer("nati")["keyPendingSync"])

    def test_wrong_password_changes_nothing(self):
        client = self.link("justin")
        revision = self.revision()
        for password in ("wrong-password-123456", "", None, "x" * 129):
            r = self.post(client, "/me/engineer/ssh-key", {"sshPubkey": ed_key(), "currentPassword": password})
            self.assertEqual((r.status_code, r.json()["error"]), (400, "invalid_current_password"), repr(password))
        self.assertEqual(self.revision(), revision)
        self.assertIsNone(self.engineer("justin")["sshPubkey"])
        self.assertEqual(self.audit("alloc.engineer_key_self_update"), [])

    def test_password_attempts_are_throttled_per_user(self):
        client = self.link("justin")
        for _ in range(5):
            self.assertEqual(self.submit(client, ed_key(), password="wrong-password-123456").status_code, 400)
        r = self.submit(client, ed_key())
        self.assertEqual((r.status_code, r.json()["error"]), (429, "rate_limited"))
        self.assertIsNone(self.engineer("justin")["sshPubkey"])
        # another engineer has their own budget
        other = self.link("mwind")
        self.assertEqual(self.submit(other, ed_key()).status_code, 200)

    def test_disabled_account_cannot_update(self):
        client = self.link("justin")
        user_id = self.engineer("justin")["account"]["userId"]
        with self.store.connect() as con:
            con.execute("UPDATE users SET disabled_at=? WHERE id=?", (1700000000, user_id))
        self.assertEqual(self.submit(client, ed_key()).status_code, 401)
        with self.store.connect() as con:
            con.execute("UPDATE users SET disabled_at=NULL WHERE id=?", (user_id,))
        client = self.client()
        login = self.post(client, "/auth/login", {"email": "justin@oadpiz.com", "password": self.link_password(user_id)})
        self.assertEqual(login.status_code, 200)

        # disabled after the password check, before the write: refused under the writer lock
        original = self.store.clear_attempts

        def disable_then_clear(scope):
            with self.store.connect() as con:
                con.execute("UPDATE users SET disabled_at=? WHERE id=?", (1700000000, user_id))
            original(scope)

        with mock.patch.object(self.store, "clear_attempts", side_effect=disable_then_clear):
            r = self.post(client, "/me/engineer/ssh-key", {"sshPubkey": ed_key(), "currentPassword": self.link_password(user_id)})
        self.assertEqual((r.status_code, r.json()["error"]), (403, "account_disabled"))
        self.assertIsNone(self.engineer("justin")["sshPubkey"])

    def link_password(self, user_id):
        return self._passwords[user_id]

    def link(self, username):
        client = super().link(username)
        self._passwords = getattr(self, "_passwords", {})
        self._passwords[self.engineer(username)["account"]["userId"]] = client.portal_password
        return client

    def test_inactive_engineer_cannot_update(self):
        r = self.post(self.admin_client, "/admin/allocation/engineers", {"username": "kim", "email": "kim@oadpiz.com"})
        self.assertEqual(r.status_code, 201)
        client = self.link("kim")
        kim = self.engineer("kim")["id"]
        self.assertEqual(self.post(self.admin_client, f"/admin/allocation/engineers/{kim}/status", {"active": False}).status_code, 200)
        r = self.submit(client, ed_key())
        self.assertEqual((r.status_code, r.json()["error"]), (409, "engineer_inactive"))
        self.assertFalse(self.me(client).json()["active"])
        self.assertIsNone(self.engineer("kim")["sshPubkey"])

    def test_duplicate_key_is_refused(self):
        shared = ed_key("shared")
        self.set_key("mwind", shared)
        client = self.link("justin")
        r = self.submit(client, shared.replace(" shared", " other-comment"))
        self.assertEqual((r.status_code, r.json()["error"]), (409, "engineer_conflict"))
        self.assertIsNone(self.engineer("justin")["sshPubkey"])

    def test_invalid_keys_are_refused_before_any_password_attempt(self):
        client = self.link("justin")
        rsa2048 = openssh(rsa.generate_private_key(public_exponent=65537, key_size=2048))
        valid = ed_key()
        for bad in ("sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIA== yubikey",
                    rsa2048, 'from="10.0.0.1" ' + valid, "command=\"/bin/sh\" " + valid, valid + "\n" + ed_key(),
                    "", "ssh-ed25519 AAAA... CHANGE_ME", None, 7):
            r = self.post(client, "/me/engineer/ssh-key", {"sshPubkey": bad, "currentPassword": client.portal_password})
            self.assertEqual(r.status_code, 400, repr(bad))
        self.assertIsNone(self.engineer("justin")["sshPubkey"])
        self.assertEqual(self.submit(client, valid).status_code, 200, "invalid keys must not use up the password budget")

    def test_an_engineer_cannot_touch_another_engineer(self):
        justin = self.link("justin")
        mwind = self.link("mwind")
        mwind_id = self.engineer("mwind")["id"]
        key = ed_key("justin")
        r = self.post(justin, "/me/engineer/ssh-key", {"sshPubkey": key, "currentPassword": justin.portal_password,
                                                       "engineerId": mwind_id, "username": "mwind"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["engineer"]["username"], "justin")
        self.assertEqual(self.engineer("justin")["sshPubkey"], key)
        self.assertIsNone(self.engineer("mwind")["sshPubkey"])
        self.assertIsNone(self.me(mwind).json()["key"])
        # the engineer account has no admin access
        self.assertEqual(self.post(justin, f"/admin/allocation/engineers/{mwind_id}", {"sshPubkey": ed_key()}).status_code, 403)
        self.assertEqual(justin.get(BASE + "/admin/allocation").status_code, 403)
        # and another account's password does not work
        r = self.submit(justin, ed_key(), password=mwind.portal_password)
        self.assertEqual(r.status_code, 400)


class PasswordChangeRequiredTests(_LinkedCase):
    """A: an administrator-issued password can never set a production SSH key."""

    def attempts(self):
        return [r for r in rows(self.store, "login_attempts") if r["scope"].startswith("engineer-key:")]

    def test_temporary_password_must_be_changed_first(self):
        client = self.link("justin", change_password=False)
        self.assertTrue(self.me(client).json()["passwordChangeRequired"])
        for _ in range(7):  # more than the attempt budget: refused before the counter
            r = self.submit(client, ed_key())
            self.assertEqual((r.status_code, r.json()["error"]), (403, "password_change_required"))
        self.assertIn("/account/security", r.json()["detail"])
        self.assertIn("請先到", r.json()["detail"])
        self.assertEqual(self.attempts(), [])
        self.assertIsNone(self.engineer("justin")["sshPubkey"])
        self.assertNotIn("password_change_required", client.get(BASE + "/session").text)
        changed = self.post(client, "/password", {"currentPassword": client.temporary_password, "newPassword": CHOSEN})
        self.assertEqual(changed.status_code, 200)
        self.assertFalse(self.me(client).json()["passwordChangeRequired"])
        self.assertIsNone(next(u for u in rows(self.store, "users") if u["email"] == "justin@oadpiz.com")["password_change_required_at"])
        self.assertEqual(self.submit(client, ed_key(), password=CHOSEN).status_code, 200)

    def test_admin_password_reset_requires_a_new_change(self):
        client = self.link("justin")
        user_id = self.engineer("justin")["account"]["userId"]
        reset = self.post(self.admin_client, f"/admin/customers/{user_id}/reset-password", {"newPassword": "admin-issued-password-789"})
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertIsNotNone(next(u for u in rows(self.store, "users") if u["id"] == user_id)["password_change_required_at"])
        self.assertEqual(self.me(client).status_code, 401, "a reset signs the user out")
        client = self.client()
        self.assertEqual(self.post(client, "/auth/login", {"email": "justin@oadpiz.com", "password": "admin-issued-password-789"}).status_code, 200)
        self.assertTrue(self.me(client).json()["passwordChangeRequired"])
        r = self.submit(client, ed_key(), password="admin-issued-password-789")
        self.assertEqual((r.status_code, r.json()["error"]), (403, "password_change_required"))
        self.post(client, "/password", {"currentPassword": "admin-issued-password-789", "newPassword": CHOSEN})
        self.assertEqual(self.submit(client, ed_key(), password=CHOSEN).status_code, 200)

    def test_marker_is_rechecked_under_the_writer_lock(self):
        client = self.link("justin")
        user_id = self.engineer("justin")["account"]["userId"]
        original = self.store.clear_attempts

        def reset_then_clear(scope):
            with self.store.connect() as con:
                con.execute("UPDATE users SET password_change_required_at=? WHERE id=?", (1700000000, user_id))
            original(scope)

        with mock.patch.object(self.store, "clear_attempts", side_effect=reset_then_clear):
            r = self.submit(client, ed_key())
        self.assertEqual((r.status_code, r.json()["error"]), (403, "password_change_required"))
        self.assertIsNone(self.engineer("justin")["sshPubkey"])


class FingerprintConfirmationTests(_LinkedCase):
    """B: an engineer-submitted key ships only after the admin confirms its fingerprint out of band."""

    def mark_with(self, revision, **extra):
        return self.post(self.admin_client, "/admin/allocation/export/mark", {"revision": revision, **extra})

    def test_old_and_new_fingerprints_and_required_confirmation(self):
        original = ed_key("justin@old")
        self.set_key("justin", original)
        self.mark()
        old_fp = self.engineer("justin")["keyFingerprint"]
        client = self.link("justin")
        self.assertEqual(self.submit(client, ed_key("first")).status_code, 200)
        before_engineer = self.revision() - 1
        final = ed_key("second")
        self.assertEqual(self.submit(client, final).status_code, 200)
        justin = self.engineer("justin")
        new_fp = justin["keyFingerprint"]
        # two changes between exports keep the fingerprint the machines still have as "from"
        self.assertEqual((justin["keyPreviousFingerprint"], justin["keyUpdatedBy"]), (old_fp, "engineer"))
        exported = self.export()
        self.assertEqual([(c["previousFingerprint"], c["fingerprint"]) for c in exported["keyChanges"]], [(old_fp, new_fp)])
        # a late mark of a revision before the engineer's change needs no confirmation
        self.assertEqual(self.mark_with(before_engineer).status_code, 200)
        self.assertTrue(self.engineer("justin")["keyPendingSync"])
        for extra in ({}, {"fingerprintsConfirmed": False}):
            r = self.mark_with(exported["revision"], **extra)
            self.assertEqual((r.status_code, r.json()["error"]), (409, "fingerprint_confirmation_required"))
            self.assertIn("確認新指紋", r.json()["detail"])
        self.assertEqual(self.mark_with(exported["revision"], fingerprintsConfirmed="yes").status_code, 400)
        self.assertTrue(self.engineer("justin")["keyPendingSync"])
        r = self.mark_with(exported["revision"], fingerprintsConfirmed=True)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(self.engineer("justin")["keyPendingSync"])
        details = json.loads(self.audit("alloc.export")[-1]["details"])
        self.assertTrue(details["fingerprintsConfirmed"])
        self.assertEqual(details["engineerKeyChanges"], [{"username": "justin", "from": old_fp, "to": new_fp}])
        # the next change starts from the key that was just exported
        self.assertEqual(self.submit(client, ed_key("third")).status_code, 200)
        self.assertEqual(self.engineer("justin")["keyPreviousFingerprint"], new_fp)

    def test_admin_only_changes_need_no_confirmation(self):
        self.set_key("justin", ed_key())
        r = self.mark_with(self.revision())
        self.assertEqual(r.status_code, 200, r.text)
        details = json.loads(self.audit("alloc.export")[-1]["details"])
        self.assertEqual((details["engineerKeyChanges"], details["fingerprintsConfirmed"]), ([], False))


class PlaceholderCommentTests(_LinkedCase):
    """C: a CHANGE_ME comment would make render.py treat a real key as the missing-key placeholder."""

    def test_change_me_in_the_comment_is_refused_on_both_paths(self):
        client = self.link("justin")
        blob = ed_key().split(" ")[1]
        for comment in ("CHANGE_ME", "change_me", "laptop-Change_Me", "x CHANGE_ME y"):
            line = "ssh-ed25519 " + blob + " " + comment
            with self.assertRaises(AllocationError, msg=comment):
                parse_public_key(line)
            r = self.submit(client, line)
            self.assertEqual(r.status_code, 400, comment)
            self.assertIn("CHANGE_ME", r.json()["detail"])
            r = self.post(self.admin_client, "/admin/allocation/engineers/" + self.engineer("mwind")["id"], {"sshPubkey": line})
            self.assertEqual(r.status_code, 400, comment)
        self.assertIsNone(self.engineer("justin")["sshPubkey"])
        self.assertIsNone(self.engineer("mwind")["sshPubkey"])
        self.assertEqual(parse_public_key("ssh-ed25519 " + blob + " change-me")["comment"], "change-me")


class ConcurrencyTests(_LinkedCase):
    """F: concurrent requests (adapted from the 2026-10-21 review)."""

    def race(self, calls):
        start = threading.Barrier(len(calls))

        def run(call):
            start.wait(timeout=15)
            return call()

        with ThreadPoolExecutor(len(calls)) as pool:
            return list(pool.map(run, calls))

    def test_concurrent_wrong_passwords_throttle(self):
        client = self.link("justin")
        key = ed_key()
        statuses = [r.status_code for r in self.race([lambda: self.submit(client, key, "wrong-password-xxxxx")] * 20)]
        self.assertEqual((statuses.count(400), statuses.count(429)), (5, 15), statuses)
        self.assertEqual(self.submit(client, key).status_code, 429, "the right password is blocked too")
        self.assertIsNone(self.engineer("justin")["sshPubkey"])

    def test_two_engineers_same_key_concurrently(self):
        justin, mwind = self.link("justin"), self.link("mwind")
        for _ in range(5):
            key = ed_key()
            results = self.race([lambda: self.submit(justin, key), lambda: self.submit(mwind, key)])
            self.assertEqual(sorted(r.status_code for r in results), [200, 409], [r.text for r in results])
            holders = [e for e in rows(self.store, "alloc_engineers")
                       if e["ssh_pubkey"] and e["ssh_pubkey"].split(" ")[1] == key.split(" ")[1]]
            self.assertEqual(len(holders), 1)

    def test_integrity_error_branch(self):
        """A signup that commits between the email check and the INSERT still gives account_exists."""
        from server import db as dbmod
        original = dbmod.Connection.execute
        store = self.store

        def execute(con, sql, params=()):
            if sql.startswith("INSERT INTO users (id,email,name,password_hash,role,created_at") and params and params[1] == "justin@oadpiz.com":
                raise store.IntegrityError("simulated unique violation")
            return original(con, sql, params)

        with mock.patch.object(dbmod.Connection, "execute", execute):
            r = self.create_account("justin")
        self.assertEqual((r.status_code, r.json()["error"]), (409, "account_exists"))
        self.assertIsNone(self.engineer("justin")["account"])
        self.assertEqual(self.audit("alloc.engineer_account_create"), [])
        self.assertNotIn("justin@oadpiz.com", [u["email"] for u in rows(self.store, "users")])


if __name__ == "__main__":
    import unittest
    unittest.main()
