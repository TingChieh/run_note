"""Cumulative province work must not starve concurrent dashboard requests."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Event
from uuid import UUID

import pytest
from sqlalchemy import text

from app.modules.activities.model import Activity
from app.modules.footprints import router
from app.modules.gpx.model import ActivitySegment
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration


def test_dense_cumulative_route_and_parallel_statistics_fit_query_budget(clients, monkeypatch):  # noqa: F811
    a, b, _, app = clients
    owner = register(a)
    b.app.state.settings.site_owner_email = a.app.state.settings.site_owner_email
    b.cookies.update(a.cookies)
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=UUID(owner),
            source="gpx",
            title="Synthetic dense route",
            activity_date=date(2026, 10, 14),
            date_source="manual",
            timezone="Asia/Shanghai",
            distance_m=Decimal(1000),
            temporal_quality="manual",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(activity)
        db.flush()
        # All 200,000 points are synthetic, between Beijing and Shanghai and below the point budget.
        # Multiple stored segments reproduce the cumulative-history query plan.
        geom = db.scalar(
            text("""SELECT ST_MakeLine(ST_SetSRID(ST_MakePoint(
            CASE WHEN i % 2 = 0 THEN 121.48 ELSE 116.405 END,
            CASE WHEN i % 2 = 0 THEN 31.23 ELSE 39.9 END),4326) ORDER BY i)
            FROM generate_series(1,1000) AS i""")
        )
        db.add_all(
            ActivitySegment(
                activity_id=activity.id,
                segment_index=index,
                source_track_index=0,
                source_segment_index=index,
                break_reason="source",
                point_count=1000,
                geom=geom,
            )
            for index in range(200)
        )

    calculating = Event()
    original = router.province_summary

    def calculate(*args, **kwargs):
        # The request has acquired its normal identity lock at this point.
        calculating.set()
        return original(*args, **kwargs)

    monkeypatch.setattr(router, "province_summary", calculate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        province = pool.submit(a.get, "/api/v1/footprints/provinces")
        assert calculating.wait(timeout=5)
        statistics = pool.submit(b.get, "/api/v1/statistics/calendar?year=2026")
        province_response = province.result(timeout=10)
        statistics_response = statistics.result(timeout=10)

    assert province_response.status_code == 200, province_response.text
    assert statistics_response.status_code == 200, statistics_response.text
    data = province_response.json()["data"]
    assert data["activity_count"] == data["located_activity_count"] == 1
    assert {110000, 310000} <= {p["code"] for p in data["provinces"]}
    assert all(p["activity_count"] == 1 for p in data["provinces"])
    assert statistics_response.json()["data"]["activity_count"] == 1


def test_cumulative_provinces_keep_working_past_the_former_point_budget(clients):  # noqa: F811
    """History growing past 250,000 points used to turn the all-time card into an error."""
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        activity = Activity(
            user_id=UUID(owner),
            source="gpx",
            title="Synthetic long history",
            activity_date=date(2026, 10, 14),
            date_source="manual",
            timezone="Asia/Shanghai",
            distance_m=Decimal(1000),
            temporal_quality="manual",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(activity)
        db.flush()
        geom = db.scalar(
            text("""SELECT ST_MakeLine(ST_SetSRID(ST_MakePoint(
            121.48 + i * 0.0001, 31.23 + (i % 7) * 0.0001), 4326) ORDER BY i)
            FROM generate_series(1,1000) AS i""")
        )
        # 300 segments x 1,000 points = 300,000 stored points, above the former 250,000 cap.
        db.add_all(
            ActivitySegment(
                activity_id=activity.id,
                segment_index=index,
                source_track_index=0,
                source_segment_index=index,
                break_reason="source",
                point_count=1000,
                geom=geom,
            )
            for index in range(300)
        )
    response = a.get("/api/v1/footprints/provinces")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["activity_count"] == 1
    assert {p["code"] for p in data["provinces"]} == {310000}
