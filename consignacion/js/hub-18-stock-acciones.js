// Hub VEREX — Stock: escáner QR, editar, corregir cantidades, asignar y devolver
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── ESCÁNER QR POR CÁMARA (teléfono) ─────────────────────────────────
// Lee el mismo texto plano que codifica el QR de la etiqueta impresa
// (impresion/index.html → generateQRDataUrl(codigo)) y entrega ese código
// a quien lo pidió — sin depender de un lector físico USB/Bluetooth.
let _scannerStream = null;
let _scannerRAF = null;
let _scannerLastCode = null;
let _scannerLastTime = 0;
let _scannerOnResult = null;

async function abrirScannerQR(onResult, titulo) {
    if (typeof jsQR !== "function") {
        return toast("⚠️ El lector de código no cargó — revisa tu conexión e intenta de nuevo", "#ef4444");
    }
    document.getElementById("scanner-qr-titulo").textContent = titulo || "📷 Escanear código";
    document.getElementById("scanner-qr-status").textContent = "Lo que ves dentro del recuadro es lo que se escanea";
    document.getElementById("modal-scanner-qr-fondo").style.display  = "block";
    document.getElementById("modal-scanner-qr-header").style.display = "flex";
    document.getElementById("modal-scanner-qr-box").style.display    = "block";
    document.getElementById("scanner-qr-status").style.display       = "block";
    // Bloquea el scroll de fondo mientras el modal está abierto — en iOS/Android
    // el "rubber-band" del scroll de la página de atrás se sentía como que la
    // pantalla del escáner "se movía de un lado a otro".
    document.body.style.overflow = "hidden";
    _scannerOnResult = onResult;
    _scannerLastCode = null;
    _scannerLastTime = 0;

    const video = document.getElementById("scanner-qr-video");
    try {
        // Pide una resolución alta pero de aspecto común (16:9/4:3) — pedir un
        // cuadrado 1920x1920 (como estaba antes) no lo soporta casi ningún
        // sensor de cámara, así que el navegador caía a una resolución más
        // baja o tardaba en negociar el formato, lo que hacía más difícil
        // detectar el QR.
        _scannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1280 } }
        });
        video.srcObject = _scannerStream;
        await video.play();

        // Solo enfoque continuo — el zoom digital automático que se probó
        // antes podía dejar la imagen borrosa en teléfonos que no lo soportan
        // bien, dificultando la lectura en vez de ayudarla.
        try {
            const track = _scannerStream.getVideoTracks()[0];
            const caps  = track.getCapabilities ? track.getCapabilities() : {};
            if (caps.focusMode && caps.focusMode.includes("continuous")) {
                await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
            }
        } catch (_) {}

        _tickScannerQR(video);

        // Vigilante: si a los 3s no hay imagen real (el stream se concedió
        // pero no llegan frames — cámara ocupada por otra app, WebView raro,
        // etc.), lo avisamos en vez de dejar el cuadro verde vacío en silencio.
        clearTimeout(window._scannerWatchdog);
        window._scannerWatchdog = setTimeout(() => {
            if (_scannerStream && video.readyState < video.HAVE_ENOUGH_DATA) {
                const status = document.getElementById("scanner-qr-status");
                if (status) status.textContent = "⚠️ La cámara no está mostrando imagen — cierra y vuelve a abrir el escáner, o revisa que ninguna otra app esté usando la cámara";
            }
        }, 3000);
    } catch (e) {
        const msgCam = e.name === "NotAllowedError"
            ? "⚠️ La cámara está bloqueada para este sitio. Toca el candado junto a la dirección → Permisos → Cámara → Permitir. Si usas lector físico, escanea sin abrir la cámara."
            : e.name === "NotFoundError"
                ? "⚠️ Este equipo no tiene cámara. Usa el lector físico: escanea directamente, sin abrir la cámara."
                : "⚠️ No se pudo acceder a la cámara: " + e.name + " — " + e.message;
        toast(msgCam, "#ef4444", 8000);
        cerrarScannerQR();
    }
}

function _tickScannerQR(video) {
    if (!_scannerStream) return; // el modal ya se cerró
    // Todo el procesamiento del frame va en try/catch — si un solo frame falla
    // (ej. dimensiones del video aún en 0 justo al abrir la cámara) NO debe
    // matar el bucle: sin este try/catch, una excepción aquí detenía
    // requestAnimationFrame para siempre y la cámara se quedaba "viva" pero
    // sin leer nunca nada, como si escanear ya no hiciera nada.
    try {
        const canvas = document.getElementById("scanner-qr-canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const vw = video.videoWidth, vh = video.videoHeight;
        if (video.readyState === video.HAVE_ENOUGH_DATA && vw > 0 && vh > 0) {
            // Recorta al cuadro central de la cámara — el mismo recorte que hace
            // el CSS (object-fit:cover) en el visor — así lo que el usuario ve
            // dentro del recuadro verde es exactamente lo que se analiza, y no
            // hay que "ajustar" el teléfono buscando dónde sí lee.
            const lado = Math.min(vw, vh);
            const sx = (vw - lado) / 2, sy = (vh - lado) / 2;
            canvas.width = lado;
            canvas.height = lado;
            ctx.drawImage(video, sx, sy, lado, lado, 0, 0, lado, lado);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imgData.data, imgData.width, imgData.height);
            if (code && code.data) {
                const texto = code.data.trim();
                const ahora = Date.now();
                // Evita disparar el mismo código en cada frame — solo lo re-acepta
                // si cambió o pasó 1.5s desde el último acierto (permite re-escanear
                // el mismo producto para agregar varias unidades).
                if (texto !== _scannerLastCode || ahora - _scannerLastTime > 1500) {
                    _scannerLastCode = texto;
                    _scannerLastTime = ahora;
                    if (navigator.vibrate) navigator.vibrate(80);
                    const status = document.getElementById("scanner-qr-status");
                    if (status) status.textContent = "✅ Leído: " + texto;
                    const callback = _scannerOnResult;
                    cerrarScannerQR();
                    callback && callback(texto);
                    return;
                }
            }
        }
    } catch (_) { /* frame ignorado, se reintenta en el siguiente */ }
    _scannerRAF = requestAnimationFrame(() => _tickScannerQR(video));
}

