"""All synthetic history, snapshots and concurrency on the guarded PostGIS test database."""

# ruff: noqa: F811
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import event, select

from tests.integration.test_footprints import add_activity
from tests.integration.test_gpx_import import clients, headers, register, upload  # noqa: F401

pytestmark = pytest.mark.integration
PATH = "/api/v1/footprints/all?mode="
NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)


def read(client, mode="tracks"):
    response = client.get(PATH + mode)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def build(app, owner, now=NOW):
    from app.modules.footprints.snapshot import build_user_snapshot

    assert build_user_snapshot(app.state.session_factory, UUID(owner), now)


def test_all_endpoint_requires_owner_and_rejects_filter_parameters(clients):
    a, b, _, app = clients
    assert a.get(PATH + "tracks").status_code == 401
    owner = register(a)
    for query in ["mode=bad", "mode=tracks&owner=x", "mode=tracks&date_from=2024-01-01"]:
        assert a.get("/api/v1/footprints/all?" + query).status_code == 422
    initial = read(a)
    assert initial["status"] == "pending" and initial["result"] is None
    build(app, owner)
    ready = read(a)
    assert ready["status"] == "ready" and ready["generated_at"]
    assert ready["result"]["scope"] == "all"
    assert ready["result"]["features"] == []
    assert ready["result"]["activity_count"] == 0
    register(b)
    assert read(b)["result"] is None


@pytest.fixture(autouse=True)
def pause_periodic_worker(monkeypatch, request):
    from app.modules.footprints.worker import FootprintWorker

    if request.node.name == "test_background_lifecycle_generates_imports_without_page_rebuilds":
        from app.modules.footprints import worker

        monkeypatch.setattr(worker, "SCAN_INTERVAL_SECONDS", 0.02)
        return
    monkeypatch.setattr(FootprintWorker, "start", lambda self: None)


def test_all_years_and_activity_dedup_preserve_full_spatial_semantics(clients):
    a, b, _, app = clients
    owner, other = register(a), register(b)
    first = add_activity(app, owner, [[(10, 50), (390, 50)]], day=date(2022, 1, 1))
    second = add_activity(
        app,
        owner,
        [[(10, 50), (150, 50), (390, 50), (10, 50)], [(10, 50), (390, 50)]],
        day=date(2026, 1, 1),
    )
    add_activity(app, owner, [[(10, 89), (10.001, 89)]], day=date(2023, 1, 1), geographic=True)
    add_activity(app, other, [[(10, 50), (390, 50)]])
    build(app, owner)
    tracks = read(a)["result"]
    assert tracks["activity_count"] == 3
    assert tracks["visible_activity_count"] == 2
    assert tracks["unsupported_segment_count"] == 1
    assert {f["properties"]["activity_id"] for f in tracks["features"]} == {first, second}
    assert {f["properties"]["activity_date"] for f in tracks["features"]} == {
        "2022-01-01",
        "2026-01-01",
    }
    heat = read(a, "heatmap")["result"]
    assert heat["max_count"] == 2
    assert {
        (f["properties"]["i"], f["properties"]["j"]): f["properties"]["count"]
        for f in heat["features"]
    } == {
        (0, 0): 2,
        (1, 0): 2,
        (2, 0): 2,
        (3, 0): 2,
    }
    assert read(b)["result"] is None


@pytest.mark.parametrize(
    "lines",
    [
        [[(179.999, 0.0004), (-179.999, 0.0004)]],
        [[(10, 89), (10.001, 89)]],
        [[(0, 0), (0, 0)]],
        [
            [(0.0001, 0.0001), (0.0002, 0.0001)],
            [(0.0031, 0.0001), (0.0032, 0.0001)],
            [(0.005, 0.0001)],
        ],
    ],
)
def test_snapshots_match_legacy_exact_geometry_without_losing_edge_cases(clients, lines):
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, lines, geographic=True)
    build(app, owner)
    for mode in ("tracks", "heatmap"):
        legacy = a.get(f"/api/v1/footprints?date_from=2024-01-01&date_to=2025-01-01&mode={mode}")
        assert legacy.status_code == 200, legacy.text
        old, new = legacy.json()["data"], read(a, mode)["result"]
        for key in (
            "features",
            "activity_count",
            "visible_activity_count",
            "unsupported_segment_count",
            "max_count",
        ):
            assert new[key] == old[key]


