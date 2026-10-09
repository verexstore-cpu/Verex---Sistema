

function cambioVDToggle(i) {
    const on = document.getElementById("cvd-on-" + i).checked;
    document.getElementById("cvd-det-" + i).style.display = on ? "block" : "none";
    if (on) document.getElementById("cvd-nuevo-" + i)?.focus();
    cambioVDPreview();
}

// Piezas marcadas → lista de cambios para el worker. `incompleto` = hay una
// marcada a la que todavía le falta el código nuevo.
function cambioVDSeleccion() {
    const cambios = []; let incompleto = false;
    (_cambioVD?.items || []).forEach((it, i) => {
        if (!document.getElementById("cvd-on-" + i)?.checked) return;
        const nuevo = (document.getElementById("cvd-nuevo-" + i)?.value || "").trim().toUpperCase();
        if (!nuevo) { incompleto = true; return; }
        cambios.push({
            codigoViejo: it.codigo, codigoNuevo: nuevo,
            aplicaDescuento: !!document.getElementById("cvd-desc-" + i)?.checked
        });
    });
    return { cambios, incompleto };
}

function cambioVDPreview() {
    clearTimeout(_cambioVDTimer);
    const ventaId = _cambioVD?.ventaId;
    const btn = document.getElementById("cvd-confirmar");
    const res = document.getElementById("cvd-resumen");
    if (!ventaId || !btn || !res) return;
    btn.disabled = true;
    const { cambios, incompleto } = cambioVDSeleccion();
    _cambioVDSeq++;
    if (!cambios.length || incompleto) {
        res.innerHTML = incompleto
            ? "Escribe el código de la pieza nueva en cada pieza marcada."
            : "Marca al menos una pieza para cambiar.";
        return;
    }
    res.innerHTML = "Calculando…";
    const seq = _cambioVDSeq;
    _cambioVDTimer = setTimeout(async () => {
        let data;
        try { data = await apiPost({ accion: "CAMBIAR_PRODUCTO_VENTA_DIRECTA", id: ventaId, cambios, soloCalcular: true }); }
        catch (e) { data = { ok: false, error: "No se pudo conectar con el servidor" }; }
        if (seq !== _cambioVDSeq) return; // ya cambió la selección mientras se calculaba
        if (!data.ok) {
            res.innerHTML = `<span style="color:#e85555;">⚠️ ${sanitizar(data.error || "No se pudo calcular el cambio")}</span>`;
            return;
        }
        const m = n => "$" + Math.abs(parseFloat(n) || 0).toFixed(2);
        const filas = (data.lineas || []).map(l => {
            const dif = parseFloat(l.diferencia) || 0;
            const nota = l.descuentoViejo > 0
                ? (l.aplicaDescuento ? " · con descuento" : ` · pierde descuento de ${m(l.descuentoViejo)}`)
                : "";
            return `<div style="padding:8px 0;border-bottom:1px solid var(--borde);">
                <div style="color:var(--blanco);">${sanitizar(l.codigoViejo)} → <strong>${sanitizar(l.nombreNuevo)}</strong> <span style="color:var(--dorado);font-size:10px;">${sanitizar(l.codigoNuevo)}</span></div>
                <div>Pagó ${m(l.precioViejo)} · nueva ${m(l.precioNuevo)}${nota}
                    → <strong style="color:${dif > 0 ? '#e8a44a' : dif < 0 ? '#52d68a' : 'var(--plateado)'};">${dif > 0 ? "+" : dif < 0 ? "−" : ""}${m(dif)}</strong></div>
            </div>`;
        }).join("");
        const dif = parseFloat(data.diferencia) || 0;
        const titulo = dif > 0 ? `El cliente debe ${m(dif)} más`
            : dif < 0 ? `Baja ${m(dif)} respecto a lo que pagó`
            : "Sin diferencia de monto";
        res.innerHTML = `${filas}
            <div style="margin-top:10px;color:var(--blanco);font-size:13px;font-weight:600;">${titulo}</div>
            <div>Nuevo total ${m(data.nuevoTotal)} · Saldo pendiente ${m(data.nuevoSaldo)}</div>
            ${data.aFavorCliente > 0 ? `<div style="margin-top:6px;color:#e8a44a;">⚠️ Le sobran ${m(data.aFavorCliente)} al cliente: hay que devolvérselos.</div>` : ""}`;
        btn.disabled = false;
    }, 350);
}

let _cambioVDEnviando = false;
async function confirmarCambioVD() {
    if (_cambioVDEnviando || !_cambioVD) return;
    const { cambios, incompleto } = cambioVDSeleccion();
    if (!cambios.length || incompleto) return;
    const btn = document.getElementById("cvd-confirmar");
    _cambioVDEnviando = true; if (btn) btn.disabled = true;
    try {
        const motivo = (document.getElementById("cvd-motivo")?.value || "").trim();
        const data = await apiPost({ accion: "CAMBIAR_PRODUCTO_VENTA_DIRECTA", id: _cambioVD.ventaId, cambios, motivo });
        if (!data.ok) throw new Error(data.error || "Error del servidor");
        const diff = parseFloat(data.diferencia) || 0;
        const msgDiff = diff > 0 ? `El saldo del cliente subió $${diff.toFixed(2)}` : diff < 0 ? `El saldo del cliente bajó $${Math.abs(diff).toFixed(2)}` : "Sin cambio en el monto";
        cerrarModal("modal-cambio-vd");
        toast(`✅ ${cambios.length > 1 ? cambios.length + " productos cambiados" : "Producto cambiado"}. ${msgDiff}`);
        cargarHistorialVD();
    } catch (e) {
        toast("⚠️ " + e.message, "#c0392b");
        if (btn) btn.disabled = false;
    } finally {
        _cambioVDEnviando = false;
    }
}

// Agrega una pieza NUEVA a una venta ya registrada (ej. el cliente aprovecha
// un cambio para llevarse algo más) — a diferencia de "Cambiar", esto no
// quita nada, solo suma al mismo saldo. Así queda un solo crédito combinado
// por cliente en vez de dos ventas sueltas que rastrear por separado.
async function agregarProductoVentaDirectaVD(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#c0392b");

    const codigo = prompt("Código del producto NUEVO que se lleva el cliente (además de lo que ya tiene):", "");
    if (!codigo) return;
    const cantStr = prompt("¿Cuántas piezas de ese producto?", "1");
    const cantidad = Math.max(1, parseInt(cantStr) || 1);

    if (!confirm(`¿Agregar "${codigo.trim()}" x${cantidad} a la venta de ${venta.cliente || "este cliente"}?\n\nEl monto se suma al saldo pendiente actual.`)) return;

    try {
        const data = await apiPost({ accion: "AGREGAR_PRODUCTO_VENTA_DIRECTA", id: ventaId, codigo: codigo.trim(), cantidad });
        if (!data.ok) throw new Error(data.error || "Error del servidor");
        toast(`✅ Pieza agregada — nuevo saldo pendiente: $${parseFloat(data.nuevoSaldo).toFixed(2)}`);
        cargarHistorialVD();
    } catch(e) {
        toast("⚠️ " + e.message, "#c0392b");
    }
}

// Corrección manual — repara casos donde subtotal/total/saldo quedaron
// desalineados de la suma real de los productos (cada cambio/agregado solo
// suma un número al anterior; un error en un paso arrastra a los siguientes).
// Calcula el subtotal REAL sumando los productos guardados, y a partir de
// ahí guía el resto: descuento acumulado → total → saldo (restando lo que
// ya se pagó, sin importar si el total viejo estaba mal).
async function corregirSaldoVD(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#c0392b");
    let items = [];
    try { items = typeof venta.items === "string" ? JSON.parse(venta.items || "[]") : (venta.items || []); } catch(_) {}
    const subtotalReal = items.reduce((s, it) => s + (parseFloat(it.precio||0) * (parseInt(it.cantidad)||1)), 0);
    const totalViejo = parseFloat(venta.total || 0);
    const saldoViejo = parseFloat(venta.saldoPendiente || 0);
    const yaPagado = Math.max(0, totalViejo - saldoViejo);

    const descStr = prompt(
        `Suma real de los productos guardados: $${subtotalReal.toFixed(2)}\n` +
        `(Total registrado actualmente: $${totalViejo.toFixed(2)} — puede estar desalineado)\n\n` +
        `¿Cuánto descuento ACUMULADO tiene esta venta en total? (todo lo que se le ha rebajado desde el inicio)`,
        Math.max(0, subtotalReal - totalViejo).toFixed(2)
    );
    if (descStr === null) return;
    const descuento = Math.max(0, parseFloat(descStr) || 0);
    const totalCorrecto = Math.max(0, subtotalReal - descuento);
    const saldoCorrecto = Math.max(0, totalCorrecto - yaPagado);

    if (!confirm(
        `Resumen de la corrección:\n\n` +
        `Subtotal (productos): $${subtotalReal.toFixed(2)}\n` +
        `Descuento acumulado: -$${descuento.toFixed(2)}\n` +
        `Total correcto: $${totalCorrecto.toFixed(2)}\n` +
        `Ya pagado (abonos + enganche): $${yaPagado.toFixed(2)}\n` +
        `Saldo pendiente correcto: $${saldoCorrecto.toFixed(2)}\n\n` +
        `¿Guardar esta corrección?`
    )) return;

    try {
        const data = await apiPost({
            accion: "CORREGIR_SALDO_VD", id: ventaId,
            subtotal: subtotalReal, descuento, total: totalCorrecto, saldoPendiente: saldoCorrecto
        });
        if (!data.ok) throw new Error(data.error || "Error del servidor");
        toast(`✅ Venta corregida — saldo pendiente: $${saldoCorrecto.toFixed(2)}`);
        cargarHistorialVD();
    } catch(e) {
        toast("⚠️ " + e.message, "#c0392b");
    }
}

