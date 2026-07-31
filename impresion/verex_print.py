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

def _preparar(img, roll_w, target_w, target_h, rotate, crop):
    """Rota, recorta y redimensiona UNA pagina al tamano de la etiqueta."""
    if rotate:
        img = img.rotate(-rotate, expand=True)  # negativo = sentido horario

    # Recortar espacio blanco antes de redimensionar.
    # OJO: esto DESTRUYE cualquier maquetación con posiciones intencionales —
    # recorta los márgenes y después el resize estira lo que quede hasta llenar
    # la etiqueta. Sirve para formatos de una sola etiqueta por página, pero
    # arruina los que colocan varias etiquetas en posiciones fijas (ver
    # --no-crop, que usa el formato de 2 mini por troquelada DK-1204).
    if crop:
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

    return img


def print_label(png_path, ip, label_id, target_w, target_h, rotate=0, crop=True,
                dither=True, threshold=70, pages=1):
    roll_w = LABEL_WIDTH_DOTS.get(label_id, 696)

    original = Image.open(png_path).convert('RGB')

    # El PNG que manda main.js trae TODAS las paginas apiladas una debajo de
    # otra (asi las dibuja pdfjs en un solo canvas). Para rollo continuo eso
    # esta bien: sale una tira larga. Pero en papel TROQUELADO cada pagina es
    # una etiqueta fisica distinta, y mandarlas juntas las aplastaba a todas
    # dentro de una sola. Por eso se parte la imagen en 'pages' bandas y se le
    # pasan como lista a convert(), que arma un trabajo de varias etiquetas.
    if pages > 1:
        alto = original.height // pages
        paginas = [original.crop((0, i * alto, original.width,
                                  (i + 1) * alto if i < pages - 1 else original.height))
                   for i in range(pages)]
    else:
        paginas = [original]

    imgs = [_preparar(p, roll_w, target_w, target_h, rotate, crop) for p in paginas]

    # dither=True (Floyd-Steinberg) esta pensado para FOTOS. Con texto y codigos
    # QR convierte los bordes suavizados en puntos salteados: el texto sale gris
    # y deshilachado, y los modulos del QR quedan sucios (peor lectura). Para
    # etiquetas conviene umbral: --no-dither con --threshold mas bajo, que en
    # brother_ql significa corte mas alto = mas pixeles en negro = mas marcado.
    qlr = BrotherQLRaster('QL-810W')
    convert(
        qlr=qlr,
        images=imgs,
        label=label_id,
        rotate='0',
        threshold=threshold,
        dither=dither,
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
            print(f'OK bytes={len(qlr.data)} etiquetas={len(imgs)}')
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
    p.add_argument('--no-crop',  action='store_true',
                   help='No recortar el espacio en blanco: conserva las posiciones '
                        'del PDF tal cual (necesario cuando la pagina lleva varias '
                        'etiquetas maquetadas en sitios fijos)')
    p.add_argument('--no-dither', action='store_true',
                   help='Usar umbral en vez de Floyd-Steinberg: texto y QR salen '
                        'solidos en vez de punteados')
    p.add_argument('--threshold', type=int, default=70,
                   help='Umbral de brother_ql (0-100). MAS BAJO = MAS NEGRO. '
                        'Solo aplica con --no-dither')
    p.add_argument('--pages', type=int, default=1,
                   help='Cuantas paginas vienen apiladas en el PNG. Necesario en '
                        'papel TROQUELADO: se parte la imagen y se manda una '
                        'etiqueta por pagina, en vez de aplastarlas en una sola')
    args = p.parse_args()
    try:
        print_label(args.png, args.ip, args.label, args.target_w, args.target_h,
                    args.rotate, crop=not args.no_crop,
                    dither=not args.no_dither, threshold=args.threshold,
                    pages=max(1, args.pages))
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
