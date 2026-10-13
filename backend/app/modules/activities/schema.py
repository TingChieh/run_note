from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class ActivityView(BaseModel):
    id: UUID
    title: str
    activity_date: date
    timezone: str
    started_at: datetime | None
    ended_at: datetime | None
    distance_m: Decimal
    elapsed_seconds: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    temporal_quality: str
    quality_summary: dict[str, Any]
    metrics_version: str
    visibility: str
    allow_shared_route: bool
    has_route: bool
    created_at: datetime


class ActivityList(BaseModel):
    items: list[ActivityView]
    total: int
    limit: int
    offset: int


class ImportView(BaseModel):
    activity: ActivityView
    import_id: UUID
    warnings: list[str]
    point_count: int
    segment_count: int
    metrics_version: str
