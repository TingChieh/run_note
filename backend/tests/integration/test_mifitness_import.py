"""Only synthetic records on the explicitly guarded test database."""

# ruff: noqa: F811 -- register existing database/client fixtures
import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import text

from app.db.schema import get_expected_revision
from tests.integration.test_gpx_import import clients, headers, register, upload  # noqa: F401

pytestmark = pytest.mark.integration
PATH = "/api/v1/mifitness-imports"
START = int(datetime(2026, 1, 2, 23, 59, tzinfo=UTC).timestamp())


def record(**changes):
    metrics = {
        "start_time": START,
        "end_time": START + 600,
        "distance": 3000,
        "duration": 500,
        "calories": 180,
        "steps": 3600,
        "avg_hrm": 150,
        "min_hrm": 90,
        "max_hrm": 180,
        "avg_cadence": 165,
        "max_cadence": 190,
        "vo2_max": 52,
        "train_load": 75,
        "train_effect": 3.2,
        "anaerobic_train_effect": 0,
        **changes,
    }
    return {"source_time": metrics["start_time"], "source_metrics": metrics}


def track(*, offset=0, namespace=False, start=START):
    ns = ' xmlns="http://www.topografix.com/GPX/1/1"' if namespace else ""
    times = [datetime.fromtimestamp(start + offset + n, UTC).isoformat() for n in (1, 61, 121)]
    return (
        f'<gpx version="1.1" creator="Go GPS Converter"{ns}><trk><trkseg>'
        + "".join(
            f'<trkpt lat="0" lon="{n * 0.001}"><time>{time}</time></trkpt>'
            for n, time in enumerate(times)
        )
        + "</trkseg></trk></gpx>"
    ).encode()


def send(client, payload=None, raw=None, *, preview=False, **fields):
    return client.post(
        PATH + ("?preview=true" if preview else ""),
        headers=headers(client),
        data={"record": json.dumps(payload or record()), "timezone": "Asia/Shanghai", **fields},
        files={"file": ("synthetic.gpx", raw, "application/gpx+xml")} if raw is not None else None,
    )


def test_preview_is_read_only_and_summary_only_import_uses_device_time(clients):
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    preview = send(a, preview=True)
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["has_route"] is False
    assert preview.json()["data"]["point_count"] == 0
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 0
        )
        assert (
            db.scalar(text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner})
            == 0
        )
    result = send(a)
    assert result.status_code == 201, result.text
    activity = result.json()["data"]["activity"]
    identifier = activity["id"]
    assert activity["has_route"] is False
    assert activity["activity_date"] == "2026-01-03"
    assert Decimal(activity["distance_m"]) == 3000
    assert Decimal(activity["elapsed_seconds"]) == 600
    assert Decimal(activity["timer_seconds"]) == 500
    assert Decimal(activity["avg_pace_seconds_per_km"]) == Decimal("166.667")
    assert activity["max_heart_rate_bpm"] == 180
    assert Decimal(activity["anaerobic_training_effect"]) == 0
    assert a.get(f"/api/v1/activities/{identifier}").json()["data"] == activity
    assert a.get(f"/api/v1/activities/{identifier}/route").json()["data"]["features"] == []
    assert b.get(f"/api/v1/activities/{identifier}").status_code == 404
    with engine.connect() as db:
        row = db.execute(
            text("SELECT raw_gpx,byte_size FROM mifitness_imports WHERE activity_id=:id"),
            {"id": identifier},
        ).one()
        assert row.raw_gpx is None and row.byte_size == 0
        assert (
            db.scalar(text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner})
            == 1
        )


def test_missing_namespace_raw_is_preserved_and_device_start_is_not_replaced_by_first_point(
    clients,
):
    a, _, engine, _ = clients
    register(a)
    raw = track()
    response = send(a, raw=raw)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["point_count"] == 3
    assert data["activity"]["has_route"] is True
    assert data["activity"]["started_at"] == datetime.fromtimestamp(START, UTC).isoformat().replace(
        "+00:00", "Z"
    )
    with engine.connect() as db:
        assert (
            bytes(
                db.scalar(
                    text("SELECT raw_gpx FROM mifitness_imports WHERE activity_id=:id"),
                    {"id": data["activity"]["id"]},
                )
            )
            == raw
        )


