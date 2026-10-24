import os
import stat
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.exc import DBAPIError, OperationalError

from app.modules.place_titles import backfill, service


def test_default_log_dir_honours_xdg_state_home(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    assert backfill.default_log_dir() == tmp_path / "run_note" / "place-titles"


def test_default_log_dir_falls_back_outside_the_repo(monkeypatch, tmp_path):
    monkeypatch.delenv("XDG_STATE_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    result = backfill.default_log_dir()
    assert result == tmp_path / ".local" / "state" / "run_note" / "place-titles"
    repo = Path(__file__).resolve().parents[3]
    assert not backfill.is_inside(result, repo)
    assert backfill.is_inside(repo / "x", repo)


def test_a_relative_xdg_state_home_is_ignored(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_STATE_HOME", "relative")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert backfill.default_log_dir().is_relative_to(tmp_path)


def test_private_dir_and_log_are_owner_only(tmp_path):
    target = tmp_path / "a" / "b"
    backfill.ensure_private_dir(target)
    assert stat.S_IMODE(os.stat(target).st_mode) == 0o700
    log = target / "place-titles-x.json"
    backfill._write_log(log, [{"activity_id": "x"}])
    assert stat.S_IMODE(os.stat(log).st_mode) == 0o600
    backfill._write_log(log, [])  # rewriting keeps the mode and leaves no temp file
    assert stat.S_IMODE(os.stat(log).st_mode) == 0o600
    assert not (target / "place-titles-x.json.tmp").exists()


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores directory permissions")
def test_an_unwritable_directory_fails_with_oserror(tmp_path):
    tmp_path.chmod(0o500)
    try:
        with pytest.raises(OSError):
            backfill._write_log(tmp_path / "log.json", [])
    finally:
        tmp_path.chmod(0o700)


def test_summaries_are_chinese_and_complete():
    apply = {"applied": 3, "changed_meanwhile": 1, "unmatched": 4, "failed": 2}
    assert backfill.format_summary("apply", apply) == (
        "已改名 3 条 / 期间已被修改 1 条 / 失败 2 条 / 未命中 4 条"
    )
    revert = {"reverted": 5, "skipped": 1, "failed": 0}
    assert "已还原 5 条" in backfill.format_summary("revert", revert)
    assert "失败 0 条" in backfill.format_summary("revert", revert)
    with pytest.raises(ValueError):
        backfill.format_summary("other", {})


def test_preview_summary_counts_every_reason():
    def proposal(reason):
        return backfill.Proposal(uuid4(), uuid4(), None, "t", None, None, None, reason)

    text = backfill.format_preview(
        [proposal(r) for r in ("matched", "matched", "no_match", "too_short", "retry")]
    )
    assert text == (
        "候选 5 条：命中 2 条，附近无地物 1 条，太短 1 条，标题已被改过 0 条，"
        "测量超时 1 条，测量出错 0 条"
    )


class FakeOrig(Exception):
    def __init__(self, sqlstate=None):
        self.sqlstate = sqlstate


def test_transient_errors_are_retried_and_others_are_not():
    assert service._is_transient(OperationalError("s", {}, FakeOrig()))
    invalid = DBAPIError("s", {}, FakeOrig(), connection_invalidated=True)
    assert service._is_transient(invalid)
    assert service._is_transient(DBAPIError("s", {}, FakeOrig("08006")))
    assert service._is_transient(DBAPIError("s", {}, FakeOrig("40P01")))
    assert not service._is_transient(DBAPIError("s", {}, FakeOrig("22012")))
    assert not service._is_transient(RuntimeError("boom"))
