// Hub VEREX — Fotos desde el celular (sesión, sincronización, pendientes)
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── FOTOS DESDE CELULAR ──────────────────────────────────────────────
const UPLOAD_URL = "https://verex-nexus.pages.dev/upload";

// ── FOTO CELULAR SYNC — sesión persistente ───────────────────────────
// La sesión vive mientras la página esté abierta.
// Si llega una foto con el modal cerrado, se guarda en _fotoCelPendiente
// y se carga automáticamente al abrir el siguiente producto.
let _fotoCelSession   = null;
let _fotoCelInterval  = null;
let _fotoCelPendiente = null;
let _fotoCelLastTs    = Date.now();
let _fotoCelLastUrl   = null; // evita procesar la misma foto dos veces

const _sbRealtime = window.supabase.createClient(
    'https://jimliwzodtglocdcwgil.supabase.co',
    'sb_publishable_PGoQtcuRuXt24bVVgG4m6w_4heJYulo'
);

function iniciarSesionFotoCel() {
    if (_fotoCelSession) return;
    _fotoCelSession = "VEREX-STORE";

    // Realtime WebSocket — recibe al instante cuando el worker guarda la URL
    _sbRealtime.channel('foto-cel')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'config',
            filter: 'id=eq.foto_temp_VEREX-STORE'
        }, (payload) => {
            const rec = payload.new;
            if (!rec || !rec.data) return;
            const url = rec.data?.url;
            if (!url) return;
            // Borrar la entrada para que el polling no la procese de nuevo
            fetch(`https://verex-api.verexstore.workers.dev/foto-check?s=${_fotoCelSession}`).catch(()=>{});
            _aplicarFotoCelular(url);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') console.log('[fotoCel] Realtime conectado ✅');
        });

    // Polling de respaldo cada 5s por si el Realtime falla
    _fotoCelInterval = setInterval(_pollFotoCel, 5000);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") _pollFotoCel();
    });
}

function abrirFotoCelularSN() {
    iniciarSesionFotoCel();
    const url = `https://verex-api.verexstore.workers.dev/foto-upload?s=${_fotoCelSession}`;
    document.getElementById("sn-qr-img").src =
        `https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=111111&bgcolor=ffffff&data=${encodeURIComponent(url)}`;
    document.getElementById("sn-foto-celular-panel").style.display = "block";
    document.getElementById("sn-foto-cel-status").textContent = "⏳ Esperando foto desde el celular...";
}

function cerrarFotoCelularSN() {
    // Solo oculta el panel — la sesión y el polling SIGUEN activos
    document.getElementById("sn-foto-celular-panel").style.display = "none";
}

async function _pollFotoCel() {
    if (!_fotoCelSession) return;
    try {
        const res  = await fetch(`https://verex-api.verexstore.workers.dev/foto-check?s=${_fotoCelSession}`);
        const data = await res.json();
        if (!data.pending || !data.url) return;
        _aplicarFotoCelular(data.url);
    } catch(e) {
        console.error("[fotoCel]", e);
    }
}

// Recibe foto del celular y la aplica en el modal
function _aplicarFotoCelular(url) {
    if (!url || url === _fotoCelLastUrl) return; // ignorar duplicados
    _fotoCelLastUrl = url;
    const modalAbierto = document.getElementById("modal-stock-nuevo")?.classList.contains("active");
    if (modalAbierto) {
        _cargarUrlFotoEnModal(url);
    } else {
        _fotoCelPendiente = { url };
        toast("📱 Foto lista — se carga al abrir el siguiente producto");
    }
}

async function _cargarUrlFotoEnModal(url) {
    const urlActiva = url; // capturar para detectar si cambió mientras procesamos
    const prev = document.getElementById("sn-foto-preview");
    if (prev) prev.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain;">`;
    const panel = document.getElementById("sn-foto-celular-panel");
    if (panel) panel.style.display = "none";
    window._snFotoUrl = url;
    toast("📱 Foto cargada desde celular ✅");

    try {
        let blob;
        if (url.startsWith("data:")) {
            const res = await fetch(url); blob = await res.blob();
        } else {
            blob = await (await fetch(url)).blob();
        }
        const file = new File([blob], "foto_celular.jpg", { type: "image/jpeg" });
        const r = await procesarFotoJoya(file);
        // Si la foto activa cambió mientras procesábamos, descartar resultado
        if (_fotoCelLastUrl !== urlActiva) return;
        _snFotoOriginalFile = file;
        window._snFotoUrl   = null;
        // Antes esto pisaba el preview con un <img> plano sin encuadre
        // arrastrable — el ajuste manual solo existía para fotos elegidas
        // desde archivo, no para las recibidas por celular.
        mostrarFotoStockConEncuadre(r);
    } catch(e) {
        console.error("[fotoCel procesarJoya]", e);
    }
}

