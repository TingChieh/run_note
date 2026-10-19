import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.admin_users.service import admin_view
from app.modules.site_settings.model import DEFAULTS, SiteImage, SiteSettings
from app.modules.site_settings.schema import SitePatch
from app.modules.users.model import User, UserAvatar
from app.modules.users.service import view


def load_migration():
    path = Path(__file__).parents[2] / "migrations/versions/0012_site_settings.py"
    spec = importlib.util.spec_from_file_location("site_settings_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_models_match_constraints():
    assert SiteSettings.__table__.c.title.type.length == 40
    assert SiteSettings.__table__.c.description.type.length == 200
    assert {c.name for c in SiteImage.__table__.constraints if c.name} >= {
        "ck_site_images_kind_valid"
    }
    fk = next(iter(UserAvatar.__table__.c.user_id.foreign_keys))
    assert fk.ondelete == "CASCADE" and fk.column.table.name == "users"
    assert User.__table__.c.avatar_version.nullable
    assert DEFAULTS["title"] == "RunNote" and DEFAULTS["default_theme"] == "system"


def test_migration_chain_and_defensive_downgrade(monkeypatch):
    migration = load_migration()
    assert migration.revision == "0012_site_settings"
    assert migration.down_revision == "0011_admin_user_states"
    op = Mock()
    monkeypatch.setattr(migration, "op", op)
    op.get_bind.return_value.execute.return_value.scalar.return_value = True
    with pytest.raises(RuntimeError):
        migration.downgrade()
    op.drop_table.assert_not_called()
    op.drop_column.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": "   "},
        {"title": "x" * 41},
        {"subtitle": "x" * 41},
        {"footer_tagline": "x" * 81},
        {"description": "x" * 201},
        {"default_theme": "blue"},
        {"title": "ok", "logo_url": "/x"},
    ],
)
def test_site_patch_rejects(payload):
    with pytest.raises(ValidationError):
        SitePatch.model_validate(payload)


def test_site_patch_strips_and_allows_empty_optional_text():
    patch = SitePatch.model_validate({"title": "  晨跑站  ", "subtitle": "  "})
    assert patch.model_dump(exclude_unset=True) == {"title": "晨跑站", "subtitle": ""}


def person(version):
    return SimpleNamespace(
        id=uuid4(),
        email_normalized="p@example.com",
        username="person",
        display_name="P",
        timezone="UTC",
        bio="",
        profile_is_public=False,
        is_active=True,
        showcase_enabled=False,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        avatar_version=version,
    )


def test_user_view_avatar_url_points_to_own_endpoint_and_admin_list_hides_it():
    settings = SimpleNamespace(site_owner_email="owner@example.com")
    assert view(person(None), settings).avatar_url is None
    assert view(person("0123456789abcdef"), settings).avatar_url == (
        "/api/v1/me/avatar?v=0123456789abcdef"
    )
    assert admin_view(person("0123456789abcdef"), settings).avatar_url is None
