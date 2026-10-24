"""Map OpenStreetMap features to place categories; used by the offline import script."""

import json
from collections import Counter
from collections.abc import Iterable

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

MIN_AREA_M2 = {"lake": 10000, "park": 5000}
SIMPLIFY_DEGREES = 0.0001  # about ten metres
MAX_FEATURE_POINTS = 200_000  # raw vertex bound per feature; larger ones are skipped and counted
AREAL = {"Polygon", "MultiPolygon"}
LINEAR = {"LineString", "MultiLineString"}
# Circuit breaker: a file where most features fail to import is systematically bad.
INVALID_FRACTION_LIMIT = 0.5
INVALID_MIN_PROCESSED = 100


class RegionImportError(RuntimeError):
    """The extract cannot be imported; the caller's transaction must roll back."""


def is_data_error(error: DBAPIError) -> bool:
    """Whether a database error is about the feature's own data, so it may be skipped.

    Accepted: SQLSTATE class 22 (data exception, e.g. malformed GeoJSON or numeric values) and
    XX000 (internal_error), which is what PostGIS/GEOS raise for geometries they cannot process
    (too few points, non-finite coordinates). Everything else is systemic and must propagate:
    class 08 / connection_invalidated (dropped connection), 57014 (statement timeout or
    cancel), 53xxx (resources), 42xxx (programming errors), 40xxx (deadlock, serialization)."""
    if error.connection_invalidated:
        return False
    state = getattr(error.orig, "sqlstate", None)
    return isinstance(state, str) and (state.startswith("22") or state == "XX000")


def has_running_sport(value) -> bool:
    """OSM `sport` may hold several values separated by ';', e.g. 'running;athletics'."""
    return isinstance(value, str) and "running" in (part.strip() for part in value.split(";"))


def classify(properties: dict, geometry_type: str) -> str | None:
    areal, linear = geometry_type in AREAL, geometry_type in LINEAR
    if properties.get("natural") == "water" and areal:
        water = properties.get("water")
        if water in ("lake", "reservoir"):
            return "lake"
        if water == "river":
            return "river"
        return None
    if properties.get("waterway") in ("river", "canal") and linear:
        return "river"
    if properties.get("natural") == "coastline" and linear:
        return "sea"
    if properties.get("natural") == "bay" and areal:
        return "sea"
    if properties.get("leisure") in ("park", "nature_reserve") and areal:
        return "park"
    if properties.get("leisure") == "stadium" and areal:
        return "stadium"
    if (
        properties.get("leisure") == "track"
        and has_running_sport(properties.get("sport"))
        and (linear or areal)
    ):
        return "stadium"
    return None


def parse_line(line: str) -> tuple[str, str, dict] | None:
    """One GeoJSON-seq line as (geometry JSON, geometry type, properties); osmium prefixes
    records with an ASCII record separator."""
    try:
        feature = json.loads(line.strip().lstrip("\x1e"))
    except ValueError:
        return None
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        return None
    geometry, properties = feature.get("geometry"), feature.get("properties")
    if not isinstance(geometry, dict) or not isinstance(properties, dict):
        return None
    geometry_type = geometry.get("type")
    if not isinstance(geometry_type, str):
        return None
    return json.dumps(geometry), geometry_type, properties


# One statement per feature. ST_Simplify with preserveCollapsed is linear in the vertex count
# (ST_SimplifyPreserveTopology is not: it once ran for minutes on huge geometries), and the raw
# vertex count is checked first so an oversized feature is never simplified at all. The outer
# SELECT reports why a feature was not written ('ok' means it was inserted).
INSERT_SQL = text(
    """WITH raw AS (
           SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326) AS g
       ), counted AS (
           SELECT g, ST_NPoints(g) AS n FROM raw
       ), simplified AS (
           SELECT n, CASE WHEN n <= :max_points
                          THEN ST_Multi(ST_Simplify(g, :tolerance, true)) END AS g
           FROM counted
       ), checked AS (
           SELECT g, CASE
                    WHEN n > :max_points THEN 'too_large'
                    WHEN g IS NULL OR ST_IsEmpty(g) THEN 'collapsed'
                    WHEN NOT ST_IsValid(g) THEN 'invalid'
                    WHEN CAST(:min_area AS double precision) IS NOT NULL
                         AND ST_Area(g::geography) < CAST(:min_area AS double precision)
                         THEN 'too_small'
                    ELSE 'ok' END AS status
           FROM simplified
       ), inserted AS (
           INSERT INTO place_features (id, category, geom, region)
           SELECT gen_random_uuid(), :category, g::geography, :region
           FROM checked WHERE status = 'ok'
           RETURNING 1
       )
       SELECT status FROM checked"""
)


def import_region(
    db, region: str, lines: Iterable[str], skipped: Counter | None = None
) -> dict[str, int]:
    """Replace one region inside the caller's transaction; tags other than the category are
    never stored. Returns the rows written per category; skipped features are added to
    `skipped` by reason (too_large, collapsed, invalid, too_small). Only data errors skip a
    feature; any other database error propagates so the caller rolls the whole replace back, and
    RegionImportError is raised when most features are invalid."""
    db.execute(text("DELETE FROM place_features WHERE region = :region"), {"region": region})
    written: Counter = Counter()
    processed = invalid = 0
    for line in lines:
        parsed = parse_line(line)
        if parsed is None:
            continue
        geometry, geometry_type, properties = parsed
        category = classify(properties, geometry_type)
        if category is None:
            continue
        params = {
            "category": category,
            "region": region,
            "geometry": geometry,
            "tolerance": SIMPLIFY_DEGREES,
            "max_points": MAX_FEATURE_POINTS,
            "min_area": MIN_AREA_M2.get(category) if geometry_type in AREAL else None,
        }
        try:
            with db.begin_nested():  # one bad geometry must not abort the whole region
                status = db.execute(INSERT_SQL, params).scalar_one()
        except DBAPIError as error:
            if not is_data_error(error):
                raise
            status = "invalid"
        processed += 1
        invalid += status == "invalid"
        if processed >= INVALID_MIN_PROCESSED and invalid / processed > INVALID_FRACTION_LIMIT:
            raise RegionImportError(
                f"文件中大部分地物无法导入（{processed} 个中有 {invalid} 个无效），已中止；"
                "未做任何更改"
            )
        if status == "ok":
            written[category] += 1
        elif skipped is not None:
            skipped[status] += 1
    return dict(written)
