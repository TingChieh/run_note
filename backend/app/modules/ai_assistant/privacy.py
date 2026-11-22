"""Outbound privacy allowlist, forbidden-key guard, and payload size capping.

Every payload leaving RunNote toward DeepSeek must be reconstructed through explicit
allowlists here and pass `assert_outbound_safe` before serialization.
"""

import json
from typing import Any

from app.modules.statistics.device_metrics import DEVICE_METRIC_KEYS

MAX_TOOL_OUTPUT_BYTES = 12_288

# Defense-in-depth denylist: any accidental appearance of these keys in an outbound
# model payload is rejected immediately. Aligned with D3 (title/tags excluded), D4
# (no coordinates/geometry), and L3 (no wellbeing, photos, notes, raw files, credentials).
FORBIDDEN_OUTBOUND_KEYS: frozenset[str] = frozenset(
    {
        # Account & auth
        "email",
        "email_normalized",
        "username",
        "password",
        "password_hash",
        "bio",
        "is_admin",
        "token_hash",
        "csrf_token",
        "api_key",
        "authorization",
        # Private free text & D3 excluded activity text
        "notes",
        "note",
        "title",
        "applied_title",
        "tags",
        # Raw import files & images/photos
        "filename",
        "original_filename",
        "raw",
        "raw_gpx",
        "raw_tcx",
        "raw_bytes",
        "png",
        "png_bytes",
        "avatar_url",
        "photo",
        "photos",
        # Exact spatial geometry / coordinates
        "coordinates",
        "geometry",
        "geom",
        "shape",
        "bounds",
        "center",
        "lon",
        "lat",
        "longitude",
        "latitude",
        "start",
        "end",
        "region_features",
        "features",
        # Wellbeing module fields (hard isolation)
        "medication_name",
        "medications",
        "symptom",
        "symptoms",
        "mood",
        "anxiety",
        "energy",
        "focus",
        "functioning",
        "sleep_hours",
        "sleep_quality",
        "sleep_wakeups",
        "dose_amount",
        "dose_unit",
        "pills",
        # Sharing / visibility internals
        "visibility",
        "allow_shared_route",
    }
)

SUMMARY_KEYS = (
    "activity_count",
    "distance_m",
    "activity_days",
    "duration_sum_seconds",
    "known_duration_count",
    "missing_duration_count",
    "pace_eligible_count",
    "pace_eligible_distance_m",
    "avg_pace_seconds_per_km",
    "quality_warning_count",
    "date_assignment",
)

BUCKET_KEYS = (
    "bucket_start",
    "bucket_end",
    "is_partial",
    *SUMMARY_KEYS,
    "distance_change_pct",
)

ACTIVITY_ITEM_KEYS = (
    "activity_id",
    "activity_date",
    "category",
    "distance_m",
    "duration_seconds",
    "avg_pace_seconds_per_km",
    "avg_heart_rate_bpm",
    "temporal_quality",
    "has_route",
)

ACTIVITY_DETAIL_KEYS = (
    "activity_id",
    "activity_date",
    "timezone",
    "category",
    "distance_m",
    "elapsed_seconds",
    "timer_seconds",
    "duration_seconds",
    "avg_pace_seconds_per_km",
    "calories_kcal",
    "steps",
    "avg_heart_rate_bpm",
    "max_heart_rate_bpm",
    "min_heart_rate_bpm",
    "avg_cadence_spm",
    "max_cadence_spm",
    "vo2_max_ml_kg_min",
    "training_load",
    "aerobic_training_effect",
    "anaerobic_training_effect",
    "temporal_quality",
    "quality_warnings",
    "has_route",
    "provinces",
    "cities",
)


class PrivacyViolationError(RuntimeError):
    """Raised when a forbidden field attempts to enter an outbound model payload."""


def _pick(source: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: source[key] for key in keys if key in source}


