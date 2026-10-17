// Hub VEREX — Envío por mensajería y recibo
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── MENSAJERÍA ───────────────────────────────────────────────────────
let _mensajeriaItems = [];
let _mensajeriaCodigo = "";
let _mensajeriaVendedor = null;

async function enviarPorMensajeria() {
    const items = Object.values(carritoEntrega);
    if (!items.length) return;

    _mensajeriaCodigo = generarCodigoFirma();
    _mensajeriaVendedor = { ...vendedorActual };

    _mensajeriaItems = items.map(e => ({
        id:          Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        codigo:      e.item.codigo,
        codigoBase:  e.item.codigoBase || getCodigoBase(e.item.codigo),
        talla:       e.item.talla || getTallaFromCodigo(e.item.codigo) || "",
        nombre:      e.item.nombre,
        nombre_base: e.item.nombre_base || (e.item.nombre || "").replace(/ T\d+$/i, "").trim(),
        categoria:   e.item.categoria || getCodigoBase(e.item.codigo).match(/^[A-Z]+/)?.[0] || "GEN",
        precio:      e.item.precio || e.item.precioNum || 0,
        cantidad:    e.qty,
        foto:        e.item.foto || e.item.img || ""
    }));

    try {
        await apiPost({ accion: "REGISTRAR_ENTREGA", vendedor: vendedorActual.codigo, items: _mensajeriaItems });
    } catch(e) { console.warn("REGISTRAR_ENTREGA error:", e); }

    _mensajeriaItems.forEach(item => consignacion.push({ ...item, vendedor: vendedorActual.codigo, vendido: 0, estado: "activo" }));

    const entregaId = "ENT_" + Date.now();
    try {
        const itemsParaSheet = _mensajeriaItems.map(i => ({
            codigo: i.codigo, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad
        }));
        const respPend = await apiPost({
            accion: "REGISTRAR_ENTREGA_PENDIENTE",
            id: entregaId,
            vendedor: vendedorActual.codigo,
            items: itemsParaSheet,
            codigoRecibo: _mensajeriaCodigo
        });
        if (!respPend.ok) toast("⚠️ Error al registrar pendiente: " + (respPend.error || "desconocido"));
    } catch(e) { toast("⚠️ Error al guardar entrega pendiente: " + e.message); console.error("REGISTRAR_ENTREGA_PENDIENTE error:", e); }

    document.getElementById("mens-codigo").textContent = _mensajeriaCodigo;
    toast("✅ Envío registrado");
    volverPerfil();
    renderPerfilStats();
    renderInventario();
    abrirModal("modal-mensajeria");
}

function copiarCodigoMensajeria() {
    navigator.clipboard.writeText(_mensajeriaCodigo)
        .then(() => toast("📋 Código copiado"))
        .catch(() => prompt("Copia este código:", _mensajeriaCodigo));
}

function enviarWhatsAppMensajeria() {
    if (!_mensajeriaVendedor) { toast("⚠️ No hay vendedor seleccionado"); return; }
    const tel = String(_mensajeriaVendedor.telefono || "").replace(/\D/g, "");
    if (!tel) { toast("⚠️ El vendedor no tiene teléfono registrado"); return; }
    const msg = "Hola " + (_mensajeriaVendedor.nombre || "") + ", tu paquete VEREX fue enviado por mensajería. "
        + "Cuando lo recibas, abre tu inventario y usa este código para confirmar la recepción:\n\n"
        + "*" + _mensajeriaCodigo + "*";
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
}

function descargarPDFMensajeria() {
    generarReciboPDF(_mensajeriaVendedor, _mensajeriaItems, null, _mensajeriaCodigo, true);
}

