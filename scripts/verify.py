#!/usr/bin/env python3
"""One entry point for the repository's checks, for people and coding agents alike.

  scripts/verify.py                   areas touched by your branch and working tree (quick)
  scripts/verify.py --full            every area, plus production build and synthetic-browser UI
  scripts/verify.py --area frontend   only the named area(s): backend, frontend, infra
  scripts/verify.py --test-db NAME    also run backend integration tests against the isolated
                                      database NAME (must end in _test; read from .env's host)
  scripts/verify.py --e2e --test-db NAME
                                      also run the real-backend browser tests (tests/e2e)
  scripts/verify.py --list            print the plan without running it

Areas are decided by .github/scripts/changed_areas.py, the same rule CI uses, so a quick local
run covers what the pull request's CI will run. The commands mirror .github/workflows/ci.yml
(infra/native/tests/test_verify_script.py keeps them in step). Integration tests need an isolated
test database; without one pytest skips them, and the summary says so: skipped is not passed.
--full adds the real-backend browser tests whenever a test database is given.
Deployment rehearsals (ops-e2e*.sh, offsite, caddy) stay in CI and are listed as not run.

Exit status is 1 when any step fails. Nothing here writes to a database other than the
allow-listed *_test database, and nothing reads or prints secrets.
"""

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
PYTHON = BACKEND / ".venv/bin/python"
NODE_MAJOR = 24
NODE_CANDIDATES = ("/opt/homebrew/opt/node@24/bin", "/usr/local/opt/node@24/bin")
AREAS = ("backend", "frontend", "infra")

# The isolated test database's variables, derived from .env's DATABASE_URL exactly like docs/09
# "运行测试". They are passed to child processes only and never printed.
TEST_ENV = """
import json, os, sys
from sqlalchemy.engine import make_url
from app.core.config import Settings
url = make_url(Settings().database_url).set(database=os.environ["VERIFY_TEST_DB"])
json.dump({
    "TEST_DATABASE_URL": url.render_as_string(hide_password=False),
    "TEST_DATABASE_ALLOWED_TARGETS": f"{url.host}:{url.port or 5432}/{url.database}",
}, sys.stdout)
"""


@dataclass
class Step:
    area: str
    name: str
    argv: list[str]
    cwd: Path
    env: dict = field(default_factory=dict)
    status: str = "PENDING"
    detail: str = ""
    seconds: float = 0.0


