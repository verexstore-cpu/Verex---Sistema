// Hub VEREX — Carga de datos, llamadas a la API y pestañas
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
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
