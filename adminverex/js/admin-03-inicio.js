// Admin VEREX — Pestañas, avisos (toast), carga inicial y sincronización
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  TABS
// ═════════════════════════════════════════════
function tab(i) {
    document.querySelectorAll(".tab").forEach(t => {
        const match = t.getAttribute("onclick")?.match(/tab\((\d+)\)/);
        if (match) t.classList.toggle("active", parseInt(match[1]) === i);
    });
    document.querySelectorAll(".tab-content").forEach(c => {
        const id = parseInt(c.id.replace("tab-",""));
        c.classList.toggle("active", i === id);
    });
    // i = -1 → pantalla limpia (solo logo y botones, centrados en vertical)
    const hw = document.getElementById("hub-wrap");
    if (hw) {
        const hd = document.querySelector("header");
        if (hd) document.documentElement.style.setProperty("--hh", hd.offsetHeight + "px");
        hw.classList.toggle("limpio", i === -1);
    }
}
// Clic sobre la pestaña ya abierta = cerrarla (pantalla limpia)
document.getElementById("hub-wrap")?.addEventListener("click", e => {
    const t = e.target.closest(".tab");
    if (t && t.classList.contains("active")) { e.stopPropagation(); tab(-1); }
}, true);

// ═════════════════════════════════════════════
//  TOAST
// ═════════════════════════════════════════════
function toast(msg, bg) {
    const t = document.getElementById("toast");
    t.textContent=msg; t.style.background=bg||"#111";
    t.classList.add("show");
    setTimeout(()=>t.classList.remove("show"),3200);
}

// ═════════════════════════════════════════════
//  INIT + POLLING
// ═════════════════════════════════════════════
async function init() {
    const saved = localStorage.getItem("vx_cfg");
    if (saved) cfg = JSON.parse(saved);
    renderEstado(); renderEnvio(); actualizarNombre();
    await cargarDatos();
    setInterval(()=>cargarDatos(true), 45000);
    cargarHistorialLinks();

    // Acceso rápido desde el panel de Logística USA ("Generar nuevo
    // catálogo"): abre directo el modal de Catálogo Cliente con la casilla
    // de Estados Unidos ya marcada, en vez de duplicar ese formulario allá.
    if (location.hash === "#editar-us") { history.replaceState(null, "", location.pathname + location.search); abrirEditorUS(); }
    if (location.hash === "#catalogo-us") {
        abrirModalCatalogo("cliente");
        const chkUS = document.getElementById("cat-es-us");
        if (chkUS) chkUS.checked = true;
        history.replaceState(null, "", location.pathname + location.search);
    }
}

async function cargarDatos(silencioso=false) {
    try {
        const res  = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_TIENDA", _pass: ADMIN_PASS }) });
        const data = await res.json();
        productos = data.productos || [];
        pedidos   = (data.pedidos || []).reverse();
        cupones   = data.cupones  || [];
        clientes  = data.clientes || [];
        if (data.config) {
            if (data.config.tiendaActiva !== undefined) cfg.tiendaActiva  = data.config.tiendaActiva;
            if (data.config.reglasEnvio  !== undefined) cfg.reglasEnvio   = data.config.reglasEnvio;
            if (data.config.fraseConfianza !== undefined) cfg.fraseConfianza = data.config.fraseConfianza;
            if (data.config.promoGeneral !== undefined) cfg.promoGeneral = data.config.promoGeneral;
            if (data.config.contenidoUS !== undefined) cfg.contenidoUS = data.config.contenidoUS;
            if (data.config.ocasiones !== undefined) cfg.ocasiones = data.config.ocasiones;
            if (data.config.plantillasCatalogo !== undefined) cfg.plantillasCatalogo = data.config.plantillasCatalogo;
            if (data.config.sugerirPublicar !== undefined) cfg.sugerirPublicar = data.config.sugerirPublicar;
            localStorage.setItem("vx_cfg", JSON.stringify(cfg));
        }
        const inpFraseC = document.getElementById("inp-frase-confianza");
        if (inpFraseC) inpFraseC.value = cfg.fraseConfianza || "";
        renderAll(silencioso);
        cargarVentasUnificadas().then(() => renderStats());
    } catch(e) {
        if (!silencioso) toast("⚠️ Error conectando con la API","#ef4444");
    }
}

