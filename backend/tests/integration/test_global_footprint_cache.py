"""Per-activity global region & city cache: live vs cached parity and Taiwan attribution."""

import json
from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import text

from app.modules.footprints import global_atlas as module
from tests.conftest import register
from tests.integration.test_footprints import add_activity

pytestmark = pytest.mark.integration

SHANGHAI = [(121.45, 31.20), (121.50, 31.25)]
TAIPEI = [(121.55, 25.03), (121.57, 25.04)]
TOKYO = [(139.69, 35.68), (139.71, 35.69)]


def quiet(*test_clients):
    for client in test_clients:
        client.app.state.footprint_worker.stop()


def cache_rows(app, owner):
    with app.state.session_factory() as db:
        return db.scalar(
            text("SELECT count(*) FROM activity_global_footprint_caches WHERE user_id=:o"),
            {"o": UUID(owner)},
        )


def read(client, year=None):
    response = client.get("/api/v1/footprints/global" + (f"?year={year}" if year else ""))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_taipei_lights_up_china_and_taiwan_province_without_separate_country(clients):
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], day=date(2025, 4, 1), geographic=True)
    add_activity(app, owner, [TAIPEI], day=date(2025, 4, 2), geographic=True)
    add_activity(app, owner, [TOKYO], day=date(2026, 4, 3), geographic=True)

    live = read(a)
    assert live["activity_count"] == 3
    assert live["located_activity_count"] == 3
    assert live["region_count"] == 3
    assert [c["code"] for c in live["countries"]] == ["CHN", "JPN"]

    china = live["countries"][0]
    assert china["name"] == "中国"
    assert china["activity_count"] == 2
    assert china["distance_m"] == 2000.0
    assert {r["code"] for r in china["regions"]} == {"CN-310000", "CN-710000"}
    taiwan = next(r for r in china["regions"] if r["code"] == "CN-710000")
    assert taiwan["name"] == "台湾省"
    assert taiwan["short_name"] == "台湾"
    assert taiwan["distance_m"] == 1000.0
    assert any(c["short_name"] == "台北" and c["distance_m"] == 1000.0 for c in taiwan["cities"])

    japan = live["countries"][1]
    assert japan["name"] == "日本"
    assert japan["distance_m"] == 1000.0
    assert japan["regions"][0]["code"] == "JP-13"
    assert japan["regions"][0]["distance_m"] == 1000.0
    assert any(
        c["short_name"] == "东京" and c["distance_m"] == 1000.0
        for c in japan["regions"][0]["cities"]
    )

    assert len(live["region_features"]["features"]) == 3

    assert module.fill_global_footprint_caches(app.state.session_factory, owner=UUID(owner)) == 3
    assert module.fill_global_footprint_caches(app.state.session_factory, owner=UUID(owner)) == 0
    assert cache_rows(app, owner) == 3

    def forbidden(*args, **kwargs):
        raise AssertionError("spatial pass must not run when every row is cached")

    orig = module.compute_global_codes
    module.compute_global_codes = forbidden
    try:
        assert read(a) == live
    finally:
        module.compute_global_codes = orig

    y2026 = read(a, 2026)
    assert y2026["year"] == 2026
    assert [c["code"] for c in y2026["countries"]] == ["JPN"]


def test_worker_scan_fills_global_footprint_caches(clients):
    from app.modules.footprints.worker import run_scan

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [TAIPEI], geographic=True)
    assert cache_rows(app, owner) == 0
    run_scan(
        app.state.session_factory,
        app.state.clock(),
        app.state.expected_revision,
        limit=0,
    )
    assert cache_rows(app, owner) == 1


def test_global_fill_holds_no_user_row_lock_while_matching(clients, monkeypatch):
    """Requests lock their user row (FOR UPDATE, 3 s statement timeout). A fill batch that spans
    two owners must not hold the first owner's row (the cache's foreign key takes a key-share lock)
    through the second owner's slow geometry matching."""
    a, b, _, app = clients
    quiet(a, b)
    owners = [UUID(register(a)), UUID(register(b))]
    for owner in owners:
        add_activity(app, owner, [SHANGHAI], geographic=True)
    original = module.compute_global_codes
    probed = []

    def probe(db, owner, ids, **options):
        # From another connection, every owner's row must be lockable at once while matching runs.
        with app.state.session_factory() as other:
            other.execute(text("SET LOCAL lock_timeout = '200ms'"))
            other.execute(
                text("SELECT id FROM users WHERE id = ANY(:ids) FOR UPDATE"), {"ids": owners}
            )
            other.rollback()
        probed.append(owner)
        return original(db, owner, ids, **options)

    monkeypatch.setattr(module, "compute_global_codes", probe)
    # limit=2: exactly these two newest activities, whatever older rows a shared test database
    # still has uncached (another test's 200,000-point route would exceed the statement budget).
    module.fill_global_footprint_caches(app.state.session_factory, limit=2, max_batches=1)
    assert set(owners) <= set(probed)
    assert all(cache_rows(app, str(owner)) == 1 for owner in owners)


