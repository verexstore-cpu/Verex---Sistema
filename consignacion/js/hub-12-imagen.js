// Hub VEREX — Carga y procesamiento de imagen, mejorar foto (ImageKit), imágenes informativas
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── CARGA DE IMAGEN ─────────────────────────────────
let _fotoOriginalBase64 = "";
let _fotoOriginalFile = null;
let _fotoCropCoords = null;
async function cargarFoto(input) {
    const file = input.files[0]; if (!file) return;
    _fotoOriginalFile = file;
    const r = await procesarFotoJoya(file);
    _fotoOriginalBase64 = r.original;
    _fotoCropCoords = r.crop;
    fotoBase64 = r.preview;
    document.getElementById("preview-foto").src = fotoBase64;
    document.getElementById("preview-foto").style.display = "block";
    document.getElementById("foto-placeholder").style.display = "none";
    document.getElementById("btn-ia").style.display = "flex";
    document.getElementById("material-single-container").style.display = "block";
}

async function analizarConIA() {
    if (!fotoBase64) return;
    const btn    = document.getElementById("btn-ia");
    const estado = document.getElementById("estado-ia");
    btn.textContent = "⏳ Analizando...";
    btn.disabled    = true;
    estado.style.display = "block";
    estado.textContent   = "Analizando imagen con IA...";
    try {
        const materialSeleccionado = window._materialProducto || null;
        const imagenIA = await comprimirParaIA(fotoBase64);
        const res  = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ accion: "ANALIZAR_IMAGEN", _pass: _sessionPass, imagen: imagenIA, material: materialSeleccionado })
        });
        const data = await res.json();
        if (!data.ok) {
            console.error("Error IA:", data.error);
            estado.textContent = String(data.error).includes("429")
                ? "⚠️ Sin créditos en OpenAI. Recarga tu cuenta."
                : "⚠️ Error: " + (data.error || "No se pudo analizar");
            estado.style.color = "#e74c3c";
            btn.textContent = "✨ Analizar con IA";
            btn.disabled    = false;
            return;
        }
        // Título — cada palabra con su primera letra en mayúscula (ej. "Anillo
        // Turquesa Chic"), no solo la primera letra del nombre completo.
        const _cap = s => s ? s.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";
        document.getElementById("np-nombre").value = _cap(data.resultado.nombre || "");
        document.getElementById("np-desc").value   = data.resultado.descripcion || "";
        // Auto-seleccionar categoría detectada por IA
        if (data.resultado.categoria) {
            const sel = document.getElementById("np-categoria");
            if (sel) {
                sel.value = data.resultado.categoria;
                mostrarSelectorTalla(data.resultado.categoria);
            }
        }
        estado.textContent = "✨ IA generó la descripción y detectó la categoría";
        estado.style.color = "var(--dorado)";
    } catch(e) {
        console.error(e);
        estado.textContent = "⚠️ No se pudo analizar la imagen";
        estado.style.color = "#e74c3c";
    }
    btn.textContent = "✨ Analizar con IA";
    btn.disabled    = false;
}

// Si el código manual ya termina en T+número (ej: SA18509JT7), lo usa tal cual
// sin agregar la talla de nuevo. Devuelve el código final.
function aplicarTalla(codigoBase, talla) {
    if (!talla) return codigoBase;
    // Detectar si ya tiene talla: termina en T seguido de uno o dos dígitos (con punto opcional: T7, T8, T7.5)
    if (/T\d+(\.\d+)?$/i.test(codigoBase)) return codigoBase;
    return `${codigoBase}T${talla}`;
}

// Y el nombre con talla, igual de inteligente
function aplicarTallaNombre(nombreBase, talla) {
    if (!talla) return nombreBase;
    if (/T\d+(\.\d+)?$/i.test(nombreBase)) return nombreBase;
    return `${nombreBase} T${talla}`;
}

// Códigos de productos ELIMINADOS (inactivos): siguen ocupados en el servidor, así que no se pueden volver a generar.
let _codigosInactivosStock = [];
function guardarCodigosInactivos(res) { if (res && Array.isArray(res.codigosInactivos)) _codigosInactivosStock = res.codigosInactivos; }
function generarCodigo(categoria, material, usadosEnSesion = []) {
    const mat = String(material || _materialLote || "").toLowerCase();
    // Un solo carácter por material para códigos compactos (máx 10 chars total)
    const matChar = mat.includes("laminado")     ? "L"
                  : mat.includes("oro")          ? "O"
                  : mat.includes("acero")        ? "A"
                  : mat.includes("reloj")        ? "W"
                  : mat.includes("plata")        ? "P"
                  : "X";
    // Formato: [CAT2][MAT1][NNN3] = 6 chars base → con talla: ANA001T10 = 9 chars
    const prefijo = categoria + matChar;
    const todosLosCodigos = [
        ...(stockData || []).map(p => String(p.codigo || p.codigoBase || "")),
        ..._codigosInactivosStock,
        ...usadosEnSesion
    ];
    let maxN = 0;
    todosLosCodigos.forEach(cod => {
        const upper = cod.toUpperCase();
        if (upper.startsWith(prefijo.toUpperCase())) {
            const resto = upper.slice(prefijo.length).replace(/T[\d.]+$/i, "");
            const n = parseInt(resto, 10);
            if (!isNaN(n) && n > maxN) maxN = n;
        }
    });
    return prefijo + String(maxN + 1).padStart(3, '0');
}

