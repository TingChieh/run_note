"""Route grouping against a real PostGIS test database: synthetic loops only."""

from datetime import date
from math import cos, hypot, radians, sin
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.modules.activities.model import Activity
from app.modules.route_groups import groups
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration  # clients is requested by name

LON, LAT = 121.47, 31.23
METRES = 111_320


def ring(width_m=300, height_m=300, *, east_m=0.0, north_m=0.0, start=0, reverse=False, step_m=20):
    """A closed rectangular loop as (lon, lat) points, optionally shifted, rotated or reversed."""
    scale = METRES * cos(radians(LAT))
    corners = [(0, 0), (width_m, 0), (width_m, height_m), (0, height_m)]
    points = []
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1], strict=True):
        count = max(1, round(hypot(x1 - x0, y1 - y0) / step_m))
        points += [(x0 + (x1 - x0) * i / count, y0 + (y1 - y0) * i / count) for i in range(count)]
    points = points[start:] + points[:start]
    if reverse:
        points = points[::-1]
    points.append(points[0])
    return [(LON + (east_m + x) / scale, LAT + (north_m + y) / METRES) for x, y in points]


def add_run(app, owner, coords, *, day, distance_m=1200, seconds=360, title="Synthetic run"):
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=owner,
            source="gpx",
            title=title,
            activity_date=day,
            date_source="manual",
            timezone="UTC",
            distance_m=distance_m,
            elapsed_seconds=seconds,
            timer_seconds=seconds,
            avg_pace_seconds_per_km=seconds / (distance_m / 1000),
            temporal_quality="complete",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(activity)
        db.flush()
        identifier = str(activity.id)
        wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y in coords) + ")"
        db.execute(
            text(
                """INSERT INTO activity_segments
                   (id, activity_id, segment_index, source_track_index, source_segment_index,
                    break_reason, point_count, geom)
                   VALUES (:sid, :id, 0, 0, 0, 'source_segment', :n, ST_GeomFromText(:wkt, 4326))"""
            ),
            dict(sid=str(uuid4()), id=identifier, n=len(coords), wkt=wkt),
        )
    return identifier


def quiet(*test_clients):
    """Stop the background workers so the test decides when the fill runs."""
    for client in test_clients:
        client.app.state.footprint_worker.stop()


def fill(app):
    """Run scans until idle: the shared test database may hold other owners' pending runs."""
    total = 0
    for _ in range(30):
        done = groups.fill_route_groups(app.state.session_factory)
        if not done:
            break
        total += done
    return total


def members(app, owner):
    with app.state.session_factory() as db:
        rows = db.execute(
            text("SELECT activity_id, group_id FROM route_group_members WHERE user_id = :o"),
            {"o": UUID(owner)},
        ).all()
    return {str(activity): group for activity, group in rows}


