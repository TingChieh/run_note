"""The version endpoint is for the site owner only, on an allowlisted _test DB."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.modules.version import service
from tests.integration.test_admin_users import login
from tests.integration.test_showcase import ORIGIN, PASSWORD

pytestmark = pytest.mark.integration

PATH = "/api/v1/admin/version"


def test_only_the_site_owner_can_read_the_version(site):
    admin, visitor, admin_headers = site[0], site[1], site[3]
    suffix = uuid4().hex[:18]
    email = f"version-{suffix}@example.com"
    created = admin.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json=dict(
            email=email,
            username=f"v_{suffix}",
            display_name="合成普通用户",
            timezone="UTC",
            password=PASSWORD,
        ),
    )
    assert created.status_code == 201, created.text
    member = TestClient(admin.app, base_url=ORIGIN)
    assert login(member, email).status_code == 200

    assert visitor.get(PATH).status_code == 401
    refused = member.get(PATH)
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "ADMIN_REQUIRED"
    assert service.app_version() not in refused.text

    read = admin.get(PATH)
    assert read.status_code == 200, read.text
    data = read.json()["data"]
    assert set(data) == {"version", "build"}
    assert data["version"] == service.app_version()
    build = service.release_build()
    assert data["build"] == (build.model_dump() if build else None)
