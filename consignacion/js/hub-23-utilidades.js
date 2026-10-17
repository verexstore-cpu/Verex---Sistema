// Hub VEREX — Detector de escáner, modales, avisos (toast) y selección de tallas
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── DETECTOR GLOBAL DE SCANNER ───────────────────────────────────────
// Captura el patrón scanner (ráfaga rápida + Enter) y lo dirige al campo
// de búsqueda activo (stock o etiquetas) sin necesidad de tenerlo enfocado
;(function() {
    let _scanBuf = "", _scanT = 0;
    document.addEventListener("keydown", function(e) {
        // Nueva Entrega tiene MÁXIMA prioridad: nunca debe perder un escaneo
        // por culpa del chequeo de foco/modal (eso causaba escaneos que no
        // dejaban NINGÚN rastro — ni éxito ni error — porque el evento se
        // ignoraba entero antes de llegar al buffer). Se revisa esto PRIMERO,
        // antes de cualquier exclusión pensada para las pantallas de Stock/Etiquetas.
        const entregaVis = document.getElementById("pantalla-entrega")?.style.display === "block";
        const verificandoBorrador = typeof _modoVerificarBorrador !== "undefined" && _modoVerificarBorrador;
        // Registrar Devolución abierto: el lector físico (USB/Bluetooth) cuenta cada pieza igual que la
        // cámara. Sin esto el escaneo caía en la búsqueda de Stock/Etiquetas que está detrás del modal.
        const devolucionVis = !!document.getElementById("modal-devolucion")?.classList.contains("active");

        if (!entregaVis && !verificandoBorrador) {
            const activeId = document.activeElement?.id || "";
            // Solo ignorar si el foco está en un input de otro módulo (modal, precio, etc.)
            // Los campos de búsqueda de stock/etiquetas SÍ deben pasar
            const inputsExcluidos = ["sn-multicod-input","sn-codigo-manual","sn-nombre","sn-precio","sn-precio-dama","sn-precio-caballero",
                "sn-cantidad","sn-desc","sn-desc-tienda","sn-caract","inp-pass",
                "np-nombre","np-desc","np-precio","np-codigo","np-qty","np-caract",
                "ep-codigo","ep-nombre","ep-desc","ep-precio","ep-precio-dama","ep-precio-caballero","ep-caract","ep-existencia",
                "lote-precio-global"];
            if (inputsExcluidos.includes(activeId)) return;
            // Ignorar si hay un modal visible con un textarea/input activo
            const modalAbierto = document.querySelector(".modal-overlay.active input:focus, .modal-overlay[style*='flex'] input:focus");
            if (modalAbierto) return;
        }

        const now = Date.now();
        if (now - _scanT > 150) _scanBuf = "";
        _scanT = now;

        if (e.key === "Enter") {
            // Si el "Enter" del lector cae mientras un botón tiene el foco
            // (ej. justo después de tocar "Verificar conteo"), el navegador
            // lo trata como un click en ese botón. Bloquearlo evita que se
            // reactive/reinicie el modo de verificación a mitad de escaneo.
            if (verificandoBorrador || entregaVis || devolucionVis) e.preventDefault();
            const cod = _scanBuf.trim().toUpperCase();
            _scanBuf = "";
            if (cod.length < 3) {
                // Lectura demasiado corta/corrupta — antes se descartaba sin
                // dejar rastro; en Nueva Entrega se registra igual para que
                // el escaneo perdido no desaparezca en silencio.
                if (entregaVis && cod.length > 0 && typeof _registrarEscaneoFallido === "function") {
                    _registrarEscaneoFallido((cod || "(vacío)") + " (lectura muy corta/corrupta)");
                }
                return;
            }

            if (devolucionVis) {
                e.preventDefault();          // que el Enter del lector no "toque" el botón que tenga el foco
                _onScanDevolucion(cod);
                return;
            }

            if (verificandoBorrador) {
                _onScanVerificarBorrador(cod);
                return;
            }

            if (entregaVis) {
                // Nueva Entrega: el lector físico agrega directo al carrito/borrador,
                // sin necesidad de tocar "+" manualmente por cada producto.
                const busEntrega = document.getElementById("bus-entrega");
                if (busEntrega) busEntrega.value = "";
                _onScanQREntrega(cod);
                return;
            }
            const tabStock = document.getElementById("tab-content-stock");
            const tabEtiq  = document.getElementById("tab-content-etiquetas");
            const stockVis = tabStock && tabStock.style.display !== "none";
            const etiqVis  = tabEtiq  && tabEtiq.style.display  !== "none";
            if (stockVis) {
                buscarStockPorScanner(cod);
            } else if (etiqVis) {
                buscarEtiquetasPorScanner(cod);
            }
        } else if (e.key.length === 1) {
            _scanBuf += e.key;
        }
    });
})();

