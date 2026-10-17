// Hub VEREX — Venta directa: recibo (HTML, PDF e impresora térmica)
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
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
