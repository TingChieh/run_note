"""Offline TCX v2 extraction; device totals remain separate from route geometry."""

from datetime import UTC, datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException

from app.core.errors import ApiError
from app.modules.gpx.parser import MAX_BYTES, MAX_POINTS, MAX_SEGMENTS, number, timestamp
from app.modules.gpx.schema import Point
from app.modules.tcx.schema import ParsedTCX

NS = "{http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2}"


def summary_number(element, path, *, integer=False, heart_rate=False):
    matches = element.findall("/".join(NS + p for p in path.split("/")))
    if not matches:
        return None
    try:
        value = Decimal(matches[0].text.strip())
        if len(matches) != 1 or not value.is_finite() or not 0 <= value < 1000000000:
            raise ValueError
        if not integer and 0 < value < Decimal("0.001"):
            raise ValueError
        if integer and value != value.to_integral_value():
            raise ValueError
        if heart_rate and not 1 <= value <= 300:
            raise ValueError
        return int(value) if integer else value
    except (InvalidOperation, ValueError, AttributeError):
        raise ApiError(422, "TCX_SUMMARY_INVALID", "TCX 设备汇总指标不合法") from None


def interpreted_time(text, zone, mode):
    value = timestamp(text)
    if value is None or mode == "absolute":
        return value
    # Local mode intentionally discards the written offset, never its wall-clock digits.
    naive = datetime.fromisoformat(text.strip().replace("Z", "+00:00")).replace(tzinfo=None)
    instants = {
        aware.astimezone(UTC)
        for fold in (0, 1)
        if (aware := naive.replace(tzinfo=zone, fold=fold))
        .astimezone(UTC)
        .astimezone(zone)
        .replace(tzinfo=None)
        == naive
    }
    if len(instants) != 1:
        raise ApiError(
            422, "TCX_LOCAL_TIME_INVALID", "当地时间存在夏令时歧义或不存在，请使用文件时区"
        )
    return instants.pop()


def parse_tcx(raw: bytes, timezone="UTC", time_mode="absolute") -> ParsedTCX:
    if len(raw) > MAX_BYTES:
        raise ApiError(413, "TCX_TOO_LARGE", "TCX 文件超过大小限制")
    if time_mode not in {"absolute", "local"}:
        raise ApiError(422, "VALIDATION_ERROR", "时间解释方式不合法")
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise ApiError(422, "VALIDATION_ERROR", "时区不合法") from None
    try:
        root = SafeET.fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (ET.ParseError, DefusedXmlException, ValueError):
        raise ApiError(400, "TCX_XML_INVALID", "TCX XML 不合法") from None
    if root.tag != NS + "TrainingCenterDatabase":
        raise ApiError(400, "TCX_XML_INVALID", "仅支持 TCX v2 训练记录")
    activities = root.findall(NS + "Activities/" + NS + "Activity")
    if len(activities) != 1:
        raise ApiError(422, "TCX_MULTIPLE_ACTIVITIES", "请选择只包含一次活动的 TCX 文件")
    activity = activities[0]
    if activity.get("Sport", "") not in {"", "Running"}:
        raise ApiError(422, "TCX_SPORT_UNSUPPORTED", "当前仅支持跑步 TCX 记录")
    laps = activity.findall(NS + "Lap")
    if len(laps) > MAX_SEGMENTS:
        raise ApiError(422, "TCX_LIMIT_EXCEEDED", "TCX 分圈数超过限制")
    counts = dict.fromkeys(
        (
            "input_point_count",
            "input_segment_count",
            "empty_segment_count",
            "invalid_coordinate_count",
            "missing_time_count",
            "missing_elevation_count",
        ),
        0,
    )
    summaries, segments = [], []
    for lap in laps:
        hr = summary_number(lap, "AverageHeartRateBpm/Value", integer=True, heart_rate=True)
        if hr is None and root.get("creator") == "Mi Fitness":
            hr = summary_number(lap, "HeartRateBpm", integer=True, heart_rate=True)
        summaries.append(
            dict(
                distance_m=summary_number(lap, "DistanceMeters"),
                timer_seconds=summary_number(lap, "TotalTimeSeconds"),
                calories_kcal=summary_number(lap, "Calories", integer=True),
                avg_heart_rate_bpm=hr,
                steps=summary_number(lap, "Steps", integer=True),
            )
        )
        for track in lap.findall(NS + "Track"):
            si = counts["input_segment_count"]
            counts["input_segment_count"] += 1
            if counts["input_segment_count"] > MAX_SEGMENTS:
                raise ApiError(422, "TCX_LIMIT_EXCEEDED", "TCX 源段数超过限制")
            points = []
            for pi, point in enumerate(track.findall(NS + "Trackpoint")):
                counts["input_point_count"] += 1
                if counts["input_point_count"] > MAX_POINTS:
                    raise ApiError(422, "TCX_LIMIT_EXCEEDED", "TCX 源点数超过限制")
                lat_text = point.findtext(NS + "Position/" + NS + "LatitudeDegrees")
                lon_text = point.findtext(NS + "Position/" + NS + "LongitudeDegrees")
                lat, lon = number(lat_text, 90), number(lon_text, 180)
                if lat is None or lon is None:
                    counts["invalid_coordinate_count"] += 1
                    points.append(None)
                    continue
                time = interpreted_time(point.findtext(NS + "Time"), zone, time_mode)
                elevation = number(point.findtext(NS + "AltitudeMeters"))
                counts["missing_time_count"] += time is None
                counts["missing_elevation_count"] += elevation is None
                points.append(Point(lon, lat, time, elevation, 0, si, pi, lon_text, lat_text))
            if not points:
                counts["empty_segment_count"] += 1
            segments.append(points)
    if counts["input_point_count"] == counts["invalid_coordinate_count"]:
        raise ApiError(422, "TCX_NO_VALID_POINTS", "TCX 不含有效 GPS 轨迹，请使用户外跑步记录")
    summary = {}
    for key in ("distance_m", "timer_seconds", "calories_kcal", "steps"):
        values = [s[key] for s in summaries]
        total = sum(values) if values and all(v is not None for v in values) else None
        if total is not None and total >= 1000000000:
            raise ApiError(422, "TCX_SUMMARY_INVALID", "TCX 设备汇总指标超出范围")
        summary[key] = total
    complete_hr = summaries and all(
        s["avg_heart_rate_bpm"] is not None
        and s["timer_seconds"] is not None
        and s["timer_seconds"] > 0
        for s in summaries
    )
    summary["avg_heart_rate_bpm"] = (
        int(
            (
                sum(s["avg_heart_rate_bpm"] * s["timer_seconds"] for s in summaries)
                / summary["timer_seconds"]
            ).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
        )
        if complete_hr
        else None
    )
    # One reported lap mean is already the activity mean; no timer weighting is needed.
    if len(summaries) == 1:
        summary["avg_heart_rate_bpm"] = summaries[0]["avg_heart_rate_bpm"]
    return ParsedTCX([segments], counts, summary)
