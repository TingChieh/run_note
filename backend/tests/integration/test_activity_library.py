"""Private labels and atomic current-page deletion on isolated synthetic data."""

# ruff: noqa: F811
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.db.schema import get_expected_revision
from tests.conftest import clients, headers, register, upload  # noqa: F401
from tests.integration.test_activity_management import version
from tests.integration.test_tcx_import import upload_tcx

pytestmark = pytest.mark.integration


def test_labels_normalize_persist_and_stay_private(clients):
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    record = upload(a).json()["data"]["activity"]
    assert record["category"] == "" and record["tags"] == []
    path = f"/api/v1/activities/{record['id']}"
    saved = a.patch(
        path,
        headers=headers(a),
        json={
            "category": "  长距离  ",
            "tags": ["  公园 ", "晨跑", "公园"],
        },
    )
    assert saved.status_code == 200, saved.text
    data = saved.json()["data"]
    assert data["category"] == "长距离" and data["tags"] == ["公园", "晨跑"]
    assert a.get(path).json()["data"] == data
    assert a.get("/api/v1/activities").json()["data"]["items"][0]["tags"] == ["公园", "晨跑"]
    assert (
        a.patch(path, headers=headers(a), json={"title": "新标题"}).json()["data"]["category"]
        == "长距离"
    )
    assert b.patch(path, headers=headers(b), json={"category": "越权"}).status_code == 404
    a.patch(path, headers=headers(a), json={"visibility": "public"})
    shared = a.post(path + "/shares", headers=headers(a), json={}).json()["data"]["share_url"]
    for public_path in [
        f"/api/v1/public/activities/{record['id']}",
        "/api/v1/shared/" + shared.rsplit("/", 1)[1],
    ]:
        public = b.get(public_path).json()["data"]
        assert "category" not in public and "tags" not in public
    assert version(engine, owner) == 4
    cleared = a.patch(path, headers=headers(a), json={"category": " ", "tags": []}).json()["data"]
    assert cleared["category"] == "" and cleared["tags"] == []


@pytest.mark.parametrize(
    "payload",
    [
        {"category": None},
        {"category": 2},
        {"category": "字" * 31},
        {"tags": None},
        {"tags": "晨跑"},
        {"tags": [None]},
        {"tags": [2]},
        {"tags": [""]},
        {"tags": [" "]},
        {"tags": ["字" * 31]},
        {"tags": [str(n) for n in range(11)]},
        {"achievement": "20 km"},
    ],
)
def test_invalid_labels_leave_record_and_version_unchanged(clients, payload):
    a, _, engine, _ = clients
    owner = register(a)
    record = upload(a).json()["data"]["activity"]
    path = f"/api/v1/activities/{record['id']}"
    assert a.patch(path, headers=headers(a), json=payload).status_code == 422
    assert a.get(path).json()["data"] == record
    assert version(engine, owner) == 1


def test_batch_is_atomic_owner_scoped_and_cascades(clients):
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    first = upload(a).json()["data"]["activity"]["id"]
    second = upload_tcx(a).json()["data"]["activity"]["id"]
    foreign = upload(b).json()["data"]["activity"]["id"]
    endpoint = "/api/v1/activities/batch-delete"
    for missing in [foreign, str(uuid4())]:
        result = a.post(endpoint, headers=headers(a), json={"ids": [first, missing]})
        assert result.status_code == 404, result.text
        assert a.get(f"/api/v1/activities/{first}").status_code == 200
        assert version(engine, owner) == 2
    a.patch(f"/api/v1/activities/{first}", headers=headers(a), json={"visibility": "unlisted"})
    shared = a.post(f"/api/v1/activities/{first}/shares", headers=headers(a), json={}).json()[
        "data"
    ]["share_url"]
    with engine.connect() as db:
        segments = (
            db.execute(
                text("SELECT id FROM activity_segments WHERE activity_id IN (:a,:b)"),
                {"a": first, "b": second},
            )
            .scalars()
            .all()
        )
    response = a.post(endpoint, headers=headers(a), json={"ids": [first, second]})
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"deleted": True, "deleted_count": 2}
    assert version(engine, owner) == 4
    assert a.get("/api/v1/statistics/summary").json()["data"]["activity_count"] == 0
    assert b.get(f"/api/v1/activities/{foreign}").status_code == 200
    assert b.get("/api/v1/shared/" + shared.rsplit("/", 1)[1]).status_code == 404
    with engine.connect() as db:
        for table in ["gpx_imports", "tcx_imports", "activity_segments", "activity_share_links"]:
            assert (
                db.scalar(
                    text(f"SELECT count(*) FROM {table} WHERE activity_id IN (:a,:b)"),
                    {"a": first, "b": second},
                )
                == 0
            )
        for segment in segments:
            assert (
                db.scalar(
                    text("SELECT count(*) FROM activity_points WHERE segment_id=:id"),
                    {"id": segment},
                )
                == 0
            )
    assert upload(a).status_code == 201 and upload_tcx(a).status_code == 201


def test_batch_auth_csrf_and_payload_validation(clients):
    a, _, engine, _ = clients
    endpoint = "/api/v1/activities/batch-delete"
    payload = {"ids": [str(uuid4())]}
    assert a.post(endpoint, json=payload).status_code == 401
    owner = register(a)
    first = upload(a).json()["data"]["activity"]["id"]
    payload = {"ids": [first]}
    assert a.post(endpoint, json=payload).status_code == 403
    assert (
        a.post(
            endpoint, json=payload, headers={**headers(a), "Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    for bad in [
        {"ids": []},
        {"ids": [first, first]},
        {"ids": [str(uuid4()) for _ in range(101)]},
        {"ids": ["bad"]},
        {"ids": [first], "all": True},
    ]:
        response = a.post(endpoint, json=bad, headers=headers(a))
        assert response.status_code == 422, response.text
    assert version(engine, owner) == 1


def test_concurrent_batches_delete_only_once_and_increment_once(clients):
    from concurrent.futures import ThreadPoolExecutor

    a, b, engine, _ = clients
    owner = register(a)
    identifier = upload(a).json()["data"]["activity"]["id"]
    h = headers(a)
    b.app.state.settings.site_owner_email = a.app.state.settings.site_owner_email
    b.cookies.update(a.cookies)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [
            pool.submit(
                client.post,
                "/api/v1/activities/batch-delete",
                headers=h,
                json={"ids": [identifier]},
            )
            for client in [a, b]
        ]
        assert sorted(result.result().status_code for result in results) == [200, 404]
    assert version(engine, owner) == 2


def test_label_migration_refuses_silent_metadata_loss(clients):
    from tests.integration.test_migrations import assert_downgrade_guard

    a, _, engine, _ = clients
    register(a)
    identifier = upload(a).json()["data"]["activity"]["id"]
    path = f"/api/v1/activities/{identifier}"
    assert (
        a.patch(
            path,
            headers=headers(a),
            json={"category": "字" * 30, "tags": ["字" * 30] + [str(n) for n in range(9)]},
        ).status_code
        == 200
    )
    try:
        assert_downgrade_guard(
            engine, "0008_activity_labels", "Cannot downgrade while activity labels exist"
        )
        with engine.connect() as db:
            assert (
                db.scalar(text("SELECT version_num FROM alembic_version"))
                == get_expected_revision()
            )
        assert a.get(path).json()["data"]["category"] == "字" * 30
    finally:
        a.patch(path, headers=headers(a), json={"category": "", "tags": []})
