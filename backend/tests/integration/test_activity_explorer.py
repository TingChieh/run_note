"""Category browsing uses all owned history, never another runner's labels."""

# ruff: noqa: F811
from datetime import date
from uuid import UUID

import pytest
from sqlalchemy.orm import Session

from app.modules.activities.model import Activity
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration


def test_categories_and_filtered_history_are_owner_scoped_and_paginated(clients):
    a, b, engine, _ = clients
    assert a.get("/api/v1/activities/categories").status_code == 401
    owner, other = register(a), register(b)
    with Session(engine) as db:
        for user, category, count in [
            (owner, "轻松跑", 21),
            (owner, "", 1),
            (owner, "比赛&恢复", 1),
            (other, "他人分类", 1),
        ]:
            for index in range(count):
                db.add(
                    Activity(
                        user_id=UUID(user),
                        source="manual",
                        title=f"{category}{index}",
                        category=category,
                        activity_date=date(2026, 1, index + 1),
                        date_source="manual",
                        timezone="UTC",
                        distance_m=1000,
                        temporal_quality="manual",
                        quality_summary={},
                        metrics_version="test",
                    )
                )
        db.commit()
    response = a.get("/api/v1/activities/categories")
    assert response.status_code == 200, response.text
    assert set(response.json()["data"]) == {"", "轻松跑", "比赛&恢复"}
    first = a.get("/api/v1/activities", params={"category": "轻松跑"}).json()["data"]
    second = a.get("/api/v1/activities", params={"category": "轻松跑", "offset": 20}).json()["data"]
    assert first["total"] == second["total"] == 21
    assert len(first["items"]) == 20 and len(second["items"]) == 1
    assert first["items"][0]["activity_date"] == "2026-01-21"
    assert second["items"][0]["activity_date"] == "2026-01-01"
    assert all(item["category"] == "轻松跑" for item in first["items"] + second["items"])
    for category in ["", "比赛&恢复"]:
        result = a.get("/api/v1/activities", params={"category": category}).json()["data"]
        assert result["total"] == 1 and result["items"][0]["category"] == category
    assert a.get("/api/v1/activities", params={"category": "他人分类"}).json()["data"]["total"] == 0
    assert a.get("/api/v1/activities", params={"category": "轻松"}).json()["data"]["total"] == 0
    assert (
        a.get(
            "/api/v1/activities", params={"category": "轻松跑", "activity_date": "2026-01-21"}
        ).json()["data"]["total"]
        == 1
    )
    assert a.get("/api/v1/activities", params={"category": "字" * 31}).status_code == 422
    assert b.get("/api/v1/activities/categories").json()["data"] == ["他人分类"]


def test_month_filter_boundaries_and_category_owner_composition(clients):
    a, b, engine, _ = clients
    owner, other = register(a), register(b)
    with Session(engine) as db:
        for user, day, category in [
            (owner, date(2024, 2, 1), "轻松跑"),
            (owner, date(2024, 2, 29), "轻松跑"),
            (owner, date(2024, 3, 1), "轻松跑"),
            (owner, date(2024, 2, 20), "比赛"),
            (other, date(2024, 2, 10), "轻松跑"),
            (owner, date(2026, 12, 31), "轻松跑"),
        ]:
            db.add(
                Activity(
                    user_id=UUID(user),
                    source="manual",
                    title=str(day),
                    category=category,
                    activity_date=day,
                    date_source="manual",
                    timezone="UTC",
                    distance_m=1000,
                    temporal_quality="manual",
                    quality_summary={},
                    metrics_version="test",
                )
            )
        db.commit()
    result = a.get(
        "/api/v1/activities", params={"activity_month": "2024-02", "category": "轻松跑"}
    ).json()["data"]
    assert result["total"] == 2
    assert [item["activity_date"] for item in result["items"]] == ["2024-02-29", "2024-02-01"]
    assert (
        a.get(
            "/api/v1/activities",
            params={"activity_month": "2024-02", "activity_date": "2024-03-01"},
        ).json()["data"]["total"]
        == 0
    )
    assert (
        a.get("/api/v1/activities", params={"activity_month": "2026-12"}).json()["data"]["total"]
        == 1
    )
    assert (
        a.get("/api/v1/activities", params={"activity_month": "2024-01"}).json()["data"]["total"]
        == 0
    )
    for invalid in ["2024-13", "2024-00", "0000-01", "2024-2", "2024-02-01"]:
        assert a.get("/api/v1/activities", params={"activity_month": invalid}).status_code == 422
