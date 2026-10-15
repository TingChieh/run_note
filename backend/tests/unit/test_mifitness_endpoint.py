from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_mifitness_route_is_registered_and_large_body_is_rejected_before_database():
    app = create_app(
        Settings(
            database_url="postgresql+psycopg://synthetic@127.0.0.1:1/unused_test",
            _env_file=None,
        )
    )
    assert "/api/v1/mifitness-imports" in app.openapi()["paths"]
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/mifitness-imports",
            content=b"x",
            headers={"Content-Length": str(11 * 1024 * 1024 + 1)},
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "MIFITNESS_TOO_LARGE"
