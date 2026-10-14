"""Private province aggregates against a bundled visualization boundary atlas."""

import json
from datetime import date
from functools import lru_cache
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.modules.footprints.service import MAX_POINTS, MAX_SEGMENTS, limit_error


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


def province_summary(db, owner, year):
    params = {"owner": owner, "start": date(year, 1, 1), "end": date(year + 1, 1, 1)}
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    try:
        counts = db.execute(
            text("""SELECT
            (SELECT count(*) FROM activities WHERE user_id=:owner
                AND activity_date>=:start AND activity_date<:end) AS activities,
            count(s.id) AS segments, COALESCE(sum(s.point_count),0) AS points
            FROM activities a JOIN activity_segments s ON s.activity_id=a.id
            WHERE a.user_id=:owner AND a.activity_date>=:start AND a.activity_date<:end
        """),
            params,
        ).one()
        if counts.points > MAX_POINTS or counts.segments > MAX_SEGMENTS:
            raise limit_error()
        rows = (
            db.execute(
                text("""WITH regions AS MATERIALIZED (
            SELECT (r->>'code')::int AS code,r->>'name' AS name,
                ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r->'geometry'),4326)) AS geom
            FROM jsonb_array_elements(CAST(:atlas AS jsonb)) r
        ), selected AS MATERIALIZED (
            SELECT a.id AS activity_id,s.point_count,COALESCE(s.geom,p.position) AS geom
            FROM activities a JOIN activity_segments s ON s.activity_id=a.id
            LEFT JOIN activity_points p ON p.segment_id=s.id
                AND s.point_count=1 AND p.point_index=0
            WHERE a.user_id=:owner AND a.activity_date>=:start AND a.activity_date<:end
        ), edges AS (
            SELECT s.activity_id,e.geom FROM selected s
                CROSS JOIN LATERAL ST_DumpSegments(s.geom) e WHERE s.point_count>1
            UNION ALL
            SELECT activity_id,geom FROM selected WHERE point_count=1
        ), routes AS MATERIALIZED (
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
            "activity_count": counts.activities,
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
