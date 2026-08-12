"""Minimal static server for previewing the Hexaequo frontend.

Serves the web folder with no-store headers AND strips conditional request
headers, so the dev browser always gets fresh files on reload (the default
http.server answers If-Modified-Since with 304, which hides edits to cached
modules during iteration).

The site is plain ES modules with no build step, so this is the whole dev setup.
"""
import http.server
import os
import socketserver

PORT = 8001
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def _strip_conditional(self):
        # Drop conditional headers so send_head() never returns 304.
        for header in ("If-Modified-Since", "If-None-Match"):
            while header in self.headers:
                del self.headers[header]

    def do_GET(self):
        self._strip_conditional()
        super().do_GET()

    def do_HEAD(self):
        self._strip_conditional()
        super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with ThreadingServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving {DIRECTORY} on http://localhost:{PORT} (no-store, no-304)")
        httpd.serve_forever()
