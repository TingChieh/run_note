#!/usr/bin/env python3
"""Decide which CI areas a change touches, so unrelated jobs can be skipped.

  changed_areas.py                     reads EVENT_NAME, BASE_SHA, HEAD_SHA from the environment,
                                       diffs the two commits and appends backend=/frontend=/infra=
                                       lines (true|false) to $GITHUB_OUTPUT (stdout when unset)

A skipped job shows as "skipped", which ops/ship.py accepts; the workflow itself must still run for
every commit on main, otherwise ship.py refuses ("no CI run exists"). So the rule is conservative:
anything that is not clearly documentation or clearly inside one area turns every area on, and so
does a diff that cannot be computed.
"""

import os
import re
import subprocess
import sys

AREAS = ("backend", "frontend", "infra")

# Documentation only: no code runs differently because of these.
DOCS = re.compile(r"^(docs/|LICENSE$|.*\.md$)")
# Files outside an area directory that still change what a job builds or runs.
INFRA_FILES = {
    "backend/requirements.lock",
    "frontend/package.json",
    "frontend/pnpm-lock.yaml",
    "frontend/pnpm-workspace.yaml",
}
KNOWN_PREFIXES = ("backend/", "frontend/", "infra/", "scripts/", ".github/")


def classify(files: list[str]) -> dict[str, bool]:
    if not files:  # nothing to go on (re-run, empty diff): run everything
        return dict.fromkeys(AREAS, True)
    result = dict.fromkeys(AREAS, False)
    for path in files:
        if DOCS.match(path):
            continue
        if not path.startswith(KNOWN_PREFIXES):  # unknown territory: run everything
            return dict.fromkeys(AREAS, True)
        if path.startswith(".github/"):  # the CI definition itself
            return dict.fromkeys(AREAS, True)
        if path.startswith(("backend/", "scripts/")):
            result["backend"] = True
        if path.startswith("frontend/"):
            result["frontend"] = True
        # The release rehearsal packages and migrates both sides, so it also follows migrations,
        # the offline scripts and the dependency manifests.
        if path.startswith(("infra/", "backend/migrations/", "scripts/")) or path in INFRA_FILES:
            result["infra"] = True
    return result


def changed_files(event: str, base: str, head: str) -> list[str]:
    if event not in ("push", "pull_request") or not head or set(base) <= {"0"}:
        return []
    done = subprocess.run(
        ["git", "diff", "--name-only", base, head], capture_output=True, text=True
    )
    if done.returncode != 0:  # e.g. a force-pushed base that is no longer reachable
        return []
    return [line for line in done.stdout.splitlines() if line]


def main() -> int:
    env = os.environ
    files = changed_files(
        env.get("EVENT_NAME", ""), env.get("BASE_SHA", ""), env.get("HEAD_SHA", "")
    )
    result = classify(files)
    lines = [f"{area}={'true' if on else 'false'}" for area, on in result.items()]
    print(f"{len(files)} changed file(s) -> " + " ".join(lines), file=sys.stderr)
    out = env.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as handle:
            handle.write("\n".join(lines) + "\n")
    else:
        print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
