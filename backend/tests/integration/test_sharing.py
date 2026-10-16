from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.integration.test_gpx_import import clients, headers, register, upload  # noqa: F401

pytestmark = pytest.mark.integration


def patch(a, identifier, visibility):
    return a.patch(
        f"/api/v1/activities/{identifier}", headers=headers(a), json={"visibility": visibility}
    )


def test_public_matrix_and_revocation(clients):  # noqa: F811 -- imported pytest fixture
    a, b, _, app = clients
    register(a)
    register(b)
    record = upload(a).json()["data"]["activity"]
    identifier = record["id"]
    name = a.get("/api/v1/me").json()["data"]["username"]
    public = f"/api/v1/public/activities/{identifier}"
    profile = f"/api/v1/public/users/{name}"
    manage = f"/api/v1/activities/{identifier}/shares"
    with TestClient(app) as anon:
        assert anon.get(public).status_code == 404
        assert anon.get(profile).status_code == 404
        assert a.post(manage, headers=headers(a), json={}).status_code == 409
        assert patch(b, identifier, "public").status_code == 404
        assert (
            a.patch(
                "/api/v1/me", headers=headers(a), json={"bio": "跑步者", "profile_is_public": True}
            ).status_code
            == 200
        )
        assert anon.get(profile).json()["data"]["summary"]["activity_count"] == 0
        assert patch(a, identifier, "unlisted").status_code == 200
        r = a.post(manage, headers=headers(a), json={})
        assert r.status_code == 201, r.text
        link = r.json()["data"]
        token = link["share_url"].rsplit("/", 1)[1]
        shared = f"/api/v1/shared/{token}"
        assert anon.get(public).status_code == 404
        assert anon.get(shared).status_code == 200
        data = anon.get(shared).json()["data"]
        assert set(data) == {
            "id",
            "title",
            "activity_date",
            "distance_m",
            "elapsed_seconds",
            "avg_pace_seconds_per_km",
            "author",
            "has_shared_route",
        }
        assert set(data["author"]) == {"username", "display_name"}
        assert data["has_shared_route"] is False
        assert anon.get(shared + "/route").status_code == 404
        assert anon.get(f"/api/v1/activities/{identifier}/route").status_code == 401
        assert patch(a, identifier, "public").status_code == 200
        assert anon.get(public).status_code == 200
        assert anon.get(profile).json()["data"]["summary"]["activity_count"] == 1
        year = int(record["activity_date"][:4])
        assert anon.get(profile + f"/calendar?year={year}").json()["data"]["activity_count"] == 1
        assert anon.get(profile + "/activities").json()["data"]["total"] == 1
        assert (
            a.patch("/api/v1/me", headers=headers(a), json={"profile_is_public": False}).status_code
            == 200
        )
        for suffix in ["", f"/calendar?year={year}", "/activities"]:
            assert anon.get(profile + suffix).status_code == 404
        assert anon.get(public).status_code == 200 and anon.get(shared).status_code == 200
        assert b.delete(manage + f"/{link['link_id']}", headers=headers(b)).status_code == 404
        assert a.delete(manage + f"/{link['link_id']}", headers=headers(a)).status_code == 200
        assert anon.get(shared).status_code == 404
        assert patch(a, identifier, "private").status_code == 200
        assert anon.get(public).status_code == 404
        assert patch(a, identifier, "public").status_code == 200
        assert anon.get(shared).status_code == 404
        assert anon.get(public + "/route").status_code == 404
        assert anon.get(public).headers["cache-control"] == "no-store"
        assert anon.get(shared).headers["referrer-policy"] == "no-referrer"
        assert b.get(manage).status_code == 404
    from sqlalchemy import select

    from app.modules.sharing.model import ActivityShareLink

    with app.state.session_factory() as db:
        stored = db.scalar(select(ActivityShareLink).where(ActivityShareLink.id == link["link_id"]))
        assert token not in stored.token_hash and len(stored.token_hash) == 64


def test_private_revokes_all_and_expiry(clients):  # noqa: F811 -- imported pytest fixture
    a, b, _, app = clients
    register(a)
    register(b)
    identifier = upload(a).json()["data"]["activity"]["id"]
    manage = f"/api/v1/activities/{identifier}/shares"
    assert patch(a, identifier, "unlisted").status_code == 200
    urls = []
    for _ in range(2):
        r = a.post(manage, headers=headers(a), json={})
        assert r.status_code == 201
        urls.append("/api/v1/shared/" + r.json()["data"]["share_url"].rsplit("/", 1)[1])
    patch(a, identifier, "private")
    patch(a, identifier, "unlisted")
    with TestClient(app) as anon:
        assert all(anon.get(url).status_code == 404 for url in urls)
        link = a.post(manage, headers=headers(a), json={}).json()["data"]
        app.state.clock = lambda: datetime.now(UTC) + timedelta(days=31)
        assert anon.get("/api/v1/shared/" + link["share_url"].rsplit("/", 1)[1]).status_code == 404


