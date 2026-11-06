"""Local preview server for PERFORMANCE LAB.

Serves this folder and turns on preview mode: no sign-in, data saved in the
browser only, coaches switched off. Run: python3 dev-server.py [port]
"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/config.js":
            body = (open("config.js", encoding="utf-8").read()
                    + "\nwindow.PERFLAB_CONFIG.demo = true;\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

print(f"Preview on http://localhost:{PORT}")
http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
