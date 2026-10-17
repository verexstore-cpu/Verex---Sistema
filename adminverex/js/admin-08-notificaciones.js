// Admin VEREX — Notificaciones
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  NOTIFICACIONES
// ═════════════════════════════════════════════
function actualizarNotif(sil=false) {
    const rec    = pedidos.slice(0,10);
    const nuevos = rec.filter(p=>!notifLeidas.has(String(p.fecha)+p.cliente));
    const badge  = document.getElementById("notif-badge");
    if (nuevos.length) {
        badge.textContent=nuevos.length; badge.style.display="flex";
        if (sil) toast(`🔔 ${nuevos.length} pedido${nuevos.length>1?"s":""} nuevo${nuevos.length>1?"s":""}`, "#00BFFF");
    } else badge.style.display="none";
    document.getElementById("notif-lista").innerHTML = rec.length
        ? rec.map(p=>`<div class="notif-item ${!notifLeidas.has(String(p.fecha)+p.cliente)?"nueva":""}" onclick="irPedido(${jsAttr(p.cliente)})">
                <b>${esc(p.cliente)||"—"}</b> — ${esc(p.total)}
                <div class="nt">${p.fecha?new Date(p.fecha).toLocaleString("es-SV"):""} · ${esc(p.municipio)}</div>
            </div>`).join('')
        : '<p style="padding:14px;color:#aaa;font-size:13px;">Sin pedidos aún.</p>';
}

function toggleNotif() { document.getElementById("notif-panel").classList.toggle("open"); }

function marcarLeidos() {
    pedidos.slice(0,10).forEach(p=>notifLeidas.add(String(p.fecha)+p.cliente));
    localStorage.setItem("vx_notif",JSON.stringify([...notifLeidas]));
    actualizarNotif(); document.getElementById("notif-panel").classList.remove("open");
}

function irPedido(cliente) {
    tab(1); document.getElementById("bus-ped").value=cliente; renderPedidos();
    document.getElementById("notif-panel").classList.remove("open");
}

document.addEventListener("click", e=>{
    if (!e.target.closest("#notif-panel")&&!e.target.closest("#notif-btn"))
        document.getElementById("notif-panel").classList.remove("open");
});