// Actualiza SOLO stockData en memoria (a diferencia de cargarStock(), que
// además redibuja toda la grilla y el spinner) — sirve para recalcular
// generarCodigo() contra el stock real justo antes de reintentar un guardado.
async function refrescarStockData() {
    try {
        const res = await apiPost({ accion: "STOCK_GET_ALL" });
        if (res && res.stock) stockData = res.stock;
        guardarCodigosInactivos(res);
    } catch (e) { /* si falla, se sigue con lo que ya había en memoria */ }
}

// Guarda un item con código auto-generado sin que una carrera con otro
// dispositivo pueda colarse: generarCodigo() calcula rápido en base al stock
// que YA está cargado en memoria, así que si alguien más registró algo con
// el mismo prefijo justo antes, el número calculado puede estar tomado. El
// servidor SIEMPRE valida contra el stock real al guardar y rechaza el
// duplicado en vez de sobreescribirlo en silencio — acá, en vez de mostrarle
// ese rechazo crudo al usuario, se refresca el stock real y se reintenta con
// el siguiente número libre, hasta 5 veces.
// `construirPayload(base)` arma el body de apiPost para un codigoBase dado.
async function guardarConCodigoUnico(categoria, material, codigoBaseInicial, construirPayload, intentosMax = 5) {
    let codigoBase = codigoBaseInicial;
    const probados = [];
    for (let intento = 1; intento <= intentosMax; intento++) {
        const res = await apiPost(construirPayload(codigoBase));
        // «ya existe» (lo tomó otro) o «existe pero está eliminado» / «ya no se usa» (código de un producto eliminado o
        // reemplazado): en los tres casos se prueba con el siguiente número libre.
        if (res.ok || !/ya existe|existe pero|ya no se usa/i.test(res.error || "")) return { res, codigoBase };
        probados.push(codigoBase);
        await refrescarStockData();
        codigoBase = generarCodigo(categoria, material, probados);
    }
    return { res: { ok: false, error: "No se pudo generar un código único después de varios intentos — probá de nuevo" }, codigoBase };
}

// Recorta una región cuadrada {x,y,side} (coordenadas del original) hacia un
// canvas de salida de "size"×"size", con sharpen 3×3 — reutilizado tanto por
// la detección automática (procesarFotoJoya) como por el ajuste manual de
// encuadre (arrastrar/zoom para reposicionar cuando la detección falla).
function dibujarRecorte(img, crop, canvas, size) {
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
    // Kernel sharpen 3×3 (unsharp mask)
    const src = ctx.getImageData(0, 0, size, size);
    const dst = ctx.createImageData(size, size);
    const s = src.data, d = dst.data;
    const k = [0,-1,0,-1,5,-1,0,-1,0];
    for (let y = 1; y < size-1; y++) {
        for (let x = 1; x < size-1; x++) {
            const i = (y*size+x)*4;
            for (let c = 0; c < 3; c++) {
                let v = 0;
                for (let ky = -1; ky <= 1; ky++)
                    for (let kx = -1; kx <= 1; kx++)
                        v += s[((y+ky)*size+(x+kx))*4+c] * k[(ky+1)*3+(kx+1)];
                d[i+c] = Math.max(0, Math.min(255, v));
            }
            d[i+3] = s[i+3];
        }
    }
    ctx.putImageData(dst, 0, 0);
}

// Convierte un contenedor en un encuadre arrastrable: el usuario mueve la
// foto con el mouse/dedo para recentrar el recorte cuadrado, y usa la rueda
// del mouse para acercar/alejar — sin depender de que la detección
// automática de bordes haya acertado (con joyas delgadas/brillantes como
// cadenas finas, a veces no hay forma de acertar por contraste de brillo).
// getCrop/setCrop leen y escriben el {x,y,side} (coords del original) que
// use el llamador; onRedraw(canvas) se llama después de cada render para que
// el llamador pueda sincronizar su propio preview (ej. para el análisis IA).
function montarEncuadreArrastrable(contenedorId, imgObj, getCrop, setCrop, onRedraw) {
    const cont = document.getElementById(contenedorId);
    if (!cont || !imgObj) return;
    cont.style.position = "relative";
    cont.innerHTML = `
        <canvas style="width:100%;height:100%;display:block;cursor:grab;touch-action:none;"></canvas>
        <div style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:9px;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;">🖐️ Arrastrá para centrar · rueda para zoom</div>
    `;
    const canvas = cont.querySelector("canvas");
    const RENDER_SIZE = 700;
    const render = () => { dibujarRecorte(imgObj, getCrop(), canvas, RENDER_SIZE); if (onRedraw) onRedraw(canvas); };
    render();

    const clampCrop = (c) => {
        c.side = Math.max(20, Math.min(c.side, Math.min(imgObj.width, imgObj.height)));
        c.x = Math.max(0, Math.min(c.x, imgObj.width - c.side));
        c.y = Math.max(0, Math.min(c.y, imgObj.height - c.side));
        return c;
    };
    let dragging = false, lastX = 0, lastY = 0, rafPending = false;
    const scheduleRender = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; render(); });
    };
    canvas.addEventListener("pointerdown", e => {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        // El canvas se muestra a rect.width px representando crop.side px del
        // original — esa razón da cuánto original se mueve por cada pixel
        // arrastrado en pantalla.
        const crop = getCrop();
        const scale = crop.side / rect.width;
        const dxScreen = e.clientX - lastX, dyScreen = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        crop.x -= dxScreen * scale;
        crop.y -= dyScreen * scale;
        setCrop(clampCrop(crop));
        scheduleRender();
    });
    const endDrag = () => { dragging = false; canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", endDrag);
    // El canvas vive dentro de un <label for="sn-foto-input">: sin esto, cada
    // click que dispara el drag (al soltar el mouse) burbujea al label y
    // reabre el selector de archivos (que en Windows suele caer en Descargas).
    canvas.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const crop = getCrop();
        const cx = crop.x + crop.side / 2, cy = crop.y + crop.side / 2;
        const factor = e.deltaY > 0 ? 1.08 : 0.92; // rueda abajo = alejar (recorte más grande)
        crop.side *= factor;
        crop.x = cx - crop.side / 2; crop.y = cy - crop.side / 2;
        setCrop(clampCrop(crop));
        scheduleRender();
    }, { passive: false });
}

