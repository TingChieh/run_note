import importlib.util
from io import StringIO
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models import Base


def test_sharing_check_names_match_metadata():
    source = Path(__file__).parents[2] / "migrations/versions/0004_public_sharing.py"
    spec = importlib.util.spec_from_file_location("sharing_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert "CONSTRAINT ck_users_bio_length CHECK" in sql
    assert "CONSTRAINT ck_activity_share_links_expiry_order CHECK" in sql
    assert "ck_users_ck_" not in sql