function generarReciboPDF(vendedor, items, firmaImg, codigoFirma, esMensajeria) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        toast("⚠️ No se pudo cargar jsPDF — verifica tu conexión a internet");
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const fecha = new Date().toLocaleDateString("es-SV", { year: "numeric", month: "long", day: "numeric" });
    const pageW = 210;
    const mL = 20, mR = 20;
    const textW = pageW - mL - mR;
    let y = 20;

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(201, 168, 76);
    doc.text("VEREX", pageW / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text("RECIBO DE ENTREGA EN CONSIGNACIÓN", pageW / 2, y, { align: "center" }); y += 7;
    if (esMensajeria) {
        doc.setFontSize(9);
        doc.setTextColor(180, 100, 30);
        doc.text("VÍA MENSAJERÍA — PENDIENTE DE FIRMA DEL VENDEDOR", pageW / 2, y, { align: "center" });
        y += 7;
    }

    // Datos
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    [["Fecha:", fecha], ["Vendedor:", vendedor.nombre], ["Teléfono:", String(vendedor.telefono)], ["Código:", vendedor.codigo]].forEach(([label, val]) => {
        doc.setFont("helvetica", "bold"); doc.text(label, mL, y);
        doc.setFont("helvetica", "normal"); doc.text(val, mL + 35, y); y += 6;
    });
    y += 4;

    // Tabla productos
    const colWidths = [30, 80, 20, 25, 25];
    const headers = ["Código", "Producto", "Cant.", "Precio", "Subtotal"];
    const rowH = 8;

    const dibujarEncabezadoTabla = () => {
        doc.setFillColor(30, 30, 30);
        doc.rect(mL, y, textW, rowH, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        let xh = mL;
        headers.forEach((h, i) => { doc.text(h, xh + 2, y + 5); xh += colWidths[i]; });
        y += rowH;
    };
    dibujarEncabezadoTabla();
    let x = mL;

    // Con muchas piezas la tabla sigue en otra hoja (antes las filas pasadas del borde, el total y la firma se perdían)
    const limiteY = 272;
    let total = 0, totalPiezas = 0;
    items.forEach((item, idx) => {
        if (y + rowH > limiteY) { doc.addPage(); y = 20; dibujarEncabezadoTabla(); }
        const subtotal = parseFloat(item.precio) * parseInt(item.cantidad);
        total += subtotal;
        totalPiezas += parseInt(item.cantidad) || 0;
        doc.setFillColor(idx % 2 === 0 ? 248 : 255, idx % 2 === 0 ? 248 : 255, idx % 2 === 0 ? 248 : 255);
        doc.rect(mL, y, textW, rowH, 'F');
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        x = mL;
        [item.codigo, item.nombre.substring(0, 35), String(item.cantidad), "$" + parseFloat(item.precio).toFixed(2), "$" + subtotal.toFixed(2)].forEach((val, i) => {
            doc.text(val, x + 2, y + 5); x += colWidths[i];
        });
        y += rowH;
    });

    // Total + nota + firmas se mantienen juntos: si no caben en la hoja actual, pasan a una nueva
    if (y + rowH + 10 + 25 + 26 + 18 + (codigoFirma ? 24 : 0) > limiteY + 8) { doc.addPage(); y = 20; }

    // Total
    doc.setFillColor(201, 168, 76);
    doc.rect(mL, y, textW, rowH, 'F');
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("TOTAL CONSIGNADO: " + totalPiezas + (totalPiezas === 1 ? " pieza" : " piezas"), mL + 2, y + 5);
    doc.text("$" + total.toFixed(2), pageW - mR - 2, y + 5, { align: "right" });
    y += rowH + 10;

    // Nota
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const nota = "El vendedor recibe las piezas en perfectas condiciones y se compromete a devolverlas o reportar su venta en la fecha del próximo corte.";
    const notaLines = doc.splitTextToSize(nota, textW);
    doc.text(notaLines, mL, y); y += notaLines.length * 5 + 14;

    // Firmas
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);

    // Si hay firma digital, insertar imagen
    if (firmaImg) {
        try {
            doc.addImage(firmaImg, "PNG", mL, y - 2, 70, 25);
        } catch(e) {}
    }
    y += 26;
    doc.line(mL, y, mL + 70, y);
    doc.line(pageW - mR - 70, y, pageW - mR, y);
    y += 5;
    doc.text("Firma del Vendedor", mL, y);
    doc.text("Firma VEREX", pageW - mR - 70, y); y += 5;
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(vendedor.nombre, mL, y);
    doc.text("Administrador", pageW - mR - 70, y);

    // Código de confirmación
    if (codigoFirma) {
        y += 12;
        doc.setFillColor(40, 40, 40);
        doc.rect(mL, y, textW, 12, 'F');
        doc.setTextColor(201, 168, 76);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("Código de confirmación:", mL + 4, y + 8);
        doc.setFontSize(13);
        doc.text(codigoFirma, pageW - mR - 4, y + 8, { align: "right" });
        y += 12;
    }

    // Footer en cada página
    const nPagRec = doc.getNumberOfPages();
    for (let pg = 1; pg <= nPagRec; pg++) {
        doc.setPage(pg);
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        doc.text("VEREX Nexus • " + fecha + (nPagRec > 1 ? "  ·  Página " + pg + " de " + nPagRec : ""), pageW / 2, 285, { align: "center" });
    }

    doc.save("Recibo_Entrega_" + vendedor.nombre.replace(/ /g, "_") + "_" + new Date().toLocaleDateString("es-SV").replace(/\//g, "-") + ".pdf");
    toast("📄 Recibo generado");
}
