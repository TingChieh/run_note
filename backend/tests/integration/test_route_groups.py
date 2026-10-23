"""Route grouping against a real PostGIS test database: synthetic loops only."""

from datetime import date
from math import cos, hypot, radians
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
    return groups.fill_route_groups(app.state.session_factory)


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
    assert fill(app) == 0  # nothing is recomputed


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
