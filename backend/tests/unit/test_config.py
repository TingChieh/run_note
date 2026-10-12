import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize("url", ["sqlite:///local.db", "postgresql://host/db", "not-a-url"])
def test_rejects_unsupported_database_configuration(url):
    with pytest.raises(ValidationError):
        Settings(database_url=url, _env_file=None)


def test_configuration_errors_do_not_reveal_credentials():
    with pytest.raises(ValidationError) as error:
        Settings(database_url="mysql://user:private-value@host/db", _env_file=None)
    assert "private-value" not in str(error.value)