// ── PROCESAMIENTO DE FOTO COMPARTIDO ────────────────────────────────
// Calcula coordenadas de recorte + devuelve preview canvas y original
// El recorte real lo aplica ImageKit en su servidor (sin pérdida de calidad)
function procesarFotoJoya(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const original = e.target.result;
            const img = new Image();
            img.onload = () => {
                const w = img.width, h = img.height;
                const tmp = document.createElement("canvas");
                tmp.width = w; tmp.height = h;
                const ctx = tmp.getContext("2d");
                ctx.drawImage(img, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h).data;

                // Analizar a escala reducida (800px max) para evitar captar ruido de fondo
                const SCALE = Math.min(1, 800 / Math.max(w, h));
                const sw = Math.round(w * SCALE), sh = Math.round(h * SCALE);
                const stmp = document.createElement("canvas");
                stmp.width = sw; stmp.height = sh;
                const sctx = stmp.getContext("2d");
                sctx.drawImage(img, 0, 0, sw, sh);
                const sdata = sctx.getImageData(0, 0, sw, sh).data;

                // Luminancia perceptual: ignora tinte cálido del fondo y sombras difusas.
                // Detecta píxeles que se diferencian del fondo en CUALQUIER dirección
                // (más oscuros U más claros) — una cadena de plata fina brilla más
                // clara que el fondo en varios tramos; comparar solo "más oscuro"
                // los perdía y el recorte terminaba más chico que el objeto real,
                // cortando puntas de cadenas/collares delgados.
                // Detectar fondo: samplear bordes de la imagen (5% de margen)
                const bgMargin = Math.max(4, Math.floor(Math.min(sw, sh) * 0.05));
                let bgSum = 0, bgCount = 0;
                for (let y = 0; y < bgMargin; y++) {
                    for (let x = 0; x < sw; x++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                for (let y = sh-bgMargin; y < sh; y++) {
                    for (let x = 0; x < sw; x++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                for (let x = 0; x < bgMargin; x++) {
                    for (let y = bgMargin; y < sh-bgMargin; y++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                for (let x = sw-bgMargin; x < sw; x++) {
                    for (let y = bgMargin; y < sh-bgMargin; y++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                const bgLum = bgSum / bgCount;
                const DIFF_MIN = 20; // píxel debe diferir ≥20 unidades del fondo (en cualquier dirección)
                const colCount = new Int32Array(sw);
                const rowCount = new Int32Array(sh);
                for (let y = 0; y < sh; y++) {
                    for (let x = 0; x < sw; x++) {
                        const i = (y * sw + x) * 4;
                        const lum = 0.299 * sdata[i] + 0.587 * sdata[i+1] + 0.114 * sdata[i+2];
                        if (Math.abs(bgLum - lum) >= DIFF_MIN) { colCount[x]++; rowCount[y]++; }
                    }
                }
                const minDensCol = Math.max(2, sh * 0.02);
                const minDensRow = Math.max(2, sw * 0.02);
                let minX = sw, maxX = 0, minY = sh, maxY = 0;
                for (let x = 0; x < sw; x++) if (colCount[x] >= minDensCol) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
                for (let y = 0; y < sh; y++) if (rowCount[y] >= minDensRow) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
                // Volver a coordenadas originales
                minX = Math.round(minX / SCALE); maxX = Math.round(maxX / SCALE);
                minY = Math.round(minY / SCALE); maxY = Math.round(maxY / SCALE);

                let crop = null;

                if (minX < maxX && minY < maxY) {
                    const objW = maxX - minX, objH = maxY - minY;
                    const largest = Math.max(objW, objH);
                    const pad   = Math.round(largest * 0.30); // 0.30 → objeto ocupa 62% del cuadrado
                    // Nunca superar el tamaño de imagen — sin bordes grises
                    const ideal = Math.min(largest + 2 * pad, Math.min(w, h));
                    const cx = Math.round((minX + maxX) / 2);
                    const cy = Math.round((minY + maxY) / 2);
                    // Centrar en (cx,cy) y clampear para que quede dentro de la imagen
                    const x1 = Math.max(0, Math.min(Math.round(cx - ideal / 2), w - ideal));
                    const y1 = Math.max(0, Math.min(Math.round(cy - ideal / 2), h - ideal));
                    console.log(`[ikCrop] bbox=${objW}×${objH} ideal=${ideal}px cx=${cx} cy=${cy} crop=(${x1},${y1}) ocup=${(largest/ideal*100).toFixed(0)}% fondo=${bgLum.toFixed(0)}`);
                    crop = { x: x1, y: y1, side: ideal };
                } else {
                    // Detección fallida — crop cuadrado centrado en la imagen
                    const side = Math.min(w, h);
                    crop = { x: Math.round((w - side) / 2), y: Math.round((h - side) / 2), side };
                    console.log(`[ikCrop] detección fallida — crop central ${side}px`);
                }

                // Preview 900×900 — alta calidad + sharpen por convolución
                const PV = 900;
                const out = document.createElement("canvas");
                const cropFinal = crop || { x: 0, y: 0, side: Math.min(w, h) };
                dibujarRecorte(img, cropFinal, out, PV);
                const preview = out.toDataURL("image/jpeg", 0.93);

                const uploadOriginal = original;

                resolve({ preview, original: uploadOriginal, crop });
            };
            img.onerror = () => resolve({ preview: original, original, crop: null });
            img.src = original;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Comprime a 800px máx para enviar a la IA (no altera la foto original)
// Copia SOLO para la IA (la foto que se guarda en stock no se toca): a 640px la
// IA identifica igual la pieza y cada análisis gasta ~35% menos del cupo gratis.
function comprimirParaIA(base64) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const MAX = 640;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            c.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => resolve(base64);
        img.src = base64;
    });
}

// Agrega transformación ImageKit para mostrar cuadrada y centrada, con
// nitidez (e-sharpen) — las fotos se suben tal cual las manda el vendedor,
// sin ningún realce, así que esto es lo único que las afina para mostrarlas.
function ikFoto(url, size) {
    if (!url || !url.includes("imagekit.io")) return url;
    const s = size || 900;
    // Una foto YA mejorada (fotoMejorada) trae su propia nitidez elegida (e-sharpen-N). No se le suma otro e-sharpen:
    // apilar los dos es lo que la hacía verse exagerada y poco natural frente a la vista previa del panel.
    // Solo se ajusta el ancho (el 1600 con el que se guardó) al tamaño pedido.
    if (esUrlMejorada(url)) {
        // el w-1600 de la mejora es el ÚLTIMO w- (justo antes de e-sharpen-N / q-90); el w- del recorte no se toca
        const reW = /(^|,)w-1600(?=(,e-sharpen-\d+)?,q-90$)/;
        return reW.test(url) ? url.replace(reW, "$1w-" + s) : (url.includes("?tr=") ? `${url},w-${s}` : url);
    }
    const base = url.split("?")[0];
    const tr   = url.includes("?tr=") ? url.split("?tr=")[1] : null;
    // Tamaño explícito en el mismo transform (no encadenado)
    return tr ? `${base}?tr=${tr},w-${s},e-sharpen` : `${base}?tr=w-${s},e-sharpen`;
}

// Foto tal cual se subió (con su recorte), SIN ninguna nitidez — solo tamaño y la misma calidad que la vista previa
// mejorada, para que el "antes" del panel ✨ sea de verdad el antes.
function ikOriginalSinNitidez(url, size) {
    if (!url || !url.includes("imagekit.io")) return url;
    const base = url.split("?")[0];
    // Se conserva TODO el recorte original (cm-extract,x,y,w,h…); solo se quita cualquier e-sharpen.
    const previo = url.includes("?tr=") ? url.split("?tr=")[1].split(",").filter(x => !x.startsWith("e-sharpen")).join(",") : "";
    return `${base}?tr=${previo ? previo + "," : ""}w-${size || 700},q-90`;
}

// ── MEJORAR IMAGEN (nitidez vía ImageKit) ──────────────────────────
// Solo transformaciones de nitidez (sharpen), nunca color/contraste/brillo
// ni IA generativa — la pieza debe verse exactamente igual, solo más nítida.
// Es una transformación por URL de ImageKit (mismo servicio ya en uso, sin
// nueva integración ni archivo adicional).
// Antes: natural=e-sharpen-3, mejorado=e-sharpen-8 — el nivel "mejorado" se
// veía muy artificial (halos duros de unsharp mask, agravados por no fijar
// calidad de salida). Se baja la intensidad de ambos y se sube la calidad,
// para que se note más nítido sin el look "sobre-procesado".
// suave = sin nitidez (solo recorte, tamaño y calidad 90); natural 1; intermedio 2; mejorado 3.
// q-90 es la marca que identifica una foto "mejorada" (las originales no la llevan): así ikFoto sabe que NO debe
// sumarle la nitidez automática, tampoco al nivel Suave, que no lleva e-sharpen.
const NIVELES_MEJORA_IMG_STOCK = { suave: "q-90", natural: "e-sharpen-1,q-90", intermedio: "e-sharpen-2,q-90", mejorado: "e-sharpen-3,q-90" };
const NIVELES_MEJORA_ORDEN = ["suave", "natural", "intermedio", "mejorado"];
function esUrlMejorada(url) { const u = String(url || ""); return /e-sharpen/.test(u) || /,q-90(?=,|$)/.test(u); }
// Valor numérico de nitidez de un nivel ("e-sharpen-3" -> 3) o de una dirección ImageKit guardada.
function nitidezDeNivel(nivel) { const m = /e-sharpen-(\d+)/.exec((NIVELES_MEJORA_IMG_STOCK[nivel] || "")); return m ? +m[1] : 0; }
function nitidezDeUrl(url) { const m = /e-sharpen-(\d+)/.exec(String(url || "")); return m ? +m[1] : (/e-sharpen/.test(String(url || "")) ? "automática" : 0); }
function ikMejorar(url, nivel, size) {
    if (!url || !url.includes("imagekit.io")) return url;
    const s = size || 900;
    const base = url.split("?")[0];
    const tr = NIVELES_MEJORA_IMG_STOCK[nivel] || NIVELES_MEJORA_IMG_STOCK.natural;
    // Conserva el recorte con el que se subió la foto (?tr=cm-extract,…) — igual que ikFoto. Antes se descartaba y la
    // versión mejorada mostraba la foto completa sin recortar: la pieza se veía pequeña y "lejana".
    const previo = url.includes("?tr=") ? url.split("?tr=")[1] : null;
    return previo ? `${base}?tr=${previo},w-${s},${tr}` : `${base}?tr=w-${s},${tr}`;
}

// Textos del panel en ES/EN — autocontenido, no depende de ningún sistema
// de idioma del resto de Stock (que es solo en español).
const MEJORA_STOCK_I18N = {
    es: {
        titulo: "✨ Mejorar imagen", original: "Original", preview: "Vista previa mejorada",
        nivel: "Nivel", suave: "Suave", natural: "Natural", intermedio: "Intermedio", mejorado: "Mejorado",
        cancelar: "Cancelar", aplicar: "Aplicar mejora", aplicando: "Aplicando...",
        toggleIdioma: "EN", okMsg: "✨ Mejora aplicada — el original se conserva intacto",
        errMsg: "⚠️ No se pudo aplicar la mejora"
    },
    en: {
        titulo: "✨ Enhance image", original: "Original", preview: "Enhanced preview",
        nivel: "Level", suave: "Soft", natural: "Natural", intermedio: "Medium", mejorado: "Enhanced",
        cancelar: "Cancel", aplicar: "Apply enhancement", aplicando: "Applying...",
        toggleIdioma: "ES", okMsg: "✨ Enhancement applied — the original is kept untouched",
        errMsg: "⚠️ Could not apply the enhancement"
    }
};
let _mjsIdioma = "es";
let _mjsNivel  = "natural";
let _mjsItem   = null;

function renderTextosMejoraStock() {
    const L = MEJORA_STOCK_I18N[_mjsIdioma];
    document.getElementById("mjs-titulo").textContent         = L.titulo;
    document.getElementById("mjs-label-original").textContent = L.original;
    document.getElementById("mjs-label-preview").textContent  = L.preview;
    document.getElementById("mjs-label-nivel").textContent    = L.nivel;
    const sh = (n) => (_mjsIdioma === "en" ? "sharpen " : "nitidez ") + nitidezDeNivel(n);
    NIVELES_MEJORA_ORDEN.forEach(n => { document.getElementById("mjs-btn-" + n).textContent = L[n] + " · " + sh(n); });
    document.getElementById("mjs-btn-cancelar").textContent   = L.cancelar;
    document.getElementById("mjs-btn-aplicar").textContent    = L.aplicar;
    document.getElementById("mjs-btn-idioma").textContent     = L.toggleIdioma;
}

function toggleIdiomaMejoraStock() {
    _mjsIdioma = _mjsIdioma === "es" ? "en" : "es";
    renderTextosMejoraStock();
}

// Se abre desde la vista de un producto de Stock (modal-ver-producto), que
// ya dejó el item actual en productoEditando.p al llamar abrirEditarStockItem.
function abrirMejorarFotoStock() {
    const item = productoEditando?.p;
    const foto = item?.foto || item?.img || "";
    if (!foto) { toast("⚠️ Este producto no tiene foto", "#f97316"); return; }
    _mjsItem  = item;
    _mjsNivel = "natural"; // Natural es siempre el nivel predeterminado
    document.getElementById("mjs-nombre").textContent = `${item.nombre || "—"} · ${item.codigo || "—"}`;
    const gd = document.getElementById("mjs-guardada");
    if (gd) {
        if (item.fotoMejorada) {
            const nit = nitidezDeUrl(item.fotoMejorada);
            gd.textContent = "Mejora guardada: nivel " + (item.fotoMejoraNivel || "?") + " · nitidez " + nit
                + (nit === 0 ? (item.fotoMejoraNivel === "suave" ? " (sin nitidez)" : " (¡la dirección guardada NO trae nitidez!)") : "");
            gd.title = item.fotoMejorada;
        } else {
            gd.textContent = "Sin mejora guardada (se muestra la foto original con la nitidez automática)";
            gd.title = "";
        }
    }
    document.getElementById("mjs-img-original").src   = ikOriginalSinNitidez(foto, 700);
    renderTextosMejoraStock();
    actualizarNivelMejoraStock();
    abrirModal("modal-mejorar-foto-stock");
}

function cerrarMejorarFotoStock() {
    cerrarModal("modal-mejorar-foto-stock");
    _mjsItem = null;
}

function setNivelMejoraStock(nivel) {
    _mjsNivel = nivel;
    actualizarNivelMejoraStock();
}

function actualizarNivelMejoraStock() {
    if (!_mjsItem) return;
    const foto = _mjsItem.foto || _mjsItem.img || "";
    document.getElementById("mjs-img-preview").src = ikMejorar(foto, _mjsNivel, 700);
    NIVELES_MEJORA_ORDEN.forEach(n => {
        const btn = document.getElementById("mjs-btn-" + n), act = _mjsNivel === n;
        btn.className = act ? "btn" : "btn btn-gris";
        btn.style.background = act ? "var(--dorado)" : "";
        btn.style.color = act ? "#111" : "";
    });
}

async function aplicarMejoraFotoStock() {
    if (!_mjsItem) return;
    const foto = _mjsItem.foto || _mjsItem.img || "";
    const L = MEJORA_STOCK_I18N[_mjsIdioma];
    const btn = document.getElementById("mjs-btn-aplicar");
    btn.textContent = L.aplicando; btn.disabled = true;
    try {
        const data = await apiPost({
            accion: "EDITAR_PRODUCTO",
            codigo: _mjsItem.codigo,
            fotoMejorada: ikMejorar(foto, _mjsNivel, 1600),
            fotoMejoraNivel: _mjsNivel
        });
        if (data.ok) {
            // Aplicación inmediata: se actualiza el dato local y todo lo que está en pantalla, sin recargar la página.
            const nuevaFoto = ikMejorar(foto, _mjsNivel, 1600);
            const codigo = _mjsItem.codigo;
            const enStock = stockData.find(p => p.codigo === codigo);
            if (enStock) { enStock.fotoMejorada = nuevaFoto; enStock.fotoMejoraNivel = _mjsNivel; }
            if (productoEditando && productoEditando.p && productoEditando.p.codigo === codigo) {
                productoEditando.p.fotoMejorada = nuevaFoto; productoEditando.p.fotoMejoraNivel = _mjsNivel;
            }
            const fotoModal = document.getElementById("modal-prod-foto");
            if (fotoModal) { fotoModal.src = ikFoto(nuevaFoto, 900); fotoModal.style.display = "block"; }
            try { filtrarStock(); } catch (_) { renderStock(stockData); }   // lista/grid con la foto mejorada ya puesta
            toast(L.okMsg, "#22c55e");
            cerrarMejorarFotoStock();
        } else {
            toast(L.errMsg, "#ef4444");
        }
    } catch (e) {
        toast(L.errMsg, "#ef4444");
    } finally {
        btn.textContent = L.aplicar; btn.disabled = false;
    }
}

// Fotos muy grandes (Upscayl 4× da PNG de 30–50 MB y 4000+ px) hacían fallar la subida: el Worker se quedaba sin memoria y el
// navegador lo mostraba como «bloqueado por CORS / Failed to fetch». Se reducen a 2600 px máx. en JPEG antes de enviar
// (ImageKit la sirve a 800–1600 px) y el recorte se reescala igual. Fotos normales pasan sin tocar.
const SUBIDA_MAX_PX = 2600, SUBIDA_MAX_B64 = 6_000_000;
function reducirParaSubida(base64) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, mayor = Math.max(w, h);
            if (mayor <= SUBIDA_MAX_PX && base64.length <= SUBIDA_MAX_B64) return resolve({ base64, k: 1 });
            const k = Math.min(1, SUBIDA_MAX_PX / mayor), cw = Math.round(w * k), ch = Math.round(h * k);
            const c = document.createElement("canvas"); c.width = cw; c.height = ch;
            const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
            ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, cw, ch);
            resolve({ base64: c.toDataURL("image/jpeg", 0.92), k: cw / w, w: cw, h: ch });
        };
        img.onerror = () => resolve({ base64, k: 1 });
        img.src = base64;
    });
}
async function subirFotoImageKit(fileOrBase64, nombre, crop) {
    try {
        // Convertir File a base64 si es necesario
        let base64;
        if (fileOrBase64 instanceof File) {
            base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(fileOrBase64);
            });
        } else {
            base64 = fileOrBase64;
        }
        const red = await reducirParaSubida(base64); base64 = red.base64;
        if (crop && red.k !== 1) {   // mismo recorte en la imagen reducida (sin salirse de ella por redondeo)
            const side = Math.max(1, Math.floor(crop.side * red.k));
            crop = { x: Math.max(0, Math.min(Math.floor(crop.x * red.k), red.w - side)), y: Math.max(0, Math.min(Math.floor(crop.y * red.k), red.h - side)), side };
        }

        // Subir a través del worker (usa clave privada server-side — más confiable)
        const res  = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ accion: "SUBIR_FOTO", _pass: _sessionPass, imagen: base64, nombre: nombre || ("foto_" + Date.now()) })
        });
        const data = await res.json();
        if (data.ok && data.url) {
            const base = data.url.split("?")[0];
            if (crop) {
                const { x, y, side } = crop;
                return `${base}?tr=cm-extract,x-${Math.round(x)},y-${Math.round(y)},w-${Math.round(side)},h-${Math.round(side)},q-99`;
            }
            return base;
        }
        console.warn("[ikUpload] worker error:", data?.error);
        return null;
    } catch(e) { console.error("[ikUpload] excepcion:", e); return null; }
}

