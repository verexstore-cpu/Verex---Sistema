

function selFormatoNota(fmt, btn) {
    _notaFormato = fmt;
    localStorage.setItem('verex_nota_formato', fmt);
    document.querySelectorAll('#nota-format-grid button').forEach(b => {
        b.style.background = '#222'; b.style.color = '#aaa'; b.style.border = '1px solid #333';
    });
    btn.style.background = '#7a4ad4'; btn.style.color = '#fff'; btn.style.border = 'none';
    actualizarPreviewNota();
}

async function actualizarPreviewNota() {
    const area = document.getElementById('nota-preview-area');
    if (!area) return;
    const texto = (document.getElementById('nota-texto-libre')?.value || '').trim();
    if (!texto) { area.innerHTML = ''; return; }
    try {
        const pdfBase64 = await generarPDFNotaLibre(texto, _notaFormato);
        area.innerHTML = `
            <p style="color:#666;font-size:10px;text-align:center;margin-bottom:4px;">Vista previa</p>
            <iframe src="data:application/pdf;base64,${pdfBase64}"
                style="width:100%;height:130px;border:1px solid #333;border-radius:6px;background:#fff;"
                scrolling="no"></iframe>`;
    } catch(e) {
        area.innerHTML = '<p style="color:#444;font-size:11px;text-align:center;padding:8px;">Vista previa no disponible</p>';
    }
}

// Genera un PDF de texto libre centrado, con auto-reducción de tamaño de fuente
// hasta que el texto quepa en las dimensiones del formato elegido.
async function generarPDFNotaLibre(texto, formato, copias) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF no cargado');
    const t = (texto || '').trim();
    if (!t) throw new Error('Escribe el texto de la nota');
    const d = NOTA_DIMS[formato] || NOTA_DIMS.producto;
    const { jsPDF } = window.jspdf;
    const W = d.w, H = d.h, pad = Math.min(4, W * 0.08);
    const orientation = (W >= H) ? 'landscape' : 'portrait';
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation });

    // Punto de partida = el automático de siempre, multiplicado por la escala
    // que eligió el usuario. El bucle de abajo lo sigue reduciendo si no entra,
    // así que subir la escala nunca puede desbordar la etiqueta: en el peor
    // caso el texto termina en el mismo tamaño que daba el automático.
    // El piso también se escala, para que al pedir letra chica de verdad baje
    // (con el piso fijo en 5pt no se notaba el cambio en textos largos).
    // El tamaño de partida se ALINEA a una grilla de 0.25pt y se baja por esa
    // misma grilla. Sin esto la escala no era monótona: al 70% arrancaba en
    // 7.14 y entraba de una, mientras que al 100% arrancaba en 10.2 y bajaba
    // de a 0.5 hasta 6.7 — o sea que pedir letra MÁS CHICA la daba MÁS GRANDE.
    // Con la grilla compartida, subir la escala nunca achica.
    const deseado = Math.min(14, H * 0.6) * _notaEscala;
    let fontSize = Math.floor(deseado * 4) / 4;
    const minFont = 3;
    let lineas, lineH;
    doc.setFont('helvetica', 'bold');
    while (fontSize >= minFont) {
        doc.setFontSize(fontSize);
        lineas = doc.splitTextToSize(t, W - pad * 2);
        lineH = fontSize * 0.42;
        if (lineas.length * lineH <= H - pad * 2) break;
        fontSize -= 0.25;
    }
    doc.setTextColor(0, 0, 0);
    const altoTexto = lineas.length * lineH;

    // Una página por copia. El tamaño de fuente ya está resuelto, así que todas
    // salen idénticas; el servidor las separa después en etiquetas distintas.
    const n = Math.max(1, Math.min(50, parseInt(copias) || 1));
    for (let c = 0; c < n; c++) {
        if (c > 0) doc.addPage([W, H], orientation);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize);
        doc.setTextColor(0, 0, 0);
        let y = (H - altoTexto) / 2 + lineH * 0.8;
        lineas.forEach(linea => {
            doc.text(linea, W / 2, y, { align: 'center' });
            y += lineH;
        });
    }
    const raw = doc.output('datauristring');
    return raw.split(',')[1];
}

async function enviarNotaImpresion() {
    const status = document.getElementById('nota-status');
    const texto = (document.getElementById('nota-texto-libre')?.value || '').trim();
    if (!texto) { status.style.color = '#ef4444'; status.textContent = '⚠️ Escribe el texto de la nota'; return; }

    status.style.color = '#a47ae8';
    status.textContent = '⏳ Generando PDF…';
    let pdfBase64 = null;
    try {
        pdfBase64 = await generarPDFNotaLibre(texto, _notaFormato, _notaCopias);
    } catch(err) {
        status.style.color = '#ef4444';
        status.textContent = '⚠️ Error PDF: ' + (err.message || err);
        return;
    }

    let serverVivo = false;
    try {
        const ping = await fetch(PRINT_SERVER + '/ping', { signal: AbortSignal.timeout(3000) });
        serverVivo = ping.ok;
    } catch {}

    if (serverVivo) {
        status.textContent = '📡 Enviando a impresora…';
        try {
            const res = await fetch(PRINT_SERVER + '/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // separar:true pide que cada página salga como etiqueta aparte y
                // no como una tira larga — si no, las copias vendrían pegadas.
                body: JSON.stringify({ formato: _notaFormato, rollo: _rolloImpresion, pdf_base64: pdfBase64, pageCount: _notaCopias, separar: true, printerIp: localStorage.getItem('verex_wifi_ip') || undefined })
            });
            const json = await res.json();
            if (json.ok) {
                status.style.color = '#22c55e';
                status.textContent = '✅ Nota enviada a Brother QL';
                setTimeout(() => { cerrarModalNota(); }, 1800);
            } else {
                status.style.color = '#ef4444';
                status.textContent = '⚠️ ' + (json.error || 'Error en impresora');
            }
        } catch(e) {
            status.style.color = '#ef4444';
            status.textContent = '⚠️ Error al enviar al servidor';
        }
    } else {
        imprimirPDFNotaNavegador(pdfBase64, _notaFormato);
        status.style.color = '#22c55e';
        status.textContent = '✅ Abriendo diálogo de impresión…';
        setTimeout(() => { cerrarModalNota(); }, 1200);
    }
}

