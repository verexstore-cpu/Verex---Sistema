// Hub VEREX — Venta directa: créditos, abonos, PDF y estado de cuenta
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
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
