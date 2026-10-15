"""Synthetic TCX inputs: catch lost summaries, offset bugs and unsafe XML."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.core.errors import ApiError

NS = "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"


def tcx(laps=None, creator="Mi Fitness", sport=""):
    if laps is None:
        laps = [lap()]
    return (
        f'<TrainingCenterDatabase xmlns="{NS}" creator="{creator}">'
        f'<Activities><Activity Sport="{sport}"><Id>2026-10-04T16:15:20Z</Id>'
        + "".join(laps)
        + "</Activity></Activities></TrainingCenterDatabase>"
    ).encode()


def lap(
    time="1166",
    distance="2999",
    hr="<HeartRateBpm>156</HeartRateBpm>",
    start="2026-10-04T16:15:20Z",
    end="2026-10-04T16:37:22Z",
):
    return (
        f"<Lap><TotalTimeSeconds>{time}</TotalTimeSeconds>"
        f"<DistanceMeters>{distance}</DistanceMeters><Calories>144</Calories>"
        f"{hr}<Steps>3262</Steps><Track>"
        f"<Trackpoint><Time>{start}</Time><Position><LatitudeDegrees>0</LatitudeDegrees>"
        "<LongitudeDegrees>0</LongitudeDegrees></Position></Trackpoint>"
        f"<Trackpoint><Time>{end}</Time><Position><LatitudeDegrees>0</LatitudeDegrees>"
        "<LongitudeDegrees>0.001</LongitudeDegrees></Position></Trackpoint></Track></Lap>"
    )


def parse(raw, **kwargs):
    from app.modules.tcx.parser import parse_tcx

    return parse_tcx(raw, **kwargs)


def test_mi_fitness_preserves_device_summaries_and_repairs_time_only_when_selected():
    absolute = parse(tcx(), timezone="Asia/Shanghai")
    local = parse(tcx(), timezone="Asia/Shanghai", time_mode="local")
    assert absolute.tracks[0][0][0].time == datetime(2026, 10, 4, 16, 15, 20, tzinfo=UTC)
    assert local.tracks[0][0][0].time == datetime(2026, 10, 4, 8, 15, 20, tzinfo=UTC)
    assert local.summary == dict(
        distance_m=Decimal("2999"),
        timer_seconds=Decimal("1166"),
        calories_kcal=144,
        avg_heart_rate_bpm=156,
        steps=3262,
    )
    assert local.counts["input_point_count"] == 2
    assert local.counts["missing_elevation_count"] == 2


def test_standard_average_heart_rate_and_lap_weighting_preserve_boundaries():
    result = parse(
        tcx(
            [
                lap(time="60", hr="<AverageHeartRateBpm><Value>100</Value></AverageHeartRateBpm>"),
                lap(
                    time="120",
                    hr="<AverageHeartRateBpm><Value>160</Value></AverageHeartRateBpm>",
                    start="2026-10-04T17:00:00Z",
                    end="2026-10-04T17:02:00Z",
                ),
            ],
            creator="Other",
        )
    )
    assert result.summary["timer_seconds"] == Decimal("180")
    assert result.summary["avg_heart_rate_bpm"] == 140
    assert result.summary["distance_m"] == Decimal("5998")
    assert len(result.tracks[0]) == 2
    assert result.tracks[0][1][0].segment_index == 1


def test_incomplete_lap_summary_is_not_presented_as_full_activity_summary():
    result = parse(
        tcx(
            [
                lap(),
                lap()
                .replace("<Steps>3262</Steps>", "")
                .replace("<TotalTimeSeconds>1166</TotalTimeSeconds>", "")
                .replace("<HeartRateBpm>156</HeartRateBpm>", ""),
            ]
        )
    )
    assert result.summary["steps"] is None
    assert result.summary["timer_seconds"] is None
    assert result.summary["avg_heart_rate_bpm"] is None


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-1", "1000000000", "bad", ""])
def test_invalid_device_distance_is_rejected(value):
    with pytest.raises(ApiError) as error:
        parse(tcx([lap(distance=value)]))
    assert error.value.code == "TCX_SUMMARY_INVALID"


def test_unknown_exporter_direct_heart_rate_is_not_assumed_average():
    assert parse(tcx(creator="Other")).summary["avg_heart_rate_bpm"] is None


@pytest.mark.parametrize("instant", ["2026-03-08T02:30:00Z", "2026-11-01T01:30:00Z"])
def test_local_mode_rejects_nonexistent_or_ambiguous_dst_time(instant):
    with pytest.raises(ApiError) as error:
        parse(tcx([lap(start=instant)]), timezone="America/New_York", time_mode="local")
    assert error.value.code == "TCX_LOCAL_TIME_INVALID"


@pytest.mark.parametrize(
    "raw,code",
    [
        (b"<bad>", "TCX_XML_INVALID"),
        (b'<!DOCTYPE x [<!ENTITY e "value">]><x>&e;</x>', "TCX_XML_INVALID"),
        (tcx().replace(b"</Activities>", b"<Activity/></Activities>"), "TCX_MULTIPLE_ACTIVITIES"),
        (
            tcx().replace(b"<Track>", b"<Empty>").replace(b"</Track>", b"</Empty>"),
            "TCX_NO_VALID_POINTS",
        ),
        (tcx(sport="Biking"), "TCX_SPORT_UNSUPPORTED"),
    ],
)
def test_invalid_or_unsupported_files_are_rejected(raw, code):
    with pytest.raises(ApiError) as error:
        parse(raw)
    assert error.value.code == code


def test_source_point_limits_are_checked_before_discarding_bad_coordinates(monkeypatch):
    import app.modules.tcx.parser as parser

    monkeypatch.setattr(parser, "MAX_POINTS", 1)
    with pytest.raises(ApiError) as error:
        parse(tcx().replace(b"<LatitudeDegrees>0", b"<LatitudeDegrees>999"))
    assert error.value.code == "TCX_LIMIT_EXCEEDED"


def test_invalid_coordinates_leave_a_hole_instead_of_joining_across_it():
    raw = tcx().replace(b"<LongitudeDegrees>0.001", b"<LongitudeDegrees>999")
    result = parse(raw)
    assert result.tracks[0][0][1] is None
    assert result.counts["invalid_coordinate_count"] == 1


def test_child_parser_dispatches_tcx_and_preserves_summary():
    from app.modules.gpx.worker import bounded_parse

    result = bounded_parse(tcx(), format="tcx", timezone="Asia/Shanghai", time_mode="local")
    assert result.summary["avg_heart_rate_bpm"] == 156
    assert result.tracks[0][0][0].time.hour == 8


def test_single_lap_reported_average_heart_rate_survives_missing_timer():
    raw = tcx().replace(b"<TotalTimeSeconds>1166</TotalTimeSeconds>", b"")
    assert parse(raw).summary["avg_heart_rate_bpm"] == 156


@pytest.mark.parametrize("field", ["TotalTimeSeconds", "DistanceMeters"])
def test_positive_device_metrics_below_storage_precision_are_validation_errors(field):
    raw = (
        tcx().replace(
            f"<{field}>1166</{field}>".encode(), f"<{field}>1e-999999999</{field}>".encode()
        )
        if field == "TotalTimeSeconds"
        else tcx([lap(distance="1e-999999999")])
    )
    with pytest.raises(ApiError) as error:
        parse(raw)
    assert error.value.code == "TCX_SUMMARY_INVALID"
