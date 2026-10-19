"""Per-user avatars: own read/write, public showcase boundary and cascade."""

from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from app.main import create_app
from app.modules.users.model import UserAvatar
from tests.integration.test_admin_users import login, write_headers
from tests.integration.test_showcase import ORIGIN, PASSWORD, site  # noqa: F401

pytestmark = pytest.mark.integration


def jpeg():
    buffer = BytesIO()
    Image.new("RGB", (800, 600), (20, 40, 200)).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_avatar_lifecycle_and_public_boundary(site, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.main.FootprintWorker.start", lambda self: None)
    admin, visitor, _, admin_headers, _, _, _, settings, _ = site
    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"avatar-{suffix}@example.com",
        username=f"av_{suffix}",
        display_name="合成头像用户",
        timezone="UTC",
        password=PASSWORD,
    )
    created = admin.post("/api/v1/admin/users", json=payload, headers=admin_headers)
    identifier = created.json()["data"]["id"]
    named = f"/api/v1/showcase/users/{payload['username']}"
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as own:
        headers = write_headers(login(own, payload["email"]))
        assert own.get("/api/v1/me/avatar").status_code == 404
        assert visitor.get("/api/v1/me/avatar").status_code == 401
        assert (
            own.put(
                "/api/v1/me/avatar", files={"file": ("a.jpg", jpeg(), "image/jpeg")}
            ).status_code
            == 403
        )  # missing CSRF
        uploaded = own.put(
            "/api/v1/me/avatar", files={"file": ("a.jpg", jpeg(), "image/jpeg")}, headers=headers
        )
        assert uploaded.status_code == 200, uploaded.text
        url = uploaded.json()["data"]["avatar_url"]
        assert url.startswith("/api/v1/me/avatar?v=")
        assert own.get("/api/v1/me").json()["data"]["avatar_url"] == url
        image = own.get(url)
        assert image.status_code == 200 and image.headers["content-type"] == "image/png"
        with Image.open(BytesIO(image.content)) as decoded:
            assert decoded.size == (512, 512)

        # Not public until the showcase is enabled; same 404 as a missing account.
        assert visitor.get(named + "/avatar").status_code == 404
        assert visitor.get("/api/v1/showcase/users/no_such_user_x/avatar").status_code == 404
        admin.patch(
            f"/api/v1/admin/users/{identifier}",
            json={"showcase_enabled": True},
            headers=admin_headers,
        )
        profile = visitor.get(named + "/profile").json()["data"]
        assert profile["avatar_url"] == f"{named}/avatar?v={url.split('=')[1]}"
        assert visitor.get(profile["avatar_url"]).status_code == 200
        listing = admin.get("/api/v1/admin/users", params={"search": payload["username"]})
        assert listing.json()["data"]["items"][0]["avatar_url"] is None

        removed = own.delete("/api/v1/me/avatar", headers=headers)
        assert removed.status_code == 200 and removed.json()["data"] == {"avatar_url": None}
        assert visitor.get(named + "/avatar").status_code == 404
        assert visitor.get(named + "/profile").json()["data"]["avatar_url"] is None
        own.put(
            "/api/v1/me/avatar", files={"file": ("a.jpg", jpeg(), "image/jpeg")}, headers=headers
        )
    deleted = admin.post(
        "/api/v1/admin/users/batch-delete", json={"ids": [identifier]}, headers=admin_headers
    )
    assert deleted.json()["data"]["deleted_count"] == 1
    with admin.app.state.session_factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(UserAvatar)
                .where(UserAvatar.user_id == UUID(identifier))
            )
            == 0
        )
