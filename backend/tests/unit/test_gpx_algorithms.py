import importlib.util
import json
import math
from datetime import date
from pathlib import Path

import pytest

from app.core.errors import ApiError

ROOT = Path(__file__).parents[1] / "fixtures" / "gpx"
CASES = json.loads((ROOT / "manifest.json").read_text())["cases"]


def modules():
    from app.modules.gpx.fingerprint import canonical_hash
    from app.modules.gpx.normalization import derive, prepare_segments
    from app.modules.gpx.parser import parse_gpx

    return parse_gpx, prepare_segments, derive, canonical_hash


def edges(segments):
    # Independent equatorial ellipsoid formula; polar fixture reference from native PROJ.
    result = []
    for segment in segments:
        distances = []
        for a, b in zip(segment.points, segment.points[1:], strict=False):
            if a.lat == b.lat == 89:
                distance = 19.493267246415
            else:
                distance = 6378137 * abs(math.radians((b.lon - a.lon + 180) % 360 - 180))
            distances.append(distance)
        result.append(distances)
    return result


@pytest.mark.parametrize("case", [c for c in CASES if "file" in c], ids=lambda c: c["id"])
def test_frozen_golden_contract(case):
    parse, prepare, derive, canonical = modules()
    expected = case["expected"]
    request = case.get("request", {})

    def execute():
        parsed = parse((ROOT / case["file"]).read_bytes())
        segments = prepare(parsed)
        derived = derive(
            parsed,
            segments,
            edges(segments),
            request.get("timezone", "UTC"),
            date.fromisoformat(request["activity_date"]) if "activity_date" in request else None,
        )
        return parsed, derived

    if "code" in expected:
        with pytest.raises(ApiError) as caught:
            execute()
        assert caught.value.code == expected["code"]
        assert caught.value.status_code == expected["http_status"]
        return
    parsed, derived = execute()
    for key, value in expected.items():
        if key.endswith("_count"):
            assert derived.quality_summary[key] == value
        elif key in ("temporal_quality", "started_at", "ended_at"):
            assert getattr(derived, key) == value
        elif key == "elapsed_seconds":
            assert derived.elapsed_seconds == value
        elif key == "activity_date":
            assert derived.activity_date.isoformat() == value
        elif key == "canonical_eligible":
            assert (canonical(parsed) is not None) is value
    relation = case.get("relation", {})
    if "canonical_reference" in relation:
        reference = parse((ROOT / (relation["canonical_reference"] + ".gpx")).read_bytes())
        assert (canonical(parsed) == canonical(reference)) is relation["expected_equal"]


@pytest.mark.parametrize(
    "case", [c for c in CASES if "recipe" in c and c["id"] != "deep-xml"], ids=lambda c: c["id"]
)
def test_precleaning_limits(case):
    parse, *_ = modules()
    spec = importlib.util.spec_from_file_location("fixture_generator", ROOT / "generate_limits.py")
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    raw = generator.build_fixture(case["id"])
    if "code" in case["expected"]:
        with pytest.raises(ApiError) as caught:
            parse(raw)
        assert caught.value.code == case["expected"]["code"]
    else:
        parsed = parse(raw)
        for key in ("input_point_count", "input_segment_count"):
            if key in case["expected"]:
                assert parsed.counts[key] == case["expected"][key]


def test_independent_haversine_and_rounding():
    from decimal import Decimal

    from app.modules.gpx.metrics import haversine, pace, round_metric

    assert haversine(0, 0, 0.01, 0) == pytest.approx(1111.950802335329, abs=0.001)
    assert haversine(180, 0, -180, 0) == 0
    assert math.isfinite(haversine(0, 0, 180, 0))
    assert round_metric(Decimal("1.2345")) == Decimal("1.234")
    assert pace(600, 1113.1949079327358) == Decimal("538.989")
    assert pace(0, 100) is None
    with pytest.raises(ApiError):
        round_metric(Decimal("999999999.9995"))


def xml(points, extra=""):
    return (
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" '
        'creator="test"><trk><trkseg>' + points + "</trkseg></trk>" + extra + "</gpx>"
    ).encode()


