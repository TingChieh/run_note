"""Spatial queries for the private city exploration views."""

import json

from sqlalchemy import text

CITY_DISTANCES = """
WITH segments AS MATERIALIZED (
    SELECT s.id, s.activity_id, s.geom, ST_Length(s.geom::geography) AS length,
        ST_XMax(s.geom)-ST_XMin(s.geom) > 180 AS wraps
    FROM activities a JOIN activity_segments s ON s.activity_id = a.id
    WHERE a.user_id = :owner AND s.geom IS NOT NULL
), city_inputs AS (
    SELECT code, geometry, ST_Expand(ST_MakeEnvelope(
        (bounds->>0)::float, (bounds->>1)::float,
        (bounds->>2)::float, (bounds->>3)::float, 4326),0.001) AS box
    FROM jsonb_to_recordset(CAST(:cities AS jsonb)) AS city(code text, geometry jsonb,bounds jsonb)
), cities AS MATERIALIZED (
    SELECT code, ST_CollectionExtract(ST_MakeValid(
        ST_GeomFromGeoJSON(geometry), 'method=structure keepcollapsed=false'),3) AS geom
    FROM city_inputs c WHERE c.box IS NULL OR EXISTS (
        SELECT 1 FROM segments s WHERE s.geom && c.box OR
            (s.wraps AND (ST_XMax(c.box) >= 170 OR ST_XMin(c.box) <= -170))
    )
), candidates AS MATERIALIZED (
    SELECT s.id, c.code, NOT s.wraps AND ST_ContainsProperly(c.geom, s.geom) AS inside
    FROM segments s JOIN cities c ON
        (s.geom && c.geom AND ST_Intersects(s.geom,c.geom)) OR
            (s.wraps AND (ST_XMax(c.geom) >= 170 OR ST_XMin(c.geom) <= -170))
    WHERE s.length > 0
), counts AS (
    SELECT id, count(*) AS n FROM candidates GROUP BY id
), interior AS MATERIALIZED (
    SELECT s.id, s.activity_id, c.code, s.length
    FROM segments s JOIN counts n ON n.id = s.id AND n.n = 1
    JOIN candidates c ON c.id = s.id
    WHERE c.inside
), edges AS (
    SELECT s.id, s.activity_id, e.path,
        CASE WHEN ST_XMax(e.geom)-ST_XMin(e.geom) > 180
             THEN ST_ShiftLongitude(e.geom) ELSE e.geom END AS geom
    FROM segments s JOIN counts n ON n.id = s.id
    LEFT JOIN interior i ON s.id = i.id
    CROSS JOIN LATERAL ST_DumpSegments(s.geom) e
    WHERE i.id IS NULL AND ST_Length(e.geom) > 0
), wrapped AS MATERIALIZED (
    SELECT e.id, e.activity_id, e.path, piece.n, piece.geom
    FROM edges e CROSS JOIN LATERAL (
        SELECT 0 AS n, CASE WHEN ST_XMax(e.geom) > 180
            THEN ST_Intersection(e.geom, ST_MakeEnvelope(0,-90,180,90,4326))
            ELSE e.geom END AS geom
        UNION ALL
        SELECT 1, ST_Translate(ST_Intersection(
            e.geom, ST_MakeEnvelope(180,-90,360,90,4326)), -360, 0)
        WHERE ST_XMax(e.geom) > 180
    ) piece WHERE ST_Length(piece.geom) > 0
), hits AS MATERIALIZED (
    SELECT e.id, e.activity_id, e.path, e.n, c.code, cut.clipped,
        ST_CollectionExtract(ST_Difference(cut.clipped, ST_Boundary(c.geom)), 2) AS interior
    FROM wrapped e JOIN candidates hit ON hit.id = e.id
    JOIN cities c ON c.code = hit.code AND e.geom && c.geom
    CROSS JOIN LATERAL (
        SELECT ST_CollectionExtract(ST_Intersection(e.geom, c.geom), 2) AS clipped
        OFFSET 0
    ) cut
    WHERE ST_Length(cut.clipped) > 0
), neighbors AS (
    SELECT id, path, n, array_agg(clipped) AS clips, array_agg(code) AS codes
    FROM hits GROUP BY id,path,n HAVING count(*) > 1
), shares AS (
    SELECT activity_id, code, length FROM interior
    UNION ALL
    SELECT h.activity_id, h.code, ST_Length(ST_CollectionExtract(
        ST_Difference(h.interior,
            COALESCE(other.geom, ST_GeomFromText('LINESTRING EMPTY',4326))), 2)::geography)
    FROM hits h LEFT JOIN neighbors b USING (id,path,n)
    LEFT JOIN LATERAL (
        SELECT ST_Union(piece.geom) AS geom
        FROM unnest(b.codes,b.clips) AS piece(code,geom) WHERE piece.code <> h.code
    ) other ON true
), per_city AS MATERIALIZED (
    SELECT activity_id, code, sum(length) AS length FROM shares
    WHERE length > 0 GROUP BY activity_id, code
), allocated AS (
    SELECT activity_id, sum(length) AS length FROM per_city GROUP BY activity_id
), totals AS (
    SELECT activity_id, sum(length) AS length FROM segments GROUP BY activity_id
)
SELECT c.code, count(*) AS activity_count, min(a.activity_date) AS first_date,
    max(a.activity_date) AS last_date,
    sum(a.distance_m * c.length / greatest(t.length, alloc.length)) AS distance_m
FROM per_city c JOIN totals t USING (activity_id) JOIN allocated alloc USING (activity_id)
JOIN activities a ON a.id = c.activity_id AND a.user_id = :owner
GROUP BY c.code
UNION ALL
SELECT NULL, count(*), NULL, NULL, 0 FROM activities a
WHERE a.user_id=:owner
    AND EXISTS (SELECT 1 FROM activity_segments s WHERE s.activity_id=a.id)
    AND NOT EXISTS (SELECT 1 FROM allocated m WHERE m.activity_id=a.id)
    AND NOT EXISTS (
        SELECT 1 FROM activity_global_footprint_caches c
        WHERE (c.activity_id,c.user_id)=(a.id,a.user_id)
            AND c.atlas_version=:atlas AND c.city_codes && CAST(:point_codes AS varchar[])
    )
ORDER BY code NULLS LAST
"""


