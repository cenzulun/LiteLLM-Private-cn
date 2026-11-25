"""Synthetic HTTP contract fixture. Never use as model, performance, or readiness evidence."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/v1/models":
            value = {"object": "list", "data": [{"id": "synthetic-motor-contract", "object": "model"}]}
        elif self.path == "/health":
            value = {"status": "synthetic"}
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())

    def log_message(self, *unused):
        pass


if __name__ == "__main__":
    servers = [ThreadingHTTPServer(("0.0.0.0", port), Handler) for port in (10300, 10301)]
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Event().wait()
