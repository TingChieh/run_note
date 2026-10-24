"""Place-based run naming against a real PostGIS test database: synthetic geometry only."""

import json
import time
from datetime import date
from math import cos, hypot, radians
from uuid import UUID, uuid4

import psycopg.errors
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, OperationalError

from app.modules.activities.model import Activity
from app.modules.place_titles import queue, rules, service
from tests.integration.test_gpx_import import clients, register, upload  # noqa: F401
from tests.integration.test_mifitness_import import record, send, track

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
        if service.has_places(db):
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
    # A different file than above, so it is not rejected as a duplicate.
    titled = upload(a, file="different-date.gpx", fields={"title": "自己的名字"})
    assert titled.status_code in (200, 201), titled.text
    assert queue_state(app, titled.json()["data"]["activity"]["id"]) is None


def test_a_mifitness_import_with_a_route_is_queued(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    register(a)
    result = send(a, record(), raw=track())
    assert result.status_code == 201, result.text
    activity = result.json()["data"]["activity"]
    assert activity["has_route"] is True
    assert queue_state(app, activity["id"])[0] == "pending"


def test_the_sql_default_title_matches_the_importer_default(clients):  # noqa: F811
    _, _, _, app = clients
    with app.state.session_factory() as db:
        for day in (date(2025, 1, 2), date(2024, 12, 31), date(999, 3, 4)):
            sql = db.scalar(
                text(
                    f"SELECT {service.DEFAULT_TITLE_SQL} FROM (SELECT CAST(:d AS date) AS "
                    "activity_date) t"
                ),
                {"d": day},
            )
            assert sql == rules.default_title(day)


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
    assert time.monotonic() - started < 60  # generous: only guards against a hang
    assert 0 < total <= rules.MAX_SAMPLES + 5
    assert 0 < near["lake"] < total


def test_many_segments_still_yield_a_bounded_sample_set(clients, region):  # noqa: F811
    """3000 two-point segments: every segment would add samples without the final thinning."""
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=UUID(owner),
            source="gpx",
            title=rules.default_title(date(2025, 7, 2)),
            activity_date=date(2025, 7, 2),
            date_source="manual",
            timezone="UTC",
            distance_m=60_000,
            elapsed_seconds=20000,
            timer_seconds=20000,
            avg_pace_seconds_per_km=330,
            temporal_quality="complete",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(activity)
        db.flush()
        many_id = activity.id
        db.execute(
            text(
                """INSERT INTO activity_segments
                   (id, activity_id, segment_index, source_track_index, source_segment_index,
                    break_reason, point_count, geom)
                   SELECT gen_random_uuid(), :id, i, 0, i, 'speed_jump', 2,
                          ST_MakeLine(ARRAY[
                              ST_SetSRID(ST_MakePoint(:lon + i * 0.0002, :lat), 4326),
                              ST_SetSRID(ST_MakePoint(:lon + (i + 1) * 0.0002, :lat), 4326)])
                   FROM generate_series(0, 2999) AS i"""
            ),
            {"id": many_id, "lon": LON, "lat": LAT},
        )
    west, east = LON - 0.01, LON + 0.62
    south, north = LAT - 500 / METRES, LAT + 500 / METRES
    add_place(
        app,
        "lake",
        [(west, south), (east, south), (east, north), (west, north), (west, south)],
        region,
    )
    started = time.monotonic()
    with app.state.session_factory() as db:
        total, near = service.measure_shares(db, many_id)
        found = service.resolve(db, many_id)
    assert time.monotonic() - started < 60  # generous: only guards against a hang
    assert 0 < total <= rules.MAX_SAMPLES
    assert near["lake"] == total
    assert found is not None and found[0] == "lake"


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
    attempts = []
    wrapped = failing_resolve({slow}, timeout)

    def counting(db, activity_id):
        attempts.append(str(activity_id))
        return wrapped(db, activity_id)

    monkeypatch.setattr(service, "resolve", counting)
    fill(app)  # must terminate although the slow run never leaves the pending state
    assert attempts.count(slow) == 1 and attempts.count(good) == 1
    assert queue_state(app, slow)[0] == "pending"
    assert queue_state(app, good)[0] == "done"
    assert title_of(app, slow) == rules.default_title(date(2025, 9, 1))


def test_a_real_database_error_aborts_only_that_run(clients, region, monkeypatch):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    bad = add_run(app, owner, ring(), day=date(2025, 10, 1))
    good = add_run(app, owner, ring(), day=date(2025, 10, 2))
    for activity in (bad, good):
        enqueue(app, owner, activity)
    real = service.resolve

    def resolve(db, activity_id):
        if str(activity_id) == bad:
            db.execute(text("SELECT 1 / 0"))  # a real error: the transaction is aborted
        return real(db, activity_id)

    monkeypatch.setattr(service, "resolve", resolve)
    assert fill(app) >= 1  # other pending rows may exist in the shared database
    assert queue_state(app, bad)[0] == "skipped"
    assert queue_state(app, good)[0] == "done"


def test_a_run_deleted_after_measuring_is_dropped_without_error(clients, region, monkeypatch):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    gone = add_run(app, owner, ring(), day=date(2025, 11, 1))
    kept = add_run(app, owner, ring(), day=date(2025, 11, 2))
    for activity in (gone, kept):
        enqueue(app, owner, activity)
    real = service.resolve

    def resolve(db, activity_id):
        found = real(db, activity_id)
        if str(activity_id) == gone:
            with app.state.session_factory.begin() as other:  # no lock is held by the worker
                other.execute(text("DELETE FROM activities WHERE id=:a"), {"a": UUID(gone)})
        return found

    monkeypatch.setattr(service, "resolve", resolve)
    assert fill(app) >= 1  # other pending rows may exist in the shared database
    assert queue_state(app, gone) is None
    assert queue_state(app, kept)[0] == "done"


def osm_line(properties, geometry):
    feature = {"type": "Feature", "properties": properties, "geometry": geometry}
    return "\x1e" + json.dumps(feature) + "\n"


def square(lon, lat, size):
    return [[lon, lat], [lon, lat + size], [lon + size, lat + size], [lon + size, lat], [lon, lat]]


def test_import_region_replaces_filters_by_area_and_stores_no_tags(clients):  # noqa: F811
    from collections import Counter

    from app.modules.place_titles import osm

    a, b, _, app = clients
    quiet(a, b)
    lake = {"natural": "water", "water": "lake"}
    polygon = lambda ring_: {"type": "Polygon", "coordinates": [ring_]}  # noqa: E731
    lines = [
        osm_line({**lake, "name": "x"}, polygon(square(121.0, 31.0, 0.01))),
        osm_line(lake, polygon(square(121.0, 31.0, 0.0001))),  # below the area threshold
        osm_line({"highway": "path"}, polygon(square(121.0, 31.0, 0.01))),
    ]
    region = f"synthetic-{uuid4().hex[:8]}"
    try:
        skipped = Counter()
        with app.state.session_factory.begin() as db:
            assert osm.import_region(db, region, lines, skipped) == {"lake": 1}
        assert skipped == {"too_small": 1}
        with app.state.session_factory.begin() as db:
            assert osm.import_region(db, region, lines[:1]) == {"lake": 1}  # replaced, not appended
            count = db.scalar(
                text("SELECT count(*) FROM place_features WHERE region = :r"), {"r": region}
            )
            assert count == 1
            columns = set(
                db.scalars(
                    text(
                        "SELECT column_name FROM information_schema.columns"
                        " WHERE table_name = 'place_features'"
                    )
                )
            )
            assert columns == {"id", "category", "geom", "region", "imported_at"}
    finally:
        clear_places(app, region)


def test_import_region_isolates_bad_and_oversized_features(clients, monkeypatch):  # noqa: F811
    from collections import Counter

    from app.modules.place_titles import osm

    a, b, _, app = clients
    quiet(a, b)
    park = {"leisure": "park"}
    good = {"type": "Polygon", "coordinates": [square(121.0, 31.0, 0.01)]}
    broken = {"type": "Polygon", "coordinates": [[[121.0, 31.0], [121.1, 31.0], [121.0, 31.0]]]}
    river = {"type": "LineString", "coordinates": [[121.0, 31.0 + i * 0.001] for i in range(50)]}
    lines = [
        osm_line(park, good),
        osm_line(park, broken),  # fewer than four points: invalid GeoJSON geometry
        osm_line(park, good),
        osm_line({"waterway": "river"}, river),
    ]
    region = f"synthetic-{uuid4().hex[:8]}"
    monkeypatch.setattr(osm, "MAX_FEATURE_POINTS", 20)
    try:
        skipped = Counter()
        with app.state.session_factory.begin() as db:
            written = osm.import_region(db, region, lines, skipped)
        # the two good parks survive the failures between them; the 50-point river is too large
        assert written == {"park": 2}
        assert skipped == {"invalid": 1, "too_large": 1}
    finally:
        clear_places(app, region)


def region_categories(app, region):
    with app.state.session_factory() as db:
        return dict(
            db.execute(
                text(
                    "SELECT category, count(*) FROM place_features WHERE region = :r "
                    "GROUP BY category"
                ),
                {"r": region},
            ).all()
        )


def test_import_region_stores_multipolygons_rivers_and_coastlines(clients):  # noqa: F811
    from app.modules.place_titles import osm

    a, b, _, app = clients
    quiet(a, b)
    lake = {"natural": "water", "water": "lake"}
    multi = {
        "type": "MultiPolygon",
        "coordinates": [[square(121.0, 31.0, 0.01)], [square(121.1, 31.0, 0.01)]],
    }
    river = {"type": "LineString", "coordinates": [[121.0, 31.0 + i * 0.001] for i in range(10)]}
    coast = {"type": "LineString", "coordinates": [[122.0, 30.0 + i * 0.01] for i in range(10)]}
    lines = [
        osm_line(lake, multi),
        osm_line({"waterway": "river"}, river),
        osm_line({"natural": "coastline"}, coast),
    ]
    region = f"synthetic-{uuid4().hex[:8]}"
    try:
        with app.state.session_factory.begin() as db:
            written = osm.import_region(db, region, lines)
        assert written == {"lake": 1, "river": 1, "sea": 1}
        assert region_categories(app, region) == {"lake": 1, "river": 1, "sea": 1}
    finally:
        clear_places(app, region)


def test_reimporting_one_region_leaves_other_regions_alone(clients):  # noqa: F811
    from app.modules.place_titles import osm

    a, b, _, app = clients
    quiet(a, b)
    lake = {"natural": "water", "water": "lake"}
    polygon = {"type": "Polygon", "coordinates": [square(121.0, 31.0, 0.01)]}
    first, second = f"synthetic-{uuid4().hex[:8]}", f"synthetic-{uuid4().hex[:8]}"
    try:
        with app.state.session_factory.begin() as db:
            osm.import_region(db, first, [osm_line(lake, polygon)] * 2)
            osm.import_region(db, second, [osm_line(lake, polygon)] * 3)
        with app.state.session_factory.begin() as db:
            osm.import_region(db, first, [osm_line(lake, polygon)])
        assert region_categories(app, first) == {"lake": 1}
        assert region_categories(app, second) == {"lake": 3}
    finally:
        clear_places(app, first)
        clear_places(app, second)


def test_a_systemic_error_rolls_back_and_keeps_the_previous_region(clients):  # noqa: F811
    from app.modules.place_titles import osm

    a, b, _, app = clients
    quiet(a, b)
    lake = {"natural": "water", "water": "lake"}
    polygon = {"type": "Polygon", "coordinates": [square(121.0, 31.0, 0.01)]}
    region = f"synthetic-{uuid4().hex[:8]}"

    class TimingOut:
        """Delegates to the session but cancels the second feature like a statement timeout."""

        def __init__(self, db):
            self.db, self.inserts = db, 0

        def begin_nested(self):
            return self.db.begin_nested()

        def execute(self, statement, params=None):
            if statement is osm.INSERT_SQL:
                self.inserts += 1
                if self.inserts == 2:
                    raise DBAPIError("statement", {}, psycopg.errors.QueryCanceled())
            return self.db.execute(statement, params)

    try:
        with app.state.session_factory.begin() as db:
            osm.import_region(db, region, [osm_line(lake, polygon)] * 2)
        with pytest.raises(DBAPIError):
            with app.state.session_factory.begin() as db:
                osm.import_region(TimingOut(db), region, [osm_line(lake, polygon)] * 3)
        assert region_categories(app, region) == {"lake": 2}  # the replace was rolled back
    finally:
        clear_places(app, region)


def test_a_mostly_invalid_file_trips_the_circuit_breaker(clients):  # noqa: F811
    from app.modules.place_titles import osm

    a, b, _, app = clients
    quiet(a, b)
    park = {"leisure": "park"}
    broken = {"type": "Polygon", "coordinates": [[[121.0, 31.0], [121.1, 31.0], [121.0, 31.0]]]}
    good = {"type": "Polygon", "coordinates": [square(121.0, 31.0, 0.01)]}
    region = f"synthetic-{uuid4().hex[:8]}"
    try:
        with app.state.session_factory.begin() as db:
            osm.import_region(db, region, [osm_line(park, good)])
        with pytest.raises(osm.RegionImportError):
            with app.state.session_factory.begin() as db:
                osm.import_region(db, region, [osm_line(park, broken)] * 150)
        assert region_categories(app, region) == {"park": 1}
    finally:
        clear_places(app, region)


def preview(app, owner):
    from app.modules.place_titles import backfill

    return backfill.collect(app.state.session_factory, owner=UUID(owner))


def version_of(app, owner):
    with app.state.session_factory() as db:
        return db.scalar(
            text("SELECT activity_data_version FROM users WHERE id=:o"), {"o": UUID(owner)}
        )


def test_backfill_previews_without_writing_then_applies_and_reverts(clients, region, tmp_path):  # noqa: F811
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    lakeside = add_run(app, owner, ring(), day=date(2025, 7, 1))
    named = add_run(app, owner, ring(), day=date(2025, 7, 2), title="我的晨跑")
    before = version_of(app, owner)
    proposals = preview(app, owner)
    assert [str(p.activity_id) for p in proposals] == [lakeside]  # user-named run is no candidate
    assert proposals[0].new_title == "湖边跑步"
    assert title_of(app, lakeside) == rules.default_title(date(2025, 7, 1))  # preview wrote nothing
    assert queue_state(app, lakeside) is None and version_of(app, owner) == before

    log = tmp_path / "log.json"
    expected = {"applied": 1, "changed_meanwhile": 0, "unmatched": 0, "failed": 0}
    assert backfill.apply_proposals(app.state.session_factory, proposals, log) == expected
    assert json.loads(log.read_text(encoding="utf-8")) == [
        {
            "activity_id": lakeside,
            "old_title": rules.default_title(date(2025, 7, 1)),
            "new_title": "湖边跑步",
        }
    ]
    assert title_of(app, lakeside) == "湖边跑步" and title_of(app, named) == "我的晨跑"
    assert queue_state(app, lakeside)[0] == "done" and version_of(app, owner) == before + 1
    assert preview(app, owner) == []  # done: not repeated

    with app.state.session_factory.begin() as db:
        db.execute(text("UPDATE activities SET title='手改' WHERE id=:a"), {"a": UUID(lakeside)})
    assert backfill.revert_log(app.state.session_factory, log)["reverted"] == 0  # edited since
    with app.state.session_factory.begin() as db:
        db.execute(
            text("UPDATE activities SET title='湖边跑步' WHERE id=:a"), {"a": UUID(lakeside)}
        )
    result = backfill.revert_log(app.state.session_factory, log)
    assert result == {"reverted": 1, "skipped": 0, "failed": 0}
    assert title_of(app, lakeside) == rules.default_title(date(2025, 7, 1))
    assert version_of(app, owner) == before + 2
    assert queue_state(app, lakeside)[0] == "skipped" and queue_state(app, lakeside)[2] is None
    again = backfill.revert_log(app.state.session_factory, log)
    assert again == {"reverted": 0, "skipped": 1, "failed": 0}
    assert version_of(app, owner) == before + 2


def test_backfill_unmatched_stay_retryable_and_edited_titles_are_not_overwritten(
    clients,  # noqa: F811
    region,
    tmp_path,
):
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    unmatched = add_run(app, owner, ring(), day=date(2025, 8, 1))
    proposals = preview(app, owner)
    assert proposals and proposals[0].new_title is None  # no places in this region: no match
    log = tmp_path / "l.json"
    result = backfill.apply_proposals(app.state.session_factory, proposals, log)
    assert result["unmatched"] == 1 and result["applied"] == 0
    assert json.loads(log.read_text(encoding="utf-8")) == []
    assert queue_state(app, unmatched) is None
    add_place(app, "lake", box_around_ring(margin_m=0), region)  # now it matches
    retry = preview(app, owner)
    assert [(str(p.activity_id), p.new_title) for p in retry] == [(unmatched, "湖边跑步")]

    with app.state.session_factory.begin() as db:  # the user renames it before apply
        db.execute(text("UPDATE activities SET title='我改的' WHERE id=:a"), {"a": UUID(unmatched)})
    result = backfill.apply_proposals(app.state.session_factory, retry, tmp_path / "m.json")
    assert result == {"applied": 0, "changed_meanwhile": 1, "unmatched": 0, "failed": 0}
    assert title_of(app, unmatched) == "我改的" and queue_state(app, unmatched) is None


def test_backfill_one_failing_run_is_counted_and_the_others_still_apply(
    clients,  # noqa: F811
    region,
    tmp_path,
    monkeypatch,
):
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    bad = add_run(app, owner, ring(), day=date(2025, 9, 1))
    good = add_run(app, owner, ring(), day=date(2025, 9, 2))
    proposals = preview(app, owner)
    assert len(proposals) == 2
    real = service.apply_title

    def apply_title(db, owner_id, activity_id, new_title):
        if str(activity_id) == bad:
            db.execute(text("SELECT 1 / 0"))  # a real error: the transaction is aborted
        return real(db, owner_id, activity_id, new_title)

    monkeypatch.setattr(service, "apply_title", apply_title)
    log = tmp_path / "log.json"
    result = backfill.apply_proposals(app.state.session_factory, proposals, log)
    assert result == {"applied": 1, "changed_meanwhile": 0, "unmatched": 0, "failed": 1}
    assert title_of(app, bad) == rules.default_title(date(2025, 9, 1))
    assert title_of(app, good) == "湖边跑步"
    assert [e["activity_id"] for e in json.loads(log.read_text(encoding="utf-8"))] == [good]
    assert not (tmp_path / "log.json.tmp").exists()


def test_backfill_pages_through_candidates_and_honours_the_limit(clients, region):  # noqa: F811
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    ids = [add_run(app, owner, ring(), day=date(2024, 1, day)) for day in (1, 2, 3, 4, 5)]
    assert [str(p.activity_id) for p in preview(app, owner)] == ids
    assert backfill.PAGE_SIZE > 2
    original = backfill.PAGE_SIZE
    backfill.PAGE_SIZE = 2  # force several pages
    try:
        assert [str(p.activity_id) for p in preview(app, owner)] == ids
        limited = backfill.collect(app.state.session_factory, owner=UUID(owner), limit=3)
        assert [str(p.activity_id) for p in limited] == ids[:3]
    finally:
        backfill.PAGE_SIZE = original


def test_backfill_rejects_a_malformed_log_before_changing_anything(clients, region, tmp_path):  # noqa: F811
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    run = add_run(app, owner, ring(), day=date(2025, 12, 1))
    with app.state.session_factory.begin() as db:
        db.execute(text("UPDATE activities SET title='湖边跑步' WHERE id=:a"), {"a": UUID(run)})
    good = {"activity_id": run, "old_title": "旧", "new_title": "湖边跑步"}
    bad_logs = [
        "not json",
        json.dumps({"activity_id": run}),
        json.dumps([good, {"activity_id": "nope", "old_title": "a", "new_title": "b"}]),
        json.dumps([good, {"activity_id": run, "old_title": "a"}]),
    ]
    for content in bad_logs:
        path = tmp_path / "bad.json"
        path.write_text(content, encoding="utf-8")
        with pytest.raises(backfill.BackfillLogError, match="还原日志"):
            backfill.revert_log(app.state.session_factory, path)
        assert title_of(app, run) == "湖边跑步"  # the valid first entry was not applied either
    gone = tmp_path / "gone.json"
    gone.write_text(
        json.dumps([{"activity_id": str(uuid4()), "old_title": "a", "new_title": "b"}]),
        encoding="utf-8",
    )
    assert backfill.revert_log(app.state.session_factory, gone)["skipped"] == 1


def test_backfill_classifies_why_a_run_is_not_matched(clients, region):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    matched = add_run(app, owner, ring(), day=date(2024, 2, 1))
    far = add_run(
        app, owner, [(x + 1.0, y) for x, y in ring()], day=date(2024, 2, 2)
    )  # about 100 km east of the lake
    short = add_run(app, owner, ring(), day=date(2024, 2, 3), distance_m=500)
    by_id = {str(p.activity_id): p for p in preview(app, owner)}
    assert by_id[matched].reason == "matched" and by_id[matched].new_title == "湖边跑步"
    assert by_id[far].reason == "no_match" and by_id[far].new_title is None
    assert by_id[short].reason == "too_short" and by_id[short].new_title is None
    # A title edited between listing and measuring is reported as edited.
    edited = add_run(app, owner, ring(), day=date(2024, 2, 4))
    with app.state.session_factory.begin() as db:
        db.execute(text("UPDATE activities SET title='改过' WHERE id=:a"), {"a": UUID(edited)})
    assert service._measure(app.state.session_factory, UUID(owner), UUID(edited)) == (
        "skip",
        "edited",
    )


def test_backfill_reports_timeouts_and_errors_separately(clients, region, monkeypatch):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    slow = add_run(app, owner, ring(), day=date(2024, 3, 1))
    broken = add_run(app, owner, ring(), day=date(2024, 3, 2))
    lost = add_run(app, owner, ring(), day=date(2024, 3, 3))
    timeout = DBAPIError("statement", {}, psycopg.errors.QueryCanceled())
    dead = OperationalError("statement", {}, psycopg.errors.AdminShutdown())
    errors = {slow: timeout, broken: RuntimeError("boom"), lost: dead}
    real = service.resolve

    def resolve(db, activity_id):
        if str(activity_id) in errors:
            raise errors[str(activity_id)]
        return real(db, activity_id)

    monkeypatch.setattr(service, "resolve", resolve)
    by_id = {str(p.activity_id): p.reason for p in preview(app, owner)}
    assert by_id[slow] == "retry" and by_id[lost] == "retry" and by_id[broken] == "error"


def test_a_transient_error_leaves_the_queue_row_pending_but_other_errors_skip_it(
    clients,  # noqa: F811
    region,
    monkeypatch,
):
    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    deadlock = add_run(app, owner, ring(), day=date(2024, 4, 1))
    dropped = add_run(app, owner, ring(), day=date(2024, 4, 2))
    plain = add_run(app, owner, ring(), day=date(2024, 4, 3))
    for activity in (deadlock, dropped, plain):
        enqueue(app, owner, activity)
    invalid = DBAPIError("s", {}, psycopg.errors.DeadlockDetected())
    closed = DBAPIError("s", {}, psycopg.errors.ConnectionException(), connection_invalidated=True)
    errors = {deadlock: invalid, dropped: closed, plain: RuntimeError("boom")}
    real = service.resolve

    def resolve(db, activity_id):
        if str(activity_id) in errors:
            raise errors[str(activity_id)]
        return real(db, activity_id)

    monkeypatch.setattr(service, "resolve", resolve)
    fill(app)
    assert queue_state(app, deadlock)[0] == "pending"
    assert queue_state(app, dropped)[0] == "pending"
    assert queue_state(app, plain)[0] == "skipped"


def test_apply_overwrites_skipped_and_pending_queue_rows(clients, region, tmp_path):  # noqa: F811
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    was_skipped = add_run(app, owner, ring(), day=date(2024, 5, 1))
    was_pending = add_run(app, owner, ring(), day=date(2024, 5, 2))
    for activity in (was_skipped, was_pending):
        enqueue(app, owner, activity)
    with app.state.session_factory.begin() as db:
        db.execute(
            text("UPDATE activity_place_names SET state='skipped' WHERE activity_id=:a"),
            {"a": UUID(was_skipped)},
        )
    proposals = preview(app, owner)
    assert len(proposals) == 2
    result = backfill.apply_proposals(app.state.session_factory, proposals, tmp_path / "l.json")
    assert result["applied"] == 2 and result["failed"] == 0
    for activity in (was_skipped, was_pending):
        state, category, applied = queue_state(app, activity)
        assert (state, category, applied) == ("done", "lake", "湖边跑步")
        assert title_of(app, activity) == "湖边跑步"


def test_backfill_log_failure_stops_loudly_and_a_readonly_dir_fails_before_any_change(
    clients,  # noqa: F811
    region,
    tmp_path,
    monkeypatch,
):
    from app.modules.place_titles import backfill

    a, b, _, app = clients
    quiet(a, b)
    add_place(app, "lake", box_around_ring(margin_m=0), region)
    owner = register(a)
    first = add_run(app, owner, ring(), day=date(2024, 6, 1))
    second = add_run(app, owner, ring(), day=date(2024, 6, 2))
    proposals = preview(app, owner)
    assert [str(p.activity_id) for p in proposals] == [first, second]

    real = backfill._write_log

    def refuse(path, entries):
        raise OSError("disk full")

    # The very first (empty) log write fails: nothing has been changed yet.
    monkeypatch.setattr(backfill, "_write_log", refuse)
    with pytest.raises(OSError):
        backfill.apply_proposals(app.state.session_factory, proposals, tmp_path / "x.json")
    assert title_of(app, first) == rules.default_title(date(2024, 6, 1))

    # The first write works, the one after the first change fails: stop right there.
    calls = []

    def flaky(path, entries):
        calls.append(len(entries))
        if len(entries) == 1:
            raise OSError("disk full")
        real(path, entries)

    monkeypatch.setattr(backfill, "_write_log", flaky)
    with pytest.raises(backfill.LogWriteError) as caught:
        backfill.apply_proposals(app.state.session_factory, proposals, tmp_path / "y.json")
    assert str(caught.value.activity_id) == first
    assert caught.value.counts["applied"] == 1
    assert title_of(app, first) == "湖边跑步"
    assert title_of(app, second) == rules.default_title(date(2024, 6, 2))  # not touched
    assert calls == [0, 1]


def test_an_untitled_gpx_import_gets_exactly_the_default_title_the_sql_matches(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    register(a)
    result = upload(a)
    assert result.status_code in (200, 201), result.text
    activity = result.json()["data"]["activity"]["id"]
    with app.state.session_factory() as db:
        title, activity_date, matches = db.execute(
            text(
                f"SELECT title, activity_date, title = {service.DEFAULT_TITLE_SQL} "
                "FROM activities WHERE id=:a"
            ),
            {"a": UUID(activity)},
        ).one()
    assert title == rules.default_title(activity_date)
    assert matches is True
