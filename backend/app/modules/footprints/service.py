"""Fixed origin-aligned projected grid; full edges intersect cells, never point counts."""

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.modules.statistics.service import validate_range

GRID_SIZE = 100
MAX_POINTS = 250000
MAX_SEGMENTS = 10000
MAX_CELLS = 20000
MAX_CANDIDATES = 500000

# Every original edge remains inside its source segment. Shift only short dateline
# crossings; split/wrap at 180 before projection, then clip unsupported polar latitudes.
GEOMETRIES = """WITH selected AS MATERIALIZED (
    SELECT s.id,s.activity_id,s.segment_index,s.point_count,a.title,a.activity_date,
        COALESCE(s.geom,(SELECT p.position FROM activity_points p
            WHERE p.segment_id=s.id ORDER BY p.point_index LIMIT 1)) AS geom
    FROM activities a JOIN activity_segments s ON s.activity_id=a.id
    WHERE a.user_id=:owner AND a.activity_date>=:start AND a.activity_date<:end
), edges AS (
    SELECT s.*,CASE WHEN ST_Length(e.geom)=0 THEN ST_StartPoint(e.geom) ELSE e.geom END AS edge
    FROM selected s CROSS JOIN LATERAL ST_DumpSegments(s.geom) e
    WHERE s.point_count>1
    UNION ALL
    SELECT s.*,s.geom AS edge FROM selected s WHERE s.point_count=1
), wrapped AS (
    SELECT *,CASE WHEN ST_XMax(Box3D(edge))-ST_XMin(Box3D(edge))>180
        THEN ST_Split(ST_ShiftLongitude(edge),ST_GeomFromText('LINESTRING(180 -90,180 90)',4326))
        ELSE edge END AS safe
    FROM edges
) , split_edges AS (
    SELECT id,activity_id,segment_index,title,activity_date,
        CASE WHEN ST_XMin(Box3D(d.geom))>=180 THEN ST_Translate(d.geom,-360,0)
            ELSE d.geom END AS safe
    FROM wrapped CROSS JOIN LATERAL ST_Dump(safe) d
), projected AS MATERIALIZED (
    SELECT id,activity_id,segment_index,title,activity_date,
        ST_SnapToGrid(ST_Transform(ST_Intersection(safe,
            ST_MakeEnvelope(-180,-85.0511287798,180,85.0511287798,4326)),3857),0.000001) AS geom
    FROM split_edges
), usable AS (
    SELECT * FROM projected WHERE NOT ST_IsEmpty(geom)
) """


def limit_error():
    return ApiError(422, "FOOTPRINT_LIMIT", "足迹数据较多，请缩小日期范围后重试")


def footprints(db, owner, start, end, mode):
    validate_range(start, end)
    params = dict(owner=owner, start=start, end=end, size=GRID_SIZE)
    # Local transaction only, released by commit/rollback; leaves pooled sessions unchanged.
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    try:
        counts = db.execute(
            text("""SELECT
            (SELECT count(*) FROM activities WHERE user_id=:owner
                AND activity_date>=:start AND activity_date<:end) AS activity_count,
            count(s.id) AS segment_count,COALESCE(sum(s.point_count),0) AS points,
            count(s.id) FILTER (WHERE ST_YMin(Box3D(COALESCE(s.geom,p.position))) < -85.0511287798
                OR ST_YMax(Box3D(COALESCE(s.geom,p.position))) > 85.0511287798) AS unsupported
            FROM activities a JOIN activity_segments s ON s.activity_id=a.id
            LEFT JOIN activity_points p ON p.segment_id=s.id AND s.point_count=1 AND p.point_index=0
            WHERE a.user_id=:owner AND a.activity_date>=:start AND a.activity_date<:end"""),
            params,
        ).one()
        if counts.points > MAX_POINTS or counts.segment_count > MAX_SEGMENTS:
            raise limit_error()
        if mode == "tracks":
            rows = (
                db.execute(
                    text(
                        GEOMETRIES
                        + """SELECT activity_id,segment_index,title,
                activity_date,ST_AsGeoJSON(ST_Transform(ST_Collect(geom),4326),9)::json AS geometry
                FROM usable GROUP BY activity_id,segment_index,title,activity_date
                ORDER BY activity_date DESC,activity_id,segment_index"""
                    ),
                    params,
                )
                .mappings()
                .all()
            )
            features = [
                dict(
                    type="Feature",
                    geometry=r["geometry"],
                    properties={
                        "activity_id": str(r["activity_id"]),
                        "segment_index": r["segment_index"],
                        "title": r["title"],
                        "activity_date": r["activity_date"].isoformat(),
                    },
                )
                for r in rows
            ]
            visible = len({r["activity_id"] for r in rows})
        else:
            # Segmentize projected edges to bound per-edge candidate grid extents.
            # This is a partition of the full line, not GPS sampling or point weights.
            query = (
                GEOMETRIES
                + """ , pieces AS (
                SELECT activity_id,d.geom FROM usable
                CROSS JOIN LATERAL ST_Dump(geom) d
            ), short_edges AS (
                SELECT activity_id,e.geom FROM pieces p
                CROSS JOIN LATERAL ST_DumpSegments(ST_Segmentize(p.geom,500)) e
                WHERE GeometryType(p.geom)='LINESTRING'
                UNION ALL SELECT activity_id,geom FROM pieces WHERE GeometryType(geom)='POINT'
            ), hits AS MATERIALIZED (
                SELECT activity_id,g.i,g.j FROM short_edges e
                CROSS JOIN LATERAL ST_SquareGrid(:size,CASE WHEN GeometryType(e.geom)='POINT'
                    THEN e.geom ELSE ST_Expand(e.geom,0.000001) END) g
                WHERE ST_Intersects(e.geom,g.geom) LIMIT :candidates
            ), totals AS (
                SELECT i,j,count(DISTINCT activity_id)::int AS count FROM hits GROUP BY i,j
            ) SELECT i,j,count,ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(
                i*:size,j*:size,(i+1)*:size,(j+1)*:size,3857),4326),9)::json AS geometry,
                (SELECT count(*) FROM hits) AS candidates,
                (SELECT count(DISTINCT activity_id) FROM hits) AS visible
                FROM totals ORDER BY i,j LIMIT :cells"""
            )
            rows = (
                db.execute(
                    text(query),
                    {**params, "candidates": MAX_CANDIDATES + 1, "cells": MAX_CELLS + 1},
                )
                .mappings()
                .all()
            )
            if len(rows) > MAX_CELLS or (rows and rows[0]["candidates"] > MAX_CANDIDATES):
                raise limit_error()
            features = [
                dict(
                    type="Feature",
                    geometry=r["geometry"],
                    properties={"i": r["i"], "j": r["j"], "count": r["count"]},
                )
                for r in rows
            ]
            visible = rows[0]["visible"] if rows else 0
        return dict(
            type="FeatureCollection",
            features=features,
            mode=mode,
            date_from=start.isoformat(),
            date_to=end.isoformat(),
            activity_count=counts.activity_count,
            visible_activity_count=visible,
            unsupported_segment_count=counts.unsupported,
            grid_size_m=GRID_SIZE,
            grid_crs="EPSG:3857",
            count_basis="distinct_activity_per_cell",
            max_count=max((f["properties"].get("count", 0) for f in features), default=0),
        )
    except DBAPIError as error:
        db.rollback()
        if getattr(error.orig, "sqlstate", None) == "57014":
            raise limit_error() from None
        raise
