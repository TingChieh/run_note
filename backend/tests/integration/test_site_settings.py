"""Site settings and site images on an allowlisted _test DB."""

from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import delete

from app.main import create_app
from app.modules.site_settings.model import DEFAULTS, SiteImage, SiteSettings
from tests.integration.test_admin_users import login, write_headers
from tests.integration.test_showcase import ORIGIN, PASSWORD, site  # noqa: F401

pytestmark = pytest.mark.integration


def png(size=(300, 200)):
    buffer = BytesIO()
    Image.new("RGB", size, (10, 120, 60)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def restore_site(site):  # noqa: F811
    yield site
    app = site[0].app
    with app.state.session_factory.begin() as db:
        db.execute(delete(SiteImage))
        row = db.get(SiteSettings, 1)
        for key, value in DEFAULTS.items():
            setattr(row, key, value)


def test_site_settings_permissions_patch_and_images(restore_site, monkeypatch):
    monkeypatch.setattr("app.main.FootprintWorker.start", lambda self: None)
    admin, visitor, _, admin_headers, _, _, _, settings, _ = restore_site
    read = visitor.get("/api/v1/site")
    assert read.status_code == 200
    assert read.json()["data"] == {**DEFAULTS, "favicon_url": None, "logo_url": None}

    assert visitor.patch("/api/v1/site", json={"title": "x"}).status_code in (401, 403)
    assert admin.patch("/api/v1/site", json={"title": "x"}).status_code == 403  # no CSRF
    bad = admin.patch("/api/v1/site", json={"title": "  "}, headers=admin_headers)
    assert bad.status_code == 422
    changed = admin.patch(
        "/api/v1/site",
        json={"title": "  晨跑站 ", "default_theme": "dark", "subtitle": ""},
        headers=admin_headers,
    )
    assert changed.status_code == 200, changed.text
    data = changed.json()["data"]
    assert (data["title"], data["default_theme"], data["subtitle"]) == ("晨跑站", "dark", "")
    assert visitor.get("/api/v1/site").json()["data"]["title"] == "晨跑站"

    suffix = uuid4().hex[:18]
    payload = dict(
        email=f"site-{suffix}@example.com",
        username=f"st_{suffix}",
        display_name="合成站点读者",
        timezone="UTC",
        password=PASSWORD,
    )
    assert admin.post("/api/v1/admin/users", json=payload, headers=admin_headers).status_code == 201
    with TestClient(create_app(settings.model_copy()), base_url=ORIGIN) as ordinary:
        logged = login(ordinary, payload["email"])
        headers = write_headers(logged)
        assert (
            ordinary.patch("/api/v1/site", json={"title": "x"}, headers=headers).status_code == 403
        )
        assert (
            ordinary.put(
                "/api/v1/site/images/logo",
                files={"file": ("a.png", png(), "image/png")},
                headers=headers,
            ).status_code
            == 403
        )

    uploaded = admin.put(
        "/api/v1/site/images/logo",
        files={"file": ("logo.png", png(), "image/png")},
        headers=admin_headers,
    )
    assert uploaded.status_code == 200, uploaded.text
    logo_url = uploaded.json()["data"]["logo_url"]
    assert logo_url.startswith("/api/v1/site/images/logo?v=") and len(logo_url.split("=")[1]) == 16
    image = visitor.get(logo_url)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"
    with Image.open(BytesIO(image.content)) as decoded:
        assert decoded.size == (200, 200)
    assert visitor.get("/api/v1/site/images/favicon").status_code == 404
    assert visitor.get("/api/v1/site/images/other").status_code == 404
    unknown_kind = admin.put(
        "/api/v1/site/images/other",
        files={"file": ("a.png", png(), "image/png")},
        headers=admin_headers,
    )
    assert unknown_kind.status_code == 404, unknown_kind.text
    unsupported = admin.put(
        "/api/v1/site/images/favicon",
        files={"file": ("a.svg", b"<svg/>", "image/svg+xml")},
        headers=admin_headers,
    )
    assert unsupported.status_code == 415
    assert unsupported.json()["error"]["code"] == "IMAGE_UNSUPPORTED"
    oversized = admin.put(
        "/api/v1/site/images/favicon",
        content=b"\0" * (6 * 1024 * 1024 + 1),
        headers={**admin_headers, "Content-Type": "application/octet-stream"},
    )
    assert oversized.status_code == 413
    removed = admin.delete("/api/v1/site/images/logo", headers=admin_headers)
    assert removed.status_code == 200 and removed.json()["data"]["logo_url"] is None
    assert visitor.get("/api/v1/site/images/logo").status_code == 404
