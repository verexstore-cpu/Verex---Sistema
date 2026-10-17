// Hub VEREX — Dashboard, próximo corte y entregas pendientes de confirmar
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
function renderDashboard() {
    cargarImagenesInformativas();
    const inv = consignacion.filter(c => c.estado === "activo");
    const vendedoresActivos = vendedores.filter(v =>
        inv.some(c => c.vendedor === v.codigo)
    );

    // KPIs
    const totalPiezas = inv.reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);
    const totalValor  = inv.reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)) * parseFloat(c.precio||0), 0);
    const totalPorCobrar = inv.reduce((s, c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);

    document.getElementById("dash-vendedores").textContent = vendedoresActivos.length;
    document.getElementById("dash-piezas").textContent = totalPiezas;
    document.getElementById("dash-valor").textContent = "$" + totalValor.toFixed(0);

    // Cobros pendientes — cortes cerrados sin marcar "ya recibí el pago"
    const cobrosCard = document.getElementById("dash-cobros-card");
    const cobrosDiv  = document.getElementById("dash-cobros");
    if (_cortesPendientesCobro.length) {
        cobrosCard.style.display = "block";
        cobrosDiv.innerHTML = _cortesPendientesCobro.map(c => {
            const fecha = c.fecha ? new Date(c.fecha).toLocaleDateString("es-SV", { day: "numeric", month: "short" }) : "—";
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--gris2);border-radius:8px;margin-bottom:8px;border-left:3px solid #e67e22;">
                <div>
                    <div style="font-size:13px;font-weight:600;">${sanitizar(c.vendedorNombre || c.vendedor)}</div>
                    <div style="font-size:11px;color:var(--plateado);">Corte del ${sanitizar(fecha)} — $${parseFloat(c.aPagarVerex||0).toFixed(2)} sin cobrar</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <button class="btn" style="background:#e67e22;color:#fff;padding:5px 12px;font-size:11px;" onclick="marcarCorteCobrado('${sanitizar(c.id)}')">💰 Ya cobré</button>
                    <button class="btn" style="background:none;color:#e74c3c;border:1px solid #e74c3c;padding:4px 12px;font-size:10px;" onclick="eliminarCorteHistorial('${sanitizar(c.id)}')">🗑️ Eliminar</button>
                </div>
            </div>`;
        }).join('');
    } else {
        cobrosCard.style.display = "none";
    }
    document.getElementById("dash-vendido").textContent = "$" + totalPorCobrar.toFixed(0);

    // Alertas de corte
    const alertas = [];
    vendedores.forEach(v => {
        const real = corteRealDe(v);
        if (!real || !corteAplica(v)) return;
        if (real.dias <= 5) alertas.push({ v, dias: real.dias });
    });
    const alertasCard = document.getElementById("dash-alertas-card");
    const alertasDiv  = document.getElementById("dash-alertas");
    if (alertas.length) {
        alertasCard.style.display = "block";
        alertasDiv.innerHTML = alertas.sort((a,b) => a.dias - b.dias).map(({v, dias}) => {
            const color = dias <= 0 ? "#c0392b" : dias <= 2 ? "#e67e22" : "#C9A84C";
            const msg   = dias <= 0 ? "Vencido hace " + Math.abs(dias) + " días" : dias === 1 ? "Vence mañana" : "Vence en " + dias + " días";
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--gris2);border-radius:8px;margin-bottom:8px;border-left:3px solid ${color};">
                <div>
                    <div style="font-size:13px;font-weight:600;">${sanitizar(v.nombre)}</div>
                    <div style="font-size:11px;color:var(--plateado);">${sanitizar(msg)}</div>
                </div>
                <button class="btn btn-dorado" style="padding:5px 12px;font-size:11px;" onclick="cambiarTab('vendedores');abrirPerfil(${jsArg(v.codigo)})">Ver</button>
            </div>`;
        }).join('');
    } else {
        alertasCard.style.display = "none";
    }

    // Ranking
    const rankingData = vendedores.map(v => {
        const vInv = inv.filter(c => c.vendedor === v.codigo);
        const vendido = vInv.reduce((s,c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);
        const stock   = vInv.reduce((s,c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);
        return { v, vendido, stock };
    }).filter(x => x.vendido > 0 || x.stock > 0).sort((a,b) => b.vendido - a.vendido);

    document.getElementById("dash-ranking").innerHTML = rankingData.length ? rankingData.map((item, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}.`;
        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--gris2);border-radius:8px;margin-bottom:8px;">
            <div style="font-size:18px;min-width:28px;">${medal}</div>
            <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">${sanitizar(item.v.nombre)}</div>
                <div style="font-size:11px;color:var(--plateado);">${item.stock} piezas en calle</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:14px;font-weight:700;color:var(--dorado);">$${item.vendido.toFixed(0)}</div>
                <div style="font-size:10px;color:var(--plateado);">por cobrar</div>
            </div>
        </div>`;
    }).join('') : '<p style="color:var(--plateado);font-size:13px;">No hay datos de ventas aún.</p>';

    // Gráfica de barras
    const graficaData = vendedores.map(v => {
        const vInv = inv.filter(c => c.vendedor === v.codigo);
        const stock = vInv.reduce((s,c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);
        return { nombre: v.nombre.split(' ')[0], stock };
    }).filter(x => x.stock > 0).sort((a,b) => b.stock - a.stock);

    const maxStock = Math.max(...graficaData.map(x => x.stock), 1);
    document.getElementById("dash-grafica").innerHTML = graficaData.length ? graficaData.map(item => {
        const pct = Math.round((item.stock / maxStock) * 100);
        return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span>${item.nombre}</span>
                <span style="color:var(--dorado);font-weight:600;">${item.stock} piezas</span>
            </div>
            <div style="background:var(--gris2);border-radius:4px;height:10px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--dorado),var(--dorado-claro));border-radius:4px;transition:width 0.5s;"></div>
            </div>
        </div>`;
    }).join('') : '<p style="color:var(--plateado);font-size:13px;">No hay datos aún.</p>';
}

// ── PRÓXIMO CORTE (siempre visible) ─────────────────────────────────────────
// Próximo corte = último corte (fechaCorte) + 30 días — la misma regla que usan
// las alertas y el cierre del link de inventario. Si el vendedor aún no ha
// hecho ningún corte, se cuenta desde su registro SOLO para mostrarlo (marcado
// como estimado): las alertas y el link de inventario siguen usando únicamente
// fechaCorte, así que esto no bloquea ni avisa a nadie por su cuenta.
// Fecha REAL del corte (o null): la fijada a mano (proximoCorte, "AAAA-MM-DD")
// manda sobre "último corte + 30 días". Es lo que usan las alertas y el aviso.
function corteRealDe(v) {
    if (v?.proximoCorte && /^\d{4}-\d{2}-\d{2}$/.test(v.proximoCorte)) {
        const [y, m, d] = v.proximoCorte.split("-").map(Number);
        const fecha = new Date(y, m - 1, d);
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        return { fecha, dias: Math.round((fecha - hoy) / 86400000), manual: true };
    }
    if (v?.fechaCorte) {
        const fecha = new Date(v.fechaCorte);
        if (isNaN(fecha)) return null;
        fecha.setDate(fecha.getDate() + 30);
        return { fecha, dias: Math.ceil((fecha - Date.now()) / 86400000), manual: false };
    }
    return null;
}

function infoProximoCorte(v) {
    const real = corteRealDe(v);
    if (real) {
        const color = real.dias <= 0 ? "#e74c3c" : real.dias <= 2 ? "#e67e22" : real.dias <= 5 ? "#C9A84C" : "var(--plateado)";
        return { fecha: real.fecha, dias: real.dias, color, estimado: false, manual: real.manual };
    }
    const base = v?.fechaRegistro;
    if (!base) return null;
    const fecha = new Date(base);
    if (isNaN(fecha)) return null;
    fecha.setDate(fecha.getDate() + 30);
    const dias = Math.ceil((fecha - Date.now()) / 86400000);
    const color = dias <= 0 ? "#e74c3c" : dias <= 2 ? "#e67e22" : dias <= 5 ? "#C9A84C" : "var(--plateado)";
    return { fecha, dias, color, estimado: !v.fechaCorte };
}

function _proximoCorteCardHTML(v) {
    const est = estadoLinkVendedor(v);
    if (est === "verificando") return `<div style="font-size:10px;color:var(--plateado);margin-top:3px;">📅 Verificando link…</div>`;
    if (est === "inactivo") return `<div style="font-size:10px;color:#777;margin-top:3px;" title="Sin link activo: no hay corte pendiente hasta que se le genere uno">📅 Sin link · sin corte pendiente</div>`;
    const info = infoProximoCorte(v);
    if (!info) return `<div style="font-size:10px;color:var(--plateado);margin-top:3px;">📅 Sin corte registrado</div>`;
    const corta = info.fecha.toLocaleDateString("es-SV", { day: "numeric", month: "short" });
    const cuando = info.dias > 1 ? `en ${info.dias} d` : info.dias === 1 ? "mañana" : info.dias === 0 ? "hoy" : `vencido hace ${Math.abs(info.dias)} d`;
    const titulo = `Próximo corte: ${info.fecha.toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" })}` + (info.estimado ? " (estimado desde su registro: aún no ha hecho ningún corte)" : "");
    return `<div style="font-size:10px;font-weight:600;color:${info.color};margin-top:3px;" title="${sanitizar(titulo)}">📅 Corte ${info.estimado ? "~" : ""}${corta} · ${cuando}</div>`;
}

function renderProximoCortePerfil() {
    const el = document.getElementById("perfil-proximo-corte");
    if (!el || !vendedorActual) return;
    const est = estadoLinkVendedor(vendedorActual);
    if (est === "verificando") { el.style.color = "var(--plateado)"; el.innerHTML = "📅 Próximo corte: verificando el link del afiliado…"; return; }
    if (est === "inactivo") {
        el.style.color = "#888";
        el.innerHTML = `📅 Sin link activo — no hay corte pendiente <span style="font-weight:400;">(el corte se cuenta mientras tenga un link vigente; se reactiva al generarle uno)</span>`;
        return;
    }
    const info = infoProximoCorte(vendedorActual);
    const enlaceFijar = ` <span onclick="event.stopPropagation();fijarProximoCorte()" style="color:#0277bd;cursor:pointer;text-decoration:underline;font-weight:400;">✏️ fijar fecha</span>`;
    if (!info) { el.innerHTML = "📅 Próximo corte: sin corte registrado" + enlaceFijar; el.style.color = "var(--plateado)"; return; }
    const fmt = f => f.toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
    const cuando = info.dias > 1 ? `faltan ${info.dias} días` : info.dias === 1 ? "vence mañana" : info.dias === 0 ? "vence hoy" : `vencido hace ${Math.abs(info.dias)} días`;
    const detalle = info.manual
        ? `<span style="font-weight:400;">fecha fijada a mano</span>`
        : info.estimado
        ? `<span style="font-weight:400;">30 días desde su registro — aún no ha hecho ningún corte</span>`
        : `<span style="font-weight:400;">último corte: ${fmt(new Date(vendedorActual.fechaCorte))}</span>`;
    el.style.color = info.color;
    el.innerHTML = `📅 Próximo corte: ${info.estimado ? "~ " : ""}${fmt(info.fecha)} · ${cuando} <span style="opacity:.8;">(${detalle})</span>` + enlaceFijar;
}

// ── Fijar a mano la fecha del próximo corte ─────────────────────────────────
// Para vendedores que aún no han hecho ningún corte (no tienen fechaCorte) o
// cuando el corte se acordó para otro día. Se guarda en su propio campo
// (proximoCorte) y NO como fechaCorte a propósito: la página del vendedor usa
// fechaCorte para decidir qué piezas le muestra (oculta lo entregado antes),
// así que falsearla le escondería inventario. Se borra al cerrar un corte real.
let _pcEnviando = false;
const _isoLocal = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

function fijarProximoCorte() {
    if (!vendedorActual) return;
    document.getElementById("pc-nombre").textContent = (vendedorActual.nombre || "") + " · " + vendedorActual.codigo;
    const inp = document.getElementById("pc-fecha");
    inp.min = _isoLocal(new Date());
    inp.value = vendedorActual.proximoCorte || "";
    document.getElementById("pc-quitar").style.display = vendedorActual.proximoCorte ? "block" : "none";
    pcActualizarAviso();
    abrirModal("modal-proximo-corte");
}

function pcActualizarAviso() {
    const el = document.getElementById("pc-aviso");
    const v = document.getElementById("pc-fecha").value;
    if (!v) { el.textContent = ""; return; }
    const [y, m, d] = v.split("-").map(Number);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
    if (dias < 0) { el.style.color = "#e74c3c"; el.textContent = "⚠️ Esa fecha ya pasó: su link de inventario se cerraría de inmediato."; return; }
    el.style.color = "var(--plateado)";
    el.textContent = (dias === 0 ? "Es hoy." : dias === 1 ? "Es mañana." : `Faltan ${dias} días.`)
        + " El vendedor verá el recordatorio desde 7 días antes, y su link de inventario se cierra después de ese día si no se hace el corte.";
}

async function guardarProximoCorte() {
    const fecha = document.getElementById("pc-fecha").value;
    if (!fecha) return toast("⚠️ Elige una fecha");
    const [y, m, d] = fecha.split("-").map(Number);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
    if (dias < 0) return toast("⚠️ Elige hoy o una fecha futura", "#c0392b");
    if (dias > 30 && !confirm(`Esa fecha está a ${dias} días (más de los 30 habituales). ¿Guardarla igual?`)) return;
    await _enviarProximoCorte(fecha);
}

async function quitarProximoCorte() {
    if (!confirm("¿Quitar la fecha fijada? Volverá a contarse 30 días desde su último corte (o quedará sin fecha si nunca ha cortado).")) return;
    await _enviarProximoCorte(null);
}

async function _enviarProximoCorte(fecha) {
    if (_pcEnviando || !vendedorActual) return;
    _pcEnviando = true;
    try {
        const data = await apiPost({ accion: "FIJAR_PROXIMO_CORTE", vendedor: vendedorActual.codigo, fecha });
        if (!data.ok) throw new Error(data.error || "No se pudo guardar");
        vendedorActual.proximoCorte = fecha;
        cerrarModal("modal-proximo-corte");
        toast(fecha ? "✅ Fecha del corte guardada" : "✅ Fecha del corte quitada");
        abrirPerfil(vendedorActual.codigo); // refresca el aviso rojo y la línea del perfil
        renderVendedores();
        renderAlertasAfiliadosHub();
    } catch (e) {
        toast("⚠️ " + e.message, "#c0392b");
    } finally {
        _pcEnviando = false;
    }
}

// ── Entregas pendientes de confirmar (por vendedor) ─────────────────────────
// Un doble toque al confirmar una entrega creaba DOS avisos de recepción para
// una sola entrega física (caso real: Jaime Solórzano, PUP105, 13-sep). Antes
// esos avisos no se veían en ninguna parte del panel hasta que el vendedor los
// confirmaba. Acá se listan, se señala la que parece duplicada, y se puede
// marcar como duplicada: NO se borra, el vendedor deja de verla y no cambia
// stock ni inventario.
async function cargarEntregasPendientesPerfil() {
    const box = document.getElementById("entregas-pendientes-box");
    if (!box || !vendedorActual) return;
    const cod = vendedorActual.codigo;
    box.style.display = "none";
    let ents;
    try { ents = (await apiPost({ accion: "GET_ENTREGAS_PENDIENTES", vendedor: cod })).entregas || []; }
    catch (_) { return; }
    if (!vendedorActual || vendedorActual.codigo !== cod || !ents.length) return; // cambió de perfil mientras cargaba

    const filas = ents.map(e => {
        let items = [];
        try { items = typeof e.items === "string" ? JSON.parse(e.items) : (e.items || []); } catch (_) {}
        return { e, items, t: new Date(e.fecha).getTime() || 0,
                 firma: items.map(i => (i.codigo || "") + "x" + (i.cantidad || 1)).sort().join("|") };
    }).sort((a, b) => a.t - b.t);
    // Posible duplicada: mismos productos que otra pendiente creada antes, con menos de 2 minutos de diferencia
    filas.forEach((f, i) => {
        const orig = filas.slice(0, i).find(o => o.firma === f.firma && (f.t - o.t) < 120000);
        if (orig) { f.dupDe = orig.e.id; f.seg = Math.round((f.t - orig.t) / 1000); }
    });

    box.innerHTML = `<div style="font-size:13px;color:#8ab4f0;font-weight:600;margin-bottom:6px;">
            ⏳ ${filas.length} entrega${filas.length > 1 ? "s" : ""} pendiente${filas.length > 1 ? "s" : ""} de confirmar por el vendedor</div>`
        + filas.map(f => {
            const cuando = f.e.fecha ? new Date(f.e.fecha).toLocaleString("es-SV", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
            const nombres = f.items.slice(0, 3).map(i => sanitizar(i.nombre || i.codigo)).join(", ");
            return `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(74,111,165,0.3);">
                <div style="min-width:0;font-size:12px;">
                    <div>${sanitizar(cuando)} · ${f.items.length} producto(s): ${nombres}</div>
                    <div style="color:var(--plateado);font-size:11px;">Código de recibo: <strong style="color:var(--dorado);">${sanitizar(f.e.codigoRecibo || "—")}</strong>
                    ${f.dupDe ? `<span style="color:#e8a44a;font-weight:700;"> · ⚠️ posible duplicada: mismos productos, ${f.seg} s después de otra</span>` : ""}</div>
                </div>
                <button onclick="marcarEntregaDuplicada(${jsArg(f.e.id)}, ${jsArg(f.dupDe || "")})"
                    style="flex-shrink:0;padding:6px 10px;border:1px solid ${f.dupDe ? "#e8a44a" : "var(--borde)"};border-radius:6px;background:${f.dupDe ? "rgba(232,164,74,0.15)" : "transparent"};color:${f.dupDe ? "#e8a44a" : "var(--plateado)"};font-size:11px;font-weight:600;cursor:pointer;">Marcar duplicada</button>
            </div>`;
        }).join("");
    box.style.display = "block";
}

async function marcarEntregaDuplicada(id, duplicadaDe) {
    if (!confirm("¿Marcar esta entrega como DUPLICADA?\n\nEl vendedor dejará de verla para confirmar. El registro se conserva (no se borra) y no cambia el stock ni el inventario.")) return;
    try {
        const res = await apiPost({ accion: "MARCAR_ENTREGA_DUPLICADA", id, duplicadaDe: duplicadaDe || undefined });
        if (!res.ok) throw new Error(res.error || "No se pudo marcar");
        toast("✅ Entrega marcada como duplicada");
        cargarEntregasPendientesPerfil();
    } catch (e) {
        toast("⚠️ " + e.message, "#c0392b");
    }
}
