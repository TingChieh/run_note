"""Unit tests for shared statistics calculations, AI assistant tools, privacy, and UI blocks."""

import json
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.core.errors import ApiError
from app.modules.ai_assistant.blocks import build_ui_blocks
from app.modules.ai_assistant.privacy import (
    PrivacyViolationError,
    assert_outbound_safe,
    sanitize_tool_calls_summary,
    sanitize_tool_output,
    sanitize_ui_blocks,
)
from app.modules.ai_assistant.provider import build_chat_request
from app.modules.ai_assistant.tools import (
    TOOL_NAMES,
    ToolContext,
    ToolInputError,
    execute_tool,
    tool_definitions,
)
from app.modules.statistics.device_metrics import DEVICE_METRIC_KEYS, change_rate, finalize


def test_shared_statistics_device_metrics():
    assert DEVICE_METRIC_KEYS == (
        "heart_rate_record_count",
        "heart_rate_weighted_count",
        "heart_rate_weighted_duration_seconds",
        "avg_heart_rate_bpm",
        "calories_record_count",
        "calories_kcal",
        "steps_record_count",
        "steps",
    )
    assert change_rate(1500, 1000) == "50.000"
    assert change_rate(1000, 0) is None
    assert finalize({}) == {
        "heart_rate_record_count": 0,
        "heart_rate_weighted_count": 0,
        "heart_rate_weighted_duration_seconds": None,
        "avg_heart_rate_bpm": None,
        "calories_record_count": 0,
        "calories_kcal": None,
        "steps_record_count": 0,
        "steps": None,
    }


def test_ai_assistant_settings_defaults_match_confirmed_decisions():
    s = Settings(database_url="postgresql+psycopg://fake:fake@127.0.0.1:1/test", _env_file=None)
    assert s.ai_assistant_enabled is True
    assert s.ai_daily_message_limit == 30
    assert s.ai_daily_token_budget == 150_000
    assert s.ai_site_daily_token_budget == 1_000_000
    assert s.ai_stream_total_timeout_seconds == 90
    assert s.ai_upstream_read_timeout_seconds == 30
    assert s.ai_max_tool_rounds == 4
    assert s.ai_max_output_tokens == 2048


def test_tool_definitions_expose_only_10_read_only_tools_without_owner_or_sql_params():
    defs = tool_definitions()
    assert len(defs) == 10
    assert [item["function"]["name"] for item in defs] == list(TOOL_NAMES)
    forbidden_param_names = {
        "user_id",
        "owner",
        "owner_id",
        "username",
        "email",
        "sql",
        "query",
        "notes",
        "title",
    }
    for item in defs:
        params = item["function"]["parameters"]
        assert params.get("additionalProperties") is False
        props = set(params.get("properties", {}))
        assert not (props & forbidden_param_names), (item["function"]["name"], props)


@pytest.mark.parametrize(
    "tool_name,bad_args",
    [
        ("unknown_tool", {}),
        ("get_running_summary", {"user_id": str(uuid4())}),
        ("get_running_summary", {"date_from": "2026-01-01"}),
        ("get_running_summary", {"date_from": "2026-02-01", "date_to": "2026-01-01"}),
        ("get_running_trends", {"date_from": "2026-01-01", "date_to": "2026-01-01"}),
        (
            "get_running_trends",
            {"date_from": "2026-01-01", "date_to": "2026-02-01", "period": "day"},
        ),
        ("get_period_report", {"period": "month", "year": 2026}),
        ("get_period_report", {"period": "year", "year": 2026, "month": 1}),
        ("get_period_report", {"period": "year", "year": 1899}),
        (
            "compare_periods",
            {
                "period_a": {"date_from": "2026-02-01", "date_to": "2026-01-01"},
                "period_b": {"date_from": "2025-01-01", "date_to": "2025-02-01"},
            },
        ),
        ("get_personal_records", {"sections": []}),
        ("get_personal_records", {"sections": ["wellbeing"]}),
        ("get_streaks_and_goals", {"owner": "someone"}),
        ("search_activities", {"limit": 21}),
        ("search_activities", {"limit": 0}),
        ("search_activities", {"limit": True}),
        ("search_activities", {"min_distance_m": 10000, "max_distance_m": 5000}),
        ("search_activities", {"title": "park"}),
        ("search_activities", {"notes": "secret"}),
        ("get_activity_detail", {"activity_id": "not-a-uuid"}),
        ("get_footprint_summary", {"scope": "mars"}),
        ("get_footprint_summary", {"limit": 35}),
        ("get_frequent_routes", {"limit": 11}),
        ("get_frequent_routes", {"sort": "sql_injection"}),
    ],
)
def test_execute_tool_rejects_invalid_and_forbidden_arguments(tool_name, bad_args):
    ctx = ToolContext(owner_id=uuid4(), timezone="Asia/Shanghai", today=date(2026, 11, 22))
    with pytest.raises(ToolInputError):
        execute_tool(None, ctx, tool_name, bad_args)


