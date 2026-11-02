#!/usr/bin/env python3
"""Preview the site the way GitHub Pages serves it: python3 serve.py [port]

Like Pages, a path with no file behind it gets 404.html, which is how the explorer's
addresses (/explorer/{block}, /explorer/{block}/{trx_id}) reach the explorer page.
Standard library only."""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Pages(http.server.SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        page = ROOT / "404.html"
        if code != 404 or not page.exists():
            return super().send_error(code, message, explain)
        body = page.read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Pages, directory=str(ROOT))
    print(f"serving {ROOT} on http://127.0.0.1:{port}/  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