def city_distances(db, owner, cities, *, atlas="", point_codes=()):
    # Ignore non-geometric atlas metadata and keep the authoritative inputs bound.
    geometries = [
        {"code": c["code"], "geometry": c["geometry"], "bounds": c.get("bounds")} for c in cities
    ]
    return db.execute(
        text(CITY_DISTANCES),
        {
            "owner": owner,
            "cities": json.dumps(geometries),
            "atlas": atlas,
            "point_codes": list(point_codes),
        },
    )


GRID_HISTORY = """
WITH cell_dates AS (
    SELECT grid.i, grid.j, a.activity_date
    FROM activities a
    JOIN footprint_activity_caches c ON (c.activity_id,c.user_id) = (a.id,a.user_id)
    CROSS JOIN LATERAL jsonb_to_recordset(c.cells) AS grid(i integer,j integer)
    WHERE a.user_id = :owner AND c.algorithm_version = :grid_version
      AND grid.i BETWEEN :west AND :east AND grid.j BETWEEN :south AND :north
), hits AS (
    SELECT i,j,extract(year FROM activity_date)::integer AS year,
        min(extract(month FROM activity_date))::integer AS first_month, count(*) AS heat
    FROM cell_dates
    GROUP BY i,j,extract(year FROM activity_date)
), history AS (
SELECT i,j,array_agg(year ORDER BY year) AS years,
    array_agg(heat ORDER BY year) AS counts,
    (array_agg(first_month ORDER BY year))[1] AS first_month
FROM hits GROUP BY i,j
), polygons AS MATERIALIZED (
    SELECT code,ST_CollectionExtract(ST_MakeValid(
        ST_GeomFromGeoJSON(geometry), 'method=structure keepcollapsed=false'),3) AS geom
    FROM jsonb_to_recordset(CAST(:polygons AS jsonb)) AS p(code text,geometry jsonb)
)
SELECT h.* FROM history h
WHERE CAST(:code AS text) IS NULL OR (
    SELECT p.code FROM polygons p
    WHERE ST_Covers(p.geom,ST_Transform(ST_SetSRID(
        ST_MakePoint((h.i+0.5)*:size,(h.j+0.5)*:size),3857),4326))
    ORDER BY p.code LIMIT 1
) = :code
ORDER BY h.i,h.j
"""
