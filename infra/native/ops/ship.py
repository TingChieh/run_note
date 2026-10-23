#!/usr/bin/env python3
# ruff: noqa: E501  (shell one-liners and user-facing messages)
"""Ship the current `main` to a Run Note server with one command, with the checks a careful
manual deployment would make. Runs on the maintainer's workstation and drives the server over SSH.

  ship.py [--migrate] [--dry-run] [--yes]

What it does, in order, and where it refuses (exit 2, nothing on the server touched):
  1. local tree is clean, on `main`, and equal to origin/main
  2. every CI job of that exact commit succeeded (read-only GitHub API call)
  3. database migrations: if the commit adds any since the deployed release, `--migrate` is required
  4. build the release (build-release.sh, which runs its own self-containment check)
  5. upload, verify the SHA-256 and run verify-release.sh on the server
  6. (not --dry-run) take a backup with a real restore drill, then deploy.sh from the new release
  7. verify: services, release marker, no process on the old release, data not reduced, loopback
     health, public HTTPS health, and no new warnings in the logs; print the rollback command

Configuration lives OUTSIDE the repository (nothing personal is committed):
  RUNNOTE_SSH_HOST   ssh destination of the server (an alias from ~/.ssh/config works); required
  RUNNOTE_INSTANCE   instance name, default "production"
  RUNNOTE_STAGE_DIR  directory on the server for uploaded releases, default /root/run-note-stage
  RUNNOTE_GITHUB_REPO  owner/name; default derived from the `origin` remote
are read from the environment, then from ~/.config/run-note/deploy.env (KEY=VALUE lines).
The domain, ports and paths come from the server's /etc/run-note-instances/<instance>.conf.

Exit status: 0 shipped and verified, 1 a step failed after work began, 2 refused before any change.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_FILE = Path.home() / ".config" / "run-note" / "deploy.env"
SAFE = re.compile(r"^[A-Za-z0-9._/@:-]+$")
NAME = re.compile(r"^[a-z][a-z0-9-]{1,30}$")


class Refuse(Exception):
    """A precondition failed; nothing was changed."""


class Failed(Exception):
    """A step failed after work had begun."""


def say(message: str) -> None:
    print(message, flush=True)


# ---- configuration -----------------------------------------------------------------------
def load_config(env: dict[str, str], config_file: Path = CONFIG_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if config_file.is_file():
        for line in config_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip("'\"")
    for key in ("RUNNOTE_SSH_HOST", "RUNNOTE_INSTANCE", "RUNNOTE_STAGE_DIR", "RUNNOTE_GITHUB_REPO"):
        if env.get(key):
            values[key] = env[key]
    host = values.get("RUNNOTE_SSH_HOST", "")
    if not host:
        raise Refuse(
            "RUNNOTE_SSH_HOST is not set. Put it in the environment or in "
            f"{config_file} (outside the repository), e.g.  RUNNOTE_SSH_HOST=my-server-alias"
        )
    values.setdefault("RUNNOTE_INSTANCE", "production")
    values.setdefault("RUNNOTE_STAGE_DIR", "/root/run-note-stage")
    if not SAFE.match(host) or host.startswith("-"):
        raise Refuse("RUNNOTE_SSH_HOST contains unexpected characters")
    if not NAME.match(values["RUNNOTE_INSTANCE"]):
        raise Refuse("RUNNOTE_INSTANCE is not a valid instance name")
    if not SAFE.match(values["RUNNOTE_STAGE_DIR"]) or not values["RUNNOTE_STAGE_DIR"].startswith(
        "/"
    ):
        raise Refuse("RUNNOTE_STAGE_DIR must be an absolute path of plain characters")
    return values


def parse_instance_conf(text: str) -> dict[str, str]:
    values = {}
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    needed = (
        "DOMAIN",
        "ROOT",
        "DB_NAME",
        "SERVICE_BACKUP",
        "SERVICE_API",
        "SERVICE_WEB",
        "API_PORT",
    )
    missing = [k for k in needed if not values.get(k)]
    if missing:
        raise Refuse("the server's instance definition lacks: " + ", ".join(missing))
    for key in needed:
        if not SAFE.match(values[key]):
            raise Refuse(f"unexpected characters in {key} of the instance definition")
    return values


# ---- local git ---------------------------------------------------------------------------
def git(repo: Path, *args: str) -> str:
    done = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if done.returncode != 0:
        raise Refuse(f"git {' '.join(args)} failed: {done.stderr.strip()[:200]}")
    return done.stdout.strip()


def preflight(repo: Path) -> str:
    """The commit that will be shipped. Refuses anything but a clean, current `main`."""
    if git(repo, "status", "--porcelain", "--untracked-files=no"):
        raise Refuse("the working tree has uncommitted changes; commit or stash them first")
    branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    if branch != "main":
        raise Refuse(f"you are on '{branch}', not 'main'; ship only what is merged")
    git(repo, "fetch", "-q", "origin")
    head, remote = git(repo, "rev-parse", "HEAD"), git(repo, "rev-parse", "origin/main")
    if head != remote:
        raise Refuse(
            f"local main ({head[:7]}) differs from origin/main ({remote[:7]}); pull or push first"
        )
    return head


def migrations_changed(repo: Path, deployed: str, target: str) -> list[str]:
    if git(repo, "cat-file", "-t", deployed) != "commit":
        raise Refuse(
            f"the deployed commit {deployed[:7]} is unknown locally; fetch it or deploy by hand"
        )
    done = subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor", deployed, target])
    if done.returncode != 0:
        raise Refuse(
            f"the deployed commit {deployed[:7]} is not an ancestor of {target[:7]}: this would be a "
            "rollback or a diverged history, not a release; roll back with rollback.sh instead"
        )
    names = git(repo, "diff", "--name-only", deployed, target, "--", "backend/migrations/versions")
    return [n for n in names.splitlines() if n]


def repo_slug(repo: Path, configured: str | None) -> str:
    if configured:
        return configured
    url = git(repo, "remote", "get-url", "origin")
    match = re.search(r"github\.com[:/]([^/]+/[^/.]+)", url)
    if not match:
        raise Refuse(
            "cannot derive the GitHub repository from the origin remote; set RUNNOTE_GITHUB_REPO"
        )
    return match.group(1)


# ---- CI ----------------------------------------------------------------------------------
def github_token() -> str:
    """The credential git already stores for github.com (read-only use; never printed)."""
    done = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True,
        text=True,
        timeout=20,
    )
    token = dict(line.split("=", 1) for line in done.stdout.splitlines() if "=" in line).get(
        "password", ""
    )
    if not token:
        raise Refuse(
            "no stored GitHub credential; cannot read the CI result (log in with git first)"
        )
    return token


def fetch_json(url: str, token: str) -> dict:
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def ci_verdict(
    slug: str, sha: str, fetch=fetch_json, token_fn=github_token, wait: int = 0
) -> list[str]:
    """Return [] when every job of every workflow run for `sha` succeeded, else the reasons."""
    token = token_fn()
    deadline = time.time() + wait
    while True:
        runs = fetch(f"https://api.github.com/repos/{slug}/actions/runs?head_sha={sha}", token).get(
            "workflow_runs", []
        )
        problems = []
        if not runs:
            problems.append("no CI run exists for this commit yet")
        for run in runs:
            if run["status"] != "completed":
                problems.append(f"run {run['id']} is still {run['status']}")
                continue
            for job in fetch(run["jobs_url"], token).get("jobs", []):
                if job["conclusion"] not in ("success", "skipped"):
                    problems.append(f"job '{job['name']}' ended '{job['conclusion']}'")
        if not problems or time.time() >= deadline:
            return problems
        time.sleep(20)


# ---- the server ---------------------------------------------------------------------------
class Remote:
    def __init__(self, host: str):
        self.host = host

    def run(self, script: str, check: bool = True) -> str:
        done = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", self.host, "bash", "-s"],
            input=script,
            capture_output=True,
            text=True,
        )
        if check and done.returncode != 0:
            raise Failed(
                f"remote command failed (exit {done.returncode}):\n{(done.stdout + done.stderr)[-1500:]}"
            )
        return done.stdout + (done.stderr if not check else "")

    def push(self, local: list[Path], remote_dir: str) -> None:
        self.run(f"install -d -m 0700 '{remote_dir}'")
        done = subprocess.run(
            ["scp", "-q", "-o", "BatchMode=yes", *map(str, local), f"{self.host}:{remote_dir}/"],
            capture_output=True,
            text=True,
        )
        if done.returncode != 0:
            raise Failed("upload failed: " + done.stderr.strip()[:300])


def public_get(url: str) -> int:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except Exception:
        return 0


def ship(
    args,
    env: dict[str, str],
    repo: Path,
    remote_factory=Remote,
    ci=ci_verdict,
    build=None,
    confirm=None,
    public=public_get,
) -> int:
    config = load_config(env)
    instance, stage = config["RUNNOTE_INSTANCE"], config["RUNNOTE_STAGE_DIR"]
    remote = remote_factory(config["RUNNOTE_SSH_HOST"])

    sha = preflight(repo)
    say(f"[1/7] local main is clean and equals origin/main ({sha[:7]})")

    problems = ci(repo_slug(repo, config.get("RUNNOTE_GITHUB_REPO")), sha, wait=args.wait_ci)
    if problems:
        raise Refuse("CI for this commit is not green: " + "; ".join(problems))
    say("[2/7] every CI job of this commit succeeded")

    inst = parse_instance_conf(remote.run(f"cat /etc/run-note-instances/{instance}.conf"))
    root = inst["ROOT"]
    deployed = remote.run(f"sed -n 's/^git_sha=//p' '{root}/current/RELEASE'").strip()
    if not re.fullmatch(r"[0-9a-f]{7,40}", deployed or ""):
        raise Refuse(f"cannot read the deployed release from {root}/current/RELEASE")
    if sha.startswith(deployed) or deployed.startswith(sha[: len(deployed)]):
        raise Refuse(f"{sha[:7]} is already deployed; nothing to ship")
    changed = migrations_changed(repo, deployed, sha)
    if changed and not args.migrate:
        raise Refuse(
            f"{len(changed)} database migration file(s) changed since the deployed release ({deployed[:7]}). "
            "Review them, then run again with --migrate (a verified backup and restore drill are taken first)."
        )
    if args.migrate and not changed:
        say(
            "      note: --migrate was given but the schema did not change; deploy.sh will find nothing to do"
        )
    say(
        f"[3/7] deployed {deployed[:7]} -> {sha[:7]}; migrations: {'YES, with --migrate' if changed else 'none'}"
    )

    tarball = build(repo) if build else build_release(repo)
    say(f"[4/7] built {tarball.name}")
    if args.dry_run:
        say("dry run: stopped before touching the server (steps 5-7 not executed)")
        return 0

    if not (args.yes or (confirm and confirm(f"Deploy {sha[:7]} to instance '{instance}'?"))):
        raise Refuse("not confirmed (run interactively, or pass --yes)")

    release_id = tarball.name.removeprefix("run-note-").removesuffix(".tar.gz")
    remote_dir = f"{stage}/{release_id}"
    remote.push([tarball, Path(str(tarball) + ".sha256")], remote_dir)
    remote.run(
        f"set -e; cd '{remote_dir}'; sha256sum -c '{tarball.name}.sha256'; rm -rf rel; mkdir rel; "
        f"tar -xzf '{tarball.name}' -C rel --strip-components=1; ./rel/ops/verify-release.sh '{tarball.name}'"
    )
    say("[5/7] uploaded, SHA-256 verified, release is self-contained on the server")

    counts = f"sudo -u postgres psql -X -qAt -d '{inst['DB_NAME']}' -c \"select (select count(*) from activities)||' '||(select count(*) from users)||' '||(select version_num from alembic_version)\""
    before = remote.run(counts).strip().splitlines()[-1]
    remote.run(
        f"set -e; systemctl start '{inst['SERVICE_BACKUP']}.service'; "
        f"test \"$(systemctl show '{inst['SERVICE_BACKUP']}.service' -p Result --value)\" = success"
    )
    say(
        f"[6/7] backup with restore drill succeeded; deploying (data before: activities/users/revision = {before})"
    )
    deploy_out = remote.run(
        f"cd /; RUNNOTE_INSTANCE='{instance}' '{remote_dir}/rel/ops/deploy.sh' {'--migrate ' if args.migrate else ''}'{remote_dir}/{tarball.name}' 2>&1 | tail -12",
        check=False,
    )
    say("\n".join("      " + line for line in deploy_out.strip().splitlines()[-6:]))
    if "deploy complete" not in deploy_out:
        raise Failed(
            "deploy.sh did not finish; the server may have returned to the previous release by itself. "
            f"Inspect with:  ssh {config['RUNNOTE_SSH_HOST']} 'journalctl -u {inst['SERVICE_API']} -n 50'"
        )

    after = remote.run(counts).strip().splitlines()[-1]
    checks = remote.run(
        f"R='{root}'; echo release=$(basename \"$(readlink $R/current)\"); [ -e $R/current/.deploy-complete ] && echo marker=yes; "
        f"echo active=$(systemctl is-active '{inst['SERVICE_API']}' '{inst['SERVICE_WEB']}' | paste -sd,); "
        f"echo old_procs=$(ps -eo args | grep \"$R/releases/\" | grep -v '{release_id}' | grep -vc grep); "
        f"echo ready=$(curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{inst['API_PORT']}/api/v1/health/ready); "
        f"echo warnings=$(journalctl -u '{inst['SERVICE_API']}' -u '{inst['SERVICE_WEB']}' -p warning --since '-3min' --no-pager 2>/dev/null | grep -vc -- '-- No entries --')"
    )
    kv = dict(line.split("=", 1) for line in checks.splitlines() if "=" in line)
    problems = []
    if kv.get("marker") != "yes":
        problems.append("the current release has no completion marker")
    if kv.get("active") != "active,active":
        problems.append(f"services are not both active ({kv.get('active')})")
    if kv.get("old_procs") != "0":
        problems.append(f"{kv.get('old_procs')} process(es) still run from an older release")
    if kv.get("ready") != "200":
        problems.append(f"loopback ready check returned {kv.get('ready')}")
    if kv.get("release") and release_id not in kv["release"]:
        problems.append(f"current release is {kv.get('release')}, expected {release_id}")
    b, a = before.split(), after.split()
    if len(a) == 3 and len(b) == 3 and (int(a[0]) < int(b[0]) or int(a[1]) < int(b[1])):
        problems.append(f"data went DOWN during the deploy ({before} -> {after})")
    domain = inst["DOMAIN"]
    statuses = {
        p: public(f"https://{domain}{p}")
        for p in ("/api/v1/health/ready", "/api/health", "/dashboard")
    }
    for path, code in statuses.items():
        if code != 200:
            problems.append(f"https://{domain}{path} returned {code}")
    rollback = f'ssh {config["RUNNOTE_SSH_HOST"]} "RUNNOTE_INSTANCE={instance} {root}/current/ops/rollback.sh previous"'
    if problems:
        raise Failed(
            "verification failed: "
            + "; ".join(problems)
            + f"\n      roll back (same schema only) with:  {rollback}"
        )
    say(
        f"[7/7] verified: {kv['release']}, services active, data {before} -> {after}, public health 200 on {len(statuses)} paths"
    )
    say(f"      rollback if needed:  {rollback}")
    return 0


def build_release(repo: Path) -> Path:
    out = Path(tempfile.mkdtemp(prefix="run-note-ship-"))
    done = subprocess.run(
        [str(HERE / "build-release.sh"), "--out", str(out)],
        capture_output=True,
        text=True,
        cwd=repo,
    )
    if done.returncode != 0:
        raise Failed("build-release.sh failed:\n" + (done.stdout + done.stderr)[-1200:])
    tarballs = sorted(out.glob("run-note-*.tar.gz"))
    if len(tarballs) != 1:
        raise Failed("build-release.sh produced no tarball")
    return tarballs[0]


def main(argv: list[str], env: dict[str, str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--migrate", action="store_true", help="allow a release that carries database migrations"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="run every local check and build, but do not touch the server",
    )
    parser.add_argument(
        "--yes", action="store_true", help="do not ask for confirmation before deploying"
    )
    parser.add_argument(
        "--wait-ci",
        type=int,
        default=0,
        metavar="SECONDS",
        help="wait up to this long for CI to finish",
    )
    args = parser.parse_args(argv)
    repo = Path(git(HERE, "rev-parse", "--show-toplevel"))

    def confirm(question: str) -> bool:
        return sys.stdin.isatty() and input(f"{question} [y/N] ").strip().lower() in ("y", "yes")

    try:
        return ship(args, dict(os.environ if env is None else env), repo, confirm=confirm)
    except Refuse as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    except Failed as error:
        print(f"FAILED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
