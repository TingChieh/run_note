from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.modules.activities.model import Activity
from tests.integration.test_admin_users import login, write_headers
from tests.integration.test_showcase import ORIGIN, PASSWORD, site  # noqa: F401

pytestmark = pytest.mark.integration


def test_admin_readonly_activity_access(site):  # noqa: F811
    admin, visitor, _, headers, own_activity, _, engine, settings, _ = site
    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"readonly-{suffix}@example.com",
        username=f"r_{suffix}",
        display_name="合成用户",
        timezone="UTC",
        password=PASSWORD,
    )
    account = admin.post("/api/v1/admin/users", json=payload, headers=headers).json()["data"]
    user_id = account["id"]
    base = f"/api/v1/admin/users/{user_id}/activities"
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as ordinary:
        auth = login(ordinary, payload["email"])
        user_headers = write_headers(auth)
        fixture = Path(__file__).parents[1] / "fixtures/gpx/equator-six.gpx"
        upload = ordinary.post(
            "/api/v1/gpx-imports",
            headers=user_headers,
            files={"file": ("synthetic.gpx", fixture.read_bytes(), "application/gpx+xml")},
        )
        assert upload.status_code == 201, upload.text
        activity = upload.json()["data"]["activity"]
        activity_id = activity["id"]
        with engine.begin() as connection:
            connection.execute(
                Activity.__table__.insert(),
                {
                    "id": uuid4(),
                    "user_id": UUID(user_id),
                    "source": "manual",
                    "title": "合成筛选",
                    "activity_date": date(2099, 3, 2),
                    "date_source": "manual",
                    "timezone": "UTC",
                    "distance_m": 1000,
                    "temporal_quality": "manual",
                    "quality_summary": {},
                    "metrics_version": "test",
                    "visibility": "private",
                    "category": "测试分类",
                },
            )
        owner_path = f"/api/v1/admin/activities/{activity_id}/owner"
        assert visitor.get(owner_path).status_code == 401
        assert ordinary.get(owner_path).status_code == 403
        assert admin.get(owner_path).json()["data"] == {"user_id": user_id}
        assert admin.get(f"/api/v1/admin/activities/{uuid4()}/owner").status_code == 404
        assert (
            ordinary.patch(
                f"/api/v1/activities/{activity_id}",
                headers=user_headers,
                json={"notes": "合成备注"},
            ).status_code
            == 200
        )
        detail = f"{base}/{activity_id}"
        assert visitor.get(base).status_code == 401
        assert ordinary.get(base).status_code == 403
        assert ordinary.get(detail).status_code == 403
        assert ordinary.get(detail + "/route").status_code == 403
        assert visitor.get(detail).status_code == 401
        assert visitor.get(detail + "/route").status_code == 401
        result = admin.get(
            base, params={"limit": 1, "offset": 0, "activity_date": activity["activity_date"]}
        )
        assert result.status_code == 200, result.text
        assert result.json()["data"]["total"] == 1
        assert result.json()["data"]["items"][0]["id"] == activity_id
        filtered = admin.get(base, params={"category": "测试分类", "activity_month": "2099-03"})
        assert filtered.json()["data"]["total"] == 1
        assert filtered.json()["data"]["items"][0]["title"] == "合成筛选"
        assert admin.get(base, params={"limit": 1, "offset": 1}).json()["data"]["total"] == 2
        assert admin.get(base, params={"offset": 2}).json()["data"]["items"] == []
        assert admin.get(detail).json()["data"]["notes"] == "合成备注"
        assert (
            admin.get(detail + "/route").json()["data"]
            == ordinary.get(f"/api/v1/activities/{activity_id}/route").json()["data"]
        )
        assert admin.get(f"{base}/{own_activity['id']}").status_code == 404
        assert admin.get(f"{base}/{own_activity['id']}/route").status_code == 404
        assert admin.get(f"/api/v1/admin/users/{uuid4()}/activities").status_code == 404
        missing = f"/api/v1/admin/users/{uuid4()}/activities/{activity_id}"
        assert admin.get(missing).status_code == 404
        assert admin.get(missing + "/route").status_code == 404
        assert (
            admin.patch(
                f"/api/v1/activities/{activity_id}", headers=headers, json={"title": "x"}
            ).status_code
            == 404
        )
        assert admin.delete(f"/api/v1/activities/{activity_id}", headers=headers).status_code == 404
        assert (
            admin.post(
                "/api/v1/activities/batch-delete", headers=headers, json={"ids": [activity_id]}
            ).status_code
            == 404
        )
        assert admin.get(f"/api/v1/activities/{activity_id}").status_code == 404
        assert ordinary.get(f"/api/v1/activities/{activity_id}").status_code == 200


def test_readonly_endpoints_refresh_admin_session(site):  # noqa: F811
    from datetime import timedelta

    from sqlalchemy import select, update

    from app.core.security import token_hash
    from app.modules.auth.model import AuthSession

    admin, _, _, _, activity, _, engine, _, _ = site
    session_hash = token_hash(admin.cookies.get("run_session"))
    now = admin.app.state.clock()
    with engine.connect() as connection:
        user_id = connection.scalar(
            select(AuthSession.user_id).where(AuthSession.token_hash == session_hash)
        )
    activity_id = activity["id"]
    for path in (
        f"/api/v1/admin/users/{user_id}",
        f"/api/v1/admin/users/{user_id}/activities",
        f"/api/v1/admin/users/{user_id}/activities/{activity_id}",
        f"/api/v1/admin/users/{user_id}/activities/{activity_id}/route",
        f"/api/v1/admin/activities/{activity_id}/owner",
    ):
        with engine.begin() as connection:
            connection.execute(
                update(AuthSession)
                .where(AuthSession.token_hash == session_hash)
                .values(last_seen_at=now - timedelta(minutes=6))
            )
        response = admin.get(path)
        assert response.status_code == 200, path
        with engine.connect() as connection:
            last_seen = connection.scalar(
                select(AuthSession.last_seen_at).where(AuthSession.token_hash == session_hash)
            )
        assert last_seen == now, path
