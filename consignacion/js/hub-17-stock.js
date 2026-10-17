// Hub VEREX — Stock: vista, compartir producto, selección y movimientos
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── STOCK NUEVO SISTEMA ──────────────────────────────────────────────
let stockData = [];
let stockSeleccionados = [];
let stockVistaGrid = false;

function toggleVistaStock() {
    stockVistaGrid = !stockVistaGrid;
    const btn = document.getElementById("btn-vista-stock");
    btn.textContent = stockVistaGrid ? "☰" : "▦";
    btn.title = stockVistaGrid ? "Vista lista" : "Vista grid";
    renderStock(stockData);
}
let _snFotoBase64 = null;
let _snMaterial = null;
let _snTalla = null;

async function cargarStock() {
    document.getElementById("lista-stock").innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await apiPost({ accion: "STOCK_GET_ALL" });
        stockData = res.stock || [];
        guardarCodigosInactivos(res);
        poblarFiltroMaterial();
        poblarFiltroCategoria();
        renderStock(stockData);
    } catch(e) {
        document.getElementById("lista-stock").innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ Error cargando stock</p>';
    }
}

// Arma el link largo de siempre (/p/COD,COD?exp=...) y, si se puede, lo
// cambia por uno corto (/l/ID) pidiéndoselo a save-plink.js — con 10+ piezas
// seleccionadas el link largo queda larguísimo y feo para publicar en un
// Estado de WhatsApp. Si save-plink falla (sin red, endpoint caído), se
// sigue compartiendo el link largo tal cual, para no bloquear el flujo.
async function _armarLinkProducto(codigo, exp, desc, afiliado, telefono) {
    const wa = telefono ? encodeURIComponent(String(telefono).replace(/\D/g,"")) : "";
    // OJO: no usar encodeURIComponent() sobre la coma que separa códigos —
    // la convertiría en %2C y la función de Cloudflare ya no podría separarlos.
    const linkLargo = "https://admin-tienda.pages.dev/p/" + codigo + "?exp=" + exp
        + (afiliado ? "&af=" + afiliado : "")
        + (wa ? "&wa=" + wa : "")
        + (desc > 0 ? "&desc=" + desc : "");
    try {
        const res = await fetch("https://admin-tienda.pages.dev/save-plink", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _pass: _sessionPass, codigo, exp, desc, af: afiliado, wa })
        });
        const data = await res.json();
        if (data.id) return "https://admin-tienda.pages.dev/l/" + data.id;
    } catch (_) {}
    return linkLargo;
}

function compartirProducto(codigo) {
    stockSeleccionados = [codigo];
    abrirModalCompartir();
}

// Igual que compartirProducto() pero para varios productos seleccionados a la
// vez — mismo link, con los códigos separados por coma, para no tener que
// mandar un link distinto por cada pieza que le interese al cliente.
function compartirSeleccionados() {
    if (!stockSeleccionados.length) return;
    abrirModalCompartir();
}

// Estado del modal "Promocionar" — vigencia y % de descuento elegidos con
// chips en vez de los prompt() de antes.
let _mcVigenciaDias = 3;
let _mcDescuentoPct = 0;

function _mcSetVigencia(dias, btn) {
    _mcVigenciaDias = dias;
    btn.parentElement.querySelectorAll(".mc-chip").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
}

function _mcSetDescuento(pct, btn) {
    _mcDescuentoPct = pct;
    document.getElementById("mc-desc-custom").value = "";
    btn.parentElement.querySelectorAll(".mc-chip").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
    _mcActualizarPreview();
}

function _mcDescuentoCustom(input) {
    const pct = Math.min(90, Math.max(0, parseInt(input.value) || 0));
    _mcDescuentoPct = pct;
    document.querySelectorAll("#mc-descuento .mc-chip").forEach(b => b.classList.remove("activo"));
    _mcActualizarPreview();
}

// Arma nombre/descripción/foto del preview con la MISMA lógica que
// adminverex/functions/_plink-render.js usa del lado servidor al abrir el
// link — así lo que el admin ve acá es igual a lo que le va a llegar al
// cliente en WhatsApp.
function _mcActualizarPreview() {
    const codigos = stockSeleccionados;
    const primero = stockData.find(s => s.codigo === codigos[0]);
    if (!primero) return;

    const basesUnicas = new Set(codigos.map(c => {
        const s = stockData.find(x => x.codigo === c);
        return getCodigoBase(s ? s.codigo : c);
    }));
    const extra = basesUnicas.size - 1;

    let nombre = (primero.nombre_base || primero.nombre || "Producto VEREX").trim();
    if (extra > 0) nombre += ` + ${extra} producto${extra > 1 ? "s" : ""} más`;

    let descripcion = "La expresión de tu mejor versión";
    if (_mcDescuentoPct > 0) {
        descripcion = extra > 0
            ? `🔥 ${_mcDescuentoPct}% OFF en ${basesUnicas.size} diseños seleccionados · Oferta por tiempo limitado`
            : (() => {
                const antes = parseFloat(primero.precio || primero.precioNum) || 0;
                const ahora = Math.round(antes * (1 - _mcDescuentoPct / 100) * 100) / 100;
                return `🔥 ${_mcDescuentoPct}% OFF — antes $${antes.toFixed(2)} ahora $${ahora.toFixed(2)}`;
              })();
    }

    document.getElementById("mc-preview-nombre").textContent = nombre + " · VEREX";
    document.getElementById("mc-preview-desc").textContent = descripcion;
    const foto = document.getElementById("mc-preview-foto");
    if (primero.foto) { foto.src = ikFoto(primero.foto, 300); foto.style.display = "block"; }
    else { foto.style.display = "none"; }
}

// Abre el modal "Promocionar" para los códigos ya puestos en
// stockSeleccionados (uno solo, o varios elegidos en Stock).
function abrirModalCompartir() {
    if (!stockSeleccionados.length) return;
    _mcVigenciaDias = 3;
    _mcDescuentoPct = 0;

    document.getElementById("mc-titulo").textContent =
        stockSeleccionados.length === 1 ? "Promocionar producto" : `Promocionar ${stockSeleccionados.length} productos`;

    const vistos = new Set();
    const miniaturas = stockSeleccionados.map(cod => {
        const item = stockData.find(s => s.codigo === cod);
        if (!item) return "";
        const base = getCodigoBase(item.codigo);
        if (vistos.has(base)) return "";
        vistos.add(base);
        const foto = item.foto ? sanitizar(ikFoto(item.foto, 100)) : "";
        return `<div style="width:44px;height:44px;border-radius:8px;overflow:hidden;background:var(--gris2);flex-shrink:0;">${foto ? `<img src="${foto}" style="width:100%;height:100%;object-fit:cover;">` : ""}</div>`;
    }).join("");
    document.getElementById("mc-productos").innerHTML = miniaturas;

    const selAfiliado = document.getElementById("mc-afiliado");
    const afiliados = (vendedores || []).filter(v => v.tipo === "afiliado" || v.tipo === "hibrido");
    selAfiliado.innerHTML = '<option value="">Ninguno — venta directa</option>' +
        afiliados.map(v => `<option value="${sanitizar(v.codigo)}" data-tel="${sanitizar(v.telefono || "")}">${sanitizar(v.nombre)}</option>`).join("");

    document.querySelectorAll("#mc-vigencia .mc-chip").forEach(b => b.classList.toggle("activo", b.dataset.dias === "3"));
    document.querySelectorAll("#mc-descuento .mc-chip").forEach(b => b.classList.toggle("activo", b.dataset.pct === "0"));
    document.getElementById("mc-desc-custom").value = "";

    _mcActualizarPreview();
    abrirModal("modal-compartir");
}

