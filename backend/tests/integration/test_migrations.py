"Explicitly allowed isolated databases; upgrades only, no downgrade or cleanup DDL."

import os
import subprocess
from datetime import UTC
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.config import IntegrationSettings, Settings
from app.main import create_app

pytestmark = pytest.mark.integration
BACKEND = Path(__file__).resolve().parents[2]


def migrate(url, *args):
    subprocess.run(
        [str(BACKEND / ".venv/bin/alembic"), *args],
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": url, "APP_ENV": "test"},
        check=True,
        capture_output=True,
        text=True,
    )


def allowed_url(variable):
    url = os.environ.get(variable)
    if not url:
        pytest.skip(f"{variable} requires an explicitly allowed isolated database")
    settings = IntegrationSettings(test_database_url=url)
    target = make_url(settings.test_database_url)
    engine = create_engine(url, hide_parameters=True)
    with engine.connect() as c:
        assert c.execute(text("SELECT current_database(), inet_server_port()")).one() == (
            target.database,
            target.port or 5432,
        )
    engine.dispose()
    return url


def spatial_hash(c):
    return c.scalar(
        text(
            "SELECT md5(string_agg(srid::text || ':' || srtext, '|' ORDER BY srid))"
            " FROM spatial_ref_sys"
        )
    )


def catalog_hash(c):
    return c.scalar(
        text(
            "SELECT md5(string_agg(oid::text || ':' || relname, '|' ORDER BY oid)) "
            "FROM pg_class WHERE relnamespace='public'::regnamespace"
        )
    )


@pytest.mark.parametrize("variable", ["TEST_DATABASE_URL", "TEST_SNAPSHOT_DATABASE_URL"])
def test_upgrade_paths_preserve_baseline_and_are_idempotent(variable):
    url = allowed_url(variable)
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.begin() as c:
            if variable == "TEST_SNAPSHOT_DATABASE_URL":
                c.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS legacy_sentinel (id integer PRIMARY "
                        "KEY,value text)"
                    )
                )
                c.execute(
                    text(
                        "INSERT INTO legacy_sentinel VALUES (1,'phase-one-preserved') ON "
                        "CONFLICT (id) DO NOTHING"
                    )
                )
            before = set(inspect(c).get_table_names())
            spatial = spatial_hash(c) if "spatial_ref_sys" in before else None
            revisions = (
                c.scalars(text("SELECT version_num FROM alembic_version")).all()
                if "alembic_version" in before
                else []
            )
        if revisions != ["0003_gpx_storage"]:
            with TestClient(
                create_app(Settings(database_url=url, app_env="test", _env_file=None))
            ) as client:
                assert client.get("/api/v1/health/ready").status_code == 503
                assert client.get("/api/v1/health/live").status_code == 200
        migrate(url, "upgrade", "head")
        with engine.connect() as c:
            assert c.scalars(text("SELECT version_num FROM alembic_version")).all() == [
                "0003_gpx_storage"
            ]
            assert set(inspect(c).get_table_names()) - before <= {
                "alembic_version",
                "spatial_ref_sys",
                "users",
                "auth_sessions",
                "auth_rate_buckets",
                "activities",
                "gpx_imports",
                "activity_segments",
                "activity_points",
            }
            if spatial:
                assert spatial_hash(c) == spatial
            if variable == "TEST_SNAPSHOT_DATABASE_URL":
                assert (
                    c.scalar(text("SELECT value FROM legacy_sentinel WHERE id=1"))
                    == "phase-one-preserved"
                )
            catalog = catalog_hash(c)
        migrate(url, "upgrade", "head")
        with engine.connect() as c:
            assert catalog_hash(c) == catalog
        migrate(url, "check")
        with TestClient(
            create_app(Settings(database_url=url, app_env="test", _env_file=None))
        ) as client:
            assert client.get("/api/v1/health/ready").status_code == 200
    finally:
        engine.dispose()


@pytest.fixture
def db():
    url = allowed_url("TEST_DATABASE_URL")
    migrate(url, "upgrade", "head")
    engine = create_engine(url, hide_parameters=True)
    with engine.connect() as c:
        transaction = c.begin()
        yield c
        transaction.rollback()
    engine.dispose()