function imprimirPDFNotaNavegador(pdfBase64, formato) {
    const d = NOTA_DIMS[formato] || NOTA_DIMS.producto;
    const orient = (d.w > d.h) ? 'landscape' : 'portrait';
    const cssSize = `${d.w}mm ${d.h}mm`;

    const html = `<!DOCTYPE html><html><head>
<style>
  @page { size: ${cssSize} ${orient}; margin: 0; }
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

    const w = window.open('', '_blank', `width=${Math.round(d.w * 3.78)},height=${Math.round(d.h * 3.78)}`);
    if (w) { w.document.write(html); w.document.close(); }
}

// Busca un producto por código en stockData y, como fallback, en productosDisponibles
function _buscarProducto(codigo) {
    return (typeof stockData !== 'undefined' && stockData.find(s => s.codigo === codigo))
        || (typeof productosDisponibles !== 'undefined' && productosDisponibles.find(p => p.codigo === codigo))
        || null;
}

// Genera PDF con 1 etiqueta por página (para enviar al print server)
// Soporta formato 'producto' (rollo continuo 6×1.5cm) y 'dk1204' (precortada 5.43×1.7cm)
async function generarPDFParaServidor(codigos, formato, notaTexto) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF no cargado');

    const prods = codigos.map(_buscarProducto).filter(Boolean);
    if (!prods.length) throw new Error('Productos no encontrados. Códigos: ' + codigos.join(','));
    if (prods.length < codigos.length) {
        const faltantes = codigos.filter(c => !_buscarProducto(c));
        console.warn('Códigos sin datos (se omitirán):', faltantes);
    }

    // Generar QR images
    const qrImages = {};
    await Promise.all(prods.map(p => new Promise(resolve => {
        const div = document.createElement("div");
        div.style.display = "none";
        document.body.appendChild(div);
        try {
            new QRCode(div, { text: p.codigo, width: 120, height: 120,
                colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
            setTimeout(() => {
                const img = div.querySelector("img") || div.querySelector("canvas");
                if (img) qrImages[p.codigo] = img.tagName === "CANVAS" ? img.toDataURL("image/png") : img.src;
                document.body.removeChild(div); resolve();
            }, 100);
        } catch(e) { document.body.removeChild(div); resolve(); }
    })));

    const { jsPDF } = window.jspdf;
    const B = [0, 0, 0];

    // ── FORMATO DK-2214 — cinta 12mm — 50×12mm ──────────────────────────────
    if (formato === 'dk2214') {
        const W = 50, H = 12, DIV = 25;
        const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
        // registrar Tahoma Bold en este doc
        const hasTahoma = !!window.TAHOMA_BOLD_B64;
        if (hasTahoma) {
            try {
                doc.addFileToVFS('TahomaBold.ttf', window.TAHOMA_BOLD_B64);
                doc.addFont('TahomaBold.ttf', 'TahomaBold', 'normal');
            } catch(e) {}
        }

        prods.forEach((p, idx) => {
            if (idx > 0) doc.addPage([W, H], 'landscape');

            // ── QR 8×8mm ─────────────────────────────────────────────────────
            if (qrImages[p.codigo]) {
                try { doc.addImage(qrImages[p.codigo], 'PNG', 0.8, 2.2, 8, 8); } catch(e) {}
            }

            // ── Precio a la derecha del QR ──────────────────────────────────
            const dataX = 9.5, dataW = DIV - dataX - 0.5;
            const precio = '$ ' + parseFloat(p.precio || 0).toFixed(2);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...B);
            doc.text(precio, dataX, 5.0);

            // ── Material debajo del precio ───────────────────────────────────
            const material = p.material || extraerMaterial(p.nombre || '', p.descripcion || '');
            if (material) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...B);
                doc.text(doc.splitTextToSize(material, dataW)[0], dataX, 7.5);
            }

            // ── Código debajo del material (Tahoma Bold 5pt, hasta 12 chars) ─
            const codigo = p.codigo || '';
            if (codigo) {
                if (hasTahoma) doc.setFont('TahomaBold', 'normal');
                else doc.setFont('helvetica', 'bold');
                doc.setFontSize(5); doc.setTextColor(...B);
                doc.text(codigo.slice(0, 12), dataX, 9.6);
            }

            // ── Línea divisoria vertical ────────────────────────────────────
            doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.2);
            doc.line(DIV, 0.8, DIV, 11.2);

            // ── Logo VEREX centrado ──────────────────────────────────────────
            const logoCX = DIV + (W - DIV) / 2; // 37.5mm
            doc.setFont('times', 'bold'); doc.setFontSize(12.5);
            const verexW = doc.getTextWidth('VEREX') + 5 * (1.2 * 25.4 / 72);
            const vHalf  = verexW / 2;
            doc.setTextColor(...B);
            doc.text('VEREX', logoCX - vHalf, 4.8, { charSpace: 1.2 });

            // ── Separador: estrella+líneas corridas +0.5mm a la derecha ──────
            const sepCX = logoCX + 0.5; // corrección visual de simetría
            const sepY = 6.3, r1 = 0.65, r2 = 0.26, starGap = r1 + 0.4;
            doc.setDrawColor(...B); doc.setLineWidth(0.22);
            doc.line(sepCX - vHalf,   sepY, sepCX - starGap, sepY);
            doc.line(sepCX + starGap, sepY, sepCX + vHalf,   sepY);
            doc.setFillColor(...B);
            const sPts = [];
            for (let i = 0; i < 8; i++) {
                const a = (i * Math.PI / 4) - Math.PI / 2;
                const r = (i % 2 === 0) ? r1 : r2;
                sPts.push([sepCX + r * Math.cos(a), sepY + r * Math.sin(a)]);
            }
            doc.lines(sPts.slice(1).map((pt, i) => [pt[0]-sPts[i][0], pt[1]-sPts[i][1]]),
                      sPts[0][0], sPts[0][1], [1,1], 'FD', true);

            // ── Slogan centrado ──────────────────────────────────────────────
            doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(5.5); doc.setTextColor(...B);
            doc.text('La expresion de tu', logoCX, 8.2, { align: 'center' });
            doc.text('mejor version',      logoCX, 10.0, { align: 'center' });
        });

        const raw = doc.output('datauristring');
        return raw.split(',')[1];
    }

    // ── FORMATO MINI 2×1.2cm — 6 por DK-11201 (29×90.3mm) ───────────────────
    if (formato === 'mini') {
        const b64 = await _generarPDFMini(prods, qrImages);
        return b64;
    }

    // ── FORMATO MINI ×2 sobre DK-1204 — misma mini, dos por troquelada ──────
    if (formato === 'mini2') {
        const b64 = await _generarPDFMini2enDK1204(prods, qrImages);
        return b64;
    }

    // ── FORMATO TARJETA 25×15mm ───────────────────────────────────────────────
    if (formato === 'tarjeta25') {
        const doc = await _generarPDFTarjeta25(prods, qrImages);
        const raw = doc.output('datauristring');
        return raw.split(',')[1];
    }

    // ── FORMATO VERTICAL DK-1204 (Propuesta 3 premium) ───────────────────────
    if (formato === 'producto-v') {
        const W = 17, H = 54.3, FOLD = H / 2; // 17×54.3mm portrait, doblez en 27.15mm
        const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait' });

        prods.forEach((p, idx) => {
            if (idx > 0) doc.addPage([W, H], 'portrait');

            // — QR (parte superior, cara datos) —
            if (qrImages[p.codigo]) {
                try { doc.addImage(qrImages[p.codigo], "PNG", 1.5, 1.0, 13, 13); } catch(e) {}
            }

            // — Código vertical (borde izquierdo, 4pt) —
            const codigo = p.codigo || "";
            if (codigo) {
                doc.setFont("helvetica", "bold"); doc.setFontSize(4); doc.setTextColor(...B);
                doc.text(codigo, 0.8, FOLD - 0.5, { angle: 90 });
            }

            // — Línea dorada separadora —
            doc.setDrawColor(180, 140, 50); doc.setLineWidth(0.3);
            doc.line(1.5, 15.0, 15.5, 15.0);

            // — Material (centrado, debajo de línea) —
            const material = p.material || extraerMaterial(p.nombre || "", p.descripcion || "");
            if (material) {
                doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.setTextColor(...B);
                const matLines = doc.splitTextToSize(material, 13);
                matLines.slice(0, 3).forEach((l, i) => doc.text(l, 8.5, 17.0 + i * 2.8, { align: 'center' }));
            }

            // — Precio (fondo cara datos) —
            const precio = "$ " + parseFloat(p.precio || 0).toFixed(2);
            doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...B);
            doc.text(precio, 8.5, 25.5, { align: 'center' });

            // — VEREX letra por letra vertical (cara marca) —
            doc.setFont("times", "bold"); doc.setFontSize(16); doc.setTextColor(...B);
            "VEREX".split("").forEach((l, i) => doc.text(l, 8.5, 31.5 + i * 4.8, { align: 'center' }));

            // — Estrella (bajo VEREX) —
            const sx = 8.5, sy = 53.0, Rs = 1.4, rs = 0.55;
            const sp = []; let px = null, py = null, sx0 = 0, sy0 = 0;
            for (let i = 0; i < 10; i++) {
                const r = (i % 2 === 0) ? Rs : rs;
                const a = -Math.PI/2 + i * Math.PI/5;
                const cx = sx + r * Math.cos(a), cy = sy + r * Math.sin(a);
                if (px !== null) sp.push([cx - px, cy - py]);
                else { sx0 = cx; sy0 = cy; }
                px = cx; py = cy;
            }
            doc.setFillColor(0,0,0);
            doc.lines(sp, sx0, sy0, [1,1], 'F', true);
        });

        const raw = doc.output('datauristring');
        return raw.split(',')[1];
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Configuración del PDF según formato
    // — 'dk1204': etiqueta precortada Brother 5.4×1.7cm
    // — 'producto' (default): etiqueta colgante 6×1.5cm con doblez
    const isDK   = (formato === 'dk1204');
    const isProd = (formato === 'producto');
    const lW = isDK ? 54.3 : 60;
    const lH = isDK ? 17 : 15;
    const doc = new jsPDF({ unit: 'mm', format: [lW, lH], orientation: 'landscape' });

    const FOLD = lW / 2;
    // Producto: CX=48 con verexSize=18pt → right edge≈58.9mm < 60mm, left edge≈37mm (7mm del fold)
    const CX = isDK ? (FOLD + (lW - FOLD)/2) : isProd ? 48 : 47;

    // QR + código vertical
    // Produto: QR=8mm subido (y=0.5), precio a la DERECHA del QR, material DEBAJO del QR (ancho completo)
    const QR_MM  = isDK ? 14 : 10;
    const QR_X   = isDK ? 1.0 : isProd ? 4.5 : 1.5;
    const QR_Y   = isProd ? 0.0 : (lH - QR_MM) / 2;
    const TX     = isDK ? (QR_X + QR_MM + 4.5) : isProd ? (QR_X + QR_MM + 1.0) : (QR_X + QR_MM + 2.0);
    const TW     = FOLD - TX - 0.5;
    const CX_L   = TX;

    const FT = isDK ? {
        verexSize: 15, verexY: 8.0,
        lineY: 10.5, starR: 1.2,
        sloganSize: 7, sloganY1: 13.0, sloganY2: 15.5, sloganY3: null,
        precioSize: 10, precioY: 7.0,
        matSizeMax: 7, matY1: [11.5], matY2: [10.5, 13.5], matY3: [9.5, 12.0, 14.5]
    } : isProd ? {
        verexSize: 20, verexY: 5.0,
        lineY: 7.3, starR: 1.3,
        sloganSize: 9.0, sloganY1: 10.5, sloganY2: 13.0, sloganY3: null,
        precioSize: 10, precioY: 5.0,
        goldLineY: 10.7,
        matSizeMax: 7.5, matY1: [14.8], matY2: [13.0, 14.9], matY3: [12.0, 13.3, 14.6]
    } : {
        verexSize: 20, verexY: 5.5,
        lineY: 7.8, starR: 1.4,
        sloganSize: 5.0, sloganY1: 11.2, sloganY2: 13.7,
        precioSize: 9,  precioY: 5.5,
        matSizeMax: 6.5, matY1: [13.0], matY2: [11.5, 13.5], matY3: [10.0, 12.0, 14.0]
    };

    prods.forEach((p, idx) => {
        if (idx > 0) doc.addPage([lW, lH], 'landscape');

        // — CARA DATOS (izquierda, 0..FOLD) — layout igual que tarjeta25 ──
        if (isProd) {
            const dQR_MM = 8.5;
            const dQR_X  = 2.5;
            const dQR_Y  = 5.5;
            const dDivX  = dQR_X + dQR_MM + 0.5;
            const dMatW  = FOLD - dDivX - 0.3;
            const dPrecioY = 4.0;

            // Precio
            const precioT = "$ " + parseFloat(p.precio || 0).toFixed(2);
            doc.setFont("helvetica", "bold"); doc.setTextColor(...B);
            let dPSize = 12.0;
            while (dPSize > 5.0) { doc.setFontSize(dPSize); if (doc.getTextWidth(precioT) <= FOLD - 1.5) break; dPSize -= 0.3; }
            doc.text(precioT, dQR_X, dPrecioY);

            // QR
            if (qrImages[p.codigo]) {
                try { doc.addImage(qrImages[p.codigo], "PNG", dQR_X, dQR_Y, dQR_MM, dQR_MM); } catch(e) {}
            }

            // Material
            const matT = (p.material || extraerMaterial(p.nombre || "", p.descripcion || ""))
                           .replace(/Laminado/gi, "Lam.");
            if (matT) {
                doc.setFont("helvetica", "bold"); doc.setTextColor(...B);
                doc.setFontSize(7.5);
                const lineas = doc.splitTextToSize(matT, dMatW);
                const n = Math.min(lineas.length, 2);
                const yMat = n === 1 ? [dQR_Y + 3.5] : [dQR_Y + 1.8, dQR_Y + 4.5];
                for (let i = 0; i < n; i++) doc.text(lineas[i], dDivX, yMat[i]);
            }

            // SKU
            const codigoT = p.codigo || "";
            if (codigoT) {
                doc.setFont("helvetica", "bold"); doc.setTextColor(...B);
                doc.setFontSize(6.5);
                const skuMaxW = FOLD - dDivX - 0.2;
                const skuW = doc.getTextWidth(codigoT);
                if (skuW > skuMaxW) {
                    doc.text(codigoT, dDivX, dQR_Y + dQR_MM - 1.0, { charSpace: -((skuW - skuMaxW) / codigoT.length) });
                } else {
                    doc.text(codigoT, dDivX, dQR_Y + dQR_MM - 1.0);
                }
            }
        } else {
            // — QR (otros formatos, cara izquierda) —
            if (qrImages[p.codigo]) {
                try { doc.addImage(qrImages[p.codigo], "PNG", QR_X, QR_Y, QR_MM, QR_MM); } catch(e) {}
            }
            // — Código —
            const codigo = p.codigo || "";
            if (codigo) {
                doc.setFont("helvetica", "bold"); doc.setTextColor(...B);
                doc.setFontSize(isDK ? 5 : 4.5);
                doc.text(codigo, QR_X + QR_MM + 1.5, lH - 1.0, { angle: 90 });
            }
        }

        // — VEREX (cara derecha, times bold, negro) —
        const GOLD = [212, 175, 55];
        doc.setFont("times", "bold"); doc.setFontSize(FT.verexSize); doc.setTextColor(...B);
        doc.text("VEREX", CX, FT.verexY, { align: "center" });

        // — Línea decorativa + ESTRELLA (negro) —
        const lnHalf = isDK ? 8 : 6;
        doc.setDrawColor(...B);
        doc.setLineWidth(0.3);
        doc.line(CX - lnHalf, FT.lineY, CX - 1.8, FT.lineY);
        doc.line(CX + 1.8, FT.lineY, CX + lnHalf, FT.lineY);
        const Rs = FT.starR, rs = Rs * 0.4;
        const starPath = [];
        let prevX = null, prevY = null, starStartX = 0, starStartY = 0;
        for (let i = 0; i < 10; i++) {
            const radius = (i % 2 === 0) ? Rs : rs;
            const ang = -Math.PI/2 + i * Math.PI/5;
            const x = CX + radius * Math.cos(ang);
            const y = FT.lineY + radius * Math.sin(ang);
            if (prevX !== null) starPath.push([x - prevX, y - prevY]);
            else { starStartX = x; starStartY = y; }
            prevX = x; prevY = y;
        }
        doc.setFillColor(...B);
        doc.lines(starPath, starStartX, starStartY, [1,1], 'F', true);

        // — Slogan —
        const sloganW = isDK ? 22 : isProd ? 23 : 26;
        doc.setFont("times", "bolditalic");
        doc.setFontSize(FT.sloganSize); doc.setTextColor(...B);
        const sl = doc.splitTextToSize("La expresión de tu mejor versión", sloganW);
        const maxSlLines = FT.sloganY3 ? 3 : 2;
        const ySlogan = sl.length === 1 ? [FT.sloganY1] : sl.length === 2 ? [FT.sloganY1, FT.sloganY2] : [FT.sloganY1, FT.sloganY2, FT.sloganY3];
        sl.slice(0, maxSlLines).forEach((l, i) => doc.text(l, CX, ySlogan[i], { align: "center" }));

        // — Precio y Material (solo formatos distintos a producto — producto ya los dibuja arriba) —
        if (!isProd) {
            const precio = "$ " + parseFloat(p.precio || 0).toFixed(2);
            doc.setFont("helvetica", "bold"); doc.setFontSize(FT.precioSize); doc.setTextColor(...B);
            doc.text(precio, TX, FT.precioY, { align: "left" });

            const material = p.material || extraerMaterial(p.nombre || "", p.descripcion || "");
            if (material) {
                doc.setFont("helvetica", "bold"); doc.setTextColor(...B);
                let sz = FT.matSizeMax; doc.setFontSize(sz);
                let lineas = doc.splitTextToSize(material, TW);
                while (lineas.length > 3 && sz > 5.0) { sz -= 0.3; doc.setFontSize(sz); lineas = doc.splitTextToSize(material, TW); }
                const n = Math.min(lineas.length, 3);
                const yMat = n === 1 ? FT.matY1 : n === 2 ? FT.matY2 : FT.matY3;
                for (let i = 0; i < n; i++) doc.text(lineas[i], CX_L, yMat[i], { align: "left" });
            }
        }
    });

    const raw = doc.output('datauristring');
    return raw.split(',')[1];
}

// ── Dibujo de UNA mini 20×12mm con origen en (ox, oy) ───────────────────────
// Extraído de _generarPDFMini para poder reusarlo tal cual en la variante que
// mete dos mini por etiqueta DK-1204. Así ambas salen visualmente idénticas:
// si se ajusta el diseño acá, cambia en los dos formatos a la vez.
function _dibujarMiniEn(doc, p, qrImg, ox, oy, hasTahoma, engrosar) {
    const B = [0, 0, 0];
    const QS = 9;                   // QR más grande — pedido explícito del usuario
    const QX = 20 - QS - 0.0;       // pegado al borde derecho de la mini
    const dataX = 0.2, dataW = QX - dataX - 1.2;   // más separación del QR
    const W = 20;

    // "Negrita extra": se dibuja el contorno de cada letra además del relleno,
    // lo que engrosa el trazo en el PDF mismo. A 20×12mm las letras quedan de
    // 1-2 puntos de ancho y el cabezal térmico las marca flojas; engrosarlas
    // acá funciona mejor que tocar la conversión a blanco y negro, que ya se
    // probó (con umbral en vez de dithering salía más pálido todavía).
    // El trazo se mantiene fino en los textos chicos para no cerrar los huecos
    // de letras como la "a" o la "e".
    const trazoGrande  = engrosar ? 0.045 : 0;  // precio, 7.5pt
    const trazoChico   = engrosar ? 0.022 : 0;  // código, 5pt
    // El material lleva MÁS trazo que el código aunque sea de tamaño parecido:
    // el código va en Tahoma Bold y el material en Helvetica Bold, que es una
    // tipografía más liviana, así que con el mismo grosor se veía más pálido.
    const trazoMaterial = engrosar ? 0.038 : 0; // material, 5.5pt
    const modo = engrosar ? { renderingMode: 'fillThenStroke' } : undefined;
    if (engrosar) doc.setDrawColor(...B);

    // QR 8×8mm — columna derecha
    if (qrImg) {
        try { doc.addImage(qrImg, 'PNG', ox + QX, oy + 0.2, QS, QS); } catch(e) {}
    }

    // Precio — 8.5pt helvetica bold
    const precio = '$ ' + parseFloat(p.precio || 0).toFixed(2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...B);
    if (engrosar) doc.setLineWidth(trazoGrande);
    doc.text(precio, ox + dataX, oy + 3.7, modo);

    // Código — 5pt Tahoma Bold (igual que DK-2214), hasta 2 líneas
    const cod = p.codigo || '';
    if (cod) {
        if (hasTahoma) doc.setFont('TahomaBold', 'normal');
        else doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5); doc.setTextColor(...B);
        if (engrosar) doc.setLineWidth(trazoChico);
        const codLines = doc.splitTextToSize(cod, dataW).slice(0, 2);
        codLines.forEach((l, j) => doc.text(l, ox + dataX, oy + 6.5 + j * 1.6, modo));
    }

    // Material — helvetica bold, ancho completo inferior
    const mat = abreviarMaterial(p.material || extraerMaterial(p.nombre || '', p.descripcion || ''));
    if (mat) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...B);
        if (engrosar) doc.setLineWidth(trazoMaterial);
        doc.text(doc.splitTextToSize(mat, W - 1)[0], ox + 0.5, oy + 11.2, modo);
    }
}

// ── FORMATO MINI 1.2×2cm — DK-2214 cinta 12mm — una etiqueta por página ──────
// PDF multi-página: cada página 20×12mm landscape (ancho cinta 12mm)
async function _generarPDFMini(prods, qrImages) {
    const { jsPDF } = window.jspdf;
    const W = 20, H = 12;

    // Tahoma Bold igual que DK-2214
    const hasTahoma = !!window.TAHOMA_BOLD_B64;

    let doc = null;

    for (let i = 0; i < prods.length; i++) {
        const p = prods[i];
        if (!p) continue;

        if (!doc) {
            doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
            if (hasTahoma) {
                try {
                    doc.addFileToVFS('TahomaBold.ttf', window.TAHOMA_BOLD_B64);
                    doc.addFont('TahomaBold.ttf', 'TahomaBold', 'normal');
                } catch(e) {}
            }
        } else {
            doc.addPage([W, H], 'landscape');
        }

        _dibujarMiniEn(doc, p, qrImages[p.codigo], 0, 0, hasTahoma, true);
    }

    if (!doc) {
        doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
    }
    return doc.output('datauristring').split(',')[1];
}

// ── FORMATO MINI ×2 EN DK-1204 — dos mini 20×12mm por etiqueta 54×17mm ──────
// Alternativa para cuando se acaba la cinta DK-2214: la mini queda del MISMO
// tamaño exacto (20×12mm), solo que se imprimen de a dos sobre una troquelada
// y se recortan por las guías punteadas.
//   54mm de ancho = 5 margen + 20 mini + 4 separación + 20 mini + 5 margen
//   17mm de alto  = 2.5 margen + 12 mini + 2.5 margen
async function _generarPDFMini2enDK1204(prods, qrImages) {
    const { jsPDF } = window.jspdf;
    // La página NO mide la etiqueta completa (54×17mm) sino el área IMPRIMIBLE
    // del troquel: 566×165 dots a 300dpi = 47.92×13.97mm. La QL no imprime
    // ~3mm de cada extremo ni ~1.5mm de cada lado, y manda a la impresora
    // justamente esa área. Usando el tamaño imprimible, el mapeo mm→dots queda
    // 1:1 y las dos mini salen a su tamaño real, sin deformarse.
    const W = 47.92, H = 13.97;
    const LW = 20, LH = 12;          // mini, mismo tamaño que en la cinta
    const G  = 4;                    // separación entre las dos
    const M  = (W - 2 * LW - G) / 2; // margen lateral que sobra: 1.96mm
    const OY = (H - LH) / 2;         // 0.985mm arriba y abajo
    const OXS = [M, M + LW + G];     // origen X de cada mini

    const hasTahoma = !!window.TAHOMA_BOLD_B64;
    let doc = null;

    for (let i = 0; i < prods.length; i += 2) {
        if (!doc) {
            doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
            if (hasTahoma) {
                try {
                    doc.addFileToVFS('TahomaBold.ttf', window.TAHOMA_BOLD_B64);
                    doc.addFont('TahomaBold.ttf', 'TahomaBold', 'normal');
                } catch(e) {}
            }
        } else {
            doc.addPage([W, H], 'landscape');
        }

        const par = [prods[i], prods[i + 1] || null];

        par.forEach((p, k) => {
            if (!p) return;
            // último parámetro: engrosar el texto. Solo acá — la mini de cinta
            // DK-2214 se deja como está, que sale bien.
            _dibujarMiniEn(doc, p, qrImages[p.codigo], OXS[k], OY, hasTahoma, true);
        });

        // Guías de corte: rectángulo punteado alrededor de cada mini, para
        // recortar exactamente a 20×12mm. Se dibujan al final para que queden
        // por encima y no las tape el QR.
        // NEGRO y 0.15mm a propósito: la Brother imprime a 1 bit (negro o nada).
        // Un gris claro de 0.1mm (~1.2 dots) desaparece en el dithering y las
        // guías no salen en el papel. 0.15mm son ~1.8 dots, que sí imprimen.
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.15);
        if (doc.setLineDashPattern) doc.setLineDashPattern([0.8, 0.6], 0);
        par.forEach((p, k) => { if (p) doc.rect(OXS[k], OY, LW, LH); });
        if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
    }

    if (!doc) {
        doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
    }
    return doc.output('datauristring').split(',')[1];
}

// ── FORMATO TARJETA 2.5×1.5cm — dos caras iguales de datos ──────────────────
// PDF 50×15mm: cara-datos (25mm) + cara-datos (25mm)
async function _generarPDFTarjeta25(prods, qrImages) {
    const { jsPDF } = window.jspdf;
    const W = 50, H = 15;
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
    // Agrupar de a 2: cada página = 2 productos distintos
    for (let i = 0; i < prods.length; i += 2) {
        if (i > 0) doc.addPage([W, H], 'landscape');
        const p1 = prods[i];
        const p2 = prods[i + 1] || null;
        // Pre-calcular tamaños mínimos entre ambas caras para que sean iguales
        const fs = _calcFontSizesTarjeta25(doc, p1, p2);
        _dibujarCaraDatos(doc, p1, qrImages[p1.codigo], 0,  H, fs);
        if (p2) _dibujarCaraDatos(doc, p2, qrImages[p2.codigo], 25, H, fs);
    }
    return doc;
}

// Calcula el font size mínimo de material y SKU mirando ambos productos
function _calcFontSizesTarjeta25(doc, p1, p2) {
    const QR_MM  = 8.5;
    const QR_X   = 0.5;
    const P_ZONE = 12.0;
    const divX   = QR_X + P_ZONE + 0.5;
    const matW   = 25 - divX - 1.0;  // ~11mm, igual en ambas caras

    function calcMat(p) {
        const raw = (p.material || extraerMaterial(p.nombre || "", p.descripcion || ""))
                     .replace(/Laminado/gi, "Lam.");
        if (!raw) return 8.5;
        doc.setFont("helvetica", "bold");
        let sz = 8.5;
        doc.setFontSize(sz);
        let lineas = doc.splitTextToSize(raw, matW);
        while (lineas.length > 2 && sz > 4.0) { sz -= 0.2; doc.setFontSize(sz); lineas = doc.splitTextToSize(raw, matW); }
        return sz;
    }
    function calcSku(p) {
        const cod = p.codigo || "";
        if (!cod) return 7.5;
        doc.setFont("helvetica", "bold");
        let cSize = 7.5;
        doc.setFontSize(cSize);
        while (cSize > 3.5) { doc.setFontSize(cSize); if (doc.getTextWidth(cod) <= matW) break; cSize -= 0.2; }
        return cSize;
    }

    const matSz1 = calcMat(p1);
    const matSz2 = p2 ? calcMat(p2) : 8.5;
    const skuSz1 = calcSku(p1);
    const skuSz2 = p2 ? calcSku(p2) : 7.5;
    return {
        mat: Math.min(matSz1, matSz2),
        sku: Math.min(skuSz1, skuSz2)
    };
}

// Dibuja una cara de datos de 25mm en el eje X a partir de offsetX
function _dibujarCaraDatos(doc, p, qrDataURL, offsetX, H, fs) {
    const FACE_W = 25;
    const B = [0, 0, 0];

    doc.setFillColor(255, 255, 255);
    doc.rect(offsetX, 0, FACE_W, H, 'F');

    const QR_MM    = 8.5;
    const QR_X     = offsetX + 0.5;
    const QR_Y     = 5.5;
    const divX     = QR_X + QR_MM + 0.5;   // texto pegado al QR
    const matW     = offsetX + FACE_W - divX - 0.3;
    const PRECIO_Y = 4.0;

    // ── Separador entre caras — banda gris de 2mm centrada en el límite ──
    if (offsetX > 0) {
        doc.setFillColor(210, 210, 210);
        doc.rect(offsetX - 1, 0, 2, H, 'F');
    }

    // ── Precio (col izq, arriba) ──────────────────────────────────────────
    const precio = "$ " + parseFloat(p.precio || 0).toFixed(2);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...B);
    let pSize = 12.0;
    while (pSize > 5.0) { doc.setFontSize(pSize); if (doc.getTextWidth(precio) <= FACE_W - 1.5) break; pSize -= 0.3; }
    doc.text(precio, QR_X, PRECIO_Y);

    // ── QR (col izq, abajo) ───────────────────────────────────────────────
    if (qrDataURL) {
        try { doc.addImage(qrDataURL, "PNG", QR_X, QR_Y, QR_MM, QR_MM); } catch(e) {}
    }

    // ── Material (col der) ────────────────────────────────────────────────
    const matRaw = (p.material || extraerMaterial(p.nombre || "", p.descripcion || ""))
                     .replace(/Laminado/gi, "Lam.");
    if (matRaw) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...B);
        doc.setFontSize(6.5);
        const lineas = doc.splitTextToSize(matRaw, matW);
        const n = Math.min(lineas.length, 2);
        const yMat = n === 1 ? [QR_Y + 3.5] : [QR_Y + 1.8, QR_Y + 4.5];
        for (let i = 0; i < n; i++) doc.text(lineas[i], divX, yMat[i]);
    }

    // ── SKU (col der — usa todo el ancho disponible hasta el borde) ──────
    const codigo = p.codigo || "";
    if (codigo) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...B);
        doc.setFontSize(5.5);
        const skuMaxW = offsetX + FACE_W - divX - 0.2;
        // Si no cabe, reducir espaciado entre caracteres comprimiendo con charSpace
        const skuW = doc.getTextWidth(codigo);
        if (skuW > skuMaxW) {
            doc.text(codigo, divX, QR_Y + QR_MM - 1.0, { maxWidth: skuMaxW, charSpace: -((skuW - skuMaxW) / codigo.length) });
        } else {
            doc.text(codigo, divX, QR_Y + QR_MM - 1.0);
        }
    }
}

// alias para compatibilidad con llamadas existentes
function _dibujarEtiqueta25x15(doc, p, qrDataURL, W, H) {
    _dibujarCaraDatos(doc, p, qrDataURL, 0, H);
}
// ─────────────────────────────────────────────────────────────────────────────

async function generarEtiquetaRapida(codigos) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        toast("⚠️ No se pudo cargar jsPDF — verifica conexión");
        return;
    }
    const prods = codigos.map(_buscarProducto).filter(Boolean);
    if (!prods.length) { toast("⚠️ No se encontraron los productos"); return; }

    const banner = document.getElementById("banner-etiqueta-rapida");
    if (banner) banner.remove();

    // Generar QR images
    const qrImages = {};
    await Promise.all(prods.map(p => new Promise(resolve => {
        const div = document.createElement("div");
        div.style.display = "none";
        document.body.appendChild(div);
        try {
            new QRCode(div, { text: p.codigo, width: 120, height: 120,
                colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
            setTimeout(() => {
                const img = div.querySelector("img") || div.querySelector("canvas");
                if (img) qrImages[p.codigo] = img.tagName === "CANVAS" ? img.toDataURL("image/png") : img.src;
                document.body.removeChild(div); resolve();
            }, 100);
        } catch(e) { document.body.removeChild(div); resolve(); }
    })));

    const { jsPDF } = window.jspdf;

    if (_formatoImpresion === 'tarjeta25') {
        const doc = await _generarPDFTarjeta25(prods, qrImages);
        doc.save("Etiqueta_VEREX_" + prods[0].codigo + ".pdf");
        toast("✅ " + prods.length + " etiqueta(s) 2.5×1.5cm generadas");
        return;
    }

    const W = 60, H = 25;
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });

    prods.forEach((p, idx) => {
        if (idx > 0) doc.addPage([W, H], 'landscape');
        _dibujarEtiqueta60x25(doc, p, qrImages[p.codigo], W, H);
    });

    doc.save("Etiqueta_VEREX_" + prods[0].codigo + ".pdf");
    toast("✅ " + prods.length + " etiqueta(s) generadas");
}

// ── Helper compartido: dibuja una etiqueta 60×25mm en el doc jsPDF actual ──
function _dibujarEtiqueta60x25(doc, p, qrDataURL, W, H) {
    // LADO IZQUIERDO (x: 0–30mm)
    const qrSize = 10;
    const qrX = 4;
    const qrY = (H - qrSize) / 2; // = 7.5 centrado
    if (qrDataURL) {
        try { doc.addImage(qrDataURL, "PNG", qrX, qrY, qrSize, qrSize); } catch(e) {}
    }

    const textX    = qrX + qrSize + 2; // 16mm
    const textMaxW = 28 - textX;       // 12mm disponibles

    // Precio
    const precio = "$ " + parseFloat(p.precio || 0).toFixed(2);
    doc.setFont("helvetica", "bold");
    let pSize = 9;
    while (pSize > 4) { doc.setFontSize(pSize); if (doc.getTextWidth(precio) <= textMaxW) break; pSize -= 0.5; }
    doc.setTextColor(0, 0, 0);
    doc.text(precio, textX, 9.5);

    // Código
    const codigo = p.codigo || "";
    doc.setFont("helvetica", "bold");
    let cSize = 7;
    while (cSize > 3.5) { doc.setFontSize(cSize); if (doc.getTextWidth(codigo) <= textMaxW) break; cSize -= 0.3; }
    doc.setTextColor(60, 60, 60);
    doc.text(codigo, textX, 14.5);

    // Material — una sola línea, máx 3 palabras, sin wrap
    const matRaw = p.material || extraerMaterial(p.nombre || "", p.descripcion || "");
    if (matRaw) {
        const mat = matRaw.split(/[\s,]+/).slice(0, 3).join(" ");
        doc.setFont("helvetica", "bold");
        let mSize = 6;
        while (mSize > 3) { doc.setFontSize(mSize); if (doc.getTextWidth(mat) <= 22) break; mSize -= 0.3; }
        doc.setTextColor(0, 0, 0);
        doc.text(mat, 15, 21, { align: "center" });
    }

    // Línea de doblez punteada
    doc.setDrawColor(210, 210, 210);
    doc.setLineDashPattern([0.8, 0.8], 0);
    doc.setLineWidth(0.2);
    doc.line(30, 0, 30, H);
    doc.setLineDashPattern([], 0);

    // LADO DERECHO (x: 30–60mm)
    const cx = 45;

    // VEREX
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(80, 35, 35);
    doc.text("V E R E X", cx, 10, { align: "center" });

    // Línea decorativa
    doc.setDrawColor(150, 100, 40);
    doc.setLineWidth(0.4);
    doc.line(33, 11.8, 57, 11.8);

    // STORE
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(80, 35, 35);
    doc.text("S T O R E", cx, 14.8, { align: "center" });

    // Slogan
    doc.setFont("helvetica", "italic");
    doc.setFontSize(5);
    doc.setTextColor(110, 85, 55);
    doc.text("La expresión de tu", cx, 18.5, { align: "center" });
    doc.text("mejor versión", cx, 21.5, { align: "center" });
}

function abrirStockNuevoLote() {
    // Reusar el modal de lote existente
    abrirModalLote();
}

function abrirModal(id) { document.getElementById(id).classList.add("active"); }
function cerrarModal(id) { document.getElementById(id).classList.remove("active"); }

function toast(msg, bg, ms) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.style.background = bg || "var(--gris2)";
    t.classList.add("show");
    clearTimeout(window._toastT);
    window._toastT = setTimeout(() => t.classList.remove("show"), ms || 2800);
}

// ── DETECTOR GLOBAL DE SCANNER ───────────────────────────────────────
// Captura el patrón scanner (ráfaga rápida + Enter) y lo dirige al campo
// de búsqueda activo (stock o etiquetas) sin necesidad de tenerlo enfocado
;(function() {
    let _scanBuf = "", _scanT = 0;
    document.addEventListener("keydown", function(e) {
        // Nueva Entrega tiene MÁXIMA prioridad: nunca debe perder un escaneo
        // por culpa del chequeo de foco/modal (eso causaba escaneos que no
        // dejaban NINGÚN rastro — ni éxito ni error — porque el evento se
        // ignoraba entero antes de llegar al buffer). Se revisa esto PRIMERO,
        // antes de cualquier exclusión pensada para las pantallas de Stock/Etiquetas.
        const entregaVis = document.getElementById("pantalla-entrega")?.style.display === "block";
        const verificandoBorrador = typeof _modoVerificarBorrador !== "undefined" && _modoVerificarBorrador;
        // Registrar Devolución abierto: el lector físico (USB/Bluetooth) cuenta cada pieza igual que la
        // cámara. Sin esto el escaneo caía en la búsqueda de Stock/Etiquetas que está detrás del modal.
        const devolucionVis = !!document.getElementById("modal-devolucion")?.classList.contains("active");

        if (!entregaVis && !verificandoBorrador) {
            const activeId = document.activeElement?.id || "";
            // Solo ignorar si el foco está en un input de otro módulo (modal, precio, etc.)
            // Los campos de búsqueda de stock/etiquetas SÍ deben pasar
            const inputsExcluidos = ["sn-multicod-input","sn-codigo-manual","sn-nombre","sn-precio","sn-precio-dama","sn-precio-caballero",
                "sn-cantidad","sn-desc","sn-desc-tienda","sn-caract","inp-pass",
                "np-nombre","np-desc","np-precio","np-codigo","np-qty","np-caract",
                "ep-codigo","ep-nombre","ep-desc","ep-precio","ep-precio-dama","ep-precio-caballero","ep-caract","ep-existencia",
                "lote-precio-global"];
            if (inputsExcluidos.includes(activeId)) return;
            // Ignorar si hay un modal visible con un textarea/input activo
            const modalAbierto = document.querySelector(".modal-overlay.active input:focus, .modal-overlay[style*='flex'] input:focus");
            if (modalAbierto) return;
        }

        const now = Date.now();
        if (now - _scanT > 150) _scanBuf = "";
        _scanT = now;

        if (e.key === "Enter") {
            // Si el "Enter" del lector cae mientras un botón tiene el foco
            // (ej. justo después de tocar "Verificar conteo"), el navegador
            // lo trata como un click en ese botón. Bloquearlo evita que se
            // reactive/reinicie el modo de verificación a mitad de escaneo.
            if (verificandoBorrador || entregaVis || devolucionVis) e.preventDefault();
            const cod = _scanBuf.trim().toUpperCase();
            _scanBuf = "";
            if (cod.length < 3) {
                // Lectura demasiado corta/corrupta — antes se descartaba sin
                // dejar rastro; en Nueva Entrega se registra igual para que
                // el escaneo perdido no desaparezca en silencio.
                if (entregaVis && cod.length > 0 && typeof _registrarEscaneoFallido === "function") {
                    _registrarEscaneoFallido((cod || "(vacío)") + " (lectura muy corta/corrupta)");
                }
                return;
            }

            if (devolucionVis) {
                e.preventDefault();          // que el Enter del lector no "toque" el botón que tenga el foco
                _onScanDevolucion(cod);
                return;
            }

            if (verificandoBorrador) {
                _onScanVerificarBorrador(cod);
                return;
            }

            if (entregaVis) {
                // Nueva Entrega: el lector físico agrega directo al carrito/borrador,
                // sin necesidad de tocar "+" manualmente por cada producto.
                const busEntrega = document.getElementById("bus-entrega");
                if (busEntrega) busEntrega.value = "";
                _onScanQREntrega(cod);
                return;
            }
            const tabStock = document.getElementById("tab-content-stock");
            const tabEtiq  = document.getElementById("tab-content-etiquetas");
            const stockVis = tabStock && tabStock.style.display !== "none";
            const etiqVis  = tabEtiq  && tabEtiq.style.display  !== "none";
            if (stockVis) {
                buscarStockPorScanner(cod);
            } else if (etiqVis) {
                buscarEtiquetasPorScanner(cod);
            }
        } else if (e.key.length === 1) {
            _scanBuf += e.key;
        }
    });
})();

window.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("inp-foto").addEventListener("change", function() { cargarFoto(this); });
    cargarCategoriasPersonalizadas();

    // Auto-login si hay sesión guardada (válida por 8 horas)
    const saved = localStorage.getItem("vx_consig_session");
    const exp   = parseInt(localStorage.getItem("vx_consig_session_exp") || "0");
    if (saved && Date.now() <= exp) {
        const hash = await hashStr(saved);
        if (hash === PASS_HASH) {
            _sessionPass = saved;
            document.getElementById("pantalla-login").style.display = "none";
            document.getElementById("app").style.display = "block";
            cargarDatos();
            iniciarAutoSync();
            document.querySelectorAll('.menu-btn[data-color]').forEach(btn => {
                btn.style.setProperty('--mc', btn.dataset.color);
            });
            return;
        }
        localStorage.removeItem("vx_consig_session");
        localStorage.removeItem("vx_consig_session_exp");
    }
    // Sin sesión válida → mostrar login
    document.getElementById("pantalla-login").style.display = "flex";
});

// ── FUNCIONES COMPLEMENTARIAS ────────────────────────────────────────

let _materialLote = null;

function seleccionarMaterialLote(btn) {
    document.querySelectorAll(".material-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    btn.style.background = "var(--dorado)"; btn.style.color = "var(--negro)"; btn.style.borderColor = "var(--dorado)";
    _materialLote = btn.dataset.material;
}

function seleccionarMaterialSingle(btn) {
    document.querySelectorAll(".mat-single-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; });
    btn.style.background = "var(--dorado)"; btn.style.color = "var(--negro)";
    window._materialProducto = btn.dataset.mat;
}

// ── Tallas múltiples para Agregar individual ─────────────────────────
window._tallasQtyIndividual = {}; // { 7: 2, 8: 1 }

function renderTallasIndividual() {
    const wrap = document.getElementById("np-tallas-wrap");
    if (!wrap) return;
    const tqs = window._tallasQtyIndividual;
    const tallasBtns = [5,6,7,8,9,10,11,12,13,14];
    wrap.innerHTML = tallasBtns.map(t => {
        const sel = tqs[t] !== undefined;
        const qty = tqs[t] || 1;
        if (sel) {
            return '<div style="display:inline-flex;align-items:center;gap:2px;background:var(--dorado);border-radius:6px;padding:2px 4px;">' +
                '<button type="button" onclick="cambiarQtyTallaInd(' + t + ',-1)" style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">−</button>' +
                '<span style="font-size:11px;font-weight:700;color:var(--negro);min-width:28px;text-align:center;">T' + t + '<br><span style="font-size:10px;">×' + qty + '</span></span>' +
                '<button type="button" onclick="cambiarQtyTallaInd(' + t + ',1)" style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">+</button>' +
                '<button type="button" onclick="toggleTallaInd(' + t + ')" style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1;">✕</button>' +
                '</div>';
        } else {
            return '<button type="button" onclick="toggleTallaInd(' + t + ')" style="padding:5px 8px;border:1px solid var(--borde);border-radius:6px;background:var(--gris);color:var(--blanco);font-size:11px;font-weight:600;cursor:pointer;">T' + t + '</button>';
        }
    }).join('');
    const total = Object.values(tqs).reduce((s, q) => s + q, 0);
    const totalDiv = document.getElementById("np-tallas-total");
    const totalNum = document.getElementById("np-tallas-total-num");
    if (totalDiv) totalDiv.style.display = total > 0 ? "block" : "none";
    if (totalNum) totalNum.textContent = total;
    // Mostrar/ocultar campo cantidad según si hay tallas
    const qtyEl = document.getElementById("np-qty");
    if (qtyEl) qtyEl.style.display = total > 0 ? "none" : "block";
}

function toggleTallaInd(t) {
    if (window._tallasQtyIndividual[t] !== undefined) {
        delete window._tallasQtyIndividual[t];
    } else {
        window._tallasQtyIndividual[t] = 1;
    }
    renderTallasIndividual();
}

function cambiarQtyTallaInd(t, delta) {
    const actual = window._tallasQtyIndividual[t] || 1;
    const nuevo = actual + delta;
    if (nuevo <= 0) { delete window._tallasQtyIndividual[t]; }
    else { window._tallasQtyIndividual[t] = nuevo; }
    renderTallasIndividual();
}

function agregarTallaEspecialInd() {
    const inp = document.getElementById("np-talla-especial");
    const val = parseFloat(inp.value);
    if (!val || val < 4 || val > 15) { toast("⚠️ Ingresa una talla válida (4–15)"); return; }
    const key = String(val); // ej: "7.5"
    if (window._tallasQtyIndividual[key] !== undefined) { toast("⚠️ Esa talla ya está agregada"); inp.value = ""; return; }
    window._tallasQtyIndividual[key] = 1;
    inp.value = "";
    renderTallasIndividual();
}

// Compatibilidad legacy (ya no se usa pero evita errores)
function seleccionarTalla(talla) { toggleTallaInd(talla); }

function mostrarSelectorTalla(cat) {
    const container = document.getElementById("np-talla-container");
    if (container) container.style.display = (cat === "AN" || cat === "CJ") ? "block" : "none";
    const matContainer = document.getElementById("material-single-container");
    if (matContainer) matContainer.style.display = cat ? "block" : "none";
    // Resetear tallas al cambiar categoría
    window._tallasQtyIndividual = {};
    renderTallasIndividual();
}

function toggleTallaLote(i, cat) {
    const el = document.getElementById("talla-lote-" + i);
    if (el) el.style.display = (cat === "AN" || cat === "CJ") ? "flex" : "none";
}

// tallasQty = { 7: 2, 8: 1, 9: 2 } — cantidad individual por talla
function agregarTallaEspecialLote(i) {
    const inp = document.getElementById("talla-esp-lote-" + i);
    if (!inp) return;
    const val = parseFloat(inp.value);
    if (!val || val < 4 || val > 15) { toast("⚠️ Ingresa una talla válida (4–15)"); return; }
    const key = String(val); // ej: "7.5"
    if (!loteProductos[i].tallasQty) loteProductos[i].tallasQty = {};
    if (loteProductos[i].tallasQty[key] !== undefined) { toast("⚠️ Esa talla ya está agregada"); inp.value = ""; return; }
    loteProductos[i].tallasQty[key] = 1;
    loteProductos[i].tallas = Object.keys(loteProductos[i].tallasQty);
    inp.value = "";
    renderLoteProductos();
}

function toggleTallaLoteMulti(i, talla) {
    if (!loteProductos[i].tallasQty) loteProductos[i].tallasQty = {};
    if (loteProductos[i].tallasQty[talla] !== undefined) {
        delete loteProductos[i].tallasQty[talla]; // deseleccionar
    } else {
        loteProductos[i].tallasQty[talla] = 1;    // seleccionar con cantidad 1
    }
    // Compatibilidad: mantener array tallas sincronizado para validaciones
    loteProductos[i].tallas = Object.keys(loteProductos[i].tallasQty).map(Number);
    renderLoteProductos();
}

function cambiarCantidadTalla(i, talla, delta) {
    if (!loteProductos[i].tallasQty) return;
    const actual = loteProductos[i].tallasQty[talla] || 1;
    const nueva  = Math.max(1, actual + delta);
    loteProductos[i].tallasQty[talla] = nueva;
    // Actualizar cantidad individual sin re-render completo
    const elQty = document.getElementById("qty-talla-" + i + "-" + talla);
    if (elQty) elQty.textContent = "×" + nueva;
    // Actualizar total automático
    const total = Object.values(loteProductos[i].tallasQty).reduce((s, q) => s + q, 0);
    const elTotal = document.getElementById("total-tallas-" + i);
    if (elTotal) elTotal.textContent = total + " piezas";
}

function seleccionarTallaLote(i, talla) {
    if (!loteProductos[i].tallasQty) loteProductos[i].tallasQty = {};
    if (loteProductos[i].tallasQty[talla] === undefined) loteProductos[i].tallasQty[talla] = 1;
    loteProductos[i].tallas = Object.keys(loteProductos[i].tallasQty).map(Number);
    renderLoteProductos();
}

function abrirModalLote() {
    loteFotos = []; loteProductos = []; _materialLote = null;
    document.getElementById("lote-paso1").style.display = "block";
    document.getElementById("lote-paso2").style.display = "none";
    document.getElementById("lote-preview").innerHTML = "";
    document.getElementById("btn-analizar-lote").style.display = "none";
    document.getElementById("inp-lote-fotos").value = "";
    document.querySelectorAll(".material-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    abrirModal("modal-lote");
}

function abrirSolicitudes() {
    abrirModal("modal-solicitudes");
    cargarSolicitudes(true);
}

let _entregasConfirmadasMap = {};

// Regenera el mismo PDF de recibo a partir de lo guardado permanentemente
// en "entregas" (items + firma) — así no se pierde si el admin cerró el
// navegador sin guardar el PDF la primera vez que se generó.
function redescargarReciboEntrega(entId) {
    const registro = _entregasConfirmadasMap[entId];
    if (!registro) { toast("⚠️ No se encontró el registro del recibo"); return; }
    const { e, items, vend } = registro;
    const vendedorPDF = vend || { nombre: e.vendedor, codigo: e.vendedor, telefono: "" };
    try {
        generarReciboPDF(vendedorPDF, items, e.firmaImg, e.codigoRecibo);
    } catch(err) {
        toast("⚠️ Error al generar PDF: " + err.message);
    }
}

async function descartarEntregaConfirmada(id) {
    if (!confirm("¿Descartar esta notificación de entrega confirmada? (ej. si fue una prueba) — solo borra el aviso, no toca stock ni consignación.")) return;
    const res = await apiPost({ accion: "DESCARTAR_ENTREGA_CONFIRMADA", id });
    if (res && res.ok !== false) {
        toast("✕ Notificación descartada");
        cargarSolicitudes(true);
    } else {
        toast("⚠️ " + (res?.error || "No se pudo descartar"), "#c0392b");
    }
}

async function cargarSolicitudes(mostrar) {
    try {
        const [resSol, resConf] = await Promise.all([
            apiPost({ accion: "GET_SOLICITUDES_CORRECCION" }),
            apiPost({ accion: "GET_ENTREGAS_CONFIRMADAS" })
        ]);
        const solicitudes = resSol.solicitudes || [];
        const confirmadas = resConf.entregas || [];
        const totalBadge = solicitudes.length + confirmadas.length;
        const badge = document.getElementById("badge-solicitudes");
        if (totalBadge > 0) {
            badge.style.display = "flex";
            badge.textContent = totalBadge;
        } else {
            badge.style.display = "none";
        }
        if (!mostrar) return;
        const lista = document.getElementById("lista-solicitudes");
        if (!lista) return;
        let html = "";
        _entregasConfirmadasMap = {};
        if (confirmadas.length) {
            confirmadas.forEach(e => {
                const fecha = e.fechaConfirmacion ? new Date(e.fechaConfirmacion).toLocaleDateString("es-SV") : "—";
                const vend = vendedores.find(v => v.codigo === e.vendedor);
                let items = [];
                try { items = typeof e.items === "string" ? JSON.parse(e.items) : (e.items || []); } catch(_) {}
                _entregasConfirmadasMap[e.id] = { e, items, vend };
                html += `<div style="background:rgba(45,122,79,0.15);border:1px solid #2d7a4f;border-radius:10px;padding:14px;margin-bottom:10px;">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:18px;">✅</span>
                            <div>
                                <div style="font-size:13px;font-weight:600;color:#4caf82;">${sanitizar(vend?.nombre || e.vendedor)} confirmó recepción</div>
                                <div style="font-size:11px;color:var(--plateado);">${sanitizar(fecha)} · Código: <strong style="color:var(--dorado);">${sanitizar(e.codigoRecibo)}</strong></div>
                            </div>
                        </div>
                        <button onclick="descartarEntregaConfirmada('${sanitizar(e.id)}')" title="Descartar esta notificación" style="background:none;border:none;color:var(--plateado);font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
                    </div>
                    <div style="font-size:12px;color:var(--plateado);margin-bottom:8px;">${items.length} producto(s): ${items.slice(0,3).map(i=>sanitizar(i.nombre)).join(", ")}</div>
                    ${e.firmaImg ? `<button onclick="redescargarReciboEntrega('${sanitizar(e.id)}')" style="padding:6px 12px;border:none;border-radius:6px;background:#2d7a4f;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">📄 Descargar recibo PDF</button>` : ''}
                </div>`;
            });
        }
        if (solicitudes.length) {
            html += solicitudes.map(s => `
                <div style="background:var(--gris2);border-radius:10px;padding:14px;margin-bottom:10px;">
                    <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${sanitizar(s.vendedor||"")} · ${sanitizar(s.codigo||"")}</div>
                    <div style="font-size:12px;color:var(--plateado);margin-bottom:10px;">${sanitizar(s.motivo||"")}</div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-verde" style="padding:6px 12px;font-size:12px;" onclick="aprobarCorreccion(${jsArg(s.id)})">✅ Aprobar</button>
                        <button class="btn btn-rojo" style="padding:6px 12px;font-size:12px;" onclick="rechazarCorreccion(${jsArg(s.id)})">❌ Rechazar</button>
                    </div>
                </div>`).join('');
        }
        if (!html) html = '<p style="color:var(--plateado);font-size:13px;padding:10px;">No hay notificaciones pendientes.</p>';
        lista.innerHTML = html;
    } catch(e) {
        const lista = document.getElementById("lista-solicitudes");
        if (lista) lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;padding:10px;">No hay notificaciones.</p>';
    }
}

async function aprobarCorreccion(id) {
    await apiPost({ accion: "APROBAR_CORRECCION_VENTA", id });
    toast("✅ Corrección aprobada");
    cargarSolicitudes(true);
}

async function rechazarCorreccion(id) {
    await apiPost({ accion: "RECHAZAR_CORRECCION_VENTA", id });
    toast("❌ Corrección rechazada");
    cargarSolicitudes(true);
}

function abrirCambiarClave() {
    document.getElementById("cons-pass-actual").value = "";
    document.getElementById("cons-pass-nueva").value = "";
    document.getElementById("cons-pass-confirmar").value = "";
    document.getElementById("cons-pass-error").style.display = "none";
    abrirModal("modal-cambiar-clave");
}

async function guardarNuevaClaveConsignacion() {
    const actual = document.getElementById("cons-pass-actual").value;
    const nueva = document.getElementById("cons-pass-nueva").value;
    const confirmar = document.getElementById("cons-pass-confirmar").value;
    const errorEl = document.getElementById("cons-pass-error");
    const hashActual = await hashStr(actual);
    if (hashActual !== PASS_HASH) { errorEl.textContent = "⚠️ Contraseña actual incorrecta"; errorEl.style.display = "block"; return; }
    if (!nueva || nueva.length < 4) { errorEl.textContent = "⚠️ Mínimo 4 caracteres"; errorEl.style.display = "block"; return; }
    if (nueva !== confirmar) { errorEl.textContent = "⚠️ Las contraseñas no coinciden"; errorEl.style.display = "block"; return; }
    errorEl.style.display = "none";
    const nuevoHash = await hashStr(nueva);
    await apiPost({ accion: "ACTUALIZAR_PASS_HASH", nuevoHash });
    PASS_HASH = nuevoHash;
    _sessionPass = nueva;
    toast("✅ Contraseña actualizada.");
    cerrarModal("modal-cambiar-clave");
}

async function verHistorialEntregas() {
    abrirModal("modal-historial-entregas");
    const lista = document.getElementById("lista-historial-entregas");
    lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await apiPost({ accion: "GET_HISTORIAL_CORTES", vendedor: vendedorActual.codigo });
        const entregas = res.historial || [];
        if (!entregas.length) {
            lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay historial de entregas.</p>';
            return;
        }
        lista.innerHTML = entregas.reverse().map(e => {
            const fecha = e.fecha ? new Date(e.fecha).toLocaleDateString("es-SV") : "—";
            return `<div style="background:var(--gris2);border-radius:10px;padding:14px;margin-bottom:10px;">
                <div style="font-size:12px;color:var(--dorado);margin-bottom:6px;">${fecha}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;">
                    <div><div style="color:var(--plateado);">Total vendido</div><div style="font-weight:700;">$${parseFloat(e.totalVendido||0).toFixed(2)}</div></div>
                    <div><div style="color:var(--plateado);">Ganancia</div><div style="font-weight:700;color:var(--dorado);">$${parseFloat(e.gananciaVendedor||0).toFixed(2)}</div></div>
                    <div><div style="color:var(--plateado);">A VEREX</div><div style="font-weight:700;">$${parseFloat(e.aPagarVerex||0).toFixed(2)}</div></div>
                </div>
            </div>`;
        }).join('');
    } catch(e) {
        lista.innerHTML = '<p style="color:#e74c3c;font-size:13px;">Error al cargar.</p>';
    }
}

function asignarAVendedor() {
    abrirAsignarVendedor();
}


// ── VENTA DIRECTA ────────────────────────────────────────────────────
const DEPARTAMENTOS_VD = ["Ahuachapán","Cabañas","Chalatenango","Cuscatlán","La Libertad","La Paz","La Unión","Morazán","San Miguel","San Salvador","San Vicente","Santa Ana","Sonsonate","Usulután"];
(function poblarDepartamentosVD(){
    const sel = document.getElementById("vd-cliente-departamento");
    if (sel) DEPARTAMENTOS_VD.forEach(d => sel.insertAdjacentHTML("beforeend", `<option value="${d}">${d}</option>`));
})();
let _vdCarrito    = {};   // { codigo: { prod, qty } }
let _vdTipo       = 'contado';
let _vdMetodoPago = 'efectivo'; // 'efectivo' | 'tarjeta' | 'transferencia' — solo aplica a contado
let _creditosVD   = [];
let _vdModoDescuento  = 'monto'; // 'monto' | 'porcentaje'
let _vdEmpresaEnvio   = '';

function selEmpresaEnvio(empresa) {
    _vdEmpresaEnvio = empresa;
    const empresas = { 'C807 Xpress': 'btn-empresa-c807', 'Trucker': 'btn-empresa-trucker' };
    Object.entries(empresas).forEach(([nombre, btnId]) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const activo = nombre === empresa;
        btn.style.background = activo ? 'var(--dorado)' : '#2a2a2a';
        btn.style.color      = activo ? '#000' : '#888';
    });
}

function setModoDescuento(modo) {
    _vdModoDescuento = modo;
    document.getElementById("btn-desc-monto").style.background = modo === 'monto' ? "var(--dorado)" : "#2a2a2a";
    document.getElementById("btn-desc-monto").style.color      = modo === 'monto' ? "#000" : "#888";
    document.getElementById("btn-desc-pct").style.background   = modo === 'porcentaje' ? "var(--dorado)" : "#2a2a2a";
    document.getElementById("btn-desc-pct").style.color        = modo === 'porcentaje' ? "#000" : "#888";
    document.getElementById("vd-desc-simbolo").textContent     = modo === 'monto' ? "$" : "%";
    document.getElementById("vd-descuento-val").placeholder    = modo === 'monto' ? "0.00" : "0";
    aplicarDescuentoVD();
}

function aplicarDescuentoVD() {
    renderCarritoVD();
}

function limpiarDescuentoVD() {
    document.getElementById("vd-descuento-val").value = "";
    renderCarritoVD();
}

// ── Promo general en Venta Directa ──────────────────────────────────────────
// Aplica sobre el carrito de Venta Directa (_vdCarrito) la misma promo de
// carrito (2x50 / 3x2 / montoFijo / escalonado) y las mismas fórmulas que usa
// el catálogo público — así el mostrador cobra igual que lo que vería el
// cliente si comprara por el link. Es un botón, no algo automático: al
// tocarlo se calcula y se deja escrito en el campo de descuento de siempre,
// así se puede ajustar o quitar como cualquier descuento manual.
function _calcularPromoGeneralVD() {
    const pc = promoGeneral?.promoCarrito;
    if (!promoGeneral?.activa || !pc?.tipo) return { error: "No hay una promo general activa ahora mismo." };
    const unidades = [];
    Object.values(_vdCarrito).forEach(({ prod, qty }) => { for (let i = 0; i < qty; i++) unidades.push(parseFloat(prod.precio) || 0); });
    if (!unidades.length) return { error: "Agrega productos al carrito primero." };
    unidades.sort((a, b) => b - a);
    const subtotal = unidades.reduce((s, p) => s + p, 0);

    if (pc.tipo === "2x50") {
        if (unidades.length < 2) return { error: "La promo 2do al 50% necesita al menos 2 piezas en el carrito." };
        let descuento = 0;
        unidades.forEach((p, idx) => { if (idx % 2 === 1) descuento += p * 0.5; });
        return { descuento, etiqueta: "2do producto al 50%" };
    }
    if (pc.tipo === "3x2") {
        if (unidades.length < 3) return { error: "La promo 3x2 necesita al menos 3 piezas en el carrito." };
        let descuento = 0;
        unidades.forEach((p, idx) => { if (idx % 3 === 2) descuento += p; });
        return { descuento, etiqueta: "3x2 (la pieza más barata de cada trío, gratis)" };
    }
    if (pc.tipo === "montoFijo") {
        const base = parseFloat(pc.montoFijo) || 0;
        const minimo = parseFloat(pc.minimoCompra) || 0;
        if (minimo > 0) {
            const tramos = Math.floor(subtotal / minimo);
            if (tramos < 1) return { error: `Esta promo aplica a partir de $${minimo.toFixed(2)} de compra (llevas $${subtotal.toFixed(2)}).` };
            const monto = Math.min(base * tramos, subtotal);
            return { descuento: monto, etiqueta: `$${base.toFixed(2)} de descuento (${tramos}× por cada $${minimo.toFixed(2)})` };
        }
        return { descuento: Math.min(base, subtotal), etiqueta: `$${base.toFixed(2)} de descuento fijo` };
    }
    if (pc.tipo === "escalonado") {
        const escalones = [...(pc.escalones || [])].sort((a, b) => b.minCant - a.minCant);
        const tier = escalones.find(e => unidades.length >= e.minCant);
        if (!tier) {
            const minReq = Math.min(...(pc.escalones || []).map(e => e.minCant));
            return { error: `Esta promo necesita al menos ${minReq} piezas (llevas ${unidades.length}).` };
        }
        return { descuento: subtotal * (tier.pct / 100), etiqueta: `${tier.pct}% por llevar ${unidades.length} piezas` };
    }
    return { error: "Tipo de promo desconocido." };
}

let _promoGeneralVDCargando = false;
async function aplicarPromoGeneralVD() {
    if (_promoGeneralVDCargando) return;
    // No usar la promo que ya estaba en memoria (llega hasta 10s tarde por la
    // sincronización de fondo) — se pide la más reciente justo al tocar el
    // botón, con GET_CONFIG (liviano: solo la config, no todo el inventario).
    const btn = document.querySelector("#vd-promo-general-wrap button");
    const txtOriginal = btn?.textContent;
    _promoGeneralVDCargando = true;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Verificando promo…"; }
    try {
        const fresco = await apiPost({ accion: "GET_CONFIG" });
        if (fresco?.ok) promoGeneral = fresco.config?.promoGeneral || null;
    } catch (_) { /* si falla la consulta, se sigue con lo que ya había en memoria */ }
    _renderBotonPromoGeneralVD(); // por si justo ahora se apagó/cambió, oculta el botón si ya no aplica
    _promoGeneralVDCargando = false;
    if (btn) { btn.disabled = false; btn.textContent = txtOriginal; }

    const r = _calcularPromoGeneralVD();
    if (r.error) { toast("⚠️ " + r.error, "#f97316"); return; }
    setModoDescuento("monto");
    document.getElementById("vd-descuento-val").value = r.descuento.toFixed(2);
    aplicarDescuentoVD();
    toast(`🎁 Promo general aplicada: ${r.etiqueta} (−$${r.descuento.toFixed(2)})`, "#22c55e");
}

// Solo se muestra si hay una promo general activa configurada; el botón igual
// avisa con un toast si el carrito todavía no cumple sus condiciones.
function _renderBotonPromoGeneralVD() {
    const wrap = document.getElementById("vd-promo-general-wrap");
    if (!wrap) return;
    wrap.style.display = (promoGeneral?.activa && promoGeneral?.promoCarrito?.tipo) ? "block" : "none";
}

function _calcularDescuento(subtotal) {
    const val = parseFloat(document.getElementById("vd-descuento-val")?.value || 0) || 0;
    if (val <= 0) return 0;
    if (_vdModoDescuento === 'porcentaje') return Math.min(subtotal, subtotal * val / 100);
    return Math.min(subtotal, val);
}
let _abonoVentaId = null;

async function iniciarVentaDirecta() {
    if (stockData.length === 0) {
        try {
            const res = await apiPost({ accion: "GET_STOCK" });
            stockData = res.stock || [];
        } catch(e) {}
    }
    filtrarVD();
    cargarCreditosPendientes();
    cargarClientesVD();
    cargarLeadsCatalogoVD();
    const selFormato = document.getElementById("sel-formato-recibo");
    if (selFormato) selFormato.value = localStorage.getItem("verex-formato-recibo") || "a5";
    seleccionarMetodoPagoVD("efectivo");
}

async function cargarLeadsCatalogoVD() {
    const card = document.getElementById("card-leads-catalogo-vd");
    const lista = document.getElementById("lista-leads-catalogo-vd");
    if (!card || !lista) return;
    try {
        const res = await apiPost({ accion: "GET_LEADS_ADMIN" });
        const leads = (res.leads || []).filter(l =>
            (!l.afiliado || l.afiliado === "") &&
            l.estado === "interesado" &&
            l.nombreCliente
        );
        if (leads.length === 0) { card.style.display = "none"; return; }
        card.style.display = "block";
        lista.innerHTML = leads.map(l => {
            const img = l.foto ? `<img src="${sanitizar(l.foto)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;">` : `<div style="width:48px;height:48px;border-radius:8px;background:#2a2a2a;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">💍</div>`;
            const tel = l.telefonoCliente ? `<div style="font-size:10.5px;color:#888;">📱 ${sanitizar(l.telefonoCliente)}</div>` : "";
            const precio = l.precio ? `<div style="font-size:12px;font-weight:800;color:var(--dorado);">$${parseFloat(l.precio).toFixed(2)}</div>` : "";
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                ${img}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(l.nombre||l.codigo)}</div>
                    ${precio}
                    <div style="font-size:11px;color:#ccc;font-weight:600;">👤 ${sanitizar(l.nombreCliente)}</div>
                    ${tel}
                </div>
                <button onclick="registrarVentaDesdeLead('${sanitizar(l.id)}')" style="flex-shrink:0;padding:7px 11px;font-size:11px;font-weight:700;background:linear-gradient(135deg,#C9A84C,#e8c96b);color:#111;border:none;border-radius:8px;cursor:pointer;">➕ Registrar</button>
                <button onclick="descartarLeadCatalogoVD('${sanitizar(l.id)}')" title="Descartar (no era un pedido real)" style="flex-shrink:0;padding:7px 9px;font-size:11px;font-weight:700;background:#3a1a1a;color:#e74c3c;border:1px solid #5a2a2a;border-radius:8px;cursor:pointer;">✕</button>
            </div>`;
        }).join("");
    } catch(e) { card.style.display = "none"; }
}

