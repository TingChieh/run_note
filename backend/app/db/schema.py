from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


def get_expected_revision(migrations: Path = MIGRATIONS) -> str:
    """Resolve this release's unique head once at application startup, without DB access."""
    config = Config()
    config.set_main_option("script_location", str(migrations))
    heads = ScriptDirectory.from_config(config).get_heads()
    if len(heads) != 1:
        raise RuntimeError("Release requires a unique Alembic head")
    return heads[0]


def include_name(name, type_, parent_names) -> bool:
    """Autogenerate owns only this release's tables in the default schema."""
    if type_ == "schema":
        return name is None
    if type_ == "table":
        from app.models import Base

        return name in Base.metadata.tables
    return True
