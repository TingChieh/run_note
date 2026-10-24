"""Offline tests for ops/ship.py: configuration, the local refusals, the CI verdict and the whole
orchestration against a scripted stand-in for the server. No SSH, network or real repository.

    backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
"""

import importlib.util
import re
import subprocess
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("ship", REPO / "infra" / "native" / "ops" / "ship.py")
ship = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ship)

CONF = """INSTANCE=production
DOMAIN=run.example.com
ROOT=/opt/run-note-production
ETC=/etc/run-note-production
BACKUP_DIR=/var/backups/run-note-production
APP_USER=run_note
DB_NAME=run_note
API_PORT=8100
WEB_PORT=3100
SERVICE_API=runnote-production-api
SERVICE_WEB=runnote-production-web
SERVICE_BACKUP=runnote-production-backup
"""


def run_git(cwd, *args):
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


def make_repos(root: Path):
    """A bare origin and a clone on main with two commits: the 'deployed' one and a newer one."""
    origin, clone = root / "origin.git", root / "clone"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    subprocess.run(["git", "clone", "-q", str(origin), str(clone)], check=True, capture_output=True)
    for key, value in (
        ("user.name", "t"),
        ("user.email", "t@example.com"),
        ("commit.gpgsign", "false"),
    ):
        run_git(clone, "config", key, value)
    (clone / "backend" / "migrations" / "versions").mkdir(parents=True)
    (clone / "backend" / "migrations" / "versions" / "0001_a.py").write_text("x = 1\n")
    (clone / "app.txt").write_text("v1\n")
    run_git(clone, "add", ".")
    run_git(clone, "commit", "-qm", "deployed")
    run_git(clone, "push", "-q", "origin", "HEAD:main")
    run_git(clone, "branch", "-q", "--set-upstream-to=origin/main")
    return clone


def sha_of(repo, ref="HEAD"):
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", ref], capture_output=True, text=True, check=True
    ).stdout.strip()


def commit(repo, name="app.txt", text="v2\n", message="change"):
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    run_git(repo, "add", ".")
    run_git(repo, "commit", "-qm", message)
    run_git(repo, "push", "-q", "origin", "HEAD:main")


