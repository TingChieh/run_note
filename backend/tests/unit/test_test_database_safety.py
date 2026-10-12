from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core import config

pytest_plugins = ["pytester"]
DEV = "postgresql+psycopg://user:fake-password@127.0.0.1:5432/running_note"
TEST = "postgresql+psycopg://user:fake-password@127.0.0.1:5432/running_note_test"
TARGET = "127.0.0.1:5432/running_note_test"


def settings(**overrides):
    cls = getattr(config, "IntegrationSettings", None)
    assert cls is not None, "IntegrationSettings safety validation is missing"
    return cls(
        _env_file=None,
        **{
            "database_url": DEV,
            "test_database_url": TEST,
            "test_database_allowed_targets": TARGET,
            **overrides,
        },
    )


def test_explicitly_allowed_separate_database_is_accepted():
    assert settings().test_database_url == TEST


@pytest.mark.parametrize(
    "overrides",
    [
        {"test_database_url": DEV, "test_database_allowed_targets": "127.0.0.1:5432/running_note"},
        {"database_url": TEST},
        {"database_url": TEST.replace("127.0.0.1", "localhost")},
        {"database_url": TEST.replace("5432", "55432")},
        {"test_database_allowed_targets": ""},
        {"test_database_allowed_targets": "127.0.0.1:55432/running_note_test"},
        {"test_database_allowed_targets": "127.0.0.1:5432/another_test"},
        {"test_database_url": TEST + "?dbname=running_note"},
        {"test_database_url": TEST + "?host=another-host"},
        {"database_url": DEV + "?service=other-database"},
        {"test_database_url": "sqlite:///running_note_test"},
    ],
)
def test_unsafe_database_target_is_rejected(overrides):
    with pytest.raises(ValidationError) as error:
        settings(**overrides)
    assert "fake-password" not in str(error.value)


def test_default_port_and_multiple_allowed_targets():
    value = settings(
        test_database_url=TEST.replace(":5432", ""),
        test_database_allowed_targets="other:5432/other_test, " + TARGET,
    )
    assert value.test_database_url


@pytest.mark.parametrize("scope", ["module", "session"])
@pytest.mark.parametrize("development", [DEV, TEST])
def test_database_guard_blocks_fixture_before_any_ddl(pytester, monkeypatch, scope, development):
    # Removing the guard would run this module fixture and create the marker.
    source = Path(__file__).parents[1] / "conftest.py"
    assert source.exists(), "pre-DDL integration guard is missing"
    pytester.makeconftest(source.read_text())
    marker = pytester.path / "ddl-attempted"
    pytester.makepyfile(
        test_guard=f"""
import pytest
from pathlib import Path
pytestmark = pytest.mark.integration
@pytest.fixture(scope={scope!r})
def database_url():
    Path({str(marker)!r}).write_text("DDL attempted")
    return "unsafe"
def test_ddl(database_url):
    assert False, "unsafe fixture must not run"
"""
    )
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).parents[2]))
    monkeypatch.setenv("DATABASE_URL", development)
    monkeypatch.setenv("TEST_DATABASE_URL", development)
    monkeypatch.setenv(
        "TEST_DATABASE_ALLOWED_TARGETS",
        TARGET if development == TEST else "127.0.0.1:5432/running_note",
    )
    result = pytester.runpytest_subprocess("-q", "--strict-markers", "-o", "markers=integration")
    assert result.ret != 0
    assert not marker.exists()
    result.stdout.fnmatch_lines(["*Unsafe integration database configuration*"])
