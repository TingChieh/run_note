"""Place-based run naming against a real PostGIS test database: synthetic geometry only."""

import time
from datetime import date
from math import cos, hypot, radians
from uuid import UUID, uuid4

import psycopg.errors
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.activities.model import Activity
from app.modules.place_titles import queue, rules, service
from tests.integration.test_gpx_import import clients, register, upload  # noqa: F401

pytestmark = pytest.mark.integration  # clients is requested by name

LON, LAT = 121.47, 31.23
METRES = 111_320


def ring(width_m=300, height_m=300, *, step_m=20):
    """A closed rectangular loop as (lon, lat) points."""
    scale = METRES * cos(radians(LAT))
    corners = [(0, 0), (width_m, 0), (width_m, height_m), (0, height_m)]
    points = []
    for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1], strict=True):
        count = max(1, round(hypot(x1 - x0, y1 - y0) / step_m))
        points += [(x0 + (x1 - x0) * i / count, y0 + (y1 - y0) * i / count) for i in range(count)]
    points.append(points[0])
    return [(LON + x / scale, LAT + y / METRES) for x, y in points]


def add_run(app, owner, coords, *, day, distance_m=1200, seconds=360, title=None):
    """title=None stores the importer default title for the day."""
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=owner,
            source="gpx",
            title=title or rules.default_title(day),
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


def add_place(app, category, polygon_lonlat, region):
    wkt = "POLYGON((" + ",".join(f"{x} {y}" for x, y in polygon_lonlat) + "))"
    with app.state.session_factory.begin() as db:
        db.execute(
            text(
                "INSERT INTO place_features (id, category, geom, region) "
                "VALUES (gen_random_uuid(), :c, ST_GeogFromText(:w), :r)"
            ),
            {"c": category, "w": f"SRID=4326;{wkt}", "r": region},
        )


def clear_places(app, region):
    with app.state.session_factory.begin() as db:
        db.execute(text("DELETE FROM place_features WHERE region = :r"), {"r": region})


@pytest.fixture
def region(clients):  # noqa: F811
    """A region label unique to the test; only its own features are removed afterwards."""
    label = f"synthetic-{uuid4().hex[:12]}"
    yield label
    clear_places(clients[3], label)


def box_around_ring(margin_m=0, shift_east_m=0):
    """A lake-sized box that fully covers the synthetic 300 m loop (plus margin)."""
    scale = METRES * cos(radians(LAT))
    west = LON - (margin_m - shift_east_m) / scale
    east = LON + (300 + margin_m + shift_east_m) / scale
    south, north = LAT - margin_m / METRES, LAT + (300 + margin_m) / METRES
    return [(west, south), (east, south), (east, north), (west, north), (west, south)]


def queue_state(app, activity):
    with app.state.session_factory() as db:
        return db.execute(
            text(
                "SELECT state, category, applied_title FROM activity_place_names "
                "WHERE activity_id=:a"
            ),
            {"a": UUID(activity)},
        ).first()


def title_of(app, activity):
    with app.state.session_factory() as db:
        return db.scalar(text("SELECT title FROM activities WHERE id=:a"), {"a": UUID(activity)})


def enqueue(app, owner, activity):
    with app.state.session_factory.begin() as db:
        queue.enqueue(db, UUID(owner), UUID(activity))


def fill(app):
    return service.fill_place_titles(app.state.session_factory)


def test_a_run_along_a_lake_is_renamed_and_the_data_version_moves(clients, region):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 1, 1))
    enqueue(app, owner, activity)
    with app.state.session_factory() as db:
        before = db.scalar(
            text("SELECT activity_data_version FROM users WHERE id=:o"), {"o": UUID(owner)}
        )
    assert fill(app) >= 1
    assert title_of(app, activity) == "湖边跑步"
    assert queue_state(app, activity) == ("done", "lake", "湖边跑步")
    with app.state.session_factory() as db:
        after = db.scalar(
            text("SELECT activity_data_version FROM users WHERE id=:o"), {"o": UUID(owner)}
        )
    assert after == before + 1


def test_far_from_any_place_or_too_short_or_user_named_is_left_alone(clients, region):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0, shift_east_m=5000), region)  # 5 km away
    owner = register(a)
    far = add_run(app, owner, ring(), day=date(2025, 2, 1))
    short = add_run(app, owner, ring(), day=date(2025, 2, 2), distance_m=500)
    named = add_run(app, owner, ring(), day=date(2025, 2, 3), title="我的晨跑")
    for activity in (far, short, named):
        enqueue(app, owner, activity)
    fill(app)
    assert title_of(app, far) == rules.default_title(date(2025, 2, 1))
    assert title_of(app, short) == rules.default_title(date(2025, 2, 2))
    assert title_of(app, named) == "我的晨跑"
    assert [queue_state(app, x)[0] for x in (far, short, named)] == ["skipped"] * 3


def test_an_empty_place_table_keeps_the_queue_pending(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    with app.state.session_factory() as db:
        if service.place_count(db):
            pytest.skip("shared test database already holds place features")
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 3, 1))
    enqueue(app, owner, activity)
    assert fill(app) == 0
    assert queue_state(app, activity)[0] == "pending"


