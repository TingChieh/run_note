"""Integration tests for AI assistant Phase 1 on an isolated PostGIS _test database.

Covers: all 10 read-only tools, canary privacy zero-leakage, cross-user 404 isolation,
consent lifecycle, concurrency/idempotency/quota limits, and migration downgrade guards.
"""

import json
import os
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import hash_password
from app.modules.activities.model import Activity
from app.modules.ai_assistant import service as assistant_service
from app.modules.ai_assistant.model import AIMessage, AIUserConsent
from app.modules.ai_assistant.tools import TOOL_NAMES, ToolContext, execute_tool
from app.modules.footprints.global_atlas import atlas_version as global_atlas_version
from app.modules.footprints.model import ActivityGlobalFootprintCache, ActivityProvinceCache
from app.modules.footprints.provinces import atlas_version as china_atlas_version
from app.modules.gpx.model import ActivityPoint, ActivitySegment, GpxImport
from app.modules.route_groups.model import RouteFingerprint, RouteGroup, RouteGroupMember
from app.modules.running_goals.model import RunningGoal
from app.modules.users.model import User, UserAvatar
from app.modules.wellbeing.model import DailyEntry, DoseEvent, Medication, SymptomEvent
from tests.integration.test_migrations import assert_downgrade_guard

pytestmark = pytest.mark.integration

# Distinctive canary strings that must NEVER appear in any outbound AI model payload.
CANARY_EMAIL = "canary-owner-email-991@example.test"
CANARY_USERNAME = "canary_user_x991"
CANARY_BIO = "CANARY_BIO_SECRET_7781"
CANARY_TITLE = "CANARY_ACTIVITY_TITLE_HOME_LOOP"
CANARY_TAG = "CANARY_TAG_SECRET"
CANARY_NOTE = "CANARY_ACTIVITY_NOTE_INJURY"
CANARY_FILENAME = "canary-secret-home-route.gpx"
CANARY_WELLBEING_MED = "CANARY_MEDICATION_RX99"
CANARY_WELLBEING_SYMPTOM = "CANARY_SYMPTOM_DIZZY99"
CANARY_WELLBEING_NOTE = "CANARY_WELLBEING_DIARY_NOTE99"
CANARY_LON = "120.155123"
CANARY_LAT = "30.274189"


@pytest.fixture
def assistant_db():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit isolated test database required")
    engine = create_engine(url, hide_parameters=True)
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    created_users: list[UUID] = []
    try:
        yield engine, SessionLocal, created_users
    finally:
        if created_users:
            with SessionLocal.begin() as db:
                for uid in created_users:
                    user = db.get(User, uid)
                    if user is not None:
                        db.delete(user)
        engine.dispose()


def _make_settings(url: str, **overrides) -> Settings:
    return Settings(
        database_url=url,
        site_origin="http://127.0.0.1:5183",
        auth_rate_hash_key=uuid4().hex,
        ai_base_url="https://api.deepseek.com",
        ai_model="deepseek-chat",
        ai_api_key="synthetic-test-key",
        _env_file=None,
        **overrides,
    )


def _create_user(db, created_users: list[UUID], *, email=None, username=None, bio="") -> User:
    suffix = uuid4().hex[:10]
    user = User(
        email_normalized=email or f"ai_{suffix}@example.test",
        username=username or f"ai_{suffix}",
        display_name="Synthetic Runner",
        password_hash=hash_password("Synthetic-password-2026"),
        is_active=True,
        timezone="Asia/Shanghai",
        bio=bio,
    )
    db.add(user)
    db.flush()
    created_users.append(user.id)
    return user