// Corrige una venta registrada con la forma de pago equivocada (ej. se
// marcó Contado pero en realidad el cliente solo dejó un enganche y debe
// el resto, o viceversa). No usar "Corregir saldo" para esto: esa acción
// asume que lo ya cobrado es (total - saldoPendiente) tal como está
// guardado, así que si el registro dice "pagado" (saldoPendiente=0) va a
// asumir que se cobró TODO y siempre va a recalcular un saldo de $0.
async function cambiarFormaPagoVD(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#c0392b");
    const esCreditoActual = venta.estado === "credito";
    const total = parseFloat(venta.total || 0);

    if (esCreditoActual) {
        if (!confirm(`Esta venta está marcada como Crédito (saldo pendiente $${parseFloat(venta.saldoPendiente||0).toFixed(2)}).\n\n¿Cambiarla a Contado (el saldo pendiente queda en $0)?`)) return;
        try {
            const data = await apiPost({ accion: "CAMBIAR_FORMA_PAGO_VD", id: ventaId, tipo: "contado" });
            if (!data.ok) throw new Error(data.error || "Error del servidor");
            toast("✅ Venta cambiada a Contado");
            cargarHistorialVD();
        } catch(e) { toast("⚠️ " + e.message, "#c0392b"); }
    } else {
        const montoStr = prompt(
            `Esta venta ($${total.toFixed(2)}) está marcada como Contado.\n\n` +
            `¿Cuánto pagó realmente el cliente (enganche)? El resto queda como saldo pendiente a crédito.`,
            "0"
        );
        if (montoStr === null) return;
        const montoPagado = Math.max(0, Math.min(total, parseFloat(montoStr) || 0));
        const saldoNuevo = Math.max(0, total - montoPagado);
        if (saldoNuevo <= 0) return toast("⚠️ Si pagó todo, ya es Contado — no hay nada que cambiar", "#c0392b");
        if (!confirm(`Se cambiará a Crédito:\nEnganche: $${montoPagado.toFixed(2)}\nSaldo pendiente: $${saldoNuevo.toFixed(2)}\n\n¿Confirmar?`)) return;
        try {
            const data = await apiPost({ accion: "CAMBIAR_FORMA_PAGO_VD", id: ventaId, tipo: "credito", saldoPendiente: saldoNuevo });
            if (!data.ok) throw new Error(data.error || "Error del servidor");
            toast(`✅ Venta cambiada a Crédito — saldo pendiente $${saldoNuevo.toFixed(2)}`);
            cargarHistorialVD();
        } catch(e) { toast("⚠️ " + e.message, "#c0392b"); }
    }
}

// Repara piezas agregadas/cambiadas ANTES de que existiera el marcador de
// fecha en el recibo — les asigna una fecha retroactivamente. Intenta
// adivinar la fecha real buscando en la nota de la venta (ej: "Pieza
// agregada el 13 ago 2026: ... (CODIGO) ..."), y si no la encuentra, deja
// que se escriba manual.
// Devolución de una pieza de una venta directa: vuelve a bodega, la venta baja por lo que costó esa pieza y el saldo se recalcula.
async function devolverPiezaVD(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#c0392b");
    let items = [];
    try { items = typeof venta.items === "string" ? JSON.parse(venta.items || "[]") : (venta.items || []); } catch(_) {}
    if (!items.length) return toast("⚠️ Esta venta no tiene piezas para devolver", "#c0392b");

    let it;
    if (items.length === 1) {
        it = items[0];
    } else {
        const lista = items.map((x, i) => `${i+1}. ${x.nombre || x.codigo} (${x.codigo}) ×${x.cantidad || 1}`).join("\n");
        const idx = parseInt(prompt(`¿Cuál pieza devolvió el cliente?\n\n${lista}\n\nEscribe el número:`, "1")) - 1;
        if (isNaN(idx) || !items[idx]) return;
        it = items[idx];
    }
    let cantidad = parseInt(it.cantidad) || 1;
    if (cantidad > 1) {
        const q = parseInt(prompt(`"${it.nombre || it.codigo}": ¿cuántas unidades devolvió? (máx. ${cantidad})`, String(cantidad)));
        if (isNaN(q) || q < 1 || q > cantidad) return;
        cantidad = q;
    }
    const motivo = (prompt("Motivo de la devolución (opcional):", "") || "").trim();

    try {
        const pre = await apiPost({ accion: "DEVOLVER_PIEZA_VD", id: ventaId, codigo: it.codigo, cantidad, motivo, soloCalcular: true });
        if (!pre.ok) throw new Error(pre.error || "Error del servidor");
        const m = x => "$" + Number(x || 0).toFixed(2);
        const msg = `¿Registrar esta devolución?\n\n` +
            `Pieza: ${pre.pieza} ×${pre.cantidad} (valor ${m(pre.valor)})\n` +
            `• La pieza vuelve a BODEGA.\n` +
            `• Total de la venta: ${m(pre.totalAntes)} → ${m(pre.nuevoTotal)}\n` +
            `• Lo que el sistema tiene como PAGADO por el cliente: ${m(pre.pagadoHastaAhora)}\n` +
            `• Pendiente por cobrar: ${m(pre.nuevoSaldo)}\n` +
            (pre.pagadoHastaAhora <= 0 ? `• ⚠️ Si el cliente ya te había pagado algo y no está registrado, cancela y regístralo primero con 💰 Abono.\n` : "") +
            (pre.aFavorCliente > 0 ? `• ⚠️ El cliente ya había pagado de más: ${m(pre.aFavorCliente)} a su favor (devuélvelo o déjalo como saldo).\n` : "") +
            (pre.quedanPiezas === 0 ? `• La venta queda como DEVUELTA (sin piezas).\n` : "");
        if (!confirm(msg)) return;
        const data = await apiPost({ accion: "DEVOLVER_PIEZA_VD", id: ventaId, codigo: it.codigo, cantidad, motivo });
        if (!data.ok) throw new Error(data.error || "Error del servidor");
        toast(`✅ Devolución registrada: "${pre.pieza}" volvió a bodega`);
        cargarHistorialVD();
        if (typeof cargarDatos === "function") cargarDatos();   // refresca el stock
    } catch(e) {
        toast("⚠️ " + e.message, "#c0392b");
    }
}

async function marcarFechaItemVD(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#c0392b");
    let items = [];
    try { items = typeof venta.items === "string" ? JSON.parse(venta.items || "[]") : (venta.items || []); } catch(_) {}
    if (!items.length) return toast("⚠️ Esta venta no tiene productos registrados", "#c0392b");

    let codigo;
    if (items.length === 1) {
        codigo = items[0].codigo;
    } else {
        const lista = items.map((it, i) => `${i+1}. ${it.codigo} — ${it.nombre || "—"}${(it.fechaAgregado||it.fechaCambio) ? " (ya tiene fecha)" : ""}`).join("\n");
        const eleccion = prompt(`¿A cuál pieza le falta la fecha?\n\n${lista}\n\nEscribe el número:`, "1");
        const idx = parseInt(eleccion) - 1;
        if (isNaN(idx) || !items[idx]) return;
        codigo = items[idx].codigo;
    }

    // Buscar en la nota una pista de fecha para ese código, ej:
    // "➕ Pieza agregada el 13 ago 2026: "..." (COD049T9) x1 — $48.00"
    let fechaSugerida = "";
    const regexNota = new RegExp(`agregad[ao] el ([\\d]{1,2} \\w+ [\\d]{4})[^\\n]*\\(${codigo}\\)`, "i");
    const match = (venta.nota || "").match(regexNota);
    if (match) {
        const parsed = new Date(match[1] + " UTC-6");
        if (!isNaN(parsed)) fechaSugerida = parsed.toISOString().slice(0,10);
    }

    const fechaStr = prompt(`Fecha en que el cliente se llevó "${codigo}" (AAAA-MM-DD):`, fechaSugerida || new Date().toISOString().slice(0,10));
    if (!fechaStr) return;
    const fechaObj = new Date(fechaStr + "T12:00:00");
    if (isNaN(fechaObj)) return toast("⚠️ Fecha inválida", "#c0392b");

    try {
        const data = await apiPost({ accion: "MARCAR_FECHA_ITEM_VD", id: ventaId, codigo, fecha: fechaObj.toISOString() });
        if (!data.ok) throw new Error(data.error || "Error del servidor");
        toast(`✅ Fecha asignada a "${codigo}"`);
        cargarHistorialVD();
    } catch(e) {
        toast("⚠️ " + e.message, "#c0392b");
    }
}

