"""Versioned, private exploration reads built from current activities and footprint caches."""

import json
from array import array
from bisect import bisect_left, bisect_right
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from dataclasses import dataclass, field
from datetime import date
from math import asinh, atan, degrees, floor, isfinite, radians, sinh, tan
from threading import Lock
from time import monotonic

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.modules.footprints.exploration_queries import GRID_HISTORY, city_distances
from app.modules.footprints.global_atlas import _atlas, _boxes_overlap, atlas_version
from app.modules.footprints.service import GRID_SIZE
from app.modules.footprints.snapshot import ALGORITHM_VERSION

EARTH_RADIUS = 6378137
MAX_LATITUDE = 85.0511287798
MAX_GRID_INDEX = 200376
MAX_FEATURES = 5000
MAX_HISTORY_HITS = 6_000_000
MAX_CACHED_HITS = 8_000_000


@dataclass
class YearGrid:
    hits: array = field(default_factory=lambda: array("i"))
    bounds: list[int] = field(default_factory=list)
    new_bounds: list[int] = field(default_factory=list)
    overview: dict = field(default_factory=dict)
    lock: Lock = field(default_factory=Lock)

    def add(self, i, j, heat, first_seen):
        self.hits.extend((i, j, -heat if first_seen else heat))
        self._expand(self.bounds, i, j)
        if first_seen:
            self._expand(self.new_bounds, i, j)

    @staticmethod
    def _expand(bounds, i, j):
        if not bounds:
            bounds.extend([i, j, i, j])
        else:
            # Column order comes from the history query.
            bounds[1] = min(bounds[1], j)
            bounds[2] = i
            bounds[3] = max(bounds[3], j)

    def columns(self, west, east):
        rows = range(len(self.hits) // 3)

        def column(row):
            return self.hits[row * 3]

        return range(bisect_left(rows, west, key=column), bisect_right(rows, east, key=column))


@dataclass
class GridHistory:
    first_year: int | None = None
    months: Counter = field(default_factory=Counter)
    years: dict[int, YearGrid] = field(default_factory=dict)
    size: int = 0


class IncompleteHistory(Exception):
    def __init__(self, status="pending"):
        self.status = status


class ExplorationReads:
    """Deduplicate cold reads in each process and cap background work and retained results."""

    def __init__(self, session_factory):
        self.session_factory = session_factory
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="exploration")
        self.lock = Lock()
        self.entries = OrderedDict()

    def close(self):
        self.executor.shutdown(wait=False, cancel_futures=True)

    def _run(self, owner, version, build):
        try:
            with self.session_factory() as db:
                db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
                db.execute(text("SET LOCAL statement_timeout = '30000ms'"))
                actual = db.scalar(
                    text("SELECT activity_data_version FROM users WHERE id=:owner"),
                    {"owner": owner},
                )
                if actual != version:
                    return "pending", None
                return "ready", build(db, owner)
        except IncompleteHistory as error:
            return error.status, None
        except DBAPIError:
            # Private query parameters and geometry must never reach exception logging.
            return "failed", None

    def read(self, owner, version, kind, build):
        key = (owner, version, atlas_version(), ALGORITHM_VERSION, kind)
        with self.lock:
            entry = self.entries.pop(key, None)
            for previous in list(self.entries):
                if previous[0] == owner and previous[1] != version:
                    if self.entries[previous][0].done():
                        del self.entries[previous]
            now = monotonic()
            if entry is not None and entry[0].done():
                status, _ = entry[0].result()
                if status != "ready" and now - entry[1] > 3:
                    entry = None
            if entry is None:
                if sum(not future.done() for future, _ in self.entries.values()) >= 2:
                    return "pending", None
                entry = (self.executor.submit(self._run, owner, version, build), now)
            self.entries[key] = entry
            self._evict(key)
        try:
            return entry[0].result(timeout=0.15)
        except TimeoutError:
            return "pending", None

    def _evict(self, keep):
        completed = {}
        for key, (future, _) in self.entries.items():
            if future.done():
                _, data = future.result()
                completed[key] = data.size if isinstance(data, GridHistory) else 0
        hits = sum(completed.values())
        for key, size in completed.items():
            if len(self.entries) <= 12 and hits <= MAX_CACHED_HITS:
                break
            if key != keep:
                del self.entries[key]
                hits -= size


