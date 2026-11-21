import logging

from uvicorn.logging import AccessFormatter

from app.core.logging import SensitiveUrlFilter


def test_uvicorn_access_redacts_token_without_breaking_formatter():
    token = "secret-share-token"
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "GET", "/api/v1/shared/" + token, "1.1", 200),
        None,
    )
    SensitiveUrlFilter().filter(record)
    formatted = AccessFormatter("%(request_line)s %(status_code)s").format(record)
    assert token not in formatted
    assert "[redacted]" in formatted


def test_uvicorn_access_redacts_exploration_cells_query():
    path = "/api/v1/me/footprints/exploration/city/310000/cells"
    query = "year=2025&bbox=1%2C2%2C3%2C4"
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "GET", f"{path}?{query}", "1.1", 200),
        None,
    )
    SensitiveUrlFilter().filter(record)
    formatted = AccessFormatter("%(request_line)s %(status_code)s").format(record)
    assert query not in formatted
    assert f"GET {path}?[redacted] HTTP/1.1" in formatted
