"""The version has one source (backend/pyproject.toml); RELEASE says how a release was built."""

import json
from pathlib import Path

import pytest

from app.modules.version import service

REPO = Path(__file__).resolve().parents[3]
RELEASE = (
    "id=20261119163755-2d1d6c553e57\n"
    "git_sha=2d1d6c553e57\n"
    "built_at=2026-11-19T16:37:55Z\n"
    "node=v24.1.0\n"
)


def test_the_frontend_package_declares_the_backend_version():
    declared = json.loads((REPO / "frontend/package.json").read_text())["version"]
    assert declared == service.app_version(), (
        "backend/pyproject.toml is the single source of the version; "
        "set frontend/package.json to the same value"
    )


def test_a_version_must_be_major_minor_patch(tmp_path):
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text('[project]\nname = "x"\nversion = "1.0"\n')
    with pytest.raises(RuntimeError, match="MAJOR.MINOR.PATCH"):
        service.app_version(pyproject)
    pyproject.write_text('[project]\nname = "x"\nversion = "1.0.0"\n')
    assert service.app_version(pyproject) == "1.0.0"


def test_a_release_file_is_read_into_the_build(tmp_path):
    release = tmp_path / "RELEASE"
    release.write_text(RELEASE)
    build = service.release_build(release)
    assert build.model_dump() == {
        "release_id": "20261119163755-2d1d6c553e57",
        "git_sha": "2d1d6c553e57",
        "built_at": "2026-11-19T16:37:55Z",
    }


def test_a_source_checkout_has_no_build(tmp_path):
    assert service.release_build(tmp_path / "RELEASE") is None


@pytest.mark.parametrize(
    "damage",
    [
        ("id=20261119163755-2d1d6c553e57", "id=not-a-release"),
        ("git_sha=2d1d6c553e57", "git_sha=<script>"),
        ("built_at=2026-11-19T16:37:55Z", "built_at=yesterday"),
        ("built_at=2026-11-19T16:37:55Z\n", ""),
    ],
)
def test_a_malformed_release_file_yields_no_build(tmp_path, damage):
    release = tmp_path / "RELEASE"
    release.write_text(RELEASE.replace(*damage))
    assert service.release_build(release) is None


def test_build_release_writes_the_keys_the_reader_expects():
    script = (REPO / "infra/native/ops/build-release.sh").read_text()
    for key in ("id=$id", "git_sha=$sha", "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"):
        assert key in script, f"build-release.sh no longer writes `{key}` into RELEASE"
