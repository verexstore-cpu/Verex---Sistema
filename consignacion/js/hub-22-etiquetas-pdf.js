// Hub VEREX — PDF de etiquetas (formatos mini, tarjeta y 60×25)
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
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
            const material = abreviarMaterial(p.material || extraerMaterial(p.nombre || '', p.descripcion || ''));
            if (material) {
                doc.setFont('helvetica', 'bold'); doc.setTextColor(...B);
                doc.text(_materialQueCabe(doc, material, dataW, 6, 4.5), dataX, 7.5);
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

    // Material — helvetica bold, ancho completo inferior. Se achica la letra lo
    // justo para que quepa entero (antes se cortaba: "Plata 925 / Oro" sin "Lam.").
    const mat = abreviarMaterial(p.material || extraerMaterial(p.nombre || '', p.descripcion || ''));
    if (mat) {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...B);
        if (engrosar) doc.setLineWidth(trazoMaterial);
        doc.text(_materialQueCabe(doc, mat, W - 1, 6.5, 5), ox + 0.5, oy + 11.2, modo);
    }
}

// Devuelve el material listo para escribir en maxW mm y deja puesto el tamaño de
// letra: empieza en fsMax y baja de a 0.25pt hasta fsMin; si aún no cabe, quita
// los espacios alrededor de "/" ("Plata 925/Oro Lam.") y, como último recurso,
// corta a la primera línea. La fuente (familia/peso) debe estar puesta antes.
function _materialQueCabe(doc, material, maxW, fsMax, fsMin) {
    for (const t of [material, material.replace(/\s*\/\s*/g, '/')]) {
        for (let fs = fsMax; fs >= fsMin - 0.001; fs -= 0.25) {
            doc.setFontSize(fs);
            if (doc.getTextWidth(t) <= maxW) return t;
        }
    }
    doc.setFontSize(fsMin);
    return doc.splitTextToSize(material, maxW)[0];
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