// ── IMÁGENES INFORMATIVAS ────────────────────────────────────────────
// Imágenes que no son de producto (guías de talla, cuidados, promociones)
// alojadas igual que las fotos de Stock (ImageKit vía SUBIR_FOTO), pero
// separadas del inventario — solo para compartir el link con clientes.
let _imagenesInfoCache = null;

async function cargarImagenesInformativas() {
    try {
        const res = await apiPost({ accion: "GET_IMAGENES_INFO" });
        _imagenesInfoCache = res.imagenes || [];
    } catch(e) { _imagenesInfoCache = _imagenesInfoCache || []; }
    renderImagenesInformativas();
}

function renderImagenesInformativas() {
    const cont = document.getElementById("imginfo-lista");
    if (!cont) return;
    const lista = _imagenesInfoCache || [];
    if (!lista.length) {
        cont.innerHTML = '<p style="font-size:12px;color:var(--plateado);">Todavía no has subido ninguna imagen informativa.</p>';
        return;
    }
    cont.innerHTML = lista.slice().reverse().map(img => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--borde);">
            <img src="${img.url}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--gris2);" onerror="this.style.display='none'">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(img.etiqueta || "Sin nombre")}</div>
                <div style="font-size:10px;color:var(--plateado);">${img.fecha ? new Date(img.fecha).toLocaleDateString("es-SV",{day:"2-digit",month:"short",year:"numeric"}) : ""}</div>
            </div>
            <button onclick="compartirImagenInfo('${img.url}','${sanitizar(img.etiqueta||"")}')" style="padding:6px 10px;font-size:11px;background:#25D366;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">📱 Compartir</button>
            <button onclick="copiarLinkImagenInfo('${img.url}')" style="padding:6px 8px;font-size:11px;background:#2a2a2a;color:#fff;border:none;border-radius:6px;cursor:pointer;">📋</button>
            <button onclick="eliminarImagenInfo('${sanitizar(img.id)}')" style="padding:6px 8px;font-size:11px;background:#3a1a1a;color:#e74c3c;border:none;border-radius:6px;cursor:pointer;">🗑️</button>
        </div>`).join("");
}

async function subirImagenInformativa(file) {
    if (!file) return;
    const etiqueta = (document.getElementById("imginfo-etiqueta")?.value || "").trim() || file.name.replace(/\.[^.]+$/, "");
    toast("⏳ Subiendo imagen...");
    const url = await subirFotoImageKit(file, "info_" + Date.now());
    if (!url) { toast("⚠️ No se pudo subir la imagen", "#ef4444"); return; }
    const res = await apiPost({ accion: "GUARDAR_IMAGEN_INFO", etiqueta, url });
    if (!res.ok) { toast("⚠️ No se pudo guardar", "#ef4444"); return; }
    document.getElementById("imginfo-etiqueta").value = "";
    document.getElementById("imginfo-file").value = "";
    toast("✅ Imagen subida");
    cargarImagenesInformativas();
}

function compartirImagenInfo(url, etiqueta) {
    const msg = `${etiqueta ? etiqueta + "\n\n" : ""}${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
}