def test_imports_incremental_metadata_delete_and_old_snapshot_replacement(clients, monkeypatch):
    from app.modules.footprints import snapshot
    from app.modules.footprints.model import FootprintActivityCache, FootprintSnapshot
    from tests.integration.test_mifitness_import import send, track
    from tests.integration.test_tcx_import import upload_tcx

    a, _, _, app = clients
    owner = register(a)
    generated = []
    original = snapshot.build_activity_cache

    def record(*args):
        generated.append(str(args[2]))
        return original(*args)

    monkeypatch.setattr(snapshot, "build_activity_cache", record)
    identifiers = []
    for importer in (upload, upload_tcx, lambda client: send(client, raw=track())):
        response = importer(a)
        assert response.status_code == 201, response.text
        identifier = response.json()["data"]["activity"]["id"]
        identifiers.append(identifier)
        assert read(a)["result"] is None
        before = len(generated)
        build(app, owner)
        assert generated[before:] == [identifier]
        assert read(a)["result"]["activity_count"] == len(identifiers)
    first = identifiers[0]
    assert (
        a.patch(
            f"/api/v1/activities/{first}", headers=headers(a), json={"title": "新路线标题"}
        ).status_code
        == 200
    )
    assert read(a)["result"] is None
    before = len(generated)
    build(app, owner)
    assert len(generated) == before
    assert {
        f["properties"]["title"]
        for f in read(a)["result"]["features"]
        if f["properties"]["activity_id"] == first
    } == {"新路线标题"}
    assert a.delete(f"/api/v1/activities/{first}", headers=headers(a)).status_code == 200
    assert read(a)["result"] is None
    with app.state.session_factory() as db:
        assert (
            db.scalar(
                select(FootprintActivityCache).where(
                    FootprintActivityCache.activity_id == UUID(first)
                )
            )
            is None
        )
    build(app, owner)
    assert first not in {f["properties"]["activity_id"] for f in read(a)["result"]["features"]}
    assert (
        a.post(
            "/api/v1/activities/batch-delete", headers=headers(a), json={"ids": identifiers[1:]}
        ).status_code
        == 200
    )
    assert read(a)["result"] is None
    build(app, owner)
    assert read(a)["result"]["activity_count"] == 0
    assert read(a)["result"]["features"] == []
    with app.state.session_factory() as db:
        assert (
            len(
                list(
                    db.scalars(
                        select(FootprintSnapshot).where(FootprintSnapshot.user_id == UUID(owner))
                    )
                )
            )
            == 1
        )
        assert (
            list(
                db.scalars(
                    select(FootprintActivityCache).where(
                        FootprintActivityCache.user_id == UUID(owner)
                    )
                )
            )
            == []
        )


def test_failure_backoff_daily_refresh_and_algorithm_cache_replacement(clients, monkeypatch):
    from app.modules.footprints import snapshot
    from app.modules.footprints.model import FootprintActivityCache, FootprintSnapshot

    a, _, _, app = clients
    owner = register(a)
    assert upload(a).status_code == 201
    original = snapshot.build_activity_cache

    def fail(*args):
        raise RuntimeError("synthetic private trace data must never escape")

    monkeypatch.setattr(snapshot, "build_activity_cache", fail)
    assert not snapshot.build_user_snapshot(app.state.session_factory, UUID(owner), NOW)
    assert read(a)["status"] == "failed" and read(a)["result"] is None
    monkeypatch.setattr(snapshot, "build_activity_cache", original)
    assert not snapshot.build_user_snapshot(
        app.state.session_factory, UUID(owner), NOW + timedelta(seconds=59)
    )
    build(app, owner, NOW + timedelta(seconds=61))
    before = read(a)["generated_at"]
    assert not snapshot.build_user_snapshot(
        app.state.session_factory, UUID(owner), NOW + timedelta(hours=23)
    )
    build(app, owner, NOW + timedelta(hours=25))
    assert read(a)["generated_at"] != before
    with app.state.session_factory.begin() as db:
        cache = db.scalar(
            select(FootprintActivityCache).where(FootprintActivityCache.user_id == UUID(owner))
        )
        cache_id = cache.id
        cache.algorithm_version = "old"
        state = db.scalar(select(FootprintSnapshot).where(FootprintSnapshot.user_id == UUID(owner)))
        state.algorithm_version = "old"
    assert read(a)["result"] is None
    build(app, owner, NOW + timedelta(hours=26))
    with app.state.session_factory() as db:
        rows = list(
            db.scalars(
                select(FootprintActivityCache).where(FootprintActivityCache.user_id == UUID(owner))
            )
        )
        assert len(rows) == 1 and rows[0].id == cache_id
        assert rows[0].algorithm_version == snapshot.ALGORITHM_VERSION


