"""Account administration and named full-showcase acceptance on an allowlisted _test DB."""

from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

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
        assert visitor.get(named + "/statistics/records").status_code == 200
        assert visitor.get(resource).status_code == 200
        assert visitor.get(resource + "/route").status_code == 200
        assert visitor.get(f"{named}/activities/{owner_activity['id']}").status_code == 404
        data = visitor.get(resource).json()["data"]
        assert not ({"notes", "email", "source_filename", "user_id"} & set(data))
        assert set(visitor.get(named + "/profile").json()["data"]) == {
            "display_name",
            "timezone",
            "avatar_url",
        }
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
            "/statistics/records",
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


def test_wellbeing_switches_preserve_private_records(site):  # noqa: F811
    admin, _, _, admin_headers, _, _, _, settings, _ = site
    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"switch-{suffix}@example.com",
        username=f"s_{suffix}",
        display_name="合成用户",
        timezone="UTC",
        password=PASSWORD,
    )
    account = admin.post("/api/v1/admin/users", json=payload, headers=admin_headers).json()["data"]
    assert account["wellbeing_allowed"] and account["wellbeing_enabled"]
    endpoint = f"/api/v1/admin/users/{account['id']}"
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as user:
        user_headers = write_headers(login(user, payload["email"]))
        day = "2020-01-01"
        entry = f"/api/v1/me/wellbeing/days/{day}/entry"
        assert user.put(entry, headers=user_headers, json={"mood": 5}).status_code == 200
        assert (
            user.patch(
                endpoint, headers=user_headers, json={"wellbeing_allowed": False}
            ).status_code
            == 403
        )
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"wellbeing_allowed": False}
            ).status_code
            == 422
        )
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"wellbeing_enabled": False}
            ).status_code
            == 200
        )
        assert user.get("/api/v1/me/wellbeing/entries").status_code == 404
        assert user.put(entry, headers=user_headers, json={"mood": 1}).status_code == 404
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"wellbeing_enabled": True}
            ).status_code
            == 200
        )
        assert (
            admin.patch(
                endpoint, headers=admin_headers, json={"wellbeing_allowed": False}
            ).status_code
            == 200
        )
        assert user.get("/api/v1/me/wellbeing/entries").status_code == 404
        assert (
            admin.patch(
                endpoint,
                headers=admin_headers,
                json={"wellbeing_allowed": True, "wellbeing_enabled": True},
            ).status_code
            == 200
        )
        response = user.get(f"/api/v1/me/wellbeing/days/{day}")
        assert response.status_code == 200
        assert response.json()["data"]["entry"]["mood"] == 5


