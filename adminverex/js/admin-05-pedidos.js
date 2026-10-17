// Admin VEREX — Pedidos de la tienda
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  PEDIDOS
// ═════════════════════════════════════════════
const EST_COLOR = { "Pendiente":"bam2","Despachado":"baz2","Entregado":"bv2","Cancelado":"br2" };

function filtrarPorPeriodo(lista) {
    const periodo = document.getElementById("fil-periodo").value;

    // Fecha local de hoy sin hora (usando hora local, no UTC)
    const ahora = new Date();
    const hoy   = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

    // Mostrar/ocultar rango personalizado
    document.getElementById("rango-custom").style.display =
        periodo === "custom" ? "flex" : "none";

    return lista.filter(p => {
        if (!p.fecha) return true;
        // Convertir fecha a hora local (corrige el desfase UTC)
        const raw = new Date(p.fecha);
        const f   = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
        if (periodo === "hoy")   return f.getTime() === hoy.getTime();
        if (periodo === "semana") {
            const ini = new Date(hoy); ini.setDate(hoy.getDate() - hoy.getDay());
            return f >= ini && f <= hoy;
        }
        if (periodo === "mes")
            return f.getMonth()===hoy.getMonth() && f.getFullYear()===hoy.getFullYear();
        if (periodo === "custom") {
            const desde = document.getElementById("fecha-desde").value;
            const hasta = document.getElementById("fecha-hasta").value;
            if (desde && f < new Date(desde)) return false;
            if (hasta && f > new Date(hasta + "T23:59:59")) return false;
        }
        return true;
    });
}