function copiarLinkImagenInfo(url) {
    navigator.clipboard.writeText(url);
    toast("✅ Link copiado");
}

async function eliminarImagenInfo(id) {
    if (!confirm("¿Eliminar esta imagen informativa?")) return;
    const res = await apiPost({ accion: "ELIMINAR_IMAGEN_INFO", id });
    if (!res.ok) { toast("⚠️ No se pudo eliminar", "#ef4444"); return; }
    toast("🗑️ Imagen eliminada");
    cargarImagenesInformativas();
}

// Compara dos nombres de producto ignorando mayúsculas/tildes/signos, y los
// considera "parecidos" si comparten casi todas las palabras relevantes
// (>2 letras) — detecta tanto el nombre idéntico como variaciones menores
// de tipeo, sin marcar como duplicado a dos diseños que solo comparten
// una palabra genérica ("Anillo", "Pulsera", etc.).
function _nombresSimilares(a, b) {
    const norm = s => String(s || "").toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9\s]/g, "").trim();
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const wa = new Set(na.split(/\s+/).filter(w => w.length > 2));
    const wb = new Set(nb.split(/\s+/).filter(w => w.length > 2));
    if (!wa.size || !wb.size) return false;
    let comunes = 0;
    wa.forEach(w => { if (wb.has(w)) comunes++; });
    return comunes / Math.min(wa.size, wb.size) >= 0.75;
}

