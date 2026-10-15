"""Synthetic device summaries and XML: preserve boundaries, units and unsafe-input rejection."""

import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.core.errors import ApiError


def record(**metrics):
    from app.modules.mifitness.schema import MifitnessRecord

    return MifitnessRecord.model_validate(
        {
            "source_time": 1720000000,
            "source_metrics": {
                "distance": 3000,
                "duration": 1200,
                "start_time": 1720000000,
                "end_time": 1720001300,
                **metrics,
            },
        }
    )


def normalize(**metrics):
    from app.modules.mifitness.metrics import normalize_summary

    return normalize_summary(record(**metrics))


def gpx(*, namespace=False, points=2, segments=1):
    xmlns = ' xmlns="http://www.topografix.com/GPX/1/1"' if namespace else ""
    track = (
        "<trkseg>"
        + "".join(
            f'<trkpt lat="0" lon="{index / 1000}"><time>2026-10-04T16:15:20Z</time></trkpt>'
            for index in range(points)
        )
        + "</trkseg>"
    )
    return (f'<gpx version="1.1"{xmlns}><trk>' + track * segments + "</trk></gpx>").encode()


def parse(raw):
    from app.modules.mifitness.parser import parse_mifitness_gpx

    return parse_mifitness_gpx(raw)


def test_minimal_summary_preserves_device_seconds_and_absolute_times():
    summary, warnings = normalize()
    assert summary["distance_m"] == Decimal("3000")
    assert summary["timer_seconds"] == Decimal("1200")
    assert summary["elapsed_seconds"] == Decimal("1300")
    assert summary["started_at"] == datetime(2024, 7, 3, 9, 46, 40, tzinfo=UTC)
    assert summary["ended_at"] == datetime(2024, 7, 3, 10, 8, 20, tzinfo=UTC)
    assert summary["max_heart_rate_bpm"] is None
    assert not warnings


def test_valid_zero_effects_are_preserved_but_zero_hr_cadence_vo2_are_missing():
    summary, warnings = normalize(
        avg_hrm=0,
        max_hrm=0,
        min_hrm=0,
        avg_cadence=0,
        max_cadence=0,
        vo2_max=0,
        train_load=0,
        train_effect=0,
        anaerobic_train_effect=0,
        calories=0,
        steps=0,
    )
    for field in ("training_load", "aerobic_training_effect", "anaerobic_training_effect"):
        assert summary[field] == Decimal("0")
    assert summary["calories_kcal"] == 0
    assert summary["steps"] == 0
    for field in ("avg_heart_rate_bpm", "avg_cadence_spm", "vo2_max_ml_kg_min"):
        assert summary[field] is None
    assert not warnings


def test_invalid_max_cadence_does_not_discard_valid_distance_or_average():
    summary, warnings = normalize(avg_cadence=170.5, max_cadence=5730)
    assert summary["distance_m"] == 3000
    assert summary["avg_cadence_spm"] == Decimal("170.5")
    assert summary["max_cadence_spm"] is None
    assert "MIFITNESS_MAX_CADENCE_INVALID" in warnings


@pytest.mark.parametrize(
    "metrics,fields,warning",
    [
        (
            {"min_hrm": 160, "avg_hrm": 150, "max_hrm": 190},
            ["min_heart_rate_bpm", "avg_heart_rate_bpm", "max_heart_rate_bpm"],
            "MIFITNESS_HEART_RATE_INCONSISTENT",
        ),
        (
            {"min_hrm": 190, "max_hrm": 180},
            ["min_heart_rate_bpm", "avg_heart_rate_bpm", "max_heart_rate_bpm"],
            "MIFITNESS_HEART_RATE_INCONSISTENT",
        ),
        (
            {"avg_cadence": 180, "max_cadence": 170},
            ["avg_cadence_spm", "max_cadence_spm"],
            "MIFITNESS_CADENCE_INCONSISTENT",
        ),
    ],
)
def test_inconsistent_metric_groups_are_empty_with_warning(metrics, fields, warning):
    summary, warnings = normalize(**metrics)
    assert all(summary[field] is None for field in fields)
    assert warning in warnings


