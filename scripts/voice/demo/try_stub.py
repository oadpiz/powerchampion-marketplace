#!/usr/bin/env python3
"""Stand-in for the web phone the "試打一通" button opens (PC_VOICE_TRY_URL), for the local demo only.

There is no voice host on a laptop, so without this the button would open a dead page. It serves one static page,
bound to 127.0.0.1, that says so. It reads nothing from the request (the ticket in the URL is ignored) and keeps
nothing.

    python try_stub.py PORT
"""
import http.server
import sys

PAGE = """<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>示範：試打一通</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #121212; color: #e9e6df;
         font: 17px/1.7 -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  p { margin: 0 0 .9rem; color: #c9c5bb; }
  .tag { display: inline-block; padding: .1rem .6rem; border: 1px solid #8a7a52; border-radius: 99px; color: #d8c58a; font-size: .85rem; margin-bottom: 1rem; }
</style></head>
<body><main>
  <span class="tag">本機示範版</span>
  <h1>這裡正式環境是「網頁電話」</h1>
  <p>允許麥克風後，直接對著電腦說話，接聽的是這家店的 AI 語音助理，用的是剛套用的那一版設定，聽到的是電話音質。</p>
  <p>本機示範沒有語音主機，所以這一頁不會接通。通話紀錄裡標成「試打」的幾筆，是示範資料。</p>
  <p>關掉這個分頁，或按瀏覽器的「上一頁」，回到後台繼續。</p>
</main></body></html>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    do_HEAD = do_GET

    def log_message(self, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) == 2 else 3922
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