function renderPedidos() {
    const busq = document.getElementById("bus-ped").value.toLowerCase();
    const fil  = document.getElementById("fil-estado").value;
    const tb   = document.getElementById("tb-ped");

    let list = pedidos.filter(p =>
        (!busq || (p.cliente||"").toLowerCase().includes(busq) ||
                  (p.productos||"").toLowerCase().includes(busq) ||
                  (p.numeroPedido||"").toLowerCase().includes(busq)) &&
        (!fil  || p.estado === fil)
    );
    list = filtrarPorPeriodo(list);

    // Resumen
    const ingresos = list.reduce((s,p) => s + (parseFloat(String(p.total).replace(/[^0-9.]/g,""))||0), 0);
    document.getElementById("resumen-pedidos").innerHTML =
        `<b>${list.length}</b> pedido${list.length!==1?"s":""} · Total: <b style="color:var(--verde)">$${ingresos.toFixed(2)}</b>`;

    if (!list.length) {
        tb.innerHTML=`<tr><td colspan="10" style="text-align:center;color:#aaa;padding:18px;">Sin resultados</td></tr>`;
        return;
    }

    tb.innerHTML = list.map((p,i) => {
        const fecha = p.fecha ? new Date(p.fecha).toLocaleDateString("es-SV",{day:"2-digit",month:"2-digit"}) : "—";
        const tel   = String(p.telefono||"").replace(/\D/g,"");
        const opts  = ["Pendiente","Despachado","Entregado","Cancelado","No entregado"]
            .map(s=>`<option value="${s}" ${p.estado===s?"selected":""}>${s}</option>`).join('');
        const pagoCorto = (p.metodoPago||"—").replace("Contra Entrega (Efectivo)","Efectivo").replace("Pago con Tarjeta","Tarjeta");
        const estadoColor = {Pendiente:"#f97316","Despachado":"#3b82f6",Entregado:"#22c55e",Cancelado:"#ef4444","No entregado":"#888"}[p.estado]||"#888";
        return `<tr>
            <td style="font-family:monospace;font-size:11px;color:var(--azul);font-weight:700;white-space:nowrap;">${p.numeroPedido||"—"}</td>
            <td style="font-size:12px;white-space:nowrap;color:#888;">${fecha}</td>
            <td style="overflow:hidden;">
                <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.cliente)||"—"}</div>
                <a href="https://wa.me/${tel}" target="_blank" style="color:var(--verde);font-size:11px;text-decoration:none;">${esc(p.telefono)||""}</a>
                ${p.codigoCliente ? `<div style="font-size:10px;color:#C9A84C;font-weight:600;margin-top:1px;">${esc(p.codigoCliente)}</div>` : ""}
            </td>
            <td style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.municipio)||"—"}</td>
            <td style="font-size:11px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.productos)||"—"}</td>
            <td style="font-weight:700;color:var(--verde);white-space:nowrap;">$${parseFloat(String(p.total).replace(/[^0-9.]/g,"")||0).toFixed(2)}${avisoTotalPedido(p)}</td>
            <td style="font-size:11px;color:#aaa;">${esc(pagoCorto)}</td>
            <td><select class="es" style="font-size:11px;padding:3px 4px;border-color:${estadoColor};color:${estadoColor};" onchange="cambiarEstado(this,${jsAttr(p.numeroPedido||"")},${jsAttr(p.cliente)},${jsAttr(p.fecha)})">${opts}</select></td>
            <td>
                <div style="display:flex;gap:4px;">
                    <button class="btn" style="background:#ef4444;color:#fff;padding:4px 8px;font-size:11px;"
                        onclick='generarPDFAdmin(${i},"${p.numeroPedido||""}")'>PDF</button>
                    <button class="btn" style="background:#00875A;color:#fff;padding:4px 8px;font-size:11px;"
                        onclick='mostrarGuiaC807("${p.numeroPedido||""}")'>📋</button>
                    <button class="btn br" style="padding:4px 7px;font-size:11px;"
                        onclick='eliminarPedido("${p.numeroPedido||""}")'>🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');

    // ── TARJETAS MÓVIL ──────────────────────────────────────────────
    const cards = document.getElementById("cards-ped");
    cards.innerHTML = list.map((p,i) => {
        const fecha = p.fecha ? new Date(p.fecha).toLocaleDateString("es-SV") : "—";
        const tel   = String(p.telefono||"").replace(/\D/g,"");
        const opts  = ["Pendiente","Despachado","Entregado","Cancelado"]
            .map(s=>`<option value="${s}" ${p.estado===s?"selected":""}>${s}</option>`).join('');
        const estColor = {"Pendiente":"bam2","Despachado":"baz2","Entregado":"bv2","Cancelado":"br2"};
        return `<div class="ped-card">
            <div class="ped-card-header">
                <span class="ped-card-num">${p.numeroPedido||"—"}</span>
                <span class="ped-card-fecha">${fecha}</span>
            </div>
            <div class="ped-card-body">
                <span>👤 <b>${esc(p.cliente)||"—"}</b></span>
                <span>📱 <a href="https://wa.me/${tel}" target="_blank" style="color:var(--verde);font-weight:600;text-decoration:none;">${esc(p.telefono)||"—"}</a></span>
                <span>📍 ${esc(p.municipio)||"—"}</span>
                <span>🛍️ ${esc(p.productos)||"—"}</span>
                <span>💰 <b style="color:var(--verde)">${esc(p.total)||"—"}</b>${avisoTotalPedido(p)}</span>
                <span>💳 ${esc(p.metodoPago)||"—"}</span>
            </div>
            <div class="ped-card-footer">
                <select class="es" onchange="cambiarEstado(this,${jsAttr(p.numeroPedido||"")},${jsAttr(p.cliente)},${jsAttr(p.fecha)})">${opts}</select>
                <div style="display:flex;gap:6px;">
                    <button class="btn" style="background:#ef4444;color:#fff;padding:6px 12px;font-size:12px;"
                        onclick='generarPDFAdmin(${i},"${p.numeroPedido||""}")'>📄 PDF</button>
                    <button class="btn" style="background:#00875A;color:#fff;padding:6px 12px;font-size:12px;"
                        onclick='mostrarGuiaC807("${p.numeroPedido||""}")'>📋 C807</button>
                    <button class="btn br" style="padding:6px 10px;font-size:12px;"
                        onclick='eliminarPedido("${p.numeroPedido||""}")'>🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');
}
