"""
Widget dev server — serves test.html at http://localhost:8080

Reads ../.env and ../.test_keys.env, injects API_BASE_URL and CLIENT_A_KEY
into the page so nothing is hardcoded in test.html.

Usage:
    cd widget && python3 serve.py
    open http://localhost:8080/test.html
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, HTTPServer


def load_env(path):
    """Parse a simple KEY=VALUE .env file."""
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return env


# Load env files from project root
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = load_env(os.path.join(ROOT, ".env"))
env.update(load_env(os.path.join(ROOT, ".test_keys.env")))
env.update(load_env(os.path.join(ROOT, ".env.local")))  # Local overrides

API_BASE = env.get("API_BASE_URL", "http://localhost:8000") + "/api/v1"
API_KEY = env.get("CLIENT_A_KEY", "")


class Handler(SimpleHTTPRequestHandler):
    """Serve files from widget/, injecting config into test.html."""

    def do_GET(self):
        if self.path in ("/test.html", "/"):
            self._serve_html("test.html")
        elif self.path == "/demo.html":
            self._serve_html("demo.html")
        elif self.path == "/headlesstest.html":
            self._serve_html("headlesstest.html")
        elif self.path == "/testwidget.html":
            self._serve_html("testwidget.html")
        elif self.path == "/testapi.html":
            self._serve_html("testapi.html")
        elif self.path == "/assistanttest.html":
            self._serve_html("assistanttest.html")
        else:
            super().do_GET()

    def _serve_html(self, filename):
        with open(os.path.join(os.path.dirname(__file__), filename), "rb") as f:
            html = f.read().decode()

        # Replace placeholder values injected by serve.py at runtime
        html = html.replace(
            'data-api-key="sk_live_SERVE_PY_INJECTS_THIS"',
            f'data-api-key="{API_KEY}"',
        )
        html = html.replace(
            'data-api-base="SERVE_PY_INJECTS_THIS"',
            f'data-api-base="{API_BASE}"',
        )
        html = html.replace(
            "'Bearer sk_live_SERVE_PY_INJECTS_THIS'",
            f"'Bearer {API_KEY}'",
        )
        html = html.replace(
            "SERVE_PY_INJECTS_BASE_THIS",
            API_BASE,
        )

        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # silence request logs


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("Widget dev server →")
    print(f"  Headless   : http://localhost:{port}/headlesstest.html")
    print(f"  Frosted    : http://localhost:{port}/testwidget.html")
    print(f"  API demo   : http://localhost:{port}/testapi.html")
    print(f"  Assistant  : http://localhost:{port}/assistanttest.html")
    print(f"  Widget     : http://localhost:{port}/test.html")
    print(f"  API base : {API_BASE}")
    print(
        f"  API key  : {API_KEY[:16]}..."
        if API_KEY
        else "  API key  : NOT FOUND in .test_keys.env"
    )
    HTTPServer(("", port), Handler).serve_forever()
