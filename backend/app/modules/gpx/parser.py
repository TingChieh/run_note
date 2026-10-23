"""Bounded, offline GPX field extraction; no persistence or configuration imports."""

import math
import re
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException

from app.core.errors import ApiError
from app.modules.gpx.schema import ParsedGPX, Point

MAX_BYTES = 10 * 1024 * 1024
MAX_POINTS = 50000
MAX_SEGMENTS = 1000
TIME_PATTERN = re.compile(
    r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)


def number(text: str | None, limit: float | None = None) -> float | None:
    try:
        decimal = Decimal(text)
        value = float(decimal)
        if not math.isfinite(value) or (limit is not None and abs(decimal) > limit):
            return None
        return value
    except (ValueError, TypeError, OverflowError, InvalidOperation):
        return None


def timestamp(text: str | None) -> datetime | None:
    if text is None or not TIME_PATTERN.fullmatch(text.strip()):
        return None
    try:
        result = datetime.fromisoformat(text.strip().replace("Z", "+00:00")).astimezone(UTC)
        return result
    except (ValueError, OverflowError):
        return None


def parse_gpx(raw: bytes) -> ParsedGPX:
    if len(raw) > MAX_BYTES:
        raise ApiError(413, "GPX_TOO_LARGE", "GPX 文件超过大小限制")
    try:
        root = SafeET.fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (ET.ParseError, DefusedXmlException, ValueError):
        raise ApiError(400, "GPX_XML_INVALID", "GPX XML 不合法") from None
    version = root.get("version")
    namespaces = {
        "1.0": "http://www.topografix.com/GPX/1/0",
        "1.1": "http://www.topografix.com/GPX/1/1",
    }
    namespace = next((uri for uri in namespaces.values() if root.tag == f"{{{uri}}}gpx"), None)
    if version not in namespaces or namespace is None:
        raise ApiError(400, "GPX_XML_INVALID", "不支持的 GPX 根元素或版本")
    # Some exporters declare 1.0 while using 1.1 tags; the actual namespace is authoritative.
    ns = "{" + namespace + "}"
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
    tracks = []
    for ti, track in enumerate(root.findall(ns + "trk")):
        source_segments = []
        for si, segment in enumerate(track.findall(ns + "trkseg")):
            counts["input_segment_count"] += 1
            if counts["input_segment_count"] > MAX_SEGMENTS:
                raise ApiError(422, "GPX_LIMIT_EXCEEDED", "GPX 源段数超过限制")
            points = []
            source_points = segment.findall(ns + "trkpt")
            if not source_points:
                counts["empty_segment_count"] += 1
            for pi, element in enumerate(source_points):
                counts["input_point_count"] += 1
                if counts["input_point_count"] > MAX_POINTS:
                    raise ApiError(422, "GPX_LIMIT_EXCEEDED", "GPX 源点数超过限制")
                lon_text, lat_text = element.get("lon"), element.get("lat")
                lon, lat = number(lon_text, 180), number(lat_text, 90)
                if lon is None or lat is None:
                    counts["invalid_coordinate_count"] += 1
                    points.append(None)
                    continue
                time = timestamp(element.findtext(ns + "time"))
                elevation = number(element.findtext(ns + "ele"))
                counts["missing_time_count"] += time is None
                counts["missing_elevation_count"] += elevation is None
                points.append(Point(lon, lat, time, elevation, ti, si, pi, lon_text, lat_text))
            source_segments.append(points)
        tracks.append(source_segments)
    if counts["input_point_count"] == counts["invalid_coordinate_count"]:
        raise ApiError(422, "GPX_NO_VALID_POINTS", "GPX 不含有效轨迹点")
    return ParsedGPX(tracks, counts)
