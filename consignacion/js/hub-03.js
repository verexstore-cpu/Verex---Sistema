

async function confirmarVentaAfiliado() {
    const items = Object.values(carritoEntrega).map(e => ({
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
    if (!items.length) { toast("⚠️ Agrega al menos un producto"); return; }

    const btn = document.getElementById("btn-venta-afiliado");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Registrando..."; }

    const fechaVA = document.getElementById("fecha-venta-afiliado")?.value;
    const fechaVAiso = fechaVA ? new Date(fechaVA + "T12:00:00").toISOString() : undefined;

    try {
        // 1. Asigna las piezas al afiliado (mismo mecanismo que una entrega normal)
        await apiPost({ accion: "REGISTRAR_ENTREGA", vendedor: vendedorActual.codigo, items });
        // 2. Marca cada pieza como vendida de inmediato — el afiliado ya cerró la venta por su cuenta
        for (const item of items) {
            await apiPost({ accion: "REGISTRAR_VENTA", id: item.id, cantidad: item.cantidad, fecha: fechaVAiso });
        }
        items.forEach(item => consignacion.push({ ...item, vendedor: vendedorActual.codigo, vendido: item.cantidad, estado: "activo" }));

        toast("✅ Venta de afiliado registrada");
        _esVentaDirectaAfiliado = false;
        volverPerfil();
        renderPerfilStats();
        renderInventario();
        renderVentasPerfil();
    } catch(e) {
        console.error("Error registrando venta de afiliado:", e);
        toast("⚠️ Error al registrar la venta: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "💰 Registrar Venta"; }
    }
}

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
    let total = 0;
    items.forEach((item, idx) => {
        if (y + rowH > limiteY) { doc.addPage(); y = 20; dibujarEncabezadoTabla(); }
        const subtotal = parseFloat(item.precio) * parseInt(item.cantidad);
        total += subtotal;
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
    doc.text("TOTAL CONSIGNADO:", mL + 2, y + 5);
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


// ── REEMPLAZAR FOTOS: reconoce a qué producto pertenece cada foto editada ──────────────────────────
// Sin API externa: cada foto se reduce a una "huella" (16×16 bits de claro/oscuro entre vecinos + tono medio) y se compara
// con la huella de las fotos de Stock. Se compara contra la foto ORIGINAL completa guardada en ImageKit (sin recorte) y
// contra la recortada, para tolerar ediciones que cambian el encuadre. Siempre propone y el usuario confirma.
function rfHuella(img, rect) {
    // Mapa 32×32 de "cuánto se diferencia cada punto del fondo" (mediana del borde): invariante a brillo/contraste/color de
    // la edición y casi independiente del fondo, que en estas fotos es casi igual en todas. rect = zona a usar (zoom/recorte).
    const N = 32, c = document.createElement("canvas"); c.width = N; c.height = N;
    const x = c.getContext("2d", { willReadFrequently: true });
    const r = rect || { x: 0, y: 0, w: img.width, h: img.height };
    x.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data, g = new Float32Array(N * N);
    let sr = 0, sb = 0;
    for (let i = 0; i < N * N; i++) { g[i] = 0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2]; sr += d[i*4]; sb += d[i*4+2]; }
    const borde = []; for (let k = 0; k < N; k++) borde.push(g[k], g[(N-1)*N + k], g[k*N], g[k*N + N-1]);
    borde.sort((p, q) => p - q); const fondo = borde[borde.length >> 1];
    const v = new Float32Array(N * N); let m = 0;
    for (let i = 0; i < N * N; i++) { v[i] = Math.abs(g[i] - fondo); m += v[i]; }
    m /= N * N; let sd = 0; for (let i = 0; i < N * N; i++) { v[i] -= m; sd += v[i] * v[i]; }
    sd = Math.sqrt(sd / (N * N)) || 1; for (let i = 0; i < N * N; i++) v[i] /= sd;
    return { v, rb: (sr - sb) / (N * N) };
}
// Vistas de una foto de Stock: completa, y con zoom 88 % / 76 % (por si la edición recortó los bordes) y recorte cuadrado central.
function rfVistas(img) {
    const w = img.width, h = img.height, z = (f) => ({ x: w * (1 - f) / 2, y: h * (1 - f) / 2, w: w * f, h: h * f }), l = Math.min(w, h);
    return [undefined, z(0.88), z(0.76), { x: (w - l) / 2, y: (h - l) / 2, w: l, h: l }].map(rc => rfHuella(img, rc));
}
function rfDistancia(a, b) {
    let s = 0; for (let i = 0; i < a.v.length; i++) s += a.v[i] * b.v[i];
    const corr = s / a.v.length;                                              // Pearson (ya normalizados)
    return (1 - corr) / 2 + Math.min(1, Math.abs(a.rb - b.rb) / 60) * 0.05;   // 0 = idéntica
}
function rfCargarImagen(src) {
    return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("no cargó")); im.src = src; });
}
function rfMejores(huella, refs, n) {
    return refs.map(r => ({ r, d: Math.min(...r.huellas.map(h => rfDistancia(huella, h))) })).sort((a, b) => a.d - b.d).slice(0, n || 3);
}

// Busca en el NOMBRE del archivo el código de un producto (p. ej. «ANP174_editada.jpg», «anp174t8 (1).png»). El código debe
// aparecer completo y no pegado a otras letras/números (así «ANP20» no confunde con «ANP200»). Gana el código más largo.
// Devuelve la referencia (diseño) o null si no hay coincidencia o hay más de un diseño posible.
function rfPorNombre(nombreArchivo, refs) {
    const n = String(nombreArchivo || "").replace(/\.[A-Za-z0-9]{2,5}$/, "").toUpperCase();
    let mejorLong = 0, candidatos = [];
    for (const r of refs) {
        const cods = new Set(); r.codigos.forEach(c => { cods.add(String(c).toUpperCase()); const b = getCodigoBase(c).toUpperCase(); if (b) cods.add(b); });
        for (const c of cods) {
            if (c.length < 4) continue;
            const i = n.indexOf(c); if (i < 0) continue;
            const antes = i === 0 || !/[A-Z0-9]/.test(n[i - 1]), despues = i + c.length === n.length || !/[A-Z0-9]/.test(n[i + c.length]);
            if (!antes || !despues) continue;
            if (c.length > mejorLong) { mejorLong = c.length; candidatos = [r]; } else if (c.length === mejorLong && !candidatos.includes(r)) candidatos.push(r);
        }
    }
    return candidatos.length === 1 ? candidatos[0] : null;
}

let _rfRefs = null, _rfRefsN = -1, _rfFilas = [];
function abrirReemplazarFotos() { _rfFilas = []; document.getElementById("rf-lista").innerHTML = ""; document.getElementById("rf-estado").textContent = ""; document.getElementById("rf-btn-aplicar").disabled = true; document.getElementById("rf-input").value = ""; abrirModal("modal-reemplazar-fotos"); }
function cerrarReemplazarFotos() { cerrarModal("modal-reemplazar-fotos"); }

// Referencias: una por foto distinta de Stock (varias tallas comparten foto) — huella de la original completa y de la recortada.
async function rfConstruirReferencias(estado) {
    const activos = stockData.filter(p => p.estado !== "inactivo" && (p.foto || p.img) && String(p.foto || p.img).includes("imagekit.io"));
    if (_rfRefs && _rfRefsN === activos.length) return _rfRefs;
    const grupos = new Map();
    for (const p of activos) {
        const foto = p.foto || p.img, base = foto.split("?")[0];
        if (!grupos.has(base)) grupos.set(base, { base, foto, codigos: [], nombre: p.nombre_base || p.nombre || "", cod: p.codigo });
        grupos.get(base).codigos.push(p.codigo);
    }
    const lista = [...grupos.values()], refs = []; let hechos = 0, fallidas = 0;
    const trozo = (url, tr) => `${url.split("?")[0]}?tr=${tr}`;
    const trabajo = async (g) => {
        try {
            const previo = g.foto.includes("?tr=") ? g.foto.split("?tr=")[1] : "";
            const huellas = rfVistas(await rfCargarImagen(trozo(g.foto, "w-96")));                           // original completa (+ zoom)
            if (previo) huellas.push(...rfVistas(await rfCargarImagen(trozo(g.foto, previo + ",w-96"))).slice(0, 2));   // la recortada de Stock
            g.huellas = huellas; g.thumb = trozo(g.foto, (previo ? previo + "," : "") + "w-480,q-85"); refs.push(g);
        } catch (e) { fallidas++; }
        estado(++hechos, lista.length);
    };
    const cola = lista.slice(); await Promise.all(Array.from({ length: 8 }, async () => { while (cola.length) await trabajo(cola.shift()); }));
    _rfRefs = refs; _rfRefsN = activos.length; _rfRefs.fallidas = fallidas; return refs;
}

async function rfElegirArchivos(files) {
    const archivos = [...files || []].filter(f => f.type.startsWith("image/")); if (!archivos.length) return;
    const est = document.getElementById("rf-estado"), lista = document.getElementById("rf-lista");
    est.textContent = "Analizando las fotos de Stock…";
    let refs;
    try { refs = await rfConstruirReferencias((a, b) => { est.textContent = `Analizando las fotos de Stock… ${a}/${b}`; }); }
    catch (e) { est.textContent = "⚠️ No se pudieron analizar las fotos de Stock"; return; }
    if (!refs.length) { est.textContent = "⚠️ No hay fotos de Stock con las que comparar"; return; }
    _rfFilas = [];
    for (let i = 0; i < archivos.length; i++) {
        const f = archivos[i]; est.textContent = `Reconociendo ${i + 1}/${archivos.length}…`;
        const url = URL.createObjectURL(f); let top = [], huella = null;
        try { huella = rfHuella(await rfCargarImagen(url)); top = rfMejores(huella, refs, 3); } catch (e) {}
        // 1.º el nombre del archivo (si trae el código); 2.º el parecido visual
        const rn = rfPorNombre(f.name, refs);
        let elegido;
        if (rn && huella) {
            const d = Math.min(...rn.huellas.map(h => rfDistancia(huella, h)));
            top = [{ r: rn, d, porNombre: true }, ...top.filter(t => t.r !== rn)].slice(0, 3); elegido = 0;
        } else {
            const mejor = top[0], seg = top[1];
            elegido = mejor && mejor.d < 0.22 && (!seg || seg.d - mejor.d > 0.04) ? 0 : -1;
        }
        _rfFilas.push({ file: f, url, top, elegido, estado: "", porNombre: !!rn });
    }
    est.textContent = `${archivos.length} foto(s) · ${_rfFilas.filter(f => f.porNombre).length} reconocidas por el nombre del archivo · ${refs.length} fotos de Stock comparadas` + (refs.fallidas ? ` · ⚠️ ${refs.fallidas} de Stock no se pudieron leer` : "");
    rfPintar();
}

function rfPintar() {
    const cont = document.getElementById("rf-lista");
    cont.innerHTML = _rfFilas.map((f, i) => {
        const cands = f.top.map((t, j) => {
            const sel = f.elegido === j, conf = Math.max(0, Math.round((1 - t.d / 0.5) * 100));
            return `<div style="flex:1 1 230px;max-width:340px;min-width:200px;background:${sel ? "rgba(201,168,76,.16)" : "var(--gris2)"};border:3px solid ${sel ? "var(--dorado)" : "transparent"};border-radius:12px;padding:8px;">
                <img src="${sanitizar(t.r.thumb)}" title="Clic para ampliar" onclick="abrirFotoZoom(${jsArg(t.r.foto)}, ${jsArg(t.r.nombre)})"
                     style="width:100%;aspect-ratio:1/1;object-fit:contain;border-radius:8px;background:#fff;cursor:zoom-in;display:block;">
                <div style="font-size:13px;line-height:1.4;margin:8px 0;"><b>${sanitizar(t.r.nombre)}</b><br><span style="color:var(--plateado);font-size:12px;">${sanitizar(t.r.codigos.slice(0,4).join(", "))}${t.r.codigos.length > 4 ? " +" + (t.r.codigos.length - 4) : ""}</span>
                    <br><span style="color:${conf > 55 ? "#4ade80" : "#f0b96a"};font-size:12px;">parecido ${conf}%</span>
                    ${t.porNombre ? '<br><span style="color:#5AC8FA;font-size:12px;">📎 Coincide con el nombre del archivo</span>' : ""}
                    ${t.porNombre && conf < 40 ? '<br><span style="color:#f0b96a;font-size:12px;">⚠️ La foto se ve distinta a la actual: verifica que sea ese producto</span>' : ""}</div>
                <button type="button" class="btn ${sel ? "btn-dorado" : "btn-gris"}" style="width:100%;padding:8px;font-size:13px;" onclick="rfElegir(${i},${j})">${sel ? "✓ Elegida" : "Es esta"}</button></div>`;
        }).join("");
        return `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;background:#1c1c1e;border:1px solid #3a3a3c;border-radius:14px;padding:14px;">
            <div style="flex:0 1 300px;min-width:220px;">
                <div style="font-size:11px;color:var(--dorado);font-weight:700;letter-spacing:.5px;margin-bottom:6px;">TU FOTO EDITADA</div>
                <img src="${f.url}" title="Clic para ampliar" onclick="abrirFotoZoom(${jsArg(f.url)}, ${jsArg(f.file.name)})" style="width:100%;aspect-ratio:1/1;object-fit:contain;border-radius:10px;background:#fff;cursor:zoom-in;display:block;">
                <div style="font-size:11px;color:var(--plateado);margin-top:6px;word-break:break-all;">${sanitizar(f.file.name)}${f.estado ? " · " + f.estado : ""}</div>
            </div>
            <div style="flex:1 1 520px;min-width:260px;">
                <div style="font-size:11px;color:var(--plateado);font-weight:700;letter-spacing:.5px;margin-bottom:6px;">¿CUÁL ES EL PRODUCTO? (clic en la foto para ampliar)</div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;">${cands || '<span style="color:#f0b96a;font-size:12px;">No se pudo comparar esta foto</span>'}</div>
                <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <input id="rf-cod-${i}" placeholder="o escribe el código exacto" style="padding:8px 10px;font-size:13px;width:220px;" onchange="rfCodigoManual(${i}, this.value)">
                    <button type="button" class="btn btn-gris" style="padding:6px 12px;font-size:12px;" onclick="rfElegir(${i},-1)">No reemplazar esta</button>
                </div></div></div>`;
    }).join("");
    document.getElementById("rf-btn-aplicar").disabled = !_rfFilas.some(f => f.elegido !== -1);
}
function rfElegir(i, j) { _rfFilas[i].elegido = j; _rfFilas[i].manual = null; rfPintar(); }
function rfCodigoManual(i, cod) {
    cod = (cod || "").trim(); if (!cod) return;
    const it = stockData.find(p => String(p.codigo).toLowerCase() === cod.toLowerCase());
    if (!it) { toast("⚠️ Ese código no existe en Stock: " + cod); return; }
    const foto = it.foto || it.img || "", base = foto.split("?")[0];
    const grupo = stockData.filter(p => p.estado !== "inactivo" && (p.foto || p.img || "").split("?")[0] === base).map(p => p.codigo);
    _rfFilas[i].manual = { r: { nombre: it.nombre_base || it.nombre, codigos: grupo.length ? grupo : [it.codigo], thumb: foto, foto }, d: 0 };
    _rfFilas[i].top = [_rfFilas[i].manual, ..._rfFilas[i].top.filter(t => t !== _rfFilas[i].manual)].slice(0, 3); _rfFilas[i].elegido = 0; rfPintar();
}

async function rfAplicar() {
    const filas = _rfFilas.filter(f => f.elegido !== -1 && f.top[f.elegido]);
    if (!filas.length) return;
    const lista = filas.map(f => `• ${f.file.name} → ${f.top[f.elegido].r.nombre} (${f.top[f.elegido].r.codigos.slice(0, 3).join(", ")})`).join("\n");
    if (!confirm(`Se reemplazará la foto de ${filas.length} producto(s) (y de todas sus tallas):\n\n${lista}\n\n¿Continuar?`)) return;
    const btn = document.getElementById("rf-btn-aplicar"); btn.disabled = true;
    let ok = 0;
    for (let i = 0; i < filas.length; i++) {
        const f = filas[i], ref = f.top[f.elegido].r;
        btn.textContent = `Subiendo ${i + 1}/${filas.length}…`;
        try {
            const r = await procesarFotoJoya(f.file);
            const url = await subirFotoImageKit(f.file, ref.codigos[0], r.crop);
            if (!url) throw new Error("no se pudo subir");
            for (const cod of ref.codigos) {
                // Nivel «Suave» (sin nitidez): la tienda no le suma e-sharpen a la foto que ya viene afilada (Upscayl, etc.)
                const suave = ikMejorar(url, "suave", 1600);
                const res = await apiPost({ accion: "EDITAR_PRODUCTO", codigo: cod, img: url, fotoMejorada: suave, fotoMejoraNivel: "suave" });
                if (res && res.ok === false) throw new Error(res.error || "no se guardó");
                const it = stockData.find(p => p.codigo === cod); if (it) { it.foto = url; it.img = url; it.fotoMejorada = suave; it.fotoMejoraNivel = "suave"; }
            }
            f.estado = "✅ reemplazada"; f.refAplicada = ref; ok++;
        } catch (e) { f.estado = "⚠️ falló: " + (e.message || e); }
        f.elegido = -1; rfPintar();
    }
    btn.textContent = "Reemplazar las confirmadas"; _rfRefs = null;
    try { filtrarStock(); } catch (_) { renderStock(stockData); }
    toast(`✅ ${ok} de ${filas.length} fotos reemplazadas`, ok === filas.length ? "#22c55e" : "#f97316");
    // Ofrece publicar en la tienda exactamente los productos que se acaban de reemplazar (sin mover inventario).
    const codigosOk = [...new Set(filas.filter(f => f.refAplicada).flatMap(f => f.refAplicada.codigos))];
    if (codigosOk.length && confirm(`¿Publicar también en la tienda online los ${codigosOk.length} códigos de las fotos reemplazadas?\n\nNO se mueve inventario: siguen disponibles en todos los canales y el stock se descuenta igual al vender.`)) {
        try { const r = await publicarVisibleEnTienda(codigosOk); toast(`🛍️ ${r.cambiados.length} publicados · ${r.yaEstaban.length} ya estaban visibles`, "#22c55e", 6000); }
        catch (e) { toast("⚠️ No se pudo publicar: " + (e.message || e), "#ef4444"); }
    }
}


// ── LOTE PARA EDITAR: productos variados con más stock → un ZIP con carpetas de N fotos ───────────────────────
// Un producto por DISEÑO (tallas que comparten foto = uno). Reparto por categorías en rueda (variedad); dentro de cada
// categoría, de mayor a menor stock. Las carpetas se llenan en ese orden: Lote-01 = los más prioritarios.
function leSeleccionar(items, total) {
    const diseños = new Map();
    for (const p of items) {
        if (p.estado === "inactivo") continue;
        const foto = p.foto || p.img; if (!foto) continue;
        const clave = String(foto).split("?")[0];
        const stock = (parseInt(p.stock_total) || 0) || ((parseInt(p.stock_bodega) || 0) + (parseInt(p.stock_tienda) || 0) + (parseInt(p.stock_consignacion) || 0));
        if (!diseños.has(clave)) diseños.set(clave, { clave, foto, codigos: [], stock: 0, nombre: p.nombre_base || p.nombre || "", categoria: String(p.categoria || (getCodigoBase(p.codigo).match(/^[A-Z]+/) || ["GEN"])[0]).toUpperCase() });
        const d = diseños.get(clave); d.codigos.push(p.codigo); d.stock += stock;
    }
    const porCat = new Map();
    for (const d of diseños.values()) { if (d.stock <= 0) continue; if (!porCat.has(d.categoria)) porCat.set(d.categoria, []); porCat.get(d.categoria).push(d); }
    for (const l of porCat.values()) l.sort((a, b) => b.stock - a.stock || String(a.codigos[0]).localeCompare(String(b.codigos[0])));
    // categorías con más diseños primero, para que la rueda arranque por las más "pobladas"
    const cats = [...porCat.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(e => e[1]);
    const out = [];
    for (let i = 0; out.length < total && cats.some(l => i < l.length); i++) for (const l of cats) { if (i < l.length && out.length < total) out.push(l[i]); }
    return out;
}
// Hace visibles en la tienda online los productos indicados SIN mover inventario (solo enCatalogo). La tienda vende con
// stock_tienda + stock_bodega y reserva primero de tienda y luego de bodega, así que el stock sigue siendo uno para todos los canales.
async function publicarVisibleEnTienda(codigos) {
    const res = await apiPost({ accion: "STOCK_PUBLICAR_VISIBLE", codigos, visible: true });
    if (!res || !res.ok) throw new Error((res && res.error) || "no se pudo publicar");
    res.cambiados = res.cambiados || []; res.yaEstaban = res.yaEstaban || []; res.inactivos = res.inactivos || []; res.noExisten = res.noExisten || [];
    for (const c of res.cambiados) { const it = stockData.find(p => p.codigo === c); if (it) it.enCatalogo = true; }
    try { filtrarStock(); } catch (_) {}
    return res;
}
let _leSel = [];
function abrirLoteEditar() { _leSel = []; document.getElementById("le-lista").innerHTML = ""; document.getElementById("le-resumen").textContent = ""; document.getElementById("le-progreso").textContent = ""; document.getElementById("le-btn-zip").disabled = true; abrirModal("modal-lote-editar"); leElegir(); }
function cerrarLoteEditar() { cerrarModal("modal-lote-editar"); }
function leElegir() {
    const total = Math.max(1, Math.min(500, parseInt(document.getElementById("le-total").value) || 100));
    _leSel = leSeleccionar(stockData, total).map(d => ({ ...d, incluir: true }));
    lePintar();
}
function lePintar() {
    const por = Math.max(1, Math.min(100, parseInt(document.getElementById("le-por").value) || 20));
    const marcados = _leSel.filter(d => d.incluir), cats = {};
    marcados.forEach(d => cats[d.categoria] = (cats[d.categoria] || 0) + 1);
    document.getElementById("le-resumen").textContent = `${marcados.length} productos · ${Math.ceil(marcados.length / por)} carpeta(s) de hasta ${por} · ` + Object.entries(cats).map(([c, n]) => `${c}: ${n}`).join("  ");
    let k = 0;
    document.getElementById("le-lista").innerHTML = _leSel.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="position:sticky;top:0;background:#222;color:var(--plateado);text-align:left;"><th style="padding:6px;"></th><th>Carpeta</th><th>Foto</th><th>Código</th><th>Nombre</th><th>Cat.</th><th style="text-align:right;padding-right:10px;">Stock</th></tr>` +
        _leSel.map((d, i) => { const carp = d.incluir ? "Lote-" + String(Math.floor(k++ / por) + 1).padStart(2, "0") : "—";
            return `<tr style="border-top:1px solid #2a2a2c;opacity:${d.incluir ? 1 : .4};"><td style="padding:4px 6px;"><input type="checkbox" ${d.incluir ? "checked" : ""} onchange="_leSel[${i}].incluir=this.checked;lePintar()"></td>
            <td style="color:var(--dorado);font-weight:700;">${carp}</td>
            <td><img src="${sanitizar(ikFoto(d.foto, 90))}" onclick="abrirFotoZoom(${jsArg(d.foto)}, ${jsArg(d.nombre)})" style="width:46px;height:46px;object-fit:cover;border-radius:6px;cursor:zoom-in;background:#222;display:block;margin:3px 0;"></td>
            <td>${sanitizar(getCodigoBase(d.codigos[0]))}<span style="color:var(--plateado);"> ${d.codigos.length > 1 ? "(" + d.codigos.length + " tallas)" : ""}</span></td>
            <td>${sanitizar(d.nombre)}</td><td>${sanitizar(d.categoria)}</td><td style="text-align:right;padding-right:10px;">${d.stock}</td></tr>`; }).join("") + "</table>"
        : '<p style="padding:14px;color:var(--plateado);font-size:13px;">No hay productos con foto y stock para elegir.</p>';
    document.getElementById("le-btn-zip").disabled = !marcados.length;
    const bp = document.getElementById("le-btn-publicar"); if (bp) bp.disabled = !marcados.length;
}
async function lePublicar() {
    const codigos = [...new Set(_leSel.filter(d => d.incluir).flatMap(d => d.codigos))]; if (!codigos.length) return;
    if (!confirm(`Se harán visibles en la tienda online ${codigos.length} códigos (todas las tallas de ${_leSel.filter(d => d.incluir).length} diseños).\n\nNO se mueve inventario: siguen disponibles en todos los canales y el stock se descuenta igual al vender.\n\n¿Continuar?`)) return;
    const prog = document.getElementById("le-progreso"); prog.textContent = "Publicando…";
    try { const r = await publicarVisibleEnTienda(codigos); prog.textContent = `🛍️ ${r.cambiados.length} publicados · ${r.yaEstaban.length} ya estaban visibles` + (r.inactivos.length ? ` · ${r.inactivos.length} inactivos omitidos` : ""); toast(prog.textContent, "#22c55e", 6000); }
    catch (e) { prog.textContent = "⚠️ " + (e.message || e); toast(prog.textContent, "#ef4444"); }
}
// Lee un LISTA.csv (el que trae el ZIP del lote) y devuelve las filas como objetos {columna: valor}. Soporta comillas, comas
// dentro de comillas, comillas dobles escapadas y el BOM del inicio.
function leLeerCsv(texto) {
    const t = String(texto || "").replace(/^\uFEFF/, ""), filas = []; let fila = [], campo = "", q = false;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c; }
        else if (c === '"') q = true;
        else if (c === ",") { fila.push(campo); campo = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; fila.push(campo); campo = ""; if (fila.some(x => x !== "")) filas.push(fila); fila = []; }
        else campo += c;
    }
    if (campo !== "" || fila.length) { fila.push(campo); if (fila.some(x => x !== "")) filas.push(fila); }
    if (!filas.length) return [];
    const enc = filas[0].map(x => x.trim().toLowerCase());
    return filas.slice(1).map(f => Object.fromEntries(enc.map((h, i) => [h, (f[i] || "").trim()])));
}
async function lePublicarDesdeCsv(archivo) {
    if (!archivo) return;
    const prog = document.getElementById("le-progreso");
    let filas; try { filas = leLeerCsv(await archivo.text()); } catch (e) { prog.textContent = "⚠️ No se pudo leer el archivo"; return; }
    if (!filas.length || !("codigos_del_diseno" in filas[0])) { prog.textContent = "⚠️ Ese archivo no parece un LISTA.csv del lote (falta la columna codigos_del_diseno)"; toast(prog.textContent, "#ef4444"); return; }
    const codigos = [...new Set(filas.flatMap(f => String(f.codigos_del_diseno || "").split(/\s+/).filter(Boolean)))];
    if (!codigos.length) { prog.textContent = "⚠️ La lista no trae códigos"; return; }
    if (!confirm(`LISTA.csv: ${filas.length} productos · ${codigos.length} códigos (todas sus tallas).\n\nSe harán visibles en la tienda online. NO se mueve inventario: siguen disponibles en todos los canales y el stock se descuenta igual al vender.\n\n¿Continuar?`)) return;
    prog.textContent = "Publicando…";
    try {
        const r = await publicarVisibleEnTienda(codigos);
        prog.textContent = `🛍️ ${r.cambiados.length} publicados · ${r.yaEstaban.length} ya estaban visibles` + (r.inactivos.length ? ` · ${r.inactivos.length} inactivos omitidos` : "") + ((r.noExisten || []).length ? ` · ${r.noExisten.length} códigos ya no existen en Stock` : "");
        toast(prog.textContent, "#22c55e", 7000);
    } catch (e) { prog.textContent = "⚠️ " + (e.message || e); toast(prog.textContent, "#ef4444"); }
}
// Quita la nitidez extra de la tienda a los productos de un LISTA.csv (fotos ya reemplazadas): guarda el nivel «Suave».
// No toca los que ya tienen una mejora guardada (esa nitidez la eligió el usuario) ni fotos que no son de ImageKit.
async function leSinNitidezDesdeCsv(archivo) {
    if (!archivo) return;
    const prog = document.getElementById("le-progreso");
    let filas; try { filas = leLeerCsv(await archivo.text()); } catch (e) { prog.textContent = "⚠️ No se pudo leer el archivo"; return; }
    if (!filas.length || !("codigos_del_diseno" in filas[0])) { prog.textContent = "⚠️ Ese archivo no parece un LISTA.csv del lote"; toast(prog.textContent, "#ef4444"); return; }
    const codigos = [...new Set(filas.flatMap(f => String(f.codigos_del_diseno || "").split(/\s+/).filter(Boolean)))];
    const items = codigos.map(c => stockData.find(p => p.codigo === c)).filter(Boolean);
    const aplicar = items.filter(p => !p.fotoMejorada && String(p.foto || p.img || "").includes("imagekit.io"));
    const conMejora = items.filter(p => p.fotoMejorada).length;
    if (!aplicar.length) { prog.textContent = `Nada que cambiar (${conMejora} ya tienen mejora guardada).`; toast(prog.textContent, "#f97316"); return; }
    if (!confirm(`${aplicar.length} códigos (todas sus tallas) dejarán de recibir la nitidez extra de la tienda (nivel «Suave»).\n${conMejora ? conMejora + " con mejora ya guardada no se tocan.\n" : ""}La foto original no se modifica y se puede revertir con ✨ Mejorar imagen.\n\n¿Continuar?`)) return;
    let ok = 0, mal = 0;
    for (let i = 0; i < aplicar.length; i++) {
        const p = aplicar[i]; prog.textContent = `Aplicando… ${i + 1}/${aplicar.length}`;
        try {
            const suave = ikMejorar(p.foto || p.img, "suave", 1600);
            const r = await apiPost({ accion: "EDITAR_PRODUCTO", codigo: p.codigo, fotoMejorada: suave, fotoMejoraNivel: "suave" });
            if (r && r.ok === false) throw new Error(r.error);
            p.fotoMejorada = suave; p.fotoMejoraNivel = "suave"; ok++;
        } catch (_) { mal++; }
    }
    prog.textContent = `✅ ${ok} sin nitidez extra` + (mal ? ` · ⚠️ ${mal} fallaron` : "");
    toast(prog.textContent, mal ? "#f97316" : "#22c55e", 7000);
    try { filtrarStock(); } catch (_) {}
}
function leCsv(filas) {
    const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    return "﻿" + ["carpeta", "archivo", "codigos_del_diseno", "nombre", "categoria", "stock", "estado"].map(esc).join(",") + "\r\n" +
        filas.map(f => [f.carpeta, f.archivo, f.codigos, f.nombre, f.categoria, f.stock, f.estado].map(esc).join(",")).join("\r\n");
}
async function leDescargar() {
    const por = Math.max(1, Math.min(100, parseInt(document.getElementById("le-por").value) || 20));
    const elegidos = _leSel.filter(d => d.incluir); if (!elegidos.length) return;
    const btn = document.getElementById("le-btn-zip"), prog = document.getElementById("le-progreso"); btn.disabled = true;
    const zip = new JSZip(), usados = new Set(), filas = [], fallidas = [];
    let hechos = 0;
    const trabajos = elegidos.map((d, idx) => ({ d, idx, carpeta: "Lote-" + String(Math.floor(idx / por) + 1).padStart(2, "0") }));
    const hacer = async (t) => {
        const { d, carpeta } = t, url = d.foto;
        let base = getCodigoBase(d.codigos[0]) || String(d.codigos[0]), ext = ((url.split("?")[0].split(".").pop() || "jpg").slice(0, 4)).toLowerCase();
        let nombre = `${base}.${ext}`; for (let n = 2; usados.has(carpeta + "/" + nombre); n++) nombre = `${base}_${n}.${ext}`;
        usados.add(carpeta + "/" + nombre);
        const fila = { carpeta, archivo: nombre, codigos: d.codigos.join(" "), nombre: d.nombre, categoria: d.categoria, stock: d.stock, estado: "ok" };
        try { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); zip.folder(carpeta).file(nombre, await r.blob()); }
        catch (e) { fila.estado = "NO DESCARGADA"; fallidas.push(base); }
        filas[t.idx] = fila; prog.textContent = `📥 ${++hechos}/${trabajos.length}…`;
    };
    const cola = trabajos.slice(); await Promise.all(Array.from({ length: 5 }, async () => { while (cola.length) await hacer(cola.shift()); }));
    if (fallidas.length === trabajos.length) { prog.textContent = "⚠️ No se pudo descargar ninguna foto (revisa la conexión)"; btn.disabled = false; return; }
    zip.file("LISTA.csv", leCsv(filas));
    prog.textContent = "🗜️ Preparando el ZIP…";
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const nombreZip = `lote-fotos-${new Date().toISOString().slice(0, 10)}.zip`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombreZip; document.body.appendChild(a); a.click(); a.remove();
    const ok = trabajos.length - fallidas.length;
    prog.textContent = `✅ ${ok} fotos en ${Math.ceil(trabajos.length / por)} carpeta(s) → ${nombreZip}` + (fallidas.length ? ` · ⚠️ ${fallidas.length} fallaron (${fallidas.slice(0, 5).join(", ")})` : "");
    toast(prog.textContent, fallidas.length ? "#f97316" : "#22c55e", 6000);
    btn.disabled = false;
}


// ── CATEGORÍAS DE LA TIENDA: revisar y corregir productos mal clasificados ───────────────────────────────────
let _catDud = [], _catNombres = {};
function abrirCategorias() { abrirModal("modal-categorias"); catCargar(); }
async function catCargar() {
    const est = document.getElementById("cat-estado"); est.textContent = "Revisando…"; document.getElementById("cat-btn-corregir").disabled = true;
    let res; try { res = await apiPost({ accion: "AUDITORIA_CATEGORIAS" }); } catch (e) { est.textContent = "⚠️ " + e.message; return; }
    if (!res || !res.ok) { est.textContent = "⚠️ " + ((res && res.error) || "No se pudo revisar"); return; }
    _catNombres = res.categorias || {}; _catDud = (res.dudosas || []).map(d => ({ ...d, elegida: d.propuesta, marcar: true }));
    document.getElementById("cat-resumen").innerHTML = Object.entries(res.porCategoria || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) =>
        `<span style="background:#222;border:1px solid #3a3a3c;border-radius:20px;padding:5px 12px;font-size:12px;"><b>${sanitizar(_catNombres[c] || c)}</b> · ${n}</span>`).join("") +
        `<span style="font-size:12px;color:var(--plateado);align-self:center;">publicados en la tienda: ${res.publicados}</span>`;
    est.textContent = _catDud.length ? `⚠️ ${_catDud.length} producto(s) parecen mal clasificados` : "✅ Todo está en su categoría";
    catPintar();
}
function catPintar() {
    const opts = (sel) => Object.entries(_catNombres).map(([c, n]) => `<option value="${c}" ${c === sel ? "selected" : ""}>${sanitizar(n)}</option>`).join("");
    document.getElementById("cat-lista").innerHTML = _catDud.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="position:sticky;top:0;background:#222;color:var(--plateado);text-align:left;"><th style="padding:6px;"></th><th>Código</th><th>Nombre</th><th>Ahora</th><th>Cambiar a</th><th>Tienda</th><th>Motivo</th></tr>` +
        _catDud.map((d, i) => `<tr style="border-top:1px solid #2a2a2c;opacity:${d.marcar ? 1 : .45};"><td style="padding:5px 6px;"><input type="checkbox" ${d.marcar ? "checked" : ""} onchange="_catDud[${i}].marcar=this.checked;catPintar()"></td>
            <td>${sanitizar(d.codigo)}</td><td>${sanitizar(d.nombre)}</td><td>${sanitizar(_catNombres[d.categoria] || d.categoria || "—")}</td>
            <td><select onchange="_catDud[${i}].elegida=this.value" style="padding:4px;font-size:12px;">${opts(d.elegida)}</select></td>
            <td>${d.publicado ? "✓ publicado" : "—"}</td><td style="color:var(--plateado);">${sanitizar(d.motivo)}</td></tr>`).join("") + "</table>"
        : '<p style="padding:16px;color:#4ade80;font-size:13px;">✅ No hay productos mal clasificados.</p>';
    document.getElementById("cat-btn-corregir").disabled = !_catDud.some(d => d.marcar);
    const bc = document.getElementById("cat-btn-codigo"); if (bc) bc.disabled = !_catDud.some(d => d.marcar);
}
// Cambia también el código (todas las tallas del diseño). El sistema SIEMPRE sugiere el código: el siguiente libre de la
// categoría correcta, revisando también los inactivos. Se muestra antes y se confirma; nunca pisa un código existente.
async function catCorregirCodigo() {
    const porDiseno = new Map();
    for (const d of _catDud.filter(x => x.marcar)) { const b = getCodigoBase(d.codigo).toUpperCase(); if (!porDiseno.has(b)) porDiseno.set(b, { codigo: d.codigo, categoria: d.elegida }); }
    const items = [...porDiseno.values()]; if (!items.length) return;
    const est = document.getElementById("cat-estado"); est.textContent = "Calculando códigos nuevos…";
    let sug = [];
    try { for (let i = 0; i < items.length; i += 40) { const r = await apiPost({ accion: "SUGERIR_CODIGOS", items: items.slice(i, i + 40) }); if (!r || !r.ok) throw new Error((r && r.error) || "no se pudo calcular"); sug.push(...r.sugerencias); } }
    catch (e) { est.textContent = "⚠️ " + (e.message || e); return; }
    // Material sin definir (letra X): se pregunta la letra y se recalcula
    const sinMat = sug.filter(x => x.ok && x.materialSinDefinir);
    if (sinMat.length) {
        const letras = {};
        for (const x of sinMat) {
            const l = (prompt(`El código ${x.codigoBase} no tiene material (letra X).\n\nEscribe la letra del material:\nP = Plata · O = Oro · L = Oro laminado · A = Acero · W = Reloj\n\n(Cancelar = no cambiar este diseño)`) || "").trim().toUpperCase();
            if (/^[POLAW]$/.test(l)) letras[x.codigoBase] = l;
        }
        const pend = items.map(it => ({ ...it, material: letras[getCodigoBase(it.codigo).toUpperCase()] }));
        try { sug = (await apiPost({ accion: "SUGERIR_CODIGOS", items: pend.slice(0, 40) })).sugerencias; } catch (e) { est.textContent = "⚠️ " + (e.message || e); return; }
        sug = sug.map(x => x.ok && x.materialSinDefinir ? { ok: false, codigo: x.codigoBase, error: "sin material: no se cambia" } : x);
        window._catMat = letras;
    } else window._catMat = {};
    const buenas = sug.filter(x => x.ok), malas = sug.filter(x => !x.ok);
    if (!buenas.length) { est.textContent = "⚠️ " + (malas[0] ? malas[0].codigo + ": " + malas[0].error : "nada que cambiar"); return; }
    const lista = buenas.map(x => `• ${x.codigoBase} → ${x.nuevoBase}  (${x.mapa.length} talla${x.mapa.length > 1 ? "s" : ""}, categoría ${_catNombres[x.categoria] || x.categoria})`).join("\n");
    if (!confirm(`Se cambiará el CÓDIGO de ${buenas.length} diseño(s) (todas sus tallas):\n\n${lista}\n\n• El código viejo queda inactivo y en cero.\n• Stock, foto y visibilidad pasan al nuevo.\n• Las consignaciones con vendedores pasan al nuevo.\n• Cada producto mostrará «CÓDIGO CORREGIDO» para que cambies la etiqueta física.\n\n¿Continuar?`)) { est.textContent = ""; return; }
    let hechos = 0; const fallos = [];
    try {
        for (let i = 0; i < buenas.length; i += 3) {
            est.textContent = `Cambiando códigos… ${Math.min(i + 3, buenas.length)}/${buenas.length}`;
            const lote = buenas.slice(i, i + 3).map(x => ({ codigo: x.mapa[0].viejo, categoria: x.categoria, material: (window._catMat || {})[x.codigoBase] }));
            const r = await apiPost({ accion: "CAMBIAR_CODIGOS", items: lote });
            if (!r || !r.ok) throw new Error((r && r.error) || "no se pudo cambiar");
            for (const x of r.resultados) { if (x.ok) hechos++; else fallos.push(`${x.codigo}: ${x.error}`); }
        }
    } catch (e) { fallos.push(e.message || String(e)); }
    toast(fallos.length ? `⚠️ ${hechos} cambiados · ${fallos.length} con problema` : `✅ ${hechos} códigos corregidos — cambia las etiquetas físicas`, fallos.length ? "#f97316" : "#22c55e", 8000);
    if (fallos.length) alert("No se pudo cambiar:\n\n" + fallos.join("\n"));
    try { await cargarStock(); } catch (_) {}
    await catCargar();
}
async function catCorregir() {
    const cambios = _catDud.filter(d => d.marcar).map(d => ({ codigo: d.codigo, categoria: d.elegida }));
    if (!cambios.length) return;
    if (!confirm(`Se cambiará la categoría de ${cambios.length} producto(s). No se toca el stock ni si están publicados.\n\n¿Continuar?`)) return;
    const est = document.getElementById("cat-estado"); est.textContent = "Corrigiendo…";
    try {
        const r = await apiPost({ accion: "CORREGIR_CATEGORIAS", cambios });
        if (!r || !r.ok) throw new Error((r && r.error) || "no se pudo corregir");
        for (const c of r.corregidos || []) { const it = stockData.find(p => p.codigo === c), n = cambios.find(x => x.codigo === c); if (it && n) it.categoria = n.categoria; }
        try { filtrarStock(); } catch (_) {}
        toast(`✅ ${r.corregidos.length} categorías corregidas`, "#22c55e", 5000);
    } catch (e) { toast("⚠️ " + (e.message || e), "#ef4444"); }
    await catCargar();
}

// Categorías administradas desde el «Editor de la página» del Hub (config.categorias): se agregan/renombran en el selector
async function cargarCategoriasSelect() {
    try {
        const r = await apiPost({ accion: "GET_CONFIG" }); const lista = r && r.config && r.config.categorias;
        const sel = document.getElementById("np-categoria"); if (!sel || !Array.isArray(lista)) return;
        const actual = sel.value;
        for (const c of lista) {
            if (!c || !/^[A-Z]{2}$/.test(String(c.codigo))) continue;
            let o = [...sel.options].find(x => x.value === c.codigo);
            if (!o) { o = document.createElement("option"); o.value = c.codigo; sel.appendChild(o); }
            o.textContent = c.es || c.codigo;
        }
        sel.value = actual;
    } catch (_) {}
}
function abrirModalProductoNuevo() {
    cargarCategoriasSelect();
    fotoBase64 = "";
    document.getElementById("preview-foto").style.display = "none";
    document.getElementById("foto-placeholder").style.display = "block";
    document.getElementById("btn-ia").style.display = "none";
    document.getElementById("estado-ia").style.display = "none";
    document.getElementById("np-codigo").value = "";
    document.getElementById("np-nombre").value = "";
    document.getElementById("np-desc").value = "";
    document.getElementById("np-precio").value = "";
    document.getElementById("np-qty").value = "1";
    document.getElementById("np-categoria").value = "";
    const npCaract = document.getElementById("np-caract"); if (npCaract) npCaract.value = "";
    document.getElementById("np-talla-container").style.display = "none";
    const tallaEsp = document.getElementById("np-talla-especial");
    if (tallaEsp) tallaEsp.value = "";
    window._tallasQtyIndividual = {};
    renderTallasIndividual();
    abrirModal("modal-prod-nuevo");
}

// ── CARGA DE IMAGEN ─────────────────────────────────
let _fotoOriginalBase64 = "";
let _fotoOriginalFile = null;
let _fotoCropCoords = null;
async function cargarFoto(input) {
    const file = input.files[0]; if (!file) return;
    _fotoOriginalFile = file;
    const r = await procesarFotoJoya(file);
    _fotoOriginalBase64 = r.original;
    _fotoCropCoords = r.crop;
    fotoBase64 = r.preview;
    document.getElementById("preview-foto").src = fotoBase64;
    document.getElementById("preview-foto").style.display = "block";
    document.getElementById("foto-placeholder").style.display = "none";
    document.getElementById("btn-ia").style.display = "flex";
    document.getElementById("material-single-container").style.display = "block";
}

async function analizarConIA() {
    if (!fotoBase64) return;
    const btn    = document.getElementById("btn-ia");
    const estado = document.getElementById("estado-ia");
    btn.textContent = "⏳ Analizando...";
    btn.disabled    = true;
    estado.style.display = "block";
    estado.textContent   = "Analizando imagen con IA...";
    try {
        const materialSeleccionado = window._materialProducto || null;
        const imagenIA = await comprimirParaIA(fotoBase64);
        const res  = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ accion: "ANALIZAR_IMAGEN", _pass: _sessionPass, imagen: imagenIA, material: materialSeleccionado })
        });
        const data = await res.json();
        if (!data.ok) {
            console.error("Error IA:", data.error);
            estado.textContent = String(data.error).includes("429")
                ? "⚠️ Sin créditos en OpenAI. Recarga tu cuenta."
                : "⚠️ Error: " + (data.error || "No se pudo analizar");
            estado.style.color = "#e74c3c";
            btn.textContent = "✨ Analizar con IA";
            btn.disabled    = false;
            return;
        }
        // Título — cada palabra con su primera letra en mayúscula (ej. "Anillo
        // Turquesa Chic"), no solo la primera letra del nombre completo.
        const _cap = s => s ? s.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";
        document.getElementById("np-nombre").value = _cap(data.resultado.nombre || "");
        document.getElementById("np-desc").value   = data.resultado.descripcion || "";
        // Auto-seleccionar categoría detectada por IA
        if (data.resultado.categoria) {
            const sel = document.getElementById("np-categoria");
            if (sel) {
                sel.value = data.resultado.categoria;
                mostrarSelectorTalla(data.resultado.categoria);
            }
        }
        estado.textContent = "✨ IA generó la descripción y detectó la categoría";
        estado.style.color = "var(--dorado)";
    } catch(e) {
        console.error(e);
        estado.textContent = "⚠️ No se pudo analizar la imagen";
        estado.style.color = "#e74c3c";
    }
    btn.textContent = "✨ Analizar con IA";
    btn.disabled    = false;
}

