"""
VEREX Print Server — servidor local para imprimir etiquetas en Brother QL
Corre en background cuando se abre el Hub VEREX.
Expone:
  GET  /ping     → {"ok": true}
  POST /imprimir → { "formato": "mini"|"producto"|"guia"|"recibo",
                     "pdf_base64": "<base64>",
                     "rotar": true }
"""
import base64
import sys
import os
import tempfile
from flask import Flask, request, jsonify, send_from_directory
import fitz
from PIL import Image, ImageDraw

# win32print — driver de Windows (más compatible con QL-810W)
try:
    import win32print, win32ui, win32con
    from PIL import ImageWin
    WIN32_OK = True
except ImportError:
    WIN32_OK = False

# ── Configuración impresora ───────────────────────────────────────────────
ANCHO = 696   # px ancho impresora (62mm a 300dpi)

# Dimensiones de papel por formato (en mm). largo=0 → continuo (9000 décimas)
FORMATOS_PAPEL = {
    'guia':     {'ancho': 62, 'largo': 0 },     # 62mm continuo (largo fijo 9cm vía código)
    'recibo':   {'ancho': 62, 'largo': 0 },     # 62mm continuo (largo dinámico al PDF)
    'etiqueta': {'ancho': 62, 'largo': 25},     # 62mm × 25mm (etiqueta producto 6×2.5cm)
    'producto': {'ancho': 62, 'largo': 15},     # 62mm × 15mm (formato anterior, legacy)
    'mini':     {'ancho': 62, 'largo': 15},     # 62mm × 15mm colgante (cinta continua)
    'tarjeta25':{'ancho': 62, 'largo': 15},     # 62mm × 15mm tarjeta compacta 2.5cm
    'dk1204':   {'ancho': 17, 'largo': 54.3},   # 17mm × 54.3mm Brother DK-1204 die-cut
    'producto-v': {'ancho': 17, 'largo': 54.3}, # 17mm × 54.3mm DK-1204 colgante vertical
}

HERE    = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(HERE, 'print_server.log')
app     = Flask(__name__, static_folder=HERE)

def log(msg):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            import datetime
            f.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}\n")
    except Exception:
        pass


# ── Buscar impresora Brother QL en drivers de Windows ────────────────────
_IMPRESORA_CACHE = {'nombre': None}

def buscar_impresora_windows(verbose=True):
    if not WIN32_OK:
        return None
    try:
        printers = win32print.EnumPrinters(
            win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS, None, 2
        )
        for p in printers:
            nombre = p['pPrinterName']
            if 'QL' in nombre or 'Brother' in nombre:
                if verbose and _IMPRESORA_CACHE['nombre'] != nombre:
                    log(f"Impresora encontrada: {nombre}")
                _IMPRESORA_CACHE['nombre'] = nombre
                return nombre
        _IMPRESORA_CACHE['nombre'] = None
    except Exception as e:
        log(f"Error buscando impresora Windows: {e}")
    return None

# ── Crear HDC de impresora con DEVMODE correcto via ctypes ───────────────
import ctypes, struct as _struct

_GDI32    = ctypes.WinDLL('gdi32')
_WINSPOOL = ctypes.WinDLL('winspool.drv')
DM_OUT_BUFFER = 2