// Badge combinado en el título de la pestaña — suma pedidos en camino sin
// confirmar entrega + leads viejos sin completar, así se nota con un solo
// vistazo aunque la pestaña esté de fondo.
let _badgeEnCamino = 0, _badgeLeadsSinCompletar = 0;
function actualizarTituloAlertas() {
    const total = _badgeEnCamino + _badgeLeadsSinCompletar;
    document.title = document.title.replace(/^🔔\(\d+\)\s*/, "");
    if (total > 0) document.title = `🔔(${total}) ` + document.title;
}

function renderAll(sil=false) {
    renderStats(); renderChart(); renderTop();
    renderPedidos(); renderProductos(); renderCupones(); renderClientes(); actualizarBadgeCorreo();
    renderEnvio(); renderEstado(); actualizarNotif(sil); renderBannerAdmin(); renderCarruselAdmin();
    cargarEstadisticas();
    cargarPedidosAfiliadosPendientes();
    cargarAfiliadosEnCamino();
    cargarLeadsSinCompletar();
}

// Leads "Interesado" de varios días SIN datos de cliente — el afiliado nunca
// llenó el pedido (nombre/teléfono/dirección) desde su link de "Completar
// Pedidos". Sin este aviso quedan silenciosos indefinidamente y la venta se
// puede perder por puro olvido del afiliado.
const LEADS_SIN_COMPLETAR_DIAS = 2;
async function cargarLeadsSinCompletar() {
    const card = document.getElementById("card-leads-sin-completar");
    const cont = document.getElementById("lista-leads-sin-completar");
    if (!card || !cont) return;
    try {
        const [resLeads, resVend] = await Promise.all([
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_LEADS_ADMIN", _pass: ADMIN_PASS }) }),
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_VENDEDORES_AFILIADOS", _pass: ADMIN_PASS }) })
        ]);
        const dataLeads = await resLeads.json();
        const dataVend  = await resVend.json();
        const vendMap = new Map((dataVend.vendedores||[]).map(v => [v.codigo, v]));
        const ahora = Date.now();
        const sinCompletar = (dataLeads.leads||[])
            .filter(l => l.estado === "interesado" && !l.cliente)
            .map(l => ({ ...l, dias: Math.floor((ahora - new Date(l.fecha||ahora).getTime()) / 86400000) }))
            .filter(l => l.dias >= LEADS_SIN_COMPLETAR_DIAS)
            .sort((a,b) => b.dias - a.dias); // más viejo primero — el más urgente

        _badgeLeadsSinCompletar = sinCompletar.length;
        actualizarTituloAlertas();

        if (!sinCompletar.length) { card.style.display = "none"; return; }
        card.style.display = "block";

        cont.innerHTML = sinCompletar.map(l => {
            const vend = vendMap.get(l.afiliado);
            const nombreVend = vend?.nombre || l.afiliado || "—";
            const tel = String(vend?.telefono || "").replace(/\D/g, "");
            const msg = `Hola ${nombreVend}! Vi que tienes un cliente interesado en "${l.nombre||l.codigo}" desde hace ${l.dias} días y todavía falta completar sus datos en tu link de pedidos. ¿Puedes completarlo o me cuentas si ya no sigue interesado?`;
            return `<div style="background:rgba(234,179,8,0.1);border:1px solid #eab308;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:13px;">${esc(l.nombre||l.codigo)}</div>
                        <div style="font-size:11px;color:#888;">🎯 ${esc(nombreVend)} · $${parseFloat(l.precio||0).toFixed(2)}</div>
                        <div style="font-size:11px;font-weight:700;color:#eab308;margin-top:3px;">⚠️ ${l.dias} días sin que el afiliado complete los datos del cliente</div>
                    </div>
                    ${tel ? `<a href="https://wa.me/${tel}?text=${encodeURIComponent(msg)}" target="_blank" style="flex-shrink:0;padding:5px 10px;font-size:11px;background:#25D366;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;">💬 Recordar</a>` : ''}
                </div>
            </div>`;
        }).join("");
    } catch(e) {
        cont.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;padding:16px 0;">Error al cargar leads sin completar.</p>';
    }
}

