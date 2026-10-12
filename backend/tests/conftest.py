import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import IntegrationSettings


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
