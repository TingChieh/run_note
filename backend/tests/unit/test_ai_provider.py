import json
import multiprocessing
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.core.config import Settings
from app.core.errors import ApiError
from app.modules.ai_reports.provider import OpenAIProvider, bounded_request, request_body

SNAPSHOT = {
    "schema_version": "running-summary-v1",
    "date_from": "2024-01-01",
    "date_to": "2024-01-29",
    "week_start": "monday",
    "date_assignment": "activity_local_date",
    "summary": {"activity_count": 4, "distance_m": "7000", "email": "hidden@example.com"},
    "weeks": [{"bucket_start": "2024-01-01", "distance_m": "1000", "coordinates": [1, 2]}],
    "average_runs_per_week": "1.000",
    "evidence_limited": False,
    "limitations": [],
    "raw_gpx": "secret",
}
TEXT = {
    "trend_summary": "跑量呈上升趋势",
    "recommendations": ["注意恢复"],
    "limitations": "建议仅供参考，不构成医疗建议",
}


def stalled_target(url, key, body, timeout, pipe):
    time.sleep(10)


def test_payload_reconstructs_nested_whitelist():
    content = request_body(SNAPSHOT, "test")["messages"][1]["content"]
    assert all(
        secret not in content
        for secret in ["hidden@example.com", "coordinates", "raw_gpx", "secret"]
    )
    assert json.loads(content)["summary"]["distance_m"] == "7000"


def test_total_deadline_terminates_child():
    before = {p.pid for p in multiprocessing.active_children()}
    start = time.monotonic()
    with pytest.raises(ApiError) as exc:
        bounded_request("http://127.0.0.1", "fake", {}, 0.2, target=stalled_target)
    assert exc.value.code == "AI_TIMEOUT"
    assert time.monotonic() - start < 2
    assert {p.pid for p in multiprocessing.active_children()} == before


@pytest.mark.parametrize(
    "mode,code",
    [
        ("ok", None),
        ("delayed", None),
        ("429", "AI_PROVIDER_ERROR"),
        ("500", "AI_PROVIDER_ERROR"),
        ("redirect", "AI_PROVIDER_ERROR"),
        ("invalid", "AI_OUTPUT_INVALID"),
        ("empty", "AI_OUTPUT_INVALID"),
        ("numbers", "AI_OUTPUT_INVALID"),
        ("oversized", "AI_OUTPUT_INVALID"),
        ("slow", "AI_TIMEOUT"),
    ],
)
def test_real_adapter_against_local_mock_http(mode, code, caplog):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((self.path, self.headers["Authorization"], data))
            if mode in {"slow", "delayed"}:
                time.sleep(6 if mode == "delayed" else 2)
            status = int(mode) if mode in {"429", "500"} else 302 if mode == "redirect" else 200
            self.send_response(status)
            if mode == "redirect":
                self.send_header("Location", "/should-not-follow")
            self.end_headers()
            analysis = {**TEXT, "trend_summary": "跑了999公里"} if mode == "numbers" else TEXT
            body = json.dumps(
                {
                    "choices": [{"message": {"content": json.dumps(analysis, ensure_ascii=False)}}],
                    "usage": {"prompt_tokens": 20, "completion_tokens": 30},
                }
            ).encode()
            if mode == "invalid":
                body = b"not json"
            if mode == "empty":
                body = b'{"choices": []}'
            if mode == "oversized":
                body = b"x" * 65537
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    s = Settings(
        database_url="postgresql+psycopg://fake@127.0.0.1:1/test",
        ai_base_url=f"http://127.0.0.1:{server.server_port}/v1",
        ai_api_key="local-test-secret",
        ai_model="test",
        ai_total_timeout_seconds=1 if mode == "slow" else 10 if mode == "delayed" else 5,
        _env_file=None,
    )
    try:
        if code:
            with pytest.raises(ApiError) as exc:
                OpenAIProvider().generate(SNAPSHOT, s)
            assert exc.value.code == code
        else:
            r = OpenAIProvider().generate(SNAPSHOT, s)
            assert r.analysis.trend_summary == TEXT["trend_summary"]
            assert r.input_tokens == 20 and r.output_tokens == 30
        assert len(calls) == 1
        assert calls[0][0] == "/v1/chat/completions"
        assert calls[0][1] == "Bearer local-test-secret"
        assert calls[0][2]["max_tokens"] == 2000
        assert "local-test-secret" not in caplog.text and "7000" not in caplog.text
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
