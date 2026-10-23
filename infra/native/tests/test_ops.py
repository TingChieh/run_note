"""Offline tests for ops/envfile.py and ops/schema_compat.py.

Run with the backend virtualenv (needs alembic, and pydantic-settings for the Settings check):
    backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
No database, network or real secrets are used.
"""

import os
import stat
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OPS = REPO / "infra" / "native" / "ops"
sys.path.insert(0, str(OPS))
sys.path.insert(0, str(REPO / "backend"))

import envfile  # noqa: E402
import schema_compat  # noqa: E402

GOOD = {
    "APP_ENV": "production",
    "DATABASE_URL": "postgresql+psycopg://runnote:pw@127.0.0.1:5432/runnote",
    "SITE_ORIGIN": "https://run.example.test",
    "SITE_OWNER_EMAIL": "owner@example.test",
    "AUTH_RATE_HASH_KEY": "k" * 40,
    "AUTH_TRUSTED_PROXIES": '["127.0.0.1"]',
}


class EnvParse(unittest.TestCase):
    def test_json_value_keeps_brackets_and_quotes(self):
        values = envfile.parse("""AUTH_TRUSTED_PROXIES='["127.0.0.1"]'\n""")
        self.assertEqual(values["AUTH_TRUSTED_PROXIES"], '["127.0.0.1"]')

    def test_comments_blank_and_double_quotes(self):
        values = envfile.parse('# c\n\n; c\nA="x y"\nB=plain\n')
        self.assertEqual(values, {"A": "x y", "B": "plain"})

    def test_rejects_garbage_line(self):
        with self.assertRaises(ValueError):
            envfile.parse("export A=1\n")
        with self.assertRaises(ValueError):
            envfile.parse("not a pair\n")

    def test_templates_parse_and_are_flagged_as_placeholders(self):
        for name in ("backend", "frontend", "backup"):
            text = (REPO / "infra/native/env" / f"{name}.env.example").read_text()
            values = envfile.parse(text)
            self.assertTrue(values, name)
        backend = envfile.parse((REPO / "infra/native/env/backend.env.example").read_text())
        self.assertTrue(any("CHANGE_ME" in value for value in backend.values()))
        problems = envfile.check_backend(backend)
        self.assertTrue(any("CHANGE_ME" in p for p in problems))
        # The template already carries the proxy setting that the rate limiter needs.
        self.assertFalse(any("AUTH_TRUSTED_PROXIES" in p for p in problems))


class BackendChecks(unittest.TestCase):
    def test_good_config_has_no_problems(self):
        self.assertEqual(envfile.check_backend(dict(GOOD)), [])

    def test_missing_trusted_proxy_is_rejected(self):
        values = dict(GOOD)
        del values["AUTH_TRUSTED_PROXIES"]
        self.assertTrue(any("AUTH_TRUSTED_PROXIES" in p for p in envfile.check_backend(values)))

    def test_non_production_and_test_database_rejected(self):
        values = dict(
            GOOD, APP_ENV="development", TEST_DATABASE_URL="postgresql+psycopg://x@h/t_test"
        )
        problems = envfile.check_backend(values)
        self.assertTrue(any("APP_ENV" in p for p in problems))
        self.assertTrue(any("TEST_DATABASE_URL" in p for p in problems))

    def test_remote_database_host_flagged(self):
        values = dict(GOOD, DATABASE_URL="postgresql+psycopg://u:p@db.example.test:5432/runnote")
        self.assertTrue(any("loopback" in p for p in envfile.check_backend(values)))

    def test_public_prefix_flagged(self):
        problems = envfile.check_backend(dict(GOOD, PUBLIC_X="1"))
        self.assertTrue(any("PUBLIC_" in p for p in problems))

    def test_application_settings_accept_the_good_config(self):
        self.assertEqual(envfile.validate_settings(dict(GOOD)), [])

    def test_application_settings_reject_http_origin_without_leaking_values(self):
        bad = dict(GOOD, SITE_ORIGIN="http://run.example.test", AUTH_RATE_HASH_KEY="s3cret" * 8)
        problems = envfile.validate_settings(bad)
        self.assertEqual(len(problems), 1)
        self.assertNotIn("s3cret", problems[0])


class FileMode(unittest.TestCase):
    def test_world_readable_rejected(self):
        with tempfile.NamedTemporaryFile() as handle:
            os.chmod(handle.name, 0o644)
            self.assertTrue(envfile.mode_problems(handle.name))
            os.chmod(handle.name, 0o640)
            self.assertEqual(envfile.mode_problems(handle.name), [])
            self.assertEqual(stat.S_IMODE(os.stat(handle.name).st_mode), 0o640)