class Config(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.file = Path(self.tmp.name) / "deploy.env"

    def test_the_server_address_is_required_and_never_has_a_repository_default(self):
        with self.assertRaises(ship.Refuse) as ctx:
            ship.load_config({}, self.file)
        self.assertIn("RUNNOTE_SSH_HOST", str(ctx.exception))

    def test_defaults_file_and_environment_precedence(self):
        self.file.write_text("# c\nRUNNOTE_SSH_HOST=from-file\nRUNNOTE_INSTANCE=staging\n")
        values = ship.load_config({"RUNNOTE_SSH_HOST": "from-env"}, self.file)
        self.assertEqual(values["RUNNOTE_SSH_HOST"], "from-env")
        self.assertEqual(values["RUNNOTE_INSTANCE"], "staging")
        self.assertEqual(
            ship.load_config({"RUNNOTE_SSH_HOST": "h"}, self.file)["RUNNOTE_STAGE_DIR"],
            "/root/run-note-stage",
        )

    def test_unsafe_values_are_refused(self):
        for env in (
            {"RUNNOTE_SSH_HOST": "-oProxyCommand=evil"},
            {"RUNNOTE_SSH_HOST": "host; rm -rf /"},
            {"RUNNOTE_SSH_HOST": "h", "RUNNOTE_INSTANCE": "Prod uction"},
            {"RUNNOTE_SSH_HOST": "h", "RUNNOTE_STAGE_DIR": "relative/dir"},
            {"RUNNOTE_SSH_HOST": "h", "RUNNOTE_STAGE_DIR": "/tmp/x y"},
        ):
            with self.subTest(env=env), self.assertRaises(ship.Refuse):
                ship.load_config(env, self.file)

    def test_the_instance_definition_must_be_complete_and_plain(self):
        self.assertEqual(ship.parse_instance_conf(CONF)["DOMAIN"], "run.example.com")
        with self.assertRaises(ship.Refuse):
            ship.parse_instance_conf(CONF.replace("DB_NAME=run_note\n", ""))
        with self.assertRaises(ship.Refuse):
            ship.parse_instance_conf(CONF.replace("DOMAIN=run.example.com", "DOMAIN=a;b"))


class Git(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = make_repos(Path(self.tmp.name))

    def test_a_clean_current_main_is_accepted(self):
        self.assertEqual(ship.preflight(self.repo), sha_of(self.repo))

    def test_uncommitted_changes_a_feature_branch_and_a_stale_main_are_refused(self):
        (self.repo / "app.txt").write_text("dirty\n")
        with self.assertRaises(ship.Refuse) as ctx:
            ship.preflight(self.repo)
        self.assertIn("uncommitted", str(ctx.exception))
        run_git(self.repo, "checkout", "-q", "--", "app.txt")
        run_git(self.repo, "checkout", "-q", "-b", "feature")
        with self.assertRaises(ship.Refuse) as ctx:
            ship.preflight(self.repo)
        self.assertIn("not 'main'", str(ctx.exception))
        run_git(self.repo, "checkout", "-q", "main")
        (self.repo / "local.txt").write_text("x\n")
        run_git(self.repo, "add", ".")
        run_git(self.repo, "commit", "-qm", "local only")
        with self.assertRaises(ship.Refuse) as ctx:
            ship.preflight(self.repo)
        self.assertIn("differs from origin/main", str(ctx.exception))

    def test_migration_changes_are_detected_between_deployed_and_target(self):
        deployed = sha_of(self.repo)
        commit(self.repo, "docs.md", "d\n", "docs only")
        self.assertEqual(ship.migrations_changed(self.repo, deployed, sha_of(self.repo)), [])
        commit(self.repo, "backend/migrations/versions/0002_b.py", "x = 2\n", "migration")
        self.assertEqual(
            ship.migrations_changed(self.repo, deployed, sha_of(self.repo)),
            ["backend/migrations/versions/0002_b.py"],
        )

    def test_an_unknown_or_non_ancestor_deployed_commit_is_a_refusal_not_a_guess(self):
        with self.assertRaises(ship.Refuse):
            ship.migrations_changed(self.repo, "1234567", sha_of(self.repo))
        old = sha_of(self.repo)
        commit(self.repo)
        with self.assertRaises(ship.Refuse) as ctx:
            ship.migrations_changed(self.repo, sha_of(self.repo), old)  # going backwards
        self.assertIn("rollback", str(ctx.exception))

    def test_the_repository_is_derived_from_origin_only_when_it_is_a_github_url(self):
        self.assertEqual(ship.repo_slug(self.repo, "me/repo"), "me/repo")
        with self.assertRaises(ship.Refuse):
            ship.repo_slug(self.repo, None)  # the origin here is a local path
        run_git(self.repo, "remote", "set-url", "origin", "https://github.com/someone/project.git")
        self.assertEqual(ship.repo_slug(self.repo, None), "someone/project")


class CI(unittest.TestCase):
    def verdict(self, runs, jobs):
        def fetch(url, token):
            self.assertEqual(token, "TOKEN")
            return {"workflow_runs": runs} if "actions/runs?" in url else {"jobs": jobs}

        return ship.ci_verdict("o/r", "abc", fetch=fetch, token_fn=lambda: "TOKEN")

    def test_all_green_and_skipped_jobs_pass(self):
        runs = [{"id": 1, "status": "completed", "jobs_url": "j"}]
        jobs = [{"name": "a", "conclusion": "success"}, {"name": "mac", "conclusion": "skipped"}]
        self.assertEqual(self.verdict(runs, jobs), [])

    def test_failures_running_jobs_and_a_missing_run_are_reported(self):
        done = [{"id": 1, "status": "completed", "jobs_url": "j"}]
        self.assertIn(
            "job 'x' ended 'failure'",
            self.verdict(done, [{"name": "x", "conclusion": "failure"}])[0],
        )
        self.assertIn(
            "still in_progress",
            self.verdict([{"id": 2, "status": "in_progress", "jobs_url": "j"}], [])[0],
        )
        self.assertIn("no CI run", self.verdict([], [])[0])


class FakeRemote:
    """Answers the commands ship.py sends and records everything, in order."""

    def __init__(
        self,
        host,
        deployed,
        conf=CONF,
        counts_before="3 1 0013",
        counts_after="3 1 0013",
        release="REL",
        deploy_text="deploy complete: REL",
        ready="200",
        active="active,active",
        backup_ok=True,
    ):
        self.host, self.log, self.pushed = host, [], []
        self.deployed, self.conf, self.release = deployed, conf, release
        self.counts = [counts_before, counts_after]
        self.deploy_text, self.ready, self.active, self.backup_ok = (
            deploy_text,
            ready,
            active,
            backup_ok,
        )

    def run(self, script, check=True):
        self.log.append(script)
        if "cat /etc/run-note-instances/" in script:
            return self.conf
        if "git_sha=" in script:
            return self.deployed + "\n"
        if "select (select count(*)" in script:
            return self.counts.pop(0) + "\n"
        if "systemctl start" in script:
            if not self.backup_ok:
                raise ship.Failed("backup unit failed")
            return ""
        if "deploy.sh" in script:
            return self.deploy_text
        if "echo release=" in script:
            return f"release={self.release}\nmarker=yes\nactive={self.active}\nold_procs=0\nready={self.ready}\nwarnings=0\n"  # noqa: E501
        return ""

    def push(self, local, remote_dir):
        self.pushed.append((tuple(p.name for p in local), remote_dir))
        self.log.append("PUSH")


class Orchestration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = make_repos(Path(self.tmp.name))
        self.deployed = sha_of(self.repo)
        commit(self.repo)
        self.target = sha_of(self.repo)
        self.tarball = Path(self.tmp.name) / "run-note-REL.tar.gz"
        self.tarball.write_bytes(b"x")
        Path(str(self.tarball) + ".sha256").write_text("x  run-note-REL.tar.gz\n")
        self.env = {"RUNNOTE_SSH_HOST": "srv", "RUNNOTE_GITHUB_REPO": "o/r"}
        self.built = []

    def go(
        self,
        remote=None,
        ci=lambda *a, **k: [],
        confirm=lambda q: True,
        public=lambda url: 200,
        **flags,
    ):
        args = Namespace(
            migrate=flags.get("migrate", False),
            dry_run=flags.get("dry_run", False),
            yes=flags.get("yes", False),
            wait_ci=0,
        )
        remote = remote or FakeRemote("srv", self.deployed)
        self.remote = remote
        code = ship.ship(
            args,
            self.env,
            self.repo,
            remote_factory=lambda host: remote,
            ci=ci,
            build=lambda repo: (self.built.append(1), self.tarball)[1],
            confirm=confirm,
            public=public,
        )
        return code

    def touched_server(self):
        return any(
            entry in ("PUSH",) or "deploy.sh" in entry or "systemctl start" in entry
            for entry in self.remote.log
        )

    def test_a_full_successful_ship_runs_the_steps_in_order(self):
        self.assertEqual(self.go(), 0)
        log = self.remote.log
        push = log.index("PUSH")
        backup = next(i for i, e in enumerate(log) if "systemctl start" in e)
        deploy = next(i for i, e in enumerate(log) if "deploy.sh" in e)
        verify = next(i for i, e in enumerate(log) if "echo release=" in e)
        self.assertLess(push, backup)
        self.assertLess(backup, deploy)
        self.assertLess(deploy, verify)
        self.assertIn("RUNNOTE_INSTANCE='production'", log[deploy])
        self.assertNotIn("--migrate", log[deploy])
        self.assertEqual(
            self.remote.pushed[0][0], ("run-note-REL.tar.gz", "run-note-REL.tar.gz.sha256")
        )

    def test_a_dry_run_builds_but_never_touches_the_server_beyond_reading(self):
        self.assertEqual(self.go(dry_run=True), 0)
        self.assertEqual(self.built, [1])
        self.assertFalse(self.touched_server())

    def test_red_or_unfinished_ci_refuses_before_anything_else(self):
        with self.assertRaises(ship.Refuse) as ctx:
            self.go(ci=lambda *a, **k: ["job 'infra' ended 'failure'"])
        self.assertIn("CI", str(ctx.exception))
        self.assertEqual(self.built, [])
        self.assertEqual(self.remote.log, [])

    def test_a_migration_needs_the_explicit_flag_and_then_reaches_deploy_sh(self):
        commit(self.repo, "backend/migrations/versions/0002_b.py", "x = 2\n", "migration")
        self.target = sha_of(self.repo)
        with self.assertRaises(ship.Refuse) as ctx:
            self.go()
        self.assertIn("--migrate", str(ctx.exception))
        self.assertFalse(self.touched_server())
        self.assertEqual(self.go(migrate=True), 0)
        deploy = next(e for e in self.remote.log if "deploy.sh" in e)
        self.assertIn("deploy.sh' --migrate ", deploy)

    def test_an_already_deployed_commit_is_refused(self):
        remote = FakeRemote("srv", self.target)
        with self.assertRaises(ship.Refuse) as ctx:
            self.go(remote=remote)
        self.assertIn("already deployed", str(ctx.exception))

    def test_without_confirmation_nothing_is_uploaded(self):
        with self.assertRaises(ship.Refuse):
            self.go(confirm=lambda q: False)
        self.assertFalse(self.touched_server())
        self.assertEqual(self.go(confirm=lambda q: False, yes=True), 0)

    def test_a_failing_backup_stops_before_deploy(self):
        with self.assertRaises(ship.Failed):
            self.go(remote=FakeRemote("srv", self.deployed, backup_ok=False))
        self.assertFalse(any("deploy.sh" in e for e in self.remote.log))

    def test_an_unfinished_deploy_is_a_failure_with_a_pointer_to_the_logs(self):
        with self.assertRaises(ship.Failed) as ctx:
            self.go(remote=FakeRemote("srv", self.deployed, deploy_text="SMOKE TEST FAILED"))
        self.assertIn("journalctl", str(ctx.exception))

    def test_verification_catches_data_loss_unhealthy_services_and_public_errors(self):
        cases = [
            (dict(counts_after="2 1 0013"), lambda url: 200, "data went DOWN"),
            (dict(active="active,failed"), lambda url: 200, "not both active"),
            (dict(ready="503"), lambda url: 200, "loopback ready check"),
            ({}, lambda url: 502, "returned 502"),
            (dict(release="OTHER"), lambda url: 200, "expected"),
        ]
        for kwargs, public, expected in cases:
            with self.subTest(expected=expected), self.assertRaises(ship.Failed) as ctx:
                self.go(remote=FakeRemote("srv", self.deployed, **kwargs), public=public)
            self.assertIn(expected, str(ctx.exception))
            self.assertIn("rollback.sh previous", str(ctx.exception))

    def test_more_activities_after_the_deploy_are_normal_not_a_failure(self):
        self.assertEqual(
            self.go(remote=FakeRemote("srv", self.deployed, counts_after="5 1 0013")), 0
        )

    def test_nothing_personal_is_baked_into_the_tool(self):
        """ship.py and this test carry no literal personal value: patterns only, plus whatever the
        local private config (outside the repository) names, when that file exists."""
        patterns = [
            r"[\w.+-]+@(?!example\.(?:com|org)\b)[\w-]+\.\w+",  # any e-mail except placeholders
            r"/Users/\w+",  # a home directory
            r"\b(?!127\.)\d{1,3}(?:\.\d{1,3}){3}\b",  # a non-loopback IPv4 literal
        ]
        private = Path.home() / ".config" / "run-note" / "deploy.env"
        if private.is_file():
            for line in private.read_text().splitlines():
                key, _, value = line.partition("=")
                value = value.strip().strip("'\"")
                if key.strip().endswith(("HOST", "DOMAIN", "EMAIL")) and len(value) >= 4:
                    patterns.append(re.escape(value))
        for path in (REPO / "infra" / "native" / "ops" / "ship.py", Path(__file__)):
            text = path.read_text()
            for pattern in patterns:
                self.assertIsNone(re.search(pattern, text), f"{path.name} contains a personal value")


if __name__ == "__main__":
    unittest.main()
