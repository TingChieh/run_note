"""Typed private response schemas for GET /api/v1/statistics/annual-story."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from app.core.responses import ExactView, LonLat
from app.modules.statistics.schema import Summary

StoryMilestone = Literal["first", "longest", "best", "new_city", "frequent"]


class StoryRunHighlight(ExactView):
    activity_id: UUID
    activity_date: date
    timezone: str
    started_at: datetime | None
    title: str
    distance_m: Decimal
    duration_seconds: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    city_name: str | None
    shoe_name: str | None
    has_track: bool
    shape: list[list[LonLat]]


class StoryLongestHighlight(StoryRunHighlight):
    tied_count: int
    same_as_first: bool


class StoryCategoryBest(ExactView):
    category: str
    activity_id: UUID
    activity_date: date
    distance_m: Decimal
    duration_seconds: Decimal
    avg_pace_seconds_per_km: Decimal


class StoryBestHighlight(ExactView):
    basis: Literal["standard_band", "fastest_run", "distance_fallback"]
    category: str
    activity_id: UUID
    activity_date: date
    timezone: str
    started_at: datetime | None
    title: str
    distance_m: Decimal
    duration_seconds: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    city_name: str | None
    has_track: bool
    shape: list[list[LonLat]]
    is_all_time_pb: bool
    pace_gain_seconds_per_km: Decimal | None
    other_bests: list[StoryCategoryBest]


class StoryCityItem(ExactView):
    code: str
    name: str
    region_name: str | None
    is_new: bool
    first_date: date
    last_date: date
    activity_count: int
    distance_m: Decimal
    lon: float
    lat: float


class StoryCitiesSection(ExactView):
    status: Literal["ready", "pending"]
    total_cities: int
    new_cities_count: int
    total_regions: int
    located_activity_count: int
    unlocated_activity_count: int
    pending_activity_count: int
    items: list[StoryCityItem]


class StoryFrequentRouteSection(ExactView):
    status: Literal["ready", "building", "none"]
    group_id: UUID | None
    name: str | None
    city_name: str | None
    run_count: int
    share_pct: int
    median_distance_m: Decimal | None
    first_date: date | None
    last_date: date | None
    first_pace_seconds_per_km: Decimal | None
    best_pace_seconds_per_km: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    pace_improvement_seconds_per_km: Decimal | None
    monthly_hits: list[int]
    shape: list[list[LonLat]]
    overlay_shapes: list[list[list[LonLat]]]


class StoryTimelineItem(ExactView):
    activity_id: UUID
    activity_date: date
    month: int
    title: str
    distance_m: Decimal
    cumulative_distance_m: Decimal
    avg_pace_seconds_per_km: Decimal | None
    city_code: str | None
    city_name: str | None
    milestone: StoryMilestone | None
    points: list[LonLat]


class StoryFootprintTimeline(ExactView):
    has_tracks: bool
    truncated: bool
    total_runs: int
    shown_runs: int
    monthly_distance_m: list[Decimal]
    monthly_activity_count: list[int]
    items: list[StoryTimelineItem]


class AnnualStory(ExactView):
    year: int
    date_from: date
    date_to: date
    is_partial: bool
    cutoff_date: date | None
    today: date
    date_assignment: Literal["activity_local_date"] = "activity_local_date"
    summary: Summary
    longest_streak_days: int
    longest_streak_weeks: int
    first_run: StoryRunHighlight | None
    longest_route: StoryLongestHighlight | None
    best_performance: StoryBestHighlight | None
    explored_cities: StoryCitiesSection
    frequent_route: StoryFrequentRouteSection
    footprint_timeline: StoryFootprintTimeline