def point(lon="0", time="2024-01-01T00:00:00Z", elevation=None):
    return (
        f'<trkpt lon="{lon}" lat="0"><time>{time}</time>'
        + (f"<ele>{elevation}</ele>" if elevation is not None else "")
        + "</trkpt>"
    )


def test_canonical_precise_bytes_negative_zero_and_half_even_carry():
    import hashlib

    parse, _, _, canonical = modules()
    parsed = parse(xml(point("-0.00000005", "2024-01-01T23:59:59.999500Z")))
    payload = b'canonical-v1\n{"tracks":[[[["0.0000000","0.0000000","2024-01-02T00:00:00.000Z"]]]]}'
    assert canonical(parsed) == hashlib.sha256(payload).hexdigest()
    assert canonical(parse(xml(point("0", "2024-01-02T00:00:00Z", "500")))) == canonical(parsed)


def test_microsecond_time_is_validated_before_fingerprint_quantization():
    parse, prepare, derive, canonical = modules()
    parsed = parse(
        xml(
            point("0", "2024-01-01T00:00:00.000001Z")
            + point("0.00000001", "2024-01-01T00:00:00.000002Z")
        )
    )
    segments = prepare(parsed)
    result = derive(parsed, segments, [[0.001]], "UTC", None)
    assert result.temporal_quality == "complete"
    assert result.quality_summary["speed_jump_count"] == 1
    assert canonical(parsed) is not None


@pytest.mark.parametrize("distance,expected", [(120.0, 1), (120.00001, 2)])
def test_authoritative_speed_threshold(distance, expected):
    parse, prepare, derive, _ = modules()
    parsed = parse(xml(point() + point(".001", "2024-01-01T00:00:10Z")))
    result = derive(parsed, prepare(parsed), [[distance]], "UTC", None)
    assert len(result.segments) == expected


@pytest.mark.parametrize(
    "root",
    [
        b'<gpx version="1.1"/>',
        b'<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.2"/>',
        b'<gpx xmlns="https://example.com/GPX/1/1" version="1.1"/>',
        b'<other xmlns="http://www.topografix.com/GPX/1/1" version="1.1"/>',
        b'<gpx xmlns="http://www.topografix.com/GPX/1/1"/>',
        b"<!DOCTYPE gpx><gpx/>",
    ],
)
def test_root_namespace_version_and_dtd_are_strict(root):
    parse, *_ = modules()
    with pytest.raises(ApiError) as caught:
        parse(root)
    assert caught.value.code == "GPX_XML_INVALID"


@pytest.mark.parametrize("version,namespace_version", [("1.0", "1/1"), ("1.1", "1/0")])
def test_export_with_mismatched_version_preserves_track_data(version, namespace_version):
    parse, prepare, derive, canonical = modules()
    standard = xml(point() + point("0.001", "2024-01-01T00:01:00Z"))
    exported = standard.replace(b'version="1.1"', f'version="{version}"'.encode()).replace(
        b"GPX/1/1", f"GPX/{namespace_version}".encode()
    )
    parsed = parse(exported)
    assert parsed.counts["input_point_count"] == 2
    assert parsed.tracks == parse(standard).tracks
    assert canonical(parsed) == canonical(parse(standard))
    result = derive(parsed, prepare(parsed), [[111.319490793]], "UTC", None)
    assert result.temporal_quality == "complete"
    assert result.elapsed_seconds == 60
    assert result.activity_date == date(2024, 1, 1)


def slow_target(raw, pipe):
    import time

    time.sleep(5)


def crash_target(raw, pipe):
    import os

    os._exit(1)


def test_spawn_timeout_crash_reap_and_subsequent_success():
    import multiprocessing

    from app.modules.gpx.worker import bounded_parse

    original = {p.pid for p in multiprocessing.active_children()}
    for target, code in [
        (slow_target, "GPX_PROCESSING_TIMEOUT"),
        (crash_target, "GPX_PROCESSING_FAILED"),
    ]:
        with pytest.raises(ApiError) as caught:
            bounded_parse(xml(point()), timeout=0.5, _target=target)
        assert caught.value.code == code
        assert {p.pid for p in multiprocessing.active_children()} == original
    assert bounded_parse(xml(point())).counts["input_point_count"] == 1


