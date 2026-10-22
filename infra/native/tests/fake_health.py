"""Tiny stand-in for the API and Node ports so deploy/rollback smoke tests can run without
systemd. Serves 200 on the two health URLs the scripts probe. Test helper only."""

import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path in {"/api/v1/health/ready", "/api/health"}
        self.send_response(200 if ok else 404)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
