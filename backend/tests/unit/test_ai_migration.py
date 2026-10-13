import importlib.util
from io import StringIO
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models import Base


def test_ai_migration_is_additive_and_constraint_names_match():
    source = Path(__file__).parents[2] / "migrations/versions/0005_ai_reports.py"
    spec = importlib.util.spec_from_file_location("ai_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0004_public_sharing"
    output = StringIO()
    ctx = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(ctx):
        module.upgrade()
    sql = output.getvalue()
    assert "CREATE TABLE ai_reports" in sql
    assert (
        "DROP" not in sql and "ALTER TABLE users" not in sql and "ALTER TABLE activities" not in sql
    )
    assert "uq_ai_reports_user_request" in sql and "WHERE status='pending'" in sql
    assert "ck_ai_reports_ck_" not in sql
    for constraint in Base.metadata.tables["ai_reports"].constraints:
        if constraint.name and constraint.name.startswith("ck_"):
            assert constraint.name in sql
