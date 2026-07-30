import http.server, os, sys

# pythonw no tiene stderr — evitar crash en log_message
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')

os.chdir(os.path.dirname(os.path.abspath(__file__)))

httpd = http.server.HTTPServer(('127.0.0.1', 5001), http.server.SimpleHTTPRequestHandler)
httpd.serve_forever()
