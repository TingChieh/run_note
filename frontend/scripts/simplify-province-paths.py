#!/usr/bin/env python3
"""Shrink src/lib/data/china-provinces.json: Douglas-Peucker per ring, one decimal, compact syntax.

The file is display-only (ProvinceMap renders it into the server-rendered dashboard HTML and the JS
bundle). The authoritative boundaries stay in backend/app/modules/footprints/data. The script is NOT
idempotent: running it on its own output simplifies further. To try another tolerance, restore the data
file first (git checkout -- src/lib/data/china-provinces.json), then run it once.

Usage (from frontend/):  python3 scripts/simplify-province-paths.py [--tolerance 0.3] [--check]
"""
import argparse
import json
import math
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src/lib/data/china-provinces.json"
Point = tuple[float, float]


def parse_rings(path: str) -> list[list[Point]]:
    rings = []
    for sub in re.findall(r"M[^M]*", path):
        points = [(float(x), float(y)) for x, y in re.findall(r"(-?\d+\.?\d*)[, ](-?\d+\.?\d*)", sub)]
        if points:
            rings.append(points)
    return rings


def distance(p: Point, a: Point, b: Point) -> float:
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    return abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / length


def simplify_open(points: list[Point], tolerance: float) -> list[Point]:
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        far, far_distance = -1, tolerance
        for i in range(first + 1, last):
            d = distance(points[i], points[first], points[last])
            if d > far_distance:
                far, far_distance = i, d
        if far >= 0:
            keep[far] = True
            stack += [(first, far), (far, last)]
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring: list[Point], tolerance: float) -> list[Point]:
    deduped = [p for i, p in enumerate(ring) if i == 0 or p != ring[i - 1]]
    if len(deduped) > 1 and deduped[0] == deduped[-1]:
        deduped.pop()
    if len(deduped) <= 3:
        return deduped
    # A closed ring has no natural chord: split it at the vertex farthest from the start.
    split = max(range(len(deduped)), key=lambda i: math.hypot(deduped[i][0] - deduped[0][0], deduped[i][1] - deduped[0][1]))
    left = simplify_open(deduped[: split + 1], tolerance)
    right = simplify_open(deduped[split:] + [deduped[0]], tolerance)
    simplified = left[:-1] + right[:-1]
    return simplified if len(simplified) >= 3 else deduped[:3]


def number(value: float) -> str:
    text = f"{value:.1f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def encode(rings: list[list[Point]]) -> str:
    return "".join("M" + "L".join(f"{number(x)},{number(y)}" for x, y in ring) + "Z" for ring in rings)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tolerance", type=float, default=0.3, help="max deviation in viewBox units (660x420)")
    parser.add_argument("--check", action="store_true", help="print sizes without writing")
    args = parser.parse_args()
    shapes = json.loads(DATA.read_text(encoding="utf8"))
    before = sum(len(s["path"]) for s in shapes)
    for shape in shapes:
        # Rings that collapse to fewer than three points had no visible area (the source has a few
        # zero-area specks); dropping them keeps every path a real polygon.
        simplified = [simplify_ring(r, args.tolerance) for r in parse_rings(shape["path"])]
        shape["path"] = encode([ring for ring in simplified if len(ring) >= 3])
    after = sum(len(s["path"]) for s in shapes)
    print(f"{len(shapes)} shapes, path chars {before} -> {after} ({before / after:.1f}x), tolerance {args.tolerance}")
    if not args.check:
        DATA.write_text(json.dumps(shapes, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
