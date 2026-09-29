# VEREX · Mejora de fotos

App de escritorio para mejorar la nitidez de fotos de producto en lote,
antes de publicarlas en el catálogo — pensada como alternativa local y
gratuita a Topaz Photo AI.

## Cómo funciona

Usa [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (`realesrgan-ncnn-vulkan`),
un modelo de IA open-source entrenado para denoise + realce de detalle —
no es Topaz (esos modelos son propietarios), pero es el mismo tipo de
enfoque (una red entrenada, no un filtro simple tipo "sharpen"), y da
resultados bastante más naturales que el sharpen crudo de ImageKit.

El primer uso descarga el motor (~70-90MB) directo de los releases
oficiales de GitHub y lo cachea localmente — después de eso no vuelve a
descargar nada, y no vuelve a necesitar internet para procesar fotos.

Para evitar el look "sobre-procesado": la app corre la IA a máxima
fuerza y después **mezcla el resultado con la foto original** según el
slider de intensidad (0% = foto original intacta, 100% = efecto completo
de la IA). Bajá la intensidad hasta que se vea natural en la vista previa.

## Requisitos

- Windows con GPU compatible con Vulkan (la mayoría de tarjetas de los
  últimos ~10 años, incluidas integradas Intel/AMD). Si no hay GPU
  compatible, tildá "Forzar CPU" — funciona igual pero más lento.
- [Node.js](https://nodejs.org) instalado (para correr `npm install` la
  primera vez).

## Instalación y uso

```
npm install
npm start
```

Dentro de la app:

1. **Instalar motor** (una sola vez, se descarga automático).
2. **Elegir carpeta** con las fotos a mejorar.
3. Ajustar **intensidad** y **modo** (mismo tamaño vs ampliar 4x).
4. **Probar con 3 fotos** — revisá el antes/después antes de comprometerte.
5. Si te gusta el resultado, **Procesar todas las fotos** — quedan en una
   subcarpeta `mejoradas/` dentro de la carpeta original, listas para
   subir por "Editar producto" en Stock.

## ⚠️ Estado de esta build

Construida y verificada en un sandbox Linux sin GPU ni Windows: se
probó la sintaxis de todo el código y **se validó con pruebas reales**
la lógica de mezcla de intensidad (`engine.js` → `mezclarConOriginal`,
con imágenes sintéticas — a intensidad 0% el resultado coincide con el
original, a 100% con la salida de la IA, y los valores intermedios
escalan de forma lineal entre ambos).

Lo que **no se pudo verificar** en este entorno, por no tener Windows ni
GPU disponibles:
- Que la descarga del motor desde GitHub funcione end-to-end tal cual
  está escrita (se validó la lógica, no la descarga real).
- Que `realesrgan-ncnn-vulkan.exe` corra correctamente en tu PC (depende
  de tu driver de GPU/Vulkan).
- La experiencia completa de la interfaz dentro de Electron en Windows.

Por eso: probá primero con el paso 4 (3 fotos) antes de correr el lote
completo, y contame qué ves — así corregimos cualquier detalle con
casos reales en vez de seguir adivinando.
