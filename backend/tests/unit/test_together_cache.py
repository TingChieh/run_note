import json
import zlib
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_session
from app.core.config import Settings
from app.main import create_app
from app.modules.together import cache
from app.modules.together.schema import TogetherView

NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)
USER_ID = UUID(int=11)
ACT_ID = UUID(int=22)
PATH = "/api/v1/together"


def sample_view(period="week") -> TogetherView:
    return TogetherView(
        distance_m=5000.0 if period == "week" else 15000.0,
        count=1 if period == "week" else 3,
        participants=[
            {
                "user_id": USER_ID,
                "avatar_version": "a1b2c3d4e5f60718",
                "username": "runner",
                "display_name": "合成跑者",
                "distance_m": 5000.0,
                "count": 1,
                "week_m": 5000.0,
                "month_m": 10000.0,
                "year_m": 15000.0,
            }
        ],
        recent=[
            {
                "id": ACT_ID,
                "username": "runner",
                "display_name": "合成跑者",
                "title": "晨跑",
                "category": "outdoor",
                "tags": ["轻松跑"],
                "temporal_quality": "full",
                "activity_date": date(2026, 10, 15),
                "distance_m": 5000.0,
                "avg_pace_seconds_per_km": 300.0,
                "elapsed_seconds": 1500.0,
                "timer_seconds": 1500.0,
                "avg_heart_rate_bpm": 145,
                "geometry": [{"type": "LineString", "coordinates": [[121.4, 31.2], [121.5, 31.3]]}],
            }
        ],
        tracks=[
            {
                "username": "runner",
                "activity_id": ACT_ID,
                "title": "晨跑",
                "activity_date": date(2026, 10, 15),
                "segment_index": 0,
                "geometry": {"type": "LineString", "coordinates": [[121.4, 31.2], [121.5, 31.3]]},
            }
        ],
        next_cursor=None,
        tracks_truncated=False,
    )


@pytest.fixture
def store(monkeypatch):
    cache._entries.clear()
    state = SimpleNamespace(version=1, mid_read_bump=False, reads=[])

    def fingerprint(db, settings, today):
        return (today, ((USER_ID, "runner", state.version),))

    def fake_overview(db, settings, now, period="week"):
        state.reads.append((settings.site_owner_email, period))
        if state.mid_read_bump:
            state.version += 1
        return sample_view(period)

    monkeypatch.setattr(cache, "_fingerprint", fingerprint)
    monkeypatch.setattr(cache, "overview", fake_overview)
    yield state
    cache._entries.clear()


@pytest.fixture
def client():
    app = create_app(
        Settings(
            database_url="postgresql+psycopg://synthetic@127.0.0.1:1/unused_test",
            auth_rate_hash_key="synthetic-unit-key-at-least-32-bytes",
            _env_file=None,
        )
    )
    app.state.clock = lambda: NOW
    app.dependency_overrides[get_session] = lambda: Mock()
    return TestClient(app)


def expected(period="week"):
    return json.loads(sample_view(period).model_dump_json())


def test_repeat_reads_serve_cached_view_without_recomputing_overview(store, client):
    first, second = client.get(PATH + "?period=year"), client.get(PATH + "?period=year")
    assert first.status_code == second.status_code == 200
    assert first.headers["cache-control"] == second.headers["cache-control"] == "no-store"
    assert first.json()["data"] == second.json()["data"] == expected("year")
    assert first.json()["meta"]["request_id"] != second.json()["meta"]["request_id"]
    assert first.json()["error"] is None
    assert len(store.reads) == 1


def test_periods_and_data_versions_are_cached_apart(store, client):
    week = client.get(PATH + "?period=week").json()["data"]
    year = client.get(PATH + "?period=year").json()["data"]
    assert week == expected("week") and year == expected("year")
    assert len(store.reads) == 2
    # Bumping participant version or advancing across Shanghai midnight invalidates the entry.
    store.version += 1
    client.get(PATH + "?period=year")
    assert len(store.reads) == 3
    client.app.state.clock = lambda: NOW + timedelta(days=1)
    client.get(PATH + "?period=year")
    assert len(store.reads) == 4


def test_a_change_during_overview_read_is_not_stored(store, client):
    store.mid_read_bump = True
    with client.stream("GET", PATH, headers={"Accept-Encoding": "gzip"}) as response:
        raw = b"".join(response.iter_raw())
        assert "content-encoding" not in response.headers
        assert json.loads(raw)["data"] == expected("week")
    assert not cache._entries


def test_entries_are_bounded():
    cache._entries.clear()
    for index in range(cache.MAX_ENTRIES + 3):
        cache._put((f"owner-{index}@example.com", "week"), ("id", index), (b"{}", b""))
    assert len(cache._entries) == cache.MAX_ENTRIES
    assert cache._get(("owner-0@example.com", "week"), ("id", 0)) is None
    cache._entries.clear()


def raw_get(client, url, accept):
    with client.stream("GET", url, headers={"Accept-Encoding": accept}) as response:
        return response, b"".join(response.iter_raw())


def test_a_cached_together_response_is_sent_as_one_valid_gzip_member(store, client):
    url = PATH + "?period=year"
    for _ in range(2):
        response, raw = raw_get(client, url, "br, gzip, zstd")
        assert response.headers["content-encoding"] == "gzip"
        assert response.headers["vary"] == "Accept-Encoding"
        assert response.headers["cache-control"] == "no-store"
        assert int(response.headers["content-length"]) == len(raw)
        inflater = zlib.decompressobj(31)
        text = inflater.decompress(raw)
        assert inflater.eof and not inflater.unused_data
        body = json.loads(text)
        assert body["data"] == expected("year") and body["error"] is None
        _, plain = raw_get(client, url, "identity")
        assert json.loads(plain)["data"] == body["data"]
    assert len(store.reads) == 1


@pytest.mark.parametrize("accept", ["identity", "br, zstd", "gzip;q=0", "gzip; q=0.0", ""])
def test_clients_that_do_not_accept_gzip_get_plain_json(store, client, accept):
    for _ in range(2):
        response, raw = raw_get(client, PATH, accept)
        assert "content-encoding" not in response.headers
        assert response.headers["vary"] == "Accept-Encoding"
        assert response.headers["cache-control"] == "no-store"
        assert json.loads(raw)["data"] == expected("week")
