import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

from app.modules.gpx.normalization import source_points, temporal_quality
from app.modules.gpx.schema import ParsedGPX


def coordinate(text: str) -> str:
    value = Decimal(text).quantize(Decimal(".0000001"), rounding=ROUND_HALF_EVEN)
    return format(abs(value) if value == 0 else value, ".7f")


def utc_millis(time: datetime) -> str:
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    delta = time - epoch
    micros = (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds
    milliseconds = (Decimal(micros) / 1000).quantize(Decimal(1), rounding=ROUND_HALF_EVEN)
    rounded = epoch + timedelta(milliseconds=int(milliseconds))
    return rounded.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_hash(parsed: ParsedGPX) -> str | None:
    if (
        parsed.counts["invalid_coordinate_count"]
        or temporal_quality(source_points(parsed)) != "complete"
    ):
        return None
    tracks = [
        [
            [[coordinate(p.lon_text), coordinate(p.lat_text), utc_millis(p.time)] for p in segment]
            for segment in track
        ]
        for track in parsed.tracks
    ]
    payload = json.dumps({"tracks": tracks}, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(b"canonical-v1\n" + payload.encode("utf-8")).hexdigest()