def _seed_rich_owner_data(db, owner_id: UUID):
    """Seed activities, GPX, goals, footprint caches, route group, avatar, and wellbeing."""
    db.add(UserAvatar(user_id=owner_id, png_bytes=b"\x89PNG\r\n\x1a\ncanary", sha256="a" * 64))

    acts = []
    specs = [
        (
            date(2025, 11, 10),
            Decimal("5000.000"),
            Decimal("1600.000"),
            Decimal("320.000"),
            155,
            "5km",
        ),
        (
            date(2026, 10, 12),
            Decimal("5000.000"),
            Decimal("1400.000"),
            Decimal("280.000"),
            160,
            "5km",
        ),
        (
            date(2026, 11, 10),
            Decimal("10000.000"),
            Decimal("2900.000"),
            Decimal("290.000"),
            158,
            "10km",
        ),
        (
            date(2026, 11, 20),
            Decimal("10000.000"),
            Decimal("2800.000"),
            Decimal("280.000"),
            162,
            "10km",
        ),
    ]
    for idx, (day, dist, secs, pace, hr, cat) in enumerate(specs):
        act = Activity(
            user_id=owner_id,
            source="gpx",
            title=f"{CANARY_TITLE}_{idx}",
            notes=f"{CANARY_NOTE}_{idx}",
            category=cat,
            tags=[CANARY_TAG],
            activity_date=day,
            date_source="timestamp",
            timezone="Asia/Shanghai",
            distance_m=dist,
            elapsed_seconds=secs,
            timer_seconds=secs,
            calories_kcal=300 + idx * 100,
            steps=4500 + idx * 1000,
            avg_heart_rate_bpm=hr,
            max_heart_rate_bpm=hr + 15,
            min_heart_rate_bpm=hr - 25,
            avg_pace_seconds_per_km=pace,
            temporal_quality="complete",
            quality_summary={"warnings": []},
            metrics_version="gpx-v1",
            visibility="private",
        )
        db.add(act)
        db.flush()
        acts.append(act)

    # Attach GPX raw file, segment, and exact canary coordinates to the latest activity.
    latest = acts[-1]
    raw_bytes = b"<gpx>canary</gpx>"
    db.add(
        GpxImport(
            activity_id=latest.id,
            user_id=owner_id,
            original_filename=CANARY_FILENAME,
            raw_gpx=raw_bytes,
            byte_size=len(raw_bytes),
            raw_sha256=uuid4().hex + uuid4().hex,
            fingerprint_version="v1",
            parser_version="v1",
        )
    )
    seg = ActivitySegment(
        activity_id=latest.id,
        segment_index=0,
        source_track_index=0,
        source_segment_index=0,
        break_reason="source_boundary",
        point_count=2,
        geom=f"SRID=4326;LINESTRING({CANARY_LON} {CANARY_LAT}, 120.165123 30.284189)",
    )
    db.add(seg)
    db.flush()
    db.add_all(
        [
            ActivityPoint(
                segment_id=seg.id,
                point_index=0,
                source_point_index=0,
                position=f"SRID=4326;POINT({CANARY_LON} {CANARY_LAT})",
            ),
            ActivityPoint(
                segment_id=seg.id,
                point_index=1,
                source_point_index=1,
                position="SRID=4326;POINT(120.165123 30.284189)",
            ),
        ]
    )

    # Province & global footprint caches for all seeded activities (avoid slow live spatial scan).
    c_ver = china_atlas_version()
    g_ver = global_atlas_version()
    for act in acts:
        db.add(
            ActivityProvinceCache(
                user_id=owner_id,
                activity_id=act.id,
                atlas_version=c_ver,
                province_codes=[330000],
            )
        )
        db.add(
            ActivityGlobalFootprintCache(
                user_id=owner_id,
                activity_id=act.id,
                atlas_version=g_ver,
                region_codes=["CN-ZJ"],
                city_codes=[],
            )
        )

    # Running goals.
    db.add_all(
        [
            RunningGoal(user_id=owner_id, period="week", target_km=Decimal("25.0")),
            RunningGoal(user_id=owner_id, period="month", target_km=Decimal("100.0")),
            RunningGoal(user_id=owner_id, period="year", target_km=Decimal("500.0")),
        ]
    )

    # Route group (2 member runs with simplified fingerprint geometry).
    group = RouteGroup(user_id=owner_id, algorithm_version="v1")
    db.add(group)
    db.flush()
    for act in acts[2:]:
        db.add(
            RouteFingerprint(
                user_id=owner_id,
                activity_id=act.id,
                algorithm_version="v1",
                geom=(
                    f"SRID=4326;MULTILINESTRING(({CANARY_LON} {CANARY_LAT}, 120.165123 30.284189))"
                ),
            )
        )
        db.add(
            RouteGroupMember(
                activity_id=act.id,
                user_id=owner_id,
                group_id=group.id,
                coverage=0.95,
            )
        )

    # Private wellbeing records with canary secrets (must NEVER leak).
    med = Medication(user_id=owner_id, name=CANARY_WELLBEING_MED)
    db.add(med)
    db.flush()
    db.add(
        DailyEntry(
            user_id=owner_id,
            entry_date=date(2026, 11, 20),
            mood=6,
            anxiety=4,
            sleep_hours=Decimal("7.50"),
            note=CANARY_WELLBEING_NOTE,
        )
    )
    db.add(
        DoseEvent(
            user_id=owner_id,
            entry_date=date(2026, 11, 20),
            medication_name=CANARY_WELLBEING_MED,
            dose_amount=Decimal("10.000"),
            dose_unit="mg",
            medication_id=med.id,
            taken_at=datetime(2026, 11, 20, 8, 0, tzinfo=UTC),
            regimen="scheduled",
            note=CANARY_WELLBEING_NOTE,
        )
    )
    db.add(
        SymptomEvent(
            user_id=owner_id,
            entry_date=date(2026, 11, 20),
            symptom=CANARY_WELLBEING_SYMPTOM,
            severity=3,
            onset_at=datetime(2026, 11, 20, 9, 0, tzinfo=UTC),
        )
    )
    db.flush()
    return acts, group


