"""Offline tests for ops/acceptance-check.py: its request shaping, its refusals and its safety
properties. No Run Note server is involved; a tiny local HTTP server stands in for the Node server.

    backend/.venv/bin/python -m unittest discover -s infra/native/tests -v
"""

import importlib.util
import threading
import unittest
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = REPO / "infra" / "native" / "ops" / "acceptance-check.py"

spec = importlib.util.spec_from_file_location("acceptance_check", TOOL)
acc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acc)


class Args:
    def __init__(self, **kw):
        self.base = kw.get("base")
        self.loopback_port = kw.get("loopback_port")
        self.domain = kw.get("domain")


class Stub(BaseHTTPRequestHandler):
    seen: list[dict] = []

    def do_GET(self):
        Stub.seen.append(
            {"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}}
        )
        self.send_response(200)
        # a Secure, __Host- cookie, exactly like a production site sets it
        self.send_header(
            "Set-Cookie", "__Host-run_session=abc; Path=/; Secure; HttpOnly; SameSite=lax"
        )
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


class Serve:
    def __enter__(self):
        Stub.seen = []
        self.server = HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self.server.server_address[1]

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


class Probe(unittest.TestCase):
    def test_the_synthetic_gpx_is_well_formed_and_entirely_on_the_probe_date(self):
        root = ET.fromstring(acc.synthetic_gpx())
        ns = {"g": "http://www.topografix.com/GPX/1/1"}
        points = root.findall(".//g:trkpt", ns)
        self.assertEqual(len(points), 60)
        times = [p.find("g:time", ns).text for p in points]
        self.assertTrue(
            all(t.startswith(acc.PROBE_DATE) for t in times),
            "every point must lie on the probe date",
        )
        self.assertEqual(acc.PROBE_DATE[:4], acc.PROBE_YEAR)
        self.assertIn("date_from=2000-01-01", acc.PROBE_RANGE)
        self.assertIn("date_to=2001-01-01", acc.PROBE_RANGE)  # the end of the range is exclusive

    def test_multipart_carries_the_fields_and_the_file(self):
        body, ctype = acc.multipart(
            {"title": "t", "activity_date": acc.PROBE_DATE}, "x.gpx", b"<gpx/>"
        )
        boundary = ctype.split("boundary=")[1].encode()
        self.assertIn(b'name="title"\r\n\r\nt', body)
        self.assertIn(b'name="file"; filename="x.gpx"', body)
        self.assertTrue(body.endswith(b"--" + boundary + b"--\r\n"))

    def test_read_kv_ignores_comments_and_strips_quotes(self):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as handle:
            handle.write("# c\nSITE_OWNER_EMAIL='me@example.test'\nOTHER=1\n")
        try:
            values = acc.read_kv(handle.name)
        finally:
            Path(handle.name).unlink()
        self.assertEqual(values, {"SITE_OWNER_EMAIL": "me@example.test", "OTHER": "1"})
        self.assertEqual(acc.read_kv("/nonexistent/file"), {})


class Usage(unittest.TestCase):
    def refused(self, *argv):
        with self.assertRaises(SystemExit) as ctx:
            acc.main(list(argv))
        self.assertEqual(ctx.exception.code, 2, argv)

    def test_exactly_one_target_is_required(self):
        self.refused()
        self.refused(
            "--base",
            "https://x.example.com",
            "--loopback-port",
            "3100",
            "--domain",
            "x.example.com",
        )

    def test_loopback_mode_needs_the_domain(self):
        self.refused("--loopback-port", "3100")

    def test_a_plain_http_public_origin_is_refused_but_a_loopback_test_origin_is_not_a_public_site(
        self,
    ):
        self.refused("--base", "http://x.example.com")


class LoopbackClient(unittest.TestCase):
    def test_loopback_mode_sends_what_the_proxy_would_and_returns_the_secure_cookie(self):
        with Serve() as port:
            site = acc.Site(
                Args(loopback_port=str(port), domain="run.example.com"), basic=("u", "p")
            )
            site.call("GET", "/api/v1/auth/csrf")
            site.call("GET", "/api/v1/auth/session")
        first, second = Stub.seen
        self.assertEqual(first["headers"]["host"], "run.example.com")
        self.assertEqual(first["headers"]["x-forwarded-proto"], "https")
        self.assertNotIn(
            "authorization", first["headers"], "basic auth belongs to the proxy, never to loopback"
        )
        self.assertIn("__host-run_session=abc", second["headers"].get("cookie", "").lower())
        self.assertEqual(site.origin, "https://run.example.com")

    def test_public_mode_does_not_forge_proxy_headers_and_sends_basic_auth_when_given(self):
        site = acc.Site(Args(base="https://run.example.com"), basic=("u", "p"))
        self.assertEqual(site.connect, "https://run.example.com")
        self.assertFalse(site.loop)
        self.assertIsNotNone(site.basic)

    def test_write_requests_carry_the_site_origin_and_the_csrf_token(self):
        captured = []

        class Echo(BaseHTTPRequestHandler):
            def do_POST(self):
                captured.append({k.lower(): v for k, v in self.headers.items()})
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Echo)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            site = acc.Site(
                Args(loopback_port=str(server.server_address[1]), domain="run.example.com"),
                basic=None,
            )
            site.csrf = "token-123"
            site.call("POST", "/api/v1/auth/logout")
            site.call("POST", "/api/v1/auth/logout", csrf=False, origin=False)
        finally:
            server.shutdown()
            server.server_close()
        with_csrf, without = captured
        self.assertEqual(with_csrf["x-csrf-token"], "token-123")
        self.assertEqual(with_csrf["origin"], "https://run.example.com")
        self.assertNotIn("x-csrf-token", without)
        self.assertNotIn("origin", without)


if __name__ == "__main__":
    unittest.main()
