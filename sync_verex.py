import os
import shutil
import subprocess
import tkinter as tk
from tkinter import messagebox
from datetime import datetime

# ── RUTAS ────────────────────────────────────────────────────────────
BASE        = r"C:\Users\erama\Desktop\SISTEMA VEREX OFICIAL MAY2026"
CONSIG_SRC  = r"C:\Users\erama\Desktop\verex-consignacion\index.html"

ARCHIVOS = [
    {
        "nombre": "Consignación",
        "fuente": CONSIG_SRC,
        "destinos": [
            os.path.join(BASE, "consignacion", "index (4).html"),
            os.path.join(BASE, "_consig-repo", "index.html"),
        ]
    },
    {
        "nombre": "Admin VEREX",
        "fuente": os.path.join(BASE, "adminverex", "index (2).html"),
        "destinos": [
            os.path.join(BASE, "_admin-repo", "index.html"),
        ]
    },
    {
        "nombre": "Inventario Sellers",
        "fuente": os.path.join(BASE, "inventario-sellers", "index (5).html"),
        "destinos": [
            os.path.join(BASE, "_inventario-repo", "index.html"),
        ]
    },
    {
        "nombre": "Worker API",
        "fuente": os.path.join(BASE, "consignacion", "worker-firebase.js"),
        "destinos": [
            os.path.join(BASE, "_consig-repo", "worker-firebase.js"),
        ]
    },
]

REPOS = [
    {"path": BASE,                                   "branch": "master"},
    {"path": os.path.join(BASE, "_admin-repo"),      "branch": "main"},
    {"path": os.path.join(BASE, "_consig-repo"),     "branch": "main"},
    {"path": os.path.join(BASE, "_inventario-repo"), "branch": "main"},
]

def git(repo_path, *args):
    result = subprocess.run(
        ["git"] + list(args),
        cwd=repo_path, capture_output=True, text=True
    )
    return result.stdout.strip(), result.returncode

def sincronizar():
    log = []
    errores = []

    # 1. Copiar archivos fuente a destinos
    log.append("📋 Copiando archivos...\n")
    for item in ARCHIVOS:
        fuente = item["fuente"]
        if not os.path.exists(fuente):
            errores.append(f"⚠️ No encontrado: {fuente}")
            continue
        for dest in item["destinos"]:
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(fuente, dest)
                log.append(f"  ✅ {item['nombre']} → {os.path.basename(dest)}")
            except Exception as e:
                errores.append(f"  ❌ Error copiando {item['nombre']}: {e}")

    # 2. Commit y push en cada repo
    fecha = datetime.now().strftime("%d/%m/%Y %H:%M")
    mensaje = f"sync: sincronización automática {fecha}"

    log.append("\n📦 Commiteando repos...\n")
    for repo in REPOS:
        path = repo["path"]
        branch = repo["branch"]
        nombre = os.path.basename(path)

        out, code = git(path, "add", "-A")
        out, code = git(path, "status", "--porcelain")
        if not out.strip():
            log.append(f"  ⏭️  {nombre} — sin cambios")
            continue

        git(path, "commit", "-m", mensaje)
        out, code = git(path, "push", "origin", branch)
        if code == 0:
            log.append(f"  ✅ {nombre} → pushed")
        else:
            errores.append(f"  ❌ {nombre} — error en push")

    # 3. Mostrar resultado
    resumen = "\n".join(log)
    if errores:
        resumen += "\n\n⚠️ ERRORES:\n" + "\n".join(errores)
        messagebox.showwarning("VEREX Sync — Con advertencias", resumen)
    else:
        resumen += "\n\n🎉 Todo sincronizado correctamente."
        messagebox.showinfo("VEREX Sync — Completado", resumen)

if __name__ == "__main__":
    root = tk.Tk()
    root.withdraw()
    if messagebox.askyesno("VEREX Sync", "¿Sincronizar y hacer push de todos los repos VEREX?"):
        sincronizar()
