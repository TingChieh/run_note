"""Private global region & city footprint aggregates against bundled offline atlases."""

import gzip
import hashlib
import json
import logging
from datetime import date
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.modules.footprints.model import ActivityGlobalFootprintCache

DATA_DIR = Path(__file__).parent / "data"
REGIONS_FILE = DATA_DIR / "world-regions.json.gz"
CITIES_FILE = DATA_DIR / "world-cities.json.gz"
logger = logging.getLogger(__name__)
FILL_BATCH = 10
CITY_PROXIMITY_M = 10_000
CITY_FALLBACK_RADIUS_M = 35_000
POINT_CITY_DEG_MARGIN = 0.5
# Tracks are Douglas-Peucker simplified to ~11 m before polygon matching. The atlas boundaries are
# themselves simplified at 0.015 deg and rounded to 0.001 deg (~110 m; data/README.md), so this
# changes no realistic hit, while a degenerate track (long overlapping edges) drops from ~30 s
# to well under a second.
TRACK_SIMPLIFY_DEG = 0.0001


@lru_cache(maxsize=1)
def _atlas():
    with gzip.open(REGIONS_FILE, "rt", encoding="utf-8") as fh:
        regions = json.load(fh)
    with gzip.open(CITIES_FILE, "rt", encoding="utf-8") as fh:
        cities_data = json.load(fh)

    regions_by_code = {r["code"]: r for r in regions}
    poly_cities = cities_data["polygon_cities"]
    point_cities = cities_data["point_cities"]
    cities_by_code = {c["code"]: c for c in poly_cities}
    for c in point_cities:
        cities_by_code[c["code"]] = c

    point_grid: dict[tuple[int, int], list[dict]] = {}
    for c in point_cities:
        cell = (int(c["lon"] // 1), int(c["lat"] // 1))
        point_grid.setdefault(cell, []).append(c)

    return {
        "regions": regions,
        "regions_by_code": regions_by_code,
        "poly_cities": poly_cities,
        "point_cities": point_cities,
        "cities_by_code": cities_by_code,
        "point_grid": point_grid,
    }


@lru_cache(maxsize=1)
def atlas_version() -> str:
    """Content hash: replacing either bundled atlas invalidates cached rows."""
    hasher = hashlib.sha256()
    hasher.update(REGIONS_FILE.read_bytes())
    hasher.update(CITIES_FILE.read_bytes())
    return hasher.hexdigest()[:16]


def _boxes_overlap(box_a: list[float], box_b: list[float]) -> bool:
    minx, miny, maxx, maxy = box_a
    r_minx, r_miny, r_maxx, r_maxy = box_b
    if r_maxy < miny or r_miny > maxy:
        return False
    if maxx - minx > 180:
        # Antimeridian-crossing track: test regions near +-180 degrees.
        return r_maxx >= 170 or r_minx <= -170
    return r_maxx >= minx and r_minx <= maxx


def _candidate_point_cities(activity_boxes: list[list[float]], point_grid: dict) -> list[dict]:
    seen: set[str] = set()
    candidates: list[dict] = []
    for minx, miny, maxx, maxy in activity_boxes:
        y0 = int((miny - POINT_CITY_DEG_MARGIN) // 1)
        y1 = int((maxy + POINT_CITY_DEG_MARGIN) // 1)
        if maxx - minx > 180:
            x_ranges = [range(-180, -168), range(168, 181)]
        else:
            x0 = int((minx - POINT_CITY_DEG_MARGIN) // 1)
            x1 = int((maxx + POINT_CITY_DEG_MARGIN) // 1)
            x_ranges = [range(x0, x1 + 1)]
        for xr in x_ranges:
            for gx in xr:
                for gy in range(y0, y1 + 1):
                    for city in point_grid.get((gx, gy), ()):
                        if city["code"] not in seen:
                            seen.add(city["code"])
                            candidates.append(city)
    return candidates


REGION_HITS_SQL = """WITH regions AS MATERIALIZED (
    SELECT r->>'code' AS code,
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r->'geometry'), 4326)) AS geom
    FROM jsonb_array_elements(CAST(:regions AS jsonb)) r
), tracks AS (
    SELECT a.id AS activity_id, s.point_count,
        CASE WHEN s.point_count > 1 THEN ST_Simplify(s.geom, :tolerance, true)
            ELSE COALESCE(s.geom, p.position)
        END AS geom
    FROM activities a JOIN activity_segments s ON s.activity_id=a.id
    LEFT JOIN activity_points p ON p.segment_id=s.id
        AND s.point_count=1 AND p.point_index=0
    WHERE a.user_id=:owner AND a.id=ANY(:ids)
), selected AS MATERIALIZED (
    SELECT activity_id, point_count, geom,
        geom IS NOT NULL AND ST_XMax(Box3D(geom)) - ST_XMin(Box3D(geom)) > 180 AS crosses
    FROM tracks
), crossing_edges AS MATERIALIZED (
    SELECT s.activity_id, e.geom,
        ST_XMax(Box3D(e.geom)) - ST_XMin(Box3D(e.geom)) > 180 AS edge_crosses
    FROM selected s
        CROSS JOIN LATERAL ST_DumpSegments(s.geom) e
    WHERE s.point_count > 1 AND s.crosses
), pairs AS (
    SELECT DISTINCT activity_id FROM selected WHERE geom IS NOT NULL
)
SELECT p.activity_id, r.code
FROM pairs p
CROSS JOIN regions r
WHERE EXISTS (
    SELECT 1 FROM selected s
    WHERE s.activity_id = p.activity_id
      AND s.geom IS NOT NULL
      AND NOT s.crosses
      AND r.geom && s.geom
      AND ST_Intersects(r.geom, s.geom)
) OR EXISTS (
    SELECT 1 FROM crossing_edges e
    WHERE e.activity_id = p.activity_id
      AND (
          (NOT e.edge_crosses AND r.geom && e.geom AND ST_Intersects(r.geom, e.geom))
          OR (
              e.edge_crosses
              AND ST_Intersects(ST_ShiftLongitude(r.geom), ST_ShiftLongitude(e.geom))
          )
      )
)"""


POINT_CITY_HITS_SQL = """WITH pts AS MATERIALIZED (
    SELECT p->>'code' AS code,
        ST_SetSRID(ST_MakePoint((p->>'lon')::float8, (p->>'lat')::float8), 4326)::geography AS geog
    FROM jsonb_array_elements(CAST(:cities AS jsonb)) p
), selected AS MATERIALIZED (
    SELECT a.id AS activity_id,
        CASE WHEN s.point_count > 1
            THEN ST_Simplify(s.geom, 0.001, true)
            ELSE COALESCE(s.geom, pt.position)
        END::geography AS geog
    FROM activities a JOIN activity_segments s ON s.activity_id=a.id
    LEFT JOIN activity_points pt ON pt.segment_id=s.id
        AND s.point_count=1 AND pt.point_index=0
    WHERE a.user_id=:owner AND a.id=ANY(:ids)
), dists AS (
    SELECT s.activity_id, p.code, MIN(ST_Distance(p.geog, s.geog)) AS dist_m
    FROM selected s JOIN pts p ON ST_DWithin(p.geog, s.geog, :fallback_m)
    WHERE s.geog IS NOT NULL
    GROUP BY s.activity_id, p.code
), ranked AS (
    SELECT activity_id, code, dist_m,
        ROW_NUMBER() OVER (PARTITION BY activity_id ORDER BY dist_m, code) AS rn
    FROM dists
)
SELECT activity_id, code FROM ranked WHERE dist_m <= :near_m OR rn = 1"""


class FillStopped(Exception):
    """The worker is stopping; raised between statements, where a cancel request cannot land."""


def _timed_out(error: DBAPIError) -> bool:
    return getattr(error.orig, "sqlstate", None) == "57014"


def _check(stop_event) -> None:
    if stop_event is not None and stop_event.is_set():
        raise FillStopped


def compute_global_codes(db, owner, activity_ids, *, stop_event=None) -> dict:
    """Return {activity_id: (sorted_region_codes, sorted_city_codes)} for every requested ID."""
    result = {activity_id: ([], []) for activity_id in activity_ids}
    if not activity_ids:
        return result

    rows = db.execute(
        text("""
            WITH selected AS (
                SELECT a.id AS activity_id, COALESCE(s.geom, p.position) AS geom
                FROM activities a JOIN activity_segments s ON s.activity_id=a.id
                LEFT JOIN activity_points p ON p.segment_id=s.id
                    AND s.point_count=1 AND p.point_index=0
                WHERE a.user_id=:owner AND a.id=ANY(:ids)
            )
            SELECT activity_id,
                   MIN(ST_XMin(geom))::float8, MIN(ST_YMin(geom))::float8,
                   MAX(ST_XMax(geom))::float8, MAX(ST_YMax(geom))::float8
            FROM selected WHERE geom IS NOT NULL GROUP BY activity_id
        """),
        {"owner": owner, "ids": list(activity_ids)},
    ).all()
    if not rows:
        return result

    activity_boxes = [[r[1], r[2], r[3], r[4]] for r in rows]
    atlas = _atlas()

    cand_regions = [
        {"code": r["code"], "geometry": r["geometry"]}
        for r in atlas["regions"]
        if any(_boxes_overlap(box, r["bounds"]) for box in activity_boxes)
    ]
    cand_poly_cities = [
        {"code": c["code"], "geometry": c["geometry"]}
        for c in atlas["poly_cities"]
        if any(_boxes_overlap(box, c["bounds"]) for box in activity_boxes)
    ]
    cand_point_cities = _candidate_point_cities(activity_boxes, atlas["point_grid"])

    region_hits: dict = {aid: set() for aid in activity_ids}
    city_hits: dict = {aid: set() for aid in activity_ids}

    if cand_regions:
        _check(stop_event)
        for aid, code in db.execute(
            text(REGION_HITS_SQL),
            {
                "owner": owner,
                "ids": list(activity_ids),
                "regions": json.dumps(cand_regions),
                "tolerance": TRACK_SIMPLIFY_DEG,
            },
        ):
            region_hits[aid].add(code)

    if cand_poly_cities:
        _check(stop_event)
        for aid, code in db.execute(
            text(REGION_HITS_SQL),
            {
                "owner": owner,
                "ids": list(activity_ids),
                "regions": json.dumps(cand_poly_cities),
                "tolerance": TRACK_SIMPLIFY_DEG,
            },
        ):
            city_hits[aid].add(code)

    if cand_point_cities:
        _check(stop_event)
        pt_payload = [
            {"code": c["code"], "lon": c["lon"], "lat": c["lat"]} for c in cand_point_cities
        ]
        for aid, code in db.execute(
            text(POINT_CITY_HITS_SQL),
            {
                "owner": owner,
                "ids": list(activity_ids),
                "cities": json.dumps(pt_payload),
                "near_m": CITY_PROXIMITY_M,
                "fallback_m": CITY_FALLBACK_RADIUS_M,
            },
        ):
            city_hits[aid].add(code)

    cities_by_code = atlas["cities_by_code"]
    for aid in activity_ids:
        for c_code in city_hits[aid]:
            region_hits[aid].add(cities_by_code[c_code]["region_code"])
        result[aid] = (sorted(region_hits[aid]), sorted(city_hits[aid]))
    return result


def store_global_footprint_codes(db, owner, codes: dict) -> None:
    version = atlas_version()
    for activity_id, (regions, cities) in codes.items():
        statement = insert(ActivityGlobalFootprintCache).values(
            id=uuid4(),
            user_id=owner,
            activity_id=activity_id,
            atlas_version=version,
            region_codes=regions,
            city_codes=cities,
        )
        db.execute(
            statement.on_conflict_do_update(
                index_elements=["activity_id"],
                set_={
                    "atlas_version": version,
                    "region_codes": regions,
                    "city_codes": cities,
                    "generated_at": func.now(),
                },
            )
        )


def fill_global_footprint_caches(
    session_factory, *, limit=FILL_BATCH, max_batches=None, owner=None, stop_event=None
) -> int:
    """Compute rows that are missing or outdated, newest activities first.

    An owner whose matching exceeds the statement budget is rolled back alone and skipped for
    the rest of this call, so one pathological track cannot stall everyone else's rows.
    """
    filled = 0
    batches = 0
    skipped: set = set()
    owner_filter = " AND a.user_id=:owner" if owner is not None else ""
    while (stop_event is None or not stop_event.is_set()) and (
        max_batches is None or batches < max_batches
    ):
        with session_factory() as db:
            # Stopping the worker cancels the statement in flight (see footprints/worker.py); a
            # stop that arrives between statements is caught by the checks before each one.
            if hasattr(stop_event, "attach"):
                stop_event.attach(db.connection())
            try:
                _check(stop_event)
                db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
                params: dict = {"version": atlas_version(), "limit": limit, "skip": list(skipped)}
                if owner is not None:
                    params["owner"] = owner
                rows = db.execute(
                    text(f"""SELECT a.user_id, a.id FROM activities a
                        LEFT JOIN activity_global_footprint_caches c
                            ON c.activity_id=a.id AND c.atlas_version=:version
                        WHERE c.id IS NULL AND a.id <> ALL(CAST(:skip AS uuid[])){owner_filter}
                        ORDER BY a.created_at DESC, a.id DESC LIMIT :limit"""),
                    params,
                ).all()
                if not rows:
                    return filled
                by_owner: dict = {}
                for row_owner, activity_id in rows:
                    by_owner.setdefault(row_owner, []).append(activity_id)
                # Match everything first, then write and commit at once. Each insert takes a
                # key-share lock on its owner's users row (the foreign key) until commit;
                # interleaving would hold it through the next owner's slow geometry matching and
                # time out that user's requests.
                computed = []
                for row_owner, ids in by_owner.items():
                    try:
                        with db.begin_nested():
                            codes = compute_global_codes(db, row_owner, ids, stop_event=stop_event)
                    except DBAPIError as error:
                        if not _timed_out(error) or (
                            stop_event is not None and stop_event.is_set()
                        ):
                            raise
                        skipped.update(ids)
                        logger.warning("Global footprint match exceeded its budget; skipped")
                        continue
                    computed.append((row_owner, codes))
                for row_owner, codes in computed:
                    store_global_footprint_codes(db, row_owner, codes)
                db.commit()
            except FillStopped:
                return filled  # nothing of this batch was committed; the next scan resumes
            except DBAPIError:
                if stop_event is not None and stop_event.is_set():
                    return filled  # cancelled by shutdown; nothing of this batch was committed
                raise
            finally:
                if hasattr(stop_event, "detach"):
                    stop_event.detach()
            filled += sum(len(codes) for _, codes in computed)
            batches += 1
    return filled


def _merge_bounds(cur: list[float] | None, nxt: list[float]) -> list[float]:
    if cur is None:
        return list(nxt)
    return [min(cur[0], nxt[0]), min(cur[1], nxt[1]), max(cur[2], nxt[2]), max(cur[3], nxt[3])]


def global_summary(db, owner, year=None) -> dict:
    """Aggregate cached global regions & cities; live-compute only missing rows without writing."""
    params: dict = {"owner": owner, "version": atlas_version()}
    date_filter = ""
    if year is not None:
        params.update(start=date(year, 1, 1), end=date(year + 1, 1, 1))
        date_filter = " AND a.activity_date>=:start AND a.activity_date<:end"

    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    try:
        activities = db.scalar(
            text(f"SELECT count(*) FROM activities a WHERE a.user_id=:owner{date_filter}"), params
        )
        region_counts: dict[str, int] = {}
        region_distances: dict[str, float] = {}
        city_counts: dict[str, int] = {}
        city_distances: dict[str, float] = {}
        located = 0

        cached = db.execute(
            text(f"""SELECT c.region_codes, c.city_codes, COALESCE(a.distance_m, 0)
                FROM activity_global_footprint_caches c
                JOIN activities a ON a.id=c.activity_id
                WHERE c.user_id=:owner AND c.atlas_version=:version{date_filter}"""),
            params,
        ).all()
        cached_entries = [
            (r_codes, c_codes, float(dist_m or 0)) for r_codes, c_codes, dist_m in cached
        ]

        missing_rows = db.execute(
            text(f"""SELECT a.id, COALESCE(a.distance_m, 0) FROM activities a
                LEFT JOIN activity_global_footprint_caches c
                    ON c.activity_id=a.id AND c.atlas_version=:version
                WHERE a.user_id=:owner AND c.id IS NULL{date_filter}"""),
            params,
        ).all()
        missing_ids = [row_id for row_id, _dist in missing_rows]
        missing_dist_by_id = {row_id: float(dist_m or 0) for row_id, dist_m in missing_rows}
        missing_map = compute_global_codes(db, owner, missing_ids) if missing_ids else {}
        missing_entries = [
            (r_codes, c_codes, missing_dist_by_id.get(act_id, 0.0))
            for act_id, (r_codes, c_codes) in missing_map.items()
        ]

        all_entries = cached_entries + missing_entries
        for r_codes, c_codes, dist_m in all_entries:
            if r_codes or c_codes:
                located += 1
            for code in r_codes:
                region_counts[code] = region_counts.get(code, 0) + 1
                region_distances[code] = region_distances.get(code, 0.0) + dist_m
            for code in c_codes:
                city_counts[code] = city_counts.get(code, 0) + 1
                city_distances[code] = city_distances.get(code, 0.0) + dist_m

        atlas = _atlas()
        regions_by_code = atlas["regions_by_code"]
        cities_by_code = atlas["cities_by_code"]

        countries_map: dict[str, dict] = {}
        regions_map: dict[str, dict] = {}

        for r_code, r_count in region_counts.items():
            reg = regions_by_code.get(r_code)
            if not reg:
                continue
            c_code = reg["country_code"]
            if c_code not in countries_map:
                countries_map[c_code] = {
                    "code": c_code,
                    "name": reg["country_name"],
                    "activity_count": 0,
                    "distance_m": 0.0,
                    "bounds": None,
                    "regions": [],
                }
            c_entry = countries_map[c_code]
            c_entry["bounds"] = _merge_bounds(c_entry["bounds"], reg["bounds"])

            r_entry = {
                "code": r_code,
                "name": reg["name"],
                "short_name": reg["short_name"],
                "activity_count": r_count,
                "distance_m": round(region_distances.get(r_code, 0.0), 1),
                "bounds": reg["bounds"],
                "center": reg["center"],
                "cities": [],
            }
            c_entry["regions"].append(r_entry)
            regions_map[r_code] = r_entry

        country_activity_counts: dict[str, int] = {}
        country_distances: dict[str, float] = {}
        for r_codes, _c_codes, dist_m in all_entries:
            hit_c = {regions_by_code[rc]["country_code"] for rc in r_codes if rc in regions_by_code}
            for cc in hit_c:
                country_activity_counts[cc] = country_activity_counts.get(cc, 0) + 1
                country_distances[cc] = country_distances.get(cc, 0.0) + dist_m

        for city_code, city_count in city_counts.items():
            city = cities_by_code.get(city_code)
            if not city:
                continue
            r_entry = regions_map.get(city["region_code"])
            if not r_entry:
                continue
            lon, lat = city["center"] if "center" in city else (city["lon"], city["lat"])
            r_entry["cities"].append(
                {
                    "code": city_code,
                    "name": city["name"],
                    "short_name": city["short_name"],
                    "activity_count": city_count,
                    "distance_m": round(city_distances.get(city_code, 0.0), 1),
                    "lon": lon,
                    "lat": lat,
                }
            )

        countries_list = []
        for c_code, c_entry in countries_map.items():
            c_entry["activity_count"] = country_activity_counts.get(c_code, 0)
            c_entry["distance_m"] = round(country_distances.get(c_code, 0.0), 1)
            for r_entry in c_entry["regions"]:
                r_entry["cities"].sort(key=lambda x: (-x["activity_count"], x["code"]))
            c_entry["regions"].sort(key=lambda x: (-x["activity_count"], x["code"]))
            c_entry["region_count"] = len(c_entry["regions"])
            c_entry["city_count"] = sum(len(r["cities"]) for r in c_entry["regions"])
            countries_list.append(c_entry)

        countries_list.sort(key=lambda x: (-x["activity_count"], x["code"]))

        region_features = [
            {
                "type": "Feature",
                "properties": {
                    "code": r_code,
                    "name": regions_by_code[r_code]["name"],
                    "short_name": regions_by_code[r_code]["short_name"],
                    "country_code": regions_by_code[r_code]["country_code"],
                    "activity_count": r_count,
                },
                "geometry": regions_by_code[r_code]["geometry"],
            }
            for r_code, r_count in sorted(region_counts.items())
            if r_code in regions_by_code
        ]

        return {
            "year": year,
            "activity_count": activities,
            "located_activity_count": located,
            "region_count": len(region_counts),
            "city_count": len(city_counts),
            "countries": countries_list,
            "region_features": {
                "type": "FeatureCollection",
                "features": region_features,
            },
        }
    except DBAPIError as error:
        db.rollback()
        if getattr(error.orig, "sqlstate", None) == "57014":
            raise ApiError(422, "FOOTPRINT_LIMIT", "全球足迹计算较慢，请稍后重试") from None
        raise
