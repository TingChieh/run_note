"""Device-summary normalization; no GPS-derived substitutions or unit guesses."""

import hashlib
import json
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from app.core.errors import ApiError
from app.modules.mifitness.schema import MifitnessRecord

RECORD_FINGERPRINT_VERSION = "mifitness-running-v1"
PRECISION = Decimal("0.001")
LIMIT = Decimal("1000000000")


def normalize_summary(record: MifitnessRecord) -> tuple[dict, list[str]]:
    source = record.source_metrics
    warnings = []

    def required(value: int | float) -> Decimal:
        decimal = Decimal(str(value)).quantize(PRECISION, rounding=ROUND_HALF_UP)
        if not 0 <= decimal < LIMIT or (value > 0 and decimal == 0):
            raise ApiError(422, "MIFITNESS_SUMMARY_INVALID", "设备距离或用时超出可保存范围")
        return decimal

    def metric(
        name: str,
        maximum: Decimal | int,
        *,
        integer: bool = False,
        zero_missing: bool = False,
        exclusive_max: bool = False,
    ) -> int | Decimal | None:
        value = getattr(source, name)
        if value is None or (zero_missing and value == 0):
            return None
        decimal = Decimal(str(value))
        if (
            not decimal.is_finite()
            or decimal < 0
            or (decimal >= maximum if exclusive_max else decimal > maximum)
            or (integer and decimal != decimal.to_integral_value())
        ):
            warnings.append(f"MIFITNESS_{name.upper()}_INVALID")
            return None
        if integer:
            return int(decimal)
        normalized = decimal.quantize(PRECISION, rounding=ROUND_HALF_UP)
        if (zero_missing and normalized == 0) or (exclusive_max and normalized >= maximum):
            warnings.append(f"MIFITNESS_{name.upper()}_INVALID")
            return None
        return normalized

    summary = {
        "distance_m": required(source.distance),
        "timer_seconds": required(source.duration),
        "calories_kcal": metric("calories", LIMIT, integer=True, exclusive_max=True),
        "steps": metric("steps", LIMIT, integer=True, exclusive_max=True),
        "avg_heart_rate_bpm": metric("avg_hrm", 300, integer=True, zero_missing=True),
        "max_heart_rate_bpm": metric("max_hrm", 300, integer=True, zero_missing=True),
        "min_heart_rate_bpm": metric("min_hrm", 300, integer=True, zero_missing=True),
        "avg_cadence_spm": metric("avg_cadence", 400, zero_missing=True),
        "max_cadence_spm": metric("max_cadence", 400, zero_missing=True),
        "vo2_max_ml_kg_min": metric("vo2_max", 150, zero_missing=True),
        "training_load": metric("train_load", LIMIT, exclusive_max=True),
        "aerobic_training_effect": metric("train_effect", 5),
        "anaerobic_training_effect": metric("anaerobic_train_effect", 5),
        "started_at": datetime.fromtimestamp(source.start_time, UTC),
        "ended_at": datetime.fromtimestamp(source.end_time, UTC),
        "elapsed_seconds": Decimal(source.end_time - source.start_time),
    }
    for fields, warning in (
        (
            ("min_heart_rate_bpm", "avg_heart_rate_bpm", "max_heart_rate_bpm"),
            "MIFITNESS_HEART_RATE_INCONSISTENT",
        ),
        (("avg_cadence_spm", "max_cadence_spm"), "MIFITNESS_CADENCE_INCONSISTENT"),
    ):
        values = [summary[field] for field in fields if summary[field] is not None]
        if any(first > second for first, second in zip(values, values[1:], strict=False)):
            summary.update(dict.fromkeys(fields))
            warnings.append(warning)
    if summary["timer_seconds"] > summary["elapsed_seconds"]:
        warnings.append("MIFITNESS_TIMER_EXCEEDS_ELAPSED")
    for name in (
        "avg_stride",
        "recover_time",
        "avg_speed",
        "max_speed",
        "avg_pace",
        "timezone",
        "hrm_aerobic_duration",
        "hrm_anaerobic_duration",
        "hrm_extreme_duration",
        "hrm_fat_burning_duration",
        "hrm_warm_up_duration",
    ):
        value = getattr(source, name)
        if value is not None:
            if not Decimal(str(value)).is_finite():
                warnings.append(f"MIFITNESS_{name.upper()}_INVALID")
            elif name in ("avg_stride", "recover_time"):
                warnings.append(f"MIFITNESS_{name.upper()}_UNIT_UNVERIFIED")
    return summary, warnings


def source_snapshot(record: MifitnessRecord) -> dict:
    """Rebuild the validated allowlist; PostgreSQL JSONB never receives NaN/Infinity."""
    metrics = record.source_metrics.model_dump()
    return {
        "source_time": record.source_time,
        "source_metrics": {
            name: value if value is None or Decimal(str(value)).is_finite() else None
            for name, value in metrics.items()
        },
    }


def record_fingerprint(record: MifitnessRecord) -> str:
    """A stable source identity survives corrections to exported device metrics."""
    payload = json.dumps(
        [RECORD_FINGERPRINT_VERSION, "running", record.source_time], separators=(",", ":")
    )
    return hashlib.sha256(payload.encode("ascii")).hexdigest()