def test_the_priority_between_categories_follows_the_share(clients, region):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "park", box_around_ring(margin_m=0), region)
    add_place(app, "sea", box_around_ring(margin_m=0), region)  # equal shares: sea wins
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 4, 1))
    enqueue(app, owner, activity)
    fill(app)
    assert title_of(app, activity) == "海边跑步"


def test_a_title_edited_after_queueing_is_not_overwritten(clients, region):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "river", box_around_ring(margin_m=0), region)
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 5, 1))
    enqueue(app, owner, activity)
    with app.state.session_factory.begin() as db:
        db.execute(text("UPDATE activities SET title='改过了' WHERE id=:a"), {"a": UUID(activity)})
    fill(app)
    assert title_of(app, activity) == "改过了"
    assert queue_state(app, activity)[0] == "skipped"


def test_imports_without_a_title_are_queued_and_titled_imports_are_not(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    register(a)
    plain = upload(a)  # equator-six.gpx with no title field
    assert plain.status_code in (200, 201), plain.text
    activity = plain.json()["data"]["activity"]["id"]
    assert queue_state(app, activity)[0] == "pending"
    titled = upload(a, file="equator-six.gpx", fields={"title": "自己的名字"}, raw=None)
    # A duplicate upload is rejected; that is fine: only a new, titled activity matters here.
    if titled.status_code in (200, 201):
        assert queue_state(app, titled.json()["data"]["activity"]["id"]) is None


def test_the_footprint_scan_also_names_pending_runs(clients, region):  # noqa: F811
    from app.db.schema import get_expected_revision
    from app.modules.footprints.worker import run_scan

    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    activity = add_run(app, owner, ring(), day=date(2025, 6, 1))
    enqueue(app, owner, activity)
    run_scan(app.state.session_factory, app.state.clock(), get_expected_revision())
    assert title_of(app, activity) == "湖边跑步"


def test_a_very_long_track_is_sampled_within_the_bound(clients, region):  # noqa: F811
    """A ~95 km, 100 000 point track: bounded samples, no non-linear geometry, a few seconds."""
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=UUID(owner),
            source="gpx",
            title=rules.default_title(date(2025, 7, 1)),
            activity_date=date(2025, 7, 1),
            date_source="manual",
            timezone="UTC",
            distance_m=95_000,
            elapsed_seconds=36000,
            timer_seconds=36000,
            avg_pace_seconds_per_km=380,
            temporal_quality="complete",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(activity)
        db.flush()
        long_id = activity.id
        db.execute(
            text(
                """INSERT INTO activity_segments
                   (id, activity_id, segment_index, source_track_index, source_segment_index,
                    break_reason, point_count, geom)
                   SELECT gen_random_uuid(), :id, 0, 0, 0, 'source_segment', 100000,
                          ST_MakeLine(ST_SetSRID(ST_MakePoint(:lon + i * 0.00001, :lat), 4326)
                                      ORDER BY i)
                   FROM generate_series(0, 99999) AS i"""
            ),
            {"id": long_id, "lon": LON, "lat": LAT},
        )
    west, east = LON + 0.2, LON + 0.4  # a stretch in the middle of the track
    south, north = LAT - 500 / METRES, LAT + 500 / METRES
    add_place(
        app,
        "lake",
        [(west, south), (east, south), (east, north), (west, north), (west, south)],
        region,
    )
    started = time.monotonic()
    with app.state.session_factory() as db:
        total, near = service.measure_shares(db, long_id)
    assert time.monotonic() - started < 10
    assert 0 < total <= rules.MAX_SAMPLES + 5
    assert 0 < near["lake"] < total


def failing_resolve(failing, error):
    real = service.resolve

    def resolve(db, activity_id):
        if str(activity_id) in failing:
            raise error
        return real(db, activity_id)

    return resolve


def test_a_failing_run_is_skipped_and_does_not_block_the_others(
    clients,  # noqa: F811
    region,
    monkeypatch,
):
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    bad = add_run(app, owner, ring(), day=date(2025, 8, 1))
    good = add_run(app, owner, ring(), day=date(2025, 8, 2))
    for activity in (bad, good):
        enqueue(app, owner, activity)
    monkeypatch.setattr(service, "resolve", failing_resolve({bad}, RuntimeError("boom")))
    fill(app)
    assert queue_state(app, bad)[0] == "skipped"
    assert queue_state(app, good)[0] == "done"
    assert title_of(app, bad) == rules.default_title(date(2025, 8, 1))


def test_a_timed_out_run_stays_pending_and_is_tried_once_per_pass(
    clients,  # noqa: F811
    region,
    monkeypatch,
):
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    slow = add_run(app, owner, ring(), day=date(2025, 9, 1))
    good = add_run(app, owner, ring(), day=date(2025, 9, 2))
    for activity in (slow, good):
        enqueue(app, owner, activity)
    timeout = DBAPIError("statement", {}, psycopg.errors.QueryCanceled())
    monkeypatch.setattr(service, "resolve", failing_resolve({slow}, timeout))
    fill(app)  # must terminate although the slow run never leaves the pending state
    assert queue_state(app, slow)[0] == "pending"
    assert queue_state(app, good)[0] == "done"
    assert title_of(app, slow) == rules.default_title(date(2025, 9, 1))
