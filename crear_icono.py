from PIL import Image, ImageDraw

def generar_icono():
    tamaño = 256
    # Fondo degradado plateado oscuro
    imagen = Image.new("RGBA", (tamaño, tamaño), "#1a1a1a")
    dibujo = ImageDraw.Draw(imagen)

    # Borde circular plateado
    dibujo.ellipse([(6, 6), (250, 250)], outline="#A8A9AD", width=8)

    # V dorada — brazo izquierdo
    dibujo.line([(58, 55), (128, 185)], fill="#C9A84C", width=32)
    # V dorada — brazo derecho
    dibujo.line([(198, 55), (128, 185)], fill="#C9A84C", width=32)
    # Redondear punta inferior
    dibujo.ellipse([(110, 168), (146, 204)], fill="#C9A84C")

    # Brillo plateado en los extremos superiores de la V
    dibujo.ellipse([(42, 42), (76, 72)], fill="#D4D4D4")
    dibujo.ellipse([(182, 42), (216, 72)], fill="#D4D4D4")

    imagen.save("verex_icon.ico", format="ICO", sizes=[(256, 256), (64, 64), (32, 32), (16, 16)])
    print("Icono plateado/dorado creado.")

if __name__ == "__main__":
    generar_icono()
