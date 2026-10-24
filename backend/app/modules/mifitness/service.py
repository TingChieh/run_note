"""Device summaries with optional tracks, under the shared owner import lock."""

import hashlib
from contextlib import contextmanager
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import ApiError
from app.modules.activities.classify import classify_distance
from app.modules.activities.model import Activity
from app.modules.activities.schema import ImportView
from app.modules.activities.service import detail, lock_owner, owned_activity
from app.modules.auth.service import require_identity
from app.modules.gpx import service as gpx_service
from app.modules.gpx.fingerprint import canonical_hash
from app.modules.gpx.metrics import pace, round_metric
from app.modules.gpx.model import GpxImport
from app.modules.gpx.normalization import derive, prepare_segments, source_points
from app.modules.gpx.queries import edge_distances, route_distance
from app.modules.gpx.worker import bounded_parse
from app.modules.mifitness.metrics import normalize_summary, record_fingerprint, source_snapshot
from app.modules.mifitness.model import MifitnessImport
from app.modules.mifitness.parser import PARSER_VERSION
from app.modules.mifitness.schema import MifitnessPreview
from app.modules.place_titles.queue import enqueue as enqueue_place_title
from app.modules.tcx.model import TcxImport

SUPPLEMENT_FIELDS = {
    "calories_kcal": "calories",
    "steps": "steps",
    "avg_heart_rate_bpm": "avg_hrm",
    "max_heart_rate_bpm": "max_hrm",
    "min_heart_rate_bpm": "min_hrm",
    "avg_cadence_spm": "avg_cadence",
    "max_cadence_spm": "max_cadence",
    "vo2_max_ml_kg_min": "vo2_max",
    "training_load": "train_load",
    "aerobic_training_effect": "train_effect",
    "anaerobic_training_effect": "anaerobic_train_effect",
}


def matches(db, owner, fingerprint, raw_hash, canonical):
    found = {}
    identifier = db.scalar(
        select(MifitnessImport.activity_id).where(
            MifitnessImport.user_id == owner, MifitnessImport.record_fingerprint == fingerprint
        )
    )
    if identifier is not None:
        found[identifier] = "record"
    for model in (GpxImport, TcxImport, MifitnessImport):
        for value, column, kind in (
            (raw_hash, model.raw_sha256, "raw"),
            (canonical, model.canonical_sha256, "canonical"),
        ):
            if value is None:
                continue
            query = select(model.activity_id).where(model.user_id == owner, column == value)
            if kind == "canonical":
                query = query.where(model.fingerprint_version == "canonical-v1")
            for identifier in db.scalars(query):
                found.setdefault(identifier, kind)
    return found


def reject_duplicate(found, *, similar=False):
    if found:
        raise ApiError(
            409,
            "MIFITNESS_SIMILAR" if similar else "MIFITNESS_DUPLICATE",
            "存在相近记录，请核对后确认" if similar else "此运动记录已经导入",
            details=[
                {"existing_activity_id": str(key), "duplicate_kind": kind}
                for key, kind in found.items()
            ],
        )


def similar_activities(db, owner, summary):
    tolerance = max(summary["distance_m"] * round_metric("0.05"), round_metric(100))
    return list(
        db.scalars(
            select(Activity.id)
            .where(
                Activity.user_id == owner,
                Activity.started_at.between(
                    summary["started_at"] - timedelta(seconds=120),
                    summary["started_at"] + timedelta(seconds=120),
                ),
                Activity.distance_m.between(
                    max(0, summary["distance_m"] - tolerance), summary["distance_m"] + tolerance
                ),
            )
            .order_by(Activity.id)
            .limit(100)
        )
    )


def supplement(activity, summary, warnings):
    updates = {
        field: summary[field]
        for field in SUPPLEMENT_FIELDS
        if getattr(activity, field) is None and summary[field] is not None
    }
    for fields, code in (
        (
            ("min_heart_rate_bpm", "avg_heart_rate_bpm", "max_heart_rate_bpm"),
            "MIFITNESS_HEART_RATE_INCONSISTENT",
        ),
        (("avg_cadence_spm", "max_cadence_spm"), "MIFITNESS_CADENCE_INCONSISTENT"),
    ):
        values = [updates.get(field, getattr(activity, field)) for field in fields]
        values = [value for value in values if value is not None]
        if any(a > b for a, b in zip(values, values[1:], strict=False)):
            for field in fields:
                updates.pop(field, None)
            warnings.append(code)
    for field, value in updates.items():
        setattr(activity, field, value)
    return updates


