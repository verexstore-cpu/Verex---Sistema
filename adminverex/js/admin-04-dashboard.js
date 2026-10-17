// Admin VEREX — Dashboard
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  DASHBOARD
// ═════════════════════════════════════════════
function renderEstado() {
    document.getElementById("tog-tienda").checked = cfg.tiendaActiva;
    const limEl = document.getElementById("inp-limite-catalogo");
    if (limEl) limEl.value = cfg.limiteCatalogo || "";
    const varEl = document.getElementById("tog-varios");
    if (varEl) varEl.checked = cfg.mostrarVarios === true;
    document.getElementById("estado-info").innerHTML = cfg.tiendaActiva
        ? `<span class="badge bv2">✅ ABIERTA</span> <span style="margin-left:7px;">Clientes pueden ver y comprar.</span>`
        : `<span class="badge br2">🔴 CERRADA</span> <span style="margin-left:7px;">Catálogo oculto para clientes.</span>`;
}

function actualizarBadgeCorreo() {
    const ultimaVisita = parseInt(localStorage.getItem("vx_ultima_visita") || "0");
    const nuevos = pedidos.filter(p => p.fecha && new Date(p.fecha).getTime() > ultimaVisita).length;
    const badge  = document.getElementById("correo-badge");
    if (!badge) return;
    if (nuevos > 0) {
        badge.textContent = nuevos > 9 ? "9+" : nuevos;
        badge.style.display = "flex";
    } else {
        badge.style.display = "none";
    }
}

function limpiarBadgeCorreo() {
    localStorage.setItem("vx_ultima_visita", Date.now());
    const badge = document.getElementById("correo-badge");
    if (badge) badge.style.display = "none";
}

// Cuenta lo que el cliente realmente ve en el catálogo público: agrupa pares/tríos
// de anillos como un solo ítem y excluye reservados y agotados — a diferencia de
// productos.length, que cuenta cada fila de Supabase por separado (ej. dama +
// caballero = 2 filas para 1 solo producto visible).
function productosVisiblesCount() {
    const visibles = productos.filter(p => !p.reservado && _stockTotalProd(p) > 0);
    const anLista  = visibles.filter(p => getCatKey(p) === "AN");
    const otros    = visibles.filter(p => getCatKey(p) !== "AN");
    return agruparParaCatalogo(anLista).length + otros.length;
}

// Ventas + pedidos totales combinan Ecommerce (pedidos), Venta Directa
// (ventas_directas) y ventas de afiliados SIN piezas físicas — en ese caso
// VEREX entrega y cobra directo al cliente, así que ese dinero ya está en
// caja (solo falta pagarle la comisión al afiliado). Se deja fuera la
// consignación tradicional (con piezas físicas), donde el vendedor cobra
// primero y liquida después — ese dinero no ha entrado a VEREX todavía.
async function cargarVentasUnificadas() {
    try {
        const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_HISTORIAL_VENTAS", _pass: ADMIN_PASS }) });
        const data = await res.json();
        _ventasUnificadas = (data.ventas || []).filter(v => v.tipo === "catalogo" || v.tipo === "directa" || v.tipo === "afiliado_sin_stock");
    } catch(e) { _ventasUnificadas = null; }
    try {
        const res2 = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_CORTES_HISTORIAL_TODOS", _pass: ADMIN_PASS }) });
        const data2 = await res2.json();
        _cortesAfiliados = (data2.cortes || []).filter(c => c.esAfiliadoSinStock);
    } catch(e) { _cortesAfiliados = null; }
}

