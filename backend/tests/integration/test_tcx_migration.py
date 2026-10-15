"""New TCX constraints and a downgrade that refuses loss of imported source data."""

import pytest
from sqlalchemy import text

from tests.integration.test_gpx_import import clients, register  # noqa: F401
from tests.integration.test_migrations import migrate
from tests.integration.test_tcx_import import upload_tcx

pytestmark = pytest.mark.integration


def test_downgrade_refuses_to_discard_imported_tcx(clients):  # noqa: F811
    a, _, engine, _ = clients
    register(a)
    response = upload_tcx(a)
    assert response.status_code == 201, response.text
    identifier = response.json()["data"]["activity"]["id"]
    import subprocess

    with pytest.raises(subprocess.CalledProcessError) as error:
        migrate(engine.url.render_as_string(hide_password=False), "downgrade", "0006_running_goals")
    assert "Cannot downgrade while TCX activities exist" in error.value.stderr
    with engine.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0008_activity_labels"
        assert (
            db.scalar(
                text("SELECT count(*) FROM tcx_imports WHERE activity_id=:id"), {"id": identifier}
            )
            == 1
        )
