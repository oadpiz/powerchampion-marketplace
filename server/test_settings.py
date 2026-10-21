import os
import unittest
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


if __name__ == "__main__":
    unittest.main()
