// Hub VEREX — Pedidos: tienda + leads de afiliados + catálogo USA, alertas de corte, reposiciones
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
async function cargarLeads() {
    try {
        const res = await apiPost({ accion: "GET_LEADS_ADMIN" });
        leadsData = res.leads || [];
    } catch(e) { leadsData = []; }
}

// Alertas de afiliados, agregadas de TODOS a la vez, arriba del listado de
// Vendedores (que es donde vive el registro de afiliados) — antes quedaban
// silenciosas y solo se veían entrando ficha por ficha.
const LEADS_SIN_COMPLETAR_DIAS_HUB = 2;
// ── ¿ESTÁ ACTIVO ESTE VENDEDOR? Solo entonces corre el corte ────────────────
// Un vendedor corre corte mientras tiene un link vigente: su Link Inventario
// (tokenInventario — el sistema lo borra al cerrar el corte o al desactivarlo,
// así que hasta que no se le genere uno nuevo NO hay corte pendiente) o, si es
// afiliado/híbrido, un catálogo de afiliado vigente en Admin (se consulta en
// vivo: ese dato vive en otro sistema). Sin ninguno está inactivo: no se calcula
// ni se avisa nada de su corte.
let _linksAfiliado = {};                 // codigo → true | false | "error"
let _linksAfiliadoTs = 0, _linksAfiliadoCargando = false;

// "activo" | "inactivo" | "verificando" (aún consultando) | "desconocido"
// (la consulta falló: se comporta como antes para no callar una alerta real).
function estadoLinkVendedor(v) {
    if (v?.tokenInventario) return "activo";
    if (v?.tipo === "afiliado" || v?.tipo === "hibrido") {
        const s = _linksAfiliado[v.codigo];
        if (s === true) return "activo";
        if (s === false) return "inactivo";
        if (s === "error") return "desconocido";
        return "verificando";
    }
    return "inactivo";
}
function corteAplica(v) { const e = estadoLinkVendedor(v); return e === "activo" || e === "desconocido"; }

async function cargarLinksAfiliados() {
    if (_linksAfiliadoCargando || !_sessionPass) return;
    const afiliados = vendedores.filter(v => (v.tipo === "afiliado" || v.tipo === "hibrido") && !v.tokenInventario);
    if (!afiliados.length) { _linksAfiliadoTs = Date.now(); return; }
    _linksAfiliadoCargando = true;
    await Promise.all(afiliados.map(async v => {
        try {
            const res = await fetch(ADMIN_CAT_URL + "/affiliate-stats", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ afiliadoCodigo: v.codigo, _pass: _sessionPass })
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || res.status);
            _linksAfiliado[v.codigo] = !!data.catalogoActivo;
        } catch (_) { _linksAfiliado[v.codigo] = "error"; }
    }));
    _linksAfiliadoTs = Date.now();
    _linksAfiliadoCargando = false;
    // Con el dato ya resuelto, repintar lo que depende de él.
    renderVendedores();
    renderAlertasAfiliadosHub();
    if (document.getElementById("tab-content-dashboard")?.style.display === "block") renderDashboard();
    if (vendedorActual && document.getElementById("pantalla-perfil")?.style.display !== "none") renderProximoCortePerfil();
}

// Se pagan comisiones a los 30 días de la última liquidación (fechaCorte) —
// el aviso debe llegar 1 día antes de que se cumpla ese plazo, no cuando ya
// esté vencido, para dar tiempo a prepararlo. (dias<=1 cubre "vence mañana"
// y "vence hoy/vencido"; se calcula sobre fechaCorte, la misma fecha que ya
// usa VERIFICAR_TOKEN para cerrar el link de inventario a los 30 días.)
function _alertasCortePorVencer() {
    const ahora = Date.now();
    return vendedores
        .filter(v => corteAplica(v) && corteRealDe(v))
        .map(v => ({ v, dias: corteRealDe(v).dias }))
        .filter(({dias}) => dias <= 1)
        .sort((a,b) => a.dias - b.dias);
}

function actualizarTituloAlertas() {
    const total = (_tabAlertas.vendedores || 0) + (_tabAlertas.pedidos || 0);
    document.title = document.title.replace(/^🔔\(\d+\)\s*/, "");
    if (total > 0) document.title = `🔔(${total}) ` + document.title;
}

