"""Unit checks for 0033_ai_assistant DDL parity and defensive downgrade."""

import importlib.util
from io import StringIO
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models import Base


def test_ai_assistant_migration_is_additive_and_matches_orm_constraints():
    source = Path(__file__).parents[2] / "migrations/versions/0033_ai_assistant.py"
    spec = importlib.util.spec_from_file_location("ai_assistant_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "0033_ai_assistant"
    assert module.down_revision == "0032_running_diary"

    output = StringIO()
    ctx = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(ctx):
        module.upgrade()
    sql = output.getvalue()

    for table_name in ("ai_conversations", "ai_messages", "ai_user_consents"):
        assert f"CREATE TABLE {table_name}" in sql
        for constraint in Base.metadata.tables[table_name].constraints:
            if constraint.name and constraint.name.startswith(("ck_", "uq_", "fk_ai_messages_")):
                assert constraint.name in sql, f"Missing constraint {constraint.name}"
        for index in Base.metadata.tables[table_name].indexes:
            assert index.name in sql, f"Missing index {index.name}"

    assert "DROP" not in sql
    assert "ALTER TABLE users" not in sql
    assert "ALTER TABLE activities" not in sql
    assert "ALTER TABLE ai_reports" not in sql
    assert "ck_ai_messages_ck_" not in sql
    assert "ck_ai_conversations_ck_" not in sql
    assert "WHERE role = 'assistant' AND status IN ('pending','streaming')" in sql
    assert "WHERE request_key IS NOT NULL" in sql