function _aplicarFotoEnModal(payload) {
    _snFotoOriginalFile   = payload.file;
    _snFotoBase64         = payload.preview;
    _snFotoOriginalBase64 = payload.original;
    _snFotoCropCoords     = payload.crop;
    window._snFotoUrl     = null;
    const prev = document.getElementById("sn-foto-preview");
    if (prev) prev.innerHTML = `<img src="${payload.preview}" style="width:100%;height:100%;object-fit:contain;">`;
    const btnIA = document.getElementById("sn-btn-ia");
    if (btnIA) btnIA.style.display = "flex";
    const panel = document.getElementById("sn-foto-celular-panel");
    if (panel) panel.style.display = "none";
    toast("📱 Foto cargada desde celular ✅");
}

// Botón manual: verificar si hay foto esperando en el servidor
async function verificarFotoCelularManual() {
    if (!_fotoCelSession) { toast("⚠️ Aún no hay sesión activa — toca 'Desde celular' primero"); return; }
    const btn = document.getElementById("sn-btn-verificar-foto");
    if (btn) { btn.textContent = "⏳ Buscando..."; btn.disabled = true; }
    try {
        const res  = await fetch(`https://verex-api.verexstore.workers.dev/foto-check?s=${_fotoCelSession}`);
        const data = await res.json();
        if (data.pending && data.url) {
            _aplicarFotoCelular(data.url);
        } else {
            toast(`📭 Sin foto nueva — sesión: ${_fotoCelSession}`);
        }
    } catch(e) {
        toast("⚠️ Error de conexión al verificar foto");
    } finally {
        if (btn) { btn.textContent = "🔄 Verificar foto"; btn.disabled = false; }
    }
}

// Llamar al abrir el modal de stock nuevo para cargar foto pendiente
function cargarFotoCelPendienteSN() {
    if (!_fotoCelPendiente) return;
    const { url } = _fotoCelPendiente;
    _fotoCelPendiente = null;
    setTimeout(() => { _cargarUrlFotoEnModal(url); }, 200);
}