def test_together_switches_and_public_filter(site, monkeypatch):  # noqa: F811
    admin, visitor, _, admin_headers, _, _, engine, settings, _ = site
    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"together-{suffix}@example.com",
        username=f"t_{suffix}",
        display_name="一起跑步合成用户",
        timezone="UTC",
        password=PASSWORD,
    )
    account = admin.post("/api/v1/admin/users", json=payload, headers=admin_headers).json()["data"]
    assert not account["together_allowed"] and not account["together_enabled"]
    endpoint = f"/api/v1/admin/users/{account['id']}"
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as user:
        user_headers = write_headers(login(user, payload["email"]))
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"together_allowed": True}
            ).status_code
            == 422
        )
        assert (
            user.patch(endpoint, headers=user_headers, json={"together_allowed": True}).status_code
            == 403
        )
        assert (
            admin.patch(
                endpoint, headers=admin_headers, json={"together_enabled": True}
            ).status_code
            == 422
        )
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"profile_is_public": True}
            ).status_code
            == 200
        )
        assert (
            admin.patch(
                endpoint, headers=admin_headers, json={"showcase_enabled": True}
            ).status_code
            == 200
        )

        def present():
            response = visitor.get("/api/v1/together")
            assert response.status_code == 200
            assert "wellbeing" not in response.text and "mood" not in response.text
            data = response.json()["data"]
            included = payload["username"] in [row["username"] for row in data["participants"]]
            if not included:
                assert all(row["username"] != payload["username"] for row in data["recent"])
                assert all(
                    row["username"] != payload["username"]
                    for row in visitor.get("/api/v1/together/feed").json()["data"]["items"]
                )
                assert all(row["username"] != payload["username"] for row in data["tracks"])
                if baseline is not None:
                    assert data["distance_m"] == baseline["distance_m"]
                    assert data["count"] == baseline["count"]
            return included

        baseline = None
        assert not present()
        baseline = visitor.get("/api/v1/together").json()["data"]
        # One switch: the administrator's and the user's controls read and write the same value.
        switched = admin.patch(endpoint, headers=admin_headers, json={"together_allowed": True})
        assert switched.status_code == 200
        assert switched.json()["data"]["together_allowed"] is True
        assert switched.json()["data"]["together_enabled"] is True
        assert present()
        off = user.patch("/api/v1/me", headers=user_headers, json={"together_enabled": False})
        assert off.status_code == 200 and off.json()["data"]["together_allowed"] is False
        assert not present()
        on = user.patch("/api/v1/me", headers=user_headers, json={"together_enabled": True})
        assert on.status_code == 200 and on.json()["data"]["together_allowed"] is True
        assert present()
        assert user.get("/api/v1/me").json()["data"]["together_enabled"] is True
        raw = (Path(__file__).parents[1] / "fixtures/gpx/equator-six.gpx").read_bytes()
        upload = user.post(
            "/api/v1/gpx-imports",
            headers=user_headers,
            files={"file": ("synthetic.gpx", raw, "application/gpx+xml")},
        )
        assert upload.status_code == 201, upload.text
        activity_id = upload.json()["data"]["activity"]["id"]
        with engine.begin() as connection:
            connection.execute(
                Activity.__table__.update()
                .where(Activity.id == UUID(activity_id))
                .values(activity_date=visitor.app.state.clock().date())
            )
        # Joining shares every record, whatever its legacy per-record visibility.
        with engine.begin() as connection:
            visibility = connection.execute(
                text("SELECT visibility FROM activities WHERE id = :id"),
                {"id": UUID(activity_id)},
            ).scalar()
        assert visibility == "private"
        joined = visitor.get("/api/v1/together").json()["data"]
        assert any(row["id"] == activity_id for row in joined["recent"])
        assert any(row["activity_id"] == activity_id for row in joined["tracks"])
        assert (
            next(row for row in joined["participants"] if row["username"] == payload["username"])[
                "distance_m"
            ]
            > 0
        )
        public_feed = visitor.get("/api/v1/together/feed").json()["data"]["items"]
        public_run = next(row for row in public_feed if row["id"] == activity_id)
        assert public_run["geometry"] and public_run["geometry"][0]["type"] == "LineString"
        assert "notes" not in public_run and "filename" not in public_run

        # A synthetic tied-date run spans the default first page and a shorter second page.
        synthetic_ids = [uuid4() for _ in range(23)]
        with engine.begin() as connection:
            connection.execute(
                Activity.__table__.insert(),
                [
                    {
                        "id": identifier,
                        "user_id": UUID(account["id"]),
                        "source": "manual",
                        "title": "分页合成",
                        "activity_date": date(2099, 1, 1),
                        "date_source": "manual",
                        "timezone": "UTC",
                        "distance_m": 1000,
                        "temporal_quality": "manual",
                        "quality_summary": {},
                        "metrics_version": "test",
                        "visibility": "private",
                    }
                    for identifier in synthetic_ids
                ],
            )
        first = visitor.get("/api/v1/together?period=week").json()["data"]
        assert [row["id"] for row in first["recent"]] == [
            str(x) for x in sorted(synthetic_ids, reverse=True)[:20]
        ]
        assert first["recent"][0]["geometry"] == []
        assert first["recent"][0]["elapsed_seconds"] is None
        assert first["recent"][0]["avg_heart_rate_bpm"] is None
        response = visitor.get(
            "/api/v1/together/feed", params={"before": first["next_cursor"], "limit": 50}
        )
        assert response.headers["cache-control"] == "no-store"
        rest = response.json()["data"]
        assert [row["id"] for row in rest["items"][:3]] == [
            str(x) for x in sorted(synthetic_ids, reverse=True)[20:]
        ]
        assert rest["next_cursor"] is None
        with engine.begin() as connection:
            connection.execute(Activity.__table__.delete().where(Activity.id.in_(synthetic_ids)))
        entry = user.put(
            "/api/v1/me/wellbeing/days/2020-01-01/entry",
            headers=user_headers,
            json={"mood": 5, "note": "SECRET_WELLBEING"},
        )
        assert entry.status_code == 200, entry.text
        result = visitor.get("/api/v1/together")
        assert result.status_code == 200, result.text
        data = result.json()["data"]
        assert data["count"] >= 1 and data["tracks"] and data["recent"]
        assert data["tracks_truncated"] is False
        for query in ("?before=***", "?limit=0", "?limit=51"):
            invalid_feed = visitor.get("/api/v1/together/feed" + query)
            assert invalid_feed.status_code == 422 and invalid_feed.json()["error"]
        assert result.headers["cache-control"] == "no-store"
        assert "SECRET_WELLBEING" not in result.text
        invalid = visitor.get("/api/v1/together?period=bad")
        assert invalid.status_code == 422 and invalid.json()["error"]
        monkeypatch.setattr(
            visitor.app.state, "clock", lambda: datetime(2023, 12, 31, 16, tzinfo=UTC)
        )
        for day, included in [(date(2023, 12, 31), False), (date(2024, 1, 1), True)]:
            with engine.begin() as connection:
                connection.execute(
                    Activity.__table__.update()
                    .where(Activity.id == UUID(activity_id))
                    .values(activity_date=day)
                )
            for period in ("week", "month", "year"):
                response = visitor.get(f"/api/v1/together?period={period}")
                assert response.headers["cache-control"] == "no-store"
                view = response.json()["data"]
                person = next(
                    row for row in view["participants"] if row["username"] == payload["username"]
                )
                assert (person["count"] == 1) == included
                assert any(row["activity_id"] == activity_id for row in view["tracks"]) == included
                assert any(row["id"] == activity_id for row in view["recent"])
        monkeypatch.setattr(
            visitor.app.state, "clock", lambda: datetime(2024, 2, 5, 12, tzinfo=UTC)
        )
        for day, period, included in [
            (date(2024, 1, 31), "month", False),
            (date(2024, 2, 1), "month", True),
            (date(2024, 2, 4), "week", False),
            (date(2024, 2, 5), "week", True),
        ]:
            with engine.begin() as connection:
                connection.execute(
                    Activity.__table__.update()
                    .where(Activity.id == UUID(activity_id))
                    .values(activity_date=day)
                )
            view = visitor.get(f"/api/v1/together?period={period}").json()["data"]
            person = next(
                row for row in view["participants"] if row["username"] == payload["username"]
            )
            assert (person["count"] == 1) == included
        with engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO activity_segments
                (id, activity_id, segment_index, source_track_index, source_segment_index,
                 break_reason, point_count, geom)
                SELECT gen_random_uuid(), activity_id, n, source_track_index, source_segment_index,
                       break_reason, point_count, geom
                FROM activity_segments CROSS JOIN generate_series(1000, 1500) n
                WHERE activity_id = :activity_id AND segment_index = 0"""),
                {"activity_id": UUID(activity_id)},
            )
        view = visitor.get("/api/v1/together?period=year").json()["data"]
        assert len(view["tracks"]) == 500 and view["tracks_truncated"] is True
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"profile_is_public": False}
            ).status_code
            == 200
        )
        assert not present()
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"profile_is_public": True}
            ).status_code
            == 200
        )
        assert (
            admin.patch(
                endpoint, headers=admin_headers, json={"together_allowed": False}
            ).status_code
            == 200
        )
        assert not present()
        assert (
            admin.patch(
                endpoint, headers=admin_headers, json={"together_allowed": True}
            ).status_code
            == 200
        )
        assert present()
        assert (
            user.patch(
                "/api/v1/me", headers=user_headers, json={"together_enabled": False}
            ).status_code
            == 200
        )
        assert not present()