// Descarta un lead del catálogo que no era un pedido real (ej. prueba,
// duplicado) — lo cancela en vez de borrarlo del todo, mismo mecanismo que
// ya usa el resto del sistema para leads no válidos.
async function descartarLeadCatalogoVD(id) {
    if (!confirm("¿Descartar este lead? No aparecerá más en la lista de pendientes por registrar.")) return;
    try {
        await apiPost({ accion: "CANCELAR_LEAD", id });
        toast("🗑️ Lead descartado");
        cargarLeadsCatalogoVD();
    } catch(e) {
        toast("⚠️ Error al descartar", "#c0392b");
    }
}

// Directorio de clientes para autocompletar nombre por teléfono en Venta
// Directa — evita reteclear los datos de un cliente que ya compró antes.
// Se carga una sola vez por sesión (no cambia seguido) y se cachea en memoria.
let _clientesVDCache = null;
async function cargarClientesVD() {
    if (_clientesVDCache) return;
    try {
        const res = await apiPost({ accion: "GET_CLIENTES" });
        _clientesVDCache = res.clientes || [];
    } catch(e) { _clientesVDCache = []; }
}

function autocompletarClienteVD() {
    const telInput = document.getElementById("vd-cliente-tel");
    const nombreInput = document.getElementById("vd-cliente-nombre");
    if (!telInput || !nombreInput || !_clientesVDCache) return;
    const norm = t => String(t||"").replace(/\D/g,"");
    const tel = norm(telInput.value);
    if (tel.length < 8) return; // aún incompleto, no buscar todavía
    const match = _clientesVDCache.find(c => norm(c.telefono) === tel);
    if (match && !nombreInput.value.trim()) {
        nombreInput.value = match.nombre || "";
        toast(`👤 Cliente reconocido: ${match.nombre}`);
        const dirInput = document.getElementById("vd-cliente-direccion");
        if (dirInput && !dirInput.value.trim() && match.direccion) {
            dirInput.value = [match.direccion, match.municipio].filter(Boolean).join(", ");
        }
        const depSelect = document.getElementById("vd-cliente-departamento");
        if (depSelect && !depSelect.value && match.departamento) depSelect.value = match.departamento;
    }
}

