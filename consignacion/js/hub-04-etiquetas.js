// Hub VEREX — Etiquetas (pestaña) y estado de etiquetas impresas
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── ETIQUETAS ────────────────────────────────────────────────────────
let seleccionEtiquetas = new Set();

async function refrescarProductosEtiquetas() {
    // stockData ya fue actualizado por cargarStock() y es la fuente definitiva
    if (stockData && stockData.length) {
        productosDisponibles = stockData.filter(p => p.estado !== "inactivo");
    } else {
        try {
            const res = await apiPost({ accion: "STOCK_GET_ALL" });
            guardarCodigosInactivos(res);
            if (res.stock) {
                stockData = res.stock;
                productosDisponibles = res.stock.filter(p => p.estado !== "inactivo");
            }
        } catch(e) {}
    }
    renderGridEtiquetas(productosDisponibles);
}

function renderGridEtiquetas(prods) {
    const grid = document.getElementById("grid-etiquetas");
    if (!prods.length) {
        grid.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay productos en el catálogo.</p>';
        return;
    }
    grid.innerHTML = prods.map((p, i) => {
        const key = "etq-" + i;
        const sel = seleccionEtiquetas.has(p.codigo);
        return `<div onclick="toggleEtiqueta('${p.codigo}')" id="etqcard-${p.codigo.replace(/[^a-zA-Z0-9]/g,'-')}"
            style="background:#0f2040;border:2px solid ${sel ? '#00E676' : '#1e3a5f'};border-radius:10px;padding:10px;cursor:pointer;transition:border-color 0.2s;">
            <div style="font-size:10px;color:var(--dorado);font-weight:600;">${p.codigo}</div>
            <div style="font-size:11px;font-weight:500;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}</div>
            <div style="font-size:12px;font-weight:700;color:var(--dorado-claro);">$${parseFloat(p.precio||0).toFixed(2)}</div>
            ${p.material ? `<div style="font-size:9px;color:var(--plateado);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${abreviarMaterial(p.material)}</div>` : ''}
            ${sel ? '<div style="font-size:10px;color:#00E676;margin-top:4px;font-weight:700;">✓ Seleccionado</div>' : ''}
        </div>`;
    }).join('');
    actualizarConteoEtiquetas();
}

function toggleEtiqueta(codigo) {
    if (seleccionEtiquetas.has(codigo)) seleccionEtiquetas.delete(codigo);
    else seleccionEtiquetas.add(codigo);
    renderGridEtiquetas(productosDisponibles.filter(p => {
        const busq = document.getElementById("bus-etiquetas").value.toLowerCase();
        return !busq || (p.nombre||"").toLowerCase().includes(busq) || (p.codigo||"").toLowerCase().includes(busq);
    }));
}

function actualizarConteoEtiquetas() {
    document.getElementById("etiq-count").textContent = seleccionEtiquetas.size + " producto" + (seleccionEtiquetas.size !== 1 ? "s" : "") + " seleccionado" + (seleccionEtiquetas.size !== 1 ? "s" : "");
}

function seleccionarTodosEtiquetas() {
    const prods = productosDisponibles;
    if (seleccionEtiquetas.size === prods.length) {
        seleccionEtiquetas.clear();
    } else {
        prods.forEach(p => seleccionEtiquetas.add(p.codigo));
    }
    renderGridEtiquetas(prods);
}

function filtrarProductosEtiquetas() {
    const busq = document.getElementById("bus-etiquetas").value.toLowerCase();
    const filtrados = productosDisponibles.filter(p =>
        (p.nombre||"").toLowerCase().includes(busq) || (p.codigo||"").toLowerCase().includes(busq)
    );
    renderGridEtiquetas(filtrados);
}

function abreviarMaterial(mat) {
    if (!mat) return mat;
    return mat.replace(/Plata 925 con Oro Laminado/gi, 'Plata 925 / Oro Lam.')
              .replace(/Laminado/gi, 'Lam.');
}

function extraerMaterial(nombre, descripcion) {
    const texto = ((nombre || "") + " " + (descripcion || "")).toLowerCase();
    if (texto.includes("plata fina")) return "Plata Fina 925";
    if (texto.includes("oro laminado") || texto.includes("gold lam")) return "Plata 925 con Oro Laminado";
    if (texto.includes("oro")) return "Oro";
    if (texto.includes("reloj") || texto.includes("watch")) return "Reloj";
    if (texto.includes("oro laminado") || texto.includes("oro lam")) return "Plata 925 + Oro Lam.";
    if (texto.includes("acero")) return "Acero 316L";
    if (texto.includes("925")) return "Plata 925";
    if (texto.includes("plata")) return "Plata 925";
    // Si no detecta del nombre, buscar en descripcion del producto
    return "";
}

// ── Helpers: estado de etiquetas impresas por código ──────────────────────
function _getEtiqImpr() { try { return new Set(JSON.parse(localStorage.getItem('verex_etiq_impr') || '[]')); } catch { return new Set(); } }
function estaEtiquetaImpresa(codigo) { return _getEtiqImpr().has(codigo); }
function marcarEtiquetaImpresa(codigo) { const s = _getEtiqImpr(); s.add(codigo); localStorage.setItem('verex_etiq_impr', JSON.stringify([...s])); }
function desmarcarEtiquetaImpresa(codigo) { const s = _getEtiqImpr(); s.delete(codigo); localStorage.setItem('verex_etiq_impr', JSON.stringify([...s])); }

let _codigosImpresionRapida = null;

function imprimirEtiquetaStock(codigo) {
    if (estaEtiquetaImpresa(codigo)) {
        if (!confirm(`¿Marcar "${codigo}" como pendiente de imprimir?`)) return;
        desmarcarEtiquetaImpresa(codigo);
        renderStock(stockData);
        return;
    }
    _colaEtiquetas = [{ codigo, qty: 1 }];
    _codigosImpresionRapida = [codigo];
    _formatoImpresion = localStorage.getItem('verex_formato_impresion') || 'mini';
    abrirModalImpresion();
}
// ── Fin helpers etiquetas ──────────────────────────────────────────────────

async function generarEtiquetas() {
    if (seleccionEtiquetas.size === 0) { toast("⚠️ Selecciona al menos un producto"); return; }

    // Siempre abrir el modal — el check del servidor se hace al presionar Imprimir
    const codigosEtiq = productosDisponibles
        .filter(p => seleccionEtiquetas.has(p.codigo))
        .map(p => p.codigo);
    const colaAnterior = [..._colaEtiquetas];
    codigosEtiq.forEach(c => { if (!_colaEtiquetas.find(x => x.codigo === c)) _colaEtiquetas.push({ codigo: c, qty: 1 }); });
    _formatoImpresion = localStorage.getItem('verex_formato_impresion') || 'mini';
    abrirModalImpresion();
    const modal = document.getElementById('modal-print-server');
    if (modal) modal._onclose = () => { _colaEtiquetas = colaAnterior; };
    return;

    // ── fallback PDF (alcanzable solo si se elimina el return arriba) ──────

    const prods = productosDisponibles.filter(p => seleccionEtiquetas.has(p.codigo));
    toast("⏳ Generando etiquetas...");

    // Generate QR images for all products first
    const qrImages = {};
    await Promise.all(prods.map(p => new Promise(resolve => {
        const div = document.createElement("div");
        div.style.display = "none";
        document.body.appendChild(div);
        try {
            const qr = new QRCode(div, {
                text: p.codigo,
                width: 120, height: 120,
                colorDark: "#000000", colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });
            setTimeout(() => {
                const img = div.querySelector("img") || div.querySelector("canvas");
                if (img) {
                    if (img.tagName === "CANVAS") qrImages[p.codigo] = img.toDataURL("image/png");
                    else qrImages[p.codigo] = img.src;
                }
                document.body.removeChild(div);
                resolve();
            }, 100);
        } catch(e) { document.body.removeChild(div); resolve(); }
    })));

    const { jsPDF } = window.jspdf;
    const W = 60, H = 25;
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });

    prods.forEach((p, idx) => {
        if (idx > 0) doc.addPage([W, H], 'landscape');
        _dibujarEtiqueta60x25(doc, p, qrImages[p.codigo], W, H);
    });

    doc.save("Etiquetas_VEREX.pdf");
    toast("✅ " + prods.length + " etiquetas generadas — 60×25mm");
}