async function agregarProductoNuevo() {
    const categoria = document.getElementById("np-categoria").value;
    const nombre    = document.getElementById("np-nombre").value.trim();
    const precio    = parseFloat(document.getElementById("np-precio").value) || 0;
    const descripcion = document.getElementById("np-desc").value.trim();
    const caracterEspecial = (document.getElementById("np-caract")?.value || "").trim();
    if (!categoria || !nombre || !precio) { toast("⚠️ Completa categoría, nombre y precio"); return; }

    const esAnillo = (categoria === "AN" || categoria === "CJ");
    const tallasQty = window._tallasQtyIndividual || {};
    const tieneTallas = Object.keys(tallasQty).length > 0;

    if (esAnillo && !tieneTallas) { toast("⚠️ Selecciona al menos una talla"); return; }

    const btn = document.querySelector("#modal-prod-nuevo .btn-dorado");
    btn.textContent = "⏳ Guardando...";
    btn.disabled = true;

    // Obtener código base
    let codigoBase = document.getElementById("np-codigo").value.trim().toUpperCase();
    if (!codigoBase) {
        codigoBase = generarCodigo(categoria, window._materialProducto);
    }

    // Construir variantes: una por talla si es anillo, o una sola si no
    let variantes;
    if (esAnillo && tieneTallas) {
        variantes = Object.entries(tallasQty)
            .map(([t, qty]) => ({ talla: Number(t), cantidad: Math.max(1, parseInt(qty) || 1) }))
            .sort((a, b) => a.talla - b.talla);
    } else {
        const qty = parseInt(document.getElementById("np-qty").value) || 1;
        variantes = [{ talla: null, cantidad: qty }];
    }

    // ── Validar duplicados antes de subir foto ────────────────────────────
    const codigosDuplicados = variantes
        .map(({ talla }) => aplicarTalla(codigoBase, talla))
        .filter(cod => stockData.find(s => String(s.codigo).toUpperCase() === cod.toUpperCase()));
    if (codigosDuplicados.length) {
        btn.textContent = "Agregar a Entrega"; btn.disabled = false;
        const existente = stockData.find(s => String(s.codigo).toUpperCase() === codigosDuplicados[0].toUpperCase());
        toast(`⚠️ Código ${codigosDuplicados[0]} ya existe — "${existente ? existente.nombre : ""}"`);
        return;
    }

    // ── Aviso de posible duplicado por NOMBRE (código distinto) ──────────
    // El caso real que motivó esto: la misma pieza ("Anillo Blue Baguette")
    // se registró dos veces con códigos base distintos (ANP032 y ANL002)
    // porque no se recordaba que ya existía — el chequeo de arriba no lo
    // detecta porque el código sí es nuevo. No bloquea (a veces dos diseños
    // distintos comparten nombre a propósito), solo frena a confirmar.
    const similar = (stockData || []).find(s =>
        (s.codigoBase || s.codigo) !== codigoBase &&
        s.estado !== "inactivo" &&
        _nombresSimilares(s.nombre_base || s.nombre, nombre)
    );
    if (similar) {
        const seguir = confirm(
            `⚠️ Ya existe un producto con nombre parecido:\n\n` +
            `${similar.codigoBase || similar.codigo} — ${similar.nombre_base || similar.nombre}\n\n` +
            `Si es la MISMA pieza, cancela y usa "✏️ Editar → agregar talla" en ese producto en vez de crear uno nuevo — así no queda duplicado.\n\n` +
            `¿Seguro que querés crear un producto nuevo de todas formas?`
        );
        if (!seguir) { btn.textContent = "Agregar a Entrega"; btn.disabled = false; return; }
    }

    // Subir foto una sola vez con el código base (siempre la original sin procesar)
    let fotoUrl = fotoBase64;
    const _fotoParaSubir = _fotoOriginalFile || _fotoOriginalBase64 || fotoBase64;
    if (_fotoParaSubir) {
        const url = await subirFotoImageKit(_fotoParaSubir, codigoBase, _fotoCropCoords);
        if (url) fotoUrl = url;
    }

    for (const { talla, cantidad } of variantes) {
        const codigo         = aplicarTalla(codigoBase, talla);
        const nombreConTalla = aplicarTallaNombre(nombre, talla);
        const tallaReal      = talla && codigo === codigoBase ? "" : (talla ? String(talla) : "");

        const prod = {
            id: codigo + "_" + Date.now(), codigo, codigoBase,
            talla: tallaReal,
            nombre: nombreConTalla, nombre_base: nombre,
            descripcion: descripcion + (tallaReal ? ` T${tallaReal}` : ""),
            precio, precioNum: precio, img: fotoUrl, esNuevo: true,
            caracterEspecial: caracterEspecial || undefined
        };

        const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
        const idxEx = extras.findIndex(x => x.codigo === codigo);
        const prodStorage = { ...prod, _fotoBase64: undefined };
        if (idxEx >= 0) extras[idxEx] = prodStorage; else extras.push(prodStorage);
        localStorage.setItem("vx_prod_extras", JSON.stringify(extras));

        mapaProductos[codigo]  = prod;
        carritoEntrega[codigo] = { item: prod, qty: cantidad };
    }

    btn.textContent = "Agregar a Entrega";
    btn.disabled = false;
    cerrarModal("modal-prod-nuevo");
    renderGridEntrega(productosDisponibles);
    actualizarCarritoEntrega();
    const total = variantes.reduce((s, v) => s + v.cantidad, 0);
    toast(`✅ ${variantes.length > 1 ? variantes.length + " tallas agregadas (" + total + " piezas)" : "Producto agregado"}`);
}
