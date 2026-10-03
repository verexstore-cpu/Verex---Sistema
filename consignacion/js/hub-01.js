
const API_URL  = "https://verex-api.verexstore.workers.dev/";
const BASE_URL = window.location.href.split('?')[0];

// Hash SHA-256 de la contraseña — la contraseña real no vive en el código
let PASS_HASH = "288c61b77753c1b1d08c4fb0a7a11dfbb2abd5c3fd6ceaf405fa09300afe4fe5";
let _sessionPass = null;

async function hashStr(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function sanitizar(str) {
    return String(str ?? "")
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function jsArg(val) {
    return JSON.stringify(String(val ?? "")).replace(/"/g,"&quot;");
}

function jsArgArr(arr) {
    return JSON.stringify(arr || []).replace(/"/g,"&quot;");
}

function safeParseJSON(str, fallback) {
    if (str == null) return fallback;
    try {
        const r = JSON.parse(str);
        // Si el resultado es null/undefined, usar el fallback
        return r ?? fallback;
    } catch(_) { return fallback; }
}

const RANGOS_COMISION = [
    { min: 0,    max: 199.99,  pct: 25 },
    { min: 200,  max: 399.99,  pct: 30 },
    { min: 400,  max: 99999,   pct: 35 },
];

// Afiliados no manejan piezas físicas ni asumen riesgo de inventario no vendido —
// comisión más baja que consignación, pero sigue subiendo por tramos según lo vendido.
const RANGOS_COMISION_AFILIADO = [
    { min: 0,    max: 199.99,  pct: 20 },
    { min: 200,  max: 399.99,  pct: 25 },
    { min: 400,  max: 99999,   pct: 30 },
];

let vendedores   = [];
let consignacion = [];
let vendedorActual = null;
let productosDisponibles = [];
// Promo general definida en Admin (Catálogo Cliente) — se ofrece también acá
// para no tener que calcular a mano el mismo descuento en Venta Directa.
let promoGeneral = null;
let carritoEntrega = {};
let fotoBase64 = "";

async function login() {
    const pass = document.getElementById("inp-pass").value;
    const hash = await hashStr(pass);
    if (hash !== PASS_HASH) { toast("⚠️ Contraseña incorrecta", "#c0392b"); return; }
    _sessionPass = pass;
    localStorage.setItem("vx_consig_session", pass);
    localStorage.setItem("vx_consig_session_exp", Date.now() + 8 * 60 * 60 * 1000);
    document.getElementById("pantalla-login").style.display = "none";
    document.getElementById("app").style.display = "block";
    cargarDatos();
    iniciarAutoSync();
    document.querySelectorAll('.menu-btn[data-color]').forEach(btn => {
        btn.style.setProperty('--mc', btn.dataset.color);
    });
}

// Abre Admin Tienda sin volver a pedir contraseña ni código de Telegram —
// el Hub ya está autenticado, así que le pide al worker un token corto de
// un solo uso (90s) y Admin lo canjea al cargar. Si algo falla, cae al
// link normal (Admin sigue pidiendo su login completo como siempre).
async function abrirAdminSSO() {
    try {
        const res = await fetch(API_URL, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ accion: "SSO_CREAR_TOKEN", _pass: _sessionPass })
        });
        const data = await res.json();
        if (data.ok && data.token) {
            window.open("https://admin-tienda.pages.dev/?sso=" + encodeURIComponent(data.token), "_blank");
            return;
        }
    } catch(e) {}
    window.open("https://admin-tienda.pages.dev", "_blank");
}

let _autoSyncInterval = null;
let _pausarSyncHasta  = 0; // timestamp: no sincronizar hasta esta hora
function iniciarAutoSync() {
    if (_autoSyncInterval) clearInterval(_autoSyncInterval);
    _autoSyncInterval = setInterval(async () => {
        // No sincronizar si hay un modal abierto o si hubo acción reciente
        const modalAbierto = document.querySelector('.modal-overlay.active');
        if (modalAbierto || Date.now() < _pausarSyncHasta) return;
        try {
            const res  = await fetch(API_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ accion: "GET_CONSIGNACION", _pass: _sessionPass }) });
            const data = await res.json();
            vendedores           = data.vendedores   || [];
            consignacion         = data.consignacion || [];
            productosDisponibles = data.productos    || [];
            promoGeneral         = data.config?.promoGeneral || null;
            _renderBotonPromoGeneralVD(); // por si Venta Directa está abierta con productos ya en el carrito
            if (Date.now() - _linksAfiliadoTs > 300000) cargarLinksAfiliados();
            // Re-renderizar vista activa sin interrumpir al usuario
            const enPerfil = document.getElementById("pantalla-perfil")?.style.display !== "none";
            if (enPerfil && vendedorActual) {
                renderPerfilStats();
                renderInventario();
                renderVentasPerfil();
            } else {
                renderVendedores();
            }
            // Leads y pedidos de tienda cambian solos (clientes que piden): se refrescan cada ~30 s
            if (Date.now() - _pedidosTs > 30000) { await cargarLeads(); cargarPedidosTienda(); }
            renderAlertasAfiliadosHub(); // mantiene vivos los avisos de Vendedores y Pedidos
            // Indicador discreto
            const ind = document.getElementById("sync-indicator");
            if (ind) { ind.textContent = "↻ " + new Date().toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}); }
        } catch(e) { /* silencioso */ }
    }, 10000); // cada 10 segundos
}

async function actualizarSistema() {
    const btn = document.getElementById("btn-actualizar");
    btn.textContent = "⏳ Actualizando...";
    btn.disabled = true;
    await cargarDatos();
    btn.textContent = "🔄 Actualizar";
    btn.disabled = false;
    toast("✅ Datos actualizados");
}

function cerrarSesion() {
    _sessionPass = null;
    localStorage.removeItem("vx_consig_session");
    localStorage.removeItem("vx_consig_session_exp");
    if (_autoSyncInterval) { clearInterval(_autoSyncInterval); _autoSyncInterval = null; }
    document.getElementById("pantalla-login").style.display = "flex";
    document.getElementById("app").style.display = "none";
    document.getElementById("inp-pass").value = "";
}

let leadsData = [];

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

async function _usaActualizar(i, patch, okMsg) {
    const g = _usaGrupos[i];
    if (!g) return;
    try {
        const rs = await Promise.all(g.leads.map(l => apiPost({ accion: "ACTUALIZAR_LEAD_USA", id: l.id, ...patch })));
        const fallo = rs.find(r => !r || r.ok === false);
        if (fallo) throw new Error(fallo?.error || "No se pudo actualizar");
        g.leads.forEach(l => Object.assign(l, patch));
        toast(okMsg);
    } catch (e) { toast("⚠️ " + e.message, "#c0392b"); }
    renderPedidosHub();
}
function usaMarcarPagado(i) {
    if (!confirm("¿Confirmas que ya recibiste el pago de este pedido USA? Se envía el correo de pago confirmado al cliente.")) return;
    _usaActualizar(i, { pagadoUSA: true }, "✅ Pago confirmado");
}
function usaMarcarEnviado(i) {
    const trk = (document.getElementById("usa-trk-" + i)?.value || "").trim();
    if (!trk) { document.getElementById("usa-trk-" + i)?.focus(); toast("⚠️ Escribe el tracking de DHL", "#c0392b"); return; }
    _usaActualizar(i, { trackingDHL: trk }, "📦 Pedido marcado como enviado");
}
function usaMarcarEntregado(i) {
    if (!confirm("¿Confirmas que este pedido USA fue entregado? Cierra la venta.")) return;
    _usaActualizar(i, { entregadoUSA: true }, "✅ Pedido entregado");
}

// Diagnóstico de PayPal: comprueba que las claves del worker existan y que PayPal las acepte (no muestra ningún valor).
async function probarPayPal(btn) {
    const txt = btn.textContent; btn.textContent = "Probando…"; btn.disabled = true;
    try {
        const r = await apiPost({ accion: "PROBAR_PAYPAL" });
        const modo = r.entorno === "live" ? "REAL (live) — cobra dinero de verdad" : "PRUEBAS (sandbox) — no mueve dinero";
        const lista = `• PAYPAL_CLIENT_ID: ${r.tieneClientId ? "✅" : "❌ falta"}\n• PAYPAL_SECRET: ${r.tieneSecret ? "✅" : "❌ falta"}\n• PAYPAL_WEBHOOK_ID: ${r.tieneWebhookId ? "✅" : "❌ falta (solo afecta al respaldo)"}\n• PAYPAL_ENV: ${r.entornoDefinido ? r.entornoDefinido : "(vacío → se usa sandbox)"}`;
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
                const items = g.leads.map(l => `${sanitizar(l.nombre || l.codigo)} ×${parseInt(l.qty) || 1}`).join(", ");
                const sub = g.leads.reduce((s, l) => s + (parseFloat(l.precio) || 0) * (parseInt(l.qty) || 1), 0);
                const totUSD = f.totalPedidoUSD != null ? parseFloat(f.totalPedidoUSD) : sub;
                const etapa = !f.pagadoUSA ? "pago" : !f.trackingDHL ? "envio" : "entrega";
                const chip = { pago: ["SIN PAGAR", "#f97316"], envio: ["PAGADO · POR ENVIAR", "#a66be8"], entrega: ["ENVIADO · " + sanitizar(f.trackingDHL || ""), "#3b82f6"] }[etapa];
                const d = dias(f.fecha);
                const accion = etapa === "pago"
                    ? `${f.pagoLink ? `<button onclick="navigator.clipboard.writeText(${jsArg(f.pagoLink)});toast('✅ Link de pago copiado','#22c55e')" style="${btnS}background:#4a4a4e;">📋 Link de pago</button>` : ''}
                       <button onclick="usaMarcarPagado(${i})" style="${btnS}background:#27ae60;">💵 Marcar pagado</button>`
                    : etapa === "envio"
                    ? `<input id="usa-trk-${i}" placeholder="Tracking DHL" style="width:130px;padding:5px 8px;font-size:11px;border-radius:6px;border:1px solid var(--borde);background:var(--negro);color:#fff;">
                       <button onclick="usaMarcarEnviado(${i})" style="${btnS}background:#3b82f6;">📦 Marcar enviado</button>`
                    : `<button onclick="usaMarcarEntregado(${i})" style="${btnS}background:#27ae60;">✅ Entregado</button>`;
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
                            <div style="font-weight:700;font-size:13px;">${sanitizar(f.nombreCliente || "(sin nombre)")} <span style="font-size:10px;color:${chip[1]};border:1px solid currentColor;border-radius:5px;padding:1px 6px;margin-left:4px;">${chip[0]}</span></div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">${items}</div>
                            <div style="font-size:11px;color:var(--plateado);margin-top:2px;">📍 ${sanitizar([f.ciudadUS, f.estadoUS, f.zipUS].filter(Boolean).join(", ") || f.direccionCliente || "—")} · <b style="color:var(--dorado-claro);">$${totUSD.toFixed(2)} USD</b></div>
                            ${tel ? `<a href="https://wa.me/${tel}" target="_blank" style="font-size:11px;color:#25D366;font-weight:700;text-decoration:none;">📱 ${sanitizar(f.telefonoCliente)}</a>` : ''}
                            ${avisoCobro}<div style="font-size:11px;color:var(--plateado);margin-top:3px;">${d >= 1 ? `hace ${d} día${d > 1 ? 's' : ''}` : "Hoy"}</div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-items:stretch;">${accion}</div>
                    </div>
                </div>`;
            }).join("")}
        </div>` : '';

    cont.innerHTML = ((bloqueNuevos + bloqueTienda + bloqueEnCamino + bloqueSinCompletar + bloqueUSA) ||
        '<div class="card"><h2>📋 Pedidos</h2><p style="color:#4ade80;font-size:14px;">✅ Todo al día — no hay pedidos pendientes de atender.</p></div>') +
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

async function cargarDatos() {
    const grid = document.getElementById("grid-vendedores");
    grid.innerHTML = '<div style="color:var(--plateado);font-size:13px;padding:10px;">⏳ Cargando...</div>';
    try {
        const res  = await fetch(API_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ accion: "GET_CONSIGNACION", _pass: _sessionPass }) });
        const data = await res.json();
        vendedores           = data.vendedores   || [];
        consignacion         = data.consignacion || [];
        productosDisponibles = data.productos    || [];
        promoGeneral         = data.config?.promoGeneral || null;
        await cargarLeads();
        cargarPedidosTienda();
        renderVendedores();
        renderAlertasAfiliadosHub();
        if (document.getElementById("tab-content-dashboard")?.style.display === "block") renderDashboard();
        cargarReposicionesPendientes();
        cargarCortesPendientesCobro();
        cargarLinksAfiliados();
        cargarSolicitudes(); // Verificar solicitudes pendientes
    } catch(e) {
        toast("⚠️ Error conectando", "#c0392b");
        grid.innerHTML = '<div style="color:#e74c3c;font-size:13px;padding:10px;">⚠️ Error al cargar. Recarga la página.</div>';
    }
}

