from datetime import UTC, datetime, timedelta

from app.modules.activities.schema import ReplayView
from app.modules.gpx.replay import ReplayPoint, build_replay, recorded_seconds, smoothed_pace
from app.modules.showcase.service import replay_view

START = datetime(2026, 5, 1, 7, 0, tzinfo=UTC)


def run(seconds, step_m=3.0, lon=116.0, gap_from=None):
    """One point per entry of `seconds`, `step_m` apart; None marks a missing timestamp."""
    return [
        ReplayPoint(
            lon + i * 0.00003,
            39.9,
            None if s is None else START + timedelta(seconds=s),
            0.0 if i == 0 else step_m,
        )
        for i, s in enumerate(seconds)
    ]


def test_real_replay_follows_recorded_time_and_track_distance():
    replay = build_replay([(0, run(range(0, 61)))])
    ReplayView.model_validate(replay)
    segment = replay["segments"][0]
    assert replay["mode"] == "real"
    assert replay["point_count"] == 61
    assert replay["interpolated_point_count"] == 0
    assert segment["elapsed_s"][:3] == [0.0, 1.0, 2.0]
    assert segment["distance_m"][-1] == replay["distance_m"] == 180.0
    assert replay["elapsed_seconds"] == replay["moving_seconds"] == 60.0
    # 3 m/s is 333.3 s/km once the window has enough span; the first seconds have no pace yet.
    assert segment["pace_s_per_km"][0] is None
    assert segment["pace_s_per_km"][-1] == 333.3


def test_gap_between_segments_counts_as_elapsed_but_not_moving_time_or_distance():
    first = run(range(0, 11))
    second = run(range(611, 622), lon=116.01)
    replay = build_replay([(0, first), (1, second)])
    a, b = replay["segments"]
    assert b["elapsed_s"][0] == 611.0
    assert b["distance_m"][0] == a["distance_m"][-1] == 30.0
    assert b["moving_s"][0] == a["moving_s"][-1] == 10.0
    assert replay["elapsed_seconds"] == 621.0
    assert replay["moving_seconds"] == 20.0
    assert replay["distance_m"] == 60.0


def test_missing_times_are_spread_by_distance_and_ends_hold_the_nearest_time():
    points = run([None, 0, None, None, 9, 10, 11, None])
    points[3] = ReplayPoint(points[3].lon, points[3].lat, None, 6.0)  # uneven spacing
    seconds, filled = recorded_seconds([points])
    assert filled == 4
    # Between t=0 and t=9 the track covers 3 + 6 + 3 = 12 m.
    assert seconds == [[0.0, 0.0, 2.25, 6.75, 9.0, 10.0, 11.0, 11.0]]
    assert build_replay([(0, points)])["interpolated_point_count"] == 4


def test_stationary_intervals_are_not_moving_time_and_have_no_pace():
    points = run(range(0, 41), step_m=0.1)
    replay = build_replay([(0, points)])
    assert replay["mode"] == "real"
    assert replay["elapsed_seconds"] == 40.0
    assert replay["moving_seconds"] == 0.0
    assert set(replay["segments"][0]["pace_s_per_km"]) == {None}


def test_one_noisy_fix_moves_the_smoothed_pace_only_slightly():
    elapsed = [float(i) for i in range(61)]
    distance = [3.0 * i for i in range(61)]
    # A single 30 m spike (10x the normal step) half a minute into the run.
    distance = [d + (27.0 if i >= 30 else 0.0) for i, d in enumerate(distance)]
    paces = [p for p in smoothed_pace(elapsed, distance)[31:] if p is not None]
    assert min(paces) > 250 and max(paces) < 340


def test_sparse_sampling_still_reports_pace_over_one_interval():
    paces = smoothed_pace([0.0, 60.0, 120.0], [0.0, 200.0, 400.0])
    assert paces == [None, 300.0, 300.0]


def test_reversed_or_missing_time_falls_back_to_a_simulated_steady_pace():
    reversed_track = [(0, run([0, 1, 2, 3])), (1, run([1, 2, 3, 4], lon=116.01))]
    untimed = [(0, run([None] * 5))]
    for segments in (reversed_track, untimed):
        replay = build_replay(segments, fallback_pace=300.0)
        assert replay["mode"] == "simulated"
        last = replay["segments"][-1]
        assert last["pace_s_per_km"] is None
        # 300 s/km is 0.3 s per metre of track.
        assert replay["elapsed_seconds"] == round(replay["distance_m"] * 0.3, 3)
        assert replay["moving_seconds"] == replay["elapsed_seconds"]


def test_mostly_untimed_tracks_and_constant_times_are_simulated():
    assert recorded_seconds([run([0, None, None, None, 5])]) == (None, 0)
    assert recorded_seconds([run([0, 0, 0])]) == (None, 0)
    assert build_replay([(0, run([None] * 3))])["elapsed_seconds"] == round(6.0 * 0.36, 3)


def test_duplicate_timestamps_and_single_point_segments_stay_valid():
    replay = build_replay([(0, run([0, 0, 1, 2])), (1, run([5])), (2, run([6, 7]))])
    ReplayView.model_validate(replay)
    assert [s["segment_index"] for s in replay["segments"]] == [0, 1, 2]
    assert replay["segments"][1]["elapsed_s"] == [5.0]
    assert replay["mode"] == "real"


def test_showcase_view_rebuilds_only_whitelisted_keys():
    replay = build_replay([(0, run(range(5)))])
    leaked = replay | {"user_id": "x"}
    leaked["segments"] = [replay["segments"][0] | {"recorded_at": "x"}]
    assert replay_view(leaked) == replay
