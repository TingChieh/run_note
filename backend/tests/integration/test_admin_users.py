"""Account administration and named full-showcase acceptance on an allowlisted _test DB."""

from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import create_app
from app.modules.activities.model import Activity
from app.modules.auth.model import AuthSession
from app.modules.gpx.model import GpxImport
from app.modules.users.model import User
from tests.integration.test_showcase import ORIGIN, PASSWORD, site  # noqa: F401

pytestmark = pytest.mark.integration


def login(client, email, password=PASSWORD):
    csrf = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    return response


def write_headers(response):
    return {"Origin": ORIGIN, "X-CSRF-Token": response.json()["data"]["csrf_token"]}


def test_admin_accounts_sessions_named_isolation_and_legacy_revocation(site, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.main.FootprintWorker.start", lambda self: None)
    admin, visitor, old, admin_headers, owner_activity, _, engine, settings, _ = site
    prefix = "/api/v1/admin/users"
    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"managed-{suffix}@example.com",
        username=f"m_{suffix}",
        display_name="合成普通用户",
        timezone="UTC",
        password=PASSWORD,
    )
    assert visitor.get(prefix).status_code == 401
    assert admin.post(prefix, json=payload).status_code == 403
    created = admin.post(prefix, json=payload, headers=admin_headers)
    assert created.status_code == 201, created.text
    account = created.json()["data"]
    assert account["is_active"] and not account["is_admin"] and not account["showcase_enabled"]
    identifier = account["id"]
    endpoint = f"{prefix}/{identifier}"
    named = f"/api/v1/showcase/users/{payload['username']}"
    assert visitor.get(named + "/profile").status_code == 404
    duplicate = admin.post(
        prefix, json={**payload, "username": f"d_{suffix}"}, headers=admin_headers
    )
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "EMAIL_EXISTS"
    duplicate = admin.post(
        prefix, json={**payload, "email": f"dup-{suffix}@example.com"}, headers=admin_headers
    )
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "USERNAME_EXISTS"
    rows = admin.get(prefix, params={"search": payload["username"], "is_active": True}).json()[
        "data"
    ]
    assert rows["total"] == 1 and rows["items"][0]["id"] == identifier
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as ordinary:
        logged = login(ordinary, payload["email"])
        assert logged.status_code == 200, logged.text
        assert logged.json()["data"]["user"]["is_admin"] is False
        headers = write_headers(logged)
        assert ordinary.get(prefix).status_code == 403
        assert ordinary.post(prefix, json=payload, headers=headers).status_code == 403
        assert ordinary.get(f"/api/v1/activities/{owner_activity['id']}").status_code == 404
        raw = (Path(__file__).parents[1] / "fixtures/gpx/equator-six.gpx").read_bytes()
        upload = ordinary.post(
            "/api/v1/gpx-imports",
            headers=headers,
            files={"file": ("synthetic.gpx", raw, "application/gpx+xml")},
        )
        assert upload.status_code == 201, upload.text
        record = upload.json()["data"]["activity"]
        resource = f"{named}/activities/{record['id']}"
        assert (
            admin.patch(
                endpoint, json={"showcase_enabled": True}, headers=admin_headers
            ).status_code
            == 200
        )
        assert visitor.get(named + "/activities").json()["data"]["total"] == 1
        assert visitor.get(resource).status_code == 200
        assert visitor.get(resource + "/route").status_code == 200
        assert visitor.get(f"{named}/activities/{owner_activity['id']}").status_code == 404
        data = visitor.get(resource).json()["data"]
        assert not ({"notes", "email", "source_filename", "user_id"} & set(data))
        assert set(visitor.get(named + "/profile").json()["data"]) == {"display_name", "timezone"}
        assert (
            admin.patch(
                endpoint, json={"showcase_enabled": False}, headers=admin_headers
            ).status_code
            == 200
        )
        for path in (
            "/profile",
            "/activities",
            f"/activities/{record['id']}",
            f"/activities/{record['id']}/route",
            "/ai-reports",
            "/running-goals",
            "/footprints/all",
            "/statistics/summary",
        ):
            assert visitor.get(named + path).status_code == 404
        assert ordinary.get("/api/v1/me").status_code == 200
        assert (
            ordinary.patch(
                f"/api/v1/activities/{record['id']}", json={"visibility": "public"}, headers=headers
            ).status_code
            == 200
        )
        assert (
            ordinary.patch(
                "/api/v1/me", json={"profile_is_public": True}, headers=headers
            ).status_code
            == 200
        )
        legacy = f"/api/v1/public/activities/{record['id']}"
        legacy_profile = f"/api/v1/public/users/{payload['username']}"
        assert visitor.get(legacy).status_code == 200
        share = ordinary.post(f"/api/v1/activities/{record['id']}/shares", json={}, headers=headers)
        assert share.status_code == 201
        shared = "/api/v1/shared/" + share.json()["data"]["share_url"].rsplit("/", 1)[1]
        assert visitor.get(shared).status_code == 200
        assert (
            admin.patch(endpoint, json={"is_active": False}, headers=admin_headers).status_code
            == 200
        )
        assert ordinary.get("/api/v1/me").status_code == 401
        assert login(ordinary, payload["email"]).status_code == 401
        for path in (legacy, legacy_profile, legacy_profile + "/activities", shared, resource):
            assert visitor.get(path).status_code == 404
        enabled = admin.patch(endpoint, json={"is_active": True}, headers=admin_headers)
        assert enabled.status_code == 200 and not enabled.json()["data"]["showcase_enabled"]
        assert ordinary.get("/api/v1/me").status_code == 401
        assert login(ordinary, payload["email"]).status_code == 200
        reset = admin.post(
            endpoint + "/reset-password",
            json={"new_password": PASSWORD + "-reset"},
            headers=admin_headers,
        )
        assert reset.status_code == 200 and reset.json()["data"] == {"password_reset": True}
        assert ordinary.get("/api/v1/me").status_code == 401
        assert login(ordinary, payload["email"]).status_code == 401
        assert login(ordinary, payload["email"], PASSWORD + "-reset").status_code == 200
        new_email = f"changed-{suffix}@example.com"
        assert (
            admin.patch(endpoint, json={"email": new_email}, headers=admin_headers).status_code
            == 200
        )
        assert ordinary.get("/api/v1/me").status_code == 401
        assert login(ordinary, new_email, PASSWORD + "-reset").status_code == 200
    owner = admin.get("/api/v1/me").json()["data"]
    for changes in ({"is_active": False}, {"showcase_enabled": False}, {"email": payload["email"]}):
        assert (
            admin.patch(f"{prefix}/{owner['id']}", json=changes, headers=admin_headers).status_code
            == 409
        )
    assert (
        admin.post(
            f"{prefix}/{owner['id']}/reset-password",
            json={"new_password": PASSWORD},
            headers=admin_headers,
        ).status_code
        == 409
    )
    assert (
        admin.patch(
            endpoint, json={"email": settings.site_owner_email}, headers=admin_headers
        ).status_code
        == 409
    )
    with admin.app.state.session_factory() as db:
        persisted = db.scalar(select(User).where(User.username == payload["username"]))
        assert persisted.is_active and not persisted.showcase_enabled
        assert persisted.email_normalized == new_email


