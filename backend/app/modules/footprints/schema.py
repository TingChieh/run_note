from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class AllFootprintCollection(BaseModel):
    scope: Literal["all"]
    type: Literal["FeatureCollection"]
    mode: Literal["tracks", "heatmap"]
    features: list[dict[str, Any]]
    activity_count: int = Field(ge=0)
    visible_activity_count: int = Field(ge=0)
    unsupported_segment_count: int = Field(ge=0)
    grid_size_m: Literal[100]
    grid_crs: Literal["EPSG:3857"]
    count_basis: Literal["distinct_activity_per_cell"]
    max_count: int = Field(ge=0)


class AllFootprintView(BaseModel):
    status: Literal["pending", "ready", "failed"]
    generated_at: datetime | None
    refreshing: bool
    refresh_failed: bool
    result: AllFootprintCollection | None
