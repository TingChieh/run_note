import importlib.util
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load():
    source = Path(__file__).parents[2] / "migrations/versions/0016_place_titles.py"
    spec = importlib.util.spec_from_file_location("place_titles_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ddl_matches_the_models_and_downgrade_refuses_to_drop_data(monkeypatch):
    from app.models import Base

    module = load()
    assert module.down_revision == "0015_route_groups"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    for name in ("place_features", "activity_place_names"):
        assert f"CREATE TABLE {name}" in sql
        assert all(column.name in sql for column in Base.metadata.tables[name].columns)
    assert "geography(GEOMETRY,4326)" in sql.replace(" ", "")
    assert "ix_place_features_geom" in sql and "gist" in sql
    assert "FOREIGN KEY(activity_id, user_id)" in sql and "ON DELETE CASCADE" in sql
    assert "'pending'" in sql and "'done'" in sql and "'skipped'" in sql
    assert "'lake'" in sql and "'stadium'" in sql

    dropped = []
    connection = SimpleNamespace(execute=lambda _: SimpleNamespace(first=lambda: (1,)))
    monkeypatch.setattr(module.op, "get_bind", lambda: connection)
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError):
        module.downgrade()
    assert dropped == []