def test_all_10_tools_and_canary_privacy_zero_leakage(assistant_db):
    _, SessionLocal, created_users = assistant_db
    with SessionLocal.begin() as db:
        owner = _create_user(
            db,
            created_users,
            email=CANARY_EMAIL,
            username=CANARY_USERNAME,
            bio=CANARY_BIO,
        )
        other = _create_user(db, created_users)
        acts, group = _seed_rich_owner_data(db, owner.id)
        # Seed distinct activity for other user to verify owner filtering in aggregates.
        db.add(
            Activity(
                user_id=other.id,
                source="manual",
                title="OTHER_USER_SECRET",
                notes="OTHER_USER_NOTE",
                category="全马",
                activity_date=date(2026, 11, 19),
                date_source="manual",
                timezone="Asia/Shanghai",
                distance_m=Decimal("42195.000"),
                elapsed_seconds=Decimal("10800.000"),
                avg_pace_seconds_per_km=Decimal("255.954"),
                temporal_quality="manual",
                quality_summary={"warnings": []},
                metrics_version="manual-v1",
            )
        )
        db.flush()
        owner_id = owner.id
        other_id = other.id
        latest_act_id = acts[-1].id
        group_id = group.id

    ctx = ToolContext(owner_id=owner_id, timezone="Asia/Shanghai", today=date(2026, 11, 22))
    calls = [
        ("get_running_summary", {"date_from": "2026-11-01", "date_to": "2026-12-01"}),
        (
            "get_running_trends",
            {
                "date_from": "2026-10-05",
                "date_to": "2026-11-23",
                "period": "week",
                "include_device_metrics": True,
            },
        ),
        ("get_period_report", {"period": "month", "year": 2026, "month": 11}),
        (
            "compare_periods",
            {
                "period_a": {
                    "date_from": "2026-11-01",
                    "date_to": "2026-12-01",
                    "label": "今年11月",
                },
                "period_b": {
                    "date_from": "2025-11-01",
                    "date_to": "2025-12-01",
                    "label": "去年11月",
                },
            },
        ),
        (
            "get_personal_records",
            {"sections": ["personal_bests", "totals", "yearly", "weekday", "weekly", "monthly"]},
        ),
        ("get_streaks_and_goals", {}),
        ("search_activities", {"category": "10km", "sort": "pace_asc", "limit": 10}),
        ("get_activity_detail", {"activity_id": str(latest_act_id)}),
        ("get_footprint_summary", {"scope": "china", "year": 2026}),
        ("get_footprint_summary", {"scope": "global", "year": 2026}),
        ("get_frequent_routes", {"sort": "count", "limit": 5}),
        ("get_frequent_routes", {"group_id": str(group_id)}),
    ]

    canaries = (
        CANARY_EMAIL,
        CANARY_USERNAME,
        CANARY_BIO,
        CANARY_TITLE,
        CANARY_TAG,
        CANARY_NOTE,
        CANARY_FILENAME,
        CANARY_WELLBEING_MED,
        CANARY_WELLBEING_SYMPTOM,
        CANARY_WELLBEING_NOTE,
        CANARY_LON,
        CANARY_LAT,
        "120.165123",
        "30.284189",
        "OTHER_USER_SECRET",
        "OTHER_USER_NOTE",
        "42195",
    )

    executed_names = set()
    with SessionLocal() as db:
        for tool_name, args in calls:
            result = execute_tool(db, ctx, tool_name, args)
            executed_names.add(tool_name)
            serialized = json.dumps(result.model_payload, ensure_ascii=False)
            for secret in canaries:
                assert secret not in serialized, f"Canary {secret!r} leaked in {tool_name}"
            assert result.ui_blocks, f"Expected UI blocks for {tool_name}"

        assert executed_names == set(TOOL_NAMES)

        # Verify authoritative numbers on owner-only summary (2 runs = 20,000 m in Nov 2026).
        nov_summary = execute_tool(
            db, ctx, "get_running_summary", {"date_from": "2026-11-01", "date_to": "2026-12-01"}
        )
        assert nov_summary.model_payload["summary"]["activity_count"] == 2
        assert nov_summary.model_payload["summary"]["distance_m"] == "20000.000"

        # Cross-user tool isolation: User B gets 404 for User A's activity_id and group_id.
        other_ctx = ToolContext(
            owner_id=other_id, timezone="Asia/Shanghai", today=date(2026, 11, 22)
        )
        with pytest.raises(ApiError) as act_err:
            execute_tool(db, other_ctx, "get_activity_detail", {"activity_id": str(latest_act_id)})
        assert act_err.value.status_code == 404

        with pytest.raises(ApiError) as grp_err:
            execute_tool(db, other_ctx, "get_frequent_routes", {"group_id": str(group_id)})
        assert grp_err.value.status_code == 404