def load_changed_areas():
    path = ROOT / ".github/scripts/changed_areas.py"
    spec = importlib.util.spec_from_file_location("changed_areas", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(*args: str) -> list[str]:
    done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    return done.stdout.splitlines() if done.returncode == 0 else []


def changed_files(known_prefixes: tuple[str, ...]) -> list[str]:
    base = next(iter(git("merge-base", "HEAD", "origin/main")), "")
    files = set(git("diff", "--name-only", base)) if base else set()
    files |= set(git("diff", "--name-only", "HEAD"))
    # Untracked files outside the code areas (local notes, tool folders) would otherwise make
    # every quick run a full one; CI never sees them.
    files |= {
        f for f in git("ls-files", "--others", "--exclude-standard") if f.startswith(known_prefixes)
    }
    return sorted(files)


def node_path() -> tuple[dict, str]:
    """PATH that puts a Node 24 first, the version CI and package.json require."""

    def major(binary: str | None) -> int | None:
        if not binary:
            return None
        done = subprocess.run([binary, "--version"], capture_output=True, text=True, check=False)
        match = re.match(r"v(\d+)", done.stdout.strip())
        return int(match.group(1)) if match else None

    if major(shutil.which("node")) == NODE_MAJOR:
        return {}, ""
    for directory in [os.environ.get("RUNNOTE_NODE_BIN", ""), *NODE_CANDIDATES]:
        if directory and major(str(Path(directory) / "node")) == NODE_MAJOR:
            return {"PATH": f"{directory}{os.pathsep}{os.environ['PATH']}"}, directory
    return {}, "missing"


def test_database_env(name: str) -> dict:
    done = subprocess.run(
        [str(PYTHON), "-c", TEST_ENV],
        cwd=BACKEND,
        env={**os.environ, "VERIFY_TEST_DB": name},
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode:
        raise SystemExit("cannot derive the test database from .env's DATABASE_URL")
    return json.loads(done.stdout)


def plan(
    areas: set[str], full: bool, db: dict | None, migrate: bool = False, e2e: bool = False
) -> tuple[list, list]:
    """`db` holds the test database variables ({} when they are already in the environment)."""
    steps, notes = [], []
    venv = ".venv/bin/"
    if migrate and db is not None:
        url = db.get("TEST_DATABASE_URL") or os.environ.get("TEST_DATABASE_URL", "<test database>")
        steps.append(
            Step(
                "database",
                "migrate the test database to head",
                [venv + "alembic", "upgrade", "head"],
                BACKEND,
                {**db, "DATABASE_URL": url},
            )
        )
    if areas & {"backend", "frontend"}:
        steps.append(
            Step(
                "contract",
                "generated API types are current",
                [str(PYTHON), "-m", "app.contract.typescript", "--check"],
                BACKEND,
            )
        )
    if "backend" in areas:
        steps += [
            Step(
                "backend",
                "ruff check",
                [venv + "ruff", "check", "app", "migrations", "tests"],
                BACKEND,
            ),
            Step(
                "backend",
                "ruff format --check",
                [venv + "ruff", "format", "--check", "app", "migrations", "tests"],
                BACKEND,
            ),
        ]
        if db is not None:
            steps.append(
                Step(
                    "backend",
                    "pytest (unit + integration)",
                    [venv + "pytest", "-q", "-rs"],
                    BACKEND,
                    db,
                )
            )
        else:
            steps.append(
                Step("backend", "pytest tests/unit", [venv + "pytest", "tests/unit", "-q"], BACKEND)
            )
            notes.append(
                (
                    "backend",
                    "integration tests",
                    "no --test-db / TEST_DATABASE_URL: not run (skipped is not passed)",
                )
            )
    if "frontend" in areas:
        steps += [
            Step("frontend", "vitest", ["pnpm", "test"], FRONTEND),
            Step("frontend", "svelte-check", ["pnpm", "check"], FRONTEND),
        ]
        if full:
            steps += [
                Step("frontend", "production build", ["pnpm", "build"], FRONTEND),
                Step(
                    "frontend",
                    "synthetic-API browser UI",
                    [
                        "pnpm",
                        "exec",
                        "playwright",
                        "test",
                        "--config",
                        "playwright.ui.config.ts",
                        "--reporter=line",
                    ],
                    FRONTEND,
                ),
                Step(
                    "frontend",
                    "synthetic-API browser UI (extended)",
                    [
                        "pnpm",
                        "exec",
                        "playwright",
                        "test",
                        "--config",
                        "playwright.ui-extended.config.ts",
                        "--reporter=line",
                    ],
                    FRONTEND,
                ),
            ]
        else:
            notes.append(("frontend", "build + browser UI", "only with --full"))
        if (e2e or full) and db is not None:
            steps.append(
                Step(
                    "frontend",
                    "real-backend browser e2e",
                    ["pnpm", "test:e2e", "--reporter=line"],
                    FRONTEND,
                    db,
                )
            )
        else:
            notes.append(("frontend", "real-backend e2e", "needs --e2e or --full with --test-db"))
    if "infra" in areas:
        steps.append(
            Step(
                "infra",
                "ops unit tests",
                [str(PYTHON), "-m", "unittest", "discover", "-s", "infra/native/tests"],
                ROOT,
            )
        )
        if shutil.which("shellcheck"):
            scripts = sorted(str(p.relative_to(ROOT)) for p in ROOT.glob("infra/native/ops/*.sh"))
            scripts += sorted(
                str(p.relative_to(ROOT)) for p in ROOT.glob("infra/native/tests/*.sh")
            )
            steps.append(
                Step(
                    "infra",
                    "shellcheck",
                    ["shellcheck", "-x", "--source-path=SCRIPTDIR", *scripts],
                    ROOT,
                )
            )
        else:
            notes.append(("infra", "shellcheck", "shellcheck not installed: not run"))
        notes.append(("infra", "deploy/backup rehearsals", "CI only (ops-e2e*.sh, offsite, caddy)"))
    return steps, notes


def run(step: Step, extra_env: dict) -> None:
    env = {**os.environ, **extra_env, **step.env}
    print(f"\n==> [{step.area}] {step.name}", flush=True)
    started = time.monotonic()
    try:
        process = subprocess.Popen(
            step.argv,
            cwd=step.cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError as error:
        step.status, step.detail = "FAIL", f"cannot start: {error.filename}"
        return
    summary = ""
    for line in process.stdout:
        sys.stdout.write(line)
        clean = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
        if re.search(r"\b\d+ (passed|failed|skipped|errors?)\b", clean):
            summary = clean
    code = process.wait()
    step.seconds = time.monotonic() - started
    step.status = "PASS" if code == 0 else "FAIL"
    step.detail = summary[:110]


def preflight(areas: set[str]) -> list[str]:
    problems = []
    if areas & {"backend", "frontend", "infra"} and not PYTHON.exists():
        problems.append(
            "backend/.venv missing: cd backend && python3.14 -m venv .venv && "
            ".venv/bin/pip install --require-hashes -r requirements.lock"
        )
    if "frontend" in areas and not (FRONTEND / "node_modules").exists():
        problems.append(
            "frontend/node_modules missing: cd frontend && pnpm install --frozen-lockfile"
        )
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--full", action="store_true", help="every area, with build and UI tests")
    parser.add_argument("--area", action="append", choices=AREAS, help="limit to these areas")
    parser.add_argument("--test-db", help="isolated *_test database for integration tests")
    parser.add_argument(
        "--migrate-test-db",
        action="store_true",
        help="alembic upgrade head on the --test-db database first",
    )
    parser.add_argument("--e2e", action="store_true", help="real-backend browser tests")
    parser.add_argument("--list", action="store_true", help="print the plan and exit")
    args = parser.parse_args(argv)
    if args.test_db and not args.test_db.endswith("_test"):
        parser.error("--test-db must name a database ending in _test")
    from_environment = bool(os.environ.get("TEST_DATABASE_URL"))
    if (args.migrate_test_db or args.e2e) and not (args.test_db or from_environment):
        parser.error("--migrate-test-db and --e2e need --test-db (or TEST_DATABASE_URL)")

    if args.area:
        areas, reason = set(args.area), "--area"
    elif args.full:
        areas, reason = set(AREAS), "--full"
    else:
        changed_areas = load_changed_areas()
        files = changed_files(changed_areas.KNOWN_PREFIXES)
        if not files:
            print("No changes against origin/main or in the working tree; use --full to check all.")
            return 0
        areas = {
            area for area, on in changed_areas.classify(files).items() if on and area in AREAS
        }
        reason = f"{len(files)} changed file(s)"
    if args.e2e:
        areas.add("frontend")
    print(f"Areas: {', '.join(sorted(areas)) or 'none (documentation only)'} ({reason})")

    if args.test_db:
        db = {} if args.list else test_database_env(args.test_db)
    else:
        db = {} if from_environment else None
    steps, notes = plan(areas, args.full, db, args.migrate_test_db, args.e2e)
    if args.list:
        for step in steps:
            print(
                f"  [{step.area}] {step.name}: (cd {step.cwd.relative_to(ROOT) or '.'} && "
                f"{' '.join(step.argv[:8])})"
            )
        for area, name, why in notes:
            print(f"  [{area}] {name}: NOT RUN - {why}")
        return 0
    problems = preflight(areas)
    if problems:
        print("\n".join(["Cannot run the checks:", *problems]), file=sys.stderr)
        return 1

    extra_env = {}
    if "frontend" in areas:
        extra_env, node_dir = node_path()
        if node_dir == "missing":
            print(
                f"Node {NODE_MAJOR} not found (CI and package.json engines require it); install "
                f"it or set RUNNOTE_NODE_BIN to its bin directory.",
                file=sys.stderr,
            )
            return 1
        if node_dir:
            print(f"Using Node {NODE_MAJOR} from {node_dir} for frontend steps.")
    for step in steps:
        run(step, extra_env)

    print("\nSummary")
    for step in steps:
        print(f"  {step.status:7} {step.area:9} {step.name:34} {step.seconds:6.1f}s  {step.detail}")
    for area, name, why in notes:
        print(f"  {'NOT RUN':7} {area:9} {name:34} {'':7}  {why}")
    failed = [step for step in steps if step.status != "PASS"]
    print(f"\n{'FAILED' if failed else 'OK'}: {len(steps) - len(failed)}/{len(steps)} steps passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
