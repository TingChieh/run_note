"""Real projected geometry fixtures; no migration or deletion."""

from datetime import date
from uuid import uuid4

import pytest

# Imported fixture is intentionally requested by name.
# ruff: noqa: F811
from sqlalchemy import text

from app.modules.activities.model import Activity
from tests.conftest import clients, register  # noqa: F401

pytestmark = pytest.mark.integration
PATH = "/api/v1/footprints?date_from=2024-01-01&date_to=2025-01-01&mode="


def add_activity(app, owner, lines, day=date(2024, 1, 1), geographic=False):
    with app.state.session_factory.begin() as db:
        a = Activity(
            user_id=owner,
            source="gpx",
            title="Grid route",
            activity_date=day,
            date_source="manual",
            timezone="UTC",
            distance_m=1000,
            temporal_quality="incomplete",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(a)
        db.flush()
        identifier = str(a.id)
        for index, coords in enumerate(lines):
            sid = str(uuid4())
            wkt = (
                ("LINESTRING(" + ",".join(f"{x} {y}" for x, y in coords) + ")")
                if len(coords) > 1
                else f"POINT({coords[0][0]} {coords[0][1]})"
            )
            expr = (
                "ST_GeomFromText(:wkt,4326)"
                if geographic
                else "ST_Transform(ST_GeomFromText(:wkt,3857),4326)"
            )
            stored_geom = expr if len(coords) > 1 else "NULL"
            db.execute(
                text(f"""INSERT INTO activity_segments
                (id,activity_id,segment_index,source_track_index,source_segment_index,break_reason,point_count,geom)
                VALUES (:sid,:id,:idx,0,:idx,'source_segment',:n,{stored_geom})"""),
                dict(sid=sid, id=identifier, idx=index, n=len(coords), wkt=wkt),
            )
            if len(coords) == 1:
                db.execute(
                    text(f"""INSERT INTO activity_points
                    (segment_id,point_index,source_point_index,position)
                    VALUES (:sid,0,0,{expr})"""),
                    dict(sid=sid, wkt=wkt),
                )
    return identifier


def cells(client):
    r = client.get(PATH + "heatmap")
    assert r.status_code == 200, r.text
    return {
        (f["properties"]["i"], f["properties"]["j"]): f["properties"]["count"]
        for f in r.json()["data"]["features"]
    }


def test_complete_lines_sampling_invariance_repeats_and_owner(clients):
    a, b, _, app = clients
    owner, other = register(a), register(b)
    first = add_activity(app, owner, [[(10, 50), (390, 50)]])
    assert cells(a) == {(0, 0): 1, (1, 0): 1, (2, 0): 1, (3, 0): 1}
    add_activity(
        app,
        owner,
        [[(10, 50), (50, 50), (150, 50), (250, 50), (390, 50), (10, 50)], [(10, 50), (390, 50)]],
    )
    assert cells(a) == {(0, 0): 2, (1, 0): 2, (2, 0): 2, (3, 0): 2}
    add_activity(app, other, [[(10, 50), (390, 50)]])
    assert set(cells(b).values()) == {1}
    assert set(cells(a).values()) == {2}
    assert b.get("/api/v1/activities/" + first).status_code == 404
    tracks = a.get(PATH + "tracks").json()["data"]
    assert tracks["activity_count"] == 2 and len(tracks["features"]) == 3
    assert len({f["properties"]["activity_id"] for f in tracks["features"]}) == 2
    b.cookies.clear()
    assert b.get(PATH + "heatmap").status_code == 401


def test_segment_gap_single_point_empty_dates_validation(clients):
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [[(10, 50), (90, 50)], [(310, 50), (390, 50)], [(550, 50)]])
    add_activity(app, owner, [[(10, 50), (390, 50)]], date(2025, 1, 1))
    assert cells(a) == {(0, 0): 1, (3, 0): 1, (5, 0): 1}
    assert len(a.get(PATH + "tracks").json()["data"]["features"]) == 3
    r = a.get("/api/v1/footprints?date_from=2023-01-01&date_to=2024-01-01&mode=heatmap")
    assert r.status_code == 200 and r.json()["data"]["features"] == []
    for q in [
        "",
        "date_from=2024-01-01",
        "date_from=2024-01-01&date_to=2024-01-01",
        "date_from=2024-01-01&date_to=2030-01-01",
        "date_from=2024-01-01&date_to=2025-01-01&mode=bad",
        "date_from=2024-01-01&date_to=2025-01-01&owner=someone",
    ]:
        assert a.get("/api/v1/footprints?" + q).status_code == 422


def test_grid_boundary_dateline_polar_and_budget(clients, monkeypatch):
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [[(100, 10), (100, 90)]])
    assert cells(a) == {(0, 0): 1, (1, 0): 1}
    add_activity(app, owner, [[(179.999, 0.0004), (-179.999, 0.0004)]], geographic=True)
    data = a.get(PATH + "heatmap").json()["data"]
    assert len(data["features"]) < 10
    assert all(
        abs(f["properties"]["i"]) > 200000 or abs(f["properties"]["i"]) < 2
        for f in data["features"]
    )
    add_activity(app, owner, [[(10, 89), (10.001, 89)]], geographic=True)
    assert a.get(PATH + "tracks").json()["data"]["unsupported_segment_count"] == 1
    from app.modules.footprints import service

    monkeypatch.setattr(service, "MAX_POINTS", 3)
    r = a.get(PATH + "heatmap")
    assert r.status_code == 422 and r.json()["error"]["code"] == "FOOTPRINT_LIMIT"


