

function abrirRegistrarVenta() {
    // Afiliados sin entrega física previa: eligen directo del stock general y se
    // registra entrega+venta en un solo paso (abrirVentaAfiliado/confirmarVentaAfiliado).
    // Si el afiliado SÍ recibe piezas físicas (recibeFisico), se comporta como
    // consignación normal — vende de lo que ya tiene asignado.
    if (vendedorActual?.tipo === "afiliado" && !vendedorActual?.recibeFisico) { abrirVentaAfiliado(); return; }
    // hibrido siempre tiene stock físico — continúa al flujo de consignación normal
    const inv = consignacion.filter(c =>
        c.vendedor === vendedorActual.codigo && c.estado === "activo" &&
        parseInt(c.cantidad||0) - parseInt(c.vendido||0) > 0
    );
    const lista = document.getElementById("lista-venta");
    const hoyISO = new Date().toISOString().slice(0,10);
    if (!inv.length) { lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay productos disponibles.</p>'; }
    else {
        lista.innerHTML = inv.map(c => {
            const disp = parseInt(c.cantidad||0) - parseInt(c.vendido||0);
            return `<div class="inv-item" style="margin-bottom:8px;flex-wrap:wrap;">
                <img src="${sanitizar(ikFoto(c.foto,200)||'')}" onerror="this.style.display='none'">
                <div class="inv-item-info">
                    <div class="inv-item-codigo">${sanitizar(c.codigo)}</div>
                    <div class="inv-item-nombre">${sanitizar(c.nombre)}</div>
                    <div class="inv-item-precio">$${parseFloat(c.precio||0).toFixed(2)} · ${disp} disponibles</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <input type="number" min="1" max="${disp}" value="1" style="width:50px;margin:0;padding:6px;font-size:13px;" id="venta-qty-${sanitizar(c.id)}">
                    <input type="date" value="${hoyISO}" max="${hoyISO}" title="Fecha real de la venta — déjala en hoy salvo que estés registrando algo atrasado"
                        style="padding:6px;font-size:12px;margin:0;" id="venta-fecha-${sanitizar(c.id)}">
                    <button class="btn btn-dorado" style="padding:6px 10px;font-size:12px;" onclick="registrarVenta(${jsArg(c.id)},${disp})">✓</button>
                </div>
            </div>`;
        }).join('');
    }
    abrirModal("modal-venta");
}

async function registrarVenta(id, maxDisp) {
    const qty = parseInt(document.getElementById("venta-qty-" + id)?.value) || 1;
    if (qty > maxDisp) { toast("⚠️ Cantidad mayor a disponible"); return; }
    const fechaInput = document.getElementById("venta-fecha-" + id)?.value;
    const fecha = fechaInput ? new Date(fechaInput + "T12:00:00").toISOString() : undefined;
    await apiPost({ accion: "REGISTRAR_VENTA", id, cantidad: qty, fecha });
    const item = consignacion.find(c => String(c.id) === String(id));
    if (item) item.vendido = parseInt(item.vendido||0) + qty;
    toast("✅ Venta registrada");
    cerrarModal("modal-venta");
    renderPerfilStats();
    renderInventario();
    renderVentasPerfil();
}

let decisionesCorte = {};
let _corteValorVend = 0;
let _cortePct = 25;
let _corteGanancia = 0;
// Evita que un doble-tap en "Confirmar Corte" dispare confirmarCorte() dos
// veces en paralelo — GUARDAR_CORTE_HISTORIAL usa Date.now() como parte del
// id, así que dos ejecuciones (aunque sea con milisegundos de diferencia)
// generaban dos registros de historial distintos para el mismo corte, y por
// eso aparecía duplicado en "Cobros pendientes".
let _corteProcesando = false;

function calcularComision(totalVendido, tipoVendedor, comisionFija) {
    if (comisionFija !== undefined && comisionFija !== null && comisionFija !== "") {
        return parseFloat(comisionFija);
    }
    const tabla = (tipoVendedor === "afiliado" || tipoVendedor === "hibrido") ? RANGOS_COMISION_AFILIADO : RANGOS_COMISION;
    const rango = tabla.slice().reverse().find(r => totalVendido >= r.min);
    return rango ? rango.pct : tabla[0].pct;
}

function abrirCorte() {
    const inv = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "activo");
    const vendidos  = inv.reduce((s, c) => s + parseInt(c.vendido||0), 0);
    const valorVend = inv.reduce((s, c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);
    const sinVender = inv.filter(c => parseInt(c.cantidad||0) - parseInt(c.vendido||0) > 0);
    const pct       = calcularComision(valorVend, vendedorActual.tipo, vendedorActual.comisionFija);
    const ganancia  = valorVend * pct / 100;
    _corteValorVend = valorVend; _cortePct = pct; _corteGanancia = ganancia;
    decisionesCorte = {};
    sinVender.forEach(c => decisionesCorte[c.id] = "renovar");
    const chkCobrado = document.getElementById("chk-cobrado-corte");
    if (chkCobrado) chkCobrado.checked = false; // sin marcar por defecto — hay que confirmarlo a propósito
    document.getElementById("resumen-corte").innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
            <div class="stat-box"><div class="stat-num">${vendidos}</div><div class="stat-label">Vendidos</div></div>
            <div class="stat-box"><div class="stat-num">$${valorVend.toFixed(2)}</div><div class="stat-label">Total vendido</div></div>
        </div>`;
    document.getElementById("lista-corte").innerHTML = sinVender.length ? sinVender.map(c => {
        const disp = parseInt(c.cantidad||0) - parseInt(c.vendido||0);
        return `<div class="corte-item">
            <img src="${sanitizar(ikFoto(c.foto,200)||'')}" onerror="this.style.display='none'">
            <div class="corte-item-info">
                <div style="font-size:10px;color:var(--dorado);">${sanitizar(c.codigo)}</div>
                <div style="font-size:13px;">${sanitizar(c.nombre)}</div>
                <div style="font-size:11px;color:var(--plateado);">${disp} piezas · $${parseFloat(c.precio||0).toFixed(2)}</div>
            </div>
            <div class="corte-item-acciones">
                <button class="corte-btn corte-btn-renovar activo" id="btn-ren-${sanitizar(c.id)}" onclick="toggleDecision(${jsArg(c.id)},&quot;renovar&quot;)">🔄</button>
                <button class="corte-btn corte-btn-devolver" id="btn-dev-${sanitizar(c.id)}" onclick="toggleDecision(${jsArg(c.id)},&quot;devolver&quot;)">↩️</button>
            </div>
        </div>`;
    }).join('') : '<p style="color:var(--plateado);font-size:13px;">¡Todo vendido! 🎉</p>';
    const afiliadoSinStockResumen = vendedorActual.tipo === "afiliado" && !vendedorActual.recibeFisico; // hibrido siempre tiene físico
    const filaFinalResumen = afiliadoSinStockResumen
        ? `<span style="color:var(--plateado);">VEREX te debe:</span><strong style="font-size:16px;color:#27ae60;">$${ganancia.toFixed(2)}</strong>`
        : `<span style="color:var(--plateado);">A recibir por VEREX:</span><strong style="font-size:16px;">$${(valorVend - ganancia).toFixed(2)}</strong>`;
    document.getElementById("totales-corte").innerHTML = `
        <div style="font-size:13px;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--plateado);">Total vendido:</span><strong>$${valorVend.toFixed(2)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--plateado);">Comisión vendedor (${pct}%):</span><strong style="color:var(--dorado);">$${ganancia.toFixed(2)}</strong></div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid var(--borde);padding-top:8px;">${filaFinalResumen}</div>
        </div>`;
    abrirModal("modal-corte");
}

function toggleDecision(id, decision) {
    decisionesCorte[id] = decision;
    const btnRen = document.getElementById("btn-ren-" + id);
    const btnDev = document.getElementById("btn-dev-" + id);
    if (btnRen) btnRen.classList.toggle("activo", decision === "renovar");
    if (btnDev) btnDev.classList.toggle("activo", decision === "devolver");
}

async function confirmarCorte() {
    if (_corteProcesando) return;
    _corteProcesando = true;
    const btnConfirmarCorte = document.getElementById("btn-confirmar-corte");
    if (btnConfirmarCorte) btnConfirmarCorte.disabled = true;
    try {
    const cobrado = !!document.getElementById("chk-cobrado-corte")?.checked;
    const devueltos = Object.entries(decisionesCorte).filter(([_, d]) => d === "devolver").map(([id]) => id);
    await apiPost({ accion: "CERRAR_CORTE", vendedor: vendedorActual.codigo, devueltos });
    await apiPost({ accion: "GUARDAR_CORTE_HISTORIAL", id: Date.now() + "_" + vendedorActual.codigo,
        vendedor: vendedorActual.codigo, vendedorNombre: vendedorActual.nombre, vendedorTelefono: vendedorActual.telefono || "",
        totalVendido: _corteValorVend, comisionPct: _cortePct,
        gananciaVendedor: _corteGanancia, aPagarVerex: _corteValorVend - _corteGanancia, cobrado });
    if (!cobrado) cargarCortesPendientesCobro(); // refresca el aviso de Dashboard/Hub con este corte nuevo
    devueltos.forEach(id => { const item = consignacion.find(c => String(c.id) === String(id)); if (item) item.estado = "devuelto"; });
    // Copia del inventario ANTES de resetear "vendido" abajo — el PDF del corte
    // necesita las cantidades vendidas reales de cada producto (incluyendo los
    // que se renuevan con stock parcial), no las ya reseteadas a 0. Generar el
    // PDF a partir de "consignacion" después del reset hacía que los productos
    // parcialmente vendidos desaparecieran de la tabla (aunque su monto sí
    // contaba en el total), porque quedaban con vendido=0 antes de imprimirse.
    const invCorte = consignacion.filter(c => c.vendedor === vendedorActual.codigo).map(c => ({ ...c }));
    // Reflejar en memoria el mismo cierre que hace el worker: piezas totalmente
    // vendidas se marcan "vendido" (no vuelven a verse disponibles), el resto
    // arranca de cero — si no, la pantalla mostraba datos viejos hasta recargar.
    consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "activo").forEach(c => {
        const cant = parseInt(c.cantidad)||0, vend = parseInt(c.vendido)||0;
        if (cant > 0 && vend >= cant) c.estado = "vendido";
        else c.vendido = 0;
    });
    if (vendedorActual) { vendedorActual.fechaCorte = new Date().toISOString(); vendedorActual.tokenInventario = ""; vendedorActual.proximoCorte = null; }
    renderProximoCortePerfil();
    const recCorte = document.getElementById("recordatorio-corte");
    if (recCorte) recCorte.style.display = "none";
    await apiPost({ accion: "GUARDAR_TOKEN", vendedor: vendedorActual.codigo, token: "" });
    sessionStorage.removeItem("vx_token_" + vendedorActual.codigo);
    toast(cobrado ? "✅ Corte realizado correctamente" : "✅ Corte realizado — pendiente de cobro (avisará en Dashboard)", cobrado ? "#22c55e" : "#e67e22");
    cerrarModal("modal-corte");
    renderPerfilStats();
    renderInventario();
    generarPDFCorte(vendedorActual, invCorte, _corteValorVend, _cortePct, _corteGanancia);
    const tel = String(vendedorActual.telefono||"").replace(/\D/g,"");
    // Un afiliado sin stock físico nunca cobra al cliente — VEREX cobra directo y
    // le debe la comisión al afiliado, al revés que consignación (donde el vendedor
    // ya tiene el dinero del cliente en mano y le remite el saldo a VEREX).
    const afiliadoSinStock = vendedorActual.tipo === "afiliado" && !vendedorActual.recibeFisico;
    const msg = "Corte VEREX - " + vendedorActual.nombre + "\n"
        + "Total vendido: $" + _corteValorVend.toFixed(2) + "\n"
        + "Tu comisión (" + _cortePct + "%): $" + _corteGanancia.toFixed(2) + "\n"
        + (afiliadoSinStock
            ? "VEREX te debe pagar: $" + _corteGanancia.toFixed(2)
            : "A pagar a VEREX: $" + (_corteValorVend - _corteGanancia).toFixed(2));
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
    } finally {
        _corteProcesando = false;
        if (btnConfirmarCorte) btnConfirmarCorte.disabled = false;
    }
}

async function verLinkInventario() {
    const cacheKey = "vx_token_" + vendedorActual.codigo;
    // El token real es el que está guardado en el vendedor (server) — NO
    // sessionStorage, que se pierde al cambiar de navegador/dispositivo o
    // borrar caché. Antes, si sessionStorage no tenía el token cacheado, se
    // generaba uno NUEVO y se sobreescribía el del servidor, invalidando en
    // silencio el link que ya se le había compartido al vendedor (aunque
    // siguiera siendo válido) — causaba que un link "de ayer" apareciera
    // cerrado hoy solo por abrir este modal desde otra sesión.
    let linkId = vendedorActual.tokenInventario || sessionStorage.getItem(cacheKey);
    if (!linkId) {
        linkId = generarLinkId();
        await apiPost({ accion: "GUARDAR_TOKEN", vendedor: vendedorActual.codigo, token: linkId });
        vendedorActual.tokenInventario = linkId;
        renderProximoCortePerfil();
    }
    sessionStorage.setItem(cacheKey, linkId);
    const link = "https://verex-invetario-consign.pages.dev?inv=" + vendedorActual.codigo + "&token=" + linkId;
    document.getElementById("inp-link").value = link;
    abrirModal("modal-link");
}

async function desactivarLink() {
    await apiPost({ accion: "GUARDAR_TOKEN", vendedor: vendedorActual.codigo, token: "" });
    vendedorActual.tokenInventario = "";
    renderProximoCortePerfil();
    sessionStorage.removeItem("vx_token_" + vendedorActual.codigo);
    toast("🔒 Link desactivado");
    cerrarModal("modal-link");
}

async function verHistorialCortes() {
    const res  = await fetch(API_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ accion: "GET_HISTORIAL_CORTES", _pass: _sessionPass, vendedor: vendedorActual.codigo }) });
    const data = await res.json();
    // El worker devuelve el historial en "cortes" — este modal llevaba tiempo
    // leyendo "historial" (siempre undefined) y por eso siempre mostraba
    // "No hay cortes registrados", aunque sí existieran.
    const historial = data.cortes || [];
    const lista = document.getElementById("lista-historial");
    if (!historial.length) {
        lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay cortes registrados.</p>';
    } else {
        lista.innerHTML = historial.map(c => {
            const fecha = c.fecha ? new Date(c.fecha).toLocaleDateString("es-SV") : "—";
            // Cortes de antes de este campo (cobrado === undefined) no se
            // muestran como pendientes — igual que en el aviso de Dashboard/Hub.
            const pendiente = c.cobrado === false;
            const estadoCobro = pendiente
                ? `<button onclick="(async()=>{await marcarCorteCobrado('${sanitizar(c.id)}');verHistorialCortes();})()" style="font-size:11px;background:#e67e22;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700;">💰 Marcar cobrado</button>`
                : (c.cobrado === true ? '<span style="font-size:11px;color:#27ae60;font-weight:700;">✅ Cobrado</span>' : '');
            return '<div style="background:var(--gris2);border:1px solid ' + (pendiente ? '#e67e22' : 'var(--borde)') + ';border-radius:10px;padding:14px;margin-bottom:10px;">'
                + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">'
                + '<span style="font-size:12px;color:var(--dorado);font-weight:600;">' + fecha + '</span>'
                + '<div style="display:flex;align-items:center;gap:10px;">'
                + '<span style="font-size:12px;color:var(--plateado);">' + c.comisionPct + '% comisión</span>'
                + '<button onclick="(async()=>{await eliminarCorteHistorial(\'' + sanitizar(c.id) + '\');verHistorialCortes();})()" style="font-size:11px;background:none;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;padding:2px 8px;cursor:pointer;" title="Eliminar este registro">🗑️</button>'
                + '</div>'
                + '</div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;margin-bottom:' + (estadoCobro ? '10px' : '0') + ';">'
                + '<div><div style="color:var(--plateado);">Total vendido</div><div style="font-weight:700;">$' + parseFloat(c.totalVendido||0).toFixed(2) + '</div></div>'
                + '<div><div style="color:var(--plateado);">Ganancia</div><div style="font-weight:700;color:var(--dorado);">$' + parseFloat(c.gananciaVendedor||0).toFixed(2) + '</div></div>'
                + '<div><div style="color:var(--plateado);">A VEREX</div><div style="font-weight:700;">$' + parseFloat(c.aPagarVerex||0).toFixed(2) + '</div></div>'
                + '</div>'
                + (estadoCobro ? '<div style="text-align:right;">' + estadoCobro + '</div>' : '')
                + '</div>';
        }).reverse().join('');
    }
    abrirModal("modal-historial");
}

function generarLinkId() { return Math.random().toString(36).substr(2, 12).toUpperCase(); }
function copiarLink() { navigator.clipboard.writeText(document.getElementById("inp-link").value); toast("✅ Link copiado"); }

function enviarLinkWhatsApp() {
    const link = document.getElementById("inp-link").value;
    const tel  = String(vendedorActual.telefono||"").replace(/\D/g,"");
    const msg  = "Hola " + vendedorActual.nombre + "! Aqui esta el link de tu inventario actual VEREX:\n" + link;
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
}

function generarPDFCorte(vendedor, inv, valorVend, pct, ganancia) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'in', format: [4, 6] });
    const pageW = 4, mL = 0.35, lh = 0.18;
    let y = 0.45;
    // Un afiliado sin stock físico nunca cobra al cliente — VEREX cobra directo y
    // le debe la comisión al afiliado, al revés que consignación.
    const afiliadoSinStock = vendedor.tipo === "afiliado" && !vendedor.recibeFisico;
    doc.setFont("helvetica","normal"); doc.setFontSize(13);
    doc.text(afiliadoSinStock ? "VEREX - Corte de Comision" : "VEREX - Corte de Consignacion", pageW/2, y, {align:"center"}); y += 0.28;
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text("Fecha: " + new Date().toLocaleDateString("es-SV"), pageW/2, y, {align:"center"}); y += 0.28;
    doc.setTextColor(0,0,0);
    doc.text("Vendedor: " + vendedor.nombre, mL, y); y += lh;
    doc.text("Telefono: " + vendedor.telefono, mL, y); y += lh + 0.1;
    const cols = [{x:mL,w:0.7},{x:1.07,w:1.85},{x:2.94,w:0.71}];
    const labels = ["Codigo","Producto","Monto"];
    const rowH = 0.24, tW = pageW - mL*2;
    doc.setFillColor(30,30,30); doc.rect(mL,y,tW,rowH,'F');
    doc.setTextColor(255,255,255); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    cols.forEach((col,i) => doc.text(labels[i], col.x+0.06, y+rowH/2+0.03));
    doc.setTextColor(0,0,0); y += rowH;
    inv.filter(c => parseInt(c.vendido||0)>0).forEach(c => {
        doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setDrawColor(200,200,200);
        // Sin setLineWidth() el borde hereda el grosor por defecto de jsPDF
        // (~0.2in) — muchísimo más grueso que el alto de la fila (0.24in),
        // así que el "borde" terminaba pintando casi toda la fila de gris
        // sólido en vez de una línea fina. Es el mismo ancho fino (0.005in)
        // que ya se usa más abajo en las filas de totales.
        doc.setLineWidth(0.005);
        doc.rect(mL,y,tW,rowH,'S');
        const monto = parseInt(c.vendido||0)*parseFloat(c.precio||0);
        doc.text(String(c.codigo||""), cols[0].x+0.06, y+rowH/2+0.03);
        doc.text((c.nombre||"").substring(0,28), cols[1].x+0.06, y+rowH/2+0.03);
        doc.text("$"+monto.toFixed(2), cols[2].x+cols[2].w-0.06, y+rowH/2+0.03, {align:"right"});
        y += rowH;
    });
    y += 0.1;
    const filaFinal = afiliadoSinStock
        ? ["VEREX TE DEBE:", "$"+ganancia.toFixed(2)]
        : ["A PAGAR A VEREX:", "$"+(valorVend-ganancia).toFixed(2)];
    [["TOTAL VENDIDO:","$"+valorVend.toFixed(2),false],["COMISION ("+pct+"%):","$"+ganancia.toFixed(2),false],[filaFinal[0],filaFinal[1],true]].forEach(([label,valor,bold]) => {
        doc.setDrawColor(190,190,190); doc.setLineWidth(0.005); doc.rect(mL,y,tW,rowH,'S');
        doc.setFont("helvetica", bold?"bold":"normal"); doc.setFontSize(bold?9:8);
        doc.text(label, cols[2].x-0.06, y+rowH/2+0.03, {align:"right"});
        doc.text(valor, cols[2].x+cols[2].w-0.06, y+rowH/2+0.03, {align:"right"});
        y += rowH;
    });
    doc.setFont("times","italic"); doc.setFontSize(7.5); doc.setTextColor(120,120,120);
    doc.text("Gracias por tu compromiso. VEREX", pageW/2, 5.75, {align:"center"});
    doc.save("Corte_" + vendedor.nombre.replace(/ /g,"_") + ".pdf");
}

let productoEditando = null;

function verProducto(key) {
    const p = mapaProductos[key];
    if (!p) return;
    productoEditando = { key, p };
    document.getElementById("modal-prod-titulo").textContent = p.codigo || "Producto";
    const foto = document.getElementById("modal-prod-foto");
    if (p.img) { foto.src = ikFoto(p.img, 900); foto.style.display = "block"; }
    else { foto.style.display = "none"; }
    document.getElementById("vp-codigo").textContent = p.codigo || "";
    document.getElementById("vp-nombre").textContent = p.nombre || "";
    document.getElementById("vp-desc").textContent = p.descripcion || "";
    document.getElementById("vp-precio").textContent = "$" + parseFloat(p.precio || p.precioNum || 0).toFixed(2);
    document.getElementById("modal-prod-vista").style.display = "block";
    document.getElementById("modal-prod-edicion").style.display = "none";
    abrirModal("modal-ver-producto");
}

function activarEdicionProducto() {
    if (!productoEditando) return;
    const p = productoEditando.p;
    document.getElementById("ep-codigo").value = p.codigo || "";
    document.getElementById("ep-nombre").value = p.nombre || "";
    document.getElementById("ep-desc").value = p.descripcion || "";
    document.getElementById("ep-precio").value = p.precio || p.precioNum || "";
    document.getElementById("ep-existencia").value = 0;
    document.getElementById("ep-caract").value = p.caracterEspecial || "";
    // Marcar material actual
    document.querySelectorAll(".ep-mat-btn").forEach(b => {
        b.style.outline = (b.dataset.mat === p.material) ? "2px solid var(--dorado)" : "";
    });
    // Marcar set_config actual y mostrar campos de precio correctos
    const scActual = p.set_config || "";
    document.querySelectorAll(".ep-set-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    const epSetBtn = document.querySelector(`.ep-set-btn[data-set="${scActual}"]`);
    if (epSetBtn) { epSetBtn.style.background="var(--dorado)"; epSetBtn.style.color="#111"; epSetBtn.style.borderColor="var(--dorado)"; }
    const esSetActual = scActual !== "";
    document.getElementById("ep-precio").style.display = esSetActual ? "none" : "";
    document.getElementById("ep-precio-set-wrap").style.display = esSetActual ? "flex" : "none";
    if (esSetActual) {
        const pDama = parseFloat(p.precio || p.precioNum) || 0;
        const pCab  = parseFloat(p.precio_caballero) || 0;
        const esUniActual = !pCab || pCab === pDama;
        selPrecioTipoEP(esUniActual ? 'unisex' : 'dif');
        if (esUniActual) {
            document.getElementById("ep-precio-unisex").value = pDama || "";
        } else {
            document.getElementById("ep-precio-dama").value = pDama || "";
            document.getElementById("ep-precio-caballero").value = pCab || "";
        }
    }
    // El campo de talla y el "Tipo de venta" (par/trío) solo aplican a
    // anillos y conjuntos — antes ocultaban por error también la "Cantidad
    // a sumar" (compartían el mismo div contenedor vía .closest("div")).
    const esAnilloEP = p.categoria === "AN" || p.categoria === "CJ";
    const tallaWrap = document.getElementById("ep-talla-add-wrap");
    if (tallaWrap) tallaWrap.style.display = esAnilloEP ? "inline-block" : "none";
    const tallaHint = document.getElementById("ep-talla-hint");
    if (tallaHint) tallaHint.style.display = esAnilloEP ? "block" : "none";
    if (!esAnilloEP && document.getElementById("ep-talla-add")) document.getElementById("ep-talla-add").value = "";
    // Alianzas (par/trío): cada talla lleva D (dama), C (caballero) o U (unisex) en el código — ANP240DT6, ANP240CT10.
    // Antes la talla nueva se registraba SIN esa letra (ANP240T11) y no aparecía en el grupo. Se elige aquí.
    const baseEPTalla = getCodigoBase(p.codigo);
    const letrasGrupo = new Set(stockData.filter(s => getCodigoBase(s.codigo) === baseEPTalla)
        .map(s => (String(s.codigo || "").match(/([DCU])T\d+(\.\d+)?$/i) || [])[1]).filter(Boolean).map(x => x.toUpperCase()));
    const opcionesTipo = [];
    if (letrasGrupo.has("D") || letrasGrupo.has("C")) opcionesTipo.push(["D", "👩 Dama"], ["C", "👨 Caballero"]);
    if (letrasGrupo.has("U")) opcionesTipo.push(["U", "Unisex"]);
    const selTipo = document.getElementById("ep-talla-tipo");
    if (selTipo) {
        const letraActual = (String(p.codigo || "").match(/([DCU])T\d+(\.\d+)?$/i) || [])[1]?.toUpperCase();
        selTipo.innerHTML = opcionesTipo.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
        if (letraActual && opcionesTipo.some(o => o[0] === letraActual)) selTipo.value = letraActual;
        selTipo.style.display = esAnilloEP && opcionesTipo.length ? "inline-block" : "none";
    }
    actualizarHintTallaEP();
    const setAnilloWrap = document.getElementById("ep-set-anillo-wrap");
    if (setAnilloWrap) setAnilloWrap.style.display = esAnilloEP ? "block" : "none";
    document.getElementById("modal-prod-vista").style.display = "none";
    document.getElementById("modal-prod-edicion").style.display = "block";
    // Mostrar foto actual en el preview del editor
    const fotoActual = productoEditando.p.img || productoEditando.p.foto || "";
    const prev = document.getElementById("ep-foto-preview");
    if (fotoActual) {
        prev.innerHTML = `<img src="${fotoActual}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
    } else {
        prev.innerHTML = "📷";
    }

    // foto change listener
    document.getElementById("ep-foto").onchange = async function() {
        const file = this.files[0]; if (!file) return;
        const r = await procesarFotoJoya(file);
        productoEditando.nuevaFotoFile = file;
        productoEditando.nuevaFotoOriginal = r.original;
        productoEditando.nuevaFotoCrop = r.crop;
        productoEditando.nuevaFoto = r.preview;
        prev.innerHTML = `<img src="${r.preview}" style="width:100%;height:100%;object-fit:contain;border-radius:10px;">`;
    };
}

