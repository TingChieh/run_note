"""Build offline global region/city atlases for backend matching and frontend base map.

Sources (all public domain / open visualization boundaries; zero runtime external calls):
- backend/app/modules/footprints/data/china-provinces.geojson (34 Chinese provincial regions)
- frontend/src/lib/data/china-cities.json (369 Chinese municipal/SAR regions)
- Natural Earth 50m countries, 10m admin-1 states/provinces, 10m populated places
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CN_PROVINCES_FILE = ROOT / "backend/app/modules/footprints/data/china-provinces.geojson"
CN_CITIES_FILE = ROOT / "frontend/src/lib/data/china-cities.json"
OUT_REGIONS = ROOT / "backend/app/modules/footprints/data/world-regions.json.gz"
OUT_CITIES = ROOT / "backend/app/modules/footprints/data/world-cities.json.gz"
OUT_BASE = ROOT / "frontend/src/lib/data/world-base.json"

COUNTRY_NAME_OVERRIDES = {
    "CHN": "中国",
    "KOR": "韩国",
    "PRK": "朝鲜",
    "ARE": "阿联酋",
    "GBR": "英国",
    "USA": "美国",
    "GIB": "直布罗陀",
    "UMI": "美国本土外小岛屿",
    "SGP": "新加坡",
}

SKIP_COUNTRIES = {"ATA", "PGA"}
CN_TERRITORIES = {"CHN", "TWN", "HKG", "MAC"}

CN_PROV_SUFFIX = re.compile(r"(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$")
CN_CITY_SUFFIX = re.compile(r"(?:市|地区|自治州|盟)$")


def simplify_ring(ring: list[list[float]], tol: float, decimals: int) -> list[list[float]] | None:
    if len(ring) < 4:
        return None
    if len(ring) == 4:
        out = [[round(x, decimals), round(y, decimals)] for x, y in ring]
    else:
        pts = [ring[0]]
        lx, ly = ring[0][0], ring[0][1]
        t2 = tol * tol
        for pt in ring[1:-1]:
            dx, dy = pt[0] - lx, pt[1] - ly
            if dx * dx + dy * dy >= t2:
                pts.append(pt)
                lx, ly = pt[0], pt[1]
        pts.append(ring[0])
        if len(pts) < 4:
            pts = ring[:3] + [ring[0]]
        out = [[round(x, decimals), round(y, decimals)] for x, y in pts]
    out[-1] = list(out[0])
    # Drop collapsed rings (e.g. tiny island rounded to a single point/line)
    if len({(p[0], p[1]) for p in out[:-1]}) < 3:
        return None
    return out


def simplify_geometry(geom: dict, tol: float, decimals: int) -> dict | None:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Polygon" and coords:
        outer = simplify_ring(coords[0], tol, decimals)
        if not outer:
            return None
        holes = [h for h in (simplify_ring(r, tol, decimals) for r in coords[1:]) if h]
        return {"type": "Polygon", "coordinates": [outer, *holes]}
    if gtype == "MultiPolygon" and coords:
        polys = []
        for poly in coords:
            if not poly:
                continue
            outer = simplify_ring(poly[0], tol, decimals)
            if not outer:
                continue
            holes = [h for h in (simplify_ring(r, tol, decimals) for r in poly[1:]) if h]
            polys.append([outer, *holes])
        return {"type": "MultiPolygon", "coordinates": polys} if polys else None
    return None


def geom_bounds(geom: dict) -> list[float]:
    minx, miny, maxx, maxy = 180.0, 90.0, -180.0, -90.0
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        for ring in poly:
            for x, y in ring:
                minx = min(minx, x)
                maxx = max(maxx, x)
                miny = min(miny, y)
                maxy = max(maxy, y)
    return [round(minx, 4), round(miny, 4), round(maxx, 4), round(maxy, 4)]


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def point_in_geometry(lon: float, lat: float, geom: dict) -> bool:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        if point_in_ring(lon, lat, poly[0]) and not any(
            point_in_ring(lon, lat, hole) for hole in poly[1:]
        ):
            return True
    return False


def decode_china_cities(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    scale = data["scale"]
    cities = []
    for region in data["regions"]:
        polys = []
        for poly in region["polygons"]:
            rings = []
            for flat in poly:
                ring = []
                x = y = 0
                for i in range(0, len(flat), 2):
                    x += flat[i]
                    y += flat[i + 1]
                    ring.append([round(x / scale, 4), round(y / scale, 4)])
                if len(ring) >= 4:
                    ring[-1] = list(ring[0])
                    if len({(pt[0], pt[1]) for pt in ring[:-1]}) >= 3:
                        rings.append(ring)
            if rings:
                polys.append(rings)
        if not polys:
            continue
        b = region["bounds"]
        bounds = [
            round(b[0][0], 4),
            round(b[0][1], 4),
            round(b[1][0], 4),
            round(b[1][1], 4),
        ]
        center = [
            round((bounds[0] + bounds[2]) / 2, 4),
            round((bounds[1] + bounds[3]) / 2, 4),
        ]
        code = str(region["code"])
        name = str(region["name"])
        short_name = CN_CITY_SUFFIX.sub("", name) or name
        cities.append(
            {
                "code": code,
                "name": name,
                "short_name": short_name,
                "country_code": "CHN",
                "region_code": f"CN-{code[:2]}0000",
                "bounds": bounds,
                "center": center,
                "geometry": {"type": "MultiPolygon", "coordinates": polys},
            }
        )
    return cities


def main() -> None:
    parser = argparse.ArgumentParser(description="Build global footprint atlases.")
    parser.add_argument("--countries", required=True, type=Path)
    parser.add_argument("--admin1", required=True, type=Path)
    parser.add_argument("--places", required=True, type=Path)
    args = parser.parse_args()

    countries_raw = json.loads(args.countries.read_text())
    admin1_raw = json.loads(args.admin1.read_text())
    places_raw = json.loads(args.places.read_text())
    cn_provinces_raw = json.loads(CN_PROVINCES_FILE.read_text())

    country_names: dict[str, str] = {"CHN": "中国"}
    for f in countries_raw["features"]:
        p = f["properties"]
        code = p.get("ADM0_A3") or p.get("ISO_A3")
        if not code or code in SKIP_COUNTRIES or code in CN_TERRITORIES:
            continue
        country_names[code] = (
            COUNTRY_NAME_OVERRIDES.get(code) or p.get("NAME_ZH") or p.get("NAME") or code
        )

    # Build regions: authoritative 34 China provinces + Natural Earth admin-1 for rest of world.
    regions: list[dict] = []
    seen_region_codes: set[str] = set()

    for f in cn_provinces_raw["features"]:
        p = f["properties"]
        name = p.get("name")
        if not name:
            continue
        adcode = str(p["adcode"])
        code = f"CN-{adcode}"
        geom = simplify_geometry(f["geometry"], tol=0.015, decimals=3)
        if not geom:
            continue
        bounds = geom_bounds(geom)
        center = [
            round((bounds[0] + bounds[2]) / 2, 3),
            round((bounds[1] + bounds[3]) / 2, 3),
        ]
        short_name = CN_PROV_SUFFIX.sub("", name) or name
        regions.append(
            {
                "code": code,
                "name": name,
                "short_name": short_name,
                "country_code": "CHN",
                "country_name": "中国",
                "bounds": bounds,
                "center": center,
                "geometry": geom,
            }
        )
        seen_region_codes.add(code)

    for f in admin1_raw["features"]:
        p = f["properties"]
        adm0 = p.get("adm0_a3")
        if not adm0 or adm0 in SKIP_COUNTRIES or adm0 in CN_TERRITORIES:
            continue
        raw_iso = p.get("iso_3166_2") or ""
        ne_id = p.get("ne_id")
        code = (
            raw_iso
            if raw_iso and "~" not in raw_iso and raw_iso not in seen_region_codes
            else f"{adm0}-{ne_id}"
        )
        if code in seen_region_codes:
            code = f"{adm0}-{ne_id}-{len(seen_region_codes)}"
        seen_region_codes.add(code)

        name = p.get("name_zh") or p.get("name") or code
        cname = (
            COUNTRY_NAME_OVERRIDES.get(adm0) or country_names.get(adm0) or p.get("admin") or adm0
        )
        country_names.setdefault(adm0, cname)
        geom = simplify_geometry(f["geometry"], tol=0.03, decimals=3)
        if not geom:
            continue
        bounds = geom_bounds(geom)
        center = [
            round((bounds[0] + bounds[2]) / 2, 3),
            round((bounds[1] + bounds[3]) / 2, 3),
        ]
        regions.append(
            {
                "code": code,
                "name": name,
                "short_name": name,
                "country_code": adm0,
                "country_name": cname,
                "bounds": bounds,
                "center": center,
                "geometry": geom,
            }
        )

    # Index regions by country for fast city-to-region matching
    by_country: dict[str, list[dict]] = {}
    for r in regions:
        by_country.setdefault(r["country_code"], []).append(r)

    # Build cities: 369 authoritative Chinese municipal polygons + populated places
    # for Taiwan & overseas regions.
    polygon_cities = decode_china_cities(CN_CITIES_FILE)
    point_cities: list[dict] = []
    seen_city_codes: set[str] = {c["code"] for c in polygon_cities}

    for f in places_raw["features"]:
        p = f["properties"]
        adm0 = p.get("ADM0_A3")
        if not adm0 or adm0 in SKIP_COUNTRIES or adm0 in {"CHN", "HKG", "MAC"}:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        lon = round(float(lon), 4)
        lat = round(float(lat), 4)
        name = p.get("NAME_ZH") or p.get("NAME")
        if not name:
            continue
        gid = p.get("GEONAMESID") or p.get("NE_ID")
        code = f"GN-{int(gid)}" if gid else f"PL-{len(point_cities)}"
        if code in seen_city_codes:
            code = f"{code}-{len(point_cities)}"
        seen_city_codes.add(code)

        if adm0 == "TWN":
            country_code = "CHN"
            region_code = "CN-710000"
        else:
            country_code = adm0
            region_code = ""
            candidates = by_country.get(country_code, [])
            for reg in candidates:
                b = reg["bounds"]
                if (
                    b[0] <= lon <= b[2]
                    and b[1] <= lat <= b[3]
                    and point_in_geometry(lon, lat, reg["geometry"])
                ):
                    region_code = reg["code"]
                    break
            if not region_code and candidates:
                # Nearest region center fallback for coastal/island cities
                best = min(
                    candidates,
                    key=lambda r: (r["center"][0] - lon) ** 2 + (r["center"][1] - lat) ** 2,
                )
                region_code = best["code"]
            if not region_code:
                continue

        point_cities.append(
            {
                "code": code,
                "name": name,
                "short_name": name,
                "country_code": country_code,
                "region_code": region_code,
                "lon": lon,
                "lat": lat,
            }
        )

    # Write gzipped backend atlases
    OUT_REGIONS.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT_REGIONS, "wt", encoding="utf-8", compresslevel=9) as fh:
        json.dump(regions, fh, ensure_ascii=False, separators=(",", ":"))

    with gzip.open(OUT_CITIES, "wt", encoding="utf-8", compresslevel=9) as fh:
        json.dump(
            {"polygon_cities": polygon_cities, "point_cities": point_cities},
            fh,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    # Build lightweight frontend base GeoJSON (countries minus CHN/TWN + China 34 provinces)
    base_features: list[dict] = []
    for f in countries_raw["features"]:
        p = f["properties"]
        code = p.get("ADM0_A3") or p.get("ISO_A3")
        if not code or code in SKIP_COUNTRIES or code in CN_TERRITORIES:
            continue
        geom = simplify_geometry(f["geometry"], tol=0.18, decimals=2)
        if not geom:
            continue
        base_features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "country",
                    "code": code,
                    "name": country_names.get(code, p.get("NAME") or code),
                },
                "geometry": geom,
            }
        )

    for f in cn_provinces_raw["features"]:
        p = f["properties"]
        if not p.get("name"):
            continue
        geom = simplify_geometry(f["geometry"], tol=0.06, decimals=2)
        if not geom:
            continue
        base_features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "region",
                    "country": "CHN",
                    "code": f"CN-{p['adcode']}",
                    "name": p["name"],
                },
                "geometry": geom,
            }
        )

    OUT_BASE.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": base_features},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(
        f"Regions: {len(regions)} ({OUT_REGIONS.stat().st_size / 1024:.1f} KB gz) | "
        f"Cities: {len(polygon_cities)} poly + {len(point_cities)} pt "
        f"({OUT_CITIES.stat().st_size / 1024:.1f} KB gz) | "
        f"Frontend base: {len(base_features)} features ({OUT_BASE.stat().st_size / 1024:.1f} KB)"
    )


if __name__ == "__main__":
    main()
