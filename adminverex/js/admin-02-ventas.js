// Admin VEREX — Ventas unificadas (tienda online + venta directa)
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  VENTAS UNIFICADAS
// ═════════════════════════════════════════════
let _adminVentas = [];

async function cargarVentasAdmin() {
    const lista = document.getElementById("av-lista");
    lista.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:20px;">&#x23F3; Cargando ventas...</p>';
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ accion: "GET_HISTORIAL_VENTAS", _pass: ADMIN_PASS })
        }).then(r => r.json());
        _adminVentas = (res.ventas || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        actualizarKPIsVentas();
        renderVentasAdmin();
    } catch(e) {
        lista.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;padding:20px;">Error al cargar ventas.</p>';
    }
}

function actualizarKPIsVentas() {
    const monto  = _adminVentas.reduce((s, v) => s + parseFloat(v.total || 0), 0);
    const cobrar = _adminVentas.reduce((s, v) => s + parseFloat(v.saldoPendiente || 0), 0);
    document.getElementById("av-total-ventas").textContent = _adminVentas.length;
    document.getElementById("av-monto-total").textContent  = "$" + monto.toFixed(2);
    document.getElementById("av-por-cobrar").textContent   = "$" + cobrar.toFixed(2);
}

function renderVentasAdmin() {
    const q      = (document.getElementById("av-buscar")?.value || "").toLowerCase();
    const tipo   = document.getElementById("av-tipo")?.value   || "";
    const estado = document.getElementById("av-estado")?.value || "";
    const tipoCfg = {
        directa:      { label:"Directa",     color:"#C9A84C", bg:"rgba(201,168,76,.15)"  },
        catalogo:     { label:"Catálogo",    color:"#0ea5e9", bg:"rgba(14,165,233,.15)"  },
        consignacion: { label:"Consignación",color:"#a78bfa", bg:"rgba(167,139,250,.15)" },
    };
    const estadoCfg = {
        pagado:   { label:"Pagado",   color:"#059669" },
        credito:  { label:"Crédito",  color:"#e85d04" },
        pendiente:{ label:"Pendiente",color:"#e74c3c" },
    };
    const filtradas = _adminVentas.filter(v => {
        if (tipo   && v.tipo   !== tipo)   return false;
        if (estado && v.estado !== estado) return false;
        if (q) {
            const hay = (v.cliente || "").toLowerCase().includes(q) ||
                (typeof v.items === "string" ? v.items : JSON.stringify(v.items || "")).toLowerCase().includes(q);
            if (!hay) return false;
        }
        return true;
    });
    const lista = document.getElementById("av-lista");
    if (!filtradas.length) {
        lista.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:30px;">Sin resultados.</p>';
        return;
    }
    lista.innerHTML = filtradas.map(v => {
        const tc  = tipoCfg[v.tipo]    || { label: v.tipo    || "—", color:"#888", bg:"#222" };
        const ec  = estadoCfg[v.estado] || { label: v.estado || "—", color:"#888" };
        const fecha = v.fecha ? new Date(v.fecha).toLocaleDateString("es-CO", { day:"2-digit", month:"short", year:"numeric" }) : "—";
        let itemsStr = "";
        try {
            const its = typeof v.items === "string" ? JSON.parse(v.items || "[]") : (v.items || []);
            itemsStr = its.slice(0,2).map(i => i.nombre || i.producto || "").filter(Boolean).join(", ");
            if (its.length > 2) itemsStr += ` +${its.length - 2} más`;
        } catch(_) {}
        return `<div style="background:#fff;border:3.5px solid ${tc.color};border-radius:10px;padding:12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px;">
                        <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${tc.bg};color:${tc.color};font-weight:700;">${tc.label}</span>
                        <span style="font-size:10px;color:${ec.color};font-weight:600;">${ec.label}</span>
                    </div>
                    <div style="font-size:13px;font-weight:700;color:#1a1a1a;">${esc(v.cliente) || "—"}</div>
                    <div style="font-size:11px;color:#374151;margin-top:2px;">${fecha} · Ref: ${String(v.id||"").slice(-6)}</div>
                    ${itemsStr ? `<div style="font-size:11px;color:#4b5563;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(itemsStr)}</div>` : ""}
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:15px;font-weight:700;color:#1e3a8a;">$${parseFloat(v.total||0).toFixed(2)}</div>
                    ${parseFloat(v.saldoPendiente||0)>0 ? `<div style="font-size:11px;color:#e74c3c;font-weight:600;">Debe: $${parseFloat(v.saldoPendiente).toFixed(2)}</div>` : ""}
                </div>
            </div>
            ${v.tipo === "directa" ? `<div style="display:flex;gap:6px;margin-top:8px;">
                <button onclick="event.stopPropagation();agregarProductoVentaDirecta('${esc(v.id)}')" style="flex:1;padding:6px 10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;">➕ Agregar pieza</button>
                <button onclick="event.stopPropagation();cambiarProductoVentaDirecta('${esc(v.id)}')" style="flex:1;padding:6px 10px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;">🔄 Cambiar producto</button>
            </div>` : ""}
        </div>`;
    }).join("");
}

// Cambio de una o varias piezas de la misma venta directa a la vez. El
// desglose que se muestra antes de confirmar lo calcula el worker
// (soloCalcular) — es la misma cuenta que se guarda al confirmar, así lo que
// ves es lo que queda. Las piezas viejas vuelven a bodega, las nuevas se
// descuentan, y el saldo se ajusta según lo que el cliente PAGÓ por cada pieza
// (con su parte del descuento) contra el precio de la nueva.
let _cambioVDA = null; // { ventaId, items, tieneDescuento }
let _cambioVDATimer = null, _cambioVDASeq = 0, _cambioVDAEnviando = false;

async function _cambioVDAApi(datos) {
    const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ accion: "CAMBIAR_PRODUCTO_VENTA_DIRECTA", _pass: ADMIN_PASS, ...datos })
    });
    return await res.json();
}

function cambiarProductoVentaDirecta(ventaId) {
    const venta = _adminVentas.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#ef4444");
    let items = [];
    try { items = typeof venta.items === "string" ? JSON.parse(venta.items || "[]") : (venta.items || []); } catch(_) {}
    if (!items.length) return toast("⚠️ Esta venta no tiene productos registrados", "#ef4444");

    _cambioVDA = { ventaId, items, tieneDescuento: (parseFloat(venta.descuento) || 0) > 0 };
    document.getElementById("cambio-vda-body").innerHTML = `
        <p style="font-size:12px;color:#666;margin:0 0 12px;line-height:1.5;">Marca las piezas que el cliente devuelve y escribe el código de la que se lleva en su lugar.</p>
        ${items.map((it, i) => {
            const precio = parseFloat(it.precio) || 0;
            const pagado = it.precioPagado != null ? parseFloat(it.precioPagado) : precio;
            const precioTxt = pagado < precio - 0.005
                ? `Pagó $${pagado.toFixed(2)} <span style="color:#999;">(precio $${precio.toFixed(2)})</span>`
                : `$${precio.toFixed(2)}`;
            return `
            <div style="border:1.5px solid #e2e2e2;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin:0;text-transform:none;letter-spacing:0;font-weight:400;color:#111;">
                    <input type="checkbox" id="cvda-on-${i}" onchange="cambioVDAToggle(${i})" style="margin:3px 0 0;flex-shrink:0;">
                    <span style="flex:1;min-width:0;">
                        <span style="display:block;font-size:10px;color:#7c3aed;font-weight:700;">${esc(it.codigo)}</span>
                        <span style="display:block;font-size:13px;font-weight:600;color:#111;">${esc(it.nombre || "—")}${(parseInt(it.cantidad)||1) > 1 ? ` ×${parseInt(it.cantidad)}` : ""}</span>
                        <span style="display:block;font-size:11px;color:#555;">${precioTxt}</span>
                    </span>
                </label>
                <div id="cvda-det-${i}" style="display:none;margin-top:10px;padding-left:26px;">
                    <input type="text" id="cvda-nuevo-${i}" placeholder="Código de la pieza nueva" autocapitalize="characters" autocomplete="off" oninput="cambioVDAPreview()" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid #e2e2e2;border-radius:8px;font-size:13px;margin-bottom:8px;">
                    ${_cambioVDA.tieneDescuento ? `
                    <label style="display:flex;gap:8px;align-items:center;font-size:12px;color:#555;cursor:pointer;margin:0;text-transform:none;letter-spacing:0;font-weight:400;">
                        <input type="checkbox" id="cvda-desc-${i}" onchange="cambioVDAPreview()" style="margin:0;">
                        La pieza nueva lleva el descuento
                    </label>` : ""}
                </div>
            </div>`;
        }).join("")}
        <input type="text" id="cvda-motivo" placeholder="Motivo del cambio (opcional)" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid #e2e2e2;border-radius:8px;font-size:13px;margin:6px 0 12px;">
        <div id="cvda-resumen" style="font-size:12px;color:#555;margin-bottom:14px;"></div>
        <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('modal-cambio-vda').style.display='none'" style="flex:1;background:#f0f2f5;color:#111;border:none;padding:11px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Cancelar</button>
            <button id="cvda-confirmar" disabled onclick="confirmarCambioVDA()" style="flex:1;background:#111;color:#fff;border:none;padding:11px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Confirmar cambio</button>
        </div>`;
    cambioVDAPreview();
    document.getElementById("modal-cambio-vda").style.display = "flex";
}

function cambioVDAToggle(i) {
    const on = document.getElementById("cvda-on-" + i).checked;
    document.getElementById("cvda-det-" + i).style.display = on ? "block" : "none";
    if (on) document.getElementById("cvda-nuevo-" + i)?.focus();
    cambioVDAPreview();
}

// Piezas marcadas → lista de cambios para el worker. `incompleto` = hay una
// marcada a la que todavía le falta el código nuevo.
function cambioVDASeleccion() {
    const cambios = []; let incompleto = false;
    (_cambioVDA?.items || []).forEach((it, i) => {
        if (!document.getElementById("cvda-on-" + i)?.checked) return;
        const nuevo = (document.getElementById("cvda-nuevo-" + i)?.value || "").trim().toUpperCase();
        if (!nuevo) { incompleto = true; return; }
        cambios.push({
            codigoViejo: it.codigo, codigoNuevo: nuevo,
            aplicaDescuento: !!document.getElementById("cvda-desc-" + i)?.checked
        });
    });
    return { cambios, incompleto };
}

function cambioVDAPreview() {
    clearTimeout(_cambioVDATimer);
    const ventaId = _cambioVDA?.ventaId;
    const btn = document.getElementById("cvda-confirmar");
    const res = document.getElementById("cvda-resumen");
    if (!ventaId || !btn || !res) return;
    btn.disabled = true; btn.style.opacity = "0.35"; btn.style.cursor = "not-allowed";
    const { cambios, incompleto } = cambioVDASeleccion();
    _cambioVDASeq++;
    if (!cambios.length || incompleto) {
        res.textContent = incompleto
            ? "Escribe el código de la pieza nueva en cada pieza marcada."
            : "Marca al menos una pieza para cambiar.";
        return;
    }
    res.textContent = "Calculando…";
    const seq = _cambioVDASeq;
    _cambioVDATimer = setTimeout(async () => {
        let data;
        try { data = await _cambioVDAApi({ id: ventaId, cambios, soloCalcular: true }); }
        catch (e) { data = { ok: false, error: "No se pudo conectar con el servidor" }; }
        if (seq !== _cambioVDASeq) return; // ya cambió la selección mientras se calculaba
        if (!data.ok) {
            res.innerHTML = `<span style="color:#dc2626;">⚠️ ${esc(data.error || "No se pudo calcular el cambio")}</span>`;
            return;
        }
        const m = n => "$" + Math.abs(parseFloat(n) || 0).toFixed(2);
        const filas = (data.lineas || []).map(l => {
            const dif = parseFloat(l.diferencia) || 0;
            const nota = l.descuentoViejo > 0
                ? (l.aplicaDescuento ? " · con descuento" : ` · pierde descuento de ${m(l.descuentoViejo)}`)
                : "";
            return `<div style="padding:8px 0;border-bottom:1px solid #e2e2e2;">
                <div style="color:#111;">${esc(l.codigoViejo)} → <strong>${esc(l.nombreNuevo)}</strong> <span style="color:#7c3aed;font-size:10px;font-weight:700;">${esc(l.codigoNuevo)}</span></div>
                <div>Pagó ${m(l.precioViejo)} · nueva ${m(l.precioNuevo)}${nota}
                    → <strong style="color:${dif > 0 ? '#c2410c' : dif < 0 ? '#15803d' : '#555'};">${dif > 0 ? "+" : dif < 0 ? "−" : ""}${m(dif)}</strong></div>
            </div>`;
        }).join("");
        const dif = parseFloat(data.diferencia) || 0;
        const titulo = dif > 0 ? `El cliente debe ${m(dif)} más`
            : dif < 0 ? `Baja ${m(dif)} respecto a lo que pagó`
            : "Sin diferencia de monto";
        res.innerHTML = `${filas}
            <div style="margin-top:10px;color:#111;font-size:13px;font-weight:700;">${titulo}</div>
            <div>Nuevo total ${m(data.nuevoTotal)} · Saldo pendiente ${m(data.nuevoSaldo)}</div>
            ${data.aFavorCliente > 0 ? `<div style="margin-top:6px;color:#c2410c;font-weight:600;">⚠️ Le sobran ${m(data.aFavorCliente)} al cliente: hay que devolvérselos.</div>` : ""}`;
        btn.disabled = false; btn.style.opacity = "1"; btn.style.cursor = "pointer";
    }, 350);
}

async function confirmarCambioVDA() {
    if (_cambioVDAEnviando || !_cambioVDA) return;
    const { cambios, incompleto } = cambioVDASeleccion();
    if (!cambios.length || incompleto) return;
    const btn = document.getElementById("cvda-confirmar");
    _cambioVDAEnviando = true; if (btn) { btn.disabled = true; btn.style.opacity = "0.35"; }
    try {
        const motivo = (document.getElementById("cvda-motivo")?.value || "").trim();
        const data = await _cambioVDAApi({ id: _cambioVDA.ventaId, cambios, motivo });
        if (!data.ok) throw new Error(data.error || "Error del servidor");
        const diff = parseFloat(data.diferencia) || 0;
        const msgDiff = diff > 0 ? `El saldo del cliente subió $${diff.toFixed(2)}` : diff < 0 ? `El saldo del cliente bajó $${Math.abs(diff).toFixed(2)}` : "Sin cambio en el monto";
        document.getElementById("modal-cambio-vda").style.display = "none";
        toast(`✅ ${cambios.length > 1 ? cambios.length + " productos cambiados" : "Producto cambiado"}. ${msgDiff}`, "#22c55e");
        cargarVentasAdmin();
    } catch (e) {
        toast("❌ " + e.message, "#ef4444");
        if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
    } finally {
        _cambioVDAEnviando = false;
    }
}

// Agrega una pieza NUEVA a una venta ya registrada (ej. el cliente aprovecha
// un cambio para llevarse algo más) — no quita nada, solo suma al mismo
// saldo, para que quede un solo crédito combinado por cliente.
async function agregarProductoVentaDirecta(ventaId) {
    const venta = _adminVentas.find(v => v.id === ventaId);
    if (!venta) return toast("⚠️ Venta no encontrada", "#ef4444");

    const codigo = prompt("Código del producto NUEVO que se lleva el cliente (además de lo que ya tiene):", "");
    if (!codigo) return;
    const cantStr = prompt("¿Cuántas piezas de ese producto?", "1");
    const cantidad = Math.max(1, parseInt(cantStr) || 1);

    if (!confirm(`¿Agregar "${codigo.trim()}" x${cantidad} a la venta de ${venta.cliente || "este cliente"}?\n\nEl monto se suma al saldo pendiente actual.`)) return;

    try {
        const res = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ accion: "AGREGAR_PRODUCTO_VENTA_DIRECTA", _pass: ADMIN_PASS, id: ventaId, codigo: codigo.trim(), cantidad })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Error del servidor");
        toast(`✅ Pieza agregada — nuevo saldo pendiente: $${parseFloat(data.nuevoSaldo).toFixed(2)}`, "#22c55e");
        cargarVentasAdmin();
    } catch (e) {
        toast("❌ " + e.message, "#ef4444");
    }
}