function renderAlertasAfiliadosHub() {
    const cont = document.getElementById("alertas-afiliados-hub");
    if (!cont) return;
    renderPedidosHub();

    const cortesPorVencer = _alertasCortePorVencer();

    const badge = document.getElementById("tab-vendedores-badge");
    const totalPendientes = cortesPorVencer.length + _reposicionesPendientes.length + _cortesPendientesCobro.length;
    _tabAlertas.vendedores = totalPendientes;
    pintarTabs(_tabActual);
    if (badge) {
        if (totalPendientes > 0) { badge.textContent = totalPendientes; badge.style.display = "block"; }
        else badge.style.display = "none";
    }
    actualizarTituloAlertas();

    if (!totalPendientes) { cont.innerHTML = ""; return; }

    const bloqueReposiciones = _reposicionesPendientes.length ? `
        <div class="card" style="border-color:#f59e0b;margin-bottom:14px;">
            <h2 style="color:#f59e0b;">📦 Piezas por reponer — vendidas bajo pedido (${_reposicionesPendientes.length})</h2>
            ${_reposicionesPendientes.map(r => `
                <div style="background:rgba(245,158,11,0.1);border:1px solid #f59e0b;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${sanitizar(r.nombre||r.codigo)}</div>
                            <div style="font-size:11px;color:var(--plateado);">Ref: ${sanitizar(r.codigo)} · Vendedor: ${sanitizar(r.vendedorNombre||r.vendedor)}</div>
                            <div style="font-size:11px;font-weight:700;color:#f59e0b;margin-top:3px;">⚠️ Vendió su última pieza — entregarle otra en la próxima entrega</div>
                        </div>
                        <button onclick="resolverReposicion('${sanitizar(r.vendedor)}','${sanitizar(r.codigo)}')" style="padding:5px 10px;font-size:11px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">✅ Ya se repuso</button>
                    </div>
                </div>`).join("")}
        </div>` : '';

    const bloqueCortes = cortesPorVencer.length ? `
        <div class="card" style="border-color:#e74c3c;margin-bottom:14px;">
            <h2 style="color:#e74c3c;">🧾 Cortes por vencer (${cortesPorVencer.length})</h2>
            ${cortesPorVencer.map(({v, dias}) => {
                const msg = dias < 0 ? `Vencido hace ${Math.abs(dias)} día${Math.abs(dias)===1?'':'s'}` : dias === 0 ? "Vence hoy" : "Vence mañana";
                return `<div style="background:rgba(231,76,60,0.1);border:1px solid #e74c3c;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${sanitizar(v.nombre)}</div>
                            <div style="font-size:11px;font-weight:700;color:#e74c3c;margin-top:2px;">⚠️ ${sanitizar(msg)} — se paga comisión a los 30 días</div>
                        </div>
                        <button onclick="abrirPerfil('${sanitizar(v.codigo)}');abrirCorte();" style="padding:5px 10px;font-size:11px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">🧾 Hacer corte</button>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    const bloqueCobrosPendientes = _cortesPendientesCobro.length ? `
        <div class="card" style="border-color:#e67e22;margin-bottom:14px;">
            <h2 style="color:#e67e22;">💰 Cobros pendientes (${_cortesPendientesCobro.length})</h2>
            ${_cortesPendientesCobro.map(c => {
                const fecha = c.fecha ? new Date(c.fecha).toLocaleDateString("es-SV", { day: "numeric", month: "short" }) : "—";
                return `<div style="background:rgba(230,126,34,0.1);border:1px solid #e67e22;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${sanitizar(c.vendedorNombre || c.vendedor)}</div>
                            <div style="font-size:11px;font-weight:700;color:#e67e22;margin-top:2px;">⚠️ Corte del ${sanitizar(fecha)} — $${parseFloat(c.aPagarVerex||0).toFixed(2)} sin cobrar</div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            <button onclick="marcarCorteCobrado('${sanitizar(c.id)}')" style="padding:5px 10px;font-size:11px;background:#e67e22;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">💰 Ya cobré</button>
                            <button onclick="eliminarCorteHistorial('${sanitizar(c.id)}')" style="padding:4px 10px;font-size:10px;background:none;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">🗑️ Eliminar</button>
                        </div>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    cont.innerHTML = bloqueCobrosPendientes + bloqueCortes + bloqueReposiciones;
}

// ══ PEDIDOS: tienda + leads de afiliados + catálogo USA, todo en un lugar ══
let _pedidosTienda = [], _pedidosTs = 0, _pedidosCargando = false;
let _usaGrupos = [];