CATALOG_TOTALS = """
SELECT count(*) AS activity_count,
    count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM activity_segments s WHERE s.activity_id=a.id
    )) AS no_track_count,
    COALESCE(sum(a.distance_m),0) AS total_distance
FROM activities a WHERE a.user_id=:owner
"""
ATLAS_COVERAGE = """
SELECT count(*) FILTER (WHERE c.id IS NULL) FROM activities a
LEFT JOIN activity_global_footprint_caches c ON (c.activity_id,c.user_id)=(a.id,a.user_id)
    AND c.atlas_version=:atlas
WHERE a.user_id=:owner
"""
ATLAS_HITS = """
SELECT hit.code, count(*) AS activity_count, min(a.activity_date) AS first_date,
    max(a.activity_date) AS last_date
FROM activities a JOIN activity_global_footprint_caches c
ON (c.activity_id,c.user_id)=(a.id,a.user_id) AND c.atlas_version=:atlas
CROSS JOIN LATERAL unnest(c.city_codes) AS hit(code)
WHERE a.user_id=:owner GROUP BY hit.code
"""
REGION_HITS = """
SELECT DISTINCT unnest(c.region_codes) AS code
FROM activities a JOIN activity_global_footprint_caches c
ON (c.activity_id,c.user_id)=(a.id,a.user_id) AND c.atlas_version=:atlas
WHERE a.user_id=:owner
"""
GRID_COVERAGE = """
SELECT count(*) FILTER (WHERE c.id IS NULL) AS missing, min(a.activity_date) AS first_date
FROM activities a LEFT JOIN footprint_activity_caches c
ON (c.activity_id,c.user_id)=(a.id,a.user_id) AND c.algorithm_version=:grid_version
WHERE a.user_id=:owner
"""


def _place(city, row, kind, distance):
    region = _atlas()["regions_by_code"].get(city["region_code"])
    return dict(
        code=city["code"],
        name=city["name"],
        region_name=region["name"] if region else None,
        kind=kind,
        first_date=row.first_date,
        last_date=row.last_date,
        activity_count=row.activity_count,
        distance_m=distance,
    )


def _catalog(db, owner):
    totals = db.execute(text(CATALOG_TOTALS), {"owner": owner}).one()
    params = {"owner": owner, "atlas": atlas_version()}
    atlas = _atlas()
    items, unmatched = [], 0
    if totals.activity_count > totals.no_track_count:
        if db.scalar(text(ATLAS_COVERAGE), params):
            raise IncompleteHistory()
        point_codes = [city["code"] for city in atlas["point_cities"]]
        for row in city_distances(
            db, owner, atlas["poly_cities"], atlas=params["atlas"], point_codes=point_codes
        ):
            if row.code is None:
                unmatched = row.activity_count
            else:
                items.append(
                    _place(atlas["cities_by_code"][row.code], row, "boundary", row.distance_m)
                )
        for row in db.execute(text(ATLAS_HITS), params):
            city = atlas["cities_by_code"].get(row.code)
            if city is not None and "geometry" not in city:
                items.append(_place(city, row, "nearby", None))
    items.sort(key=lambda item: (item["kind"], -item["last_date"].toordinal(), item["code"]))
    region_codes = db.scalars(text(REGION_HITS), params)
    regions = [
        {"code": code, "name": atlas["regions_by_code"][code]["name"]}
        for code in region_codes
        if code in atlas["regions_by_code"]
    ]
    regions.sort(key=lambda region: (region["name"], region["code"]))
    # Counts for cities cannot be added to obtain a distinct count of matched activities.
    boundary_count = sum(item["kind"] == "boundary" for item in items)
    distance = sum(item["distance_m"] or 0 for item in items)
    return dict(
        items=items,
        regions=regions,
        activity_count=totals.activity_count,
        no_track_count=totals.no_track_count,
        boundary_count=boundary_count,
        nearby_count=len(items) - boundary_count,
        unmatched_count=unmatched,
        distance_m=distance,
        unallocated_m=max(0, float(totals.total_distance) - distance),
    )


