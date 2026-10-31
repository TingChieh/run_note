import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import IntegrationSettings, Settings
from app.db.schema import get_expected_revision
from app.main import create_app

ORIGIN = "http://127.0.0.1:5183"
FIXTURES = Path(__file__).parent / "fixtures/gpx"


@pytest.fixture(scope="session", autouse=True)
def require_safe_integration_database(request: pytest.FixtureRequest) -> None:
    """Run before migration fixtures, including session-scoped ones."""
    uses_database = any(item.get_closest_marker("integration") for item in request.session.items)
    if not uses_database:
        return
    try:
        settings = IntegrationSettings()
    except ValidationError as error:
        reason = error.errors(include_input=False)[0]["msg"]
        raise pytest.UsageError(f"Unsafe integration database configuration: {reason}") from None
    if not settings.test_database_url:
        # Existing database tests explicitly skip; this is never a passing DB acceptance.
        return
    target = make_url(settings.test_database_url)
    development = make_url(settings.database_url)
    engine = create_engine(
        settings.test_database_url,
        hide_parameters=True,
        connect_args={
            "connect_timeout": 3,
            "options": "-c default_transaction_read_only=on -c statement_timeout=3000",
        },
    )
    try:
        with engine.connect() as connection:
            database, port = connection.execute(
                text("SELECT current_database(), inet_server_port()")
            ).one()
            if (
                database != target.database
                or database == development.database
                or port != (target.port or 5432)
            ):
                raise pytest.UsageError(
                    "Unsafe integration database configuration: target mismatch"
                )
    except SQLAlchemyError:
        raise pytest.UsageError("Integration database read-only identity check failed") from None
    finally:
        engine.dispose()


@pytest.fixture
def clients():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit isolated test database required")
    engine = create_engine(url, hide_parameters=True)
    with engine.connect() as c:
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalars().all() == [
            get_expected_revision()
        ]
    settings = Settings(
        database_url=url, site_origin=ORIGIN, auth_rate_hash_key=uuid4().hex, _env_file=None
    )
    a, b = create_app(settings.model_copy()), create_app(settings.model_copy())
    with TestClient(a, base_url=ORIGIN) as ca, TestClient(b, base_url=ORIGIN) as cb:
        yield ca, cb, engine, a
    engine.dispose()


def headers(client):
    r = client.get("/api/v1/auth/csrf")
    assert r.status_code == 200
    return {"Origin": ORIGIN, "X-CSRF-Token": r.json()["data"]["csrf_token"]}


def register(client):
    """Provision a synthetic owner offline; the public registration API is closed.

    Each client represents a separate site configuration for ownership regression tests.
    No production dependency or permission bypass is installed.
    """
    from app.core.security import hash_password
    from app.modules.users.model import User

    unique = uuid4().hex[:20]
    email = f"{unique}@example.com"
    password = "Synthetic-password-2026"
    client.app.state.settings.site_owner_email = email
    with client.app.state.session_factory() as db:
        user = User(
            email_normalized=email,
            username=f"u_{unique}",
            display_name="Synthetic runner",
            password_hash=hash_password(password),
            is_active=True,
            timezone="Asia/Shanghai",
        )
        db.add(user)
        db.commit()
        owner = str(user.id)
    response = client.post(
        "/api/v1/auth/login",
        headers=headers(client),
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    return owner


def upload(client, file="equator-six.gpx", fields=None, raw=None, extra_headers=None):
    return client.post(
        "/api/v1/gpx-imports",
        headers={**headers(client), **(extra_headers or {})},
        files={
            "file": (
                file,
                raw if raw is not None else (FIXTURES / file).read_bytes(),
                "application/gpx+xml",
            )
        },
        data={"timezone": "UTC", **(fields or {})},
    )