def test_cross_user_404_consent_concurrency_idempotency_and_quotas(assistant_db):
    _, SessionLocal, created_users = assistant_db
    url = os.environ["TEST_DATABASE_URL"]
    settings = _make_settings(
        url,
        ai_daily_message_limit=2,
        ai_daily_token_budget=10_000,
        ai_site_daily_token_budget=50_000,
    )
    now = datetime(2026, 11, 22, 10, 0, tzinfo=UTC)

    with SessionLocal.begin() as db:
        user_a = _create_user(db, created_users)
        user_b = _create_user(db, created_users)
        conv_a = assistant_service.create_conversation(db, user_a.id, now, title="User A Chat")
        conv_a2 = assistant_service.create_conversation(db, user_a.id, now, title="User A Chat 2")
        conv_b = assistant_service.create_conversation(db, user_b.id, now, title="User B Chat")

        # Cross-user 404 on conversations.
        with pytest.raises(ApiError) as err:
            assistant_service.owned_conversation(db, user_b.id, conv_a.id)
        assert err.value.status_code == 404
        with pytest.raises(ApiError) as err:
            assistant_service.delete_conversation(db, user_b.id, conv_a.id, now, settings)
        assert err.value.status_code == 404

        # Consent required before first turn.
        key_1 = uuid4()
        with pytest.raises(ApiError) as err:
            assistant_service.begin_turn(db, user_a.id, conv_a.id, "你好", key_1, now, settings)
        assert err.value.status_code == 403
        assert err.value.code == "AI_CONSENT_REQUIRED"

        # Grant consent, then revoke, then re-grant.
        c = assistant_service.grant_consent(db, user_a.id, now)
        assert c.consented is True
        c = assistant_service.revoke_consent(db, user_a.id, now + timedelta(seconds=5))
        assert c.consented is False
        with pytest.raises(ApiError) as err:
            assistant_service.begin_turn(db, user_a.id, conv_a.id, "你好", key_1, now, settings)
        assert err.value.code == "AI_CONSENT_REQUIRED"
        assistant_service.grant_consent(db, user_a.id, now + timedelta(seconds=10))
        assistant_service.grant_consent(db, user_b.id, now + timedelta(seconds=10))

        # Begin turn 1 -> pending; concurrent turn 2 fails 409 AI_IN_PROGRESS.
        u1, a1, replayed = assistant_service.begin_turn(
            db, user_a.id, conv_a.id, "总结我近四周跑量", key_1, now, settings
        )
        assert replayed is False
        assert u1.status == "succeeded" and a1.status == "pending"

        # Cross-user 404 on message id.
        with pytest.raises(ApiError) as err:
            assistant_service.owned_message(db, user_b.id, a1.id)
        assert err.value.status_code == 404

        with pytest.raises(ApiError) as err:
            assistant_service.begin_turn(
                db, user_a.id, conv_a.id, "并发提问", uuid4(), now + timedelta(seconds=1), settings
            )
        assert err.value.status_code == 409
        assert err.value.code == "AI_IN_PROGRESS"

        # DB partial unique index also rejects a direct second active assistant message.
        with pytest.raises(IntegrityError), db.begin_nested():
            db.add(
                AIMessage(
                    conversation_id=conv_a.id,
                    user_id=user_a.id,
                    role="assistant",
                    status="streaming",
                    source_data_version=0,
                    created_at=now,
                    finished_at=None,
                )
            )
            db.flush()

        # Cannot delete conversation while generating.
        with pytest.raises(ApiError) as err:
            assistant_service.delete_conversation(db, user_a.id, conv_a.id, now, settings)
        assert err.value.status_code == 409

        # Transition pending -> streaming -> succeeded with token usage.
        assert assistant_service.mark_streaming(db, user_a.id, a1.id) is True
        assert (
            assistant_service.finish_turn(
                db,
                user_a.id,
                a1.id,
                "succeeded",
                finished_at=now + timedelta(seconds=3),
                content="这是你的四周总结。",
                input_tokens=6000,
                output_tokens=2000,
                cached_input_tokens=3000,
            )
            is True
        )

        # Idempotent replay returns same turn without consuming quota; different conv conflicts 409.
        _, a1_replay, replayed = assistant_service.begin_turn(
            db,
            user_a.id,
            conv_a.id,
            "总结我近四周跑量",
            key_1,
            now + timedelta(seconds=4),
            settings,
        )
        assert replayed is True
        assert a1_replay.id == a1.id
        with pytest.raises(ApiError) as err:
            assistant_service.begin_turn(
                db,
                user_a.id,
                conv_a2.id,
                "总结我近四周跑量",
                key_1,
                now + timedelta(seconds=4),
                settings,
            )
        assert err.value.status_code == 409
        assert err.value.code == "IDEMPOTENCY_CONFLICT"

        # Turn 2 uses 2500 more tokens (total 10,500 > 10,000 daily user budget) and 2/2 messages.
        key_2 = uuid4()
        _, a2, _ = assistant_service.begin_turn(
            db, user_a.id, conv_a.id, "查 5K 最佳成绩", key_2, now + timedelta(seconds=5), settings
        )
        assistant_service.finish_turn(
            db,
            user_a.id,
            a2.id,
            "succeeded",
            finished_at=now + timedelta(seconds=6),
            content="5K PB 详情。",
            input_tokens=2000,
            output_tokens=500,
        )

        # Deleting conv_a wipes contents and does NOT refund quota.
        assistant_service.delete_conversation(
            db, user_a.id, conv_a.id, now + timedelta(seconds=7), settings
        )
        wiped = db.scalar(select(AIMessage).where(AIMessage.id == a1.id))
        assert wiped.deleted_at is not None and wiped.content is None and wiped.ui_blocks == []

        # User A hits daily message limit (429 AI_QUOTA_EXCEEDED) even after deleting conv_a.
        with pytest.raises(ApiError) as err:
            assistant_service.begin_turn(
                db, user_a.id, conv_a2.id, "第三问", uuid4(), now + timedelta(seconds=8), settings
            )
        assert err.value.status_code == 429
        assert err.value.code == "AI_QUOTA_EXCEEDED"

        # Raising message limit still hits user token budget (10,500 >= 10,000).
        token_settings = _make_settings(
            url,
            ai_daily_message_limit=30,
            ai_daily_token_budget=10_000,
            ai_site_daily_token_budget=50_000,
        )
        with pytest.raises(ApiError) as err:
            assistant_service.begin_turn(
                db,
                user_a.id,
                conv_a2.id,
                "token超限测试",
                uuid4(),
                now + timedelta(seconds=9),
                token_settings,
            )
        assert err.value.status_code == 429
        assert err.value.code == "AI_QUOTA_EXCEEDED"

        # User B adds 40,000 tokens -> site total reaches 50,500 >= 50,000 -> 503.
        site_settings = _make_settings(
            url,
            ai_daily_message_limit=30,
            ai_daily_token_budget=100_000,
            ai_site_daily_token_budget=50_000,
        )
        _, b1, _ = assistant_service.begin_turn(
            db,
            user_b.id,
            conv_b.id,
            "用户B首问",
            uuid4(),
            now + timedelta(seconds=10),
            site_settings,
        )
        assistant_service.finish_turn(
            db,
            user_b.id,
            b1.id,
            "succeeded",
            finished_at=now + timedelta(seconds=11),
            content="用户B回复。",
            input_tokens=30000,
            output_tokens=10000,
        )
        with pytest.raises(ApiError) as err:
            assistant_service.begin_turn(
                db,
                user_b.id,
                conv_b.id,
                "全站熔断测试",
                uuid4(),
                now + timedelta(seconds=12),
                site_settings,
            )
        assert err.value.status_code == 503
        assert err.value.code == "AI_BUDGET_EXHAUSTED"

        # Stale pending message recovery frees concurrency lock after timeout + 60s.
        relaxed = _make_settings(
            url,
            ai_daily_message_limit=30,
            ai_daily_token_budget=100_000,
            ai_site_daily_token_budget=200_000,
        )
        _, b2, _ = assistant_service.begin_turn(
            db, user_b.id, conv_b.id, "超时测试", uuid4(), now + timedelta(seconds=20), relaxed
        )
        later = now + timedelta(seconds=relaxed.ai_stream_total_timeout_seconds + 85)
        assistant_service.recover_stale_messages(db, user_b.id, later, relaxed)
        db.refresh(b2)
        assert b2.status == "failed" and b2.error_code == "AI_TIMEOUT"


def test_migration_0033_defensive_downgrade_refuses_to_drop_data(assistant_db):
    engine, SessionLocal, created_users = assistant_db
    now = datetime(2026, 11, 22, 10, 0, tzinfo=UTC)
    with SessionLocal.begin() as db:
        owner = _create_user(db, created_users)
        db.add(AIUserConsent(user_id=owner.id, consent_version="ai-assistant-v1", consented_at=now))
        db.flush()

    assert_downgrade_guard(engine, "0033_ai_assistant", "Refusing to drop AI assistant tables")
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM ai_user_consents")) >= 1
