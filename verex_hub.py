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
            for btn in seccion["botones"]:
                texto = f"{btn['emoji']}  {btn['texto']}"
                self._boton(texto, btn["archivo"], btn.get("url", ""), "#1a1a2e", seccion["color"])

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

    def _boton(self, texto, nombre_archivo, url, bg, accent):
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
        btn.pack(pady=4, padx=4, fill="x")

    def _abrir(self, nombre_base, url=""):
        # "Imprimir PDF (Guías)" necesita que la app de impresión esté
        # corriendo (puerto 7891) para poder mandar cualquier trabajo — en
        # vez de abrirla siempre con el Hub (aunque no se vaya a imprimir
        # nada esa sesión), se arranca sola justo aquí, un instante antes de
        # abrir la página, solo si todavía no está activa.
        if nombre_base == "imprimir":
            self._asegurar_impresion_activa()
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
