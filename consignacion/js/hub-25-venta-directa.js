// Hub VEREX — Venta directa: inicio, descuentos, promo general, clientes e historial
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── VENTA DIRECTA ────────────────────────────────────────────────────
const DEPARTAMENTOS_VD = ["Ahuachapán","Cabañas","Chalatenango","Cuscatlán","La Libertad","La Paz","La Unión","Morazán","San Miguel","San Salvador","San Vicente","Santa Ana","Sonsonate","Usulután"];
(function poblarDepartamentosVD(){
    const sel = document.getElementById("vd-cliente-departamento");
    if (sel) DEPARTAMENTOS_VD.forEach(d => sel.insertAdjacentHTML("beforeend", `<option value="${d}">${d}</option>`));
})();
let _vdCarrito    = {};   // { codigo: { prod, qty } }
let _vdTipo       = 'contado';
let _vdMetodoPago = 'efectivo'; // 'efectivo' | 'tarjeta' | 'transferencia' — solo aplica a contado
let _creditosVD   = [];
let _vdModoDescuento  = 'monto'; // 'monto' | 'porcentaje'
let _vdEmpresaEnvio   = '';

function selEmpresaEnvio(empresa) {
    _vdEmpresaEnvio = empresa;
    const empresas = { 'C807 Xpress': 'btn-empresa-c807', 'Trucker': 'btn-empresa-trucker' };
    Object.entries(empresas).forEach(([nombre, btnId]) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const activo = nombre === empresa;
        btn.style.background = activo ? 'var(--dorado)' : '#2a2a2a';
        btn.style.color      = activo ? '#000' : '#888';
    });
}

function setModoDescuento(modo) {
    _vdModoDescuento = modo;
    document.getElementById("btn-desc-monto").style.background = modo === 'monto' ? "var(--dorado)" : "#2a2a2a";
    document.getElementById("btn-desc-monto").style.color      = modo === 'monto' ? "#000" : "#888";
    document.getElementById("btn-desc-pct").style.background   = modo === 'porcentaje' ? "var(--dorado)" : "#2a2a2a";
    document.getElementById("btn-desc-pct").style.color        = modo === 'porcentaje' ? "#000" : "#888";
    document.getElementById("vd-desc-simbolo").textContent     = modo === 'monto' ? "$" : "%";
    document.getElementById("vd-descuento-val").placeholder    = modo === 'monto' ? "0.00" : "0";
    aplicarDescuentoVD();
}

function aplicarDescuentoVD() {
    renderCarritoVD();
}

function limpiarDescuentoVD() {
    document.getElementById("vd-descuento-val").value = "";
    renderCarritoVD();
}