def test_many_routes_exact_counts_and_output_limit(clients, monkeypatch):
    a, _, _, app = clients
    owner = register(a)
    for _ in range(1000):
        add_activity(app, owner, [[(10, 50), (390, 50)]])
    assert cells(a) == {(0, 0): 1000, (1, 0): 1000, (2, 0): 1000, (3, 0): 1000}
    assert a.get(PATH + "tracks").json()["data"]["activity_count"] == 1000
    from app.modules.footprints import service

    monkeypatch.setattr(service, "MAX_CELLS", 2)
    r = a.get(PATH + "heatmap")
    assert r.status_code == 422 and r.json()["error"]["code"] == "FOOTPRINT_LIMIT"


def test_different_heat_levels_zero_length_and_candidate_budget(clients, monkeypatch):
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [[(10, 50), (390, 50)]])
    add_activity(app, owner, [[(10, 50), (90, 50)]])
    add_activity(app, owner, [[(550, 50), (550, 50)]])
    assert cells(a) == {(0, 0): 2, (1, 0): 1, (2, 0): 1, (3, 0): 1, (5, 0): 1}
    from app.modules.footprints import service

    monkeypatch.setattr(service, "MAX_CANDIDATES", 2)
    r = a.get(PATH + "heatmap")
    assert r.status_code == 422 and r.json()["error"]["code"] == "FOOTPRINT_LIMIT"


def test_single_point_on_origin_and_cell_boundary_uses_one_cell(clients):
    a, _, _, app = clients
    owner = register(a)
    add_activity(app, owner, [[(0, 0)]])
    add_activity(app, owner, [[(100, 100)]])
    assert cells(a) == {(0, 0): 1, (1, 1): 1}


def test_tracks_keep_ordered_full_resolution_segments_without_edge_duplication(clients):
    """A display route must retain bends/loop order, without a two-point line per edge."""
    a, b, _, app = clients
    owner, other = register(a), register(b)
    lines = [[(10, 50), (90, 50), (90, 90), (10, 50)], [(310, 50), (390, 50)]]
    identifier = add_activity(app, owner, lines)
    add_activity(app, other, [[(500, 50), (590, 50)]])
    before_cells = cells(a)
    data = a.get(PATH + "tracks").json()["data"]
    assert len(data["features"]) == 2
    assert all(f["properties"]["activity_id"] == identifier for f in data["features"])
    first = data["features"][0]["geometry"]
    assert first["type"] == "LineString"
    assert len(first["coordinates"]) == 4
    with app.state.session_factory() as db:
        expected = db.scalar(
            text("""SELECT ST_AsGeoJSON(geom,9)::json FROM activity_segments
            WHERE activity_id=:id AND segment_index=0"""),
            {"id": identifier},
        )
    assert first == expected  # original order and all points; no display simplification
    assert cells(a) == before_cells


def test_tracks_exceptional_edges_and_stationary_route_stay_visible(clients):
    a, _, _, app = clients
    owner = register(a)
    dateline = add_activity(app, owner, [[(179.999, 0.0004), (-179.999, 0.0004)]], geographic=True)
    polar = add_activity(app, owner, [[(10, 85), (10, 86), (10.001, 85)]], geographic=True)
    stationary = add_activity(app, owner, [[(550, 50), (550, 50)]])
    data = a.get(PATH + "tracks").json()["data"]
    features = {f["properties"]["activity_id"]: f["geometry"] for f in data["features"]}
    assert features[stationary]["type"] in {"Point", "MultiPoint"}
    assert data["unsupported_segment_count"] == 1
    assert data["visible_activity_count"] == 3
    assert len(features[dateline]["coordinates"]) == 2
    for line in features[dateline]["coordinates"]:
        assert abs(line[1][0] - line[0][0]) < 0.002
    assert polar in features
    heat = cells(a)
    assert any(i > 200000 for i, _ in heat)
    assert any(i < -200000 for i, _ in heat)


def test_tracks_clip_polar_excursion_keep_boundary_and_omit_outside(clients):
    a, _, _, app = clients
    owner = register(a)
    excursion = add_activity(app, owner, [[(10, 85), (10, 86), (10.001, 85)]], geographic=True)
    boundary = add_activity(
        app, owner, [[(10, 85.0511287798), (10.001, 85.0511287798)]], geographic=True
    )
    outside = add_activity(app, owner, [[(10, 89), (10.001, 89)]], geographic=True)
    data = a.get(PATH + "tracks").json()["data"]
    features = {f["properties"]["activity_id"]: f["geometry"] for f in data["features"]}
    assert excursion in features and boundary in features and outside not in features
    assert data["activity_count"] == 3 and data["visible_activity_count"] == 2
    assert data["unsupported_segment_count"] == 2

    def points(geometry):
        if geometry["type"] == "GeometryCollection":
            for child in geometry["geometries"]:
                yield from points(child)
        else:
            yield from flatten(geometry["coordinates"])

    def flatten(value):
        if isinstance(value[0], (int, float)):
            yield value
        else:
            for child in value:
                yield from flatten(child)

    for geometry in features.values():
        # GeoJSON rounds to 9 decimals; allow one rounding unit at the clip edge.
        assert all(abs(y) <= 85.0511287798 + 1e-9 for _, y in points(geometry))