def test_batch_delete_cascades_protects_owner_and_requires_admin(site, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.main.FootprintWorker.start", lambda self: None)
    admin, visitor, _, admin_headers, _, _, _, settings, _ = site
    prefix = "/api/v1/admin/users"
    endpoint = prefix + "/batch-delete"
    owner_id = admin.get("/api/v1/me").json()["data"]["id"]
    accounts = []
    for tag in ("a", "b"):
        suffix = uuid4().hex[:18]
        payload = dict(
            email=f"bulk-{tag}-{suffix}@example.com",
            username=f"b{tag}_{suffix}",
            display_name="合成批量删除",
            timezone="UTC",
            password=PASSWORD,
        )
        created = admin.post(prefix, json=payload, headers=admin_headers)
        assert created.status_code == 201, created.text
        accounts.append((created.json()["data"]["id"], payload))
    (first, first_payload), (second, second_payload) = accounts
    raw = (Path(__file__).parents[1] / "fixtures/gpx/equator-six.gpx").read_bytes()
    with (
        TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as one,
        TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as two,
    ):
        logged = login(one, first_payload["email"])
        assert logged.status_code == 200, logged.text
        headers = write_headers(logged)
        upload = one.post(
            "/api/v1/gpx-imports",
            headers=headers,
            files={"file": ("synthetic.gpx", raw, "application/gpx+xml")},
        )
        assert upload.status_code == 201, upload.text
        record = upload.json()["data"]["activity"]["id"]
        patched = one.patch(
            f"/api/v1/activities/{record}", json={"visibility": "public"}, headers=headers
        )
        assert patched.status_code == 200, patched.text
        share = one.post(f"/api/v1/activities/{record}/shares", json={}, headers=headers)
        assert share.status_code == 201
        shared = "/api/v1/shared/" + share.json()["data"]["share_url"].rsplit("/", 1)[1]
        assert visitor.get(shared).status_code == 200

        other = login(two, second_payload["email"])
        assert other.status_code == 200
        assert (
            two.post(endpoint, json={"ids": [first]}, headers=write_headers(other)).status_code
            == 403
        )
        assert admin.post(endpoint, json={"ids": [first]}).status_code == 403

        protected = admin.post(endpoint, json={"ids": [first, owner_id]}, headers=admin_headers)
        assert protected.status_code == 409
        assert protected.json()["error"]["code"] == "OWNER_PROTECTED"
        assert one.get("/api/v1/me").status_code == 200

        missing = str(uuid4())
        deleted = admin.post(
            endpoint, json={"ids": [first, second, missing]}, headers=admin_headers
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["data"] == {"deleted": True, "deleted_count": 2}
        assert one.get("/api/v1/me").status_code == 401
        assert two.get("/api/v1/me").status_code == 401
        assert visitor.get(shared).status_code == 404
        again = admin.post(endpoint, json={"ids": [first]}, headers=admin_headers)
        assert again.json()["data"] == {"deleted": True, "deleted_count": 0}

    with admin.app.state.session_factory() as db:
        removed = [UUID(first), UUID(second)]
        for model in (User, Activity, GpxImport, AuthSession):
            column = model.id if model is User else model.user_id
            count = db.scalar(select(func.count()).select_from(model).where(column.in_(removed)))
            assert count == 0, model.__name__
        assert db.get(User, UUID(owner_id)) is not None
