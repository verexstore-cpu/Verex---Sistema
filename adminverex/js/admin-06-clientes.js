// Admin VEREX — Clientes
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  CLIENTES
// ═════════════════════════════════════════════
let clientes = [];

async function migrarClientesVentaDirecta(btn) {
    if (!confirm("Esto sincroniza los clientes que ya compraron por Venta Directa hacia esta lista, deduplicados por teléfono. Es seguro correrlo más de una vez. ¿Continuar?")) return;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Sincronizando..."; }
    try {
        const res  = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"MIGRAR_CLIENTES_VENTA_DIRECTA", _pass: ADMIN_PASS }) });
        const data = await res.json();
        if (!data.ok) { toast("⚠️ No se pudo sincronizar", "#ef4444"); return; }
        toast(`✅ ${data.creados} cliente(s) nuevo(s), ${data.actualizados} actualizado(s) — de ${data.totalVentasDirectas} ventas directas`, "#22c55e");
        await cargarDatos();
    } catch(e) {
        toast("⚠️ Error de conexión", "#ef4444");
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "🔄 Sincronizar clientes de Venta Directa"; }
    }
}

function badgeCanalCliente(c) {
    const eco = parseInt(c.totalPedidosEcommerce) || 0;
    const dir = parseInt(c.totalPedidosDirecta) || 0;
    const afi = parseInt(c.totalPedidosAfiliado) || 0;
    const partes = [];
    if (eco > 0) partes.push(`<span style="display:inline-block;font-size:10px;font-weight:700;color:#0277bd;background:rgba(2,119,189,0.12);border:1px solid rgba(2,119,189,0.3);border-radius:5px;padding:1px 6px;margin:1px;">🛒 Ecommerce (${eco})</span>`);
    if (dir > 0) partes.push(`<span style="display:inline-block;font-size:10px;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.12);border:1px solid rgba(22,163,74,0.3);border-radius:5px;padding:1px 6px;margin:1px;">🤝 Directa (${dir})</span>`);
    if (afi > 0) partes.push(`<span style="display:inline-block;font-size:10px;font-weight:700;color:#7c3aed;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);border-radius:5px;padding:1px 6px;margin:1px;">🎯 Afiliado (${afi})</span>`);
    return partes.length ? partes.join(" ") : '<span style="font-size:11px;color:#aaa;">—</span>';
}