def test_source_identity_and_cross_format_duplicates_are_owner_scoped(clients):
    a, b, _, _ = clients
    register(a)
    register(b)
    first = send(a, raw=track())
    assert first.status_code == 201, first.text
    identifier = first.json()["data"]["activity"]["id"]
    for response in (
        send(a, record(calories=999), raw=track()),
        upload(a, raw=track(namespace=True)),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["error"]["details"][0]["existing_activity_id"] == identifier
    assert send(b, raw=track()).status_code == 201


def test_existing_gpx_can_be_explicitly_enriched_without_overwriting_nonempty_values(clients):
    a, b, engine, _ = clients
    register(a)
    register(b)
    response = upload(a, raw=track(namespace=True))
    assert response.status_code == 201, response.text
    original = response.json()["data"]["activity"]
    identifier = original["id"]
    assert send(a, raw=track()).status_code == 409
    enriched = send(a, raw=track(), enrich_activity_id=identifier)
    assert enriched.status_code == 201, enriched.text
    activity = enriched.json()["data"]["activity"]
    assert activity["id"] == identifier
    assert activity["distance_m"] == original["distance_m"]
    assert activity["visibility"] == original["visibility"]
    assert activity["max_heart_rate_bpm"] == 180
    assert activity["timer_seconds"] == original["timer_seconds"]
    assert activity["avg_pace_seconds_per_km"] == original["avg_pace_seconds_per_km"]
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT count(*) FROM activities WHERE id=:id"), {"id": identifier}) == 1
        )
    assert send(b, raw=track(), enrich_activity_id=identifier).status_code == 404


def test_arbitrary_activity_cannot_be_enriched_without_matching_source_or_canonical_track(clients):
    a, _, _, _ = clients
    register(a)
    first = send(a)
    assert first.status_code == 201, first.text
    identifier = first.json()["data"]["activity"]["id"]
    other = record(start_time=START + 86400, end_time=START + 87000)
    result = send(a, other, enrich_activity_id=identifier)
    assert result.status_code == 422, result.text


def test_similar_record_needs_confirmation_and_other_owners_are_not_disclosed(clients):
    a, b, _, _ = clients
    register(a)
    register(b)
    original = send(a)
    assert original.status_code == 201
    similar = record(start_time=START + 1, end_time=START + 601)
    preview = send(a, similar, preview=True)
    assert preview.status_code == 200
    assert preview.json()["data"]["suspected_activity_ids"] == [
        original.json()["data"]["activity"]["id"]
    ]
    assert send(a, similar).status_code == 409
    assert send(a, similar, confirm_similar="true").status_code == 201
    assert send(b, similar).status_code == 201


def test_optional_invalid_metric_warns_and_never_reaches_public_or_share_response(clients):
    a, b, _, _ = clients
    register(a)
    register(b)
    result = send(a, record(max_cadence=5730))
    assert result.status_code == 201, result.text
    data = result.json()["data"]
    assert data["activity"]["max_cadence_spm"] is None
    assert any("CADENCE" in warning for warning in data["warnings"])
    identifier = data["activity"]["id"]
    assert (
        a.patch(
            f"/api/v1/activities/{identifier}", headers=headers(a), json={"visibility": "public"}
        ).status_code
        == 200
    )
    public = b.get(f"/api/v1/public/activities/{identifier}").json()["data"]
    assert (
        not {"source_summary", "max_heart_rate_bpm", "training_load", "vo2_max_ml_kg_min"}
        & public.keys()
    )


def test_wrong_track_or_invalid_base_summary_creates_no_partial_rows(clients):
    a, _, engine, _ = clients
    owner = register(a)
    for payload, raw in [(record(distance=-1), None), (record(), track(offset=86400))]:
        response = send(a, payload, raw)
        assert response.status_code == 422, response.text
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 0
        )


def test_extreme_device_epoch_is_rejected_without_timezone_overflow(clients):
    a, _, _, _ = clients
    register(a)
    epoch = int(datetime(9999, 12, 31, 23, 59, tzinfo=UTC).timestamp())
    response = send(a, record(start_time=epoch, end_time=epoch))
    assert response.status_code == 422, response.text