// Construye el PDF del recibo térmico (62mm) y devuelve el objeto jsPDF —
// separado de descargarReciboVD() para poder reutilizarlo también en el
// modal de impresión directa (abrirModalImprimirRecibo58) sin duplicar
// las ~140 líneas de armado del recibo.
function _generarHTMLReciboVD(v) {
    let items = [];
    try { items = typeof v.items==="string" ? JSON.parse(v.items) : (v.items||[]); } catch(e){}

    const descuento   = parseFloat(v.descuento || 0);
    const costoEnvioHTML = parseFloat(v.costoEnvio || 0);
    const envioGratis = costoEnvioHTML === 0 && !!v.departamentoEnvio;
    const totalVenta  = parseFloat(v.total || 0);
    const saldo       = parseFloat(v.saldoPendiente || 0);
    const pagado      = totalVenta - saldo;
    const fecha = new Date(v.fecha).toLocaleDateString("es-SV", { day:"2-digit", month:"2-digit", year:"numeric" });
    const hora  = new Date(v.fecha).toLocaleTimeString("es-SV", { hour:"2-digit", minute:"2-digit" });

    let itemsHTML = '';
    items.forEach(it => {
        const nombre = (it.nombre || it.codigo || "—").replace(/</g,"&lt;");
        const qty    = parseInt(it.cantidad || 1);
        const pu     = parseFloat(it.precioUnitario || it.precio || 0);
        const total  = pu * qty;
        itemsHTML += `<tr>
          <td style="padding:1.2mm 0;vertical-align:top;">${nombre}</td>
          <td style="padding:1.2mm 2mm;text-align:center;vertical-align:top;white-space:nowrap;">${qty}</td>
          <td style="padding:1.2mm 0;text-align:right;vertical-align:top;white-space:nowrap;">$${total.toFixed(2)}</td>
        </tr>`;
        if (it.material) {
            itemsHTML += `<tr><td colspan="3" style="font-size:6.5pt;padding-bottom:1mm;">${it.material.replace(/</g,"&lt;")}</td></tr>`;
        }
        const refItem = it.codigo || it.ref || "";
        if (refItem) {
            itemsHTML += `<tr><td colspan="3" style="font-size:6.5pt;padding-bottom:1.5mm;">Ref: ${refItem}</td></tr>`;
        }
    });

    let totalesHTML = '';
    if (descuento > 0) {
        const subtotal   = parseFloat(v.subtotal || 0) || (totalVenta + descuento);
        const descLabel  = v.descuentoTipo === 'porcentaje'
            ? `Descuento (${v.descuentoValor || ''}%):`
            : "Descuento:";
        totalesHTML += `<tr><td>Subtotal:</td><td style="text-align:right;">$${subtotal.toFixed(2)}</td></tr>
        <tr><td>${descLabel}</td><td style="text-align:right;">-$${descuento.toFixed(2)}</td></tr>`;
    }
    if (costoEnvioHTML > 0) {
        totalesHTML += `<tr><td>Envío:</td><td style="text-align:right;">$${costoEnvioHTML.toFixed(2)}</td></tr>`;
    } else if (envioGratis) {
        totalesHTML += `<tr><td>Envío:</td><td style="text-align:right;font-weight:bold;">GRATIS</td></tr>`;
    }
    totalesHTML += `<tr><td style="font-size:10pt;padding-top:1.5mm;">TOTAL:</td>
      <td style="font-size:10pt;text-align:right;padding-top:1.5mm;">$${totalVenta.toFixed(2)}</td></tr>`;
    if (v.estado === "credito") {
        totalesHTML += `<tr><td>Pagado:</td><td style="text-align:right;">$${pagado.toFixed(2)}</td></tr>
        <tr><td>Pendiente:</td><td style="text-align:right;">$${saldo.toFixed(2)}</td></tr>`;
    }

    const notaHTML = v.nota
        ? `<p style="font-style:italic;font-size:7pt;margin:1.5mm 0;">Nota: ${String(v.nota).replace(/</g,"&lt;")}</p>`
        : '';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { size: 48mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin:0; padding:0; width:48mm;
    font-family:'Courier New',Courier,monospace;
    font-size:9pt; font-weight:normal; color:#000; background:#fff;
  }
  /* Margen generoso arriba y abajo: la térmica empieza a imprimir apenas entra
     el papel, y entre el cabezal y la barra de corte queda un tramo que se
     lleva el final del recibo. Con 3mm/6mm se cortaba el texto de ambas
     puntas. Los laterales quedan igual, que nunca dieron problema. */
  .page { width:48mm; padding:8mm 2.5mm 15mm 2.5mm; }
  .c { text-align:center; }
  .store { font-size:7pt; letter-spacing:3px; margin:0 0 1.5mm; }
  hr { border:none; border-top:1px solid #000; margin:2mm 0; }
  hr.t { border-top:0.5px solid #000; }
  .stit { font-size:8.5pt; text-align:center; margin:0 0 2mm; }
  table.d { width:100%; border-collapse:collapse; font-size:7.5pt; }
  table.d td { padding:0.5mm 0; vertical-align:top; }
  table.d td.lb { width:14mm; }
  table.i { width:100%; border-collapse:collapse; font-size:8pt; }
  table.i th { font-size:7pt; padding:0 0 1mm; }
  table.i th:nth-child(2), table.i td:nth-child(2) { text-align:center; width:9mm; }
  table.i th:last-child, table.i td:last-child { text-align:right; }
  table.tt { width:100%; border-collapse:collapse; font-size:8pt; }
  table.tt td { padding:0.8mm 0; }
  table.tt td:last-child { text-align:right; }
  .ft { text-align:center; font-size:8pt; line-height:1.8; margin-top:1mm; }
  .tg { text-align:center; font-size:7.5pt; font-style:italic; margin-top:2mm; line-height:1.6; }
</style></head><body>
<div class="page">
  <p class="c" style="margin:0;font-size:22pt;font-weight:bold;line-height:1.1;">VEREX</p>
  <p class="c store">S T O R E</p>
  <hr>
  <p class="stit">RECIBO DE VENTA</p>
  <table class="d">
    <tr><td class="lb">Fecha:</td><td>${fecha}&nbsp;&nbsp;${hora}</td></tr>
    <tr><td class="lb">Cliente:</td><td>${(v.cliente||"Sin nombre").replace(/</g,"&lt;")}</td></tr>
    <tr><td class="lb">Tel:</td><td>${(v.telefono||"—").replace(/</g,"&lt;")}</td></tr>
    <tr><td class="lb">Estado:</td><td>${v.estado==="credito"?"Crédito":"Contado"}</td></tr>
  </table>
  ${notaHTML}
  <hr class="t">
  <table class="i">
    <thead>
      <tr><th style="text-align:left;">PRODUCTO</th><th>CANT</th><th>PRECIO</th></tr>
      <tr><td colspan="3"><hr class="t" style="margin:0.5mm 0;"></td></tr>
    </thead>
    <tbody>${itemsHTML}</tbody>
  </table>
  <hr class="t">
  <table class="tt">${totalesHTML}</table>
  <hr>
  <div class="ft">WhatsApp: 7125-0725<br>Gracias por su preferencia</div>
  <p class="tg">El mundo es más maravilloso,<br>cuando brillas TÚ</p>
</div>
</body></html>`;
}

// Las fuentes del PDF (Helvetica / Courier) no tienen emoji ni flechas: si la
// nota los trae, salen como basura ("Ø=Ý") y jsPDF además reparte TODA la
// línea con las letras separadas. En pantalla y WhatsApp la nota se sigue
// mostrando con emoji; esto es solo para lo que se imprime. Devuelve una
// lista de líneas (cada cambio / pieza agregada se guardó en su propia línea).
// Los cambios de producto se condensan a "Cambio: CODIGO_VIEJO por CODIGO_NUEVO
// — +$8.88" (sin nombres, fecha ni motivo); la nota completa queda en la venta.
function notaLineasParaPDF(nota) {
    return String(nota || "").split("\n")
        .map(l => l.replace(/→/g, "por")
                   .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, "")
                   .replace(/[ \t]{2,}/g, " ").trim())
        .filter(Boolean)
        .map(l => {
            const m = l.match(/^Cambio el .+?: ".*?" \(([^)]+)\) por ".*?" \(([^)]+)\)(?: — diferencia \$(-?[\d.]+))?/);
            if (!m) return l;
            const dif = parseFloat(m[3]) || 0;
            return `Cambio: ${m[1]} por ${m[2]}` + (dif ? ` — ${dif > 0 ? "+" : "-"}$${Math.abs(dif).toFixed(2)}` : "");
        });
}

function _generarPDFReciboVD(v) {
    if (!window.jspdf?.jsPDF) { toast("⚠️ No se pudo cargar jsPDF"); return null; }
    const { jsPDF } = window.jspdf;

    let items = [];
    try { items = typeof v.items==="string" ? JSON.parse(v.items) : (v.items||[]); } catch(e){}

    const W  = 48;   // 48mm — área imprimible real de la POS-58 (driver desplaza ~5mm desde el borde físico)
    const mX = 2;    // margen horizontal mínimo
    const cX = W / 2;
    const lH = 4.5;  // interlineado base
    let y = 6;

    const descuento = parseFloat(v.descuento || 0);

    const costoEnvioRecibo = parseFloat(v.costoEnvio || 0);
    const envioGratis = costoEnvioRecibo === 0 && !!v.departamentoEnvio;

    // El alto del ticket se fija ANTES de crear el PDF, así que el texto que se
    // parte en varias líneas (nombres largos, nota) se mide acá con las mismas
    // fuentes que después se imprimen.
    const medir = new jsPDF({ unit:'mm', format:[W, 100] });
    medir.setFont("helvetica","normal"); medir.setFontSize(7);
    const altoItemsReal = items.reduce((s, it) =>
        s + medir.splitTextToSize(it.nombre || it.codigo || "—", W - mX*2 - 24).length * lH
          + (it.material ? lH - 0.5 : 0) + ((it.codigo||it.ref) ? lH - 0.5 : 0) + 2, 0);
    let notaLines = [];
    if (v.nota) {
        medir.setFont("helvetica","italic"); medir.setFontSize(7);
        notaLines = notaLineasParaPDF(v.nota).flatMap((l, i) => medir.splitTextToSize((i === 0 && !l.startsWith("Cambio:") ? "Nota: " : "") + l, W - mX*2));
    }

    // Calcular alto dinámico — la reserva fija por producto (12mm) se queda corta
    // cuando el nombre ocupa 3 líneas o más: se toma la que sea mayor. El +4 cubre
    // que las constantes de abajo (46 + footer 34) ya quedaban ~2.5mm cortas.
    const altoItems  = Math.max(altoItemsReal + 4, items.reduce((s, it) => s + 12 + (it.material ? 6 : 0) + ((it.codigo||it.ref) ? 6 : 0), 0));
    const altoCuerpo = 46 + altoItems + (v.estado==="credito" ? 10 : 0) + (notaLines.length ? notaLines.length * (lH - 0.5) + 5 : 0) + (descuento > 0 ? 9 : 0) + (envioGratis || costoEnvioRecibo > 0 ? 5 : 0);
    const H = altoCuerpo + 34; // footer ~34mm
    const doc = new jsPDF({ unit:'mm', format:[W, H], orientation:'portrait' });

    // ── HEADER ──────────────────────────────────────────────────────────
    doc.setFont("helvetica","normal"); doc.setFontSize(18); doc.setTextColor(0,0,0);
    doc.text("VEREX", cX, y, { align:"center" }); y += 5.5;
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    doc.text("S T O R E", cX, y, { align:"center" }); y += 4;

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);
    doc.line(mX, y, W-mX, y); y += 4;

    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(0,0,0);
    doc.text("RECIBO DE VENTA", cX, y, { align:"center" }); y += 4.5;

    // ── DATOS ───────────────────────────────────────────────────────────
    const fecha = new Date(v.fecha).toLocaleDateString("es-SV", { day:"2-digit", month:"2-digit", year:"numeric" });
    const hora  = new Date(v.fecha).toLocaleTimeString("es-SV", { hour:"2-digit", minute:"2-digit" });
    doc.setFontSize(7); doc.setTextColor(0,0,0);
    [
        ["Fecha:",   fecha + "  " + hora],
        ["Cliente:", v.cliente || "Sin nombre"],
        ["Tel:",     v.telefono || "—"],
        ["Estado:",  v.estado==="credito" ? "Crédito" : "Contado"],
    ].forEach(([label, val]) => {
        doc.setFont("helvetica","normal"); doc.text(label, mX, y);
        doc.text(String(val), mX+14, y);
        y += lH;
    });
    y += 2;

    // ── LÍNEA SEPARADORA ────────────────────────────────────────────────
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.3);
    doc.line(mX, y, W-mX, y); y += 3;

    // ── PRODUCTOS ───────────────────────────────────────────────────────
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    doc.text("PRODUCTO", mX, y);
    doc.text("CANT", W-28, y);
    doc.text("PRECIO", W-mX, y, { align:"right" });
    y += 1.5;
    doc.setDrawColor(200,200,200); doc.line(mX, y, W-mX, y); y += 3;

    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(0,0,0);
    items.forEach(it => {
        const nombre = it.nombre || it.codigo || "—";
        const qty    = parseInt(it.cantidad || 1);
        const pu     = parseFloat(it.precioUnitario || it.precio || 0);
        const total  = pu * qty;
        const nombreLines = doc.splitTextToSize(nombre, W - mX*2 - 24);
        nombreLines.forEach((l, i) => { doc.text(l, mX, y + i*lH); });
        doc.text(String(qty), W-28, y);
        doc.text("$"+total.toFixed(2), W-mX, y, { align:"right" });
        y += nombreLines.length * lH;
        if (it.material) {
            doc.setFontSize(6); doc.setTextColor(0,0,0);
            doc.text(it.material, mX, y);
            doc.setFontSize(7); doc.setTextColor(0,0,0);
            y += lH - 0.5;
        }
        const refItem = it.codigo || it.ref || "";
        if (refItem) {
            doc.setFontSize(6); doc.setTextColor(0,0,0);
            doc.text("Ref: " + refItem, mX, y);
            doc.setFontSize(7); doc.setTextColor(0,0,0);
            y += lH - 0.5;
        }
        y += 2;
    });

    // ── TOTALES ─────────────────────────────────────────────────────────
    doc.setDrawColor(200,200,200); doc.line(mX, y, W-mX, y); y += 3.5;
    const totalVenta = parseFloat(v.total || 0);
    const saldo      = parseFloat(v.saldoPendiente || 0);
    const pagado     = totalVenta - saldo;

    if (descuento > 0) {
        const subtotal = parseFloat(v.subtotal || 0) || (totalVenta + descuento);
        doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(0,0,0);
        doc.text("Subtotal:", mX, y); doc.text("$"+subtotal.toFixed(2), W-mX, y, { align:"right" }); y += 4;
        const descLabel = v.descuentoTipo === 'porcentaje'
            ? `Descuento (${v.descuentoValor || ''}%):`
            : "Descuento:";
        doc.text(descLabel, mX, y); doc.text("-$"+descuento.toFixed(2), W-mX, y, { align:"right" }); y += 4.5;
    }

    if (costoEnvioRecibo > 0) {
        doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(0,0,0);
        doc.text("Envío:", mX, y); doc.text("$"+costoEnvioRecibo.toFixed(2), W-mX, y, { align:"right" }); y += 4.5;
    } else if (envioGratis) {
        doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(0,0,0);
        doc.text("Envío:", mX, y); doc.text("GRATIS", W-mX, y, { align:"right" }); y += 4.5;
    }

    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(0,0,0);
    doc.text("TOTAL:", mX, y); doc.text("$"+totalVenta.toFixed(2), W-mX, y, { align:"right" }); y += 5;

    if (v.estado === "credito") {
        doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(0,0,0);
        doc.text("Pagado:", mX, y); doc.text("$"+pagado.toFixed(2), W-mX, y, { align:"right" }); y += 4.5;
        doc.text("Pendiente:", mX, y); doc.text("$"+saldo.toFixed(2), W-mX, y, { align:"right" }); y += 4.5;
    }
    y += 3;

    // ── NOTA (al pie, después de los totales) ───────────────────────────
    if (notaLines.length) {
        doc.setDrawColor(200,200,200); doc.setLineWidth(0.3);
        doc.line(mX, y, W-mX, y); y += 3.5;
        doc.setFont("helvetica","italic"); doc.setFontSize(7); doc.setTextColor(0,0,0);
        notaLines.forEach(l => { doc.text(l, mX, y); y += lH - 0.5; });
        y += 1.5;
    }

    // ── FOOTER ──────────────────────────────────────────────────────────
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);
    doc.line(mX, y, W-mX, y); y += 5;

    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(0,0,0);
    doc.text("WhatsApp: 7125-0725", cX, y, { align:"center" }); y += 4.5;
    doc.text("Gracias por su preferencia", cX, y, { align:"center" }); y += 5;

    doc.setFont("helvetica","italic"); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    doc.text("El mundo es más maravilloso,", cX, y, { align:"center" }); y += 4;
    doc.text("cuando brillas TÚ", cX, y, { align:"center" });

    return doc;
}

function descargarReciboVD(id) {
    const v = _historialVD.find(x => x.id === id);
    if (!v) return toast("⚠️ Venta no encontrada");
    const doc = _generarPDFReciboVD(v);
    if (!doc) return;
    doc.save("Recibo_" + (v.cliente||"cliente").replace(/ /g,"_") + ".pdf");
}

// ═══════════════════════════════════════════════════════════════════════
// IMPRESIÓN DIRECTA DEL RECIBO — impresora térmica POS-58 (o cualquier otra
// configurada en la app VEREX Impresión). A diferencia de descargarReciboVD
// (que solo descarga el PDF), este modal manda el recibo directo al
// servidor de impresión local (127.0.0.1:7891) para que salga impreso sin
// que el admin tenga que abrir el PDF descargado ni elegir impresora cada
// vez — y si esa app no está abierta, cae al diálogo de impresión del
// navegador como respaldo.
// ═══════════════════════════════════════════════════════════════════════
let _reciboModalBase64 = null;
let _reciboModalNombre = "";
let _reciboModalVData  = null;   // datos de la venta para generar HTML al imprimir

function abrirModalImprimirRecibo58(id) {
    const v = _historialVD.find(x => x.id === id);
    if (!v) return toast("⚠️ Venta no encontrada");
    const doc = _generarPDFReciboVD(v);
    if (!doc) return;

    const raw = doc.output('datauristring');
    _reciboModalBase64 = raw.split(',')[1];
    _reciboModalNombre = "Recibo_" + (v.cliente||"cliente").replace(/ /g,"_") + ".pdf";
    _reciboModalVData  = v;

    let m = document.getElementById('modal-recibo-imprimir');
    if (!m) {
        m = document.createElement('div');
        m.id = 'modal-recibo-imprimir';
        m.style.cssText = `
            position:fixed;inset:0;z-index:10000;
            background:rgba(0,0,0,0.82);display:flex;
            align-items:center;justify-content:center;
        `;
        m.innerHTML = `
            <div style="background:#111;border:1px solid #C9A84C;border-radius:16px;
                        padding:20px;width:360px;max-width:94vw;font-family:'DM Sans',sans-serif;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="color:#C9A84C;font-size:15px;font-weight:700;">🧾 Imprimir recibo</span>
                    <button onclick="cerrarModalRecibo()" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;line-height:1;">×</button>
                </div>
                <div id="recibo-modal-preview" style="border-radius:8px;overflow:hidden;margin-bottom:10px;min-height:200px;"></div>
                <div id="recibo-modal-status" style="font-size:11px;color:#888;margin-bottom:8px;min-height:14px;text-align:center;"></div>
                <button onclick="enviarReciboImpresoraTermica()"
                    style="width:100%;background:linear-gradient(135deg,#C9A84C,#a87d20);
                           color:#111;border:none;border-radius:10px;padding:12px;
                           font-size:13px;font-weight:700;cursor:pointer;margin-bottom:6px;">
                    🖨️ Imprimir en POS-58
                </button>
                <button onclick="descargarReciboModalActual()"
                    style="width:100%;background:none;color:#666;border:1px solid #333;
                           border-radius:10px;padding:8px;font-size:11px;cursor:pointer;">
                    ⬇️ Solo descargar PDF
                </button>
            </div>
        `;
        document.body.appendChild(m);
    }
    m.style.display = 'flex';
    document.getElementById('recibo-modal-preview').innerHTML = `
        <iframe src="data:application/pdf;base64,${_reciboModalBase64}"
            style="width:100%;height:280px;border:1px solid #333;border-radius:6px;background:#fff;"
            scrolling="no"></iframe>`;
    document.getElementById('recibo-modal-status').textContent = '';
}

function cerrarModalRecibo() {
    const m = document.getElementById('modal-recibo-imprimir');
    if (m) m.style.display = 'none';
}

function descargarReciboModalActual() {
    if (!_reciboModalBase64) return;
    const a = document.createElement('a');
    a.href = 'data:application/pdf;base64,' + _reciboModalBase64;
    a.download = _reciboModalNombre || 'recibo.pdf';
    a.click();
}

async function enviarReciboImpresoraTermica() {
    const status = document.getElementById('recibo-modal-status');
    if (!_reciboModalBase64) return;

    status.style.color = '#C9A84C';
    status.textContent = '⏳ Enviando a impresora…';

    let serverVivo = false;
    try {
        const ping = await fetch(PRINT_SERVER + '/ping', { signal: AbortSignal.timeout(3000) });
        serverVivo = ping.ok;
    } catch {}

    if (serverVivo) {
        try {
            const html = _reciboModalVData ? _generarHTMLReciboVD(_reciboModalVData) : null;
            if (!html) throw new Error('No se pudo generar el recibo HTML');
            const res = await fetch(PRINT_SERVER + '/print-html-58', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html, printerName: '' })
            });
            const json = await res.json();
            if (json.ok) {
                status.style.color = '#22c55e';
                status.textContent = '✅ Enviado — acepta el diálogo de impresión';
                setTimeout(() => { cerrarModalRecibo(); }, 1800);
            } else {
                status.style.color = '#ef4444';
                status.textContent = '⚠️ ' + (json.error || 'Error al enviar');
            }
        } catch(e) {
            status.style.color = '#ef4444';
            status.textContent = '⚠️ Error al enviar al servidor';
        }
    } else {
        // App de impresión no está abierta — imprimir directo desde el navegador
        imprimirPDFReciboNavegador(_reciboModalBase64);
        status.style.color = '#22c55e';
        status.textContent = '✅ Abriendo diálogo de impresión…';
        setTimeout(() => { cerrarModalRecibo(); }, 1200);
    }
}

function imprimirPDFReciboNavegador(pdfBase64) {
    const html = `<!DOCTYPE html><html><head>
<style>
  @page { size: 58mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; }
  embed { display: block; width: 100vw; height: 100vh; }
</style>
</head><body>
<embed src="data:application/pdf;base64,${pdfBase64}" type="application/pdf" width="100%" height="100%">
<script>
  window.onload = function() {
    setTimeout(function() { window.print(); }, 800);
  };
<\/script>
</body></html>`;
    const w = window.open('', '_blank', 'width=400,height=700');
    if (w) { w.document.write(html); w.document.close(); }
}

function agregarAlVD(codigo) {
    const prod = stockData.find(s => s.codigo === codigo);
    if (!prod) return;
    // Bodega + tienda: ambas son vendibles en Venta Directa (ver _onScanVD).
    const max = parseInt(prod.stock_bodega || 0) + parseInt(prod.stock_tienda || 0);
    if (!_vdCarrito[codigo]) _vdCarrito[codigo] = { prod, qty: 0 };
    if (_vdCarrito[codigo].qty >= max) { toast("⚠️ No hay más unidades disponibles"); return; }
    _vdCarrito[codigo].qty++;
    filtrarVD();
    renderCarritoVD();
    setTimeout(() => document.getElementById("card-carrito-vd").scrollIntoView({ behavior: "smooth", block: "start" }), 100);
}

function quitarDeVD(codigo) {
    if (!_vdCarrito[codigo]) return;
    _vdCarrito[codigo].qty--;
    if (_vdCarrito[codigo].qty <= 0) delete _vdCarrito[codigo];
    filtrarVD();
    renderCarritoVD();
}

function renderCarritoVD() {
    _renderBotonPromoGeneralVD();
    const items = Object.values(_vdCarrito);
    const cardC = document.getElementById("card-carrito-vd");
    const cardCl = document.getElementById("card-cliente-vd");
    if (!items.length) {
        cardC.style.display = "none";
        cardCl.style.display = "none";
        document.getElementById("fab-vd").style.display = "none";
        return;
    }
    cardC.style.display = "block";
    cardCl.style.display = "block";
    document.getElementById("fab-vd").style.display = "block";
    let total = 0;
    document.getElementById("lista-carrito-vd").innerHTML = items.map(({ prod, qty }) => {
        const sub = parseFloat(prod.precio || 0) * qty;
        total += sub;
        const fotoTag = prod.foto
            ? `<img src="${ikFoto(prod.foto,100)}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
            : `<div style="width:36px;height:36px;border-radius:8px;background:#2a2a2a;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;">💍</div>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #222;">
            ${fotoTag}
            <div style="flex:1;">
                <div style="font-size:12px;font-weight:700;color:#fff;">${prod.nombre}</div>
                <div style="font-size:11px;color:var(--plateado);">${prod.codigo} · $${parseFloat(prod.precio||0).toFixed(2)} c/u</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button class="qty-btn" onclick="quitarDeVD('${prod.codigo}')" style="border:none;background:#2a2a2a;color:#fff;">−</button>
                <span class="qty-num" style="font-weight:700;min-width:20px;text-align:center;">${qty}</span>
                <button class="qty-btn" onclick="agregarAlVD('${prod.codigo}')" style="border:none;background:#2a2a2a;color:#fff;">+</button>
            </div>
            <div style="font-size:13px;font-weight:700;color:var(--dorado);min-width:50px;text-align:right;">$${sub.toFixed(2)}</div>
        </div>`;
    }).join('');
    const descuento   = _calcularDescuento(total);
    const envio       = parseFloat(document.getElementById("vd-envio-val")?.value || 0) || 0;
    const totalFinal  = Math.max(0, total - descuento + envio);
    const val         = parseFloat(document.getElementById("vd-descuento-val")?.value || 0) || 0;

    document.getElementById("subtotal-vd").textContent = "$" + total.toFixed(2);
    document.getElementById("total-vd").textContent    = "$" + totalFinal.toFixed(2);

    const filaDesc = document.getElementById("fila-descuento-vd");
    const infoDesc = document.getElementById("vd-desc-info");
    if (descuento > 0) {
        filaDesc.style.display = "flex";
        document.getElementById("monto-desc-vd").textContent = "-$" + descuento.toFixed(2);
        infoDesc.style.display = "block";
        infoDesc.textContent = _vdModoDescuento === 'porcentaje'
            ? `${val}% de descuento = -$${descuento.toFixed(2)}`
            : `Descuento de $${descuento.toFixed(2)} aplicado`;
    } else {
        filaDesc.style.display = "none";
        infoDesc.style.display = "none";
    }

    const filaEnvio = document.getElementById("fila-envio-vd");
    const wrapDireccion = document.getElementById("vd-cliente-direccion-wrap");
    if (envio > 0) {
        filaEnvio.style.display = "flex";
        document.getElementById("monto-envio-vd").textContent = "+$" + envio.toFixed(2);
        if (wrapDireccion) wrapDireccion.style.display = "block";
    } else {
        filaEnvio.style.display = "none";
        if (wrapDireccion) wrapDireccion.style.display = "none";
    }
    calcularSaldoVD();
}