def user(db):
    identifier = uuid4()
    db.execute(
        text(
            "INSERT INTO users "
            "(id,email_normalized,username,password_hash,display_name) VALUES "
            "(:id,:email,:username,'synthetic-hash','Synthetic')"
        ),
        {"id": identifier, "email": f"{identifier}@example.test", "username": identifier.hex[:30]},
    )
    return identifier


def activity(db, owner):
    identifier = uuid4()
    db.execute(
        text(
            "INSERT INTO activities "
            "(id,user_id,source,title,activity_date,date_source,timezone,distance_m,temporal_quality,quality_summary,metrics_version)"
            " VALUES "
            "(:id,:owner,'gpx','Synthetic','2026-10-12','timestamp','UTC',0,'complete','{}','gpx-v1')"
        ),
        {"id": identifier, "owner": owner},
    )
    return identifier


def rejected(db, sql, params=None):
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text(sql), params or {})


def test_owner_fingerprint_uniqueness_and_nullable_canonical(db):
    a, b = user(db), user(db)

    def insert(owner, raw, canonical=None, target=None):
        db.execute(
            text(
                "INSERT INTO gpx_imports "
                "(id,activity_id,user_id,original_filename,raw_gpx,byte_size,raw_sha256,canonical_sha256,fingerprint_version,parser_version)"
                " VALUES "
                "(:id,:activity,:owner,'test.gpx',:bytes,1,:raw,:canonical,'canonical-v1','gpx-parser-v1')"
            ),
            {
                "id": uuid4(),
                "activity": target or activity(db, owner),
                "owner": owner,
                "bytes": b"x",
                "raw": raw * 64,
                "canonical": canonical * 64 if canonical else None,
            },
        )

    insert(a, "a", "c")
    insert(b, "a", "c")
    for raw, canonical, target in [
        ("a", None, None),
        ("b", "c", None),
        ("d", None, activity(db, b)),
    ]:
        with pytest.raises(DBAPIError), db.begin_nested():
            insert(a, raw, canonical, target)
    insert(a, "e")
    insert(a, "f")
    assert db.scalar(text("SELECT count(*) FROM gpx_imports")) == 4


@pytest.mark.parametrize(
    "expression",
    [
        "ST_GeomFromText('POINT(0 0)',3857)",
        "ST_GeomFromText('LINESTRING(0 0,1 1)',4326)",
        "ST_GeomFromText('POINT(181 0)',4326)",
        "ST_GeomFromText('POINT(0 91)',4326)",
        "ST_GeomFromText('POINT(NaN 0)',4326)",
        "ST_GeomFromText('POINT EMPTY',4326)",
    ],
)
def test_point_rejects_wrong_srid_type_and_invalid_coordinates(db, expression):
    segment = uuid4()
    db.execute(
        text(
            "INSERT INTO activity_segments "
            "(id,activity_id,segment_index,source_track_index,source_segment_index,break_reason,point_count)"
            " VALUES (:id,:activity,0,0,0,'source_boundary',1)"
        ),
        {"id": segment, "activity": activity(db, user(db))},
    )
    rejected(
        db,
        "INSERT INTO activity_points (segment_id,point_index,source_point_index,position) "
        f"VALUES (:segment,0,0,{expression})",
        {"segment": segment},
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("distance_m", "'-1'"),
        ("distance_m", "'NaN'"),
        ("distance_m", "'Infinity'"),
        ("elapsed_seconds", "'-1'"),
        ("avg_pace_seconds_per_km", "'1000000000'"),
        ("source", "'invalid'"),
        ("temporal_quality", "'unknown'"),
        ("notes", "repeat('x',5001)"),
    ],
)
def test_activity_rejects_invalid_metrics_and_categories(db, field, value):
    identifier = activity(db, user(db))
    rejected(db, f"UPDATE activities SET {field}={value} WHERE id=:id", {"id": identifier})


