"""Replay timeline derived from stored track points; stored activity data is never rewritten."""

from dataclasses import dataclass
from datetime import datetime

# A trailing window long enough that one noisy fix cannot swing the shown pace.
PACE_WINDOW_SECONDS = 30.0
PACE_MIN_SPAN_SECONDS = 5.0
# Below this speed an interval counts as standing still (GPS jitter while paused).
STATIONARY_SPEED_MPS = 0.5
SIMULATED_PACE_SECONDS_PER_KM = 360.0
# With fewer timestamps than this share, interpolation would invent most of the rhythm.
MIN_TIMED_SHARE = 0.5


@dataclass(frozen=True)
class ReplayPoint:
    lon: float
    lat: float
    time: datetime | None
    # Geodesic length of the edge ending at this point; ignored at a segment start.
    edge_m: float


def _cumulative(points: list[ReplayPoint]) -> list[float]:
    total, result = 0.0, []
    for index, point in enumerate(points):
        if index:
            total += point.edge_m
        result.append(total)
    return result


def recorded_seconds(segments: list[list[ReplayPoint]]) -> tuple[list[list[float]] | None, int]:
    """Seconds since the first timestamp for every point, filling gaps along the track.

    Returns None when the timestamps cannot drive a real replay: too few, all equal, or going
    backwards anywhere in route order (segments split at a reversal are still out of order).
    Missing times between two recorded points are spread by distance; a run without a recorded
    point on one side holds the nearest recorded time instead of inventing a speed.
    """
    points = [p for segment in segments for p in segment]
    timed = [p.time for p in points if p.time is not None]
    if len(timed) < 2 or len(timed) < len(points) * MIN_TIMED_SHARE or timed[-1] == timed[0]:
        return None, 0
    if any(b < a for a, b in zip(timed, timed[1:], strict=False)):
        return None, 0
    origin, filled, result = timed[0], 0, []
    for segment in segments:
        seconds = [None if p.time is None else (p.time - origin).total_seconds() for p in segment]
        anchors = [i for i, value in enumerate(seconds) if value is not None]
        if not anchors:
            return None, 0
        filled += len(segment) - len(anchors)
        distance = _cumulative(segment)
        for i in range(anchors[0]):
            seconds[i] = seconds[anchors[0]]
        for i in range(anchors[-1] + 1, len(segment)):
            seconds[i] = seconds[anchors[-1]]
        for a, b in zip(anchors, anchors[1:], strict=False):
            span_d, span_t = distance[b] - distance[a], seconds[b] - seconds[a]
            for i in range(a + 1, b):
                share = (distance[i] - distance[a]) / span_d if span_d > 0 else (i - a) / (b - a)
                seconds[i] = seconds[a] + span_t * share
        result.append(seconds)
    return result, filled


def smoothed_pace(elapsed: list[float], distance: list[float]) -> list[float | None]:
    """Seconds per km over the latest window of at least PACE_WINDOW_SECONDS within one segment."""
    result: list[float | None] = []
    start = 0
    for i in range(len(elapsed)):
        while start + 1 < i and elapsed[i] - elapsed[start + 1] >= PACE_WINDOW_SECONDS:
            start += 1
        span, moved = elapsed[i] - elapsed[start], distance[i] - distance[start]
        if span < PACE_MIN_SPAN_SECONDS or moved <= 0 or moved < span * STATIONARY_SPEED_MPS:
            result.append(None)
        else:
            result.append(round(1000 * span / moved, 1))
    return result


def build_replay(
    segments: list[tuple[int, list[ReplayPoint]]], fallback_pace: float | None = None
) -> dict:
    """Columnar per-segment arrays for the replay player.

    "real" follows recorded time. "simulated" moves at a steady pace (the activity's average when
    known) because the timestamps cannot be trusted, and then reports no pace at all. Segment
    boundaries are where the import split the track at gaps or jumps: elapsed time keeps running
    across them, moving time and distance do not.
    """
    segments = [(index, points) for index, points in segments if points]
    times, interpolated = recorded_seconds([points for _, points in segments])
    real = times is not None
    seconds_per_m = (fallback_pace or SIMULATED_PACE_SECONDS_PER_KM) / 1000
    output, total, moving, last = [], 0.0, 0.0, 0.0
    for position, (index, points) in enumerate(segments):
        distance = [total + value for value in _cumulative(points)]
        total = distance[-1]
        elapsed = times[position] if real else [value * seconds_per_m for value in distance]
        moving_s = []
        for k, point in enumerate(points):
            dt = elapsed[k] - elapsed[k - 1] if k else 0.0
            if dt > 0 and point.edge_m / dt >= STATIONARY_SPEED_MPS:
                moving += dt
            moving_s.append(round(moving, 3))
        last = elapsed[-1]
        output.append(
            {
                "segment_index": index,
                "coordinates": [(round(p.lon, 7), round(p.lat, 7)) for p in points],
                "elapsed_s": [round(value, 3) for value in elapsed],
                "moving_s": moving_s,
                "distance_m": [round(value, 2) for value in distance],
                "pace_s_per_km": smoothed_pace(elapsed, distance) if real else None,
            }
        )
    return {
        "mode": "real" if real else "simulated",
        "point_count": sum(len(points) for _, points in segments),
        "interpolated_point_count": interpolated,
        "distance_m": round(total, 2),
        "elapsed_seconds": round(last, 3),
        "moving_seconds": round(moving, 3),
        "segments": output,
    }
