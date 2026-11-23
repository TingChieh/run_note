"""Integration tests for GET /api/v1/activities/sync incremental sync contract."""

from datetime import timedelta

import pytest

from tests.conftest import FIXTURES, headers, register, upload

pytestmark = pytest.mark.integration

BASE_GPX = (FIXTURES / "equator-six.gpx").read_bytes()


def _gpx_shifted(day: int) -> bytes:
    return BASE_GPX.replace(b"2024-01-01", f"2024-01-{day:02d}".encode())


def test_sync_requires_authentication(clients):
    a, _, _, _ = clients
    response = a.get("/api/v1/activities/sync")
    assert response.status_code == 401


def test_sync_supports_version_short_circuit_pagination_dedup_and_deletions(clients):
    a, b, _, app = clients
    base_now = app.state.clock()
    current_time = [base_now + timedelta(seconds=10)]
    app.state.clock = lambda: current_time[0]

    register(a)
    register(b)

    first = upload(a, file="run1.gpx", raw=_gpx_shifted(1)).json()["data"]["activity"]["id"]
    current_time[0] += timedelta(minutes=1)
    second = upload(a, file="run2.gpx", raw=_gpx_shifted(2)).json()["data"]["activity"]["id"]
    current_time[0] += timedelta(minutes=1)
    third = upload(a, file="run3.gpx", raw=_gpx_shifted(3)).json()["data"]["activity"]["id"]
    # Another user's activity must never appear in A's sync stream.
    other = upload(b, file="other.gpx", raw=_gpx_shifted(4)).json()["data"]["activity"]["id"]

    page1 = a.get("/api/v1/activities/sync", params={"limit": 2})
    assert page1.status_code == 200, page1.text
    assert page1.headers["cache-control"] == "private, no-store"
    body1 = page1.json()["data"]
    assert body1["unchanged"] is False
    assert body1["total_count"] == 3
    assert body1["has_more"] is True
    assert body1["next_cursor"]
    assert len(body1["items"]) == 2
    assert page1.headers["etag"] == f'W/"v{body1["data_version"]}"'

    page2 = a.get("/api/v1/activities/sync", params={"limit": 2, "cursor": body1["next_cursor"]})
    assert page2.status_code == 200, page2.text
    body2 = page2.json()["data"]
    assert body2["has_more"] is False
    assert body2["next_cursor"] is None
    assert len(body2["items"]) == 1

    synced_ids = [item["id"] for item in body1["items"] + body2["items"]]
    assert len(synced_ids) == len(set(synced_ids)) == 3
    assert set(synced_ids) == {first, second, third}
    assert other not in synced_ids

    # Unchanged short-circuit when since_version matches current activity_data_version.
    unchanged = a.get("/api/v1/activities/sync", params={"since_version": body1["data_version"]})
    assert unchanged.status_code == 200
    unchanged_data = unchanged.json()["data"]
    assert unchanged_data["unchanged"] is True
    assert unchanged_data["items"] == []
    assert unchanged_data["active_ids"] is None

    # Edit bumps data_version & updated_at; delete is reflected in active_ids.
    last_version = body1["data_version"]
    last_server_time = body2["server_time"]
    current_time[0] += timedelta(minutes=5)
    patched = a.patch(
        f"/api/v1/activities/{second}",
        headers=headers(a),
        json={"title": "同步后更新标题"},
    )
    assert patched.status_code == 200, patched.text

    current_time[0] += timedelta(minutes=1)
    deleted = a.delete(f"/api/v1/activities/{first}", headers=headers(a))
    assert deleted.status_code == 200, deleted.text

    delta = a.get(
        "/api/v1/activities/sync",
        params={"since_version": last_version, "updated_since": last_server_time},
    )
    assert delta.status_code == 200, delta.text
    delta_data = delta.json()["data"]
    assert delta_data["unchanged"] is False
    assert delta_data["data_version"] > last_version
    assert delta_data["total_count"] == 2
    assert [item["id"] for item in delta_data["items"]] == [second]
    assert delta_data["items"][0]["title"] == "同步后更新标题"
    assert set(delta_data["active_ids"]) == {second, third}
    assert first not in delta_data["active_ids"]
    assert other not in delta_data["active_ids"]


def test_sync_rejects_bad_cursor_and_naive_updated_since(clients):
    a, _, _, _ = clients
    register(a)
    bad_cursor = a.get("/api/v1/activities/sync", params={"cursor": "bad!!!"})
    assert bad_cursor.status_code == 422
    bad_ts = a.get("/api/v1/activities/sync", params={"updated_since": "2026-11-23T12:00:00"})
    assert bad_ts.status_code == 422