async function apiPost(datos) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...datos, _pass: _sessionPass })
    });
    return await res.json();
}

const TAB_METALS = {
    pedidos:       { bg: 'linear-gradient(135deg,#4a2a6b,#a66be8,#6b3aa8,#c9a0ff,#4a2a6b)', color: '#f5ecff', shadow: '0 2px 8px rgba(166,107,232,0.5)' },
    vendedores:    { bg: 'linear-gradient(135deg,#7a5500,#C9A84C,#a87d20,#F5D78E,#7a5500)', color: '#fff8e1', shadow: '0 2px 8px rgba(201,168,76,0.5)' },
    dashboard:     { bg: 'linear-gradient(135deg,#1a3a6b,#4a90d9,#1a5fa8,#6ab0f5,#1a3a6b)', color: '#e8f4ff', shadow: '0 2px 8px rgba(74,144,217,0.5)' },
    fotoqr:        { bg: 'linear-gradient(135deg,#1a4a2e,#27ae60,#0e6b35,#52d68a,#1a4a2e)', color: '#e8fff2', shadow: '0 2px 8px rgba(39,174,96,0.5)' },
    etiquetas:     { bg: 'linear-gradient(135deg,#6b1a2a,#e8748a,#b03050,#f5a0b0,#6b1a2a)', color: '#fff0f3', shadow: '0 2px 8px rgba(232,116,138,0.5)' },
    stock:         { bg: 'linear-gradient(135deg,#4a2800,#cd8c52,#7a4a1a,#e8b07a,#4a2800)', color: '#fff3e0', shadow: '0 2px 8px rgba(205,140,82,0.5)' },
    ventadirecta:    { bg: 'linear-gradient(135deg,#0a4a6b,#0ea5e9,#0369a1,#38bdf8,#0a4a6b)', color: '#e0f7ff', shadow: '0 2px 8px rgba(14,165,233,0.5)' },
    historialventas: { bg: 'linear-gradient(135deg,#005f5f,#00c2c2,#008a8a,#00e5e5,#005f5f)', color: '#e0ffff', shadow: '0 2px 8px rgba(0,194,194,0.5)' },
};
const TAB_INACTIVE = { bg: 'linear-gradient(135deg,#2a2a2a,#4a4a4a,#333,#555,#2a2a2a)', color: '#fff', shadow: 'none' };

// Pestañas con aviso de actividad pendiente (lo calculan renderAlertasAfiliadosHub
// y renderPedidosHub).
const _tabAlertas = { vendedores: 0, pedidos: 0 };
let _tabActual = '';   // '' = pantalla limpia (solo logo y botones)
const TAB_ALERTA = { bg: 'linear-gradient(135deg,#7a1a10,#e74c3c,#b03020,#ff7b6b,#7a1a10)', color: '#fff', shadow: '0 2px 10px rgba(231,76,60,0.7)' };

function pintarTabs(tab) {
    _tabActual = tab;
    document.getElementById('pantalla-vendedores')?.classList.toggle('hub-limpio', tab === '');
    const tabs = ['vendedores', 'pedidos', 'dashboard', 'fotoqr', 'etiquetas', 'stock', 'ventadirecta', 'historialventas'];
    tabs.forEach(t => {
        document.getElementById('tab-content-' + t).style.display = t === tab ? 'block' : 'none';
        const btn = document.getElementById('tab-' + t);
        const alerta = t !== tab && (_tabAlertas[t] || 0) > 0;
        const m = t === tab ? TAB_METALS[t] : alerta ? TAB_ALERTA : TAB_INACTIVE;
        btn.style.background  = m.bg;
        btn.style.color       = m.color;
        btn.style.boxShadow   = m.shadow;
        btn.style.filter      = 'none';
        if (t in _tabAlertas) btn.classList.toggle('tab-alerta', alerta);
    });
}

document.addEventListener('DOMContentLoaded', () => pintarTabs(''));

// toggle=true (clic del usuario en la barra): si la pestaña ya está abierta, se cierra
// volviendo a la pantalla limpia. Las llamadas desde código no usan toggle.
function cambiarTab(tab, toggle) {
    if (toggle && tab === _tabActual) tab = '';
    pintarTabs(tab);
    if (tab === 'dashboard')    renderDashboard();
    if (tab === 'etiquetas')  { refrescarProductosEtiquetas(); setTimeout(()=>{ const f=document.getElementById('bus-etiquetas'); if(f)f.focus(); },300); }
    if (tab === 'stock')      { cargarStock(); setTimeout(()=>{ const f=document.getElementById('bus-stock'); if(f)f.focus(); },300); }
    if (tab === 'ventadirecta')    { iniciarVentaDirecta(); document.getElementById("fab-historial-vd").style.display = "flex"; document.getElementById("fab-scan-vd").style.display = "block"; }
    else { document.getElementById("fab-historial-vd").style.display = "none"; document.getElementById("fab-scan-vd").style.display = "none"; }
    if (tab === 'historialventas') cargarHistorialVentas();
}

// ── ETIQUETAS ────────────────────────────────────────────────────────
let seleccionEtiquetas = new Set();