def test_two_workers_do_not_duplicate_and_concurrent_edit_cannot_publish_stale(
    clients, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from app.modules.footprints import snapshot

    a, _, _, app = clients
    owner = register(a)
    identifier = upload(a).json()["data"]["activity"]["id"]
    entered, release = Event(), Event()
    original = snapshot._assemble

    def held(*args):
        result = original(*args)
        entered.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(snapshot, "_assemble", held)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(
            snapshot.build_user_snapshot, app.state.session_factory, UUID(owner), NOW
        )
        try:
            assert entered.wait(10)
            assert not snapshot.build_user_snapshot(app.state.session_factory, UUID(owner), NOW)
            assert (
                a.patch(
                    f"/api/v1/activities/{identifier}",
                    headers=headers(a),
                    json={"title": "并发后的标题"},
                ).status_code
                == 200
            )
        finally:
            release.set()
        assert not first.result(timeout=10)
    assert read(a)["result"] is None
    monkeypatch.setattr(snapshot, "_assemble", original)
    build(app, owner)
    assert {f["properties"]["title"] for f in read(a)["result"]["features"]} == {"并发后的标题"}


def test_get_remains_constant_query_count_without_reading_original_geometry(clients):
    import json
    import time

    a, _, _, app = clients
    owner = register(a)
    # Each of six routes has 50000 full vertices: account total exceeds old 250000 limit.
    for n in range(6):
        add_activity(
            app,
            owner,
            [[(121 + i / 100000000, 31 + n / 1000) for i in range(50000)]],
            geographic=True,
        )
    start = time.perf_counter()
    build(app, owner)
    build_ms = (time.perf_counter() - start) * 1000
    statements = []
    engine = app.state.session_factory.kw["bind"]

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    durations, query_counts = [], []
    try:
        for _ in range(3):
            statements.clear()
            start = time.perf_counter()
            result = read(a)
            durations.append(round((time.perf_counter() - start) * 1000, 2))
            query_counts.append(len(statements))
            selected = [
                sql for sql in statements if "FROM users LEFT OUTER JOIN footprint_snapshots" in sql
            ]
            assert len(selected) == 1 and "footprint_snapshots.heatmap" not in selected[0]
            assert result["status"] == "ready"
            assert result["result"]["activity_count"] == 6
            assert (
                sum(len(f["geometry"]["coordinates"]) for f in result["result"]["features"])
                == 300000
            )
            assert not any(
                "activity_segments" in sql or "activity_points" in sql or "ST_Intersects" in sql
                for sql in statements
            )
        assert len(set(query_counts)) == 1 and query_counts[0] <= 6
    finally:
        event.remove(engine, "before_cursor_execute", record)
    print(
        json.dumps(
            {
                "synthetic_points": 300000,
                "build_ms": round(build_ms, 2),
                "read_ms": durations,
                "query_counts": query_counts,
                "response_bytes": len(json.dumps(result).encode()),
            }
        )
    )


def test_background_lifecycle_generates_imports_without_page_rebuilds(clients):
    from threading import Event
    from time import monotonic

    from tests.integration.test_mifitness_import import send, track
    from tests.integration.test_tcx_import import upload_tcx

    a, _, _, app = clients
    register(a)
    for importer in (upload, upload_tcx, lambda client: send(client, raw=track())):
        response = importer(a)
        assert response.status_code == 201, response.text
    deadline = monotonic() + 15
    wait = Event()
    while True:
        data = read(a)
        if data["status"] == "ready" and data["result"]["activity_count"] == 3:
            break
        assert monotonic() < deadline, data
        wait.wait(0.03)
    assert read(a, "heatmap")["status"] == "ready"
    assert data["result"]["visible_activity_count"] == 3
    app.state.footprint_worker.stop()
    assert not app.state.footprint_worker.thread.is_alive()


def test_snapshot_migration_guard_retains_successful_derived_data(clients):
    from tests.integration.test_migrations import assert_downgrade_guard

    a, _, engine, app = clients
    owner = register(a)
    build(app, owner)
    assert_downgrade_guard(engine, "0010_footprint_snapshots", "Cannot downgrade")
    assert read(a)["status"] == "ready"


def test_periodic_refresh_failure_retains_current_success_with_explicit_warning(
    clients, monkeypatch
):
    from app.modules.footprints import snapshot

    a, _, _, app = clients
    owner = register(a)
    assert upload(a).status_code == 201
    build(app, owner)
    before = read(a)
    original = snapshot._assemble

    def fail(*args):
        raise RuntimeError("synthetic refresh failure")

    monkeypatch.setattr(snapshot, "_assemble", fail)
    assert not snapshot.build_user_snapshot(
        app.state.session_factory, UUID(owner), NOW + timedelta(hours=25)
    )
    failed_refresh = read(a)
    assert failed_refresh["status"] == "ready" and failed_refresh["refresh_failed"]
    assert failed_refresh["result"] == before["result"]
    assert failed_refresh["generated_at"] == before["generated_at"]
    monkeypatch.setattr(snapshot, "_assemble", original)
    build(app, owner, NOW + timedelta(hours=26))
    assert not read(a)["refresh_failed"]