function cancelarEdicionProducto() {
    document.getElementById("modal-prod-vista").style.display = "block";
    document.getElementById("modal-prod-edicion").style.display = "none";
    productoEditando.nuevaFoto = null;
}

// Registra la 2da pieza de dama de un trío (ej. anillo de compromiso, aparte
// del de matrimonio) sin tocar las filas que ya existen de dama/caballero.
// Reusa nombre_base/categoria/material/foto del producto que está abierto,
// y crea el código con el sufijo "B" que el catálogo ya sabe reconocer como
// una pieza distinta.
async function agregarSegundaPiezaDamaTrio() {
    if (!productoEditando) return;
    const p = productoEditando.p;
    const codigoBase = p.codigoBase || getCodigoBase(p.codigo);
    if (!codigoBase) { toast("⚠️ No se pudo determinar el código base de este producto"); return; }

    const tallasRaw = prompt("Tallas de la 2da pieza de dama, separadas por coma.\nSi hay más de 1 unidad de una talla, pon talla:cantidad (ej: 6,7:2,9:2):");
    if (!tallasRaw) return;
    const entradas = tallasRaw.split(",").map(t => t.trim()).filter(Boolean).map(t => {
        const [talla, cantRaw] = t.split(":").map(x => x.trim());
        const cantidad = parseInt(cantRaw, 10);
        return { talla, cantidad: (!cantRaw || isNaN(cantidad) || cantidad < 1) ? 1 : cantidad };
    });
    if (!entradas.length) return toast("⚠️ No ingresaste ninguna talla");

    const precioRaw = prompt("Precio de esta 2da pieza de dama ($):");
    if (!precioRaw) return;
    const precio = parseFloat(precioRaw);
    if (isNaN(precio) || precio < 0) return toast("⚠️ Precio inválido");

    const codigoBase2 = codigoBase + "B";
    const nombreBase  = p.nombre_base || (p.nombre || "").replace(/\s+(Dama|Caballero)?\s*T?\d+(\.\d+)?$/i, "").trim();
    let guardados = 0;
    for (const { talla, cantidad } of entradas) {
        const codigo = codigoBase2 + "DT" + talla;
        const res = await apiPost({
            accion: "STOCK_REGISTRAR",
            codigo, codigoBase: codigoBase2, talla,
            nombre: `${nombreBase} Dama T${talla}`,
            nombre_base: nombreBase,
            categoria: p.categoria || "AN",
            precio, foto: p.img || p.foto || "", cantidad,
            material: p.material || "",
            descripcion: p.descripcion || "",
            caracterEspecial: p.caracterEspecial || ""
        });
        if (res.ok) guardados++;
    }
    toast(`✅ ${guardados} talla${guardados > 1 ? "s" : ""} de la 2da pieza registrada${guardados > 1 ? "s" : ""} — ya forma un trío`);
    cerrarModal("modal-ver-producto");
    await cargarStock();
}

// Muestra el código exacto que tendrá la talla nueva (con D/C/U en alianzas)
function letraTallaEP() {
    const sel = document.getElementById("ep-talla-tipo");
    return sel && sel.style.display !== "none" ? (sel.value || "") : "";
}
function actualizarHintTallaEP() {
    const hint = document.getElementById("ep-talla-hint"); if (!hint || !productoEditando) return;
    const t = (document.getElementById("ep-talla-add")?.value || "").trim();
    const base = getCodigoBase(productoEditando.p.codigo || "");
    const letra = letraTallaEP();
    hint.innerHTML = t
        ? `Se registra como <b style="color:#FF9500;">${sanitizar(base + letra + "T" + t)}</b>${letra ? ` (${letra === "D" ? "dama" : letra === "C" ? "caballero" : "unisex"})` : ""}`
        : `Si ingresas talla, se registra como variante separada (ej: ${sanitizar(base)}<b style="color:#FF9500;">${letra}T10</b>)`;
}