// ── Promo general en Venta Directa ──────────────────────────────────────────
// Aplica sobre el carrito de Venta Directa (_vdCarrito) la misma promo de
// carrito (2x50 / 3x2 / montoFijo / escalonado) y las mismas fórmulas que usa
// el catálogo público — así el mostrador cobra igual que lo que vería el
// cliente si comprara por el link. Es un botón, no algo automático: al
// tocarlo se calcula y se deja escrito en el campo de descuento de siempre,
// así se puede ajustar o quitar como cualquier descuento manual.
function _calcularPromoGeneralVD() {
    const pc = promoGeneral?.promoCarrito;
    if (!promoGeneral?.activa || !pc?.tipo) return { error: "No hay una promo general activa ahora mismo." };
    const unidades = [];
    Object.values(_vdCarrito).forEach(({ prod, qty }) => { for (let i = 0; i < qty; i++) unidades.push(parseFloat(prod.precio) || 0); });
    if (!unidades.length) return { error: "Agrega productos al carrito primero." };
    unidades.sort((a, b) => b - a);
    const subtotal = unidades.reduce((s, p) => s + p, 0);

    if (pc.tipo === "2x50") {
        if (unidades.length < 2) return { error: "La promo 2do al 50% necesita al menos 2 piezas en el carrito." };
        let descuento = 0;
        unidades.forEach((p, idx) => { if (idx % 2 === 1) descuento += p * 0.5; });
        return { descuento, etiqueta: "2do producto al 50%" };
    }
    if (pc.tipo === "3x2") {
        if (unidades.length < 3) return { error: "La promo 3x2 necesita al menos 3 piezas en el carrito." };
        let descuento = 0;
        unidades.forEach((p, idx) => { if (idx % 3 === 2) descuento += p; });
        return { descuento, etiqueta: "3x2 (la pieza más barata de cada trío, gratis)" };
    }
    if (pc.tipo === "montoFijo") {
        const base = parseFloat(pc.montoFijo) || 0;
        const minimo = parseFloat(pc.minimoCompra) || 0;
        if (minimo > 0) {
            const tramos = Math.floor(subtotal / minimo);
            if (tramos < 1) return { error: `Esta promo aplica a partir de $${minimo.toFixed(2)} de compra (llevas $${subtotal.toFixed(2)}).` };
            const monto = Math.min(base * tramos, subtotal);
            return { descuento: monto, etiqueta: `$${base.toFixed(2)} de descuento (${tramos}× por cada $${minimo.toFixed(2)})` };
        }
        return { descuento: Math.min(base, subtotal), etiqueta: `$${base.toFixed(2)} de descuento fijo` };
    }
    if (pc.tipo === "escalonado") {
        const escalones = [...(pc.escalones || [])].sort((a, b) => b.minCant - a.minCant);
        const tier = escalones.find(e => unidades.length >= e.minCant);
        if (!tier) {
            const minReq = Math.min(...(pc.escalones || []).map(e => e.minCant));
            return { error: `Esta promo necesita al menos ${minReq} piezas (llevas ${unidades.length}).` };
        }
        return { descuento: subtotal * (tier.pct / 100), etiqueta: `${tier.pct}% por llevar ${unidades.length} piezas` };
    }
    return { error: "Tipo de promo desconocido." };
}

let _promoGeneralVDCargando = false;
async function aplicarPromoGeneralVD() {
    if (_promoGeneralVDCargando) return;
    // No usar la promo que ya estaba en memoria (llega hasta 10s tarde por la
    // sincronización de fondo) — se pide la más reciente justo al tocar el
    // botón, con GET_CONFIG (liviano: solo la config, no todo el inventario).
    const btn = document.querySelector("#vd-promo-general-wrap button");
    const txtOriginal = btn?.textContent;
    _promoGeneralVDCargando = true;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Verificando promo…"; }
    try {
        const fresco = await apiPost({ accion: "GET_CONFIG" });
        if (fresco?.ok) promoGeneral = fresco.config?.promoGeneral || null;
    } catch (_) { /* si falla la consulta, se sigue con lo que ya había en memoria */ }
    _renderBotonPromoGeneralVD(); // por si justo ahora se apagó/cambió, oculta el botón si ya no aplica
    _promoGeneralVDCargando = false;
    if (btn) { btn.disabled = false; btn.textContent = txtOriginal; }

    const r = _calcularPromoGeneralVD();
    if (r.error) { toast("⚠️ " + r.error, "#f97316"); return; }
    setModoDescuento("monto");
    document.getElementById("vd-descuento-val").value = r.descuento.toFixed(2);
    aplicarDescuentoVD();
    toast(`🎁 Promo general aplicada: ${r.etiqueta} (−$${r.descuento.toFixed(2)})`, "#22c55e");
}

// Solo se muestra si hay una promo general activa configurada; el botón igual
// avisa con un toast si el carrito todavía no cumple sus condiciones.
function _renderBotonPromoGeneralVD() {
    const wrap = document.getElementById("vd-promo-general-wrap");
    if (!wrap) return;
    wrap.style.display = (promoGeneral?.activa && promoGeneral?.promoCarrito?.tipo) ? "block" : "none";
}

function _calcularDescuento(subtotal) {
    const val = parseFloat(document.getElementById("vd-descuento-val")?.value || 0) || 0;
    if (val <= 0) return 0;
    if (_vdModoDescuento === 'porcentaje') return Math.min(subtotal, subtotal * val / 100);
    return Math.min(subtotal, val);
}
let _abonoVentaId = null;

