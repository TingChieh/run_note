"""scripts/verify.py must run what CI runs, so a green local run predicts a green pull request.

backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
"""

import glob
import importlib.util
import os
import re
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("verify", REPO / "scripts" / "verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)

# Commands in these jobs that check the code (setup steps such as installs are not compared).
JOBS = ("backend", "frontend", "frontend-ui", "frontend-ui-extended", "infra")
CHECKS = re.compile(
    r"^(\.venv/bin/(ruff|pytest)|pnpm (test|check|build|exec playwright)|shellcheck|"
    r"backend/\.venv/bin/python -m unittest)\b"
)
# Output-only flags that legitimately differ between CI and a terminal.
NOISE = re.compile(r"^(-q|-v|-rs|--junitxml=.*|--reporter=.*)$")


def ci_commands() -> dict[str, list[str]]:
    jobs, current = {}, None
    for line in (REPO / ".github/workflows/ci.yml").read_text().splitlines():
        job = re.match(r"^  ([\w-]+):\s*$", line)
        if job:
            current = job.group(1)
            jobs[current] = []
        run = re.match(r"^\s+(?:- )?run: (.+)$", line)
        if run and current and CHECKS.match(run.group(1)):
            jobs[current].append(run.group(1))
    return {job: jobs.get(job, []) for job in JOBS}


def normalise(argv: list[str], cwd: Path) -> str:
    tokens = []
    for token in argv:
        if NOISE.match(token):
            continue
        if token.startswith(str(REPO)):  # absolute interpreter path in verify.py
            token = os.path.relpath(token, cwd)
        if "*" in token:
            tokens += sorted(os.path.relpath(p, cwd) for p in glob.glob(str(cwd / token)))
        else:
            tokens.append(token)
    return " ".join(tokens)


class CiParity(unittest.TestCase):
    def test_every_ci_check_is_in_the_full_local_plan(self):
        with mock.patch.object(verify.shutil, "which", return_value="/usr/bin/shellcheck"):
            steps, _ = verify.plan(set(verify.AREAS), True, {})
        local = {normalise(step.argv, step.cwd) for step in steps}
        commands = ci_commands()
        self.assertTrue(
            all(commands.values()), f"no check commands parsed for some job: {commands}"
        )
        cwd = {"backend": REPO / "backend", "infra": REPO}
        for job, runs in commands.items():
            for command in runs:
                expected = normalise(command.split(), cwd.get(job, REPO / "frontend"))
                self.assertIn(
                    expected, local, f"ci.yml job {job!r} runs `{command}`; add it to verify.py"
                )

    def test_quick_plan_reports_skipped_integration_tests_instead_of_hiding_them(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("TEST_DATABASE_URL", None)
            steps, notes = verify.plan({"backend"}, False, None)
        self.assertIn([".venv/bin/pytest", "tests/unit", "-q"], [s.argv for s in steps])
        self.assertTrue(any(name == "integration tests" for _, name, _ in notes))

    def test_e2e_runs_only_against_a_test_database_and_migrates_first_when_asked(self):
        db = {"TEST_DATABASE_URL": "postgresql+psycopg://x@h/y_test"}
        steps, _ = verify.plan({"frontend"}, False, db, migrate=True, e2e=True)
        self.assertEqual(steps[0].argv[-3:], [".venv/bin/alembic", "upgrade", "head"])
        self.assertEqual(steps[0].env["DATABASE_URL"], db["TEST_DATABASE_URL"])
        e2e = [s for s in steps if s.argv[:2] == ["pnpm", "test:e2e"]]
        self.assertEqual(len(e2e), 1)
        self.assertEqual(e2e[0].env, db)
        steps, notes = verify.plan({"frontend"}, True, None)
        self.assertFalse([s for s in steps if s.argv[:2] == ["pnpm", "test:e2e"]])
        self.assertTrue(any(name == "real-backend e2e" for _, name, _ in notes))

    def test_test_database_must_be_an_isolated_test_database(self):
        with self.assertRaises(SystemExit), mock.patch("sys.stderr"):
            verify.main(["--test-db", "running_note"])


if __name__ == "__main__":
    unittest.main()
