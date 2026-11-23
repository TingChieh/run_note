"""Independent allowlists for the explicitly public single-owner site."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.activities.schema import TemporalQuality


class ShowcaseProfile(BaseModel):
    display_name: str
    timezone: str
    avatar_url: str | None = None


class ShowcaseActivity(BaseModel):
    id: UUID
    title: str
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
    metrics_version: str
    has_route: bool
    created_at: datetime


class ShowcaseActivityList(BaseModel):
    items: list[ShowcaseActivity]
    total: int
    limit: int
    offset: int