function seleccionarTipoVD(tipo) {
    _vdTipo = tipo;
    const esCredito = tipo === 'credito';
    document.getElementById("panel-credito-vd").style.display = esCredito ? "block" : "none";
    // El método de pago (efectivo/tarjeta/transferencia) solo aplica al pago
    // de contado — el crédito ya es su propia forma de pago (a plazos).
    const panelMP = document.getElementById("panel-metodo-pago-vd");
    if (panelMP) panelMP.style.display = esCredito ? "none" : "block";
    const btnCont = document.getElementById("btn-vd-contado");
    const btnCred = document.getElementById("btn-vd-credito");
    btnCont.style.background = !esCredito ? "linear-gradient(135deg,#0a3d20,#27ae60,#0e6b35,#52d68a,#0a3d20)" : "linear-gradient(135deg,#2a2a2a,#4a4a4a,#333,#555,#2a2a2a)";
    btnCont.style.color = !esCredito ? "#e8fff2" : "#888";
    btnCred.style.background = esCredito ? "linear-gradient(135deg,#4a2800,#cd8c52,#7a4a1a,#e8b07a,#4a2800)" : "linear-gradient(135deg,#2a2a2a,#4a4a4a,#333,#555,#2a2a2a)";
    btnCred.style.color = esCredito ? "#fff3e0" : "#888";
    if (esCredito) calcularSaldoVD();
}