def _crear_hdc_con_papel(nombre_impresora, ancho_mm, largo_mm, rollo='mono', formato='guia'):
    """
    Usa devmode_rojo.bin o devmode_mono.bin (capturados directamente del driver)
    y solo sobreescribe los campos de tamaño de papel. Esto garantiza que el
    color mode es correcto porque viene del driver mismo.
    """
    nombre_w = nombre_impresora

    # Cargar DEVMODE guardado según tipo de rollo
    archivo_dm = os.path.join(HERE, f'devmode_{rollo}.bin')
    devmode_de_archivo = False
    if os.path.exists(archivo_dm):
        with open(archivo_dm, 'rb') as f:
            raw = f.read()
        buf = ctypes.create_string_buffer(raw)
        devmode_de_archivo = True
        log(f"DEVMODE cargado desde {archivo_dm} ({len(raw)} bytes)")
    else:
        # Fallback: obtener DEVMODE actual del driver
        log(f"No encontré {archivo_dm}, usando DEVMODE actual del driver")
        size = _WINSPOOL.DocumentPropertiesW(0, None, nombre_w, None, None, 0)
        if size <= 0:
            log("DocumentPropertiesW devolvió tamaño 0"); return None
        buf = ctypes.create_string_buffer(size)
        ret = _WINSPOOL.DocumentPropertiesW(0, None, nombre_w, buf, None, DM_OUT_BUFFER)
        if ret < 0:
            log(f"DocumentPropertiesW falló: {ret}"); return None

    # ── Para guía/recibo/producto: usar DEVMODE capturado del driver
    #    (preserva paper_code y datos privados) y solo ajustar
    #    largo + color según necesidad. Para producto evita la
    #    duplicación del alto que ocurre cuando forzamos paper_code=279. ──
    if devmode_de_archivo and formato in ('guia', 'recibo', 'producto', 'dk1204', 'mini', 'producto-v', 'tarjeta25'):
        es_rojo = (rollo == 'rojo')
        color_target = 2 if es_rojo else 1
        largo_actual = _struct.unpack_from('<H', buf, 80)[0]
        color_actual = _struct.unpack_from('<H', buf, 92)[0]
        fields = _struct.unpack_from('<I', buf, 72)[0]

        # Largo objetivo en décimas de mm
        if formato == 'guia':
            largo_target = 900   # 9cm exactos
        elif formato in ('producto', 'mini', 'tarjeta25'):
            largo_target = 150   # 15mm = 1.5cm
        elif formato in ('dk1204', 'producto-v'):
            largo_target = 543   # 54.3mm — etiqueta DK-1204 precortada
        else:
            largo_target = largo_mm * 10 if largo_mm else largo_actual

        ancho_actual = _struct.unpack_from('<H', buf, 82)[0]
        # DK-1204 es 17mm de ancho — corregir dmPaperWidth en el devmode
        ancho_target = 170 if formato in ('dk1204', 'producto-v') else ancho_actual

        cambios = []
        if largo_actual != largo_target:
            fields |= 0x0004  # DM_PAPERLENGTH
            _struct.pack_into('<H', buf, 80, largo_target)
            cambios.append(f"largo {largo_actual}→{largo_target}")
        if ancho_actual != ancho_target:
            fields |= 0x0002  # DM_PAPERWIDTH
            _struct.pack_into('<H', buf, 82, ancho_target)
            cambios.append(f"ancho {ancho_actual}→{ancho_target}")
        if color_actual != color_target:
            fields |= 0x0800  # DM_COLOR
            _struct.pack_into('<H', buf, 92, color_target)
            cambios.append(f"color {color_actual}→{color_target}")
        _struct.pack_into('<I', buf, 72, fields)

        log(f"DEVMODE driver + ajustes: {', '.join(cambios) if cambios else 'sin cambios'}")
        hdc_raw = _GDI32.CreateDCW(None, nombre_w, None, buf)
        if not hdc_raw:
            log("CreateDCW devolvió NULL"); return None
        ancho_log = f"{ancho_target/10}mm" if formato == 'dk1204' else "62mm"
        log(f"HDC creado: {ancho_log} × {largo_target/10}mm | rollo={rollo} | formato={formato}")
        return hdc_raw

    # ── Para producto/mini necesitamos sobrescribir paper_code y largo ──
    # 259 = 62mm continuo mono  (DK-2205)
    # 279 = 62mm continuo x2   (DK-2251, negro+rojo)
    # 271 = 29mm × 90mm        (DK-1201, mini)
    es_rojo = (rollo == 'rojo')
    if formato == 'mini':
        paper_code = 271
    elif es_rojo:
        paper_code = 279   # DK-2251 negro+rojo
    else:
        paper_code = 259   # DK-2205 mono

    fields = _struct.unpack_from('<I', buf, 72)[0]
    fields |= 0x0002 | 0x0004 | 0x0008 | 0x0800
    _struct.pack_into('<I', buf, 72, fields)
    _struct.pack_into('<H', buf, 78, paper_code)                           # dmPaperSize
    _struct.pack_into('<H', buf, 80, largo_mm * 10 if largo_mm else 9000)  # dmPaperLength
    _struct.pack_into('<H', buf, 82, ancho_mm * 10)                        # dmPaperWidth
    dm_color = 2 if es_rojo else 1
    _struct.pack_into('<H', buf, 92, dm_color)                             # dmColor
    log(f"paper_code={paper_code}, dmColor={dm_color}, {ancho_mm}mm rollo={rollo}")

    hdc_raw = _GDI32.CreateDCW(None, nombre_w, None, buf)
    if not hdc_raw:
        log("CreateDCW devolvió NULL")
        return None
    log(f"HDC creado: {ancho_mm}mm × {'continuo' if not largo_mm else str(largo_mm)+'mm'} | rollo={rollo}")
    return hdc_raw

