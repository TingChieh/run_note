"""The application version and, on a deployed release, how that release was built.

The version is ``[project] version`` in backend/pyproject.toml, which every release ships.
build-release.sh writes ``RELEASE`` (``key=value`` lines) at the release root, next to
``backend/``. A source checkout has no such file, so there ``build`` is None.
"""

import re
import tomllib
from functools import cache
from pathlib import Path

from app.modules.version.schema import VersionBuild, VersionInfo

BACKEND = Path(__file__).resolve().parents[3]
RELEASE_FILE = BACKEND.parent / "RELEASE"

VERSION = re.compile(r"\d+\.\d+\.\d+")
RELEASE_ID = re.compile(r"\d{14}-[0-9a-f]{12}(-dirty)?")
GIT_SHA = re.compile(r"[0-9a-f]{12}(-dirty)?")
BUILT_AT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def app_version(pyproject: Path = BACKEND / "pyproject.toml") -> str:
    version = tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"]["version"]
    if not VERSION.fullmatch(version):
        raise RuntimeError(f"{pyproject}: version {version!r} is not MAJOR.MINOR.PATCH")
    return version


def release_build(release_file: Path = RELEASE_FILE) -> VersionBuild | None:
    """The build recorded in a release's RELEASE file; None when absent or not well formed."""
    try:
        lines = release_file.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return None
    fields = dict(line.split("=", 1) for line in lines if "=" in line)
    id_, sha, built = fields.get("id", ""), fields.get("git_sha", ""), fields.get("built_at", "")
    if not (RELEASE_ID.fullmatch(id_) and GIT_SHA.fullmatch(sha) and BUILT_AT.fullmatch(built)):
        return None
    return VersionBuild(release_id=id_, git_sha=sha, built_at=built)


@cache
def version_info() -> VersionInfo:
    # A running process never changes release: deploying restarts it.
    return VersionInfo(version=app_version(), build=release_build())
