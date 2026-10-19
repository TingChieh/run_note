"""Independent allowlists for the explicitly public single-owner site."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.ai_reports.schema import AnalysisText
from app.modules.statistics.schema import Bucket, Summary


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
    temporal_quality: str
    metrics_version: str
    has_route: bool
    created_at: datetime


class ShowcaseActivityList(BaseModel):
    items: list[ShowcaseActivity]
    total: int
    limit: int
    offset: int


class DeviceSummary(BaseModel):
    heart_rate_record_count: int
    heart_rate_weighted_count: int
    heart_rate_weighted_duration_seconds: Decimal | None
    avg_heart_rate_bpm: Decimal | None
    calories_record_count: int
    calories_kcal: int | None
    steps_record_count: int
    steps: int | None


class SnapshotWeek(Bucket):
    distance_change_pct: Decimal | None
    device_metrics: DeviceSummary | None = None


class ShowcaseSnapshot(BaseModel):
    schema_version: Literal["running-summary-v1", "running-summary-v2"]
    date_from: date
    date_to: date
    summary: Summary
    weeks: list[SnapshotWeek]
    device_metrics: DeviceSummary | None = None
    average_runs_per_week: Decimal
    evidence_limited: bool
    limitations: list[str]


class ShowcaseReport(BaseModel):
    id: UUID
    date_from: date
    date_to: date
    stats_snapshot: ShowcaseSnapshot
    analysis: AnalysisText
    created_at: datetime
    finished_at: datetime | None
    is_stale: bool


class ShowcaseReportList(BaseModel):
    items: list[ShowcaseReport]
    total: int
    limit: int
    offset: int