def test_same_loop_reversed_rotated_and_jittered_shares_one_group(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    first = add_run(app, owner, ring(), day=date(2025, 1, 1))
    second = add_run(app, owner, ring(reverse=True), day=date(2025, 1, 3), distance_m=1230)
    third = add_run(app, owner, ring(start=7, north_m=8), day=date(2025, 1, 5), distance_m=1190)
    assert fill(app) >= 3
    found = members(app, owner)
    assert set(found) == {first, second, third}
    assert len(set(found.values())) == 1


def test_a_shifted_loop_or_a_very_different_length_is_a_different_route(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    base = add_run(app, owner, ring(), day=date(2025, 2, 1))
    shifted = add_run(app, owner, ring(east_m=400), day=date(2025, 2, 2))
    longer = add_run(app, owner, ring(), day=date(2025, 2, 3), distance_m=2400)
    fill(app)
    found = members(app, owner)
    assert len({found[base], found[shifted], found[longer]}) == 3


def test_short_and_trackless_runs_get_an_empty_fingerprint_and_no_group(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    short = add_run(app, owner, ring(), day=date(2025, 3, 1), distance_m=500)
    fill(app)
    assert members(app, owner) == {}
    with app.state.session_factory() as db:
        geom_is_null = db.scalar(
            text("SELECT geom IS NULL FROM route_fingerprints WHERE activity_id = :a"),
            {"a": UUID(short)},
        )
    assert geom_is_null is True
    assert groups.fill_route_groups(app.state.session_factory) == 0  # nothing is recomputed


def test_a_loop_shifted_within_the_buffer_joins_and_one_beyond_it_does_not(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    base = add_run(app, owner, ring(), day=date(2025, 4, 1))
    near = add_run(app, owner, ring(east_m=20), day=date(2025, 4, 2))
    far = add_run(app, owner, ring(east_m=900), day=date(2025, 4, 3))
    fill(app)
    found = members(app, owner)
    assert found[base] == found[near]
    assert found[far] != found[base]


def test_deleting_runs_removes_members_and_empty_groups_on_the_next_fill(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    only = add_run(app, owner, ring(), day=date(2025, 5, 1))
    fill(app)
    assert only in members(app, owner)
    with app.state.session_factory.begin() as db:
        db.execute(text("DELETE FROM activities WHERE id = :a"), {"a": UUID(only)})
    fill(app)
    with app.state.session_factory() as db:
        remaining = db.scalar(
            text("SELECT count(*) FROM route_groups WHERE user_id = :o"), {"o": UUID(owner)}
        )
    assert remaining == 0


def test_grouping_never_crosses_owners(clients):  # noqa: F811
    a, b, _, app_a = clients
    quiet(a, b)
    owner_a = register(a)
    owner_b = register(b)
    mine = add_run(app_a, owner_a, ring(), day=date(2025, 6, 1))
    theirs = add_run(b.app, owner_b, ring(), day=date(2025, 6, 2))
    fill(app_a)
    assert members(app_a, owner_a)[mine] != members(app_a, owner_b)[theirs]


def test_the_footprint_worker_scan_also_fills_route_groups(clients):  # noqa: F811
    from app.db.schema import get_expected_revision
    from app.modules.footprints.worker import run_scan

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    run = add_run(app, owner, ring(), day=date(2025, 7, 1))
    run_scan(app.state.session_factory, app.state.clock(), get_expected_revision())
    assert run in members(app, owner)


def long_wave(*, north=0.0, points=100_000):
    """About 11 km of dense, gently wavy track: 0.1 m between points, about 0.3 m of wobble."""
    return [
        (LON + i * 1e-6, LAT + north + 0.002 * sin(i / 8000) + 3e-6 * sin(i / 7))
        for i in range(points)
    ]


def test_a_very_long_dense_track_makes_a_small_fingerprint_and_groups(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    first = add_run(app, owner, long_wave(), day=date(2025, 5, 1), distance_m=11000)
    second = add_run(app, owner, long_wave(north=0.0001), day=date(2025, 5, 3), distance_m=11100)
    built = 0
    while True:  # the shared test database may hold older pending runs; drain them in batches
        with app.state.session_factory.begin() as db:
            batch = groups.build_fingerprints(db, 20)
        if not batch:
            break
        built += batch
    assert built >= 2
    with app.state.session_factory() as db:
        rows = db.execute(
            text(
                """SELECT ST_GeometryType(geom), ST_NPoints(geom), ST_SRID(geom)
                   FROM route_fingerprints WHERE activity_id = ANY(:ids)"""
            ),
            {"ids": [UUID(first), UUID(second)]},
        ).all()
    assert len(rows) == 2
    for kind, count, srid in rows:
        assert kind == "ST_MultiLineString"
        assert 2 <= count <= groups.MAX_FINGERPRINT_VERTICES
        assert srid == 4326
    fill(app)
    found = members(app, owner)
    assert found[first] == found[second]


def test_a_run_without_a_track_gets_an_empty_fingerprint_and_no_group(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=UUID(owner),
            source="gpx",
            title="No track",
            activity_date=date(2025, 8, 1),
            date_source="manual",
            timezone="UTC",
            distance_m=1500,
            elapsed_seconds=500,
            timer_seconds=500,
            avg_pace_seconds_per_km=333,
            temporal_quality="complete",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(activity)
        db.flush()
        identifier = activity.id
    fill(app)
    assert members(app, owner) == {}
    with app.state.session_factory() as db:
        geom_is_null = db.scalar(
            text("SELECT geom IS NULL FROM route_fingerprints WHERE activity_id = :a"),
            {"a": identifier},
        )
    assert geom_is_null is True


def test_an_eighty_metre_shift_is_not_the_same_route(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    base = add_run(app, owner, ring(), day=date(2025, 9, 1))
    shifted = add_run(app, owner, ring(east_m=80), day=date(2025, 9, 2))
    fill(app)
    found = members(app, owner)
    assert found[base] != found[shifted]


def test_a_stationary_track_does_not_stop_other_runs_from_being_grouped(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    still = add_run(
        app, owner, [(LON, LAT)] * 5, day=date(2025, 10, 1), distance_m=1500, seconds=500
    )
    first = add_run(app, owner, ring(), day=date(2025, 10, 2))
    second = add_run(app, owner, ring(start=5), day=date(2025, 10, 3))
    fill(app)
    found = members(app, owner)
    assert still not in found
    assert found[first] == found[second]
    with app.state.session_factory() as db:
        geom_is_null = db.scalar(
            text("SELECT geom IS NULL FROM route_fingerprints WHERE activity_id = :a"),
            {"a": UUID(still)},
        )
    assert geom_is_null is True


def group_ids(app, owner):
    with app.state.session_factory() as db:
        return set(
            db.scalars(text("SELECT id FROM route_groups WHERE user_id = :o"), {"o": UUID(owner)})
        )


def test_a_run_that_matches_two_groups_merges_them_into_the_earliest(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    first = add_run(app, owner, ring(), day=date(2025, 11, 1))
    second = add_run(app, owner, ring(east_m=70), day=date(2025, 11, 2))
    fill(app)
    found = members(app, owner)
    assert found[first] != found[second]  # premise: 70 m apart is below the coverage bar
    earliest = found[first]
    third = add_run(app, owner, ring(east_m=35), day=date(2025, 11, 3))
    with app.state.session_factory() as db:
        build = groups.build_fingerprints(db, 20)
        db.commit()
        assert build >= 1
        both = {group for group, _ in groups.matching_groups(db, UUID(owner), UUID(third), 1200)}
    assert both == {found[first], found[second]}  # premise: the third matches both groups
    fill(app)
    found = members(app, owner)
    assert set(found.values()) == {earliest}
    assert set(found) == {first, second, third}
    assert group_ids(app, owner) == {earliest}


def read(client, path):
    response = client.get(path)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_listing_shows_only_routes_run_at_least_twice_with_aggregates(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_run(app, owner, ring(), day=date(2025, 8, 1), seconds=400, title="早晨")
    add_run(app, owner, ring(reverse=True), day=date(2025, 8, 8), seconds=360, distance_m=1210)
    add_run(app, owner, ring(east_m=900), day=date(2025, 8, 9))  # a single run: not listed
    fill(app)
    data = read(a, "/api/v1/routes/groups")
    assert (data["total"], data["limit"], data["offset"], data["building"]) == (1, 20, 0, False)
    item = data["items"][0]
    assert item["run_count"] == 2
    assert (item["first_date"], item["last_date"]) == ("2025-08-01", "2025-08-08")
    assert float(item["best_duration_seconds"]) == 360
    assert float(item["avg_duration_seconds"]) == 380
    assert len(item["shape"]) == 1 and len(item["shape"][0]) >= 4
    assert set(item) == {
        "id",
        "run_count",
        "first_date",
        "last_date",
        "median_distance_m",
        "best_duration_seconds",
        "avg_duration_seconds",
        "best_pace_seconds_per_km",
        "avg_pace_seconds_per_km",
        "shape",
    }


def test_detail_lists_runs_newest_first_and_other_owners_get_404(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    register(b)
    first = add_run(app, owner, ring(), day=date(2025, 9, 1), title="第一次")
    second = add_run(app, owner, ring(), day=date(2025, 9, 2), title="第二次")
    fill(app)
    group = read(a, "/api/v1/routes/groups")["items"][0]["id"]
    detail = read(a, f"/api/v1/routes/groups/{group}")
    assert [run["activity_id"] for run in detail["runs"]] == [second, first]
    assert detail["runs"][0]["title"] == "第二次" and 0 < detail["runs"][0]["coverage"] <= 1
    response = b.get(f"/api/v1/routes/groups/{group}")
    assert response.status_code == 404 and response.json()["error"]["code"] == "ROUTE_NOT_FOUND"
    assert a.get(f"/api/v1/routes/groups/{uuid4()}").status_code == 404


def test_listing_pages_sorts_and_flags_unprocessed_runs_as_building(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    for day in (1, 2, 3):
        add_run(app, owner, ring(), day=date(2025, 10, day))
    for day in (4, 5):
        add_run(app, owner, ring(east_m=900), day=date(2025, 10, day), distance_m=1700)
    assert read(a, "/api/v1/routes/groups")["building"] is True  # nothing processed yet
    fill(app)
    by_count = read(a, "/api/v1/routes/groups?sort=count")["items"]
    assert [item["run_count"] for item in by_count] == [3, 2]
    by_distance = read(a, "/api/v1/routes/groups?sort=distance")["items"]
    assert [item["run_count"] for item in by_distance] == [2, 3]
    page = read(a, "/api/v1/routes/groups?limit=1&offset=1")
    assert (page["total"], len(page["items"])) == (2, 1)
    assert a.get("/api/v1/routes/groups?sort=nope").status_code == 422
    assert a.get("/api/v1/routes/groups?owner=x").status_code == 422
