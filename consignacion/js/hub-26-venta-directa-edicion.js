// Hub VEREX — Venta directa: editar descuento, cambiar producto, saldo y devoluciones
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// Menú "⋯ Más acciones" de cada tarjeta de venta directa — agrupa Agregar/
// Cambiar/Descuento/Corregir saldo para no saturar la tarjeta, dejando solo
// Abono y Recibo visibles a simple vista (mismo patrón que toggleMenuMover).
function toggleMenuMasVD(id, btn) {
    document.querySelectorAll('[id^="menu-mas-vd-"]').forEach(m => {
        if (m.id !== `menu-mas-vd-${id}`) m.style.display = "none";
    });
    const menu = document.getElementById(`menu-mas-vd-${id}`);
    if (!menu) return;
    menu.style.display = menu.style.display === "none" ? "block" : "none";
    if (menu.style.display === "block" && btn) {
        menu.style.position = "fixed";
        const rect = btn.getBoundingClientRect();
        const menuAltura = menu.offsetHeight || 160;
        const espacioAbajo = window.innerHeight - rect.bottom;
        if (espacioAbajo < menuAltura + 10) {
            menu.style.top = "auto";
            menu.style.bottom = (window.innerHeight - rect.top + 4) + "px";
        } else {
            menu.style.bottom = "auto";
            menu.style.top = (rect.bottom + 4) + "px";
        }
        menu.style.right = (window.innerWidth - rect.right) + "px";
    }
}

function abrirModalEditDescuento(id) {
    const v = _historialVD.find(x => x.id === id);
    if (!v) return toast("⚠️ Venta no encontrada");
    const totalRegistrado = parseFloat(v.total || 0);

    let m = document.getElementById("modal-edit-desc-vd");
    if (!m) {
        m = document.createElement("div");
        m.id = "modal-edit-desc-vd";
        m.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;";
        document.body.appendChild(m);
    }
    m.innerHTML = `
        <div style="background:#111;border:1px solid #C9A84C;border-radius:16px;padding:20px;width:320px;max-width:94vw;font-family:'DM Sans',sans-serif;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="color:#C9A84C;font-size:15px;font-weight:700;">✏️ Corregir descuento</span>
                <button onclick="document.getElementById('modal-edit-desc-vd').style.display='none'" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;line-height:1;">×</button>
            </div>
            <div style="font-size:12px;color:#888;margin-bottom:16px;">${sanitizar(v.cliente)} · Registrado en: <strong style="color:#e85555;">$${totalRegistrado.toFixed(2)}</strong></div>

            <div style="font-size:11px;color:#aaa;margin-bottom:6px;">Precio real cobrado al cliente</div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                <span style="font-size:16px;font-weight:700;color:var(--dorado);">$</span>
                <input type="number" id="ed-precio-real" min="0" step="0.01" placeholder="0.00"
                    oninput="calcularPreviaEditDesc(${totalRegistrado})"
                    style="flex:1;padding:10px;background:#1a1a1a;border:1px solid #444;border-radius:8px;color:#fff;font-size:16px;font-weight:700;">
            </div>

            <div style="font-size:11px;color:#aaa;margin-bottom:6px;">Tipo de descuento (para el recibo)</div>
            <div style="display:flex;gap:6px;margin-bottom:10px;">
                <button id="edbtn-monto" onclick="setTipoEditDesc('monto')"
                    style="flex:1;padding:8px;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;background:var(--dorado);color:#000;">$ Monto fijo</button>
                <button id="edbtn-pct" onclick="setTipoEditDesc('porcentaje')"
                    style="flex:1;padding:8px;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;background:#2a2a2a;color:#888;">% Porcentaje</button>
            </div>

            <div id="ed-previa" style="font-size:12px;color:#888;background:#1a1a1a;border-radius:8px;padding:10px;margin-bottom:14px;min-height:40px;line-height:1.8;"></div>

            <button onclick="guardarEditDescVD('${id}', ${totalRegistrado})"
                style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#C9A84C,#a87d20);color:#111;font-size:13px;font-weight:700;cursor:pointer;">
                ✅ Guardar corrección
            </button>
        </div>`;
    m.style.display = "flex";
}