async function iniciarVentaDirecta() {
    if (stockData.length === 0) {
        try {
            const res = await apiPost({ accion: "GET_STOCK" });
            stockData = res.stock || [];
        } catch(e) {}
    }
    filtrarVD();
    cargarCreditosPendientes();
    cargarClientesVD();
    cargarLeadsCatalogoVD();
    const selFormato = document.getElementById("sel-formato-recibo");
    if (selFormato) selFormato.value = localStorage.getItem("verex-formato-recibo") || "a5";
    seleccionarMetodoPagoVD("efectivo");
}

async function cargarLeadsCatalogoVD() {
    const card = document.getElementById("card-leads-catalogo-vd");
    const lista = document.getElementById("lista-leads-catalogo-vd");
    if (!card || !lista) return;
    try {
        const res = await apiPost({ accion: "GET_LEADS_ADMIN" });
        const leads = (res.leads || []).filter(l =>
            (!l.afiliado || l.afiliado === "") &&
            l.estado === "interesado" &&
            l.nombreCliente
        );
        if (leads.length === 0) { card.style.display = "none"; return; }
        card.style.display = "block";
        lista.innerHTML = leads.map(l => {
            const img = l.foto ? `<img src="${sanitizar(l.foto)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;">` : `<div style="width:48px;height:48px;border-radius:8px;background:#2a2a2a;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">💍</div>`;
            const tel = l.telefonoCliente ? `<div style="font-size:10.5px;color:#888;">📱 ${sanitizar(l.telefonoCliente)}</div>` : "";
            const precio = l.precio ? `<div style="font-size:12px;font-weight:800;color:var(--dorado);">$${parseFloat(l.precio).toFixed(2)}</div>` : "";
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                ${img}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(l.nombre||l.codigo)}</div>
                    ${precio}
                    <div style="font-size:11px;color:#ccc;font-weight:600;">👤 ${sanitizar(l.nombreCliente)}</div>
                    ${tel}
                </div>
                <button onclick="registrarVentaDesdeLead('${sanitizar(l.id)}')" style="flex-shrink:0;padding:7px 11px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#C9A84C,#e8c96b);color:#111;border:none;border-radius:8px;cursor:pointer;">➕ Registrar</button>
                <button onclick="descartarLeadCatalogoVD('${sanitizar(l.id)}')" title="Descartar (no era un pedido real)" style="flex-shrink:0;padding:7px 9px;font-size:11px;font-weight:700;background:#3a1a1a;color:#e74c3c;border:1px solid #5a2a2a;border-radius:8px;cursor:pointer;">✕</button>
            </div>`;
        }).join("");
    } catch(e) { card.style.display = "none"; }
}

// Descarta un lead del catálogo que no era un pedido real (ej. prueba,
// duplicado) — lo cancela en vez de borrarlo del todo, mismo mecanismo que
// ya usa el resto del sistema para leads no válidos.
async function descartarLeadCatalogoVD(id) {
    if (!confirm("¿Descartar este lead? No aparecerá más en la lista de pendientes por registrar.")) return;
    try {
        await apiPost({ accion: "CANCELAR_LEAD", id });
        toast("🗑️ Lead descartado");
        cargarLeadsCatalogoVD();
    } catch(e) {
        toast("⚠️ Error al descartar", "#c0392b");
    }
}

// Directorio de clientes para autocompletar nombre por teléfono en Venta
// Directa — evita reteclear los datos de un cliente que ya compró antes.
// Se carga una sola vez por sesión (no cambia seguido) y se cachea en memoria.
let _clientesVDCache = null;
async function cargarClientesVD() {
    if (_clientesVDCache) return;
    try {
        const res = await apiPost({ accion: "GET_CLIENTES" });
        _clientesVDCache = res.clientes || [];
    } catch(e) { _clientesVDCache = []; }
}

function autocompletarClienteVD() {
    const telInput = document.getElementById("vd-cliente-tel");
    const nombreInput = document.getElementById("vd-cliente-nombre");
    if (!telInput || !nombreInput || !_clientesVDCache) return;
    const norm = t => String(t||"").replace(/\D/g,"");
    const tel = norm(telInput.value);
    if (tel.length < 8) return; // aún incompleto, no buscar todavía
    const match = _clientesVDCache.find(c => norm(c.telefono) === tel);
    if (match && !nombreInput.value.trim()) {
        nombreInput.value = match.nombre || "";
        toast(`👤 Cliente reconocido: ${match.nombre}`);
        const dirInput = document.getElementById("vd-cliente-direccion");
        if (dirInput && !dirInput.value.trim() && match.direccion) {
            dirInput.value = [match.direccion, match.municipio].filter(Boolean).join(", ");
        }
        const depSelect = document.getElementById("vd-cliente-departamento");
        if (depSelect && !depSelect.value && match.departamento) depSelect.value = match.departamento;
    }
}

function filtrarVD() {
    const q = (document.getElementById("bus-vd")?.value || "").toLowerCase();
    const prods = stockData.filter(s => {
        // Bodega + tienda: ambas son vendibles en Venta Directa (ver _onScanVD/agregarAlVD).
        const disp = parseInt(s.stock_bodega || 0) + parseInt(s.stock_tienda || 0);
        if (disp <= 0) return false;
        if (!q) return true;
        return (s.codigo || "").toLowerCase().includes(q) || (s.nombre || "").toLowerCase().includes(q);
    });
    renderGridVD(prods);
}

function renderGridVD(prods) {
    const grid = document.getElementById("grid-vd");
    if (!grid) return;
    if (!prods.length) { grid.innerHTML = '<p style="color:var(--plateado);font-size:13px;grid-column:1/-1;">Sin productos disponibles.</p>'; return; }
    grid.innerHTML = prods.map(p => {
        const qty      = _vdCarrito[p.codigo]?.qty || 0;
        const bodega   = parseInt(p.stock_bodega || 0);
        const tienda   = parseInt(p.stock_tienda || 0);
        const disp     = bodega + tienda;
        const selec    = qty > 0;
        const fotoHtml = p.foto
            ? `<img src="${ikFoto(p.foto,1200)}" onerror="this.style.display='none'">`
            : ``;
        // Desglose bodega/tienda visible — si no, al vender algo que solo está
        // en tienda el admin iría a buscarlo a bodega y no lo encontraría.
        const desglose = [bodega > 0 ? `Bodega: ${bodega}` : "", tienda > 0 ? `Tienda: ${tienda}` : ""].filter(Boolean).join(" · ");
        return `<div class="prod-card ${selec ? 'seleccionado' : ''}">
            ${fotoHtml}
            <div class="prod-card-info">
                <div class="prod-card-codigo">${p.codigo}</div>
                <div class="prod-card-nombre">${p.nombre}</div>
                <div class="prod-card-precio">$${parseFloat(p.precio||0).toFixed(2)}</div>
                <div style="font-size:10px;color:${disp>0?'#2ecc71':'#e74c3c'};margin-top:2px;">${desglose}</div>
            </div>
            <div class="prod-card-qty">
                <button class="qty-btn" onclick="quitarDeVD('${p.codigo}')">−</button>
                <span class="qty-num">${qty}</span>
                <button class="qty-btn" onclick="agregarAlVD('${p.codigo}')">+</button>
            </div>
        </div>`;
    }).join('');
}

async function diagnosticoVD() {
    const payload = {
        accion: "REGISTRAR_VENTA_DIRECTA",
        id: "TEST_" + Date.now(),
        fecha: new Date().toISOString(),
        cliente: "PRUEBA_DIAGNOSTICO",
        telefono: "0000-0000",
        items: [{ codigo: "TEST", nombre: "Producto prueba", precio: 99, cantidad: 1 }],
        total: 99,
        tipo: "credito",
        enganche: 10,
        saldoPendiente: 89,
        nota: "diagnostico",
        estado: "credito"
    };
    try {
        const resp = await apiPost(payload);
        alert(
            "=== RESULTADO DIAGNÓSTICO ===\n\n" +
            "Respuesta del API:\n" + JSON.stringify(resp, null, 2) +
            "\n\n¿resp.ok es true? → " + (resp.ok ? "SÍ ✅" : "NO ❌") +
            "\n\nSi ves ok: true, la venta de prueba se guardó en Google Sheets." +
            "\nSi ves error, copia este mensaje y compártelo."
        );
    } catch(e) {
        alert("=== ERROR DE CONEXIÓN ===\n\n" + e.message + "\n\nVerifica que tienes internet y que la URL del Worker está correcta.");
    }
}

// "Créditos Pendientes" ya no es un panel aparte — es el Historial mismo
// con el filtro en "Crédito", para que cada cliente tenga un solo
// expediente (antes vivía duplicado en dos vistas con datos separados).
function abrirHistorialSoloPendientes() {
    const panel = document.getElementById("panel-historial-vd");
    const abrirloPrimero = panel.style.display === "none";
    if (abrirloPrimero) toggleHistorialVD();
    setTimeout(() => {
        const sel = document.getElementById("filtro-historial-vd");
        if (sel) { sel.value = "credito"; renderHistorialVD(); }
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }, abrirloPrimero ? 250 : 50);
}

function toggleHistorialVD() {
    const panel = document.getElementById("panel-historial-vd");
    const btn   = document.getElementById("btn-toggle-historial-vd");
    const abierto = panel.style.display !== "none";
    panel.style.display = abierto ? "none" : "block";
    btn.textContent = abierto ? "📊 Historial de Ventas" : "📊 Ocultar Historial";
    if (!abierto) { cargarHistorialVD(); setTimeout(() => panel.scrollIntoView({ behavior:"smooth", block:"start" }), 200); }
}

function irAHistorialVD() {
    const panel = document.getElementById("panel-historial-vd");
    if (panel.style.display === "none") toggleHistorialVD();
    else setTimeout(() => panel.scrollIntoView({ behavior:"smooth", block:"start" }), 50);
}

let _historialVD = [];

async function cargarHistorialVD() {
    const el = document.getElementById("lista-historial-vd");
    if (el) el.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const resp = await apiPost({ accion: "GET_VENTAS_DIRECTAS" });
        if (!resp.ok) {
            if (el) el.innerHTML = '<p style="color:#e85555;font-size:13px;">Error: ' + (resp.error || "no se pudo obtener el historial") + '</p>';
            return;
        }
        _historialVD = (resp.ventas || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        renderHistorialVD();
    } catch(e) {
        if (el) el.innerHTML = '<p style="color:#e85555;font-size:13px;">Error de conexión: ' + e.message + '</p>';
    }
}

function renderHistorialVD() {
    const el     = document.getElementById("lista-historial-vd");
    const filtro = document.getElementById("filtro-historial-vd")?.value || "";
    // Una venta a crédito sin saldo (saldoPendiente $0) cuenta como PAGADA aunque el registro viejo siga diciendo "credito"
    const vdSaldo = v => parseFloat(v.saldoPendiente || 0);
    const vdCreditoPendiente = v => v.estado === "credito" && vdSaldo(v) > 0.005;
    const vdCreditoPagado = v => (v.estado === "credito" && vdSaldo(v) <= 0.005) || (v.estado === "pagado" && v.tipo === "credito");
    let lista  = !filtro ? _historialVD
        : filtro === "credito" ? _historialVD.filter(vdCreditoPendiente)
        : filtro === "credito_pagado" ? _historialVD.filter(vdCreditoPagado)
        : filtro === "pagado" ? _historialVD.filter(v => v.estado === "pagado" && !vdCreditoPagado(v))
        : _historialVD.filter(v => v.estado === filtro);

    // Filtrando por Crédito: ordenar por deuda MÁS VIEJA primero — es la
    // vista que se usa para decidir a quién recordarle el pago, así que el
    // que lleva más tiempo debiendo aparece arriba, no el más reciente.
    if (filtro === "credito") {
        lista = [...lista].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    }

    if (!lista.length) {
        el.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay ventas registradas.</p>';
        return;
    }

    // Totales rápidos
    const totalVentas  = lista.reduce((s, v) => s + (parseFloat(v.total)||0), 0);
    const totalPend    = lista.filter(vdCreditoPendiente).reduce((s, v) => s + (parseFloat(v.saldoPendiente)||0), 0);
    const countCred    = lista.filter(vdCreditoPendiente).length;

    el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
            <div style="background:#0a2a0a;border:1px solid #1a5c1a;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:16px;font-weight:700;color:#52d68a;">$${totalVentas.toFixed(2)}</div>
                <div style="font-size:10px;color:var(--plateado);">Total vendido</div>
            </div>
            <div style="background:#0a1a2a;border:1px solid #1a3a5c;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:16px;font-weight:700;color:#3a9de8;">${lista.length}</div>
                <div style="font-size:10px;color:var(--plateado);">Ventas</div>
            </div>
            <div style="background:rgba(255,159,64,0.15);border:1px solid rgba(255,159,64,0.4);border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:16px;font-weight:700;color:#ffb85c;">$${totalPend.toFixed(2)}</div>
                <div style="font-size:10px;color:var(--plateado);">${countCred} pendiente${countCred!==1?"s":""}</div>
            </div>
        </div>
        ${lista.map(v => {
            const fecha    = new Date(v.fecha).toLocaleDateString("es-SV", { day:"2-digit", month:"short", year:"2-digit" });
            const hora     = new Date(v.fecha).toLocaleTimeString("es-SV", { hour:"2-digit", minute:"2-digit" });
            const esCredito = v.estado === "credito" && vdSaldo(v) > 0.005;   // crédito con deuda
            const creditoPagado = vdCreditoPagado(v);                          // crédito ya saldado
            const diasDeuda = esCredito ? Math.floor((Date.now() - new Date(v.fecha).getTime()) / 86400000) : 0;
            const diasTxt = esCredito
                ? ` · <span style="color:${diasDeuda>=15?'#e85555':diasDeuda>=7?'#ffb85c':'var(--plateado)'};font-weight:${diasDeuda>=7?700:400};">hace ${diasDeuda} día${diasDeuda===1?"":"s"}</span>`
                : "";
            const saldo    = parseFloat(v.saldoPendiente||0);
            const total    = parseFloat(v.total||0);
            const pagado   = total - saldo;
            const pct      = (total > 0 && !creditoPagado) ? Math.round((pagado/total)*100) : 100;
            let items = [];
            try { items = typeof v.items === "string" ? JSON.parse(v.items) : (v.items||[]); } catch(e){}
            const itemsResumen = items.map(i => `${i.nombre||i.codigo} ×${i.cantidad||1}`).join(", ");
            return `<div style="background:#0f0f0f;border:1px solid ${esCredito ? "#c97a2b" : creditoPagado ? "#27ae60" : "#1a3a1a"};border-radius:10px;padding:12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:700;color:#fff;">${sanitizar(v.cliente || "Sin nombre")}</div>
                        <div style="font-size:11px;color:var(--plateado);">${fecha} ${hora} · ${sanitizar(v.telefono||"")}${diasTxt}</div>
                        ${v.nota ? `<div style="font-size:11px;color:#888;margin-top:2px;font-style:italic;">"${sanitizar(v.nota)}"</div>` : ""}
                    </div>
                    <div style="text-align:right;flex-shrink:0;margin-left:10px;">
                        <div style="font-size:16px;font-weight:700;color:${esCredito ? "#ffb85c" : "#52d68a"};">$${total.toFixed(2)}</div>
                        <div style="font-size:10px;padding:2px 7px;border-radius:20px;display:inline-block;margin-top:2px;
                            background:${esCredito ? "rgba(255,159,64,0.15)" : "rgba(82,214,138,0.15)"};
                            color:${esCredito ? "#ffb85c" : "#52d68a"};">
                            ${v.estado === "devuelto" ? "↩️ Devuelta" : esCredito ? "Crédito" : creditoPagado ? "✅ Crédito pagado" : "Contado"}
                        </div>
                    </div>
                </div>
                ${itemsResumen ? `<div style="font-size:11px;color:#666;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${itemsResumen}</div>` : ""}
                ${v.empresaEnvio ? `<div style="font-size:11px;color:#0ea5e9;margin-bottom:4px;">🚚 ${sanitizar(v.empresaEnvio)}</div>` : ""}
                ${(esCredito || creditoPagado) ? `
                <div style="background:#3a2a12;border-radius:5px;height:5px;margin-bottom:6px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#27ae60,#52d68a);border-radius:5px;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                    <div style="font-size:11px;color:var(--plateado);">Pagado $${pagado.toFixed(2)} · Pendiente <strong style="color:${saldo > 0.005 ? '#ffb85c' : '#52d68a'};">$${saldo.toFixed(2)}</strong></div>
                    ${saldo > 0.005 ? `<div style="display:flex;gap:6px;flex-shrink:0;">
                        <button onclick="enviarRecordatorioAbono('${v.id}')" style="padding:5px 10px;border:none;border-radius:6px;background:#25D366;color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">💬 Recordar</button>
                        <button onclick="abrirModalAbono('${v.id}')" style="padding:5px 10px;border:none;border-radius:6px;background:linear-gradient(135deg,#0a4a6b,#0ea5e9,#0369a1);color:#e0f7ff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">💰 Abono</button>
                    </div>` : '<span style="font-size:11px;color:#52d68a;font-weight:700;">✅ Saldado</span>'}
                </div>` : ""}
                <div style="margin-top:8px;display:flex;justify-content:flex-end;gap:6px;position:relative;">
                    <div id="menu-mas-vd-${v.id}" style="display:none;position:absolute;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:170px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                        <button onclick="toggleMenuMasVD('${v.id}');agregarProductoVentaDirectaVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#52d68a;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">➕ Agregar pieza</button>
                        <button onclick="toggleMenuMasVD('${v.id}');cambiarProductoVentaDirectaVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#a78bfa;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🔄 Cambiar producto</button>
                        <button onclick="toggleMenuMasVD('${v.id}');devolverPiezaVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#fb923c;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">↩️ Devolver pieza (vuelve a bodega)</button>
                        <button onclick="toggleMenuMasVD('${v.id}');editarDescuentoVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#ccc;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">✏️ Descuento</button>
                        <button onclick="toggleMenuMasVD('${v.id}');corregirSaldoVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#e85555;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🩹 Corregir saldo</button>
                        <button onclick="toggleMenuMasVD('${v.id}');cambiarFormaPagoVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#5eb3f0;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🔄 Cambiar forma de pago</button>
                        <button onclick="toggleMenuMasVD('${v.id}');verEstadoCuenta('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#e8b07a;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">📄 Estado de cuenta (PDF)</button>
                        <button onclick="toggleMenuMasVD('${v.id}');enviarWAEstadoCuenta('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#25D366;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">💬 Enviar estado de cuenta</button>
                        <button onclick="toggleMenuMasVD('${v.id}');marcarFechaItemVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#C9A84C;border:none;cursor:pointer;text-align:left;font-weight:600;">📅 Marcar fecha de una pieza</button>
                    </div>
                    <button onclick="toggleMenuMasVD('${v.id}',this)" style="padding:5px 10px;border:none;border-radius:6px;background:#1a1a1a;border:1px solid #444;color:#888;font-size:11px;font-weight:700;cursor:pointer;">⋯ Más acciones</button>
                    <button onclick="abrirModalImprimirRecibo58('${v.id}')" style="padding:5px 12px;border:none;border-radius:6px;background:#1a1a1a;border:1px solid #333;color:#C9A84C;font-size:11px;font-weight:700;cursor:pointer;">🧾 Recibo</button>
                </div>
            </div>`;
        }).join("")}`;
}