window.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("inp-foto").addEventListener("change", function() { cargarFoto(this); });
    cargarCategoriasPersonalizadas();

    // Auto-login si hay un pase de sesión vigente (8 horas desde que se entró).
    const pase = sesionHubGuardada();
    if (pase) { entrarHub(pase); return; }
    // Sin sesión válida (o una contraseña guardada por la versión anterior del Hub): se borra.
    localStorage.removeItem("vx_consig_session");
    localStorage.removeItem("vx_consig_session_exp");
    // Sin sesión válida → mostrar login
    document.getElementById("pantalla-login").style.display = "flex";
});

// ── FUNCIONES COMPLEMENTARIAS ────────────────────────────────────────

let _materialLote = null;

function seleccionarMaterialLote(btn) {
    document.querySelectorAll(".material-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    btn.style.background = "var(--dorado)"; btn.style.color = "var(--negro)"; btn.style.borderColor = "var(--dorado)";
    _materialLote = btn.dataset.material;
}

function seleccionarMaterialSingle(btn) {
    document.querySelectorAll(".mat-single-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; });
    btn.style.background = "var(--dorado)"; btn.style.color = "var(--negro)";
    window._materialProducto = btn.dataset.mat;
}

// ── Tallas múltiples para Agregar individual ─────────────────────────
window._tallasQtyIndividual = {}; // { 7: 2, 8: 1 }

function renderTallasIndividual() {
    const wrap = document.getElementById("np-tallas-wrap");
    if (!wrap) return;
    const tqs = window._tallasQtyIndividual;
    const tallasBtns = [5,6,7,8,9,10,11,12,13,14];
    wrap.innerHTML = tallasBtns.map(t => {
        const sel = tqs[t] !== undefined;
        const qty = tqs[t] || 1;
        if (sel) {
            return '<div style="display:inline-flex;align-items:center;gap:2px;background:var(--dorado);border-radius:6px;padding:2px 4px;">' +
                '<button type="button" onclick="cambiarQtyTallaInd(' + t + ',-1)" style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">−</button>' +
                '<span style="font-size:11px;font-weight:700;color:var(--negro);min-width:28px;text-align:center;">T' + t + '<br><span style="font-size:10px;">×' + qty + '</span></span>' +
                '<button type="button" onclick="cambiarQtyTallaInd(' + t + ',1)" style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">+</button>' +
                '<button type="button" onclick="toggleTallaInd(' + t + ')" style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1;">✕</button>' +
                '</div>';
        } else {
            return '<button type="button" onclick="toggleTallaInd(' + t + ')" style="padding:5px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--gris);color:var(--blanco);font-size:11px;font-weight:600;cursor:pointer;">T' + t + '</button>';
        }
    }).join('');
    const total = Object.values(tqs).reduce((s, q) => s + q, 0);
    const totalDiv = document.getElementById("np-tallas-total");
    const totalNum = document.getElementById("np-tallas-total-num");
    if (totalDiv) totalDiv.style.display = total > 0 ? "block" : "none";
    if (totalNum) totalNum.textContent = total;
    // Mostrar/ocultar campo cantidad según si hay tallas
    const qtyEl = document.getElementById("np-qty");
    if (qtyEl) qtyEl.style.display = total > 0 ? "none" : "block";
}

function toggleTallaInd(t) {
    if (window._tallasQtyIndividual[t] !== undefined) {
        delete window._tallasQtyIndividual[t];
    } else {
        window._tallasQtyIndividual[t] = 1;
    }
    renderTallasIndividual();
}

function cambiarQtyTallaInd(t, delta) {
    const actual = window._tallasQtyIndividual[t] || 1;
    const nuevo = actual + delta;
    if (nuevo <= 0) { delete window._tallasQtyIndividual[t]; }
    else { window._tallasQtyIndividual[t] = nuevo; }
    renderTallasIndividual();
}

function agregarTallaEspecialInd() {
    const inp = document.getElementById("np-talla-especial");
    const val = parseFloat(inp.value);
    if (!val || val < 4 || val > 15) { toast("⚠️ Ingresa una talla válida (4–15)"); return; }
    const key = String(val); // ej: "7.5"
    if (window._tallasQtyIndividual[key] !== undefined) { toast("⚠️ Esa talla ya está agregada"); inp.value = ""; return; }
    window._tallasQtyIndividual[key] = 1;
    inp.value = "";
    renderTallasIndividual();
}

// Compatibilidad legacy (ya no se usa pero evita errores)
function seleccionarTalla(talla) { toggleTallaInd(talla); }

function mostrarSelectorTalla(cat) {
    const container = document.getElementById("np-talla-container");
    if (container) container.style.display = (cat === "AN" || cat === "CJ") ? "block" : "none";
    const matContainer = document.getElementById("material-single-container");
    if (matContainer) matContainer.style.display = cat ? "block" : "none";
    // Resetear tallas al cambiar categoría
    window._tallasQtyIndividual = {};
    renderTallasIndividual();
}

function toggleTallaLote(i, cat) {
    const el = document.getElementById("talla-lote-" + i);
    if (el) el.style.display = (cat === "AN" || cat === "CJ") ? "flex" : "none";
}

// tallasQty = { 7: 2, 8: 1, 9: 2 } — cantidad individual por talla
function agregarTallaEspecialLote(i) {
    const inp = document.getElementById("talla-esp-lote-" + i);
    if (!inp) return;
    const val = parseFloat(inp.value);
    if (!val || val < 4 || val > 15) { toast("⚠️ Ingresa una talla válida (4–15)"); return; }
    const key = String(val); // ej: "7.5"
    if (!loteProductos[i].tallasQty) loteProductos[i].tallasQty = {};
    if (loteProductos[i].tallasQty[key] !== undefined) { toast("⚠️ Esa talla ya está agregada"); inp.value = ""; return; }
    loteProductos[i].tallasQty[key] = 1;
    loteProductos[i].tallas = Object.keys(loteProductos[i].tallasQty);
    inp.value = "";
    renderLoteProductos();
}

function toggleTallaLoteMulti(i, talla) {
    if (!loteProductos[i].tallasQty) loteProductos[i].tallasQty = {};
    if (loteProductos[i].tallasQty[talla] !== undefined) {
        delete loteProductos[i].tallasQty[talla]; // deseleccionar
    } else {
        loteProductos[i].tallasQty[talla] = 1;    // seleccionar con cantidad 1
    }
    // Compatibilidad: mantener array tallas sincronizado para validaciones
    loteProductos[i].tallas = Object.keys(loteProductos[i].tallasQty).map(Number);
    renderLoteProductos();
}

function cambiarCantidadTalla(i, talla, delta) {
    if (!loteProductos[i].tallasQty) return;
    const actual = loteProductos[i].tallasQty[talla] || 1;
    const nueva  = Math.max(1, actual + delta);
    loteProductos[i].tallasQty[talla] = nueva;
    // Actualizar cantidad individual sin re-render completo
    const elQty = document.getElementById("qty-talla-" + i + "-" + talla);
    if (elQty) elQty.textContent = "×" + nueva;
    // Actualizar total automático
    const total = Object.values(loteProductos[i].tallasQty).reduce((s, q) => s + q, 0);
    const elTotal = document.getElementById("total-tallas-" + i);
    if (elTotal) elTotal.textContent = total + " piezas";
}

function seleccionarTallaLote(i, talla) {
    if (!loteProductos[i].tallasQty) loteProductos[i].tallasQty = {};
    if (loteProductos[i].tallasQty[talla] === undefined) loteProductos[i].tallasQty[talla] = 1;
    loteProductos[i].tallas = Object.keys(loteProductos[i].tallasQty).map(Number);
    renderLoteProductos();
}

function abrirModalLote() {
    loteFotos = []; loteProductos = []; _materialLote = null;
    document.getElementById("lote-paso1").style.display = "block";
    document.getElementById("lote-paso2").style.display = "none";
    document.getElementById("lote-preview").innerHTML = "";
    document.getElementById("btn-analizar-lote").style.display = "none";
    document.getElementById("inp-lote-fotos").value = "";
    document.querySelectorAll(".material-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    abrirModal("modal-lote");
}

function abrirSolicitudes() {
    abrirModal("modal-solicitudes");
    cargarSolicitudes(true);
}

let _entregasConfirmadasMap = {};

// Regenera el mismo PDF de recibo a partir de lo guardado permanentemente
// en "entregas" (items + firma) — así no se pierde si el admin cerró el
// navegador sin guardar el PDF la primera vez que se generó.
function redescargarReciboEntrega(entId) {
    const registro = _entregasConfirmadasMap[entId];
    if (!registro) { toast("⚠️ No se encontró el registro del recibo"); return; }
    const { e, items, vend } = registro;
    const vendedorPDF = vend || { nombre: e.vendedor, codigo: e.vendedor, telefono: "" };
    try {
        generarReciboPDF(vendedorPDF, items, e.firmaImg, e.codigoRecibo);
    } catch(err) {
        toast("⚠️ Error al generar PDF: " + err.message);
    }
}

async function descartarEntregaConfirmada(id) {
    if (!confirm("¿Descartar esta notificación de entrega confirmada? (ej. si fue una prueba) — solo borra el aviso, no toca stock ni consignación.")) return;
    const res = await apiPost({ accion: "DESCARTAR_ENTREGA_CONFIRMADA", id });
    if (res && res.ok !== false) {
        toast("✕ Notificación descartada");
        cargarSolicitudes(true);
    } else {
        toast("⚠️ " + (res?.error || "No se pudo descartar"), "#c0392b");
    }
}

async function cargarSolicitudes(mostrar) {
    try {
        const [resSol, resConf] = await Promise.all([
            apiPost({ accion: "GET_SOLICITUDES_CORRECCION" }),
            apiPost({ accion: "GET_ENTREGAS_CONFIRMADAS" })
        ]);
        const solicitudes = resSol.solicitudes || [];
        const confirmadas = resConf.entregas || [];
        const totalBadge = solicitudes.length + confirmadas.length;
        const badge = document.getElementById("badge-solicitudes");
        if (totalBadge > 0) {
            badge.style.display = "flex";
            badge.textContent = totalBadge;
        } else {
            badge.style.display = "none";
        }
        if (!mostrar) return;
        const lista = document.getElementById("lista-solicitudes");
        if (!lista) return;
        let html = "";
        _entregasConfirmadasMap = {};
        if (confirmadas.length) {
            confirmadas.forEach(e => {
                const fecha = e.fechaConfirmacion ? new Date(e.fechaConfirmacion).toLocaleDateString("es-SV") : "—";
                const vend = vendedores.find(v => v.codigo === e.vendedor);
                let items = [];
                try { items = typeof e.items === "string" ? JSON.parse(e.items) : (e.items || []); } catch(_) {}
                _entregasConfirmadasMap[e.id] = { e, items, vend };
                html += `<div style="background:rgba(45,122,79,0.15);border:1px solid #2d7a4f;border-radius:10px;padding:14px;margin-bottom:10px;">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:18px;">✅</span>
                            <div>
                                <div style="font-size:13px;font-weight:600;color:#4caf82;">${sanitizar(vend?.nombre || e.vendedor)} confirmó recepción</div>
                                <div style="font-size:11px;color:var(--plateado);">${sanitizar(fecha)} · Código: <strong style="color:var(--dorado);">${sanitizar(e.codigoRecibo)}</strong></div>
                            </div>
                        </div>
                        <button onclick="descartarEntregaConfirmada('${sanitizar(e.id)}')" title="Descartar esta notificación" style="background:none;border:none;color:var(--plateado);font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
                    </div>
                    <div style="font-size:12px;color:var(--plateado);margin-bottom:8px;">${items.length} producto(s): ${items.slice(0,3).map(i=>sanitizar(i.nombre)).join(", ")}</div>
                    ${e.firmaImg ? `<button onclick="redescargarReciboEntrega('${sanitizar(e.id)}')" style="padding:6px 12px;border:none;border-radius:6px;background:#2d7a4f;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">📄 Descargar recibo PDF</button>` : ''}
                </div>`;
            });
        }
        if (solicitudes.length) {
            html += solicitudes.map(s => `
                <div style="background:var(--gris2);border-radius:10px;padding:14px;margin-bottom:10px;">
                    <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${sanitizar(s.vendedor||"")} · ${sanitizar(s.codigo||"")}</div>
                    <div style="font-size:12px;color:var(--plateado);margin-bottom:10px;">${sanitizar(s.motivo||"")}</div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-verde" style="padding:6px 12px;font-size:12px;" onclick="aprobarCorreccion(${jsArg(s.id)})">✅ Aprobar</button>
                        <button class="btn btn-rojo" style="padding:6px 12px;font-size:12px;" onclick="rechazarCorreccion(${jsArg(s.id)})">❌ Rechazar</button>
                    </div>
                </div>`).join('');
        }
        if (!html) html = '<p style="color:var(--plateado);font-size:13px;padding:10px;">No hay notificaciones pendientes.</p>';
        lista.innerHTML = html;
    } catch(e) {
        const lista = document.getElementById("lista-solicitudes");
        if (lista) lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;padding:10px;">No hay notificaciones.</p>';
    }
}

async function aprobarCorreccion(id) {
    await apiPost({ accion: "APROBAR_CORRECCION_VENTA", id });
    toast("✅ Corrección aprobada");
    cargarSolicitudes(true);
}

async function rechazarCorreccion(id) {
    await apiPost({ accion: "RECHAZAR_CORRECCION_VENTA", id });
    toast("❌ Corrección rechazada");
    cargarSolicitudes(true);
}

function abrirCambiarClave() {
    document.getElementById("cons-pass-actual").value = "";
    document.getElementById("cons-pass-nueva").value = "";
    document.getElementById("cons-pass-confirmar").value = "";
    document.getElementById("cons-pass-error").style.display = "none";
    abrirModal("modal-cambiar-clave");
}

async function guardarNuevaClaveConsignacion() {
    const actual = document.getElementById("cons-pass-actual").value;
    const nueva = document.getElementById("cons-pass-nueva").value;
    const confirmar = document.getElementById("cons-pass-confirmar").value;
    const errorEl = document.getElementById("cons-pass-error");
    // La contraseña actual se comprueba con el servidor (antes contra un hash fijo en el código).
    const chk = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ accion: "VERIFICAR_PASS", _pass: await hashStr(actual) }) })
        .then(r => r.json()).catch(() => ({ ok: false }));
    if (!chk.ok) { errorEl.textContent = "⚠️ Contraseña actual incorrecta"; errorEl.style.display = "block"; return; }
    if (!nueva || nueva.length < 4) { errorEl.textContent = "⚠️ Mínimo 4 caracteres"; errorEl.style.display = "block"; return; }
    if (nueva !== confirmar) { errorEl.textContent = "⚠️ Las contraseñas no coinciden"; errorEl.style.display = "block"; return; }
    errorEl.style.display = "none";
    const nuevoHash = await hashStr(nueva);
    const r = await apiPost({ accion: "ACTUALIZAR_PASS_HASH", nuevoHash }).catch(() => ({ ok: false }));
    if (!r.ok) { errorEl.textContent = "⚠️ No se pudo guardar"; errorEl.style.display = "block"; return; }
    cerrarModal("modal-cambiar-clave");
    // Cambiar la contraseña cierra todas las sesiones (también esta).
    alert("✅ Contraseña actualizada. Se cerraron todas las sesiones: vuelve a entrar con la contraseña nueva.");
    cerrarSesion();
}

