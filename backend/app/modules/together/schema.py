from datetime import date
from uuid import UUID

from pydantic import BaseModel


class Participant(BaseModel):
    username: str
    display_name: str
    distance_m: float
    count: int
    week_m: float
    month_m: float


class Recent(BaseModel):
    id: UUID
    username: str
    display_name: str
    title: str
    activity_date: date
    distance_m: float


class Track(BaseModel):
    username: str
    activity_id: UUID
    title: str
    activity_date: date
    segment_index: int
    geometry: dict


class TogetherView(BaseModel):
    distance_m: float
    count: int
    participants: list[Participant]
    recent: list[Recent]
    tracks: list[Track]
