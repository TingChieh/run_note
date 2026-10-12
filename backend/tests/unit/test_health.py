from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def make_client():
    settings = Settings(
        database_url="postgresql+psycopg://test:test@127.0.0.1:1/test",
        app_env="test",
        _env_file=None,
    )
    return TestClient(create_app(settings))


def test_liveness_does_not_require_database():
    with make_client() as client:
        response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json()["data"] == {"status": "ok"}
    assert response.json()["error"] is None
    assert response.headers["x-request-id"] == response.json()["meta"]["request_id"]
    assert response.headers["cache-control"] == "no-store"


def test_health_reports_database_failure_without_connection_details():
    with make_client() as client:
        response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["data"] is None
    assert response.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"
    assert "postgresql" not in response.text
    assert "127.0.0.1" not in response.text


def test_unknown_api_route_uses_standard_error_envelope():
    with make_client() as client:
        response = client.get("/api/unknown")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"
    assert response.json()["data"] is None