// Si el código manual ya termina en T+número (ej: SA18509JT7), lo usa tal cual
// sin agregar la talla de nuevo. Devuelve el código final.
function aplicarTalla(codigoBase, talla) {
    if (!talla) return codigoBase;
    // Detectar si ya tiene talla: termina en T seguido de uno o dos dígitos (con punto opcional: T7, T8, T7.5)
    if (/T\d+(\.\d+)?$/i.test(codigoBase)) return codigoBase;
    return `${codigoBase}T${talla}`;
}

// Y el nombre con talla, igual de inteligente
function aplicarTallaNombre(nombreBase, talla) {
    if (!talla) return nombreBase;
    if (/T\d+(\.\d+)?$/i.test(nombreBase)) return nombreBase;
    return `${nombreBase} T${talla}`;
}

function generarCodigo(categoria, material, usadosEnSesion = []) {
    const mat = String(material || _materialLote || "").toLowerCase();
    // Un solo carácter por material para códigos compactos (máx 10 chars total)
    const matChar = mat.includes("laminado")     ? "L"
                  : mat.includes("oro")          ? "O"
                  : mat.includes("acero")        ? "A"
                  : mat.includes("reloj")        ? "W"
                  : mat.includes("plata")        ? "P"
                  : "X";
    // Formato: [CAT2][MAT1][NNN3] = 6 chars base → con talla: ANA001T10 = 9 chars
    const prefijo = categoria + matChar;
    const todosLosCodigos = [
        ...(stockData || []).map(p => String(p.codigo || p.codigoBase || "")),
        ...usadosEnSesion
    ];
    let maxN = 0;
    todosLosCodigos.forEach(cod => {
        const upper = cod.toUpperCase();
        if (upper.startsWith(prefijo.toUpperCase())) {
            const resto = upper.slice(prefijo.length).replace(/T[\d.]+$/i, "");
            const n = parseInt(resto, 10);
            if (!isNaN(n) && n > maxN) maxN = n;
        }
    });
    return prefijo + String(maxN + 1).padStart(3, '0');
}