function cerrarScannerQR() {
    clearTimeout(window._scannerWatchdog);
    ["modal-scanner-qr-fondo", "modal-scanner-qr-header", "modal-scanner-qr-box", "scanner-qr-status"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
    document.body.style.overflow = "";
    if (_scannerRAF) cancelAnimationFrame(_scannerRAF);
    _scannerRAF = null;
    if (_scannerStream) { _scannerStream.getTracks().forEach(t => t.stop()); _scannerStream = null; }
    _scannerOnResult = null;
}

function _onScanVD(codRaw) {
    // No toca el buscador ni llama filtrarVD() aquí — agregarAlVD() ya hace su
    // propio filtrarVD()+renderCarritoVD()+scroll al carrito. Duplicarlo hacía
    // que la pantalla se re-dibujara dos veces seguidas y se sintiera como que
    // "se movía sola" justo al cerrarse la cámara.
    const cod = String(codRaw || "").trim().toUpperCase();
    // Cuenta bodega + tienda como vendible — igual que agregarAlVD()/filtrarVD()
    // y que el propio worker (REGISTRAR_VENTA_DIRECTA descuenta primero de
    // tienda y luego de bodega). Antes esto solo miraba stock_bodega, así que
    // un producto que físicamente ya estaba en la tienda (no en bodega) salía
    // como "no encontrado" al escanearlo, aunque sí era vendible.
    const match = stockData.find(s => (s.codigo || "").toUpperCase() === cod && (parseInt(s.stock_bodega || 0) + parseInt(s.stock_tienda || 0)) > 0);
    if (match) {
        agregarAlVD(match.codigo);
        mostrarConfirmacionEscaneo(match.foto, match.nombre || match.codigo, match.codigo + " · $" + parseFloat(match.precio||0).toFixed(2));
    } else {
        toast("⚠️ No se encontró ese código en bodega", "#f97316");
    }
}

// Muestra brevemente la foto del producto escaneado — el carrito de Venta
// Directa solo lista texto, así que sin esto no había manera de confirmar a
// simple vista que el QR leído correspondía a la pieza correcta.
function mostrarConfirmacionEscaneo(foto, nombre, sub) {
    const box = document.getElementById("scan-confirm");
    if (!box) return;
    const img = document.getElementById("scan-confirm-foto");
    img.src = foto ? ikFoto(foto, 400) : "";
    img.dataset.fotoRaw = foto || "";
    img.style.display = foto ? "block" : "none";
    document.getElementById("scan-confirm-nombre").textContent = nombre || "";
    document.getElementById("scan-confirm-sub").textContent = sub || "";
    box.style.display = "flex";
    clearTimeout(window._scanConfirmTimer);
    window._scanConfirmTimer = setTimeout(() => { box.style.display = "none"; }, 2200);
}

// Toca la foto de la confirmación de escaneo (Venta Directa) para verla en
// grande — la abre en el mismo lightbox de zoom que ya usa el resto del
// sistema y frena el auto-cierre para que no desaparezca mientras se mira.
function _zoomFotoEscaneo() {
    const img = document.getElementById("scan-confirm-foto");
    if (!img || !img.dataset.fotoRaw) return;
    clearTimeout(window._scanConfirmTimer);
    document.getElementById("scan-confirm").style.display = "none";
    abrirFotoZoom(img.dataset.fotoRaw, document.getElementById("scan-confirm-nombre").textContent);
}

// Etiquetas legibles para las categorías estándar — cualquier categoría
// personalizada que no esté aquí se muestra tal cual viene en el dato.
const CATEGORIA_LABELS_STOCK = {
    AN: "💍 Anillos", PU: "📿 Pulseras", CO: "📿 Collares", AR: "👂 Aretes",
    CJ: "✨ Conjuntos", DJ: "🔗 Dijes", TB: "🦶 Tobilleras", CD: "⛓️ Cadenas con Dije",
    CA: "⛓️ Cadenas solas", RS: "📿 Rosarios", RE: "⌚ Relojes",
};

// Aviso «N productos sin foto» (sobre todo el stock activo, sin importar los filtros): un clic abre la lista
function actualizarAvisoSinFoto() {
    const box = document.getElementById("stock-sinfoto-aviso"); if (!box) return;
    const sin = (typeof stockData !== "undefined" ? stockData : []).filter(i => i.estado !== "inactivo" && !String(i.foto || i.img || "").trim());
    if (!sin.length) { box.style.display = "none"; box.innerHTML = ""; return; }
    const disenos = new Set(sin.map(i => getCodigoBase(i.codigo).toUpperCase())).size;
    box.innerHTML = `<button class="btn" onclick="document.getElementById('fil-stock-estado').value='sinfoto';filtrarStock();" style="background:#2f2a14;color:#f5d76e;border:1px solid #8a7a1e;padding:7px 14px;font-size:12px;">📷 <b>${sin.length}</b> código${sin.length > 1 ? "s" : ""} sin foto (<b>${disenos}</b> diseño${disenos > 1 ? "s" : ""}) — ver lista</button>`;
    box.style.display = "block";
}
function filtrarStock() {
    actualizarAvisoSinFoto();
    const filtro = document.getElementById("fil-stock-estado").value;
    const material = document.getElementById("fil-stock-material")?.value || "";
    const categoria = document.getElementById("fil-stock-categoria")?.value || "";
    const busq = document.getElementById("bus-stock").value.toLowerCase();
    const filtrados = stockData.filter(i => {
        // También se encuentra por el CÓDIGO ANTERIOR (la etiqueta física aún trae el viejo) y, escribiendo «etiqueta»,
        // salen solo los productos con la etiqueta por cambiar.
        const coincideBusq = !busq ||
            (i.nombre||"").toLowerCase().includes(busq) ||
            (i.codigo||"").toLowerCase().includes(busq) ||
            (i.codigoAnterior||"").toLowerCase().includes(busq) ||
            (busq === "etiqueta" && i.etiquetaPendiente === true);
        const coincideMaterial = !material || (i.material||"") === material;
        const coincideCategoria = !categoria || (i.categoria||"").toUpperCase() === categoria;
        let coincideEstado = true;
        if (filtro) {
            switch (filtro) {
                case "bodega":       coincideEstado = (parseInt(i.stock_bodega)||0)       > 0; break;
                case "tienda":       coincideEstado = (parseInt(i.stock_tienda)||0)        > 0; break;
                case "consignacion": coincideEstado = (parseInt(i.stock_consignacion)||0)  > 0; break;
                case "reservado":    coincideEstado = Boolean(i.reservado) || (parseInt(i.stock_reservado)||0) > 0; break;
                case "vendido":      coincideEstado = (parseInt(i.stock_vendido)||0)       > 0; break;
                case "sinfoto":      coincideEstado = i.estado !== "inactivo" && !String(i.foto || i.img || "").trim(); break;
                default:             coincideEstado = normalizar(i.estado) === filtro;
            }
        }
        return coincideEstado && coincideMaterial && coincideCategoria && coincideBusq;
    });
    const orden = document.getElementById("fil-stock-orden")?.value || "";
    if (orden === "cantidad-desc" || orden === "cantidad-asc") {
        const disp = i => Math.max(0, parseInt(i.cantidad||0) - parseInt(i.vendido||0));
        filtrados.sort((a, b) => orden === "cantidad-desc" ? disp(b) - disp(a) : disp(a) - disp(b));
    }
    renderStock(filtrados);
}

// Llena el filtro de materiales con los valores distintos presentes en el
// stock actual — se llama cada vez que se recarga la lista completa.
function poblarFiltroMaterial() {
    const sel = document.getElementById("fil-stock-material");
    if (!sel) return;
    const actual = sel.value;
    const materiales = [...new Set(stockData.map(i => (i.material||"").trim()).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todo material</option>' +
        materiales.map(m => `<option value="${m.replace(/"/g,'&quot;')}">${m}</option>`).join("");
    if (materiales.includes(actual)) sel.value = actual;
}

// ── ➕ AGREGAR TALLA a un diseño (botón del grupo en Stock) ─────────────────────────────────────────────
// Una talla nueva se crea con el código correcto del grupo: en alianzas lleva D (dama), C (caballero) o U (unisex)
// — ANP240CT11 —, con el nombre, precio, foto y visibilidad de sus hermanas. Si la talla ya existe, solo suma unidades.
let _at = { base: "", talla: "", letra: "", tipos: [] };
const _atLetraDe = c => ((String(c || "").match(/([DCU])T\d+(\.\d+)?$/i) || [])[1] || "").toUpperCase();
const _atFilas = base => stockData.filter(s => getCodigoBase(s.codigo) === base);
function abrirAgregarTalla(base) {
    const filas = _atFilas(base).filter(f => f.estado !== "inactivo");
    if (!filas.length) return toast("⚠️ No encontré ese diseño en Stock");
    const letras = new Set(filas.map(f => _atLetraDe(f.codigo)).filter(Boolean));
    const tipos = [];
    if (letras.has("D") || letras.has("C")) tipos.push(["D", "👩 Dama"], ["C", "👨 Caballero"]);
    if (letras.has("U")) tipos.push(["U", "Unisex"]);
    _at = { base, talla: "", letra: tipos.length ? tipos[0][0] : "", tipos };
    const ref = filas[0];
    document.getElementById("at-titulo").textContent = `➕ Agregar talla · ${base}`;
    document.getElementById("at-nombre").textContent = ref.nombre_base || ref.nombre || base;
    document.getElementById("at-cantidad").value = 1;
    document.getElementById("at-talla-otra").value = "";
    _atPintar();
    abrirModal("modal-agregar-talla");
}
function _atCodigo() { return _at.talla ? `${_at.base}${_at.letra}T${_at.talla}` : ""; }
function _atPintar() {
    const filas = _atFilas(_at.base).filter(f => f.estado !== "inactivo");
    const tiene = t => filas.find(f => String(f.talla) === String(t) && _atLetraDe(f.codigo) === _at.letra);
    const btnSt = on => `padding:8px 0;min-width:44px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;border:1px solid ${on ? "var(--dorado)" : "var(--borde)"};background:${on ? "var(--dorado)" : "var(--gris2)"};color:${on ? "#111" : "var(--blanco)"};`;
    document.getElementById("at-tipo-wrap").style.display = _at.tipos.length ? "block" : "none";
    document.getElementById("at-tipos").innerHTML = _at.tipos.map(([v, t]) =>
        `<button type="button" onclick="atElegirTipo('${v}')" style="${btnSt(_at.letra === v)}flex:1;">${t}</button>`).join("");
    const tallas = []; for (let t = 4; t <= 15; t++) tallas.push(String(t));
    document.getElementById("at-tallas").innerHTML = tallas.map(t => { const f = tiene(t);
        return `<button type="button" onclick="atElegirTalla('${t}')" style="${btnSt(_at.talla === t)}position:relative;" title="${f ? `Ya existe (${sanitizar(f.codigo)}): se suman unidades` : "Talla nueva"}">${t}${f ? `<span style="position:absolute;top:-6px;right:-6px;background:#34D399;color:#111;border-radius:8px;font-size:9px;padding:0 4px;">${parseInt(f.stock_bodega) || 0}</span>` : ""}</button>`; }).join("");
    const prev = document.getElementById("at-preview"), cod = _atCodigo(), f = _at.talla ? tiene(_at.talla) : null;
    const lado = _at.letra === "D" ? " (dama)" : _at.letra === "C" ? " (caballero)" : _at.letra === "U" ? " (unisex)" : "";
    prev.innerHTML = !cod ? '<span style="color:var(--plateado);">Elige una talla</span>'
        : f ? `Ya existe <b style="color:#FF9500;">${sanitizar(cod)}</b>${lado}: tiene ${parseInt(f.stock_bodega) || 0} en bodega → se suman`
            : `Talla nueva → se crea <b style="color:#FF9500;">${sanitizar(cod)}</b>${lado}`;
}
function atElegirTipo(l) { _at.letra = l; _atPintar(); }
function atElegirTalla(t) { _at.talla = String(t); document.getElementById("at-talla-otra").value = ""; _atPintar(); }
function atTallaOtra(v) { v = String(v || "").trim().replace(",", "."); _at.talla = /^\d{1,2}(\.5)?$/.test(v) ? String(parseFloat(v)) : ""; _atPintar(); }
async function guardarAgregarTalla() {
    const qty = parseInt(document.getElementById("at-cantidad").value) || 0;
    if (!_at.talla) return toast("⚠️ Elige la talla");
    if (qty < 1) return toast("⚠️ Pon cuántas unidades");
    const btn = document.getElementById("at-guardar");
    const codigo = _atCodigo();
    const todas = _atFilas(_at.base);
    const existe = todas.find(s => s.codigo === codigo);
    if (existe && existe.estado === "inactivo") return toast(`⚠️ ${codigo} existe pero está inactivo — reactívalo en vez de crearlo de nuevo`, "#f97316", 7000);
    btn.disabled = true; btn.textContent = "⏳ Guardando...";
    let r;
    try {
        if (existe) {
            r = await apiPost({ accion: "STOCK_ACTUALIZAR_CANTIDADES", items: [{ codigo, stock_bodega: (parseInt(existe.stock_bodega) || 0) + qty }] });
        } else {
            const activas = todas.filter(s => s.estado !== "inactivo");
            const hermana = activas.find(s => _atLetraDe(s.codigo) === _at.letra) || activas[0];
            const nb = hermana.nombre_base || hermana.nombre || "";
            // mismo formato de nombre que sus hermanas (solo cambia la talla)
            const nombre = /T\d+(\.\d+)?\s*$/i.test(hermana.nombre || "") ? hermana.nombre.replace(/T\d+(\.\d+)?\s*$/i, "T" + _at.talla) : `${nb} T${_at.talla}`;
            const copiar = ["nombre_base", "categoria", "material", "precio", "precio_caballero", "foto", "img", "fotoMejorada", "fotoMejoraNivel", "descripcion", "descripcionTienda", "caracterEspecial", "set_config", "enCatalogo"];
            // reactivarSiInactivo: si esa talla se había eliminado (queda inactiva y ocupa el código), el servidor la reactiva
            const nuevo = { accion: "STOCK_REGISTRAR", codigo, codigoBase: _at.base, talla: _at.talla, nombre, cantidad: qty, reactivarSiInactivo: true };
            for (const k of copiar) if (hermana[k] !== undefined && hermana[k] !== null && hermana[k] !== "") nuevo[k] = hermana[k];
            r = await apiPost(nuevo);
        }
    } catch (e) { r = { ok: false, error: e.message }; }
    btn.disabled = false; btn.textContent = "💾 Guardar";
    if (!r || !r.ok) return toast(`❌ ${codigo} NO se guardó: ${(r && r.error) || "sin respuesta del servidor"}`, "#ef4444", 8000);
    const reactivada = (r.reactivados || []).includes(codigo);
    toast(existe ? `✅ +${qty} en ${codigo}` : reactivada ? `♻️ ${codigo} estaba eliminada: se reactivó con ${qty} unidad${qty > 1 ? "es" : ""}` : `✅ Talla nueva ${codigo} creada con ${qty} unidad${qty > 1 ? "es" : ""}`, "#22c55e", 6000);
    cerrarModal("modal-agregar-talla");
    await cargarStock();
    if (typeof refrescarProductosEtiquetas === "function") await refrescarProductosEtiquetas();
    if (typeof ofrecerEtiquetaRapida === "function") ofrecerEtiquetaRapida([{ codigo, qty }]);
}


// Llena el filtro de tipo de producto (categoría) con los valores distintos
// presentes en el stock actual — igual que el de material.
function poblarFiltroCategoria() {
    const sel = document.getElementById("fil-stock-categoria");
    if (!sel) return;
    const actual = sel.value;
    const categorias = [...new Set(stockData.map(i => (i.categoria||"").trim().toUpperCase()).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todo tipo</option>' +
        categorias.map(c => `<option value="${c}">${CATEGORIA_LABELS_STOCK[c] || c}</option>`).join("");
    if (categorias.includes(actual)) sel.value = actual;
}

function normalizar(estado) {
    if (!estado) return "bodega";
    const e = estado.toLowerCase().replace(/\s/g, "");
    if (e.includes("bodega")) return "bodega";
    if (e.includes("tienda")) return "tienda";
    if (e.includes("consign")) return "consignacion";
    if (e.includes("reserv")) return "reservado";
    if (e.includes("vendid")) return "vendido";
    return "bodega";
}

function limpiarSeleccion() {
    stockSeleccionados = [];
    document.getElementById("stock-acciones").style.display = "none";
    renderStock(stockData);
}

// Descarga en un solo ZIP las fotos originales (sin transformar) de los
// productos seleccionados en Stock — para procesarlas en una app externa
// de nitidez/mejora y luego resubirlas por "Editar producto".
async function descargarFotosSeleccionadas() {
    if (!stockSeleccionados.length) return;
    const items = stockSeleccionados
        .map(cod => stockData.find(p => String(p.codigo) === String(cod)))
        .filter(Boolean);
    const conFoto = items.filter(i => i.foto || i.img);
    if (!conFoto.length) { toast("⚠️ Ninguno de los seleccionados tiene foto"); return; }

    const btn = document.getElementById("btn-descargar-fotos-stock");
    const textoOriginal = btn.textContent;
    btn.disabled = true;

    const zip = new JSZip();
    let ok = 0;
    const fallidas = [];
    for (let i = 0; i < conFoto.length; i++) {
        const item = conFoto[i];
        btn.textContent = `📥 ${i + 1}/${conFoto.length}...`;
        const url = item.foto || item.img;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(String(resp.status));
            const blob = await resp.blob();
            const ext = (url.split("?")[0].split(".").pop() || "jpg").slice(0, 4);
            zip.file(`${item.codigo || ("item" + i)}.${ext}`, blob);
            ok++;
        } catch (e) {
            fallidas.push(item.codigo || "?");
        }
    }

    if (ok === 0) {
        toast("⚠️ No se pudo descargar ninguna foto (revisá conexión)");
        btn.disabled = false;
        btn.textContent = textoOriginal;
        return;
    }

    btn.textContent = "🗜️ Comprimiendo...";
    const contenido = await zip.generateAsync({ type: "blob" });
    const nombreZip = `fotos-stock-${new Date().toISOString().slice(0, 10)}.zip`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(contenido);
    a.download = nombreZip;
    document.body.appendChild(a);
    a.click();
    a.remove();

    toast(fallidas.length
        ? `✅ ${ok} fotos descargadas · ⚠️ ${fallidas.length} fallaron (${fallidas.slice(0, 5).join(", ")}${fallidas.length > 5 ? "…" : ""})`
        : `✅ ${ok} fotos descargadas en ${nombreZip}`);

    btn.disabled = false;
    btn.textContent = textoOriginal;
}

// ── EDITAR PRODUCTO DESDE STOCK ──────────────────────────────────────
function abrirEditarStockItem(codigo) {
    const item = stockData.find(p => p.codigo === codigo);
    if (!item) return;
    // Reutilizar modal existente de edición de producto
    productoEditando = { key: item.codigo, p: { ...item, img: item.foto || item.img || "" } };
    document.getElementById("modal-prod-titulo").textContent = item.codigo || "Producto";
    const foto = document.getElementById("modal-prod-foto");
    if (item.foto || item.img) { foto.src = ikFoto(item.fotoMejorada || item.foto || item.img, 900); foto.style.display = "block"; }
    else { foto.style.display = "none"; }
    document.getElementById("vp-codigo").textContent  = item.codigo  || "";
    document.getElementById("vp-nombre").textContent  = item.nombre  || "";
    document.getElementById("vp-desc").textContent    = item.descripcion || item.descripcionTienda || "";
    document.getElementById("vp-precio").textContent  = "$" + parseFloat(item.precio || 0).toFixed(2);
    document.getElementById("modal-prod-vista").style.display   = "block";
    document.getElementById("modal-prod-edicion").style.display = "none";
    abrirModal("modal-ver-producto");
}

// ── CORREGIR CANTIDAD EXACTA (bodega/tienda/consignación) ────────────
// Auditoría de SOLO LECTURA — no cambia nada, solo compara stock_consignacion
// (contador agregado, se ajusta manualmente en +20 lugares del código) contra
// la fuente real de verdad (consignación activa por vendedor) y avisa el
// drift, igual al que causó el caso Jaime/PUP035 — para detectarlo antes de
// que alguien note algo raro, no solo después.
async function ejecutarAuditoriaStock() {
    const panel = document.getElementById("auditoria-stock-panel");
    panel.style.display = "block";
    panel.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Auditando... (no se modifica nada)</p>';
    let res;
    try {
        res = await apiPost({ accion: "AUDITORIA_STOCK" });
    } catch(e) {
        panel.innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ Error al auditar: ' + e.message + '</p>';
        return;
    }
    if (!res || res.ok === false) {
        panel.innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ ' + (res?.error||"No se pudo auditar") + '</p>';
        return;
    }
    const { discrepanciasConsignacion, negativos, consHuerfanas, cerradosSinContar, resumen, generadoEn } = res;
    const sinProblemas = !discrepanciasConsignacion.length && !negativos.length && !consHuerfanas.length && !(cerradosSinContar||[]).length;

    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:var(--dorado);font-size:15px;">🔍 Auditoría de Stock</h3>
        <span style="font-size:11px;color:var(--plateado);">${new Date(generadoEn).toLocaleString('es-SV')} · ${resumen.productosRevisados} productos revisados</span>
    </div>`;

    if (sinProblemas) {
        html += '<p style="color:#2ecc71;font-size:13px;font-weight:700;">✅ Todo cuadra — sin discrepancias, sin negativos, sin huérfanas.</p>';
    } else {
        if (discrepanciasConsignacion.length) {
            html += `<div style="margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#f0b96a;margin-bottom:6px;">⚖️ Contador de consignación desincronizado (${discrepanciasConsignacion.length})</div>
                ${discrepanciasConsignacion.map(d => `
                    <div style="background:#1f1a12;border:1px solid #5a4520;border-radius:8px;padding:8px 10px;margin-bottom:6px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <div>
                                <strong style="font-size:12.5px;">${sanitizar(d.codigo)}</strong> — ${sanitizar(d.nombre)}
                                <div style="font-size:11px;color:var(--plateado);margin-top:2px;">
                                    Registrado: <strong>${d.stock_consignacion_registrado}</strong> · Real (consignación activa): <strong>${d.consignacion_real}</strong>
                                    · Diferencia: <strong style="color:${d.diferencia>0?'#e74c3c':'#3b82f6'};">${d.diferencia>0?'+':''}${d.diferencia}</strong>
                                </div>
                                ${d.detalleVendedores.length ? `<div style="font-size:10.5px;color:#888;margin-top:2px;display:flex;flex-direction:column;gap:3px;">
                                    ${d.detalleVendedores.map(v => `<span>Con: ${sanitizar(v.vendedorNombre)} (${v.cantidad})${!v.vendedorExiste ? ` — <span style="color:#a78bfa;">vendedor ya no existe</span> <button onclick="event.stopPropagation();eliminarConsignacionHuerfana('${sanitizar(v.id)}','${sanitizar(d.codigo)}')" style="padding:2px 8px;font-size:10px;background:#3a2a5a;color:#c4b5fd;border:none;border-radius:5px;cursor:pointer;font-weight:700;">🗑️ Eliminar registro</button>` : ''}</span>`).join('')}
                                </div>` : ''}
                            </div>
                            <button onclick="corregirCantidadExactaStock('${sanitizar(d.codigo)}')" style="padding:5px 10px;font-size:11px;background:#e8b07a;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">⚖️ Corregir</button>
                        </div>
                    </div>`).join('')}
            </div>`;
        }
        if (negativos.length) {
            html += `<div style="margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#e74c3c;margin-bottom:6px;">🚫 Cantidades negativas (${negativos.length}) — no deberían existir</div>
                ${negativos.map(n => `
                    <div style="background:#1f1212;border:1px solid #5a2020;border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <div><strong style="font-size:12.5px;">${sanitizar(n.codigo)}</strong> — ${sanitizar(n.nombre)}
                            <div style="font-size:11px;color:var(--plateado);">Bodega: ${n.stock_bodega} · Tienda: ${n.stock_tienda} · Consignación: ${n.stock_consignacion} · Reservado: ${n.stock_reservado}</div>
                        </div>
                        <button onclick="corregirCantidadExactaStock('${sanitizar(n.codigo)}')" style="padding:5px 10px;font-size:11px;background:#e8b07a;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">⚖️ Corregir</button>
                    </div>`).join('')}
            </div>`;
        }
        if (consHuerfanas.length) {
            html += `<div>
                <div style="font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:6px;">👻 Consignación activa con código que ya no existe en Stock (${consHuerfanas.length})</div>
                ${consHuerfanas.map(h => `
                    <div style="background:#181225;border:1px solid #3a2a5a;border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <div><strong style="font-size:12.5px;">${sanitizar(h.codigo)}</strong> — vendedor: ${sanitizar(h.vendedorNombre)} · cantidad: ${h.cantidad} · vendido: ${h.vendido||0}</div>
                        <button onclick="eliminarConsignacionHuerfana('${sanitizar(h.id)}','${sanitizar(h.codigo)}')" style="padding:5px 10px;font-size:11px;background:#3a2a5a;color:#c4b5fd;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">🗑️ Eliminar registro</button>
                    </div>`).join('')}
                <div style="font-size:11px;color:var(--plateado);margin-top:4px;">Revisa manualmente estos casos en el perfil del vendedor — el producto pudo haberse eliminado de Stock por error.</div>
            </div>`;
        }
        if ((cerradosSinContar||[]).length) {
            html += `<div style="margin-top:14px;">
                <div style="font-size:13px;font-weight:700;color:#52d68a;margin-bottom:6px;">💰 Cerradas con "Ya vendida" pero la venta nunca se contó (${cerradosSinContar.length})</div>
                <div style="font-size:11px;color:var(--plateado);margin-bottom:6px;">Se marcaron como ya liquidadas (sin tocar comisión ni stock) en vez de registrarse como venta nueva — no aparecen en el inventario del vendedor porque ya están cerradas.</div>
                ${cerradosSinContar.map(c => `
                    <div style="background:#0f1f16;border:1px solid #205a3a;border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <div><strong style="font-size:12.5px;">${sanitizar(c.codigo)}</strong> — ${sanitizar(c.nombre)}
                            <div style="font-size:11px;color:var(--plateado);">Vendedor: ${sanitizar(c.vendedorNombre)} · $${parseFloat(c.precio||0).toFixed(2)} · pendiente de contar: ${c.pendiente}</div>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button onclick="registrarVentaCerradaSinContar('${sanitizar(c.id)}','${sanitizar(c.codigo)}',${c.pendiente})" style="padding:5px 10px;font-size:11px;background:#52d68a;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">💰 Registrar venta real</button>
                            <button onclick="eliminarConsignacionHuerfana('${sanitizar(c.id)}','${sanitizar(c.codigo)}')" style="padding:5px 10px;font-size:11px;background:#3a2a5a;color:#c4b5fd;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">🗑️ Eliminar</button>
                        </div>
                    </div>`).join('')}
            </div>`;
        }
    }
    panel.innerHTML = html;
}

// Recupera una pieza cerrada por error con "Ya vendida" (marcada solo como
// liquidada, sin contar la venta) — la registra de verdad con REGISTRAR_VENTA
// para que sí cuente comisión y aparezca en el historial del vendedor, igual
// que si se hiciera desde su perfil.
async function registrarVentaCerradaSinContar(id, codigo, pendiente) {
    const fechaTxt = prompt(`Fecha real en que se vendió "${codigo}" (AAAA-MM-DD):`, new Date().toISOString().slice(0,10));
    if (!fechaTxt) return;
    const fechaISO = new Date(fechaTxt + "T12:00:00").toISOString();
    const res = await apiPost({ accion: "REGISTRAR_VENTA", id, cantidad: pendiente, fecha: fechaISO });
    if (!res.ok) { toast("⚠️ " + (res.error||"No se pudo registrar la venta"), "#c0392b"); return; }
    toast("✅ Venta registrada — ya cuenta para su comisión y aparece en su historial");
    ejecutarAuditoriaStock();
}

// Borra un registro de consignación de raíz (sin mover stock) — para casos
// huérfanos/de prueba que el panel de auditoría encontró, típicamente con un
// vendedor que ya no existe o un código que ya no existe en Stock, donde no
// hay perfil al que entrar para borrarlo con el botón normal.
async function eliminarConsignacionHuerfana(id, codigo) {
    if (!confirm(`¿Eliminar el registro de consignación de "${codigo}"? Es para limpiar datos de prueba/huérfanos — NO restaura nada a bodega, porque se asume que esa pieza nunca existió realmente. Si tienes dudas, cancela y revisa primero.`)) return;
    const res = await apiPost({ accion: "ELIMINAR_CONSIGNACION_SIN_RESTAURAR", id });
    if (res && res.ok !== false) {
        toast("🗑️ Registro eliminado");
        ejecutarAuditoriaStock();
    } else {
        toast("⚠️ " + (res?.error || "No se pudo eliminar"), "#c0392b");
    }
}

// A diferencia de "+ Existencia" (que solo SUMA), esto fija el número
// exacto de cada columna — para arreglar desajustes puntuales (ej. un
// duplicado eliminado que dejó el contador de consignación mal calculado).
async function corregirCantidadExactaStock(codigo) {
    const item = stockData.find(p => p.codigo === codigo);
    if (!item) return;
    const bodegaActual = parseInt(item.stock_bodega) || 0;
    const tiendaActual = parseInt(item.stock_tienda) || 0;
    const consigActual = parseInt(item.stock_consignacion) || 0;

    const nuevaBodega = prompt(`${codigo} — Bodega actual: ${bodegaActual}\n\nNueva cantidad exacta en BODEGA:`, bodegaActual);
    if (nuevaBodega === null) return;
    const nuevaTienda = prompt(`${codigo} — Tienda actual: ${tiendaActual}\n\nNueva cantidad exacta en TIENDA:`, tiendaActual);
    if (nuevaTienda === null) return;
    const nuevaConsig = prompt(`${codigo} — Consignación actual: ${consigActual}\n\nNueva cantidad exacta en CONSIGNACIÓN:`, consigActual);
    if (nuevaConsig === null) return;

    const b = Math.max(0, parseInt(nuevaBodega) || 0);
    const t = Math.max(0, parseInt(nuevaTienda) || 0);
    const c = Math.max(0, parseInt(nuevaConsig) || 0);

    if (!confirm(`Confirmar corrección de ${codigo}:\nBodega: ${bodegaActual} → ${b}\nTienda: ${tiendaActual} → ${t}\nConsignación: ${consigActual} → ${c}`)) return;

    try {
        const res = await apiPost({ accion: "STOCK_ACTUALIZAR_CANTIDADES", items: [{ codigo, stock_bodega: b, stock_tienda: t, stock_consignacion: c }] });
        if (res && res.ok !== false) {
            item.stock_bodega = b; item.stock_tienda = t; item.stock_consignacion = c;
            renderStock(stockData);
            toast("✅ Cantidades corregidas");
        } else {
            toast("⚠️ Error al corregir: " + (res?.error || "desconocido"));
        }
    } catch(e) { toast("⚠️ Error al corregir: " + e.message); }
}

// ── ELIMINAR PRODUCTO DESDE STOCK ────────────────────────────────────
async function eliminarStockItem(codigo) {
    if (!confirm(`¿Eliminar "${codigo}" del inventario?\nEsta acción no se puede deshacer.`)) return;
    const res = await apiPost({ accion: "ELIMINAR_PRODUCTO", codigo });
    if (res && res.ok !== false) {
        stockData = stockData.filter(p => p.codigo !== codigo);
        renderStock(stockData);
        toast("🗑️ Producto eliminado");
    } else {
        toast("⚠️ Error al eliminar", "#c0392b");
    }
}

// ── ASIGNAR A TIENDA ─────────────────────────────────────────────────
// todo = true: mueve TODAS las unidades que haya en bodega de cada talla (el Worker nunca mueve más de lo que hay).
const _CANT_TODO = 100000;
async function asignarATienda(todo = false) {
    if (!stockSeleccionados.length) return;
    const uds = todo ? stockSeleccionados.reduce((a, c) => a + (parseInt(stockData.find(p => p.codigo === c)?.stock_bodega) || 0), 0) : 0;
    if (todo && !uds) { toast("⚠️ No hay unidades en bodega para enviar a tienda"); return; }
    if (!confirm(todo ? `¿Enviar a tienda las ${uds} unidad(es) que hay en bodega de ${stockSeleccionados.length} talla(s)?` : `¿Publicar ${stockSeleccionados.length} producto(s) en la tienda online?`)) return;
    const res = await apiPost({ accion: "STOCK_ASIGNAR_TIENDA", codigos: stockSeleccionados, cantidad: todo ? _CANT_TODO : 1 });
    if (res.ok) {
        toast(todo ? `✅ ${uds} unidad(es) enviadas a tienda` : `✅ ${res.publicados?.length || stockSeleccionados.length} producto(s) publicados en tienda`);
        limpiarSeleccion();
        await cargarStock();
    } else {
        toast("⚠️ Error al publicar", "#c0392b");
    }
}

// ── ASIGNAR A VENDEDOR ───────────────────────────────────────────────
function abrirAsignarVendedor() {
    if (!stockSeleccionados.length) return;
    document.getElementById("stock-asignar-info").textContent = 
        `Se asignarán ${stockSeleccionados.length} producto(s) al vendedor seleccionado.`;
    const sel = document.getElementById("stock-vendedor-sel");
    sel.innerHTML = '<option value="">-- Seleccionar vendedor --</option>' +
        vendedores.map(v => `<option value="${v.codigo}">${v.nombre}</option>`).join('');
    abrirModal("modal-stock-asignar");
}

async function confirmarAsignarVendedor() {
    const vendedor = document.getElementById("stock-vendedor-sel").value;
    if (!vendedor) { toast("⚠️ Selecciona un vendedor"); return; }
    const res = await apiPost({ accion: "STOCK_ASIGNAR_VENDEDOR", codigos: stockSeleccionados, vendedor, cantidad: 1 });
    if (res.ok) {
        cerrarModal("modal-stock-asignar");
        limpiarSeleccion();
        await cargarStock();
        await cargarDatos();
        let msg = "";
        if (res.asignados && res.asignados.length > 0) {
            msg += "✅ Asignados: " + res.asignados.length + " productos. ";
        }
        if (res.sinStock && res.sinStock.length > 0) {
            msg += "⚠️ Sin stock en bodega: " + res.sinStock.join(", ");
            toast(msg, "#e67e22");
        } else {
            toast(msg || "✅ Productos asignados correctamente");
        }
    } else {
        toast("⚠️ Error al asignar", "#c0392b");
    }
}

// ── DEVOLVER A BODEGA ────────────────────────────────────────────────
async function devolverABodega(todo = false) {
    if (!stockSeleccionados.length) return;
    // Detectar origen real según los contadores del producto
    const origen = (() => {
        const prod = stockData.find(p => p.codigo === stockSeleccionados[0]);
        if (!prod) return "tienda";
        const enConsig = parseInt(prod.stock_consignacion) || 0;
        const enTienda = parseInt(prod.stock_tienda) || 0;
        if (enConsig > 0 && enTienda === 0) return "consignacion";
        return "tienda";
    })();
    const campo = origen === "consignacion" ? "stock_consignacion" : "stock_tienda";
    const uds = todo ? stockSeleccionados.reduce((a, c) => a + (parseInt(stockData.find(p => p.codigo === c)?.[campo]) || 0), 0) : 0;
    if (todo && !uds) { toast(`⚠️ No hay unidades en ${origen} para devolver a bodega`); return; }
    if (!confirm(todo ? `¿Devolver a bodega las ${uds} unidad(es) que hay en ${origen} de ${stockSeleccionados.length} talla(s)?` : `¿Devolver ${stockSeleccionados.length} producto(s) a bodega?`)) return;
    const res = await apiPost({ accion: "STOCK_DEVOLVER_BODEGA", codigos: stockSeleccionados, cantidad: todo ? _CANT_TODO : 1, origen });
    if (res.ok) {
        toast("✅ Productos devueltos a bodega");
        limpiarSeleccion();
        await cargarStock();
    }
}
