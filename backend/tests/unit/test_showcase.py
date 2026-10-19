from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.api.dependencies import get_identity, get_session, require_admin
from app.core.config import Settings
from app.core.errors import ApiError
from app.main import create_app


def settings(**overrides):
    return Settings(
        database_url="postgresql+psycopg://synthetic@127.0.0.1:1/unused_test",
        auth_rate_hash_key="synthetic-unit-key-at-least-32-bytes",
        _env_file=None,
        **overrides,
    )


def test_registration_is_closed_without_creating_a_user():
    app = create_app(settings())
    db = Mock()
    app.dependency_overrides[get_session] = lambda: db
    response = TestClient(app).post(
        "/api/v1/auth/register",
        json={"email": "new@example.com", "username": "new_user", "password": "synthetic-password"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "REGISTRATION_DISABLED"
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_ordinary_user_cannot_access_admin_endpoints(monkeypatch):
    app = create_app(settings())
    request = Request({"type": "http", "app": app})
    monkeypatch.setattr(
        "app.modules.auth.service.require_identity",
        lambda *args: (object(), SimpleNamespace(email_normalized="other@example.com")),
    )
    with pytest.raises(ApiError) as error:
        require_admin(request, get_identity(request, Mock()))
    assert error.value.status_code == 403


def test_missing_owner_fails_closed_and_normalizes_deployment_setting():
    from app.modules.showcase.service import site_owner

    config = settings(site_owner_email="  OWNER@Example.com ")
    assert config.site_owner_email == "owner@example.com"
    db = Mock()
    db.scalar.return_value = None
    with pytest.raises(ApiError) as error:
        site_owner(db, config)
    assert error.value.status_code == 503
    assert error.value.code == "SHOWCASE_UNAVAILABLE"
    statement = db.scalar.call_args.args[0]
    assert statement.compile().params == {"email_normalized_1": "owner@example.com"}


def test_anonymous_profile_uses_display_whitelist_and_no_cookie(monkeypatch):
    app = create_app(settings())
    db = Mock()
    app.dependency_overrides[get_session] = lambda: db
    from app.modules.showcase import service

    owner = SimpleNamespace(
        id=uuid4(),
        email_normalized="private@example.com",
        username="private_username",
        display_name="展示跑者",
        timezone="Asia/Shanghai",
        password_hash="private-hash",
        avatar_version=None,
    )
    monkeypatch.setattr(service, "site_owner", lambda *args: owner)
    response = TestClient(app).get("/api/v1/showcase/profile")
    assert response.status_code == 200
    assert response.json()["data"] == {
        "display_name": "展示跑者",
        "timezone": "Asia/Shanghai",
        "avatar_url": None,
    }
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers


def test_activity_whitelist_drops_private_notes_and_unknown_nested_fields():
    from app.modules.showcase.schema import ShowcaseActivity

    data = dict(
        id=uuid4(),
        title="合成晨跑",
        activity_date="2026-10-01",
        timezone="Asia/Shanghai",
        started_at=None,
        ended_at=None,
        distance_m="1000",
        elapsed_seconds="400",
        avg_pace_seconds_per_km="400",
        temporal_quality="complete",
        metrics_version="v1",
        created_at=datetime(2026, 10, 1, tzinfo=UTC),
        has_route=True,
        notes="private-notes",
        filename="private.gpx",
        user_id=str(uuid4()),
        quality_summary={"email": "private@example.com"},
        visibility="private",
    )
    public = ShowcaseActivity.model_validate(data).model_dump(mode="json")
    assert not {"notes", "filename", "user_id", "quality_summary", "visibility"} & public.keys()
    assert public["distance_m"] == "1000"


def test_public_reports_are_owner_filtered_completed_and_read_only():
    from app.modules.showcase.service import reports

    owner = SimpleNamespace(id=uuid4(), activity_data_version=7)
    db = Mock()
    db.scalar.return_value = 0
    db.scalars.return_value.all.return_value = []
    result = reports(db, owner, 10, 0)
    assert result.total == 0
    for statement in [db.scalar.call_args.args[0], db.scalars.call_args.args[0]]:
        params = statement.compile().params
        assert owner.id in params.values()
        assert "succeeded" in params.values()
        assert "deleted_at IS NULL" in str(statement)
    db.execute.assert_not_called()
    db.commit.assert_not_called()
    db.flush.assert_not_called()


def test_unknown_owner_parameter_cannot_select_another_showcase_account():
    app = create_app(settings())
    app.dependency_overrides[get_session] = lambda: Mock()
    response = TestClient(app).get("/api/v1/showcase/profile?owner=other")
    assert response.status_code == 422


@pytest.mark.parametrize(
    "path,method,payload",
    [
        ("/api/v1/activities/00000000-0000-4000-8000-000000000001", "patch", {"title": "合成修改"}),
        ("/api/v1/activities/00000000-0000-4000-8000-000000000001", "delete", None),
        (
            "/api/v1/activities/batch-delete",
            "post",
            {"ids": ["00000000-0000-4000-8000-000000000001"]},
        ),
        ("/api/v1/me/running-goals/week", "put", {"target_km": 10.0}),
        (
            "/api/v1/ai-reports",
            "post",
            {"date_from": "2026-09-14", "date_to": "2026-10-12", "consent_to_send_summary": True},
        ),
        ("/api/v1/me", "patch", {"display_name": "合成修改"}),
    ],
)
def test_anonymous_direct_mutations_are_rejected_before_service(path, method, payload):
    app = create_app(settings())
    db = Mock()
    app.dependency_overrides[get_session] = lambda: db
    response = TestClient(app).request(method, path, json=payload)
    assert response.status_code == 401
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_non_owner_password_login_never_rotates_a_session(monkeypatch):
    from app.modules.auth import service

    db = Mock()
    db.scalar.return_value = SimpleNamespace(
        email_normalized="other@example.com", password_hash="x", is_active=False
    )
    monkeypatch.setattr(service, "verify_password", lambda *args: True)
    rotate = Mock()
    monkeypatch.setattr(service, "rotate", rotate)
    with pytest.raises(ApiError) as error:
        service.login(
            db,
            None,
            SimpleNamespace(email="other@example.com", password="x"),
            datetime(2026, 10, 16, tzinfo=UTC),
            "owner@example.com",
        )
    assert error.value.code == "INVALID_CREDENTIALS"
    rotate.assert_not_called()


def test_public_report_hides_unknown_nested_snapshot_metadata():
    from app.modules.showcase.service import report_view

    summary = dict(
        activity_count=0,
        distance_m="0",
        activity_days=0,
        duration_sum_seconds=None,
        known_duration_count=0,
        missing_duration_count=0,
        pace_eligible_count=0,
        pace_eligible_distance_m="0",
        avg_pace_seconds_per_km=None,
        quality_warning_count=0,
        user_id="private-id",
    )
    row = SimpleNamespace(
        id=uuid4(),
        date_from="2026-09-14",
        date_to="2026-10-12",
        stats_snapshot=dict(
            schema_version="running-summary-v1",
            date_from="2026-09-14",
            date_to="2026-10-12",
            summary=summary,
            weeks=[],
            average_runs_per_week="0",
            evidence_limited=True,
            limitations=["合成数据"],
            email="private@example.com",
        ),
        report_text='{"trend_summary":"保持节奏","recommendations":["适度休息"],"limitations":"仅供参考"}',
        created_at=datetime(2026, 10, 16, tzinfo=UTC),
        finished_at=None,
        source_data_version=1,
    )
    public = report_view(row, 1).model_dump_json()
    for forbidden in ["private-id", "private@example.com", "user_id", "model", "error_code"]:
        assert forbidden not in public


def test_cached_footprint_fields_are_rebuilt_and_unknown_metadata_is_dropped():
    from app.modules.showcase.service import footprint_view

    view = footprint_view(
        {
            "type": "FeatureCollection",
            "mode": "tracks",
            "activity_count": 1,
            "email": "PRIVATE_EMAIL",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[0, 0], [1, 1]],
                        "private": "DROP",
                    },
                    "properties": {
                        "activity_id": "synthetic",
                        "segment_index": 0,
                        "title": "合成跑步",
                        "user_id": "PRIVATE_ID",
                        "notes": "PRIVATE_NOTES",
                    },
                }
            ],
        }
    )
    assert "PRIVATE" not in str(view) and "DROP" not in str(view)
    assert view["features"][0]["geometry"]["coordinates"] == [[0, 0], [1, 1]]