def test_atomic_segment_failure_rolls_back_and_import_lock_releases(clients, monkeypatch):
    from app.modules.gpx import service as gpx_service

    a, _, engine, _ = clients
    owner = register(a)
    real = gpx_service.insert_points

    def fail(*args):
        raise RuntimeError("synthetic point failure")

    monkeypatch.setattr(gpx_service, "insert_points", fail)
    with pytest.raises(RuntimeError, match="synthetic point failure"):
        send(a, raw=track())
    with engine.connect() as db:
        assert (
            db.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 0
        )
    monkeypatch.setattr(gpx_service, "insert_points", real)
    assert send(a, raw=track()).status_code == 201


def test_csrf_unknown_fields_duplicate_parts_and_body_limits(clients):
    a, _, _, _ = clients
    assert a.post(PATH, data={"record": "{}"}).status_code == 401
    register(a)
    assert a.post(PATH, data={"record": "{}"}).status_code == 403
    assert send(a, record(), owner_id="someone").status_code == 422
    assert send(a, {**record(), "url": "https://example.invalid/private"}).status_code == 422
    assert (
        a.post(
            PATH, headers={**headers(a), "Content-Length": str(12 * 1024 * 1024)}, content=b"x"
        ).status_code
        == 413
    )
    response = a.post(
        PATH,
        headers=headers(a),
        data={"record": json.dumps(record())},
        files=[("file", ("a.gpx", track())), ("file", ("b.gpx", track()))],
    )
    assert response.status_code == 422


def test_enrichment_preserves_existing_metrics_when_incoming_group_conflicts(clients):
    a, _, engine, _ = clients
    register(a)
    original = upload(a, raw=track(namespace=True)).json()["data"]["activity"]
    identifier = original["id"]
    with engine.begin() as db:
        db.execute(
            text("UPDATE activities SET avg_heart_rate_bpm=200, calories_kcal=123 WHERE id=:id"),
            {"id": identifier},
        )
    result = send(a, raw=track(), enrich_activity_id=identifier)
    assert result.status_code == 201, result.text
    data = result.json()["data"]
    assert data["activity"]["avg_heart_rate_bpm"] == 200
    assert data["activity"]["max_heart_rate_bpm"] is None
    assert data["activity"]["calories_kcal"] == 123
    assert "MIFITNESS_HEART_RATE_INCONSISTENT" in data["warnings"]


def test_preview_uses_same_shared_import_lock_and_does_not_leave_it_held(clients):
    from app.modules.gpx.service import import_lock

    a, _, engine, _ = clients
    owner = register(a)
    with import_lock(engine, UUID(owner)):
        response = send(a, preview=True)
        assert response.status_code == 429, response.text
        assert response.json()["error"]["code"] == "IMPORT_BUSY"
    assert send(a, preview=True).status_code == 200


def test_summary_source_duplicate_and_explicit_supplement_preserve_single_source(clients):
    a, _, engine, _ = clients
    register(a)
    original = send(a, record(vo2_max=None)).json()["data"]["activity"]
    identifier = original["id"]
    duplicate = send(a, preview=True)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["details"][0]["duplicate_kind"] == "record"
    result = send(a, enrich_activity_id=identifier)
    assert result.status_code == 201, result.text
    assert Decimal(result.json()["data"]["activity"]["vo2_max_ml_kg_min"]) == 52
    assert not result.json()["data"]["activity"]["has_route"]
    with engine.connect() as db:
        snapshot = db.scalar(
            text("SELECT source_summary FROM mifitness_imports WHERE activity_id=:id"),
            {"id": identifier},
        )
        assert snapshot["source_metrics"]["vo2_max"] == 52
        assert snapshot["source_metrics"]["distance"] == 3000
    with engine.connect() as db:
        assert (
            db.scalar(
                text("SELECT count(*) FROM mifitness_imports WHERE activity_id=:id"),
                {"id": identifier},
            )
            == 1
        )


def test_migration_refuses_to_discard_device_data(clients):
    from tests.integration.test_migrations import assert_downgrade_guard

    a, _, engine, _ = clients
    register(a)
    assert send(a).status_code == 201
    assert_downgrade_guard(
        engine,
        "0009_mifitness_imports",
        "Cannot downgrade while Mi Fitness or device metrics exist",
    )
    with engine.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == get_expected_revision()
        assert db.scalar(text("SELECT count(*) FROM mifitness_imports")) >= 1