async function guardarEdicionProducto() {
    if (!productoEditando) return;
    const btn = document.querySelector("#modal-prod-edicion .btn-dorado");
    btn.textContent = "⏳ Guardando..."; btn.disabled = true;
    const codigo  = document.getElementById("ep-codigo").value.trim();
    const nombre  = document.getElementById("ep-nombre").value.trim();
    const desc    = document.getElementById("ep-desc").value.trim();
    const setConfigEP  = document.querySelector(".ep-set-btn[style*='var(--dorado)']")?.dataset.set ?? "";
    const esSetEP      = setConfigEP !== "";
    const esUnisexEP   = esSetEP && document.getElementById("ep-precio-unisex-wrap")?.style.display !== "none";
    const precio       = esSetEP
        ? (esUnisexEP ? (parseFloat(document.getElementById("ep-precio-unisex").value) || 0)
                      : (parseFloat(document.getElementById("ep-precio-dama").value) || 0))
        : (parseFloat(document.getElementById("ep-precio").value) || 0);
    const precioCaballeroEP = esSetEP
        ? (esUnisexEP ? precio : (parseFloat(document.getElementById("ep-precio-caballero").value) || 0))
        : undefined;
    if (!nombre || !precio) { toast("⚠️ Completa nombre y precio"); btn.textContent = "💾 Guardar"; btn.disabled = false; return; }
    if (esSetEP && !esUnisexEP && !precioCaballeroEP) { toast("⚠️ Completa el precio de caballero"); btn.textContent = "💾 Guardar"; btn.disabled = false; return; }
    let img = productoEditando.p.img || "";
    // Si se CAMBIA la foto, la versión "mejorada" guardada es de la foto anterior: hay que borrarla, porque la pantalla
    // muestra fotoMejorada antes que foto y seguiría enseñando la foto vieja (el cambio parecía no aplicarse).
    const cambioFoto = !!productoEditando.nuevaFoto;
    if (cambioFoto) {
        const url = await subirFotoImageKit(productoEditando.nuevaFotoFile || productoEditando.nuevaFotoOriginal || productoEditando.nuevaFoto, codigo, productoEditando.nuevaFotoCrop);
        if (!url) {
            // Sin URL no se guarda nada de la foto (antes se guardaba la imagen completa en base64 como si fuera la URL).
            toast("⚠️ No se pudo subir la foto nueva — no se cambió la foto. Inténtalo de nuevo.", "#ef4444");
            btn.textContent = "💾 Guardar"; btn.disabled = false;
            return;
        }
        img = url;
    }
    const limpiaMejora = cambioFoto ? { fotoMejorada: "", fotoMejoraNivel: "" } : {};
    const matSelBtn = document.querySelector(".ep-mat-btn[style*='solid var(--dorado)']");
    const material  = matSelBtn ? matSelBtn.dataset.mat : (productoEditando.p.material || "");
    const caracterEspecial = (document.getElementById("ep-caract")?.value || "").trim();
    const codigoViejo = productoEditando.p.codigo;
    // nombre_base es el nombre "limpio" sin el sufijo de talla (ej. "Pulsera
    // Étoile Blanc T7" -> "Pulsera Étoile Blanc") — es lo que muestran Stock
    // y el catálogo, así que hay que mantenerlo sincronizado con el nombre.
    const nombreBaseEP = nombre.replace(/\s+T?\d+(\.\d+)?\s*$/i, "").trim() || nombre;
    // Update en servidor
    await apiPost({ accion: "EDITAR_PRODUCTO", codigo: codigoViejo, nuevo_codigo: codigo !== codigoViejo ? codigo : undefined, nombre, nombre_base: nombreBaseEP, descripcion: desc, precio, img, material, caracterEspecial, set_config: setConfigEP || undefined, precio_caballero: precioCaballeroEP, ...limpiaMejora });
    // Propagar nombre_base, foto, material, descripción y caracterEspecial al
    // resto de tallas del mismo diseño — así editar cualquier talla actualiza
    // todo el grupo sin tener que hacerlo una por una.
    const codigoBaseActual = getCodigoBase(codigoViejo);
    const hermanos = stockData.filter(s => getCodigoBase(s.codigo) === codigoBaseActual && s.codigo !== codigoViejo && s.estado !== "inactivo");
    for (const h of hermanos) {
        const tallaH = getTallaFromCodigo(h.codigo);
        const nombreH = tallaH ? `${nombreBaseEP} T${tallaH}` : nombreBaseEP;
        await apiPost({ accion: "EDITAR_PRODUCTO", codigo: h.codigo, nombre: nombreH, nombre_base: nombreBaseEP, descripcion: desc, img, material, caracterEspecial, ...limpiaMejora });
        // h es la misma referencia que el objeto dentro de stockData — reflejar
        // el cambio ahí también para que sus tarjetas se vean actualizadas sin
        // esperar a un cargarStock().
        h.nombre = nombreH; h.nombre_base = nombreBaseEP; h.descripcion = desc;
        h.img = img; h.foto = img; h.material = material; h.caracterEspecial = caracterEspecial;
        if (cambioFoto) { h.fotoMejorada = ""; h.fotoMejoraNivel = ""; }
    }
    // Sumar existencia a bodega si se ingresó cantidad
    const existencia = parseInt(document.getElementById("ep-existencia")?.value) || 0;
    const catEP = productoEditando.p.categoria || "";
    const esAnilloCategoria = catEP === "AN" || catEP === "CJ";
    const tallaAdd = esAnilloCategoria ? (document.getElementById("ep-talla-add")?.value || "").trim() : "";
    if (tallaAdd && existencia <= 0) {
        toast("⚠️ Ingresa la cantidad de unidades para la talla " + tallaAdd);
        btn.textContent = "💾 Guardar"; btn.disabled = false;
        return;
    }
    if (existencia > 0) {
        // Si el servidor no confirma, se avisa y el formulario queda abierto (antes decía «✅» aunque no se guardara)
        const fallo = (r, que) => {
            if (r && r.ok) return false;
            toast(`❌ ${que} NO se guardó: ${(r && r.error) || "sin respuesta del servidor"}`, "#ef4444", 8000);
            btn.textContent = "💾 Guardar"; btn.disabled = false;
            return true;
        };
        if (tallaAdd) {
            // Registrar variante con talla — puede ser nueva o existente. En alianzas lleva la letra D/C/U.
            const codigoBase  = getCodigoBase(codigo);
            const letra       = letraTallaEP();
            const codigoTalla = `${codigoBase}${letra}T${tallaAdd}`;
            const stockTalla  = stockData.find(s => s.codigo === codigoTalla);
            if (stockTalla) {
                // Ya existe esa talla → solo sumar cantidad
                const bodegaActual = parseInt(stockTalla.stock_bodega || 0);
                const r = await apiPost({ accion: "STOCK_ACTUALIZAR_CANTIDADES", items: [{ codigo: codigoTalla, stock_bodega: bodegaActual + existencia }] });
                if (fallo(r, `La cantidad de ${codigoTalla}`)) return;
            } else {
                // Nueva variante — registrar con STOCK_REGISTRAR (mismo nombre y precio que sus hermanas de dama/caballero)
                const p = productoEditando.p;
                const nb = p.nombre_base || p.nombre;
                const nombreConTalla = letra === "D" ? `${nb} Dama T${tallaAdd}` : letra === "C" ? `${nb} Caballero T${tallaAdd}` : `${nb} T${tallaAdd}`;
                const hermana = letra ? stockData.find(s => getCodigoBase(s.codigo) === codigoBase && new RegExp(letra + "T\\d", "i").test(s.codigo)) : null;
                const precioTalla = hermana ? (parseFloat(hermana.precio) || precio) : precio;
                const r = await apiPost({ accion: "STOCK_REGISTRAR", codigo: codigoTalla, codigoBase, talla: tallaAdd, nombre: nombreConTalla, nombre_base: nb, categoria: p.categoria || "", material, precio: precioTalla, foto: img, cantidad: existencia, descripcion: desc, caracterEspecial, set_config: p.set_config || undefined, enCatalogo: hermana ? hermana.enCatalogo : undefined });
                if (fallo(r, `La talla ${tallaAdd} (${codigoTalla})`)) return;
            }
            toast(`✅ +${existencia} unidades T${tallaAdd} (${codigoTalla})`);
        } else {
            const stockActual  = stockData.find(s => s.codigo === codigoViejo);
            const bodegaActual = parseInt(stockActual?.stock_bodega || 0);
            const r = await apiPost({ accion: "STOCK_ACTUALIZAR_CANTIDADES", items: [{ codigo, stock_bodega: bodegaActual + existencia }] });
            if (fallo(r, "La cantidad")) return;
            toast(`✅ Producto actualizado y +${existencia} unidades sumadas a bodega`);
        }
    } else {
        toast("✅ Producto actualizado");
    }
    // Update local — usar codigoViejo para encontrar el índice antes de sobreescribir
    const p = productoEditando.p;
    const idx = productosDisponibles.findIndex(x => x.codigo === codigoViejo);
    p.codigo = codigo; p.nombre = nombre; p.nombre_base = nombreBaseEP; p.descripcion = desc;
    p.precio = precio; p.precioNum = precio; p.img = img; p.foto = img; p.material = material; p.caracterEspecial = caracterEspecial;
    if (cambioFoto) { p.fotoMejorada = ""; p.fotoMejoraNivel = ""; productoEditando.nuevaFoto = null; }
    if (idx >= 0) productosDisponibles[idx] = p;
    // productoEditando.p es una COPIA (no la misma referencia que stockData),
    // así que hay que reflejar el cambio ahí también — si no, la pestaña de
    // Stock se ve "sin cambios" hasta salir y volver a entrar.
    const stockIdx = stockData.findIndex(x => x.codigo === codigoViejo);
    if (stockIdx >= 0) Object.assign(stockData[stockIdx], p);
    btn.textContent = "💾 Guardar"; btn.disabled = false;
    cerrarModal("modal-ver-producto");
    renderGridEntrega(productosDisponibles);
    renderGridEtiquetas(productosDisponibles);
    filtrarStock();
    if (existencia > 0) {
        await cargarStock();
        // Refrescar productosDisponibles desde stockData actualizado (incluye nueva talla)
        await refrescarProductosEtiquetas();
        if (tallaAdd) {
            // Ir a etiquetas para imprimir la nueva talla de inmediato
            cambiarTab('etiquetas');
            // Pre-seleccionar la nueva talla en el grid de etiquetas
            const codigoTallaNueva = `${getCodigoBase(codigo)}${letraTallaEP()}T${tallaAdd}`;
            setTimeout(() => {
                const card = document.querySelector(`#grid-etiquetas [data-codigo="${codigoTallaNueva}"]`);
                if (card) { card.click(); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            }, 400);
        }
    }
}

// ── NUEVO LOTE ───────────────────────────────────────────────────────
let loteFotos = [];
let loteFotosOriginales = [];
let loteFotosFiles = [];
let loteCropCoords = [];
let loteProductos = [];

function cargarFotosLote(input) {
    const files = Array.from(input.files).slice(0, 20);
    loteFotos = []; loteFotosOriginales = []; loteFotosFiles = []; loteCropCoords = [];
    const preview = document.getElementById("lote-preview");
    preview.innerHTML = "";
    let processed = 0;

    files.forEach((file, i) => {
        loteFotosFiles[i] = file;
        procesarFotoJoya(file).then(r => {
            loteFotos[i] = r.preview;
            loteFotosOriginales[i] = r.original;
            loteCropCoords[i] = r.crop;
            const div = document.createElement("div");
            div.style.cssText = "position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;";
            div.innerHTML = `<img src="${r.preview}" style="width:100%;height:100%;object-fit:cover;">
                <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);font-size:10px;color:#fff;padding:2px;text-align:center;">${i+1}</div>`;
            preview.appendChild(div);
            processed++;
            if (processed === files.length) {
                document.getElementById("btn-analizar-lote").style.display = "flex";
            }
        });
    });
}

// Mapea lo que devuelve la IA (texto libre o código) al código de categoría del sistema
function mapCategoriaIA(cat) {
    if (!cat) return "";
    const c = String(cat).toLowerCase().trim();
    if (c === "an" || c.includes("anillo"))                          return "AN";
    if (c === "pu" || c.includes("pulser"))                          return "PU";
    if (c === "co" || (c.includes("collar") && !c.includes("cj")))  return "CO";
    if (c === "ar" || c.includes("aret"))                            return "AR";
    if (c === "cj" || c.includes("conjunto"))                        return "CJ";
    if (c === "dj" || c.includes("dije"))                            return "DJ";
    if (c === "tb" || c.includes("tobill"))                          return "TB";
    if (c === "cd" || c.includes("cadena") && c.includes("dije"))    return "CD";
    if (c === "ca" || c.includes("cadena"))                          return "CA";
    if (c === "rs" || c.includes("rosario"))                         return "RS";
    if (c === "re" || c.includes("reloj"))                           return "RE";
    return "";
}

async function analizarLote() {
    if (!loteFotos.length) return;
    document.getElementById("lote-paso1").style.display = "none";
    document.getElementById("lote-paso2").style.display = "block";
    loteProductos = loteFotos.map((foto, i) => ({ foto, fotoOriginal: loteFotosOriginales[i] || foto, fotoFile: loteFotosFiles[i] || null, fotoCrop: loteCropCoords[i] || null, nombre: "", descripcion: "", precio: "", categoria: "", analizando: true, errorIA: false, idx: i }));
    renderLoteProductos();

    let errores = 0;

    // Analizar una por una con pausa entre llamadas para evitar rate limit OpenAI
    for (let i = 0; i < loteProductos.length; i++) {
        document.getElementById("lote-progreso").textContent = `Analizando ${i+1} de ${loteProductos.length}...`;
        let intentos = 0;
        let exito = false;
        while (intentos < 3 && !exito) {
            try {
                if (intentos > 0) {
                    document.getElementById("lote-progreso").textContent = `Reintentando foto ${i+1}... (espera)`;
                    await new Promise(r => setTimeout(r, 5000 * intentos));
                }
                const res = await fetch(API_URL, {
                    method: "POST",
                    body: JSON.stringify({ accion: "ANALIZAR_IMAGEN", _pass: _sessionPass, imagen: await comprimirParaIA(loteFotos[i]), material: _materialLote })
                });
                const data = await res.json();
                if (data.ok && data.resultado) {
                    const capN = s => s ? s.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";
                    loteProductos[i].nombre            = capN(data.resultado.nombre || "");
                    loteProductos[i].descripcion       = data.resultado.descripcion       || "";
                    loteProductos[i].descripcionTienda = data.resultado.descripcion_tienda || "";
                    loteProductos[i].categoria         = mapCategoriaIA(data.resultado.categoria);
                    exito = true;
                } else if (data.error && data.error.includes("429")) {
                    intentos++;
                } else {
                    loteProductos[i].errorIA = true;
                    errores++;
                    exito = true;
                }
            } catch(e) {
                loteProductos[i].errorIA = true;
                errores++;
                exito = true;
            }
        }
        if (!exito) { loteProductos[i].errorIA = true; errores++; }
        loteProductos[i].analizando = false;
        renderLoteProductos();
        // Pausa entre fotos para no saturar la API
        if (i < loteProductos.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    const texto = errores > 0
        ? `⚠️ ${loteProductos.length - errores}/${loteProductos.length} analizados — completa los que fallaron manualmente`
        : `✅ ${loteProductos.length} productos listos — revisa y agrega precios`;
    document.getElementById("lote-progreso").textContent = texto;
}

function renderLoteProductos() {
    const lista = document.getElementById("lote-lista");
    const tallasBtns = [5,6,7,8,9,10,11,12,13,14];
    lista.innerHTML = loteProductos.map((p, i) => {
        // Estado del análisis
        let estadoHTML = "";
        if (p.analizando) {
            estadoHTML = '<div style="color:var(--dorado);font-size:12px;padding:8px 0;">⏳ Analizando...</div>';
        } else if (p.errorIA) {
            estadoHTML = '<div style="color:#e67e22;font-size:11px;margin-bottom:6px;">⚠️ IA no pudo analizar — llena manualmente</div>';
        }

        // Opciones del select de categoría
        const cats = [
            ["AN","Anillos"],["PU","Pulseras"],["CO","Collares"],["AR","Aretes"],
            ["CJ","Conjuntos"],["DJ","Dijes"],["TB","Tobilleras"],
            ["CD","Cadenas con Dije"],["CA","Cadenas solas"],["RS","Rosarios"],["RE","Relojes"]
        ];
        const opsCat = cats.map(([v,l]) =>
            '<option value="' + v + '"' + (p.categoria === v ? ' selected' : '') + '>' + l + '</option>'
        ).join('');

        // Botones de talla con cantidad individual por talla
        const mostrarTallas = (p.categoria === 'AN' || p.categoria === 'CJ');
        const esCJ = p.categoria === 'CJ';
        const tqty = p.tallasQty || {};
        const btnsTalla = tallasBtns.map(t => {
            const sel = tqty[t] !== undefined;
            const qty = tqty[t] || 1;
            if (sel) {
                // Talla seleccionada: mostrar contador - qty +
                return '<div style="display:inline-flex;align-items:center;gap:2px;background:var(--dorado);border-radius:6px;padding:2px 4px;">' +
                    '<button type="button" onclick="cambiarCantidadTalla(' + i + ',' + t + ',-1)" ' +
                    'style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">−</button>' +
                    '<span style="font-size:11px;font-weight:700;color:var(--negro);min-width:28px;text-align:center;">T' + t + '<br><span id="qty-talla-' + i + '-' + t + '" style="font-size:10px;">×' + qty + '</span></span>' +
                    '<button type="button" onclick="cambiarCantidadTalla(' + i + ',' + t + ',1)" ' +
                    'style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">+</button>' +
                    '<button type="button" onclick="toggleTallaLoteMulti(' + i + ',' + t + ')" ' +
                    'style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1;">✕</button>' +
                    '</div>';
            } else {
                // Talla no seleccionada: botón simple para agregar
                return '<button type="button" onclick="toggleTallaLoteMulti(' + i + ',' + t + ')" ' +
                    'style="padding:5px 8px;border:1px solid var(--borde);border-radius:6px;' +
                    'background:var(--gris);color:var(--blanco);font-size:11px;font-weight:600;cursor:pointer;">T' + t + '</button>';
            }
        }).join('');

        // Campos de formulario (solo cuando no está analizando)
        let camposHTML = "";
        if (!p.analizando) {
            camposHTML =
                '<input type="text" value="' + (p.nombre || '') + '" placeholder="Nombre" ' +
                'style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'oninput="loteProductos[' + i + '].nombre=this.value">' +

                '<select style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'onchange="loteProductos[' + i + '].categoria=this.value;toggleTallaLote(' + i + ',this.value)">' +
                '<option value="">-- Categoría --</option>' + opsCat + '</select>' +

                '<input type="text" value="' + (p.codigoManual || '') + '" placeholder="Código manual (opcional — se auto-genera si vacío)" ' +
                'style="margin-bottom:6px;padding:6px;font-size:11px;color:var(--plateado);font-family:sans-serif;" ' +
                'oninput="loteProductos[' + i + '].codigoManual=this.value.toUpperCase();this.value=this.value.toUpperCase()">' +

                '<div id="talla-lote-' + i + '" style="display:' + (mostrarTallas ? 'flex' : 'none') + ';flex-wrap:wrap;gap:6px;margin-bottom:4px;">' +
                '<div style="font-size:11px;color:var(--plateado);width:100%;margin-bottom:4px;">' +
                (esCJ ? 'Tallas de anillo <span style="color:#e67e22;font-size:10px;">(opcional — solo si incluye anillo)</span>' : 'Tallas <span style="color:#e74c3c;font-size:10px;">*obligatorio</span>') +
                ':</div>' +
                btnsTalla +
                '</div>' +
                (mostrarTallas ?
                '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">' +
                '<input type="number" id="talla-esp-lote-' + i + '" placeholder="Talla especial (7.5…)" step="0.5" min="4" max="15" ' +
                'style="flex:1;padding:5px 8px;font-size:11px;background:var(--gris);border:1px solid var(--borde);border-radius:6px;color:var(--blanco);">' +
                '<button type="button" onclick="agregarTallaEspecialLote(' + i + ')" ' +
                'style="padding:5px 10px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;color:var(--plateado);font-size:11px;font-weight:600;cursor:pointer;">+ Agregar</button>' +
                '</div>'
                : '') +

                '<input type="number" id="lote-precio-' + i + '" value="' + (p.precio || '') + '" placeholder="Precio $" step="0.01" ' +
                'style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'oninput="loteProductos[' + i + '].precio=this.value">' +

                '<input type="text" value="' + (p.caracterEspecial || '') + '" placeholder="Características especiales (ej: hipoalergénico, ajustable…)" ' +
                'style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'oninput="loteProductos[' + i + '].caracterEspecial=this.value">' +

                // Cantidad: si hay tallas seleccionadas mostrar total automático, si no campo editable
                (Object.keys(tqty).length > 0
                    ? '<div style="padding:6px 8px;background:var(--gris);border-radius:6px;font-size:12px;color:var(--plateado);">Total: <b style="color:var(--dorado);" id="total-tallas-' + i + '">' +
                      Object.values(tqty).reduce((s, q) => s + q, 0) +
                      ' piezas</b> <span style="font-size:10px;">(suma de tallas)</span></div>'
                    : '<input type="number" value="' + (p.cantidad || 1) + '" placeholder="Cantidad" min="1" ' +
                      'style="margin-bottom:0;padding:6px;font-size:12px;" ' +
                      'oninput="loteProductos[' + i + '].cantidad=this.value">'
                );
        }

        return '<div style="display:flex;gap:10px;padding:10px;background:var(--gris2);border-radius:10px;margin-bottom:8px;align-items:flex-start;">' +
            '<img src="' + (ikFoto(p.foto,200)||'') + '" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;">' +
            '<div style="flex:1;min-width:0;">' + estadoHTML + camposHTML + '</div>' +
            '<button onclick="eliminarDeLote(' + i + ')" style="background:rgba(192,57,43,0.2);border:none;color:#e74c3c;border-radius:6px;padding:4px 8px;cursor:pointer;flex-shrink:0;">🗑️</button>' +
            '</div>';
    }).join('');
}

function aplicarPrecioGlobal() {
    const precio = document.getElementById("lote-precio-global").value;
    if (!precio) { toast("⚠️ Ingresa un precio"); return; }
    loteProductos.forEach((p, i) => {
        p.precio = precio;
        const el = document.getElementById("lote-precio-" + i);
        if (el) el.value = precio;
    });
    toast("✅ Precio aplicado a todos");
}

function eliminarDeLote(i) {
    loteProductos.splice(i, 1);
    loteFotos.splice(i, 1);
    loteProductos.forEach((p, idx) => p.idx = idx);
    renderLoteProductos();
}

function volverLotePaso1() {
    document.getElementById("lote-paso1").style.display = "block";
    document.getElementById("lote-paso2").style.display = "none";
}

async function confirmarLote() {
    const invalidos = loteProductos.filter(p => !p.nombre || !p.precio || !p.categoria);
    if (invalidos.length) { toast("⚠️ Completa nombre, categoría y precio en todos"); return; }

    // Talla obligatoria SOLO para anillos (AN). Conjuntos (CJ) es opcional — no todos llevan anillo.
    const sinTalla = loteProductos.filter(p => p.categoria === "AN" && (!p.tallas || p.tallas.length === 0));
    if (sinTalla.length) { toast("⚠️ Selecciona al menos una talla en los anillos"); return; }

    // ── PASO 1: Generar todo localmente (instantáneo) ─────────────────
    const productosGenerados = [];
    const tareasAPI = []; // llamadas a guardar en background
    const codigosGeneradosEnLote = []; // evitar duplicados dentro del mismo lote

    for (let p of loteProductos) {
        const categoria  = p.categoria;
        const codigoBase = p.codigoManual ? p.codigoManual.trim().toUpperCase() : generarCodigo(categoria, _materialLote, codigosGeneradosEnLote);
        codigosGeneradosEnLote.push(codigoBase);

        // Construir lista de { talla, cantidad } — soporta cantidad individual por talla
        let variantes;
        if (p.tallasQty && Object.keys(p.tallasQty).length > 0) {
            // Tallas con cantidades individuales: { 7:2, 8:1, 9:2 }
            variantes = Object.entries(p.tallasQty)
                .map(([t, qty]) => ({ talla: Number(t), cantidad: Math.max(1, parseInt(qty) || 1) }))
                .sort((a, b) => a.talla - b.talla);
        } else {
            // Sin talla: una sola variante con la cantidad global
            variantes = [{ talla: null, cantidad: parseInt(p.cantidad) || 1 }];
        }

        for (let { talla, cantidad } of variantes) {
            const codigo         = aplicarTalla(codigoBase, talla);
            const nombreConTalla = aplicarTallaNombre(p.nombre, talla);
            const tallaReal      = talla && codigo === codigoBase ? "" : (talla ? String(talla) : "");

            // ── Validar duplicado ─────────────────────────────────────────────
            const existeDup = stockData.find(s => String(s.codigo).toUpperCase() === codigo.toUpperCase());
            if (existeDup) {
                toast(`⚠️ Código ${codigo} ya existe — "${existeDup.nombre}" — omitido`);
                continue; // saltar esta variante
            }

            const prod = {
                id:          codigo + "_" + Date.now(),
                codigo,
                codigoBase,
                talla:       tallaReal,
                nombre:      nombreConTalla,
                nombre_base: p.nombre,
                descripcion: p.descripcion,
                precio:      parseFloat(p.precio),
                precioNum:   parseFloat(p.precio),
                img:         p.foto,   // base64 solo en memoria para preview inmediato
                categoria,
                esNuevo:     true,
                _fotoBase64: p.fotoOriginal || p.foto,
                _fotoFile:   p.fotoFile || null,
                _fotoCrop:   p.fotoCrop || null,
                cantidad
            };

            // Guardar en localStorage SIN base64 (evitar QuotaExceededError)
            const prodParaStorage = {
                id: prod.id, codigo, codigoBase,
                talla: prod.talla, nombre: prod.nombre, nombre_base: p.nombre,
                descripcion: p.descripcion, precio: prod.precio, precioNum: prod.precio,
                img: "",           // vacío hasta que ImageKit devuelva la URL
                categoria, esNuevo: true, cantidad
            };
            try {
                const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
                const idxExistente = extras.findIndex(x => x.codigo === codigo);
                if (idxExistente >= 0) extras[idxExistente] = prodParaStorage; else extras.push(prodParaStorage);
                localStorage.setItem("vx_prod_extras", JSON.stringify(extras));
            } catch(e) { console.warn("localStorage lleno, producto solo en memoria:", codigo); }

            mapaProductos[codigo]  = prod;
            carritoEntrega[codigo] = { item: prod, qty: cantidad };
            productosGenerados.push(prod);

            // Encolar tarea para guardar en Google Sheets en background
            tareasAPI.push({
                accion:            "STOCK_REGISTRAR",
                codigo,
                codigoBase,
                talla:             prod.talla,
                nombre:            nombreConTalla,
                nombre_base:       p.nombre,
                categoria,
                material:          _materialLote || "",
                precio:            parseFloat(p.precio),
                foto:              p.foto,
                cantidad,
                descripcion:       p.descripcion,
                descripcionTienda: p.descripcionTienda || "",
                caracterEspecial:  p.caracterEspecial || ""
            });
        }
    }

    // ── PASO 2: Cerrar modal y mostrar UI inmediatamente ──────────────
    cerrarModal("modal-lote");
    renderGridEntrega(productosDisponibles);
    actualizarCarritoEntrega();
    toast("✅ " + productosGenerados.length + " productos listos — sincronizando con servidor...");

    // ── PASO 3: Background — subir fotos a ImageKit + guardar en Sheets ─
    // Orden correcto: 1° ImageKit (en paralelo) → 2° Sheets con URL real
    (async () => {
        // 3a. Subir TODAS las fotos a ImageKit en paralelo
        toast("☁️ Subiendo fotos...");
        const uploadResults = await Promise.allSettled(
            productosGenerados.map(prod =>
                subirFotoImageKit(prod._fotoFile || prod._fotoBase64, prod.codigo, prod._fotoCrop)
                    .then(url => ({ prod, url: url || null }))
                    .catch(() => ({ prod, url: null }))
            )
        );

        // 3b. Actualizar URLs en local state con la URL real de ImageKit
        const extrasActuales = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
        let cambiosStorage = false;
        uploadResults.forEach(r => {
            if (r.status !== "fulfilled") return;
            const { prod, url } = r.value;
            if (!url) return;
            prod.img = url;
            if (mapaProductos[prod.codigo])          mapaProductos[prod.codigo].img = url;
            if (carritoEntrega[prod.codigo])         carritoEntrega[prod.codigo].item.img = url;
            const idx = extrasActuales.findIndex(x => x.codigo === prod.codigo);
            if (idx >= 0) { extrasActuales[idx].img = url; cambiosStorage = true; }
        });
        // Guardar una sola vez al final (más eficiente que guardar uno por uno)
        if (cambiosStorage) {
            try { localStorage.setItem("vx_prod_extras", JSON.stringify(extrasActuales)); } catch(e) {}
        }

        // 3c. Guardar en Google Sheets con la URL real (no base64)
        // En lotes de 5 para no saturar Apps Script
        const LOTE = 5;
        let guardados = 0;
        for (let i = 0; i < tareasAPI.length; i += LOTE) {
            const grupo = tareasAPI.slice(i, i + LOTE).map(datos => {
                // Reemplazar foto con URL de ImageKit si ya se subió
                const prod = mapaProductos[datos.codigo];
                return { ...datos, foto: (prod && prod.img && !prod.img.startsWith("data:")) ? prod.img : "" };
            });
            const resultados = await Promise.allSettled(grupo.map(d => apiPost(d)));
            guardados += resultados.filter(r => r.status === "fulfilled" && r.value?.ok).length;
        }

        const total = tareasAPI.length;
        toast(guardados === total
            ? "✅ " + guardados + " productos guardados en servidor"
            : "⚠️ " + guardados + "/" + total + " guardados — revisa conexión"
        );
        cargarStock();
    })();
}

// ── STOCK NUEVO SISTEMA ──────────────────────────────────────────────
let stockData = [];
let stockSeleccionados = [];
let stockVistaGrid = false;

function toggleVistaStock() {
    stockVistaGrid = !stockVistaGrid;
    const btn = document.getElementById("btn-vista-stock");
    btn.textContent = stockVistaGrid ? "☰" : "▦";
    btn.title = stockVistaGrid ? "Vista lista" : "Vista grid";
    renderStock(stockData);
}
let _snFotoBase64 = null;
let _snMaterial = null;
let _snTalla = null;

async function cargarStock() {
    document.getElementById("lista-stock").innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await apiPost({ accion: "STOCK_GET_ALL" });
        stockData = res.stock || [];
        poblarFiltroMaterial();
        poblarFiltroCategoria();
        renderStock(stockData);
    } catch(e) {
        document.getElementById("lista-stock").innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ Error cargando stock</p>';
    }
}

// Arma el link largo de siempre (/p/COD,COD?exp=...) y, si se puede, lo
// cambia por uno corto (/l/ID) pidiéndoselo a save-plink.js — con 10+ piezas
// seleccionadas el link largo queda larguísimo y feo para publicar en un
// Estado de WhatsApp. Si save-plink falla (sin red, endpoint caído), se
// sigue compartiendo el link largo tal cual, para no bloquear el flujo.
async function _armarLinkProducto(codigo, exp, desc, afiliado, telefono) {
    const wa = telefono ? encodeURIComponent(String(telefono).replace(/\D/g,"")) : "";
    // OJO: no usar encodeURIComponent() sobre la coma que separa códigos —
    // la convertiría en %2C y la función de Cloudflare ya no podría separarlos.
    const linkLargo = "https://admin-tienda.pages.dev/p/" + codigo + "?exp=" + exp
        + (afiliado ? "&af=" + afiliado : "")
        + (wa ? "&wa=" + wa : "")
        + (desc > 0 ? "&desc=" + desc : "");
    try {
        const res = await fetch("https://admin-tienda.pages.dev/save-plink", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _pass: _sessionPass, codigo, exp, desc, af: afiliado, wa })
        });
        const data = await res.json();
        if (data.id) return "https://admin-tienda.pages.dev/l/" + data.id;
    } catch (_) {}
    return linkLargo;
}

