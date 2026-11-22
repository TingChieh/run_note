"""Authoritative frontend UI block builders.

UI blocks are constructed exclusively from server-side tool results (never from model
prose) so charts, activity links, and summary cards always match authoritative metrics.
No GPS coordinates, raw files, notes, or wellbeing fields ever appear in UI blocks.
"""

from typing import Any

from app.modules.ai_assistant.schema import UIBlock


def build_ui_blocks(tool_name: str, sanitized_payload: dict[str, Any]) -> list[UIBlock]:
    if sanitized_payload.get("degraded") is True and "summary" not in sanitized_payload:
        return []

    if tool_name == "get_running_summary":
        return [
            UIBlock(
                type="metrics_card",
                data={
                    "date_from": sanitized_payload.get("date_from"),
                    "date_to": sanitized_payload.get("date_to"),
                    "scope": sanitized_payload.get("scope"),
                    "summary": sanitized_payload["summary"],
                    "device_metrics": sanitized_payload.get("device_metrics"),
                },
            )
        ]

    if tool_name == "get_running_trends":
        return [
            UIBlock(
                type="trend_chart",
                data={
                    "period": sanitized_payload["period"],
                    "date_from": sanitized_payload["date_from"],
                    "date_to": sanitized_payload["date_to"],
                    "date_assignment": sanitized_payload["date_assignment"],
                    "week_start": sanitized_payload["week_start"],
                    "buckets": sanitized_payload["buckets"],
                },
            )
        ]

    if tool_name == "get_period_report":
        return [UIBlock(type="period_card", data=dict(sanitized_payload))]

    if tool_name == "compare_periods":
        return [UIBlock(type="comparison_card", data=dict(sanitized_payload))]

    if tool_name == "get_personal_records":
        blocks: list[UIBlock] = []
        summary_data = {
            key: sanitized_payload[key]
            for key in ("personal_bests", "totals", "yearly", "weekday", "weekly")
            if key in sanitized_payload
        }
        if summary_data:
            blocks.append(UIBlock(type="records_summary", data=summary_data))
        if "monthly" in sanitized_payload:
            blocks.append(
                UIBlock(
                    type="records_chart",
                    data={
                        "monthly": sanitized_payload["monthly"],
                        "truncated": bool(sanitized_payload.get("monthly_truncated", False)),
                    },
                )
            )
        return blocks

    if tool_name == "get_streaks_and_goals":
        return [UIBlock(type="goals_streaks_card", data=dict(sanitized_payload))]

    if tool_name == "search_activities":
        return [
            UIBlock(
                type="activity_list",
                data={
                    "total": sanitized_payload["total"],
                    "activity_ids": [item["activity_id"] for item in sanitized_payload["items"]],
                    "items": sanitized_payload["items"],
                },
            )
        ]

    if tool_name == "get_activity_detail":
        return [
            UIBlock(
                type="activity_detail_card",
                data={
                    "activity_id": sanitized_payload["activity_id"],
                    "activity_date": sanitized_payload["activity_date"],
                    "category": sanitized_payload.get("category", ""),
                    "distance_m": sanitized_payload["distance_m"],
                    "duration_seconds": sanitized_payload.get("duration_seconds"),
                    "avg_pace_seconds_per_km": sanitized_payload.get("avg_pace_seconds_per_km"),
                    "avg_heart_rate_bpm": sanitized_payload.get("avg_heart_rate_bpm"),
                    "temporal_quality": sanitized_payload["temporal_quality"],
                    "has_route": sanitized_payload["has_route"],
                    "provinces": sanitized_payload.get("provinces", []),
                    "cities": sanitized_payload.get("cities", []),
                },
            )
        ]

    if tool_name == "get_footprint_summary":
        return [UIBlock(type="footprint_summary_card", data=dict(sanitized_payload))]

    if tool_name == "get_frequent_routes":
        return [UIBlock(type="route_group_list", data=dict(sanitized_payload))]

    return []