def test_privacy_sanitizer_strips_d3_d4_l3_fields_and_blocks_leaks():
    raw_detail = {
        "activity_id": str(uuid4()),
        "activity_date": "2026-11-20",
        "timezone": "Asia/Shanghai",
        "category": "10km",
        "distance_m": "10000.000",
        "elapsed_seconds": "3000.000",
        "timer_seconds": "2950.000",
        "duration_seconds": "2950.000",
        "avg_pace_seconds_per_km": "295.000",
        "calories_kcal": 620,
        "steps": 9500,
        "avg_heart_rate_bpm": 152,
        "max_heart_rate_bpm": 172,
        "min_heart_rate_bpm": 118,
        "avg_cadence_spm": "178.000",
        "max_cadence_spm": "188.000",
        "vo2_max_ml_kg_min": "52.000",
        "training_load": "95.000",
        "aerobic_training_effect": "3.800",
        "anaerobic_training_effect": "1.200",
        "temporal_quality": "complete",
        "quality_warnings": [],
        "has_route": True,
        "provinces": ["浙江省"],
        "cities": ["杭州市"],
        # Injected forbidden fields that must be stripped by allowlist reconstruction:
        "title": "SECRET_TITLE_HOME_LOOP",
        "tags": ["SECRET_TAG"],
        "notes": "SECRET_NOTE_KNEE_PAIN",
        "email": "secret@example.com",
        "coordinates": [[120.15, 30.28]],
        "original_filename": "home.gpx",
        "medication_name": "secret-med",
        "visibility": "private",
    }
    sanitized, truncated = sanitize_tool_output("get_activity_detail", raw_detail)
    assert truncated is False
    text_out = json.dumps(sanitized, ensure_ascii=False)
    for forbidden in (
        "SECRET_TITLE_HOME_LOOP",
        "SECRET_TAG",
        "SECRET_NOTE_KNEE_PAIN",
        "secret@example.com",
        "120.15",
        "home.gpx",
        "secret-med",
        "visibility",
    ):
        assert forbidden not in text_out
    assert sanitized["provinces"] == ["浙江省"]
    assert sanitized["cities"] == ["杭州市"]


def test_privacy_sanitizer_strips_global_footprint_geometry_and_coordinates():
    raw_global = {
        "scope": "global",
        "year": 2026,
        "activity_count": 10,
        "located_activity_count": 9,
        "country_count": 1,
        "region_count": 1,
        "city_count": 1,
        "cached_only": False,
        "region_features": {"type": "FeatureCollection", "features": [{"geometry": "POLYGON"}]},
        "countries": [
            {
                "code": "CN",
                "name": "China",
                "activity_count": 9,
                "distance_m": 90000.0,
                "region_count": 1,
                "city_count": 1,
                "bounds": [118.0, 27.0, 123.0, 31.0],
                "regions": [
                    {
                        "code": "CN-ZJ",
                        "name": "Zhejiang",
                        "activity_count": 9,
                        "distance_m": 90000.0,
                        "bounds": [118.0, 27.0, 123.0, 31.0],
                        "center": [120.15, 30.28],
                        "cities": [
                            {
                                "code": "CN-ZJ-HZ",
                                "name": "Hangzhou",
                                "activity_count": 9,
                                "distance_m": 90000.0,
                                "lon": 120.1551,
                                "lat": 30.2741,
                            }
                        ],
                    }
                ],
            }
        ],
    }
    sanitized, _ = sanitize_tool_output("get_footprint_summary", raw_global)
    text_out = json.dumps(sanitized, ensure_ascii=False)
    for forbidden in ("region_features", "POLYGON", "bounds", "center", "120.1551", "30.2741"):
        assert forbidden not in text_out
    assert sanitized["countries"][0]["regions"][0]["cities"][0]["name"] == "Hangzhou"