function compartirProducto(codigo) {
    stockSeleccionados = [codigo];
    abrirModalCompartir();
}

// Igual que compartirProducto() pero para varios productos seleccionados a la
// vez — mismo link, con los códigos separados por coma, para no tener que
// mandar un link distinto por cada pieza que le interese al cliente.
function compartirSeleccionados() {
    if (!stockSeleccionados.length) return;
    abrirModalCompartir();
}

// Estado del modal "Promocionar" — vigencia y % de descuento elegidos con
// chips en vez de los prompt() de antes.
let _mcVigenciaDias = 3;
let _mcDescuentoPct = 0;

function _mcSetVigencia(dias, btn) {
    _mcVigenciaDias = dias;
    btn.parentElement.querySelectorAll(".mc-chip").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
}

function _mcSetDescuento(pct, btn) {
    _mcDescuentoPct = pct;
    document.getElementById("mc-desc-custom").value = "";
    btn.parentElement.querySelectorAll(".mc-chip").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
    _mcActualizarPreview();
}

function _mcDescuentoCustom(input) {
    const pct = Math.min(90, Math.max(0, parseInt(input.value) || 0));
    _mcDescuentoPct = pct;
    document.querySelectorAll("#mc-descuento .mc-chip").forEach(b => b.classList.remove("activo"));
    _mcActualizarPreview();
}

