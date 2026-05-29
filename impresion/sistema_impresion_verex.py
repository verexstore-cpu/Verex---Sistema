import os
import customtkinter as ctk
from tkinterdnd2 import TkinterDnD, DND_FILES
import fitz  # PyMuPDF
from PIL import Image, ImageTk, ImageChops, ImageDraw, ImageFont
from brother_ql.conversion import convert
from brother_ql.backends.helpers import send
from brother_ql.raster import BrotherQLRaster

# --- Configuración de la Impresora ---
MODELO_IMPRESORA = 'QL-810W'
TIPO_ETIQUETA_GUIA     = '62red'
TIPO_ETIQUETA_PRODUCTO = '62red'
IP_IMPRESORA = 'tcp://192.168.0.2'

class TkinterDnDApp(ctk.CTk, TkinterDnD.DnDWrapper):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.TkdndVersion = TkinterDnD._require(self)

class SistemaImpresionVerex(TkinterDnDApp):
    def __init__(self):
        super().__init__()

        self.title("SISTEMA DE IMPRESIÓN VEREX")
        self.geometry("700x850")
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

        if modulo == "guia":
            self.btn_guia.configure(fg_color=self.color_activo, text_color="white")
        elif modulo == "producto":
            self.btn_producto.configure(fg_color=self.color_activo, text_color="white")
        elif modulo == "recibo":
            self.btn_recibo.configure(fg_color=self.color_activo, text_color="white")

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

    def generar_vista_previa(self):
        try:
            self.imagenes_impresion.clear()
            doc = fitz.open(self.pdf_actual)
            total_paginas = len(doc)

            ANCHO_IMPRESORA = 696
            tipo = self.tipo_seleccionado.get()

            for num_pag in range(total_paginas):
                pagina = doc.load_page(num_pag)
                matriz = fitz.Matrix(4.0, 4.0)
                pix = pagina.get_pixmap(matrix=matriz, alpha=False)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

                # Auto-recorte de márgenes blancos
                bg = Image.new(img.mode, img.size, (255, 255, 255))
                diff = ImageChops.difference(img, bg)
                bbox = diff.getbbox()
                if bbox:
                    b_left, b_top, b_right, b_bottom = bbox
                    img = img.crop((max(0, b_left-10), max(0, b_top-10), min(img.width, b_right+10), min(img.height, b_bottom+10)))

                # Rotación
                if tipo == "guia" and self.rotar_var.get():
                    img = img.rotate(90, expand=True)
                elif tipo == "producto":
                    if img.height > img.width:
                        img = img.rotate(90, expand=True)

                # ESCALADO
                if tipo == "guia":
                    img = img.resize((ANCHO_IMPRESORA, 1063), Image.Resampling.LANCZOS)

                elif tipo == "producto":
                    # Cinta completa 62mm: 696×117px — mitad izquierda blanco, mitad derecha contenido
                    alto_etiqueta  = 133          # 1.7cm — mejor legibilidad del contenido
                    zona_contenido = ANCHO_IMPRESORA // 2  # 348px cada mitad

                    prop_alto  = (alto_etiqueta - 4) / float(img.height)
                    prop_ancho = zona_contenido / float(img.width)
                    proporcion = min(prop_alto, prop_ancho)

                    nuevo_ancho = int(img.width  * proporcion)
                    nuevo_alto  = int(img.height * proporcion)
                    img_resized = img.resize((nuevo_ancho, nuevo_alto), Image.Resampling.LANCZOS)

                    canvas = Image.new("RGB", (ANCHO_IMPRESORA, alto_etiqueta), "white")
                    x_offset = zona_contenido + (zona_contenido - nuevo_ancho) // 2
                    y_offset = (alto_etiqueta - nuevo_alto) // 2
                    canvas.paste(img_resized, (x_offset, y_offset))

                    # Texto VEREX en la mitad izquierda (zona en blanco)
                    draw = ImageDraw.Draw(canvas)
                    cx = zona_contenido // 2  # centro horizontal de la zona blanca
                    try:
                        font_titulo = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", size=28)
                        font_slogan = ImageFont.truetype("C:/Windows/Fonts/ariali.ttf",  size=14)
                    except:
                        font_titulo = ImageFont.load_default()
                        font_slogan = ImageFont.load_default()

                    draw.text((cx, alto_etiqueta // 2 - 14), "VEREX",      fill="black",       font=font_titulo, anchor="mm")
                    draw.text((cx, alto_etiqueta // 2 + 16), "“Más que accesorios... Identidad”", fill=(80, 80, 80), font=font_slogan, anchor="mm")
                    img = canvas

                elif tipo == "recibo":
                    proporcion = ANCHO_IMPRESORA / float(img.width)
                    nuevo_alto = int((float(img.height) * float(proporcion)))
                    img = img.resize((ANCHO_IMPRESORA, nuevo_alto), Image.Resampling.LANCZOS)

                    margen_seguridad = 250
                    imagen_con_margen = Image.new("RGB", (ANCHO_IMPRESORA, nuevo_alto + margen_seguridad), "white")
                    imagen_con_margen.paste(img, (0, 0))
                    img = imagen_con_margen

                self.imagenes_impresion.append(img)

                if num_pag == 0:
                    img_preview = img.copy()
                    img_preview.thumbnail((300, 350))
                    ctk_img = ctk.CTkImage(light_image=img_preview, dark_image=img_preview, size=(img_preview.width, img_preview.height))

                    texto_preview = "" if total_paginas == 1 else f"Mostrando 1 de {total_paginas} etiquetas"
                    self.lbl_preview.configure(image=ctk_img, text=texto_preview, compound="bottom")

            self.btn_imprimir.configure(state="normal")

        except Exception as e:
            self.lbl_drop.configure(text=f"Error procesando PDF: {e}", text_color="red")

    def imprimir_etiqueta(self):
        if not self.imagenes_impresion:
            return

        try:
            tipo = self.tipo_seleccionado.get()
            label_type = TIPO_ETIQUETA_PRODUCTO if tipo == "producto" else TIPO_ETIQUETA_GUIA

            qlr = BrotherQLRaster(MODELO_IMPRESORA)
            qlr.exception_on_warning = True

            instrucciones = convert(
                qlr=qlr,
                images=self.imagenes_impresion,
                label=label_type,
                dither=True,
                compress=False,
                red=True
            )

            send(instrucciones, IP_IMPRESORA)
            self.lbl_drop.configure(text=f"¡Se enviaron {len(self.imagenes_impresion)} etiquetas a imprimir!", text_color="#28a745")

        except Exception as e:
            self.lbl_drop.configure(text=f"Error: {e}", text_color="red")

if __name__ == "__main__":
    app = SistemaImpresionVerex()
    app.mainloop()