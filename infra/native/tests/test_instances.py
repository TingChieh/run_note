"""Offline tests for the multi-instance support (ops/instance.py, lib.sh instance context,
envfile.py instance expectations). No database, network, root or real secrets.

    backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
"""

import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
NATIVE = REPO / "infra" / "native"
OPS = NATIVE / "ops"
sys.path.insert(0, str(OPS))
sys.path.insert(0, str(REPO / "backend"))

import envfile  # noqa: E402
import instance  # noqa: E402

EXAMPLE = NATIVE / "instances" / "production.conf.example"


def write_conf(directory: Path, name: str, **override) -> Path:
    values = dict(instance.parse_conf(EXAMPLE))
    values.update(override)
    path = directory / f"{name}.conf"
    path.write_text("".join(f"{k}={v}\n" for k, v in values.items()), encoding="utf-8")
    return path


def bash(script: str, **env) -> subprocess.CompletedProcess:
    import os

    full = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("RUNNOTE_", "APP_", "BACKUP_", "API_", "WEB_"))
    }
    full.update(env)
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=full, cwd=OPS)


class LegacyIsUnchanged(unittest.TestCase):
    def test_templates_reproduce_the_existing_units_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as tmp:
            instance.render(dict(instance.LEGACY), Path(tmp), instance=False, caddy_mode=None)
            for name in (
                "runnote-api.service",
                "runnote-web.service",
                "runnote-backup.service",
                "runnote-backup.timer",
            ):
                self.assertEqual(
                    (Path(tmp) / name).read_text(encoding="utf-8"),
                    (NATIVE / name).read_text(encoding="utf-8"),
                    f"{name} would change for the existing installation",
                )

    def test_lib_defaults_without_an_instance_are_the_legacy_layout(self):
        out = bash(
            '. ./lib.sh; echo "$RUNNOTE_ROOT|$RUNNOTE_ETC|$BACKUP_DIR|$APP_USER|$API_URL|$WEB_URL|${SERVICES[*]}|$BACKEND_ENV"'  # noqa: E501
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(
            out.stdout.strip(),
            "/opt/run-note|/etc/run-note|/var/backups/run-note|runnote|http://127.0.0.1:8000|http://127.0.0.1:3000"  # noqa: E501
            "|runnote-api runnote-web|/etc/run-note/backend.env",
        )

    def test_legacy_paths_stay_overridable_for_tests(self):
        out = bash(
            '. ./lib.sh; echo "$RUNNOTE_ROOT $API_URL"',
            RUNNOTE_ROOT="/tmp/x",
            API_URL="http://127.0.0.1:1",
        )
        self.assertEqual(out.stdout.strip(), "/tmp/x http://127.0.0.1:1")


class InstanceDefinition(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def load(self, name="production"):
        return instance.load(name, self.dir)

    def test_the_shipped_example_is_valid_and_disjoint_from_the_legacy_layout(self):
        write_conf(self.dir, "production")
        values = self.load()
        for key in ("APP_USER", "DB_ROLE", "DB_NAME", "ROOT", "ETC", "API_PORT", "SERVICE_API"):
            self.assertNotEqual(values[key], instance.LEGACY[key], key)
        self.assertEqual(
            (values["APP_USER"], values["DB_NAME"], values["API_PORT"], values["WEB_PORT"]),
            ("run_note", "run_note", "8100", "3100"),
        )

    def test_every_collision_with_the_legacy_installation_is_refused(self):
        cases = {
            "APP_USER": "runnote",
            "APP_GROUP": "runnote",
            "DB_ROLE": "runnote",
            "API_PORT": "8000",
            "WEB_PORT": "3000",
            "ROOT": "/opt/run-note",
            "ETC": "/etc/run-note",
            "BACKUP_DIR": "/var/backups/run-note",
            "SERVICE_API": "runnote-api",
            "SERVICE_WEB": "runnote-web",
            "SERVICE_BACKUP": "runnote-backup",
            "DB_NAME": "runnote",
        }
        for key, bad in cases.items():
            with self.subTest(key=key):
                write_conf(self.dir, "production", **{key: bad})
                with self.assertRaises(instance.ConfigError):
                    self.load()

    def test_staging_database_name_is_reserved_too(self):
        write_conf(self.dir, "production", DB_NAME="runnote_rehearsal")
        with self.assertRaises(instance.ConfigError):
            self.load()

    def test_nested_directories_are_refused(self):
        write_conf(self.dir, "production", ETC="/opt/run-note-production/etc")
        with self.assertRaises(instance.ConfigError):
            self.load()
        write_conf(
            self.dir, "production", ROOT="/opt/run-note/production"
        )  # inside the legacy root
        with self.assertRaises(instance.ConfigError):
            self.load()

    def test_two_instances_may_not_share_anything(self):
        write_conf(self.dir, "production")
        for key, value in {
            "API_PORT": "8100",
            "WEB_PORT": "3100",
            "APP_USER": "run_note",
            "DB_NAME": "run_note",
            "DOMAIN": "run.example.com",
            "SERVICE_API": "runnote-production-api",
        }.items():
            with self.subTest(key=key):
                other = dict(
                    INSTANCE="second",
                    DOMAIN="second.example.com",
                    ROOT="/opt/run-note-second",
                    ETC="/etc/run-note-second",
                    BACKUP_DIR="/var/backups/run-note-second",
                    APP_USER="run_second",
                    APP_GROUP="run_second",
                    DB_NAME="run_second",
                    DB_ROLE="run_second",
                    API_PORT="8200",
                    WEB_PORT="3200",
                    SERVICE_API="runnote-second-api",
                    SERVICE_WEB="runnote-second-web",
                    SERVICE_BACKUP="runnote-second-backup",
                )
                other[key] = value
                if key == "API_PORT":
                    other[key] = "3100"  # collides with the other instance's WEB_PORT
                write_conf(self.dir, "second", **other)
                with self.assertRaises(instance.ConfigError):
                    self.load("second")

    def test_malformed_files_are_refused(self):
        for bad in ("UNKNOWN_KEY=1\n", "INSTANCE\n"):
            (self.dir / "production.conf").write_text(bad, encoding="utf-8")
            with self.assertRaises(instance.ConfigError):
                self.load()
        path = write_conf(self.dir, "production")
        path.write_text(path.read_text() + "API_PORT=9999\n", encoding="utf-8")  # duplicate key
        with self.assertRaises(instance.ConfigError):
            self.load()
        write_conf(self.dir, "production", API_PORT="80")
        with self.assertRaises(instance.ConfigError):
            self.load()
        write_conf(self.dir, "production", ROOT="/opt/../etc/shadow-dir")
        with self.assertRaises(instance.ConfigError):
            self.load()
        write_conf(self.dir, "production", APP_USER="Run Note")
        with self.assertRaises(instance.ConfigError):
            self.load()

    def test_file_name_must_equal_the_declared_instance(self):
        write_conf(self.dir, "other-name")
        with self.assertRaises(instance.ConfigError):
            instance.load("other-name", self.dir)
        write_conf(self.dir, "legacy", INSTANCE="legacy")
        with self.assertRaises(instance.ConfigError):
            instance.load("legacy", self.dir)

    def test_missing_key_is_refused_not_defaulted(self):
        path = write_conf(self.dir, "production")
        path.write_text(
            "".join(
                line
                for line in path.read_text().splitlines(True)
                if not line.startswith("DB_ROLE=")
            ),
            encoding="utf-8",
        )
        with self.assertRaises(instance.ConfigError):
            self.load()


class Rendering(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / "conf"
        self.dir.mkdir()
        write_conf(self.dir, "production")
        self.out = Path(self.tmp.name) / "out"
        self.values = instance.load("production", self.dir)
        instance.render(self.values, self.out, instance=True, caddy_mode="maintenance")

    def text(self, name):
        return (self.out / name).read_text(encoding="utf-8")

    def test_unit_files_are_named_after_the_explicit_service_names(self):
        self.assertEqual(
            sorted(p.name for p in self.out.iterdir()),
            [
                "production.caddy",
                "runnote-production-api.service",
                "runnote-production-backup.service",
                "runnote-production-backup.timer",
                "runnote-production-web.service",
            ],
        )

    def test_api_unit_expands_user_paths_and_port(self):
        unit = self.text("runnote-production-api.service")
        for expected in (
            "User=run_note",
            "Group=run_note",
            "WorkingDirectory=/opt/run-note-production/current/backend",
            "EnvironmentFile=/etc/run-note-production/backend.env",
            "--port 8100",
            "ExecStart=/opt/run-note-production/current/backend/.venv/bin/uvicorn",
            "--host 127.0.0.1",
        ):
            self.assertIn(expected, unit)

    def test_web_unit_expands_port_and_depends_on_its_own_api(self):
        unit = self.text("runnote-production-web.service")
        for expected in (
            "User=run_note",
            "Environment=PORT=3100",
            "Environment=HOST=127.0.0.1",
            "EnvironmentFile=/etc/run-note-production/frontend.env",
            "After=network.target runnote-production-api.service",
            "Wants=runnote-production-api.service",
        ):
            self.assertIn(expected, unit)

    def test_nothing_of_the_legacy_installation_leaks_into_the_instance_units(self):
        for name in (
            "runnote-production-api.service",
            "runnote-production-web.service",
            "runnote-production-backup.service",
        ):
            text = self.text(name)
            for legacy in (
                "/opt/run-note/",
                "/etc/run-note/",
                "/var/backups/run-note/",
                "User=runnote\n",
                "Group=runnote\n",
                "port 8000",
                "PORT=3000",
                "runnote-api",
                "runnote-web",
            ):
                self.assertNotIn(legacy, text, f"{name} mentions {legacy!r}")
            self.assertNotIn("@@", text)

    def test_backup_unit_carries_the_instance_and_its_own_directories(self):
        unit = self.text("runnote-production-backup.service")
        for expected in (
            "Environment=RUNNOTE_INSTANCE=production",
            "EnvironmentFile=/etc/run-note-production/backup.env",
            "ReadWritePaths=/var/backups/run-note-production",
            "ExecStart=/opt/run-note-production/current/ops/backup.sh",
            "RESTIC_CACHE_DIR=/var/backups/run-note-production/.restic-cache",
            "User=postgres",
        ):
            self.assertIn(expected, unit)

    def test_backup_timer_runs_at_hong_kong_0315_without_random_delay(self):
        timer = self.text("runnote-production-backup.timer")
        self.assertIn("OnCalendar=*-*-* 03:15:00 Asia/Hong_Kong", timer)
        self.assertIn("RandomizedDelaySec=0", timer)

    def test_caddy_maintenance_never_proxies_and_live_proxies_only_its_own_ports(self):
        maintenance = self.text("production.caddy")
        self.assertIn("run.example.com {", maintenance)
        self.assertIn("503", maintenance)
        self.assertNotIn("reverse_proxy", maintenance)
        self.assertNotIn("runnote_app", maintenance)
        live_dir = Path(self.tmp.name) / "live"
        instance.render(self.values, live_dir, instance=True, caddy_mode="live")
        live = (live_dir / "production.caddy").read_text(encoding="utf-8")
        self.assertIn("import runnote_app 8100 3100", live)
        self.assertNotIn("basic_auth", live)
        self.assertNotIn("8000", live)

    def test_the_main_caddyfile_keeps_basic_auth_off_the_shared_snippet(self):
        caddyfile = (NATIVE / "Caddyfile").read_text(encoding="utf-8")
        snippet = caddyfile[
            caddyfile.index("(runnote_app) {") : caddyfile.index("{$RUNNOTE_DOMAIN} {")
        ]
        self.assertNotIn("basic_auth", snippet)
        self.assertNotIn("access.d", snippet)
        legacy_site = caddyfile[caddyfile.index("{$RUNNOTE_DOMAIN} {") :]
        self.assertIn("import runnote_app 8000 3000", legacy_site)
        self.assertIn("import /etc/caddy/access.d/*.caddy", legacy_site)

    def test_a_template_with_an_unknown_placeholder_is_refused(self):
        with self.assertRaises(instance.ConfigError):
            instance.render_template("User=@@NOT_A_KEY@@\n", self.values, True)

    def test_shell_variables_are_quoted_assignments_with_derived_urls(self):
        out = instance.shellvars(self.values)
        self.assertIn("API_URL='http://127.0.0.1:8100'", out)
        self.assertIn("WEB_URL='http://127.0.0.1:3100'", out)
        self.assertIn("SERVICE_API='runnote-production-api'", out)


OFFLINE_SCRIPTS = ("site-owner.py", "osm-places.py", "backfill-place-titles.py")


def make_release_tree(root: Path) -> Path:
    """The layout build-release.sh ships: ops/ at the top, everything else under infra/native/."""
    release = root / "release"
    shutil.copytree(OPS, release / "ops", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(
        NATIVE, release / "infra" / "native", ignore=shutil.ignore_patterns("__pycache__", "tests")
    )
    for stub in ("backend/app", "backend/migrations", "frontend/build", "scripts"):
        (release / stub).mkdir(parents=True, exist_ok=True)
    (release / "backend" / "alembic.ini").write_text("[alembic]\n")
    (release / "backend" / "requirements.lock").write_text("\n")
    (release / "frontend" / "build" / "index.js").write_text("\n")
    for script in OFFLINE_SCRIPTS:
        path = release / "scripts" / script
        path.write_text("\n")
        path.chmod(0o755)
    (release / "RELEASE").write_text("id=test\n")
    return release


def run_tool(release: Path, *args: str, cwd: str = "/") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(release / "ops" / "instance.py"), *args],
        capture_output=True,
        text=True,
        cwd=cwd,
    )


class ReleaseLayout(unittest.TestCase):
    """The tooling must work from the unpacked release, not only from a repository checkout."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.release = make_release_tree(self.root)

    def test_templates_are_found_in_the_release_layout_from_any_working_directory(self):
        out = self.root / "legacy"
        for cwd in ("/", self.tmp.name, str(self.release / "infra")):
            result = run_tool(self.release, "render", "--legacy", "--out", str(out), cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
        for name in (
            "runnote-api.service",
            "runnote-web.service",
            "runnote-backup.service",
            "runnote-backup.timer",
        ):
            self.assertEqual((out / name).read_text(), (NATIVE / name).read_text(), name)

    def test_an_instance_renders_from_the_release_layout(self):
        conf = self.root / "instances"
        conf.mkdir()
        shutil.copy(
            self.release / "infra/native/instances/production.conf.example",
            conf / "production.conf",
        )
        for mode in ("maintenance", "live"):
            out = self.root / f"out-{mode}"
            result = run_tool(
                self.release,
                "render",
                "production",
                "--dir",
                str(conf),
                "--out",
                str(out),
                "--caddy-mode",
                mode,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(list(out.iterdir())), 5)

    def test_candidates_are_derived_from_the_script_location_only(self):
        candidates = instance.template_candidates(self.release / "ops")
        self.assertEqual(
            candidates,
            [self.release / "templates", self.release / "infra" / "native" / "templates"],
        )
        self.assertEqual(
            instance.find_templates(self.release / "ops"), self.release / "infra/native/templates"
        )
        self.assertEqual(instance.find_templates(OPS), NATIVE / "templates")  # repository layout

    def test_a_missing_template_directory_is_refused_with_both_locations_named(self):
        shutil.rmtree(self.release / "infra" / "native" / "templates")
        result = run_tool(self.release, "render", "--legacy", "--out", str(self.root / "x"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(str(self.release / "templates"), result.stderr)
        self.assertIn(str(self.release / "infra" / "native" / "templates"), result.stderr)
        self.assertFalse((self.root / "x").exists(), "a failed render must leave nothing behind")

    def test_one_missing_template_is_refused_and_named(self):
        (self.release / "infra/native/templates/caddy-live.in").unlink()
        result = run_tool(self.release, "render", "--legacy", "--out", str(self.root / "x"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("caddy-live.in", result.stderr)

    def test_an_incomplete_first_location_falls_through_to_a_complete_second_one(self):
        (self.release / "templates").mkdir()
        (self.release / "templates" / "api.service.in").write_text("broken")
        self.assertEqual(
            instance.find_templates(self.release / "ops"), self.release / "infra/native/templates"
        )

    def test_a_wrong_layout_is_not_papered_over(self):
        # ops/ moved somewhere with no templates anywhere near it
        lonely = self.root / "lonely" / "ops"
        shutil.copytree(self.release / "ops", lonely)
        result = subprocess.run(
            [
                sys.executable,
                str(lonely / "instance.py"),
                "render",
                "--legacy",
                "--out",
                str(self.root / "y"),
            ],
            capture_output=True,
            text=True,
            cwd="/",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no complete template directory", result.stderr)

    def test_a_template_with_a_broken_placeholder_is_refused(self):
        path = self.release / "infra/native/templates/api.service.in"
        path.write_text(path.read_text() + "X=@@NO_SUCH_KEY@@\n")
        result = run_tool(self.release, "render", "--legacy", "--out", str(self.root / "z"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("NO_SUCH_KEY", result.stderr)


class VerifyRelease(unittest.TestCase):
    """verify-release.sh is the gate build-release.sh applies to every tarball."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def pack(self, release: Path) -> Path:
        tarball = self.root / "release.tar.gz"
        with tarfile.open(tarball, "w:gz") as archive:
            archive.add(release, arcname="rel-1")
        return tarball

    def verify(self, tarball: Path) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(OPS / "verify-release.sh"), str(tarball)], capture_output=True, text=True
        )

    def test_a_complete_release_passes(self):
        release = make_release_tree(self.root)
        result = self.verify(self.pack(release))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("self-contained", result.stderr)

    def test_every_missing_resource_is_refused_and_named(self):
        victims = [
            "ops/init-instance.sh",
            "ops/set-site-mode.sh",
            "ops/instance.py",
            "ops/lib.sh",
            "infra/native/templates/backup.timer.in",
            "infra/native/templates/caddy-maintenance.in",
            "infra/native/instances/production.conf.example",
            "infra/native/Caddyfile",
            "infra/native/runnote-api.service",
            "scripts/site-owner.py",
            "scripts/osm-places.py",
            "scripts/backfill-place-titles.py",
        ]
        for victim in victims:
            with self.subTest(missing=victim):
                shutil.rmtree(self.root / "release", ignore_errors=True)
                release = make_release_tree(self.root)
                (release / victim).unlink()
                result = self.verify(self.pack(release))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(Path(victim).name, result.stderr)

    def test_a_non_executable_or_broken_script_is_refused(self):
        release = make_release_tree(self.root)
        (release / "ops/deploy.sh").chmod(0o644)
        self.assertNotEqual(self.verify(self.pack(release)).returncode, 0)
        shutil.rmtree(self.root / "release")
        release = make_release_tree(self.root)
        (release / "ops/rollback.sh").write_text("#!/usr/bin/env bash\nif then\n")
        (release / "ops/rollback.sh").chmod(0o755)
        result = self.verify(self.pack(release))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("syntax", result.stderr)

    def test_offline_scripts_must_be_executable_and_compile(self):
        for script in OFFLINE_SCRIPTS:
            with self.subTest(script=script, defect="not executable"):
                shutil.rmtree(self.root / "release", ignore_errors=True)
                release = make_release_tree(self.root)
                (release / "scripts" / script).chmod(0o644)
                result = self.verify(self.pack(release))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"scripts/{script} is not executable", result.stderr)
            with self.subTest(script=script, defect="syntax error"):
                shutil.rmtree(self.root / "release", ignore_errors=True)
                release = make_release_tree(self.root)
                (release / "scripts" / script).write_text("def broken(:\n")
                result = self.verify(self.pack(release))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"scripts/{script} does not compile", result.stderr)

    def test_a_caddyfile_that_cannot_host_instances_is_refused(self):
        release = make_release_tree(self.root)
        caddyfile = release / "infra/native/Caddyfile"
        caddyfile.write_text(caddyfile.read_text().replace("import /etc/caddy/sites.d/*.caddy", ""))
        result = self.verify(self.pack(release))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sites.d", result.stderr)

    def test_a_drifted_legacy_template_is_refused(self):
        release = make_release_tree(self.root)
        path = release / "infra/native/runnote-web.service"
        path.write_text(path.read_text().replace("Restart=on-failure", "Restart=always"))
        result = self.verify(self.pack(release))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("runnote-web.service", result.stderr)

    def test_a_missing_file_or_empty_archive_is_refused(self):
        self.assertNotEqual(self.verify(self.root / "nope.tar.gz").returncode, 0)


