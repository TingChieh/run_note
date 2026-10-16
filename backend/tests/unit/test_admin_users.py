from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.core.errors import ApiError
from app.modules.auth import service as auth
from app.modules.users.service import view


def user():
    return SimpleNamespace(
        id=uuid4(),
        email_normalized="person@example.com",
        username="person",
        display_name="Person",
        timezone="UTC",
        bio="",
        profile_is_public=False,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        is_active=False,
        showcase_enabled=False,
        password_hash="hash",
    )


def test_effective_owner_flags_use_configured_email():
    person = user()
    settings = SimpleNamespace(site_owner_email=person.email_normalized)
    result = view(person, settings)
    assert result.is_admin and result.showcase_enabled
    settings.site_owner_email = "different@example.com"
    result = view(person, settings)
    assert not result.is_admin and not result.showcase_enabled


def test_enabled_ordinary_user_can_login(monkeypatch):
    person = user()
    person.is_active = True
    db = Mock()
    db.scalar.return_value = person
    monkeypatch.setattr(auth, "verify_password", lambda *_: True)
    monkeypatch.setattr(
        auth, "PASSWORD_HASHER", SimpleNamespace(check_needs_rehash=lambda *_: False)
    )
    monkeypatch.setattr(auth, "rotate", lambda *_: ("session", "token"))
    result = auth.login(
        db,
        None,
        SimpleNamespace(email=person.email_normalized, password="x"),
        datetime(2026, 1, 1, tzinfo=UTC),
        "owner@example.com",
    )
    assert result == (person, "session", "token")


def test_disabled_ordinary_user_rejected(monkeypatch):
    db = Mock()
    db.scalar.return_value = user()
    monkeypatch.setattr(auth, "verify_password", lambda *_: True)
    with pytest.raises(ApiError) as error:
        auth.login(
            db,
            None,
            SimpleNamespace(email="person@example.com", password="x"),
            datetime(2026, 1, 1, tzinfo=UTC),
            "owner@example.com",
        )
    assert error.value.code == "INVALID_CREDENTIALS"


def test_disabled_session_rejected_after_locked_user_refresh(monkeypatch):
    now = datetime(2026, 1, 1, tzinfo=UTC)
    person = user()
    row = SimpleNamespace(
        user_id=person.id, revoked_at=None, expires_at=now.replace(day=2), last_seen_at=now
    )
    db = Mock()
    db.scalar.return_value = person
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(settings=SimpleNamespace(site_owner_email="owner@example.com"))
        )
    )
    monkeypatch.setattr(auth, "find_session", lambda *_: row)
    with pytest.raises(ApiError) as error:
        auth.require_identity(db, request, now)
    assert error.value.status_code == 401
    db.refresh.assert_called_once_with(row)


@pytest.mark.parametrize(
    "changes", [{"email": "else@example.com"}, {"is_active": False}, {"showcase_enabled": False}]
)
def test_owner_protected_from_admin_mutations(changes):
    from app.modules.admin_users.schema import UserPatch
    from app.modules.admin_users.service import patch

    person = user()
    db = Mock()
    db.scalar.return_value = person
    with pytest.raises(ApiError) as error:
        patch(
            db,
            person.id,
            UserPatch(**changes),
            SimpleNamespace(site_owner_email=person.email_normalized),
            person.created_at,
        )
    assert error.value.code == "OWNER_PROTECTED"
    db.flush.assert_not_called()


def test_disabling_clears_public_opt_in_and_revokes_sessions():
    from app.modules.admin_users.schema import UserPatch
    from app.modules.admin_users.service import patch

    person = user()
    person.is_active = person.showcase_enabled = True
    person.activity_data_version = 2
    db = Mock()
    db.scalar.return_value = person
    result = patch(
        db,
        person.id,
        UserPatch(is_active=False),
        SimpleNamespace(site_owner_email="owner@example.com"),
        person.created_at,
    )
    assert not result.is_active and not result.showcase_enabled
    assert person.activity_data_version == 3
    db.execute.assert_called_once()


@pytest.mark.parametrize(
    "active,public,allowed", [(False, True, False), (True, False, False), (True, True, True)]
)
def test_named_showcase_requires_both_opt_ins(active, public, allowed):
    from app.modules.showcase.service import named_owner

    person = user()
    person.is_active, person.showcase_enabled = active, public
    db = Mock()
    db.scalar.return_value = person
    settings = SimpleNamespace(site_owner_email="owner@example.com")
    if allowed:
        assert named_owner(db, settings, person.username) is person
    else:
        with pytest.raises(ApiError) as error:
            named_owner(db, settings, person.username)
        assert error.value.status_code == 404