// Actualiza SOLO stockData en memoria (a diferencia de cargarStock(), que
// además redibuja toda la grilla y el spinner) — sirve para recalcular
// generarCodigo() contra el stock real justo antes de reintentar un guardado.
async function refrescarStockData() {
    try {
        const res = await apiPost({ accion: "STOCK_GET_ALL" });
        if (res && res.stock) stockData = res.stock;
    } catch (e) { /* si falla, se sigue con lo que ya había en memoria */ }
}

// Guarda un item con código auto-generado sin que una carrera con otro
// dispositivo pueda colarse: generarCodigo() calcula rápido en base al stock
// que YA está cargado en memoria, así que si alguien más registró algo con
// el mismo prefijo justo antes, el número calculado puede estar tomado. El
// servidor SIEMPRE valida contra el stock real al guardar y rechaza el
// duplicado en vez de sobreescribirlo en silencio — acá, en vez de mostrarle
// ese rechazo crudo al usuario, se refresca el stock real y se reintenta con
// el siguiente número libre, hasta 5 veces.
// `construirPayload(base)` arma el body de apiPost para un codigoBase dado.
async function guardarConCodigoUnico(categoria, material, codigoBaseInicial, construirPayload, intentosMax = 5) {
    let codigoBase = codigoBaseInicial;
    const probados = [];
    for (let intento = 1; intento <= intentosMax; intento++) {
        const res = await apiPost(construirPayload(codigoBase));
        if (res.ok || !/ya existe/i.test(res.error || "")) return { res, codigoBase };
        probados.push(codigoBase);
        await refrescarStockData();
        codigoBase = generarCodigo(categoria, material, probados);
    }
    return { res: { ok: false, error: "No se pudo generar un código único después de varios intentos — probá de nuevo" }, codigoBase };
}

