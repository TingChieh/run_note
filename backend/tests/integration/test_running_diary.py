from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from tests.conftest import ORIGIN, headers, register, upload

pytestmark = pytest.mark.integration


def diary_path(activity):
    return f"/api/v1/me/activities/{activity}/diary"


def activity_id(client):
    response = upload(client)
    assert response.status_code == 201, response.text
    return response.json()["data"]["activity"]["id"]


def photo(client, path, content=None):
    if content is None:
        source = Image.new("RGB", (80, 48), "blue")
        source.getexif()[274] = 6
        source.getexif()[271] = "Synthetic device"
        buffer = BytesIO()
        source.save(buffer, "JPEG", exif=source.getexif())
        content = buffer.getvalue()
    return client.post(
        f"{path}/photos",
        files={"file": ("synthetic.jpg", content, "image/jpeg")},
        headers=headers(client),
    )


def test_running_diary_lifecycle_and_photo_privacy(clients):
    a, _, engine, _ = clients
    register(a)
    activity = activity_id(a)
    path = diary_path(activity)
    assert a.get(path).json()["data"] == {"diary": None}
    fields = {"mood": "good", "rpe": 10, "weather": "rain", "notes": "Synthetic diary note"}
    result = a.put(path, json=fields, headers=headers(a))
    assert result.status_code == 200, result.text
    entry = result.json()["data"]["diary"]
    assert {key: entry[key] for key in fields} == fields
    assert entry["photos"] == []

    uploaded = photo(a, path)
    assert uploaded.status_code == 201, uploaded.text
    picture = uploaded.json()["data"]
    assert set(picture) == {"id", "width", "height"}
    imagepath = f"{path}/photos/{picture['id']}"
    downloaded = a.get(imagepath)
    assert downloaded.status_code == 200
    assert downloaded.headers["cache-control"] == "private, no-store"
    assert downloaded.headers["content-type"] == "image/png"
    with Image.open(BytesIO(downloaded.content)) as image:
        assert image.size == (48, 80)
        assert not image.info
        assert not image.getexif()

    updated = a.put(path, json={**fields, "rpe": 1, "notes": None}, headers=headers(a))
    assert updated.json()["data"]["diary"]["photos"] == [picture]
    assert updated.json()["data"]["diary"]["notes"] is None
    assert a.delete(imagepath, headers=headers(a)).status_code == 200
    assert a.get(imagepath).status_code == 404
    assert photo(a, path).status_code == 201
    assert a.delete(path, headers=headers(a)).status_code == 200
    assert a.get(path).json()["data"] == {"diary": None}
    recreated = photo(a, path)  # A photo-only diary is supported.
    assert recreated.status_code == 201
    assert a.delete(f"/api/v1/activities/{activity}", headers=headers(a)).status_code == 200
    with engine.connect() as db:
        assert not db.scalar(
            text("SELECT EXISTS (SELECT 1 FROM activity_diaries WHERE activity_id = :id)"),
            {"id": activity},
        )
        assert not db.scalar(
            text("SELECT EXISTS (SELECT 1 FROM activity_diary_photos WHERE id = :id)"),
            {"id": recreated.json()["data"]["id"]},
        )


def test_other_users_cannot_access_diary_or_photos(clients):
    a, b, _, app = clients
    register(a)
    register(b)
    path = diary_path(activity_id(a))
    other_path = diary_path(activity_id(b))
    entry = a.put(path, json={"notes": "Only visible to author"}, headers=headers(a))
    assert entry.status_code == 200
    uploaded = photo(a, path)
    assert uploaded.status_code == 201
    suffix = f"/photos/{uploaded.json()['data']['id']}"
    with TestClient(app) as anonymous:
        assert anonymous.get(path).status_code == 401
        assert anonymous.get(path + suffix).status_code == 401
    assert b.get(path).status_code == 404
    assert b.put(path, json={"notes": "Other"}, headers=headers(b)).status_code == 404
    assert b.delete(path, headers=headers(b)).status_code == 404
    assert photo(b, path).status_code == 404
    for base in (path, other_path):
        assert b.get(base + suffix).status_code == 404
        assert b.delete(base + suffix, headers=headers(b)).status_code == 404
    assert a.get(path).json()["data"]["diary"]["notes"] == "Only visible to author"
    assert a.get(path + suffix).status_code == 200


def test_running_diary_validates_input_and_photo_limits(clients):
    a, _, _, _ = clients
    register(a)
    path = diary_path(activity_id(a))
    for fields in (
        {"rpe": 0},
        {"rpe": 11},
        {"rpe": "4"},
        {"rpe": True},
        {"mood": "unknown"},
        {"weather": "unknown"},
        {"notes": "z" * 5001},
    ):
        assert a.put(path, json=fields, headers=headers(a)).status_code == 422
    assert photo(a, path, b"not an image").status_code == 415
    assert photo(a, path, b"0" * (5 * 1024 * 1024 + 1)).status_code == 413
    assert photo(a, path, b"0" * (6 * 1024 * 1024)).status_code == 413
    assert a.get(path).json()["data"] == {"diary": None}
    for _ in range(6):
        assert photo(a, path).status_code == 201
    assert photo(a, path).status_code == 409
    assert len(a.get(path).json()["data"]["diary"]["photos"]) == 6


def test_running_diary_is_excluded_from_showcase_sharing_and_ai(clients):
    owner, _, _, app = clients
    register(owner)
    run = activity_id(owner)
    path = diary_path(run)
    marker = "Synthetic-private-diary-marker"
    assert (
        owner.put(path, json={"notes": marker, "rpe": 8}, headers=headers(owner)).status_code == 200
    )
    uploaded = photo(owner, path)
    assert uploaded.status_code == 201
    photo_id = uploaded.json()["data"]["id"]
    username = owner.get("/api/v1/me").json()["data"]["username"]
    assert (
        owner.patch(
            f"/api/v1/activities/{run}", json={"visibility": "public"}, headers=headers(owner)
        ).status_code
        == 200
    )
    share = owner.post(f"/api/v1/activities/{run}/shares", json={}, headers=headers(owner))
    assert share.status_code == 201
    token = share.json()["data"]["share_url"].rsplit("/", 1)[1]

    with TestClient(app, base_url=ORIGIN) as anonymous:
        for public_path in (
            f"/api/v1/showcase/activities/{run}",
            f"/api/v1/showcase/users/{username}/activities/{run}",
            f"/api/v1/public/activities/{run}",
            f"/api/v1/shared/{token}",
        ):
            response = anonymous.get(public_path)
            assert response.status_code == 200, (public_path, response.text)
            assert marker not in response.text and photo_id not in response.text
            assert (
                not {"diary", "photos", "rpe", "mood", "weather"} & response.json()["data"].keys()
            )

    for private_path in (f"/api/v1/activities/{run}", "/api/v1/ai-reports/context"):
        response = owner.get(private_path)
        assert response.status_code == 200, response.text
        assert marker not in response.text and photo_id not in response.text
        assert not {"diary", "photos", "rpe", "mood", "weather"} & response.json()["data"].keys()
