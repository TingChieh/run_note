"""Unit tests for GPX upload Idempotency-Key helpers (no database)."""

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.core.errors import ApiError
from app.modules.gpx.service import (
    IDEMPOTENT_PARSER_VERSION,
    find_idempotent_replay,
    idempotency_filename,
)


def test_idempotency_filename_and_parser_version_are_disjoint_from_regular_uploads():
    key = UUID("11111111-2222-4333-8444-555555555555")
    tag = idempotency_filename(key, "gpx")
    assert tag == "idempotency:11111111-2222-4333-8444-555555555555.gpx"
    assert len(tag) <= 255
    assert IDEMPOTENT_PARSER_VERSION != "gpx-parser-v1"
    assert len(IDEMPOTENT_PARSER_VERSION) <= 32


def test_find_idempotent_replay_ignores_non_gpx_formats():
    class UnusedDB:
        def scalar(self, *_args, **_kwargs):
            raise AssertionError("non-gpx format must short-circuit without querying DB")

    assert find_idempotent_replay(UnusedDB(), uuid4(), uuid4(), "0" * 64, format="tcx") is None


def test_find_idempotent_replay_rejects_mismatched_payload_hash():
    owner = uuid4()
    key = uuid4()

    class StubDB:
        def scalar(self, *_args, **_kwargs):
            return SimpleNamespace(
                id=uuid4(),
                activity_id=uuid4(),
                user_id=owner,
                raw_sha256="a" * 64,
            )

    with pytest.raises(ApiError) as exc:
        find_idempotent_replay(StubDB(), owner, key, "b" * 64, format="gpx")
    assert exc.value.status_code == 409
    assert exc.value.code == "IDEMPOTENCY_CONFLICT"


def test_find_idempotent_replay_returns_none_when_no_prior_import():
    class EmptyDB:
        def scalar(self, *_args, **_kwargs):
            return None

    assert find_idempotent_replay(EmptyDB(), uuid4(), uuid4(), "a" * 64, format="gpx") is None


def test_find_idempotent_replay_returns_current_activity_view():
    owner = uuid4()
    activity_id = uuid4()
    import_id = uuid4()
    key = uuid4()
    now = datetime(2026, 11, 24, 6, 0, 0, tzinfo=UTC)

    existing_import = SimpleNamespace(
        id=import_id,
        activity_id=activity_id,
        user_id=owner,
        raw_sha256="a" * 64,
    )
    edited_activity = SimpleNamespace(
        id=activity_id,
        title="用户已修改的新标题",
        notes="修改备注",
        category="路跑",
        tags=["晨跑"],
        activity_date=date(2026, 11, 24),
        timezone="Asia/Shanghai",
        started_at=now,
        ended_at=now,
        distance_m=Decimal("5000.000"),
        elapsed_seconds=Decimal("1500.000"),
        timer_seconds=None,
        calories_kcal=None,
        steps=None,
        avg_heart_rate_bpm=None,
        max_heart_rate_bpm=None,
        min_heart_rate_bpm=None,
        avg_cadence_spm=None,
        max_cadence_spm=None,
        vo2_max_ml_kg_min=None,
        training_load=None,
        aerobic_training_effect=None,
        anaerobic_training_effect=None,
        avg_pace_seconds_per_km=Decimal("300.000"),
        temporal_quality="complete",
        quality_summary={"warnings": ["PACE_ADJUSTED"]},
        metrics_version="gpx-v1",
        visibility="public",
        allow_shared_route=False,
        created_at=now,
    )

    class StubReplayDB:
        def __init__(self):
            self.calls = 0

        def scalar(self, *_args, **_kwargs):
            self.calls += 1
            return existing_import if self.calls == 1 else edited_activity

        def execute(self, *_args, **_kwargs):
            return SimpleNamespace(one=lambda: (2, 120))

    replayed = find_idempotent_replay(StubReplayDB(), owner, key, "a" * 64, format="gpx")
    assert replayed is not None
    assert replayed.activity.id == activity_id
    assert replayed.activity.title == "用户已修改的新标题"
    assert replayed.activity.visibility == "public"
    assert replayed.import_id == import_id
    assert replayed.point_count == 120
    assert replayed.segment_count == 2
    assert replayed.warnings == ["PACE_ADJUSTED"]
    assert replayed.metrics_version == "gpx-v1"
