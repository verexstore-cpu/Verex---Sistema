"""
Abre el diálogo de Preferencias del driver Brother QL para que el usuario
seleccione el rollo correcto y guarda el DEVMODE resultante en
devmode_<tag>.bin para que verex_print_server lo use al imprimir.

Uso:
    pythonw capturar_rollo.py rojo    → rollo 62mm negro/rojo
    pythonw capturar_rollo.py mono    → rollo 62mm monocromo
    pythonw capturar_rollo.py mini    → rollo 29mm × 90mm die-cut
"""
import ctypes
import os
import sys
import tkinter as tk
from tkinter import messagebox

_WINSPOOL = ctypes.WinDLL('winspool.drv')
DM_OUT_BUFFER = 2
DM_IN_PROMPT  = 4

HERE = os.path.dirname(os.path.abspath(__file__))


def buscar_impresora():
    try:
        import win32print
    except ImportError:
        return None
    printers = win32print.EnumPrinters(
        win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS,
        None, 2
    )
    for p in printers:
        nombre = p['pPrinterName']
        if 'QL' in nombre or 'Brother' in nombre:
            return nombre
    return None


def capturar(tag, hwnd=0):
    nombre = buscar_impresora()
    if not nombre:
        return False, "No se encontró impresora Brother QL"

    size = _WINSPOOL.DocumentPropertiesW(0, None, nombre, None, None, 0)
    if size <= 0:
        return False, f"DocumentPropertiesW devolvió tamaño {size}"

    buf = ctypes.create_string_buffer(size)
    flags = DM_IN_PROMPT | DM_OUT_BUFFER
    ret = _WINSPOOL.DocumentPropertiesW(hwnd, None, nombre, buf, None, flags)

    if ret < 0:
        return False, "El diálogo de Windows falló"
    if ret == 0:
        return False, "Cancelaste el diálogo"

    ruta = os.path.join(HERE, f'devmode_{tag}.bin')
    with open(ruta, 'wb') as f:
        f.write(buf.raw)
    return True, f"Guardado: devmode_{tag}.bin ({len(buf.raw)} bytes)\nImpresora: {nombre}"


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else 'rojo'
    if tag not in ('mono', 'rojo', 'mini'):
        print(f"Tag inválido: {tag}. Usa: mono | rojo | mini")
        sys.exit(1)

    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    instrucciones = {
        'rojo':  'Selecciona el tipo de papel:\n→ "62mm × cinta continua (negro/rojo)"\nLuego dale ACEPTAR.',
        'mono':  'Selecciona el tipo de papel:\n→ "62mm × cinta continua"\nLuego dale ACEPTAR.',
        'mini':  'Selecciona el tipo de papel:\n→ "29mm × 90mm"\nLuego dale ACEPTAR.',
    }
    messagebox.showinfo(
        f"Capturar rollo '{tag}'",
        f"Se abrirá la ventana de Preferencias de Brother QL.\n\n"
        f"{instrucciones[tag]}"
    )

    ok, msg = capturar(tag, hwnd=root.winfo_id())
    if ok:
        messagebox.showinfo("Listo", msg + "\n\nReinicia el VEREX Hub para aplicar.")
    else:
        messagebox.showerror("Error", msg)
    root.destroy()
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
