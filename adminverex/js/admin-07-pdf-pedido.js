// Admin VEREX — PDF de pedido
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  PDF DE PEDIDO
// ═════════════════════════════════════════════
function generarPDFAdmin(idx, numeroPedido) {
    // Reconstruir lista filtrada igual que renderPedidos
    const busq = document.getElementById("bus-ped").value.toLowerCase();
    const fil  = document.getElementById("fil-estado").value;
    let list = pedidos.filter(p =>
        (!busq || (p.cliente||"").toLowerCase().includes(busq) ||
                  (p.productos||"").toLowerCase().includes(busq) ||
                  (p.numeroPedido||"").toLowerCase().includes(busq)) &&
        (!fil  || p.estado === fil)
    );
    list = filtrarPorPeriodo(list);
    const p = list[idx];
    if (!p) return toast("⚠️ Pedido no encontrado", "#ef4444");

    // Parsear items desde el campo productos (texto) o items JSON si existe
    let items = [];
    try { items = typeof p.items === "string" ? JSON.parse(p.items) : (p.items || []); } catch(_) {}

    // Si no hay items estructurados, construir uno genérico desde el texto
    if (!items.length && p.productos) {
        String(p.productos || "").split(",").forEach(prod => {
            const match = prod.trim().match(/^(.+?)\s*\((.+?)\)$/);
            items.push({
                codigo:      p.numeroPedido || "—",
                nombre:      match ? match[1].trim() : prod.trim(),
                tallaElegida: match ? match[2].trim() : "",
                precioNum:   0,
            });
        });
    }

    // Calcular valores financieros desde el total guardado
    const totalStr  = String(p.total || "").replace(/[^0-9.]/g, "");
    const totalNum  = parseFloat(totalStr) || 0;

    const datos = {
        nombre:       p.cliente    || "—",
        tel:          p.telefono   || "—",
        ubicacion:    p.departamento || p.municipio || "—",
        direccion:    p.direccion  || "—",
        metodoPago:   p.metodoPago || "—",
        numeroPedido: p.numeroPedido || numeroPedido || "—",
        items,
        cuponUsado:   p.cuponUsado || "",
        descMonto:    p.descMonto  || 0,
        envio:        p.envio      || 0,
        totalFinal:   p.total      || `$${totalNum.toFixed(2)}`,
    };

    try {
        const doc = generarPDF(datos);
        doc.save(`Verex_${datos.numeroPedido.replace(/#/g,"")}.pdf`);
        toast("📄 PDF generado correctamente", "#22c55e");
    } catch(e) {
        console.error(e);
        toast("⚠️ Error generando PDF", "#ef4444");
    }
}

function generarPDF(datos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'in', format: [4, 6] });

    const marginL = 0.35;
    const pageW   = 4;
    const marginR = pageW - marginL;
    const tableW  = marginR - marginL;
    const cellPad = 0.07;
    const rowH    = 0.26;

    const cols = [
        { x: marginL, w: 0.72, label: "Código",      align: "left"  },
        { x: 1.09,    w: 1.92, label: "Descripción", align: "left"  },
        { x: 3.03,    w: 0.62, label: "Precio",      align: "right" },
    ];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Nota de Pedido - VEREX STORE", pageW / 2, 0.45, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`N° Pedido: ${datos.numeroPedido || "—"}`, pageW / 2, 0.62, { align: "center" });
    doc.setTextColor(0, 0, 0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let y = 0.90;
    const lh = 0.175;
    doc.text(`Cliente: ${datos.nombre}`,     marginL, y); y += lh;
    doc.text(`Teléfono: ${datos.tel}`,        marginL, y); y += lh;
    doc.text(`Ubicación: ${datos.ubicacion}`, marginL, y); y += lh;
    if (datos.metodoPago) { doc.text(`Pago: ${datos.metodoPago}`, marginL, y); y += lh; }
    y += 0.12;

    function drawRow(rowY, height, fillRGB) {
        if (fillRGB) { doc.setFillColor(...fillRGB); doc.rect(marginL, rowY, tableW, height, 'F'); }
        doc.setDrawColor(190, 190, 190);
        doc.setLineWidth(0.005);
        doc.rect(marginL, rowY, tableW, height, 'S');
        let cx = marginL;
        cols.slice(0, -1).forEach(col => { cx += col.w; doc.line(cx, rowY, cx, rowY + height); });
    }

    function cellText(text, col, rowY, height, style) {
        doc.setFont("helvetica", style || "normal");
        const str = String(text);
        if (col.align === "right") {
            doc.setFontSize(8.5);
            doc.text(str, col.x + col.w - cellPad, rowY + height / 2 + 0.032, { align: "right" });
        } else {
            const maxW = col.w - cellPad * 2;
            doc.setFontSize(8.5);
            let lines = doc.splitTextToSize(str, maxW);
            if (lines.length > 1) { doc.setFontSize(7.5); lines = doc.splitTextToSize(str, maxW); }
            if (lines.length === 1) {
                doc.text(lines[0], col.x + cellPad, rowY + height / 2 + 0.032);
            } else {
                doc.text(lines[0], col.x + cellPad, rowY + height / 2 - 0.04);
                doc.text(lines[1], col.x + cellPad, rowY + height / 2 + 0.10);
            }
        }
        doc.setFontSize(8.5);
    }

    doc.setFontSize(8.5);
    drawRow(y, rowH, null);
    cols.forEach(col => cellText(col.label, col, y, rowH, "bold"));
    y += rowH;

    let subtotal = 0;
    (datos.items || []).forEach(item => {
        const talla = item.tallaElegida || item.talla || "";
        const tallaEsUnica = talla === "Única" || talla === "";
        const tallaCorta = tallaEsUnica ? "" : "T" + talla.replace(/[^0-9]/g, "");
        const material = item.material ? ` · ${item.material}` : "";
        const descripcion = tallaCorta ? `${item.nombre}  ${tallaCorta}${material}` : `${item.nombre}${material}`;
        drawRow(y, rowH, null);
        cellText(item.codigo,                     cols[0], y, rowH);
        cellText(descripcion,                     cols[1], y, rowH);
        cellText(`$${(item.precioNum||0).toFixed(2)}`, cols[2], y, rowH);
        subtotal += (item.precioNum || 0);
        y += rowH;
    });

    const cupon     = datos.cuponUsado || "";
    const envio     = datos.envio ?? 0;
    const descMonto = datos.descMonto ?? 0;
    const total     = subtotal - descMonto + envio;

    function totalRow(label, value, bold, bigger) {
        const h = bigger ? rowH + 0.04 : rowH;
        doc.setDrawColor(190, 190, 190);
        doc.setLineWidth(0.005);
        doc.rect(marginL, y, tableW, h, 'S');
        const ty = y + h / 2 + (bigger ? 0.04 : 0.032);
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(bigger ? 10 : 8.5);
        doc.text(label, cols[2].x - cellPad, ty, { align: "right" });
        doc.text(value, cols[2].x + cols[2].w - cellPad, ty, { align: "right" });
        y += h;
    }

    totalRow("SUBTOTAL", `$${subtotal.toFixed(2)}`);
    if (descMonto > 0) {
        totalRow(cupon ? `DESC. (${cupon})` : `DESC.`, `-$${descMonto.toFixed(2)}`);
    }
    totalRow("ENVÍO", envio > 0 ? `$${envio.toFixed(2)}` : "GRATIS");
    totalRow("TOTAL FINAL:", `$${total.toFixed(2)}`, true, true);

    const yFrase = Math.max(y + 0.25, 5.55);
    doc.setFont("times", "italic");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text("Gracias por tu compra.", pageW / 2, yFrase, { align: "center" });
    doc.text("El mundo es mejor cuando tu brillas.", pageW / 2, yFrase + 0.13, { align: "center" });
    doc.setTextColor(0, 0, 0);

    return doc;
}