@pytest.mark.parametrize(
    "field,value,target",
    [
        ("calories", -1, "calories_kcal"),
        ("steps", 1.5, "steps"),
        ("avg_hrm", 150.5, "avg_heart_rate_bpm"),
        ("max_hrm", 301, "max_heart_rate_bpm"),
        ("min_hrm", -1, "min_heart_rate_bpm"),
        ("vo2_max", 151, "vo2_max_ml_kg_min"),
        ("train_load", 1e9, "training_load"),
        ("train_effect", 5.01, "aerobic_training_effect"),
        ("anaerobic_train_effect", -1, "anaerobic_training_effect"),
        ("max_cadence", float("inf"), "max_cadence_spm"),
        ("avg_cadence", float("nan"), "avg_cadence_spm"),
    ],
)
def test_optional_invalid_metrics_are_empty_not_record_rejection(field, value, target):
    summary, warnings = normalize(**{field: value})
    assert summary[target] is None
    assert f"MIFITNESS_{field.upper()}_INVALID" in warnings
    assert summary["distance_m"] == 3000


def test_fractional_cadence_and_estimates_keep_three_decimal_precision():
    summary, _ = normalize(
        avg_cadence=170.125,
        max_cadence=195.75,
        vo2_max=47.125,
        train_load=30.25,
        train_effect=2.4,
        anaerobic_train_effect=0.5,
    )
    assert summary["avg_cadence_spm"] == Decimal("170.125")
    assert summary["max_cadence_spm"] == Decimal("195.750")
    assert summary["vo2_max_ml_kg_min"] == Decimal("47.125")


@pytest.mark.parametrize("field", ["distance", "duration", "avg_hrm", "timezone"])
@pytest.mark.parametrize("value", [True, "123"])
def test_boolean_or_string_numeric_values_are_rejected(field, value):
    with pytest.raises(ValidationError):
        record(**{field: value})


@pytest.mark.parametrize(
    "field,value",
    [
        ("distance", -1),
        ("distance", float("inf")),
        ("distance", float("nan")),
        ("distance", 1e9),
        ("duration", -1),
        ("start_time", 1720000000.5),
        ("start_time", 1720000001),
        ("end_time", 1719999999),
        ("end_time", 10**30),
    ],
)
def test_invalid_required_summaries_are_rejected(field, value):
    with pytest.raises((ValidationError, ApiError)):
        normalize(**{field: value})


@pytest.mark.parametrize("extra", ["download_url", "account_id", "device_id", "arbitrary"])
def test_unknown_summary_keys_are_rejected(extra):
    with pytest.raises(ValidationError):
        record(**{extra: "private"})


def test_unknown_units_stay_only_in_bounded_finite_snapshot():
    from app.modules.mifitness.metrics import source_snapshot

    item = record(avg_stride=123, recover_time=36, avg_speed=float("inf"), timezone=32)
    summary, warnings = normalize(avg_stride=123, recover_time=36)
    assert "avg_stride" not in summary and "recover_time" not in summary
    assert "MIFITNESS_AVG_STRIDE_UNIT_UNVERIFIED" in warnings
    assert "MIFITNESS_RECOVER_TIME_UNIT_UNVERIFIED" in warnings
    snapshot = source_snapshot(item)
    assert snapshot["source_metrics"]["avg_stride"] == 123
    assert snapshot["source_metrics"]["avg_speed"] is None
    assert snapshot["source_metrics"]["timezone"] == 32
    json.dumps(snapshot, allow_nan=False)


def test_fingerprint_detects_same_source_even_when_export_metrics_change():
    from app.modules.mifitness.metrics import record_fingerprint
    from app.modules.mifitness.schema import MifitnessRecord

    first = record_fingerprint(record())
    assert len(first) == 64
    assert record_fingerprint(record(distance=4000, avg_hrm=155)) == first
    later = MifitnessRecord.model_validate(
        {
            "source_time": 1720000100,
            "source_metrics": {
                "start_time": 1720000100,
                "end_time": 1720001300,
                "distance": 3000,
                "duration": 1200,
            },
        }
    )
    assert record_fingerprint(later) != first


def test_timer_greater_than_elapsed_is_preserved_and_warned():
    summary, warnings = normalize(duration=1500)
    assert summary["timer_seconds"] == 1500
    assert summary["elapsed_seconds"] == 1300
    assert "MIFITNESS_TIMER_EXCEEDS_ELAPSED" in warnings


