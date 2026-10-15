"""Bounded namespace adapter for the identified Mi Fitness GPX 1.1 export."""

from xml.etree import ElementTree as ET

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException

from app.core.errors import ApiError
from app.modules.gpx import parser as gpx_parser
from app.modules.gpx.schema import ParsedGPX

PARSER_VERSION = "mifitness-gpx-v1"
GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1"


def parse_mifitness_gpx(raw: bytes) -> ParsedGPX:
    if len(raw) > gpx_parser.MAX_BYTES:
        raise ApiError(413, "GPX_TOO_LARGE", "GPX 文件超过大小限制")
    try:
        root = SafeET.fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (ET.ParseError, DefusedXmlException, ValueError):
        raise ApiError(400, "GPX_XML_INVALID", "GPX XML 不合法") from None
    if root.tag != "gpx" or root.get("version") != "1.1":
        return gpx_parser.parse_gpx(raw)
    # Rebuild only the recognized direct hierarchy. Unknown/deep extension trees never
    # reach serialization, and namespaces cannot turn foreign elements into GPX points.
    safe = ET.Element("gpx", {"version": "1.1", "xmlns": GPX_NAMESPACE})
    point_count = segment_count = 0
    for track in root.findall("trk"):
        safe_track = ET.SubElement(safe, "trk")
        for segment in track.findall("trkseg"):
            segment_count += 1
            if segment_count > gpx_parser.MAX_SEGMENTS:
                raise ApiError(422, "GPX_LIMIT_EXCEEDED", "GPX 源段数超过限制")
            safe_segment = ET.SubElement(safe_track, "trkseg")
            for point in segment.findall("trkpt"):
                point_count += 1
                if point_count > gpx_parser.MAX_POINTS:
                    raise ApiError(422, "GPX_LIMIT_EXCEEDED", "GPX 源点数超过限制")
                attributes = {
                    name: point.get(name) for name in ("lat", "lon") if name in point.attrib
                }
                safe_point = ET.SubElement(safe_segment, "trkpt", attributes)
                for name in ("ele", "time"):
                    value = point.findtext(name)
                    if value is not None:
                        ET.SubElement(safe_point, name).text = value
    # Source bytes stay untouched for provenance. The ordinary parser remains authoritative
    # for original indexes, coordinate validation, timestamps and gpxpy extraction.
    return gpx_parser.parse_gpx(ET.tostring(safe, encoding="utf-8"))
