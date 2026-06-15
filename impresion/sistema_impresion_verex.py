import os
import threading
import json
import base64
import tempfile
import customtkinter as ctk
from tkinterdnd2 import TkinterDnD, DND_FILES
import fitz
from PIL import Image, ImageTk, ImageChops, ImageDraw, ImageEnhance
from brother_ql.conversion import convert
from brother_ql.backends.helpers import send
from brother_ql.raster import BrotherQLRaster
from http.server import BaseHTTPRequestHandler, HTTPServer

# --- Configuración de la Impresora ---
MODELO_IMPRESORA = 'QL-810W'
TIPO_ETIQUETA      = '62red'    # guias y recibos
TIPO_ETIQUETA_MINI = '29x90'   # DK-1201: 29mm × 90mm die-cut — 306×991px exactos
IP_IMPRESORA = 'tcp://192.168.0.10'

_app_instance = None  # referencia global para el servidor HTTP

class TkinterDnDApp(ctk.CTk, TkinterDnD.DnDWrapper):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.TkdndVersion = TkinterDnD._require(self)

class SistemaImpresionVerex(TkinterDnDApp):
    def __init__(self):
        super().__init__()

        self.title("SISTEMA DE IMPRESIÓN VEREX")
        self.geometry("750x850")
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.pdf_actual = None
        self.imagenes_impresion = []

        self.tipo_seleccionado = ctk.StringVar(value="guia")
        self.rotar_var = ctk.BooleanVar(value=True)

        self.color_activo = "#2B78E4"
        self.color_inactivo = "#333333"
        self.color_hover = "#3A8DF5"

        self.construir_interfaz()

    def construir_interfaz(self):
        lbl_titulo = ctk.CTkLabel(self, text="SISTEMA DE IMPRESIÓN VEREX", font=("Arial", 24, "bold"))
        lbl_titulo.pack(pady=15)

        frame_opciones = ctk.CTkFrame(self, fg_color="transparent")
        frame_opciones.pack(pady=5, padx=20, fill="x")

        self.btn_guia = ctk.CTkButton(frame_opciones, text="📦 Guía (9cm)", font=("Arial", 16, "bold"),
                                      corner_radius=8, height=45, hover_color=self.color_hover,
                                      command=lambda: self.seleccionar_modulo("guia"))
        self.btn_guia.pack(side="left", padx=5, expand=True, fill="x")

        self.btn_producto = ctk.CTkButton(frame_opciones, text="🏷️ Producto (5 x 1.5)", font=("Arial", 16, "bold"),
                                          corner_radius=8, height=45, hover_color=self.color_hover,
                                          command=lambda: self.seleccionar_modulo("producto"))
        self.btn_producto.pack(side="left", padx=5, expand=True, fill="x")

        self.btn_recibo = ctk.CTkButton(frame_opciones, text="🧾 Recibo (Dinámico)", font=("Arial", 16, "bold"),
                                        corner_radius=8, height=45, hover_color=self.color_hover,
                                        command=lambda: self.seleccionar_modulo("recibo"))
        self.btn_recibo.pack(side="left", padx=5, expand=True, fill="x")

        self.btn_mini = ctk.CTkButton(frame_opciones, text="📎 Mini ½×¾", font=("Arial", 16, "bold"),
                                      corner_radius=8, height=45, hover_color=self.color_hover,
                                      command=lambda: self.seleccionar_modulo("mini"))
        self.btn_mini.pack(side="left", padx=5, expand=True, fill="x")

        self.chk_rotar = ctk.CTkCheckBox(self, text="Rotar 90° (Aplica SOLO para guías)", variable=self.rotar_var, command=self.actualizar_vista_previa_manual, onvalue=True, offvalue=False)
        self.chk_rotar.pack(pady=15)

        self.frame_drop = ctk.CTkFrame(self, height=120, corner_radius=10, fg_color="#2b2b2b", border_width=2, border_color="#555555")
        self.frame_drop.pack(pady=10, padx=40, fill="x")
        self.frame_drop.pack_propagate(False)

        self.lbl_drop = ctk.CTkLabel(self.frame_drop, text="Arrastra y suelta tu PDF aquí", font=("Arial", 16, "bold"))
        self.lbl_drop.pack(expand=True)

        self.frame_drop.drop_target_register(DND_FILES)
        self.frame_drop.dnd_bind('<<Drop>>', self.procesar_archivo)

        self.lbl_preview = ctk.CTkLabel(self, text="Vista Previa", text_color="gray")
        self.lbl_preview.pack(pady=10, expand=True)

        self.btn_imprimir = ctk.CTkButton(self, text="IMPRIMIR ETIQUETA", font=("Arial", 16, "bold"),
                                          fg_color="#28a745", hover_color="#218838", height=50, corner_radius=8,
                                          state="disabled", command=self.imprimir_etiqueta)
        self.btn_imprimir.pack(pady=15, ipadx=20)

        self.seleccionar_modulo("guia")

    def seleccionar_modulo(self, modulo):
        self.tipo_seleccionado.set(modulo)
        self.btn_guia.configure(fg_color=self.color_inactivo, text_color="#AAAAAA")
        self.btn_producto.configure(fg_color=self.color_inactivo, text_color="#AAAAAA")
        self.btn_recibo.configure(fg_color=self.color_inactivo, text_color="#AAAAAA")
        self.btn_mini.configure(fg_color=self.color_inactivo, text_color="#AAAAAA")

        if modulo == "guia":
            self.btn_guia.configure(fg_color=self.color_activo, text_color="white")
        elif modulo == "producto":
            self.btn_producto.configure(fg_color=self.color_activo, text_color="white")
        elif modulo == "recibo":
            self.btn_recibo.configure(fg_color=self.color_activo, text_color="white")
        elif modulo == "mini":
            self.btn_mini.configure(fg_color=self.color_activo, text_color="white")

        self.actualizar_vista_previa_manual()

    def procesar_archivo(self, event):
        archivo = event.data.strip('{}')
        if not archivo.lower().endswith('.pdf'):
            self.lbl_drop.configure(text="¡Error! Solo PDF", text_color="red")
            return

        self.pdf_actual = archivo
        self.lbl_drop.configure(text=f"Cargado: {os.path.basename(archivo)}", text_color="#28a745")
        self.generar_vista_previa()

    def actualizar_vista_previa_manual(self):
        if self.pdf_actual:
            self.generar_vista_previa()

    def procesar_pdf_a_imagenes(self, pdf_path, tipo, rotar=True):
        """
        Convierte un PDF a lista de imágenes listas para imprimir.
        Soporta: guia, producto, recibo, mini, tarjeta25, dk1204, producto-v
        Retorna lista de PIL.Image.
        """
        imagenes = []
        doc = fitz.open(pdf_path)
        ANCHO_IMPRESORA = 696
        mini_buffer = []

        for num_pag in range(len(doc)):
            pagina = doc.load_page(num_pag)
            matriz = fitz.Matrix(4.0, 4.0)
            pix = pagina.get_pixmap(matrix=matriz, alpha=False)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            img_busqueda = img.convert("L").point(lambda x: 0 if x > 240 else 255, '1')
            bbox = img_busqueda.getbbox()
            if bbox:
                img = img.crop((max(0, bbox[0]-2), max(0, bbox[1]-2),
                                min(img.width, bbox[2]+2), min(img.height, bbox[3]+2)))

            if tipo == "guia":
                if rotar:
                    img = img.rotate(90, expand=True)
                img = img.resize((ANCHO_IMPRESORA, 1063), Image.Resampling.LANCZOS)
                imagenes.append(img)

            elif tipo == "producto":
                if img.height > img.width:
                    img = img.rotate(90, expand=True)
                target_w = int(54 * 696 / 62)
                target_h = 117
                img_resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                canvas = Image.new("RGB", (ANCHO_IMPRESORA, target_h), "white")
                canvas.paste(img_resized, ((ANCHO_IMPRESORA - target_w) // 2, 0))
                imagenes.append(canvas)

            elif tipo == "mini":
                px_mm = 696 / 62.0
                target_w = int(60 * px_mm)
                target_h = int(15 * px_mm)
                if img.height > img.width:
                    img = img.rotate(90, expand=True)
                prop = min(target_w / float(img.width), target_h / float(img.height))
                nw = int(img.width * prop)
                nh = int(img.height * prop)
                img_sc = img.resize((nw, nh), Image.Resampling.LANCZOS)
                canvas_mini = Image.new("RGB", (ANCHO_IMPRESORA, target_h), "white")
                canvas_mini.paste(img_sc, ((ANCHO_IMPRESORA - nw) // 2, (target_h - nh) // 2))
                mini_buffer.append(canvas_mini)

            elif tipo == "tarjeta25":
                # Etiqueta 25×15mm — todo el contenido en una sola cara
                px_mm = 696 / 62.0          # 11.226 px/mm
                target_w = int(25 * px_mm)  # 281px
                target_h = int(15 * px_mm)  # 168px
                if img.height > img.width:
                    img = img.rotate(90, expand=True)
                img_sc = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                canvas = Image.new("RGB", (ANCHO_IMPRESORA, target_h), "white")
                x_off = (ANCHO_IMPRESORA - target_w) // 2
                canvas.paste(img_sc, (x_off, 0))
                mini_buffer.append(canvas)

            elif tipo == "recibo":
                proporcion = ANCHO_IMPRESORA / float(img.width)
                nuevo_alto = int(float(img.height) * float(proporcion))
                img = img.resize((ANCHO_IMPRESORA, nuevo_alto), Image.Resampling.LANCZOS)
                margen_seguridad = 250
                imagen_con_margen = Image.new("RGB", (ANCHO_IMPRESORA, nuevo_alto + margen_seguridad), "white")
                imagen_con_margen.paste(img, (0, 0))
                imagenes.append(imagen_con_margen)

            else:
                # Fallback: escalar proporcional al ancho
                proporcion = ANCHO_IMPRESORA / float(img.width)
                nuevo_alto = int(float(img.height) * float(proporcion))
                img = img.resize((ANCHO_IMPRESORA, nuevo_alto), Image.Resampling.LANCZOS)
                imagenes.append(img)

        if (tipo in ("mini", "tarjeta25")) and mini_buffer:
            imagenes.extend(mini_buffer)

        return imagenes

    def generar_vista_previa(self):
        try:
            self.imagenes_impresion.clear()
            tipo = self.tipo_seleccionado.get()
            rotar = self.rotar_var.get()

            self.imagenes_impresion = self.procesar_pdf_a_imagenes(self.pdf_actual, tipo, rotar)

            if not self.imagenes_impresion:
                self.lbl_drop.configure(text="No se generaron imágenes del PDF", text_color="red")
                return

            img_preview = self.imagenes_impresion[0].copy()
            img_preview.thumbnail((300, 350))
            ctk_img = ctk.CTkImage(light_image=img_preview, dark_image=img_preview,
                                   size=(img_preview.width, img_preview.height))
            n = len(self.imagenes_impresion)
            texto = "" if n == 1 else f"Mostrando 1 de {n} etiquetas"
            self.lbl_preview.configure(image=ctk_img, text=texto, compound="bottom")
            self.btn_imprimir.configure(state="normal")

        except Exception as e:
            self.lbl_drop.configure(text=f"Error procesando PDF: {e}", text_color="red")

    def imprimir_etiqueta(self):
        if not self.imagenes_impresion:
            return

        try:
            qlr = BrotherQLRaster(MODELO_IMPRESORA)
            qlr.exception_on_warning = True

            instrucciones = convert(
                qlr=qlr,
                images=self.imagenes_impresion,
                label=TIPO_ETIQUETA,
                dither=True,
                compress=False,
                red=True
            )

            send(instrucciones, IP_IMPRESORA)

            total_etiquetas = len(self.imagenes_impresion)
            mensaje_exito = f"¡Se enviaron {total_etiquetas} etiquetas a imprimir!"
            self.lbl_drop.configure(text=mensaje_exito, text_color="#28a745")

        except Exception as e:
            self.lbl_drop.configure(text=f"Error: {e}", text_color="red")

    def imprimir_desde_web(self, pdf_path, formato, rotar=True):
        """Llamado desde el servidor HTTP. Retorna dict {ok, etiquetas/error}."""
        try:
            imagenes = self.procesar_pdf_a_imagenes(pdf_path, formato, rotar)
            if not imagenes:
                return {'ok': False, 'error': 'No se generaron imágenes del PDF'}

            qlr = BrotherQLRaster(MODELO_IMPRESORA)
            qlr.exception_on_warning = True
            instrucciones = convert(
                qlr=qlr,
                images=imagenes,
                label=TIPO_ETIQUETA,
                dither=True,
                compress=False,
                red=True
            )
            send(instrucciones, IP_IMPRESORA)
            return {'ok': True, 'etiquetas': len(imagenes)}
        except Exception as e:
            return {'ok': False, 'error': str(e)}


# ── Servidor HTTP en puerto 5000 ─────────────────────────────────────────────

class VerexHTTPHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # silenciar logs de consola

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/ping':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True, 'app': 'VEREX Impresión'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != '/imprimir':
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except Exception:
            self._responder({'ok': False, 'error': 'JSON inválido'})
            return

        formato   = data.get('formato', 'mini')
        pdf_b64   = data.get('pdf_base64', '')
        rotar     = data.get('rotar', True)

        if not pdf_b64:
            self._responder({'ok': False, 'error': 'pdf_base64 vacío'})
            return

        try:
            pdf_bytes = base64.b64decode(pdf_b64)
        except Exception:
            self._responder({'ok': False, 'error': 'pdf_base64 inválido'})
            return

        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(pdf_bytes)
            tmp_path = f.name

        try:
            result = _app_instance.imprimir_desde_web(tmp_path, formato, rotar)
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

        self._responder(result)

    def _responder(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)


def iniciar_servidor_http():
    server = HTTPServer(('127.0.0.1', 5000), VerexHTTPHandler)
    print('VEREX HTTP Print Server → http://127.0.0.1:5000')
    server.serve_forever()


if __name__ == "__main__":
    app = SistemaImpresionVerex()
    _app_instance = app

    hilo = threading.Thread(target=iniciar_servidor_http, daemon=True)
    hilo.start()

    app.mainloop()
