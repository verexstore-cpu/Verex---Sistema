# VEREX PHOTO OPTIMIZER

Aplicación de escritorio (Windows) para optimizar fotografías de joyería para web y ecommerce.

> **MEJORAR LA FOTO, NO CREAR OTRA FOTO.**
> Todo el procesamiento es edición controlada de los píxeles existentes. No hay IA generativa, ni
> superresolución, ni reconstrucción: si la joya no está en la foto original, no aparece en el resultado.

100 % local · funciona sin internet · ninguna foto sale del equipo · los originales nunca se modifican.

---

## Arquitectura elegida y por qué

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| **Electron + JavaScript vanilla** | Tauri/Rust, .NET/WPF, Python+Qt | Mismo stack que el resto del sistema VEREX (HTML/JS sin frameworks); `.exe` con instalador NSIS estándar; sin runtime que instalar. |
| **Motor propio en JS puro, sin dependencias nativas** | `sharp`/libvips, OpenCV, modelos ONNX | Cero binarios nativos que compilar o que fallen en el PC del usuario; comportamiento 100 % predecible y auditable. |
| **Un solo pipeline determinista** compartido por vista previa, lote y pruebas | Un camino para preview y otro para exportar | Lo que ves en el visor es exactamente lo que se exporta. Mismos parámetros → mismos píxeles (verificado en las pruebas). |
| **Web Workers** (1 para la vista previa, N para el lote) | Procesar en el hilo de la interfaz | La interfaz no se congela; el lote usa varios núcleos. |
| **Detección clásica del producto** (color de fondo, umbral de Otsu, morfología) | Modelos de segmentación (U²-Net, SAM) | Cumple el requisito de IA: la detección solo decide **dónde** aplicar cada ajuste; nunca produce píxeles. Sin descargas de modelos. |
| **Proceso principal mínimo** (`main.js`) con IPC restringido | `nodeIntegration` | La página no tiene acceso a Node (`contextIsolation`, `sandbox`, CSP estricta). Solo puede leer las fotos y escribir resultados vía 4 llamadas IPC. |

### Cómo se garantiza la fidelidad al producto

1. **Sin operaciones geométricas ni generativas.** El único remuestreo es el redimensionado a la salida (reducción por pasos, calidad alta) y ocurre *antes* de cualquier ajuste. El pipeline solo hace aritmética por píxel y filtros locales.
2. **Ajustes de tono sobre la luma**, reaplicados como ganancia al RGB → el matiz no cambia. Rodilla suave: nunca se queman los canales metálicos.
3. **Nitidez con limitador de halos:** el resultado se restringe al mínimo/máximo local de la propia foto (± unos niveles según la fidelidad). Físicamente no puede crear un anillo claro/oscuro alrededor de un borde. *Coring* para no realzar ruido; protección de luces > 235.
4. **Reducción de ruido bilateral** guiada por luma (preserva bordes), con tope de fuerza y filtrado de croma más fuerte que el de luminancia: DETALLE > SUAVIDAD.
5. **JOYERÍA VEREX:** compara cada píxel con el original en croma normalizado por luminancia y **limita la deriva de matiz y de saturación** (más estricto en oro laminado para que no se vuelva amarillo/naranja; en plata evita que se desature hacia blanco/gris plástico). Metal automático / plata 925 / oro laminado / acero 316L.
6. **FIDELIDAD DEL PRODUCTO (95 % por defecto)** escala la fuerza de todos los ajustes y estrecha el margen del limitador de halos. **INTENSIDAD (70)** es el multiplicador global.
7. **Fondo:** solo actúa donde la máscara dice «fondo» **y** el píxel coincide con el modelo de iluminación del fondo. Uniformiza, aplana manchas y llega a `#FFFFFF`; no añade sombras. Los píxeles con desviación de color, junto a bordes fuertes o dentro de reflejos claros del metal quedan protegidos.
8. **Control de calidad antes de exportar** (ver abajo) con métrica de *integridad estructural* (correlación de bordes original ↔ resultado).

---

## Funciones