def make_chain(directory: Path, revisions: list[str]) -> Path:
    versions = directory / "versions"
    versions.mkdir(parents=True)
    (directory / "script.py.mako").write_text("")
    previous = "None"
    for revision in revisions:
        (versions / f"{revision}.py").write_text(
            textwrap.dedent(
                f"""
                revision = {revision!r}
                down_revision = {previous if previous == "None" else repr(previous)}
                def upgrade(): pass
                def downgrade(): pass
                """
            )
        )
        previous = revision
    return directory


class SchemaRelation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.new = make_chain(Path(self.tmp.name) / "new", ["0001_a", "0002_b", "0003_c"])
        self.old = make_chain(Path(self.tmp.name) / "old", ["0001_a", "0002_b"])

    def test_head(self):
        self.assertEqual(schema_compat.head_of(self.new), "0003_c")

    def test_same_behind_none(self):
        self.assertEqual(schema_compat.relation(self.new, "0003_c"), "same")
        self.assertEqual(schema_compat.relation(self.new, "0002_b"), "behind")
        self.assertEqual(schema_compat.relation(self.new, "none"), "behind")

    def test_database_newer_than_old_release_is_ahead(self):
        # CLI semantics: a revision the release has never heard of means the DB is ahead.
        import subprocess

        out = subprocess.run(
            [sys.executable, str(OPS / "schema_compat.py"), "relation", str(self.old), "0003_c"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        self.assertEqual(out, "ahead")

    def test_two_heads_refused(self):
        branch = make_chain(Path(self.tmp.name) / "branch", ["0001_a"])
        (branch / "versions" / "0002_x.py").write_text(
            "revision='0002_x'\ndown_revision='0001_a'\n"
        )
        (branch / "versions" / "0002_y.py").write_text(
            "revision='0002_y'\ndown_revision='0001_a'\n"
        )
        with self.assertRaises(SystemExit):
            schema_compat.head_of(branch)

    def test_real_repository_has_one_head(self):
        head = schema_compat.head_of(REPO / "backend" / "migrations")
        self.assertRegex(head, r"^\d{4}_[a-z0-9_]+$")


class DbStateClassification(unittest.TestCase):
    """The first-initialisation guard: `empty` only when nothing but PostGIS exists."""

    def facts(self, **override):
        base = {
            "version_table": False,
            "version_rows": [],
            "extensions": ["plpgsql", "postgis"],
            "foreign": {"relation": [], "function": [], "type": [], "schema": []},
            "large_objects": 0,
        }
        base.update(override)
        return base

    def test_precreated_postgis_only_is_empty(self):
        self.assertEqual(schema_compat.classify_state(self.facts()), "empty")
        self.assertEqual(schema_compat.classify_state(self.facts(extensions=["plpgsql"])), "empty")

    def test_missing_version_table_alone_is_not_enough(self):
        for kind in ("relation", "function", "type", "schema"):
            with self.subTest(kind=kind):
                foreign = {"relation": [], "function": [], "type": [], "schema": []}
                foreign[kind] = ["public.something"]
                state = schema_compat.classify_state(self.facts(foreign=foreign))
                self.assertTrue(state.startswith("refuse "), state)
                self.assertIn("public.something", state)

    def test_large_objects_and_unexpected_extensions_are_refused(self):
        self.assertTrue(
            schema_compat.classify_state(self.facts(large_objects=2)).startswith("refuse ")
        )
        state = schema_compat.classify_state(
            self.facts(extensions=["plpgsql", "postgis", "pg_trgm"])
        )
        self.assertTrue(state.startswith("refuse "))
        self.assertIn("pg_trgm", state)

    def test_versioned_database_reports_its_revision(self):
        state = schema_compat.classify_state(
            self.facts(version_table=True, version_rows=["0012_x"])
        )
        self.assertEqual(state, "revision 0012_x")

    def test_version_table_without_a_row_or_with_several_is_refused(self):
        for rows in ([], ["a", "b"]):
            with self.subTest(rows=rows):
                state = schema_compat.classify_state(
                    self.facts(version_table=True, version_rows=rows)
                )
                self.assertTrue(state.startswith("refuse "), state)

    def test_version_table_beats_the_emptiness_check(self):
        # A versioned database is judged by its revision, never re-labelled `empty`.
        state = schema_compat.classify_state(
            self.facts(
                version_table=True, version_rows=["0001_a"], foreign={"relation": ["public.t"]}
            )
        )
        self.assertEqual(state, "revision 0001_a")


if __name__ == "__main__":
    unittest.main()
