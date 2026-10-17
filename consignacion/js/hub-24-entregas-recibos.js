// Hub VEREX — Entregas y recibos de vendedores
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── ENTREGAS / RECIBOS ───────────────────────────────────────────────
// Todas las entregas del vendedor abierto, con su recibo PDF para descargar
// cuando se necesite (el PDF se regenera de lo guardado en "entregas").
let _entregasRecibosMap = {};
function _piezasDeEntrega(items) { return items.reduce((s, i) => s + (parseInt(i.cantidad) || 0), 0); }
function _totalDeEntrega(items)  { return items.reduce((s, i) => s + (parseFloat(i.precio) || 0) * (parseInt(i.cantidad) || 0), 0); }

async function verEntregasRecibos() {
    abrirModal("modal-entregas-recibos");
    const lista = document.getElementById("lista-entregas-recibos");
    lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await apiPost({ accion: "GET_ENTREGAS_VENDEDOR", vendedor: vendedorActual.codigo });
        if (!res || res.ok === false) throw new Error((res && res.error) || "no se pudo cargar");
        const todas = (res.entregas || []).slice().sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
        if (!todas.length) {
            lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">Este vendedor todavía no tiene entregas registradas con recibo. (Las entregas hechas antes de esta función no guardaron recibo.)</p>';
            return;
        }
        _entregasRecibosMap = {};
        const filas = todas.map(e => {
            let items = [];
            try { items = typeof e.items === "string" ? JSON.parse(e.items) : (e.items || []); } catch (_) {}
            _entregasRecibosMap[e.id] = { e, items };
            return { e, items, piezas: _piezasDeEntrega(items), total: _totalDeEntrega(items) };
        });
        const validas = filas.filter(f => f.e.estado !== "duplicada");
        const confirm_ = validas.filter(f => f.e.estado === "confirmado");
        const piezasConf = confirm_.reduce((s, f) => s + f.piezas, 0);
        const piezasPend = validas.filter(f => f.e.estado !== "confirmado").reduce((s, f) => s + f.piezas, 0);
        const resumen = `<div style="background:#1a1a1a;border:1px solid var(--dorado);border-radius:10px;padding:12px 14px;margin-bottom:12px;">
            <div style="font-size:11px;color:var(--plateado);text-transform:uppercase;letter-spacing:.5px;">Total entregado a ${sanitizar(vendedorActual.nombre)}</div>
            <div style="font-size:20px;font-weight:700;color:var(--dorado);margin-top:2px;">${piezasConf} pieza${piezasConf === 1 ? "" : "s"}
                <span style="font-size:12px;font-weight:600;color:var(--plateado);">en ${confirm_.length} entrega${confirm_.length === 1 ? "" : "s"} confirmada${confirm_.length === 1 ? "" : "s"}</span></div>
            ${piezasPend ? `<div style="font-size:11px;color:#e67e22;margin-top:3px;">+ ${piezasPend} pieza${piezasPend === 1 ? "" : "s"} en entregas pendientes de confirmar</div>` : ""}
        </div>`;
        lista.innerHTML = resumen + filas.map(({ e, items, piezas, total }) => {
            const fecha = e.fecha ? new Date(e.fecha).toLocaleDateString("es-SV", { year: "numeric", month: "short", day: "numeric" }) : "—";
            const est = e.estado === "confirmado" ? { t: "✅ Confirmada", c: "#4caf82" }
                      : e.estado === "duplicada"  ? { t: "⚠️ Duplicada",  c: "#888" }
                      : { t: "⏳ Pendiente de firma", c: "#e67e22" };
            const nombres = items.slice(0, 3).map(i => sanitizar(i.nombre)).join(", ") + (items.length > 3 ? " +" + (items.length - 3) + " más" : "");
            return `<div style="background:var(--gris2);border:1px solid var(--borde);border-radius:10px;padding:12px 14px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="font-size:12px;color:var(--dorado);font-weight:600;">${sanitizar(fecha)}</span>
                    <span style="font-size:11px;font-weight:700;color:${est.c};">${est.t}</span>
                </div>
                <div style="font-size:13px;font-weight:700;color:#fff;">${piezas} pieza${piezas === 1 ? "" : "s"} · $${total.toFixed(2)}</div>
                <div style="font-size:11px;color:var(--plateado);margin:3px 0 8px;">${nombres || "—"}${e.codigoRecibo ? ` · Código: <strong style="color:var(--dorado);">${sanitizar(e.codigoRecibo)}</strong>` : ""}</div>
                ${items.length ? `<button onclick="descargarReciboEntregaVendedor('${sanitizar(e.id)}')" style="padding:6px 12px;border:none;border-radius:6px;background:#2d7a4f;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">📄 Descargar recibo PDF</button>` : ""}
            </div>`;
        }).join("");
    } catch (err) {
        lista.innerHTML = '<p style="color:#e74c3c;font-size:13px;">Error al cargar: ' + sanitizar(err.message || String(err)) + '</p>';
    }
}

async function descargarReciboEntregaVendedor(id) {
    const reg = _entregasRecibosMap[id];
    if (!reg) { toast("⚠️ No se encontró la entrega"); return; }
    try {
        // la firma no viene en la lista (pesa): se pide solo al descargar
        let firma = "";
        if (reg.e.tieneFirma) {
            const r = await apiPost({ accion: "GET_ENTREGA_RECIBO", id });
            if (!r || r.ok === false) throw new Error((r && r.error) || "no se pudo leer la entrega");
            firma = (r.entrega && r.entrega.firmaImg) || "";
        }
        const pendiente = reg.e.estado !== "confirmado";
        generarReciboPDF(vendedorActual, reg.items, firma || null, reg.e.codigoRecibo, pendiente);
    } catch (err) {
        toast("⚠️ Error al generar PDF: " + (err.message || err));
    }
}

function asignarAVendedor() {
    abrirAsignarVendedor();
}