async function eliminarPedido(numeroPedido) {
    if (!confirm(`⚠️ VEREX STORE\n\n¿Eliminar el pedido ${numeroPedido}?\nEsta acción no se puede deshacer.`)) return;
    const idx = pedidos.findIndex(p => p.numeroPedido === numeroPedido);
    if (idx >= 0) pedidos.splice(idx, 1);
    renderPedidos();
    await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ accion:"ELIMINAR_PEDIDO", _pass:ADMIN_PASS, numeroPedido })
    });
    toast("🗑️ Pedido eliminado", "#ef4444");
}

// Municipios zona metropolitana de San Salvador
const ZONA_METRO = [
    "antiguo cuscatlán","apopa","ayutuxtepeque","ciudad delgado","cuscatancingo",
    "ilopango","mejicanos","nejapa","san marcos","san martín","san martin",
    "san salvador","santa tecla","santo tomás","santo tomas","soyapango","tonacatepeque"
];

function esZonaMetro(municipio) {
    const m = (municipio || "").toLowerCase();
    return ZONA_METRO.some(z => m.includes(z));
}

function mensajeWhatsApp(estado, p) {
    const nombre = p.cliente || "cliente";
    const numero = p.numeroPedido || "—";
    const metro  = esZonaMetro(p.municipio);

    if (estado === "Despachado") {
        const tiempo = metro
            ? "Como estás cerca, lo tendrás en tus manos hoy o mañana."
            : "En 1 a 2 días hábiles estará en tus manos.";
        return "Hola " + nombre + ", tu pedido " + numero + " ya está en camino hacia ti! " + tiempo + " Gracias por elegir VEREX!";
    }
    if (estado === "Entregado") {
        return "Hola " + nombre + ", tu pedido " + numero + " fue entregado con éxito. Esperamos que lo ames tanto como nosotros al hacerlo llegar hasta ti. Gracias por ser parte de VEREX!";
    }
    return null;
}

async function cambiarEstado(sel, numeroPedido, cliente, fecha) {
    const estado = sel.value;
    const p = pedidos.find(p => p.numeroPedido === numeroPedido || (p.cliente === cliente && String(p.fecha) === String(fecha)));
    if (p) p.estado = estado;

    await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ accion:"ACTUALIZAR_ESTADO_PEDIDO", _pass:ADMIN_PASS, numeroPedido, cliente, fecha, estado })
    });

    // Enviar mensaje de WhatsApp solo si el pedido fue por WhatsApp (no por correo)
    const msg = mensajeWhatsApp(estado, p);
    if (msg && p && (p.canal || "whatsapp") !== "correo") {
        const tel = String(p.telefono || "").replace(/\D/g, "");
        if (tel) window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`);
    }

    toast(`✅ Estado: ${estado}`);
}