// Arma nombre/descripción/foto del preview con la MISMA lógica que
// adminverex/functions/_plink-render.js usa del lado servidor al abrir el
// link — así lo que el admin ve acá es igual a lo que le va a llegar al
// cliente en WhatsApp.
function _mcActualizarPreview() {
    const codigos = stockSeleccionados;
    const primero = stockData.find(s => s.codigo === codigos[0]);
    if (!primero) return;

    const basesUnicas = new Set(codigos.map(c => {
        const s = stockData.find(x => x.codigo === c);
        return getCodigoBase(s ? s.codigo : c);
    }));
    const extra = basesUnicas.size - 1;

    let nombre = (primero.nombre_base || primero.nombre || "Producto VEREX").trim();
    if (extra > 0) nombre += ` + ${extra} producto${extra > 1 ? "s" : ""} más`;

    let descripcion = "La expresión de tu mejor versión";
    if (_mcDescuentoPct > 0) {
        descripcion = extra > 0
            ? `🔥 ${_mcDescuentoPct}% OFF en ${basesUnicas.size} diseños seleccionados · Oferta por tiempo limitado`
            : (() => {
                const antes = parseFloat(primero.precio || primero.precioNum) || 0;
                const ahora = Math.round(antes * (1 - _mcDescuentoPct / 100) * 100) / 100;
                return `🔥 ${_mcDescuentoPct}% OFF — antes $${antes.toFixed(2)} ahora $${ahora.toFixed(2)}`;
              })();
    }

    document.getElementById("mc-preview-nombre").textContent = nombre + " · VEREX";
    document.getElementById("mc-preview-desc").textContent = descripcion;
    const foto = document.getElementById("mc-preview-foto");
    if (primero.foto) { foto.src = ikFoto(primero.foto, 300); foto.style.display = "block"; }
    else { foto.style.display = "none"; }
}

// Abre el modal "Promocionar" para los códigos ya puestos en
// stockSeleccionados (uno solo, o varios elegidos en Stock).
function abrirModalCompartir() {
    if (!stockSeleccionados.length) return;
    _mcVigenciaDias = 3;
    _mcDescuentoPct = 0;

    document.getElementById("mc-titulo").textContent =
        stockSeleccionados.length === 1 ? "Promocionar producto" : `Promocionar ${stockSeleccionados.length} productos`;

    const vistos = new Set();
    const miniaturas = stockSeleccionados.map(cod => {
        const item = stockData.find(s => s.codigo === cod);
        if (!item) return "";
        const base = getCodigoBase(item.codigo);
        if (vistos.has(base)) return "";
        vistos.add(base);
        const foto = item.foto ? sanitizar(ikFoto(item.foto, 100)) : "";
        return `<div style="width:44px;height:44px;border-radius:8px;overflow:hidden;background:var(--gris2);flex-shrink:0;">${foto ? `<img src="${foto}" style="width:100%;height:100%;object-fit:cover;">` : ""}</div>`;
    }).join("");
    document.getElementById("mc-productos").innerHTML = miniaturas;

    const selAfiliado = document.getElementById("mc-afiliado");
    const afiliados = (vendedores || []).filter(v => v.tipo === "afiliado" || v.tipo === "hibrido");
    selAfiliado.innerHTML = '<option value="">Ninguno — venta directa</option>' +
        afiliados.map(v => `<option value="${sanitizar(v.codigo)}" data-tel="${sanitizar(v.telefono || "")}">${sanitizar(v.nombre)}</option>`).join("");

    document.querySelectorAll("#mc-vigencia .mc-chip").forEach(b => b.classList.toggle("activo", b.dataset.dias === "3"));
    document.querySelectorAll("#mc-descuento .mc-chip").forEach(b => b.classList.toggle("activo", b.dataset.pct === "0"));
    document.getElementById("mc-desc-custom").value = "";

    _mcActualizarPreview();
    abrirModal("modal-compartir");
}

// Arma el link (corto si save-plink responde, largo si no) con lo elegido en
// el modal — mismo helper que usaba el flujo de prompt() de antes.
async function _mcObtenerLink() {
    const exp = Date.now() + _mcVigenciaDias * 86400000;
    const selAfiliado = document.getElementById("mc-afiliado");
    const opt = selAfiliado.selectedOptions[0];
    const afiliado = selAfiliado.value;
    const telefono = opt ? opt.dataset.tel : "";
    const codigos = stockSeleccionados.join(",");
    return _armarLinkProducto(codigos, exp, _mcDescuentoPct, afiliado, telefono);
}

async function _mcCompartirWhatsApp(btn) {
    const original = btn.textContent;
    btn.textContent = "Generando…"; btn.disabled = true;
    try {
        const link = await _mcObtenerLink();
        const nombre = document.getElementById("mc-preview-nombre").textContent.replace(" · VEREX", "");
        const texto = `Mira ${stockSeleccionados.length > 1 ? "estas piezas" : "esta pieza"} de VEREX 😍\n${nombre}\n${link}`;
        window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank");
        cerrarModal("modal-compartir");
    } finally {
        btn.textContent = original; btn.disabled = false;
    }
}

async function _mcCopiarLink(btn) {
    btn.disabled = true;
    try {
        const link = await _mcObtenerLink();
        navigator.clipboard.writeText(link).then(() => {
            toast("🔗 Link copiado al portapapeles");
        }).catch(() => {
            prompt("Link copiado — pégalo donde lo necesites compartir:", link);
        });
        cerrarModal("modal-compartir");
    } finally {
        btn.disabled = false;
    }
}

// Nota «código corregido» en la tarjeta del producto: avisa que hay que cambiar la etiqueta física.
function notaCodigoCorregido(g) {
    const pend = (g.items || []).filter(i => i.etiquetaPendiente && i.codigoAnterior);
    if (!pend.length) return "";
    const antes = getCodigoBase(pend[0].codigoAnterior), ahora = getCodigoBase(pend[0].codigo), cods = pend.map(i => i.codigo);
    return `<div onclick="event.stopPropagation()" style="margin:5px 0;padding:6px 8px;border-radius:8px;background:rgba(245,158,11,.14);border:1px solid #f59e0b;color:#fcd34d;font-size:11px;line-height:1.4;">
        🏷️ <b>CÓDIGO CORREGIDO</b><br>Antes <b>${sanitizar(antes)}</b> → ahora <b>${sanitizar(ahora)}</b><br>Cambia la etiqueta física de ${pend.length > 1 ? "las " + pend.length + " tallas" : "la pieza"}.
        <button onclick="event.stopPropagation();marcarEtiquetaCambiada(${jsArgArr(cods)})" style="display:block;margin-top:5px;padding:4px 8px;font-size:11px;font-weight:700;background:#f59e0b;color:#111;border:none;border-radius:6px;cursor:pointer;">✓ Etiqueta ya cambiada</button></div>`;
}
// Alerta en la tarjeta: un par/trío (tiene tallas D de dama y C/H de caballero) con alguna talla
// SIN la letra D/C/H en el código (ej. ANP311T11). Se cuenta como pieza aparte y el catálogo no la reconoce.
function notaCodigoSinLetra(g) {
    const cods = (g.items || []).map(i => String(i.codigo || ""));
    const conLetra = L => cods.some(c => new RegExp("[\\dB]" + L + "T\\d+(\\.\\d+)?$", "i").test(c));
    if (!(conLetra("D") && conLetra("[CH]"))) return "";
    const sueltas = cods.filter(c => /\dT\d+(\.\d+)?$/i.test(c));
    if (!sueltas.length) return "";
    return `<div onclick="event.stopPropagation()" style="margin:5px 0;padding:6px 8px;border-radius:8px;background:rgba(245,158,11,.14);border:1px solid #f59e0b;color:#fcd34d;font-size:11px;line-height:1.4;">
        ⚠️ <b>Falta D o C en el código</b><br>${sueltas.map(c => "<b>" + sanitizar(c) + "</b>").join(", ")} no dice si es dama (D) o caballero (C). Se cuenta como una pieza extra. Corrígelo con ✏️.
    </div>`;
}
async function marcarEtiquetaCambiada(codigos) {
    try {
        const r = await apiPost({ accion: "MARCAR_ETIQUETA_CAMBIADA", codigos });
        if (!r || !r.ok) throw new Error((r && r.error) || "no se pudo guardar");
        for (const c of codigos) { const it = stockData.find(p => p.codigo === c); if (it) it.etiquetaPendiente = false; }
        try { filtrarStock(); } catch (_) { renderStock(stockData); }
        toast("✅ Etiqueta marcada como cambiada", "#22c55e");
    } catch (e) { toast("⚠️ " + (e.message || e), "#ef4444"); }
}