# ── Imprimir imagen via driver de Windows con DEVMODE dinámico ───────────
def imprimir_via_driver(imagenes, nombre_impresora, formato, rollo='mono', largo_dinamico_mm=None):
    papel    = FORMATOS_PAPEL.get(formato, {'ancho': 62, 'largo': 0})
    ancho_mm = papel['ancho']
    largo_mm = largo_dinamico_mm if largo_dinamico_mm else papel['largo']

    hdc_raw = _crear_hdc_con_papel(nombre_impresora, ancho_mm, largo_mm, rollo, formato)
    if hdc_raw:
        # Usar el HDC raw con ctypes para obtener las dimensiones
        ancho_px = _GDI32.GetDeviceCaps(hdc_raw, 8)   # HORZRES = 8
        alto_px  = _GDI32.GetDeviceCaps(hdc_raw, 10)  # VERTRES = 10
        log(f"Área impresión (ctypes): {ancho_px}×{alto_px}px")

        # Si el rollo es rojo y el driver reporta alto duplicado por
        # los 2 canales de color, limitar a la mitad para que el contenido
        # se dibuje solo en el canal negro (mitad superior).
        ANCHO_ROLLO_PX = 696   # 62mm a 300dpi
        if rollo == 'rojo' and alto_px > ANCHO_ROLLO_PX * 1.5:
            alto_px_original = alto_px
            alto_px = alto_px // 2
            log(f"alto duplicado por rollo rojo: {alto_px_original}→{alto_px}")

        # Envolver en win32ui para poder usar StartDoc/StartPage/Dib
        hdc = win32ui.CreateDCFromHandle(hdc_raw)
    else:
        # Fallback: usar pywin32 sin DEVMODE personalizado
        log("Fallback: CreatePrinterDC sin DEVMODE")
        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(nombre_impresora)
        ancho_px = hdc.GetDeviceCaps(win32con.HORZRES)
        alto_px  = hdc.GetDeviceCaps(win32con.VERTRES)
        log(f"Área impresión (fallback): {ancho_px}×{alto_px}px")

    hdc.StartDoc('VEREX Etiqueta')
    for img in imagenes:
        hdc.StartPage()
        # Rotar imagen si su orientación no coincide con la del HDC
        # (HDC landscape vs imagen portrait, o viceversa)
        if (img.width > img.height) != (ancho_px > alto_px):
            img = img.rotate(90, expand=True)
        prop  = min(ancho_px / img.width, alto_px / img.height)
        nw    = int(img.width  * prop)
        nh    = int(img.height * prop)
        img_r = img.resize((nw, nh), Image.Resampling.BILINEAR)
        dib   = ImageWin.Dib(img_r)
        x_off = (ancho_px - nw) // 2
        y_off = (alto_px - nh) // 2
        dib.draw(hdc.GetHandleOutput(), (x_off, y_off, x_off + nw, y_off + nh))
        hdc.EndPage()
    hdc.EndDoc()
    hdc.DeleteDC()