function setTipoEditDesc(tipo) {
    document.getElementById("edbtn-monto").style.background = tipo==="monto" ? "var(--dorado)" : "#2a2a2a";
    document.getElementById("edbtn-monto").style.color      = tipo==="monto" ? "#000" : "#888";
    document.getElementById("edbtn-pct").style.background   = tipo==="porcentaje" ? "var(--dorado)" : "#2a2a2a";
    document.getElementById("edbtn-pct").style.color        = tipo==="porcentaje" ? "#000" : "#888";
    const inp = document.getElementById("ed-precio-real");
    if (inp) { const tr = parseFloat(inp.closest("[id='modal-edit-desc-vd']")?.dataset?.tr || 0); calcularPreviaEditDesc(tr || 0); }
}

function calcularPreviaEditDesc(totalRegistrado) {
    const precioReal = parseFloat(document.getElementById("ed-precio-real")?.value) || 0;
    const prev = document.getElementById("ed-previa");
    if (!prev) return;
    if (precioReal <= 0) { prev.innerHTML = '<span style="color:#555;">Ingresa el precio real cobrado</span>'; return; }
    if (precioReal > totalRegistrado) {
        prev.innerHTML = '<span style="color:#e85555;">⚠️ El precio real no puede ser mayor al registrado</span>'; return;
    }
    const tipo = document.getElementById("edbtn-pct")?.style.background.includes("dorado") || document.getElementById("edbtn-pct")?.style.background === "var(--dorado)" ? "porcentaje" : "monto";
    const desc = totalRegistrado - precioReal;
    const pct  = totalRegistrado > 0 ? (desc / totalRegistrado * 100).toFixed(1) : 0;
    prev.innerHTML = `
        Precio sin descuento: <strong>$${totalRegistrado.toFixed(2)}</strong><br>
        Descuento: <strong style="color:#e85555;">-$${desc.toFixed(2)} (${pct}%)</strong><br>
        Total correcto: <strong style="color:#52d68a;">$${precioReal.toFixed(2)}</strong>`;
}

async function guardarEditDescVD(id, totalRegistrado) {
    const precioReal = parseFloat(document.getElementById("ed-precio-real")?.value) || 0;
    if (precioReal <= 0) return toast("⚠️ Ingresa el precio real cobrado");
    if (precioReal > totalRegistrado) return toast("⚠️ El precio real no puede superar el total registrado");
    if (precioReal === totalRegistrado) return toast("⚠️ El precio es igual al registrado — no hay descuento que corregir");
    const tipoBtnPct = document.getElementById("edbtn-pct");
    const tipo = (tipoBtnPct?.style.background === "var(--dorado)" || tipoBtnPct?.style.background?.includes?.("dorado")) ? "porcentaje" : "monto";
    const desc = totalRegistrado - precioReal;
    const val  = tipo === "porcentaje" ? parseFloat((desc / totalRegistrado * 100).toFixed(2)) : desc;
    const res = await apiPost({
        accion: "ACTUALIZAR_DESCUENTO_VD",
        id,
        subtotal:       totalRegistrado,
        totalReal:      precioReal,
        descuentoTipo:  tipo,
        descuentoValor: val
    });
    if (res.ok) {
        document.getElementById("modal-edit-desc-vd").style.display = "none";
        toast("✅ Venta corregida a $" + precioReal.toFixed(2));
        await cargarHistorialVD();
    } else {
        toast("⚠️ Error: " + (res.error || "no se pudo actualizar"));
    }
}

function editarDescuentoVD(id) { abrirModalEditDescuento(id); }

