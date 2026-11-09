#!/usr/bin/env python3
"""用本機伺服器開啟：http://localhost:8000/index.html（只綁定本機 127.0.0.1，不對外）。"""
import http.server, os, socketserver, webbrowser, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache"); super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), H) as s:
    url = "http://localhost:%d/index.html" % PORT
    print("已啟動：", url, "\n（關閉這個視窗即可停止）")
    try: webbrowser.open(url)
    except Exception: pass
    s.serve_forever()
