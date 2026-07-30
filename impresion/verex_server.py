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

# IP verificada en memoria — evita buscar en cada request
_printer_ip_cache = None
_printer_ip_lock  = threading.Lock()

def _is_brother(ip, timeout=2.0):
    """Verifica que el dispositivo sea realmente una Brother QL.
    Idéntico al check de main.js: HTTP puerto 80 debe contener 'brother' en el body.
    Las Brother siempre tienen web admin en puerto 80; otros dispositivos con 9100 no."""
    import urllib.request, urllib.error
    try:
        req = urllib.request.urlopen(
            f'http://{ip}/', timeout=timeout)
        body = req.read(4096).decode('utf-8', errors='ignore').lower()
        return 'brother' in body
    except urllib.error.HTTPError as e:
        # Redirige (301/302) → casi seguro es una Brother
        return e.code in (301, 302)
    except:
        return False

def _is_brother_quick(ip, timeout=1.5):
    """Check rápido: solo TCP puerto 9100. Para IPs ya verificadas en caché."""
    return _tcp_reachable(ip, 9100, timeout)

def _tcp_reachable(ip, port, timeout=0.7):
    try:
        s = socket.create_connection((ip, port), timeout=timeout)
        s.close()
        return True
    except:
        return False

def auto_discover_printer():
    """1) UDP broadcast Brother (rápido, ~3s)
       2) Subnet scan + verificación real de Brother (fallback, ~8s)
    Retorna la IP verificada o None."""
    import subprocess as sp, re

    # ── 1. UDP broadcast puerto 54925 (protocolo nativo Brother) ──────────────
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(3)
        # Packet de descubrimiento Brother QL/P-touch (igual que main.js)
        probe = bytes([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])
        sock.sendto(probe, ('255.255.255.255', 54925))
        try:
            data, addr = sock.recvfrom(1024)
            ip = addr[0]
            sock.close()
            # Verificar que sea realmente una Brother antes de aceptar
            if _is_brother(ip):
                print(f'[Brother] Encontrada via UDP: {ip}')
                return ip
        except:
            pass
        sock.close()
    except:
        pass

    # ── 2. Subnet scan: ARP cache + /24 completo ──────────────────────────────
    candidates = set()
    try:
        arp = sp.check_output('arp -a', shell=True, timeout=3).decode(errors='ignore')
        for m in re.finditer(r'(\d+\.\d+\.\d+\.\d+)', arp):
            ip = m.group(1)
            if not any(ip.startswith(p) for p in ('224.', '239.', '169.', '255.')):
                candidates.add(ip)
    except:
        pass

    # Agregar toda la subnet local /24
    try:
        local_ip = socket.gethostbyname(socket.gethostname())
        if not local_ip.startswith('127.'):
            base = '.'.join(local_ip.split('.')[:3])
            for i in range(1, 255):
                candidates.add(f'{base}.{i}')
    except:
        pass

    # Paso 1: detectar IPs con puerto 9100 O puerto 80 abiertos (paralelo, rápido)
    candidates_ok = []
    lock = threading.Lock()
    def check_ports(ip):
        if _tcp_reachable(ip, 9100, 0.4) or _tcp_reachable(ip, 80, 0.4):
            with lock: candidates_ok.append(ip)
    threads = [threading.Thread(target=check_ports, args=(ip,), daemon=True)
               for ip in candidates]
    for t in threads: t.start()
    for t in threads: t.join(timeout=0.6)

    # Paso 2: de las candidatas, verificar cuál tiene web Brother (HTTP puerto 80)
    for ip in candidates_ok:
        if _is_brother(ip):
            print(f'[Brother] Encontrada via scan: {ip}')
            return ip

    return None

def get_printer_ip():
    """Devuelve la IP del caché si sigue viva, sino descubre y actualiza."""
    global _printer_ip_cache
    with _printer_ip_lock:
        # Check rápido del caché (solo TCP, sin DNS)
        if _printer_ip_cache and _is_brother_quick(_printer_ip_cache, timeout=1.0):
            return _printer_ip_cache
        # Caché inválida — intentar IP guardada en disco primero (check rápido)
        saved = load_cfg().get('printerIp')
        if saved and _is_brother_quick(saved, timeout=1.5):
            _printer_ip_cache = saved
            return saved
        # Autodescubrimiento completo (con verificación hostname BRW)
        ip = auto_discover_printer()
        if ip:
            _printer_ip_cache = ip
            save_cfg({'printerIp': ip})
            print(f'[Brother] IP actualizada: {ip}')
        return ip

