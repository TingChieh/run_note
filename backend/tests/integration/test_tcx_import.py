"""TCX persistence/identity tests on a dedicated guarded synthetic database."""

# ruff: noqa: F811 -- pytest fixture imported for local registration
from decimal import Decimal

import pytest
from sqlalchemy import text

from tests.integration.test_gpx_import import clients, headers, register, upload  # noqa: F401
from tests.unit.test_tcx_parser import lap, tcx

pytestmark = pytest.mark.integration
PATH = "/api/v1/tcx-imports"


def upload_tcx(client, raw=None, fields=None):
    return client.post(
        PATH,
        headers=headers(client),
        files={"file": ("synthetic.tcx", raw or tcx(), "application/xml")},
        data={"timezone": "Asia/Shanghai", "time_mode": "local", **(fields or {})},
    )


def test_corrected_tcx_keeps_original_and_device_metrics_with_consistent_statistics(clients):
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    result = upload_tcx(a)
    assert result.status_code == 201, result.text
    activity = result.json()["data"]["activity"]
    identifier = activity["id"]
    assert activity["activity_date"] == "2026-10-04"
    assert activity["started_at"] == "2026-10-04T08:15:20Z"
    assert activity["ended_at"] == "2026-10-04T08:37:22Z"
    assert Decimal(activity["distance_m"]) == 2999
    assert Decimal(activity["elapsed_seconds"]) == 1322
    assert Decimal(activity["timer_seconds"]) == 1166
    assert Decimal(activity["avg_pace_seconds_per_km"]) == Decimal("388.796")
    assert activity["avg_heart_rate_bpm"] == 156
    assert activity["steps"] == 3262
    assert activity["calories_kcal"] == 144
    assert activity["visibility"] == "private"
    assert activity["quality_summary"]["time_interpretation"] == "local"
    assert a.get(f"/api/v1/activities/{identifier}").json()["data"] == activity
    assert b.get(f"/api/v1/activities/{identifier}").status_code == 404
    assert b.get(f"/api/v1/activities/{identifier}/route").status_code == 404
    assert a.get(f"/api/v1/activities/{identifier}/route").status_code == 200
    summary = a.get("/api/v1/statistics/summary").json()["data"]
    assert Decimal(summary["duration_sum_seconds"]) == 1166
    assert Decimal(summary["avg_pace_seconds_per_km"]) == Decimal("388.796")
    with engine.connect() as db:
        saved = db.execute(
            text("SELECT raw_tcx,time_mode,timezone FROM tcx_imports WHERE activity_id=:id"),
            {"id": identifier},
        ).one()
        assert bytes(saved.raw_tcx) == tcx()
        assert saved.time_mode == "local" and saved.timezone == "Asia/Shanghai"
        assert (
            db.scalar(text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner})
            == 1
        )
    # New physiological summaries must not be added to public/share allowlists.
    response = a.patch(
        f"/api/v1/activities/{identifier}", headers=headers(a), json={"visibility": "public"}
    )
    assert response.status_code == 200, response.text
    public = b.get(f"/api/v1/public/activities/{identifier}")
    assert public.status_code == 200, public.text
    assert Decimal(public.json()["data"]["elapsed_seconds"]) == 1166
    assert not (
        {"avg_heart_rate_bpm", "steps", "calories_kcal", "raw_tcx"} & public.json()["data"].keys()
    )


def test_absolute_mode_respects_file_offset_instead_of_filename_or_creator(clients):
    a, _, _, _ = clients
    register(a)
    result = upload_tcx(a, fields={"time_mode": "absolute"})
    assert result.status_code == 201, result.text
    assert result.json()["data"]["activity"]["activity_date"] == "2026-10-05"


def test_raw_duplicates_cannot_bypass_check_by_changing_time_mode_and_are_owner_scoped(clients):
    a, b, _, _ = clients
    register(a)
    register(b)
    first = upload_tcx(a)
    assert first.status_code == 201, first.text
    duplicate = upload_tcx(a, fields={"time_mode": "absolute"})
    assert duplicate.status_code == 409
    assert (
        duplicate.json()["error"]["details"][0]["existing_activity_id"]
        == first.json()["data"]["activity"]["id"]
    )
    assert upload_tcx(b).status_code == 201


