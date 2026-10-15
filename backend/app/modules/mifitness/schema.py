"""Strict, numeric-only allowlist for a single prepared Mi Fitness running record."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, model_validator

from app.modules.users.schema import StrictInput


class SourceMetrics(StrictInput):
    distance: int | float
    duration: int | float
    start_time: int
    end_time: int
    calories: int | float | None = None
    steps: int | float | None = None
    avg_hrm: int | float | None = None
    max_hrm: int | float | None = None
    min_hrm: int | float | None = None
    avg_cadence: int | float | None = None
    max_cadence: int | float | None = None
    vo2_max: int | float | None = None
    train_load: int | float | None = None
    train_effect: int | float | None = None
    anaerobic_train_effect: int | float | None = None
    avg_stride: int | float | None = None
    recover_time: int | float | None = None
    avg_speed: int | float | None = None
    max_speed: int | float | None = None
    avg_pace: int | float | None = None
    timezone: int | float | None = None
    hrm_aerobic_duration: int | float | None = None
    hrm_anaerobic_duration: int | float | None = None
    hrm_extreme_duration: int | float | None = None
    hrm_fat_burning_duration: int | float | None = None
    hrm_warm_up_duration: int | float | None = None

    @model_validator(mode="after")
    def validate_required_metrics(self):
        for value in (self.distance, self.duration):
            number = Decimal(str(value))
            if not number.is_finite() or not 0 <= number < 1_000_000_000:
                raise ValueError("Finite nonnegative distance and duration required")
        try:
            datetime.fromtimestamp(self.start_time, UTC)
            datetime.fromtimestamp(self.end_time, UTC)
        except (ValueError, OverflowError, OSError):
            raise ValueError("Valid UTC epoch seconds required") from None
        if self.end_time < self.start_time:
            raise ValueError("End time must not precede start time")
        if self.end_time - self.start_time >= 1_000_000_000:
            raise ValueError("Elapsed time outside supported range")
        return self


class MifitnessRecord(StrictInput):
    source_time: int
    source_metrics: SourceMetrics

    @model_validator(mode="after")
    def validate_source_time(self):
        if self.source_time != self.source_metrics.start_time:
            raise ValueError("Source time must match device start time")
        return self


class MifitnessPreview(BaseModel):
    activity_date: date
    timezone: str
    started_at: datetime
    ended_at: datetime
    distance_m: Decimal
    timer_seconds: Decimal
    elapsed_seconds: Decimal
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
    has_route: bool
    point_count: int
    segment_count: int
    warnings: list[str]
    suspected_activity_ids: list[UUID]