function seleccionarMetodoPagoVD(metodo) {
    _vdMetodoPago = metodo;
    document.querySelectorAll(".btn-mp-vd").forEach(btn => {
        const activo = btn.id === "btn-mp-" + metodo;
        btn.style.background = activo ? "var(--dorado)" : "#2a2a2a";
        btn.style.color = activo ? "#000" : "#888";
    });
}

function calcularSaldoVD() {
    const subtotal    = Object.values(_vdCarrito).reduce((s, { prod, qty }) => s + parseFloat(prod.precio||0)*qty, 0);
    const descuento   = _calcularDescuento(subtotal);
    const envio       = parseFloat(document.getElementById("vd-envio-val")?.value || 0) || 0;
    const total       = Math.max(0, subtotal - descuento + envio);
    const enganche    = parseFloat(document.getElementById("vd-enganche")?.value || 0) || 0;
    const saldo       = Math.max(0, total - enganche);
    const el          = document.getElementById("vd-saldo-display");
    if (el) el.textContent = "$" + saldo.toFixed(2);
}

let _vdEnviando = false;
async function confirmarVentaDirecta() {
    // Sin este seguro, dos toques rápidos (o un primer toque que tarda en
    // responder y el usuario vuelve a tocar) registraban la MISMA venta dos
    // veces — mismo cliente, mismos productos, descontando el stock doble.
    if (_vdEnviando) return;
    const items = Object.values(_vdCarrito);
    if (!items.length) { toast("⚠️ Agrega al menos un producto"); return; }
    const nombre = document.getElementById("vd-cliente-nombre").value.trim();
    if (!nombre) { toast("⚠️ Ingresa el nombre del cliente"); return; }
    const tel    = document.getElementById("vd-cliente-tel").value.trim();
    const subtotal   = items.reduce((s, { prod, qty }) => s + parseFloat(prod.precio||0)*qty, 0);
    const descuento  = _calcularDescuento(subtotal);
    const costoEnvio = parseFloat(document.getElementById("vd-envio-val")?.value || 0) || 0;
    const direccionEnvio = (document.getElementById("vd-cliente-direccion")?.value || "").trim();
    const departamentoEnvio = (document.getElementById("vd-cliente-departamento")?.value || "").trim();
    if (costoEnvio > 0 && !direccionEnvio) { toast("⚠️ Ingresa la dirección de envío"); return; }
    if (costoEnvio > 0 && !departamentoEnvio) { toast("⚠️ Selecciona el departamento"); return; }
    const total      = Math.max(0, subtotal - descuento + costoEnvio);
    const enganche   = _vdTipo === 'credito' ? (parseFloat(document.getElementById("vd-enganche").value)||0) : total;
    const saldo      = _vdTipo === 'credito' ? Math.max(0, total - enganche) : 0;
    const nota     = _vdTipo === 'credito' ? (document.getElementById("vd-nota-credito").value.trim()) : "";

    const payload = {
        accion: "REGISTRAR_VENTA_DIRECTA",
        id: "VD_" + Date.now(),
        fecha: new Date().toISOString(),
        cliente: nombre,
        telefono: tel,
        direccionEnvio,
        departamentoEnvio,
        items: items.map(({ prod, qty }) => ({ codigo: prod.codigo, nombre: prod.nombre, precio: prod.precio, cantidad: qty, material: prod.material || '' })),
        subtotal,
        descuento,
        descuentoTipo: _vdModoDescuento,
        descuentoValor: parseFloat(document.getElementById("vd-descuento-val")?.value || 0) || 0,
        costoEnvio,
        total,
        tipo: _vdTipo,
        // Crédito ya es su propia forma de pago (a plazos) — el selector de
        // efectivo/tarjeta/transferencia solo aplica cuando es contado.
        metodoPago: _vdTipo === 'credito' ? 'credito' : _vdMetodoPago,
        enganche,
        saldoPendiente: saldo,
        nota,
        estado: saldo > 0 ? "credito" : "pagado",
        empresaEnvio: _vdEmpresaEnvio || ""
    };

    console.log("[VD] Payload enviado:", JSON.stringify(payload));
    _vdEnviando = true;
    const btnConfirmarVD = document.getElementById("btn-confirmar-venta-vd");
    if (btnConfirmarVD) { btnConfirmarVD.disabled = true; btnConfirmarVD.style.opacity = ".6"; btnConfirmarVD.textContent = "⏳ Guardando..."; }
    try {
        const resp = await apiPost(payload);
        console.log("[VD] Respuesta recibida:", JSON.stringify(resp));
        if (resp.ok) {
            toast("✅ Venta registrada" + (saldo > 0 ? " — crédito $" + saldo.toFixed(2) : ""));
            if (resp.itemsSinStock && resp.itemsSinStock.length > 0) {
                setTimeout(() => {
                    alert("⚠️ AVISO — Stock NO descontado\n\nLos siguientes productos no se encontraron en la tabla de stock y su inventario NO fue actualizado:\n\n" + resp.itemsSinStock.join(", ") + "\n\nCorrige el stock manualmente desde el panel de administración.");
                }, 500);
            }
            if (resp.faltantes && resp.faltantes.length > 0) {
                setTimeout(() => {
                    alert("⚠️ AVISO — Stock insuficiente\n\nLa venta se registró, pero el sistema tenía menos unidades de las vendidas (solo se descontó lo que había):\n\n" +
                        resp.faltantes.map(f => `• ${f.codigo}: vendidas ${f.vendido}, descontadas ${f.descontado}`).join("\n") +
                        "\n\nRevisa el inventario de esos productos (pudo venderse a la vez por otro canal o el stock estaba desactualizado).");
                }, 700);
            }
            // Si la venta salió de un pedido de catálogo, ese pedido ya quedó cumplido (deja de ser restaurable)
            if (typeof _vdLeadOrigenId !== "undefined" && _vdLeadOrigenId) {
                const leadOrig = leadsData.find(l => l.id === _vdLeadOrigenId);
                if (leadOrig && items.some(i => i.prod.codigo === leadOrig.codigo)) {
                    apiPost({ accion: "CERRAR_LEAD_VD", id: _vdLeadOrigenId }).catch(() => {});
                    leadOrig.pendienteVD = false;
                    leadOrig.historial = [...(leadOrig.historial || []), { estado: "cancelado", fecha: new Date().toISOString(), motivo: "Venta directa registrada" }];
                    _vdLeadOrigenId = null;
                    renderPedidosHub();
                }
            }
            generarPDFVentaDirecta(payload, []);
            // Reflejar en memoria el mismo descuento que hace el worker
            // (REGISTRAR_VENTA_DIRECTA): primero de tienda, luego de bodega.
            // Antes esto solo restaba de stock_bodega, así que una venta con
            // stock solo en tienda se veía correcta en el recibo pero la
            // grilla seguía mostrando el stock de tienda viejo hasta recargar.
            items.forEach(({ prod, qty }) => {
                const s = stockData.find(s => s.codigo === prod.codigo);
                if (s) {
                    const tiendaAntes = parseInt(s.stock_tienda||0);
                    const descTienda  = Math.min(tiendaAntes, qty);
                    s.stock_tienda = Math.max(0, tiendaAntes - descTienda);
                    s.stock_bodega = Math.max(0, parseInt(s.stock_bodega||0) - (qty - descTienda));
                }
            });
            _vdCarrito = {};
            document.getElementById("vd-cliente-nombre").value = "";
            document.getElementById("vd-cliente-tel").value = "";
            const elDir = document.getElementById("vd-cliente-direccion");
            if (elDir) elDir.value = "";
            const elDep = document.getElementById("vd-cliente-departamento");
            if (elDep) elDep.value = "";
            const elEng = document.getElementById("vd-enganche");
            const elNot = document.getElementById("vd-nota-credito");
            const elEnvio = document.getElementById("vd-envio-val");
            if (elEng) elEng.value = "";
            if (elNot) elNot.value = "";
            if (elEnvio) elEnvio.value = "";
            selEmpresaEnvio('');
            seleccionarTipoVD('contado');
            filtrarVD();
            renderCarritoVD();
            // Abrir Historial filtrado en "Crédito" si la venta quedó a crédito
            // (el panel propio de "Créditos Pendientes" ya no existe, se
            // fusionó con Historial).
            if (saldo > 0) {
                abrirHistorialSoloPendientes();
            }
        } else {
            const msg = resp.error || "no se pudo registrar";
            alert("⚠️ Error al guardar venta:\n" + msg + "\n\nVerifica que el Worker y el Apps Script estén actualizados.");
        }
    } catch(e) {
        alert("⚠️ Error de conexión al guardar la venta:\n" + e.message);
    } finally {
        _vdEnviando = false;
        if (btnConfirmarVD) { btnConfirmarVD.disabled = false; btnConfirmarVD.style.opacity = "1"; btnConfirmarVD.textContent = "✅ Confirmar Venta"; }
    }
}

