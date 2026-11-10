from app.modules.footprints.encoding import ENCODING, SCALE, encode_collection


def decode_positions(flat):
    positions, x, y = [], 0, 0
    for index in range(0, len(flat), 2):
        x, y = x + flat[index], y + flat[index + 1]
        positions.append([x / SCALE, y / SCALE])
    return positions


def decode_geometry(geometry):
    kind = geometry["type"]
    if kind == "GeometryCollection":
        return {"type": kind, "geometries": [decode_geometry(g) for g in geometry["geometries"]]}
    if kind == "Point":
        return {"type": kind, "coordinates": decode_positions(geometry["delta"])[0]}
    if kind in ("MultiPoint", "LineString"):
        return {"type": kind, "coordinates": decode_positions(geometry["delta"])}
    return {"type": kind, "coordinates": [decode_positions(part) for part in geometry["delta"]]}


def decode_collection(collection):
    """Reference decoder (mirrors frontend/src/lib/api/footprints.ts) for tests."""
    assert collection.pop("coordinate_encoding") == ENCODING
    for feature in collection["features"]:
        feature["geometry"] = decode_geometry(feature["geometry"])
    return collection


def collection(*geometries):
    return {
        "type": "FeatureCollection",
        "mode": "tracks",
        "features": [
            {"type": "Feature", "geometry": g, "properties": {"segment_index": i}}
            for i, g in enumerate(geometries)
        ],
    }


GEOMETRIES = [
    {"type": "Point", "coordinates": [121.473701234, 31.230416789]},
    {"type": "LineString", "coordinates": [[-179.999999999, -85.05], [179.5, 85.051128779]]},
    {"type": "MultiLineString", "coordinates": [[[0, 0], [0.000000001, 0]], [[1, 1], [2, 2]]]},
    {"type": "Polygon", "coordinates": [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]},
    {
        "type": "GeometryCollection",
        "geometries": [{"type": "LineString", "coordinates": [[10.5, 20.25], [10.75, 20.125]]}],
    },
]


def test_encoding_is_lossless_and_keeps_everything_else():
    original = collection(*GEOMETRIES)
    encoded = encode_collection(original)
    assert encoded["coordinate_encoding"] == "delta-1e9"
    # Runs are flat integer deltas; the input is never mutated.
    assert encoded["features"][1]["geometry"]["delta"][2:] == [359499999999, 170101128779]
    assert all(isinstance(v, int) for v in encoded["features"][1]["geometry"]["delta"])
    assert "coordinates" in original["features"][0]["geometry"]
    assert decode_collection(encoded) == original


def test_anything_that_would_lose_precision_stays_plain_geojson():
    for geometry in [
        {"type": "Point", "coordinates": [1.0000000001, 2]},  # finer than 1e-9 degree
        {"type": "LineString", "coordinates": [[1, 2, 3], [4, 5, 6]]},  # a third dimension
        {"type": "LineString", "coordinates": []},
        {"type": "MultiPolygon", "coordinates": [[[[1, 1], [2, 1], [2, 2], [1, 1]]]]},
    ]:
        original = collection(GEOMETRIES[0], geometry)
        assert encode_collection(original) is original


def test_empty_collection_is_marked_encoded():
    assert encode_collection(collection()) == {**collection(), "coordinate_encoding": "delta-1e9"}
