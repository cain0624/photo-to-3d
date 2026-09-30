import http.server, socketserver

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
    def __init__(self, *a, **k):
        super().__init__(*a, directory='/Users/cain/Desktop/照片/photo-to-3d', **k)

with socketserver.TCPServer(('127.0.0.1', 8765), H) as s:
    print('serving on 8765'); s.serve_forever()
