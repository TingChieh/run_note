"""Opt-in compact coordinates for the all-record footprint response.

Snapshot geometry comes from ``ST_AsGeoJSON(..., 9)``, so every coordinate is a multiple of 1e-9
degree. Each run of positions is sent as flat integer deltas in that unit: lossless, and about half
the compressed size of decimal GeoJSON. The browser decodes it back to the same numbers.
"""

from itertools import chain

SCALE = 10**9
ENCODING = "delta-1e9"


class NotEncodable(ValueError):
    """A coordinate is not an exact multiple of 1/SCALE; the caller keeps plain GeoJSON."""


def _run(positions):
    if not positions or min(map(len, positions)) != 2 or max(map(len, positions)) != 2:
        raise NotEncodable
    values = list(chain.from_iterable(positions))
    units = [round(value * SCALE) for value in values]
    # Lossless only: every value must come back exactly when the browser divides by SCALE.
    if [unit / SCALE for unit in units] != values:
        raise NotEncodable
    # Flat [x0, y0, x1, y1, ...]: each value minus the one two places earlier (same axis).
    return units[:2] + [b - a for a, b in zip(units, units[2:], strict=False)]


def _geometry(geometry):
    kind = geometry["type"]
    if kind == "GeometryCollection":
        return {"type": kind, "geometries": [_geometry(child) for child in geometry["geometries"]]}
    coordinates = geometry["coordinates"]
    if kind == "Point":
        return {"type": kind, "delta": _run([coordinates])}
    if kind in ("MultiPoint", "LineString"):
        return {"type": kind, "delta": _run(coordinates)}
    if kind in ("MultiLineString", "Polygon"):
        return {"type": kind, "delta": [_run(part) for part in coordinates]}
    raise NotEncodable


def encode_collection(collection):
    """Return the collection with compact coordinates, or unchanged if any value would be lost."""
    try:
        features = [
            {**feature, "geometry": _geometry(feature["geometry"])}
            for feature in collection["features"]
        ]
    except NotEncodable:
        return collection
    return {**collection, "features": features, "coordinate_encoding": ENCODING}