function filtrarVD() {
    const q = (document.getElementById("bus-vd")?.value || "").toLowerCase();
    const prods = stockData.filter(s => {
        // Bodega + tienda: ambas son vendibles en Venta Directa (ver _onScanVD/agregarAlVD).
        const disp = parseInt(s.stock_bodega || 0) + parseInt(s.stock_tienda || 0);
        if (disp <= 0) return false;
        if (!q) return true;
        return (s.codigo || "").toLowerCase().includes(q) || (s.nombre || "").toLowerCase().includes(q);
    });
    renderGridVD(prods);
}

function renderGridVD(prods) {
    const grid = document.getElementById("grid-vd");
    if (!grid) return;
    if (!prods.length) { grid.innerHTML = '<p style="color:var(--plateado);font-size:13px;grid-column:1/-1;">Sin productos disponibles.</p>'; return; }
    grid.innerHTML = prods.map(p => {
        const qty      = _vdCarrito[p.codigo]?.qty || 0;
        const bodega   = parseInt(p.stock_bodega || 0);
        const tienda   = parseInt(p.stock_tienda || 0);
        const disp     = bodega + tienda;
        const selec    = qty > 0;
        const fotoHtml = p.foto
            ? `<img src="${ikFoto(p.foto,1200)}" onerror="this.style.display='none'">`
            : ``;
        // Desglose bodega/tienda visible — si no, al vender algo que solo está
        // en tienda el admin iría a buscarlo a bodega y no lo encontraría.
        const desglose = [bodega > 0 ? `Bodega: ${bodega}` : "", tienda > 0 ? `Tienda: ${tienda}` : ""].filter(Boolean).join(" · ");
        return `<div class="prod-card ${selec ? 'seleccionado' : ''}">
            ${fotoHtml}
            <div class="prod-card-info">
                <div class="prod-card-codigo">${p.codigo}</div>
                <div class="prod-card-nombre">${p.nombre}</div>
                <div class="prod-card-precio">$${parseFloat(p.precio||0).toFixed(2)}</div>
                <div style="font-size:10px;color:${disp>0?'#2ecc71':'#e74c3c'};margin-top:2px;">${desglose}</div>
            </div>
            <div class="prod-card-qty">
                <button class="qty-btn" onclick="quitarDeVD('${p.codigo}')">−</button>
                <span class="qty-num">${qty}</span>
                <button class="qty-btn" onclick="agregarAlVD('${p.codigo}')">+</button>
            </div>
        </div>`;
    }).join('');
}