def test_assert_outbound_safe_catches_nested_forbidden_keys():
    with pytest.raises(PrivacyViolationError):
        assert_outbound_safe({"items": [{"nested": {"notes": "should fail"}}]})
    with pytest.raises(PrivacyViolationError):
        assert_outbound_safe({"group": {"shape": [[120.0, 30.0]]}})
    with pytest.raises(PrivacyViolationError):
        assert_outbound_safe({"entry": {"mood": 7}})


def test_payload_size_cap_truncates_oversized_list_cleanly():
    items = [
        {
            "activity_id": str(uuid4()),
            "activity_date": "2026-11-01",
            "category": "10km",
            "distance_m": "10000.000",
            "duration_seconds": "3000.000",
            "avg_pace_seconds_per_km": "300.000",
            "avg_heart_rate_bpm": 150,
            "temporal_quality": "complete",
            "has_route": True,
        }
        for _ in range(20)
    ]
    sanitized, truncated = sanitize_tool_output(
        "search_activities", {"total": 20, "items": items}, max_bytes=1200
    )
    assert truncated is True
    assert sanitized["truncated"] is True
    assert len(sanitized["items"]) < 20
    encoded = json.dumps(sanitized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    assert len(encoded) <= 1200


def test_execute_tool_degrades_gracefully_on_statement_timeout():
    class _Nested:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class _TimeoutDB:
        def begin_nested(self):
            return _Nested()

        def execute(self, statement, *_args, **_kwargs):
            if "SET LOCAL" in str(statement):
                return None
            orig = SimpleNamespace(sqlstate="57014")
            raise DBAPIError("SELECT 1", {}, orig)

    ctx = ToolContext(owner_id=uuid4(), timezone="Asia/Shanghai", today=date(2026, 11, 22))
    result = execute_tool(_TimeoutDB(), ctx, "search_activities", {"limit": 5})
    assert result.degraded is True
    assert result.model_payload["degraded"] is True
    assert result.model_payload["reason"] == "timeout"
    assert result.ui_blocks == []


def test_footprint_summary_falls_back_to_cache_only_on_limit(monkeypatch):
    from app.modules.ai_assistant import tools as assistant_tools
    from app.modules.footprints import provinces

    def _boom(_db, _owner, _year=None):
        raise ApiError(422, "PROVINCE_LIMIT", "省份足迹计算较慢，请稍后重试")

    def _cached(_db, _owner, year, _limit):
        return {
            "scope": "china",
            "year": year,
            "total_provinces": 34,
            "visited_province_count": 1,
            "activity_count": 10,
            "located_activity_count": 4,
            "cached_only": True,
            "provinces": [{"code": 330000, "name": "浙江省", "activity_count": 4}],
        }

    monkeypatch.setattr(provinces, "province_summary", _boom)
    monkeypatch.setattr(assistant_tools, "_cached_china_provinces_only", _cached)
    ctx = ToolContext(owner_id=uuid4(), timezone="Asia/Shanghai", today=date(2026, 11, 22))
    result = execute_tool(None, ctx, "get_footprint_summary", {"scope": "china", "year": 2026})
    assert result.degraded is True
    assert result.model_payload["cached_only"] is True
    assert result.model_payload["provinces"][0]["name"] == "浙江省"
    assert result.ui_blocks[0].type == "footprint_summary_card"


def test_payload_size_cap_truncates_oversized_yearly_records_keeping_most_recent():
    yearly = [
        {
            "year": year,
            "activity_count": 10,
            "distance_m": "100000.000",
            "activity_days": 10,
            "avg_pace_seconds_per_km": "300.000",
            "is_partial": year == 2026,
            "delta_basis": "previous_year" if year > 1960 else None,
            "delta": (
                {
                    "activity_count": 0,
                    "distance_m": "0.000",
                    "avg_pace_seconds_per_km": "0.000",
                }
                if year > 1960
                else None
            ),
        }
        for year in range(1960, 2027)
    ]
    sanitized, truncated = sanitize_tool_output(
        "get_personal_records",
        {"date_assignment": "activity_local_date", "yearly": yearly},
    )
    assert truncated is True
    assert sanitized["truncated"] is True
    assert len(sanitized["yearly"]) < len(yearly)
    assert sanitized["yearly"][-1]["year"] == 2026
    encoded = json.dumps(sanitized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    assert len(encoded) <= 12_288


def test_ui_blocks_builder_produces_typed_blocks_for_records():
    blocks = build_ui_blocks(
        "get_personal_records",
        {
            "date_assignment": "activity_local_date",
            "totals": {
                "activity_count": 2,
                "distance_m": "15000.000",
                "activity_days": 2,
                "avg_pace_seconds_per_km": "300.000",
                "first_activity_date": "2026-01-01",
            },
            "monthly": [
                {
                    "month_start": "2026-01-01",
                    "activity_count": 2,
                    "distance_m": "15000.000",
                    "avg_pace_seconds_per_km": "300.000",
                }
            ],
        },
    )
    assert [b.type for b in blocks] == ["records_summary", "records_chart"]


def test_payload_size_cap_trims_nested_cities_in_global_footprints():
    raw_global = {
        "scope": "global",
        "year": 2026,
        "activity_count": 100,
        "located_activity_count": 100,
        "country_count": 1,
        "region_count": 1,
        "city_count": 60,
        "cached_only": False,
        "countries": [
            {
                "code": "CN",
                "name": "China",
                "activity_count": 100,
                "distance_m": 100000.0,
                "region_count": 1,
                "city_count": 60,
                "regions": [
                    {
                        "code": "CN-ZJ",
                        "name": "Zhejiang",
                        "activity_count": 100,
                        "distance_m": 100000.0,
                        "cities": [
                            {
                                "code": f"CN-ZJ-{idx:03d}",
                                "name": f"CityNameLongSuffix_{idx:03d}",
                                "activity_count": 60 - idx,
                                "distance_m": 1000.0,
                            }
                            for idx in range(60)
                        ],
                    }
                ],
            }
        ],
    }
    sanitized, truncated = sanitize_tool_output("get_footprint_summary", raw_global, max_bytes=1200)
    assert truncated is True
    assert sanitized["truncated"] is True
    encoded = json.dumps(sanitized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    assert len(encoded) <= 1200
    assert len(sanitized["countries"]) == 1
    assert len(sanitized["countries"][0]["regions"][0]["cities"]) < 60


def test_write_time_sanitizers_block_forbidden_keys_and_keep_safe_fields():
    summary = sanitize_tool_calls_summary(
        [
            {
                "tool": "get_running_summary",
                "duration_ms": 18,
                "degraded": False,
                "truncated": False,
                "notes": "must-be-dropped",
            }
        ]
    )
    assert summary == [
        {
            "tool": "get_running_summary",
            "duration_ms": 18,
            "degraded": False,
            "truncated": False,
        }
    ]
    with pytest.raises(PrivacyViolationError):
        sanitize_ui_blocks([{"type": "metrics_card", "data": {"notes": "leaked"}}])
    with pytest.raises(PrivacyViolationError):
        sanitize_ui_blocks([{"type": "metrics_card", "data": {"png": "base64"}}])
    with pytest.raises(PrivacyViolationError):
        sanitize_ui_blocks([{"type": "metrics_card", "data": {"coordinates": [[120.1, 30.2]]}}])


def test_build_chat_request_disables_thinking_and_sets_streaming_tools():
    s = Settings(
        database_url="postgresql+psycopg://fake:fake@127.0.0.1:1/test",
        ai_model="deepseek-chat",
        ai_max_output_tokens=2048,
        _env_file=None,
    )
    with_tools = build_chat_request([{"role": "user", "content": "hi"}], tool_definitions(), s)
    assert with_tools["model"] == "deepseek-chat"
    assert with_tools["stream"] is True
    assert with_tools["stream_options"] == {"include_usage": True}
    assert with_tools["thinking"] == {"type": "disabled"}
    assert with_tools["tool_choice"] == "auto"
    assert len(with_tools["tools"]) == 10

    without_tools = build_chat_request([{"role": "user", "content": "hi"}], [], s)
    assert "tools" not in without_tools
    assert "tool_choice" not in without_tools
