"""Private province aggregates against a bundled visualization boundary atlas."""

import json
from datetime import date
from functools import lru_cache
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError


@lru_cache(maxsize=1)
def atlas():
    data = json.loads((Path(__file__).parent / "data/china-provinces.geojson").read_text())
    return json.dumps(
        [
            {
                "code": f["properties"]["adcode"],
                "name": f["properties"]["name"],
                "geometry": f["geometry"],
            }
            for f in data["features"]
            if f["properties"]["name"]
        ]
    )


def province_summary(db, owner, year=None):
    params = {"owner": owner}
    date_filter = ""
    if year is not None:
        params.update(start=date(year, 1, 1), end=date(year + 1, 1, 1))
        date_filter = " AND a.activity_date>=:start AND a.activity_date<:end"
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    try:
        # No point/segment pre-check: the cumulative answer must not stop working as history
        # grows. A synthetic 1.1 M-point history takes ~150 ms; the statement timeout is the guard.
        activities = db.scalar(
            text(f"SELECT count(*) FROM activities a WHERE a.user_id=:owner{date_filter}"), params
        )
        rows = (
            db.execute(
                text(f"""WITH regions AS MATERIALIZED (
            SELECT (r->>'code')::int AS code,r->>'name' AS name,
                ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r->'geometry'),4326)) AS geom
            FROM jsonb_array_elements(CAST(:atlas AS jsonb)) r
        ), selected AS MATERIALIZED (
            SELECT a.id AS activity_id,s.point_count,COALESCE(s.geom,p.position) AS geom
            FROM activities a JOIN activity_segments s ON s.activity_id=a.id
            LEFT JOIN activity_points p ON p.segment_id=s.id
                AND s.point_count=1 AND p.point_index=0
            WHERE a.user_id=:owner{date_filter}
        ), edges AS (
            SELECT s.activity_id,e.geom FROM selected s
                CROSS JOIN LATERAL ST_DumpSegments(s.geom) e
                WHERE s.point_count>1 AND ST_XMax(Box3D(s.geom))-ST_XMin(Box3D(s.geom))>180
        ), routes AS MATERIALIZED (
            -- Ordinary stored segments retain every edge and gap without expanding
            -- cumulative history into hundreds of thousands of spatial comparisons.
            SELECT activity_id,geom FROM selected
                WHERE ST_XMax(Box3D(geom))-ST_XMin(Box3D(geom))<=180
            UNION ALL
            -- Shift individual crossing edges; shifting a whole segment can create
            -- a false 359-to-1 edge through China. The atlas is east of Greenwich.
            SELECT activity_id,CASE WHEN ST_XMax(Box3D(geom))-ST_XMin(Box3D(geom))>180
                THEN ST_ShiftLongitude(geom) ELSE geom END AS geom FROM edges
        ), hits AS MATERIALIZED (
            SELECT r.code,r.name,s.activity_id FROM regions r JOIN routes s
                ON ST_Intersects(r.geom,s.geom)
        ) SELECT code,name,count(DISTINCT activity_id)::int AS activity_count,
            (SELECT count(DISTINCT activity_id) FROM hits) AS located
            FROM hits GROUP BY code,name ORDER BY code
        """),
                {**params, "atlas": atlas()},
            )
            .mappings()
            .all()
        )
        return {
            "year": year,
            "total": 34,
            "activity_count": activities,
            "located_activity_count": rows[0]["located"] if rows else 0,
            "provinces": [
                {"code": r["code"], "name": r["name"], "activity_count": r["activity_count"]}
                for r in rows
            ],
        }
    except DBAPIError as error:
        db.rollback()
        if getattr(error.orig, "sqlstate", None) == "57014":
            raise ApiError(422, "PROVINCE_LIMIT", "省份足迹计算较慢，请稍后重试") from None
        raise