async function diagnosticoVD() {
    const payload = {
        accion: "REGISTRAR_VENTA_DIRECTA",
        id: "TEST_" + Date.now(),
        fecha: new Date().toISOString(),
        cliente: "PRUEBA_DIAGNOSTICO",
        telefono: "0000-0000",
        items: [{ codigo: "TEST", nombre: "Producto prueba", precio: 99, cantidad: 1 }],
        total: 99,
        tipo: "credito",
        enganche: 10,
        saldoPendiente: 89,
        nota: "diagnostico",
        estado: "credito"
    };
    try {
        const resp = await apiPost(payload);
        alert(
            "=== RESULTADO DIAGNÓSTICO ===\n\n" +
            "Respuesta del API:\n" + JSON.stringify(resp, null, 2) +
            "\n\n¿resp.ok es true? → " + (resp.ok ? "SÍ ✅" : "NO ❌") +
            "\n\nSi ves ok: true, la venta de prueba se guardó en Google Sheets." +
            "\nSi ves error, copia este mensaje y compártelo."
        );
    } catch(e) {
        alert("=== ERROR DE CONEXIÓN ===\n\n" + e.message + "\n\nVerifica que tienes internet y que la URL del Worker está correcta.");
    }
}

// "Créditos Pendientes" ya no es un panel aparte — es el Historial mismo
// con el filtro en "Crédito", para que cada cliente tenga un solo
// expediente (antes vivía duplicado en dos vistas con datos separados).
function abrirHistorialSoloPendientes() {
    const panel = document.getElementById("panel-historial-vd");
    const abrirloPrimero = panel.style.display === "none";
    if (abrirloPrimero) toggleHistorialVD();
    setTimeout(() => {
        const sel = document.getElementById("filtro-historial-vd");
        if (sel) { sel.value = "credito"; renderHistorialVD(); }
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }, abrirloPrimero ? 250 : 50);
}