def test_stopping_the_worker_cancels_a_running_global_fill_statement(clients, monkeypatch):
    """Shutdown (deploys, tests) must not wait for a slow geometry match to finish."""
    from threading import Thread
    from time import monotonic

    from app.modules.footprints.worker import WorkerStop

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], geographic=True)
    started = []

    def slow(db, row_owner, ids, **options):
        started.append(monotonic())
        db.execute(text("SELECT pg_sleep(4)"))
        return {}

    monkeypatch.setattr(module, "compute_global_codes", slow)
    stop, outcome = WorkerStop(), {}

    def fill():
        try:
            outcome["filled"] = module.fill_global_footprint_caches(
                app.state.session_factory, max_batches=1, owner=UUID(owner), stop_event=stop
            )
        except Exception as error:  # surfaced below
            outcome["error"] = error

    thread = Thread(target=fill)
    thread.start()
    deadline = monotonic() + 3
    while not started and monotonic() < deadline:
        thread.join(0.05)
    assert started, "the fill never reached the geometry match"
    stop.set()
    thread.join(1.5)
    assert not thread.is_alive(), "stop did not cancel the running statement"
    assert outcome == {"filled": 0}
    assert cache_rows(app, owner) == 0


def test_a_degenerate_dense_track_matches_within_the_fill_budget(clients):
    """200 segments of 1,000 points bouncing between Beijing and Shanghai (within the point
    budget) took ~30 s to match unsimplified, past the fill's 5 s statement timeout."""
    from time import monotonic

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    bounce = [(116.405, 39.9) if i % 2 else (121.48, 31.23) for i in range(1000)]
    activity = add_activity(app, owner, [bounce] * 200, geographic=True)
    with app.state.session_factory() as db:
        db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
        started = monotonic()
        regions, _ = module.compute_global_codes(db, UUID(owner), [UUID(activity)])[UUID(activity)]
        elapsed = monotonic() - started
    assert elapsed < 3, f"matching took {elapsed:.1f}s"
    assert {"CN-110000", "CN-310000"} <= set(regions)


def test_an_owner_whose_matching_times_out_does_not_block_others(clients, monkeypatch):
    a, b, _, app = clients
    quiet(a, b)
    slow_owner, other = UUID(register(a)), UUID(register(b))
    add_activity(app, slow_owner, [SHANGHAI], geographic=True)
    add_activity(app, other, [TOKYO], geographic=True)
    original = module.compute_global_codes
    attempts = []

    def flaky(db, row_owner, ids, **options):
        attempts.append(row_owner)
        if row_owner == slow_owner:
            db.execute(text("SET LOCAL statement_timeout = '50ms'"))
            db.execute(text("SELECT pg_sleep(1)"))
        return original(db, row_owner, ids, **options)

    monkeypatch.setattr(module, "compute_global_codes", flaky)
    filled = module.fill_global_footprint_caches(app.state.session_factory, limit=2, max_batches=1)
    assert filled == 1
    assert cache_rows(app, str(other)) == 1
    assert cache_rows(app, str(slow_owner)) == 0
    assert attempts.count(slow_owner) == 1


def test_a_track_grazing_a_region_boundary_still_counts_the_region(clients):
    """A and B lie just outside Shanghai's boundary; P pokes ~3 m inside. P is closer to the
    chord A-B than the simplification tolerance, so matching only the simplified track drops it."""
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    grazing = [(121.7899996, 30.816517), (121.7930007, 30.81653), (121.7959981, 30.8163831)]
    activity = add_activity(app, owner, [grazing], geographic=True)
    with app.state.session_factory() as db:
        inside = db.scalar(
            text("""SELECT ST_Intersects(
                ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(:region), 4326)),
                ST_SetSRID(ST_MakePoint(:x, :y), 4326))"""),
            {
                "region": json.dumps(module._atlas()["regions_by_code"]["CN-310000"]["geometry"]),
                "x": grazing[1][0],
                "y": grazing[1][1],
            },
        )
        assert inside, "the synthetic track no longer reaches into the bundled boundary"
        regions, _ = module.compute_global_codes(db, UUID(owner), [UUID(activity)])[UUID(activity)]
    assert "CN-310000" in regions


def test_a_slow_track_does_not_hold_back_the_same_owners_other_activities(clients, monkeypatch):
    a, b, _, app = clients
    quiet(a, b)
    owner = UUID(register(a))
    slow = UUID(add_activity(app, owner, [SHANGHAI], geographic=True))
    fast = UUID(add_activity(app, owner, [TOKYO], geographic=True))
    original = module.compute_global_codes
    attempts = []

    def flaky(db, row_owner, ids, **options):
        attempts.append(sorted(ids))
        if slow in ids:
            db.execute(text("SET LOCAL statement_timeout = '50ms'"))
            db.execute(text("SELECT pg_sleep(1)"))
        return original(db, row_owner, ids, **options)

    def cached():
        with app.state.session_factory() as db:
            rows = db.scalars(
                text("SELECT activity_id FROM activity_global_footprint_caches WHERE user_id=:o"),
                {"o": owner},
            )
            return set(rows)

    monkeypatch.setattr(module, "compute_global_codes", flaky)
    for _scan in range(2):
        module.fill_global_footprint_caches(
            app.state.session_factory, limit=2, max_batches=1, owner=owner
        )
        assert cached() == {fast}
    # The second scan only retries the slow track, alone.
    assert attempts[-1] == [slow]
