"""
verex_server.py — Servidor de impresión VEREX (puerto 7891)
Sin Electron, sin GUI — solo Python puro.
Inicio automático via iniciar_servidor.vbs en carpeta Startup de Windows.

Dependencias: pip install pymupdf pillow brother_ql
"""
import sys, json, socket, os, tempfile, subprocess, struct, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import base64

BASE_DIR  = Path(__file__).parent
CFG_FILE  = Path.home() / '.verex-print-config.json'

# ── Config ────────────────────────────────────────────────────────────────────
def load_cfg():
    try:
        return json.loads(CFG_FILE.read_text())
    except:
        return {}

def save_cfg(data):
    cfg = load_cfg()
    cfg.update(data)
    CFG_FILE.write_text(json.dumps(cfg))

# ── Auto-descubrimiento de impresora Brother QL ───────────────────────────────
def _tcp_reachable(ip, port, timeout=0.7):
    try:
        s = socket.create_connection((ip, port), timeout=timeout)
        s.close()
        return True
    except:
        return False

def auto_discover_printer():
    """UDP broadcast Brother (rápido) → ARP + TCP scan (fallback)."""
    import socket as sk
    # 1. UDP broadcast puerto 54925 (protocolo Brother)
    try:
        sock = sk.socket(sk.AF_INET, sk.SOCK_DGRAM)
        sock.setsockopt(sk.SOL_SOCKET, sk.SO_BROADCAST, 1)
        sock.settimeout(3)
        probe = bytes([0x00]*6 + [0x01])
        sock.sendto(probe, ('255.255.255.255', 54925))
        try:
            _, addr = sock.recvfrom(256)
            sock.close()
            return addr[0]
        except:
            pass
        sock.close()
    except:
        pass

    # 2. ARP cache + subnet /24 — busca puerto 9100
    import subprocess as sp, re, ipaddress
    candidates = set()
    try:
        arp = sp.check_output('arp -a', shell=True, timeout=3).decode(errors='ignore')
        for m in re.finditer(r'(\d+\.\d+\.\d+\.\d+)', arp):
            ip = m.group(1)
            if not any(ip.startswith(p) for p in ('224.', '239.', '169.254.', '255.')):
                candidates.add(ip)
    except:
        pass

    import socket as sk2
    for iface_addrs in sk2.getaddrinfo(sk2.gethostname(), None):
        if iface_addrs[0] == sk2.AF_INET:
            ip = iface_addrs[4][0]
            if not ip.startswith('127.'):
                base = '.'.join(ip.split('.')[:3])
                for i in range(1, 255):
                    candidates.add(f'{base}.{i}')

    found = []
    threads = []
    lock = threading.Lock()
    def check(ip):
        if _tcp_reachable(ip, 9100, 0.5):
            with lock: found.append(ip)
    for ip in list(candidates):
        t = threading.Thread(target=check, args=(ip,), daemon=True)
        threads.append(t)
        t.start()
    for t in threads:
        t.join(timeout=0.8)
    return found[0] if found else None

# ── PDF → PNG por página usando PyMuPDF ──────────────────────────────────────
def pdf_to_pngs(pdf_path, scale=4):
    """Devuelve lista de rutas PNG temporales, una por página."""
    try:
        import fitz  # pymupdf
    except ImportError:
        raise RuntimeError('Instala pymupdf: pip install pymupdf')

    doc = fitz.open(pdf_path)
    pngs = []
    for i, page in enumerate(doc):
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
        tmp = tempfile.mktemp(suffix=f'_p{i}.png')
        pix.save(tmp)
        pngs.append(tmp)
    doc.close()
    return pngs

# ── Enviar a impresora vía TCP puerto 9100 ────────────────────────────────────
def print_png_to_printer(png_path, printer_ip, label_id, target_w, target_h, rotate=0):
    script = BASE_DIR / 'verex_print.py'
    cmd = [
        sys.executable, str(script),
        '--png', png_path,
        '--ip', printer_ip,
        '--label', label_id,
        '--target-w', str(target_w),
        '--target-h', str(target_h),
        '--rotate', str(rotate),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'Error imprimiendo')