function renderStats() {
    const hoy  = new Date();
    const iniMes  = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const iniSem  = new Date(hoy); iniSem.setDate(hoy.getDate() - hoy.getDay());
    const iniHoy  = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

    // Si ya cargaron las ventas unificadas (ecommerce + venta directa), usarlas;
    // si no, usar solo pedidos de ecommerce como respaldo.
    const fuenteVentas = _ventasUnificadas || pedidos;

    const pedMes  = fuenteVentas.filter(p => p.fecha && new Date(p.fecha) >= iniMes);
    const pedSem  = fuenteVentas.filter(p => p.fecha && new Date(p.fecha) >= iniSem);
    const pedHoy  = fuenteVentas.filter(p => p.fecha && new Date(p.fecha) >= iniHoy);
    const pedPend = pedidos.filter(p => p.estado === "Pendiente");

    const ingMes  = pedMes.reduce((s,p)=>s+(parseFloat(String(p.total).replace(/[^0-9.]/g,""))||0),0);
    const ingSem  = pedSem.reduce((s,p)=>s+(parseFloat(String(p.total).replace(/[^0-9.]/g,""))||0),0);
    // Cuánto de ese ingreso del mes vino de afiliados — para no olvidar que
    // ahí falta descontar la comisión antes de ser ganancia neta.
    const ingMesAfiliados = pedMes.filter(p => p.tipo === "afiliado_sin_stock")
        .reduce((s,p)=>s+(parseFloat(String(p.total).replace(/[^0-9.]/g,""))||0),0);
    // Comisión YA pagada este mes (con Corte hecho) a afiliados sin stock —
    // lo pendiente de cortar no se resta porque aún no se sabe el monto final.
    const comisionPagadaMes = (_cortesAfiliados || [])
        .filter(c => c.fecha && new Date(c.fecha) >= iniMes)
        .reduce((s,c) => s + (parseFloat(c.gananciaVendedor)||0), 0);
    const ingNeto = ingMes - comisionPagadaMes;

    document.getElementById("s-prod").textContent    = productosVisiblesCount();
    document.getElementById("s-ped").textContent     = fuenteVentas.length;
    document.getElementById("s-ped-hoy").textContent = `${pedHoy.length} hoy`;
    document.getElementById("s-mes").textContent     = `$${ingMes.toFixed(0)}`;
    const statMes = document.getElementById("s-mes")?.closest(".stat");
    if (statMes) {
        statMes.title = ingMesAfiliados > 0
            ? `Ingreso bruto: $${ingMes.toFixed(0)} (incluye $${ingMesAfiliados.toFixed(0)} de afiliados)\nComisión ya pagada este mes: -$${comisionPagadaMes.toFixed(0)}\nGanancia neta estimada: $${ingNeto.toFixed(0)}\n(No incluye comisión pendiente de cortar)`
            : "";
    }
    document.getElementById("s-mes-sem").textContent = ingMesAfiliados > 0
        ? `$${ingSem.toFixed(0)} esta semana · Neto tras comisión pagada: $${ingNeto.toFixed(0)}`
        : `$${ingSem.toFixed(0)} esta semana`;
    document.getElementById("s-cup").textContent     = cupones.filter(c=>c.activo).length;
    document.getElementById("s-pend").textContent    = `${pedPend.length} pendientes`;
}

function renderChart() {
    const cont = document.getElementById("chart"); cont.innerHTML="";
    const hoy  = new Date();
    const sem  = Array.from({length:8},(_,i)=>{
        const ini = new Date(hoy); ini.setDate(hoy.getDate()-i*7);
        const fin = new Date(hoy); fin.setDate(hoy.getDate()-(i-1)*7);
        const ps  = pedidos.filter(p=>{ const f=new Date(p.fecha); return f>=ini&&f<fin; });
        const ing = ps.reduce((s,p)=>s+(parseFloat(String(p.total).replace(/[^0-9.]/g,""))||0),0);
        return { lbl:`S${8-i}`, n: ps.length, ing };
    }).reverse();
    const mx = Math.max(...sem.map(s=>s.n),1);
    sem.forEach((s,i)=>{
        const pct   = Math.max(s.n/mx*100,4);
        const isLast = i === sem.length-1;
        cont.innerHTML += `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default;" title="${s.n} pedidos · $${s.ing.toFixed(0)}">
            <span style="font-size:11px;font-weight:700;color:${isLast?'#00BFFF':'rgba(255,255,255,0.5)'};">${s.n||''}</span>
            <div style="width:100%;border-radius:8px 8px 0 0;transition:height 0.6s ease;
                background:${isLast?'linear-gradient(180deg,#00BFFF,#0080ff)':'linear-gradient(180deg,rgba(0,191,255,0.4),rgba(0,191,255,0.15))'};
                height:${pct}%;box-shadow:${isLast?'0 0 12px rgba(0,191,255,0.4)':''};"></div>
            <span style="font-size:10px;color:rgba(255,255,255,0.35);">${s.lbl}</span>
        </div>`;
    });
}

function renderTop() {
    const cont = document.getElementById("top-prod");
    const cnt  = {};
    pedidos.forEach(p=>String(p.productos||"").split(",").forEach(i=>{
        const n=i.trim().split("(")[0].trim(); if(n) cnt[n]=(cnt[n]||0)+1;
    }));
    const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    const maxV = top.length ? top[0][1] : 1;
    cont.innerHTML = top.length ? top.map(([n,v],i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:18px;min-width:26px;">${medals[i]}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(n)}</div>
                <div style="background:rgba(0,191,255,0.12);border-radius:4px;height:4px;margin-top:5px;">
                    <div style="background:var(--azul);height:4px;border-radius:4px;width:${Math.round(v/maxV*100)}%;"></div>
                </div>
            </div>
            <span style="font-size:13px;font-weight:700;color:var(--azul);white-space:nowrap;">${v}×</span>
        </div>`).join('')
    : '<p style="color:#aaa;font-size:13px;">Sin datos aún.</p>';
}
