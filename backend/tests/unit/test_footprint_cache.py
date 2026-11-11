from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_read_identity, get_session
from app.core.config import Settings
from app.main import create_app
from app.modules.footprints import cache
from app.modules.footprints.encoding import encode_collection
from app.modules.footprints.snapshot import ALGORITHM_VERSION
from app.modules.showcase import router as showcase_router
from app.modules.showcase.service import footprint_view

NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)
OWNER = UUID(int=7)
SHOWCASE = "/api/v1/showcase/footprints/all"


def collection():
    return {
        "type": "FeatureCollection",
        "mode": "tracks",
        "scope": "all",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[1.5, 2.25], [1.5, 2.0]]},
                # "note" stands for a stored property the public whitelist must drop.
                "properties": {"title": "合成", "activity_id": "a", "note": "x"},
            }
        ],
        "activity_count": 1,
        "visible_activity_count": 1,
        "unsupported_segment_count": 0,
        "grid_size_m": 100,
        "grid_crs": "EPSG:3857",
        "count_basis": "distinct_activity_per_cell",
        "max_count": 0,
    }


@pytest.fixture
def store(monkeypatch):
    """A fake snapshot store: `versions` is the cheap read, `reads` counts payload reads."""
    cache._entries.clear()
    state = SimpleNamespace(version=3, generated_at=NOW, state="idle", payload_generated_at=None)
    state.reads = []

    def versions(db, owner):
        snapshot = SimpleNamespace(
            source_version=3,
            algorithm_version=ALGORITHM_VERSION,
            generated_at=state.generated_at,
            state=state.state,
            target_version=3,
        )
        return state.version, snapshot

    def read_all(db, owner, mode):
        state.reads.append((owner, mode))
        current = state.version == 3
        return {
            "status": "ready" if current else "pending",
            "generated_at": state.payload_generated_at or state.generated_at,
            "refreshing": state.state == "building",
            "refresh_failed": False,
            "result": collection() if current else None,
        }

    monkeypatch.setattr(cache, "_versions", versions)
    monkeypatch.setattr(cache, "read_all_footprints", read_all)
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
    app.dependency_overrides[get_session] = lambda: Mock()
    app.dependency_overrides[showcase_router.get_site_owner] = lambda: SimpleNamespace(id=OWNER)
    app.dependency_overrides[get_read_identity] = lambda: (None, SimpleNamespace(id=OWNER))
    return TestClient(app)


def expected(view, encoded):
    result = view(collection()) if view else collection()
    result = encode_collection(result) if encoded else result
    return {
        "status": "ready",
        "generated_at": "2026-10-15T12:00:00Z",
        "refreshing": False,
        "refresh_failed": False,
        "result": result,
    }


@pytest.mark.parametrize("encoded", [False, True])
def test_repeat_reads_serve_the_same_body_without_loading_the_payload(store, client, encoded):
    url = SHOWCASE + ("?encoding=delta" if encoded else "")
    first, second = client.get(url), client.get(url)
    assert first.status_code == second.status_code == 200
    assert first.json()["data"] == second.json()["data"] == expected(footprint_view, encoded)
    assert "note" not in first.text
    assert first.json()["meta"]["request_id"] != second.json()["meta"]["request_id"]
    assert first.json()["error"] is None
    assert len(store.reads) == 1


def test_a_rebuilt_snapshot_is_read_again_and_state_flags_stay_live(store, client):
    client.get(SHOWCASE)
    store.state = "building"
    assert client.get(SHOWCASE).json()["data"]["refreshing"] is True
    assert len(store.reads) == 1
    store.generated_at = NOW + timedelta(hours=1)
    client.get(SHOWCASE)
    assert len(store.reads) == 2


def test_public_and_own_views_and_encodings_are_cached_apart(store, client):
    own = client.get("/api/v1/footprints/all?encoding=delta").json()["data"]
    public = client.get(SHOWCASE + "?encoding=delta").json()["data"]
    plain = client.get(SHOWCASE).json()["data"]
    assert own == expected(None, True)
    assert "note" in own["result"]["features"][0]["properties"]
    assert public == expected(footprint_view, True)
    assert plain == expected(footprint_view, False)
    assert len(store.reads) == 3


def test_stale_snapshots_are_never_cached(store, client):
    store.version = 4
    for _ in range(2):
        data = client.get(SHOWCASE).json()["data"]
        assert data["status"] == "pending" and data["result"] is None
    assert len(store.reads) == 2
    assert not cache._entries


def test_a_payload_rebuilt_between_the_two_reads_is_not_stored(store, client):
    store.payload_generated_at = NOW + timedelta(seconds=1)
    client.get(SHOWCASE)
    client.get(SHOWCASE)
    assert len(store.reads) == 2


def test_entries_are_bounded():
    cache._entries.clear()
    for owner in range(cache.MAX_ENTRIES + 3):
        cache._put((True, owner, "tracks", None), (1, ALGORITHM_VERSION, NOW), "{}")
    assert len(cache._entries) == cache.MAX_ENTRIES
    assert cache._get((True, 0, "tracks", None), (1, ALGORITHM_VERSION, NOW)) is None
    cache._entries.clear()
