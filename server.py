"""
本地服务器 - 同时提供静态文件和 API 代理
运行: python server.py
打开: http://localhost:8080
"""

import http.server
import json
import os
import sys
import urllib.request
import urllib.error

PORT = 8080
API_BASE = "https://api.anthropic.com"
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        """Proxy POST requests to Anthropic API"""
        if self.path.startswith("/api/v1/") or self.path.startswith("/api/"):
            self.proxy_to_anthropic()
        else:
            self.send_error(404)

    def proxy_to_anthropic(self):
        """Forward the request to api.anthropic.com"""
        # Determine target path
        if self.path.startswith("/api/v1/"):
            target_path = self.path.replace("/api/v1/", "/v1/", 1)
        elif self.path.startswith("/api/"):
            target_path = self.path.replace("/api/", "/", 1)
        else:
            target_path = self.path

        target_url = API_BASE + target_path

        # Read request body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        # Build forwarded headers
        headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json"),
            "x-api-key": self.headers.get("x-api-key", ""),
            "anthropic-version": self.headers.get("anthropic-version", "2023-06-01"),
        }

        try:
            req = urllib.request.Request(
                target_url,
                data=body,
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            error_body = e.read() if e.fp else b"{}"
            self.send_response(e.code)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(error_body)
        except Exception as e:
            self.send_response(500)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, x-api-key, anthropic-version")

    def log_message(self, format, *args):
        # Quieter logging - only show errors and API calls
        msg = format % args
        if "/api/" in msg or "404" in msg or "500" in msg:
            print(f"  {msg}")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    with http.server.HTTPServer(("127.0.0.1", port), ProxyHandler) as server:
        print(f"\n✈️  旅行翻译测验服务器已启动")
        print(f"📌 打开浏览器访问: http://localhost:{port}")
        print(f"📌 按 Ctrl+C 停止服务器\n")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")