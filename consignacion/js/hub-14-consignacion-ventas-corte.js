// Hub VEREX — Consignación: ventas, comisión, corte, link de inventario y PDF del corte
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
async function eliminarItemInventario(id, nombre) {
    if (!confirm("¿Eliminar " + nombre + " del inventario? La pieza vuelve a bodega de VEREX — úsalo solo si la pieza NO se vendió (se está devolviendo). Si ya se vendió, usa el botón '✅ Ya vendida' en su lugar.")) return;
    await apiPost({ accion: "ELIMINAR_ITEM_CONSIGNACION", id });
    const idx = consignacion.findIndex(c => String(c.id) === String(id));
    if (idx >= 0) consignacion.splice(idx, 1);
    renderPerfilStats();
    renderInventario();
    toast("🗑️ Producto eliminado del inventario");
}

// Cierra un item que en realidad YA se vendió (y normalmente ya se liquidó
// en un corte) pero por algún motivo quedó marcado como disponible — a
// diferencia de eliminarItemInventario(), esto NO mueve stock ni lo regresa
// a bodega, porque la pieza no existe físicamente en VEREX, ya está con el
// cliente que la compró.
// Para ventas que ya ocurrieron y ya se liquidaron (ej. una pieza que se
// cerró con "✅ Ya vendida" antes de que existiera el registro histórico
// combinado, o cualquier venta antigua que se coló sin fecha real) — pide
// los datos a mano y crea SOLO el registro de reporte, sin tocar stock ni
// volver a cobrar comisión.
async function registrarVentaHistoricaManual() {
    const codigo = prompt("Código del producto (ej. SE28001PM):");
    if (!codigo) return;
    const nombre = prompt("Nombre del producto:", codigo);
    if (nombre === null) return;
    const precio = parseFloat(prompt("Precio de venta ($):", "0"));
    if (!precio || precio <= 0) { toast("⚠️ Precio inválido"); return; }
    const cantidad = parseInt(prompt("Cantidad:", "1")) || 1;
    const fechaTxt = prompt("Fecha real en que se vendió (AAAA-MM-DD):", new Date().toISOString().slice(0,10));
    if (!fechaTxt) return;
    const fechaISO = new Date(fechaTxt + "T12:00:00").toISOString();
    const res = await apiPost({
        accion: "REGISTRAR_VENTA_HISTORICA", vendedor: vendedorActual.codigo,
        codigo, nombre, precio, cantidad, fecha: fechaISO
    });
    if (res.ok) toast("✅ Registrada en Ventas Generales / Cierres");
    else toast("⚠️ " + (res.error||"No se pudo registrar"), "#c0392b");
}