// Arma el link (corto si save-plink responde, largo si no) con lo elegido en
// el modal — mismo helper que usaba el flujo de prompt() de antes.
async function _mcObtenerLink() {
    const exp = Date.now() + _mcVigenciaDias * 86400000;
    const selAfiliado = document.getElementById("mc-afiliado");
    const opt = selAfiliado.selectedOptions[0];
    const afiliado = selAfiliado.value;
    const telefono = opt ? opt.dataset.tel : "";
    const codigos = stockSeleccionados.join(",");
    return _armarLinkProducto(codigos, exp, _mcDescuentoPct, afiliado, telefono);
}

async function _mcCompartirWhatsApp(btn) {
    const original = btn.textContent;
    btn.textContent = "Generando…"; btn.disabled = true;
    try {
        const link = await _mcObtenerLink();
        const nombre = document.getElementById("mc-preview-nombre").textContent.replace(" · VEREX", "");
        const texto = `Mira ${stockSeleccionados.length > 1 ? "estas piezas" : "esta pieza"} de VEREX 😍\n${nombre}\n${link}`;
        window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank");
        cerrarModal("modal-compartir");
    } finally {
        btn.textContent = original; btn.disabled = false;
    }
}

async function _mcCopiarLink(btn) {
    btn.disabled = true;
    try {
        const link = await _mcObtenerLink();
        navigator.clipboard.writeText(link).then(() => {
            toast("🔗 Link copiado al portapapeles");
        }).catch(() => {
            prompt("Link copiado — pégalo donde lo necesites compartir:", link);
        });
        cerrarModal("modal-compartir");
    } finally {
        btn.disabled = false;
    }
}

// Nota «código corregido» en la tarjeta del producto: avisa que hay que cambiar la etiqueta física.
function notaCodigoCorregido(g) {
    const pend = (g.items || []).filter(i => i.etiquetaPendiente && i.codigoAnterior);
    if (!pend.length) return "";
    const antes = getCodigoBase(pend[0].codigoAnterior), ahora = getCodigoBase(pend[0].codigo), cods = pend.map(i => i.codigo);
    return `<div onclick="event.stopPropagation()" style="margin:5px 0;padding:6px 8px;border-radius:8px;background:rgba(245,158,11,.14);border:1px solid #f59e0b;color:#fcd34d;font-size:11px;line-height:1.4;">
        🏷️ <b>CÓDIGO CORREGIDO</b><br>Antes <b>${sanitizar(antes)}</b> → ahora <b>${sanitizar(ahora)}</b><br>Cambia la etiqueta física de ${pend.length > 1 ? "las " + pend.length + " tallas" : "la pieza"}.
        <button onclick="event.stopPropagation();marcarEtiquetaCambiada(${jsArgArr(cods)})" style="display:block;margin-top:5px;padding:4px 8px;font-size:11px;font-weight:700;background:#f59e0b;color:#111;border:none;border-radius:6px;cursor:pointer;">✓ Etiqueta ya cambiada</button></div>`;
}
// Alerta en la tarjeta: un par/trío (tiene tallas D de dama y C/H de caballero) con alguna talla
// SIN la letra D/C/H en el código (ej. ANP311T11). Se cuenta como pieza aparte y el catálogo no la reconoce.
function notaCodigoSinLetra(g) {
    const cods = (g.items || []).map(i => String(i.codigo || ""));
    const conLetra = L => cods.some(c => new RegExp("[\\dB]" + L + "T\\d+(\\.\\d+)?$", "i").test(c));
    if (!(conLetra("D") && conLetra("[CH]"))) return "";
    const sueltas = cods.filter(c => /\dT\d+(\.\d+)?$/i.test(c));
    if (!sueltas.length) return "";
    return `<div onclick="event.stopPropagation()" style="margin:5px 0;padding:6px 8px;border-radius:8px;background:rgba(245,158,11,.14);border:1px solid #f59e0b;color:#fcd34d;font-size:11px;line-height:1.4;">
        ⚠️ <b>Falta D o C en el código</b><br>${sueltas.map(c => "<b>" + sanitizar(c) + "</b>").join(", ")} no dice si es dama (D) o caballero (C). Se cuenta como una pieza extra. Corrígelo con ✏️.
    </div>`;
}
async function marcarEtiquetaCambiada(codigos) {
    try {
        const r = await apiPost({ accion: "MARCAR_ETIQUETA_CAMBIADA", codigos });
        if (!r || !r.ok) throw new Error((r && r.error) || "no se pudo guardar");
        for (const c of codigos) { const it = stockData.find(p => p.codigo === c); if (it) it.etiquetaPendiente = false; }
        try { filtrarStock(); } catch (_) { renderStock(stockData); }
        toast("✅ Etiqueta marcada como cambiada", "#22c55e");
    } catch (e) { toast("⚠️ " + (e.message || e), "#ef4444"); }
}

// Si la foto guardada no carga (archivo borrado, subida incompleta…), la tarjeta muestra un aviso en vez de quedar sin imagen.
function fotoNoDisponible(img) {
    const d = document.createElement("div");
    d.title = "La foto no está disponible: usa ✏️ para subir otra (el código y el nombre identifican el producto)";
    d.style.cssText = "width:64px;height:64px;flex-shrink:0;border:1px dashed #C9A84C;border-radius:8px;background:#3a3a3c;color:#C9A84C;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;line-height:1.1;text-align:center;";
    d.innerHTML = '📷<span style="font-size:8px;font-weight:700;letter-spacing:.5px;margin-top:2px;">SIN FOTO</span>';
    img.replaceWith(d);
}
// Clave del grupo visual de Stock: el codigoBase del diseño, quitando la «B» final de la 2da pieza de dama de un trío
// (ANL106B → ANL106). La usan la tarjeta de Stock y el guardado de «Editar producto» para hablar del mismo grupo.
function claveGrupoStock(item) {
    const base = (item && (item.codigoBase || item.codigo)) || "";
    return base.replace(/^(.+\d)B$/, "$1");
}

