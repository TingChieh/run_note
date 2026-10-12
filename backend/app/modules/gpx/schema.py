from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal


@dataclass(frozen=True)
class Point:
    lon: float
    lat: float
    time: datetime | None
    elevation: float | None
    track_index: int
    segment_index: int
    source_index: int
    lon_text: str
    lat_text: str


@dataclass
class ParsedGPX:
    tracks: list[list[list[Point | None]]]
    counts: dict[str, int]


@dataclass
class Segment:
    points: list[Point]
    break_reason: str


@dataclass
class Derived:
    segments: list[Segment]
    quality_summary: dict
    temporal_quality: str
    started_at: datetime | None
    ended_at: datetime | None
    activity_date: date
    date_source: str
    elapsed_seconds: Decimal | None
