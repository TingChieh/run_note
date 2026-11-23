"""Unit checks for 0034_drop_ai_reports DDL and irreversible downgrade guard."""

import importlib.util
from io import StringIO
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models import Base


def test_drop_ai_reports_migration_drops_only_legacy_table_and_guards_downgrade():
    source = Path(__file__).parents[2] / "migrations/versions/0034_drop_ai_reports.py"
    spec = importlib.util.spec_from_file_location("drop_ai_reports_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "0034_drop_ai_reports"
    assert module.down_revision == "0033_ai_assistant"

    output = StringIO()
    ctx = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(ctx):
        module.upgrade()
    sql = output.getvalue()

    assert "DROP INDEX IF EXISTS uq_ai_reports_user_pending" in sql
    assert "DROP INDEX IF EXISTS ix_ai_reports_user_created" in sql
    assert "DROP TABLE ai_reports" in sql
    assert "ai_conversations" not in sql
    assert "ai_messages" not in sql
    assert "ai_user_consents" not in sql
    assert "ai_reports" not in Base.metadata.tables

    with pytest.raises(RuntimeError, match="0034_drop_ai_reports"):
        module.downgrade()