def test_zero_length_line_single_point_and_microseconds_roundtrip(db):
    from datetime import datetime

    from app.modules.gpx.model import ActivityPoint, ActivitySegment

    identifier = activity(db, user(db))
    single, stationary = uuid4(), uuid4()
    db.execute(
        text(
            "INSERT INTO activity_segments "
            "(id,activity_id,segment_index,source_track_index,source_segment_index,break_reason,point_count,geom)"
            " VALUES "
            "(:a,:activity,0,0,0,'source_boundary',1,NULL),(:b,:activity,1,0,1,'source_boundary',2,ST_GeomFromText('LINESTRING(0"
            " 0,0 0)',4326))"
        ),
        {"a": single, "b": stationary, "activity": identifier},
    )
    with Session(bind=db, join_transaction_mode="create_savepoint") as session:
        stamp = datetime(2026, 10, 12, 0, 0, 0, 123456, tzinfo=UTC)
        session.add(
            ActivityPoint(
                segment_id=single,
                point_index=0,
                source_point_index=0,
                position="SRID=4326;POINT(180 90)",
                recorded_at=stamp,
            )
        )
        session.flush()
        session.expire_all()
        assert session.get(ActivityPoint, (single, 0)).recorded_at == stamp
        assert session.get(ActivitySegment, single).geom is None
        assert session.get(ActivitySegment, stationary).point_count == 2
    assert (
        db.scalar(
            text("SELECT ST_Length(geom::geography) FROM activity_segments WHERE id=:id"),
            {"id": stationary},
        )
        == 0
    )


@pytest.mark.parametrize(
    "rows", [["0001_postgis"], ["0002_auth"], ["unknown"], [], ["0003_gpx_storage", "unexpected"]]
)
def test_ready_requires_exact_release_revision_and_live_stays_available(db, rows):
    db.execute(
        text("DELETE FROM alembic_version")
    )  # Rollback-only transaction in isolated test DB.
    for revision in rows:
        db.execute(text("INSERT INTO alembic_version VALUES (:revision)"), {"revision": revision})
    app = create_app(
        Settings(database_url=os.environ["TEST_DATABASE_URL"], app_env="test", _env_file=None)
    )

    def override():
        with Session(bind=db) as session:
            yield session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as client:
        assert client.get("/api/v1/health/ready").status_code == 503
        assert client.get("/api/health").status_code == 503
        assert client.get("/api/v1/health/live").status_code == 200


def test_auth_storage_defaults_anonymous_session_and_unique_identity(db):
    from app.modules.auth.model import AuthRateBucket, AuthSession
    from app.modules.users.model import User

    owner = user(db)
    with Session(bind=db, join_transaction_mode="create_savepoint") as session:
        saved = session.get(User, owner)
        assert (saved.timezone, saved.profile_is_public, saved.activity_data_version) == (
            "Asia/Shanghai",
            False,
            0,
        )
        session.add(
            AuthSession(
                token_hash="a" * 64,
                csrf_token="b" * 64,
                expires_at=text("now() + interval '10 minutes'"),
            )
        )
        session.add(
            AuthRateBucket(
                scope="csrf-ip",
                subject_hash="c" * 64,
                window_start=text("now()"),
                expires_at=text("now()"),
            )
        )
        session.flush()
        anonymous = session.query(AuthSession).one()
        assert anonymous.user_id is None
        assert anonymous.revoked_at is None
        assert session.query(AuthRateBucket).one().attempts == 0
        session.commit()
    rejected(db, "UPDATE users SET activity_data_version=-1 WHERE id=:id", {"id": owner})
    second = user(db)
    for column in ("email_normalized", "username"):
        rejected(
            db,
            f"UPDATE users SET {column}=(SELECT {column} FROM users WHERE id=:a) WHERE id=:b",
            {"a": owner, "b": second},
        )
    rejected(
        db,
        "INSERT INTO auth_sessions (id,token_hash,csrf_token,expires_at) "
        "VALUES (:id,:hash,'csrf',now())",
        {"id": uuid4(), "hash": "a" * 64},
    )
    rejected(db, "UPDATE auth_rate_buckets SET attempts=-1")
    rejected(db, "UPDATE auth_rate_buckets SET scope='unsupported'")