function abrirModalFotosCelular() {
    // Generar QR con la URL de la página de carga
    const qrImg = document.getElementById("qr-celular");
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&color=111111&bgcolor=ffffff&data=${encodeURIComponent(UPLOAD_URL)}`;
    document.getElementById("fotos-pendientes-grid").innerHTML = "";
    document.getElementById("fotos-pendientes-msg").style.display = "none";
    abrirModal("modal-fotos-celular");
    // Cargar fotos existentes al abrir
    cargarFotosPendientes();
}

let _todasFotosPendientes = [];
let _colaFotosStock = []; // fotos que faltan por usar en la cola de "Nuevo Producto" seguido

async function cargarFotosPendientes() {
    const grid = document.getElementById("fotos-pendientes-grid");
    const msg  = document.getElementById("fotos-pendientes-msg");
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--plateado);font-size:13px;padding:16px;">⏳ Cargando...</div>';
    msg.style.display = "none";
    try {
        const res  = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "GET_FOTOS_PENDIENTES", _pass: _sessionPass }) });
        const data = await res.json();
        _todasFotosPendientes = data.fotos || [];
        if (!data.ok || !data.fotos.length) {
            grid.innerHTML = "";
            msg.style.display = "block";
            return;
        }
        grid.innerHTML = data.fotos.map(f => `
            <div style="position:relative;" title="Usar esta foto">
                <img src="${sanitizar(f.url)}" onclick="usarFotoCelular(${jsArg(f.id)},${jsArg(f.url)})"
                     style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:2px solid transparent;transition:border-color .2s;cursor:pointer;"
                     onmouseover="this.style.borderColor='var(--dorado)'" onmouseout="this.style.borderColor='transparent'">
                <div style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.6);border-radius:4px;padding:2px 5px;font-size:9px;color:#fff;">
                    ${new Date(f.fecha).toLocaleDateString("es-SV",{day:"2-digit",month:"2-digit"})}
                </div>
                <button onclick="eliminarFotoPendiente('${f.id}',this)" title="Eliminar foto"
                    style="position:absolute;top:3px;right:3px;background:rgba(192,57,43,0.85);border:none;color:#fff;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button>
            </div>`).join("");
    } catch(e) {
        grid.innerHTML = "";
        msg.textContent = "❌ Error al cargar fotos";
        msg.style.display = "block";
    }
}

async function eliminarFotoPendiente(id, btn) {
    btn.disabled = true;
    try {
        await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "MARCAR_FOTO_USADA", _pass: _sessionPass, id }) });
        btn.closest("div[style]").remove();
        const grid = document.getElementById("fotos-pendientes-grid");
        if (!grid.children.length) {
            document.getElementById("fotos-pendientes-msg").style.display = "block";
        }
    } catch(e) { btn.disabled = false; toast("❌ Error al eliminar"); }
}

async function usarFotoCelular(id, url) {
    fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "MARCAR_FOTO_USADA", _pass: _sessionPass, id }) }).catch(()=>{});
    cerrarModal("modal-fotos-celular");

    // Detectar qué sección está activa: Stock o Entrega
    const secStock = document.getElementById("tab-content-stock");
    const enStock  = secStock && secStock.style.display !== "none";

    // En Stock: arma la cola con el resto de fotos pendientes, para poder
    // seguir de una foto a la siguiente sin volver a abrir este modal cada vez.
    if (enStock) {
        _colaFotosStock = _todasFotosPendientes.filter(f => f.id !== id);
    } else {
        _colaFotosStock = [];
    }

    await cargarFotoEnFormularioStockOEntrega(url, enStock);
}

// Procesa una foto (descarga + recorte IA) y la carga en el formulario
// correspondiente — usado tanto al elegir una foto de la galería como al
// avanzar automáticamente a la siguiente de la cola tras guardar un producto.
async function cargarFotoEnFormularioStockOEntrega(url, enStock) {
    toast("⏳ Procesando foto...");
    let r = null;
    try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const file = new File([blob], "foto_celular.jpg", { type: blob.type || "image/jpeg" });
        r = await procesarFotoJoya(file);
        r._file = file;
    } catch(e) {
        toast("❌ Error al procesar foto"); return;
    }

    if (enStock) {
        abrirStockNuevoProd();
        window._snFotoUrl = null;
        setTimeout(() => mostrarFotoStockConEncuadre(r), 150);
    } else {
        _fotoOriginalFile   = r._file;
        _fotoOriginalBase64 = r.original;
        _fotoCropCoords     = r.crop;
        fotoBase64          = r.preview;
        const preview = document.getElementById("preview-foto");
        if (preview) {
            preview.src = r.preview;
            preview.style.display = "block";
            document.getElementById("foto-placeholder").style.display = "none";
            document.getElementById("btn-ia").style.display = "flex";
            document.getElementById("material-single-container").style.display = "block";
        }
        abrirModalProductoNuevo();
    }
    toast(_colaFotosStock.length ? `✅ Foto lista — quedan ${_colaFotosStock.length} en la cola` : "✅ Foto lista");
}

// Se llama después de guardar un producto en Stock — si quedan fotos en la
// cola, salta directo a la siguiente sin que el admin tenga que volver a
// abrir "📱 Fotos" cada vez.
async function guardarStockNuevoYAvanzarCola() {
    await guardarStockNuevo();
    const modalCerrado = !document.getElementById("modal-stock-nuevo")?.classList.contains("active");
    if (modalCerrado && _colaFotosStock.length) {
        const siguiente = _colaFotosStock.shift();
        fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "MARCAR_FOTO_USADA", _pass: _sessionPass, id: siguiente.id }) }).catch(()=>{});
        await cargarFotoEnFormularioStockOEntrega(siguiente.url, true);
    }
}

function abrirQR() {
    abrirScannerQR(_onScanQREntrega, "📷 Escanear producto");
}

// Algunos lectores físicos (keyboard-wedge) leen mal el primer carácter del
// código (se pierde) y/o confunden "0" con "O". Normaliza para comparar.
function _normalizarCodigoScanner(s) {
    return String(s || "").trim().toUpperCase().replace(/O/g, "0");
}

// Registro persistente de escaneos que no se pudieron agregar — el toast
// desaparece en segundos y al escanear rápido y seguido es fácil no verlo,
// causando pérdidas silenciosas de piezas que el vendedor sí debía recibir.
let _scansFallidosSesion = [];
let _refrescarGridEntregaTimer = null;
function _registrarEscaneoFallido(codigo) {
    _scansFallidosSesion.push({ codigo, hora: new Date().toLocaleTimeString("es-SV", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) });
    const wrap  = document.getElementById("escaneos-fallidos-wrap");
    const lista = document.getElementById("escaneos-fallidos-lista");
    const count = document.getElementById("escaneos-fallidos-count");
    if (!wrap || !lista || !count) return;
    wrap.style.display = "block";
    count.textContent = _scansFallidosSesion.length;
    lista.innerHTML = _scansFallidosSesion.map(s => `${sanitizar(s.hora)} — <strong>${sanitizar(s.codigo)}</strong>`).join("<br>");
}

function _onScanQREntrega(codRaw) {
    const codigo = String(codRaw || "").trim().toUpperCase();
    if (!codigo) return;
    // Buscar en mapaProductosCompleto — el inventario COMPLETO de esta sesión
    // de entrega, que nunca se reduce por el filtro de búsqueda (a diferencia
    // de mapaProductos, que renderGridEntrega achica letra por letra mientras
    // el lector físico "escribe" el código en el buscador).
    let key = Object.keys(mapaProductosCompleto).find(k => String(k).toUpperCase() === codigo);

    // Fallback 1: confusión 0/O del lector físico
    if (!key) {
        const codigoNorm = _normalizarCodigoScanner(codigo);
        key = Object.keys(mapaProductosCompleto).find(k => _normalizarCodigoScanner(k) === codigoNorm);
    }
    // Fallback 2: el lector se comió los primeros 1, 2 o 3 caracteres del
    // código (la cantidad perdida varía de un escaneo a otro con este lector).
    if (!key) {
        const codigoNorm = _normalizarCodigoScanner(codigo);
        for (let recorte = 1; recorte <= 3 && !key; recorte++) {
            key = Object.keys(mapaProductosCompleto).find(k => _normalizarCodigoScanner(k).slice(recorte) === codigoNorm);
        }
    }

    if (!key) {
        // Nueva Entrega solo asigna stock EXISTENTE a un vendedor — nunca debe
        // abrir el modal de registrar producto nuevo (eso es otro flujo, en Stock).
        // Se registra en una lista PERSISTENTE (no solo el toast, que desaparece
        // en segundos) para que nada se pierda si se escanea rápido y seguido.
        _registrarEscaneoFallido(codigo);
        toast("⚠️ \"" + codigo + "\" no existe o no tiene stock en bodega");
        return;
    }
    const prod = mapaProductosCompleto[key];

    // BLOQUEO — no dejar re-escanear un producto que este vendedor YA tiene
    // asignado, sea en borrador sin publicar O ya activo/publicado. Antes
    // solo se revisaba "borrador", así que reescanear algo ya entregado y
    // publicado en una sesión de entrega distinta creaba un segundo registro
    // duplicado (mismo producto, dos veces con el mismo vendedor) sin ningún
    // aviso — eso pasó con PUP035 de Jaime.
    const yaAsignado = vendedorActual && consignacion.some(c =>
        getCodigoBase(c.codigo) === getCodigoBase(prod.codigo) &&
        (c.estado === "borrador" || c.estado === "activo") &&
        c.vendedor === vendedorActual.codigo
    );
    if (yaAsignado) {
        const yaEnBorrador = consignacion.some(c =>
            getCodigoBase(c.codigo) === getCodigoBase(prod.codigo) && c.estado === "borrador" && c.vendedor === vendedorActual.codigo
        );
        const detalle = yaEnBorrador ? "en un borrador sin publicar" : "ya publicado en su inventario";
        _registrarEscaneoFallido(codigo + " (YA ESTÁ " + detalle + " — no se agregó de nuevo)");
        toast("🚫 " + prod.nombre + " YA está " + detalle + " — no se agregó otra vez");
        return;
    }

    cambiarQtyEntrega(key, 1);
    // Restaurar la vista completa del grid tras el escaneo — pero POSPUESTO:
    // reconstruir el grid completo (1000+ productos) bloquea el hilo principal
    // una fracción de segundo, y si el siguiente escaneo llega justo en ese
    // instante, el navegador puede perder esas teclas silenciosamente. Se
    // espera una pausa breve sin nuevos escaneos antes de redibujar.
    const busEntrega = document.getElementById("bus-entrega");
    if (busEntrega) busEntrega.value = "";
    clearTimeout(_refrescarGridEntregaTimer);
    _refrescarGridEntregaTimer = setTimeout(() => { filtrarProductosEntrega(); }, 500);
    toast("✅ " + prod.nombre + " agregado");
}