// Pedidos de afiliados que ya se empacaron/enviaron pero cuya entrega real
// todavía no se confirmó — quedan "en el limbo" entre envío y cierre de venta,
// así que se muestran aparte y en rojo si llevan más de 1 día sin resolver,
// para que no se pase por alto confirmar la entrega (o el rechazo en puerta).
async function cargarAfiliadosEnCamino() {
    const card = document.getElementById("card-afiliados-en-camino");
    const cont = document.getElementById("lista-afiliados-en-camino");
    if (!card || !cont) return;
    try {
        const [resLeads, resVend] = await Promise.all([
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_LEADS_ADMIN", _pass: ADMIN_PASS }) }),
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_VENDEDORES_AFILIADOS", _pass: ADMIN_PASS }) })
        ]);
        const dataLeads = await resLeads.json();
        const dataVend  = await resVend.json();
        const vendMap = new Map((dataVend.vendedores||[]).map(v => [v.codigo, v.nombre]));
        const enCamino = (dataLeads.leads||[])
            .filter(l => l.estado === "en_camino")
            .sort((a,b) => new Date(a.fecha) - new Date(b.fecha)); // más antiguo primero — el más urgente

        _badgeEnCamino = enCamino.length;
        actualizarTituloAlertas();

        if (!enCamino.length) { card.style.display = "none"; return; }
        card.style.display = "block";

        const ahora = Date.now();
        cont.innerHTML = enCamino.map(l => {
            const fechaMs = l.fecha ? new Date(l.fecha).getTime() : ahora;
            const dias = Math.floor((ahora - fechaMs) / 86400000);
            const urgente = dias >= 1;
            const fecha = l.fecha ? new Date(l.fecha).toLocaleDateString("es-SV",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
            const nombreVend = vendMap.get(l.afiliado) || l.afiliado || "—";
            const c = l.cliente;
            return `<div style="background:${urgente?'rgba(249,115,22,0.12)':'#1a1a1a'};border:1px solid ${urgente?'#f97316':'#333'};border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:13px;">${esc(l.nombre||l.codigo)}</div>
                        <div style="font-size:11px;color:#888;">🎯 ${esc(nombreVend)} · $${parseFloat(l.precio||0).toFixed(2)} · ${fecha}</div>
                        ${c ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">👤 ${esc(c.nombre||"—")} · ${esc(c.telefono||"—")}</div>` : ""}
                        <div style="font-size:11px;font-weight:700;color:${urgente?'#f97316':'#888'};margin-top:3px;">${urgente ? `⚠️ ${dias} día${dias>1?'s':''} sin confirmar entrega` : "En camino"}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;position:relative;">
                        <div style="display:flex;gap:2px;">
                            <button onclick="confirmarEntregaDesdeAdmin('${l.id}',false)" style="flex:1;padding:5px 8px;font-size:11px;background:#27ae60;color:#fff;border:none;border-radius:6px 0 0 6px;cursor:pointer;font-weight:700;">✅ Entregado</button>
                            <button onclick="event.stopPropagation();toggleMenuCambioAdmin('${l.id}',this)" title="Otras opciones" style="padding:5px 6px;font-size:11px;background:#1e6b3e;color:#fff;border:none;border-radius:0 6px 6px 0;cursor:pointer;font-weight:700;border-left:1px solid rgba(255,255,255,.25);">▾</button>
                        </div>
                        <div id="menu-cambio-admin-${l.id}" style="display:none;position:absolute;top:32px;right:0;background:#111;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:190px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                            <button onclick="event.stopPropagation();confirmarEntregaDesdeAdmin('${l.id}',true);document.getElementById('menu-cambio-admin-${l.id}').style.display='none';" style="display:block;width:100%;padding:9px 12px;font-size:11px;background:none;color:#a78bfa;border:none;cursor:pointer;text-align:left;font-weight:600;">🔄 Es un cambio (sin comisión)</button>
                        </div>
                        <button onclick="rechazarEntregaDesdeAdmin('${l.id}')" style="padding:5px 10px;font-size:11px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">❌ Rechazado</button>
                    </div>
                </div>
            </div>`;
        }).join("");
    } catch(e) {
        cont.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;padding:16px 0;">Error al cargar pedidos en camino.</p>';
    }
}

// Botón "Entregado" = venta normal, un clic. El "▾" abre un menú chiquito
// para marcarlo como cambio (excepción, no interrumpe el caso de siempre).
function toggleMenuCambioAdmin(id, btn) {
    document.querySelectorAll('[id^="menu-cambio-admin-"]').forEach(m => {
        if (m.id !== `menu-cambio-admin-${id}`) m.style.display = "none";
    });
    const menu = document.getElementById(`menu-cambio-admin-${id}`);
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

async function confirmarEntregaDesdeAdmin(id, esCambio) {
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"CONFIRMAR_LEAD_ENTREGA", _pass: ADMIN_PASS, id, esCambio: !!esCambio }) }).then(r=>r.json());
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo confirmar"), "#ef4444"); return; }
    toast(esCambio ? "✅ Cambio entregado — sin venta ni comisión nueva" : "✅ Entrega confirmada — venta y comisión cerradas", "#22c55e");
    cargarAfiliadosEnCamino();
}

async function rechazarEntregaDesdeAdmin(id) {
    if (!confirm("¿El cliente rechazó este pedido en la puerta? La pieza regresará a bodega, sin venta ni comisión.")) return;
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"RECHAZAR_LEAD_ENTREGA", _pass: ADMIN_PASS, id }) }).then(r=>r.json());
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo registrar el rechazo"), "#ef4444"); return; }
    toast("↩️ Pedido rechazado — pieza devuelta a bodega", "#22c55e");
    cargarAfiliadosEnCamino();
}

// Vista central: todos los Leads pendientes de confirmar de todos los
// afiliados juntos, ordenados por fecha — evita tener que entrar
// afiliado por afiliado a revisar quién tiene algo esperando.
async function cargarPedidosAfiliadosPendientes() {
    const cont = document.getElementById("lista-pedidos-afiliados-pendientes");
    if (!cont) return;
    try {
        const [resLeads, resVend] = await Promise.all([
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_LEADS_ADMIN", _pass: ADMIN_PASS }) }),
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_VENDEDORES_AFILIADOS", _pass: ADMIN_PASS }) })
        ]);
        const dataLeads = await resLeads.json();
        const dataVend  = await resVend.json();
        const vendMap = new Map((dataVend.vendedores||[]).map(v => [v.codigo, v.nombre]));
        const pendientes = (dataLeads.leads||[])
            .filter(l => l.estado === "interesado" || l.estado === "reportado")
            .sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

        if (!pendientes.length) {
            cont.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:16px 0;">✅ No hay pedidos de afiliados pendientes de confirmar.</p>';
            return;
        }

        cont.innerHTML = pendientes.map(l => {
            const fecha = l.fecha ? new Date(l.fecha).toLocaleDateString("es-SV",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
            const nombreVend = vendMap.get(l.afiliado) || l.afiliado || "—";
            const c = l.cliente;
            const clienteHtml = c
                ? `<div style="font-size:11px;color:#166534;margin-top:3px;">👤 ${esc(c.nombre||"—")} · ${esc(c.telefono||"—")} · ${esc(c.municipio||"")}${c.municipio?", ":""}${esc(c.departamento||"")}</div>`
                : (l.nombreCliente || l.telefonoCliente)
                    ? `<div style="font-size:11px;color:#166534;margin-top:3px;">👤 ${esc(l.nombreCliente||"—")} · ${esc(l.telefonoCliente||"—")}${l.direccionCliente ? ` · ${esc(l.direccionCliente)}` : ""}</div>`
                    : `<div style="font-size:11px;color:#f97316;margin-top:3px;">⏳ El afiliado todavía no completó los datos del cliente</div>`;
            return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--borde);">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:700;">${esc(l.nombre||l.codigo||"—")}</div>
                    <div style="font-size:11px;color:#888;">🎯 ${esc(nombreVend)} · $${parseFloat(l.precio||0).toFixed(2)} · ${fecha}</div>
                    ${clienteHtml}
                </div>
                <button onclick="confirmarLeadDesdeAdmin('${l.id}')" style="flex-shrink:0;padding:6px 12px;font-size:11px;background:#f97316;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">📦 Empacar y Enviar</button>
            </div>`;
        }).join("");
    } catch(e) {
        cont.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;padding:16px 0;">Error al cargar pedidos de afiliados.</p>';
    }
}

