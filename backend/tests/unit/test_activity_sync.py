"""Unit tests for activity incremental sync cursor encoding/decoding and validation."""

from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.core.errors import ApiError
from app.modules.activities.service import decode_sync_cursor, encode_sync_cursor


def test_sync_cursor_round_trips_timezone_aware_timestamp_and_uuid():
    ts = datetime(2026, 11, 23, 12, 34, 56, 789000, tzinfo=UTC)
    identifier = UUID("11111111-1111-4111-8111-111111111111")
    encoded = encode_sync_cursor(ts, identifier)
    assert "|" not in encoded
    assert len(encoded) <= 128
    decoded_ts, decoded_id = decode_sync_cursor(encoded)
    assert decoded_ts == ts
    assert decoded_id == identifier


@pytest.mark.parametrize(
    "bad_cursor",
    [
        "",
        "not-valid-base64!!!",
        "MjAyNi0xMS0yM1QxMjowMDowMHwxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTE",  # naive ts
        "MjAyNi0xMS0yM1QxMjowMDowMFp8bm90LWEtdXVpZA",  # invalid uuid
        "MjAyNi0xMS0yM1QxMjowMDowMFp8MTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExfGV4dHJh",
        "a" * 129,
    ],
)
def test_decode_sync_cursor_rejects_malformed_values(bad_cursor):
    with pytest.raises(ApiError) as exc_info:
        decode_sync_cursor(bad_cursor)
    assert exc_info.value.status_code == 422
    assert exc_info.value.code == "VALIDATION_ERROR"