function renderClientes() {
    const busq = (document.getElementById("bus-cli")?.value || "").toLowerCase();
    const list = clientes.filter(c =>
        !busq ||
        (c.nombre||"").toLowerCase().includes(busq) ||
        (c.telefono||"").toString().includes(busq) ||
        (c.codigo||"").toLowerCase().includes(busq)
    );

    document.getElementById("resumen-cli").textContent =
        `${list.length} cliente${list.length !== 1 ? "s" : ""} registrado${list.length !== 1 ? "s" : ""}`;

    // Tabla escritorio
    const tb = document.getElementById("tb-cli");
    if (tb) tb.innerHTML = list.map((c,i) => {
        const tel   = String(c.telefono||"").replace(/\D/g,"");
        const fecha = c.fechaRegistro ? new Date(c.fechaRegistro).toLocaleDateString("es-SV") : "—";
        return `<tr>
            <td><span style="font-family:monospace;font-weight:700;color:var(--azul);">${c.codigo||"—"}</span></td>
            <td><b>${esc(c.nombre)||"—"}</b></td>
            <td><a href="https://wa.me/${tel}" target="_blank" style="color:var(--verde);font-weight:600;text-decoration:none;">${esc(c.telefono)||"—"}</a></td>
            <td>${esc(c.municipio)||"—"}</td>
            <td style="text-align:center;"><b>${c.totalPedidos||0}</b></td>
            <td>${badgeCanalCliente(c)}</td>
            <td style="font-size:12px;color:#888;">${fecha}</td>
            <td><button class="btn" style="background:#111;color:#fff;padding:4px 10px;font-size:12px;"
                onclick="generarCuponCliente(${jsAttr(c.codigo)},${jsAttr(c.nombre)},${jsAttr(c.telefono)})">🎫 Generar</button></td>
        </tr>`;
    }).join('');

    // Tarjetas móvil
    const cards = document.getElementById("cards-cli");
    if (cards) cards.innerHTML = list.map((c,i) => {
        const tel   = String(c.telefono||"").replace(/\D/g,"");
        const fecha = c.fechaRegistro ? new Date(c.fechaRegistro).toLocaleDateString("es-SV") : "—";
        return `<div class="ped-card">
            <div class="ped-card-header">
                <span class="ped-card-num">${c.codigo||"—"}</span>
                <span class="ped-card-fecha">${fecha}</span>
            </div>
            <div class="ped-card-body">
                <span>👤 <b>${esc(c.nombre)||"—"}</b></span>
                <span>📱 <a href="https://wa.me/${tel}" target="_blank" style="color:var(--verde);font-weight:600;text-decoration:none;">${esc(c.telefono)||"—"}</a></span>
                <span>📍 ${esc(c.municipio)||"—"}</span>
                <span>🛍️ <b>${c.totalPedidos||0}</b> pedidos</span>
                <span>${badgeCanalCliente(c)}</span>
            </div>
            <div class="ped-card-footer">
                <button class="btn" style="background:#111;color:#fff;padding:6px 14px;font-size:13px;width:100%;"
                    onclick="generarCuponCliente(${jsAttr(c.codigo)},${jsAttr(c.nombre)},${jsAttr(c.telefono)})">🎫 Generar Cupón</button>
            </div>
        </div>`;
    }).join('');
}

function exportarClientesExcel() {
    const busq = (document.getElementById("bus-cli")?.value || "").toLowerCase();
    const list = clientes.filter(c =>
        !busq ||
        (c.nombre||"").toLowerCase().includes(busq) ||
        (c.telefono||"").toString().includes(busq) ||
        (c.codigo||"").toLowerCase().includes(busq)
    );
    if (!list.length) { toast("No hay clientes para exportar", "#ef4444"); return; }

    const filas = [
        ["Código", "Nombre", "Teléfono", "Correo", "Municipio", "Departamento", "Total Pedidos", "Pedidos Ecommerce", "Pedidos Directa", "Pedidos Afiliado", "Fecha Registro"]
    ];
    list.forEach(c => {
        filas.push([
            c.codigo || "",
            c.nombre || "",
            c.telefono || "",
            c.correo || "",
            c.municipio || "",
            c.departamento || "",
            c.totalPedidos || 0,
            c.totalPedidosEcommerce || 0,
            c.totalPedidosDirecta || 0,
            c.totalPedidosAfiliado || 0,
            c.fechaRegistro ? new Date(c.fechaRegistro).toLocaleDateString("es-SV") : ""
        ]);
    });

    const csv = filas.map(f => f.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `clientes-verex-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`✅ ${list.length} clientes exportados`, "#1a7a4a");
}

async function generarCuponCliente(codigo, nombre, telefono) {
    const descuento = prompt(`Descuento para ${nombre} (%):`, "10");
    if (!descuento || isNaN(descuento)) return;
    const codigoCupon = `${codigo}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
    const datos = {
        accion: "CREAR_CUPON", _pass: ADMIN_PASS,
        codigo: codigoCupon, tipo: "porcentaje",
        descuento: parseFloat(descuento), categorias: "",
        montoMinimo: 0, limiteUsos: 1, activo: true,
        codigoCliente: codigo
    };
    await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(datos) });
    const tel = String(telefono).replace(/\D/g,"");
    const msg = "Hola " + nombre + "! Tienes un cupon exclusivo de VEREX: " + codigoCupon + " con " + descuento + "% de descuento. Valido para tu proxima compra!";
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`);
    toast(`✅ Cupón ${codigoCupon} generado y enviado`, "#22c55e");
    cargarDatos();
}
