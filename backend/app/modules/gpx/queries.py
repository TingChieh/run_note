"""Bounded bulk PostGIS queries; no degree-length or per-point round trips."""

import json
from decimal import Decimal

from sqlalchemy import text

from app.modules.gpx.schema import Segment


def line_wkt(segment: Segment) -> str | None:
    if len(segment.points) < 2:
        return None
    return "LINESTRING(" + ",".join(f"{p.lon} {p.lat}" for p in segment.points) + ")"


def edge_distances(db, segments: list[Segment]) -> list[list[float]]:
    edges, sizes = [], []
    for segment in segments:
        sizes.append(len(segment.points) - 1)
        for a, b in zip(segment.points, segment.points[1:], strict=False):
            edges.append(
                {"idx": len(edges), "lon1": a.lon, "lat1": a.lat, "lon2": b.lon, "lat2": b.lat}
            )
    values = []
    # Keep bind count fixed and intermediate rows bounded even at 50000 source points.
    for start in range(0, len(edges), 5000):
        rows = db.execute(
            text("""SELECT idx, ST_Distance(
            ST_SetSRID(ST_MakePoint(lon1,lat1),4326)::geography,
            ST_SetSRID(ST_MakePoint(lon2,lat2),4326)::geography) AS meters
            FROM jsonb_to_recordset(CAST(:edges AS jsonb)) AS e
            (idx int,lon1 double precision,lat1 double precision,
            lon2 double precision,lat2 double precision)
            ORDER BY idx"""),
            {"edges": json.dumps(edges[start : start + 5000])},
        ).all()
        values.extend(row.meters for row in rows)
    result, offset = [], 0
    for size in sizes:
        result.append(values[offset : offset + size])
        offset += size
    return result


def route_distance(db, segments: list[Segment]) -> Decimal:
    lines = [{"wkt": line_wkt(s)} for s in segments if len(s.points) > 1]
    total = Decimal(0)
    for start in range(0, len(lines), 1000):
        # Each line is continuous by the frozen rules; singletons contribute zero.
        lengths = db.execute(
            text("""SELECT ST_Length(ST_GeomFromText(wkt,4326)::geography)
            FROM jsonb_to_recordset(CAST(:lines AS jsonb)) AS line(wkt text)"""),
            {"lines": json.dumps(lines[start : start + 1000])},
        ).scalars()
        total += sum((Decimal(str(value)) for value in lengths), Decimal(0))
    return total
