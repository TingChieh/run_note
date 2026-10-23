"""Private province aggregates against a bundled visualization boundary atlas."""

import hashlib
import json
from datetime import date
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.modules.footprints.model import ActivityProvinceCache

ATLAS_FILE = Path(__file__).parent / "data/china-provinces.geojson"
FILL_BATCH = 50


@lru_cache(maxsize=1)
def _features():
    data = json.loads(ATLAS_FILE.read_text())
    return [
        {
            "code": f["properties"]["adcode"],
            "name": f["properties"]["name"],
            "geometry": f["geometry"],
        }
        for f in data["features"]
        if f["properties"]["name"]
    ]


@lru_cache(maxsize=1)
def atlas():
    return json.dumps(_features())


@lru_cache(maxsize=1)
def atlas_version():
    """Content hash: replacing the boundary file makes every cached row outdated."""
    return hashlib.sha256(ATLAS_FILE.read_bytes()).hexdigest()[:16]


@lru_cache(maxsize=1)
def province_names():
    return {feature["code"]: feature["name"] for feature in _features()}


# The same spatial rules as the original cumulative query, restricted to chosen activities.
HITS = """WITH regions AS MATERIALIZED (
    SELECT (r->>'code')::int AS code,
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r->'geometry'),4326)) AS geom
    FROM jsonb_array_elements(CAST(:atlas AS jsonb)) r
), selected AS MATERIALIZED (
    SELECT a.id AS activity_id,s.point_count,COALESCE(s.geom,p.position) AS geom
    FROM activities a JOIN activity_segments s ON s.activity_id=a.id
    LEFT JOIN activity_points p ON p.segment_id=s.id
        AND s.point_count=1 AND p.point_index=0
    WHERE a.user_id=:owner AND a.id=ANY(:ids)
), edges AS (
    SELECT s.activity_id,e.geom FROM selected s
        CROSS JOIN LATERAL ST_DumpSegments(s.geom) e
        WHERE s.point_count>1 AND ST_XMax(Box3D(s.geom))-ST_XMin(Box3D(s.geom))>180
), routes AS MATERIALIZED (
    -- Ordinary stored segments retain every edge and gap.
    SELECT activity_id,geom FROM selected
        WHERE ST_XMax(Box3D(geom))-ST_XMin(Box3D(geom))<=180
    UNION ALL
    -- Shift individual crossing edges; shifting a whole segment can create a false
    -- 359-to-1 edge through China. The atlas is east of Greenwich.
    SELECT activity_id,CASE WHEN ST_XMax(Box3D(geom))-ST_XMin(Box3D(geom))>180
        THEN ST_ShiftLongitude(geom) ELSE geom END AS geom FROM edges
), hits AS MATERIALIZED (
    SELECT DISTINCT r.code,s.activity_id FROM regions r JOIN routes s
        ON ST_Intersects(r.geom,s.geom)
) SELECT activity_id,code FROM hits"""


def compute_province_codes(db, owner, activity_ids):
    """Province codes per activity (ascending); every requested ID gets a key."""
    result = {activity_id: [] for activity_id in activity_ids}
    if not activity_ids:
        return result
    params = {"owner": owner, "ids": list(activity_ids), "atlas": atlas()}
    for activity_id, code in db.execute(text(HITS), params):
        result[activity_id].append(code)
    return {activity_id: sorted(codes) for activity_id, codes in result.items()}


def store_province_codes(db, owner, codes):
    version = atlas_version()
    for activity_id, provinces in codes.items():
        statement = insert(ActivityProvinceCache).values(
            id=uuid4(),
            user_id=owner,
            activity_id=activity_id,
            atlas_version=version,
            province_codes=provinces,
        )
        db.execute(
            statement.on_conflict_do_update(
                index_elements=["activity_id"],
                set_={
                    "atlas_version": version,
                    "province_codes": provinces,
                    "generated_at": func.now(),
                },
            )
        )


def fill_province_caches(session_factory, *, limit=FILL_BATCH, stop_event=None):
    """Compute rows that are missing or outdated, oldest activities first.

    Idempotent and safe across workers: a concurrent writer only overwrites with equal data.
    """
    filled = 0
    while stop_event is None or not stop_event.is_set():
        with session_factory() as db:
            db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
            rows = db.execute(
                text("""SELECT a.user_id, a.id FROM activities a
                    LEFT JOIN activity_province_caches c
                        ON c.activity_id=a.id AND c.atlas_version=:version
                    WHERE c.id IS NULL ORDER BY a.created_at, a.id LIMIT :limit"""),
                {"version": atlas_version(), "limit": limit},
            ).all()
            if not rows:
                return filled
            by_owner = {}
            for owner, activity_id in rows:
                by_owner.setdefault(owner, []).append(activity_id)
            for owner, ids in by_owner.items():
                store_province_codes(db, owner, compute_province_codes(db, owner, ids))
            db.commit()
            filled += len(rows)
    return filled


def province_summary(db, owner, year=None):
    """Aggregate cached per-activity provinces; compute live only for activities not cached."""
    params = {"owner": owner, "version": atlas_version()}
    date_filter = ""
    if year is not None:
        params.update(start=date(year, 1, 1), end=date(year + 1, 1, 1))
        date_filter = " AND a.activity_date>=:start AND a.activity_date<:end"
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    try:
        activities = db.scalar(
            text(f"SELECT count(*) FROM activities a WHERE a.user_id=:owner{date_filter}"), params
        )
        counts, located = {}, 0
        cached = db.execute(
            text(f"""SELECT c.province_codes FROM activity_province_caches c
                JOIN activities a ON a.id=c.activity_id
                WHERE c.user_id=:owner AND c.atlas_version=:version{date_filter}"""),
            params,
        ).scalars()
        for codes in cached:
            located += bool(codes)
            for code in codes:
                counts[code] = counts.get(code, 0) + 1
        missing = (
            db.execute(
                text(f"""SELECT a.id FROM activities a
                    LEFT JOIN activity_province_caches c
                        ON c.activity_id=a.id AND c.atlas_version=:version
                    WHERE a.user_id=:owner AND c.id IS NULL{date_filter}"""),
                params,
            )
            .scalars()
            .all()
        )
        if missing:
            for codes in compute_province_codes(db, owner, missing).values():
                located += bool(codes)
                for code in codes:
                    counts[code] = counts.get(code, 0) + 1
        names = province_names()
        return {
            "year": year,
            "total": 34,
            "activity_count": activities,
            "located_activity_count": located,
            "provinces": [
                {"code": code, "name": names[code], "activity_count": counts[code]}
                for code in sorted(counts)
            ],
        }
    except DBAPIError as error:
        db.rollback()
        if getattr(error.orig, "sqlstate", None) == "57014":
            raise ApiError(422, "PROVINCE_LIMIT", "省份足迹计算较慢，请稍后重试") from None
        raise
