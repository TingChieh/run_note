"""Existing isolated schema only; synthetic inserts, no migration or cleanup."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import Settings
from app.db.schema import get_expected_revision
from app.main import create_app

pytestmark = pytest.mark.integration
FIXTURES = Path(__file__).parents[1] / "fixtures/gpx"
CASES = [c for c in json.loads((FIXTURES / "manifest.json").read_text())["cases"] if "file" in c]
ORIGIN = "http://127.0.0.1:5183"


@pytest.fixture
def clients():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit isolated test database required")
    engine = create_engine(url, hide_parameters=True)
    with engine.connect() as c:
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalars().all() == [
            get_expected_revision()
        ]
    settings = Settings(
        database_url=url, site_origin=ORIGIN, auth_rate_hash_key=uuid4().hex, _env_file=None
    )
    a, b = create_app(settings), create_app(settings)
    with TestClient(a, base_url=ORIGIN) as ca, TestClient(b, base_url=ORIGIN) as cb:
        yield ca, cb, engine, a
    engine.dispose()


def headers(client):
    r = client.get("/api/v1/auth/csrf")
    assert r.status_code == 200
    return {"Origin": ORIGIN, "X-CSRF-Token": r.json()["data"]["csrf_token"]}


def register(client):
    unique = uuid4().hex[:20]
    r = client.post(
        "/api/v1/auth/register",
        headers=headers(client),
        json={
            "email": f"{unique}@example.com",
            "username": f"u_{unique}",
            "password": "Synthetic-password-2026",
        },
    )
    assert r.status_code == 201
    return r.json()["data"]["user"]["id"]


def upload(client, file="equator-six.gpx", fields=None, raw=None, extra_headers=None):
    return client.post(
        "/api/v1/gpx-imports",
        headers={**headers(client), **(extra_headers or {})},
        files={
            "file": (
                file,
                raw if raw is not None else (FIXTURES / file).read_bytes(),
                "application/gpx+xml",
            )
        },
        data={"timezone": "UTC", **(fields or {})},
    )


def test_import_requires_identity_and_source_before_parsing(clients):
    a, _, _, _ = clients
    r = a.post("/api/v1/gpx-imports", files={"file": ("test.gpx", b"invalid")})
    assert r.status_code == 401
    register(a)
    assert upload(a, extra_headers={"Origin": "https://evil.example"}).status_code == 403
    assert upload(a, extra_headers={"X-CSRF-Token": "bad"}).status_code == 403


def test_submillisecond_gpx_preserves_zero_stored_duration_without_pace(clients):
    a, _, _, _ = clients
    register(a)
    raw = b"""<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
    <trk><trkseg>
    <trkpt lat="0" lon="0"><time>2026-10-04T00:00:00Z</time></trkpt>
    <trkpt lat="0" lon="0.00000001"><time>2026-10-04T00:00:00.0004Z</time></trkpt>
    </trkseg></trk></gpx>"""
    result = upload(a, raw=raw)
    assert result.status_code == 201, result.text
    activity = result.json()["data"]["activity"]
    assert float(activity["elapsed_seconds"]) == 0
    assert activity["avg_pace_seconds_per_km"] is None


def test_mismatched_export_version_imports_and_preserves_original(clients):
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    raw = (FIXTURES / "equator-six.gpx").read_bytes().replace(b'version="1.1"', b'version="1.0"')
    response = upload(a, raw=raw)
    assert response.status_code == 201, response.json()
    data = response.json()["data"]
    activity = data["activity"]
    identifier = activity["id"]
    assert data["point_count"] == 6
    assert data["segment_count"] == 1
    assert float(activity["distance_m"]) == pytest.approx(1113.195, abs=0.001)
    assert float(activity["elapsed_seconds"]) == 600
    assert activity["visibility"] == "private"
    assert a.get(f"/api/v1/activities/{identifier}/route").status_code == 200
    assert b.get(f"/api/v1/activities/{identifier}/route").status_code == 404
    assert upload(a).status_code == 409  # Same track with a standard header is still a duplicate.
    with engine.connect() as c:
        saved = c.execute(
            text("SELECT raw_gpx,user_id FROM gpx_imports WHERE activity_id=:id"),
            {"id": identifier},
        ).one()
        assert bytes(saved.raw_gpx) == raw
        assert str(saved.user_id) == owner


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_golden_import_metrics_storage_and_route(clients, case):
    a, _, engine, _ = clients
    owner = register(a)
    fields = {"timezone": "UTC", **case.get("request", {})}
    if case["id"] in [
        "null-time-repeated-points",
        "missing-coordinate",
        "missing-latitude",
        "nonfinite-coordinate",
    ]:
        fields.setdefault("activity_date", "2024-01-01")
    r = upload(a, case["file"], fields)
    want = case["expected"]
    assert r.status_code == want.get("http_status", 201), r.text
    if r.status_code != 201:
        assert r.json()["error"]["code"] == want["code"]
        with engine.connect() as c:
            assert (
                c.scalar(
                    text("SELECT count(*) FROM activities WHERE user_id=:owner"), {"owner": owner}
                )
                == 0
            )
        return
    data = r.json()["data"]
    activity = data["activity"]
    identifier = activity["id"]
    for key in ["temporal_quality", "activity_date", "started_at", "ended_at"]:
        if key in want:
            assert activity[key] == want[key]
    for key in ["distance_m", "elapsed_seconds", "avg_pace_seconds_per_km"]:
        if key in want:
            if want[key] is None:
                assert activity[key] is None
            else:
                assert float(activity[key]) == pytest.approx(want[key], abs=0.001)
    for key in [
        "input_point_count",
        "input_segment_count",
        "invalid_coordinate_count",
        "empty_segment_count",
        "deduplicated_point_count",
        "speed_jump_count",
    ]:
        if key in want:
            assert activity["quality_summary"][key] == want[key]
    if "valid_point_count" in want:
        assert data["point_count"] == want["valid_point_count"]
    if "derived_segment_count" in want:
        assert data["segment_count"] == want["derived_segment_count"]
    assert a.get(f"/api/v1/activities/{identifier}").json()["data"] == activity
    route = a.get(f"/api/v1/activities/{identifier}/route").json()["data"]
    assert len(route["features"]) == data["segment_count"]
    with engine.connect() as c:
        saved = c.execute(
            text(
                "SELECT raw_gpx,raw_sha256,canonical_sha256,user_id "
                "FROM gpx_imports WHERE activity_id=:id"
            ),
            {"id": identifier},
        ).one()
        assert bytes(saved.raw_gpx) == (FIXTURES / case["file"]).read_bytes()
        assert str(saved.user_id) == owner
        if "canonical_eligible" in want:
            assert bool(saved.canonical_sha256) == want["canonical_eligible"]
        assert (
            c.scalar(
                text(
                    "SELECT count(*) FROM activity_points p "
                    "JOIN activity_segments s ON p.segment_id=s.id WHERE s.activity_id=:id"
                ),
                {"id": identifier},
            )
            == data["point_count"]
        )
        assert (
            c.scalar(text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner})
            == 1
        )
        assert not c.scalar(
            text(
                "SELECT count(*) FROM activity_segments s WHERE s.activity_id=:id "
                "AND (s.point_count!=(SELECT count(*) FROM activity_points p "
                "WHERE p.segment_id=s.id) OR (s.geom IS NOT NULL AND NOT ST_Equals(s.geom,"
                "(SELECT ST_MakeLine(p.position ORDER BY p.point_index) "
                "FROM activity_points p WHERE p.segment_id=s.id))))"
            ),
            {"id": identifier},
        )
        if want.get("elevation_m", "absent") is None:
            assert not c.scalar(
                text(
                    "SELECT count(*) FROM activity_points p "
                    "JOIN activity_segments s ON p.segment_id=s.id "
                    "WHERE s.activity_id=:id AND p.elevation_m IS NOT NULL"
                ),
                {"id": identifier},
            )


def test_owner_list_detail_route_and_duplicates(clients):
    a, b, engine, _ = clients
    ua, ub = register(a), register(b)
    first = upload(a)
    assert first.status_code == 201
    aid = first.json()["data"]["activity"]["id"]
    raw = upload(a)
    canonical = upload(a, "format-equivalent.gpx")
    for response, kind in [(raw, "raw"), (canonical, "canonical")]:
        assert response.status_code == 409
        assert response.json()["error"]["details"] == [
            {"existing_activity_id": aid, "duplicate_kind": kind}
        ]
    assert b.get(f"/api/v1/activities/{aid}").status_code == 404
    assert b.get(f"/api/v1/activities/{aid}/route").status_code == 404
    assert b.get("/api/v1/activities").json()["data"]["total"] == 0
    second = upload(b)
    assert second.status_code == 201
    bid = second.json()["data"]["activity"]["id"]
    assert bid != aid
    assert [i["id"] for i in a.get("/api/v1/activities").json()["data"]["items"]] == [aid]
    with engine.connect() as c:
        assert c.execute(
            text("SELECT activity_data_version FROM users WHERE id IN (:a,:b)"), {"a": ua, "b": ub}
        ).scalars().all() == [1, 1]
    unknown = upload(a, fields={"owner_id": ub})
    assert unknown.status_code == 422
    assert upload(a, fields={"title": "x" * 121}).status_code == 422
    assert upload(a, fields={"timezone": "not-a-zone"}).status_code == 422


def test_upload_file_and_request_limits(clients):
    a, _, _, _ = clients
    register(a)
    assert upload(a, raw=b"x" * (10485760 + 1)).status_code == 413
    r = a.post(
        "/api/v1/gpx-imports",
        headers=headers(a),
        files=[("file", ("a.gpx", b"x")), ("file", ("b.gpx", b"x"))],
    )
    assert r.status_code in [400, 422]
    r = a.post(
        "/api/v1/gpx-imports",
        headers={**headers(a), "Content-Length": str(11 * 1024 * 1024 + 1)},
        content=b"x",
    )
    assert r.status_code == 413


def test_atomic_point_failure_rolls_back_and_lock_releases(clients, monkeypatch):
    from app.modules.gpx import service

    a, _, engine, _ = clients
    owner = register(a)
    original = service.insert_points

    def fail(*args):
        raise RuntimeError("synthetic write fault")

    monkeypatch.setattr(service, "insert_points", fail)
    with pytest.raises(RuntimeError):
        upload(a)
    with engine.connect() as c:
        assert (
            c.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 0
        )
        assert (
            c.scalar(text("SELECT count(*) FROM gpx_imports WHERE user_id=:id"), {"id": owner}) == 0
        )
        assert (
            c.scalar(text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner})
            == 0
        )
    monkeypatch.setattr(service, "insert_points", original)
    assert upload(a).status_code == 201


def test_same_user_parallel_workers_commit_at_most_once(clients):
    a, b, engine, app = clients
    owner = register(a)
    b.cookies.update(a.cookies)
    ha, hb = headers(a), headers(b)
    file = (FIXTURES / "equator-six.gpx").read_bytes()

    def perform(client, h):
        return client.post(
            "/api/v1/gpx-imports",
            headers=h,
            files={"file": ("x.gpx", file)},
            data={"timezone": "UTC"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(perform, a, ha), pool.submit(perform, b, hb)]
        responses = [f.result() for f in futures]
    assert sum(r.status_code == 201 for r in responses) == 1
    assert all(r.status_code in [201, 409, 429] for r in responses)
    with engine.connect() as c:
        assert (
            c.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 1
        )
    assert upload(a).status_code == 409


def test_chunked_body_limit_is_enforced_without_content_length(clients):
    a, _, _, _ = clients
    register(a)

    def chunks():
        yield b'--z\r\nContent-Disposition: form-data; name="file"; filename="x.gpx"\r\n\r\n'
        for _ in range(12):
            yield b"x" * 1024 * 1024
        yield b"\r\n--z--\r\n"

    response = a.post(
        "/api/v1/gpx-imports",
        headers={**headers(a), "Content-Type": "multipart/form-data; boundary=z"},
        content=chunks(),
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "GPX_TOO_LARGE"


def test_database_unique_constraint_stops_duplicate_when_precheck_is_bypassed(clients):
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session

    from app.modules.activities.model import Activity
    from app.modules.gpx.model import GpxImport

    a, _, engine, _ = clients
    owner = register(a)
    response = upload(a)
    assert response.status_code == 201
    identifier = response.json()["data"]["activity"]["id"]
    with pytest.raises(IntegrityError), Session(engine) as db, db.begin():
        original = db.get(Activity, identifier)
        other = Activity(
            id=uuid4(),
            user_id=original.user_id,
            source="gpx",
            title="Synthetic duplicate",
            activity_date=original.activity_date,
            date_source="timestamp",
            timezone="UTC",
            distance_m=0,
            temporal_quality="complete",
            quality_summary={},
            metrics_version="gpx-v1",
        )
        db.add(other)
        db.flush()
        saved = db.query(GpxImport).filter_by(activity_id=original.id).one()
        db.add(
            GpxImport(
                activity_id=other.id,
                user_id=original.user_id,
                original_filename="x.gpx",
                raw_gpx=saved.raw_gpx,
                byte_size=saved.byte_size,
                raw_sha256=saved.raw_sha256,
                canonical_sha256=None,
                fingerprint_version="canonical-v1",
                parser_version="gpx-parser-v1",
            )
        )
        db.flush()
    with engine.connect() as c:
        assert (
            c.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 1
        )
        assert (
            c.scalar(text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner})
            == 1
        )


def test_session_revoked_during_parse_cannot_commit(clients, monkeypatch):
    from app.core.security import token_hash
    from app.modules.gpx import service

    a, _, engine, _ = clients
    owner = register(a)
    original = service.bounded_parse

    def revoke(raw):
        with engine.begin() as c:
            c.execute(
                text("UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=:token"),
                {"token": token_hash(a.cookies.get("run_session"))},
            )
        return original(raw)

    monkeypatch.setattr(service, "bounded_parse", revoke)
    assert upload(a).status_code == 401
    with engine.connect() as c:
        assert (
            c.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 0
        )
        assert (
            c.scalar(text("SELECT activity_data_version FROM users WHERE id=:id"), {"id": owner})
            == 0
        )


def test_geometry_dependency_failure_is_sanitized_and_releases_lock(clients, monkeypatch):
    from sqlalchemy.exc import OperationalError

    from app.modules.gpx import service

    a, _, engine, _ = clients
    owner = register(a)
    original = service.edge_distances

    def fail(*args):
        raise OperationalError("synthetic-private-sql", {}, RuntimeError("hidden credentials"))

    monkeypatch.setattr(service, "edge_distances", fail)
    response = upload(a)
    assert response.status_code == 503
    assert "hidden" not in response.text and "synthetic-private-sql" not in response.text
    with engine.connect() as c:
        assert (
            c.scalar(text("SELECT count(*) FROM activities WHERE user_id=:id"), {"id": owner}) == 0
        )
    monkeypatch.setattr(service, "edge_distances", original)
    assert upload(a).status_code == 201


def test_fifty_thousand_distinct_points_persist_in_batches(clients):
    from datetime import datetime, timedelta
    from decimal import Decimal

    from sqlalchemy import event

    client, _, engine, _ = clients
    owner = register(client)
    start = datetime(2024, 1, 1, tzinfo=UTC)
    points = "".join(
        f'<trkpt lat="31" lon="{Decimal("121") + Decimal(i) / 1000000}">'
        f"<time>{(start + timedelta(seconds=i)).isoformat()}</time></trkpt>"
        for i in range(50000)
    )
    raw = (
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">'
        f"<trk><trkseg>{points}</trkseg></trk></gpx>"
    ).encode()
    assert len(raw) < 10 * 1024 * 1024
    statements = []
    api_engine = client.app.state.session_factory.kw["bind"]

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(api_engine, "before_cursor_execute", record)
    try:
        response = upload(client, raw=raw)
    finally:
        event.remove(api_engine, "before_cursor_execute", record)
    assert response.status_code == 201, response.json()
    imported = response.json()["data"]
    assert imported["point_count"] == 50000
    assert imported["segment_count"] == 1
    assert Decimal(imported["activity"]["elapsed_seconds"]) == 49999
    assert imported["activity"]["temporal_quality"] == "complete"
    assert len(statements) < 250  # Batch edges and INSERTs, no per-point database round trip.
    with engine.connect() as connection:
        row = connection.execute(
            text("""SELECT s.point_count,ST_NPoints(s.geom),count(p.*),min(p.point_index),
            max(p.point_index),min(p.source_point_index),max(p.source_point_index)
            FROM activity_segments s JOIN activity_points p ON p.segment_id=s.id
            JOIN activities a ON a.id=s.activity_id WHERE a.id=:id AND a.user_id=:owner
            GROUP BY s.id"""),
            {"id": imported["activity"]["id"], "owner": owner},
        ).one()
        assert tuple(row) == (50000, 50000, 50000, 0, 49999, 0, 49999)
