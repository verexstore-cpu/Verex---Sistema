// Hub VEREX — Venta directa: carrito, tipo y método de pago, confirmar venta
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
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
