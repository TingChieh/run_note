import importlib.util
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load():
    source = Path(__file__).parents[2] / "migrations/versions/0014_activity_province_caches.py"
    spec = importlib.util.spec_from_file_location("province_cache_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ddl_matches_the_model_and_downgrade_refuses_to_drop_data(monkeypatch):
    from app.models import Base

    module = load()
    assert module.down_revision == "0013_backfill_distance_category"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    table = Base.metadata.tables["activity_province_caches"]
    assert "CREATE TABLE activity_province_caches" in sql
    assert all(column.name in sql for column in table.columns)
    assert "FOREIGN KEY(activity_id, user_id)" in sql and "ON DELETE CASCADE" in sql
    assert "ix_activity_province_caches_user_id" in sql

    mutations = []
    connection = SimpleNamespace(execute=lambda _: SimpleNamespace(first=lambda: (1,)))
    monkeypatch.setattr(module.op, "get_bind", lambda: connection)
    monkeypatch.setattr(module.op, "drop_table", lambda name: mutations.append(name))
    with pytest.raises(RuntimeError):
        module.downgrade()
    assert mutations == []
