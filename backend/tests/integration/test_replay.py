"""Replay data read from stored points: owner scope, track distance, gaps and fallbacks."""

import pytest
from sqlalchemy import text

from tests.conftest import register, upload

pytestmark = pytest.mark.integration


def imported(client, file, fields=None):
    response = upload(client, file, fields=fields)
    assert response.status_code == 201, response.text
    return response.json()["data"]["activity"]


def snapshot(engine, identifier):
    with engine.connect() as c:
        return c.execute(
            text("""SELECT s.segment_index, p.point_index, ST_AsText(p.position), p.recorded_at
            FROM activity_segments s JOIN activity_points p ON p.segment_id = s.id
            WHERE s.activity_id = :id ORDER BY 1, 2"""),
            {"id": identifier},
        ).all()


def test_real_replay_matches_stored_distance_and_time_and_changes_nothing(clients):
    a, b, engine, _ = clients
    register(a)
    register(b)
    activity = imported(a, "equator-six.gpx")
    before = snapshot(engine, activity["id"])
    response = a.get(f"/api/v1/activities/{activity['id']}/replay")
    assert response.status_code == 200, response.text
    replay = response.json()["data"]
    assert replay["mode"] == "real"
    assert replay["point_count"] == 6
    assert replay["distance_m"] == pytest.approx(float(activity["distance_m"]), abs=0.01)
    assert replay["elapsed_seconds"] == float(activity["elapsed_seconds"]) == 600
    (segment,) = replay["segments"]
    assert segment["elapsed_s"][0] == 0 and segment["elapsed_s"][-1] == 600
    assert segment["distance_m"] == sorted(segment["distance_m"])
    assert len(segment["coordinates"]) == len(segment["pace_s_per_km"]) == 6
    assert b.get(f"/api/v1/activities/{activity['id']}/replay").status_code == 404
    assert snapshot(engine, activity["id"]) == before


def test_speed_jump_is_not_bridged_and_reversal_is_simulated(clients):
    a, _, _, _ = clients
    register(a)
    jump = imported(a, "speed-jump.gpx")
    replay = a.get(f"/api/v1/activities/{jump['id']}/replay").json()["data"]
    assert replay["mode"] == "real"
    assert [len(s["coordinates"]) for s in replay["segments"]] == [1, 2]
    # The 111 km jump between segments adds elapsed time but no distance or moving time.
    assert replay["distance_m"] == pytest.approx(float(jump["distance_m"]), abs=0.01)
    assert replay["elapsed_seconds"] == 61
    assert replay["moving_seconds"] == 60

    reversed_track = imported(a, "cross-segment-reversal.gpx")
    replay = a.get(f"/api/v1/activities/{reversed_track['id']}/replay").json()["data"]
    assert replay["mode"] == "simulated"
    assert all(s["pace_s_per_km"] is None for s in replay["segments"])


def test_untimed_track_replays_at_a_steady_simulated_pace(clients):
    a, _, _, _ = clients
    register(a)
    activity = imported(a, "bad-time.gpx", {"activity_date": "2024-01-01"})
    replay = a.get(f"/api/v1/activities/{activity['id']}/replay").json()["data"]
    assert replay["mode"] == "simulated"
    assert replay["elapsed_seconds"] == pytest.approx(replay["distance_m"] * 0.36, abs=0.01)
