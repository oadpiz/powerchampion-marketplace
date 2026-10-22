import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server.settings import Settings


class DatabaseUrlTests(unittest.TestCase):
    def test_default_is_sqlite_from_db_path(self):
        s = Settings(db_path="/tmp/x/portal.sqlite3")
        self.assertEqual(s.resolved_database_url, "sqlite:////tmp/x/portal.sqlite3")

    def test_explicit_database_url_wins(self):
        s = Settings(db_path="/tmp/x/portal.sqlite3", database_url="postgresql://u:p@db:5432/portal")
        self.assertEqual(s.resolved_database_url, "postgresql://u:p@db:5432/portal")

    def test_db_path_may_already_be_a_url(self):
        s = Settings(db_path="postgresql://u:p@db:5432/portal")
        self.assertEqual(s.resolved_database_url, "postgresql://u:p@db:5432/portal")

    def test_from_env_reads_database_url(self):
        env = {"PC_PORTAL_DATABASE_URL": "postgresql://u:p@db:5432/portal", "PC_PORTAL_DB": "/data/portal.sqlite3"}
        with patch.dict(os.environ, env, clear=False):
            s = Settings.from_env()
        self.assertEqual(s.resolved_database_url, "postgresql://u:p@db:5432/portal")
        self.assertEqual(s.db_path, "/data/portal.sqlite3")

    def test_rejects_unknown_scheme(self):
        with self.assertRaises(ValueError):
            Settings(database_url="mysql://u:p@db/x")


class KeyIssuanceSettingTests(unittest.TestCase):
    def test_customer_key_issuance_defaults_off_and_reads_env(self):
        self.assertFalse(Settings().customer_key_issuance)
        with patch.dict(os.environ, {"PC_CUSTOMER_KEY_ISSUANCE": "1"}, clear=False):
            self.assertTrue(Settings.from_env().customer_key_issuance)


class GrafanaUrlSettingTests(unittest.TestCase):
    def test_default_and_env(self):
        self.assertEqual(Settings().grafana_url, "https://grafana.powerchampion.ai")
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PC_GRAFANA_URL", None)
            self.assertEqual(Settings.from_env().grafana_url, "https://grafana.powerchampion.ai")
        with patch.dict(os.environ, {"PC_GRAFANA_URL": "https://grafana.example.test/"}, clear=False):
            self.assertEqual(Settings.from_env().grafana_url, "https://grafana.example.test")

    def test_empty_disables_the_link(self):
        with patch.dict(os.environ, {"PC_GRAFANA_URL": ""}, clear=False):
            self.assertEqual(Settings.from_env().grafana_url, "")
        self.assertEqual(Settings(grafana_url="").grafana_url, "")

    def test_rejects_unsafe_urls(self):
        for url in ("http://grafana.example.test", "https://u:p@grafana.example.test", "https://grafana.example.test/?a=1",
                    "https://grafana.example.test/#x", "https://grafana.example.test/sub", "javascript:alert(1)", "https://"):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    Settings(grafana_url=url)


TEST_SECRET = "test-only-not-a-secret-0000000000"
VOICE_ENV = ("PC_VOICE_ENABLED", "PC_VOICE_TRY_SECRET", "PC_VOICE_TRY_URL")


class VoiceSettingTests(unittest.TestCase):
    def from_env(self, **values):
        env = {"PC_PORTAL_ENV": "production", "PC_PORTAL_SECURE_COOKIES": "1"}
        env.update(values)
        with patch.dict(os.environ, env, clear=False):
            for name in VOICE_ENV:
                if name not in values:
                    os.environ.pop(name, None)
            return Settings.from_env()

    def test_defaults_off_and_unavailable(self):
        for s in (Settings(), self.from_env()):
            self.assertFalse(s.voice_enabled)
            self.assertEqual((s.voice_try_secret, s.voice_try_url, s.voice_try_origin), ("", "", ""))
            self.assertFalse(s.voice_try_available)

    def test_reads_env(self):
        s = self.from_env(PC_VOICE_ENABLED="1", PC_VOICE_TRY_SECRET=TEST_SECRET, PC_VOICE_TRY_URL=" https://try.example.test/ ")
        self.assertTrue(s.voice_enabled)
        self.assertEqual(s.voice_try_secret, TEST_SECRET)
        self.assertEqual(s.voice_try_origin, "https://try.example.test")
        self.assertTrue(s.voice_try_available)
        self.assertFalse(self.from_env(PC_VOICE_ENABLED="true").voice_enabled)  # only "1" turns it on

    def test_missing_or_bad_values_never_stop_startup(self):
        # Enabled without a secret or URL, or with malformed ones: the service still starts; trying a call is just unavailable.
        for values in ({"PC_VOICE_ENABLED": "1"},
                       {"PC_VOICE_ENABLED": "1", "PC_VOICE_TRY_SECRET": TEST_SECRET},
                       {"PC_VOICE_ENABLED": "1", "PC_VOICE_TRY_URL": "https://try.example.test"},
                       {"PC_VOICE_ENABLED": "1", "PC_VOICE_TRY_SECRET": TEST_SECRET[:31], "PC_VOICE_TRY_URL": "https://try.example.test"},
                       {"PC_VOICE_ENABLED": "1", "PC_VOICE_TRY_SECRET": TEST_SECRET, "PC_VOICE_TRY_URL": "http://try.example.test"},
                       {"PC_VOICE_ENABLED": "1", "PC_VOICE_TRY_SECRET": TEST_SECRET, "PC_VOICE_TRY_URL": "https://try.example.test:99999"}):
            with self.subTest(values=sorted(values)):
                s = self.from_env(**values)
                self.assertTrue(s.voice_enabled)
                self.assertFalse(s.voice_try_available)
        from server.app import create_app
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(db_path=str(Path(directory) / "p.sqlite"), voice_enabled=True))
            self.assertTrue(app.state.store)

    def test_secret_needs_32_characters(self):
        url = "https://try.example.test"
        self.assertFalse(Settings(voice_try_secret="x" * 31, voice_try_url=url).voice_try_available)
        self.assertTrue(Settings(voice_try_secret="x" * 32, voice_try_url=url).voice_try_available)

    def test_secret_is_not_in_repr(self):
        self.assertNotIn(TEST_SECRET, repr(Settings(voice_try_secret=TEST_SECRET)))

    def test_try_url_must_be_an_https_origin_or_local_http(self):
        accepted = {"https://try.example.test": "https://try.example.test", "https://Try.Example.test:8443/": "https://try.example.test:8443",
                    "http://localhost:8097/": "http://localhost:8097", "http://127.0.0.1:8097": "http://127.0.0.1:8097",
                    "http://[::1]:8097": "http://[::1]:8097"}
        for url, origin in accepted.items():
            with self.subTest(url=url):
                self.assertEqual(Settings(voice_try_url=url).voice_try_origin, origin)
        for url in ("http://try.example.test", "http://localhost.example.test", "https://u:p@try.example.test", "https://@try.example.test",
                    "https://try.example.test/demo", "https://try.example.test/?t=1", "https://try.example.test/#t=1",
                    "https://try.example.test:abc", "https://", "ftp://try.example.test", "javascript:alert(1)", "try.example.test",
                    "https://try example.test", ""):
            with self.subTest(url=url):
                self.assertEqual(Settings(voice_try_url=url).voice_try_origin, "")


if __name__ == "__main__":
    unittest.main()