def test_spawn_large_result_does_not_deadlock_pipe():
    from app.modules.gpx.worker import bounded_parse

    parsed = bounded_parse(xml(point() * 50000))
    assert parsed.counts["input_point_count"] == 50000


def test_parser_slot_busy_does_not_spawn():
    from app.modules.gpx.worker import _SLOT, bounded_parse

    _SLOT.acquire()
    try:
        with pytest.raises(ApiError) as caught:
            bounded_parse(xml(point()))
        assert caught.value.code == "IMPORT_BUSY"
    finally:
        _SLOT.release()


def test_original_decimal_coordinate_bound_not_float_rounded():
    parse, *_ = modules()
    parsed = parse(xml(point("180.0000000000000000001") + point("0")))
    assert parsed.counts["invalid_coordinate_count"] == 1


def test_submicrosecond_reversal_stays_invalid_at_supported_precision():
    parse, prepare, derive, canonical = modules()
    parsed = parse(
        xml(point("0", "2024-01-01T00:00:00.000002Z") + point("0", "2024-01-01T00:00:00.000001Z"))
    )
    result = derive(parsed, prepare(parsed), [[0]], "UTC", None)
    assert result.temporal_quality == "invalid"
    assert canonical(parsed) is None


@pytest.mark.parametrize(
    "time,zone,expected_date,year",
    [
        ("1900-01-01T00:00:00+01:00", "Etc/GMT-1", "1900-01-01", 1899),
        ("2100-12-31T23:30:00-01:00", "Etc/GMT+1", "2100-12-31", 2101),
    ],
)
def test_reliable_utc_year_outside_activity_date_bounds(time, zone, expected_date, year):
    parse, prepare, derive, canonical = modules()
    parsed = parse(xml(point(time=time)))
    p = parsed.tracks[0][0][0]
    assert p.time is not None
    assert p.time.year == year
    result = derive(parsed, prepare(parsed), [[]], zone, None)
    assert result.activity_date.isoformat() == expected_date
    assert result.temporal_quality == "complete"
    assert canonical(parsed) is not None


@pytest.mark.parametrize("offset", ["+01:60", "-01:60", "+24:00", "+99:00"])
def test_invalid_timezone_offset_is_null_instead_of_normalized(offset):
    parse, *_ = modules()
    parsed = parse(xml(point(time="2024-01-01T00:00:00" + offset)))
    assert parsed.tracks[0][0][0].time is None


def partial_header_target(raw, pipe):
    import os
    import struct
    import time

    os.write(pipe.fileno(), struct.pack("!i", 1000))
    time.sleep(5)


def test_spawn_partial_pipe_header_cannot_block_past_deadline():
    import multiprocessing
    import time

    from app.modules.gpx.worker import bounded_parse

    original = {p.pid for p in multiprocessing.active_children()}
    start = time.monotonic()
    with pytest.raises(ApiError) as caught:
        bounded_parse(xml(point()), timeout=0.5, _target=partial_header_target)
    assert caught.value.code == "GPX_PROCESSING_TIMEOUT"
    assert time.monotonic() - start < 1.5
    assert {p.pid for p in multiprocessing.active_children()} == original
    assert bounded_parse(xml(point())).counts["input_point_count"] == 1


@pytest.mark.parametrize(
    "lat,lon1,lon2,expected",
    [
        (0, 180, -180, "complete"),
        (90, 0, 50, "complete"),
        (-90, 0, -50, "complete"),
        (0, 0, 1, "invalid"),
        (89, 0, 50, "invalid"),
    ],
)
def test_zero_time_geographic_identity(lat, lon1, lon2, expected):
    parse, prepare, derive, canonical = modules()

    def pt(lon):
        return point(str(lon)).replace('lat="0"', f'lat="{lat}"')

    parsed = parse(xml(pt(lon1) + pt(lon2)))
    segment = prepare(parsed)
    distance = 0 if expected == "complete" else 1
    result = derive(parsed, segment, [[distance]], "UTC", None)
    assert result.temporal_quality == expected
    assert (canonical(parsed) is not None) is (expected == "complete")
