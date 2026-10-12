from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class Summary(BaseModel):
    activity_count: int
    distance_m: Decimal
    activity_days: int
    duration_sum_seconds: Decimal | None
    known_duration_count: int
    missing_duration_count: int
    pace_eligible_count: int
    pace_eligible_distance_m: Decimal
    avg_pace_seconds_per_km: Decimal | None
    quality_warning_count: int
    date_assignment: Literal["activity_local_date"] = "activity_local_date"


class CalendarDay(BaseModel):
    date: date
    activity_count: int
    distance_m: Decimal
    duration_sum_seconds: Decimal | None
    known_duration_count: int
    missing_duration_count: int


class Calendar(BaseModel):
    year: int
    metric: Literal["distance", "count"]
    days: list[CalendarDay]
    activity_count: int
    distance_m: Decimal
    date_assignment: Literal["activity_local_date"] = "activity_local_date"


class Bucket(Summary):
    bucket_start: date
    bucket_end: date
    is_partial: bool


class Trends(BaseModel):
    period: Literal["week", "month", "year"]
    date_from: date
    date_to: date
    buckets: list[Bucket]
    date_assignment: Literal["activity_local_date"] = "activity_local_date"
    week_start: Literal["monday"] = "monday"