def test_patch_rejects_null_empty_unknown_username_and_invalid_timezone():
    from pydantic import ValidationError

    from app.modules.admin_users.schema import UserPatch

    for payload in (
        {},
        {"email": None},
        {"is_active": None},
        {"username": "changed"},
        {"timezone": "Unknown/Nowhere"},
        {"email": "invalid"},
    ):
        with pytest.raises(ValidationError):
            UserPatch(**payload)


def test_duplicate_email_is_domain_error():
    from sqlalchemy.exc import IntegrityError

    from app.modules.admin_users.service import flush_user

    db = Mock()
    db.flush.side_effect = IntegrityError(
        "insert",
        {},
        SimpleNamespace(diag=SimpleNamespace(constraint_name="uq_users_email_normalized")),
    )
    with pytest.raises(ApiError) as error:
        flush_user(db)
    assert error.value.code == "EMAIL_EXISTS"
    db.rollback.assert_called_once()


def test_legacy_public_view_rejects_disabled_but_preserves_configured_owner():
    from app.modules.sharing.service import public_view

    person = user()
    db = Mock()
    db.get.return_value = person
    activity = SimpleNamespace(
        user_id=person.id,
        id=uuid4(),
        title="Synthetic",
        activity_date=datetime(2026, 1, 1).date(),
        distance_m=1,
        avg_pace_seconds_per_km=None,
        timer_seconds=None,
        elapsed_seconds=1,
    )
    with pytest.raises(ApiError):
        public_view(db, activity, SimpleNamespace(site_owner_email="different@example.com"))
    result = public_view(db, activity, SimpleNamespace(site_owner_email=person.email_normalized))
    assert "email" not in result.model_dump()["author"]


def test_named_route_rechecks_switch_and_uses_same_whitelist():
    from fastapi.testclient import TestClient

    from app.api.dependencies import get_session
    from app.core.config import Settings
    from app.main import create_app

    app = create_app(
        Settings(
            database_url="postgresql+psycopg://synthetic@127.0.0.1:1/unused_test",
            site_owner_email="owner@example.com",
            _env_file=None,
        )
    )
    person = user()
    person.is_active = person.showcase_enabled = True
    db = Mock()
    db.scalar.return_value = person
    app.dependency_overrides[get_session] = lambda: db
    client = TestClient(app)
    path = "/api/v1/showcase/users/person/profile"
    response = client.get(path)
    assert response.status_code == 200
    assert response.json()["data"] == {"display_name": "Person", "timezone": "UTC"}
    person.showcase_enabled = False
    assert client.get(path).status_code == 404
    assert client.get(path + "?owner=someone").status_code == 422


def test_password_reset_protects_owner_and_revokes_ordinary_sessions(monkeypatch):
    from app.modules.admin_users import service
    from app.modules.admin_users.schema import PasswordReset

    person = user()
    person.activity_data_version = 0
    db = Mock()
    db.scalar.return_value = person
    payload = PasswordReset(new_password="synthetic-new-password")
    with pytest.raises(ApiError) as error:
        service.reset_password(
            db,
            person.id,
            payload,
            SimpleNamespace(site_owner_email=person.email_normalized),
            person.created_at,
        )
    assert error.value.code == "OWNER_PROTECTED"
    monkeypatch.setattr(service, "hash_password", lambda _: "new-hash")
    result = service.reset_password(
        db,
        person.id,
        payload,
        SimpleNamespace(site_owner_email="owner@example.com"),
        person.created_at,
    )
    assert result == {"password_reset": True} and person.password_hash == "new-hash"
    db.execute.assert_called_once()


def test_migration_false_defaults_and_defensive_downgrade(monkeypatch):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).parents[2] / "migrations/versions/0011_admin_user_states.py"
    spec = importlib.util.spec_from_file_location("admin_states_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    op = Mock()
    monkeypatch.setattr(migration, "op", op)
    migration.upgrade()
    assert [call.args[1].name for call in op.add_column.call_args_list] == [
        "is_active",
        "showcase_enabled",
    ]
    for call in op.add_column.call_args_list:
        assert call.args[1].nullable is False
        assert str(call.args[1].server_default.arg) == "false"
    op.get_bind.return_value.execute.return_value.scalar.return_value = True
    with pytest.raises(RuntimeError):
        migration.downgrade()
    op.drop_column.assert_not_called()