async function cargarCreditosPendientes() {
    const el = document.getElementById("lista-creditos-vd");
    if (el) el.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando créditos...</p>';
    try {
        const resp = await apiPost({ accion: "GET_VENTAS_DIRECTAS", estado: "credito" });
        console.log("[CREDITOS] Respuesta GET_VENTAS_DIRECTAS:", JSON.stringify(resp));
        if (!resp.ok) {
            if (el) el.innerHTML = '<p style="color:#e85555;font-size:13px;">Error: ' + (resp.error || "no se pudo obtener la lista") + '</p>';
            return;
        }
        _creditosVD = (resp.ventas || []).filter(v => parseFloat(v.saldoPendiente||0) > 0);
        renderCreditosPendientes();
    } catch(e) {
        console.error("[CREDITOS] Error:", e);
        if (el) el.innerHTML = '<p style="color:#e85555;font-size:13px;">Error de conexión: ' + e.message + '</p>';
    }
}

function renderCreditosPendientes() {
    // El panel propio de "Créditos Pendientes" ya no existe (se fusionó con
    // el Historial + filtro "Crédito") — _creditosVD se sigue cargando en
    // segundo plano solo como respaldo de datos para verEstadoCuenta/
    // enviarWAEstadoCuenta, sin necesidad de dibujar nada acá.
    const el = document.getElementById("lista-creditos-vd");
    if (!el) return;
    if (!_creditosVD.length) { el.innerHTML = '<p style="color:var(--plateado);font-size:13px;">Sin créditos pendientes.</p>'; return; }
    el.innerHTML = _creditosVD.map(v => {
        const fecha  = new Date(v.fecha).toLocaleDateString("es-SV");
        const saldo  = parseFloat(v.saldoPendiente||0);
        const total  = parseFloat(v.total||0);
        const pagado = total - saldo;
        const pct    = total > 0 ? Math.round((pagado/total)*100) : 0;
        return `<div style="background:#111;border:1px solid #2a2a2a;border-radius:10px;padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                <div>
                    <div style="font-size:14px;font-weight:700;color:#fff;">${sanitizar(v.cliente)}</div>
                    <div style="font-size:11px;color:var(--plateado);">${fecha} · Total: $${total.toFixed(2)}</div>
                    ${v.nota ? `<div style="font-size:11px;color:#666;margin-top:2px;">${sanitizar(v.nota)}</div>` : ''}
                </div>
                <div style="text-align:right;">
                    <div style="font-size:16px;font-weight:700;color:#e85555;">$${saldo.toFixed(2)}</div>
                    <div style="font-size:10px;color:var(--plateado);">pendiente</div>
                </div>
            </div>
            <div style="background:#1a1a1a;border-radius:6px;height:6px;margin-bottom:10px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#27ae60,#52d68a);border-radius:6px;transition:width 0.5s;"></div>
            </div>
            <div style="font-size:10px;color:var(--plateado);margin-bottom:10px;">Pagado: $${pagado.toFixed(2)} (${pct}%)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
                <button onclick="abrirModalAbono('${v.id}')" class="btn"
                    style="background:linear-gradient(135deg,#0a4a6b,#0ea5e9,#0369a1,#38bdf8,#0a4a6b);color:#e0f7ff;font-size:11px;font-weight:700;padding:8px;">
                    💰 Abono
                </button>
                <button onclick="verEstadoCuenta('${v.id}')" class="btn"
                    style="background:linear-gradient(135deg,#4a2800,#cd8c52,#7a4a1a,#e8b07a,#4a2800);color:#fff3e0;font-size:11px;font-weight:700;padding:8px;">
                    📄 PDF
                </button>
                <button onclick="enviarWAEstadoCuenta('${v.id}')" class="btn"
                    style="background:linear-gradient(135deg,#075e54,#25D366,#128C7E,#34eb7a,#075e54);color:#fff;border:none;font-size:11px;font-weight:700;padding:8px;box-shadow:0 2px 8px rgba(37,211,102,0.5);">
                    💬 WA
                </button>
            </div>
        </div>`;
    }).join('');
}

function abrirModalAbono(ventaId) {
    _abonoVentaId = ventaId;
    const venta = _creditosVD.find(v => v.id === ventaId);
    const saldo = venta ? parseFloat(venta.saldoPendiente||0).toFixed(2) : "?";
    const monto = prompt(`Registrar abono para ${venta?.cliente||''}\nSaldo pendiente: $${saldo}\n\n¿Cuánto abona?`);
    if (!monto || isNaN(parseFloat(monto))) return;
    confirmarAbono(ventaId, parseFloat(monto));
}

async function confirmarAbono(ventaId, monto) {
    try {
        const resp = await apiPost({ accion: "REGISTRAR_ABONO", ventaId, monto, fecha: new Date().toISOString() });
        if (resp.ok) {
            toast("✅ Abono de $" + monto.toFixed(2) + " registrado");
            cargarCreditosPendientes();
        } else {
            toast("⚠️ Error: " + (resp.error || "no se pudo registrar"));
        }
    } catch(e) { toast("⚠️ Error de conexión"); }
}

// ── QR SCANNER (cámara real) ─────────────────────────────────────────
// Usa el motor compartido abrirScannerQR (jsQR) en vez de BarcodeDetector —
// esa API nativa no existe en todos los navegadores/teléfonos (Safari/iOS,
// varios Android con WebView viejo), lo que hacía que el botón "no hiciera
// nada" en esos casos. jsQR funciona igual en cualquier navegador moderno.
function abrirQRVD() {
    abrirScannerQR(_onScanVD, "📷 Escanear producto");
}

// ── PDF VENTA DIRECTA ─────────────────────────────────────────────────
// Formato fijo pedido para los recibos: "24-SEP-2026" — día en dos dígitos,
// mes abreviado en español y mayúsculas (sin punto), año completo. No se usa
// toLocaleDateString con month:"short" porque el resultado varía según el
// navegador/entorno (con o sin punto, con o sin mayúscula), y acá se quiere
// siempre el mismo formato exacto en el recibo impreso.
const MESES_RECIBO_VD = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function formatearFechaReciboVD(fecha) {
    if (!fecha) return "";
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(d)) return "";
    return String(d.getDate()).padStart(2, "0") + "-" + MESES_RECIBO_VD[d.getMonth()] + "-" + d.getFullYear();
}

// Despachador — decide el formato según lo elegido en "Venta Directa" (select
// persistido en localStorage). Por defecto sigue siendo A5, así que nada
// cambia para quien no toque el selector nuevo.
async function generarPDFVentaDirecta(venta, abonos) {
    const formato = localStorage.getItem("verex-formato-recibo") || "a5";
    if (formato === "58mm") return generarPDFVentaDirecta58mm(venta, abonos);
    return generarPDFVentaDirectaA5(venta, abonos);
}

