from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.core.errors import ApiError
from app.modules.users import service
from app.modules.users.schema import UsernameUpdate


def test_username_validation():
    assert UsernameUpdate(username="run_123").username == "run_123"
    for value in ("ab", "a" * 31, "Runner", "run-name"):
        with pytest.raises(ValidationError):
            UsernameUpdate(username=value)


def test_username_cooldown_and_same_name(monkeypatch):
    now = datetime(2026, 1, 1, tzinfo=UTC)
    user = SimpleNamespace(username="runner", username_changed_at=now)
    db = Mock()
    monkeypatch.setattr(service, "view", lambda user, settings: user)
    assert service.change_username(db, user, "runner", now, None) is user
    db.flush.assert_not_called()
    with pytest.raises(ApiError) as caught:
        service.change_username(db, user, "other", now + timedelta(days=29), None)
    assert caught.value.status_code == 409
    assert caught.value.details[0]["available_at"] == (now + timedelta(days=30)).isoformat()
    service.change_username(db, user, "other", now + timedelta(days=30), None)
    assert user.username == "other"
    assert user.username_changed_at == now + timedelta(days=30)
    db.flush.assert_called_once()


def test_username_unique_conflict_rolls_back(monkeypatch):
    now = datetime(2026, 1, 1, tzinfo=UTC)
    user = SimpleNamespace(username="runner", username_changed_at=None)
    original = Exception("unique violation")
    original.diag = SimpleNamespace(constraint_name="uq_users_username")
    db = Mock()
    db.flush.side_effect = IntegrityError("", {}, original)
    monkeypatch.setattr(service, "view", lambda user, settings: user)
    with pytest.raises(ApiError) as caught:
        service.change_username(db, user, "taken", now, None)
    assert (caught.value.status_code, caught.value.code) == (409, "USERNAME_EXISTS")
    db.rollback.assert_called_once()
