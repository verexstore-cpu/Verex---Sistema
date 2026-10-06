import customtkinter as ctk
import os
import json
import subprocess
import sys

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hub_config.json")

class VerexHub(ctk.CTk):
    def __init__(self):
        super().__init__()

        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            self.config_data = json.load(f)

        self._procesos_hijos = []
        self._iniciar_print_server()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.title("VEREX HUB")
        self.geometry("560x620")
        self.resizable(False, False)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        # ── Encabezado ─────────────────────────────────────────────
        frame_header = ctk.CTkFrame(self, fg_color="#0a0a0a", corner_radius=0)
        frame_header.pack(fill="x", pady=(0, 0))

        ctk.CTkLabel(
            frame_header,
            text=self.config_data["titulo"],
            font=("Georgia", 32, "bold"),
            text_color="#C9A84C"
        ).pack(pady=(18, 0))

        ctk.CTkLabel(
            frame_header,
            text=self.config_data["slogan"],
            font=("Arial", 11, "italic"),
            text_color="#888888"
        ).pack(pady=(2, 14))

        # ── Scroll ─────────────────────────────────────────────────
        self.scroll = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.scroll.pack(fill="both", expand=True, padx=20, pady=10)

        # ── Secciones desde config ──────────────────────────────────
        for seccion in self.config_data["secciones"]:
            self._seccion(seccion["nombre"], seccion["color"])
            botones = list(seccion["botones"])
            # "Recibir cambios" va justo después de "Sincronizar Sistema" (si el config no lo trae ya)
            hay_recibir = any("recibir" in b["texto"].lower() for s2 in self.config_data["secciones"] for b in s2["botones"])
            if not hay_recibir:
                for i, b in enumerate(botones):
                    if "sincronizar" in b["texto"].lower():
                        botones.insert(i + 1, {"emoji": "📥", "texto": "Recibir cambios", "archivo": "__recibir__", "url": ""})
                        break
            for btn in botones:
                texto = f"{btn['emoji']}  {btn['texto']}"
                archivo = btn["archivo"]
                t = btn["texto"].lower()
                # Las dos entradas de impresión se reconocen por su nombre, sin depender de hub_config.json:
                if "imprimir pdf" in t:
                    archivo = "imprimir"             # → app de impresión en la pestaña "Cualquier PDF"
                elif "impresión verex" in t or "impresion verex" in t:
                    archivo = "__app_impresion__"    # → app de impresión (ventana normal)
                self._boton(texto, archivo, btn.get("url", ""), "#1a1a2e", seccion["color"],
                            nota=btn.get("nota") or self._nota_para(btn["texto"]))

    def _seccion(self, titulo, color):
        frame = ctk.CTkFrame(self.scroll, fg_color="transparent")
        frame.pack(fill="x", pady=(18, 6), padx=4)
        ctk.CTkLabel(
            frame,
            text=titulo,
            font=("Arial", 11, "bold"),
            text_color=color
        ).pack(side="left")
        ctk.CTkFrame(frame, height=1, fg_color="#333333").pack(
            side="left", fill="x", expand=True, padx=(10, 0), pady=6
        )

    # Nota corta (qué hace cada botón). Si en hub_config.json un botón trae su propio campo "nota", esa gana.
    NOTAS = [
        ("sincronizar", "SUBE lo de esta PC a GitHub y publica las páginas. Úsalo solo si editaste archivos aquí. "
                        "Si Claude cambió algo desde la nube, usa antes «Recibir cambios»."),
        ("recibir",     "BAJA a esta PC lo que hay en GitHub (los cambios hechos desde la nube). No borra tus archivos. "
                        "Úsalo antes de «Sincronizar Sistema»."),
        ("supabase",    "Abre la base de datos (Supabase): productos, stock, pedidos y clientes."),
        ("optimizador", "Mejora las fotos de producto: nitidez, fondo y color, listas para la tienda."),
        ("foto qr",     "Toma la foto del producto y genera o lee su código QR."),
        ("impresión verex", "Abre la app de impresión: etiquetas, recibos y guías en la Brother QL."),
        ("impresion verex", "Abre la app de impresión: etiquetas, recibos y guías en la Brother QL."),
        ("imprimir pdf", "Abre la app de impresión en «Cualquier PDF»: arrastra la guía de envío, elige el grosor del texto e imprime."),
        ("obs",         "Abre OBS Studio para grabar o transmitir en vivo."),
    ]

    def _nota_para(self, texto):
        t = texto.lower()
        for clave, nota in self.NOTAS:
            if clave in t:
                return nota
        return ""

    def _boton(self, texto, nombre_archivo, url, bg, accent, nota=""):
        btn = ctk.CTkButton(
            self.scroll,
            text=texto,
            font=("Arial", 14, "bold"),
            height=46,
            corner_radius=8,
            fg_color=bg,
            hover_color=accent,
            border_width=1,
            border_color=accent,
            text_color="white",
            anchor="w",
            command=lambda n=nombre_archivo, u=url: self._abrir(n, u)
        )
        btn.pack(pady=(4, 0 if nota else 4), padx=4, fill="x")
        if nota:
            ctk.CTkLabel(
                self.scroll, text=nota, font=("Arial", 10), text_color="#8a8a8a",
                anchor="w", justify="left", wraplength=470
            ).pack(pady=(0, 6), padx=10, fill="x")

    def _recibir_cambios(self):
        """Trae a esta PC lo que hay en GitHub (abre «RECIBIR CAMBIOS DE GITHUB.bat», que no borra archivos)."""
        bat = os.path.join(os.path.expanduser("~"), "Desktop", "SISTEMA VEREX OFICIAL MAY2026",
                           "hub-escritorio", "RECIBIR CAMBIOS DE GITHUB.bat")
        if os.path.exists(bat):
            try:
                subprocess.Popen(['cmd', '/c', 'start', '"Recibir cambios"', bat])
                return
            except Exception:
                pass
        try:
            from tkinter import messagebox
            messagebox.showinfo("Recibir cambios",
                "No se encontró «RECIBIR CAMBIOS DE GITHUB.bat» en\n" + bat +
                "\n\nGuárdalo en esa carpeta (hub-escritorio) y vuelve a intentar.")
        except Exception:
            print("No encontrado:", bat)

    def _abrir(self, nombre_base, url=""):
        # "Imprimir PDF (Guías)" necesita que la app de impresión esté
        # corriendo (puerto 7891) para poder mandar cualquier trabajo — en
        # vez de abrirla siempre con el Hub (aunque no se vaya a imprimir
        # nada esa sesión), se arranca sola justo aquí, un instante antes de
        # abrir la página, solo si todavía no está activa.
        if nombre_base == "__recibir__":
            self._recibir_cambios()
            return
        if nombre_base == "__app_impresion__":
            self._asegurar_impresion_activa()
            if self._traer_app_impresion_al_frente():
                return
            nombre_base, url = "impresion", url   # si algo falla, el comportamiento de siempre
        if nombre_base == "imprimir":
            self._asegurar_impresion_activa()
            # Ahora "Imprimir PDF (Guías)" abre la app VEREX – Impresión en su pestaña
            # "Cualquier PDF" (con el selector de negrita), no la página vieja imprimir.html.
            if self._abrir_guias_en_app_impresion():
                return
        # Si tiene ruta local completa, abrirla directamente
        if url and not url.startswith("http") and os.path.exists(url):
            os.startfile(url)
            return
        # Si es URL web, abrirla en el navegador
        if url and url.startswith("http"):
            import webbrowser
            webbrowser.open(url)
            return
        # Buscar archivo en la carpeta del hub
        ruta = os.path.dirname(os.path.abspath(__file__))
        try:
            for archivo in os.listdir(ruta):
                if archivo.startswith(nombre_base) and not archivo.endswith(".py") and not archivo.endswith(".json"):
                    os.startfile(os.path.join(ruta, archivo))
                    return
            print(f"No encontrado: {nombre_base}")
        except Exception as e:
            print(f"Error: {e}")

    def _traer_app_impresion_al_frente(self):
        """Muestra la ventana de 'VEREX – Impresión' (la app que escucha en el puerto 7891). True si respondió."""
        try:
            import urllib.request
            urllib.request.urlopen("http://127.0.0.1:7891/abrir", timeout=3).read()
            return True
        except Exception:
            return False

    def _abrir_guias_en_app_impresion(self):
        """Abre la app 'VEREX – Impresión' directo en la pestaña 'Cualquier PDF' usando
        'Abrir Guias VEREX.vbs' (si la app está cerrada, ese archivo la arranca).
        Devuelve True si pudo lanzarlo; si no existe el archivo, se usa la página vieja como antes."""
        vbs = r"C:\Users\erama\Desktop\SISTEMA VEREX OFICIAL MAY2026\impresion\Abrir Guias VEREX.vbs"
        if not os.path.exists(vbs):
            return False
        try:
            subprocess.Popen(['wscript.exe', vbs], creationflags=subprocess.CREATE_NO_WINDOW)
            return True
        except Exception:
            return False

    def _asegurar_impresion_activa(self):
        """Arranca la app 'Impresión VEREX' (puerto 7891) si todavía no está
        corriendo — se llama solo al abrir 'Imprimir PDF (Guías)', no cada
        vez que se abre el Hub, para no consumir recursos de más cuando el
        Hub se usa para otra cosa."""
        try:
            import socket
            s = socket.socket()
            s.settimeout(0.3)
            ya_activa = s.connect_ex(('127.0.0.1', 7891)) == 0
            s.close()
        except Exception:
            ya_activa = False
        if ya_activa:
            return
        impresion_vbs = r"C:\Users\erama\Desktop\SISTEMA VEREX OFICIAL MAY2026\impresion\iniciar.vbs"
        if os.path.exists(impresion_vbs):
            try:
                subprocess.Popen(
                    ['wscript.exe', impresion_vbs],
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
                import time
                time.sleep(2)  # dar tiempo a que levante el servidor antes de abrir la pagina
            except Exception:
                pass

    def _liberar_puerto(self, puerto):
        """Mata cualquier proceso que esté usando el puerto dado."""
        try:
            import socket
            s = socket.socket()
            s.settimeout(0.3)
            en_uso = s.connect_ex(('127.0.0.1', puerto)) == 0
            s.close()
            if not en_uso:
                return  # puerto libre, nada que hacer
        except Exception:
            return

        # Buscar y matar PID usando netstat
        try:
            out = subprocess.check_output(
                ['netstat', '-ano'],
                creationflags=subprocess.CREATE_NO_WINDOW
            ).decode(errors='ignore')
            for line in out.splitlines():
                if f':{puerto}' in line and 'LISTEN' in line:
                    pid = line.strip().split()[-1]
                    try:
                        subprocess.run(['taskkill', '/PID', pid, '/F'],
                                       creationflags=subprocess.CREATE_NO_WINDOW,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except Exception:
                        pass
        except Exception:
            pass

    def _iniciar_print_server(self):
        """
        Libera puertos 5000 y 5002, luego lanza los servidores frescos.
        """
        import time
        here = os.path.dirname(os.path.abspath(__file__))

        # ── Liberar puertos antes de iniciar ───────────────────────────────
        self._liberar_puerto(5000)
        self._liberar_puerto(5002)
        time.sleep(0.8)  # dar tiempo a que los sockets se liberen

        # ── Servidor HTTP simple para imprimir.html (puerto 5002) ──────────
        try:
            p = subprocess.Popen(
                [sys.executable, '-m', 'http.server', '5002',
                 '--bind', '127.0.0.1', '--directory', here],
                creationflags=subprocess.CREATE_NO_WINDOW,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            self._procesos_hijos.append(p)
        except Exception:
            pass

        # ── Flask print server (puerto 5000) ────────────────────────────────
        server_py = os.path.join(here, "verex_print_server.py")
        if os.path.exists(server_py):
            try:
                p = subprocess.Popen(
                    [sys.executable, server_py],
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                self._procesos_hijos.append(p)
            except Exception:
                pass


    def _on_close(self):
        """Cierra todos los procesos hijos antes de salir."""
        for p in self._procesos_hijos:
            try:
                p.terminate()
                p.wait(timeout=2)
            except Exception:
                try: p.kill()
                except Exception: pass
        # Por si quedó algo, liberar puertos
        try:
            self._liberar_puerto(5000)
            self._liberar_puerto(5002)
        except Exception:
            pass
        self.destroy()


if __name__ == "__main__":
    app = VerexHub()
    app.mainloop()
