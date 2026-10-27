from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

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


class PersonalBest(BaseModel):
    activity_id: UUID
    activity_date: date
    distance_m: Decimal
    duration_seconds: Decimal
    avg_pace_seconds_per_km: Decimal
    qualifying_count: int


class FirstRun(BaseModel):
    activity_id: UUID
    activity_date: date
    distance_m: Decimal
    duration_seconds: Decimal
    avg_pace_seconds_per_km: Decimal


class CategoryBest(BaseModel):
    category: Literal["5km", "10km"]
    best: PersonalBest | None
    first: FirstRun | None
    pace_gain_seconds_per_km: Decimal | None


class Totals(BaseModel):
    activity_count: int
    distance_m: Decimal
    activity_days: int
    avg_pace_seconds_per_km: Decimal | None
    first_activity_date: date | None


class MonthPoint(BaseModel):
    month_start: date
    activity_count: int
    distance_m: Decimal
    avg_pace_seconds_per_km: Decimal | None


class WeekPoint(BaseModel):
    week_start: date
    active_days: int


class WeekdayPoint(BaseModel):
    weekday: int
    activity_count: int


class YearDelta(BaseModel):
    activity_count: int
    distance_m: Decimal
    avg_pace_seconds_per_km: Decimal | None


class YearRow(BaseModel):
    year: int
    activity_count: int
    distance_m: Decimal
    activity_days: int
    avg_pace_seconds_per_km: Decimal | None
    is_partial: bool
    delta: YearDelta | None
    delta_basis: Literal["previous_year", "previous_year_same_period"] | None


class Records(BaseModel):
    personal_bests: list[CategoryBest]
    totals: Totals
    monthly: list[MonthPoint]
    weekly: list[WeekPoint]
    weekday: list[WeekdayPoint]
    yearly: list[YearRow]
    date_assignment: Literal["activity_local_date"] = "activity_local_date"
