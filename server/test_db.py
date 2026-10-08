import os
import tempfile
import unittest
from pathlib import Path

from server.db import Database, translate_placeholders


class PlaceholderTests(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(translate_placeholders("SELECT * FROM t WHERE a=? AND b=?"), "SELECT * FROM t WHERE a=%s AND b=%s")

    def test_skips_string_literals(self):
        self.assertEqual(translate_placeholders("SELECT 'what?' AS q FROM t WHERE a=?"), "SELECT 'what?' AS q FROM t WHERE a=%s")

    def test_escaped_quote_inside_literal(self):
        self.assertEqual(translate_placeholders("SELECT 'it''s ?' FROM t WHERE a=?"), "SELECT 'it''s ?' FROM t WHERE a=%s")


def _target(tmp):
    url = os.environ.get("PC_PORTAL_TEST_DATABASE_URL")
    return url if url else str(Path(tmp) / "db.sqlite")


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = Database(_target(self.directory.name))
        self.db.reset_for_tests()
        with self.db.connect() as con:
            con.execute("CREATE TABLE items (id TEXT PRIMARY KEY, n INTEGER NOT NULL, note TEXT)")

    def tearDown(self):
        self.directory.cleanup()

    def test_backend_and_url(self):
        if self.db.backend == "sqlite":
            self.assertTrue(self.db.url.startswith("sqlite:///"))
            self.assertTrue(self.db.path.endswith("db.sqlite"))
        else:
            self.assertTrue(self.db.url.startswith("postgresql+psycopg://"))
            self.assertIsNone(self.db.path)

    def test_rows_support_name_and_index(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, "x?"))
            row = con.execute("SELECT id, n, note FROM items WHERE id=?", ("a",)).fetchone()
        self.assertEqual(row["n"], 1)
        self.assertEqual(row[0], "a")
        self.assertEqual(dict(row), {"id": "a", "n": 1, "note": "x?"})
        self.assertEqual(list(row.keys()), ["id", "n", "note"])

    def test_count_fetchone_index_zero(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM items").fetchone()[0], 1)

    def test_rowcount_on_update(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
            self.assertEqual(con.execute("UPDATE items SET n=2 WHERE id=?", ("a",)).rowcount, 1)
            self.assertEqual(con.execute("UPDATE items SET n=2 WHERE id=?", ("zz",)).rowcount, 0)

    def test_rollback_on_exception(self):
        with self.assertRaises(RuntimeError):
            with self.db.connect() as con:
                con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
                raise RuntimeError("boom")
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM items").fetchone()[0], 0)

    def test_integrity_error_is_unified(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
        with self.assertRaises(self.db.IntegrityError):
            with self.db.connect() as con:
                con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 2, None))

    def test_begin_immediate_is_accepted(self):
        with self.db.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, None))
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM items").fetchone()[0], 1)

    def test_case_with_cast_parameter(self):
        with self.db.connect() as con:
            con.execute("INSERT INTO items VALUES (?,?,?)", ("a", 1, "keep"))
            con.execute("UPDATE items SET note=CASE WHEN CAST(? AS TEXT)='clear' THEN NULL ELSE note END WHERE id=?", ("clear", "a"))
            self.assertIsNone(con.execute("SELECT note FROM items WHERE id=?", ("a",)).fetchone()["note"])

    def test_table_names(self):
        self.assertIn("items", self.db.table_names())


if __name__ == "__main__":
    unittest.main()
