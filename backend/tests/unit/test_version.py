"""The version has one source (root VERSION); RELEASE says how a release was built."""

import importlib.util
import json
import re
import sys
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


def _load_version_tool():
    spec = importlib.util.spec_from_file_location(
        "runnote_version_tool", REPO / "scripts/version.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_root_version_is_the_single_source_for_backend():
    root_version = (REPO / "VERSION").read_text(encoding="utf-8").strip()
    assert service.app_version() == root_version, (
        "VERSION is the single source of truth; run `python3 scripts/version.py sync`"
    )


def test_the_frontend_package_declares_the_backend_version():
    declared = json.loads((REPO / "frontend/package.json").read_text(encoding="utf-8"))["version"]
    assert declared == service.app_version(), (
        "VERSION is the single source of truth; run `python3 scripts/version.py sync`"
    )


def test_the_android_package_declares_the_backend_version():
    declared = json.loads((REPO / "android/package.json").read_text(encoding="utf-8"))["version"]
    assert declared == service.app_version(), (
        "VERSION is the single source of truth; run `python3 scripts/version.py sync`"
    )


def test_the_android_app_declares_the_backend_version():
    tool = _load_version_tool()
    gradle = (REPO / "android/native/app/build.gradle").read_text(encoding="utf-8")
    names = re.findall(r'^\s*versionName\s+"([^"]+)"\s*$', gradle, re.MULTILINE)
    codes = re.findall(r"^\s*versionCode\s+(\d+)\s*$", gradle, re.MULTILINE)
    expected_name = service.app_version()
    expected_code = tool.android_version_code(expected_name)

    assert names == [expected_name], (
        "VERSION is the single source of truth; "
        f"set android/native/app/build.gradle versionName to {expected_name!r}"
    )
    assert codes == [str(expected_code)], (
        "android/native/app/build.gradle versionCode must match the monotonic SemVer formula "
        f"({expected_code}); run `python3 scripts/version.py sync`"
    )


def test_version_tool_reports_no_drift():
    tool = _load_version_tool()
    assert tool.check_consistency(REPO) == []


@pytest.mark.parametrize(
    "valid_version",
    [
        "1.0.0",
        "2.6.1",
        "2.6.10",
        "2.7.0",
        "2.10.0",
        "2.11.0",
        "2.99.0",
        "2.7.0-alpha.1",
        "2.7.0-beta.2",
        "2.10.0-rc.1",
        "2.99.0-rc.1",
    ],
)
def test_a_version_accepts_semver_and_prereleases(tmp_path, valid_version):
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(f'[project]\nname = "x"\nversion = "{valid_version}"\n', encoding="utf-8")
    assert service.app_version(pyproject) == valid_version


@pytest.mark.parametrize(
    "bad_version",
    [
        "1.0",
        "v1.0.0",
        "01.0.0",
        "2.010.0",
        "2.6.010",
        "2.06.1",
        "2.1\u0660.0",
        "2.7.0-rc.1\u0661",
        "1.0.0-alpha.0",
        "1.0.0-alpha.01",
        "1.0.0-dev.1",
        "1.0.0+build.1",
    ],
)
def test_a_version_rejects_invalid_semver(tmp_path, bad_version):
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(f'[project]\nname = "x"\nversion = "{bad_version}"\n', encoding="utf-8")
    with pytest.raises(RuntimeError, match="MAJOR.MINOR.PATCH"):
        service.app_version(pyproject)


def test_a_release_file_is_read_into_the_build(tmp_path):
    release = tmp_path / "RELEASE"
    release.write_text(RELEASE, encoding="utf-8")
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
    release.write_text(RELEASE.replace(*damage), encoding="utf-8")
    assert service.release_build(release) is None


def test_build_release_writes_the_keys_the_reader_expects():
    script = (REPO / "infra/native/ops/build-release.sh").read_text(encoding="utf-8")
    for key in ("id=$id", "git_sha=$sha", "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"):
        assert key in script, f"build-release.sh no longer writes `{key}` into RELEASE"
