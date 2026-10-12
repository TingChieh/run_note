import os
import subprocess
from pathlib import Path

import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import Settings
from app.main import create_app

pytestmark = pytest.mark.integration
BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def database_url():
    url = os.environ.get("TEST_DATABASE_URL") or dotenv_values(BACKEND.parent / ".env").get(
        "TEST_DATABASE_URL"
    )
    if not url:
        pytest.skip("TEST_DATABASE_URL must point to a separate PostgreSQL/PostGIS database")
    from sqlalchemy.engine import make_url

    if not (make_url(url).database or "").endswith("_test"):
        pytest.fail("Integration database name must end with _test")
    environment = {**os.environ, "DATABASE_URL": url, "APP_ENV": "test"}
    subprocess.run(
        [str(BACKEND / ".venv/bin/alembic"), "upgrade", "head"],
        cwd=BACKEND,
        env=environment,
        check=True,
    )
    return url


def test_migration_enables_postgis_and_spatial_functions(database_url):
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version")) == "0001_postgis"
            )
            distance = connection.scalar(
                text(
                    "SELECT ST_Distance(ST_SetSRID(ST_MakePoint(0,0),4326)::geography, "
                    "ST_SetSRID(ST_MakePoint(0.01,0),4326)::geography)"
                )
            )
            assert distance == pytest.approx(1113.194908, abs=0.001)
    finally:
        engine.dispose()


@pytest.mark.parametrize("path", ["/api/health", "/api/v1/health/ready"])
def test_ready_api_uses_real_postgres_postgis_and_migration(database_url, path):
    settings = Settings(database_url=database_url, app_env="test", _env_file=None)
    with TestClient(create_app(settings)) as client:
        response = client.get(path)
    assert response.status_code == 200
    assert response.json()["data"] == {
        "status": "ok",
        "database": "connected",
        "postgis": "enabled",
        "schema": "current",
    }
