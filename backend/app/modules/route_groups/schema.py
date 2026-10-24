from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class RouteGroupItem(BaseModel):
    id: UUID
    run_count: int = Field(ge=2)
    first_date: date
    last_date: date
    median_distance_m: Decimal
    best_duration_seconds: Decimal | None
    avg_duration_seconds: Decimal | None
    best_pace_seconds_per_km: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    # Lines of [lon, lat] pairs, simplified; used for thumbnails and the detail map.
    shape: list[list[list[float]]]


class RouteGroupList(BaseModel):
    items: list[RouteGroupItem]
    total: int = Field(ge=0)
    limit: int
    offset: int
    building: bool


class RouteRun(BaseModel):
    activity_id: UUID
    title: str
    activity_date: date
    distance_m: Decimal
    duration_seconds: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    coverage: float = Field(ge=0, le=1)


class RouteGroupDetail(RouteGroupItem):
    runs: list[RouteRun]