// Aviso permanente si los correos del sistema dejaron de salir (lo registra el worker al fallar un envío
// y en su chequeo diario) — antes un fallo así pasaba desapercibido durante días.
async function cargarEstadoCorreo() {
    try {
        const r = await apiPost({ accion: "GET_ESTADO_CORREO" });
        const el = document.getElementById("alerta-correo");
        if (!el || !r || !r.ok) return;
        const e = r.estado;
        if (e && e.ok === false) {
            const cuando = e.fecha ? new Date(e.fecha).toLocaleString("es-SV", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
            el.innerHTML = `⚠️ Los correos del sistema NO están saliendo (pedidos, pagos, envíos${cuando ? " · desde " + sanitizar(cuando) : ""}). ${sanitizar(String(e.detalle || "").slice(0, 140))}
                <button onclick="probarCorreos(this)" style="margin-left:10px;padding:3px 10px;font-size:11px;background:#fff;color:#7a1a10;border:none;border-radius:6px;cursor:pointer;font-weight:700;">✉️ Probar ahora</button>`;
            el.style.display = "block";
        } else {
            el.style.display = "none";
        }
    } catch (_) { /* sin red: no se toca el aviso */ }
}

async function cargarPedidosTienda() {
    if (_pedidosCargando || !_sessionPass) return;
    cargarEstadoCorreo();
    _pedidosCargando = true;
    try {
        const res = await apiPost({ accion: "GET_PEDIDOS" });
        if (res && res.ok && Array.isArray(res.pedidos)) { _pedidosTienda = res.pedidos; _pedidosTs = Date.now(); }
    } catch (_) { /* conserva lo último que se tenía */ }
    _pedidosCargando = false;
    renderPedidosHub();
}

const ZONA_METRO_HUB = [
    "antiguo cuscatlán","apopa","ayutuxtepeque","ciudad delgado","cuscatancingo",
    "ilopango","mejicanos","nejapa","san marcos","san martín","san martin",
    "san salvador","santa tecla","santo tomás","santo tomas","soyapango","tonacatepeque"
];

function _mensajeWhatsAppPedido(estado, p) {
    const nombre = p.cliente || "cliente", numero = p.numeroPedido || "—";
    const m = String(p.municipio || "").toLowerCase();
    const metro = ZONA_METRO_HUB.some(z => m.includes(z));
    if (estado === "Despachado") {
        const tiempo = metro ? "Como estás cerca, lo tendrás en tus manos hoy o mañana." : "En 1 a 2 días hábiles estará en tus manos.";
        return "Hola " + nombre + ", tu pedido " + numero + " ya está en camino hacia ti! " + tiempo + " Gracias por elegir VEREX!";
    }
    if (estado === "Entregado") return "Hola " + nombre + ", tu pedido " + numero + " fue entregado con éxito. Esperamos que lo ames tanto como nosotros al hacerlo llegar hasta ti. Gracias por ser parte de VEREX!";
    return null;
}

async function cambiarEstadoPedidoTienda(numeroPedido, estado) {
    const p = _pedidosTienda.find(x => x.numeroPedido === numeroPedido);
    if (!p) return;
    if ((estado === "Cancelado" || estado === "No entregado") &&
        !confirm(`¿Marcar el pedido ${numeroPedido} como "${estado}"? Se libera el stock reservado.`)) return;
    try {
        const res = await apiPost({ accion: "ACTUALIZAR_ESTADO_PEDIDO", numeroPedido, estado });
        if (!res || res.ok === false || res.error) throw new Error(res?.error || "No se pudo actualizar");
        p.estado = estado;
        const msg = _mensajeWhatsAppPedido(estado, p);
        const tel = String(p.telefono || "").replace(/\D/g, "");
        if (msg && tel && (p.canal || "whatsapp") !== "correo") window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`);
        toast(`✅ Pedido ${numeroPedido}: ${estado}`);
    } catch (e) { toast("⚠️ " + e.message, "#c0392b"); }
    renderPedidosHub();
}

// Diagnóstico de PayPal: comprueba que las claves del worker existan y que PayPal las acepte (no muestra ningún valor).
async function probarPayPal(btn) {
    const txt = btn.textContent; btn.textContent = "Probando…"; btn.disabled = true;
    try {
        const r = await apiPost({ accion: "PROBAR_PAYPAL" });
        const modo = r.entorno === "live" ? "REAL (live) — cobra dinero de verdad" : "PRUEBAS (sandbox) — no mueve dinero";
        const lista = `• PAYPAL_CLIENT_ID: ${r.tieneClientId ? "✅" : "❌ falta"}\n• PAYPAL_SECRET: ${r.tieneSecret ? "✅" : "❌ falta"}\n• PAYPAL_WEBHOOK_ID: ${r.tieneWebhookId ? "✅" : "❌ falta (solo afecta al respaldo)"}\n• PAYPAL_ENV: ${r.entornoDefinido === "valor_invalido" ? "❌ valor no válido (debe ser exactamente: sandbox o live) — por ahora se usa sandbox" : r.entornoDefinido ? "✅ " + r.entornoDefinido : "(vacío → se usa sandbox)"}`;
        if (r.ok) alert(`✅ PayPal aceptó las claves.\n\nModo: ${modo}\n\n${lista}`);
        else if (r.motivo === "faltan_claves") alert(`❌ Faltan claves de PayPal en el worker.\n\n${lista}\n\nCréalas en Cloudflare → verex-api → Settings → Variables and Secrets y vuelve a desplegar.`);
        else alert(`❌ PayPal rechazó las claves.\n\nModo: ${modo}\n\n${lista}\n\nDetalle: ${r.detalle || ""}\n\nLo más común: el Client ID y el Secret son de otro entorno (Sandbox vs Live) o tienen un espacio al copiarlos.`);
    } catch (e) { alert("⚠️ No se pudo conectar con el servidor: " + e.message); }
    btn.textContent = txt; btn.disabled = false;
}

// Diagnóstico: manda un correo de prueba y explica por qué falla si no sale (clave, dominio, límite…).
async function probarCorreos(btn) {
    const para = prompt("¿A qué correo mando la prueba?", "verex.pedidos@verexstore.com");
    if (!para) return;
    const txt = btn.textContent; btn.textContent = "Enviando…"; btn.disabled = true;
    try {
        const r = await apiPost({ accion: "PROBAR_CORREO", para });
        let msg;
        if (r.ok) msg = `✅ Resend aceptó el correo para ${r.para}.\n\nSi no te llega en un par de minutos, revisa Spam y el panel de Resend (sección Emails).`;
        else if (r.motivo === "falta_clave") msg = "❌ El Worker no tiene la clave de Resend (RESEND_KEY) en Cloudflare — por eso no sale ningún correo.\n\nHay que crearla en Cloudflare → Workers → verex-api → Settings → Variables and Secrets.";
        else if (r.status === 401 || r.status === 403) msg = `❌ Resend rechazó el envío (HTTP ${r.status}).\n\nLo más común: la clave no es válida, o el dominio notificaciones.verexstore.com no está verificado en Resend.\n\nDetalle: ${r.detalle || ""}`;
        else if (r.status === 429) msg = `❌ Resend dice que se superó el límite de envíos (HTTP 429).\n\nDetalle: ${r.detalle || ""}`;
        else msg = `❌ No se pudo enviar (${r.status ? "HTTP " + r.status : r.motivo || "error"}).\n\nDetalle: ${r.detalle || r.error || ""}`;
        alert(msg);
    } catch (e) { alert("⚠️ No se pudo conectar con el servidor: " + e.message); }
    btn.textContent = txt; btn.disabled = false;
    cargarEstadoCorreo();
}

async function restaurarVencidos(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    if (!confirm("¿Restaurar este pedido? Se vuelve a apartar la pieza (si todavía hay stock) y vuelve a la lista de pedidos.")) return;
    try {
        const res = await apiPost({ accion: "RESTAURAR_LEAD_VENCIDO", ids });
        if (res && res.ok) {
            toast("✅ Pedido restaurado", "#22c55e");
        } else if (res && res.error === "sin_stock") {
            alert(`⚠️ No se pudo restaurar: ya no hay stock de ${res.nombre || res.codigo || "una pieza"} (disponible: ${res.disponible || 0}).\n\nLa pieza se vendió o se apartó para otro cliente. No se restauró nada.`);
        } else if (res && res.error === "no_restaurable") {
            toast("⚠️ Ese pedido ya no se puede restaurar (cambió de estado)", "#c0392b");
        } else {
            toast("⚠️ " + ((res && res.error) || "No se pudo restaurar"), "#c0392b");
        }
    } catch (e) { toast("⚠️ " + e.message, "#c0392b"); }
    await cargarLeads();
    renderPedidosHub();
}

function renderPedidosHub() {
    const cont = document.getElementById("pedidos-hub");
    if (!cont) return;
    const vendMap = new Map(vendedores.map(v => [v.codigo, v]));
    const ahora = Date.now();
    const dias = f => Math.floor((ahora - new Date(f || ahora).getTime()) / 86400000);

    // ── Leads de afiliados / catálogo (sin USA, que va en su propia sección)
    const leadsMX = leadsData.filter(l => l.pais !== "US");
    const enCamino = leadsMX
        .filter(l => l.estado === "en_camino")
        .map(l => ({ ...l, dias: Math.floor((ahora - new Date(l.fecha||ahora).getTime()) / 86400000) }))
        .sort((a,b) => b.dias - a.dias);

    const sinCompletar = leadsMX
        .filter(l => l.estado === "interesado" && !l.cliente)
        .map(l => ({ ...l, dias: Math.floor((ahora - new Date(l.fecha||ahora).getTime()) / 86400000) }))
        .filter(l => l.dias >= LEADS_SIN_COMPLETAR_DIAS_HUB)
        .sort((a,b) => b.dias - a.dias);


    // ── Pedidos nuevos desde el link compartido / catálogo (afiliado o venta directa): se avisan
    // apenas entran. Los que llevan 2+ días sin completarse salen en "Leads sin completar".
    const idsSinCompletar = new Set(sinCompletar.map(l => l.id));
    const nuevos = leadsMX
        .filter(l => (l.estado === "interesado" || l.estado === "reportado") && !idsSinCompletar.has(l.id))
        .map(l => ({ ...l, mins: Math.max(0, Math.floor((ahora - new Date(l.fecha || ahora).getTime()) / 60000)) }))
        .sort((a, b) => b.mins - a.mins);

    // ── Pedidos de la tienda que aún requieren acción
    const tienda = _pedidosTienda
        .filter(p => p.numeroPedido && (p.estado === "Pendiente" || p.estado === "Despachado"))
        .map(p => ({ ...p, dias: dias(p.fecha) }))
        .sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));

    // ── Pedidos USA (un pedido = varios leads con el mismo pedidoId)
    const gmap = new Map();
    leadsData.filter(l => l.pais === "US" && !l.entregadoUSA && ((l.estado !== "cancelado" && l.estado !== "rechazado") || l.pagadoSinStock))   // pagado sin stock se sigue mostrando aunque haya quedado cancelado
        .forEach(l => { const k = l.pedidoId || l.id; if (!gmap.has(k)) gmap.set(k, []); gmap.get(k).push(l); });
    _usaGrupos = [...gmap.entries()].map(([id, leads]) => ({ id, leads, f: leads[0] }))
        .sort((a, b) => new Date(a.f.fecha || 0) - new Date(b.f.fecha || 0));

    // ── Pedidos que el sistema canceló solo porque la reserva venció sin que nadie los confirmara
    // (últimas 48 h). No cuentan en la alerta roja: son para revisar y, si aplica, restaurar.
    const hace48 = ahora - 48 * 3600000;
    const vmap = new Map();
    leadsData.filter(l => {
        if (l.estado !== "cancelado" || l.esPrueba) return false;
        const h = l.historial || [], ult = h[h.length - 1];
        const pasoAVD = l.pendienteVD === true && ult && ult.motivo === "Pasado a venta directa";
        return ult && (ult.motivo === "Reserva vencida sin confirmar" || pasoAVD) && new Date((pasoAVD ? ult.fecha : l.vencidoEn) || ult.fecha || 0).getTime() >= hace48;
    }).forEach(l => { const k = l.pedidoId || l.id; if (!vmap.has(k)) vmap.set(k, []); vmap.get(k).push(l); });
    const vencidos = [...vmap.values()]
        .map(leads => ({ leads, f: leads[0], cuando: Math.max(...leads.map(l => new Date((l.pendienteVD ? null : l.vencidoEn) || (l.historial || []).slice(-1)[0]?.fecha || 0).getTime())) }))
        .sort((a, b) => b.cuando - a.cuando);

    const total = tienda.length + nuevos.length + enCamino.length + sinCompletar.length + _usaGrupos.length;
    _tabAlertas.pedidos = total;
    pintarTabs(_tabActual);
    const badge = document.getElementById("tab-pedidos-badge");
    if (badge) { if (total > 0) { badge.textContent = total; badge.style.display = "block"; } else badge.style.display = "none"; }
    actualizarTituloAlertas();

    const btnS = "padding:5px 10px;font-size:11px;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;";
    const bloqueEnCamino = enCamino.length ? `
        <div class="card" style="border-color:#f97316;margin-bottom:14px;">
            <h2 style="color:#f97316;">🚚 Pedidos en Camino — Confirmar Entrega (${enCamino.length})</h2>
            ${enCamino.map(l => {
                const nombreVend = vendMap.get(l.afiliado)?.nombre || l.afiliado || "—";
                const urgente = l.dias >= 1;
                return `<div style="background:${urgente?'rgba(249,115,22,0.12)':'var(--negro)'};border:1px solid ${urgente?'#f97316':'var(--borde)'};border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${sanitizar(l.nombre||l.codigo)}</div>
                            <div style="font-size:11px;color:var(--plateado);">🎯 ${sanitizar(nombreVend)} · $${parseFloat(l.precio||0).toFixed(2)}</div>
                            <div style="font-size:11px;font-weight:700;color:${urgente?'#f97316':'var(--plateado)'};margin-top:3px;">${urgente ? `⚠️ ${l.dias} día${l.dias>1?'s':''} sin confirmar entrega` : "En camino"}</div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;position:relative;">
                            <div style="display:flex;gap:2px;">
                                <button onclick="confirmarLeadEntrega('${sanitizar(l.id)}',false)" style="flex:1;padding:5px 8px;font-size:11px;background:#27ae60;color:#fff;border:none;border-radius:6px 0 0 6px;cursor:pointer;font-weight:700;">✅ Entregado</button>
                                <button onclick="event.stopPropagation();toggleMenuCambio('${sanitizar(l.id)}',this)" title="Otras opciones" style="padding:5px 6px;font-size:11px;background:#1e6b3e;color:#fff;border:none;border-radius:0 6px 6px 0;cursor:pointer;font-weight:700;border-left:1px solid rgba(255,255,255,.25);">▾</button>
                            </div>
                            <div id="menu-cambio-${sanitizar(l.id)}" style="display:none;position:absolute;top:32px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:190px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                                <button onclick="event.stopPropagation();confirmarLeadEntrega('${sanitizar(l.id)}',true);document.getElementById('menu-cambio-${sanitizar(l.id)}').style.display='none';" style="display:block;width:100%;padding:9px 12px;font-size:11px;background:none;color:#a78bfa;border:none;cursor:pointer;text-align:left;font-weight:600;">🔄 Es un cambio (sin comisión)</button>
                            </div>
                            <button onclick="rechazarLeadEntrega('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">❌ Rechazado</button>
                        </div>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    const bloqueSinCompletar = sinCompletar.length ? `
        <div class="card" style="border-color:#eab308;margin-bottom:14px;">
            <h2 style="color:#eab308;">🕐 Leads sin Completar (${sinCompletar.length})</h2>
            ${sinCompletar.map(l => {
                const esAfiliado = !!l.afiliado;
                const vend = esAfiliado ? vendMap.get(l.afiliado) : null;
                const nombreVend = esAfiliado ? (vend?.nombre || l.afiliado || "—") : "👤 Cliente directo (catálogo)";
                const tel = String(vend?.telefono || "").replace(/\D/g, "");
                const msg = `Hola ${nombreVend}! Vi que tienes un cliente interesado en "${l.nombre||l.codigo}" desde hace ${l.dias} días y todavía falta completar sus datos en tu link de pedidos. ¿Puedes completarlo o me cuentas si ya no sigue interesado?`;
                const accionBoton = esAfiliado
                    ? `<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                        ${tel ? `<a href="https://wa.me/${tel}?text=${encodeURIComponent(msg)}" target="_blank" style="padding:5px 10px;font-size:11px;background:#25D366;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;text-align:center;">💬 Recordar</a>` : ''}
                        <button onclick="resolverLeadClienteDirecto('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">✅ Resuelto</button>
                    </div>`
                    : `<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                        <button onclick="registrarVentaDesdeLead('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#C9A84C;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;">📝 Registrar Venta</button>
                        <button onclick="resolverLeadClienteDirecto('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">✅ Resuelto</button>
                    </div>`;
                const notaEstado = esAfiliado ? "sin que el afiliado complete los datos" : "sin cerrar como venta ni descartar";
                // Teléfono que el CLIENTE dejó antes de abrir WhatsApp (si el
                // catálogo lo pidió) — respaldo por si el mensaje nunca le
                // llegó a nadie: aquí sí hay a quién contactar directo.
                const telCliente = String(l.telefonoCliente || "").replace(/\D/g, "");
                // Nombre del cliente que dejó el catálogo antes de mandar el
                // WhatsApp — clave cuando el mismo link se comparte por varios
                // canales a varios clientes distintos y llegan varios mensajes.
                const nombreClienteSC = l.nombreCliente ? `<div style="font-size:11px;color:#e8b400;font-weight:700;margin-top:2px;">👤 ${sanitizar(l.nombreCliente)}</div>` : '';
                const clienteHtmlSC = telCliente ? `
                    <a href="https://wa.me/503${telCliente}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#25D366;font-weight:700;margin-top:4px;text-decoration:none;">📱 Cliente dejó su número: ${sanitizar(l.telefonoCliente)} — escribirle</a>` : '';
                const direccionClienteSC = l.direccionCliente ? `<div style="font-size:11px;color:var(--plateado);margin-top:4px;">📍 ${sanitizar(l.direccionCliente)}</div>` : '';
                return `<div style="background:rgba(234,179,8,0.1);border:1px solid #eab308;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${sanitizar(l.nombre||l.codigo)}</div>
                            <div style="font-size:11px;color:var(--plateado);">${sanitizar(nombreVend)} · $${parseFloat(l.precio||0).toFixed(2)}</div>
                            <div style="font-size:11px;font-weight:700;color:#eab308;margin-top:3px;">⚠️ ${l.dias} días ${notaEstado}</div>
                            ${nombreClienteSC}
                            ${clienteHtmlSC}
                            ${direccionClienteSC}
                        </div>
                        ${accionBoton}
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';


    const hace = m => m < 1 ? "justo ahora" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : `hace ${Math.floor(m / 1440)} día${Math.floor(m / 1440) > 1 ? 's' : ''}`;
    const bloqueNuevos = nuevos.length ? `
        <div class="card" style="border-color:#22d3ee;margin-bottom:14px;">
            <h2 style="color:#22d3ee;">🆕 Pedidos nuevos — link compartido / catálogo (${nuevos.length})</h2>
            ${nuevos.map(l => {
                const esAfiliado = !!l.afiliado;
                const vend = esAfiliado ? vendMap.get(l.afiliado) : null;
                const origen = esAfiliado ? `🎯 ${sanitizar(vend?.nombre || l.afiliado)}` : "👤 Venta directa";
                const c = l.cliente;
                const nombreCli = c?.nombre || l.nombreCliente || "";
                const telRaw = c?.telefono || l.telefonoCliente || "";
                const tel = String(telRaw).replace(/\D/g, "");
                const dir = c ? [c.direccion, c.municipio, c.departamento].filter(Boolean).join(", ") : (l.direccionCliente || "");
                const completo = !!c || l.estado === "reportado";
                const estadoTxt = l.estado === "reportado" ? "🟡 Reportado por el afiliado — falta confirmar el envío"
                    : c ? "✅ Completado por el afiliado — listo para empacar y enviar"
                    : esAfiliado ? "🔵 Cliente interesado — el afiliado debe completar el pedido" : "🔵 Cliente interesado — escríbele para cerrar la venta";
                const acciones = (completo
                        ? `<button onclick="confirmarLeadEnvio('${sanitizar(l.id)}')" style="${btnS}background:#f97316;">📦 Empacar y enviar</button>`
                        : !esAfiliado
                        ? `<button onclick="registrarVentaDesdeLead('${sanitizar(l.id)}')" style="${btnS}background:#C9A84C;color:#111;">📝 Registrar venta</button>`
                        : "")
                    + `<button onclick="${completo || !esAfiliado ? "cancelarLeadUI" : "resolverLeadClienteDirecto"}('${sanitizar(l.id)}')" style="${btnS}background:${completo ? '#e74c3c' : '#4a4a4e'};">${completo ? "❌ Cancelar" : "✅ Resuelto"}</button>`;
                return `<div style="background:rgba(34,211,238,0.08);border:1px solid #22d3ee;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        ${l.foto ? `<img src="${sanitizar(ikFoto(l.foto, 120))}" onerror="this.style.display='none'" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;">` : ""}
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${sanitizar(l.nombre || l.codigo)} <span style="font-size:11px;color:var(--dorado-claro);font-weight:600;">$${parseFloat(l.precio || 0).toFixed(2)}</span></div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">${origen} · ${hace(l.mins)}</div>
                            <div style="font-size:11px;font-weight:700;color:#22d3ee;margin-top:3px;">${estadoTxt}</div>
                            ${nombreCli ? `<div style="font-size:11px;color:#e8b400;font-weight:700;margin-top:3px;">👤 ${sanitizar(nombreCli)}</div>` : ""}
                            ${tel ? `<a href="https://wa.me/503${tel}" target="_blank" style="font-size:11px;color:#25D366;font-weight:700;text-decoration:none;">📱 ${sanitizar(telRaw)} — escribirle</a>` : ""}
                            ${dir ? `<div style="font-size:11px;color:var(--plateado);margin-top:2px;">📍 ${sanitizar(dir)}</div>` : ""}
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">${acciones}</div>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    const bloqueTienda = tienda.length ? `
        <div class="card" style="border-color:#a66be8;margin-bottom:14px;">
            <h2 style="color:#a66be8;">🛍️ Pedidos de la tienda (${tienda.length})</h2>
            ${tienda.map(p => {
                const pend = p.estado === "Pendiente";
                const tel = String(p.telefono || "").replace(/\D/g, "");
                return `<div style="background:rgba(166,107,232,0.1);border:1px solid #a66be8;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${sanitizar(p.numeroPedido)} · ${sanitizar(p.cliente || "—")} <span style="font-size:10px;color:${pend ? '#f97316' : '#3b82f6'};border:1px solid currentColor;border-radius:5px;padding:1px 6px;margin-left:4px;">${pend ? "PENDIENTE" : "DESPACHADO"}</span></div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">${sanitizar(p.productos || "—")}</div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">📍 ${sanitizar([p.municipio, p.departamento].filter(Boolean).join(", ") || "—")} · ${sanitizar(p.metodoPago || "—")} · <b style="color:var(--dorado-claro);">${sanitizar(p.total)}</b> · ${sanitizar(p.canal || "whatsapp")}</div>
                            ${tel ? `<a href="https://wa.me/${tel}" target="_blank" style="font-size:11px;color:#25D366;font-weight:700;text-decoration:none;">📱 ${sanitizar(p.telefono)}</a>` : ''}
                            <div style="font-size:11px;font-weight:700;color:${p.dias >= 1 ? '#f97316' : 'var(--plateado)'};margin-top:3px;">${p.dias >= 1 ? `⚠️ hace ${p.dias} día${p.dias > 1 ? 's' : ''}` : "Hoy"}</div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                            ${pend
                                ? `<button onclick="cambiarEstadoPedidoTienda(${jsArg(p.numeroPedido)},'Despachado')" style="${btnS}background:#3b82f6;">🚚 Despachar</button>`
                                : `<button onclick="cambiarEstadoPedidoTienda(${jsArg(p.numeroPedido)},'Entregado')" style="${btnS}background:#27ae60;">✅ Entregado</button>
                                   <button onclick="cambiarEstadoPedidoTienda(${jsArg(p.numeroPedido)},'No entregado')" style="${btnS}background:#4a4a4e;">↩️ No entregado</button>`}
                            <button onclick="cambiarEstadoPedidoTienda(${jsArg(p.numeroPedido)},'Cancelado')" style="${btnS}background:#e74c3c;">❌ Cancelar</button>
                        </div>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    const bloqueUSA = _usaGrupos.length ? `
        <div class="card" style="border-color:#0ea5e9;margin-bottom:14px;">
            <h2 style="color:#0ea5e9;">🇺🇸 Pedidos USA (${_usaGrupos.length})</h2>
            ${_usaGrupos.map((g, i) => {
                const f = g.f;
                const items = g.leads.map(l => `<b>${sanitizar(l.nombre || l.codigo)}</b> ×${parseInt(l.qty) || 1} <span style="color:var(--dorado-claro);font-weight:700;">[${sanitizar(l.codigo || "—")}]</span>`).join("<br>");
                const sub = g.leads.reduce((s, l) => s + (parseFloat(l.precio) || 0) * (parseInt(l.qty) || 1), 0);
                const totUSD = f.totalPedidoUSD != null ? parseFloat(f.totalPedidoUSD) : sub;
                const etapa = !f.pagadoUSA ? "pago" : !f.trackingDHL ? "envio" : "entrega";
                const chip = { pago: ["SIN PAGAR", "#f97316"], envio: ["PAGADO · POR ENVIAR", "#a66be8"], entrega: ["ENVIADO · " + sanitizar(f.trackingDHL || ""), "#3b82f6"] }[etapa];
                const d = dias(f.fecha);
                // Aviso de cobro: PayPal.me no le avisa al sistema, hay que revisar PayPal y
                // marcar pagado antes de que venza la reserva (12 h); la tarjeta se confirma sola.
                let avisoCobro = "";
                if (etapa === "pago") {
                    if (f.paypalOrderId || /paypal\.com/.test(f.pagoLink || "")) {
                        avisoCobro = `<div style="font-size:11px;color:var(--plateado);margin-top:3px;">🅿️ PayPal: se confirma sola al pagar</div>`;
                    } else if (/paypal\.me/.test(f.pagoLink || "")) {
                        const ms = f.reservaExpiraEn ? new Date(f.reservaExpiraEn).getTime() - ahora : null;
                        const resta = ms === null ? "" : ms <= 0 ? " — la reserva ya venció" : ` — la reserva vence en ${Math.floor(ms / 3600000)} h ${Math.floor((ms % 3600000) / 60000)} min`;
                        avisoCobro = `<div style="font-size:11px;font-weight:700;color:#f97316;margin-top:3px;">⏳ Revisa PayPal y marca pagado${resta}</div>`;
                    } else if (/wompi\.sv/.test(f.pagoLink || "")) {
                        avisoCobro = `<div style="font-size:11px;color:var(--plateado);margin-top:3px;">💳 Tarjeta (Wompi): se confirma sola al pagar</div>`;
                    }
                }
                const tel = String(f.telefonoCliente || "").replace(/\D/g, "");
                return `<div style="background:rgba(14,165,233,0.1);border:1px solid #0ea5e9;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;font-size:13px;">${f.esPrueba ? `<span style="color:#b42318;font-weight:800;">🧪 PRUEBA</span> · ` : ""}${f.numeroPedidoUSA ? `<span style="color:var(--dorado);">${sanitizar(f.numeroPedidoUSA)}</span> · ` : ""}${sanitizar(f.nombreCliente || "(sin nombre)")} <span style="font-size:10px;color:${chip[1]};border:1px solid currentColor;border-radius:5px;padding:1px 6px;margin-left:4px;">${chip[0]}</span></div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">${items}</div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">📍 ${sanitizar([f.ciudadUS, f.estadoUS, f.zipUS].filter(Boolean).join(", ") || f.direccionCliente || "—")} · <b style="color:var(--dorado-claro);">$${totUSD.toFixed(2)} USD</b></div>
                            ${tel ? `<a href="https://wa.me/${tel}" target="_blank" style="font-size:11px;color:#25D366;font-weight:700;text-decoration:none;">📱 ${sanitizar(f.telefonoCliente)}</a>` : ''}
                            ${avisoCobro}<div style="font-size:11px;color:var(--plateado);margin-top:3px;">${d >= 1 ? `hace ${d} día${d > 1 ? 's' : ''}` : "Hoy"}</div>
                        </div>
                        <button onclick="abrirAdminSSO('logistica-usa.html?pedido=' + encodeURIComponent(${jsArg(g.id)}))" style="flex-shrink:0;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;" title="Abre este pedido en Logística USA">📦 Abrir ↗</button>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    const bloqueVencidos = vencidos.length ? `
        <div class="card" style="border-color:#9ca3af;margin-bottom:14px;">
            <h2 style="color:#d1d5db;">⌛ Vencidos o sin registrar — últimas 48 h (${vencidos.length})</h2>
            <p style="font-size:11px;color:var(--plateado);margin:4px 0 0;">Pedidos que salieron de la lista sin completarse: vencieron sin confirmar, o se pasaron a Venta Directa y la venta no se llegó a registrar. La pieza volvió al stock. Si el cliente sigue interesado, restáuralos (se vuelve a apartar la pieza si aún hay).</p>
            ${vencidos.map(g => {
                const f = g.f;
                const esUS = f.pais === "US";
                const vend = f.afiliado ? vendMap.get(f.afiliado) : null;
                const origen = esUS ? "🇺🇸 USA" : f.afiliado ? `🎯 ${sanitizar(vend?.nombre || f.afiliado)}` : "👤 Catálogo / venta directa";
                const items = g.leads.map(l => `<b>${sanitizar(l.nombre || l.codigo)}</b> ×${parseInt(l.qty) || 1}`).join(" · ");
                const nombreCli = f.cliente?.nombre || f.nombreCliente || "";
                const telRaw = f.cliente?.telefono || f.telefonoCliente || "";
                const tel = String(telRaw).replace(/\D/g, "");
                const horas = Math.max(0, Math.floor((ahora - g.cuando) / 3600000));
                const hace_ = horas < 1 ? "hace menos de 1 h" : `hace ${horas} h`;
                const ids = g.leads.map(l => l.id);
                return `<div style="background:rgba(156,163,175,0.1);border:1px solid #6b7280;border-radius:10px;padding:10px 12px;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;">${items}</div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">${origen} · ${g.leads.some(l => l.pendienteVD) ? "📝 pasado a Venta Directa, sin registrar —" : "venció"} ${hace_}</div>
                            ${nombreCli ? `<div style="font-size:11px;color:#e8b400;font-weight:700;margin-top:3px;">👤 ${sanitizar(nombreCli)}</div>` : ""}
                            ${tel ? `<a href="https://wa.me/${esUS ? "" : "503"}${tel}" target="_blank" style="font-size:11px;color:#25D366;font-weight:700;text-decoration:none;">📱 ${sanitizar(telRaw)} — escribirle</a>` : ""}
                        </div>
                        <button onclick="restaurarVencidos(${jsArgArr(ids)})" style="${btnS}background:#16a34a;flex-shrink:0;">↩ Restaurar</button>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    cont.innerHTML = ((bloqueNuevos + bloqueTienda + bloqueEnCamino + bloqueSinCompletar + bloqueUSA) ||
        '<div class="card"><h2>📋 Pedidos</h2><p style="color:#4ade80;font-size:14px;">✅ Todo al día — no hay pedidos pendientes de atender.</p></div>') + bloqueVencidos +
        `<div style="text-align:center;margin:6px 0 20px;"><button onclick="probarCorreos(this)" style="padding:6px 14px;font-size:11px;background:none;color:var(--plateado);border:1px solid var(--borde);border-radius:8px;cursor:pointer;">✉️ Probar el envío de correos</button> <button onclick="probarPayPal(this)" style="padding:6px 14px;font-size:11px;background:none;color:var(--plateado);border:1px solid var(--borde);border-radius:8px;cursor:pointer;">🅿️ Probar PayPal</button></div>`;
}

async function migrarHistorialVentas() {
    if (!confirm("¿Migrar el historial de ventas antiguas? Crea un registro aproximado (fecha de entrega, marcado como \"migrado\") por cada venta que aún no tenga historial individual. Es seguro correrlo más de una vez.")) return;
    const btn = event.target;
    const txtOriginal = btn.textContent;
    btn.textContent = "⏳ Migrando..."; btn.disabled = true;
    try {
        const res  = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accion:"MIGRAR_HISTORIAL_VENTAS_ANTIGUAS", _pass: _sessionPass }) });
        const data = await res.json();
        if (data.ok) toast(`✅ Migración completa — ${data.creados} registro(s) creado(s)`);
        else toast("⚠️ " + (data.error||"No se pudo migrar"), "#c0392b");
    } catch(e) { toast("⚠️ Error de conexión", "#c0392b"); }
    btn.textContent = txtOriginal; btn.disabled = false;
}

// Piezas que un vendedor vendió "bajo pedido" (ya no las tenía en mano,
// pero VEREX sí tenía en bodega) — hay que reponerle físicamente o se
// queda debiéndole la pieza al cliente. El worker las genera solo al
// vender la última unidad, acá solo se muestran y se pueden marcar resueltas.
let _reposicionesPendientes = [];
async function cargarReposicionesPendientes() {
    try {
        const res  = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accion:"GET_REPOSICIONES_PENDIENTES", _pass: _sessionPass }) });
        const data = await res.json();
        _reposicionesPendientes = data.reposiciones || [];
    } catch(e) { _reposicionesPendientes = []; }
    renderAlertasAfiliadosHub();
}

async function resolverReposicion(vendedor, codigo) {
    if (!confirm("¿Confirmas que ya le entregaste la pieza de reposición a este vendedor?")) return;
    try {
        const res  = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accion:"RESOLVER_REPOSICION", vendedor, codigo, _pass: _sessionPass }) });
        const data = await res.json();
        if (data.ok) {
            toast("✅ Reposición marcada como resuelta");
            await cargarReposicionesPendientes();
        } else toast("⚠️ " + (data.error||"No se pudo actualizar"), "#c0392b");
    } catch(e) { toast("⚠️ Error de conexión", "#c0392b"); }
}

// Cortes ya cerrados donde, al confirmar, no se marcó "ya recibí el pago" —
// nada obliga a cobrar/devolver antes de cerrar un corte, esto es solo el
// recordatorio de lo que quedó pendiente. Se muestra en el Hub y en Dashboard.
let _cortesPendientesCobro = [];
async function cargarCortesPendientesCobro() {
    try {
        const res  = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accion:"GET_CORTES_PENDIENTES_COBRO", _pass: _sessionPass }) });
        const data = await res.json();
        _cortesPendientesCobro = (data.cortes || []).sort((a,b) => new Date(a.fecha||0) - new Date(b.fecha||0));
    } catch(e) { _cortesPendientesCobro = []; }
    renderAlertasAfiliadosHub();
    if (document.getElementById("tab-content-dashboard")?.style.display === "block") renderDashboard();
}

async function marcarCorteCobrado(id) {
    if (!confirm("¿Confirmas que ya recibiste el pago de este corte?")) return;
    try {
        const res  = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accion:"MARCAR_CORTE_COBRADO", id, _pass: _sessionPass }) });
        const data = await res.json();
        if (data.ok) {
            toast("✅ Marcado como cobrado");
            await cargarCortesPendientesCobro();
        } else toast("⚠️ " + (data.error||"No se pudo actualizar"), "#c0392b");
    } catch(e) { toast("⚠️ Error de conexión", "#c0392b"); }
}

// Borra un registro del historial de cortes — para limpiar duplicados (ej.
// los que deja un doble-tap en "Confirmar Corte") sin tocar inventario ni
// comisiones, ya que esto solo borra el registro de historial/cobro.
async function eliminarCorteHistorial(id) {
    if (!confirm("¿Eliminar este registro del historial de cortes? No se puede deshacer.")) return;
    try {
        const res  = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ accion:"ELIMINAR_CORTE_HISTORIAL", id, _pass: _sessionPass }) });
        const data = await res.json();
        if (data.ok) {
            toast("🗑️ Registro eliminado");
            await cargarCortesPendientesCobro();
        } else toast("⚠️ " + (data.error||"No se pudo eliminar"), "#c0392b");
    } catch(e) { toast("⚠️ Error de conexión", "#c0392b"); }
}
