from datetime import date
from typing import Literal

from app.core.responses import ExactView

Scope = Literal["global", "region", "city"]
Layer = Literal["heatmap", "new"]
Status = Literal["ready", "pending", "failed"]


class ExplorationPlace(ExactView):
    code: str
    name: str
    region_name: str | None
    kind: Literal["boundary", "nearby"]
    first_date: date
    last_date: date
    activity_count: int
    distance_m: float | None


class ExplorationMarker(ExactView):
    code: str
    name: str
    short_name: str
    region_code: str
    region_name: str | None
    country_code: str
    kind: Literal["boundary", "nearby"]
    lon: float
    lat: float
    bounds: tuple[float, float, float, float] | None
    activity_count: int
    distance_m: float | None
    first_date: date
    last_date: date
    is_new_in_year: bool


class ExplorationRegion(ExactView):
    code: str
    name: str


class ExplorationVersion(ExactView):
    source_version: int
    atlas_version: str
    status: Status


class ExplorationMarkersResponse(ExplorationVersion):
    year: int | None
    items: list[ExplorationMarker]
    regions: list[ExplorationRegion]
    activity_count: int | None
    boundary_count: int | None
    nearby_count: int | None


class ExplorationCatalog(ExplorationVersion):
    items: list[ExplorationPlace]
    total: int
    limit: int
    offset: int
    regions: list[ExplorationRegion]
    activity_count: int | None
    boundary_count: int | None
    nearby_count: int | None
    no_track_count: int | None
    unmatched_count: int | None
    distance_m: float | None
    unallocated_m: float | None


class ExplorationMonth(ExactView):
    month: int
    new_cells: int | None
    cumulative_cells: int | None


class ExplorationDetail(ExplorationVersion):
    scope: Scope
    code: str
    name: str
    year: int
    first_year: int | None
    city: ExplorationPlace | None
    months: list[ExplorationMonth]
    new_cells: int | None
    cumulative_cells: int | None


class ExplorationCells(ExplorationVersion):
    # West, south, east and north of this year's populated grid at its native resolution.
    bounds: tuple[float, float, float, float] | None
    block_size: int
    # Fixed-origin column, row and value. Blocks count distinct 100 m cells.
    cells: list[tuple[int, int, int]]