def version_fields(version, status):
    return dict(source_version=version, atlas_version=atlas_version(), status=status)


def catalog(reads, owner, version, limit, offset):
    status, data = reads.read(owner, version, "catalog", _catalog)
    return dict(
        **version_fields(version, status),
        items=data["items"][offset : offset + limit] if data else [],
        total=len(data["items"]) if data else 0,
        limit=limit,
        offset=offset,
        regions=data["regions"] if data else [],
        **{
            field: data[field] if data else None
            for field in (
                "activity_count",
                "boundary_count",
                "nearby_count",
                "no_track_count",
                "unmatched_count",
                "distance_m",
                "unallocated_m",
            )
        },
    )


def _grid_coverage(db, owner):
    params = {"owner": owner, "grid_version": ALGORITHM_VERSION}
    coverage = db.execute(text(GRID_COVERAGE), params).one()
    if coverage.missing:
        failed = db.scalar(
            text("""SELECT state='failed' FROM footprint_snapshots WHERE user_id=:owner
                AND target_version=(SELECT activity_data_version FROM users WHERE id=:owner)"""),
            params,
        )
        raise IncompleteHistory("failed" if failed else "pending")
    return coverage.first_date


def _index_box(bounds):
    west, south, east, north = bounds

    def x(lon):
        return floor(EARTH_RADIUS * radians(lon) / GRID_SIZE)

    def y(lat):
        return floor(EARTH_RADIUS * asinh(tan(radians(lat))) / GRID_SIZE)

    return x(west), y(south), x(east), y(north)


def _grid(db, owner, scope, geo):
    first_date = _grid_coverage(db, owner)
    history = GridHistory(first_year=max(1900, first_date.year) if first_date else None)
    if first_date is None:
        return history
    west, south, east, north = -MAX_GRID_INDEX, -MAX_GRID_INDEX, MAX_GRID_INDEX, MAX_GRID_INDEX
    candidates = []
    if geo is not None:
        x0, y0, x1, y1 = _index_box(geo["bounds"])
        west, south, east, north = x0 - 3, y0 - 3, x1 + 3, y1 + 3
        peers = _atlas()["regions" if scope == "region" else "poly_cities"]
        candidates = [
            {"code": p["code"], "geometry": p["geometry"]}
            for p in peers
            if p["code"] <= geo["code"] and _boxes_overlap(p["bounds"], geo["bounds"])
        ]
    params = dict(
        owner=owner,
        grid_version=ALGORITHM_VERSION,
        west=west,
        south=south,
        east=east,
        north=north,
        polygons=json.dumps(candidates),
        code=geo["code"] if geo else None,
        size=GRID_SIZE,
    )
    with db.execute(text(GRID_HISTORY).execution_options(yield_per=4096), params) as rows:
        for row in rows:
            first_year = row.years[0]
            history.months[first_year, row.first_month] += 1
            for year, heat in zip(row.years, row.counts, strict=True):
                if year not in history.years:
                    history.years[year] = YearGrid()
                history.years[year].add(row.i, row.j, heat, year == first_year)
            history.size += len(row.years)
            if history.size > MAX_HISTORY_HITS:
                raise IncompleteHistory("failed")
    return history


def _scope_data(reads, owner, version, scope, code):
    if scope == "global" and code == "all":
        return "ready", "全域", None, None
    if scope == "city" and code in _atlas()["cities_by_code"]:
        status, data = reads.read(owner, version, "catalog", _catalog)
        geo = _atlas()["cities_by_code"][code]
        if status != "ready":
            return status, geo["name"], None, geo
        city = next((item for item in data["items"] if item["code"] == code), None)
        if city is not None:
            return "ready", city["name"], city, geo if city["kind"] == "boundary" else None
    if scope == "region" and code in _atlas()["regions_by_code"]:
        status, data = reads.read(owner, version, "catalog", _catalog)
        geo = _atlas()["regions_by_code"][code]
        if status != "ready" or any(region["code"] == code for region in data["regions"]):
            return status, geo["name"], None, geo
    raise ApiError(404, "EXPLORATION_NOT_FOUND", "没有找到该范围的足迹")


