"""
verex_print.py - Impresión directa Brother QL via TCP usando brother_ql
Uso: python verex_print.py --png <path> --ip <ip> --label <label> --target-w W --target-h H
"""
import sys, argparse, socket
from PIL import Image, ImageOps, ImageEnhance
if not hasattr(Image, 'ANTIALIAS'):
    Image.ANTIALIAS = Image.LANCZOS

from brother_ql.labels import ALL_LABELS
from brother_ql.raster import BrotherQLRaster
from brother_ql.conversion import convert

# Ancho imprimible en dots por label_id (ej: '62red'->696, '29x90'->306)
LABEL_WIDTH_DOTS = {l.identifier: l.dots_printable[0] for l in ALL_LABELS}

def crop_to_content(img):
    """Recorta el espacio blanco alrededor del contenido (igual que el sistema original)."""
    gray = img.convert('L').point(lambda x: 0 if x > 240 else 255, '1')
    bbox = gray.getbbox()
    if bbox:
        pad = 4
        x0 = max(0, bbox[0] - pad)
        y0 = max(0, bbox[1] - pad)
        x1 = min(img.width,  bbox[2] + pad)
        y1 = min(img.height, bbox[3] + pad)
        img = img.crop((x0, y0, x1, y1))
    return img

def print_label(png_path, ip, label_id, target_w, target_h, rotate=0):
    roll_w = LABEL_WIDTH_DOTS.get(label_id, 696)

    img = Image.open(png_path).convert('RGB')

    if rotate:
        img = img.rotate(-rotate, expand=True)  # negativo = sentido horario

    # Recortar espacio blanco antes de redimensionar
    img = crop_to_content(img)

    if target_h > 0:
        # Formato fijo: redimensionar al tamaño exacto
        img = img.resize((target_w, target_h), Image.LANCZOS)
    else:
        # Formato continuo (recibo): solo ajustar ancho, mantener altura proporcional
        if img.width != target_w:
            ratio = target_w / img.width
            img = img.resize((target_w, max(1, int(img.height * ratio))), Image.LANCZOS)

    # Centrar en el canvas del rollo (ancho varía según label_id)
    if target_w < roll_w:
        canvas = Image.new('RGB', (roll_w, img.height), (255, 255, 255))
        x_off = (roll_w - target_w) // 2
        canvas.paste(img, (x_off, 0))
        img = canvas

    qlr = BrotherQLRaster('QL-810W')
    convert(
        qlr=qlr,
        images=[img],
        label=label_id,
        rotate='0',
        threshold=70,
        dither=True,
        compress=False,
        red=('red' in label_id),
        hq=True,
        cut=True
    )
    import time
    for intento in range(2):   # un retry si falla (ej: la QL despertando del sleep)
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(25)
            sock.connect((ip, 9100))
            sock.sendall(qlr.data)
            sock.close()
            print(f'OK bytes={len(qlr.data)}')
            return
        except OSError as e:
            if intento == 0:
                time.sleep(3)   # esperar que la QL salga del sleep y reintentar
                continue
            raise

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--png',      required=True)
    p.add_argument('--ip',       required=True)
    p.add_argument('--label',    required=True)
    p.add_argument('--target-w', type=int, required=True)
    p.add_argument('--target-h', type=int, required=True)
    p.add_argument('--rotate',   type=int, default=0)
    args = p.parse_args()
    try:
        print_label(args.png, args.ip, args.label, args.target_w, args.target_h, args.rotate)
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