# ── Envío a impresora ─────────────────────────────────────────────────────
def enviar_a_impresora(imagenes, formato, rollo='mono', largo_dinamico_mm=None):
    """Usa el driver de Windows como método principal."""
    if WIN32_OK:
        nombre = buscar_impresora_windows()
        if nombre:
            imprimir_via_driver(imagenes, nombre, formato, rollo, largo_dinamico_mm)
            log(f"Impreso via driver Windows: {nombre}")
            return f"driver:{nombre}"
        else:
            log("No se encontró impresora Brother en drivers de Windows")

    raise Exception("No se encontró la impresora. Verifica que el driver Brother QL esté instalado.")

# ── CORS (permite llamadas desde verex-consignacion.pages.dev) ────────────
@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response


# ── Capturar DEVMODE actual del driver (para debug) ───────────────────────
@app.route('/devmode')
def get_devmode():
    nombre = buscar_impresora_windows()
    if not nombre:
        return jsonify({"ok": False, "error": "No se encontró impresora"}), 400
    size = _WINSPOOL.DocumentPropertiesW(0, None, nombre, None, None, 0)
    buf  = ctypes.create_string_buffer(size)
    _WINSPOOL.DocumentPropertiesW(0, None, nombre, buf, None, DM_OUT_BUFFER)
    hex_bytes = buf.raw.hex()
    # Guardar en archivo para comparar
    tag = request.args.get('tag', 'actual')
    ruta = os.path.join(HERE, f'devmode_{tag}.bin')
    with open(ruta, 'wb') as f:
        f.write(buf.raw)
    log(f"DEVMODE capturado ({tag}): {size} bytes → {ruta}")
    return jsonify({"ok": True, "tag": tag, "size": size, "hex": hex_bytes[:200] + "..."})

# ── Página de impresión ───────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(HERE, 'imprimir.html')

# ── Health check ─────────────────────────────────────────────────────────
@app.route('/ping')
def ping():
    impresora = buscar_impresora_windows(verbose=False) if WIN32_OK else None
    return jsonify({"ok": True, "version": "2.1", "impresora": impresora})


