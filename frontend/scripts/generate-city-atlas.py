"""Build the local display atlas from DataV 100000_full_city.json (no private input)."""

import json
import math
import sys
from pathlib import Path


def simplify(points, tolerance=0.002):
    if len(points) <= 2:
        return points
    first, last = points[0], points[-1]
    dx, dy = last[0] - first[0], last[1] - first[1]
    length = dx * dx + dy * dy
    maximum, pivot = 0, 0
    for index, point in enumerate(points[1:-1], 1):
        fraction = max(0, min(1, ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / length)) if length else 0
        distance = math.hypot(point[0] - first[0] - fraction * dx, point[1] - first[1] - fraction * dy)
        if distance > maximum:
            maximum, pivot = distance, index
    if maximum > tolerance:
        return simplify(points[:pivot + 1])[:-1] + simplify(points[pivot:])
    return [first, last]


source = json.loads(Path(sys.argv[1]).read_text())
municipalities = {110000: "北京市", 120000: "天津市", 310000: "上海市", 500000: "重庆市", 810000: "香港", 820000: "澳门"}
regions = {}
for feature in source["features"]:
    properties = feature["properties"]
    parent = properties.get("parent", {}).get("adcode")
    if parent in municipalities:
        code, name = parent, municipalities[parent]
    elif properties.get("level") == "city":
        code, name = properties["adcode"], properties["name"]
    else:
        continue  # A province or sea outline must not be labelled as a city.
    region = regions.setdefault(code, {"code": str(code), "name": name, "polygons": []})
    geometry = feature["geometry"]
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    for polygon in polygons:
        rings = []
        for ring in polygon:
            reduced = simplify(ring)
            if len(reduced) < 4:
                reduced = ring
            rings.append([[round(x, 4), round(y, 4)] for x, y in reduced])
        region["polygons"].append(rings)

for region in regions.values():
    points = [point for polygon in region["polygons"] for ring in polygon for point in ring]
    region["bounds"] = [[min(p[0] for p in points), min(p[1] for p in points)], [max(p[0] for p in points), max(p[1] for p in points)]]
target = Path(__file__).parent.parent / "src/lib/data/china-cities.json"
target.write_text(json.dumps(sorted(regions.values(), key=lambda r: r["code"]), ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Generated {len(regions)} regions; {target.stat().st_size} bytes")