@contextmanager
def import_record(
    request,
    db,
    owner,
    record,
    raw,
    timezone,
    *,
    preview=False,
    confirm_similar=False,
    enrich_activity_id=None,
):
    """Keep the advisory lock through the router's commit; rollback on every exit."""
    try:
        with gpx_service.import_lock(db.get_bind(), owner):
            summary, warnings = normalize_summary(record)
            summary["elapsed_seconds"] = round_metric(summary["elapsed_seconds"])
            try:
                activity_date = summary["started_at"].astimezone(ZoneInfo(timezone)).date()
            except (OverflowError, ValueError):
                raise ApiError(422, "MIFITNESS_SUMMARY_INVALID", "活动日期不合法") from None
            if not 1900 <= activity_date.year <= 2100:
                raise ApiError(422, "MIFITNESS_SUMMARY_INVALID", "活动日期不合法")
            fingerprint = record_fingerprint(record)
            raw_hash = hashlib.sha256(raw).hexdigest() if raw is not None else None
            canonical = route_metric = derived = None
            if enrich_activity_id is not None:
                owned_activity(db, owner, enrich_activity_id)
            db.rollback()
            if raw is not None:
                parsed = bounded_parse(raw, format="mifitness")
                times = [point.time for point in source_points(parsed) if point.time is not None]
                margin = timedelta(seconds=900)
                if (
                    not times
                    or min(times) < summary["started_at"] - margin
                    or max(times) > summary["ended_at"] + margin
                ):
                    raise ApiError(422, "MIFITNESS_TRACK_MISMATCH", "轨迹时间与设备记录不匹配")
                source = prepare_segments(parsed)
                derived = derive(parsed, source, edge_distances(db, source), timezone, None)
                route_metric = round_metric(route_distance(db, derived.segments))
                canonical = canonical_hash(parsed)
                warnings.extend(derived.quality_summary["warnings"])
            found = matches(db, owner, fingerprint, raw_hash, canonical)
            if enrich_activity_id is None:
                reject_duplicate(found)
            elif enrich_activity_id not in found:
                raise ApiError(422, "MIFITNESS_ENRICH_MISMATCH", "只能补充同源或同轨迹记录")
            else:
                reject_duplicate(
                    {key: kind for key, kind in found.items() if key != enrich_activity_id}
                )
            suspected = similar_activities(db, owner, summary) if not found else []
            point_count = sum(len(segment.points) for segment in derived.segments) if derived else 0
            segment_count = len(derived.segments) if derived else 0
            average = pace(summary["timer_seconds"], summary["distance_m"])
            if summary["distance_m"] == 0:
                warnings.append("ZERO_DISTANCE")
            if average is None:
                warnings.append("PACE_UNAVAILABLE")
            if preview:
                yield MifitnessPreview(
                    **summary,
                    activity_date=activity_date,
                    timezone=timezone,
                    has_route=derived is not None,
                    point_count=point_count,
                    segment_count=segment_count,
                    warnings=warnings,
                    suspected_activity_ids=suspected,
                )
                return
            if suspected and not confirm_similar:
                reject_duplicate(dict.fromkeys(suspected, "similar"), similar=True)
            quality = dict(derived.quality_summary) if derived else {}
            quality.update(
                warnings=list(dict.fromkeys(warnings)),
                time_interpretation="absolute",
                distance_source="device",
                duration_source="device",
                time_source="device",
                route_distance_m=str(route_metric) if route_metric is not None else None,
                track_elapsed_seconds=str(derived.elapsed_seconds) if derived else None,
            )
            db.rollback()
            _, identity = require_identity(db, request, request.app.state.clock())
            if identity.id != owner:
                raise ApiError(401, "AUTH_REQUIRED", "请重新登录")
            user = lock_owner(db, owner)
            updates = {}
            if enrich_activity_id is None:
                activity = Activity(
                    user_id=owner,
                    source="mifitness",
                    title=f"跑步 · {activity_date}",
                    activity_date=activity_date,
                    date_source="timestamp",
                    timezone=timezone,
                    **summary,
                    category=classify_distance(summary["distance_m"]),
                    avg_pace_seconds_per_km=average,
                    temporal_quality="complete",
                    quality_summary=quality,
                    metrics_version="mifitness-v1",
                    visibility="private",
                    allow_shared_route=False,
                )
                db.add(activity)
                db.flush()
                if derived:
                    point_count, segment_count = gpx_service.persist_segments(
                        db, activity.id, derived.segments
                    )
                    enqueue_place_title(db, owner, activity.id)
            else:
                activity = owned_activity(db, owner, enrich_activity_id)
                updates = supplement(activity, summary, warnings)
                quality = dict(activity.quality_summary)
                quality["warnings"] = list(dict.fromkeys([*quality.get("warnings", []), *warnings]))
                activity.quality_summary = quality
            imported = db.scalar(
                select(MifitnessImport).where(
                    MifitnessImport.user_id == owner, MifitnessImport.activity_id == activity.id
                )
            )
            if imported is not None and imported.record_fingerprint != fingerprint:
                raise ApiError(422, "MIFITNESS_ENRICH_MISMATCH", "已有其他设备来源记录，无法补充")
            if imported is None:
                imported = MifitnessImport(
                    activity_id=activity.id,
                    user_id=owner,
                    record_fingerprint=fingerprint,
                    source_summary=source_snapshot(record),
                    raw_gpx=raw,
                    byte_size=len(raw) if raw is not None else 0,
                    raw_sha256=raw_hash,
                    canonical_sha256=canonical,
                    fingerprint_version="canonical-v1",
                    parser_version=PARSER_VERSION,
                    route_distance_m=route_metric,
                )
                db.add(imported)
            elif updates:
                # Retain original base/nonempty source metrics; record only the values
                # actually used to fill NULL activity metrics in this explicit supplement.
                snapshot = dict(imported.source_summary)
                metrics = dict(snapshot["source_metrics"])
                incoming = source_snapshot(record)["source_metrics"]
                for field in updates:
                    raw_field = SUPPLEMENT_FIELDS[field]
                    metrics[raw_field] = incoming[raw_field]
                imported.source_summary = {**snapshot, "source_metrics": metrics}
            user.activity_data_version += 1
            db.flush()
            yield ImportView(
                activity=detail(db, owner, activity.id),
                import_id=imported.id,
                warnings=list(dict.fromkeys(warnings)),
                point_count=point_count,
                segment_count=segment_count,
                metrics_version=activity.metrics_version,
            )
    except SQLAlchemyError:
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "数据库暂时不可用，请稍后重试") from None
    finally:
        db.rollback()