@pytest.mark.parametrize("size,content", [(0, b""), (2, b"x"), (10485761, b"x")])
def test_raw_storage_rejects_empty_oversize_or_inconsistent_bytes(db, size, content):
    owner = user(db)
    rejected(
        db,
        "INSERT INTO gpx_imports "
        "(id,activity_id,user_id,original_filename,raw_gpx,byte_size,raw_sha256,"
        "fingerprint_version,parser_version) "
        "VALUES (:id,:activity,:owner,'test.gpx',:raw,:size,:hash,'canonical-v1','gpx-parser-v1')",
        {
            "id": uuid4(),
            "activity": activity(db, owner),
            "owner": owner,
            "raw": content,
            "size": size,
            "hash": "a" * 64,
        },
    )


@pytest.mark.parametrize(
    "geom,count",
    [
        ("ST_GeomFromText('LINESTRING(0 0,1 1)',3857)", 2),
        ("ST_GeomFromText('POINT(0 0)',4326)", 2),
        ("ST_GeomFromText('LINESTRING(0 0,181 0)',4326)", 2),
        ("ST_GeomFromText('LINESTRING EMPTY',4326)", 2),
        ("ST_GeomFromText('LINESTRING(0 0,1 1)',4326)", 3),
        ("NULL", 2),
        ("NULL", 0),
    ],
)
def test_segments_reject_invalid_geometry_and_counts(db, geom, count):
    rejected(
        db,
        "INSERT INTO activity_segments "
        "(id,activity_id,segment_index,source_track_index,source_segment_index,"
        "break_reason,point_count,geom) "
        f"VALUES (:id,:activity,0,0,0,'source_boundary',:count,{geom})",
        {"id": uuid4(), "activity": activity(db, user(db)), "count": count},
    )


def test_golden_six_points_preserve_order_null_elevation_and_geography(db):
    import gpxpy

    from app.modules.gpx.model import ActivityPoint, ActivitySegment

    # Reuse S2-01 input; this verifies storage, not the S2-04 parser or S2-05 metrics.
    source = gpxpy.parse((BACKEND / "tests/fixtures/gpx/equator-six.gpx").read_text())
    points = source.tracks[0].segments[0].points
    identifier = activity(db, user(db))
    segment = uuid4()
    with Session(bind=db, join_transaction_mode="create_savepoint") as session:
        line = (
            "SRID=4326;LINESTRING(" + ",".join(f"{p.longitude} {p.latitude}" for p in points) + ")"
        )
        session.add(
            ActivitySegment(
                id=segment,
                activity_id=identifier,
                segment_index=0,
                source_track_index=0,
                source_segment_index=0,
                break_reason="source_boundary",
                point_count=6,
                geom=line,
            )
        )
        session.flush()
        session.add_all(
            [
                ActivityPoint(
                    segment_id=segment,
                    point_index=i,
                    source_point_index=i,
                    position=f"SRID=4326;POINT({p.longitude} {p.latitude})",
                    recorded_at=p.time,
                    elevation_m=None,
                )
                for i, p in enumerate(points)
            ]
        )
        session.flush()
        session.commit()
    rows = db.execute(
        text(
            "SELECT point_index,source_point_index,ST_X(position),ST_Y(position),"
            "elevation_m FROM activity_points ORDER BY point_index"
        )
    ).all()
    assert [r[0] for r in rows] == [0, 1, 2, 3, 4, 5]
    assert [r[1] for r in rows] == [0, 1, 2, 3, 4, 5]
    assert [r[2] for r in rows] == pytest.approx([0, 0.002, 0.004, 0.006, 0.008, 0.01])
    assert all(r[3] == 0 and r[4] is None for r in rows)
    assert db.scalar(
        text("SELECT ST_Length(geom::geography) FROM activity_segments")
    ) == pytest.approx(1113.194908, abs=0.001)
    rejected(db, "UPDATE activity_points SET elevation_m='NaN' WHERE point_index=0")
    rejected(db, "UPDATE activity_points SET point_index=-1 WHERE point_index=0")
    rejected(db, "UPDATE activity_segments SET segment_index=-1")
    rejected(db, "INSERT INTO activity_segments SELECT * FROM activity_segments")
