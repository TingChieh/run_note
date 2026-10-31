"""Owner-scoped metadata and hard-delete behavior on synthetic isolated records."""

# ruff: noqa: F811 -- imported pytest fixture
from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import clients, headers, register, upload  # noqa: F401
from tests.integration.test_ai_reports import ai_clients, post, seed  # noqa: F401
from tests.integration.test_tcx_import import upload_tcx

pytestmark = pytest.mark.integration


def version(engine, owner):
    with engine.connect() as db:
        return db.scalar(
            text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner}
        )


def test_metadata_persists_and_is_private_without_changing_imported_metrics(clients):
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    original = upload(a).json()["data"]["activity"]
    path = f"/api/v1/activities/{original['id']}"
    response = a.patch(
        path,
        headers=headers(a),
        json={"title": "  周末晨跑  ", "notes": "私人感受\n<script>文本</script>"},
    )
    assert response.status_code == 200, response.text
    saved = response.json()["data"]
    assert saved["title"] == "周末晨跑"
    assert saved["notes"] == "私人感受\n<script>文本</script>"
    for field in original.keys() - {"title", "notes"}:
        assert saved[field] == original[field]
    assert a.get(path).json()["data"] == saved
    assert a.get("/api/v1/activities").json()["data"]["items"][0]["title"] == "周末晨跑"
    assert version(engine, owner) == 2
    assert b.patch(path, headers=headers(b), json={"title": "越权"}).status_code == 404
    assert version(engine, owner) == 2
    assert a.patch(path, headers=headers(a), json={"visibility": "public"}).status_code == 200
    public = b.get(f"/api/v1/public/activities/{original['id']}").json()["data"]
    assert public["title"] == "周末晨跑" and "notes" not in public
    assert a.patch(path, headers=headers(a), json={"notes": ""}).json()["data"]["notes"] == ""


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": ""},
        {"title": "   "},
        {"title": None},
        {"title": 123},
        {"title": "字" * 121},
        {"notes": None},
        {"notes": "字" * 5001},
        {"distance_m": 100},
        {"activity_date": "2026-01-01"},
        {"user_id": str(uuid4())},
    ],
)
def test_invalid_metadata_never_changes_record_or_version(clients, payload):
    a, _, engine, _ = clients
    owner = register(a)
    original = upload(a).json()["data"]["activity"]
    path = f"/api/v1/activities/{original['id']}"
    assert a.patch(path, headers=headers(a), json=payload).status_code == 422
    assert a.get(path).json()["data"] == original
    assert version(engine, owner) == 1


@pytest.mark.parametrize(
    "importer,source_table", [(upload, "gpx_imports"), (upload_tcx, "tcx_imports")]
)
def test_delete_cascades_sources_routes_shares_updates_statistics_and_allows_reimport(
    clients, importer, source_table
):
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    record = importer(a).json()["data"]["activity"]
    identifier = record["id"]
    path = f"/api/v1/activities/{identifier}"
    assert a.patch(path, headers=headers(a), json={"visibility": "unlisted"}).status_code == 200
    shared = a.post(path + "/shares", headers=headers(a), json={}).json()["data"]["share_url"]
    shared_path = "/api/v1/shared/" + shared.rsplit("/", 1)[1]
    assert b.get(shared_path).status_code == 200
    with engine.connect() as db:
        segments = (
            db.execute(
                text("SELECT id FROM activity_segments WHERE activity_id=:id"), {"id": identifier}
            )
            .scalars()
            .all()
        )
        assert segments
    assert b.delete(path, headers=headers(b)).status_code == 404
    assert a.delete(path).status_code == 403
    assert (
        a.delete(path, headers={**headers(a), "Origin": "https://evil.example"}).status_code == 403
    )
    assert version(engine, owner) == 2
    response = a.delete(path, headers=headers(a))
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"deleted": True}
    assert version(engine, owner) == 3
    assert a.get(path).status_code == a.get(path + "/route").status_code == 404
    assert b.get(shared_path).status_code == 404
    assert a.get("/api/v1/activities").json()["data"]["total"] == 0
    assert a.get("/api/v1/statistics/summary").json()["data"]["activity_count"] == 0
    with engine.connect() as db:
        for table in [source_table, "activity_segments", "activity_share_links"]:
            assert (
                db.scalar(
                    text(f"SELECT count(*) FROM {table} WHERE activity_id=:id"), {"id": identifier}
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
    assert a.delete(path, headers=headers(a)).status_code == 404
    assert version(engine, owner) == 3
    assert importer(a).status_code == 201


def test_mutations_require_identity_csrf_and_allow_maximum_text_lengths(clients):
    a, _, engine, _ = clients
    unknown = f"/api/v1/activities/{uuid4()}"
    assert a.patch(unknown, json={"title": "无身份"}).status_code == 401
    assert a.delete(unknown).status_code == 401
    owner = register(a)
    record = upload(a).json()["data"]["activity"]
    path = f"/api/v1/activities/{record['id']}"
    assert a.patch(path, json={"title": "缺少 CSRF"}).status_code == 403
    assert (
        a.patch(
            path, headers={**headers(a), "X-CSRF-Token": "bad"}, json={"title": "坏 token"}
        ).status_code
        == 403
    )
    assert a.patch(unknown, headers=headers(a), json={"title": "不存在"}).status_code == 404
    result = a.patch(path, headers=headers(a), json={"title": "字" * 120, "notes": "字" * 5000})
    assert result.status_code == 200, result.text
    assert len(result.json()["data"]["notes"]) == 5000
    assert version(engine, owner) == 2


def test_edit_and_delete_mark_existing_ai_snapshots_stale_without_regeneration(ai_clients):
    a, _, app, provider = ai_clients
    owner = register(a)
    seed(app, owner)
    activity = a.get("/api/v1/activities").json()["data"]["items"][0]
    path = f"/api/v1/activities/{activity['id']}"
    first = post(a).json()["data"]
    assert first["is_stale"] is False
    assert a.patch(path, headers=headers(a), json={"notes": "修改备注"}).status_code == 200
    stored = a.get("/api/v1/ai-reports/" + first["id"]).json()["data"]
    assert stored["is_stale"] is True
    assert stored["stats_snapshot"] == first["stats_snapshot"]
    second = post(a).json()["data"]
    assert second["is_stale"] is False
    assert a.delete(path, headers=headers(a)).status_code == 200
    stored = a.get("/api/v1/ai-reports/" + second["id"]).json()["data"]
    assert stored["is_stale"] is True
    assert stored["stats_snapshot"] == second["stats_snapshot"]
    assert len(provider.calls) == 2


def test_concurrent_metadata_changes_preserve_both_fields_and_version_increments(clients):
    from concurrent.futures import ThreadPoolExecutor

    a, b, engine, _ = clients
    owner = register(a)
    activity = upload(a).json()["data"]["activity"]
    path = f"/api/v1/activities/{activity['id']}"
    h = headers(a)
    b.app.state.settings.site_owner_email = a.app.state.settings.site_owner_email
    b.cookies.update(a.cookies)
    with ThreadPoolExecutor(max_workers=2) as pool:
        title = pool.submit(a.patch, path, headers=h, json={"title": "并发标题"})
        notes = pool.submit(b.patch, path, headers=h, json={"notes": "并发备注"})
        assert title.result().status_code == notes.result().status_code == 200
    stored = a.get(path).json()["data"]
    assert stored["title"] == "并发标题" and stored["notes"] == "并发备注"
    assert version(engine, owner) == 3