async function cerrarItemYaVendido(id, nombre) {
    const item = consignacion.find(c => String(c.id) === String(id));
    if (!item) return;

    // Este botón mezclaba dos casos muy distintos bajo un solo click:
    //  · Venta NUEVA (el vendedor recién la vendió a un cliente, sin
    //    posibilidad de devolución) — debe contar para su comisión en el
    //    próximo corte y aparecer en su historial de ventas, igual que
    //    cualquier venta registrada por el flujo normal.
    //  · Pieza que YA se liquidó antes (ej. quedó mal cerrada por el bug
    //    del corte) — la comisión ya se cobró, así que NO debe volver a
    //    contarse; solo hace falta cerrar el registro viejo.
    // Antes SIEMPRE hacía el segundo caso (MARCAR_CONSIGNACION_VENDIDA, que
    // no toca comisión ni historial), así que una venta nueva marcada "Ya
    // vendida" nunca generaba comisión ni aparecía en el registro de ventas
    // del vendedor a menos que además se completara un segundo paso opcional.
    //
    // Antes esto usaba confirm() con "Cancelar = ya se había liquidado" — un
    // usuario que quería CANCELAR TODO (no sabía cuál opción era, se
    // arrepintió, etc.) terminaba disparando la rama opuesta sin darse
    // cuenta, porque en un confirm() "Cancelar" nunca significa "aborta y no
    // hagas nada distinto a lo que ya hacías". Ahora las dos opciones se
    // escriben como texto explícito y cualquier respuesta que no sea
    // exactamente una de las dos aborta sin tocar nada.
    const respuestaTipo = (prompt(
        `¿"${nombre}" es una venta NUEVA o ya se había liquidado antes?\n\n` +
        `Escribe NUEVA → se registra normal, cuenta para su comisión y aparece en su historial de ventas.\n` +
        `Escribe LIQUIDADA → ya se había cobrado antes (ej. quedó mal cerrada por el bug del corte), solo cierra el registro sin volver a cobrar comisión.\n\n` +
        `(Cancelar no hace nada)`,
        "NUEVA"
    ) || "").trim().toUpperCase();

    if (respuestaTipo !== "NUEVA" && respuestaTipo !== "LIQUIDADA") return;

    if (respuestaTipo === "NUEVA") {
        const disponible = Math.max(1, parseInt(item.cantidad||0) - parseInt(item.vendido||0));
        const fechaTxtNueva = prompt("Fecha real en que se vendió (AAAA-MM-DD):", new Date().toISOString().slice(0,10));
        if (!fechaTxtNueva) return;
        const fechaISONueva = new Date(fechaTxtNueva + "T12:00:00").toISOString();
        const resVenta = await apiPost({ accion: "REGISTRAR_VENTA", id, cantidad: disponible, fecha: fechaISONueva });
        if (!resVenta.ok) { toast("⚠️ " + (resVenta.error||"No se pudo registrar la venta"), "#c0392b"); return; }
        item.vendido = (parseInt(item.vendido)||0) + disponible;
        renderPerfilStats();
        renderInventario();
        toast("✅ Venta registrada — cuenta para su comisión y ya aparece en su historial");
        return;
    }

    if (!confirm("¿Confirmas que \"" + nombre + "\" ya se había liquidado antes? Se cerrará sin devolver stock a bodega ni volver a cobrar comisión.")) return;
    const res = await apiPost({ accion: "MARCAR_CONSIGNACION_VENDIDA", id });
    if (!res.ok) { toast("⚠️ " + (res.error||"No se pudo cerrar el item"), "#c0392b"); return; }
    item.estado = "vendido";
    renderPerfilStats();
    renderInventario();
    toast("✅ Pieza cerrada — ya no aparece como disponible");

    // Preguntar si quiere que también quede registrada en "Ventas generales"
    // / Cierres Mensuales con su fecha real — es un registro SOLO para
    // reportes, no vuelve a cobrar comisión (eso ya se liquidó).
    if (item && confirm("¿Quieres que esta venta también quede registrada en Ventas Generales / Cierres Mensuales con su fecha real? (No afecta el próximo corte, es solo para el reporte)")) {
        const fechaTxt = prompt("Fecha real en que se vendió (AAAA-MM-DD):", new Date().toISOString().slice(0,10));
        if (fechaTxt) {
            const fechaISO = new Date(fechaTxt + "T12:00:00").toISOString();
            const resHist = await apiPost({
                accion: "REGISTRAR_VENTA_HISTORICA", vendedor: vendedorActual.codigo,
                codigo: item.codigo, nombre: item.nombre, precio: item.precio,
                cantidad: item.vendido || item.cantidad || 1, fecha: fechaISO
            });
            if (resHist.ok) toast("✅ Registrada también en Ventas Generales");
            else toast("⚠️ " + (resHist.error||"No se pudo registrar en Ventas Generales"), "#c0392b");
        }
    }
}

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

// Aviso al cortar ANTES de la fecha programada (corte = último corte + 30 días, o la fecha fijada a mano). Devuelve
// { abortar } o { mantenerFecha: "AAAA-MM-DD" | null }. Faltando menos de 3 días no pregunta nada.
const CORTE_ANTICIPADO_MIN_DIAS = 3;
function decidirCorteAnticipado(v) {
    const real = typeof corteRealDe === "function" ? corteRealDe(v) : null;
    if (!real || !(real.dias >= CORTE_ANTICIPADO_MIN_DIAS)) return { mantenerFecha: null };
    const f = real.fecha;
    const fechaTxt = f.toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" });
    const iso = f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
    if (!confirm(`⚠️ CORTE ANTICIPADO\n\nEste corte se está haciendo ${real.dias} días antes de la fecha programada (${fechaTxt}).\n\nAl cerrarlo se cierra el link de inventario del vendedor y se reinicia su ciclo.\n\n¿Hacer el corte ahora?`)) return { abortar: true };
    const reiniciar = confirm(`¿Qué pasa con la fecha del próximo corte?\n\nAceptar = reiniciar: el próximo corte será en 30 días desde hoy.\nCancelar = mantener la fecha ya programada (${fechaTxt}).`);
    return { mantenerFecha: reiniciar ? null : iso };
}

async function confirmarCorte() {
    if (_corteProcesando) return;
    const decCorte = decidirCorteAnticipado(vendedorActual);
    if (decCorte.abortar) return;
    const mantenerFechaCorte = decCorte.mantenerFecha || null;
    _corteProcesando = true;
    const btnConfirmarCorte = document.getElementById("btn-confirmar-corte");
    if (btnConfirmarCorte) btnConfirmarCorte.disabled = true;
    try {
    const cobrado = !!document.getElementById("chk-cobrado-corte")?.checked;
    const devueltos = Object.entries(decisionesCorte).filter(([_, d]) => d === "devolver").map(([id]) => id);
    await apiPost({ accion: "CERRAR_CORTE", vendedor: vendedorActual.codigo, devueltos, ...(mantenerFechaCorte ? { mantenerProximoCorte: mantenerFechaCorte } : {}) });
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
    if (vendedorActual) { vendedorActual.fechaCorte = new Date().toISOString(); vendedorActual.tokenInventario = ""; vendedorActual.proximoCorte = mantenerFechaCorte; }
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
