from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from geoalchemy2.elements import WKTElement

from app.modules.activities.model import Activity
from app.modules.gpx.model import ActivityPoint, ActivitySegment
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration


def test_milestones_use_owner_history_and_never_return_raw_coordinates(clients):  # noqa: F811
    a, b, _, app = clients
    owner, other = register(a), register(b)
    app.state.clock = lambda: datetime(2026, 10, 14, 15, tzinfo=UTC)
    with app.state.session_factory.begin() as db:
        for user, day, route in [
            (owner, "2026-10-12", "LINESTRING(121.48 31.23,121.49 31.237)"),
            (owner, "2026-10-13", "POINT(116.405 39.9)"),
            (owner, "2026-10-14", None),
            (owner, "2025-10-12", "LINESTRING(104.06 30.66,104.07 30.67)"),
            # A dateline crossing cannot spuriously light provinces halfway around the world.
            (owner, "2026-10-01", "LINESTRING(179 30,-179 30,-1 30,1 30)"),
            (other, "2026-10-11", "LINESTRING(104.06 30.66,104.07 30.67)"),
        ]:
            activity = Activity(
                user_id=UUID(user),
                source="gpx",
                title="Synthetic milestone",
                activity_date=date.fromisoformat(day),
                date_source="manual",
                timezone="Asia/Shanghai",
                distance_m=Decimal(1000),
                temporal_quality="manual",
                quality_summary={},
                metrics_version="gpx-v1",
            )
            db.add(activity)
            db.flush()
            if not route:
                continue
            single = route.startswith("POINT")
            segment = ActivitySegment(
                activity_id=activity.id,
                segment_index=0,
                source_track_index=0,
                source_segment_index=0,
                break_reason="source",
                point_count=1 if single else route.count(",") + 1,
                geom=None if single else WKTElement(route, srid=4326),
            )
            db.add(segment)
            db.flush()
            if single:
                db.add(
                    ActivityPoint(
                        segment_id=segment.id,
                        point_index=0,
                        source_point_index=0,
                        position=WKTElement(route, srid=4326),
                    )
                )
    streak = a.get("/api/v1/statistics/streaks")
    assert streak.status_code == 200
    data = streak.json()["data"]
    assert data["today"] == "2026-10-14"
    assert data["current_days"] == data["longest_days"] == 3
    assert b.get("/api/v1/statistics/streaks").json()["data"]["current_days"] == 0
    province = a.get("/api/v1/footprints/provinces?year=2026")
    assert province.status_code == 200
    data = province.json()["data"]
    assert data["total"] == 34
    assert {p["code"] for p in data["provinces"]} == {310000, 110000}
    assert data["activity_count"] == 4
    assert data["located_activity_count"] == 2
    assert all(p["activity_count"] == 1 for p in data["provinces"])
    assert "coordinates" not in province.text
    assert "activity_id" not in province.text
    assert {
        p["code"]
        for p in b.get("/api/v1/footprints/provinces?year=2026").json()["data"]["provinces"]
    } == {510000}
    assert (
        a.get("/api/v1/footprints/provinces?year=2025").json()["data"]["provinces"][0]["code"]
        == 510000
    )
    assert a.get("/api/v1/footprints/provinces?year=2200").status_code == 422
    a.cookies.clear()
    assert a.get("/api/v1/statistics/streaks").status_code == 401
    assert a.get("/api/v1/footprints/provinces?year=2026").status_code == 401