// Recorta una región cuadrada {x,y,side} (coordenadas del original) hacia un
// canvas de salida de "size"×"size", con sharpen 3×3 — reutilizado tanto por
// la detección automática (procesarFotoJoya) como por el ajuste manual de
// encuadre (arrastrar/zoom para reposicionar cuando la detección falla).
function dibujarRecorte(img, crop, canvas, size) {
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
    // Kernel sharpen 3×3 (unsharp mask)
    const src = ctx.getImageData(0, 0, size, size);
    const dst = ctx.createImageData(size, size);
    const s = src.data, d = dst.data;
    const k = [0,-1,0,-1,5,-1,0,-1,0];
    for (let y = 1; y < size-1; y++) {
        for (let x = 1; x < size-1; x++) {
            const i = (y*size+x)*4;
            for (let c = 0; c < 3; c++) {
                let v = 0;
                for (let ky = -1; ky <= 1; ky++)
                    for (let kx = -1; kx <= 1; kx++)
                        v += s[((y+ky)*size+(x+kx))*4+c] * k[(ky+1)*3+(kx+1)];
                d[i+c] = Math.max(0, Math.min(255, v));
            }
            d[i+3] = s[i+3];
        }
    }
    ctx.putImageData(dst, 0, 0);
}

// Convierte un contenedor en un encuadre arrastrable: el usuario mueve la
// foto con el mouse/dedo para recentrar el recorte cuadrado, y usa la rueda
// del mouse para acercar/alejar — sin depender de que la detección
// automática de bordes haya acertado (con joyas delgadas/brillantes como
// cadenas finas, a veces no hay forma de acertar por contraste de brillo).
// getCrop/setCrop leen y escriben el {x,y,side} (coords del original) que
// use el llamador; onRedraw(canvas) se llama después de cada render para que
// el llamador pueda sincronizar su propio preview (ej. para el análisis IA).
function montarEncuadreArrastrable(contenedorId, imgObj, getCrop, setCrop, onRedraw) {
    const cont = document.getElementById(contenedorId);
    if (!cont || !imgObj) return;
    cont.style.position = "relative";
    cont.innerHTML = `
        <canvas style="width:100%;height:100%;display:block;cursor:grab;touch-action:none;"></canvas>
        <div style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:9px;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;">🖐️ Arrastrá para centrar · rueda para zoom</div>
    `;
    const canvas = cont.querySelector("canvas");
    const RENDER_SIZE = 700;
    const render = () => { dibujarRecorte(imgObj, getCrop(), canvas, RENDER_SIZE); if (onRedraw) onRedraw(canvas); };
    render();

    const clampCrop = (c) => {
        c.side = Math.max(20, Math.min(c.side, Math.min(imgObj.width, imgObj.height)));
        c.x = Math.max(0, Math.min(c.x, imgObj.width - c.side));
        c.y = Math.max(0, Math.min(c.y, imgObj.height - c.side));
        return c;
    };
    let dragging = false, lastX = 0, lastY = 0, rafPending = false;
    const scheduleRender = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; render(); });
    };
    canvas.addEventListener("pointerdown", e => {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        // El canvas se muestra a rect.width px representando crop.side px del
        // original — esa razón da cuánto original se mueve por cada pixel
        // arrastrado en pantalla.
        const crop = getCrop();
        const scale = crop.side / rect.width;
        const dxScreen = e.clientX - lastX, dyScreen = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        crop.x -= dxScreen * scale;
        crop.y -= dyScreen * scale;
        setCrop(clampCrop(crop));
        scheduleRender();
    });
    const endDrag = () => { dragging = false; canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", endDrag);
    // El canvas vive dentro de un <label for="sn-foto-input">: sin esto, cada
    // click que dispara el drag (al soltar el mouse) burbujea al label y
    // reabre el selector de archivos (que en Windows suele caer en Descargas).
    canvas.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const crop = getCrop();
        const cx = crop.x + crop.side / 2, cy = crop.y + crop.side / 2;
        const factor = e.deltaY > 0 ? 1.08 : 0.92; // rueda abajo = alejar (recorte más grande)
        crop.side *= factor;
        crop.x = cx - crop.side / 2; crop.y = cy - crop.side / 2;
        setCrop(clampCrop(crop));
        scheduleRender();
    }, { passive: false });
}

