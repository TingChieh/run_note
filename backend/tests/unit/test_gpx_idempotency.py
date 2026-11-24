"""Unit tests for GPX upload Idempotency-Key helpers (no database)."""

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