def test_invalid_summary_date_conflict_or_extra_field_creates_no_activity(clients):
    a, _, engine, _ = clients
    owner = register(a)
    assert upload_tcx(a, raw=tcx([lap(distance="-1")])).status_code == 422
    assert upload_tcx(a, fields={"activity_date": "2026-10-05"}).status_code == 422
    assert upload_tcx(a, fields={"user_id": owner}).status_code == 422
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 0
        )


def test_auth_csrf_body_limits_and_multi_file_guard_apply_to_tcx(clients):
    a, _, _, _ = clients
    assert a.post(PATH, files={"file": ("run.tcx", tcx())}).status_code == 401
    register(a)
    assert a.post(PATH, files={"file": ("run.tcx", tcx())}).status_code == 403
    assert (
        a.post(
            PATH,
            headers={**headers(a), "Origin": "https://evil.example"},
            files={"file": ("run.tcx", tcx())},
        ).status_code
        == 403
    )
    assert (
        a.post(
            PATH, headers={**headers(a), "Content-Length": str(12 * 1024 * 1024)}, content=b"x"
        ).status_code
        == 413
    )
    assert (
        a.post(
            PATH, headers=headers(a), files=[("file", ("a.tcx", tcx())), ("file", ("b.tcx", tcx()))]
        ).status_code
        == 422
    )


def test_missing_device_totals_fall_back_to_track_duration_and_distance(clients):
    a, _, _, _ = clients
    register(a)
    raw = (
        tcx()
        .replace(b"<TotalTimeSeconds>1166</TotalTimeSeconds>", b"")
        .replace(b"<DistanceMeters>2999</DistanceMeters>", b"")
    )
    result = upload_tcx(a, raw=raw)
    assert result.status_code == 201, result.text
    activity = result.json()["data"]["activity"]
    assert activity["timer_seconds"] is None
    assert Decimal(activity["elapsed_seconds"]) == 1322
    # The >300-second gap is deliberately disconnected by existing quality rules.
    assert Decimal(activity["distance_m"]) == 0
    assert activity["avg_pace_seconds_per_km"] is None


def test_equivalent_cross_format_route_is_duplicate_in_both_directions(clients):
    a, b, _, _ = clients
    register(a)
    register(b)
    gpx = (
        b'<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>'
        b'<trkpt lat="0" lon="0"><time>2026-10-04T16:15:20Z</time></trkpt>'
        b'<trkpt lat="0" lon="0.001"><time>2026-10-04T16:37:22Z</time></trkpt>'
        b"</trkseg></trk></gpx>"
    )
    assert upload(a, raw=gpx).status_code == 201
    assert upload_tcx(a, fields={"time_mode": "absolute"}).status_code == 409
    assert upload_tcx(b, fields={"time_mode": "absolute"}).status_code == 201
    assert upload(b, raw=gpx).status_code == 409


@pytest.mark.parametrize("times", ["incomplete", "invalid", "zero_span"])
def test_valid_device_totals_preserve_pace_independently_of_track_time_quality(clients, times):
    a, _, _, _ = clients
    register(a)
    raw = tcx()
    if times == "incomplete":
        raw = raw.replace(b"<Time>2026-10-04T16:37:22Z</Time>", b"")
    elif times == "invalid":
        raw = raw.replace(b"2026-10-04T16:37:22Z", b"2026-10-04T16:00:00Z")
    else:
        raw = raw.replace(b"2026-10-04T16:37:22Z", b"2026-10-04T16:15:20Z").replace(
            b"<LongitudeDegrees>0.001", b"<LongitudeDegrees>0"
        )
    response = upload_tcx(a, raw=raw)
    assert response.status_code == 201, response.text
    activity = response.json()["data"]["activity"]
    assert Decimal(activity["timer_seconds"]) == 1166
    assert Decimal(activity["avg_pace_seconds_per_km"]) == Decimal("388.796")
    summary = a.get("/api/v1/statistics/summary").json()["data"]
    assert summary["pace_eligible_count"] == 1
    assert Decimal(summary["avg_pace_seconds_per_km"]) == Decimal("388.796")