// Si la foto guardada no carga (archivo borrado, subida incompleta…), la tarjeta muestra un aviso en vez de quedar sin imagen.
function fotoNoDisponible(img) {
    const d = document.createElement("div");
    d.title = "La foto no está disponible: usa ✏️ para subir otra (el código y el nombre identifican el producto)";
    d.style.cssText = "width:64px;height:64px;flex-shrink:0;border:1px dashed #C9A84C;border-radius:8px;background:#3a3a3c;color:#C9A84C;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;line-height:1.1;text-align:center;";
    d.innerHTML = '📷<span style="font-size:8px;font-weight:700;letter-spacing:.5px;margin-top:2px;">SIN FOTO</span>';
    img.replaceWith(d);
}
function renderStock(items) {
    if (!items) items = stockData;
    if (!items) return;
    // KPIs
    document.getElementById("sk-total").textContent   = items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0) + (parseInt(i.stock_tienda)||0) + (parseInt(i.stock_consignacion)||0), 0);
    document.getElementById("sk-bodega").textContent  = items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0), 0);
    document.getElementById("sk-tienda").textContent  = items.reduce((s,i) => s + (parseInt(i.stock_tienda)||0), 0);
    document.getElementById("sk-cons").textContent    = items.reduce((s,i) => s + (parseInt(i.stock_consignacion)||0), 0);
    document.getElementById("sk-reservado").textContent = items.reduce((s,i) => s + (parseInt(i.sstock_reservado||i.stock_reservado)||0), 0);

    // Ordenar: más nuevos primero (por fecha_registro descendente)
    items = [...items].sort((a, b) => {
        const fa = new Date(a.fecha_registro || a.fechaRegistro || 0).getTime();
        const fb = new Date(b.fecha_registro || b.fechaRegistro || 0).getTime();
        return fb - fa;
    });

    // Mismo esquema de color del badge de material que ya usa el catálogo
    // público — para que se identifique de un vistazo también en Stock.
    const colorMaterial = m => {
        const s = String(m||"").toLowerCase();
        if (s.includes("acero")) return { bg:"rgba(59,130,246,0.15)", border:"#3b82f6", color:"#93c5fd" };
        if (s.includes("oro"))   return { bg:"rgba(234,179,8,0.15)",  border:"#eab308", color:"#fcd34d" };
        if (s.includes("plata")) return { bg:"rgba(148,163,184,0.15)",border:"#94a3b8", color:"#cbd5e1" };
        return { bg:"rgba(201,168,76,0.12)", border:"rgba(201,168,76,0.3)", color:"#C9A84C" };
    };

    const lista = document.getElementById("lista-stock");
    if (!items.length) {
        lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay productos en stock. Usa "+ Agregar" para registrar piezas.</p>';
        return;
    }

    const estadoColor = {
        "bodega":       { bg: "rgba(74,111,165,0.2)", color: "#4a6fa5", label: "🏠 Bodega" },
        "tienda":       { bg: "rgba(45,122,79,0.2)",  color: "#4caf82", label: "🛍️ Tienda" },
        "consignacion": { bg: "rgba(201,168,76,0.2)", color: "var(--dorado)", label: "👤 Consignación" },
        "reservado":    { bg: "rgba(231,76,60,0.2)",  color: "#e74c3c", label: "⏳ Reservado" },
        "vendido":      { bg: "rgba(100,100,100,0.2)", color: "#888", label: "✅ Vendido" },
    };

    // Agrupar por diseño (mismo codigoBase) para no repetir una fila por cada
    // talla — un anillo con 3 tallas ocupa 1 tarjeta con 3 chips en vez de 3
    // filas completas. Tocar un chip expande los botones de esa talla exacta
    // (editar/compartir/reservar/mover/eliminar), sin perder nada de lo que
    // ya se podía hacer por fila.
    // La 2da pieza de dama de un trío se registra con el codigoBase + "B"
    // (ej. ANL106B) para poder distinguirla físicamente de la primera pieza
    // — pero para el AGRUPADO visual sigue siendo el mismo diseño/trío, así
    // que aquí se le quita esa "B" final para que caiga en el mismo grupo.
    const grupos = new Map();
    items.forEach(item => {
        const base = item.codigoBase || item.codigo;
        const key = base.replace(/^(.+\d)B$/, "$1");
        if (!grupos.has(key)) grupos.set(key, { key, nombre: item.nombre_base || item.nombre, material: item.material, caracterEspecial: item.caracterEspecial, foto: item.foto, fotoMejorada: item.fotoMejorada || "", categoria: item.categoria, items: [] });
        const g = grupos.get(key);
        g.items.push(item);
        if (!g.caracterEspecial && item.caracterEspecial) g.caracterEspecial = item.caracterEspecial;
        // Preferir el nombre/foto de la pieza "base" (sin la B) para el
        // encabezado del grupo, si la B llegó primero por orden de fecha.
        if (base === key) { g.nombre = item.nombre_base || item.nombre; g.foto = item.foto || g.foto; }
        // Foto "mejorada" (nitidez, botón ✨) — se muestra en vez de la
        // original cuando existe, sin sobrescribirla nunca.
        if (!g.fotoMejorada && item.fotoMejorada) g.fotoMejorada = item.fotoMejorada;
    });

    // ── Vista grid: mismo agrupado por diseño, una tarjeta por grupo con
    // chips de talla en vez de una tarjeta por cada talla individual ────────
    if (stockVistaGrid) {
        lista.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">` +
        [...grupos.values()].map(g => {
            const codigos = g.items.map(i => i.codigo);
            const selAll = codigos.every(c => stockSeleccionados.includes(c));
            const totalBodega = g.items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0), 0);
            const totalTienda = g.items.reduce((s,i) => s + (parseInt(i.stock_tienda)||0), 0);
            const totalConsig = g.items.reduce((s,i) => s + (parseInt(i.stock_consignacion)||0), 0);
            const totalPiezas = totalBodega + totalTienda + totalConsig;
            const agotadoGrupo = totalPiezas === 0;
            const piezasUnicas = new Map();
            g.items.forEach(item => {
                const piezaKey = String(item.codigo).replace(/\d+(\.\d+)?$/, "") || item.codigo;
                if (!piezasUnicas.has(piezaKey)) piezasUnicas.set(piezaKey, item);
            });
            const precioTotal = [...piezasUnicas.values()].reduce((s,it) => s + parseFloat(it.precio||0), 0);
            const activo = g.items[0];
            const chips = g.items.map((item, idx) => {
                const total = (parseInt(item.stock_bodega)||0) + (parseInt(item.stock_tienda)||0) + (parseInt(item.stock_consignacion)||0);
                const label = item.talla ? `T${sanitizar(item.talla)}` : sanitizar(item.codigo);
                return `<span class="grid-chip-talla" data-codigo="${sanitizar(item.codigo)}" onclick="event.stopPropagation();_stockGridActivarTalla(this,${jsArg(item.codigo)})" title="${sanitizar(item.codigo)} · ${total} en stock" style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;cursor:pointer;background:${total===0?'rgba(136,136,136,0.15)':'rgba(52,211,153,0.15)'};border:1px solid ${idx===0?'var(--dorado)':(total===0?'#666':'#34D399')};color:${total===0?'#888':'#34D399'};">${label}${total>0?` ×${total}`:''}</span>`;
            }).join('');
            return `<div data-grupo="${sanitizar(g.key)}" data-activo="${sanitizar(activo.codigo)}" onclick="toggleSeleccionGrupo(${jsArgArr(codigos)})" style="background:#2C2C2E;border:${selAll?"2px solid var(--dorado)":"1px solid var(--dorado)"};border-radius:12px;overflow:hidden;cursor:pointer;position:relative;">
                <div onclick="event.stopPropagation();toggleSeleccionGrupo(${jsArgArr(codigos)})" style="position:absolute;top:6px;left:6px;width:18px;height:18px;border:2px solid ${selAll?"var(--dorado)":"#666"};border-radius:4px;background:${selAll?"var(--dorado)":"rgba(0,0,0,0.5)"};display:flex;align-items:center;justify-content:center;font-size:11px;z-index:2;">${selAll?"✓":""}</div>
                <div style="width:100%;aspect-ratio:1;background:#1a1a1a;overflow:hidden;">
                    ${g.foto ? `<img src="${sanitizar(ikFoto(g.fotoMejorada||g.foto,300))}" onerror="fotoNoDisponible(this)" style="width:100%;height:100%;object-fit:cover;">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;">💍</div>`}
                </div>
                <div style="padding:7px 8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="color:#FF9500;font-size:10px;font-weight:700;">${sanitizar(g.key)}</div>
                        <div style="color:#34D399;font-size:11px;font-weight:700;">$${precioTotal.toFixed(2)}</div>
                    </div>
                    <div style="color:#fff;font-size:11px;font-weight:600;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(g.nombre)}</div>
                    ${notaCodigoCorregido(g)}${notaCodigoSinLetra(g)}
                    ${g.material ? `<div style="display:inline-block;font-size:9px;font-weight:700;margin-bottom:3px;background:${colorMaterial(g.material).bg};border:1px solid ${colorMaterial(g.material).border};color:${colorMaterial(g.material).color};border-radius:4px;padding:1px 6px;">${sanitizar(g.material)}</div>` : ''}
                    ${g.caracterEspecial ? `<div style="display:inline-block;font-size:9px;font-weight:700;margin-bottom:3px;margin-left:3px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);color:#c9a8ff;border-radius:4px;padding:1px 6px;" title="Característica especial">✨ ${sanitizar(g.caracterEspecial)}</div>` : ''}
                    ${agotadoGrupo
                        ? '<div style="text-align:center;font-size:11px;font-weight:700;color:#fff;background:#C0392B;border-radius:6px;padding:3px 4px;margin-top:4px;letter-spacing:1px;">AGOTADO</div>'
                        : `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px;font-size:9px;color:#666;margin-top:2px;"><span>🏠 Bodega:<b style="color:#fff"> ${totalBodega}</b></span><span>🛍️ Tienda:<b style="color:#34D399"> ${totalTienda}</b></span><span>👤 Consig.:<b style="color:var(--dorado)"> ${totalConsig}</b></span></div>`}
                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${chips}</div>
                    <div style="display:flex;gap:4px;margin-top:6px;position:relative;" data-grupo-botones="${sanitizar(g.key)}">
                        <button onclick="event.stopPropagation();abrirEditarStockItem(_stockGridCodActivo(this))" style="flex:1;padding:4px 0;font-size:10px;background:#5AC8FA;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:600;">✏️</button>
                        <button onclick="event.stopPropagation();compartirProducto(_stockGridCodActivo(this))" style="flex:1;padding:4px 0;font-size:10px;background:#25D366;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;" title="Compartir la talla activa">🔗</button>
                        <button onclick="event.stopPropagation();toggleReservaStock(_stockGridCodActivo(this))" style="flex:1;padding:4px 0;font-size:10px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;" title="Reservar/liberar la talla activa">🔒</button>
                        <button onclick="event.stopPropagation();_stockGridToggleMover(this)" style="flex:2;padding:4px 6px;font-size:10px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">⇄ Mover ▾</button>
                        <button onclick="event.stopPropagation();imprimirEtiquetaStock(_stockGridCodActivo(this))" title="Imprimir etiqueta de la talla activa" style="flex:1;padding:4px 0;font-size:12px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️</button>
                        <div class="menu-mover-grid" style="display:none;position:absolute;bottom:30px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArgArr(codigos)},'tienda')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4caf82;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;" title="Mueve todas las tallas en existencia de este diseño">🛍️ Enviar todo a Tienda</button>
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArgArr(codigos)},'bodega')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4a6fa5;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;" title="Mueve todas las tallas en existencia de este diseño">📦 Devolver todo a Bodega</button>
                            <button onclick="event.stopPropagation();moverItemDirectoVendedor(${jsArgArr(codigos)})" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:var(--dorado);border:none;cursor:pointer;text-align:left;font-weight:600;" title="Asigna todas las tallas en existencia de este diseño">👤 Asignar todo a Vendedor</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('') + `</div>`;
        return;
    }

    lista.innerHTML = [...grupos.values()].map(g => {
        const codigos = g.items.map(i => i.codigo);
        const selAll = codigos.every(c => stockSeleccionados.includes(c));
        const totalBodega = g.items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0), 0);
        const totalTienda = g.items.reduce((s,i) => s + (parseInt(i.stock_tienda)||0), 0);
        const totalConsig = g.items.reduce((s,i) => s + (parseInt(i.stock_consignacion)||0), 0);
        const totalPiezas = totalBodega + totalTienda + totalConsig;
        const agotadoGrupo = totalPiezas === 0;
        const nUltimas  = g.items.filter(i => { const t=(parseInt(i.stock_bodega)||0)+(parseInt(i.stock_tienda)||0)+(parseInt(i.stock_consignacion)||0); return t>0 && (parseInt(i.stock_bodega)||0)<=1; }).length;
        const nAgotadas = g.items.filter(i => ((parseInt(i.stock_bodega)||0)+(parseInt(i.stock_tienda)||0)+(parseInt(i.stock_consignacion)||0))===0).length;

        // El precio a mostrar es la suma de las piezas DISTINTAS del set (no
        // por talla). OJO: dama y caballero comparten el mismo codigoBase en
        // un par/trío normal (solo la 2da pieza de dama usa uno con "B"), así
        // que agrupar por codigoBase los contaría como una sola pieza — hay
        // que usar el código completo SIN la talla para distinguir cada
        // pieza física real (ej. "ANL106DT8" y "ANL106CT11" son piezas
        // distintas aunque compartan codigoBase "ANL106").
        const piezasUnicas = new Map();
        g.items.forEach(item => {
            const piezaKey = String(item.codigo).replace(/\d+(\.\d+)?$/, "") || item.codigo;
            if (!piezasUnicas.has(piezaKey)) piezasUnicas.set(piezaKey, item);
        });
        const precioTotal = [...piezasUnicas.values()].reduce((s,it) => s + parseFloat(it.precio||0), 0);
        const nPiezas = piezasUnicas.size;

        const stat = (label, valor, color) => `<div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px 10px;text-align:center;flex:1;min-width:70px;">
            <div style="font-size:16px;font-weight:700;color:${color};">${valor}</div>
            <div style="font-size:9px;color:#888;font-weight:600;">${label}</div>
        </div>`;
        const statsRow = `<div style="display:flex;gap:6px;margin-top:8px;">
            ${stat("Stock total", totalPiezas, "#fff")}
            ${stat("Tallas", g.items.length, "#fff")}
            ${stat("Últimas uds.", nUltimas, nUltimas>0?"#e74c3c":"#666")}
            ${stat("Agotados", nAgotadas, nAgotadas>0?"#888":"#666")}
        </div>`;

        // Cada talla mantiene sus botones completos y SIEMPRE visibles, ahora
        // en formato tabla — más compacto que las tarjetas apiladas de antes.
        const filas = g.items.map(item => {
            const estadoNorm = item.reservado ? "reservado" : normalizar(item.estado);
            const est = estadoColor[estadoNorm] || estadoColor["bodega"];
            const total = (parseInt(item.stock_bodega)||0) + (parseInt(item.stock_tienda)||0) + (parseInt(item.stock_consignacion)||0);
            const bajo = total > 0 && (parseInt(item.stock_bodega)||0) <= 1;
            const label = item.talla ? `T${sanitizar(item.talla)}` : "—";
            const estadoTxt = total===0 ? "Agotado" : bajo ? "Última unidad" : "Disponible";
            const estadoColorTxt = total===0 ? "#888" : bajo ? "#e74c3c" : "#34D399";
            return `<tr style="border-top:1px solid #333;">
                <td style="padding:7px 6px;font-size:12px;font-weight:700;color:#FF9500;">${label}</td>
                <td style="padding:7px 6px;font-size:11px;color:#aaa;">${sanitizar(item.codigo)}</td>
                <td style="padding:7px 6px;font-size:12px;text-align:center;color:#fff;">${item.stock_bodega||0}</td>
                <td style="padding:7px 6px;font-size:12px;text-align:center;color:#34D399;">${item.stock_tienda||0}</td>
                <td style="padding:7px 6px;font-size:12px;text-align:center;color:var(--dorado);">${item.stock_consignacion||0}</td>
                <td style="padding:7px 6px;font-size:11px;font-weight:600;color:${estadoColorTxt};white-space:nowrap;">${estadoTxt}</td>
                <td style="padding:7px 6px;">
                    <div style="display:flex;gap:4px;justify-content:flex-end;position:relative;">
                        <button onclick="event.stopPropagation();abrirEditarStockItem(${jsArg(item.codigo)})" title="Editar" style="width:26px;height:26px;padding:0;font-size:12px;background:#5AC8FA;color:#111;border:none;border-radius:6px;cursor:pointer;">✏️</button>
                        <button onclick="event.stopPropagation();compartirProducto(${jsArg(item.codigo)})" title="Compartir" style="width:26px;height:26px;padding:0;font-size:12px;background:#25D366;color:#fff;border:none;border-radius:6px;cursor:pointer;">🔗</button>
                        <button onclick="event.stopPropagation();toggleReservaStock(${jsArg(item.codigo)})" title="${item.reservado?"Liberar":"Reservar"}" style="width:26px;height:26px;padding:0;font-size:12px;background:${item.reservado?"#e74c3c":"#4a4a4e"};color:#fff;border:none;border-radius:6px;cursor:pointer;">${item.reservado?"🔓":"🔒"}</button>
                        <button onclick="event.stopPropagation();toggleMenuMover(${jsArg(item.codigo)},this)" title="Mover" style="width:26px;height:26px;padding:0;font-size:12px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;">⇄</button>
                        <button onclick="event.stopPropagation();corregirCantidadExactaStock(${jsArg(item.codigo)})" title="Corregir cantidad exacta (bodega/tienda/consignación)" style="width:26px;height:26px;padding:0;font-size:12px;background:#e8b07a;color:#111;border:none;border-radius:6px;cursor:pointer;">⚖️</button>
                        <button onclick="event.stopPropagation();eliminarStockItem(${jsArg(item.codigo)})" title="Eliminar" style="width:26px;height:26px;padding:0;font-size:12px;background:#FF453A;color:#fff;border:none;border-radius:6px;cursor:pointer;">🗑️</button>
                        <button onclick="event.stopPropagation();imprimirEtiquetaStock(${jsArg(item.codigo)})" title="${estaEtiquetaImpresa(item.codigo)?'Etiqueta impresa — clic para desmarcar':'Imprimir etiqueta'}" style="width:26px;height:26px;padding:0;font-size:12px;background:${estaEtiquetaImpresa(item.codigo)?'#22c55e':'#4a4a4e'};color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️</button>
                        <div id="menu-mover-${sanitizar(item.codigo)}" style="display:none;position:absolute;top:30px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArg(item.codigo)},'tienda')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4caf82;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🛍️ Enviar a Tienda</button>
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArg(item.codigo)},'bodega')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4a6fa5;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">📦 Devolver a Bodega</button>
                            <button onclick="event.stopPropagation();moverItemDirectoVendedor(${jsArg(item.codigo)})" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:var(--dorado);border:none;cursor:pointer;text-align:left;font-weight:600;">👤 Asignar a Vendedor</button>
                        </div>
                    </div>
                </td>
            </tr>`;
        }).join('');

        const detalles = `<div style="overflow-x:auto;margin-top:8px;">
            <table style="width:100%;border-collapse:collapse;min-width:480px;">
                <thead><tr style="text-align:left;">
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;">Talla</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;">Código</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:center;"><span style="font-size:16px;">🏠</span> Bodega</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:center;"><span style="font-size:16px;">🛍️</span> Tienda</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:center;"><span style="font-size:16px;">🪙</span> Consig.</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;">Estado</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:right;">Acciones</th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;

        return `<div class="inv-item" style="background:#2C2C2E;border-color:var(--dorado);cursor:pointer;flex-direction:column;align-items:stretch;padding:10px 12px;" onclick="toggleSeleccionGrupo(${jsArgArr(codigos)})">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:18px;height:18px;border:2px solid ${selAll?"var(--dorado)":"#555"};border-radius:4px;background:${selAll?"var(--dorado)":"transparent"};display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;">
                    ${selAll ? "✓" : ""}
                </div>
                ${g.foto ? `<img src="${sanitizar(ikFoto(g.fotoMejorada||g.foto,200))}" onerror="fotoNoDisponible(this)" onclick="event.stopPropagation();abrirFotoZoom(${jsArg(g.fotoMejorada||g.foto)},${jsArg(g.nombre)})" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;cursor:zoom-in;background:#3a3a3c;">` : '<div style="width:64px;height:64px;background:#3a3a3c;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">💍</div>'}
                <div style="flex:1;min-width:0;">
                    <div style="color:#fff;font-size:14px;font-weight:600;">${sanitizar(g.nombre)}</div>
                    ${notaCodigoCorregido(g)}${notaCodigoSinLetra(g)}
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;">
                        ${g.material ? `<span style="font-size:10px;font-weight:700;color:${colorMaterial(g.material).color};background:${colorMaterial(g.material).bg};border:1px solid ${colorMaterial(g.material).border};border-radius:4px;padding:1px 7px;">${sanitizar(g.material)}</span>` : ''}
                        ${g.caracterEspecial ? `<span style="font-size:10px;font-weight:700;color:#c9a8ff;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);border-radius:4px;padding:1px 7px;" title="Característica especial">✨ ${sanitizar(g.caracterEspecial)}</span>` : ''}
                        ${agotadoGrupo ? '<span style="font-size:10px;font-weight:700;color:#fff;background:#C0392B;border-radius:6px;padding:2px 8px;letter-spacing:1px;">AGOTADO</span>' : ''}
                    </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:15px;color:#34D399;font-weight:700;">$${precioTotal.toFixed(2)}</div>
                    ${nPiezas > 1 ? `<div style="font-size:9px;color:#888;font-weight:600;">${nPiezas} pieza${nPiezas>2?'s':''}</div>` : ''}
                    <div style="color:#FF9500;font-size:11px;font-weight:700;margin-top:2px;">${sanitizar(g.key)}${g.categoria?` · ${sanitizar(g.categoria)}`:''}</div>
                </div>
            </div>
            <div onclick="event.stopPropagation();">
                <div style="display:flex;justify-content:flex-end;margin:2px 0 6px;position:relative;">
                    <button onclick="_stockGridToggleMover(this)" style="padding:5px 10px;font-size:11px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;" title="Mueve todas las tallas en existencia de este diseño">⇄ Mover grupo completo ▾</button>
                    <div class="menu-mover-grid" style="display:none;position:absolute;top:30px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                        <button onclick="moverItemDirecto(${jsArgArr(codigos)},'tienda')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4caf82;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🛍️ Enviar todo a Tienda</button>
                        <button onclick="moverItemDirecto(${jsArgArr(codigos)},'bodega')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4a6fa5;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">📦 Devolver todo a Bodega</button>
                        <button onclick="moverItemDirectoVendedor(${jsArgArr(codigos)})" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:var(--dorado);border:none;cursor:pointer;text-align:left;font-weight:600;">👤 Asignar todo a Vendedor</button>
                    </div>
                </div>
                ${statsRow}${detalles}
            </div>
        </div>`;
    }).join('');
}

// Vista grid: cada tarjeta agrupada guarda en data-activo el código de la
// talla sobre la que actúan los botones (editar/compartir/reservar/mover/
// imprimir) — por defecto la primera, y cambia al tocar un chip de talla.
function _stockGridActivarTalla(chipEl, codigo) {
    const card = chipEl.closest('[data-grupo]');
    if (!card) return;
    card.dataset.activo = codigo;
    card.querySelectorAll('.grid-chip-talla').forEach(c => {
        c.style.borderColor = (c.dataset.codigo === codigo) ? 'var(--dorado)' : (c.style.color === 'rgb(136, 136, 136)' ? '#666' : '#34D399');
    });
}
function _stockGridCodActivo(el) {
    const card = el.closest('[data-grupo]');
    return card ? card.dataset.activo : '';
}
function _stockGridToggleMover(btn) {
    const menu = btn.parentElement.querySelector('.menu-mover-grid');
    document.querySelectorAll('.menu-mover-grid').forEach(m => { if (m !== menu) m.style.display = 'none'; });
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function toggleSeleccionGrupo(codigos) {
    const todosSel = codigos.every(c => stockSeleccionados.includes(c));
    codigos.forEach(c => {
        const idx = stockSeleccionados.indexOf(c);
        if (todosSel) { if (idx >= 0) stockSeleccionados.splice(idx, 1); }
        else { if (idx < 0) stockSeleccionados.push(c); }
    });
    const accionesDiv = document.getElementById("stock-acciones");
    const countEl = document.getElementById("stock-sel-count");
    if (stockSeleccionados.length > 0) {
        accionesDiv.style.display = "flex";
        const header = document.querySelector(".header");
        accionesDiv.style.top = (header?.offsetHeight || 60) + "px";
        countEl.textContent = stockSeleccionados.length + " seleccionado" + (stockSeleccionados.length > 1 ? "s" : "");
    } else {
        accionesDiv.style.display = "none";
    }
    filtrarStock();
}

function selMatEdit(btn) {
    document.querySelectorAll(".ep-mat-btn").forEach(b => b.style.outline = "");
    btn.style.outline = "2px solid var(--dorado)";
}

function selSetSN(btn) {
    document.querySelectorAll(".sn-set-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; b.classList.remove("selected"); });
    btn.style.background = "var(--dorado)"; btn.style.color = "#111"; btn.style.borderColor = "var(--dorado)"; btn.classList.add("selected");
    const esSet = btn.dataset.set !== "";
    document.getElementById("sn-precio").style.display = esSet ? "none" : "";
    document.getElementById("sn-precio-set").style.display = esSet ? "flex" : "none";
    const esTrioSet = btn.dataset.set === "2+1";
    const wrapDama2 = document.getElementById("sn-precio-dama2-wrap");
    if (wrapDama2) wrapDama2.style.display = esTrioSet ? "block" : "none";
    if (esSet) selPrecioTipoSN('unisex');
    if (esSet) renderTallaSetSN();
    // Show set talla container only if categoria is anillo/conjunto and visible
    const snTallaCont = document.getElementById("sn-talla-container");
    const snTallaSetCont = document.getElementById("sn-talla-set-container");
    const snTallaSetResumen = document.getElementById("sn-tallas-set-resumen");
    if (snTallaCont && snTallaCont.style.display !== "none") {
        snTallaCont.style.display = esSet ? "none" : "block";
        if (snTallaSetCont) snTallaSetCont.style.display = esSet ? "block" : "none";
        if (snTallaSetResumen) snTallaSetResumen.style.display = esSet ? "block" : "none";
    }
    // Al cambiar modo, limpiar tallas del modo anterior
    const snResumenInd = document.getElementById("sn-tallas-resumen");
    if (esSet) {
        _snTallasQty = {};
        if (snResumenInd) snResumenInd.innerHTML = "";
    } else {
        _snTallasQtyDama = {}; _snTallasQtyCaballero = {};
        const srSet = document.getElementById("sn-tallas-set-resumen");
        if (srSet) srSet.innerHTML = "";
    }
}
function selPrecioTipoSN(tipo) {
    const esUni = tipo === 'unisex';
    document.getElementById("sn-precio-unisex-btn").style.background = esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("sn-precio-unisex-btn").style.color = esUni ? "#111" : "var(--blanco)";
    document.getElementById("sn-precio-unisex-btn").style.borderColor = esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("sn-precio-dif-btn").style.background = !esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("sn-precio-dif-btn").style.color = !esUni ? "#111" : "var(--blanco)";
    document.getElementById("sn-precio-dif-btn").style.borderColor = !esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("sn-precio-unisex-wrap").style.display = esUni ? "" : "none";
    document.getElementById("sn-precio-dif-wrap").style.display = !esUni ? "flex" : "none";
    // Actualizar selector de tallas si el set container está visible
    if (document.getElementById("sn-talla-set-container")?.style.display !== "none") {
        _snTallasQtyDama = {}; _snTallasQtyCaballero = {};
        renderTallaSetSN();
    }
}

function selSetEP(btn) {
    document.querySelectorAll(".ep-set-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    btn.style.background = "var(--dorado)"; btn.style.color = "#111"; btn.style.borderColor = "var(--dorado)";
    const esSet = btn.dataset.set !== "";
    document.getElementById("ep-precio").style.display = esSet ? "none" : "";
    document.getElementById("ep-precio-set-wrap").style.display = esSet ? "flex" : "none";
    if (esSet) selPrecioTipoEP('unisex');
}
function selPrecioTipoEP(tipo) {
    const esUni = tipo === 'unisex';
    document.getElementById("ep-precio-unisex-btn").style.background = esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("ep-precio-unisex-btn").style.color = esUni ? "#111" : "var(--blanco)";
    document.getElementById("ep-precio-unisex-btn").style.borderColor = esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("ep-precio-dif-btn").style.background = !esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("ep-precio-dif-btn").style.color = !esUni ? "#111" : "var(--blanco)";
    document.getElementById("ep-precio-dif-btn").style.borderColor = !esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("ep-precio-unisex-wrap").style.display = esUni ? "" : "none";
    document.getElementById("ep-precio-dif-wrap").style.display = !esUni ? "" : "none";
}

function toggleMenuMover(codigo, btn) {
    // Cerrar todos los otros menús abiertos
    document.querySelectorAll('[id^="menu-mover-"]').forEach(m => {
        if (m.id !== `menu-mover-${codigo}`) m.style.display = "none";
    });
    const menu = document.getElementById(`menu-mover-${codigo}`);
    if (!menu) return;
    menu.style.display = menu.style.display === "none" ? "block" : "none";
    // Posición fija calculada desde el botón — así el menú no queda cortado
    // por el scroll horizontal de la tabla, y se abre hacia arriba si no hay
    // espacio abajo (ej. últimas filas de una tarjeta larga).
    if (menu.style.display === "block" && btn) {
        menu.style.position = "fixed";
        const rect = btn.getBoundingClientRect();
        const menuAltura = menu.offsetHeight || 110;
        const espacioAbajo = window.innerHeight - rect.bottom;
        if (espacioAbajo < menuAltura + 10) {
            menu.style.top = "auto";
            menu.style.bottom = (window.innerHeight - rect.top + 4) + "px";
        } else {
            menu.style.bottom = "auto";
            menu.style.top = (rect.bottom + 4) + "px";
        }
        menu.style.left = "auto";
        menu.style.right = (window.innerWidth - rect.right) + "px";
    }
    // Cerrar al hacer clic fuera
    if (menu.style.display === "block") {
        setTimeout(() => {
            document.addEventListener("click", function cerrar() {
                menu.style.display = "none";
                document.removeEventListener("click", cerrar);
            }, { once: true });
        }, 10);
    }
}

async function moverItemDirecto(codigoOCodigos, destino) {
    document.querySelectorAll('[id^="menu-mover-"]').forEach(m => m.style.display = "none");
    document.querySelectorAll('.menu-mover-grid').forEach(m => m.style.display = "none");
    // Acepta un código individual (fila de lista = una talla puntual) o un
    // arreglo de códigos (tarjeta de grupo en la vista grid): mover desde el
    // grupo mueve TODAS las tallas en existencia de ese diseño, no solo la
    // que estaba activa/resaltada en ese momento.
    stockSeleccionados = Array.isArray(codigoOCodigos) ? [...codigoOCodigos] : [codigoOCodigos];
    if (destino === "tienda") await asignarATienda();
    else if (destino === "bodega") await devolverABodega();
    stockSeleccionados = [];
}

function moverItemDirectoVendedor(codigoOCodigos) {
    document.querySelectorAll('[id^="menu-mover-"]').forEach(m => m.style.display = "none");
    document.querySelectorAll('.menu-mover-grid').forEach(m => m.style.display = "none");
    // asignarAVendedor() solo ABRE el modal — no espera a que el usuario elija
    // vendedor y confirme, así que un `await` seguido de vaciar
    // stockSeleccionados se ejecutaba de inmediato, antes de que el usuario
    // tocara nada. Cuando confirmarAsignarVendedor() finalmente se disparaba,
    // stockSeleccionados ya estaba vacío: mandaba codigos:[] al servidor, que
    // no hacía nada pero igual respondía ok, y el toast decía "✅ Asignados
    // correctamente" aunque la asignación real nunca se ejecutó. Ahora queda
    // seteado hasta que confirmarAsignarVendedor() lo limpie de verdad
    // (via limpiarSeleccion(), al terminar con éxito).
    // Mismo criterio que moverItemDirecto: desde una tarjeta de grupo (vista
    // grid) llega un arreglo con TODAS las tallas en existencia, no solo la activa.
    stockSeleccionados = Array.isArray(codigoOCodigos) ? [...codigoOCodigos] : [codigoOCodigos];
    asignarAVendedor();
}

async function toggleReservaStock(codigo) {
    const item = stockData.find(p => String(p.codigo) === String(codigo));
    if (!item) return;
    const nuevoValor = !item.reservado;
    const res = await apiPost({ accion: "EDITAR_PRODUCTO", codigo, reservado: nuevoValor });
    if (!res || res.ok === false) { toast("⚠️ Error al actualizar reserva"); return; }
    item.reservado = nuevoValor;
    toast(nuevoValor ? "⏳ Producto reservado — ya no aparece disponible en el catálogo" : "✅ Reserva liberada");
    filtrarStock();
}

function toggleSeleccionStock(codigo) {
    const idx = stockSeleccionados.indexOf(codigo);
    if (idx >= 0) stockSeleccionados.splice(idx, 1);
    else stockSeleccionados.push(codigo);
    
    const accionesDiv = document.getElementById("stock-acciones");
    const countEl = document.getElementById("stock-sel-count");
    if (stockSeleccionados.length > 0) {
        accionesDiv.style.display = "flex";
        // Pegar la barra justo debajo del header (que también es sticky top:0) —
        // si no, ambos chocan en el mismo lugar y el header (con más prioridad)
        // termina tapando esta barra en vez de que quede visible al hacer scroll.
        const header = document.querySelector(".header");
        accionesDiv.style.top = (header?.offsetHeight || 60) + "px";
        countEl.textContent = stockSeleccionados.length + " seleccionado" + (stockSeleccionados.length > 1 ? "s" : "");
    } else {
        accionesDiv.style.display = "none";
    }
    filtrarStock();
}

let _modoScannerStock = false;
window._modoScannerStock = false;

function toggleModoScanner() {
    _modoScannerStock = !_modoScannerStock;
    window._modoScannerStock = _modoScannerStock;
    const btn = document.getElementById("btn-scanner-stock");
    const inp = document.getElementById("bus-stock");
    if (_modoScannerStock) {
        btn.style.background = "#2ecc71";
        btn.style.color = "#111";
        btn.style.border = "1px solid #27ae60";
        btn.textContent = "📡 Scanner ON";
        inp.placeholder = "Listo para escanear...";
        inp.value = "";
        inp.focus();
    } else {
        btn.style.background = "#222";
        btn.style.color = "#888";
        btn.style.border = "1px solid #444";
        btn.textContent = "📡 Scanner";
        inp.placeholder = "Buscar por código o nombre...";
    }
}

function buscarStockPorScanner(cod) {
    const inp = document.getElementById("bus-stock");
    if (inp) inp.value = cod;
    filtrarStock();
    // Resaltar tarjeta encontrada en verde
    setTimeout(() => {
        const lista = document.getElementById("lista-stock");
        const cards = lista ? lista.querySelectorAll(".inv-item") : [];
        let encontrada = null;
        cards.forEach(card => {
            const c = (card.dataset.codigo || "").toUpperCase();
            if (c === cod.toUpperCase()) { encontrada = card; }
            else { card.style.borderColor = "#333"; card.style.boxShadow = ""; }
        });
        if (encontrada) {
            encontrada.style.borderColor = "#2ecc71";
            encontrada.style.boxShadow = "0 0 0 2px #2ecc71, 0 0 16px rgba(46,204,113,0.3)";
            encontrada.scrollIntoView({ behavior: "smooth", block: "center" });
            // Quitar highlight después de 4 segundos
            setTimeout(() => {
                encontrada.style.borderColor = "#333";
                encontrada.style.boxShadow = "";
            }, 4000);
        } else if (cards.length === 1) {
            // Si solo hay un resultado (búsqueda parcial), resaltarlo igual
            cards[0].style.borderColor = "#2ecc71";
            cards[0].style.boxShadow = "0 0 0 2px #2ecc71, 0 0 16px rgba(46,204,113,0.3)";
            cards[0].scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => {
                cards[0].style.borderColor = "#333";
                cards[0].style.boxShadow = "";
            }, 4000);
        }
    }, 80);
}

function buscarEtiquetasPorScanner(cod) {
    const inp = document.getElementById("bus-etiquetas");
    if (inp) inp.value = cod;
    filtrarProductosEtiquetas();
    setTimeout(() => {
        const grid = document.getElementById("grid-etiquetas");
        const cards = grid ? grid.querySelectorAll("div[id^='etqcard-']") : [];
        // Buscar coincidencia exacta por código
        const idEsperado = "etqcard-" + cod.replace(/[^a-zA-Z0-9]/g, '-');
        let card = document.getElementById(idEsperado) || (cards.length === 1 ? cards[0] : null);
        if (card) {
            card.style.outline = "2px solid #2ecc71";
            card.style.boxShadow = "0 0 12px rgba(46,204,113,0.4)";
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => { card.style.outline = ""; card.style.boxShadow = ""; }, 4000);
        }
    }, 80);
}

// ── ESCÁNER QR POR CÁMARA (teléfono) ─────────────────────────────────
// Lee el mismo texto plano que codifica el QR de la etiqueta impresa
// (impresion/index.html → generateQRDataUrl(codigo)) y entrega ese código
// a quien lo pidió — sin depender de un lector físico USB/Bluetooth.
let _scannerStream = null;
let _scannerRAF = null;
let _scannerLastCode = null;
let _scannerLastTime = 0;
let _scannerOnResult = null;

async function abrirScannerQR(onResult, titulo) {
    if (typeof jsQR !== "function") {
        return toast("⚠️ El lector de código no cargó — revisa tu conexión e intenta de nuevo", "#ef4444");
    }
    document.getElementById("scanner-qr-titulo").textContent = titulo || "📷 Escanear código";
    document.getElementById("scanner-qr-status").textContent = "Lo que ves dentro del recuadro es lo que se escanea";
    document.getElementById("modal-scanner-qr-fondo").style.display  = "block";
    document.getElementById("modal-scanner-qr-header").style.display = "flex";
    document.getElementById("modal-scanner-qr-box").style.display    = "block";
    document.getElementById("scanner-qr-status").style.display       = "block";
    // Bloquea el scroll de fondo mientras el modal está abierto — en iOS/Android
    // el "rubber-band" del scroll de la página de atrás se sentía como que la
    // pantalla del escáner "se movía de un lado a otro".
    document.body.style.overflow = "hidden";
    _scannerOnResult = onResult;
    _scannerLastCode = null;
    _scannerLastTime = 0;

    const video = document.getElementById("scanner-qr-video");
    try {
        // Pide una resolución alta pero de aspecto común (16:9/4:3) — pedir un
        // cuadrado 1920x1920 (como estaba antes) no lo soporta casi ningún
        // sensor de cámara, así que el navegador caía a una resolución más
        // baja o tardaba en negociar el formato, lo que hacía más difícil
        // detectar el QR.
        _scannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1280 } }
        });
        video.srcObject = _scannerStream;
        await video.play();

        // Solo enfoque continuo — el zoom digital automático que se probó
        // antes podía dejar la imagen borrosa en teléfonos que no lo soportan
        // bien, dificultando la lectura en vez de ayudarla.
        try {
            const track = _scannerStream.getVideoTracks()[0];
            const caps  = track.getCapabilities ? track.getCapabilities() : {};
            if (caps.focusMode && caps.focusMode.includes("continuous")) {
                await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
            }
        } catch (_) {}

        _tickScannerQR(video);

        // Vigilante: si a los 3s no hay imagen real (el stream se concedió
        // pero no llegan frames — cámara ocupada por otra app, WebView raro,
        // etc.), lo avisamos en vez de dejar el cuadro verde vacío en silencio.
        clearTimeout(window._scannerWatchdog);
        window._scannerWatchdog = setTimeout(() => {
            if (_scannerStream && video.readyState < video.HAVE_ENOUGH_DATA) {
                const status = document.getElementById("scanner-qr-status");
                if (status) status.textContent = "⚠️ La cámara no está mostrando imagen — cierra y vuelve a abrir el escáner, o revisa que ninguna otra app esté usando la cámara";
            }
        }, 3000);
    } catch (e) {
        const msgCam = e.name === "NotAllowedError"
            ? "⚠️ La cámara está bloqueada para este sitio. Toca el candado junto a la dirección → Permisos → Cámara → Permitir. Si usas lector físico, escanea sin abrir la cámara."
            : e.name === "NotFoundError"
                ? "⚠️ Este equipo no tiene cámara. Usa el lector físico: escanea directamente, sin abrir la cámara."
                : "⚠️ No se pudo acceder a la cámara: " + e.name + " — " + e.message;
        toast(msgCam, "#ef4444", 8000);
        cerrarScannerQR();
    }
}

function _tickScannerQR(video) {
    if (!_scannerStream) return; // el modal ya se cerró
    // Todo el procesamiento del frame va en try/catch — si un solo frame falla
    // (ej. dimensiones del video aún en 0 justo al abrir la cámara) NO debe
    // matar el bucle: sin este try/catch, una excepción aquí detenía
    // requestAnimationFrame para siempre y la cámara se quedaba "viva" pero
    // sin leer nunca nada, como si escanear ya no hiciera nada.
    try {
        const canvas = document.getElementById("scanner-qr-canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const vw = video.videoWidth, vh = video.videoHeight;
        if (video.readyState === video.HAVE_ENOUGH_DATA && vw > 0 && vh > 0) {
            // Recorta al cuadro central de la cámara — el mismo recorte que hace
            // el CSS (object-fit:cover) en el visor — así lo que el usuario ve
            // dentro del recuadro verde es exactamente lo que se analiza, y no
            // hay que "ajustar" el teléfono buscando dónde sí lee.
            const lado = Math.min(vw, vh);
            const sx = (vw - lado) / 2, sy = (vh - lado) / 2;
            canvas.width = lado;
            canvas.height = lado;
            ctx.drawImage(video, sx, sy, lado, lado, 0, 0, lado, lado);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imgData.data, imgData.width, imgData.height);
            if (code && code.data) {
                const texto = code.data.trim();
                const ahora = Date.now();
                // Evita disparar el mismo código en cada frame — solo lo re-acepta
                // si cambió o pasó 1.5s desde el último acierto (permite re-escanear
                // el mismo producto para agregar varias unidades).
                if (texto !== _scannerLastCode || ahora - _scannerLastTime > 1500) {
                    _scannerLastCode = texto;
                    _scannerLastTime = ahora;
                    if (navigator.vibrate) navigator.vibrate(80);
                    const status = document.getElementById("scanner-qr-status");
                    if (status) status.textContent = "✅ Leído: " + texto;
                    const callback = _scannerOnResult;
                    cerrarScannerQR();
                    callback && callback(texto);
                    return;
                }
            }
        }
    } catch (_) { /* frame ignorado, se reintenta en el siguiente */ }
    _scannerRAF = requestAnimationFrame(() => _tickScannerQR(video));
}

function cerrarScannerQR() {
    clearTimeout(window._scannerWatchdog);
    ["modal-scanner-qr-fondo", "modal-scanner-qr-header", "modal-scanner-qr-box", "scanner-qr-status"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
    document.body.style.overflow = "";
    if (_scannerRAF) cancelAnimationFrame(_scannerRAF);
    _scannerRAF = null;
    if (_scannerStream) { _scannerStream.getTracks().forEach(t => t.stop()); _scannerStream = null; }
    _scannerOnResult = null;
}

function _onScanVD(codRaw) {
    // No toca el buscador ni llama filtrarVD() aquí — agregarAlVD() ya hace su
    // propio filtrarVD()+renderCarritoVD()+scroll al carrito. Duplicarlo hacía
    // que la pantalla se re-dibujara dos veces seguidas y se sintiera como que
    // "se movía sola" justo al cerrarse la cámara.
    const cod = String(codRaw || "").trim().toUpperCase();
    // Cuenta bodega + tienda como vendible — igual que agregarAlVD()/filtrarVD()
    // y que el propio worker (REGISTRAR_VENTA_DIRECTA descuenta primero de
    // tienda y luego de bodega). Antes esto solo miraba stock_bodega, así que
    // un producto que físicamente ya estaba en la tienda (no en bodega) salía
    // como "no encontrado" al escanearlo, aunque sí era vendible.
    const match = stockData.find(s => (s.codigo || "").toUpperCase() === cod && (parseInt(s.stock_bodega || 0) + parseInt(s.stock_tienda || 0)) > 0);
    if (match) {
        agregarAlVD(match.codigo);
        mostrarConfirmacionEscaneo(match.foto, match.nombre || match.codigo, match.codigo + " · $" + parseFloat(match.precio||0).toFixed(2));
    } else {
        toast("⚠️ No se encontró ese código en bodega", "#f97316");
    }
}

// Muestra brevemente la foto del producto escaneado — el carrito de Venta
// Directa solo lista texto, así que sin esto no había manera de confirmar a
// simple vista que el QR leído correspondía a la pieza correcta.
function mostrarConfirmacionEscaneo(foto, nombre, sub) {
    const box = document.getElementById("scan-confirm");
    if (!box) return;
    const img = document.getElementById("scan-confirm-foto");
    img.src = foto ? ikFoto(foto, 400) : "";
    img.dataset.fotoRaw = foto || "";
    img.style.display = foto ? "block" : "none";
    document.getElementById("scan-confirm-nombre").textContent = nombre || "";
    document.getElementById("scan-confirm-sub").textContent = sub || "";
    box.style.display = "flex";
    clearTimeout(window._scanConfirmTimer);
    window._scanConfirmTimer = setTimeout(() => { box.style.display = "none"; }, 2200);
}

// Toca la foto de la confirmación de escaneo (Venta Directa) para verla en
// grande — la abre en el mismo lightbox de zoom que ya usa el resto del
// sistema y frena el auto-cierre para que no desaparezca mientras se mira.
function _zoomFotoEscaneo() {
    const img = document.getElementById("scan-confirm-foto");
    if (!img || !img.dataset.fotoRaw) return;
    clearTimeout(window._scanConfirmTimer);
    document.getElementById("scan-confirm").style.display = "none";
    abrirFotoZoom(img.dataset.fotoRaw, document.getElementById("scan-confirm-nombre").textContent);
}

// Etiquetas legibles para las categorías estándar — cualquier categoría
// personalizada que no esté aquí se muestra tal cual viene en el dato.
const CATEGORIA_LABELS_STOCK = {
    AN: "💍 Anillos", PU: "📿 Pulseras", CO: "📿 Collares", AR: "👂 Aretes",
    CJ: "✨ Conjuntos", DJ: "🔗 Dijes", TB: "🦶 Tobilleras", CD: "⛓️ Cadenas con Dije",
    CA: "⛓️ Cadenas solas", RS: "📿 Rosarios", RE: "⌚ Relojes",
};

// Aviso «N productos sin foto» (sobre todo el stock activo, sin importar los filtros): un clic abre la lista
function actualizarAvisoSinFoto() {
    const box = document.getElementById("stock-sinfoto-aviso"); if (!box) return;
    const sin = (typeof stockData !== "undefined" ? stockData : []).filter(i => i.estado !== "inactivo" && !String(i.foto || i.img || "").trim());
    if (!sin.length) { box.style.display = "none"; box.innerHTML = ""; return; }
    const disenos = new Set(sin.map(i => getCodigoBase(i.codigo).toUpperCase())).size;
    box.innerHTML = `<button class="btn" onclick="document.getElementById('fil-stock-estado').value='sinfoto';filtrarStock();" style="background:#2f2a14;color:#f5d76e;border:1px solid #8a7a1e;padding:7px 14px;font-size:12px;">📷 <b>${sin.length}</b> código${sin.length > 1 ? "s" : ""} sin foto (<b>${disenos}</b> diseño${disenos > 1 ? "s" : ""}) — ver lista</button>`;
    box.style.display = "block";
}
function filtrarStock() {
    actualizarAvisoSinFoto();
    const filtro = document.getElementById("fil-stock-estado").value;
    const material = document.getElementById("fil-stock-material")?.value || "";
    const categoria = document.getElementById("fil-stock-categoria")?.value || "";
    const busq = document.getElementById("bus-stock").value.toLowerCase();
    const filtrados = stockData.filter(i => {
        // También se encuentra por el CÓDIGO ANTERIOR (la etiqueta física aún trae el viejo) y, escribiendo «etiqueta»,
        // salen solo los productos con la etiqueta por cambiar.
        const coincideBusq = !busq ||
            (i.nombre||"").toLowerCase().includes(busq) ||
            (i.codigo||"").toLowerCase().includes(busq) ||
            (i.codigoAnterior||"").toLowerCase().includes(busq) ||
            (busq === "etiqueta" && i.etiquetaPendiente === true);
        const coincideMaterial = !material || (i.material||"") === material;
        const coincideCategoria = !categoria || (i.categoria||"").toUpperCase() === categoria;
        let coincideEstado = true;
        if (filtro) {
            switch (filtro) {
                case "bodega":       coincideEstado = (parseInt(i.stock_bodega)||0)       > 0; break;
                case "tienda":       coincideEstado = (parseInt(i.stock_tienda)||0)        > 0; break;
                case "consignacion": coincideEstado = (parseInt(i.stock_consignacion)||0)  > 0; break;
                case "reservado":    coincideEstado = Boolean(i.reservado) || (parseInt(i.stock_reservado)||0) > 0; break;
                case "vendido":      coincideEstado = (parseInt(i.stock_vendido)||0)       > 0; break;
                case "sinfoto":      coincideEstado = i.estado !== "inactivo" && !String(i.foto || i.img || "").trim(); break;
                default:             coincideEstado = normalizar(i.estado) === filtro;
            }
        }
        return coincideEstado && coincideMaterial && coincideCategoria && coincideBusq;
    });
    const orden = document.getElementById("fil-stock-orden")?.value || "";
    if (orden === "cantidad-desc" || orden === "cantidad-asc") {
        const disp = i => Math.max(0, parseInt(i.cantidad||0) - parseInt(i.vendido||0));
        filtrados.sort((a, b) => orden === "cantidad-desc" ? disp(b) - disp(a) : disp(a) - disp(b));
    }
    renderStock(filtrados);
}

// Llena el filtro de materiales con los valores distintos presentes en el
// stock actual — se llama cada vez que se recarga la lista completa.
function poblarFiltroMaterial() {
    const sel = document.getElementById("fil-stock-material");
    if (!sel) return;
    const actual = sel.value;
    const materiales = [...new Set(stockData.map(i => (i.material||"").trim()).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todo material</option>' +
        materiales.map(m => `<option value="${m.replace(/"/g,'&quot;')}">${m}</option>`).join("");
    if (materiales.includes(actual)) sel.value = actual;
}