// ── PROCESAMIENTO DE FOTO COMPARTIDO ────────────────────────────────
// Calcula coordenadas de recorte + devuelve preview canvas y original
// El recorte real lo aplica ImageKit en su servidor (sin pérdida de calidad)
function procesarFotoJoya(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const original = e.target.result;
            const img = new Image();
            img.onload = () => {
                const w = img.width, h = img.height;
                const tmp = document.createElement("canvas");
                tmp.width = w; tmp.height = h;
                const ctx = tmp.getContext("2d");
                ctx.drawImage(img, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h).data;

                // Analizar a escala reducida (800px max) para evitar captar ruido de fondo
                const SCALE = Math.min(1, 800 / Math.max(w, h));
                const sw = Math.round(w * SCALE), sh = Math.round(h * SCALE);
                const stmp = document.createElement("canvas");
                stmp.width = sw; stmp.height = sh;
                const sctx = stmp.getContext("2d");
                sctx.drawImage(img, 0, 0, sw, sh);
                const sdata = sctx.getImageData(0, 0, sw, sh).data;

                // Luminancia perceptual: ignora tinte cálido del fondo y sombras difusas.
                // Detecta píxeles que se diferencian del fondo en CUALQUIER dirección
                // (más oscuros U más claros) — una cadena de plata fina brilla más
                // clara que el fondo en varios tramos; comparar solo "más oscuro"
                // los perdía y el recorte terminaba más chico que el objeto real,
                // cortando puntas de cadenas/collares delgados.
                // Detectar fondo: samplear bordes de la imagen (5% de margen)
                const bgMargin = Math.max(4, Math.floor(Math.min(sw, sh) * 0.05));
                let bgSum = 0, bgCount = 0;
                for (let y = 0; y < bgMargin; y++) {
                    for (let x = 0; x < sw; x++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                for (let y = sh-bgMargin; y < sh; y++) {
                    for (let x = 0; x < sw; x++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                for (let x = 0; x < bgMargin; x++) {
                    for (let y = bgMargin; y < sh-bgMargin; y++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                for (let x = sw-bgMargin; x < sw; x++) {
                    for (let y = bgMargin; y < sh-bgMargin; y++) {
                        const i = (y*sw+x)*4; bgSum += 0.299*sdata[i]+0.587*sdata[i+1]+0.114*sdata[i+2]; bgCount++;
                    }
                }
                const bgLum = bgSum / bgCount;
                const DIFF_MIN = 20; // píxel debe diferir ≥20 unidades del fondo (en cualquier dirección)
                const colCount = new Int32Array(sw);
                const rowCount = new Int32Array(sh);
                for (let y = 0; y < sh; y++) {
                    for (let x = 0; x < sw; x++) {
                        const i = (y * sw + x) * 4;
                        const lum = 0.299 * sdata[i] + 0.587 * sdata[i+1] + 0.114 * sdata[i+2];
                        if (Math.abs(bgLum - lum) >= DIFF_MIN) { colCount[x]++; rowCount[y]++; }
                    }
                }
                const minDensCol = Math.max(2, sh * 0.02);
                const minDensRow = Math.max(2, sw * 0.02);
                let minX = sw, maxX = 0, minY = sh, maxY = 0;
                for (let x = 0; x < sw; x++) if (colCount[x] >= minDensCol) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
                for (let y = 0; y < sh; y++) if (rowCount[y] >= minDensRow) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
                // Volver a coordenadas originales
                minX = Math.round(minX / SCALE); maxX = Math.round(maxX / SCALE);
                minY = Math.round(minY / SCALE); maxY = Math.round(maxY / SCALE);

                let crop = null;

                if (minX < maxX && minY < maxY) {
                    const objW = maxX - minX, objH = maxY - minY;
                    const largest = Math.max(objW, objH);
                    const pad   = Math.round(largest * 0.30); // 0.30 → objeto ocupa 62% del cuadrado
                    // Nunca superar el tamaño de imagen — sin bordes grises
                    const ideal = Math.min(largest + 2 * pad, Math.min(w, h));
                    const cx = Math.round((minX + maxX) / 2);
                    const cy = Math.round((minY + maxY) / 2);
                    // Centrar en (cx,cy) y clampear para que quede dentro de la imagen
                    const x1 = Math.max(0, Math.min(Math.round(cx - ideal / 2), w - ideal));
                    const y1 = Math.max(0, Math.min(Math.round(cy - ideal / 2), h - ideal));
                    console.log(`[ikCrop] bbox=${objW}×${objH} ideal=${ideal}px cx=${cx} cy=${cy} crop=(${x1},${y1}) ocup=${(largest/ideal*100).toFixed(0)}% fondo=${bgLum.toFixed(0)}`);
                    crop = { x: x1, y: y1, side: ideal };
                } else {
                    // Detección fallida — crop cuadrado centrado en la imagen
                    const side = Math.min(w, h);
                    crop = { x: Math.round((w - side) / 2), y: Math.round((h - side) / 2), side };
                    console.log(`[ikCrop] detección fallida — crop central ${side}px`);
                }

                // Preview 900×900 — alta calidad + sharpen por convolución
                const PV = 900;
                const out = document.createElement("canvas");
                const cropFinal = crop || { x: 0, y: 0, side: Math.min(w, h) };
                dibujarRecorte(img, cropFinal, out, PV);
                const preview = out.toDataURL("image/jpeg", 0.93);

                const uploadOriginal = original;

                resolve({ preview, original: uploadOriginal, crop });
            };
            img.onerror = () => resolve({ preview: original, original, crop: null });
            img.src = original;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Comprime a 800px máx para enviar a la IA (no altera la foto original)
function comprimirParaIA(base64) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const MAX = 800;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            c.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => resolve(base64);
        img.src = base64;
    });
}

// Agrega transformación ImageKit para mostrar cuadrada y centrada, con
// nitidez (e-sharpen) — las fotos se suben tal cual las manda el vendedor,
// sin ningún realce, así que esto es lo único que las afina para mostrarlas.
function ikFoto(url, size) {
    if (!url || !url.includes("imagekit.io")) return url;
    const s = size || 900;
    // Una foto YA mejorada (fotoMejorada) trae su propia nitidez elegida (e-sharpen-N). No se le suma otro e-sharpen:
    // apilar los dos es lo que la hacía verse exagerada y poco natural frente a la vista previa del panel.
    // Solo se ajusta el ancho (el 1600 con el que se guardó) al tamaño pedido.
    if (esUrlMejorada(url)) {
        // el w-1600 de la mejora es el ÚLTIMO w- (justo antes de e-sharpen-N / q-90); el w- del recorte no se toca
        const reW = /(^|,)w-1600(?=(,e-sharpen-\d+)?,q-90$)/;
        return reW.test(url) ? url.replace(reW, "$1w-" + s) : (url.includes("?tr=") ? `${url},w-${s}` : url);
    }
    const base = url.split("?")[0];
    const tr   = url.includes("?tr=") ? url.split("?tr=")[1] : null;
    // Tamaño explícito en el mismo transform (no encadenado)
    return tr ? `${base}?tr=${tr},w-${s},e-sharpen` : `${base}?tr=w-${s},e-sharpen`;
}

// Foto tal cual se subió (con su recorte), SIN ninguna nitidez — solo tamaño y la misma calidad que la vista previa
// mejorada, para que el "antes" del panel ✨ sea de verdad el antes.
function ikOriginalSinNitidez(url, size) {
    if (!url || !url.includes("imagekit.io")) return url;
    const base = url.split("?")[0];
    // Se conserva TODO el recorte original (cm-extract,x,y,w,h…); solo se quita cualquier e-sharpen.
    const previo = url.includes("?tr=") ? url.split("?tr=")[1].split(",").filter(x => !x.startsWith("e-sharpen")).join(",") : "";
    return `${base}?tr=${previo ? previo + "," : ""}w-${size || 700},q-90`;
}

// ── MEJORAR IMAGEN (nitidez vía ImageKit) ──────────────────────────
// Solo transformaciones de nitidez (sharpen), nunca color/contraste/brillo
// ni IA generativa — la pieza debe verse exactamente igual, solo más nítida.
// Es una transformación por URL de ImageKit (mismo servicio ya en uso, sin
// nueva integración ni archivo adicional).
// Antes: natural=e-sharpen-3, mejorado=e-sharpen-8 — el nivel "mejorado" se
// veía muy artificial (halos duros de unsharp mask, agravados por no fijar
// calidad de salida). Se baja la intensidad de ambos y se sube la calidad,
// para que se note más nítido sin el look "sobre-procesado".
// suave = sin nitidez (solo recorte, tamaño y calidad 90); natural 1; intermedio 2; mejorado 3.
// q-90 es la marca que identifica una foto "mejorada" (las originales no la llevan): así ikFoto sabe que NO debe
// sumarle la nitidez automática, tampoco al nivel Suave, que no lleva e-sharpen.
const NIVELES_MEJORA_IMG_STOCK = { suave: "q-90", natural: "e-sharpen-1,q-90", intermedio: "e-sharpen-2,q-90", mejorado: "e-sharpen-3,q-90" };
const NIVELES_MEJORA_ORDEN = ["suave", "natural", "intermedio", "mejorado"];
function esUrlMejorada(url) { const u = String(url || ""); return /e-sharpen/.test(u) || /,q-90(?=,|$)/.test(u); }
// Valor numérico de nitidez de un nivel ("e-sharpen-3" -> 3) o de una dirección ImageKit guardada.
function nitidezDeNivel(nivel) { const m = /e-sharpen-(\d+)/.exec((NIVELES_MEJORA_IMG_STOCK[nivel] || "")); return m ? +m[1] : 0; }
function nitidezDeUrl(url) { const m = /e-sharpen-(\d+)/.exec(String(url || "")); return m ? +m[1] : (/e-sharpen/.test(String(url || "")) ? "automática" : 0); }
function ikMejorar(url, nivel, size) {
    if (!url || !url.includes("imagekit.io")) return url;
    const s = size || 900;
    const base = url.split("?")[0];
    const tr = NIVELES_MEJORA_IMG_STOCK[nivel] || NIVELES_MEJORA_IMG_STOCK.natural;
    // Conserva el recorte con el que se subió la foto (?tr=cm-extract,…) — igual que ikFoto. Antes se descartaba y la
    // versión mejorada mostraba la foto completa sin recortar: la pieza se veía pequeña y "lejana".
    const previo = url.includes("?tr=") ? url.split("?tr=")[1] : null;
    return previo ? `${base}?tr=${previo},w-${s},${tr}` : `${base}?tr=w-${s},${tr}`;
}

// Textos del panel en ES/EN — autocontenido, no depende de ningún sistema
// de idioma del resto de Stock (que es solo en español).
const MEJORA_STOCK_I18N = {
    es: {
        titulo: "✨ Mejorar imagen", original: "Original", preview: "Vista previa mejorada",
        nivel: "Nivel", suave: "Suave", natural: "Natural", intermedio: "Intermedio", mejorado: "Mejorado",
        cancelar: "Cancelar", aplicar: "Aplicar mejora", aplicando: "Aplicando...",
        toggleIdioma: "EN", okMsg: "✨ Mejora aplicada — el original se conserva intacto",
        errMsg: "⚠️ No se pudo aplicar la mejora"
    },
    en: {
        titulo: "✨ Enhance image", original: "Original", preview: "Enhanced preview",
        nivel: "Level", suave: "Soft", natural: "Natural", intermedio: "Medium", mejorado: "Enhanced",
        cancelar: "Cancel", aplicar: "Apply enhancement", aplicando: "Applying...",
        toggleIdioma: "ES", okMsg: "✨ Enhancement applied — the original is kept untouched",
        errMsg: "⚠️ Could not apply the enhancement"
    }
};
let _mjsIdioma = "es";
let _mjsNivel  = "natural";
let _mjsItem   = null;

function renderTextosMejoraStock() {
    const L = MEJORA_STOCK_I18N[_mjsIdioma];
    document.getElementById("mjs-titulo").textContent         = L.titulo;
    document.getElementById("mjs-label-original").textContent = L.original;
    document.getElementById("mjs-label-preview").textContent  = L.preview;
    document.getElementById("mjs-label-nivel").textContent    = L.nivel;
    const sh = (n) => (_mjsIdioma === "en" ? "sharpen " : "nitidez ") + nitidezDeNivel(n);
    NIVELES_MEJORA_ORDEN.forEach(n => { document.getElementById("mjs-btn-" + n).textContent = L[n] + " · " + sh(n); });
    document.getElementById("mjs-btn-cancelar").textContent   = L.cancelar;
    document.getElementById("mjs-btn-aplicar").textContent    = L.aplicar;
    document.getElementById("mjs-btn-idioma").textContent     = L.toggleIdioma;
}

function toggleIdiomaMejoraStock() {
    _mjsIdioma = _mjsIdioma === "es" ? "en" : "es";
    renderTextosMejoraStock();
}

// Se abre desde la vista de un producto de Stock (modal-ver-producto), que
// ya dejó el item actual en productoEditando.p al llamar abrirEditarStockItem.
function abrirMejorarFotoStock() {
    const item = productoEditando?.p;
    const foto = item?.foto || item?.img || "";
    if (!foto) { toast("⚠️ Este producto no tiene foto", "#f97316"); return; }
    _mjsItem  = item;
    _mjsNivel = "natural"; // Natural es siempre el nivel predeterminado
    document.getElementById("mjs-nombre").textContent = `${item.nombre || "—"} · ${item.codigo || "—"}`;
    const gd = document.getElementById("mjs-guardada");
    if (gd) {
        if (item.fotoMejorada) {
            const nit = nitidezDeUrl(item.fotoMejorada);
            gd.textContent = "Mejora guardada: nivel " + (item.fotoMejoraNivel || "?") + " · nitidez " + nit
                + (nit === 0 ? (item.fotoMejoraNivel === "suave" ? " (sin nitidez)" : " (¡la dirección guardada NO trae nitidez!)") : "");
            gd.title = item.fotoMejorada;
        } else {
            gd.textContent = "Sin mejora guardada (se muestra la foto original con la nitidez automática)";
            gd.title = "";
        }
    }
    document.getElementById("mjs-img-original").src   = ikOriginalSinNitidez(foto, 700);
    renderTextosMejoraStock();
    actualizarNivelMejoraStock();
    abrirModal("modal-mejorar-foto-stock");
}

function cerrarMejorarFotoStock() {
    cerrarModal("modal-mejorar-foto-stock");
    _mjsItem = null;
}

function setNivelMejoraStock(nivel) {
    _mjsNivel = nivel;
    actualizarNivelMejoraStock();
}

function actualizarNivelMejoraStock() {
    if (!_mjsItem) return;
    const foto = _mjsItem.foto || _mjsItem.img || "";
    document.getElementById("mjs-img-preview").src = ikMejorar(foto, _mjsNivel, 700);
    NIVELES_MEJORA_ORDEN.forEach(n => {
        const btn = document.getElementById("mjs-btn-" + n), act = _mjsNivel === n;
        btn.className = act ? "btn" : "btn btn-gris";
        btn.style.background = act ? "var(--dorado)" : "";
        btn.style.color = act ? "#111" : "";
    });
}

async function aplicarMejoraFotoStock() {
    if (!_mjsItem) return;
    const foto = _mjsItem.foto || _mjsItem.img || "";
    const L = MEJORA_STOCK_I18N[_mjsIdioma];
    const btn = document.getElementById("mjs-btn-aplicar");
    btn.textContent = L.aplicando; btn.disabled = true;
    try {
        const data = await apiPost({
            accion: "EDITAR_PRODUCTO",
            codigo: _mjsItem.codigo,
            fotoMejorada: ikMejorar(foto, _mjsNivel, 1600),
            fotoMejoraNivel: _mjsNivel
        });
        if (data.ok) {
            // Aplicación inmediata: se actualiza el dato local y todo lo que está en pantalla, sin recargar la página.
            const nuevaFoto = ikMejorar(foto, _mjsNivel, 1600);
            const codigo = _mjsItem.codigo;
            const enStock = stockData.find(p => p.codigo === codigo);
            if (enStock) { enStock.fotoMejorada = nuevaFoto; enStock.fotoMejoraNivel = _mjsNivel; }
            if (productoEditando && productoEditando.p && productoEditando.p.codigo === codigo) {
                productoEditando.p.fotoMejorada = nuevaFoto; productoEditando.p.fotoMejoraNivel = _mjsNivel;
            }
            const fotoModal = document.getElementById("modal-prod-foto");
            if (fotoModal) { fotoModal.src = ikFoto(nuevaFoto, 900); fotoModal.style.display = "block"; }
            try { filtrarStock(); } catch (_) { renderStock(stockData); }   // lista/grid con la foto mejorada ya puesta
            toast(L.okMsg, "#22c55e");
            cerrarMejorarFotoStock();
        } else {
            toast(L.errMsg, "#ef4444");
        }
    } catch (e) {
        toast(L.errMsg, "#ef4444");
    } finally {
        btn.textContent = L.aplicar; btn.disabled = false;
    }
}

// Fotos muy grandes (Upscayl 4× da PNG de 30–50 MB y 4000+ px) hacían fallar la subida: el Worker se quedaba sin memoria y el
// navegador lo mostraba como «bloqueado por CORS / Failed to fetch». Se reducen a 2600 px máx. en JPEG antes de enviar
// (ImageKit la sirve a 800–1600 px) y el recorte se reescala igual. Fotos normales pasan sin tocar.
const SUBIDA_MAX_PX = 2600, SUBIDA_MAX_B64 = 6_000_000;
function reducirParaSubida(base64) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, mayor = Math.max(w, h);
            if (mayor <= SUBIDA_MAX_PX && base64.length <= SUBIDA_MAX_B64) return resolve({ base64, k: 1 });
            const k = Math.min(1, SUBIDA_MAX_PX / mayor), cw = Math.round(w * k), ch = Math.round(h * k);
            const c = document.createElement("canvas"); c.width = cw; c.height = ch;
            const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
            ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, cw, ch);
            resolve({ base64: c.toDataURL("image/jpeg", 0.92), k: cw / w, w: cw, h: ch });
        };
        img.onerror = () => resolve({ base64, k: 1 });
        img.src = base64;
    });
}
async function subirFotoImageKit(fileOrBase64, nombre, crop) {
    try {
        // Convertir File a base64 si es necesario
        let base64;
        if (fileOrBase64 instanceof File) {
            base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(fileOrBase64);
            });
        } else {
            base64 = fileOrBase64;
        }
        const red = await reducirParaSubida(base64); base64 = red.base64;
        if (crop && red.k !== 1) {   // mismo recorte en la imagen reducida (sin salirse de ella por redondeo)
            const side = Math.max(1, Math.floor(crop.side * red.k));
            crop = { x: Math.max(0, Math.min(Math.floor(crop.x * red.k), red.w - side)), y: Math.max(0, Math.min(Math.floor(crop.y * red.k), red.h - side)), side };
        }

        // Subir a través del worker (usa clave privada server-side — más confiable)
        const res  = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ accion: "SUBIR_FOTO", _pass: _sessionPass, imagen: base64, nombre: nombre || ("foto_" + Date.now()) })
        });
        const data = await res.json();
        if (data.ok && data.url) {
            const base = data.url.split("?")[0];
            if (crop) {
                const { x, y, side } = crop;
                return `${base}?tr=cm-extract,x-${Math.round(x)},y-${Math.round(y)},w-${Math.round(side)},h-${Math.round(side)},q-99`;
            }
            return base;
        }
        console.warn("[ikUpload] worker error:", data?.error);
        return null;
    } catch(e) { console.error("[ikUpload] excepcion:", e); return null; }
}

