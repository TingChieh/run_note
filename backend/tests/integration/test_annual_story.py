"""Integration tests for private GET /api/v1/statistics/annual-story."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.modules.activities.model import Activity
from app.modules.footprints import global_atlas
from app.modules.footprints.model import ActivityGlobalFootprintCache
from app.modules.gpx.model import ActivitySegment
from app.modules.route_groups.model import RouteFingerprint, RouteGroup, RouteGroupMember
from app.modules.shoes.model import Shoe
from tests.conftest import register

pytestmark = pytest.mark.integration


def _add_activity(
    db,
    owner,
    *,
    day: str,
    title: str,
    distance_m: int,
    duration_s: int | None,
    quality: str = "complete",
    source: str = "gpx",
    timezone: str = "Asia/Shanghai",
    started_at: datetime | None = None,
    shoe_id=None,
    line_wkt: str | None = None,
    city_code: str | None = None,
    region_code: str | None = None,
    create_fingerprint: bool = True,
):
    act = Activity(
        id=uuid4(),
        user_id=owner,
        shoe_id=shoe_id,
        source=source,
        title=title,
        activity_date=date.fromisoformat(day),
        date_source="timestamp",
        timezone=timezone,
        started_at=started_at or datetime.fromisoformat(f"{day}T06:30:00+08:00").astimezone(UTC),
        ended_at=None,
        distance_m=Decimal(distance_m),
        elapsed_seconds=Decimal(duration_s) if duration_s is not None else None,
        avg_pace_seconds_per_km=None,
        temporal_quality=quality,
        quality_summary={"warnings": []},
        metrics_version="gpx-v1",
    )
    db.add(act)
    db.flush()
    if line_wkt:
        db.add(
            ActivitySegment(
                id=uuid4(),
                activity_id=act.id,
                segment_index=0,
                source_track_index=0,
                source_segment_index=0,
                break_reason="none",
                point_count=3,
                geom=f"SRID=4326;{line_wkt}",
            )
        )
        if create_fingerprint:
            db.add(
                RouteFingerprint(
                    id=uuid4(),
                    user_id=owner,
                    activity_id=act.id,
                    algorithm_version="v1",
                    geom=f"SRID=4326;MULTILINESTRING({line_wkt.removeprefix('LINESTRING')})",
                )
            )
    if city_code or region_code:
        db.add(
            ActivityGlobalFootprintCache(
                id=uuid4(),
                user_id=owner,
                activity_id=act.id,
                atlas_version=global_atlas.atlas_version(),
                region_codes=[region_code] if region_code else [],
                city_codes=[city_code] if city_code else [],
            )
        )
    return act


def test_annual_story_full_beats_isolation_and_privacy_guards(clients):
    a, b, _, app = clients
    owner, other = register(a), register(b)

    # Pick two real atlas city codes so city metadata lookup succeeds deterministically.
    atlas = global_atlas._atlas()
    city_items = list(atlas["cities_by_code"].values())
    city_home = city_items[0]
    city_new = city_items[1]

    with app.state.session_factory.begin() as db:
        shoe_owner = Shoe(id=uuid4(), user_id=owner, name="轻云测试鞋")
        shoe_other = Shoe(id=uuid4(), user_id=other, name="他人跑鞋不可见")
        db.add_all([shoe_owner, shoe_other])
        db.flush()

        # Prior year visit to city_home so only city_new is marked is_new in 2025.
        _add_activity(
            db,
            owner,
            day="2024-06-01",
            title="去年旧城跑",
            distance_m=5000,
            duration_s=1500,
            line_wkt="LINESTRING(120.1 30.1, 120.12 30.12, 120.14 30.14)",
            city_code=city_home["code"],
            region_code=city_home["region_code"],
        )

        # 2025 runs for owner: first run, frequent loop x2, longest trackless, best 10km.
        r1 = _add_activity(
            db,
            owner,
            day="2025-01-01",
            title="环湖常规跑",
            distance_m=5200,
            duration_s=1716,
            line_wkt="LINESTRING(120.1 30.1, 120.11 30.11, 120.12 30.12)",
            city_code=city_home["code"],
            region_code=city_home["region_code"],
        )
        r2 = _add_activity(
            db,
            owner,
            day="2025-03-10",
            title="环湖常规跑",
            distance_m=5300,
            duration_s=1590,
            line_wkt="LINESTRING(120.1 30.1, 120.111 30.111, 120.121 30.121)",
            city_code=city_home["code"],
            region_code=city_home["region_code"],
        )
        r3 = _add_activity(
            db,
            owner,
            day="2025-05-18",
            title="新城竞速 10K",
            distance_m=10000,
            duration_s=2700,
            line_wkt="LINESTRING(121.4 31.2, 121.42 31.22, 121.45 31.25)",
            city_code=city_new["code"],
            region_code=city_new["region_code"],
        )
        # Longest run is intentionally trackless (manual) to verify confirmed default.
        r4 = _add_activity(
            db,
            owner,
            day="2025-10-12",
            title="室内半马耐力跑",
            distance_m=21100,
            duration_s=6600,
            source="manual",
            quality="manual",
            shoe_id=shoe_owner.id,
        )

        group = RouteGroup(id=uuid4(), user_id=owner, algorithm_version="v1")
        db.add(group)
        db.flush()
        db.add_all(
            [
                RouteGroupMember(
                    activity_id=r1.id, user_id=owner, group_id=group.id, coverage=0.95
                ),
                RouteGroupMember(
                    activity_id=r2.id, user_id=owner, group_id=group.id, coverage=0.96
                ),
            ]
        )

        # Another user's activity in 2025 must never appear in owner's story.
        _add_activity(
            db,
            other,
            day="2025-02-02",
            title="他人绝密跑步",
            distance_m=42195,
            duration_s=9000,
            shoe_id=shoe_other.id,
            line_wkt="LINESTRING(116.3 39.9, 116.35 39.95, 116.4 40.0)",
            city_code=city_new["code"],
            region_code=city_new["region_code"],
        )

    # Anonymous / showcase / invalid query protections.
    anon = a.__class__(app)
    assert anon.get("/api/v1/statistics/annual-story?year=2025").status_code == 401
    assert anon.get("/api/v1/showcase/statistics/annual-story?year=2025").status_code == 404
    assert a.get("/api/v1/statistics/annual-story?year=1800").status_code == 422
    assert a.get("/api/v1/statistics/annual-story?year=2025&extra=1").status_code == 422

    res = a.get("/api/v1/statistics/annual-story?year=2025")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "private, no-store"
    story = res.json()["data"]

    assert story["year"] == 2025
    assert story["is_partial"] is False
    assert story["summary"]["activity_count"] == 4
    assert Decimal(story["summary"]["distance_m"]) == Decimal(41600)

    # First run
    assert story["first_run"]["activity_id"] == str(r1.id)
    assert story["first_run"]["has_track"] is True
    assert len(story["first_run"]["shape"]) == 1

    # Longest run (trackless manual run eligible)
    assert story["longest_route"]["activity_id"] == str(r4.id)
    assert story["longest_route"]["has_track"] is False
    assert story["longest_route"]["shape"] == []
    assert story["longest_route"]["shoe_name"] == "轻云测试鞋"
    assert story["longest_route"]["same_as_first"] is False

    # Best performance prioritizes 10km band and marks all-time PB
    assert story["best_performance"]["basis"] == "standard_band"
    assert story["best_performance"]["category"] == "10km"
    assert story["best_performance"]["activity_id"] == str(r3.id)
    assert story["best_performance"]["is_all_time_pb"] is True
    assert any(o["category"] == "5km" for o in story["best_performance"]["other_bests"])

    # Explored cities distinguishes home vs newly discovered city
    cities = {c["code"]: c for c in story["explored_cities"]["items"]}
    assert story["explored_cities"]["status"] == "ready"
    assert story["explored_cities"]["total_cities"] == 2
    assert story["explored_cities"]["new_cities_count"] == 1
    assert cities[city_home["code"]]["is_new"] is False
    assert cities[city_new["code"]]["is_new"] is True

    # Most frequent route
    fr = story["frequent_route"]
    assert fr["status"] == "ready"
    assert fr["name"] == "环湖常规跑"
    assert fr["run_count"] == 2
    assert fr["share_pct"] == 50
    assert Decimal(fr["pace_improvement_seconds_per_km"]) == Decimal("30.000")
    assert len(fr["overlay_shapes"]) == 2

    # Footprint timeline
    tl = story["footprint_timeline"]
    assert tl["has_tracks"] is True
    assert tl["truncated"] is False
    assert tl["total_runs"] == 4
    assert tl["shown_runs"] == 4
    assert "他人绝密跑步" not in str(story)
    assert "他人跑鞋不可见" not in str(story)

    # Cross-user check: user B sees only their own single 2025 run.
    res_b = b.get("/api/v1/statistics/annual-story?year=2025")
    assert res_b.status_code == 200
    story_b = res_b.json()["data"]
    assert story_b["summary"]["activity_count"] == 1
    assert story_b["longest_route"]["same_as_first"] is True
    assert "环湖常规跑" not in str(story_b)


def test_annual_story_empty_future_partial_and_trackless_fallbacks(clients):
    a, _, _, app = clients
    owner = register(a)

    with app.state.session_factory.begin() as db:
        # Trackless activity missing duration -> distance_fallback for best performance
        _add_activity(
            db,
            owner,
            day="2024-04-10",
            title="无计时室内跑",
            distance_m=6000,
            duration_s=None,
            quality="incomplete",
            source="manual",
        )
        # Ensure no unprocessed route groups confuse the "none" check
        db.execute(
            text(
                """INSERT INTO route_fingerprints
                       (id, user_id, activity_id, algorithm_version, geom)
                   SELECT gen_random_uuid(), user_id, id, 'v1', NULL
                   FROM activities WHERE user_id = :owner"""
            ),
            {"owner": owner},
        )

    # Empty year
    empty = a.get("/api/v1/statistics/annual-story?year=2020").json()["data"]
    assert empty["summary"]["activity_count"] == 0
    assert empty["first_run"] is None
    assert empty["longest_route"] is None
    assert empty["best_performance"] is None
    assert empty["footprint_timeline"]["has_tracks"] is False

    # Future year
    future = a.get("/api/v1/statistics/annual-story?year=2099").json()["data"]
    assert future["date_from"] == future["date_to"]
    assert future["is_partial"] is False
    assert future["first_run"] is None

    # Trackless / missing-duration fallback year
    sparse = a.get("/api/v1/statistics/annual-story?year=2024").json()["data"]
    assert sparse["summary"]["activity_count"] == 1
    assert sparse["longest_route"]["same_as_first"] is True
    assert sparse["best_performance"]["basis"] == "distance_fallback"
    assert sparse["explored_cities"]["status"] == "ready"
    assert sparse["explored_cities"]["total_cities"] == 0
    assert sparse["explored_cities"]["pending_activity_count"] == 0
    assert sparse["explored_cities"]["unlocated_activity_count"] == 1
    assert sparse["frequent_route"]["status"] == "none"
    assert sparse["footprint_timeline"]["has_tracks"] is False
    assert Decimal(sparse["footprint_timeline"]["monthly_distance_m"][3]) == Decimal(6000)


def test_annual_story_pending_cities_building_routes_and_first_run_timezone(clients, monkeypatch):
    from app.modules.statistics import annual_story as annual_story_mod

    a, _, _, app = clients
    owner = register(a)
    # Lower inline threshold so 2 uncached tracked runs trigger status="pending".
    monkeypatch.setattr(annual_story_mod, "MAX_INLINE_CITY_COMPUTE", 1)

    with app.state.session_factory.begin() as db:
        # 2 tracked runs without cached global footprint OR route fingerprints:
        # first run is recorded in America/New_York at local 07:30 (UTC 12:30).
        _add_activity(
            db,
            owner,
            day="2023-01-01",
            title="跨时区新年第一跑",
            distance_m=5200,
            duration_s=1700,
            timezone="America/New_York",
            started_at=datetime(2023, 1, 1, 12, 30, 0, tzinfo=UTC),
            line_wkt="LINESTRING(120.1 30.1, 120.11 30.11, 120.12 30.12)",
            create_fingerprint=False,
        )
        _add_activity(
            db,
            owner,
            day="2023-02-05",
            title="未归并户外跑",
            distance_m=6000,
            duration_s=1900,
            line_wkt="LINESTRING(120.2 30.2, 120.21 30.21, 120.22 30.22)",
            create_fingerprint=False,
        )
        # 1 truly trackless run
        _add_activity(
            db,
            owner,
            day="2023-03-01",
            title="手动无轨迹跑",
            distance_m=4000,
            duration_s=1400,
            source="manual",
            create_fingerprint=False,
        )

    res = a.get("/api/v1/statistics/annual-story?year=2023")
    assert res.status_code == 200
    story = res.json()["data"]

    # P3-3: first run keeps its own activity timezone instead of account timezone
    assert story["first_run"]["activity_date"] == "2023-01-01"
    assert story["first_run"]["timezone"] == "America/New_York"

    # P2-1: pending tracked runs are counted in pending_activity_count, NOT unlocated_activity_count
    ec = story["explored_cities"]
    assert ec["status"] == "pending"
    assert ec["total_cities"] == 0
    assert ec["located_activity_count"] == 0
    assert ec["pending_activity_count"] == 2
    assert ec["unlocated_activity_count"] == 1
    assert (
        ec["located_activity_count"] + ec["unlocated_activity_count"] + ec["pending_activity_count"]
        == story["summary"]["activity_count"]
    )

    # P2-1: unprocessed route fingerprints report status="building", NOT "none"
    assert story["frequent_route"]["status"] == "building"