def _clean_device_metrics(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if raw is None:
        return None
    return {key: raw[key] for key in DEVICE_METRIC_KEYS if key in raw}


def assert_outbound_safe(value: Any, *, path: str = "$") -> None:
    """Recursively verify no forbidden key exists anywhere in the outbound payload."""
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in FORBIDDEN_OUTBOUND_KEYS:
                raise PrivacyViolationError(f"Forbidden outbound key at {path}.{key}")
            assert_outbound_safe(item, path=f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            assert_outbound_safe(item, path=f"{path}[{index}]")


def _encode_size(payload: dict[str, Any]) -> int:
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _trim_nested_cities(result: dict[str, Any], max_bytes: int) -> bool:
    """Trim nested cities inside global footprint countries/regions before dropping regions."""
    countries = result.get("countries")
    if not isinstance(countries, list):
        return False
    # Deep-copy nested structures before mutating.
    copied = [
        {
            **country,
            "regions": [
                {**region, "cities": list(region.get("cities", []))}
                for region in country.get("regions", [])
            ],
        }
        for country in countries
    ]
    trimmed = False
    while _encode_size({**result, "countries": copied, "truncated": True}) > max_bytes:
        # Pop the tail city from the region that currently holds the most cities.
        candidates = [
            region for country in copied for region in country["regions"] if region["cities"]
        ]
        if not candidates:
            break
        richest = max(candidates, key=lambda r: len(r["cities"]))
        richest["cities"].pop()
        trimmed = True
    if trimmed:
        result["countries"] = copied
        result["truncated"] = True
    return trimmed


def _cap_payload_size(
    payload: dict[str, Any], *, list_key: str | None = None, max_bytes: int = MAX_TOOL_OUTPUT_BYTES
) -> tuple[dict[str, Any], bool]:
    """Ensure serialized payload stays within `max_bytes`; truncate list items if needed."""
    if _encode_size(payload) <= max_bytes:
        return payload, False
    result = dict(payload)
    truncated = False
    if list_key == "countries" and _trim_nested_cities(result, max_bytes):
        truncated = True
        if _encode_size(result) <= max_bytes:
            return result, True
    chronological = {"monthly", "weekly", "yearly", "buckets"}
    if list_key and isinstance(result.get(list_key), list):
        items = list(result[list_key])
        total_before = len(items)
        pop_index = 0 if list_key in chronological else -1
        while (
            items
            and _encode_size(
                {
                    **result,
                    list_key: items,
                    "truncated": True,
                    "returned_count": len(items),
                    "untruncated_count": total_before,
                }
            )
            > max_bytes
        ):
            items.pop(pop_index)
        result[list_key] = items
        result["truncated"] = True
        result["returned_count"] = len(items)
        result["untruncated_count"] = total_before
        truncated = True
    if _encode_size(result) > max_bytes:
        # Fallback: trim any bulky list fields (keeping most recent entries for time series).
        for key in (
            "monthly",
            "weekly",
            "yearly",
            "buckets",
            "runs",
            "groups",
            "cities",
            "regions",
            "countries",
            "provinces",
            "items",
        ):
            if isinstance(result.get(key), list) and result[key]:
                items = list(result[key])
                pop_index = 0 if key in chronological else -1
                while items and _encode_size({**result, key: items, "truncated": True}) > max_bytes:
                    items.pop(pop_index)
                result[key] = items
                result["truncated"] = True
                truncated = True
                if _encode_size(result) <= max_bytes:
                    break
    return result, truncated


ALLOWED_TOOL_SUMMARY_KEYS = ("tool", "duration_ms", "degraded", "truncated", "error_code")


def sanitize_tool_calls_summary(entries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Allowlist-sanitize persisted tool execution metadata (never store raw arguments/text)."""
    cleaned: list[dict[str, Any]] = []
    for entry in (entries or [])[:16]:
        if not isinstance(entry, dict):
            continue
        item = {
            "tool": str(entry.get("tool", ""))[:64],
            "duration_ms": max(0, int(entry.get("duration_ms", 0))),
            "degraded": bool(entry.get("degraded", False)),
            "truncated": bool(entry.get("truncated", False)),
        }
        error_code = entry.get("error_code")
        if isinstance(error_code, str) and error_code:
            item["error_code"] = error_code[:50]
        cleaned.append(item)
    assert_outbound_safe(cleaned)
    return cleaned


def sanitize_ui_blocks(blocks: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Defense-in-depth privacy check before persisting UI blocks to PostgreSQL."""
    sanitized = list((blocks or [])[:12])
    assert_outbound_safe(sanitized)
    return sanitized


def sanitize_tool_output(
    tool_name: str, raw: dict[str, Any], *, max_bytes: int = MAX_TOOL_OUTPUT_BYTES
) -> tuple[dict[str, Any], bool]:
    """Reconstruct an explicit allowlist payload for DeepSeek and enforce privacy + size caps."""
    if raw.get("degraded") is True and "summary" not in raw and "items" not in raw:
        # Pure degraded response (e.g. statement timeout fallback with no rows).
        out = {
            "degraded": True,
            "reason": str(raw.get("reason", "unavailable")),
            "message": str(raw.get("message", "查询受限，请缩小范围后重试")),
        }
        assert_outbound_safe(out)
        return out, False

    list_key: str | None = None
    if tool_name == "get_running_summary":
        out = {
            "date_from": raw.get("date_from"),
            "date_to": raw.get("date_to"),
            "scope": raw.get("scope"),
            "summary": _pick(raw["summary"], SUMMARY_KEYS),
            "device_metrics": _clean_device_metrics(raw.get("device_metrics")),
            "limitations": list(raw.get("limitations", [])),
        }
    elif tool_name == "get_running_trends":
        list_key = "buckets"
        buckets = []
        for bucket in raw.get("buckets", []):
            item = _pick(bucket, BUCKET_KEYS)
            if "device_metrics" in bucket and bucket["device_metrics"] is not None:
                item["device_metrics"] = _clean_device_metrics(bucket["device_metrics"])
            buckets.append(item)
        out = {
            "period": raw["period"],
            "date_from": raw["date_from"],
            "date_to": raw["date_to"],
            "week_start": raw.get("week_start", "monday"),
            "date_assignment": raw.get("date_assignment", "activity_local_date"),
            "bucket_count": len(buckets),
            "truncated": bool(raw.get("truncated", False)),
            "buckets": buckets,
        }
    elif tool_name == "get_period_report":
        out = {
            "period": raw["period"],
            "year": raw["year"],
            "month": raw.get("month"),
            "date_from": raw["date_from"],
            "date_to": raw["date_to"],
            "is_partial": raw["is_partial"],
            "cutoff_date": raw.get("cutoff_date"),
            "today": raw["today"],
            **_pick(raw, SUMMARY_KEYS),
        }
    elif tool_name == "compare_periods":
        out = {
            "period_a": {
                "label": raw["period_a"].get("label"),
                "date_from": raw["period_a"]["date_from"],
                "date_to": raw["period_a"]["date_to"],
                "summary": _pick(raw["period_a"]["summary"], SUMMARY_KEYS),
                "device_metrics": _clean_device_metrics(raw["period_a"].get("device_metrics")),
            },
            "period_b": {
                "label": raw["period_b"].get("label"),
                "date_from": raw["period_b"]["date_from"],
                "date_to": raw["period_b"]["date_to"],
                "summary": _pick(raw["period_b"]["summary"], SUMMARY_KEYS),
                "device_metrics": _clean_device_metrics(raw["period_b"].get("device_metrics")),
            },
            "delta": {
                key: raw["delta"].get(key)
                for key in (
                    "activity_count_diff",
                    "activity_days_diff",
                    "distance_m_diff",
                    "distance_change_pct",
                    "avg_pace_seconds_per_km_diff",
                    "avg_heart_rate_bpm_diff",
                )
            },
        }
    elif tool_name == "get_personal_records":
        out = {"date_assignment": raw.get("date_assignment", "activity_local_date")}
        if "personal_bests" in raw:
            bests = []
            for entry in raw["personal_bests"]:
                bests.append(
                    {
                        "category": entry["category"],
                        "best": _pick(
                            entry["best"],
                            (
                                "activity_id",
                                "activity_date",
                                "distance_m",
                                "duration_seconds",
                                "avg_pace_seconds_per_km",
                                "qualifying_count",
                            ),
                        )
                        if entry.get("best")
                        else None,
                        "first": _pick(
                            entry["first"],
                            (
                                "activity_id",
                                "activity_date",
                                "distance_m",
                                "duration_seconds",
                                "avg_pace_seconds_per_km",
                            ),
                        )
                        if entry.get("first")
                        else None,
                        "pace_gain_seconds_per_km": entry.get("pace_gain_seconds_per_km"),
                    }
                )
            out["personal_bests"] = bests
        if "totals" in raw:
            out["totals"] = _pick(
                raw["totals"],
                (
                    "activity_count",
                    "distance_m",
                    "activity_days",
                    "avg_pace_seconds_per_km",
                    "first_activity_date",
                ),
            )
        if "yearly" in raw:
            out["yearly"] = [
                {
                    "year": row["year"],
                    "activity_count": row["activity_count"],
                    "distance_m": row["distance_m"],
                    "activity_days": row["activity_days"],
                    "avg_pace_seconds_per_km": row["avg_pace_seconds_per_km"],
                    "is_partial": row["is_partial"],
                    "delta_basis": row.get("delta_basis"),
                    "delta": _pick(
                        row["delta"],
                        ("activity_count", "distance_m", "avg_pace_seconds_per_km"),
                    )
                    if row.get("delta")
                    else None,
                }
                for row in raw["yearly"]
            ]
        if "weekday" in raw:
            out["weekday"] = [
                {"weekday": row["weekday"], "activity_count": row["activity_count"]}
                for row in raw["weekday"]
            ]
        if "weekly" in raw:
            out["weekly"] = [
                {"week_start": row["week_start"], "active_days": row["active_days"]}
                for row in raw["weekly"]
            ]
        if "monthly" in raw:
            list_key = "monthly"
            out["monthly"] = [
                {
                    "month_start": row["month_start"],
                    "activity_count": row["activity_count"],
                    "distance_m": row["distance_m"],
                    "avg_pace_seconds_per_km": row["avg_pace_seconds_per_km"],
                }
                for row in raw["monthly"]
            ]
            if raw.get("monthly_truncated"):
                out["monthly_truncated"] = True
    elif tool_name == "get_streaks_and_goals":
        out = {
            "today": raw["today"],
            "streaks": {
                "current_days": raw["streaks"]["current_days"],
                "longest_days": raw["streaks"]["longest_days"],
                "current_weeks": raw["streaks"]["current_weeks"],
                "longest_weeks": raw["streaks"]["longest_weeks"],
                "week": [
                    {"date": d["date"], "active": bool(d["active"])} for d in raw["streaks"]["week"]
                ],
            },
            "goals": {
                period: {
                    "target_km": info.get("target_km"),
                    "completed_km": info.get("completed_km"),
                    "progress_pct": info.get("progress_pct"),
                }
                for period, info in raw["goals"].items()
                if period in {"week", "month", "year"}
            },
        }
    elif tool_name == "search_activities":
        list_key = "items"
        out = {
            "total": raw["total"],
            "returned_count": len(raw["items"]),
            "truncated": raw["total"] > len(raw["items"]),
            "items": [_pick(item, ACTIVITY_ITEM_KEYS) for item in raw["items"]],
        }
    elif tool_name == "get_activity_detail":
        out = _pick(raw, ACTIVITY_DETAIL_KEYS)
    elif tool_name == "get_footprint_summary":
        if raw["scope"] == "china":
            list_key = "provinces"
            out = {
                "scope": "china",
                "year": raw.get("year"),
                "total_provinces": raw.get("total_provinces", 34),
                "visited_province_count": raw["visited_province_count"],
                "activity_count": raw["activity_count"],
                "located_activity_count": raw["located_activity_count"],
                "cached_only": bool(raw.get("cached_only", False)),
                "provinces": [
                    {
                        "code": p["code"],
                        "name": p["name"],
                        "activity_count": p["activity_count"],
                    }
                    for p in raw.get("provinces", [])
                ],
            }
        else:
            list_key = "countries"
            out = {
                "scope": "global",
                "year": raw.get("year"),
                "activity_count": raw["activity_count"],
                "located_activity_count": raw["located_activity_count"],
                "country_count": raw["country_count"],
                "region_count": raw["region_count"],
                "city_count": raw["city_count"],
                "cached_only": bool(raw.get("cached_only", False)),
                "countries": [
                    {
                        "code": c["code"],
                        "name": c["name"],
                        "activity_count": c["activity_count"],
                        "distance_m": c["distance_m"],
                        "region_count": c["region_count"],
                        "city_count": c["city_count"],
                        "regions": [
                            {
                                "code": r["code"],
                                "name": r["name"],
                                "activity_count": r["activity_count"],
                                "distance_m": r["distance_m"],
                                "cities": [
                                    {
                                        "code": city["code"],
                                        "name": city["name"],
                                        "activity_count": city["activity_count"],
                                        "distance_m": city["distance_m"],
                                    }
                                    for city in r.get("cities", [])
                                ],
                            }
                            for r in c.get("regions", [])
                        ],
                    }
                    for c in raw.get("countries", [])
                ],
            }
    elif tool_name == "get_frequent_routes":
        if "group" in raw:
            list_key = "runs"
            group = raw["group"]
            out = {
                "group": {
                    "group_id": group["group_id"],
                    "run_count": group["run_count"],
                    "first_date": group["first_date"],
                    "last_date": group["last_date"],
                    "median_distance_m": group["median_distance_m"],
                    "best_duration_seconds": group["best_duration_seconds"],
                    "avg_duration_seconds": group["avg_duration_seconds"],
                    "best_pace_seconds_per_km": group["best_pace_seconds_per_km"],
                    "avg_pace_seconds_per_km": group["avg_pace_seconds_per_km"],
                },
                "runs": [
                    {
                        "activity_id": run["activity_id"],
                        "activity_date": run["activity_date"],
                        "distance_m": run["distance_m"],
                        "duration_seconds": run["duration_seconds"],
                        "avg_pace_seconds_per_km": run["avg_pace_seconds_per_km"],
                        "coverage": run["coverage"],
                    }
                    for run in raw.get("runs", [])
                ],
                "total_runs": raw.get("total_runs", len(raw.get("runs", []))),
            }
        else:
            list_key = "groups"
            out = {
                "total": raw["total"],
                "building": bool(raw["building"]),
                "groups": [
                    {
                        "group_id": g["group_id"],
                        "run_count": g["run_count"],
                        "first_date": g["first_date"],
                        "last_date": g["last_date"],
                        "median_distance_m": g["median_distance_m"],
                        "best_duration_seconds": g["best_duration_seconds"],
                        "avg_duration_seconds": g["avg_duration_seconds"],
                        "best_pace_seconds_per_km": g["best_pace_seconds_per_km"],
                        "avg_pace_seconds_per_km": g["avg_pace_seconds_per_km"],
                    }
                    for g in raw.get("groups", [])
                ],
            }
    else:
        raise ValueError(f"Unsupported tool for outbound serialization: {tool_name}")

    capped, truncated = _cap_payload_size(out, list_key=list_key, max_bytes=max_bytes)
    assert_outbound_safe(capped)
    return capped, truncated