// ── IMÁGENES INFORMATIVAS ────────────────────────────────────────────
// Imágenes que no son de producto (guías de talla, cuidados, promociones)
// alojadas igual que las fotos de Stock (ImageKit vía SUBIR_FOTO), pero
// separadas del inventario — solo para compartir el link con clientes.
let _imagenesInfoCache = null;

async function cargarImagenesInformativas() {
    try {
        const res = await apiPost({ accion: "GET_IMAGENES_INFO" });
        _imagenesInfoCache = res.imagenes || [];
    } catch(e) { _imagenesInfoCache = _imagenesInfoCache || []; }
    renderImagenesInformativas();
}

function renderImagenesInformativas() {
    const cont = document.getElementById("imginfo-lista");
    if (!cont) return;
    const lista = _imagenesInfoCache || [];
    if (!lista.length) {
        cont.innerHTML = '<p style="font-size:12px;color:var(--plateado);">Todavía no has subido ninguna imagen informativa.</p>';
        return;
    }
    cont.innerHTML = lista.slice().reverse().map(img => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--borde);">
            <img src="${img.url}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--gris2);" onerror="this.style.display='none'">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(img.etiqueta || "Sin nombre")}</div>
                <div style="font-size:10px;color:var(--plateado);">${img.fecha ? new Date(img.fecha).toLocaleDateString("es-SV",{day:"2-digit",month:"short",year:"numeric"}) : ""}</div>
            </div>
            <button onclick="compartirImagenInfo('${img.url}','${sanitizar(img.etiqueta||"")}')" style="padding:6px 10px;font-size:11px;background:#25D366;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">📱 Compartir</button>
            <button onclick="copiarLinkImagenInfo('${img.url}')" style="padding:6px 8px;font-size:11px;background:#2a2a2a;color:#fff;border:none;border-radius:6px;cursor:pointer;">📋</button>
            <button onclick="eliminarImagenInfo('${sanitizar(img.id)}')" style="padding:6px 8px;font-size:11px;background:#3a1a1a;color:#e74c3c;border:none;border-radius:6px;cursor:pointer;">🗑️</button>
        </div>`).join("");
}

async function subirImagenInformativa(file) {
    if (!file) return;
    const etiqueta = (document.getElementById("imginfo-etiqueta")?.value || "").trim() || file.name.replace(/\.[^.]+$/, "");
    toast("⏳ Subiendo imagen...");
    const url = await subirFotoImageKit(file, "info_" + Date.now());
    if (!url) { toast("⚠️ No se pudo subir la imagen", "#ef4444"); return; }
    const res = await apiPost({ accion: "GUARDAR_IMAGEN_INFO", etiqueta, url });
    if (!res.ok) { toast("⚠️ No se pudo guardar", "#ef4444"); return; }
    document.getElementById("imginfo-etiqueta").value = "";
    document.getElementById("imginfo-file").value = "";
    toast("✅ Imagen subida");
    cargarImagenesInformativas();
}

function compartirImagenInfo(url, etiqueta) {
    const msg = `${etiqueta ? etiqueta + "\n\n" : ""}${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
}

function copiarLinkImagenInfo(url) {
    navigator.clipboard.writeText(url);
    toast("✅ Link copiado");
}

async function eliminarImagenInfo(id) {
    if (!confirm("¿Eliminar esta imagen informativa?")) return;
    const res = await apiPost({ accion: "ELIMINAR_IMAGEN_INFO", id });
    if (!res.ok) { toast("⚠️ No se pudo eliminar", "#ef4444"); return; }
    toast("🗑️ Imagen eliminada");
    cargarImagenesInformativas();
}

// Compara dos nombres de producto ignorando mayúsculas/tildes/signos, y los
// considera "parecidos" si comparten casi todas las palabras relevantes
// (>2 letras) — detecta tanto el nombre idéntico como variaciones menores
// de tipeo, sin marcar como duplicado a dos diseños que solo comparten
// una palabra genérica ("Anillo", "Pulsera", etc.).
function _nombresSimilares(a, b) {
    const norm = s => String(s || "").toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9\s]/g, "").trim();
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const wa = new Set(na.split(/\s+/).filter(w => w.length > 2));
    const wb = new Set(nb.split(/\s+/).filter(w => w.length > 2));
    if (!wa.size || !wb.size) return false;
    let comunes = 0;
    wa.forEach(w => { if (wb.has(w)) comunes++; });
    return comunes / Math.min(wa.size, wb.size) >= 0.75;
}

async function agregarProductoNuevo() {
    const categoria = document.getElementById("np-categoria").value;
    const nombre    = document.getElementById("np-nombre").value.trim();
    const precio    = parseFloat(document.getElementById("np-precio").value) || 0;
    const descripcion = document.getElementById("np-desc").value.trim();
    const caracterEspecial = (document.getElementById("np-caract")?.value || "").trim();
    if (!categoria || !nombre || !precio) { toast("⚠️ Completa categoría, nombre y precio"); return; }

    const esAnillo = (categoria === "AN" || categoria === "CJ");
    const tallasQty = window._tallasQtyIndividual || {};
    const tieneTallas = Object.keys(tallasQty).length > 0;

    if (esAnillo && !tieneTallas) { toast("⚠️ Selecciona al menos una talla"); return; }

    const btn = document.querySelector("#modal-prod-nuevo .btn-dorado");
    btn.textContent = "⏳ Guardando...";
    btn.disabled = true;

    // Obtener código base
    let codigoBase = document.getElementById("np-codigo").value.trim().toUpperCase();
    if (!codigoBase) {
        codigoBase = generarCodigo(categoria, window._materialProducto);
    }

    // Construir variantes: una por talla si es anillo, o una sola si no
    let variantes;
    if (esAnillo && tieneTallas) {
        variantes = Object.entries(tallasQty)
            .map(([t, qty]) => ({ talla: Number(t), cantidad: Math.max(1, parseInt(qty) || 1) }))
            .sort((a, b) => a.talla - b.talla);
    } else {
        const qty = parseInt(document.getElementById("np-qty").value) || 1;
        variantes = [{ talla: null, cantidad: qty }];
    }

    // ── Validar duplicados antes de subir foto ────────────────────────────
    const codigosDuplicados = variantes
        .map(({ talla }) => aplicarTalla(codigoBase, talla))
        .filter(cod => stockData.find(s => String(s.codigo).toUpperCase() === cod.toUpperCase()));
    if (codigosDuplicados.length) {
        btn.textContent = "Agregar a Entrega"; btn.disabled = false;
        const existente = stockData.find(s => String(s.codigo).toUpperCase() === codigosDuplicados[0].toUpperCase());
        toast(`⚠️ Código ${codigosDuplicados[0]} ya existe — "${existente ? existente.nombre : ""}"`);
        return;
    }

    // ── Aviso de posible duplicado por NOMBRE (código distinto) ──────────
    // El caso real que motivó esto: la misma pieza ("Anillo Blue Baguette")
    // se registró dos veces con códigos base distintos (ANP032 y ANL002)
    // porque no se recordaba que ya existía — el chequeo de arriba no lo
    // detecta porque el código sí es nuevo. No bloquea (a veces dos diseños
    // distintos comparten nombre a propósito), solo frena a confirmar.
    const similar = (stockData || []).find(s =>
        (s.codigoBase || s.codigo) !== codigoBase &&
        s.estado !== "inactivo" &&
        _nombresSimilares(s.nombre_base || s.nombre, nombre)
    );
    if (similar) {
        const seguir = confirm(
            `⚠️ Ya existe un producto con nombre parecido:\n\n` +
            `${similar.codigoBase || similar.codigo} — ${similar.nombre_base || similar.nombre}\n\n` +
            `Si es la MISMA pieza, cancela y usa "✏️ Editar → agregar talla" en ese producto en vez de crear uno nuevo — así no queda duplicado.\n\n` +
            `¿Seguro que querés crear un producto nuevo de todas formas?`
        );
        if (!seguir) { btn.textContent = "Agregar a Entrega"; btn.disabled = false; return; }
    }

    // Subir foto una sola vez con el código base (siempre la original sin procesar)
    let fotoUrl = fotoBase64;
    const _fotoParaSubir = _fotoOriginalFile || _fotoOriginalBase64 || fotoBase64;
    if (_fotoParaSubir) {
        const url = await subirFotoImageKit(_fotoParaSubir, codigoBase, _fotoCropCoords);
        if (url) fotoUrl = url;
    }

    for (const { talla, cantidad } of variantes) {
        const codigo         = aplicarTalla(codigoBase, talla);
        const nombreConTalla = aplicarTallaNombre(nombre, talla);
        const tallaReal      = talla && codigo === codigoBase ? "" : (talla ? String(talla) : "");

        const prod = {
            id: codigo + "_" + Date.now(), codigo, codigoBase,
            talla: tallaReal,
            nombre: nombreConTalla, nombre_base: nombre,
            descripcion: descripcion + (tallaReal ? ` T${tallaReal}` : ""),
            precio, precioNum: precio, img: fotoUrl, esNuevo: true,
            caracterEspecial: caracterEspecial || undefined
        };

        const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
        const idxEx = extras.findIndex(x => x.codigo === codigo);
        const prodStorage = { ...prod, _fotoBase64: undefined };
        if (idxEx >= 0) extras[idxEx] = prodStorage; else extras.push(prodStorage);
        localStorage.setItem("vx_prod_extras", JSON.stringify(extras));

        mapaProductos[codigo]  = prod;
        carritoEntrega[codigo] = { item: prod, qty: cantidad };
    }

    btn.textContent = "Agregar a Entrega";
    btn.disabled = false;
    cerrarModal("modal-prod-nuevo");
    renderGridEntrega(productosDisponibles);
    actualizarCarritoEntrega();
    const total = variantes.reduce((s, v) => s + v.cantidad, 0);
    toast(`✅ ${variantes.length > 1 ? variantes.length + " tallas agregadas (" + total + " piezas)" : "Producto agregado"}`);
}