function toggleHistorialVD() {
    const panel = document.getElementById("panel-historial-vd");
    const btn   = document.getElementById("btn-toggle-historial-vd");
    const abierto = panel.style.display !== "none";
    panel.style.display = abierto ? "none" : "block";
    btn.textContent = abierto ? "📊 Historial de Ventas" : "📊 Ocultar Historial";
    if (!abierto) { cargarHistorialVD(); setTimeout(() => panel.scrollIntoView({ behavior:"smooth", block:"start" }), 200); }
}

function irAHistorialVD() {
    const panel = document.getElementById("panel-historial-vd");
    if (panel.style.display === "none") toggleHistorialVD();
    else setTimeout(() => panel.scrollIntoView({ behavior:"smooth", block:"start" }), 50);
}

let _historialVD = [];

async function cargarHistorialVD() {
    const el = document.getElementById("lista-historial-vd");
    if (el) el.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const resp = await apiPost({ accion: "GET_VENTAS_DIRECTAS" });
        if (!resp.ok) {
            if (el) el.innerHTML = '<p style="color:#e85555;font-size:13px;">Error: ' + (resp.error || "no se pudo obtener el historial") + '</p>';
            return;
        }
        _historialVD = (resp.ventas || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        renderHistorialVD();
    } catch(e) {
        if (el) el.innerHTML = '<p style="color:#e85555;font-size:13px;">Error de conexión: ' + e.message + '</p>';
    }
}

