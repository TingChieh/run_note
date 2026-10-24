import json
from collections import Counter
from contextlib import contextmanager

import psycopg.errors
import pytest
from sqlalchemy.exc import DBAPIError

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
    assert osm.classify({"leisure": "track", "sport": "cycling;running_x"}, "LineString") is None
    assert osm.classify({"leisure": "track"}, "LineString") is None
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
    geometry, geometry_type, properties = parsed
    assert geometry_type == "Polygon"
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


def test_classify_accepts_multi_valued_sport_containing_running():
    for sport in ("running;athletics", "athletics; running", "running"):
        track = {"leisure": "track", "sport": sport}
        assert osm.classify(track, "LineString") == "stadium", sport


class FakeDb:
    """Stands in for a Session: records statements, raises the scripted error on INSERT_SQL."""

    def __init__(self, errors):
        self.errors = list(errors)
        self.inserts = 0

    @contextmanager
    def begin_nested(self):
        yield

    def execute(self, statement, params=None):
        if statement is not osm.INSERT_SQL:
            return None
        self.inserts += 1
        error = self.errors.pop(0) if self.errors else None
        if error is not None:
            raise error

        class Result:
            def scalar_one(self):
                return "ok"

        return Result()


def park_line(index=0):
    feature = {
        "type": "Feature",
        "properties": {"leisure": "park"},
        "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
    }
    return json.dumps(feature)


def test_data_errors_are_skipped_and_counted_and_the_import_continues():
    data_error = DBAPIError("s", {}, psycopg.errors.InvalidParameterValue())  # class 22
    internal = DBAPIError("s", {}, psycopg.errors.InternalError_())  # XX000
    db = FakeDb([data_error, None, internal, None])
    skipped = Counter()
    written = osm.import_region(db, "r", [park_line()] * 4, skipped)
    assert written == {"park": 2}
    assert skipped == {"invalid": 2}
    assert db.inserts == 4


def test_systemic_database_errors_propagate():
    dropped = DBAPIError("s", {}, Exception("gone"), connection_invalidated=True)
    errors = [
        dropped,
        DBAPIError("s", {}, psycopg.errors.QueryCanceled()),  # 57014
        DBAPIError("s", {}, psycopg.errors.UndefinedColumn()),  # 42703
        DBAPIError("s", {}, psycopg.errors.ConnectionException()),  # 08000
    ]
    for error in errors:
        with pytest.raises(DBAPIError):
            osm.import_region(FakeDb([None, error]), "r", [park_line()] * 5, Counter())
    assert not osm.is_data_error(errors[0])


def test_circuit_breaker_trips_when_most_features_are_invalid():
    bad = DBAPIError("s", {}, psycopg.errors.InvalidParameterValue())
    db = FakeDb([bad] * 200)
    with pytest.raises(osm.RegionImportError, match="无效"):
        osm.import_region(db, "r", [park_line()] * 200, Counter())
    assert db.inserts < 200  # stopped early


def test_circuit_breaker_ignores_small_or_mostly_valid_inputs():
    bad = DBAPIError("s", {}, psycopg.errors.InvalidParameterValue())
    # fewer than the minimum processed features: no trip even though all are invalid
    osm.import_region(FakeDb([bad] * 50), "r", [park_line()] * 50, Counter())
    # 40 % invalid of 100 is below the limit
    errors = ([bad] * 2 + [None] * 3) * 20
    osm.import_region(FakeDb(errors), "r", [park_line()] * 100, Counter())