// ── FOTOS DESDE CELULAR ──────────────────────────────────────────────
const UPLOAD_URL = "https://verex-nexus.pages.dev/upload";

// ── FOTO CELULAR SYNC — sesión persistente ───────────────────────────
// La sesión vive mientras la página esté abierta.
// Si llega una foto con el modal cerrado, se guarda en _fotoCelPendiente
// y se carga automáticamente al abrir el siguiente producto.
let _fotoCelSession   = null;
let _fotoCelInterval  = null;
let _fotoCelPendiente = null;
let _fotoCelLastTs    = Date.now();
let _fotoCelLastUrl   = null; // evita procesar la misma foto dos veces

const _sbRealtime = window.supabase.createClient(
    'https://jimliwzodtglocdcwgil.supabase.co',
    'sb_publishable_PGoQtcuRuXt24bVVgG4m6w_4heJYulo'
);

function iniciarSesionFotoCel() {
    if (_fotoCelSession) return;
    _fotoCelSession = "VEREX-STORE";

    // Realtime WebSocket — recibe al instante cuando el worker guarda la URL
    _sbRealtime.channel('foto-cel')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'config',
            filter: 'id=eq.foto_temp_VEREX-STORE'
        }, (payload) => {
            const rec = payload.new;
            if (!rec || !rec.data) return;
            const url = rec.data?.url;
            if (!url) return;
            // Borrar la entrada para que el polling no la procese de nuevo
            fetch(`https://verex-api.verexstore.workers.dev/foto-check?s=${_fotoCelSession}`).catch(()=>{});
            _aplicarFotoCelular(url);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') console.log('[fotoCel] Realtime conectado ✅');
        });

    // Polling de respaldo cada 5s por si el Realtime falla
    _fotoCelInterval = setInterval(_pollFotoCel, 5000);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") _pollFotoCel();
    });
}

function abrirFotoCelularSN() {
    iniciarSesionFotoCel();
    const url = `https://verex-api.verexstore.workers.dev/foto-upload?s=${_fotoCelSession}`;
    document.getElementById("sn-qr-img").src =
        `https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=111111&bgcolor=ffffff&data=${encodeURIComponent(url)}`;
    document.getElementById("sn-foto-celular-panel").style.display = "block";
    document.getElementById("sn-foto-cel-status").textContent = "⏳ Esperando foto desde el celular...";
}

function cerrarFotoCelularSN() {
    // Solo oculta el panel — la sesión y el polling SIGUEN activos
    document.getElementById("sn-foto-celular-panel").style.display = "none";
}

async function _pollFotoCel() {
    if (!_fotoCelSession) return;
    try {
        const res  = await fetch(`https://verex-api.verexstore.workers.dev/foto-check?s=${_fotoCelSession}`);
        const data = await res.json();
        if (!data.pending || !data.url) return;
        _aplicarFotoCelular(data.url);
    } catch(e) {
        console.error("[fotoCel]", e);
    }
}

// Recibe foto del celular y la aplica en el modal
function _aplicarFotoCelular(url) {
    if (!url || url === _fotoCelLastUrl) return; // ignorar duplicados
    _fotoCelLastUrl = url;
    const modalAbierto = document.getElementById("modal-stock-nuevo")?.classList.contains("active");
    if (modalAbierto) {
        _cargarUrlFotoEnModal(url);
    } else {
        _fotoCelPendiente = { url };
        toast("📱 Foto lista — se carga al abrir el siguiente producto");
    }
}

async function _cargarUrlFotoEnModal(url) {
    const urlActiva = url; // capturar para detectar si cambió mientras procesamos
    const prev = document.getElementById("sn-foto-preview");
    if (prev) prev.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain;">`;
    const panel = document.getElementById("sn-foto-celular-panel");
    if (panel) panel.style.display = "none";
    window._snFotoUrl = url;
    toast("📱 Foto cargada desde celular ✅");

    try {
        let blob;
        if (url.startsWith("data:")) {
            const res = await fetch(url); blob = await res.blob();
        } else {
            blob = await (await fetch(url)).blob();
        }
        const file = new File([blob], "foto_celular.jpg", { type: "image/jpeg" });
        const r = await procesarFotoJoya(file);
        // Si la foto activa cambió mientras procesábamos, descartar resultado
        if (_fotoCelLastUrl !== urlActiva) return;
        _snFotoOriginalFile = file;
        window._snFotoUrl   = null;
        // Antes esto pisaba el preview con un <img> plano sin encuadre
        // arrastrable — el ajuste manual solo existía para fotos elegidas
        // desde archivo, no para las recibidas por celular.
        mostrarFotoStockConEncuadre(r);
    } catch(e) {
        console.error("[fotoCel procesarJoya]", e);
    }
}

function _aplicarFotoEnModal(payload) {
    _snFotoOriginalFile   = payload.file;
    _snFotoBase64         = payload.preview;
    _snFotoOriginalBase64 = payload.original;
    _snFotoCropCoords     = payload.crop;
    window._snFotoUrl     = null;
    const prev = document.getElementById("sn-foto-preview");
    if (prev) prev.innerHTML = `<img src="${payload.preview}" style="width:100%;height:100%;object-fit:contain;">`;
    const btnIA = document.getElementById("sn-btn-ia");
    if (btnIA) btnIA.style.display = "flex";
    const panel = document.getElementById("sn-foto-celular-panel");
    if (panel) panel.style.display = "none";
    toast("📱 Foto cargada desde celular ✅");
}

// Botón manual: verificar si hay foto esperando en el servidor
async function verificarFotoCelularManual() {
    if (!_fotoCelSession) { toast("⚠️ Aún no hay sesión activa — toca 'Desde celular' primero"); return; }
    const btn = document.getElementById("sn-btn-verificar-foto");
    if (btn) { btn.textContent = "⏳ Buscando..."; btn.disabled = true; }
    try {
        const res  = await fetch(`https://verex-api.verexstore.workers.dev/foto-check?s=${_fotoCelSession}`);
        const data = await res.json();
        if (data.pending && data.url) {
            _aplicarFotoCelular(data.url);
        } else {
            toast(`📭 Sin foto nueva — sesión: ${_fotoCelSession}`);
        }
    } catch(e) {
        toast("⚠️ Error de conexión al verificar foto");
    } finally {
        if (btn) { btn.textContent = "🔄 Verificar foto"; btn.disabled = false; }
    }
}

// Llamar al abrir el modal de stock nuevo para cargar foto pendiente
function cargarFotoCelPendienteSN() {
    if (!_fotoCelPendiente) return;
    const { url } = _fotoCelPendiente;
    _fotoCelPendiente = null;
    setTimeout(() => { _cargarUrlFotoEnModal(url); }, 200);
}