def _bg_reconectar():
    """Hilo background: verifica/descubre la impresora cada 45s."""
    import time
    global _printer_ip_cache
    time.sleep(5)  # Esperar arranque del servidor
    while True:
        try:
            ip = get_printer_ip()
            with _printer_ip_lock:
                _printer_ip_cache = ip
            if ip:
                print(f'[Brother] OK en {ip}')
            else:
                print('[Brother] No encontrada, reintentando en 45s...')
        except Exception as e:
            print(f'[Brother] Error en bg: {e}')
        time.sleep(45)

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
        # Filtrar líneas de deprecation warnings (no son errores reales)
        stderr_lines = [
            l for l in result.stderr.splitlines()
            if 'deprecat' not in l.lower() and 'future release' not in l.lower()
            and 'warnings.warn' not in l.lower() and l.strip()
        ]
        raw = '\n'.join(stderr_lines).strip() or result.stderr.strip() or 'Error imprimiendo'
        # Traducir errores técnicos de red a mensajes legibles
        if 'WinError 10061' in raw or 'Connection refused' in raw or 'ConnectionRefusedError' in raw:
            raise RuntimeError('Impresora no disponible — verificá que esté encendida y conectada al WiFi')
        if 'WinError 10060' in raw or 'timed out' in raw.lower():
            raise RuntimeError('Impresora no responde — verificá que esté encendida y en la red')
        if 'WinError 10065' in raw or 'unreachable' in raw.lower():
            raise RuntimeError('Impresora fuera de la red — verificá la conexión WiFi de la impresora')
        raise RuntimeError(raw)

# ── Dimensiones por formato ───────────────────────────────────────────────────
FORMAT_CFG = {
    'mini':       {'label': '12',    'w': 106, 'h': 190,  'rotate': 90},  # ~20mm ajustado
    'dk2214':     {'label': '12',    'w': 106, 'h': 591,  'rotate': 90},  # 50mm @ 300dpi = 591 dots
    'producto':   {'label': '62',    'w': 606, 'h': 117,  'rotate': 0},
    'dk1204':     {'label': '62',    'w': 606, 'h': 191,  'rotate': 0},
    'producto-v': {'label': '62',    'w': 191, 'h': 606,  'rotate': 0},
    'tarjeta25':  {'label': '62',    'w': 281, 'h': 168,  'rotate': 0},
    'guia':       {'label': '62',    'w': 696, 'h': 1063, 'rotate': 90},
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
            ip = get_printer_ip()
            if ip:
                self._json(200, {'ok': True, 'ip': ip})
            else:
                self._json(200, {'ok': False, 'error': 'Impresora Brother no encontrada en la red'})
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
            pdf_b64    = body.get('pdf_base64', '')
            formato    = body.get('formato', 'mini')
            rollo      = body.get('rollo', 'rojo')
            page_count = int(body.get('pageCount', 1))
            printer_ip = body.get('printerIp') or load_cfg().get('printerIp')

            if not pdf_b64:
                self._json(400, {'ok': False, 'error': 'pdf_base64 vacío'}); return

            # Siempre verificar que sea realmente la Brother antes de imprimir
            # (evita mandar datos a otro dispositivo con puerto 9100 abierto)
            if not printer_ip or not _is_brother_quick(printer_ip, timeout=1.5):
                printer_ip = get_printer_ip()
            if not printer_ip:
                self._json(200, {'ok': False, 'error': 'Impresora Brother no encontrada — verificá que esté encendida y en el WiFi'}); return

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

                cfg = dict(FORMAT_CFG.get(formato, FORMAT_CFG['producto']))
                # Si el rollo instalado es monocromo, usar label '62' en vez de '62red'
                LABEL_ROJO = {'guia', 'recibo', 'producto', 'dk1204', 'producto-v', 'tarjeta25'}
                if rollo != 'rojo' and formato in LABEL_ROJO:
                    cfg['label'] = '62'
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
        # Hilo background: busca/verifica la Brother cada 45s automáticamente
        threading.Thread(target=_bg_reconectar, daemon=True).start()
        srv.serve_forever()
    except OSError:
        # Puerto ocupado (ya hay una instancia corriendo)
        sys.exit(0)