def test_strict_writes_and_filtering(clients):  # noqa: F811 -- imported pytest fixture
    a, b, _, app = clients
    register(a)
    register(b)
    identifier = upload(a).json()["data"]["activity"]["id"]
    other = upload(a, "different-date.gpx").json()["data"]["activity"]["id"]
    patch(a, identifier, "public")
    patch(a, other, "unlisted")
    r = a.patch("/api/v1/me", headers=headers(a), json={"profile_is_public": True})
    assert r.status_code == 200
    name = r.json()["data"]["username"]
    assert (
        a.patch(f"/api/v1/activities/{identifier}", json={"visibility": "private"}).status_code
        == 403
    )
    for payload in [
        {},
        {"visibility": "bad"},
        {"visibility": None},
        {"user_id": str(uuid4())},
        {"allow_shared_route": True},
    ]:
        assert (
            a.patch(
                f"/api/v1/activities/{identifier}", headers=headers(a), json=payload
            ).status_code
            == 422
        )
    for payload in [
        {"expires_at": None, "owner_id": str(uuid4())},
        {"expires_at": "bad"},
        {"expires_at": (datetime.now(UTC) + timedelta(days=366)).isoformat()},
    ]:
        assert (
            a.post(
                f"/api/v1/activities/{identifier}/shares", headers=headers(a), json=payload
            ).status_code
            == 422
        )
    with TestClient(app) as anon:
        profile = f"/api/v1/public/users/{name}"
        assert anon.get(profile).json()["data"]["summary"]["activity_count"] == 1
        assert anon.get(profile + "/activities").json()["data"]["items"][0]["id"] == identifier
        assert anon.get(profile + "/calendar?year=9999").status_code == 422
        assert anon.get("/api/v1/public/activities/" + other).status_code == 404


def test_multiple_links_unrelated_ids_defaults_and_logs(clients, caplog):  # noqa: F811
    import logging

    a, b, _, app = clients
    register(a)
    register(b)
    first = upload(a).json()["data"]["activity"]
    second = upload(a, "different-date.gpx").json()["data"]["activity"]
    assert first["visibility"] == second["visibility"] == "private"
    assert first["allow_shared_route"] is False
    patch(a, first["id"], "unlisted")
    base = f"/api/v1/activities/{first['id']}/shares"
    link = a.post(base, headers=headers(a), json={"expires_at": None}).json()["data"]
    assert link["expires_at"] is None
    # Management listing never reveals token or URL.
    listed = a.get(base).json()["data"]["items"][0]
    assert "share_url" not in listed and "token" not in listed
    assert (
        a.delete(
            f"/api/v1/activities/{second['id']}/shares/{link['link_id']}", headers=headers(a)
        ).status_code
        == 404
    )
    assert b.post(base, headers=headers(b), json={}).status_code == 404
    token = link["share_url"].rsplit("/", 1)[1]
    with TestClient(app) as anon, caplog.at_level(logging.INFO):
        assert anon.get("/api/v1/shared/" + token).status_code == 200
        assert anon.get("/api/v1/shared/" + token + "/route").status_code == 404
    assert token not in caplog.text
    assert a.delete(base + "/" + str(link["link_id"]), headers=headers(a)).status_code == 200
    assert a.delete(base + "/" + str(link["link_id"]), headers=headers(a)).status_code == 200


def test_concurrent_private_transition_cannot_leave_live_share(clients):  # noqa: F811
    from concurrent.futures import ThreadPoolExecutor

    a, b, _, app = clients
    register(a)
    identifier = upload(a).json()["data"]["activity"]["id"]
    patch(a, identifier, "unlisted")
    h = headers(a)
    # Both requests are genuinely authenticated as the same owner.
    b.app.state.settings.site_owner_email = a.app.state.settings.site_owner_email
    b.cookies.update(a.cookies)
    with ThreadPoolExecutor(max_workers=2) as pool:
        created = pool.submit(b.post, f"/api/v1/activities/{identifier}/shares", headers=h, json={})
        changed = pool.submit(
            a.patch, f"/api/v1/activities/{identifier}", headers=h, json={"visibility": "private"}
        )
        link, private = created.result(), changed.result()
    assert private.status_code == 200
    assert link.status_code in (201, 409)
    if link.status_code == 201:
        token = link.json()["data"]["share_url"].rsplit("/", 1)[1]
        with TestClient(app) as anon:
            assert anon.get("/api/v1/shared/" + token).status_code == 404
        assert (
            a.get(f"/api/v1/activities/{identifier}/shares").json()["data"]["items"][0]["status"]
            == "revoked"
        )