- Arrastrar y soltar JPG/JPEG/PNG/WEBP, una foto o carpetas enteras; vista previa inmediata.
- **Nitidez**, **Reducción de ruido**, **Contraste** (0–100); **Exposición, Altas luces, Sombras, Blancos, Negros**; **Temperatura, Tinte, Saturación, Vibrancia**.
- **Fidelidad del producto** (95) e **Intensidad de optimización** (70), con la advertencia «Valores elevados pueden producir una apariencia poco natural.» (intensidad o nitidez > 85).
- **Comparación ANTES | DESPUÉS** con divisor vertical u horizontal, botón **ANTES / DESPUÉS** (alterna) y tecla `\` (mantener para ver el original).
- **Zoom** 25 / 50 / 100 / 200 % y Ajustar; `Ctrl + rueda` para zoom libre; arrastrar para desplazarse. A ≥ 150 % se ven los píxeles reales.
- **Presets:** NATURAL, PROFESSIONAL, ECOMMERCE (1600×1600 · WEBP 88 · sRGB · #FFFFFF), PRODUCT CARD (800×800 · WEBP 82), SILVER, GOLD, STEEL. Editables: *Guardar cambios en el preset* / *Restablecer preset*.
- **Historial:** Deshacer (`Ctrl+Z`), Rehacer (`Ctrl+Y`), **Restaurar original** (quita todos los ajustes; también se puede deshacer).
- **Exportación:** JPG, PNG y WEBP (uno o varios a la vez) · *Crear copia* (sufijo `_verex`, nunca pisa archivos: numera `(2)`) · *Seleccionar carpeta* · *Sobrescribir* (antes guarda el original en `_originales_verex/`).
- **Lote:** 10, 50, 100 o más fotos con exactamente la misma configuración; muestra nº de imágenes, progreso, imagen actual, tiempo restante, completadas, errores y avisos; cancelable. Ejemplo de salida: `producto01.jpg`, `producto01.webp`, `producto02.jpg`, `producto02.webp`.
- **Control de calidad** automático (panel + aviso al exportar): pérdida de detalle, halos de nitidez, clipping de luces, exceso de saturación, alteración de color, exceso de reducción de ruido e integridad estructural.
- Ajustes persistentes (última configuración, presets propios, resolución de vista previa, procesos en lote).

Atajos: `Ctrl+O` abrir · `Ctrl+E` exportar · `Ctrl+Z/Y` historial · `Ctrl+0` ajustar · `Ctrl+1` 100 % · `↑/↓` foto anterior/siguiente · `\` ver original.

---

## Estructura del proyecto

```
verex-photo-optimizer/
├─ main.js                  Proceso principal: ventana, IPC, lectura/escritura segura, ajustes
├─ preload.js               Puente aislado (contextBridge) hacia el proceso principal
├─ src/
│  ├─ index.html · styles.css · app.js    Interfaz (visor, controles, lote, historial)
│  ├─ worker.js                            Web Worker que ejecuta el pipeline
│  └─ core/
│     ├─ pipeline.js        Motor de imagen (denoise, tono, color, contraste, fondo, metal, nitidez, QC)
│     └─ presets.js         Parámetros por defecto y presets
├─ test/
│  ├─ pipeline.test.js      Pruebas del motor (fidelidad, halos, color, fondo, rendimiento)
│  ├─ ui.test.js            Interfaz completa en Chromium
│  ├─ electron.test.js      App Electron real: IPC, disco, copias, sobrescritura con respaldo
│  └─ synthetic.js · make-png.js   Fotos sintéticas de joyería para las pruebas
├─ build/icon.ico · icon.png       Icono
├─ scripts/make-icon.js
├─ Abrir VEREX Photo Optimizer.bat     Ejecutar en Windows sin instalar
└─ Crear instalador.bat                Genera el instalador .exe
```

---

## Uso en Windows

**Opción A — instalador (recomendado):** ejecuta `VEREX-PHOTO-OPTIMIZER-Setup-1.0.0.exe`. Instala con acceso directo en escritorio y menú inicio; no necesita internet.

**Opción B — sin instalar:** con [Node.js LTS](https://nodejs.org) instalado, doble clic en `Abrir VEREX Photo Optimizer.bat` (la primera vez descarga Electron).

### Crear el instalador `.exe`

- **En tu PC:** doble clic en `Crear instalador.bat` → el `.exe` queda en `dist/`.
- **Desde GitHub:** *Actions → «VEREX PHOTO OPTIMIZER — instalador de Windows» → Run workflow*; el `.exe` se descarga como artefacto.
- Manualmente: `npm install && npm run dist`.

El instalador no está firmado digitalmente: Windows SmartScreen mostrará «Editor desconocido» la primera vez (*Más información → Ejecutar de todas formas*). Para evitarlo hace falta un certificado de firma de código.

### Desarrollo y pruebas

```
npm install
npm start                # ejecutar
npm test                 # pruebas del motor (rápidas, sin dependencias)
```

---

## Límites conocidos (por honestidad)

- **Metal casi idéntico al color del fondo.** Con «Optimizar fondo», píxeles de producto prácticamente iguales al fondo y sin un borde marcado alrededor (p. ej. el borde de una faceta muy clara sobre fondo casi blanco) no se pueden distinguir del fondo por color; en las pruebas sintéticas ≈ 0,4 % de los píxeles del producto cambian al usar fondo blanco. Revisa con el divisor y el zoom. Sin «Optimizar fondo» el producto no se toca con la máscara.
- **Fondos complejos** (texturas, telas, degradados fuertes, sombras duras) no son el caso de uso del módulo de fondo, que está pensado para fondos lisos de estudio. Las sombras de contacto suaves cuentan como producto y se conservan.
- **Huecos grandes** (interior de anillos, eslabones) se tratan como fondo; un reflejo blanco muy grande (> 3 % de la foto) dentro del metal podría tratarse como fondo si coincide exactamente con él.
- **Vista previa:** por rendimiento se calcula a un máximo de 2400 px (configurable, hasta resolución completa). La exportación siempre usa la resolución final completa; el visor avisa cuando la vista previa está reducida.
- **Color:** se trabaja y exporta en sRGB. Los perfiles ICC incrustados se convierten a sRGB al abrir; no se incrusta perfil en la salida (sRGB implícito). La transparencia (PNG) se aplana sobre blanco.
- **Velocidad:** el motor es JavaScript puro (sin GPU): ≈ 1–5 s por foto de 1600 px según ajustes, en varios núcleos en lote.
- El instalador `.exe` **no se ha probado en Windows real** en el desarrollo (ver «Verificación»).

---

## Verificación realizada

| Qué | Resultado |
|---|---|
| `test/pipeline.test.js` — motor sobre joyas sintéticas (plata y oro, ruido, motas, gradiente) | **21/21**: neutral = idéntico byte a byte; determinista; no muta la entrada; detección del producto; con «solo fondo» ≥ 99,4 % de los píxeles del producto idénticos; fondo `#FFFFFF`; los 7 presets con integridad estructural > 97 %, 0 halos, 0 clipping, ΔC < 1; oro/plata bajo ajustes extremos; advertencias con valores extremos; rendimiento |
| `test/ui.test.js` — interfaz en Chromium | **28/28**: presets, comparación (arrastre, vertical/horizontal), zoom, historial, restaurar original (DESPUÉS = ANTES píxel a píxel), advertencia de intensidad, lote de 3 fotos × 2 formatos con JPG/WEBP válidos |
| `test/electron.test.js` — Electron real bajo Xvfb | **16/16**: aislamiento de contexto, worker bajo `file://`, expansión de carpetas, exportar a carpeta / copia numerada / sobrescribir con respaldo idéntico, originales intactos por hash |
| Empaquetado `electron-builder` (Linux) | Genera `win-unpacked`; el NSIS `.exe` requiere Windows o Wine → se construye con el `.bat` o la GitHub Action |

**Aún no verificado:** apariencia con fotografías reales de joyería del catálogo VEREX (las pruebas usan imágenes sintéticas) y ejecución del instalador en Windows. Recomendación: probar primero con 5–10 fotos reales, comparar con el divisor a 100–200 % y ajustar los presets con *Guardar cambios en el preset*.