// Cambio de producto en una venta directa (devolución para cambiar de
// pieza). Regresa la vieja a bodega, descuenta la nueva, y ajusta
// total/saldoPendiente por la diferencia de precio — sube el saldo si la
// pieza nueva vale más, lo baja si vale menos.
// Cambio de una o varias piezas de la misma venta a la vez. El desglose que
// se muestra antes de confirmar lo calcula el worker (soloCalcular) — es la
// misma cuenta que se guarda al confirmar, así lo que ves es lo que queda.
let _cambioVD = null; // { ventaId, items, tieneDescuento }
let _cambioVDTimer = null, _cambioVDSeq = 0;

function cambiarProductoVentaDirectaVD(ventaId) {
    const venta = _historialVD.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#c0392b");
    let items = [];
    try { items = typeof venta.items === "string" ? JSON.parse(venta.items || "[]") : (venta.items || []); } catch(_) {}
    if (!items.length) return toast("⚠️ Esta venta no tiene productos registrados", "#c0392b");

    _cambioVD = { ventaId, items, tieneDescuento: (parseFloat(venta.descuento) || 0) > 0 };
    document.getElementById("cambio-vd-body").innerHTML = `
        <div style="font-size:12px;color:var(--plateado);margin-bottom:12px;line-height:1.5;">
            Marca las piezas que el cliente devuelve y escribe el código de la que se lleva en su lugar.
        </div>
        ${items.map((it, i) => {
            const precio = parseFloat(it.precio) || 0;
            const pagado = it.precioPagado != null ? parseFloat(it.precioPagado) : precio;
            const precioTxt = pagado < precio - 0.005
                ? `Pagó $${pagado.toFixed(2)} <span style="opacity:.7;">(precio $${precio.toFixed(2)})</span>`
                : `$${precio.toFixed(2)}`;
            return `
            <div style="border:1px solid var(--borde);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;">
                    <input type="checkbox" id="cvd-on-${i}" onchange="cambioVDToggle(${i})" style="width:auto;margin:3px 0 0;padding:0;flex-shrink:0;">
                    <span style="flex:1;min-width:0;">
                        <span style="display:block;font-size:10px;color:var(--dorado);font-weight:600;">${sanitizar(it.codigo)}</span>
                        <span style="display:block;font-size:13px;">${sanitizar(it.nombre || "—")}${(parseInt(it.cantidad)||1) > 1 ? ` ×${parseInt(it.cantidad)}` : ""}</span>
                        <span style="display:block;font-size:11px;color:var(--plateado);">${precioTxt}</span>
                    </span>
                </label>
                <div id="cvd-det-${i}" style="display:none;margin-top:10px;padding-left:26px;">
                    <input type="text" id="cvd-nuevo-${i}" placeholder="Código de la pieza nueva" autocapitalize="characters" autocomplete="off" oninput="cambioVDPreview()" style="margin-bottom:8px;">
                    ${_cambioVD.tieneDescuento ? `
                    <label style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--plateado);cursor:pointer;">
                        <input type="checkbox" id="cvd-desc-${i}" onchange="cambioVDPreview()" style="width:auto;margin:0;padding:0;">
                        La pieza nueva lleva el descuento
                    </label>` : ""}
                </div>
            </div>`;
        }).join("")}
        <input type="text" id="cvd-motivo" placeholder="Motivo del cambio (opcional)" style="margin:6px 0 12px;">
        <div id="cvd-resumen" style="font-size:12px;color:var(--plateado);margin-bottom:14px;"></div>
        <div style="display:flex;gap:8px;">
            <button class="btn btn-gris" style="flex:1;" onclick="cerrarModal('modal-cambio-vd')">Cancelar</button>
            <button class="btn btn-dorado" id="cvd-confirmar" style="flex:1;" disabled onclick="confirmarCambioVD()">Confirmar cambio</button>
        </div>`;
    cambioVDPreview();
    abrirModal("modal-cambio-vd");
}

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
