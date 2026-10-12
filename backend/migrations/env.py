from logging.config import fileConfig

from alembic import context
from sqlalchemy import text

from app.core.config import Settings
from app.db.base import Base
from app.db.session import create_session_factory

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
settings = Settings()
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine, _ = create_session_factory(settings)
    try:
        with engine.connect() as connection:
            # Extension installation may exceed the API's short query deadline.
            connection.execute(text("SET statement_timeout = 0"))
            connection.commit()
            context.configure(connection=connection, target_metadata=target_metadata)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