function renderStock(items) {
    if (!items) items = stockData;
    if (!items) return;
    // KPIs
    document.getElementById("sk-total").textContent   = items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0) + (parseInt(i.stock_tienda)||0) + (parseInt(i.stock_consignacion)||0), 0);
    document.getElementById("sk-bodega").textContent  = items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0), 0);
    document.getElementById("sk-tienda").textContent  = items.reduce((s,i) => s + (parseInt(i.stock_tienda)||0), 0);
    document.getElementById("sk-cons").textContent    = items.reduce((s,i) => s + (parseInt(i.stock_consignacion)||0), 0);
    document.getElementById("sk-reservado").textContent = items.reduce((s,i) => s + (parseInt(i.sstock_reservado||i.stock_reservado)||0), 0);

    // Ordenar: más nuevos primero (por fecha_registro descendente)
    items = [...items].sort((a, b) => {
        const fa = new Date(a.fecha_registro || a.fechaRegistro || 0).getTime();
        const fb = new Date(b.fecha_registro || b.fechaRegistro || 0).getTime();
        return fb - fa;
    });

    // Mismo esquema de color del badge de material que ya usa el catálogo
    // público — para que se identifique de un vistazo también en Stock.
    const colorMaterial = m => {
        const s = String(m||"").toLowerCase();
        if (s.includes("acero")) return { bg:"rgba(59,130,246,0.15)", border:"#3b82f6", color:"#93c5fd" };
        if (s.includes("oro"))   return { bg:"rgba(234,179,8,0.15)",  border:"#eab308", color:"#fcd34d" };
        if (s.includes("plata")) return { bg:"rgba(148,163,184,0.15)",border:"#94a3b8", color:"#cbd5e1" };
        return { bg:"rgba(201,168,76,0.12)", border:"rgba(201,168,76,0.3)", color:"#C9A84C" };
    };

    const lista = document.getElementById("lista-stock");
    if (!items.length) {
        lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay productos en stock. Usa "+ Agregar" para registrar piezas.</p>';
        return;
    }

    const estadoColor = {
        "bodega":       { bg: "rgba(74,111,165,0.2)", color: "#4a6fa5", label: "🏠 Bodega" },
        "tienda":       { bg: "rgba(45,122,79,0.2)",  color: "#4caf82", label: "🛍️ Tienda" },
        "consignacion": { bg: "rgba(201,168,76,0.2)", color: "var(--dorado)", label: "👤 Consignación" },
        "reservado":    { bg: "rgba(231,76,60,0.2)",  color: "#e74c3c", label: "⏳ Reservado" },
        "vendido":      { bg: "rgba(100,100,100,0.2)", color: "#888", label: "✅ Vendido" },
    };

    // Agrupar por diseño (mismo codigoBase) para no repetir una fila por cada
    // talla — un anillo con 3 tallas ocupa 1 tarjeta con 3 chips en vez de 3
    // filas completas. Tocar un chip expande los botones de esa talla exacta
    // (editar/compartir/reservar/mover/eliminar), sin perder nada de lo que
    // ya se podía hacer por fila.
    // La 2da pieza de dama de un trío se registra con el codigoBase + "B"
    // (ej. ANL106B) para poder distinguirla físicamente de la primera pieza
    // — pero para el AGRUPADO visual sigue siendo el mismo diseño/trío, así
    // que aquí se le quita esa "B" final para que caiga en el mismo grupo.
    const grupos = new Map();
    items.forEach(item => {
        const base = item.codigoBase || item.codigo;
        const key = claveGrupoStock(item);
        if (!grupos.has(key)) grupos.set(key, { key, nombre: item.nombre_base || item.nombre, material: item.material, caracterEspecial: item.caracterEspecial, foto: item.foto, fotoMejorada: item.fotoMejorada || "", categoria: item.categoria, items: [] });
        const g = grupos.get(key);
        g.items.push(item);
        if (!g.caracterEspecial && item.caracterEspecial) g.caracterEspecial = item.caracterEspecial;
        // Preferir el nombre/foto de la pieza "base" (sin la B) para el
        // encabezado del grupo, si la B llegó primero por orden de fecha.
        if (base === key) { g.nombre = item.nombre_base || item.nombre; g.foto = item.foto || g.foto; }
        // Foto "mejorada" (nitidez, botón ✨) — se muestra en vez de la
        // original cuando existe, sin sobrescribirla nunca.
        if (!g.fotoMejorada && item.fotoMejorada) g.fotoMejorada = item.fotoMejorada;
    });

    // ── Vista grid: mismo agrupado por diseño, una tarjeta por grupo con
    // chips de talla en vez de una tarjeta por cada talla individual ────────
    if (stockVistaGrid) {
        lista.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">` +
        [...grupos.values()].map(g => {
            const codigos = g.items.map(i => i.codigo);
            const selAll = codigos.every(c => stockSeleccionados.includes(c));
            const totalBodega = g.items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0), 0);
            const totalTienda = g.items.reduce((s,i) => s + (parseInt(i.stock_tienda)||0), 0);
            const totalConsig = g.items.reduce((s,i) => s + (parseInt(i.stock_consignacion)||0), 0);
            const totalPiezas = totalBodega + totalTienda + totalConsig;
            const agotadoGrupo = totalPiezas === 0;
            const piezasUnicas = new Map();
            g.items.forEach(item => {
                const piezaKey = String(item.codigo).replace(/\d+(\.\d+)?$/, "") || item.codigo;
                if (!piezasUnicas.has(piezaKey)) piezasUnicas.set(piezaKey, item);
            });
            const precioTotal = [...piezasUnicas.values()].reduce((s,it) => s + parseFloat(it.precio||0), 0);
            const activo = g.items[0];
            const chips = g.items.map((item, idx) => {
                const total = (parseInt(item.stock_bodega)||0) + (parseInt(item.stock_tienda)||0) + (parseInt(item.stock_consignacion)||0);
                const label = item.talla ? `T${sanitizar(item.talla)}` : sanitizar(item.codigo);
                return `<span class="grid-chip-talla" data-codigo="${sanitizar(item.codigo)}" onclick="event.stopPropagation();_stockGridActivarTalla(this,${jsArg(item.codigo)})" title="${sanitizar(item.codigo)} · ${total} en stock" style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;cursor:pointer;background:${total===0?'rgba(136,136,136,0.15)':'rgba(52,211,153,0.15)'};border:1px solid ${idx===0?'var(--dorado)':(total===0?'#666':'#34D399')};color:${total===0?'#888':'#34D399'};">${label}${total>0?` ×${total}`:''}</span>`;
            }).join('');
            return `<div data-grupo="${sanitizar(g.key)}" data-activo="${sanitizar(activo.codigo)}" onclick="toggleSeleccionGrupo(${jsArgArr(codigos)})" style="background:#2C2C2E;border:${selAll?"2px solid var(--dorado)":"1px solid var(--dorado)"};border-radius:12px;overflow:hidden;cursor:pointer;position:relative;">
                <div onclick="event.stopPropagation();toggleSeleccionGrupo(${jsArgArr(codigos)})" style="position:absolute;top:6px;left:6px;width:18px;height:18px;border:2px solid ${selAll?"var(--dorado)":"#666"};border-radius:4px;background:${selAll?"var(--dorado)":"rgba(0,0,0,0.5)"};display:flex;align-items:center;justify-content:center;font-size:11px;z-index:2;">${selAll?"✓":""}</div>
                <div style="width:100%;aspect-ratio:1;background:#1a1a1a;overflow:hidden;">
                    ${g.foto ? `<img src="${sanitizar(ikFoto(g.fotoMejorada||g.foto,300))}" onerror="fotoNoDisponible(this)" style="width:100%;height:100%;object-fit:cover;">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;">💍</div>`}
                </div>
                <div style="padding:7px 8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="color:#FF9500;font-size:10px;font-weight:700;">${sanitizar(g.key)}</div>
                        <div style="color:#34D399;font-size:11px;font-weight:700;">$${precioTotal.toFixed(2)}</div>
                    </div>
                    <div style="color:#fff;font-size:11px;font-weight:600;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(g.nombre)}</div>
                    ${notaCodigoCorregido(g)}${notaCodigoSinLetra(g)}
                    ${g.material ? `<div style="display:inline-block;font-size:9px;font-weight:700;margin-bottom:3px;background:${colorMaterial(g.material).bg};border:1px solid ${colorMaterial(g.material).border};color:${colorMaterial(g.material).color};border-radius:4px;padding:1px 6px;">${sanitizar(g.material)}</div>` : ''}
                    ${g.caracterEspecial ? `<div style="display:inline-block;font-size:9px;font-weight:700;margin-bottom:3px;margin-left:3px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);color:#c9a8ff;border-radius:4px;padding:1px 6px;" title="Característica especial">✨ ${sanitizar(g.caracterEspecial)}</div>` : ''}
                    ${g.items.some(it => it.noOfrecerWhatsApp === true) ? `<div style="display:inline-block;font-size:9px;font-weight:700;margin-bottom:3px;margin-left:3px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.45);color:#fca5a5;border-radius:4px;padding:1px 6px;" title="Lyra no la ofrece por WhatsApp (✏️ Editar producto)">🚫 WhatsApp</div>` : ''}
                    ${agotadoGrupo
                        ? '<div style="text-align:center;font-size:11px;font-weight:700;color:#fff;background:#C0392B;border-radius:6px;padding:3px 4px;margin-top:4px;letter-spacing:1px;">AGOTADO</div>'
                        : `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px;font-size:9px;color:#666;margin-top:2px;"><span>🏠 Bodega:<b style="color:#fff"> ${totalBodega}</b></span><span>🛍️ Tienda:<b style="color:#34D399"> ${totalTienda}</b></span><span>👤 Consig.:<b style="color:var(--dorado)"> ${totalConsig}</b></span></div>`}
                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${chips}</div>
                    <div style="display:flex;gap:4px;margin-top:6px;position:relative;" data-grupo-botones="${sanitizar(g.key)}">
                        <button onclick="event.stopPropagation();abrirEditarStockItem(_stockGridCodActivo(this))" style="flex:1;padding:4px 0;font-size:10px;background:#5AC8FA;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:600;">✏️</button>
                        <button onclick="event.stopPropagation();compartirProducto(_stockGridCodActivo(this))" style="flex:1;padding:4px 0;font-size:10px;background:#25D366;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;" title="Compartir la talla activa">🔗</button>
                        <button onclick="event.stopPropagation();toggleReservaStock(_stockGridCodActivo(this))" style="flex:1;padding:4px 0;font-size:10px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;" title="Reservar/liberar la talla activa">🔒</button>
                        <button onclick="event.stopPropagation();_stockGridToggleMover(this)" style="flex:2;padding:4px 6px;font-size:10px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">⇄ Mover ▾</button>
                        <button onclick="event.stopPropagation();imprimirEtiquetaStock(_stockGridCodActivo(this))" title="Imprimir etiqueta de la talla activa" style="flex:1;padding:4px 0;font-size:12px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️</button>
                        <div class="menu-mover-grid" style="display:none;position:absolute;bottom:30px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArgArr(codigos)},'tienda')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4caf82;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;" title="Mueve todas las tallas en existencia de este diseño">🛍️ Enviar todo a Tienda</button>
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArgArr(codigos)},'bodega')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4a6fa5;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;" title="Mueve todas las tallas en existencia de este diseño">📦 Devolver todo a Bodega</button>
                            <button onclick="event.stopPropagation();moverItemDirectoVendedor(${jsArgArr(codigos)})" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:var(--dorado);border:none;cursor:pointer;text-align:left;font-weight:600;" title="Asigna todas las tallas en existencia de este diseño">👤 Asignar todo a Vendedor</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('') + `</div>`;
        return;
    }

    lista.innerHTML = [...grupos.values()].map(g => {
        const codigos = g.items.map(i => i.codigo);
        const selAll = codigos.every(c => stockSeleccionados.includes(c));
        const totalBodega = g.items.reduce((s,i) => s + (parseInt(i.stock_bodega)||0), 0);
        const totalTienda = g.items.reduce((s,i) => s + (parseInt(i.stock_tienda)||0), 0);
        const totalConsig = g.items.reduce((s,i) => s + (parseInt(i.stock_consignacion)||0), 0);
        const totalPiezas = totalBodega + totalTienda + totalConsig;
        const agotadoGrupo = totalPiezas === 0;
        const nUltimas  = g.items.filter(i => { const t=(parseInt(i.stock_bodega)||0)+(parseInt(i.stock_tienda)||0)+(parseInt(i.stock_consignacion)||0); return t>0 && (parseInt(i.stock_bodega)||0)<=1; }).length;
        const nAgotadas = g.items.filter(i => ((parseInt(i.stock_bodega)||0)+(parseInt(i.stock_tienda)||0)+(parseInt(i.stock_consignacion)||0))===0).length;

        // El precio a mostrar es la suma de las piezas DISTINTAS del set (no
        // por talla). OJO: dama y caballero comparten el mismo codigoBase en
        // un par/trío normal (solo la 2da pieza de dama usa uno con "B"), así
        // que agrupar por codigoBase los contaría como una sola pieza — hay
        // que usar el código completo SIN la talla para distinguir cada
        // pieza física real (ej. "ANL106DT8" y "ANL106CT11" son piezas
        // distintas aunque compartan codigoBase "ANL106").
        const piezasUnicas = new Map();
        g.items.forEach(item => {
            const piezaKey = String(item.codigo).replace(/\d+(\.\d+)?$/, "") || item.codigo;
            if (!piezasUnicas.has(piezaKey)) piezasUnicas.set(piezaKey, item);
        });
        const precioTotal = [...piezasUnicas.values()].reduce((s,it) => s + parseFloat(it.precio||0), 0);
        const nPiezas = piezasUnicas.size;

        const stat = (label, valor, color) => `<div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px 10px;text-align:center;flex:1;min-width:70px;">
            <div style="font-size:16px;font-weight:700;color:${color};">${valor}</div>
            <div style="font-size:9px;color:#888;font-weight:600;">${label}</div>
        </div>`;
        const statsRow = `<div style="display:flex;gap:6px;margin-top:8px;">
            ${stat("Stock total", totalPiezas, "#fff")}
            ${stat("Tallas", g.items.length, "#fff")}
            ${stat("Últimas uds.", nUltimas, nUltimas>0?"#e74c3c":"#666")}
            ${stat("Agotados", nAgotadas, nAgotadas>0?"#888":"#666")}
        </div>`;

        // Cada talla mantiene sus botones completos y SIEMPRE visibles, ahora
        // en formato tabla — más compacto que las tarjetas apiladas de antes.
        const filas = g.items.map(item => {
            const estadoNorm = item.reservado ? "reservado" : normalizar(item.estado);
            const est = estadoColor[estadoNorm] || estadoColor["bodega"];
            const total = (parseInt(item.stock_bodega)||0) + (parseInt(item.stock_tienda)||0) + (parseInt(item.stock_consignacion)||0);
            const bajo = total > 0 && (parseInt(item.stock_bodega)||0) <= 1;
            const label = item.talla ? `T${sanitizar(item.talla)}` : "—";
            // Sin unidades en bodega/tienda/consignación:
            //  · Reservado — apartada por un pedido aún no cerrado (tienda online
            //    o USA pagado sin entregar, pedido de catálogo/afiliado): está en
            //    stock_reservado hasta que se marca entregado o se libera.
            //  · Vendido — la venta ya se cerró: stock_vendido sube en todos los
            //    canales (venta directa, vendedor, consignación desde el Hub,
            //    tienda online "Entregado", lead/afiliado y USA entregados).
            const reservadoPedido = total===0 && (parseInt(item.stock_reservado)||0) > 0;
            const vendido = total===0 && !reservadoPedido && (parseInt(item.stock_vendido)||0) > 0;
            const estadoTxt = reservadoPedido ? "Reservado" : vendido ? "Vendido" : total===0 ? "Agotado" : bajo ? "Última unidad" : "Disponible";
            const estadoColorTxt = reservadoPedido ? "#FF9500" : vendido ? "#5AC8FA" : total===0 ? "#888" : bajo ? "#e74c3c" : "#34D399";
            return `<tr style="border-top:1px solid #333;">
                <td style="padding:7px 6px;font-size:12px;font-weight:700;color:#FF9500;">${label}</td>
                <td style="padding:7px 6px;font-size:11px;color:#aaa;">${sanitizar(item.codigo)}</td>
                <td style="padding:7px 6px;font-size:12px;text-align:center;color:#fff;">${item.stock_bodega||0}</td>
                <td style="padding:7px 6px;font-size:12px;text-align:center;color:#34D399;">${item.stock_tienda||0}</td>
                <td style="padding:7px 6px;font-size:12px;text-align:center;color:var(--dorado);">${item.stock_consignacion||0}</td>
                <td style="padding:7px 6px;font-size:11px;font-weight:600;color:${estadoColorTxt};white-space:nowrap;">${estadoTxt}</td>
                <td style="padding:7px 6px;">
                    <div style="display:flex;gap:4px;justify-content:flex-end;position:relative;">
                        <button onclick="event.stopPropagation();abrirEditarStockItem(${jsArg(item.codigo)})" title="Editar" style="width:26px;height:26px;padding:0;font-size:12px;background:#5AC8FA;color:#111;border:none;border-radius:6px;cursor:pointer;">✏️</button>
                        <button onclick="event.stopPropagation();compartirProducto(${jsArg(item.codigo)})" title="Compartir" style="width:26px;height:26px;padding:0;font-size:12px;background:#25D366;color:#fff;border:none;border-radius:6px;cursor:pointer;">🔗</button>
                        <button onclick="event.stopPropagation();toggleReservaStock(${jsArg(item.codigo)})" title="${item.reservado?"Liberar":"Reservar"}" style="width:26px;height:26px;padding:0;font-size:12px;background:${item.reservado?"#e74c3c":"#4a4a4e"};color:#fff;border:none;border-radius:6px;cursor:pointer;">${item.reservado?"🔓":"🔒"}</button>
                        <button onclick="event.stopPropagation();toggleMenuMover(${jsArg(item.codigo)},this)" title="Mover" style="width:26px;height:26px;padding:0;font-size:12px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;">⇄</button>
                        <button onclick="event.stopPropagation();corregirCantidadExactaStock(${jsArg(item.codigo)})" title="Corregir cantidad exacta (bodega/tienda/consignación)" style="width:26px;height:26px;padding:0;font-size:12px;background:#e8b07a;color:#111;border:none;border-radius:6px;cursor:pointer;">⚖️</button>
                        <button onclick="event.stopPropagation();eliminarStockItem(${jsArg(item.codigo)})" title="Eliminar" style="width:26px;height:26px;padding:0;font-size:12px;background:#FF453A;color:#fff;border:none;border-radius:6px;cursor:pointer;">🗑️</button>
                        <button onclick="event.stopPropagation();imprimirEtiquetaStock(${jsArg(item.codigo)})" title="${estaEtiquetaImpresa(item.codigo)?'Etiqueta impresa — clic para desmarcar':'Imprimir etiqueta'}" style="width:26px;height:26px;padding:0;font-size:12px;background:${estaEtiquetaImpresa(item.codigo)?'#22c55e':'#4a4a4e'};color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️</button>
                        <div id="menu-mover-${sanitizar(item.codigo)}" style="display:none;position:absolute;top:30px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArg(item.codigo)},'tienda')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4caf82;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🛍️ Enviar a Tienda</button>
                            <button onclick="event.stopPropagation();moverItemDirecto(${jsArg(item.codigo)},'bodega')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4a6fa5;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">📦 Devolver a Bodega</button>
                            <button onclick="event.stopPropagation();moverItemDirectoVendedor(${jsArg(item.codigo)})" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:var(--dorado);border:none;cursor:pointer;text-align:left;font-weight:600;">👤 Asignar a Vendedor</button>
                        </div>
                    </div>
                </td>
            </tr>`;
        }).join('');

        const detalles = `<div style="overflow-x:auto;margin-top:8px;">
            <table style="width:100%;border-collapse:collapse;min-width:480px;">
                <thead><tr style="text-align:left;">
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;">Talla</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;">Código</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:center;"><span style="font-size:16px;">🏠</span> Bodega</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:center;"><span style="font-size:16px;">🛍️</span> Tienda</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:center;"><span style="font-size:16px;">🪙</span> Consig.</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;">Estado</th>
                    <th style="padding:0 6px 4px;font-size:9px;color:#fff;font-weight:700;text-transform:uppercase;text-align:right;">Acciones</th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;

        return `<div class="inv-item" style="background:#2C2C2E;border-color:var(--dorado);cursor:pointer;flex-direction:column;align-items:stretch;padding:10px 12px;" onclick="toggleSeleccionGrupo(${jsArgArr(codigos)})">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:18px;height:18px;border:2px solid ${selAll?"var(--dorado)":"#555"};border-radius:4px;background:${selAll?"var(--dorado)":"transparent"};display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;">
                    ${selAll ? "✓" : ""}
                </div>
                ${g.foto ? `<img src="${sanitizar(ikFoto(g.fotoMejorada||g.foto,200))}" onerror="fotoNoDisponible(this)" onclick="event.stopPropagation();abrirFotoZoom(${jsArg(g.fotoMejorada||g.foto)},${jsArg(g.nombre)})" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;cursor:zoom-in;background:#3a3a3c;">` : '<div style="width:64px;height:64px;background:#3a3a3c;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">💍</div>'}
                <div style="flex:1;min-width:0;">
                    <div style="color:#fff;font-size:14px;font-weight:600;">${sanitizar(g.nombre)}</div>
                    ${notaCodigoCorregido(g)}${notaCodigoSinLetra(g)}
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;">
                        ${g.material ? `<span style="font-size:10px;font-weight:700;color:${colorMaterial(g.material).color};background:${colorMaterial(g.material).bg};border:1px solid ${colorMaterial(g.material).border};border-radius:4px;padding:1px 7px;">${sanitizar(g.material)}</span>` : ''}
                        ${g.caracterEspecial ? `<span style="font-size:10px;font-weight:700;color:#c9a8ff;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);border-radius:4px;padding:1px 7px;" title="Característica especial">✨ ${sanitizar(g.caracterEspecial)}</span>` : ''}
                        ${g.items.some(it => it.noOfrecerWhatsApp === true) ? `<span style="font-size:10px;font-weight:700;color:#fca5a5;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.45);border-radius:4px;padding:1px 7px;" title="Lyra no la ofrece por WhatsApp (✏️ Editar producto)">🚫 WhatsApp</span>` : ''}
                        ${agotadoGrupo ? '<span style="font-size:10px;font-weight:700;color:#fff;background:#C0392B;border-radius:6px;padding:2px 8px;letter-spacing:1px;">AGOTADO</span>' : ''}
                    </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:15px;color:#34D399;font-weight:700;">$${precioTotal.toFixed(2)}</div>
                    ${nPiezas > 1 ? `<div style="font-size:9px;color:#888;font-weight:600;">${nPiezas} pieza${nPiezas>2?'s':''}</div>` : ''}
                    <div style="color:#FF9500;font-size:11px;font-weight:700;margin-top:2px;">${sanitizar(g.key)}${g.categoria?` · ${sanitizar(g.categoria)}`:''}</div>
                </div>
            </div>
            <div onclick="event.stopPropagation();">
                <div style="display:flex;justify-content:flex-end;gap:6px;margin:2px 0 6px;position:relative;">
                    ${(g.categoria === "AN" || g.categoria === "CJ" || g.items?.some?.(it => it.talla)) ? `<button onclick="abrirAgregarTalla(${jsArg(g.key)})" style="padding:5px 10px;font-size:11px;background:var(--dorado);color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;" title="Agregar unidades de una talla nueva o de una que ya existe">➕ Agregar talla</button>` : ""}
                    <button onclick="_stockGridToggleMover(this)" style="padding:5px 10px;font-size:11px;background:#4a4a4e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;" title="Mueve todas las tallas en existencia de este diseño">⇄ Mover grupo completo ▾</button>
                    <div class="menu-mover-grid" style="display:none;position:absolute;top:30px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                        <button onclick="moverItemDirecto(${jsArgArr(codigos)},'tienda')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4caf82;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">🛍️ Enviar todo a Tienda</button>
                        <button onclick="moverItemDirecto(${jsArgArr(codigos)},'bodega')" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:#4a6fa5;border:none;border-bottom:1px solid #333;cursor:pointer;text-align:left;font-weight:600;">📦 Devolver todo a Bodega</button>
                        <button onclick="moverItemDirectoVendedor(${jsArgArr(codigos)})" style="display:block;width:100%;padding:9px 14px;font-size:12px;background:none;color:var(--dorado);border:none;cursor:pointer;text-align:left;font-weight:600;">👤 Asignar todo a Vendedor</button>
                    </div>
                </div>
                ${statsRow}${detalles}
            </div>
        </div>`;
    }).join('');
}

// Vista grid: cada tarjeta agrupada guarda en data-activo el código de la
// talla sobre la que actúan los botones (editar/compartir/reservar/mover/
// imprimir) — por defecto la primera, y cambia al tocar un chip de talla.
function _stockGridActivarTalla(chipEl, codigo) {
    const card = chipEl.closest('[data-grupo]');
    if (!card) return;
    card.dataset.activo = codigo;
    card.querySelectorAll('.grid-chip-talla').forEach(c => {
        c.style.borderColor = (c.dataset.codigo === codigo) ? 'var(--dorado)' : (c.style.color === 'rgb(136, 136, 136)' ? '#666' : '#34D399');
    });
}
function _stockGridCodActivo(el) {
    const card = el.closest('[data-grupo]');
    return card ? card.dataset.activo : '';
}
function _stockGridToggleMover(btn) {
    const menu = btn.parentElement.querySelector('.menu-mover-grid');
    document.querySelectorAll('.menu-mover-grid').forEach(m => { if (m !== menu) m.style.display = 'none'; });
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function toggleSeleccionGrupo(codigos) {
    const todosSel = codigos.every(c => stockSeleccionados.includes(c));
    codigos.forEach(c => {
        const idx = stockSeleccionados.indexOf(c);
        if (todosSel) { if (idx >= 0) stockSeleccionados.splice(idx, 1); }
        else { if (idx < 0) stockSeleccionados.push(c); }
    });
    const accionesDiv = document.getElementById("stock-acciones");
    const countEl = document.getElementById("stock-sel-count");
    if (stockSeleccionados.length > 0) {
        accionesDiv.style.display = "flex";
        const header = document.querySelector(".header");
        accionesDiv.style.top = (header?.offsetHeight || 60) + "px";
        countEl.textContent = stockSeleccionados.length + " seleccionado" + (stockSeleccionados.length > 1 ? "s" : "");
    } else {
        accionesDiv.style.display = "none";
    }
    filtrarStock();
}

function selMatEdit(btn) {
    document.querySelectorAll(".ep-mat-btn").forEach(b => b.style.outline = "");
    btn.style.outline = "2px solid var(--dorado)";
}

function selSetSN(btn) {
    document.querySelectorAll(".sn-set-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; b.classList.remove("selected"); });
    btn.style.background = "var(--dorado)"; btn.style.color = "#111"; btn.style.borderColor = "var(--dorado)"; btn.classList.add("selected");
    const esSet = btn.dataset.set !== "";
    document.getElementById("sn-precio").style.display = esSet ? "none" : "";
    document.getElementById("sn-precio-set").style.display = esSet ? "flex" : "none";
    const esTrioSet = btn.dataset.set === "2+1";
    const wrapDama2 = document.getElementById("sn-precio-dama2-wrap");
    if (wrapDama2) wrapDama2.style.display = esTrioSet ? "block" : "none";
    if (esSet) selPrecioTipoSN('unisex');
    if (esSet) renderTallaSetSN();
    // Show set talla container only if categoria is anillo/conjunto and visible
    const snTallaCont = document.getElementById("sn-talla-container");
    const snTallaSetCont = document.getElementById("sn-talla-set-container");
    const snTallaSetResumen = document.getElementById("sn-tallas-set-resumen");
    if (snTallaCont && snTallaCont.style.display !== "none") {
        snTallaCont.style.display = esSet ? "none" : "block";
        if (snTallaSetCont) snTallaSetCont.style.display = esSet ? "block" : "none";
        if (snTallaSetResumen) snTallaSetResumen.style.display = esSet ? "block" : "none";
    }
    // Al cambiar modo, limpiar tallas del modo anterior
    const snResumenInd = document.getElementById("sn-tallas-resumen");
    if (esSet) {
        _snTallasQty = {};
        if (snResumenInd) snResumenInd.innerHTML = "";
    } else {
        _snTallasQtyDama = {}; _snTallasQtyCaballero = {};
        const srSet = document.getElementById("sn-tallas-set-resumen");
        if (srSet) srSet.innerHTML = "";
    }
}
function selPrecioTipoSN(tipo) {
    const esUni = tipo === 'unisex';
    document.getElementById("sn-precio-unisex-btn").style.background = esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("sn-precio-unisex-btn").style.color = esUni ? "#111" : "var(--blanco)";
    document.getElementById("sn-precio-unisex-btn").style.borderColor = esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("sn-precio-dif-btn").style.background = !esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("sn-precio-dif-btn").style.color = !esUni ? "#111" : "var(--blanco)";
    document.getElementById("sn-precio-dif-btn").style.borderColor = !esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("sn-precio-unisex-wrap").style.display = esUni ? "" : "none";
    document.getElementById("sn-precio-dif-wrap").style.display = !esUni ? "flex" : "none";
    // Actualizar selector de tallas si el set container está visible
    if (document.getElementById("sn-talla-set-container")?.style.display !== "none") {
        _snTallasQtyDama = {}; _snTallasQtyCaballero = {};
        renderTallaSetSN();
    }
}

function selSetEP(btn) {
    document.querySelectorAll(".ep-set-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    btn.style.background = "var(--dorado)"; btn.style.color = "#111"; btn.style.borderColor = "var(--dorado)";
    const esSet = btn.dataset.set !== "";
    document.getElementById("ep-precio").style.display = esSet ? "none" : "";
    document.getElementById("ep-precio-set-wrap").style.display = esSet ? "flex" : "none";
    if (esSet) selPrecioTipoEP('unisex');
}
function selPrecioTipoEP(tipo) {
    const esUni = tipo === 'unisex';
    document.getElementById("ep-precio-unisex-btn").style.background = esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("ep-precio-unisex-btn").style.color = esUni ? "#111" : "var(--blanco)";
    document.getElementById("ep-precio-unisex-btn").style.borderColor = esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("ep-precio-dif-btn").style.background = !esUni ? "var(--dorado)" : "var(--gris2)";
    document.getElementById("ep-precio-dif-btn").style.color = !esUni ? "#111" : "var(--blanco)";
    document.getElementById("ep-precio-dif-btn").style.borderColor = !esUni ? "var(--dorado)" : "var(--borde)";
    document.getElementById("ep-precio-unisex-wrap").style.display = esUni ? "" : "none";
    document.getElementById("ep-precio-dif-wrap").style.display = !esUni ? "" : "none";
}

function toggleMenuMover(codigo, btn) {
    // Cerrar todos los otros menús abiertos
    document.querySelectorAll('[id^="menu-mover-"]').forEach(m => {
        if (m.id !== `menu-mover-${codigo}`) m.style.display = "none";
    });
    const menu = document.getElementById(`menu-mover-${codigo}`);
    if (!menu) return;
    menu.style.display = menu.style.display === "none" ? "block" : "none";
    // Posición fija calculada desde el botón — así el menú no queda cortado
    // por el scroll horizontal de la tabla, y se abre hacia arriba si no hay
    // espacio abajo (ej. últimas filas de una tarjeta larga).
    if (menu.style.display === "block" && btn) {
        menu.style.position = "fixed";
        const rect = btn.getBoundingClientRect();
        const menuAltura = menu.offsetHeight || 110;
        const espacioAbajo = window.innerHeight - rect.bottom;
        if (espacioAbajo < menuAltura + 10) {
            menu.style.top = "auto";
            menu.style.bottom = (window.innerHeight - rect.top + 4) + "px";
        } else {
            menu.style.bottom = "auto";
            menu.style.top = (rect.bottom + 4) + "px";
        }
        menu.style.left = "auto";
        menu.style.right = (window.innerWidth - rect.right) + "px";
    }
    // Cerrar al hacer clic fuera
    if (menu.style.display === "block") {
        setTimeout(() => {
            document.addEventListener("click", function cerrar() {
                menu.style.display = "none";
                document.removeEventListener("click", cerrar);
            }, { once: true });
        }, 10);
    }
}

async function moverItemDirecto(codigoOCodigos, destino) {
    document.querySelectorAll('[id^="menu-mover-"]').forEach(m => m.style.display = "none");
    document.querySelectorAll('.menu-mover-grid').forEach(m => m.style.display = "none");
    // Acepta un código individual (fila de lista = una talla puntual) o un
    // arreglo de códigos (tarjeta de grupo en la vista grid): mover desde el
    // grupo mueve TODAS las tallas en existencia de ese diseño, no solo la
    // que estaba activa/resaltada en ese momento.
    // Desde el grupo («Enviar todo» / «Devolver todo») se mueven TODAS las unidades de cada talla, no solo 1:
    // antes una talla con 9 en bodega pasaba solo 1 a tienda. Desde una fila (una talla) sigue siendo 1 unidad.
    const todo = Array.isArray(codigoOCodigos);
    stockSeleccionados = todo ? [...codigoOCodigos] : [codigoOCodigos];
    if (destino === "tienda") await asignarATienda(todo);
    else if (destino === "bodega") await devolverABodega(todo);
    stockSeleccionados = [];
}

function moverItemDirectoVendedor(codigoOCodigos) {
    document.querySelectorAll('[id^="menu-mover-"]').forEach(m => m.style.display = "none");
    document.querySelectorAll('.menu-mover-grid').forEach(m => m.style.display = "none");
    // asignarAVendedor() solo ABRE el modal — no espera a que el usuario elija
    // vendedor y confirme, así que un `await` seguido de vaciar
    // stockSeleccionados se ejecutaba de inmediato, antes de que el usuario
    // tocara nada. Cuando confirmarAsignarVendedor() finalmente se disparaba,
    // stockSeleccionados ya estaba vacío: mandaba codigos:[] al servidor, que
    // no hacía nada pero igual respondía ok, y el toast decía "✅ Asignados
    // correctamente" aunque la asignación real nunca se ejecutó. Ahora queda
    // seteado hasta que confirmarAsignarVendedor() lo limpie de verdad
    // (via limpiarSeleccion(), al terminar con éxito).
    // Mismo criterio que moverItemDirecto: desde una tarjeta de grupo (vista
    // grid) llega un arreglo con TODAS las tallas en existencia, no solo la activa.
    stockSeleccionados = Array.isArray(codigoOCodigos) ? [...codigoOCodigos] : [codigoOCodigos];
    asignarAVendedor();
}

async function toggleReservaStock(codigo) {
    const item = stockData.find(p => String(p.codigo) === String(codigo));
    if (!item) return;
    const nuevoValor = !item.reservado;
    const res = await apiPost({ accion: "EDITAR_PRODUCTO", codigo, reservado: nuevoValor });
    if (!res || res.ok === false) { toast("⚠️ Error al actualizar reserva"); return; }
    item.reservado = nuevoValor;
    toast(nuevoValor ? "⏳ Producto reservado — ya no aparece disponible en el catálogo" : "✅ Reserva liberada");
    filtrarStock();
}

function toggleSeleccionStock(codigo) {
    const idx = stockSeleccionados.indexOf(codigo);
    if (idx >= 0) stockSeleccionados.splice(idx, 1);
    else stockSeleccionados.push(codigo);
    
    const accionesDiv = document.getElementById("stock-acciones");
    const countEl = document.getElementById("stock-sel-count");
    if (stockSeleccionados.length > 0) {
        accionesDiv.style.display = "flex";
        // Pegar la barra justo debajo del header (que también es sticky top:0) —
        // si no, ambos chocan en el mismo lugar y el header (con más prioridad)
        // termina tapando esta barra en vez de que quede visible al hacer scroll.
        const header = document.querySelector(".header");
        accionesDiv.style.top = (header?.offsetHeight || 60) + "px";
        countEl.textContent = stockSeleccionados.length + " seleccionado" + (stockSeleccionados.length > 1 ? "s" : "");
    } else {
        accionesDiv.style.display = "none";
    }
    filtrarStock();
}

let _modoScannerStock = false;
window._modoScannerStock = false;

function toggleModoScanner() {
    _modoScannerStock = !_modoScannerStock;
    window._modoScannerStock = _modoScannerStock;
    const btn = document.getElementById("btn-scanner-stock");
    const inp = document.getElementById("bus-stock");
    if (_modoScannerStock) {
        btn.style.background = "#2ecc71";
        btn.style.color = "#111";
        btn.style.border = "1px solid #27ae60";
        btn.textContent = "📡 Scanner ON";
        inp.placeholder = "Listo para escanear...";
        inp.value = "";
        inp.focus();
    } else {
        btn.style.background = "#222";
        btn.style.color = "#888";
        btn.style.border = "1px solid #444";
        btn.textContent = "📡 Scanner";
        inp.placeholder = "Buscar por código o nombre...";
    }
}

function buscarStockPorScanner(cod) {
    const inp = document.getElementById("bus-stock");
    if (inp) inp.value = cod;
    filtrarStock();
    // Resaltar tarjeta encontrada en verde
    setTimeout(() => {
        const lista = document.getElementById("lista-stock");
        const cards = lista ? lista.querySelectorAll(".inv-item") : [];
        let encontrada = null;
        cards.forEach(card => {
            const c = (card.dataset.codigo || "").toUpperCase();
            if (c === cod.toUpperCase()) { encontrada = card; }
            else { card.style.borderColor = "#333"; card.style.boxShadow = ""; }
        });
        if (encontrada) {
            encontrada.style.borderColor = "#2ecc71";
            encontrada.style.boxShadow = "0 0 0 2px #2ecc71, 0 0 16px rgba(46,204,113,0.3)";
            encontrada.scrollIntoView({ behavior: "smooth", block: "center" });
            // Quitar highlight después de 4 segundos
            setTimeout(() => {
                encontrada.style.borderColor = "#333";
                encontrada.style.boxShadow = "";
            }, 4000);
        } else if (cards.length === 1) {
            // Si solo hay un resultado (búsqueda parcial), resaltarlo igual
            cards[0].style.borderColor = "#2ecc71";
            cards[0].style.boxShadow = "0 0 0 2px #2ecc71, 0 0 16px rgba(46,204,113,0.3)";
            cards[0].scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => {
                cards[0].style.borderColor = "#333";
                cards[0].style.boxShadow = "";
            }, 4000);
        }
    }, 80);
}

function buscarEtiquetasPorScanner(cod) {
    const inp = document.getElementById("bus-etiquetas");
    if (inp) inp.value = cod;
    filtrarProductosEtiquetas();
    setTimeout(() => {
        const grid = document.getElementById("grid-etiquetas");
        const cards = grid ? grid.querySelectorAll("div[id^='etqcard-']") : [];
        // Buscar coincidencia exacta por código
        const idEsperado = "etqcard-" + cod.replace(/[^a-zA-Z0-9]/g, '-');
        let card = document.getElementById(idEsperado) || (cards.length === 1 ? cards[0] : null);
        if (card) {
            card.style.outline = "2px solid #2ecc71";
            card.style.boxShadow = "0 0 12px rgba(46,204,113,0.4)";
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => { card.style.outline = ""; card.style.boxShadow = ""; }, 4000);
        }
    }, 80);
}
