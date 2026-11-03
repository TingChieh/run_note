from datetime import date
from uuid import UUID

from pydantic import BaseModel


class Participant(BaseModel):
    user_id: UUID
    avatar_version: str | None
    username: str
    display_name: str
    distance_m: float
    count: int
    week_m: float
    month_m: float
    year_m: float


class Recent(BaseModel):
    id: UUID
    username: str
    display_name: str
    title: str
    category: str
    tags: list[str]
    temporal_quality: str
    activity_date: date
    distance_m: float
    avg_pace_seconds_per_km: float | None
    elapsed_seconds: float | None
    timer_seconds: float | None
    avg_heart_rate_bpm: int | None
    geometry: list[dict]


class Track(BaseModel):
    username: str
    activity_id: UUID
    title: str
    activity_date: date
    segment_index: int
    geometry: dict


class FeedPage(BaseModel):
    items: list[Recent]
    next_cursor: str | None


class TogetherView(BaseModel):
    distance_m: float
    count: int
    participants: list[Participant]
    recent: list[Recent]
    tracks: list[Track]
    next_cursor: str | None
    tracks_truncated: bool