async function verHistorialEntregas() {
    abrirModal("modal-historial-entregas");
    const lista = document.getElementById("lista-historial-entregas");
    lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await apiPost({ accion: "GET_HISTORIAL_CORTES", vendedor: vendedorActual.codigo });
        const entregas = res.historial || [];
        if (!entregas.length) {
            lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay historial de entregas.</p>';
            return;
        }
        lista.innerHTML = entregas.reverse().map(e => {
            const fecha = e.fecha ? new Date(e.fecha).toLocaleDateString("es-SV") : "—";
            return `<div style="background:var(--gris2);border-radius:10px;padding:14px;margin-bottom:10px;">
                <div style="font-size:12px;color:var(--dorado);margin-bottom:6px;">${fecha}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;">
                    <div><div style="color:var(--plateado);">Total vendido</div><div style="font-weight:700;">$${parseFloat(e.totalVendido||0).toFixed(2)}</div></div>
                    <div><div style="color:var(--plateado);">Ganancia</div><div style="font-weight:700;color:var(--dorado);">$${parseFloat(e.gananciaVendedor||0).toFixed(2)}</div></div>
                    <div><div style="color:var(--plateado);">A VEREX</div><div style="font-weight:700;">$${parseFloat(e.aPagarVerex||0).toFixed(2)}</div></div>
                </div>
            </div>`;
        }).join('');
    } catch(e) {
        lista.innerHTML = '<p style="color:#e74c3c;font-size:13px;">Error al cargar.</p>';
    }
}
