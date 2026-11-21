from datetime import date
from time import monotonic, sleep
from uuid import UUID

import pytest
from sqlalchemy import text

from tests.conftest import headers, register, upload

pytestmark = pytest.mark.integration
BASE = "/api/v1/me/footprints/exploration"


def ready(client, suffix, **kwargs):
    deadline = monotonic() + 8
    while monotonic() < deadline:
        result = client.get(BASE + suffix, **kwargs)
        assert result.status_code == 200, result.text
        data = result.json()["data"]
        if data["status"] != "pending":
            assert data["status"] == "ready", data
            return data
        sleep(0.05)
    pytest.fail("Footprints did not become ready")


def test_exploration_is_owner_only_and_private(clients):
    first, second, _, _ = clients
    for path in ("/cities", "/global/all?year=2026", "/global/all/cells?year=2026&zoom=10"):
        assert first.get(BASE + path).status_code == 401
    register(first)
    register(second)
    result = second.get(BASE + "/cities")
    assert result.status_code == 200
    assert result.headers["cache-control"] == "private, no-store"
    assert result.json()["data"]["items"] == []
    assert second.get(BASE + "/city/missing?year=2026").status_code == 404
    assert second.get(BASE + "/city/310000?year=2026").status_code == 404
    assert second.get(BASE + "/city/310000/cells?year=2026&zoom=12").status_code == 404
    assert second.get(BASE + "/cities?owner=other").status_code == 422
    assert second.get("/api/v1/showcase/footprints/exploration/cities").status_code == 404


def test_city_allocation_preserves_crossings_repeats_and_shared_edges(clients):
    from app.modules.footprints.exploration_queries import city_distances

    client, _, engine, _ = clients
    owner = register(client)
    with engine.begin() as db:
        db.execute(
            text("""
                WITH runs(wkt, day, metres) AS (VALUES
                    ('LINESTRING(-3 0,3 0,-3 0)', 1, 6000),
                    ('LINESTRING(0 -.5,0 .5)', 2, 1000),
                    ('LINESTRING(1 0,1 0)', 3, 500),
                    (NULL, 4, 500),
                    ('LINESTRING(-1 -.25,-1 .25)', 5, 0)
                ), inserted AS (
                    INSERT INTO activities (
                        id,user_id,source,title,activity_date,date_source,timezone,distance_m,
                        temporal_quality,quality_summary,metrics_version
                    )
                    SELECT gen_random_uuid(),:owner,'gpx','Synthetic',
                        make_date(2026,1,day),'manual','UTC',
                        metres,'manual','{}','test' FROM runs
                    RETURNING id,activity_date
                )
                INSERT INTO activity_segments (id,activity_id,segment_index,source_track_index,
                    source_segment_index,break_reason,point_count,geom)
                SELECT gen_random_uuid(),id,0,0,0,'none',ST_NPoints(g),g FROM inserted JOIN runs
                ON extract(day from activity_date)=runs.day
                CROSS JOIN LATERAL ST_GeomFromText(wkt,4326) g WHERE wkt IS NOT NULL
            """),
            {"owner": owner},
        )

        def city(code, west, east):
            return {
                "code": code,
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[west, -1], [east, -1], [east, 1], [west, 1], [west, -1]]],
                },
            }

        rows = list(city_distances(db, owner, [city("a", -2, 0), city("b", 0, 2)]))
    assert [(r.code, r.activity_count, r.first_date) for r in rows] == [
        ("a", 2, date(2026, 1, 1)),
        ("b", 1, date(2026, 1, 1)),
        (None, 2, None),
    ]
    assert [float(r.distance_m) for r in rows] == pytest.approx([2000, 2000, 0])


def test_history_recovers_after_old_import_and_delete(clients):
    from app.modules.footprints.global_atlas import store_global_footprint_codes
    from app.modules.footprints.snapshot import build_activity_cache

    first, second, _, app = clients
    owner = UUID(register(first))
    register(second)

    def run(day, end_lon):
        raw = (
            '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">'
            "<trk><trkseg>"
            f'<trkpt lat="31.23" lon="121.48"><time>{day}T01:00:00Z</time></trkpt>'
            f'<trkpt lat="31.23" lon="{end_lon}"><time>{day}T01:05:00Z</time></trkpt>'
            "</trkseg></trk></gpx>"
        ).encode()
        response = upload(first, file=f"run-{end_lon}.gpx", raw=raw)
        assert response.status_code == 201, response.text
        activity_id = UUID(response.json()["data"]["activity"]["id"])
        with app.state.session_factory() as db:
            now = app.state.clock()
            build_activity_cache(db, owner, activity_id, now)
            store_global_footprint_codes(db, owner, {activity_id: (["CN-310000"], ["310000"])})
            db.commit()
        return activity_id

    city = "/city/310000?year=2025"
    original = run("2025-02-02", "121.483")
    baseline = ready(first, city)
    assert baseline["city"]["first_date"] == "2025-02-02"
    assert baseline["months"][1]["new_cells"] > 0
    assert baseline["new_cells"] == sum(month["new_cells"] for month in baseline["months"])
    assert baseline["cumulative_cells"] == baseline["new_cells"]
    assert second.get(BASE + city).status_code == 404
    overlapping = run("2025-02-02", "121.483001")
    combined = ready(first, city)
    assert combined["new_cells"] == baseline["new_cells"]
    assert combined["city"]["activity_count"] == 2
    cells = "/city/310000/cells?year=2025&zoom=12"
    heat = ready(first, cells, headers={"X-Footprint-Viewport": "121.47,31.22,121.49,31.24"})
    assert heat["cells"] and all(count == 2 for _, _, count in heat["cells"])
    assert (
        first.get(
            BASE + cells, headers={"X-Footprint-Viewport": "121.47,nan,121.49,31.24"}
        ).status_code
        == 422
    )
    old = run("2024-07-03", "121.483002")
    recalculated = ready(first, city)
    assert recalculated["city"]["first_date"] == "2024-07-03"
    assert recalculated["cumulative_cells"] == baseline["cumulative_cells"]
    assert recalculated["new_cells"] == 0
    assert ready(first, cells + "&layer=new")["cells"] == []
    assert recalculated["source_version"] > baseline["source_version"]
    deletion = first.delete(f"/api/v1/activities/{old}", headers=headers(first))
    assert deletion.status_code == 200, deletion.text
    assert ready(first, city)["months"] == baseline["months"]
    for target in (original, overlapping):
        assert (
            first.delete(f"/api/v1/activities/{target}", headers=headers(first)).status_code == 200
        )
    assert first.get(BASE + city).status_code == 404