function renderHistorialVD() {
    const el     = document.getElementById("lista-historial-vd");
    const filtro = document.getElementById("filtro-historial-vd")?.value || "";
    let lista  = filtro ? _historialVD.filter(v => v.estado === filtro) : _historialVD;

    // Filtrando por Crédito: ordenar por deuda MÁS VIEJA primero — es la
    // vista que se usa para decidir a quién recordarle el pago, así que el
    // que lleva más tiempo debiendo aparece arriba, no el más reciente.
    if (filtro === "credito") {
        lista = [...lista].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    }

    if (!lista.length) {
        el.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay ventas registradas.</p>';
        return;
    }

    // Totales rápidos
    const totalVentas  = lista.reduce((s, v) => s + (parseFloat(v.total)||0), 0);
    const totalPend    = lista.filter(v => v.estado === "credito").reduce((s, v) => s + (parseFloat(v.saldoPendiente)||0), 0);
    const countCred    = lista.filter(v => v.estado === "credito").length;

    el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
            <div style="background:#0a2a0a;border:1px solid #1a5c1a;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:16px;font-weight:700;color:#52d68a;">$${totalVentas.toFixed(2)}</div>
                <div style="font-size:10px;color:var(--plateado);">Total vendido</div>
            </div>
            <div style="background:#0a1a2a;border:1px solid #1a3a5c;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:16px;font-weight:700;color:#3a9de8;">${lista.length}</div>
                <div style="font-size:10px;color:var(--plateado);">Ventas</div>
            </div>
            <div style="background:rgba(255,159,64,0.15);border:1px solid rgba(255,159,64,0.4);border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:16px;font-weight:700;color:#ffb85c;">$${totalPend.toFixed(2)}</div>
                <div style="font-size:10px;color:var(--plateado);">${countCred} pendiente${countCred!==1?"s":""}</div>
            </div>
        </div>
        ${lista.map(v => {
            const fecha    = new Date(v.fecha).toLocaleDateString("es-SV", { day:"2-digit", month:"short", year:"2-digit" });
            const hora     = new Date(v.fecha).toLocaleTimeString("es-SV", { hour:"2-digit", minute:"2-digit" });
            const esCredito = v.estado === "credito";
            const diasDeuda = esCredito ? Math.floor((Date.now() - new Date(v.fecha).getTime()) / 86400000) : 0;
            const diasTxt = esCredito
                ? ` · <span style="color:${diasDeuda>=15?'#e85555':diasDeuda>=7?'#ffb85c':'var(--plateado)'};font-weight:${diasDeuda>=7?700:400};">hace ${diasDeuda} día${diasDeuda===1?"":"s"}</span>`
                : "";
            const saldo    = parseFloat(v.saldoPendiente||0);
            const total    = parseFloat(v.total||0);
            const pagado   = total - saldo;
            const pct      = total > 0 ? Math.round((pagado/total)*100) : 100;
            let items = [];
            try { items = typeof v.items === "string" ? JSON.parse(v.items) : (v.items||[]); } catch(e){}
            const itemsResumen = items.map(i => `${i.nombre||i.codigo} ×${i.cantidad||1}`).join(", ");
            return `<div style="background:#0f0f0f;border:1px solid ${esCredito ? "#c97a2b" : "#1a3a1a"};border-radius:10px;padding:12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:700;color:#fff;">${sanitizar(v.cliente || "Sin nombre")}</div>
                        <div style="font-size:11px;color:var(--plateado);">${fecha} ${hora} · ${sanitizar(v.telefono||"")}${diasTxt}</div>
                        ${v.nota ? `<div style="font-size:11px;color:#888;margin-top:2px;font-style:italic;">"${sanitizar(v.nota)}"</div>` : ""}
                    </div>
                    <div style="text-align:right;flex-shrink:0;margin-left:10px;">
                        <div style="font-size:16px;font-weight:700;color:${esCredito ? "#ffb85c" : "#52d68a"};">$${total.toFixed(2)}</div>
                        <div style="font-size:10px;padding:2px 7px;border-radius:20px;display:inline-block;margin-top:2px;
                            background:${esCredito ? "rgba(255,159,64,0.15)" : "rgba(82,214,138,0.15)"};
                            color:${esCredito ? "#ffb85c" : "#52d68a"};">
                            ${esCredito ? "Crédito" : "Contado"}
                        </div>
                    </div>
                </div>
                ${itemsResumen ? `<div style="font-size:11px;color:#666;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${itemsResumen}</div>` : ""}
                ${v.empresaEnvio ? `<div style="font-size:11px;color:#0ea5e9;margin-bottom:4px;">🚚 ${sanitizar(v.empresaEnvio)}</div>` : ""}
                ${esCredito ? `
                <div style="background:#3a2a12;border-radius:5px;height:5px;margin-bottom:6px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#27ae60,#52d68a);border-radius:5px;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                    <div style="font-size:11px;color:var(--plateado);">Pagado $${pagado.toFixed(2)} · Pendiente <strong style="color:#ffb85c;">$${saldo.toFixed(2)}</strong></div>
                    ${saldo > 0 ? `<div style="display:flex;gap:6px;flex-shrink:0;">
                        <button onclick="enviarRecordatorioAbono('${v.id}')" style="padding:5px 10px;border:none;border-radius:6px;background:#25D366;color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">💬 Recordar</button>
                        <button onclick="abrirModalAbono('${v.id}')" style="padding:5px 10px;border:none;border-radius:6px;background:linear-gradient(135deg,#0a4a6b,#0ea5e9,#0369a1);color:#e0f7ff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">💰 Abono</button>
                    </div>` : '<span style="font-size:11px;color:#52d68a;font-weight:700;">✅ Saldado</span>'}
                </div>` : ""}
                <div style="margin-top:8px;display:flex;justify-content:flex-end;gap:6px;position:relative;">
                    <div id="menu-mas-vd-${v.id}" style="display:none;position:absolute;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:170px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                        <button onclick="toggleMenuMasVD('${v.id}');agregarProductoVentaDirectaVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#52d68a;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">➕ Agregar pieza</button>
                        <button onclick="toggleMenuMasVD('${v.id}');cambiarProductoVentaDirectaVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#a78bfa;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🔄 Cambiar producto</button>
                        <button onclick="toggleMenuMasVD('${v.id}');editarDescuentoVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#ccc;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">✏️ Descuento</button>
                        <button onclick="toggleMenuMasVD('${v.id}');corregirSaldoVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#e85555;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🩹 Corregir saldo</button>
                        <button onclick="toggleMenuMasVD('${v.id}');cambiarFormaPagoVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#5eb3f0;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🔄 Cambiar forma de pago</button>
                        <button onclick="toggleMenuMasVD('${v.id}');verEstadoCuenta('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#e8b07a;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">📄 Estado de cuenta (PDF)</button>
                        <button onclick="toggleMenuMasVD('${v.id}');enviarWAEstadoCuenta('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#25D366;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">💬 Enviar estado de cuenta</button>
                        <button onclick="toggleMenuMasVD('${v.id}');marcarFechaItemVD('${v.id}')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#C9A84C;border:none;cursor:pointer;text-align:left;font-weight:600;">📅 Marcar fecha de una pieza</button>
                    </div>
                    <button onclick="toggleMenuMasVD('${v.id}',this)" style="padding:5px 10px;border:none;border-radius:6px;background:#1a1a1a;border:1px solid #444;color:#888;font-size:11px;font-weight:700;cursor:pointer;">⋯ Más acciones</button>
                    <button onclick="abrirModalImprimirRecibo58('${v.id}')" style="padding:5px 12px;border:none;border-radius:6px;background:#1a1a1a;border:1px solid #333;color:#C9A84C;font-size:11px;font-weight:700;cursor:pointer;">🧾 Recibo</button>
                </div>
            </div>`;
        }).join("")}`;
}

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