from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.responses import ExactView, LonLat
from app.modules.users.schema import StrictInput

# The same sets as the activities table's CHECK constraints.
TemporalQuality = Literal["complete", "incomplete", "invalid", "manual"]
Visibility = Literal["private", "unlisted", "public"]


class ActivityView(BaseModel):
    id: UUID
    title: str
    notes: str = ""
    category: str = ""
    tags: list[str] = Field(default_factory=list)
    activity_date: date
    timezone: str
    started_at: datetime | None
    ended_at: datetime | None
    distance_m: Decimal
    elapsed_seconds: Decimal | None
    timer_seconds: Decimal | None = None
    calories_kcal: int | None = None
    steps: int | None = None
    avg_heart_rate_bpm: int | None = None
    max_heart_rate_bpm: int | None = None
    min_heart_rate_bpm: int | None = None
    avg_cadence_spm: Decimal | None = None
    max_cadence_spm: Decimal | None = None
    vo2_max_ml_kg_min: Decimal | None = None
    training_load: Decimal | None = None
    aerobic_training_effect: Decimal | None = None
    anaerobic_training_effect: Decimal | None = None
    avg_pace_seconds_per_km: Decimal | None
    temporal_quality: TemporalQuality
    quality_summary: dict[str, Any]
    metrics_version: str
    visibility: Visibility
    allow_shared_route: bool
    has_route: bool
    created_at: datetime


class ActivityList(BaseModel):
    items: list[ActivityView]
    total: int
    limit: int
    offset: int


class ActivityUpdate(StrictInput):
    title: str = Field(default=None, min_length=1, max_length=120)
    notes: str = Field(default=None, max_length=5000)
    visibility: Visibility = None
    category: str = Field(default=None, max_length=30)
    tags: list[Annotated[str, Field(min_length=1, max_length=30)]] = Field(
        default=None, max_length=10
    )

    @field_validator("category", mode="before")
    @classmethod
    def trim_category(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("tags", mode="before")
    @classmethod
    def trim_tags(cls, value):
        if isinstance(value, list):
            return [item.strip() if isinstance(item, str) else item for item in value]
        return value

    @field_validator("tags")
    @classmethod
    def unique_tags(cls, value):
        return list(dict.fromkeys(value))

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        return self


class ImportView(BaseModel):
    activity: ActivityView
    import_id: UUID
    warnings: list[str]
    point_count: int
    segment_count: int
    metrics_version: str


class ActivityBatchDelete(StrictInput):
    ids: list[Annotated[UUID, Field(strict=False)]] = Field(min_length=1, max_length=100)

    @field_validator("ids")
    @classmethod
    def unique_ids(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Activity ids must be unique")
        return value


class ActivityDeleted(ExactView):
    deleted: Literal[True]


class ActivitiesDeleted(ExactView):
    deleted: Literal[True]
    deleted_count: int


class LineStringGeometry(ExactView):
    type: Literal["LineString"]
    coordinates: list[LonLat]


class PointGeometry(ExactView):
    type: Literal["Point"]
    coordinates: LonLat


class RouteSegment(ExactView):
    segment_index: int
    point_count: int


class RouteFeature(ExactView):
    type: Literal["Feature"]
    geometry: LineStringGeometry | PointGeometry
    properties: RouteSegment


class RouteView(ExactView):
    type: Literal["FeatureCollection"]
    features: list[RouteFeature]
    start: LonLat | None
    end: LonLat | None


class ReplaySegment(ExactView):
    segment_index: int
    coordinates: list[LonLat]
    elapsed_s: list[float]
    moving_s: list[float]
    distance_m: list[float]
    pace_s_per_km: list[float | None] | None


class ReplayView(ExactView):
    mode: Literal["real", "simulated"]
    point_count: int
    interpolated_point_count: int
    distance_m: float
    elapsed_seconds: float
    moving_seconds: float
    segments: list[ReplaySegment]