# ── Dimensiones por formato ───────────────────────────────────────────────────
FORMAT_CFG = {
    'mini':       {'label': '12',    'w': 106, 'h': 236,  'rotate': 0},   # 20mm @ 300dpi = 236 dots
    'dk2214':     {'label': '12',    'w': 106, 'h': 591,  'rotate': 90},  # 50mm @ 300dpi = 591 dots
    'producto':   {'label': '62',    'w': 606, 'h': 117,  'rotate': 0},
    'dk1204':     {'label': '62',    'w': 606, 'h': 191,  'rotate': 0},
    'producto-v': {'label': '62',    'w': 191, 'h': 606,  'rotate': 0},
    'tarjeta25':  {'label': '62',    'w': 281, 'h': 168,  'rotate': 0},
    'guia':       {'label': '62',    'w': 696, 'h': 1063, 'rotate': 0},
    'recibo':     {'label': '62',    'w': 696, 'h': 0,    'rotate': 0},
}

# ── Handler HTTP ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass  # silencioso

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def do_GET(self):
        if self.path == '/ping':
            self._json(200, {'ok': True, 'app': 'VEREX Print Server (Python)'})

        elif self.path == '/wifi':
            self._json(200, {'ok': True, 'ip': load_cfg().get('printerIp')})

        elif self.path == '/wifi-autoconnect':
            ip = load_cfg().get('printerIp')
            if ip and _tcp_reachable(ip, 9100):
                self._json(200, {'ok': True, 'ip': ip})
            else:
                ip = auto_discover_printer()
                if ip:
                    save_cfg({'printerIp': ip})
                    self._json(200, {'ok': True, 'ip': ip})
                else:
                    self._json(200, {'ok': False, 'error': 'Impresora no encontrada'})
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path == '/wifi':
            body = self._read_body()
            if body.get('ip'):
                save_cfg({'printerIp': body['ip'].strip()})
                self._json(200, {'ok': True})
            else:
                self._json(400, {'ok': False, 'error': 'IP requerida'})

        elif self.path == '/imprimir':
            body = self._read_body()
            pdf_b64   = body.get('pdf_base64', '')
            formato   = body.get('formato', 'mini')
            page_count = int(body.get('pageCount', 1))
            printer_ip = body.get('printerIp') or load_cfg().get('printerIp')

            if not pdf_b64:
                self._json(400, {'ok': False, 'error': 'pdf_base64 vacío'}); return

            # Auto-descubrir si no hay IP
            if not printer_ip:
                printer_ip = auto_discover_printer()
                if printer_ip:
                    save_cfg({'printerIp': printer_ip})
            if not printer_ip:
                self._json(200, {'ok': False, 'error': 'Impresora no encontrada. Verifica WiFi.'}); return

            # Persistir IP si llegó del browser
            if body.get('printerIp') and body['printerIp'] != load_cfg().get('printerIp'):
                save_cfg({'printerIp': body['printerIp']})

            # Guardar PDF temporal
            pdf_path = tempfile.mktemp(suffix='.pdf')
            try:
                with open(pdf_path, 'wb') as f:
                    f.write(base64.b64decode(pdf_b64))

                cfg = FORMAT_CFG.get(formato, FORMAT_CFG['producto'])
                pngs = pdf_to_pngs(pdf_path)

                for png in pngs:
                    try:
                        print_png_to_printer(png, printer_ip, cfg['label'],
                                             cfg['w'], cfg['h'], cfg['rotate'])
                    finally:
                        try: os.unlink(png)
                        except: pass

                self._json(200, {'ok': True, 'etiquetas': len(pngs)})
            except Exception as e:
                self._json(200, {'ok': False, 'error': str(e)})
            finally:
                try: os.unlink(pdf_path)
                except: pass
        else:
            self.send_response(404); self.end_headers()

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = 7891
    try:
        srv = HTTPServer(('127.0.0.1', port), Handler)
        print(f'VEREX Print Server http://127.0.0.1:{port}')
        srv.serve_forever()
    except OSError:
        # Puerto ocupado (ya hay una instancia corriendo)
        sys.exit(0)
