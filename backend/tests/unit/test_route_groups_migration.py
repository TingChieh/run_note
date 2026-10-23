import importlib.util
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load():
    source = Path(__file__).parents[2] / "migrations/versions/0015_route_groups.py"
    spec = importlib.util.spec_from_file_location("route_groups_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ddl_matches_the_models_and_downgrade_refuses_to_drop_data(monkeypatch):
    from app.models import Base

    module = load()
    assert module.down_revision == "0014_activity_province_caches"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    for name in ("route_fingerprints", "route_groups", "route_group_members"):
        assert f"CREATE TABLE {name}" in sql
        assert all(column.name in sql for column in Base.metadata.tables[name].columns)
    assert sql.count("FOREIGN KEY(activity_id, user_id)") == 2
    assert "ix_route_fingerprints_geom" in sql and "gist" in sql
    assert "ix_route_group_members_group_id" in sql

    dropped = []
    connection = SimpleNamespace(execute=lambda _: SimpleNamespace(first=lambda: (1,)))
    monkeypatch.setattr(module.op, "get_bind", lambda: connection)
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError):
        module.downgrade()
    assert dropped == []
