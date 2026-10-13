import logging

from uvicorn.logging import AccessFormatter

from app.core.logging import ShareTokenFilter


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
    ShareTokenFilter().filter(record)
    formatted = AccessFormatter("%(request_line)s %(status_code)s").format(record)
    assert token not in formatted
    assert "[redacted]" in formatted
