import os
import customtkinter as ctk
from tkinterdnd2 import TkinterDnD, DND_FILES
import fitz
from PIL import Image, ImageTk, ImageChops, ImageDraw, ImageEnhance
from brother_ql.conversion import convert
from brother_ql.backends.helpers import send
from brother_ql.raster import BrotherQLRaster

# --- Configuración de la Impresora ---
MODELO_IMPRESORA = 'QL-810W'
TIPO_ETIQUETA      = '62red'    # guias y recibos
TIPO_ETIQUETA_MINI = '29x90'   # DK-1201: 29mm × 90mm die-cut — 306×991px exactos
IP_IMPRESORA = 'tcp://192.168.0.7'

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

    def generar_vista_previa(self):
        try:
            self.imagenes_impresion.clear()
            doc = fitz.open(self.pdf_actual)
            total_paginas = len(doc)
            ANCHO_IMPRESORA = 696
            tipo = self.tipo_seleccionado.get()
            mini_buffer = []  # acumula etiquetas mini individuales

            for num_pag in range(total_paginas):
                pagina = doc.load_page(num_pag)
                matriz = fitz.Matrix(4.0, 4.0)
                pix = pagina.get_pixmap(matrix=matriz, alpha=False)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

                img_busqueda = img.convert("L").point(lambda x: 0 if x > 240 else 255, '1')
                bbox = img_busqueda.getbbox()
                if bbox:
                    img = img.crop((max(0, bbox[0]-2), max(0, bbox[1]-2), min(img.width, bbox[2]+2), min(img.height, bbox[3]+2)))

                if tipo == "guia" and self.rotar_var.get():
                    img = img.rotate(90, expand=True)
                elif tipo == "producto":
                    if img.height > img.width:
                        img = img.rotate(90, expand=True)

                if tipo == "guia":
                    img = img.resize((ANCHO_IMPRESORA, 1063), Image.Resampling.LANCZOS)

                elif tipo == "producto":
                    target_w = int(54 * 696 / 62)
                    target_h = 117
                    img_resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                    canvas = Image.new("RGB", (ANCHO_IMPRESORA, target_h), "white")
                    canvas.paste(img_resized, ((ANCHO_IMPRESORA - target_w) // 2, 0))
                    img = canvas

                elif tipo == "mini":
                    # PDF landscape 19.05×12.7mm → escalar → rotar 90° → QR al lado
                    px_mm = 696 / 62.0
                    tw = int(19.05 * px_mm)   # 214px ancho
                    th = int(12.7  * px_mm)   # 143px alto
                    prop = min(tw/float(img.width), th/float(img.height))
                    nw = int(img.width  * prop)
                    nh = int(img.height * prop)
                    img_sc = img.resize((nw, nh), Image.Resampling.LANCZOS)
                    canvas_mini = Image.new("RGB", (tw, th), "white")
                    canvas_mini.paste(img_sc, ((tw-nw)//2, (th-nh)//2))
                    mini_buffer.append(canvas_mini.rotate(90, expand=True))  # 143×214px
                    continue

                elif tipo == "recibo":
                    proporcion = ANCHO_IMPRESORA / float(img.width)
                    nuevo_alto = int(float(img.height) * float(proporcion))
                    img = img.resize((ANCHO_IMPRESORA, nuevo_alto), Image.Resampling.LANCZOS)
                    margen_seguridad = 250
                    imagen_con_margen = Image.new("RGB", (ANCHO_IMPRESORA, nuevo_alto + margen_seguridad), "white")
                    imagen_con_margen.paste(img, (0, 0))
                    img = imagen_con_margen

                self.imagenes_impresion.append(img)

                if num_pag == 0 and tipo != "mini":
                    img_preview = img.copy()
                    img_preview.thumbnail((300, 350))
                    ctk_img = ctk.CTkImage(light_image=img_preview, dark_image=img_preview, size=(img_preview.width, img_preview.height))
                    texto_preview = "" if total_paginas == 1 else f"Mostrando 1 de {total_paginas} etiquetas"
                    self.lbl_preview.configure(image=ctk_img, text=texto_preview, compound="bottom")

            # ── Combinar etiquetas mini de 3 en 3 ──────────────────────────────
            if tipo == "mini" and mini_buffer:
                # DK-1201: 29×90mm — una mini por die-cut, escalada para llenar el label
                DIE_W = 306
                DIE_H = 991

                for i, lbl in enumerate(mini_buffer):
                    # Rotar 90° y escalar al die-cut 306×991px
                    lbl = lbl.rotate(90, expand=True)
                    prop = min(DIE_W / float(lbl.width), DIE_H / float(lbl.height))
                    nw   = int(lbl.width  * prop)
                    nh   = int(lbl.height * prop)
                    lbl_r = lbl.resize((nw, nh), Image.Resampling.LANCZOS)
                    canvas_die = Image.new("RGB", (DIE_W, DIE_H), "white")
                    canvas_die.paste(lbl_r, ((DIE_W - nw) // 2, (DIE_H - nh) // 2))
                    self.imagenes_impresion.append(canvas_die)

                    if i == 0:
                        prev = canvas_die.copy()
                        prev.thumbnail((300, 350))
                        ctk_img = ctk.CTkImage(light_image=prev, dark_image=prev, size=(prev.width, prev.height))
                        self.lbl_preview.configure(image=ctk_img,
                            text=f"{len(mini_buffer)} etiqueta(s) mini — DK-1201",
                            compound="bottom")

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
                label=TIPO_ETIQUETA_MINI if self.tipo_seleccionado.get() == "mini" else TIPO_ETIQUETA,
                dither=True,
                compress=False,
                red=self.tipo_seleccionado.get() != "mini"  # False para die-cut 29x90 (solo negro)
            )

            send(instrucciones, IP_IMPRESORA)
            
            total_etiquetas = len(self.imagenes_impresion)
            mensaje_exito = f"¡Se enviaron {total_etiquetas} etiquetas a imprimir!"
            self.lbl_drop.configure(text=mensaje_exito, text_color="#28a745")
            
        except Exception as e:
            self.lbl_drop.configure(text=f"Error: {e}", text_color="red")

if __name__ == "__main__":
    app = SistemaImpresionVerex()
    app.mainloop()