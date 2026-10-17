// Hub VEREX — Reemplazar fotos, lote para editar y categorías de la tienda
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
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