// Solo reserva el stock (paso 1 de 2) — la venta y la comisión del afiliado
// se cierran hasta confirmar la entrega real desde el Hub (Leads del
// afiliado), porque con pago contra entrega el cliente puede rechazarlo.
async function confirmarLeadDesdeAdmin(id) {
    if (!confirm("¿Marcar como empacado y enviado? Se reserva el stock — la venta y la comisión se cerrarán hasta confirmar la entrega real desde el Hub.")) return;
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"CONFIRMAR_LEAD_ENVIO", _pass: ADMIN_PASS, id }) }).then(r=>r.json());
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo confirmar"), "#ef4444"); return; }
    toast("📦 Pedido en camino — confirma la entrega en el Hub cuando el transportista la realice", "#22c55e");
    cargarPedidosAfiliadosPendientes();
}

async function cargarEstadisticas() {
    try {
        const res  = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_ESTADISTICAS", _pass: ADMIN_PASS }) });
        const data = await res.json();
        if (!data.ok) return;

        // Badge alerta pedidos pendientes
        const alertaDiv = document.getElementById("alerta-pendientes");
        if (data.alertas > 0) {
            alertaDiv.style.display = "block";
            document.getElementById("txt-alerta-count").textContent =
                `${data.alertas} pedido${data.alertas>1?'s':''} sin actualizar (+2 días)`;
        } else {
            alertaDiv.style.display = "none";
        }

        // Top destinos
        const destEl = document.getElementById("stats-destinos");
        if (data.topDestinos?.length) {
            const max = data.topDestinos[0].total;
            destEl.innerHTML = data.topDestinos.map((d,i) => `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <span style="font-size:13px;font-weight:800;color:var(--azul);min-width:20px;">${i+1}</span>
                    <div style="flex:1;">
                        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                            <span style="font-weight:600;">${d.lugar}</span>
                            <span style="font-weight:700;color:var(--azul);">${d.total} 📦</span>
                        </div>
                        <div style="background:rgba(0,191,255,0.1);border-radius:6px;height:7px;">
                            <div style="background:linear-gradient(90deg,#00BFFF,#0080ff);height:7px;border-radius:6px;width:${Math.round(d.total/max*100)}%;box-shadow:0 0 6px rgba(0,191,255,0.4);transition:width 0.8s ease;"></div>
                        </div>
                    </div>
                </div>`).join('');
        } else {
            destEl.innerHTML = '<p style="color:#888;font-size:13px;">Sin datos aún.</p>';
        }

        // Top pagos — como píldoras
        const pagEl = document.getElementById("stats-pagos");
        if (data.topPagos?.length) {
            const total = data.topPagos.reduce((s,p)=>s+p.total,0);
            const colores = ['#C9A84C','#00BFFF','#22c55e','#f97316'];
            pagEl.innerHTML = data.topPagos.map((p,i) => `
                <div style="flex:1;min-width:140px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;text-align:center;">
                    <div style="font-size:26px;font-weight:800;color:${colores[i]||'#888'};">${Math.round(p.total/total*100)}%</div>
                    <div style="font-size:12px;color:#aaa;margin-top:4px;">${p.metodo.replace('Contra Entrega (Efectivo)','💵 Efectivo').replace('Pago con Tarjeta','💳 Tarjeta')}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">${p.total} pedidos</div>
                </div>`).join('');
        } else {
            pagEl.innerHTML = '<p style="color:#888;font-size:13px;">Sin datos aún.</p>';
        }
        // Visitas catálogo
        try {
            const resVis = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_VISITAS", _pass: ADMIN_PASS }) });
            const vis = await resVis.json();
            if (vis.ok) {
                document.getElementById("vis-hoy").textContent    = vis.hoy;
                document.getElementById("vis-semana").textContent = vis.semana;
                document.getElementById("vis-total").textContent  = vis.total;
            }
        } catch(_) {}

    } catch(e) {}
}