async function generarPDFVentaDirectaA5(venta, abonos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });
    const W = 148, pad = 14;
    let y = 14;

    // Modo térmico: forzar todo texto en negro puro independientemente del color configurado
    const _origSetTextColor = doc.setTextColor.bind(doc);
    doc.setTextColor = (...args) => _origSetTextColor(0, 0, 0);

    // Salto de página de seguridad — con ventas que acumulan varios cambios/
    // piezas agregadas/abonos el contenido puede crecer más de lo que cabe
    // en una A5 (210mm); sin esto, el saldo/historial/frase final quedaban
    // cortados en vez de pasar a una segunda hoja.
    const checkPage = (needed) => {
        if (y + needed > 195) { doc.addPage('a5'); y = 14; }
    };

    // Encabezado — sin franja negra
    doc.setFont('courier', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(201, 168, 76);
    doc.text('VEREX', W/2, 14, { align: 'center' });
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const titulo = parseFloat(venta.saldoPendiente||0) > 0 ? 'ESTADO DE CUENTA' : 'RECIBO DE VENTA';
    doc.text(titulo, W/2, 20, { align: 'center' });
    doc.setTextColor(39, 174, 96);
    doc.text('WhatsApp: 7125-0725', W/2, 26, { align: 'center' });
    // Línea dorada decorativa
    doc.setDrawColor(201, 168, 76);
    doc.setLineWidth(0.5);
    doc.line(pad, 30, W - pad, 30);
    y = 38;

    // Info venta
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    const fechaVenta = formatearFechaReciboVD(venta.fecha);
    doc.text('Fecha de compra: ' + fechaVenta, pad, y);
    const refCorta = String(venta.id || '').replace('VD_','').slice(-6);
    doc.text('Ref: ' + refCorta, W - pad, y, { align: 'right' });
    y += 7;

    // Cliente
    doc.setFillColor(245, 245, 245);
    const boxAltura = venta.departamentoEnvio ? 20 : 14;
    doc.roundedRect(pad - 2, y - 4, W - pad*2 + 4, boxAltura, 2, 2, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text('Cliente: ' + (venta.cliente || ''), pad, y + 3);
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    if (venta.telefono) doc.text('Tel: ' + venta.telefono, pad, y + 9);
    if (venta.departamentoEnvio) doc.text('Envio: ' + venta.departamentoEnvio, pad, y + 15, { maxWidth: W - pad*2 });
    y += boxAltura + 6;

    // Tabla productos
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(201, 168, 76);
    doc.text('PRODUCTOS', pad, y);
    y += 5;
    doc.setDrawColor(201, 168, 76);
    doc.setLineWidth(0.3);
    doc.line(pad, y, W - pad, y);
    y += 4;

    let items = [];
    try { items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || []); } catch(_) {}
    doc.setFont('courier', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 30, 30);
    items.forEach(item => {
        checkPage(20);
        const qty    = parseInt(item.cantidad || 1);
        const precio = parseFloat(item.precio || 0);
        const sub    = (qty * precio).toFixed(2);
        const nombre = (item.nombre || '').substring(0, 32);
        const ref    = item.codigo || item.ref || '';
        doc.setFont('courier', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(30, 30, 30);
        doc.text(nombre, pad, y);
        doc.text(`${qty} x $${precio.toFixed(2)}`, 108, y, { align: 'right' });
        doc.text(`$${sub}`, W - pad, y, { align: 'right' });
        const material = item.material || '';
        if (material) {
            y += 4.5;
            doc.setFontSize(9.5);
            doc.setTextColor(150, 150, 150);
            doc.text(material, pad, y);
            doc.setFontSize(10.5);
            doc.setTextColor(30, 30, 30);
        }
        if (ref) {
            y += 4.5;
            doc.setFontSize(9.5);
            doc.setTextColor(150, 150, 150);
            doc.text(`Ref: ${ref}`, pad, y);
            doc.setFontSize(10.5);
            doc.setTextColor(30, 30, 30);
        }
        // Pieza que entró después de la compra original (cambio o agregado) —
        // se marca con su propia fecha para que el estado de cuenta no dé a
        // entender que todo se compró el mismo día.
        const fechaExtra = item.fechaAgregado || item.fechaCambio;
        if (fechaExtra) {
            y += 4.5;
            const etiquetaExtra = item.fechaAgregado ? 'agregado' : 'cambiado';
            const fechaTxt = formatearFechaReciboVD(fechaExtra);
            doc.setFont('courier', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(160, 160, 160);
            doc.text(`(${etiquetaExtra} ${fechaTxt})`, pad, y);
            doc.setFont('courier', 'bold');
            doc.setFontSize(10.5);
            doc.setTextColor(30, 30, 30);
        }
        y += 6.5;
    });

    doc.setDrawColor(220, 220, 220);
    doc.line(pad, y, W - pad, y);
    y += 6;

    // Totales
    const total   = parseFloat(venta.total || 0);
    const enganche = parseFloat(venta.enganche || 0);
    const totalAbonado = abonos.reduce((s, a) => s + parseFloat(a.monto||0), 0);
    const pagado  = venta.tipo === 'credito' ? enganche + totalAbonado : total;
    const saldo   = Math.max(0, total - pagado);

    // fechaSub (opcional): fecha chica en gris pegada justo a la izquierda del
    // monto — se calcula su ancho con getTextWidth() para no adivinar cuánto
    // espacio deja libre el monto (varía según cuántos dígitos tenga).
    const filaTotal = (label, valor, bold, color, negativo, fechaSub) => {
        doc.setFont('courier', 'bold');
        if (color) doc.setTextColor(...color); else doc.setTextColor(30, 30, 30);
        doc.setFontSize(11);
        doc.text(label, pad, y);
        const montoTxt = (negativo ? '-' : '') + '$' + Math.abs(parseFloat(valor)).toFixed(2);
        doc.text(montoTxt, W - pad, y, { align: 'right' });
        if (fechaSub) {
            const anchoMonto = doc.getTextWidth(montoTxt);
            doc.setFont('courier', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(150, 150, 150);
            doc.text(fechaSub, W - pad - anchoMonto - 3, y, { align: 'right' });
        }
        y += 6.5;
    };
    // Si se aplicó descuento, mostrar el desglose (subtotal → descuento →
    // total) en vez de solo el total ya rebajado — así el cliente ve
    // exactamente cuánto se le descontó.
    const descuento = parseFloat(venta.descuento || 0);
    if (descuento > 0) {
        const subtotal = venta.subtotal != null ? parseFloat(venta.subtotal) : (total + descuento);
        filaTotal('Subtotal:', subtotal, false, [80,80,80]);
        filaTotal('Descuento:', descuento, false, [201,60,60], true);
    }
    const costoEnvio = parseFloat(venta.costoEnvio || 0);
    if (costoEnvio > 0) {
        filaTotal('Envío:', costoEnvio, false, [14,165,233]);
    } else if (venta.departamentoEnvio) {
        // Hubo envío (tiene dirección) pero sin costo — decir "GRATIS" en vez
        // de omitir la línea, para que quede claro que sí se consideró.
        doc.setFont('courier', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(39, 174, 96);
        doc.text('Envío:', pad, y);
        doc.text('GRATIS', W - pad, y, { align: 'right' });
        y += 6.5;
    }
    filaTotal('Total de compra:', total, true, [30,30,30]);
    if (venta.tipo === 'credito') {
        // El enganche se paga el mismo día de la venta — no hay un campo de
        // fecha propio para el enganche, así que se usa venta.fecha.
        filaTotal('Enganche pagado:', enganche, false, [39,174,96], false, enganche > 0 ? formatearFechaReciboVD(venta.fecha) : null);
        if (totalAbonado > 0) filaTotal('Abonos realizados:', totalAbonado, false, [39,174,96]);
        filaTotal('Saldo pendiente:', saldo, true, saldo > 0 ? [201,60,60] : [39,174,96]);
    }
    y += 4;

    // Historial de abonos — fecha a la par del monto, en la misma línea
    if (abonos.length > 0) {
        checkPage(14 + abonos.length * 5);
        doc.setFont('courier', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(201, 168, 76);
        doc.text('HISTORIAL DE PAGOS', pad, y);
        y += 5;
        doc.setDrawColor(201, 168, 76);
        doc.line(pad, y, W - pad, y);
        y += 4;
        abonos.forEach((ab, i) => {
            checkPage(5);
            const fa = formatearFechaReciboVD(ab.fecha);
            doc.setFont('courier', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(30, 30, 30);
            doc.text(`Abono ${i+1}${fa ? '  ·  ' + fa : ''}`, pad, y);
            doc.setTextColor(39, 174, 96);
            doc.text(`+$${parseFloat(ab.monto).toFixed(2)}`, W - pad, y, { align: 'right' });
            y += 5;
        });
        y += 1;
    }

    // Notas — cada cambio/pieza agregada quedó como su propia línea (separadas
    // por "\n" al guardarse), así que se listan una por una en formato
    // compacto en vez de un párrafo largo — más ordenado y ocupa menos.
    if (venta.nota) {
        // La fuente Courier del PDF no soporta emoji (🔄, ➕, etc.) — ver notaLineasParaPDF.
        const notaItems = notaLineasParaPDF(venta.nota);
        if (notaItems.length) {
            checkPage(9);
            doc.setFont('courier', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(180, 150, 60);
            doc.text('NOTAS', pad, y);
            y += 4;
            doc.setDrawColor(220, 220, 220);
            doc.line(pad, y, W - pad, y);
            y += 4;
            notaItems.forEach(item => {
                doc.setFont('courier', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(110, 110, 110);
                const lineas = doc.splitTextToSize('• ' + item, W - pad*2 - 2);
                checkPage(lineas.length * 3.3 + 1);
                lineas.forEach(linea => { doc.text(linea, pad + 2, y); y += 3.3; });
                y += 1;
            });
            y += 3;
        }
    }

    checkPage(16);
    // Saldo destacado si hay pendiente
    if (saldo > 0) {
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.8);
        doc.roundedRect(pad - 2, y - 4, W - pad*2 + 4, 12, 2, 2, 'S');
        doc.setFont('courier', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(30, 60, 140);
        doc.text('SALDO PENDIENTE: $' + saldo.toFixed(2), W/2, y + 4, { align: 'center' });
        y += 16;
    } else {
        doc.setDrawColor(201, 168, 76);
        doc.setLineWidth(0.5);
        doc.roundedRect(pad - 2, y - 4, W - pad*2 + 4, 12, 2, 2, 'S');
        doc.setFont('courier', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(201, 168, 76);
        doc.text('PAGADO COMPLETAMENTE', W/2, y + 4, { align: 'center' });
        y += 16;
    }

    checkPage(18);
    // Footer
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text('Gracias por su preferencia  VEREX', W/2, y + 1, { align: 'center' });
    y += 8;
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 150, 180);
    const tagline = 'El mundo es mas maravilloso cuando brillas TU';
    const tw = doc.getTextWidth(tagline);
    const tx = (W - tw) / 2;
    doc.text(tagline, tx, y);
    // Corazón pequeño y dorado después del texto
    const hx = tx + tw + 2;
    const hy = y - 1.2;
    doc.setFillColor(201, 168, 76);
    doc.circle(hx - 0.7, hy, 0.8, 'F');
    doc.circle(hx + 0.7, hy, 0.8, 'F');
    doc.triangle(hx - 1.4, hy + 0.4, hx + 1.4, hy + 0.4, hx, hy + 2.1, 'F');

    const nombreArchivo = 'VEREX_' + (venta.cliente||'Cliente').replace(/ /g,'_') + '_' + (venta.id||'').replace('VD_','') + '.pdf';

    // En móvil: compartir directamente (el usuario elige WhatsApp u otra app)
    if (navigator.share && navigator.canShare) {
        const blob = doc.output('blob');
        const file = new File([blob], nombreArchivo, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: 'Comprobante VEREX',
                    text: 'Tu comprobante de compra VEREX — WhatsApp: 7125-0725'
                });
                return;
            } catch(e) {
                // Usuario canceló el share — igual descargar
            }
        }
    }
    doc.save(nombreArchivo);
}

// Versión compacta para impresora térmica de 58mm — mismo contenido que la
// A5 (cliente, productos con código/material, totales, footer), reacomodado
// en una sola columna angosta. Alto dinámico según cuántos productos tenga.
async function generarPDFVentaDirecta58mm(venta, abonos) {
    const { jsPDF } = window.jspdf;
    const W = 58, pad = 4, cX = W/2;

    let items = [];
    try { items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || []); } catch(_) {}
    const total    = parseFloat(venta.total || 0);
    const enganche = parseFloat(venta.enganche || 0);
    const totalAbonado = abonos.reduce((s, a) => s + parseFloat(a.monto||0), 0);
    const pagado = venta.tipo === 'credito' ? enganche + totalAbonado : total;
    const saldo  = Math.max(0, total - pagado);
    const costoEnvio = parseFloat(venta.costoEnvio || 0);

    const descuento = parseFloat(venta.descuento || 0);

    // Estimar alto: header + cliente + 1 línea por item (+2 si tiene material/ref/fecha) + totales + footer
    const lineasItems = items.reduce((s,it) => s + 2 + (it.material?1:0) + ((it.codigo||it.ref)?1:0) + ((it.fechaAgregado||it.fechaCambio)?1:0), 0);
    const alturaEstim = 26                                    // header
        + 10 + (venta.departamentoEnvio ? 4 : 0)               // cliente
        + 6 + lineasItems*4                                    // productos
        + 6 + (descuento>0?8:0) + (costoEnvio>0?4:0) + 4 + (venta.tipo==='credito' ? 8+(abonos.length*3.6) : 0) // totales
        + 10 + 14;                                             // footer + margen
    const H = Math.max(70, Math.ceil(alturaEstim));
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait' });
    let y = 8;

    doc.setFont('courier', 'bold'); doc.setFontSize(15); doc.setTextColor(0,0,0);
    doc.text('VEREX', cX, y, { align:'center' }); y += 4;
    doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    doc.text('S T O R E', cX, y, { align:'center' }); y += 4;
    doc.setDrawColor(150,150,150); doc.setLineDashPattern([0.6,0.6],0); doc.setLineWidth(0.2);
    doc.line(pad, y, W-pad, y); y += 4;
    doc.setFont('courier','bold'); doc.setFontSize(8.5); doc.setTextColor(0,0,0);
    doc.text(saldo > 0 ? 'ESTADO DE CUENTA' : 'RECIBO DE VENTA', cX, y, { align:'center' }); y += 5;
    doc.line(pad, y, W-pad, y); y += 4.5;

    doc.setFontSize(7.5); doc.setTextColor(30,30,30);
    const fechaVenta = venta.fecha ? formatearFechaReciboVD(venta.fecha) + ' ' + new Date(venta.fecha).toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit'}) : '';
    doc.text('Fecha: ' + fechaVenta, pad, y); y += 4;
    doc.text('Cliente: ' + (venta.cliente||''), pad, y); y += 4;
    if (venta.telefono) { doc.text('Tel: ' + venta.telefono, pad, y); y += 4; }
    if (venta.departamentoEnvio) { doc.text('Envio: ' + venta.departamentoEnvio, pad, y); y += 4; }
    doc.line(pad, y, W-pad, y); y += 4.5;

    items.forEach(item => {
        const qty = parseInt(item.cantidad||1);
        const precio = parseFloat(item.precio||0);
        const sub = (qty*precio).toFixed(2);
        doc.setFont('courier','bold'); doc.setFontSize(7.5); doc.setTextColor(0,0,0);
        const nombreLineas = doc.splitTextToSize(item.nombre||'', W - pad*2);
        doc.text(nombreLineas[0] || '', pad, y); y += 3.8;
        const refMat = [item.codigo||item.ref||'', item.material||''].filter(Boolean).join(' · ');
        if (refMat) {
            doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(120,120,120);
            doc.text(refMat, pad, y, { maxWidth: W - pad*2 }); y += 3.6;
        }
        doc.setFont('courier','bold'); doc.setFontSize(7.5); doc.setTextColor(30,30,30);
        doc.text(`${qty} x $${precio.toFixed(2)}`, pad, y);
        doc.text(`$${sub}`, W-pad, y, { align:'right' }); y += 4.2;
        const fechaExtra58 = item.fechaAgregado || item.fechaCambio;
        if (fechaExtra58) {
            const etq = item.fechaAgregado ? 'Agregado' : 'Cambiado';
            const ftx = formatearFechaReciboVD(fechaExtra58);
            doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(201,168,76);
            doc.text(`↳ ${etq} ${ftx}`, pad, y); y += 3.6;
        }
    });

    doc.setDrawColor(150,150,150); doc.line(pad, y, W-pad, y); y += 4.5;

    doc.setFont('courier','bold'); doc.setFontSize(7.5); doc.setTextColor(30,30,30);
    if (descuento > 0) {
        const subtotal = parseFloat(venta.subtotal || 0) || (total + descuento);
        doc.text('Subtotal', pad, y); doc.text('$'+subtotal.toFixed(2), W-pad, y, {align:'right'}); y += 4;
        const descLabel = venta.descuentoTipo === 'porcentaje'
            ? `Descuento (${venta.descuentoValor||''}%):`
            : 'Descuento:';
        doc.setTextColor(180,60,60);
        doc.text(descLabel, pad, y); doc.text('-$'+descuento.toFixed(2), W-pad, y, {align:'right'}); y += 4;
        doc.setTextColor(30,30,30);
    }
    if (costoEnvio > 0) { doc.text('Envio', pad, y); doc.text('$'+costoEnvio.toFixed(2), W-pad, y, {align:'right'}); y += 4; }
    doc.setFontSize(9);
    doc.text('TOTAL', pad, y); doc.text('$'+total.toFixed(2), W-pad, y, {align:'right'}); y += 5;
    if (venta.tipo === 'credito') {
        doc.setFont('courier','normal'); doc.setFontSize(7); doc.setTextColor(30,30,30);
        doc.text('Enganche: $'+enganche.toFixed(2), pad, y);
        // Fecha del enganche a la par del monto — el enganche se paga el
        // mismo día de la venta, así que se usa venta.fecha.
        if (enganche > 0) {
            doc.setFontSize(6); doc.setTextColor(150,150,150);
            doc.text(formatearFechaReciboVD(venta.fecha), W - pad, y, { align: 'right' });
            doc.setTextColor(30,30,30);
        }
        y += 3.6;
        abonos.forEach((ab,i) => {
            const faTerm = formatearFechaReciboVD(ab.fecha);
            doc.setFont('courier','normal'); doc.setFontSize(7); doc.setTextColor(30,30,30);
            doc.text(`Abono ${i+1}${faTerm ? ' ('+faTerm+')' : ''}`, pad, y);
            doc.text(`$${parseFloat(ab.monto).toFixed(2)}`, W-pad, y, {align:'right'});
            y += 3.6;
        });
        doc.setFont('courier','bold'); doc.setTextColor(saldo>0?200:0,saldo>0?0:120,0);
        doc.text('SALDO: $'+saldo.toFixed(2), pad, y); y += 5;
    }

    doc.setDrawColor(150,150,150); doc.line(pad, y, W-pad, y); y += 4.5;
    doc.setFont('courier','normal'); doc.setFontSize(7); doc.setTextColor(30,30,30);
    doc.text('Contra entrega, efectivo', cX, y, { align:'center' }); y += 3.6;
    doc.text('WhatsApp: 7125-0725', cX, y, { align:'center' }); y += 5;
    doc.setFont('courier','normal'); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    const tag1 = 'El mundo es mas maravilloso,';
    const tag2 = 'cuando brillas TU';
    doc.text(tag1, cX, y, { align:'center' }); y += 3.4;
    doc.text(tag2, cX, y, { align:'center' });

    const nombreArchivo = 'VEREX_' + (venta.cliente||'Cliente').replace(/ /g,'_') + '_' + (venta.id||'').replace('VD_','') + '.pdf';
    if (navigator.share && navigator.canShare) {
        const blob = doc.output('blob');
        const file = new File([blob], nombreArchivo, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Comprobante VEREX', text: 'Tu comprobante de compra VEREX — WhatsApp: 7125-0725' });
                return;
            } catch(e) {}
        }
    }
    doc.save(nombreArchivo);
}

async function verEstadoCuenta(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId) || _creditosVD.find(v => v.id === ventaId);
    if (!venta) return;
    toast("⏳ Cargando estado de cuenta...");
    let abonos = [];
    try {
        const resp = await apiPost({ accion: "GET_ABONOS_VENTA", ventaId });
        abonos = resp.abonos || [];
    } catch(e) {}
    generarPDFVentaDirecta(venta, abonos);
}

function enviarWAEstadoCuenta(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId) || _creditosVD.find(v => v.id === ventaId);
    if (!venta) return;
    const tel = String(venta.telefono||"").replace(/\D/g,"");
    if (!tel) { toast("⚠️ El cliente no tiene teléfono registrado"); return; }
    const total   = parseFloat(venta.total||0);
    const saldo   = parseFloat(venta.saldoPendiente||0);
    const pagado  = total - saldo;
    let items = [];
    try { items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items||[]); } catch(_) {}
    const lista = items.map(i => `• ${i.nombre} ×${i.cantidad||1} — $${(parseFloat(i.precio||0)*(parseInt(i.cantidad||1))).toFixed(2)}`).join('\n');
    const msg = `Hola ${venta.cliente}, aquí tu estado de cuenta *VEREX* 💛\n\n`
        + `📦 *Compra registrada:*\n${lista}\n\n`
        + `💰 *Total:* $${total.toFixed(2)}\n`
        + `✅ *Pagado:* $${pagado.toFixed(2)}\n`
        + (saldo > 0 ? `⏳ *Saldo pendiente:* $${saldo.toFixed(2)}` : `✓ *¡Cuenta liquidada!*`);
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
}

// A diferencia de enviarWAEstadoCuenta (el detalle completo de la compra),
// esto es un recordatorio corto y directo — para cuando lo que quieres es
// avisarle al cliente que le toca abonar, no mandarle un desglose de cuenta.
function enviarRecordatorioAbono(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId) || _creditosVD.find(v => v.id === ventaId);
    if (!venta) return;
    const tel = String(venta.telefono||"").replace(/\D/g,"");
    if (!tel) { toast("⚠️ El cliente no tiene teléfono registrado"); return; }
    const saldo = parseFloat(venta.saldoPendiente||0);
    if (saldo <= 0) { toast("Esta venta ya está saldada"); return; }
    const dias = Math.floor((Date.now() - new Date(venta.fecha).getTime()) / 86400000);
    const msg = `Hola ${venta.cliente}! 👋 Te escribo de *VEREX* para recordarte que tienes un abono pendiente de *$${saldo.toFixed(2)}*`
        + (dias > 0 ? ` (desde hace ${dias} día${dias===1?"":"s"})` : "")
        + `. Cuando puedas completarlo avísame y coordinamos 💛`;
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
}
