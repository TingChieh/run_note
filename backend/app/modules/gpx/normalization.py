from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.errors import ApiError
from app.modules.gpx.metrics import round_metric
from app.modules.gpx.schema import Derived, ParsedGPX, Point, Segment


def source_points(parsed: ParsedGPX) -> list[Point]:
    return [p for t in parsed.tracks for s in t for p in s if p is not None]


def same_position(a: Point, b: Point) -> bool:
    """Geographic identity, without quantizing or rewriting source coordinates."""
    return a.lat == b.lat and (a.lon == b.lon or abs(a.lon - b.lon) == 360 or abs(a.lat) == 90)


def temporal_quality(points: list[Point]) -> str:
    incomplete = False
    previous = None
    for point in points:
        if point.time is None:
            incomplete = True
            continue
        if previous is not None:
            if point.time < previous.time or (
                point.time == previous.time and not same_position(point, previous)
            ):
                return "invalid"
        previous = point
    return "incomplete" if incomplete else "complete"


def prepare_segments(parsed: ParsedGPX) -> list[Segment]:
    result = []
    for track in parsed.tracks:
        for source in track:
            current = []
            reason = "source_boundary"
            for point in source:
                if point is None:
                    if current:
                        result.append(Segment(current, reason))
                    current = []
                    reason = "invalid_coordinate"
                    continue
                if current:
                    last = current[-1]
                    if (
                        point.time is not None
                        and point.time == last.time
                        and point.lon == last.lon
                        and point.lat == last.lat
                        and point.elevation == last.elevation
                    ):
                        continue
                current.append(point)
            if current:
                result.append(Segment(current, reason))
    return result


def derive(
    parsed: ParsedGPX,
    segments: list[Segment],
    edge_distances: list[list[float]],
    timezone: str,
    activity_date: date | None,
) -> Derived:
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise ApiError(422, "VALIDATION_ERROR", "时区不合法") from None
    points = source_points(parsed)
    quality = temporal_quality(points)
    started, ended = points[0].time, points[-1].time if quality != "invalid" else None
    inferred = started.astimezone(zone).date() if started is not None else None
    if activity_date is not None and not 1900 <= activity_date.year <= 2100:
        raise ApiError(422, "VALIDATION_ERROR", "活动日期不合法")
    if inferred is not None and not 1900 <= inferred.year <= 2100:
        raise ApiError(422, "VALIDATION_ERROR", "活动日期不合法")
    if inferred is not None and activity_date is not None and inferred != activity_date:
        raise ApiError(422, "ACTIVITY_DATE_CONFLICT", "活动日期与开始时间冲突")
    if inferred is None and activity_date is None:
        raise ApiError(422, "ACTIVITY_DATE_REQUIRED", "请补录活动日期")
    counts = dict(parsed.counts)
    counts["deduplicated_point_count"] = len(points) - sum(len(s.points) for s in segments)
    for key in (
        "time_reversal_count",
        "zero_time_movement_count",
        "time_gap_count",
        "speed_jump_count",
    ):
        counts[key] = 0
    final = []
    if len(edge_distances) != len(segments):
        raise ValueError("Edge distances must align with segments")
    for segment, distances in zip(segments, edge_distances, strict=True):
        if len(distances) != len(segment.points) - 1:
            raise ValueError("Edge distances must align with points")
        current = [segment.points[0]]
        reason = segment.break_reason
        for a, b, distance in zip(segment.points, segment.points[1:], distances, strict=False):
            d = Decimal(str(distance))
            if not d.is_finite() or d < 0:
                raise ApiError(422, "GPX_METRIC_INVALID", "距离不合法")
            rejection = None
            if a.time is not None and b.time is not None:
                dt = Decimal(str((b.time - a.time).total_seconds()))
                if dt < 0:
                    rejection = "time_reversal"
                elif dt == 0 and d > 0:
                    rejection = "zero_time_movement"
                elif dt > 300:
                    rejection = "time_gap"
                elif dt > 0 and d / dt > 12:
                    rejection = "speed_jump"
            if rejection:
                counts[rejection + "_count"] += 1
                final.append(Segment(current, reason))
                current = []
                reason = rejection
            current.append(b)
        final.append(Segment(current, reason))
    counts["valid_point_count"] = sum(len(s.points) for s in final)
    counts["derived_segment_count"] = len(final)
    warnings = []
    codes = {
        "invalid_coordinate_count": "INVALID_COORDINATE",
        "missing_time_count": "SPEED_CHECK_UNAVAILABLE",
        "missing_elevation_count": "ELEVATION_UNAVAILABLE",
        "time_gap_count": "TIME_GAP",
        "speed_jump_count": "SPEED_JUMP",
        "empty_segment_count": "EMPTY_SEGMENT",
    }
    warnings.extend(code for key, code in codes.items() if counts[key])
    if quality == "invalid":
        warnings.append("TIME_INVALID")
    if quality == "incomplete":
        warnings.append("TIME_INCOMPLETE")
    counts["warnings"] = warnings
    elapsed = (
        round_metric(Decimal(str((ended - started).total_seconds())))
        if quality == "complete"
        else None
    )
    return Derived(
        final,
        counts,
        quality,
        started,
        ended,
        inferred or activity_date,
        "timestamp" if inferred is not None else "manual",
        elapsed,
    )