def test_unnamespaced_adapter_preserves_times_and_ordinary_parser_remains_strict():
    from app.modules.gpx.parser import parse_gpx

    parsed = parse(gpx())
    standard = parse(gpx(namespace=True))
    assert parsed == standard
    assert parsed.counts["input_point_count"] == 2
    assert parsed.tracks[0][0][0].time == datetime(2026, 10, 4, 16, 15, 20, tzinfo=UTC)
    with pytest.raises(ApiError) as error:
        parse_gpx(gpx())
    assert error.value.code == "GPX_XML_INVALID"


@pytest.mark.parametrize(
    "raw",
    [
        b"<bad>",
        b'<gpx version="1.0"><trk/></gpx>',
        b'<!DOCTYPE gpx [<!ENTITY x "secret">]><gpx version="1.1">&x;</gpx>',
        b'<!DOCTYPE gpx SYSTEM "file:///never-read"><gpx version="1.1"/>',
        b'<gpx xmlns="https://untrusted.example" version="1.1"/>',
    ],
)
def test_adapter_rejects_bad_roots_versions_and_entities(raw):
    with pytest.raises(ApiError) as error:
        parse(raw)
    assert error.value.code == "GPX_XML_INVALID"


def test_adapter_enforces_original_byte_limit_before_parsing():
    from app.modules.gpx.parser import MAX_BYTES

    with pytest.raises(ApiError) as error:
        parse(b" " * (MAX_BYTES + 1))
    assert error.value.code == "GPX_TOO_LARGE"


@pytest.mark.parametrize(
    "limit,raw", [("MAX_POINTS", gpx(points=3)), ("MAX_SEGMENTS", gpx(segments=3))]
)
def test_adapter_retains_point_and_segment_limits(monkeypatch, limit, raw):
    import app.modules.gpx.parser as parser

    monkeypatch.setattr(parser, limit, 2)
    with pytest.raises(ApiError) as error:
        parse(raw)
    assert error.value.code == "GPX_LIMIT_EXCEEDED"


def test_adapter_discards_deep_unknown_xml_without_serialization_recursion():
    nested = b"<extension>" * 1500 + b"ignored" + b"</extension>" * 1500
    raw = gpx().replace(b"</gpx>", nested + b"</gpx>")
    assert parse(raw).counts["input_point_count"] == 2


def test_adapter_preserves_invalid_point_holes_and_empty_segments():
    raw = gpx(points=3).replace(b'lon="0.001"', b'lon="999"')
    raw = raw.replace(b"</trk>", b"<trkseg/></trk>")
    parsed = parse(raw)
    assert parsed.tracks[0][0][1] is None
    assert parsed.tracks[0][1] == []
    assert parsed.counts["invalid_coordinate_count"] == 1
    assert parsed.counts["empty_segment_count"] == 1


@pytest.mark.parametrize(
    "field",
    [
        "avg_speed",
        "max_speed",
        "avg_pace",
        "timezone",
        "hrm_warm_up_duration",
        "avg_stride",
        "recover_time",
    ],
)
def test_nonfinite_unshown_optional_values_are_sanitized_and_warned(field):
    from app.modules.mifitness.metrics import source_snapshot

    item = record(**{field: float("nan")})
    _, warnings = normalize(**{field: float("nan")})
    assert f"MIFITNESS_{field.upper()}_INVALID" in warnings
    assert source_snapshot(item)["source_metrics"][field] is None


def test_private_preview_serialization_excludes_source_record_and_defaults_optional_metrics():
    from app.modules.mifitness.schema import MifitnessPreview

    summary, warnings = normalize()
    view = MifitnessPreview.model_validate(
        {
            **summary,
            "activity_date": datetime(2024, 7, 3).date(),
            "timezone": "UTC",
            "has_route": False,
            "point_count": 0,
            "segment_count": 0,
            "warnings": warnings,
            "suspected_activity_ids": [],
            "source_metrics": {"avg_stride": 120},
            "record_fingerprint": "private source identity",
            "raw_gpx": b"private original",
        }
    )
    payload = view.model_dump()
    assert payload["max_heart_rate_bpm"] is None
    assert payload["avg_cadence_spm"] is None
    assert payload["started_at"].tzinfo is UTC
    assert "source_metrics" not in payload
    assert "record_fingerprint" not in payload
    assert "raw_gpx" not in payload
