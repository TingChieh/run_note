from decimal import Decimal

# (label, min_m inclusive, max_m inclusive); gaps between bands stay unclassified.
DISTANCE_BANDS: tuple[tuple[str, Decimal, Decimal], ...] = (
    ("3km", Decimal(2500), Decimal(4000)),
    ("5km", Decimal(4000), Decimal(7500)),
    ("10km", Decimal(9000), Decimal(12000)),
    ("半马", Decimal(20000), Decimal(22500)),
    ("全马", Decimal(41000), Decimal(44000)),
)


def classify_distance(distance_m) -> str:
    """Map a run distance to a standard race category, or "" when it fits none."""
    if distance_m is None:
        return ""
    value = Decimal(distance_m)
    for label, low, high in DISTANCE_BANDS:
        # 4000 m belongs to 5km; the 3km upper bound is exclusive.
        if low <= value <= high and not (label == "3km" and value == high):
            return label
    return ""