function abrirModalFotosCelular() {
    // Generar QR con la URL de la página de carga
    const qrImg = document.getElementById("qr-celular");
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&color=111111&bgcolor=ffffff&data=${encodeURIComponent(UPLOAD_URL)}`;
    document.getElementById("fotos-pendientes-grid").innerHTML = "";
    document.getElementById("fotos-pendientes-msg").style.display = "none";
    abrirModal("modal-fotos-celular");
    // Cargar fotos existentes al abrir
    cargarFotosPendientes();
}

let _todasFotosPendientes = [];
let _colaFotosStock = []; // fotos que faltan por usar en la cola de "Nuevo Producto" seguido

async function cargarFotosPendientes() {
    const grid = document.getElementById("fotos-pendientes-grid");
    const msg  = document.getElementById("fotos-pendientes-msg");
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--plateado);font-size:13px;padding:16px;">⏳ Cargando...</div>';
    msg.style.display = "none";
    try {
        const res  = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "GET_FOTOS_PENDIENTES", _pass: _sessionPass }) });
        const data = await res.json();
        _todasFotosPendientes = data.fotos || [];
        if (!data.ok || !data.fotos.length) {
            grid.innerHTML = "";
            msg.style.display = "block";
            return;
        }
        grid.innerHTML = data.fotos.map(f => `
            <div style="position:relative;" title="Usar esta foto">
                <img src="${f.url}" onclick="usarFotoCelular('${f.id}','${f.url}')"
                     style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:2px solid transparent;transition:border-color .2s;cursor:pointer;"
                     onmouseover="this.style.borderColor='var(--dorado)'" onmouseout="this.style.borderColor='transparent'">
                <div style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.6);border-radius:4px;padding:2px 5px;font-size:9px;color:#fff;">
                    ${new Date(f.fecha).toLocaleDateString("es-SV",{day:"2-digit",month:"2-digit"})}
                </div>
                <button onclick="eliminarFotoPendiente('${f.id}',this)" title="Eliminar foto"
                    style="position:absolute;top:3px;right:3px;background:rgba(192,57,43,0.85);border:none;color:#fff;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button>
            </div>`).join("");
    } catch(e) {
        grid.innerHTML = "";
        msg.textContent = "❌ Error al cargar fotos";
        msg.style.display = "block";
    }
}

async function eliminarFotoPendiente(id, btn) {
    btn.disabled = true;
    try {
        await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "MARCAR_FOTO_USADA", _pass: _sessionPass, id }) });
        btn.closest("div[style]").remove();
        const grid = document.getElementById("fotos-pendientes-grid");
        if (!grid.children.length) {
            document.getElementById("fotos-pendientes-msg").style.display = "block";
        }
    } catch(e) { btn.disabled = false; toast("❌ Error al eliminar"); }
}

async function usarFotoCelular(id, url) {
    fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "MARCAR_FOTO_USADA", _pass: _sessionPass, id }) }).catch(()=>{});
    cerrarModal("modal-fotos-celular");

    // Detectar qué sección está activa: Stock o Entrega
    const secStock = document.getElementById("tab-content-stock");
    const enStock  = secStock && secStock.style.display !== "none";

    // En Stock: arma la cola con el resto de fotos pendientes, para poder
    // seguir de una foto a la siguiente sin volver a abrir este modal cada vez.
    if (enStock) {
        _colaFotosStock = _todasFotosPendientes.filter(f => f.id !== id);
    } else {
        _colaFotosStock = [];
    }

    await cargarFotoEnFormularioStockOEntrega(url, enStock);
}

// Procesa una foto (descarga + recorte IA) y la carga en el formulario
// correspondiente — usado tanto al elegir una foto de la galería como al
// avanzar automáticamente a la siguiente de la cola tras guardar un producto.
async function cargarFotoEnFormularioStockOEntrega(url, enStock) {
    toast("⏳ Procesando foto...");
    let r = null;
    try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const file = new File([blob], "foto_celular.jpg", { type: blob.type || "image/jpeg" });
        r = await procesarFotoJoya(file);
        r._file = file;
    } catch(e) {
        toast("❌ Error al procesar foto"); return;
    }

    if (enStock) {
        abrirStockNuevoProd();
        window._snFotoUrl = null;
        setTimeout(() => mostrarFotoStockConEncuadre(r), 150);
    } else {
        _fotoOriginalFile   = r._file;
        _fotoOriginalBase64 = r.original;
        _fotoCropCoords     = r.crop;
        fotoBase64          = r.preview;
        const preview = document.getElementById("preview-foto");
        if (preview) {
            preview.src = r.preview;
            preview.style.display = "block";
            document.getElementById("foto-placeholder").style.display = "none";
            document.getElementById("btn-ia").style.display = "flex";
            document.getElementById("material-single-container").style.display = "block";
        }
        abrirModalProductoNuevo();
    }
    toast(_colaFotosStock.length ? `✅ Foto lista — quedan ${_colaFotosStock.length} en la cola` : "✅ Foto lista");
}

// Se llama después de guardar un producto en Stock — si quedan fotos en la
// cola, salta directo a la siguiente sin que el admin tenga que volver a
// abrir "📱 Fotos" cada vez.
async function guardarStockNuevoYAvanzarCola() {
    await guardarStockNuevo();
    const modalCerrado = !document.getElementById("modal-stock-nuevo")?.classList.contains("active");
    if (modalCerrado && _colaFotosStock.length) {
        const siguiente = _colaFotosStock.shift();
        fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "MARCAR_FOTO_USADA", _pass: _sessionPass, id: siguiente.id }) }).catch(()=>{});
        await cargarFotoEnFormularioStockOEntrega(siguiente.url, true);
    }
}

function abrirQR() {
    abrirScannerQR(_onScanQREntrega, "📷 Escanear producto");
}

// Algunos lectores físicos (keyboard-wedge) leen mal el primer carácter del
// código (se pierde) y/o confunden "0" con "O". Normaliza para comparar.
function _normalizarCodigoScanner(s) {
    return String(s || "").trim().toUpperCase().replace(/O/g, "0");
}

// Registro persistente de escaneos que no se pudieron agregar — el toast
// desaparece en segundos y al escanear rápido y seguido es fácil no verlo,
// causando pérdidas silenciosas de piezas que el vendedor sí debía recibir.
let _scansFallidosSesion = [];
let _refrescarGridEntregaTimer = null;
function _registrarEscaneoFallido(codigo) {
    _scansFallidosSesion.push({ codigo, hora: new Date().toLocaleTimeString("es-SV", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) });
    const wrap  = document.getElementById("escaneos-fallidos-wrap");
    const lista = document.getElementById("escaneos-fallidos-lista");
    const count = document.getElementById("escaneos-fallidos-count");
    if (!wrap || !lista || !count) return;
    wrap.style.display = "block";
    count.textContent = _scansFallidosSesion.length;
    lista.innerHTML = _scansFallidosSesion.map(s => `${sanitizar(s.hora)} — <strong>${sanitizar(s.codigo)}</strong>`).join("<br>");
}

function _onScanQREntrega(codRaw) {
    const codigo = String(codRaw || "").trim().toUpperCase();
    if (!codigo) return;
    // Buscar en mapaProductosCompleto — el inventario COMPLETO de esta sesión
    // de entrega, que nunca se reduce por el filtro de búsqueda (a diferencia
    // de mapaProductos, que renderGridEntrega achica letra por letra mientras
    // el lector físico "escribe" el código en el buscador).
    let key = Object.keys(mapaProductosCompleto).find(k => String(k).toUpperCase() === codigo);

    // Fallback 1: confusión 0/O del lector físico
    if (!key) {
        const codigoNorm = _normalizarCodigoScanner(codigo);
        key = Object.keys(mapaProductosCompleto).find(k => _normalizarCodigoScanner(k) === codigoNorm);
    }
    // Fallback 2: el lector se comió los primeros 1, 2 o 3 caracteres del
    // código (la cantidad perdida varía de un escaneo a otro con este lector).
    if (!key) {
        const codigoNorm = _normalizarCodigoScanner(codigo);
        for (let recorte = 1; recorte <= 3 && !key; recorte++) {
            key = Object.keys(mapaProductosCompleto).find(k => _normalizarCodigoScanner(k).slice(recorte) === codigoNorm);
        }
    }

    if (!key) {
        // Nueva Entrega solo asigna stock EXISTENTE a un vendedor — nunca debe
        // abrir el modal de registrar producto nuevo (eso es otro flujo, en Stock).
        // Se registra en una lista PERSISTENTE (no solo el toast, que desaparece
        // en segundos) para que nada se pierda si se escanea rápido y seguido.
        _registrarEscaneoFallido(codigo);
        toast("⚠️ \"" + codigo + "\" no existe o no tiene stock en bodega");
        return;
    }
    const prod = mapaProductosCompleto[key];

    // BLOQUEO — no dejar re-escanear un producto que este vendedor YA tiene
    // asignado, sea en borrador sin publicar O ya activo/publicado. Antes
    // solo se revisaba "borrador", así que reescanear algo ya entregado y
    // publicado en una sesión de entrega distinta creaba un segundo registro
    // duplicado (mismo producto, dos veces con el mismo vendedor) sin ningún
    // aviso — eso pasó con PUP035 de Jaime.
    const yaAsignado = vendedorActual && consignacion.some(c =>
        getCodigoBase(c.codigo) === getCodigoBase(prod.codigo) &&
        (c.estado === "borrador" || c.estado === "activo") &&
        c.vendedor === vendedorActual.codigo
    );
    if (yaAsignado) {
        const yaEnBorrador = consignacion.some(c =>
            getCodigoBase(c.codigo) === getCodigoBase(prod.codigo) && c.estado === "borrador" && c.vendedor === vendedorActual.codigo
        );
        const detalle = yaEnBorrador ? "en un borrador sin publicar" : "ya publicado en su inventario";
        _registrarEscaneoFallido(codigo + " (YA ESTÁ " + detalle + " — no se agregó de nuevo)");
        toast("🚫 " + prod.nombre + " YA está " + detalle + " — no se agregó otra vez");
        return;
    }

    cambiarQtyEntrega(key, 1);
    // Restaurar la vista completa del grid tras el escaneo — pero POSPUESTO:
    // reconstruir el grid completo (1000+ productos) bloquea el hilo principal
    // una fracción de segundo, y si el siguiente escaneo llega justo en ese
    // instante, el navegador puede perder esas teclas silenciosamente. Se
    // espera una pausa breve sin nuevos escaneos antes de redibujar.
    const busEntrega = document.getElementById("bus-entrega");
    if (busEntrega) busEntrega.value = "";
    clearTimeout(_refrescarGridEntregaTimer);
    _refrescarGridEntregaTimer = setTimeout(() => { filtrarProductosEntrega(); }, 500);
    toast("✅ " + prod.nombre + " agregado");
}

async function eliminarItemInventario(id, nombre) {
    if (!confirm("¿Eliminar " + nombre + " del inventario? La pieza vuelve a bodega de VEREX — úsalo solo si la pieza NO se vendió (se está devolviendo). Si ya se vendió, usa el botón '✅ Ya vendida' en su lugar.")) return;
    await apiPost({ accion: "ELIMINAR_ITEM_CONSIGNACION", id });
    const idx = consignacion.findIndex(c => String(c.id) === String(id));
    if (idx >= 0) consignacion.splice(idx, 1);
    renderPerfilStats();
    renderInventario();
    toast("🗑️ Producto eliminado del inventario");
}

// Cierra un item que en realidad YA se vendió (y normalmente ya se liquidó
// en un corte) pero por algún motivo quedó marcado como disponible — a
// diferencia de eliminarItemInventario(), esto NO mueve stock ni lo regresa
// a bodega, porque la pieza no existe físicamente en VEREX, ya está con el
// cliente que la compró.
// Para ventas que ya ocurrieron y ya se liquidaron (ej. una pieza que se
// cerró con "✅ Ya vendida" antes de que existiera el registro histórico
// combinado, o cualquier venta antigua que se coló sin fecha real) — pide
// los datos a mano y crea SOLO el registro de reporte, sin tocar stock ni
// volver a cobrar comisión.
async function registrarVentaHistoricaManual() {
    const codigo = prompt("Código del producto (ej. SE28001PM):");
    if (!codigo) return;
    const nombre = prompt("Nombre del producto:", codigo);
    if (nombre === null) return;
    const precio = parseFloat(prompt("Precio de venta ($):", "0"));
    if (!precio || precio <= 0) { toast("⚠️ Precio inválido"); return; }
    const cantidad = parseInt(prompt("Cantidad:", "1")) || 1;
    const fechaTxt = prompt("Fecha real en que se vendió (AAAA-MM-DD):", new Date().toISOString().slice(0,10));
    if (!fechaTxt) return;
    const fechaISO = new Date(fechaTxt + "T12:00:00").toISOString();
    const res = await apiPost({
        accion: "REGISTRAR_VENTA_HISTORICA", vendedor: vendedorActual.codigo,
        codigo, nombre, precio, cantidad, fecha: fechaISO
    });
    if (res.ok) toast("✅ Registrada en Ventas Generales / Cierres");
    else toast("⚠️ " + (res.error||"No se pudo registrar"), "#c0392b");
}

async function cerrarItemYaVendido(id, nombre) {
    const item = consignacion.find(c => String(c.id) === String(id));
    if (!item) return;

    // Este botón mezclaba dos casos muy distintos bajo un solo click:
    //  · Venta NUEVA (el vendedor recién la vendió a un cliente, sin
    //    posibilidad de devolución) — debe contar para su comisión en el
    //    próximo corte y aparecer en su historial de ventas, igual que
    //    cualquier venta registrada por el flujo normal.
    //  · Pieza que YA se liquidó antes (ej. quedó mal cerrada por el bug
    //    del corte) — la comisión ya se cobró, así que NO debe volver a
    //    contarse; solo hace falta cerrar el registro viejo.
    // Antes SIEMPRE hacía el segundo caso (MARCAR_CONSIGNACION_VENDIDA, que
    // no toca comisión ni historial), así que una venta nueva marcada "Ya
    // vendida" nunca generaba comisión ni aparecía en el registro de ventas
    // del vendedor a menos que además se completara un segundo paso opcional.
    //
    // Antes esto usaba confirm() con "Cancelar = ya se había liquidado" — un
    // usuario que quería CANCELAR TODO (no sabía cuál opción era, se
    // arrepintió, etc.) terminaba disparando la rama opuesta sin darse
    // cuenta, porque en un confirm() "Cancelar" nunca significa "aborta y no
    // hagas nada distinto a lo que ya hacías". Ahora las dos opciones se
    // escriben como texto explícito y cualquier respuesta que no sea
    // exactamente una de las dos aborta sin tocar nada.
    const respuestaTipo = (prompt(
        `¿"${nombre}" es una venta NUEVA o ya se había liquidado antes?\n\n` +
        `Escribe NUEVA → se registra normal, cuenta para su comisión y aparece en su historial de ventas.\n` +
        `Escribe LIQUIDADA → ya se había cobrado antes (ej. quedó mal cerrada por el bug del corte), solo cierra el registro sin volver a cobrar comisión.\n\n` +
        `(Cancelar no hace nada)`,
        "NUEVA"
    ) || "").trim().toUpperCase();

    if (respuestaTipo !== "NUEVA" && respuestaTipo !== "LIQUIDADA") return;

    if (respuestaTipo === "NUEVA") {
        const disponible = Math.max(1, parseInt(item.cantidad||0) - parseInt(item.vendido||0));
        const fechaTxtNueva = prompt("Fecha real en que se vendió (AAAA-MM-DD):", new Date().toISOString().slice(0,10));
        if (!fechaTxtNueva) return;
        const fechaISONueva = new Date(fechaTxtNueva + "T12:00:00").toISOString();
        const resVenta = await apiPost({ accion: "REGISTRAR_VENTA", id, cantidad: disponible, fecha: fechaISONueva });
        if (!resVenta.ok) { toast("⚠️ " + (resVenta.error||"No se pudo registrar la venta"), "#c0392b"); return; }
        item.vendido = (parseInt(item.vendido)||0) + disponible;
        renderPerfilStats();
        renderInventario();
        toast("✅ Venta registrada — cuenta para su comisión y ya aparece en su historial");
        return;
    }

    if (!confirm("¿Confirmas que \"" + nombre + "\" ya se había liquidado antes? Se cerrará sin devolver stock a bodega ni volver a cobrar comisión.")) return;
    const res = await apiPost({ accion: "MARCAR_CONSIGNACION_VENDIDA", id });
    if (!res.ok) { toast("⚠️ " + (res.error||"No se pudo cerrar el item"), "#c0392b"); return; }
    item.estado = "vendido";
    renderPerfilStats();
    renderInventario();
    toast("✅ Pieza cerrada — ya no aparece como disponible");

    // Preguntar si quiere que también quede registrada en "Ventas generales"
    // / Cierres Mensuales con su fecha real — es un registro SOLO para
    // reportes, no vuelve a cobrar comisión (eso ya se liquidó).
    if (item && confirm("¿Quieres que esta venta también quede registrada en Ventas Generales / Cierres Mensuales con su fecha real? (No afecta el próximo corte, es solo para el reporte)")) {
        const fechaTxt = prompt("Fecha real en que se vendió (AAAA-MM-DD):", new Date().toISOString().slice(0,10));
        if (fechaTxt) {
            const fechaISO = new Date(fechaTxt + "T12:00:00").toISOString();
            const resHist = await apiPost({
                accion: "REGISTRAR_VENTA_HISTORICA", vendedor: vendedorActual.codigo,
                codigo: item.codigo, nombre: item.nombre, precio: item.precio,
                cantidad: item.vendido || item.cantidad || 1, fecha: fechaISO
            });
            if (resHist.ok) toast("✅ Registrada también en Ventas Generales");
            else toast("⚠️ " + (resHist.error||"No se pudo registrar en Ventas Generales"), "#c0392b");
        }
    }
}