async function refrescarProductosEtiquetas() {
    // stockData ya fue actualizado por cargarStock() y es la fuente definitiva
    if (stockData && stockData.length) {
        productosDisponibles = stockData.filter(p => p.estado !== "inactivo");
    } else {
        try {
            const res = await apiPost({ accion: "STOCK_GET_ALL" });
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

function renderDashboard() {
    cargarImagenesInformativas();
    const inv = consignacion.filter(c => c.estado === "activo");
    const vendedoresActivos = vendedores.filter(v =>
        inv.some(c => c.vendedor === v.codigo)
    );

    // KPIs
    const totalPiezas = inv.reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);
    const totalValor  = inv.reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)) * parseFloat(c.precio||0), 0);
    const totalPorCobrar = inv.reduce((s, c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);

    document.getElementById("dash-vendedores").textContent = vendedoresActivos.length;
    document.getElementById("dash-piezas").textContent = totalPiezas;
    document.getElementById("dash-valor").textContent = "$" + totalValor.toFixed(0);

    // Cobros pendientes — cortes cerrados sin marcar "ya recibí el pago"
    const cobrosCard = document.getElementById("dash-cobros-card");
    const cobrosDiv  = document.getElementById("dash-cobros");
    if (_cortesPendientesCobro.length) {
        cobrosCard.style.display = "block";
        cobrosDiv.innerHTML = _cortesPendientesCobro.map(c => {
            const fecha = c.fecha ? new Date(c.fecha).toLocaleDateString("es-SV", { day: "numeric", month: "short" }) : "—";
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--gris2);border-radius:8px;margin-bottom:8px;border-left:3px solid #e67e22;">
                <div>
                    <div style="font-size:13px;font-weight:600;">${sanitizar(c.vendedorNombre || c.vendedor)}</div>
                    <div style="font-size:11px;color:var(--plateado);">Corte del ${sanitizar(fecha)} — $${parseFloat(c.aPagarVerex||0).toFixed(2)} sin cobrar</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <button class="btn" style="background:#e67e22;color:#fff;padding:5px 12px;font-size:11px;" onclick="marcarCorteCobrado('${sanitizar(c.id)}')">💰 Ya cobré</button>
                    <button class="btn" style="background:none;color:#e74c3c;border:1px solid #e74c3c;padding:4px 12px;font-size:10px;" onclick="eliminarCorteHistorial('${sanitizar(c.id)}')">🗑️ Eliminar</button>
                </div>
            </div>`;
        }).join('');
    } else {
        cobrosCard.style.display = "none";
    }
    document.getElementById("dash-vendido").textContent = "$" + totalPorCobrar.toFixed(0);

    // Alertas de corte
    const alertas = [];
    vendedores.forEach(v => {
        const real = corteRealDe(v);
        if (!real || !corteAplica(v)) return;
        if (real.dias <= 5) alertas.push({ v, dias: real.dias });
    });
    const alertasCard = document.getElementById("dash-alertas-card");
    const alertasDiv  = document.getElementById("dash-alertas");
    if (alertas.length) {
        alertasCard.style.display = "block";
        alertasDiv.innerHTML = alertas.sort((a,b) => a.dias - b.dias).map(({v, dias}) => {
            const color = dias <= 0 ? "#c0392b" : dias <= 2 ? "#e67e22" : "#C9A84C";
            const msg   = dias <= 0 ? "Vencido hace " + Math.abs(dias) + " días" : dias === 1 ? "Vence mañana" : "Vence en " + dias + " días";
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--gris2);border-radius:8px;margin-bottom:8px;border-left:3px solid ${color};">
                <div>
                    <div style="font-size:13px;font-weight:600;">${sanitizar(v.nombre)}</div>
                    <div style="font-size:11px;color:var(--plateado);">${sanitizar(msg)}</div>
                </div>
                <button class="btn btn-dorado" style="padding:5px 12px;font-size:11px;" onclick="cambiarTab('vendedores');abrirPerfil(${jsArg(v.codigo)})">Ver</button>
            </div>`;
        }).join('');
    } else {
        alertasCard.style.display = "none";
    }

    // Ranking
    const rankingData = vendedores.map(v => {
        const vInv = inv.filter(c => c.vendedor === v.codigo);
        const vendido = vInv.reduce((s,c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);
        const stock   = vInv.reduce((s,c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);
        return { v, vendido, stock };
    }).filter(x => x.vendido > 0 || x.stock > 0).sort((a,b) => b.vendido - a.vendido);

    document.getElementById("dash-ranking").innerHTML = rankingData.length ? rankingData.map((item, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}.`;
        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--gris2);border-radius:8px;margin-bottom:8px;">
            <div style="font-size:18px;min-width:28px;">${medal}</div>
            <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">${sanitizar(item.v.nombre)}</div>
                <div style="font-size:11px;color:var(--plateado);">${item.stock} piezas en calle</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:14px;font-weight:700;color:var(--dorado);">$${item.vendido.toFixed(0)}</div>
                <div style="font-size:10px;color:var(--plateado);">por cobrar</div>
            </div>
        </div>`;
    }).join('') : '<p style="color:var(--plateado);font-size:13px;">No hay datos de ventas aún.</p>';

    // Gráfica de barras
    const graficaData = vendedores.map(v => {
        const vInv = inv.filter(c => c.vendedor === v.codigo);
        const stock = vInv.reduce((s,c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);
        return { nombre: v.nombre.split(' ')[0], stock };
    }).filter(x => x.stock > 0).sort((a,b) => b.stock - a.stock);

    const maxStock = Math.max(...graficaData.map(x => x.stock), 1);
    document.getElementById("dash-grafica").innerHTML = graficaData.length ? graficaData.map(item => {
        const pct = Math.round((item.stock / maxStock) * 100);
        return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span>${item.nombre}</span>
                <span style="color:var(--dorado);font-weight:600;">${item.stock} piezas</span>
            </div>
            <div style="background:var(--gris2);border-radius:4px;height:10px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--dorado),var(--dorado-claro));border-radius:4px;transition:width 0.5s;"></div>
            </div>
        </div>`;
    }).join('') : '<p style="color:var(--plateado);font-size:13px;">No hay datos aún.</p>';
}

// ── PRÓXIMO CORTE (siempre visible) ─────────────────────────────────────────
// Próximo corte = último corte (fechaCorte) + 30 días — la misma regla que usan
// las alertas y el cierre del link de inventario. Si el vendedor aún no ha
// hecho ningún corte, se cuenta desde su registro SOLO para mostrarlo (marcado
// como estimado): las alertas y el link de inventario siguen usando únicamente
// fechaCorte, así que esto no bloquea ni avisa a nadie por su cuenta.
// Fecha REAL del corte (o null): la fijada a mano (proximoCorte, "AAAA-MM-DD")
// manda sobre "último corte + 30 días". Es lo que usan las alertas y el aviso.
function corteRealDe(v) {
    if (v?.proximoCorte && /^\d{4}-\d{2}-\d{2}$/.test(v.proximoCorte)) {
        const [y, m, d] = v.proximoCorte.split("-").map(Number);
        const fecha = new Date(y, m - 1, d);
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        return { fecha, dias: Math.round((fecha - hoy) / 86400000), manual: true };
    }
    if (v?.fechaCorte) {
        const fecha = new Date(v.fechaCorte);
        if (isNaN(fecha)) return null;
        fecha.setDate(fecha.getDate() + 30);
        return { fecha, dias: Math.ceil((fecha - Date.now()) / 86400000), manual: false };
    }
    return null;
}

function infoProximoCorte(v) {
    const real = corteRealDe(v);
    if (real) {
        const color = real.dias <= 0 ? "#e74c3c" : real.dias <= 2 ? "#e67e22" : real.dias <= 5 ? "#C9A84C" : "var(--plateado)";
        return { fecha: real.fecha, dias: real.dias, color, estimado: false, manual: real.manual };
    }
    const base = v?.fechaRegistro;
    if (!base) return null;
    const fecha = new Date(base);
    if (isNaN(fecha)) return null;
    fecha.setDate(fecha.getDate() + 30);
    const dias = Math.ceil((fecha - Date.now()) / 86400000);
    const color = dias <= 0 ? "#e74c3c" : dias <= 2 ? "#e67e22" : dias <= 5 ? "#C9A84C" : "var(--plateado)";
    return { fecha, dias, color, estimado: !v.fechaCorte };
}

function _proximoCorteCardHTML(v) {
    const est = estadoLinkVendedor(v);
    if (est === "verificando") return `<div style="font-size:10px;color:var(--plateado);margin-top:3px;">📅 Verificando link…</div>`;
    if (est === "inactivo") return `<div style="font-size:10px;color:#777;margin-top:3px;" title="Sin link activo: no hay corte pendiente hasta que se le genere uno">📅 Sin link · sin corte pendiente</div>`;
    const info = infoProximoCorte(v);
    if (!info) return `<div style="font-size:10px;color:var(--plateado);margin-top:3px;">📅 Sin corte registrado</div>`;
    const corta = info.fecha.toLocaleDateString("es-SV", { day: "numeric", month: "short" });
    const cuando = info.dias > 1 ? `en ${info.dias} d` : info.dias === 1 ? "mañana" : info.dias === 0 ? "hoy" : `vencido hace ${Math.abs(info.dias)} d`;
    const titulo = `Próximo corte: ${info.fecha.toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" })}` + (info.estimado ? " (estimado desde su registro: aún no ha hecho ningún corte)" : "");
    return `<div style="font-size:10px;font-weight:600;color:${info.color};margin-top:3px;" title="${sanitizar(titulo)}">📅 Corte ${info.estimado ? "~" : ""}${corta} · ${cuando}</div>`;
}

function renderProximoCortePerfil() {
    const el = document.getElementById("perfil-proximo-corte");
    if (!el || !vendedorActual) return;
    const est = estadoLinkVendedor(vendedorActual);
    if (est === "verificando") { el.style.color = "var(--plateado)"; el.innerHTML = "📅 Próximo corte: verificando el link del afiliado…"; return; }
    if (est === "inactivo") {
        el.style.color = "#888";
        el.innerHTML = `📅 Sin link activo — no hay corte pendiente <span style="font-weight:400;">(el corte se cuenta mientras tenga un link vigente; se reactiva al generarle uno)</span>`;
        return;
    }
    const info = infoProximoCorte(vendedorActual);
    const enlaceFijar = ` <span onclick="event.stopPropagation();fijarProximoCorte()" style="color:#0277bd;cursor:pointer;text-decoration:underline;font-weight:400;">✏️ fijar fecha</span>`;
    if (!info) { el.innerHTML = "📅 Próximo corte: sin corte registrado" + enlaceFijar; el.style.color = "var(--plateado)"; return; }
    const fmt = f => f.toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
    const cuando = info.dias > 1 ? `faltan ${info.dias} días` : info.dias === 1 ? "vence mañana" : info.dias === 0 ? "vence hoy" : `vencido hace ${Math.abs(info.dias)} días`;
    const detalle = info.manual
        ? `<span style="font-weight:400;">fecha fijada a mano</span>`
        : info.estimado
        ? `<span style="font-weight:400;">30 días desde su registro — aún no ha hecho ningún corte</span>`
        : `<span style="font-weight:400;">último corte: ${fmt(new Date(vendedorActual.fechaCorte))}</span>`;
    el.style.color = info.color;
    el.innerHTML = `📅 Próximo corte: ${info.estimado ? "~ " : ""}${fmt(info.fecha)} · ${cuando} <span style="opacity:.8;">(${detalle})</span>` + enlaceFijar;
}

// ── Fijar a mano la fecha del próximo corte ─────────────────────────────────
// Para vendedores que aún no han hecho ningún corte (no tienen fechaCorte) o
// cuando el corte se acordó para otro día. Se guarda en su propio campo
// (proximoCorte) y NO como fechaCorte a propósito: la página del vendedor usa
// fechaCorte para decidir qué piezas le muestra (oculta lo entregado antes),
// así que falsearla le escondería inventario. Se borra al cerrar un corte real.
let _pcEnviando = false;
const _isoLocal = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

function fijarProximoCorte() {
    if (!vendedorActual) return;
    document.getElementById("pc-nombre").textContent = (vendedorActual.nombre || "") + " · " + vendedorActual.codigo;
    const inp = document.getElementById("pc-fecha");
    inp.min = _isoLocal(new Date());
    inp.value = vendedorActual.proximoCorte || "";
    document.getElementById("pc-quitar").style.display = vendedorActual.proximoCorte ? "block" : "none";
    pcActualizarAviso();
    abrirModal("modal-proximo-corte");
}

function pcActualizarAviso() {
    const el = document.getElementById("pc-aviso");
    const v = document.getElementById("pc-fecha").value;
    if (!v) { el.textContent = ""; return; }
    const [y, m, d] = v.split("-").map(Number);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
    if (dias < 0) { el.style.color = "#e74c3c"; el.textContent = "⚠️ Esa fecha ya pasó: su link de inventario se cerraría de inmediato."; return; }
    el.style.color = "var(--plateado)";
    el.textContent = (dias === 0 ? "Es hoy." : dias === 1 ? "Es mañana." : `Faltan ${dias} días.`)
        + " El vendedor verá el recordatorio desde 7 días antes, y su link de inventario se cierra después de ese día si no se hace el corte.";
}

async function guardarProximoCorte() {
    const fecha = document.getElementById("pc-fecha").value;
    if (!fecha) return toast("⚠️ Elige una fecha");
    const [y, m, d] = fecha.split("-").map(Number);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
    if (dias < 0) return toast("⚠️ Elige hoy o una fecha futura", "#c0392b");
    if (dias > 30 && !confirm(`Esa fecha está a ${dias} días (más de los 30 habituales). ¿Guardarla igual?`)) return;
    await _enviarProximoCorte(fecha);
}

async function quitarProximoCorte() {
    if (!confirm("¿Quitar la fecha fijada? Volverá a contarse 30 días desde su último corte (o quedará sin fecha si nunca ha cortado).")) return;
    await _enviarProximoCorte(null);
}

async function _enviarProximoCorte(fecha) {
    if (_pcEnviando || !vendedorActual) return;
    _pcEnviando = true;
    try {
        const data = await apiPost({ accion: "FIJAR_PROXIMO_CORTE", vendedor: vendedorActual.codigo, fecha });
        if (!data.ok) throw new Error(data.error || "No se pudo guardar");
        vendedorActual.proximoCorte = fecha;
        cerrarModal("modal-proximo-corte");
        toast(fecha ? "✅ Fecha del corte guardada" : "✅ Fecha del corte quitada");
        abrirPerfil(vendedorActual.codigo); // refresca el aviso rojo y la línea del perfil
        renderVendedores();
        renderAlertasAfiliadosHub();
    } catch (e) {
        toast("⚠️ " + e.message, "#c0392b");
    } finally {
        _pcEnviando = false;
    }
}

// ── Entregas pendientes de confirmar (por vendedor) ─────────────────────────
// Un doble toque al confirmar una entrega creaba DOS avisos de recepción para
// una sola entrega física (caso real: Jaime Solórzano, PUP105, 13-sep). Antes
// esos avisos no se veían en ninguna parte del panel hasta que el vendedor los
// confirmaba. Acá se listan, se señala la que parece duplicada, y se puede
// marcar como duplicada: NO se borra, el vendedor deja de verla y no cambia
// stock ni inventario.
async function cargarEntregasPendientesPerfil() {
    const box = document.getElementById("entregas-pendientes-box");
    if (!box || !vendedorActual) return;
    const cod = vendedorActual.codigo;
    box.style.display = "none";
    let ents;
    try { ents = (await apiPost({ accion: "GET_ENTREGAS_PENDIENTES", vendedor: cod })).entregas || []; }
    catch (_) { return; }
    if (!vendedorActual || vendedorActual.codigo !== cod || !ents.length) return; // cambió de perfil mientras cargaba

    const filas = ents.map(e => {
        let items = [];
        try { items = typeof e.items === "string" ? JSON.parse(e.items) : (e.items || []); } catch (_) {}
        return { e, items, t: new Date(e.fecha).getTime() || 0,
                 firma: items.map(i => (i.codigo || "") + "x" + (i.cantidad || 1)).sort().join("|") };
    }).sort((a, b) => a.t - b.t);
    // Posible duplicada: mismos productos que otra pendiente creada antes, con menos de 2 minutos de diferencia
    filas.forEach((f, i) => {
        const orig = filas.slice(0, i).find(o => o.firma === f.firma && (f.t - o.t) < 120000);
        if (orig) { f.dupDe = orig.e.id; f.seg = Math.round((f.t - orig.t) / 1000); }
    });

    box.innerHTML = `<div style="font-size:13px;color:#8ab4f0;font-weight:600;margin-bottom:6px;">
            ⏳ ${filas.length} entrega${filas.length > 1 ? "s" : ""} pendiente${filas.length > 1 ? "s" : ""} de confirmar por el vendedor</div>`
        + filas.map(f => {
            const cuando = f.e.fecha ? new Date(f.e.fecha).toLocaleString("es-SV", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
            const nombres = f.items.slice(0, 3).map(i => sanitizar(i.nombre || i.codigo)).join(", ");
            return `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(74,111,165,0.3);">
                <div style="min-width:0;font-size:12px;">
                    <div>${sanitizar(cuando)} · ${f.items.length} producto(s): ${nombres}</div>
                    <div style="color:var(--plateado);font-size:11px;">Código de recibo: <strong style="color:var(--dorado);">${sanitizar(f.e.codigoRecibo || "—")}</strong>
                    ${f.dupDe ? `<span style="color:#e8a44a;font-weight:700;"> · ⚠️ posible duplicada: mismos productos, ${f.seg} s después de otra</span>` : ""}</div>
                </div>
                <button onclick="marcarEntregaDuplicada(${jsArg(f.e.id)}, ${jsArg(f.dupDe || "")})"
                    style="flex-shrink:0;padding:6px 10px;border:1px solid ${f.dupDe ? "#e8a44a" : "var(--borde)"};border-radius:6px;background:${f.dupDe ? "rgba(232,164,74,0.15)" : "transparent"};color:${f.dupDe ? "#e8a44a" : "var(--plateado)"};font-size:11px;font-weight:600;cursor:pointer;">Marcar duplicada</button>
            </div>`;
        }).join("");
    box.style.display = "block";
}

async function marcarEntregaDuplicada(id, duplicadaDe) {
    if (!confirm("¿Marcar esta entrega como DUPLICADA?\n\nEl vendedor dejará de verla para confirmar. El registro se conserva (no se borra) y no cambia el stock ni el inventario.")) return;
    try {
        const res = await apiPost({ accion: "MARCAR_ENTREGA_DUPLICADA", id, duplicadaDe: duplicadaDe || undefined });
        if (!res.ok) throw new Error(res.error || "No se pudo marcar");
        toast("✅ Entrega marcada como duplicada");
        cargarEntregasPendientesPerfil();
    } catch (e) {
        toast("⚠️ " + e.message, "#c0392b");
    }
}

function renderVendedores() {
    const grid = document.getElementById("grid-vendedores");
    grid.innerHTML = vendedores.map(v => {
        const inv = consignacion.filter(c => c.vendedor === v.codigo && c.estado === "activo");
        const stock = inv.reduce((s, c) => s + (parseInt(c.cantidad) - parseInt(c.vendido||0)), 0);
        // Comisión acumulada en vivo — mismo cálculo exacto que "Hacer Corte",
        // así el número siempre calza con lo que saldría al cortar ahora mismo.
        let comisionLive = 0, comisionPct = 0;
        if (v.tipo === "afiliado" || v.tipo === "hibrido") {
            const valorVendCard = inv.reduce((s, c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);
            comisionPct  = calcularComision(valorVendCard, v.tipo, v.comisionFija);
            comisionLive = valorVendCard * comisionPct / 100;
        }
        const inicial = sanitizar((v.nombre || "?")[0].toUpperCase());
        const leadsPend = leadsData.filter(l => l.afiliado === v.codigo && (l.estado === "interesado" || l.estado === "reportado")).length;
        const inactivo = v.activo === false;
        return `<div class="vendedor-card" onclick="abrirPerfil(${jsArg(v.codigo)})" style="position:relative;${inactivo?'opacity:.5;':''}">
            <button onclick="event.stopPropagation();toggleMenuVendedor('menu-${sanitizar(v.codigo)}')"
                style="position:absolute;top:8px;right:8px;background:var(--gris);border:none;color:var(--plateado);border-radius:50%;width:26px;height:26px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;">⋯</button>
            <div id="menu-${sanitizar(v.codigo)}" style="display:none;position:absolute;top:36px;right:8px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;z-index:10;min-width:150px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
                <button onclick="event.stopPropagation();toggleActivoVendedor(${jsArg(v.codigo)})"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:${inactivo?'#27ae60':'#C9A84C'};font-size:13px;cursor:pointer;text-align:left;border-bottom:1px solid var(--borde);">${inactivo?'✅ Activar':'⏸️ Desactivar'}</button>
                <button onclick="event.stopPropagation();eliminarVendedor(${jsArg(v.codigo)},${jsArg(v.nombre)})"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:#e74c3c;font-size:13px;cursor:pointer;text-align:left;">🗑️ Eliminar</button>
            </div>
            <div style="position:relative;width:54px;margin:0 auto 10px;">
                <div class="vendedor-avatar" onclick="${leadsPend > 0 ? `event.stopPropagation();abrirLeadsVendedor(${jsArg(v.codigo)})` : ''}" title="${leadsPend > 0 ? leadsPend + ' Lead(s) pendientes de confirmar — toca para verlos' : 'Sin Leads pendientes'}" style="margin:0;${leadsPend > 0 ? 'background:#16a34a;color:#fff;cursor:pointer;box-shadow:0 0 0 3px rgba(22,163,74,.35);' : ''}">${inicial}</div>
                <div onclick="event.stopPropagation();abrirLeadsVendedor(${jsArg(v.codigo)})" title="${leadsPend} Lead(s) pendientes" style="position:absolute;top:-4px;right:-4px;background:#111;color:${leadsPend > 0 ? '#4ade80' : 'var(--dorado)'};border:2px solid ${leadsPend > 0 ? '#16a34a' : 'var(--dorado)'};border-radius:50%;width:20px;height:20px;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:pointer;">${leadsPend}</div>
            </div>
            <div class="vendedor-nombre">${sanitizar(v.nombre)}</div>
            <div style="font-size:10px;color:var(--dorado);font-weight:600;letter-spacing:1px;margin-bottom:2px;">${sanitizar(v.codigo)}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin-bottom:4px;">
                ${v.tipo === "afiliado"
                    ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.35);border-radius:5px;padding:1px 6px;">🤝 AFILIADO</div>'
                    : v.tipo === "hibrido"
                    ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#a78bfa;background:rgba(167,139,250,0.15);border:1px solid rgba(167,139,250,0.35);border-radius:5px;padding:1px 6px;">🔄 HÍBRIDO</div>'
                    : ''}
                ${(v.tipo === "afiliado" && v.recibeFisico) || v.tipo === "hibrido"
                    ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#C9A84C;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.35);border-radius:5px;padding:1px 6px;">📦 RECIBE PIEZAS</div>'
                    : ''}
                ${inactivo ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#888;background:rgba(136,136,136,0.15);border:1px solid rgba(136,136,136,0.35);border-radius:5px;padding:1px 6px;">⏸️ INACTIVO</div>' : ''}
                ${v.comisionFija !== undefined && v.comisionFija !== null ? `<div style="display:inline-block;font-size:9px;font-weight:700;color:#0277bd;background:rgba(2,119,189,0.15);border:1px solid rgba(2,119,189,0.35);border-radius:5px;padding:1px 6px;">${v.comisionFija}% fija</div>` : ''}
            </div>
            <div class="vendedor-stock">${stock} piezas</div>
            ${_proximoCorteCardHTML(v)}
            ${(v.tipo === "afiliado" || v.tipo === "hibrido") ? `<div style="font-size:11px;font-weight:700;color:#27ae60;margin-top:2px;" title="Comisión acumulada sin cortar">💰 $${comisionLive.toFixed(2)} <span style="color:var(--plateado);font-weight:400;">(${comisionPct}%)</span></div>` : ''}
        </div>`;
    }).join('') + `<button class="btn-nuevo-vendedor" onclick="abrirModalVendedor()">+ Nuevo Vendedor</button>`;
}

const ADMIN_CAT_URL = "https://admin-tienda.pages.dev";

async function _cargarStatsAfiliados(codigos) {
    await Promise.all(codigos.map(async codigo => {
        const el = document.getElementById("cat-stats-" + codigo);
        if (!el) return;
        try {
            const res = await fetch(ADMIN_CAT_URL + "/affiliate-stats", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ afiliadoCodigo: codigo })
            });
            if (!res.ok) { el.innerHTML = ""; return; }
            const { totalCatalogos, totalVistas, ultimaVista, catalogoActivo } = await res.json();

            if (!totalCatalogos && !catalogoActivo) {
                el.innerHTML = `<div style="font-size:10px;color:#555;text-align:center;">Sin catálogos generados</div>`;
                return;
            }

            const ultimaTotal = ultimaVista ? _catTiempoRelativo(ultimaVista) : "—";
            let html = "";

            if (catalogoActivo) {
                const vence = new Date(catalogoActivo.expiresAt).toLocaleDateString("es-SV", { day:"numeric", month:"short" });
                const ultimaCat = catalogoActivo.ultimaVista ? _catTiempoRelativo(catalogoActivo.ultimaVista) : null;
                const primeraApertura = catalogoActivo.primeraVista
                    ? new Date(catalogoActivo.primeraVista).toLocaleDateString("es-SV", { day:"numeric", month:"short" })
                    : null;

                html += `<div style="background:#0d1f0d;border:1px solid #1a3a1a;border-radius:8px;padding:7px 9px;margin-bottom:4px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:10px;font-weight:700;color:#4ade80;">🔗 Catálogo activo</span>
                        <span style="font-size:9px;color:#555;">vence ${vence}</span>
                    </div>
                    <div style="font-size:10px;color:#86efac;word-break:break-all;margin-bottom:5px;">${catalogoActivo.url}</div>
                    <div style="display:flex;gap:5px;margin-bottom:5px;">
                        <button onclick="navigator.clipboard.writeText('${catalogoActivo.url}');toast('✅ Link copiado','#22c55e')"
                            style="flex:1;font-size:10px;background:#166534;color:#fff;border:none;border-radius:5px;padding:4px 0;cursor:pointer;font-weight:600;">📋 Copiar</button>
                        <button onclick="window.open('${catalogoActivo.url}','_blank')"
                            style="font-size:10px;background:#1a3a1a;color:#86efac;border:1px solid #1a3a1a;border-radius:5px;padding:4px 8px;cursor:pointer;">👁️ Ver</button>
                        <button onclick="window.open('https://wa.me/?text='+encodeURIComponent('Hola, aquí está tu catálogo VEREX: ${catalogoActivo.url}'),'_blank')"
                            style="font-size:10px;background:#14532d;color:#4ade80;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;">📱</button>
                    </div>
                    <div style="font-size:10px;color:#6b7280;">
                        👁️ <b style="color:#d1fae5">${catalogoActivo.vistas}</b> ${catalogoActivo.vistas === 1 ? "apertura" : "aperturas"}
                        ${primeraApertura ? ` · primera: ${primeraApertura}` : ""}
                        ${ultimaCat ? ` · última: ${ultimaCat}` : " · aún no abierto"}
                        &nbsp;·&nbsp; ${catalogoActivo.prods} productos
                    </div>
                </div>`;
            } else {
                html += `<div style="font-size:10px;color:#555;text-align:center;margin-bottom:4px;">Sin catálogo activo</div>`;
            }

            if (totalCatalogos > 0) {
                html += `<div style="font-size:10px;color:#6b7280;text-align:center;">
                    📊 Total histórico: <b style="color:#9ca3af">${totalVistas}</b> vistas en ${totalCatalogos} catálogo${totalCatalogos !== 1 ? "s" : ""}
                    ${ultimaVista ? ` · última: ${ultimaTotal}` : ""}
                </div>`;
            }

            el.innerHTML = html;
        } catch(_) { el.innerHTML = ""; }
    }));
}

async function _cargarCatalogoPerfil(codigo) {
    const wrap = document.getElementById("perfil-catalogo-contenido");
    if (!wrap) return;
    wrap.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await fetch(ADMIN_CAT_URL + "/affiliate-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ afiliadoCodigo: codigo })
        });
        if (!res.ok) throw new Error("Sin respuesta");
        const { totalCatalogos, totalVistas, ultimaVista, catalogos } = await res.json();

        if (!catalogos?.length) {
            wrap.innerHTML = `<p style="color:var(--plateado);font-size:13px;">No hay catálogos generados para este afiliado.<br><span style="font-size:11px;">Genera el primero desde el Admin → tab Catálogo.</span></p>`;
            return;
        }

        // Resumen total
        const ultimaTxt = ultimaVista ? _catTiempoRelativo(ultimaVista) : "—";
        let html = `<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
            <div style="flex:1;min-width:80px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#fff;">${totalCatalogos}</div>
                <div style="font-size:10px;color:var(--plateado);">catálogos</div>
            </div>
            <div style="flex:1;min-width:80px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#4ade80;">${totalVistas}</div>
                <div style="font-size:10px;color:var(--plateado);">vistas totales</div>
            </div>
            <div style="flex:1;min-width:80px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:8px;text-align:center;">
                <div style="font-size:13px;font-weight:700;color:#C9A84C;">${ultimaTxt}</div>
                <div style="font-size:10px;color:var(--plateado);">última apertura</div>
            </div>
        </div>`;

        // Lista de catálogos del más reciente al más antiguo
        html += catalogos.map(cat => {
            const fechaGen  = cat.createdAt  ? new Date(cat.createdAt).toLocaleDateString("es-SV",  { day:"numeric", month:"short", year:"numeric" }) : "—";
            const fechaVence = cat.expiresAt ? new Date(cat.expiresAt).toLocaleDateString("es-SV",  { day:"numeric", month:"short" }) : "—";
            const primera   = cat.primeraVista ? new Date(cat.primeraVista).toLocaleDateString("es-SV", { day:"numeric", month:"short" }) : null;
            const ultima    = cat.ultimaVista   ? _catTiempoRelativo(cat.ultimaVista) : null;
            const borderColor = cat.activo ? "#16a34a" : "#374151";
            const statusBadge = cat.activo
                ? `<span style="font-size:10px;background:#14532d;color:#4ade80;border-radius:5px;padding:2px 7px;font-weight:700;">● ACTIVO</span>`
                : `<span style="font-size:10px;background:#1f2937;color:#6b7280;border-radius:5px;padding:2px 7px;">✕ Vencido</span>`;

            return `<div style="border:1px solid ${borderColor};border-radius:10px;padding:12px;margin-bottom:10px;background:var(--gris2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
                    <div>
                        <div style="font-size:12px;font-weight:700;color:#fff;">${cat.nombre || "(Sin nombre)"}</div>
                        <div style="font-size:10px;color:var(--plateado);">Generado: ${fechaGen} · vence: ${fechaVence} · ${cat.prods} productos</div>
                    </div>
                    ${statusBadge}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
                    <div style="background:#111;border-radius:7px;padding:7px;text-align:center;">
                        <div style="font-size:18px;font-weight:700;color:#4ade80;">${cat.vistas}</div>
                        <div style="font-size:9px;color:var(--plateado);">${cat.vistas === 1 ? "apertura" : "aperturas"}</div>
                    </div>
                    <div style="background:#111;border-radius:7px;padding:7px;text-align:center;">
                        <div style="font-size:12px;font-weight:700;color:#C9A84C;">${primera || "—"}</div>
                        <div style="font-size:9px;color:var(--plateado);">primera vista</div>
                    </div>
                    <div style="background:#111;border-radius:7px;padding:7px;text-align:center;">
                        <div style="font-size:12px;font-weight:700;color:#C9A84C;">${ultima || "—"}</div>
                        <div style="font-size:9px;color:var(--plateado);">última vista</div>
                    </div>
                </div>
                ${cat.vistas === 0 ? `<div style="font-size:11px;color:#6b7280;text-align:center;padding:4px 0;">Este catálogo nunca fue abierto</div>` : ""}
                <div style="display:flex;gap:6px;">
                    <button onclick="navigator.clipboard.writeText('${cat.url}');toast('✅ Link copiado','#22c55e')"
                        style="flex:1;font-size:11px;background:#166534;color:#fff;border:none;border-radius:7px;padding:7px 0;cursor:pointer;font-weight:600;">📋 Copiar link</button>
                    <button onclick="window.open('${cat.url}','_blank')"
                        style="font-size:11px;background:#1a3a1a;color:#86efac;border:1px solid #1a3a1a;border-radius:7px;padding:7px 10px;cursor:pointer;">👁️ Ver</button>
                    <button onclick="window.open('https://wa.me/?text='+encodeURIComponent('Hola, aquí está tu catálogo VEREX: ${cat.url}'),'_blank')"
                        style="font-size:11px;background:#14532d;color:#4ade80;border:none;border-radius:7px;padding:7px 10px;cursor:pointer;">📱</button>
                </div>
            </div>`;
        }).join("");

        wrap.innerHTML = html;
    } catch(_) {
        wrap.innerHTML = `<p style="color:var(--plateado);font-size:13px;">No se pudieron cargar las métricas. Verifica tu conexión.</p>`;
    }
}

function _catTiempoRelativo(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const dias = Math.floor(diff / 86400000);
    if (min < 2)  return "ahora";
    if (min < 60) return `hace ${min}min`;
    if (hrs < 24) return `hace ${hrs}h`;
    if (dias < 7) return `hace ${dias}d`;
    return new Date(ts).toLocaleDateString("es-SV", { day:"numeric", month:"short" });
}

const LEAD_ESTADO_INFO = {
    interesado: { label: "🔵 Interesado",  color: "#4a90d9" },
    reportado:  { label: "🟡 Reportado — pendiente de confirmar", color: "#C9A84C" },
    en_camino:  { label: "🚚 En camino — pendiente de entrega",   color: "#f97316" },
    vendido:    { label: "✅ Vendido",      color: "#27ae60" },
    rechazado:  { label: "❌ Rechazado en puerta", color: "#e74c3c" },
    cancelado:  { label: "❌ Cancelado",    color: "#888" },
};

function abrirLeadsVendedor(codigo) {
    const v = vendedores.find(x => x.codigo === codigo);
    document.getElementById("leads-titulo").textContent = "🔔 Leads — " + (v?.nombre || codigo);
    renderLeadsModal(codigo);
    abrirModal("modal-leads");
}

function renderLeadsModal(codigo) {
    const propios = leadsData
        .filter(l => l.afiliado === codigo)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const cont = document.getElementById("leads-lista");
    if (!propios.length) {
        cont.innerHTML = '<p style="color:var(--plateado);font-size:13px;">Sin Leads registrados.</p>';
        return;
    }
    cont.innerHTML = propios.map(l => {
        const info = LEAD_ESTADO_INFO[l.estado] || LEAD_ESTADO_INFO.interesado;
        const fecha = l.fecha ? new Date(l.fecha).toLocaleDateString("es-SV", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "";
        const accionable = l.estado === "interesado" || l.estado === "reportado";
        const enCamino = l.estado === "en_camino";
        const c = l.cliente;
        const casilla = (label, valor) => `<div style="background:var(--negro);border:1px solid var(--borde);border-radius:7px;padding:6px 9px;margin-bottom:5px;">
                <div style="font-size:9px;color:var(--plateado);font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:1px;">${label}</div>
                <div style="font-size:12px;font-weight:600;">${valor}</div>
            </div>`;
        const clienteHtml = c ? `<div style="margin-top:6px;font-size:11px;line-height:1.7;">
                <div style="display:inline-block;background:#16a34a;color:#fff;font-weight:800;font-size:12px;padding:5px 12px;border-radius:20px;margin-bottom:6px;">✅ Pedido completado por el afiliado</div>
                ${casilla("Nombre del cliente", sanitizar(c.nombre))}
                ${casilla("Teléfono", sanitizar(c.telefono))}
                ${casilla("Dirección", `${sanitizar(c.direccion)}, ${sanitizar(c.municipio)}, ${sanitizar(c.departamento)}`)}
                <div style="padding:6px 9px;">💵 Contra entrega en efectivo${l.envioInfo ? ` · Envío: ${l.envioInfo.envio===0?'GRATIS':'$'+l.envioInfo.envio.toFixed(2)} · Total: $${l.envioInfo.total.toFixed(2)}` : ''}</div>
            </div>` : '';
        return `<div style="padding:10px 12px;background:var(--gris2);border:1px solid var(--borde);border-radius:10px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
                ${l.foto ? `<img src="${sanitizar(ikFoto(l.foto,120))}" onerror="this.style.display='none'" onclick="verStockLead('${sanitizar(l.id)}','${sanitizar(l.codigo)}')" title="Ver stock y confirmar" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0;cursor:pointer;">` : ''}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:700;">${sanitizar(l.nombre||l.codigo)}</div>
                    <div style="font-size:11px;color:var(--plateado);">$${parseFloat(l.precio||0).toFixed(2)} · ${fecha}</div>
                    <div style="font-size:11px;font-weight:600;color:${info.color};margin-top:2px;">${info.label}</div>
                    <div style="font-size:10px;color:var(--dorado);margin-top:2px;cursor:pointer;text-decoration:underline;" onclick="verStockLead('${sanitizar(l.id)}','${sanitizar(l.codigo)}')">🔎 ${sanitizar(l.codigo)} — ver stock y confirmar</div>
                </div>
                ${accionable ? `<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                    <button onclick="confirmarLeadEnvio('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#f97316;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">📦 Empacar y Enviar</button>
                    <button onclick="cancelarLeadUI('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">❌ Cancelar</button>
                </div>` : ''}
                ${enCamino ? `<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;position:relative;">
                    <div style="display:flex;gap:2px;">
                        <button onclick="confirmarLeadEntrega('${sanitizar(l.id)}',false)" style="flex:1;padding:5px 8px;font-size:11px;background:#27ae60;color:#fff;border:none;border-radius:6px 0 0 6px;cursor:pointer;font-weight:600;">✅ Confirmar Entrega</button>
                        <button onclick="event.stopPropagation();toggleMenuCambio('${sanitizar(l.id)}',this)" title="Otras opciones" style="padding:5px 6px;font-size:11px;background:#1e6b3e;color:#fff;border:none;border-radius:0 6px 6px 0;cursor:pointer;font-weight:700;border-left:1px solid rgba(255,255,255,.25);">▾</button>
                    </div>
                    <div id="menu-cambio-${sanitizar(l.id)}" style="display:none;position:absolute;top:32px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:190px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                        <button onclick="event.stopPropagation();confirmarLeadEntrega('${sanitizar(l.id)}',true);document.getElementById('menu-cambio-${sanitizar(l.id)}').style.display='none';" style="display:block;width:100%;padding:9px 12px;font-size:11px;background:none;color:#a78bfa;border:none;cursor:pointer;text-align:left;font-weight:600;">🔄 Es un cambio (sin comisión)</button>
                    </div>
                    <button onclick="rechazarLeadEntrega('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">❌ Rechazado en puerta</button>
                </div>` : ''}
                ${(l.estado === "vendido" || l.estado === "en_camino") ? `<button onclick="reimprimirReciboLead('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#111;border:1px solid var(--dorado);color:var(--dorado);border-radius:6px;cursor:pointer;font-weight:600;flex-shrink:0;">🧾 Recibo</button>` : ''}
                ${l.estado === "vendido" ? `<button onclick="cambiarProductoLeadUI('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#8b5cf6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;flex-shrink:0;">🔄 Cambio</button>` : ''}
            </div>
            ${clienteHtml}
        </div>`;
    }).join('');
}

// Muestra un resumen rápido del stock del producto de este Lead (talla,
// ubicación, disponibilidad) con el botón de Confirmar justo ahí — es el
// paso exacto para verificar que existe la pieza y descontarla, sin salir
// del modal de Leads ni ir y volver a la pestaña Stock.
let _leadStockActual = null;
async function verStockLead(id, codigo) {
    _leadStockActual = id;
    const cont = document.getElementById("lead-stock-resumen");
    cont.innerHTML = '<p style="color:var(--plateado);font-size:13px;text-align:center;padding:20px;">⏳ Buscando...</p>';
    abrirModal("modal-lead-stock");

    if (!codigo) { cont.innerHTML = '<p style="color:#e74c3c;font-size:13px;">Este Lead no tiene código de producto.</p>'; return; }
    if (!stockData || !stockData.length) {
        try { const res = await apiPost({ accion: "GET_STOCK" }); stockData = res.stock || []; } catch(_) { stockData = []; }
    }
    const s = stockData.find(p => p.codigo === codigo);
    if (!s) {
        cont.innerHTML = `<p style="color:#e74c3c;font-size:13px;">⚠️ El código <b>${sanitizar(codigo)}</b> ya no existe en Stock — puede haberse eliminado.</p>`;
        return;
    }
    const bodega = parseInt(s.stock_bodega)||0, tienda = parseInt(s.stock_tienda)||0;
    const disponible = bodega + tienda;
    cont.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">
            ${s.foto ? `<img src="${sanitizar(ikFoto(s.foto,160))}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0;">` : ''}
            <div>
                <div style="font-weight:700;font-size:14px;">${sanitizar(s.nombre||codigo)}</div>
                <div style="font-size:11px;color:var(--plateado);">${sanitizar(codigo)}${s.talla?` · Talla ${sanitizar(s.talla)}`:''}</div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
            <div class="stat-box"><div class="stat-num" style="font-size:18px;">${bodega}</div><div class="stat-label">Bodega</div></div>
            <div class="stat-box"><div class="stat-num" style="font-size:18px;">${tienda}</div><div class="stat-label">Tienda</div></div>
        </div>
        ${disponible > 0
            ? `<div style="background:rgba(39,174,96,0.15);border:1px solid #27ae60;color:#27ae60;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;margin-bottom:14px;">✅ Disponible (${disponible} en total) — lista para confirmar</div>`
            : `<div style="background:rgba(231,76,60,0.15);border:1px solid #e74c3c;color:#e74c3c;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;margin-bottom:14px;">⚠️ Sin stock disponible — no se podrá confirmar hasta reponer</div>`
        }
        <button class="btn btn-dorado btn-full" ${disponible<=0?'disabled':''} onclick="confirmarDesdeResumenStock()">📦 Empacar y enviar (reservar stock)</button>
    `;
}

async function confirmarDesdeResumenStock() {
    if (!_leadStockActual) return;
    cerrarModal("modal-lead-stock");
    await confirmarLeadEnvio(_leadStockActual);
    _leadStockActual = null;
}

// Reimprime el recibo de un Lead que ya se confirmó como vendido antes de
// que existiera esta función — los datos del cliente y el producto siguen
// guardados en el Lead, así que se puede generar en cualquier momento.
// Cambio de producto DESPUÉS de entregado (talla que no quedó, defecto, o
// cualquier otro motivo) — la venta y la comisión ya quedaron cerradas al
// confirmar la entrega, esto solo ajusta el inventario físico: regresa la
// pieza vieja a bodega y descuenta la nueva, sin tocar el monto de la venta.
async function cambiarProductoLeadUI(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;
    const codigoNuevo = prompt(
        `Cambio de producto para "${lead.nombre || lead.codigo}".\n\nCódigo EXACTO del producto/talla que se va a enviar en su lugar:`,
        ""
    );
    if (!codigoNuevo || !codigoNuevo.trim()) return;
    const motivo = prompt("Motivo del cambio (opcional, ej: talla no quedó, pieza defectuosa):", "") || "";
    const res = await apiPost({ accion: "CAMBIAR_PRODUCTO_LEAD", id, codigoNuevo: codigoNuevo.trim().toUpperCase(), motivo });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo registrar el cambio")); return; }
    toast("🔄 Cambio registrado — venta y comisión sin alterar");
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

async function reimprimirReciboLead(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return toast("⚠️ Lead no encontrado");
    const codigoConfirmado = lead.codigoConfirmado || lead.codigo;
    await generarReciboLeadPDF(lead, codigoConfirmado);
}

// Paso 1 de 2: empacar y entregar al transportista — reserva el stock (evita
// que se venda dos veces) pero NO cierra la venta todavía. La venta se cierra
// de verdad hasta que se confirme la entrega real (confirmarLeadEntrega), ya
// que con pago contra entrega el cliente puede rechazar el pedido en la puerta.
async function confirmarLeadEnvio(id) {
    const lead = leadsData.find(l => l.id === id);
    let codigoOverride = null;
    // Los diseños de pareja (dama+caballero) se agrupan en el catálogo bajo un solo
    // código elegido al azar — al confirmar, hay que verificar cuál pieza fue la real.
    const esPareja = /matrimonio|argolla|novios|pareja|alianza/i.test(lead?.nombre || "");
    if (esPareja) {
        const nuevo = prompt(
            "Este es un diseño de pareja (dama/caballero) — el código pudo quedar ambiguo al agrupar el catálogo.\n\n" +
            "Verifica o corrige el código EXACTO de la pieza que realmente se va a enviar (dama o caballero) antes de reservar stock:",
            lead?.codigo || ""
        );
        if (nuevo === null) return; // canceló
        codigoOverride = nuevo.trim();
        if (!codigoOverride) { toast("⚠️ Código vacío — cancelado"); return; }
    }
    const res = await apiPost({ accion: "CONFIRMAR_LEAD_ENVIO", id, codigoOverride });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo confirmar")); return; }
    toast("📦 Pedido en camino — stock reservado. Confirma la entrega cuando el transportista la realice.");
    // El recibo se imprime AQUÍ, al empacar — es lo que va físicamente con el
    // pedido o se le entrega al transportista, no después de la entrega (que
    // pasa a distancia y ya no hay nada que meter en el paquete).
    if (lead) await generarReciboLeadPDF(lead, codigoOverride || lead.codigo);
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Paso 2 de 2 (caso A): el transportista SÍ entregó y cobró — recién aquí se
// cierra la venta de verdad (comisión, Historial de Ventas y recibo).
// Botón "Entregado" = venta normal, un clic, sin preguntar nada (caso de
// siempre). El "▾" al lado abre un menú chiquito con la opción de marcarlo
// como cambio — los cambios son la excepción, no vale la pena interrumpir
// cada confirmación normal con una pregunta.
function toggleMenuCambio(id, btn) {
    document.querySelectorAll('[id^="menu-cambio-"]').forEach(m => {
        if (m.id !== `menu-cambio-${id}`) m.style.display = "none";
    });
    const menu = document.getElementById(`menu-cambio-${id}`);
    if (!menu) return;
    menu.style.display = menu.style.display === "none" ? "block" : "none";
    if (menu.style.display === "block") {
        setTimeout(() => {
            document.addEventListener("click", function cerrar() {
                menu.style.display = "none";
                document.removeEventListener("click", cerrar);
            }, { once: true });
        }, 10);
    }
}

async function confirmarLeadEntrega(id, esCambio) {
    const lead = leadsData.find(l => l.id === id);
    // Si este envío es el reemplazo de un "🔄 Cambio" ya registrado en OTRO
    // Lead (venta original ya cobrada), no debe sumar venta ni comisión de
    // nuevo — solo se descuenta el stock, porque la pieza sí salió físicamente.
    const res = await apiPost({ accion: "CONFIRMAR_LEAD_ENTREGA", id, esCambio: !!esCambio });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo confirmar la entrega")); return; }
    toast(esCambio ? "✅ Cambio entregado — no se generó venta ni comisión nueva" : "✅ Entrega confirmada — venta y comisión cerradas");
    // El recibo ya se imprimió al empacar (confirmarLeadEnvio) — aquí no se
    // reimprime solo, usa el botón "🧾 Recibo" si necesitas otra copia.
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Paso 2 de 2 (caso B): el cliente rechazó el pedido en la puerta — la pieza
// regresa a bodega, sin generar venta ni comisión.
async function rechazarLeadEntrega(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!confirm(`¿Confirmar que "${lead?.nombre||''}" fue rechazado en la puerta?\nLa pieza regresará a bodega y no se generará venta ni comisión.`)) return;
    const res = await apiPost({ accion: "RECHAZAR_LEAD_ENTREGA", id });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo registrar el rechazo")); return; }
    toast("↩️ Pedido rechazado — pieza devuelta a bodega");
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Recibo de venta para una venta confirmada de afiliado — mismo formato
// térmico (62mm) que el de Venta Directa. El código del afiliado va en una
// línea discreta del footer, en gris chico, para no protagonizar el recibo
// que ve el cliente pero quede trazable de dónde vino la venta.
async function generarReciboLeadPDF(lead, codigoConfirmado){
    if (!window.jspdf?.jsPDF) return;
    const { jsPDF } = window.jspdf;

    // stockData solo se carga al abrir la pestaña Stock — si el admin no la ha
    // abierto en esta sesión, viene vacía y el material/talla no aparecerían.
    if (!stockData || !stockData.length) {
        try { const res = await apiPost({ accion: "GET_STOCK" }); stockData = res.stock || []; } catch(_) {}
    }

    const c = lead.cliente || {};
    const envio = lead.envioInfo || null;
    const total = envio ? parseFloat(envio.total||0) : parseFloat(lead.precio||0);
    const vend  = vendedores.find(v => v.codigo === lead.afiliado);
    const s     = stockData.find(p => p.codigo === codigoConfirmado);

    const W  = 62, mX = 4, cX = W/2, lH = 4.5;

    // Medir el contenido primero para saber el alto real que necesita el papel —
    // el alto fijo anterior cortaba la referencia del afiliado al final.
    const measure = new jsPDF({ unit:'mm', format:[W, 200], orientation:'portrait' });
    const nombreLines = measure.splitTextToSize(lead.nombre || codigoConfirmado || "—", W - mX*2);
    const alturaEstim = 6 + 5.5 + 4 + 4 + 4.5           // header
        + lH*3 + 2                                       // fecha/cliente/tel
        + 3.5 + nombreLines.length*lH + 3.5 + 3.5         // producto + refs
        + (envio ? 8.5 : 0)                               // subtotal/envio
        + 5 + 5                                           // total + forma pago
        + 5 + (vend ? 4.5*2 : 4.5) + 5                     // footer contacto
        + 8 + 8 + 8;                                      // ref afiliado + frase icónica + margen final
    const H = Math.max(78, Math.ceil(alturaEstim));
    const doc = new jsPDF({ unit:'mm', format:[W, H], orientation:'portrait' });
    let y = 6;

    doc.setFont("helvetica","normal"); doc.setFontSize(18); doc.setTextColor(0,0,0);
    doc.text("VEREX", cX, y, { align:"center" }); y += 5.5;
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(80,80,80);
    doc.text("S T O R E", cX, y, { align:"center" }); y += 4;

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);
    doc.line(mX, y, W-mX, y); y += 4;

    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(0,0,0);
    doc.text("RECIBO DE VENTA", cX, y, { align:"center" }); y += 4.5;

    const fecha = new Date().toLocaleDateString("es-SV", { day:"2-digit", month:"2-digit", year:"numeric" });
    const hora  = new Date().toLocaleTimeString("es-SV", { hour:"2-digit", minute:"2-digit" });
    doc.setFontSize(7); doc.setTextColor(40,40,40);
    [
        ["Fecha:",   fecha + "  " + hora],
        ["Cliente:", c.nombre || "—"],
        ["Tel:",     c.telefono || "—"],
    ].forEach(([label, val]) => {
        doc.setFont("helvetica","normal");   doc.text(label, mX, y);
        doc.setFont("helvetica","normal"); doc.text(String(val), mX+14, y);
        y += lH;
    });
    y += 2;

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.3);
    doc.line(mX, y, W-mX, y); y += 3.5;

    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(20,20,20);
    nombreLines.forEach(l => { doc.text(l, mX, y); y += lH; });

    // Referencia (código), talla y material — antes no aparecían en el recibo
    doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(100,100,100);
    doc.text("Ref: " + (codigoConfirmado || "—"), mX, y); y += lH - 1;
    if (s?.talla) { doc.text("Talla: " + s.talla, mX, y); y += lH - 1; }
    if (s?.material) { doc.text(s.material, mX, y); y += lH - 1; }
    doc.setTextColor(20,20,20);
    y += 1;

    doc.setDrawColor(200,200,200); doc.line(mX, y, W-mX, y); y += 3.5;

    if (envio) {
        doc.setFontSize(7);
        doc.text("Subtotal:", mX, y); doc.text("$"+parseFloat(envio.subtotal||0).toFixed(2), W-mX, y, { align:"right" }); y += 4;
        doc.text("Envío:", mX, y); doc.text(envio.envio===0?"GRATIS":"$"+parseFloat(envio.envio).toFixed(2), W-mX, y, { align:"right" }); y += 4.5;
    }
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(0,0,0);
    doc.text("TOTAL:", mX, y); doc.text("$"+total.toFixed(2), W-mX, y, { align:"right" }); y += 5;
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(80,80,80);
    doc.text("Contra entrega, en efectivo", cX, y, { align:"center" }); y += 5;

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);
    doc.line(mX, y, W-mX, y); y += 5;

    // Contacto: el WhatsApp del AFILIADO, no el de VEREX — es su venta
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(40,40,40);
    if (vend?.telefono) { doc.text("WhatsApp: " + vend.telefono, cX, y, { align:"center" }); y += 4.5; }
    if (vend?.nombre)   { doc.text("Atendido por: " + vend.nombre, cX, y, { align:"center" }); y += 4.5; }
    doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text("Gracias por su preferencia  VEREX", cX, y, { align:"center" }); y += 5;

    // Código del afiliado — discreto, chico y gris, no protagoniza el recibo
    doc.setFont("helvetica","normal"); doc.setFontSize(5.5); doc.setTextColor(160,160,160);
    doc.text("Ref. afiliado: " + (lead.afiliado || "—"), cX, y, { align:"center" }); y += 5;

    doc.setFont("helvetica","italic"); doc.setFontSize(6.5); doc.setTextColor(160,110,30);
    doc.text("El mundo es mas maravilloso", cX, y, { align:"center" }); y += 4;
    doc.text("cuando brillas TU", cX, y, { align:"center" });

    doc.save("Recibo_" + (c.nombre||"cliente").replace(/ /g,"_") + ".pdf");
}

async function cancelarLeadUI(id) {
    if (!confirm("¿Cancelar este Lead? No se registrará como venta.")) return;
    const res = await apiPost({ accion: "CANCELAR_LEAD", id });
    if (!res.ok) { toast("⚠️ No se pudo cancelar"); return; }
    toast("❌ Lead cancelado");
    const lead = leadsData.find(l => l.id === id);
    const codigoVend = lead?.afiliado;
    await cargarLeads();
    renderVendedores();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Leads del catálogo público de clientes (sin afiliado) no tienen un pipeline
// de entrega — la venta ya se cierra aparte por "Registrar Venta Directa"
// cuando el cliente confirma por WhatsApp. Este botón solo quita la alerta
// una vez que ya la atendiste (se cerró la venta o el cliente ya no siguió).
// Salta directo a Venta Directa con el producto del Lead ya agregado al
// carrito — evita tener que buscarlo de nuevo a mano. El Lead se marca
// resuelto de una vez (el admin ya está en proceso de cerrar la venta).
async function registrarVentaDesdeLead(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;
    cambiarTab('ventadirecta');
    await iniciarVentaDirecta();
    const prod = stockData.find(s => s.codigo === lead.codigo);
    if (prod && parseInt(prod.stock_bodega||0) > 0) {
        agregarAlVD(prod.codigo);
        // Si el catálogo tenía descuento, el lead guarda el precio ya rebajado.
        // Pre-llenar el campo de descuento para que la venta refleje el mismo
        // precio que el cliente vio en el catálogo.
        const precioStock = parseFloat(prod.precio || 0);
        const precioLead  = parseFloat(lead.precio  || 0);
        const diffDesc    = precioStock - precioLead;
        if (diffDesc > 0.005) {
            setModoDescuento('monto');
            const inputDesc = document.getElementById("vd-descuento-val");
            if (inputDesc) {
                inputDesc.value = diffDesc.toFixed(2);
                renderCarritoVD();
            }
        }
        toast(`🛍️ "${prod.nombre}" agregado — revisa los datos del cliente`);
    } else {
        toast(`⚠️ "${lead.nombre||lead.codigo}" ya no está disponible en bodega — agrégalo manualmente si aplica`, "#f97316");
    }

    // Precargar nombre/teléfono/dirección que el cliente ya dejó en el
    // catálogo ANTES de abrir WhatsApp — así VEREX no tiene que volver a
    // preguntarle ni transcribirlos a mano.
    const inpNombre = document.getElementById("vd-cliente-nombre");
    const inpTel    = document.getElementById("vd-cliente-tel");
    const inpDir    = document.getElementById("vd-cliente-direccion");
    const wrapDir   = document.getElementById("vd-cliente-direccion-wrap");
    const selDepto  = document.getElementById("vd-cliente-departamento");
    if (inpNombre && lead.nombreCliente) inpNombre.value = lead.nombreCliente;
    if (inpTel && lead.telefonoCliente)  inpTel.value = lead.telefonoCliente;
    if (lead.direccionCliente) {
        if (wrapDir) wrapDir.style.display = "block";
        if (inpDir) inpDir.value = lead.direccionCliente;
        // Intento best-effort: si el nombre de algún departamento aparece
        // dentro del texto libre de dirección, lo preselecciona — el cliente
        // no llena un select, escribe todo junto en un solo campo.
        if (selDepto) {
            const dirNorm = lead.direccionCliente.toLowerCase();
            const match = [...selDepto.options].find(o => o.value && dirNorm.includes(o.value.toLowerCase()));
            if (match) selDepto.value = match.value;
        }
    }

    await apiPost({ accion: "CANCELAR_LEAD", id });
    await cargarLeads();
    renderAlertasAfiliadosHub();
}

async function resolverLeadClienteDirecto(id) {
    if (!confirm("¿Ya atendiste este interés (se cerró la venta por WhatsApp o el cliente ya no siguió)?\nSe quitará de la alerta.")) return;
    const res = await apiPost({ accion: "CANCELAR_LEAD", id });
    if (!res.ok) { toast("⚠️ No se pudo actualizar"); return; }
    toast("✅ Quitado de la alerta");
    await cargarLeads();
    renderAlertasAfiliadosHub();
}

let _tipoVendedorSel = "consignacion";

function selTipoVendedor(tipo) {
    _tipoVendedorSel = tipo;
    const btnConsig  = document.getElementById("v-tipo-consig-btn");
    const btnAfil    = document.getElementById("v-tipo-afiliado-btn");
    const btnHibrido = document.getElementById("v-tipo-hibrido-btn");
    const desc       = document.getElementById("v-tipo-desc");
    const fisicoWrap = document.getElementById("v-recibe-fisico-wrap");
    const btnHojaInfo = document.getElementById("v-btn-hoja-info");
    const off = s => { s.style.background = "var(--gris2)"; s.style.color = "var(--blanco)"; s.style.borderColor = "var(--borde)"; };
    const on  = s => { s.style.background = "var(--dorado)"; s.style.color = "#111"; s.style.borderColor = "var(--dorado)"; };
    off(btnConsig); off(btnAfil); if (btnHibrido) off(btnHibrido);
    if (tipo === "afiliado") {
        on(btnAfil);
        desc.textContent = "No maneja piezas físicas — cierra la venta por su cuenta y pide la pieza a VEREX para entregarla.";
        if (fisicoWrap) fisicoWrap.style.display = "flex";
        if (btnHojaInfo) btnHojaInfo.style.display = "block";
    } else if (tipo === "hibrido") {
        if (btnHibrido) on(btnHibrido);
        desc.textContent = "Recibe piezas físicas en consignación Y tiene catálogo digital de afiliado.";
        if (fisicoWrap) fisicoWrap.style.display = "none";
        if (btnHojaInfo) btnHojaInfo.style.display = "block";
    } else {
        on(btnConsig);
        desc.textContent = "Recibe piezas físicas, vende, devuelve lo no vendido.";
        if (fisicoWrap) fisicoWrap.style.display = "none";
        if (btnHojaInfo) btnHojaInfo.style.display = "none";
    }
}

// Hoja informativa para el afiliado — explica la dinámica de venta y comisiones
// ANTES de llenar la ficha y generar el contrato. No usa datos de ningún vendedor
// en particular (aún no existe), es información general del programa.
function generarHojaInformativaAfiliadoPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = 210;
    const mL = 20, mR = 20;
    const textW = pageW - mL - mR;
    let y = 20;

    function checkPage(needed) {
        if (y + needed > 280) { doc.addPage(); y = 20; }
    }
    function seccion(titulo) {
        checkPage(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(201, 168, 76);
        doc.text(titulo, mL, y); y += 6;
    }
    function parrafo(texto) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        const lines = doc.splitTextToSize(texto, textW);
        checkPage(lines.length * 5 + 3);
        doc.text(lines, mL, y); y += lines.length * 5 + 5;
    }
    function bullet(texto) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        const lines = doc.splitTextToSize(texto, textW - 6);
        checkPage(lines.length * 5 + 2);
        doc.text("•", mL, y);
        doc.text(lines, mL + 5, y); y += lines.length * 5 + 3;
    }

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(201, 168, 76);
    doc.text("VEREX", pageW / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(12);
    doc.setTextColor(80, 80, 80);
    doc.text("PROGRAMA DE AFILIADOS — CÓMO FUNCIONA", pageW / 2, y, { align: "center" }); y += 12;

    parrafo("Esta hoja explica la dinámica de venta y comisiones del Programa de Afiliados VEREX antes de registrarte. Léela con calma — si tienes dudas, pregúntanos antes de firmar el contrato.");

    seccion("1. ¿QUÉ ES SER AFILIADO?");
    parrafo("Recibes un catálogo digital personalizado con los productos VEREX que definamos juntos. Tú lo compartes con tus clientes (WhatsApp, redes sociales, boca a boca) y gestionas la venta por tu cuenta. No necesitas comprar inventario ni arriesgar tu dinero — VEREX es dueña de las piezas hasta que se venden.");

    seccion("2. CÓMO SE REGISTRA UNA VENTA");
    bullet("Un cliente ve tu catálogo digital y presiona el botón \"¡Hazlo tuyo!\" en el producto que le interesa.");
    bullet("El catálogo le pide al cliente su nombre, número de WhatsApp y dirección de entrega antes de enviar el mensaje. Esos datos quedan registrados automáticamente como un interesado (Lead) a tu nombre — ya completos, sin que tú tengas que hacer nada extra.");
    bullet("Se abre WhatsApp con un mensaje pre-armado que incluye el producto, precio, talla (si aplica) y los datos del cliente. El cliente solo presiona Enviar.");
    bullet("También puede usar el carrito: agrega varios productos, llena sus datos una sola vez y manda todo en un solo mensaje de WhatsApp al final.");
    bullet("En tu link personal de \"Completar Pedidos\" (te lo comparte VEREX) verás el pedido ya precargado con los datos que el cliente ingresó en el catálogo. Revisa que todo esté correcto y confírmalo — ese paso es obligatorio para que VEREX pueda coordinar la entrega.");
    bullet("Tú coordinas con VEREX la entrega. Las ventas de afiliado son contra entrega, en efectivo, con envío gratis en pedidos desde $30.");
    bullet("La venta se confirma oficialmente cuando VEREX verifica que la pieza fue entregada — solo hasta ese momento se genera tu comisión. Esto protege a ambas partes: ni tú cargas con inventario no vendido, ni se paga comisión por ventas que no se concretaron.");

    seccion("3. TU COMISIÓN");
    parrafo("Ganas comisión por tramos según el total de ventas confirmadas en el período — entre más vendas, mayor tu porcentaje:");

    checkPage(35);
    doc.setFillColor(30, 30, 30);
    doc.rect(mL, y, textW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Ventas confirmadas del período", mL + 4, y + 5);
    doc.text("Tu comisión", mL + 120, y + 5); y += 8;
    RANGOS_COMISION_AFILIADO.forEach((r, i) => {
        const rango = r.max >= 99999 ? `$${r.min} o más` : `$${r.min} — $${r.max}`;
        doc.setFillColor(i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255);
        doc.rect(mL, y, textW, 7, 'F');
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "normal");
        doc.text(rango, mL + 4, y + 5);
        doc.setFont("helvetica", "bold");
        doc.text(r.pct + "%", mL + 120, y + 5); y += 7;
    });
    y += 10;

    seccion("4. ¿RECIBES PIEZAS FÍSICAS O NO?");
    bullet("Sin piezas físicas (lo más común): tú solo cierras la venta, VEREX se encarga de la entrega. No tienes responsabilidad sobre el inventario.");
    bullet("Con piezas físicas (si se acuerda contigo): VEREX te entrega algunas piezas para que tú mismo las entregues a tus clientes. En ese caso, eres responsable de esas piezas — si se pierden, roban o dañan, se descuenta el valor de venta menos tu comisión.");

    seccion("5. PRECIOS Y REGLAS");
    bullet("Vendes al precio que aparece en el catálogo — no puedes cambiar precios sin autorización de VEREX.");
    bullet("El catálogo se actualiza en tiempo real: los productos agotados desaparecen automáticamente — no se marcan ni se grisan, simplemente dejan de aparecer. Esto incluye pares y tríos: si una pieza del conjunto se vende en otro canal, todo el set desaparece del catálogo para que no ofrezcas algo que ya no está disponible.");

    seccion("6. GARANTÍA LIMITADA — LÉELA ANTES DE VENDER");
    parrafo("VEREX tiene una Garantía Limitada de 30 días, válida únicamente contra defectos de fabricación (piedras mal engastadas de fábrica, broches o soldaduras defectuosas). NO cubre golpes, mal uso, cadenas reventadas por jalones, ni el oscurecimiento/oxidación de la plata — eso es una reacción natural del material con el pH de la piel, sudor, perfumes, cremas o cloro, no un defecto.");
    checkPage(30);
    doc.setFillColor(240, 249, 255);
    doc.rect(mL, y, textW, 22, 'F');
    doc.setDrawColor(14, 165, 233);
    doc.rect(mL, y, textW, 22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(14, 116, 144);
    doc.text("Lee la política completa de Garantía Limitada aquí:", mL + 4, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(2, 132, 199);
    doc.textWithLink("admin-tienda.pages.dev/garantia.html", mL + 4, y + 15, { url: "https://admin-tienda.pages.dev/garantia.html" });
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text("(o pide a VEREX el QR para escanearlo)", mL + 4, y + 20);
    y += 27;
    bullet("Antes de ofrecerle algo a un cliente (cambio, reembolso, reparación), consulta esa página o pregúntale a VEREX — así no le prometes algo que la garantía no cubre.");

    seccion("7. ¿CUÁNDO SE PAGA?");
    parrafo("Tu comisión se liquida en el corte de cuentas, que se realiza cada 30 días, únicamente sobre las ventas que VEREX ya confirmó como entregadas.");

    seccion("8. SIGUIENTE PASO");
    parrafo("Si estás de acuerdo con esta dinámica, VEREX registrará tu ficha y generará tu contrato de afiliado con estas mismas condiciones para que lo firmes (en persona o a distancia).");

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text("VEREX — Programa de Afiliados · Información general, sujeta a lo acordado en tu contrato", pageW / 2, 292, { align: "center" });

    doc.save("VEREX_Programa_Afiliados_Info.pdf");
    toast("📄 Hoja informativa generada");
}