class LibInInstanceMode(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        write_conf(self.dir, "production")
        self.env = {"RUNNOTE_INSTANCE": "production", "RUNNOTE_INSTANCES_DIR": str(self.dir)}

    def test_every_value_comes_from_the_instance_file(self):
        out = bash(
            '. ./lib.sh; echo "$RUNNOTE_ROOT|$RUNNOTE_ETC|$BACKUP_DIR|$APP_USER|$API_URL|$WEB_URL|${SERVICES[*]}|$BACKEND_ENV|$FRONTEND_ENV|$BACKUP_ENV|$DB_NAME|$DB_ROLE"',  # noqa: E501
            **self.env,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(
            out.stdout.strip(),
            "/opt/run-note-production|/etc/run-note-production|/var/backups/run-note-production|run_note|http://127.0.0.1:8100"  # noqa: E501
            "|http://127.0.0.1:3100|runnote-production-api runnote-production-web|/etc/run-note-production/backend.env"  # noqa: E501
            "|/etc/run-note-production/frontend.env|/etc/run-note-production/backup.env|run_note|run_note",  # noqa: E501
        )

    def test_a_conflicting_override_in_the_environment_is_an_error(self):
        for name, value in {
            "RUNNOTE_ROOT": "/opt/run-note",
            "RUNNOTE_ETC": "/etc/run-note",
            "BACKUP_DIR": "/x",
            "APP_USER": "runnote",
            "API_URL": "http://127.0.0.1:8000",
            "BACKEND_ENV": "/etc/run-note/backend.env",
        }.items():
            with self.subTest(name=name):
                out = bash(". ./lib.sh; echo reached", **self.env, **{name: value})
                self.assertNotEqual(out.returncode, 0)
                self.assertNotIn("reached", out.stdout)
                self.assertIn(name, out.stderr)

    def test_an_unknown_or_invalid_instance_never_falls_back_to_the_legacy_layout(self):
        for env in ({"RUNNOTE_INSTANCE": "missing"}, {"RUNNOTE_INSTANCE": "../etc"}):
            out = bash(". ./lib.sh; echo reached", RUNNOTE_INSTANCES_DIR=str(self.dir), **env)
            self.assertNotEqual(out.returncode, 0)
            self.assertNotIn("reached", out.stdout)

    def test_database_guard_accepts_only_the_instance_database(self):
        ok = bash(". ./lib.sh; PGDATABASE=run_note assert_instance_database; echo fine", **self.env)
        self.assertEqual(ok.stdout.strip(), "fine")
        for wrong in ("runnote", "runnote_rehearsal", ""):
            bad = bash(
                f'. ./lib.sh; PGDATABASE="{wrong}" assert_instance_database; echo reached',
                **self.env,
            )
            self.assertNotEqual(bad.returncode, 0, wrong)
            self.assertNotIn("reached", bad.stdout)

    def test_database_guard_is_inert_without_an_instance(self):
        out = bash(". ./lib.sh; PGDATABASE=anything assert_instance_database; echo fine")
        self.assertEqual(out.stdout.strip(), "fine")

    def test_expectations_handed_to_envfile_are_the_instances_own(self):
        out = bash(
            ". ./lib.sh; instance_check_args backend; instance_check_args frontend", **self.env
        )
        self.assertEqual(
            out.stdout.split(),
            [
                "--expect-db-name",
                "run_note",
                "--expect-db-user",
                "run_note",
                "--expect-origin-host",
                "run.example.com",
                "--expect-api-port",
                "8100",
            ],
        )
        legacy = bash(". ./lib.sh; instance_check_args backend; instance_check_args frontend")
        self.assertEqual(legacy.stdout.strip(), "")


class EnvFileExpectations(unittest.TestCase):
    GOOD = {
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql+psycopg://run_note:s3cretpw@127.0.0.1:5432/run_note",
        "SITE_ORIGIN": "https://run.example.com",
        "SITE_OWNER_EMAIL": "owner@example.test",
        "AUTH_RATE_HASH_KEY": "k" * 40,
        "AUTH_TRUSTED_PROXIES": '["127.0.0.1"]',
    }

    def argv(self, *extra):
        return ["check", "f", "--kind", "backend", *extra]

    def test_matching_values_pass(self):
        args = self.argv(
            "--expect-db-name",
            "run_note",
            "--expect-db-user",
            "run_note",
            "--expect-origin-host",
            "run.example.com",
        )
        self.assertEqual(envfile.instance_problems(self.GOOD, "backend", args), [])
        self.assertEqual(
            envfile.instance_problems(
                {"INTERNAL_API_BASE_URL": "http://127.0.0.1:8100"},
                "frontend",
                ["check", "f", "--expect-api-port", "8100"],
            ),
            [],
        )

    def test_another_instances_database_role_origin_or_port_is_refused_without_echoing_the_password(
        self,
    ):
        cases = [
            (self.argv("--expect-db-name", "other"), "database"),
            (self.argv("--expect-db-user", "other"), "role"),
            (self.argv("--expect-origin-host", "staging.example.com"), "SITE_ORIGIN"),
        ]
        for args, word in cases:
            problems = envfile.instance_problems(self.GOOD, "backend", args)
            self.assertTrue(problems and word in problems[0], (args, problems))
            self.assertNotIn("s3cretpw", " ".join(problems))
        wrong_port = envfile.instance_problems(
            {"INTERNAL_API_BASE_URL": "http://127.0.0.1:8000"},
            "frontend",
            ["check", "f", "--expect-api-port", "8100"],
        )
        self.assertTrue(wrong_port)

    def test_without_expectations_nothing_is_checked(self):
        self.assertEqual(envfile.instance_problems(self.GOOD, "backend", ["check", "f"]), [])


if __name__ == "__main__":
    unittest.main()