def _read_grid(reads, owner, version, scope, code):
    status, name, city, geo = _scope_data(reads, owner, version, scope, code)
    data = None
    if status == "ready" and (city is None or geo is not None):
        status, data = reads.read(
            owner, version, (scope, code), lambda db, owner: _grid(db, owner, scope, geo)
        )
    return status, name, city, data


def detail(reads, owner, version, scope, code, year, today: date):
    status, name, city, history = _read_grid(reads, owner, version, scope, code)
    has_coverage = history is not None
    counts = history.months if history else {}
    before = sum(count for (first_year, _), count in counts.items() if first_year < year)
    months = []
    cumulative = before
    completed = 12 if year < today.year else today.month if year == today.year else 0
    for month in range(1, 13):
        count = counts.get((year, month), 0)
        cumulative += count if month <= completed else 0
        show = has_coverage and month <= completed
        months.append(
            dict(
                month=month,
                new_cells=count if show else None,
                cumulative_cells=cumulative if show else None,
            )
        )
    return dict(
        **version_fields(version, status),
        scope=scope,
        code=code,
        name=name,
        year=year,
        city=city,
        first_year=history.first_year if history else None,
        months=months,
        new_cells=sum(counts.get((year, m), 0) for m in range(1, completed + 1))
        if has_coverage
        else None,
        cumulative_cells=cumulative if has_coverage else None,
    )


def parse_viewport(value):
    if value is None:
        return None
    try:
        west, south, east, north = (float(part) for part in value.split(","))
        if (
            all(isfinite(v) for v in (west, south, east, north))
            and -180 <= west <= 180
            and -180 <= east <= 180
            and west != east
            and -MAX_LATITUDE <= south < north <= MAX_LATITUDE
        ):
            return west, south, east, north
    except ValueError:
        pass
    raise ApiError(422, "EXPLORATION_VIEWPORT_INVALID", "地图视口范围无效")


def cells(reads, owner, version, scope, code, year, viewport, zoom, layer):
    status, _, _, history = _read_grid(reads, owner, version, scope, code)
    grid = history.years.get(year) if history else None
    new = layer == "new"
    extents = (grid.new_bounds if new else grid.bounds) if grid else None
    if not extents:
        return dict(**version_fields(version, status), bounds=None, block_size=1, cells=[])
    west, south, east, north = extents
    bounds = (
        max(-180, degrees(west * GRID_SIZE / EARTH_RADIUS)),
        degrees(atan(sinh(south * GRID_SIZE / EARTH_RADIUS))),
        min(180, degrees((east + 1) * GRID_SIZE / EARTH_RADIUS)),
        degrees(atan(sinh((north + 1) * GRID_SIZE / EARTH_RADIUS))),
    )
    block = 16 if zoom < 8 else 4 if zoom < 11 else 1
    if viewport is None:
        with grid.lock:
            key = (layer, block)
            if key not in grid.overview:
                grid.overview[key] = _visible_cells(grid, extents, block, new)
            block, populated = grid.overview[key]
    else:
        bounds = None
        block, populated = _visible_cells(grid, _index_box(viewport), block, new)
    # Three bounded integers per feature keep the uncompressed envelope below 256 KiB.
    return dict(**version_fields(version, status), bounds=bounds, block_size=block, cells=populated)


def _visible_cells(grid, indices, block, new):
    west, south, east, north = indices
    columns = (
        [grid.columns(west, east)]
        if west <= east
        else [grid.columns(-MAX_GRID_INDEX, east), grid.columns(west, MAX_GRID_INDEX)]
    )
    while True:
        counts = Counter()
        for indices in columns:
            for index in indices:
                p = index * 3
                i, j, heat = grid.hits[p], grid.hits[p + 1], grid.hits[p + 2]
                if not south <= j <= north or (new and heat >= 0):
                    continue
                counts[i // block, j // block] += 1 if new or block > 1 else abs(heat)
                if len(counts) > MAX_FEATURES:
                    break
            if len(counts) > MAX_FEATURES:
                break
        if len(counts) <= MAX_FEATURES:
            return block, [(i, j, count) for (i, j), count in counts.items()]
        block *= 4
