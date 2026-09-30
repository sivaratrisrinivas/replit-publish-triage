import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "error_discovery_data")
FILES = ["samples.json", "annotations.json", "graph.json", "patterns.json", "suggestions.json"]


def data_path(name):
    return os.path.join(DATA_DIR, name)


def read_json(name, default):
    p = data_path(name)
    if not os.path.exists(p):
        return default
    with open(p) as f:
        return json.load(f)


def write_json(name, obj):
    with open(data_path(name), "w") as f:
        json.dump(obj, f)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        raw = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            here = os.path.dirname(os.path.abspath(__file__))
            with open(os.path.join(here, "review.html"), "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
            return
        mapping = {
            "/api/samples": "samples.json",
            "/api/annotations": "annotations.json",
            "/api/graph": "graph.json",
            "/api/patterns": "patterns.json",
            "/api/suggestions": "suggestions.json",
        }
        if parsed.path in mapping:
            self._send(200, json.dumps(read_json(mapping[parsed.path], [] if mapping[parsed.path] != "patterns.json" else {})))
            return
        self._send(404, "not found", "text/plain")

    def do_POST(self):
        parsed = urlparse(self.path)
        mapping = {
            "/api/samples": "samples.json",
            "/api/annotations": "annotations.json",
            "/api/graph": "graph.json",
            "/api/patterns": "patterns.json",
            "/api/suggestions": "suggestions.json",
        }
        if parsed.path in mapping:
            length = int(self.headers.get("Content-Length", 0))
            write_json(mapping[parsed.path], json.loads(self.rfile.read(length) or b"null"))
            self._send(200, '{"ok": true}')
            return
        self._send(404, "not found", "text/plain")


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    for f in FILES:
        if not os.path.exists(data_path(f)):
            write_json(f, {} if f == "patterns.json" else [])
    port = int(os.environ.get("PORT", "4123"))
    print(f"error-discovery review app at http://localhost:{port}")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
