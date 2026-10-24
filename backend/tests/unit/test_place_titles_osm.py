import json

from app.modules.place_titles import osm


def test_classify_maps_osm_tags_to_categories():
    cases = [
        ({"natural": "water", "water": "lake"}, "Polygon", "lake"),
        ({"natural": "water", "water": "reservoir"}, "MultiPolygon", "lake"),
        ({"natural": "water", "water": "river"}, "Polygon", "river"),
        ({"waterway": "river"}, "LineString", "river"),
        ({"waterway": "canal"}, "LineString", "river"),
        ({"natural": "coastline"}, "LineString", "sea"),
        ({"natural": "bay"}, "Polygon", "sea"),
        ({"leisure": "park"}, "Polygon", "park"),
        ({"leisure": "nature_reserve"}, "MultiPolygon", "park"),
        ({"leisure": "stadium"}, "Polygon", "stadium"),
        ({"leisure": "track", "sport": "running"}, "LineString", "stadium"),
    ]
    for properties, geometry, expected in cases:
        assert osm.classify(properties, geometry) == expected, properties


def test_classify_ignores_everything_else():
    assert osm.classify({"natural": "water", "water": "pond"}, "Polygon") is None
    assert osm.classify({"leisure": "track", "sport": "cycling"}, "LineString") is None
    assert osm.classify({"highway": "residential"}, "LineString") is None
    assert osm.classify({"natural": "water"}, "Point") is None
    assert osm.classify({"leisure": "park"}, "Point") is None
    assert osm.classify({}, "Polygon") is None


def test_parse_line_handles_record_separators_and_non_features():
    feature = {
        "type": "Feature",
        "properties": {"natural": "water", "water": "lake", "name": "ignored"},
        "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
    }
    parsed = osm.parse_line("\x1e" + json.dumps(feature) + "\n")
    assert parsed is not None
    geometry, properties = parsed
    assert json.loads(geometry)["type"] == "Polygon"
    assert properties["water"] == "lake"
    assert osm.parse_line("\n") is None
    assert osm.parse_line(json.dumps({"type": "FeatureCollection"})) is None
    assert osm.parse_line("not json") is None


def test_insert_sql_uses_only_the_linear_simplifier_and_bounds_vertices():
    sql = str(osm.INSERT_SQL)
    assert "ST_SimplifyPreserveTopology" not in sql  # non-linear, once hung PostgreSQL
    assert "ST_Simplify(" in sql
    assert "ST_NPoints" in sql
    assert osm.MAX_FEATURE_POINTS == 200_000