# ── Imprimir ──────────────────────────────────────────────────────────────
@app.route('/imprimir', methods=['POST', 'OPTIONS'])
def imprimir():
    if request.method == 'OPTIONS':
        return jsonify({"ok": True})

    data    = request.get_json(force=True)
    formato = data.get('formato', 'mini')        # mini | producto | guia | recibo
    pdf_b64 = data.get('pdf_base64', '')
    rotar   = data.get('rotar', True)
    rollo   = data.get('rollo', 'mono')   # 'mono' | 'rojo'
    log(f"Solicitud recibida: formato={formato}, rollo={rollo}, pdf_b64 len={len(pdf_b64)}")

    # Decodificar PDF
    try:
        pdf_bytes = base64.b64decode(pdf_b64)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        log(f"PDF decodificado OK: {len(doc)} páginas")
    except Exception as e:
        log(f"ERROR decodificando PDF: {e}")
        return jsonify({"ok": False, "error": f"PDF inválido: {e}"}), 400

    imagenes  = []
    mini_buf  = []

    # Para recibo/guía escalamos hacia abajo (PDF grande → rollo 696px):
    # 2× da suficiente calidad y es 4× más rápido que 4×.
    # Para etiquetas pequeñas (mini, producto) escalamos hacia arriba,
    # por eso mantenemos 4× para preservar detalle.
    scale = 2 if formato in ('recibo', 'guia') else 4
    mat   = fitz.Matrix(scale, scale)

    for i in range(len(doc)):
        pag = doc.load_page(i)
        pix = pag.get_pixmap(matrix=mat, alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Recorte de blancos — NO aplicar para producto/etiqueta (tienen layout exacto).
        if formato not in ("producto", "etiqueta", "producto-v"):
            bw = img.convert("L").point(lambda x: 0 if x > 240 else 255, '1')
            bb = bw.getbbox()
            if bb:
                img = img.crop((
                    max(0, bb[0]-10), max(0, bb[1]-10),
                    min(img.width, bb[2]+10), min(img.height, bb[3]+10)
                ))

        # ── Guía (62mm × 9cm fijo) ───────────────────────────────────────
        if formato == "guia":
            # Auto-rotar si el PDF es horizontal (para que el lado largo
            # vaya a lo largo del rollo)
            if img.width > img.height:
                img = img.rotate(90, expand=True)
            elif rotar:
                img = img.rotate(90, expand=True)
            # Largo fijo: 9cm = 1063px a 300dpi
            img = img.resize((ANCHO, 1063), Image.Resampling.BILINEAR)
            imagenes.append(img)

        # ── Etiqueta (6cm × 2.5cm, landscape, doblez al centro) ─────────
        elif formato == "etiqueta":
            # PDF en landscape 60×25mm — rotar si viene portrait
            if img.height > img.width:
                img = img.rotate(-90, expand=True)
            tw = ANCHO                         # 696px ≈ 62mm
            th = int(25 * ANCHO / 62)          # 281px = 25mm
            img = img.resize((tw, th), Image.Resampling.BILINEAR)
            imagenes.append(img)

        # ── DK-1204 (5.43cm × 1.7cm — etiqueta precortada Brother) ──────
        elif formato == "dk1204":
            # PDF en landscape 54.3×17mm.
            if img.height > img.width:
                img = img.rotate(90, expand=True)
            tw = 641   # 54.3mm a 300dpi
            th = 201   # 17mm a 300dpi
            r  = img.resize((tw, th), Image.Resampling.BILINEAR)
            # Para DK-1204 NO rotamos -90 porque el rollo ya tiene la orientación
            # correcta (17mm de ancho × 54.3mm de avance por etiqueta).
            # Pegamos directo en un canvas del mismo tamaño.
            c = Image.new("RGB", (tw, th), "white")
            c.paste(r, (0, 0))
            imagenes.append(c)

        # ── DK Vertical (1.7cm × 5.43cm — DK-1204 colgante vertical) ─────
        elif formato == "producto-v":
            # PDF portrait 17×54.3mm. Asegurar orientación portrait.
            if img.width > img.height:
                img = img.rotate(-90, expand=True)
            tw = 201   # 17mm a 300dpi
            th = 641   # 54.3mm a 300dpi
            r  = img.resize((tw, th), Image.Resampling.BILINEAR)
            c  = Image.new("RGB", (tw, th), "white")
            c.paste(r, (0, 0))
            imagenes.append(c)

        # ── Producto (6cm × 1.5cm — etiqueta plegable plastiflecha) ──────
        elif formato == "producto":
            # PDF en landscape 60×15mm. Doblez al centro (x=30mm).
            if img.height > img.width:
                img = img.rotate(90, expand=True)
            tw = 708   # 60mm a 300dpi
            th = 177   # 15mm a 300dpi
            r  = img.resize((tw, th), Image.Resampling.BILINEAR)
            # Rotar 90° CW para que el PDF landscape se mapee al canvas
            # portrait de la etiqueta (15mm de avance × 62mm de ancho rollo)
            r = r.rotate(-90, expand=True)
            # Canvas portrait 177×696 (= 15mm × 62mm).
            # Si el PDF (60mm) es más ancho que el rollo (62mm), recortar.
            # Si es más estrecho, centrar verticalmente.
            c = Image.new("RGB", (th, ANCHO), "white")
            if r.height <= ANCHO:
                y_off = (ANCHO - r.height) // 2
                c.paste(r, (0, y_off))
            else:
                # PDF más alto que canvas — centrar y recortar bordes
                crop_top = (r.height - ANCHO) // 2
                r_cropped = r.crop((0, crop_top, r.width, crop_top + ANCHO))
                c.paste(r_cropped, (0, 0))
            imagenes.append(c)

        # ── Recibo (62mm × largo dinámico al contenido) ──────────────────
        elif formato == "recibo":
            # Auto-rotar si el PDF es horizontal (lado largo a lo largo del rollo)
            if img.width > img.height:
                img = img.rotate(90, expand=True)
            # Escalar al ancho del rollo (62mm) manteniendo proporción
            p = ANCHO / float(img.width)
            h = int(img.height * p)
            img = img.resize((ANCHO, h), Image.Resampling.BILINEAR)
            imagenes.append(img)

        # ── Tarjeta 25 (2.5cm × 1.5cm — todo en una cara, cinta 62mm) ──────
        elif formato == "tarjeta25":
            # PDF landscape 22×15mm — cara datos única, fondo blanco
            if img.height > img.width:
                img = img.rotate(90, expand=True)
            tw = int(50 * 300 / 25.4)  # ~591px = 50mm a 300dpi (dos caras de 25mm)
            th = int(15 * 300 / 25.4)  # ~177px = 15mm a 300dpi
            r  = img.resize((tw, th), Image.Resampling.BILINEAR)
            # Rotar 90° CW para mapear PDF landscape al canvas portrait del rollo
            r = r.rotate(-90, expand=True)
            # Canvas portrait th×ANCHO (= 15mm × 62mm)
            c = Image.new("RGB", (th, ANCHO), "white")
            if r.height <= ANCHO:
                y_off = (ANCHO - r.height) // 2
                c.paste(r, (0, y_off))
            else:
                crop_top = (r.height - ANCHO) // 2
                c.paste(r.crop((0, crop_top, r.width, crop_top + ANCHO)), (0, 0))
            imagenes.append(c)

        # ── Mini (6cm × 1.5cm colgante — cinta continua 62mm) ───────────
        elif formato == "mini":
            # PDF landscape 60×15mm. Doblez al centro (x=30mm).
            if img.height > img.width:
                img = img.rotate(90, expand=True)
            tw = 708   # 60mm a 300dpi
            th = 177   # 15mm a 300dpi
            r  = img.resize((tw, th), Image.Resampling.BILINEAR)
            # Rotar 90° CW para mapear PDF landscape al canvas portrait del rollo
            r = r.rotate(-90, expand=True)
            # Canvas portrait 177×696 (= 15mm × 62mm)
            c = Image.new("RGB", (th, ANCHO), "white")
            if r.height <= ANCHO:
                y_off = (ANCHO - r.height) // 2
                c.paste(r, (0, y_off))
            else:
                crop_top = (r.height - ANCHO) // 2
                c.paste(r.crop((0, crop_top, r.width, crop_top + ANCHO)), (0, 0))
            imagenes.append(c)

    if not imagenes:
        return jsonify({"ok": False, "error": "No se generaron imágenes del PDF"}), 400

    # Binarizar a blanco/negro puro — el cabezal térmico no reproduce grises;
    # los textos/colores claros (grises decorativos, dorado del logo, etc.)
    # que se ven bien en pantalla salen casi invisibles si se dejan como
    # tonos intermedios. Forzamos negro sólido para todo lo que no sea
    # prácticamente blanco, así el impreso queda legible sin importar el
    # color original en el PDF.
    imagenes = [
        im.convert('L').point(lambda x: 0 if x < 225 else 255).convert('RGB')
        for im in imagenes
    ]

    # Para recibo: calcular el largo en mm desde el alto de la imagen procesada
    # (300dpi → 1mm = 11.811 px). Damos 10mm extra de margen de corte.
    # Clamp a [30, 1000]mm para evitar errores del driver con valores extremos.
    largo_dinamico_mm = None
    if formato == 'recibo':
        alto_px = max(im.height for im in imagenes)
        largo_dinamico_mm = int(alto_px / 11.811) + 10
        largo_dinamico_mm = max(30, min(1000, largo_dinamico_mm))
        log(f"Recibo: largo dinámico = {largo_dinamico_mm}mm (alto={alto_px}px)")

    # ── Enviar a impresora ────────────────────────────────────────────────
    try:
        log(f"Enviando {len(imagenes)} imagen(es) a impresora...")
        via = enviar_a_impresora(imagenes, formato, rollo, largo_dinamico_mm)
        log(f"Impreso OK via {via}")
        return jsonify({"ok": True, "etiquetas": len(imagenes), "formato": formato, "via": via})
    except Exception as e:
        import traceback
        log(f"ERROR al imprimir: {e}\n{traceback.format_exc()}")
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Entry point ───────────────────────────────────────────────────────────
def run():
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)

if __name__ == '__main__':
    run()
