import math
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation

from app.core.errors import ApiError


def haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    if (
        not all(math.isfinite(x) for x in (lon1, lat1, lon2, lat2))
        or abs(lon1) > 180
        or abs(lon2) > 180
        or abs(lat1) > 90
        or abs(lat2) > 90
    ):
        raise ApiError(422, "GPX_METRIC_INVALID", "坐标不合法")
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians((lon2 - lon1 + 180) % 360 - 180)
    a = math.sin((phi2 - phi1) / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    a = max(0, min(1, a))
    return 2 * 6371008.8 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def round_metric(value) -> Decimal:
    try:
        result = Decimal(str(value)).quantize(Decimal(".001"), rounding=ROUND_HALF_EVEN)
        if not result.is_finite() or result < 0 or result >= Decimal("1000000000"):
            raise InvalidOperation
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise ApiError(422, "GPX_METRIC_INVALID", "指标超过支持范围") from None


def pace(elapsed, distance) -> Decimal | None:
    if elapsed is None or distance is None:
        return None
    e, d = Decimal(str(elapsed)), Decimal(str(distance))
    if not e.is_finite() or not d.is_finite() or e < 0 or d < 0:
        raise ApiError(422, "GPX_METRIC_INVALID", "指标不合法")
    return round_metric(e * 1000 / d) if e > 0 and d > 0 else None
